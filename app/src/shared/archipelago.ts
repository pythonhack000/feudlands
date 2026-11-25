// The archipelago: each feud is fought over a chain of islands, not one.
// More islands open as more fighters swear in, so a crowd never drowns on one small map.
// Neighbouring islands are linked by fleets: an island your side holds sends +1 to every charge on the islands beside it.
import type { Side } from './rules.ts';

export const ISLE_NAMES = ['Ash', 'Brine', 'Cinder', 'Dune', 'Elm', 'Fen', 'Gale', 'Holm', 'Iron', 'Juniper', 'Kestrel', 'Lark'] as const;
/** Every feud starts with this many islands. */
export const MIN_ISLES = 3;
export const MAX_ISLES = ISLE_NAMES.length;
/** Roughly how many fighters one island holds before another opens. */
export const REGIMENT = 50;

export const islesFor = (sworn: number): number => Math.min(MAX_ISLES, Math.max(MIN_ISLES, Math.ceil(sworn / REGIMENT)));
/** Each island has its own coast. Island 0 keeps the day's own shape, so posts from before the archipelago look the same. */
export const isleSeed = (day: number, isle: number): number => (isle === 0 ? day : day * 31 + isle * 977);
/** The islands lie in a chain: each one's neighbours are the ones before and after it. */
export const neighbours = (isle: number, count: number): number[] => [isle - 1, isle + 1].filter((j) => j >= 0 && j < count);

export type IsleStat = { a: number; b: number };
/** Who holds an island: whoever has more of it. A tie holds nothing. */
export const holder = (s: IsleStat | undefined): Side | null => (!s ? null : s.a > s.b ? 'a' : s.b > s.a ? 'b' : null);
/** Fleets for a charge on this island: one for each neighbouring island the charging side holds. */
export const fleetBonus = (stats: IsleStat[], isle: number, side: Side): number =>
  neighbours(isle, stats.length).filter((j) => holder(stats[j]) === side).length;
