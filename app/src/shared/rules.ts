// Rules both the server and the game need to agree on.

export type Side = 'a' | 'b';
export const SIDES: readonly Side[] = ['a', 'b'];
export const isSide = (value: unknown): value is Side => value === 'a' || value === 'b';

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
export type ChargeMove = { t: 'charge'; q: number; r: number; cry: { id: string; power: number } | null };
/** A move by the demo crowd. Every client works out the same move from the seed and the board. */
export type BotMove = { t: 'bot'; seed: number };
export type NewMove = (BuildMove | ChargeMove | BotMove) & { by: string; side: Side | null };
export type Move = NewMove & { seq: number; at: number };

export type Argument = { id: string; side: Side; by: string; text: string; parent: string | null; at: number; votes: number };

export type State = {
  me: { name: string | null; side: Side | null };
  moves: Move[];
  args: Argument[];
  myVotes: Record<string, number>;
  here: number;
  /** Fighters sworn in on each side today. */
  sworn: Record<Side, number>;
  quiet: boolean;
};

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };
