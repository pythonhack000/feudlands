// Rules both the server and the game need to agree on.

export type Side = 'a' | 'b';
export const SIDES: readonly Side[] = ['a', 'b'];
export const isSide = (value: unknown): value is Side => value === 'a' || value === 'b';

/** The day number of feud posts made before days were counted. */
export const LEGACY_DAY = 12;

/** Which feud a post is fighting. */
export type FeudInfo = { day: number; topic: string; question: string; sides: Record<Side, string>; glyphs: Record<Side, string> | null; by: string | null; rematch: LastTime | null };

/** A fighter's run across days: consecutive days at war, and days their side won. */
export type FighterRecord = { streak: number; best: number; wins: number; lastDay: number; made?: number; general?: number };

/** A week runs seven feud days: days 1-7 are week 1. */
export const WEEK_DAYS = 7;
export const weekOf = (day: number): number => Math.ceil(day / WEEK_DAYS);
export type WeekRow = { name: string; hexes: number; wins: number };

/** How this topic went the last time it was fought, for a rematch. */
export type LastTime = { day: number; a: number; b: number };

/** Every this many upvotes make a battle cry 1 stronger. */
export const CRY_VOTES = 20;
export const TEXT_MAX = 120;
/** The island's hexes all sit within this distance of the centre. */
export const MAP_REACH = 12;

/** A cry's strength: its score, less the score of the best rebuttal posted under it. */
export function cryPower(votes: number, bestRebuttalVotes: number): number {
  const raw = (v: number) => Math.max(0, Math.floor(v / CRY_VOTES));
  return Math.max(0, raw(votes) - raw(bestRebuttalVotes));
}

export type BuildMove = { t: 'build'; kind: 'camp' | 'tower'; q: number; r: number };
/** A charge carries its cry's power and the fleets from neighbouring islands, both fixed when it was made. */
export type ChargeMove = { t: 'charge'; q: number; r: number; cry: { id: string; power: number } | null; fleet?: number };
/** A move by the demo crowd. Every client works out the same move from the seed and the board. */
export type BotMove = { t: 'bot'; seed: number };
export type NewMove = (BuildMove | ChargeMove | BotMove) & { by: string; side: Side | null };
export type Move = NewMove & { seq: number; at: number };

export type Argument = { id: string; side: Side; by: string; text: string; parent: string | null; at: number; votes: number };

export type State = {
  feud: FeudInfo;
  /** Tomorrow's ballot. */
  next: { choices: { id: string; question: string; votes: number; by: string | null }[]; mine: string | null; suggested: boolean };
  me: { name: string | null; side: Side | null; record: FighterRecord | null };
  /** The archipelago: which island you fight on, which one you're looking at, and how every island stands. */
  isles: { mine: number | null; viewing: number; stats: { a: number; b: number }[] };
  /** This week's generals so far, best first. */
  week: { n: number; top: WeekRow[] };
  moves: Move[];
  args: Argument[];
  myVotes: Record<string, number>;
  here: number;
  /** Fighters sworn in on each side today. */
  sworn: Record<Side, number>;
  quiet: boolean;
};

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };
