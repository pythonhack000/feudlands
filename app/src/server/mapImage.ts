// Paints the day's island as a PNG on the server, so the midnight comment can show the map.
// Pure code (Devvit's server has no canvas): every pixel finds its hex, then takes that hex's colour.
import { deflateSync } from 'node:zlib';
import { DIRS, hash, type Cell, type Island } from '../shared/island.ts';
import type { Side } from '../shared/rules.ts';

const WIDTH = 720, HEIGHT = 600, SUPERSAMPLE = 2;
const TILE = { w: 320, h: 267, gap: 12 } as const;
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const PAPER = hex('#efe3c8');
const SEA = mix(hex('#efe3c8'), hex('#6f9a95'), 0.45);
const LAND = hex('#e6d3a3');
const INK = hex('#3a2a1c');
const SIDE_INK: Record<Side, RGB> = { a: hex('#2f5d8a'), b: hex('#b5452f') };
const TERRITORY = 0.32;
/** How far out from a hex's centre (0 centre, about 0.5 at the edge) each kind of line starts. */
const EDGE = { coast: 0.455, front: 0.465, grid: 0.48 } as const;

/** One day's island as a PNG. */
export function islandPng(cells: Island): Buffer {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  paintIsland(cells, rgb, WIDTH, { x: 0, y: 0, w: WIDTH, h: HEIGHT });
  return encodePng(WIDTH, HEIGHT, rgb);
}

/** A week's islands side by side, in day order: four on top, the rest below. Gaps are paper. */
export function weekGridPng(islands: Island[]): Buffer {
  const cols = Math.min(4, islands.length), rows = Math.ceil(islands.length / cols);
  const width = cols * TILE.w + (cols + 1) * TILE.gap, height = rows * TILE.h + (rows + 1) * TILE.gap;
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < rgb.length; i += 3) { rgb[i] = PAPER[0]; rgb[i + 1] = PAPER[1]; rgb[i + 2] = PAPER[2]; }
  islands.forEach((cells, i) => {
    const row = Math.floor(i / cols), inRow = row === rows - 1 ? islands.length - row * cols : cols;
    const offset = ((cols - inRow) * (TILE.w + TILE.gap)) / 2; // centre a shorter last row
    const x = Math.round(TILE.gap + offset + (i % cols) * (TILE.w + TILE.gap)), y = TILE.gap + row * (TILE.h + TILE.gap);
    paintIsland(cells, rgb, width, { x, y, w: TILE.w, h: TILE.h });
  });
  return encodePng(width, height, rgb);
}

type Box = { x: number; y: number; w: number; h: number };
/** Paints an island into a box of an RGB buffer `stride` pixels wide. */
function paintIsland(cells: Island, out: Buffer, stride: number, box: Box): void {
  const WIDTH = box.w, HEIGHT = box.h; // the island fits its own box
  const land = [...cells.values()].filter((c) => c.land);
  const xs = land.map((c) => Math.sqrt(3) * (c.q + c.r / 2)), ys = land.map((c) => 1.5 * c.r);
  const minX = Math.min(...xs) - 1.2, maxX = Math.max(...xs) + 1.2, minY = Math.min(...ys) - 1.4, maxY = Math.max(...ys) + 1.3;
  const size = Math.min(WIDTH / (maxX - minX), HEIGHT / (maxY - minY));
  const ox = WIDTH / 2 - (size * (minX + maxX)) / 2, oy = HEIGHT / 2 - (size * (minY + maxY)) / 2;
  const at = (q: number, r: number): Cell | undefined => cells.get(q + ',' + r);

  const shade = (px: number, py: number): RGB => {
    const x = (px - ox) / size, y = (py - oy) / size;
    const fq = (Math.sqrt(3) / 3) * x - y / 3, fr = (2 / 3) * y, fs = -fq - fr;
    let q = Math.round(fq), r = Math.round(fr);
    const s = Math.round(fs), dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
    if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
    const c = at(q, r);
    const grain = (hash(Math.floor(px / 3), Math.floor(py / 3), 7) - 0.5) * 10; // paper grain
    const grainy = (rgb: RGB): RGB => [rgb[0] + grain, rgb[1] + grain, rgb[2] + grain];
    if (!c || !c.land) return grainy(SEA);

    const lx = fq - q, ly = fr - r, reach = Math.max(Math.abs(lx), Math.abs(ly), Math.abs(-lx - ly));
    let rgb = c.side ? mix(LAND, SIDE_INK[c.side], TERRITORY) : LAND;
    // A piece in the middle: a tent for a camp, a block for a tower.
    const cx = ox + size * Math.sqrt(3) * (q + r / 2), cy = oy + size * 1.5 * r;
    const ux = (px - cx) / size, uy = (py - cy) / size;
    if (c.side && c.kind === 'camp' && uy > -0.34 && uy < 0.26 && Math.abs(ux) <= (uy + 0.34) * 0.62) rgb = SIDE_INK[c.side];
    if (c.side && c.kind === 'tower' && Math.abs(ux) < 0.2 && uy > -0.32 && uy < 0.28) rgb = mix(SIDE_INK[c.side], INK, 0.35);

    if (reach > EDGE.grid) {
      // Which neighbour is across this edge decides the line: coast, front, or a faint grid.
      const n = nearestNeighbour(at, q, r, lx, ly);
      if (!n || !n.land) { if (reach > EDGE.coast) rgb = mix(rgb, INK, 0.85); }
      else if (n.side && c.side && n.side !== c.side) { if (reach > EDGE.front) rgb = mix(rgb, INK, 0.75); }
      else if (reach > EDGE.grid) rgb = mix(rgb, INK, 0.1);
    }
    return grainy(rgb);
  };

  const step = 1 / SUPERSAMPLE, samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < HEIGHT; py++) {
    for (let px = 0; px < WIDTH; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const [cr, cg, cb] = shade(px + (sx + 0.5) * step, py + (sy + 0.5) * step);
        r += cr; g += cg; b += cb;
      }
      const i = ((box.y + py) * stride + box.x + px) * 3;
      out[i] = clamp(r / samples); out[i + 1] = clamp(g / samples); out[i + 2] = clamp(b / samples);
    }
  }
}

/** The neighbouring hex across the nearest edge from a point inside hex (q, r). */
function nearestNeighbour(at: (q: number, r: number) => Cell | undefined, q: number, r: number, lx: number, ly: number): Cell | undefined {
  let best: Cell | undefined, bestDot = -Infinity;
  for (const [dq, dr] of DIRS) {
    const dot = lx * dq + ly * dr + (-lx - ly) * (-dq - dr); // cube dot product: largest towards the edge we're near
    if (dot > bestDot) { bestDot = dot; best = at(q + dq, r + dr); }
  }
  return best;
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

// ---------- a minimal PNG writer: 8-bit RGB, one IDAT ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8 bits per channel, RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); // filter byte 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
