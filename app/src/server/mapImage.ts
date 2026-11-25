// Paints the day's island as a PNG on the server, so the midnight comment can show the map.
// Pure code (Devvit's server has no canvas): every pixel finds its hex, then takes that hex's colour.
import { deflateSync } from 'node:zlib';
import { DIRS, hash, type Cell, type Island } from '../shared/island.ts';
import type { Side } from '../shared/rules.ts';

const WIDTH = 720, HEIGHT = 600, SMOOTHING = 2;
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
/** Paints an island into a box of an RGB buffer `stride` pixels wide. `flat` drops grain and smoothing, for GIF's 256 colours. */
function paintIsland(cells: Island, out: Buffer, stride: number, box: Box, flat = false): void {
  const SUPERSAMPLE = flat ? 1 : SMOOTHING;
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
    const grain = flat ? 0 : (hash(Math.floor(px / 3), Math.floor(py / 3), 7) - 0.5) * 10; // paper grain
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

// ---------- the day as an animation: the island after each stretch of moves ----------
const FRAME = { w: 480, h: 400, delayMs: 450, lastDelayMs: 2500 } as const;

/** Islands as a looping GIF, one frame each, holding on the last. */
export function islandsGif(islands: Island[]): Buffer {
  return framesGif(islands.map((cells) => [cells]), FRAME.w, FRAME.h);
}

/** The archipelago as a looping GIF: each frame is every island side by side at that point in the day. */
export function archipelagoGif(frames: Island[][]): Buffer {
  const count = frames[0]?.length ?? 1;
  if (count === 1) return islandsGif(frames.map((f) => f[0]));
  return framesGif(frames, TILE.w, TILE.h);
}

/** Frames of islands laid out like the week grid (four across), flat-painted for GIF's 256 colours. */
function framesGif(frames: Island[][], tileW: number, tileH: number): Buffer {
  const count = frames[0].length, single = count === 1;
  const cols = Math.min(4, count), rows = Math.ceil(count / cols), gap = single ? 0 : TILE.gap;
  const width = cols * tileW + (cols + 1) * gap, height = rows * tileH + (rows + 1) * gap;
  const palette = new Map<number, number>();
  const indexed = frames.map((isles) => {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < rgb.length; i += 3) { rgb[i] = PAPER[0]; rgb[i + 1] = PAPER[1]; rgb[i + 2] = PAPER[2]; }
    isles.forEach((cells, i) => {
      const row = Math.floor(i / cols), inRow = row === rows - 1 ? count - row * cols : cols;
      const offset = ((cols - inRow) * (tileW + gap)) / 2;
      paintIsland(cells, rgb, width, { x: Math.round(gap + offset + (i % cols) * (tileW + gap)), y: gap + row * (tileH + gap), w: tileW, h: tileH }, true);
    });
    const idx = new Uint8Array(width * height);
    for (let i = 0; i < idx.length; i++) {
      const key = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
      let at = palette.get(key);
      if (at === undefined) {
        at = palette.size < 256 ? palette.size : nearest(palette, key);
        if (palette.size < 256) palette.set(key, at);
      }
      idx[i] = at;
    }
    return idx;
  });
  return encodeGif(width, height, [...palette.keys()], indexed, (i) => (i === indexed.length - 1 ? FRAME.lastDelayMs : FRAME.delayMs));
}

function nearest(palette: Map<number, number>, key: number): number {
  let best = 0, bestD = Infinity;
  for (const [c, i] of palette) {
    const d = (((c >> 16) & 255) - ((key >> 16) & 255)) ** 2 + (((c >> 8) & 255) - ((key >> 8) & 255)) ** 2 + ((c & 255) - (key & 255)) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** A minimal GIF89a writer: one global palette, looping, LZW-compressed frames. */
export function encodeGif(width: number, height: number, colours: number[], frames: Uint8Array[], delayMs: (i: number) => number): Buffer {
  const bytes: number[] = [];
  const u16 = (n: number) => bytes.push(n & 255, (n >> 8) & 255);
  bytes.push(...Buffer.from('GIF89a', 'ascii'));
  u16(width); u16(height);
  bytes.push(0xf7, 0, 0); // global colour table, 256 entries
  for (let i = 0; i < 256; i++) { const c = colours[i] ?? 0; bytes.push((c >> 16) & 255, (c >> 8) & 255, c & 255); }
  bytes.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0', 'ascii'), 3, 1, 0, 0, 0); // loop forever
  frames.forEach((frame, i) => {
    bytes.push(0x21, 0xf9, 4, 0); u16(Math.round(delayMs(i) / 10)); bytes.push(0, 0);
    bytes.push(0x2c); u16(0); u16(0); u16(width); u16(height); bytes.push(0);
    const data = lzw(frame, 8);
    bytes.push(8);
    for (let at = 0; at < data.length; at += 255) { const block = data.subarray(at, at + 255); bytes.push(block.length, ...block); }
    bytes.push(0);
  });
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

/** GIF's variable-width LZW, least significant bit first. */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1, out: number[] = [];
  let codeSize = minCodeSize + 1, next = end + 1, acc = 0, bits = 0;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    acc |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(acc & 255); acc >>>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) { emit(clear); table = new Map(); codeSize = minCodeSize + 1; next = end + 1; }
    else { if (next >= 1 << codeSize) codeSize++; table.set(key, next++); }
    prefix = k;
  }
  emit(prefix); emit(end);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}
