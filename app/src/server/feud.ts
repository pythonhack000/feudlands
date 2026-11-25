// The shared war: one island per post, stored as an ordered log of moves.
// Every client replays the same log onto the same seeded island, so everyone sees the same map.
import { dayFrames, isCrowd, NAMES, sideOf, tallyDay } from '../shared/island.ts';
import { archipelagoGif, islandPng, weekGridPng } from './mapImage.ts';
import { fleetBonus, ISLE_NAMES, isleSeed, islesFor, type IsleStat } from '../shared/archipelago.ts';
import type { Island } from '../shared/island.ts';
import {
  cryPower, isSide, LEGACY_DAY, MAP_REACH, TEXT_MAX, WEEK_DAYS, weekOf,
  type Argument, type FeudInfo, type FighterRecord, type LastTime, type Move, type WeekRow, type NewMove, type Side, type State,
} from '../shared/rules.ts';
import { builtinTopic, candidatesAfter, DEFAULT_TOPIC, SUGGEST, type Topic } from '../shared/topics.ts';

/** The slice of Redis this game uses. Devvit's client fits it; tests use a memory copy. */
export interface Store {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<unknown>;
  incrBy(key: string, value: number): Promise<number>;
  zAdd(key: string, ...members: { member: string; score: number }[]): Promise<number>;
  zRange(key: string, start: number, stop: number, options: { by: 'score' }): Promise<{ member: string; score: number }[]>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, values: Record<string, string>): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hDel(key: string, fields: string[]): Promise<number>;
}

export interface Results {
  feud: FeudInfo;
  a: number; b: number;
  sworn: Record<Side, number>;
  general: { name: string; hexes: number } | null;
  cry: { text: string; by: string; side: Side; hexes: number } | null;
  hexes: Record<string, number>;
  /** Each island's hexes at the end of the day. */
  isles?: { name: string; a: number; b: number }[];
}

const hexes = (n: number) => `${n} ${n === 1 ? 'hex' : 'hexes'}`;
const pct = (n: number, total: number) => Math.round((n / Math.max(1, total)) * 100);

/** The pinned comment that closes the day. Plain Markdown for Reddit. */
export function resultsComment(r: Results, tomorrow: { question: string; by?: string } | null = null): string {
  const total = r.a + r.b, win: Side = r.a >= r.b ? 'a' : 'b', { day, sides } = r.feud;
  const head = r.a === r.b
    ? `**Midnight, day ${day}: the island is split, 50% to 50%** (${hexes(r.a)} each).`
    : `**Midnight, day ${day}: the ${sides[win].toLowerCase()} hold the island, ${pct(r[win], total)}% to ${100 - pct(r[win], total)}%** (${r[win]} hexes to ${r[win === 'a' ? 'b' : 'a']}).`;
  const last = r.feud.rematch;
  const lines = [
    last ? `- Rematch: last time, on day ${last.day}, ${last.a === last.b ? 'it ended split' : `the ${sides[last.a > last.b ? 'a' : 'b'].toLowerCase()} won, ${pct(Math.max(last.a, last.b), last.a + last.b)}% to ${100 - pct(Math.max(last.a, last.b), last.a + last.b)}%`}` : null,
    r.general ? `- General of the day: u/${r.general.name}, ${hexes(r.general.hexes)} taken` : null,
    r.cry ? `- Cry of the day: \u201c${r.cry.text}\u201d by u/${r.cry.by}${r.cry.hexes ? `, took ${hexes(r.cry.hexes)}` : ''}` : null,
    r.isles && r.isles.length > 1 ? `- The islands: ${r.isles.map((x) => `${x.name} ${x.a === x.b ? 'split' : `to the ${sides[x.a > x.b ? 'a' : 'b'].toLowerCase()}`}`).join(', ')}` : null,
    `- Sworn in: ${r.sworn.a} for the ${sides.a.toLowerCase()}, ${r.sworn.b} for the ${sides.b.toLowerCase()}`,
  ].filter(Boolean);
  const next = tomorrow ? ['', `Tomorrow's feud, picked by the council: **${tomorrow.question}**${tomorrow.by ? `, suggested by u/${tomorrow.by}` : ''}`] : [];
  return [head, '', ...lines, ...next].join('\n');
}

/** The moderators' heads-up an hour before midnight, when tomorrow's feud is a player's suggestion. */
export function ballotNotice(topic: Topic, votes: number, postUrl: string): { subject: string; body: string } {
  const lines = [
    `Tomorrow's feud is leading with ${votes} ${votes === 1 ? 'vote' : 'votes'}. It was suggested by u/${topic.by}, so the app will post their words as the title at 00:00 UTC:`,
    '',
    `> **${topic.question}** ${topic.sides.a} or ${topic.sides.b}`,
    ...topic.openers.map(([side, text]) => `> For the ${topic.sides[side].toLowerCase()}: ${text}`),
    '',
    `If it shouldn't run, open [today's feud](${postUrl}), press Midnight, and remove it from the ballot. The next most voted feud runs instead.`,
  ];
  return { subject: 'Tomorrow\u2019s Feudlands feud needs a look', body: lines.join('\n') };
}

export class FeudError extends Error {
  readonly status: 400 | 401 | 404 | 429;
  constructor(message: string, status: 400 | 401 | 404 | 429 = 400) { super(message); this.status = status; }
}

/** The demo crowd makes one move per tick, only while someone is watching, up to a day's worth. */
export const BOT_TICK_MS = 5000;
export const BOT_MOVES_PER_DAY = 80;
const BOT_VOTE_CHANCE = 0.6;
/** Anti-abuse ceilings per fighter per day. The game's own hand is smaller. */
const LIMITS = { build: 6, charge: 8, args: 12 } as const;
const HERE_WINDOW_MS = 5 * 60 * 1000;
const MAX_SUGGESTIONS_SHOWN = 5;
/** Frames in the day's animation, morning included. */
const DAY_GIF_FRAMES = 12;
/** An author's opening argument starts with their own vote. */
const OPENER_VOTES = 1;
const LAST_SEQ = Number.MAX_SAFE_INTEGER;

// The council's opening arguments, from the crowd, so a new post isn't empty.
// Ids s1, s2... follow the topic's order; a rebuttal points at the argument it answers.
type SeedArg = { id: string; side: Side; by: string; text: string; parent: string | null; votes: number };
function seedArgs(topic: Topic): SeedArg[] {
  const fighters = { a: NAMES.filter((n) => sideOf(n) === 'a'), b: NAMES.filter((n) => sideOf(n) === 'b') };
  const used = { a: 0, b: 0 };
  return topic.openers.map(([side, text, votes, rebuts, author], i) => ({
    id: `s${i + 1}`, side, text, votes,
    by: author ?? fighters[side][used[side]++ % fighters[side].length],
    parent: rebuts === null ? null : `s${rebuts + 1}`,
  }));
}

/** Every feud post, scored by when it opened, so midnight knows which days to close. */
export const POSTS_KEY = 'feud:posts';
/** Feuds players suggested, by id, so any later post can fight over them. */
const TOPICS_KEY = 'feud:topics', TOPIC_SEQ_KEY = 'feud:topicseq';
/** Every fighter's run across days. */
const FIGHTERS_KEY = 'feud:fighters';

/** A built-in topic, or one a player suggested. Unknown ids fall back to cats or dogs. */
export async function resolveTopic(store: Store, id: string | undefined): Promise<Topic> {
  const builtin = builtinTopic(id);
  if (builtin || !id) return builtin ?? DEFAULT_TOPIC;
  const row = await store.hGet(TOPICS_KEY, id);
  return row ? (JSON.parse(row) as Topic) : DEFAULT_TOPIC;
}

/** Plain one-line text: no markup, no links, no control characters. */
function plain(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f<>*_~`#|\[\]\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
const LINKY = /https?:|www\.|\.(com|net|org|io|gg|ly)\b|\b[ru]\/\w/i;

/** The flair line for a fighter's record. */
export function flairText(r: FighterRecord): string {
  const parts = r.streak ? [`${r.streak} ${r.streak === 1 ? 'day' : 'days'} at war`] : [];
  if (r.wins) parts.push(`${r.wins} ${r.wins === 1 ? 'win' : 'wins'}`);
  if (r.made) parts.push(r.made === 1 ? 'feud maker' : `feud maker x${r.made}`);
  if (r.general) parts.push(`General of week ${r.general}`);
  return `Feudlands: ${parts.join(', ')}`;
}

/** A player's feud became a post: they're a feud maker. Returns their new record for the flair. */
export async function creditMaker(store: Store, topic: Topic, day: number): Promise<{ name: string; record: FighterRecord } | null> {
  if (!topic.by) return null;
  const before = await recordOf(store, topic.by);
  const record = { ...(before ?? { streak: 0, best: 0, wins: 0, lastDay: day - 1 }), made: (before?.made ?? 0) + 1 };
  await store.hSet(FIGHTERS_KEY, { [topic.by]: JSON.stringify(record) });
  return { name: topic.by, record };
}

// ---------- the week: hexes and wins add up over seven days, and the best fighter is its General ----------
const weekKeys = (week: number) => ({ hexes: `feud:week:${week}:hexes`, wins: `feud:week:${week}:wins`, days: `feud:week:${week}:days` });
const WEEK_BOARD_SIZE = 10;

export async function weekBoard(store: Store, week: number, size = WEEK_BOARD_SIZE): Promise<WeekRow[]> {
  const k = weekKeys(week);
  const [hexes, wins] = await Promise.all([store.hGetAll(k.hexes), store.hGetAll(k.wins)]);
  return [...new Set([...Object.keys(hexes), ...Object.keys(wins)])]
    .map((name) => ({ name, hexes: Number(hexes[name] ?? 0), wins: Number(wins[name] ?? 0) }))
    .sort((x, y) => y.hexes - x.hexes || y.wins - x.wins || x.name.localeCompare(y.name))
    .slice(0, size);
}

/** True on the day that closes a week. */
export const endsWeek = (day: number): boolean => day % WEEK_DAYS === 0;

/** The weekly post: the table of generals. Plain Markdown. */
export function weekPost(week: number, board: WeekRow[]): { title: string; body: string } {
  const rows = board.map((r, i) => `| ${i + 1} | u/${r.name} | ${r.hexes} | ${r.wins} |`);
  return {
    title: `Feudlands, week ${week}: the generals`,
    body: [
      `Seven feuds are done. Here's who took the most of the island this week.`,
      '',
      '| | Fighter | Hexes taken | Days won |',
      '|---|---|---|---|',
      ...rows,
      '',
      `u/${board[0].name} is General of week ${week}. A new week starts at the next feud.`,
    ].join('\n'),
  };
}

/** The week's islands, each as it stood at its midnight, in day order, as one picture. Null before any day closed. */
export async function weekMapPng(store: Store, week: number): Promise<Buffer | null> {
  const days = Object.entries(await store.hGetAll(weekKeys(week).days)).sort((x, y) => Number(x[0]) - Number(y[0]));
  if (!days.length) return null;
  const islands = await Promise.all(days.map(([, post]) => new Feud(store, post, null).island()));
  return weekGridPng(islands);
}

/** Names the week's General in their record, for the flair. */
export async function crownGeneral(store: Store, name: string, week: number): Promise<FighterRecord> {
  const before = await recordOf(store, name);
  const record = { ...(before ?? { streak: 0, best: 0, wins: 0, lastDay: 0 }), general: week };
  await store.hSet(FIGHTERS_KEY, { [name]: JSON.stringify(record) });
  return record;
}

const historyKey = (topicId: string) => `feud:history:${topicId}`;
/** The last time this topic was fought, before the given day. */
async function lastTime(store: Store, topicId: string, before: number): Promise<LastTime | null> {
  const rows = Object.values(await store.hGetAll(historyKey(topicId))).map((row) => JSON.parse(row) as LastTime);
  return rows.filter((r) => r.day < before).sort((x, y) => y.day - x.day)[0] ?? null;
}

const keys = (post: string) => {
  const k = (name: string) => `feud:${post}:${name}`;
  return {
    meta: k('meta'), seq: k('seq'), moves: k('moves'), sides: k('sides'), seen: k('seen'),
    args: k('args'), votes: k('votes'), shared: k('shared'), next: k('next'), nextMine: k('nextmine'),
    proposals: k('proposals'), proposedBy: k('proposedby'),
    isleOf: k('isleof'), isleSworn: k('islesworn'), isleStats: k('islestats'),
    // Island 0 keeps the original key names, so posts from before the archipelago carry on.
    movesOf: (isle: number) => (isle === 0 ? k('moves') : k(`moves:${isle}`)),
    botSlotsOf: (isle: number) => (isle === 0 ? k('botslots') : k(`botslots:${isle}`)),
    botCountOf: (isle: number) => (isle === 0 ? k('botcount') : k(`botcount:${isle}`)), botSlots: k('botslots'), botCount: k('botcount'),
    used: (user: string) => k(`used:${user}`), myVotes: (user: string) => k(`uv:${user}`),
  };
};
type Keys = ReturnType<typeof keys>;

export class Feud {
  private readonly k: Keys;
  private readonly store: Store;
  private readonly user: string | null;
  private readonly now: number;
  private readonly post: string;
  /** The island asked for; null means the fighter's own, or the first. */
  private readonly view: number | null;
  constructor(store: Store, post: string, user: string | null, now = Date.now(), view: number | null = null) {
    this.store = store; this.user = user; this.now = now; this.post = post; this.k = keys(post); this.view = view;
  }

  /** Sets up a brand-new feud post with its topic and day, before anyone opens it. */
  static async open(store: Store, post: string, topicId: string, day: number): Promise<void> {
    await store.hSet(keys(post).meta, { topic: (await resolveTopic(store, topicId)).id, day: String(day) });
  }

  /** Which feud this post is. Posts from before topics existed are cats or dogs, day 12. */
  async info(): Promise<FeudInfo> {
    const meta = await this.store.hGetAll(this.k.meta);
    const topic = await resolveTopic(this.store, meta.topic), day = Number(meta.day) || LEGACY_DAY;
    return {
      day, topic: topic.id, question: topic.question, sides: topic.sides, glyphs: topic.glyphs ?? null, by: topic.by ?? null,
      rematch: await lastTime(this.store, topic.id, day),
    };
  }

  /** Tomorrow's three choices with their votes, and the one you picked. */
  async next(): Promise<State['next']> {
    const info = await this.info();
    const [votes, mine, proposals, suggested] = await Promise.all([
      this.store.hGetAll(this.k.next),
      this.user ? this.store.hGet(this.k.nextMine, this.user) : Promise.resolve(undefined),
      this.store.hGetAll(this.k.proposals),
      this.user ? this.store.hGet(this.k.proposedBy, this.user) : Promise.resolve(undefined),
    ]);
    const choice = (t: Topic) => ({ id: t.id, question: t.question, votes: Number(votes[t.id] ?? 0), by: t.by ?? null });
    // Players' suggestions follow the three built-in choices, the most voted first.
    const fromPlayers = Object.values(proposals).map((row) => choice(JSON.parse(row) as Topic))
      .sort((x, y) => y.votes - x.votes).slice(0, MAX_SUGGESTIONS_SHOWN);
    return { choices: [...candidatesAfter(info.topic).map(choice), ...fromPlayers], mine: mine ?? null, suggested: Boolean(suggested) };
  }

  /**
   * A player's own feud for tomorrow's ballot: a question, two sides, and optionally one argument for each side
   * to open the council with. One per fighter per day, and it gets their vote.
   */
  async suggest(question: unknown, a: unknown, b: unknown, argA: unknown = null, argB: unknown = null): Promise<string> {
    const user = this.fighter();
    let q = plain(question, SUGGEST.questionMax);
    const sides = { a: plain(a, SUGGEST.sideMax), b: plain(b, SUGGEST.sideMax) };
    if (q.length < SUGGEST.questionMin) throw new FeudError('Ask a real question');
    if (!sides.a || !sides.b) throw new FeudError('Name both sides');
    if (sides.a.toLowerCase() === sides.b.toLowerCase()) throw new FeudError('The two sides need different names');
    const openers = { a: plain(argA, TEXT_MAX), b: plain(argB, TEXT_MAX) };
    if ([q, sides.a, sides.b, openers.a, openers.b].some((t) => LINKY.test(t))) throw new FeudError('No links or usernames in a feud');
    if (!q.endsWith('?')) q = `${q.replace(/[.!]+$/, '')}?`;
    const same = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((await this.next()).choices.some((c) => same(c.question) === same(q))) throw new FeudError('That feud is already on the ballot. Vote for it instead.');
    const id = `c${await this.store.incrBy(TOPIC_SEQ_KEY, 1)}`;
    if (!(await this.store.hSetNX(this.k.proposedBy, user, id))) throw new FeudError('You already suggested a feud today', 429);
    const topic: Topic = {
      id, question: q, sides, by: user,
      openers: (['a', 'b'] as const).filter((sd) => openers[sd]).map((sd) => [sd, openers[sd], OPENER_VOTES, null, user] as Topic['openers'][number]),
    };
    const row = JSON.stringify(topic);
    await this.store.hSet(TOPICS_KEY, { [id]: row });
    await this.store.hSet(this.k.proposals, { [id]: row });
    return id; // the author can't vote for it: other fighters have to want it
  }

  /** A moderator strikes a player's suggestion off the ballot. Its votes go with it. */
  async removeSuggestion(topicId: unknown): Promise<void> {
    if (typeof topicId !== 'string' || !(await this.store.hGet(this.k.proposals, topicId))) throw new FeudError('That suggestion is already gone', 404);
    await this.store.hDel(this.k.proposals, [topicId]);
    await this.store.hDel(this.k.next, [topicId]);
  }

  /** One vote per fighter for tomorrow's feud; voting again moves it. */
  async voteNext(topicId: unknown): Promise<void> {
    const user = this.fighter();
    const { choices } = await this.next();
    const choice = choices.find((c) => c.id === topicId);
    if (!choice) throw new FeudError('That feud isn\u2019t on tomorrow\u2019s ballot');
    if (choice.by === user) throw new FeudError('You can\u2019t vote for your own feud. Get others to.');
    const before = await this.store.hGet(this.k.nextMine, user);
    if (before === topicId) return;
    if (before && (await this.store.hGet(this.k.next, before)) !== undefined) await this.store.hIncrBy(this.k.next, before, -1);
    await this.store.hIncrBy(this.k.next, topicId as string, 1);
    await this.store.hSet(this.k.nextMine, { [user]: topicId as string });
  }

  /** The ballot's winner. A tie goes to the earlier choice, so an empty ballot still picks one. */
  async winner(): Promise<string> {
    const { choices } = await this.next();
    return choices.reduce((best, c) => (c.votes > best.votes ? c : best)).id;
  }

  /** Everything after `after` in the log, plus the council and who you are. */
  async state(after: number): Promise<State> {
    await this.seed();
    const isles = await this.isles();
    const viewing = this.view !== null && this.view >= 0 && this.view < isles.count ? this.view : isles.mine ?? 0;
    await this.tickBots(viewing);
    if (this.user) await this.store.zAdd(this.k.seen, { member: this.user, score: this.now });
    const day = (await this.info()).day;
    const [feud, next, record, moves, args, myVotes, sides, here, botCount, top] = await Promise.all([
      this.info(),
      this.next(),
      this.user ? recordOf(this.store, this.user) : Promise.resolve(null),
      this.store.zRange(this.k.movesOf(viewing), after + 1, LAST_SEQ, { by: 'score' }),
      this.args(),
      this.user ? this.store.hGetAll(this.k.myVotes(this.user)) : Promise.resolve({}),
      this.store.hGetAll(this.k.sides),
      this.store.zRange(this.k.seen, this.now - HERE_WINDOW_MS, this.now, { by: 'score' }),
      this.store.get(this.k.botCountOf(viewing)),
      weekBoard(this.store, weekOf(day), 5),
    ]);
    const side = this.user ? sides[this.user] : undefined;
    const sworn = { a: 0, b: 0 };
    Object.values(sides).forEach((s) => { if (isSide(s)) sworn[s]++; });
    return {
      feud, next,
      isles: { mine: isles.mine, viewing, stats: await this.isleStats(isles.count) },
      week: { n: weekOf(day), top },
      me: { name: this.user, side: isSide(side) ? side : null, record },
      sworn,
      moves: moves.map((m) => JSON.parse(m.member) as Move),
      args,
      myVotes: Object.fromEntries(Object.entries(myVotes).map(([id, v]) => [id, Number(v)])),
      here: here.length,
      quiet: Number(botCount ?? 0) >= BOT_MOVES_PER_DAY,
    };
  }

  /** Swears you in. Your first choice stands for the day. Returns your record when this is your first fight of the day. */
  async chooseSide(side: unknown): Promise<FighterRecord | null> {
    const user = this.fighter();
    if (!isSide(side)) throw new FeudError('Pick a side');
    if (!(await this.store.hSetNX(this.k.sides, user, side))) return null;
    await this.assignIsle(user, side);
    const { day } = await this.info(), before = await recordOf(this.store, user);
    if (before && before.lastDay === day) return null;
    const streak = before && before.lastDay === day - 1 ? before.streak + 1 : 1;
    const record = { streak, best: Math.max(streak, before?.best ?? 0), wins: before?.wins ?? 0, lastDay: day };
    await this.store.hSet(FIGHTERS_KEY, { [user]: JSON.stringify(record) });
    return record;
  }

  /** Adds the day's hexes and wins to the week. Only real fighters count; the crowd never makes a board. */
  async addToWeek(r: Results, winners: string[]): Promise<void> {
    const k = weekKeys(weekOf(r.feud.day));
    await this.store.hSet(k.days, { [String(r.feud.day)]: this.post });
    for (const [name, n] of Object.entries(r.hexes)) if (n > 0 && !isCrowd(name)) await this.store.hIncrBy(k.hexes, name, n);
    for (const name of winners) await this.store.hIncrBy(k.wins, name, 1);
  }

  /** An island's log, in order. */
  private async movesOf(isle: number): Promise<Move[]> {
    return (await this.store.zRange(this.k.movesOf(isle), 0, LAST_SEQ, { by: 'score' })).map((m) => JSON.parse(m.member) as Move);
  }

  /** An island as it stands at the end of its log (the fighter's own, or the first). */
  async island(isle?: number): Promise<Island> {
    const at = isle ?? (await this.isles()).mine ?? 0, { day } = await this.info();
    return tallyDay(isleSeed(day, at), await this.movesOf(at)).cells;
  }

  /** The whole day as a looping GIF: every island from the morning to its last move, side by side. */
  async dayGif(): Promise<Buffer> {
    const { count } = await this.isles(), { day } = await this.info();
    const perIsle = await Promise.all(Array.from({ length: count }, async (_, i) => dayFrames(isleSeed(day, i), await this.movesOf(i), DAY_GIF_FRAMES)));
    const length = Math.max(...perIsle.map((f) => f.length));
    const frames = Array.from({ length }, (_, j) => perIsle.map((f) => f[Math.min(j, f.length - 1)]));
    return archipelagoGif(frames);
  }

  /** The fighter's island as it stands now, as a PNG. */
  async mapPng(): Promise<Buffer> {
    return islandPng(await this.island());
  }

  /** Every island at the end of the day, side by side. */
  async archipelagoPng(): Promise<Buffer> {
    const { count } = await this.isles();
    return weekGridPng(await Promise.all(Array.from({ length: count }, (_, i) => this.island(i))));
  }

  /** Files today's result under its topic, so the next time it comes round it's a rematch. */
  async remember(r: Results): Promise<void> {
    const entry: LastTime = { day: r.feud.day, a: r.a, b: r.b };
    await this.store.hSet(historyKey(r.feud.topic), { [String(r.feud.day)]: JSON.stringify(entry) });
  }

  /** At midnight: everyone sworn to the winning side gets a win. Returns their names and new records. A split day has no winner. */
  async creditWinners(r: Results): Promise<{ name: string; record: FighterRecord }[]> {
    if (r.a === r.b) return [];
    const win: Side = r.a > r.b ? 'a' : 'b', sides = await this.store.hGetAll(this.k.sides), out = [];
    for (const [name, side] of Object.entries(sides)) {
      if (side !== win) continue;
      const before = await recordOf(this.store, name);
      const record = { ...(before ?? { streak: 1, best: 1, lastDay: r.feud.day }), wins: (before?.wins ?? 0) + 1 };
      await this.store.hSet(FIGHTERS_KEY, { [name]: JSON.stringify(record) });
      out.push({ name, record });
    }
    return out;
  }

  async build(kind: unknown, q: unknown, r: unknown): Promise<void> {
    const user = this.fighter(), side = await this.sideOf(user);
    if (kind !== 'camp' && kind !== 'tower') throw new FeudError('Unknown piece');
    const at = hexOf(q, r);
    await this.spend(user, 'build');
    await this.append({ t: 'build', kind, ...at, by: user, side }, await this.myIsle(user));
  }

  async charge(q: unknown, r: unknown, cryId: unknown): Promise<void> {
    const user = this.fighter(), side = await this.sideOf(user);
    const at = hexOf(q, r);
    let cry: { id: string; power: number } | null = null;
    if (cryId !== null && cryId !== undefined) {
      const args = await this.args(), chosen = args.find((a) => a.id === cryId && a.parent === null);
      if (!chosen) throw new FeudError('That battle cry is gone', 404);
      if (chosen.side !== side) throw new FeudError('Shout your own side’s cry');
      const rebuttal = Math.max(0, ...args.filter((a) => a.parent === chosen.id).map((a) => a.votes));
      cry = { id: chosen.id, power: cryPower(chosen.votes, rebuttal) };
    }
    const isle = await this.myIsle(user), { count } = await this.isles();
    const fleet = fleetBonus(await this.isleStats(count), isle, side);
    await this.spend(user, 'charge');
    await this.append({ t: 'charge', ...at, cry, fleet, by: user, side }, isle);
  }

  /** A new argument, or a rebuttal when `parent` names the other side's argument. */
  async argue(text: unknown, parent: unknown): Promise<string> {
    const user = this.fighter(), side = await this.sideOf(user);
    const clean = typeof text === 'string' ? text.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, TEXT_MAX) : '';
    if (!clean) throw new FeudError('Write something first');
    let parentId: string | null = null;
    if (parent !== null && parent !== undefined) {
      const target = (await this.args()).find((a) => a.id === parent && a.parent === null);
      if (!target) throw new FeudError('That argument is gone', 404);
      if (target.side === side) throw new FeudError('Rebut the other side, not your own');
      parentId = target.id;
    }
    await this.spend(user, 'args');
    const id = `u${await this.store.incrBy(this.k.seq, 1)}`;
    const arg = { id, side, by: user, text: clean, parent: parentId, at: this.now };
    await this.store.hSet(this.k.args, { [id]: JSON.stringify(arg) });
    await this.store.hSet(this.k.votes, { [id]: '0' });
    await this.vote(id, 1);
    return id;
  }

  async vote(id: unknown, dir: unknown): Promise<void> {
    const user = this.fighter();
    if (dir !== 1 && dir !== -1 && dir !== 0) throw new FeudError('Vote up, down or not at all');
    if (typeof id !== 'string' || !(await this.store.hGet(this.k.args, id))) throw new FeudError('That argument is gone', 404);
    const before = Number((await this.store.hGet(this.k.myVotes(user), id)) ?? 0);
    if (before === dir) return;
    await this.store.hIncrBy(this.k.votes, id, dir - before);
    await this.store.hSet(this.k.myVotes(user), { [id]: String(dir) });
  }

  /** The day so far, counted from the whole log: what the midnight comment says. */
  async results(): Promise<Results> {
    const [feud, { count }, args, sides] = await Promise.all([this.info(), this.isles(), this.args(), this.store.hGetAll(this.k.sides)]);
    const tallies = await Promise.all(Array.from({ length: count }, async (_, i) => tallyDay(isleSeed(feud.day, i), await this.movesOf(i))));
    const day = { a: 0, b: 0, hexes: {} as Record<string, number>, cries: {} as Record<string, number> };
    for (const t of tallies) {
      day.a += t.a; day.b += t.b;
      for (const [n, v] of Object.entries(t.hexes)) day.hexes[n] = (day.hexes[n] ?? 0) + v;
      for (const [n, v] of Object.entries(t.cries)) day.cries[n] = (day.cries[n] ?? 0) + v;
    }
    const players = Object.entries(day.hexes).filter(([name, n]) => !isCrowd(name) && n > 0).sort((x, y) => y[1] - x[1]);
    const said = args.filter((a) => a.parent === null && !isCrowd(a.by));
    const best = said.map((a) => ({ a, hexes: day.cries[a.id] ?? 0 })).sort((x, y) => y.hexes - x.hexes || y.a.votes - x.a.votes)[0];
    const sworn = { a: 0, b: 0 };
    Object.values(sides).forEach((s) => { if (isSide(s)) sworn[s]++; });
    return {
      feud, a: day.a, b: day.b, sworn,
      general: players[0] ? { name: players[0][0], hexes: players[0][1] } : null,
      cry: best ? { text: best.a.text, by: best.a.by, side: best.a.side, hexes: best.hexes } : null,
      hexes: day.hexes,
      isles: tallies.map((t, i) => ({ name: ISLE_NAMES[i], a: t.a, b: t.b })),
    };
  }

  /** One brag per fighter per day, worked out from the log so nobody can claim hexes they didn't take. */
  async shareLine(): Promise<string> {
    const user = this.fighter(), side = await this.sideOf(user);
    const r = await this.results(), mine = r.hexes[user] ?? 0;
    if (!mine) throw new FeudError('Take a hex first, then brag');
    const name = r.feud.sides[side].toLowerCase(), sign = `Feudlands, day ${r.feud.day}`;
    const lead = side === 'a' ? r.a - r.b : r.b - r.a;
    const text = lead > 0 && mine >= lead
      ? `I was the margin: the ${name} lead by ${hexes(lead)} and I took ${mine}. ${sign}`
      : `I took ${hexes(mine)} for the ${name}. ${sign}`;
    if (!(await this.store.hSetNX(this.k.shared, user, text))) throw new FeudError('You already shared today', 429);
    return text;
  }

  /** Lets a share try again if posting the comment failed. */
  async unshare(): Promise<void> {
    if (this.user) await this.store.hDel(this.k.shared, [this.user]);
  }

  private fighter(): string {
    if (!this.user) throw new FeudError('Log in to Reddit to fight', 401);
    return this.user;
  }

  private async sideOf(user: string): Promise<Side> {
    const side = await this.store.hGet(this.k.sides, user);
    if (!isSide(side)) throw new FeudError('Pick a side first');
    return side;
  }

  private async spend(user: string, what: keyof typeof LIMITS): Promise<void> {
    const used = await this.store.hIncrBy(this.k.used(user), what, 1);
    if (used > LIMITS[what]) {
      await this.store.hIncrBy(this.k.used(user), what, -1);
      throw new FeudError('That’s all you get today', 429);
    }
  }

  private async append(move: NewMove, isle: number): Promise<void> {
    const seq = await this.store.incrBy(this.k.seq, 1);
    await this.store.zAdd(this.k.movesOf(isle), { member: JSON.stringify({ ...move, seq, at: this.now }), score: seq });
    // Keep the island's standing current, so fleets and the archipelago bar never replay whole logs.
    const { day } = await this.info(), t = tallyDay(isleSeed(day, isle), await this.movesOf(isle));
    await this.store.hSet(this.k.isleStats, { [String(isle)]: JSON.stringify({ a: t.a, b: t.b }) });
  }

  /** How many islands are open, and which one is yours. */
  private async isles(): Promise<{ count: number; mine: number | null }> {
    const [sides, mine] = await Promise.all([
      this.store.hGetAll(this.k.sides),
      this.user ? this.store.hGet(this.k.isleOf, this.user) : Promise.resolve(undefined),
    ]);
    const sworn = Object.keys(sides).length;
    const own = mine !== undefined ? Number(mine) : this.user && sides[this.user] ? 0 : null; // sworn before the archipelago: island 0
    return { count: Math.max(islesFor(sworn), own === null ? 0 : own + 1), mine: own };
  }

  private async myIsle(user: string): Promise<number> {
    const isle = await this.store.hGet(this.k.isleOf, user);
    return isle === undefined ? 0 : Number(isle);
  }

  /** Every island's standing: hexes held by each side. Islands nobody has touched stand at their morning. */
  private async isleStats(count: number): Promise<IsleStat[]> {
    const [rows, { day }] = await Promise.all([this.store.hGetAll(this.k.isleStats), this.info()]);
    return Array.from({ length: count }, (_, i) => {
      if (rows[String(i)]) return JSON.parse(rows[String(i)]) as IsleStat;
      const morning = tallyDay(isleSeed(day, i), []);
      return { a: morning.a, b: morning.b };
    });
  }

  /** A new fighter goes where their side is thinnest, so every island has a fight. */
  private async assignIsle(user: string, side: Side): Promise<void> {
    const { count } = await this.isles(), counts = await this.store.hGetAll(this.k.isleSworn);
    const mine = (i: number) => Number(counts[`${i}:${side}`] ?? 0), theirs = (i: number) => Number(counts[`${i}:${side === 'a' ? 'b' : 'a'}`] ?? 0);
    let best = 0;
    for (let i = 1; i < count; i++) if (mine(i) - theirs(i) < mine(best) - theirs(best) || (mine(i) - theirs(i) === mine(best) - theirs(best) && mine(i) < mine(best))) best = i;
    await this.store.hSet(this.k.isleOf, { [user]: String(best) });
    await this.store.hIncrBy(this.k.isleSworn, `${best}:${side}`, 1);
  }

  private async args(): Promise<Argument[]> {
    const [rows, votes] = await Promise.all([this.store.hGetAll(this.k.args), this.store.hGetAll(this.k.votes)]);
    return Object.values(rows).map((row) => {
      const arg = JSON.parse(row) as Omit<Argument, 'votes'>;
      return { ...arg, votes: Number(votes[arg.id] ?? 0) };
    });
  }

  private async seed(): Promise<void> {
    if (!(await this.store.hSetNX(this.k.meta, 'seeded', '1'))) return;
    await this.store.zAdd(POSTS_KEY, { member: this.post, score: this.now });
    const rows: Record<string, string> = {}, votes: Record<string, string> = {};
    for (const { id, side, by, text, parent, votes: v } of seedArgs(await resolveTopic(this.store, (await this.info()).topic))) {
      rows[id] = JSON.stringify({ id, side, by, text, parent, at: this.now });
      votes[id] = String(v);
    }
    if (Object.keys(rows).length) {
      await this.store.hSet(this.k.args, rows);
      await this.store.hSet(this.k.votes, votes);
    }
  }

  // Whoever claims this tick's slot first makes the crowd's move, so two viewers never double it.
  private async tickBots(isle: number): Promise<void> {
    if (Number((await this.store.get(this.k.botCountOf(isle))) ?? 0) >= BOT_MOVES_PER_DAY) return;
    const slot = Math.floor(this.now / BOT_TICK_MS);
    if (!(await this.store.hSetNX(this.k.botSlotsOf(isle), String(slot), '1'))) return;
    await this.store.incrBy(this.k.botCountOf(isle), 1);
    const seed = ((slot + isle * 7919) * 2654435761) >>> 0;
    await this.append({ t: 'bot', seed, by: 'crowd', side: null }, isle);
    if (seed % 100 < BOT_VOTE_CHANCE * 100) {
      const openers = (await resolveTopic(this.store, (await this.info()).topic)).openers.length;
      if (openers) await this.store.hIncrBy(this.k.votes, `s${1 + (seed % openers)}`, 1 + (seed % 3));
    }
  }
}

async function recordOf(store: Store, user: string): Promise<FighterRecord | null> {
  const row = await store.hGet(FIGHTERS_KEY, user);
  return row ? (JSON.parse(row) as FighterRecord) : null;
}

function hexOf(q: unknown, r: unknown): { q: number; r: number } {
  const ok = (n: unknown): n is number => Number.isInteger(n) && Math.abs(n as number) <= MAP_REACH;
  if (!ok(q) || !ok(r)) throw new FeudError('That hex is off the map');
  return { q, r };
}
