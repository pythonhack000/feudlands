// The island and its rules, shared by the game (which draws it) and the server (which counts it at midnight).
// Everything here is deterministic: the same day and the same move log give the same island everywhere.
import type { Move, Side } from './rules.ts';

export type Kind = 'camp' | 'tower';
export interface Cell { q: number; r: number; land: boolean; side: Side | null; kind: Kind | null; by: string | null }
export type Island = Map<string, Cell>;

export function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (q: number, r: number, s = 0): number => {
  let h = (q * 374761393 + r * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const;
export const key = (q: number, r: number): string => q + ',' + r;
const RADIUS = 7, MORNING_MOVES = 66, TOWER_CHANCE = 0.15;

/** The demo crowd. Even-numbered names fight for side a. */
export const NAMES = ['quietfox', 'tea_and_maps', 'mod_kettle', 'lofi_owl', 'pixelpuddle', 'oldsalt', 'fernweh', 'brick_by_brick', 'nightjar', 'cartographer_k', 'sundial', 'gravelpit'];
export const sideOf = (name: string): Side => (NAMES.indexOf(name) % 2 === 0 ? 'a' : 'b');
export const isCrowd = (name: string): boolean => NAMES.includes(name);

/** Today's island, with the crowd's morning already played: each side pushes inland from its own shore. */
export function makeIsland(day: number): Island {
  const cells: Island = new Map();
  for (let q = -RADIUS - 2; q <= RADIUS + 2; q++) for (let r = -RADIUS - 2; r <= RADIUS + 2; r++) {
    const d = (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2;
    if (d > RADIUS + 1) continue;
    const coast = RADIUS - 1.2 + (hash(q, r, day) - 0.5) * 2.4 + Math.sin(q * 0.9 + r * 0.4 + day) * 0.8;
    cells.set(key(q, r), { q, r, land: d <= coast, side: null, kind: null, by: null });
  }
  const rand = rng(day), land = [...cells.values()].filter((c) => c.land);
  const anchors = { a: { q: -4, r: 2 }, b: { q: 4, r: -2 } };
  for (let i = 0; i < MORNING_MOVES; i++) {
    const side: Side = i % 2 ? 'a' : 'b', home = anchors[side];
    // Noise is drawn once per hex before sorting: a comparator that rolls dice gives a different order in every JS engine.
    const pool = land.filter(isFree).map((c) => ({ c, k: Math.hypot(c.q - home.q, c.r - home.r) + (rand() - 0.5) * 6 })).sort((x, y) => x.k - y.k);
    const c = pool[0]?.c; if (!c) break;
    const by = NAMES.filter((n) => sideOf(n) === side)[Math.floor(rand() * 5)] || NAMES[0];
    Object.assign(c, { side, kind: rand() < TOWER_CHANCE ? 'tower' : 'camp', by });
  }
  return cells;
}

export const cellAt = (cells: Island, q: number, r: number): Cell | undefined => cells.get(key(q, r));
export const landNeighbours = (cells: Island, c: Cell): Cell[] =>
  DIRS.map(([dq, dr]) => cellAt(cells, c.q + dq, c.r + dr)).filter((n): n is Cell => Boolean(n && n.land));
export const isFree = (c: Cell | undefined | null): c is Cell => Boolean(c && c.land && !c.side);

// Capture: an enemy camp whose every land neighbour is yours turns to your side. Towers can't be boxed in.
export function captures(cells: Island, side: Side): Cell[] {
  const flipped: Cell[] = [];
  for (const c of cells.values()) {
    if (!c.land || !c.side || c.side === side || c.kind === 'tower') continue;
    const near = landNeighbours(cells, c);
    if (near.length && near.every((n) => n.side === side)) flipped.push(c);
  }
  return flipped;
}
/** How many enemy hexes would fall if this side built here. */
export function wouldCapture(cells: Island, c: Cell, side: Side): number {
  const was = c.side; c.side = side; c.kind = 'camp';
  const n = captures(cells, side).length;
  c.side = was; c.kind = null;
  return n;
}

// Charge: attack = 1 + your hexes around the target + the cry's power.
// Defence = the piece (camp 1, tower 3) + its side's hexes around it + 1 for holding the ground.
export const STRENGTH: Record<Kind, number> = { camp: 1, tower: 3 };
export const HOME = 1;
export const ownNear = (cells: Island, c: Cell, side: Side): number => landNeighbours(cells, c).filter((n) => n.side === side).length;
export const canCharge = (cells: Island, c: Cell | undefined | null, side: Side): c is Cell =>
  Boolean(c && c.land && c.side && c.side !== side && ownNear(cells, c, side) > 0);
export const attackOf = (cells: Island, c: Cell, side: Side, power: number): number => 1 + ownNear(cells, c, side) + power;
export const defenceOf = (cells: Island, c: Cell): number => STRENGTH[c.kind ?? 'camp'] + ownNear(cells, c, c.side as Side) + HOME;

export type CrowdChoice =
  | { t: 'charge'; c: Cell; side: Side; by: string }
  | { t: 'build'; c: Cell; kind: Kind; side: Side; by: string }
  | null;
/** The crowd stops building once only this share of land is free, so players always have room. */
const FREE_LAND_KEPT = 0.25;
/** What the crowd does with this seed: the move that captures the most, else push the front. Charges carry no cry. */
export function crowdChoice(cells: Island, seed: number): CrowdChoice {
  const roll = rng(seed);
  const by = NAMES[Math.floor(roll() * NAMES.length)], side = sideOf(by);
  const land = [...cells.values()].filter((c) => c.land);
  const crowded = land.filter(isFree).length <= land.length * FREE_LAND_KEPT;
  if (crowded || roll() < 0.45) {
    const targets = land.filter((c) => canCharge(cells, c, side))
      .map((c) => ({ c, v: attackOf(cells, c, side, 0) - defenceOf(cells, c) + roll() }))
      .sort((x, y) => y.v - x.v);
    if (targets[0]) return { t: 'charge', c: targets[0].c, side, by };
  }
  const scored = (crowded ? [] : land.filter(isFree))
    .map((c) => ({ c, v: wouldCapture(cells, c, side) * 5 + landNeighbours(cells, c).filter((n) => n.side).length + roll() * 2 }));
  scored.sort((x, y) => y.v - x.v);
  const pick = scored[Math.floor(roll() * Math.min(3, scored.length))];
  return pick ? { t: 'build', c: pick.c, kind: roll() < TOWER_CHANCE ? 'tower' : 'camp', side, by } : null;
}

/** The outcome of one move on the board. `taken` counts hexes that changed hands to the mover. */
export type Outcome =
  | { t: 'build'; c: Cell; kind: Kind; side: Side; by: string; flipped: Cell[] }
  | { t: 'charge'; c: Cell; side: Side; by: string; enemy: Side; atk: number; def: number; won: boolean; flipped: Cell[]; cryId: string | null }
  | null;

export function build(cells: Island, c: Cell, kind: Kind, side: Side, by: string): Outcome {
  Object.assign(c, { side, kind, by });
  const flipped = captures(cells, side);
  flipped.forEach((f) => Object.assign(f, { side, by }));
  return { t: 'build', c, kind, side, by, flipped };
}
export function charge(cells: Island, c: Cell, side: Side, by: string, power: number, cryId: string | null): Outcome {
  const atk = attackOf(cells, c, side, power), def = defenceOf(cells, c), enemy = c.side as Side, won = atk > def;
  let flipped: Cell[] = [];
  if (won) {
    Object.assign(c, { side, kind: 'camp', by });
    flipped = captures(cells, side);
    flipped.forEach((f) => Object.assign(f, { side, by }));
  }
  return { t: 'charge', c, side, by, enemy, atk, def, won, flipped, cryId };
}

/** Plays one logged move. Null when the board had already moved on (the hex was taken, or the front shifted). */
export function play(cells: Island, m: Move): Outcome {
  if (m.t === 'bot') {
    const choice = crowdChoice(cells, m.seed);
    if (!choice) return null;
    return choice.t === 'build' ? build(cells, choice.c, choice.kind, choice.side, choice.by) : charge(cells, choice.c, choice.side, choice.by, 0, null);
  }
  const c = cellAt(cells, m.q, m.r);
  if (!m.side) return null;
  if (m.t === 'build') return isFree(c) ? build(cells, c, m.kind, m.side, m.by) : null;
  return canCharge(cells, c, m.side) ? charge(cells, c, m.side, m.by, (m.cry ? m.cry.power : 0) + (m.fleet ?? 0), m.cry ? m.cry.id : null) : null;
}

/** Hexes a move took: the charged hex if it fell, plus everything boxed in. */
export const takenBy = (o: Outcome): number => (!o ? 0 : o.t === 'build' ? o.flipped.length : o.won ? 1 + o.flipped.length : 0);

export interface DayTally {
  a: number; b: number;
  /** Hexes taken today, per fighter. */
  hexes: Record<string, number>;
  /** Hexes taken today, per battle cry. */
  cries: Record<string, number>;
  /** The island as it stands at the end of the log. */
  cells: Island;
}
/** The whole day from the log: who holds what, and who took it. */
export function tallyDay(day: number, moves: Move[]): DayTally {
  const cells = makeIsland(day), hexes: Record<string, number> = {}, cries: Record<string, number> = {};
  for (const m of [...moves].sort((x, y) => x.seq - y.seq)) {
    const o = play(cells, m), n = takenBy(o);
    if (!o || !n) continue;
    hexes[o.by] = (hexes[o.by] ?? 0) + n;
    if (o.t === 'charge' && o.cryId) cries[o.cryId] = (cries[o.cryId] ?? 0) + n;
  }
  let a = 0, b = 0;
  for (const c of cells.values()) { if (c.side === 'a') a++; if (c.side === 'b') b++; }
  return { a, b, hexes, cries, cells };
}

/** The island at evenly spaced points through the day, from the morning to the last move. */
export function dayFrames(day: number, moves: Move[], frames: number): Island[] {
  const sorted = [...moves].sort((x, y) => x.seq - y.seq), cells = makeIsland(day), out: Island[] = [];
  const copy = (): Island => new Map([...cells].map(([k, c]) => [k, { ...c }]));
  out.push(copy());
  // Frame j shows the island after round(j * n / (frames - 1)) moves, so the day is spread evenly.
  const cuts = new Set(Array.from({ length: Math.max(0, frames - 1) }, (_, j) => Math.round(((j + 1) * sorted.length) / (frames - 1))));
  sorted.forEach((m, i) => {
    play(cells, m);
    if (cuts.has(i + 1)) out.push(copy());
  });
  return out;
}
