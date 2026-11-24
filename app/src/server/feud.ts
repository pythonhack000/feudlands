// The shared war: one island per post, stored as an ordered log of moves.
// Every client replays the same log onto the same seeded island, so everyone sees the same map.
import {
  cryPower, isSide, MAP_REACH, TEXT_MAX,
  type Argument, type Move, type NewMove, type Side, type State,
} from '../shared/rules.ts';

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
const SEED_ARGS: [string, Side, string, string, string | null, number][] = [
  ['s1', 'a', 'quietfox', 'A cat will never make you walk it in the rain at 6 am.', null, 48],
  ['s2', 'b', 'tea_and_maps', 'Nobody has ever been rescued from a fire by a cat.', null, 44],
  ['s3', 'a', 'mod_kettle', 'Cats invented the internet. Dogs just chew the cables.', null, 31],
  ['s4', 'b', 'lofi_owl', 'A dog is happy to see you every single time. Every. Time.', null, 27],
  ['s5', 'a', 'pixelpuddle', 'Quiet, clean, and judges your life choices for free.', null, 12],
  ['s6', 'b', 'oldsalt', 'Try taking a cat on a hike.', null, 9],
  ['s7', 'b', 'nightjar', 'The walk in the rain is the best part of the day. Ask any dog.', 's1', 26],
  ['s8', 'a', 'sundial', 'Nobody has been rescued from a fire by a goldfish either. Not a job requirement.', 's2', 41],
  ['s9', 'b', 'cartographer_k', 'Dogs invented loyalty. Try running a forum without it.', 's3', 8],
  ['s10', 'a', 'fernweh', 'Happy to see you, the mailman, and a sock.', 's4', 19],
];

const keys = (post: string) => {
  const k = (name: string) => `feud:${post}:${name}`;
  return {
    meta: k('meta'), seq: k('seq'), moves: k('moves'), sides: k('sides'), seen: k('seen'),
    args: k('args'), votes: k('votes'), botSlots: k('botslots'), botCount: k('botcount'),
    used: (user: string) => k(`used:${user}`), myVotes: (user: string) => k(`uv:${user}`),
  };
};
type Keys = ReturnType<typeof keys>;

export class Feud {
  private readonly k: Keys;
  private readonly store: Store;
  private readonly user: string | null;
  private readonly now: number;
  constructor(store: Store, post: string, user: string | null, now = Date.now()) {
    this.store = store; this.user = user; this.now = now; this.k = keys(post);
  }

  /** Everything after `after` in the log, plus the council and who you are. */
  async state(after: number): Promise<State> {
    await this.seed();
    await this.tickBots();
    if (this.user) await this.store.zAdd(this.k.seen, { member: this.user, score: this.now });
    const [moves, args, myVotes, sides, here, botCount] = await Promise.all([
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
    if (!isSide(side)) throw new FeudError('Pick cats or dogs');
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
    const rows: Record<string, string> = {}, votes: Record<string, string> = {};
    for (const [id, side, by, text, parent, v] of SEED_ARGS) {
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
      const [id] = SEED_ARGS[seed % SEED_ARGS.length];
      await this.store.hIncrBy(this.k.votes, id, 1 + (seed % 3));
    }
  }
}

function hexOf(q: unknown, r: unknown): { q: number; r: number } {
  const ok = (n: unknown): n is number => Number.isInteger(n) && Math.abs(n as number) <= MAP_REACH;
  if (!ok(q) || !ok(r)) throw new FeudError('That hex is off the map');
  return { q, r };
}
