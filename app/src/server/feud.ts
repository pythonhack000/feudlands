// The shared war: one island per post, stored as an ordered log of moves.
// Every client replays the same log onto the same seeded island, so everyone sees the same map.
import { isCrowd, NAMES, sideOf, tallyDay } from '../shared/island.ts';
import {
  cryPower, isSide, LEGACY_DAY, MAP_REACH, TEXT_MAX,
  type Argument, type FeudInfo, type Move, type NewMove, type Side, type State,
} from '../shared/rules.ts';
import { candidatesAfter, DEFAULT_TOPIC, topicById, type Topic } from '../shared/topics.ts';

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
}

const hexes = (n: number) => `${n} ${n === 1 ? 'hex' : 'hexes'}`;
const pct = (n: number, total: number) => Math.round((n / Math.max(1, total)) * 100);

/** The pinned comment that closes the day. Plain Markdown for Reddit. */
export function resultsComment(r: Results, tomorrow: string | null = null): string {
  const total = r.a + r.b, win: Side = r.a >= r.b ? 'a' : 'b', { day, sides } = r.feud;
  const head = r.a === r.b
    ? `**Midnight, day ${day}: the island is split, 50% to 50%** (${hexes(r.a)} each).`
    : `**Midnight, day ${day}: the ${sides[win].toLowerCase()} hold the island, ${pct(r[win], total)}% to ${100 - pct(r[win], total)}%** (${r[win]} hexes to ${r[win === 'a' ? 'b' : 'a']}).`;
  const lines = [
    r.general ? `- General of the day: u/${r.general.name}, ${hexes(r.general.hexes)} taken` : null,
    r.cry ? `- Cry of the day: \u201c${r.cry.text}\u201d by u/${r.cry.by}${r.cry.hexes ? `, took ${hexes(r.cry.hexes)}` : ''}` : null,
    `- Sworn in: ${r.sworn.a} for the ${sides.a.toLowerCase()}, ${r.sworn.b} for the ${sides.b.toLowerCase()}`,
  ].filter(Boolean);
  const next = tomorrow ? ['', `Tomorrow's feud, picked by the council: **${tomorrow}**`] : [];
  return [head, '', ...lines, ...next].join('\n');
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
const LAST_SEQ = Number.MAX_SAFE_INTEGER;

// The council's opening arguments, from the crowd, so a new post isn't empty.
// Ids s1, s2... follow the topic's order; a rebuttal points at the argument it answers.
type SeedArg = { id: string; side: Side; by: string; text: string; parent: string | null; votes: number };
function seedArgs(topic: Topic): SeedArg[] {
  const fighters = { a: NAMES.filter((n) => sideOf(n) === 'a'), b: NAMES.filter((n) => sideOf(n) === 'b') };
  const used = { a: 0, b: 0 };
  return topic.openers.map(([side, text, votes, rebuts], i) => ({
    id: `s${i + 1}`, side, text, votes,
    by: fighters[side][used[side]++ % fighters[side].length],
    parent: rebuts === null ? null : `s${rebuts + 1}`,
  }));
}

/** Every feud post, scored by when it opened, so midnight knows which days to close. */
export const POSTS_KEY = 'feud:posts';

const keys = (post: string) => {
  const k = (name: string) => `feud:${post}:${name}`;
  return {
    meta: k('meta'), seq: k('seq'), moves: k('moves'), sides: k('sides'), seen: k('seen'),
    args: k('args'), votes: k('votes'), shared: k('shared'), next: k('next'), nextMine: k('nextmine'), botSlots: k('botslots'), botCount: k('botcount'),
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
  constructor(store: Store, post: string, user: string | null, now = Date.now()) {
    this.store = store; this.user = user; this.now = now; this.post = post; this.k = keys(post);
  }

  /** Sets up a brand-new feud post with its topic and day, before anyone opens it. */
  static async open(store: Store, post: string, topicId: string, day: number): Promise<void> {
    await store.hSet(keys(post).meta, { topic: topicById(topicId).id, day: String(day) });
  }

  /** Which feud this post is. Posts from before topics existed are cats or dogs, day 12. */
  async info(): Promise<FeudInfo> {
    const meta = await this.store.hGetAll(this.k.meta);
    const topic = topicById(meta.topic ?? DEFAULT_TOPIC.id), day = Number(meta.day) || LEGACY_DAY;
    return { day, topic: topic.id, question: topic.question, sides: topic.sides, glyphs: topic.glyphs ?? null };
  }

  /** Tomorrow's three choices with their votes, and the one you picked. */
  async next(): Promise<State['next']> {
    const info = await this.info();
    const [votes, mine] = await Promise.all([
      this.store.hGetAll(this.k.next),
      this.user ? this.store.hGet(this.k.nextMine, this.user) : Promise.resolve(undefined),
    ]);
    return {
      choices: candidatesAfter(info.topic).map((t) => ({ id: t.id, question: t.question, votes: Number(votes[t.id] ?? 0) })),
      mine: mine ?? null,
    };
  }

  /** One vote per fighter for tomorrow's feud; voting again moves it. */
  async voteNext(topicId: unknown): Promise<void> {
    const user = this.fighter();
    const { choices } = await this.next();
    if (!choices.some((c) => c.id === topicId)) throw new FeudError('That feud isn\u2019t on tomorrow\u2019s ballot');
    const before = await this.store.hGet(this.k.nextMine, user);
    if (before === topicId) return;
    if (before) await this.store.hIncrBy(this.k.next, before, -1);
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
    await this.tickBots();
    if (this.user) await this.store.zAdd(this.k.seen, { member: this.user, score: this.now });
    const [feud, next, moves, args, myVotes, sides, here, botCount] = await Promise.all([
      this.info(),
      this.next(),
      this.store.zRange(this.k.moves, after + 1, LAST_SEQ, { by: 'score' }),
      this.args(),
      this.user ? this.store.hGetAll(this.k.myVotes(this.user)) : Promise.resolve({}),
      this.store.hGetAll(this.k.sides),
      this.store.zRange(this.k.seen, this.now - HERE_WINDOW_MS, this.now, { by: 'score' }),
      this.store.get(this.k.botCount),
    ]);
    const side = this.user ? sides[this.user] : undefined;
    const sworn = { a: 0, b: 0 };
    Object.values(sides).forEach((s) => { if (isSide(s)) sworn[s]++; });
    return {
      feud, next,
      me: { name: this.user, side: isSide(side) ? side : null },
      sworn,
      moves: moves.map((m) => JSON.parse(m.member) as Move),
      args,
      myVotes: Object.fromEntries(Object.entries(myVotes).map(([id, v]) => [id, Number(v)])),
      here: here.length,
      quiet: Number(botCount ?? 0) >= BOT_MOVES_PER_DAY,
    };
  }

  async chooseSide(side: unknown): Promise<void> {
    const user = this.fighter();
    if (!isSide(side)) throw new FeudError('Pick a side');
    await this.store.hSetNX(this.k.sides, user, side); // your first choice stands for the day
  }

  async build(kind: unknown, q: unknown, r: unknown): Promise<void> {
    const user = this.fighter(), side = await this.sideOf(user);
    if (kind !== 'camp' && kind !== 'tower') throw new FeudError('Unknown piece');
    const at = hexOf(q, r);
    await this.spend(user, 'build');
    await this.append({ t: 'build', kind, ...at, by: user, side });
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
    await this.spend(user, 'charge');
    await this.append({ t: 'charge', ...at, cry, by: user, side });
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
    const [feud, moves, args, sides] = await Promise.all([
      this.info(),
      this.store.zRange(this.k.moves, 0, LAST_SEQ, { by: 'score' }),
      this.args(),
      this.store.hGetAll(this.k.sides),
    ]);
    const day = tallyDay(feud.day, moves.map((m) => JSON.parse(m.member) as Move));
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

  private async append(move: NewMove): Promise<void> {
    const seq = await this.store.incrBy(this.k.seq, 1);
    await this.store.zAdd(this.k.moves, { member: JSON.stringify({ ...move, seq, at: this.now }), score: seq });
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
    for (const { id, side, by, text, parent, votes: v } of seedArgs(topicById((await this.info()).topic))) {
      rows[id] = JSON.stringify({ id, side, by, text, parent, at: this.now });
      votes[id] = String(v);
    }
    await this.store.hSet(this.k.args, rows);
    await this.store.hSet(this.k.votes, votes);
  }

  // Whoever claims this tick's slot first makes the crowd's move, so two viewers never double it.
  private async tickBots(): Promise<void> {
    if (Number((await this.store.get(this.k.botCount)) ?? 0) >= BOT_MOVES_PER_DAY) return;
    const slot = Math.floor(this.now / BOT_TICK_MS);
    if (!(await this.store.hSetNX(this.k.botSlots, String(slot), '1'))) return;
    await this.store.incrBy(this.k.botCount, 1);
    const seed = (slot * 2654435761) >>> 0;
    await this.append({ t: 'bot', seed, by: 'crowd', side: null });
    if (seed % 100 < BOT_VOTE_CHANCE * 100) {
      const openers = topicById((await this.info()).topic).openers.length;
      await this.store.hIncrBy(this.k.votes, `s${1 + (seed % openers)}`, 1 + (seed % 3));
    }
  }
}

function hexOf(q: unknown, r: unknown): { q: number; r: number } {
  const ok = (n: unknown): n is number => Number.isInteger(n) && Math.abs(n as number) <= MAP_REACH;
  if (!ok(q) || !ok(r)) throw new FeudError('That hex is off the map');
  return { q, r };
}
