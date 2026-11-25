import * as I from '../shared/island.ts';
import { CRY_VOTES, LEGACY_DAY } from '../shared/rules.ts';
import * as sound from './sound.js';
import { fleetBonus, ISLE_NAMES, isleSeed } from '../shared/archipelago.ts';

const { rng, hash, DIRS, NAMES, sideOf, isFree, STRENGTH, HOME } = I;

const C = { ink: '#3a2a1c', inkSoft: '#7a6347', sea: '#6f9a95', land: '#e6d3a3', paper: '#efe3c8' };
const SIDES = { a: { name: 'Cats', ink: '#2f5d8a' }, b: { name: 'Dogs', ink: '#b5452f' } };
let TODAY = LEGACY_DAY; // the post's day, set when the feud loads
const VERDICT_MS = 900; // the verdict sounds as 'captured' or 'held' is drawn
const INK_MS = 700, LABEL_MS = 2600, BATTLE_MS = 3400;
const battles = [];

// ---------- today's island and its rules (shared with the server) ----------
const EDGE = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
const cells = I.makeIsland(TODAY); // rebuilt for the post's own day in setFeud()
const cell = (q, r) => I.cellAt(cells, q, r);
const landNeighbours = (c) => I.landNeighbours(cells, c);
const KINDS = {
  camp: { name: 'Camp', rule: 'Claims one hex' },
  tower: { name: 'Tower', rule: 'Claims a hex. Can\u2019t be boxed in' },
  charge: { name: 'Charge', rule: 'Attack an enemy hex beside your land' },
};
const wouldCapture = (c, side) => I.wouldCapture(cells, c, side);
const ownNear = (c, side) => I.ownNear(cells, c, side);
const canCharge = (c, side) => I.canCharge(cells, c, side);
// A cry's strength is its score, minus the score of the best rebuttal the other side has posted under it.
const rawPower = (x) => Math.max(0, Math.floor(x.votes / CRY_VOTES));
const rebuttalOf = (cry) => (cry && cry.replies && cry.replies.length ? [...cry.replies].sort((x, y) => y.votes - x.votes)[0] : null);
const cryPower = (cry) => (!cry ? 0 : typeof cry.power === 'number' ? cry.power : Math.max(0, rawPower(cry) - (rebuttalOf(cry) ? rawPower(rebuttalOf(cry)) : 0)));
// ---------- the archipelago: you fight on one island and can watch the others ----------
const VIEW = new URLSearchParams(location.search).get('isle');
let isles = { mine: null, viewing: VIEW === null ? 0 : Number(VIEW), stats: [] };
const onOwnIsle = () => isles.mine !== null && isles.viewing === isles.mine;
const isleName = (i) => ISLE_NAMES[i] || `Isle ${i + 1}`;
/** Fleets from neighbouring islands your side holds: +1 each to your charges here. */
const myFleet = () => (mySide && onOwnIsle() ? fleetBonus(isles.stats, isles.viewing, mySide) : 0);
function goIsle(i) { const q = new URLSearchParams(location.search); q.set('isle', String(i)); location.search = q.toString(); }
const attackOf = (c, side, cry) => I.attackOf(cells, c, side, cryPower(cry) + (side === mySide ? myFleet() : 0));
const defenceOf = (c) => I.defenceOf(cells, c);

// ---------- ranks: earned by hexes taken, across all days ----------
const RANKS = [[0, 'Recruit', 'Rct.'], [3, 'Private', 'Pvt.'], [8, 'Corporal', 'Cpl.'], [15, 'Sergeant', 'Sgt.'], [25, 'Captain', 'Capt.'], [40, 'General', 'Gen.']];
const stats = {};
const statOf = (name) => (stats[name] ||= { total: 0, today: 0 });
const rankOf = (name) => [...RANKS].reverse().find(([min]) => statOf(name).total >= min);
const titled = (name) => (name === 'you' ? 'you' : `${rankOf(name)[2]} u/${name}`);
function credit(name, n) { const st = statOf(name); st.total += n; st.today += n; }

// ---------- ink and watercolour ----------
const canvas = document.getElementById('map');
let g = canvas.getContext('2d');
let size = 20, ox = 0, oy = 0, dpr = 1;
const center = (c) => ({ x: ox + size * Math.sqrt(3) * (c.q + c.r / 2), y: oy + size * 1.5 * c.r });
const corners = (c, s = size) => { const p = center(c); return [...Array(6)].map((_, i) => { const a = Math.PI / 180 * (60 * i - 30); return { x: p.x + s * Math.cos(a), y: p.y + s * Math.sin(a) }; }); };
function inkLine(x1, y1, x2, y2, rand, w = 1.2, color = C.ink) {
  const mx = (x1 + x2) / 2 + (rand() - 0.5) * 1.6, my = (y1 + y2) / 2 + (rand() - 0.5) * 1.6;
  g.strokeStyle = color; g.lineWidth = w * (0.8 + rand() * 0.4); g.lineCap = 'round';
  g.beginPath(); g.moveTo(x1 + (rand() - .5) * .6, y1 + (rand() - .5) * .6); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
}
function wash(points, color, rand, alpha = 0.22, layers = 4) {
  g.save(); g.fillStyle = color;
  for (let l = 0; l < layers; l++) {
    g.globalAlpha = alpha * (0.6 + rand() * 0.6); g.beginPath();
    points.forEach((p, i) => { const x = p.x + (rand() - .5) * size * .16, y = p.y + (rand() - .5) * size * .16; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.fill();
  }
  g.restore();
}

// A camp is a small tent; a tower is a stone keep. Both fly the side's banner.
function swords(p, u, swing = 1, colour = C.ink) {
  // Two crossed blades; swing 0..1 brings them together.
  const spread = (1 - swing) * 0.9;
  for (const dir of [-1, 1]) {
    const a = -Math.PI / 2 + dir * (Math.PI / 4 + spread);
    const hx = p.x - Math.cos(a) * 9 * u, hy = p.y - Math.sin(a) * 9 * u, tx = p.x + Math.cos(a) * 11 * u, ty = p.y + Math.sin(a) * 11 * u;
    g.strokeStyle = colour; g.lineCap = 'round'; g.lineWidth = 1.8 * u; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
    const gx = p.x - Math.cos(a) * 5 * u, gy = p.y - Math.sin(a) * 5 * u, px = -Math.sin(a) * 3.5 * u, py = Math.cos(a) * 3.5 * u;
    g.lineWidth = 1.4 * u; g.beginPath(); g.moveTo(gx - px, gy - py); g.lineTo(gx + px, gy + py); g.stroke();
  }
}
function drawPiece(kind, side, p, s, rand, ghost = false) {
  const u = s / 20, ink = SIDES[side].ink;
  if (kind === 'charge') { g.save(); if (ghost) g.globalAlpha = 0.7; swords(p, u, 1, ink); g.restore(); return; }
  g.save(); if (ghost) g.globalAlpha = 0.6;
  if (kind === 'camp') {
    wash([{ x: p.x - 8 * u, y: p.y + 6 * u }, { x: p.x, y: p.y - 7 * u }, { x: p.x + 8 * u, y: p.y + 6 * u }], ink, rand, 0.45, 3);
    inkLine(p.x - 9 * u, p.y + 6 * u, p.x, p.y - 8 * u, rand, 1.2 * u); inkLine(p.x, p.y - 8 * u, p.x + 9 * u, p.y + 6 * u, rand, 1.2 * u);
    inkLine(p.x - 9 * u, p.y + 6 * u, p.x + 9 * u, p.y + 6 * u, rand, 1 * u); inkLine(p.x, p.y - 8 * u, p.x + 1 * u, p.y + 6 * u, rand, 0.8 * u);
    inkLine(p.x, p.y - 8 * u, p.x, p.y - 13 * u, rand, 0.9 * u);
    g.drawImage(flying(side).img, p.x + 0.5 * u, p.y - 14 * u, 7 * u, 8.4 * u);
  } else {
    wash([{ x: p.x - 6 * u, y: p.y + 8 * u }, { x: p.x - 5 * u, y: p.y - 6 * u }, { x: p.x + 5 * u, y: p.y - 6 * u }, { x: p.x + 6 * u, y: p.y + 8 * u }], '#d9ccb0', rand, 0.9, 2);
    inkLine(p.x - 6 * u, p.y + 8 * u, p.x - 5 * u, p.y - 6 * u, rand, 1.2 * u); inkLine(p.x + 6 * u, p.y + 8 * u, p.x + 5 * u, p.y - 6 * u, rand, 1.2 * u);
    inkLine(p.x - 7 * u, p.y + 8 * u, p.x + 7 * u, p.y + 8 * u, rand, 1.1 * u);
    for (let i = -1; i <= 1; i++) inkLine(p.x + i * 3.5 * u - 1.2 * u, p.y - 6 * u, p.x + i * 3.5 * u - 1.2 * u, p.y - 9 * u, rand, 1.4 * u);
    inkLine(p.x - 5.5 * u, p.y - 6 * u, p.x + 5.5 * u, p.y - 6 * u, rand, 1.1 * u);
    inkLine(p.x - 1.5 * u, p.y + 8 * u, p.x - 1.5 * u, p.y + 3 * u, rand, 0.9 * u); inkLine(p.x + 1.5 * u, p.y + 3 * u, p.x + 1.5 * u, p.y + 8 * u, rand, 0.9 * u);
    inkLine(p.x, p.y - 9 * u, p.x, p.y - 15 * u, rand, 0.9 * u);
    g.drawImage(flying(side).img, p.x + 0.5 * u, p.y - 16 * u, 7.5 * u, 9 * u);
  }
  g.restore();
}

// ---------- heraldry: banners drawn by players, or generated until they are ----------
const TINCTURE = { gold: '#c9a23a', silver: '#efe3c8', ink: '#3a2a1c' };
const BW = 120, BH = 144;
function shieldPath(ctx, w = BW, h = BH) {
  ctx.beginPath(); ctx.moveTo(5, 4); ctx.lineTo(w - 5, 4); ctx.lineTo(w - 5, h * .5);
  ctx.quadraticCurveTo(w - 5, h * .84, w / 2, h - 3); ctx.quadraticCurveTo(5, h * .84, 5, h * .5); ctx.closePath();
}
const DIVISIONS = ['plain', 'pale', 'bend', 'chevron', 'quarterly'];
function division(ctx, kind, field, other) {
  ctx.fillStyle = field; ctx.fillRect(0, 0, BW, BH); ctx.fillStyle = other; ctx.beginPath();
  if (kind === 'pale') ctx.rect(BW / 2, 0, BW / 2, BH);
  else if (kind === 'bend') { ctx.moveTo(0, 0); ctx.lineTo(BW, BH); ctx.lineTo(BW, 0); }
  else if (kind === 'chevron') { ctx.moveTo(0, BH * .95); ctx.lineTo(BW / 2, BH * .42); ctx.lineTo(BW, BH * .95); ctx.lineTo(BW, BH * .7); ctx.lineTo(BW / 2, BH * .2); ctx.lineTo(0, BH * .7); }
  else if (kind === 'quarterly') { ctx.rect(BW / 2, 0, BW / 2, BH / 2); ctx.rect(0, BH / 2, BW / 2, BH / 2); }
  ctx.fill();
}
function charge(ctx, kind, x, y, r, colour) {
  ctx.fillStyle = colour; ctx.strokeStyle = colour; ctx.lineWidth = r * .28; ctx.beginPath();
  if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, k = i % 2 ? r * .45 : r; ctx.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k); } ctx.fill(); }
  else if (kind === 'crescent') { ctx.arc(x, y, r, 0.3 * Math.PI, 1.7 * Math.PI, false); ctx.arc(x + r * .45, y, r * .78, 1.62 * Math.PI, 0.38 * Math.PI, true); ctx.fill(); }
  else if (kind === 'paw') { ctx.ellipse(x, y + r * .3, r * .55, r * .45, 0, 0, Math.PI * 2); ctx.fill(); for (const [dx, dy] of [[-.62, -.3], [-.22, -.68], [.22, -.68], [.62, -.3]]) { ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, r * .22, 0, Math.PI * 2); ctx.fill(); } }
  else if (kind === 'cross') { ctx.fillRect(x - r * .18, y - r, r * .36, r * 2); ctx.fillRect(x - r, y - r * .18, r * 2, r * .36); }
  else if (kind === 'sun') { ctx.arc(x, y, r * .5, 0, Math.PI * 2); ctx.fill(); for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * .62, y + Math.sin(a) * r * .62); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke(); } }
}
function frame(ctx) { ctx.strokeStyle = C.ink; ctx.lineWidth = 3; shieldPath(ctx); ctx.stroke(); }
function generatedBanner(seed, side) {
  const rand = rng(seed), cv = document.createElement('canvas'); cv.width = BW; cv.height = BH;
  const ctx = cv.getContext('2d'); ctx.save(); shieldPath(ctx); ctx.clip();
  const metal = rand() < .5 ? TINCTURE.gold : TINCTURE.silver;
  division(ctx, DIVISIONS[Math.floor(rand() * DIVISIONS.length)], SIDES[side].ink, metal);
  const kinds = side === 'a' ? ['paw', 'crescent', 'star'] : ['paw', 'sun', 'cross'];
  charge(ctx, kinds[Math.floor(rand() * kinds.length)], BW / 2, BH * .44, 26, rand() < .5 ? metal : C.ink);
  ctx.restore(); frame(ctx); return cv;
}
const banners = { a: [], b: [] };
const fightersOf = (side) => NAMES.filter((n) => sideOf(n) === side);
// Veterans from earlier days.
NAMES.forEach((n, i) => { statOf(n).total = [44, 31, 18, 27, 9, 12, 4, 21, 6, 2, 15, 0][i] || 0; });
[34, 21, 9].forEach((votes, i) => banners.a.push({ by: fightersOf('a')[i], votes, voted: false, img: generatedBanner(11 + i * 7, 'a') }));
[41, 17, 6].forEach((votes, i) => banners.b.push({ by: fightersOf('b')[i], votes, voted: false, img: generatedBanner(5 + i * 13, 'b') }));
const flying = (side) => banners[side].reduce((top, b) => (b.votes > top.votes ? b : top));

// ---------- the map ----------
function layout() {
  const box = canvas.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  canvas.width = box.width * dpr; canvas.height = box.height * dpr;
  const land = [...cells.values()].filter((c) => c.land);
  const xs = land.map((c) => Math.sqrt(3) * (c.q + c.r / 2)), ys = land.map((c) => 1.5 * c.r);
  const minX = Math.min(...xs) - 1.2, maxX = Math.max(...xs) + 1.2, minY = Math.min(...ys) - 1.4, maxY = Math.max(...ys) + 1.3;
  size = Math.min(box.width / (maxX - minX), box.height / (maxY - minY));
  ox = box.width / 2 - size * (minX + maxX) / 2; oy = box.height / 2 - size * (minY + maxY) / 2;
}
let hover = null, picked = null, mySide = null;
function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = canvas.width / dpr, h = canvas.height / dpr, now = performance.now();
  g.clearRect(0, 0, w, h);
  const rand = rng(7);
  wash([{ x: -20, y: -20 }, { x: w + 20, y: -20 }, { x: w + 20, y: h + 20 }, { x: -20, y: h + 20 }], C.sea, rand, 0.12, 5);
  for (let i = 0; i < 60; i++) { const x = rand() * w, y = rand() * h; inkLine(x, y, x + 8, y - 1.5, rand, 0.6, 'rgba(58,42,28,.3)'); inkLine(x + 8, y - 1.5, x + 15, y, rand, 0.6, 'rgba(58,42,28,.3)'); }
  const land = [...cells.values()].filter((c) => c.land);
  for (const c of land) {
    const cs = corners(c), p = center(c);
    DIRS.forEach(([dq, dr], i) => {
      const n = cell(c.q + dq, c.r + dr); if (n && n.land) return;
      const a = cs[EDGE[i][0]], b = cs[EDGE[i][1]];
      for (let k = 1; k <= 3; k++) { const f = 1 + k * 0.16; inkLine(p.x + (a.x - p.x) * f, p.y + (a.y - p.y) * f, p.x + (b.x - p.x) * f, p.y + (b.y - p.y) * f, rand, 0.55, `rgba(58,42,28,${0.4 - k * 0.1})`); }
    });
  }
  for (const c of land) wash(corners(c, size * 1.04), C.land, rand, 0.32, 3);
  // Territory: each side's land washed in its ink; fresh captures flash.
  for (const c of land) {
    if (!c.side) continue;
    const flash = c.flipAt && now - c.flipAt < 900 ? 1 - (now - c.flipAt) / 900 : 0;
    wash(corners(c, size * 0.98), SIDES[c.side].ink, rng(c.q * 7 + c.r), 0.13 + flash * 0.35, 3);
  }
  // Borders between the two sides drawn as a heavier front line.
  for (const c of land) {
    if (!c.side) continue;
    const cs = corners(c);
    DIRS.forEach(([dq, dr], i) => {
      const n = cell(c.q + dq, c.r + dr), a = cs[EDGE[i][0]], b = cs[EDGE[i][1]];
      if (n && n.land && n.side && n.side !== c.side && c.side === 'a') inkLine(a.x, a.y, b.x, b.y, rand, 1.8, 'rgba(58,42,28,.75)');
    });
  }
  for (const c of land) {
    const cs = corners(c);
    DIRS.forEach(([dq, dr], i) => {
      const n = cell(c.q + dq, c.r + dr), a = cs[EDGE[i][0]], b = cs[EDGE[i][1]];
      if (!n || !n.land) inkLine(a.x, a.y, b.x, b.y, rand, 1.4);
      else if (!c.side && !n.side && hash(c.q, c.r, i) > 0.35) { g.setLineDash([1, 3]); inkLine(a.x, a.y, b.x, b.y, rand, 0.5, 'rgba(58,42,28,.3)'); g.setLineDash([]); }
    });
  }
  // Pieces, with new ones inking in.
  for (const c of land) {
    if (!c.side) continue;
    const p = center(c), age = c.bornAt ? now - c.bornAt : Infinity, r = rng(c.q * 31 + c.r * 17);
    if (age < INK_MS) { const k = age / INK_MS; g.save(); g.globalAlpha = k; g.translate(p.x, p.y); g.scale(.6 + .4 * k, .6 + .4 * k); g.translate(-p.x, -p.y); drawPiece(c.kind, c.side, p, size, r); g.restore(); }
    else drawPiece(c.kind, c.side, p, size, r);
    if (c.by === 'you') {
      // Yours: the hex itself traced twice in ink, like a map maker's own claim.
      for (const k of [0.92, 0.8]) { const cs = corners(c, size * k); g.strokeStyle = C.ink; g.lineWidth = k > .9 ? 1.6 : 0.9; g.beginPath(); cs.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke(); }
    }
  }
  // Labels over fresh builds and captures.
  for (const c of land) {
    const at = Math.max(c.bornAt || 0, c.flipAt || 0), age = at ? now - at : Infinity;
    if (age > LABEL_MS || !c.label) continue;
    const p = center(c), k = Math.min(1, age / 250) * Math.min(1, (LABEL_MS - age) / 500);
    g.save(); g.globalAlpha = k; g.font = `italic ${Math.round(size * 0.68)}px 'IM Fell English', serif`; g.textAlign = 'center';
    const tw = g.measureText(c.label).width, y = p.y - size * 1.5 - (age / LABEL_MS) * size * .4;
    g.fillStyle = 'rgba(239,227,200,.94)'; g.fillRect(p.x - tw / 2 - 5, y - size * .6, tw + 10, size * .84);
    g.strokeStyle = SIDES[c.side].ink; g.lineWidth = 1; g.strokeRect(p.x - tw / 2 - 5, y - size * .6, tw + 10, size * .84);
    g.fillStyle = C.ink; g.fillText(c.label, p.x, y); g.restore();
  }
  // Training: the hexes the current lesson points at, dotted in your ink.
  for (const c of lessonHexes()) {
    const cs = corners(c, size * 0.86);
    g.save(); g.setLineDash([3, 3]); g.lineWidth = 1.6; g.strokeStyle = SIDES[mySide].ink;
    g.beginPath(); cs.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke(); g.restore();
  }
  // Battles: crossed swords, ink spatter, the battle cry on a scroll, then the verdict.
  for (const b of battles) {
    const age = now - b.at; if (age > BATTLE_MS) continue;
    const p = center(b.c), u = size / 20, fade = Math.min(1, (BATTLE_MS - age) / 500);
    g.save(); g.globalAlpha = fade;
    swords(p, u * 1.3, Math.min(1, age / 450), SIDES[b.side].ink);
    if (age > 450) { const r = rng(b.seed), spread = Math.min(1, (age - 450) / 400); for (let i = 0; i < 14; i++) { const a = r() * Math.PI * 2, d = (6 + r() * 16) * u * spread; g.fillStyle = r() < .5 ? C.ink : SIDES[b.side].ink; g.globalAlpha = fade * 0.7; g.beginPath(); g.arc(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, (0.8 + r() * 1.8) * u, 0, Math.PI * 2); g.fill(); } g.globalAlpha = fade; }
    if (b.cry) {
      g.font = `italic ${Math.round(size * 0.6)}px 'IM Fell English', serif`; g.textAlign = 'center';
      const lines = wrap(b.cry.text, 26).slice(0, 3), lh = size * 0.72, bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 16, bh = lines.length * lh + 10;
      const bx = Math.min(Math.max(p.x, bw / 2 + 4), canvas.width / dpr - bw / 2 - 4), by = Math.max(4, p.y - size * 2.2 - bh);
      g.fillStyle = 'rgba(244,234,210,.97)'; g.fillRect(bx - bw / 2, by, bw, bh);
      g.strokeStyle = SIDES[b.side].ink; g.lineWidth = 1.2; g.strokeRect(bx - bw / 2, by, bw, bh);
      g.fillStyle = C.ink; lines.forEach((l, i) => g.fillText(l, bx, by + 6 + lh * (i + 0.8)));
      // The defenders' rebuttal answers it a moment later, in their ink.
      if (b.rebut && age > 650) {
        const foe = b.rebut.side, rl = wrap('\u2014 ' + b.rebut.text, 26).slice(0, 4);
        const rw = Math.max(...rl.map((l) => g.measureText(l).width)) + 16, rh = rl.length * lh + 10;
        const rx = Math.min(Math.max(bx + 14, rw / 2 + 4), canvas.width / dpr - rw / 2 - 4), ry = by + bh + 4;
        g.save(); g.globalAlpha = fade * Math.min(1, (age - 650) / 250);
        g.fillStyle = 'rgba(244,234,210,.97)'; g.fillRect(rx - rw / 2, ry, rw, rh);
        g.strokeStyle = SIDES[foe].ink; g.lineWidth = 1.2; g.strokeRect(rx - rw / 2, ry, rw, rh);
        g.fillStyle = SIDES[foe].ink; rl.forEach((l, i) => g.fillText(l, rx, ry + 6 + lh * (i + 0.8)));
        g.restore();
      }
    }
    if (age > 900) { g.font = `${Math.round(size * 0.85)}px 'IM Fell English SC', serif`; g.textAlign = 'center'; g.fillStyle = b.won ? SIDES[b.side].ink : C.ink; g.fillText(b.won ? 'captured' : 'held', p.x, p.y + size * 1.55); }
    g.restore();
  }
  // Preview of your move.
  const kind = pickedKind();
  if (hover && kind === 'charge' && mySide) {
    const p = center(hover);
    if (canCharge(hover, mySide)) {
      swords(p, size / 20 * 1.1, 1, SIDES[mySide].ink);
      const atk = attackOf(hover, mySide, bestCry(mySide)), def = defenceOf(hover);
      g.font = `italic ${Math.round(size * .8)}px 'IM Fell English', serif`; g.textAlign = 'left'; g.fillStyle = atk > def ? SIDES[mySide].ink : C.ink;
      g.fillText(atk > def ? `${atk} beats ${def}` : `${atk} can\u2019t beat ${def}`, p.x + size * .8, p.y - size * .6);
    } else if (hover.land) { inkLine(p.x - 5, p.y - 5, p.x + 5, p.y + 5, rand, 1, 'rgba(58,42,28,.5)'); inkLine(p.x + 5, p.y - 5, p.x - 5, p.y + 5, rand, 1, 'rgba(58,42,28,.5)'); }
  } else if (hover && kind && mySide && isFree(hover)) {
    const p = center(hover);
    drawPiece(kind, mySide, p, size, rng(1), true);
    const taken = wouldCapture(hover, mySide);
    if (taken) { g.font = `italic ${Math.round(size * .8)}px 'IM Fell English', serif`; g.fillStyle = SIDES[mySide].ink; g.textAlign = 'left'; g.fillText(`takes ${taken}`, p.x + size * .7, p.y - size * .7); }
  } else if (hover && kind && kind !== 'charge' && hover.land) {
    const p = center(hover); inkLine(p.x - 5, p.y - 5, p.x + 5, p.y + 5, rand, 1, 'rgba(58,42,28,.5)'); inkLine(p.x + 5, p.y - 5, p.x - 5, p.y + 5, rand, 1, 'rgba(58,42,28,.5)');
  }
}

function hexAt(px, py) {
  const x = (px - ox) / size, y = (py - oy) / size;
  const q = Math.sqrt(3) / 3 * x - y / 3, r = 2 / 3 * y, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r); const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  return cell(rq, rr);
}

function wrap(text, width) { const out = []; let line = ''; for (const w of text.split(' ')) { if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; } else line += ' ' + w; } if (line.trim()) out.push(line.trim()); return out; }
const bestCry = (side) => [...args].filter((a) => a.side === side).sort((x, y) => y.votes - x.votes)[0] || null;
function assault(c, side, by, cry, fleet = 0) {
  const now = replaying ? -Infinity : performance.now();
  for (let i = battles.length - 1; i >= 0; i--) if (performance.now() - battles[i].at > BATTLE_MS) battles.splice(i, 1);
  const o = I.charge(cells, c, side, by, cryPower(cry) + fleet, cry && cry.id ? cry.id : null);
  if (!replaying) {
    battles.push({ c, side, at: now, cry, rebut: rebuttalOf(cry), won: o.won, seed: Math.floor(now) });
    sound.clash(by === 'you');
    setTimeout(() => sound.verdict(o.won, by === 'you'), VERDICT_MS);
  }
  if (o.won) {
    Object.assign(c, { flipAt: now + 900, label: null });
    o.flipped.forEach((f) => Object.assign(f, { flipAt: now + 1200, label: 'captured' }));
    credit(by, 1 + o.flipped.length);
    if (o.cryId) takenBy[o.cryId] = (takenBy[o.cryId] || 0) + 1 + o.flipped.length;
  }
  const who = by === 'you' ? 'You' : titled(by);
  log(`<span>${who} charged the ${SIDES[o.enemy].name.toLowerCase()}, ${o.atk} against ${o.def}: ${o.won ? 'taken' : 'held off'}</span><em>${o.won ? '+3' : '+0'}</em>`, side);
  setTimeout(() => { tally(); showRank(); }, 900); animate();
  return o.won ? 3 : 0;
}

// ---------- animation loop while anything is fresh ----------
let raf = 0;
function animate() {
  cancelAnimationFrame(raf);
  const tick = () => { draw(); const now = performance.now(); if (battles.some((b) => now - b.at < BATTLE_MS) || [...cells.values()].some((c) => now - Math.max(c.bornAt || 0, c.flipAt || 0) < LABEL_MS)) raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
}

// ---------- score: the tug of war ----------
function tally() {
  // The big bar is the whole war: this island live, the others as the server last reported them.
  let a = 0, b = 0;
  for (const c of cells.values()) { if (c.side === 'a') a++; if (c.side === 'b') b++; }
  if (isles.stats.length) renderIsles(a, b);
  isles.stats.forEach((st, i) => { if (i !== isles.viewing) { a += st.a; b += st.b; } });
  const pa = Math.round((a / Math.max(1, a + b)) * 100);
  document.getElementById('rope').style.width = pa + '%';
  document.getElementById('pctA').textContent = pa + '%';
  document.getElementById('pctB').textContent = (100 - pa) + '%';
}

// The island bar: every island's tug of war, yours marked, the one you're watching outlined.
function renderIsles(liveA, liveB) {
  const el = document.getElementById('isles');
  el.replaceChildren(...isles.stats.map((st, i) => {
    const a = i === isles.viewing ? liveA : st.a, b = i === isles.viewing ? liveB : st.b, pa = Math.round((a / Math.max(1, a + b)) * 100);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.setAttribute('aria-current', String(i === isles.viewing));
    const tag = i === isles.mine ? 'yours' : a > b ? SIDES.a.name.toLowerCase() : b > a ? SIDES.b.name.toLowerCase() : 'split';
    btn.innerHTML = `<span>${isleName(i)} <small>${tag}</small></span><span class="bar"><i style="width:${pa}%;background:${SIDES.a.ink}"></i><i style="width:${100 - pa}%;background:${SIDES.b.ink}"></i></span>`;
    btn.setAttribute('aria-label', `${isleName(i)}: ${SIDES.a.name} ${pa}%, ${SIDES.b.name} ${100 - pa}%${i === isles.mine ? ', your island' : ''}`);
    btn.onclick = () => { if (i !== isles.viewing) goIsle(i); };
    return btn;
  }));
}

// ---------- moves, yours and everyone else's ----------
const feedEl = document.getElementById('feed');
function log(html, side) {
  const li = document.createElement('li');
  li.innerHTML = html; li.style.color = SIDES[side].ink;
  feedEl.prepend(li);
  while (feedEl.children.length > 3) feedEl.lastChild.remove();
}
function move(c, kind, side, by) {
  const now = replaying ? -Infinity : performance.now();
  const o = I.build(cells, c, kind, side, by), flipped = o.flipped;
  Object.assign(c, { bornAt: now, label: titled(by) });
  flipped.forEach((f) => Object.assign(f, { flipAt: now + 350, label: 'captured' }));
  credit(by, flipped.length);
  if (!replaying) { if (flipped.length) sound.capture(flipped.length, by === 'you'); else sound.build(by === 'you'); }
  const who = by === 'you' ? 'You' : titled(by);
  log(flipped.length ? `<span>${who} took ${flipped.length} from the ${SIDES[side === 'a' ? 'b' : 'a'].name.toLowerCase()}</span><em>+${1 + flipped.length * 2}</em>` : `<span>${who} raised a ${KINDS[kind].name.toLowerCase()}</span><em>+1</em>`, side);
  tally(); showRank(); animate();
  return 1 + flipped.length * 2;
}
// The demo crowd: the server sends a seed, and every client works out the same move from it.
function crowdMove(seed) {
  const choice = I.crowdChoice(cells, seed);
  if (!choice) return;
  if (choice.t === 'charge') assault(choice.c, choice.side, choice.by, null);
  else move(choice.c, choice.kind, choice.side, choice.by);
}

// ---------- which feud this post is: question, sides and day come from the server ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
function setFeud(feud) {
  TODAY = feud.day;
  cells.clear();
  I.makeIsland(isleSeed(TODAY, isles.viewing)).forEach((c, k) => cells.set(k, c)); // each island has its own coast
  SIDES.a.name = feud.sides.a; SIDES.b.name = feud.sides.b;
  document.title = `Feudlands: ${feud.question}`;
  for (const id of ['question', 'pickQuestion']) { const el = document.getElementById(id); if (el) el.textContent = feud.question; }
  const by = document.getElementById('feudBy');
  const last = feud.rematch, pctOf = (x, y) => Math.round((x / Math.max(1, x + y)) * 100);
  const rematch = !last ? '' : last.a === last.b ? `Rematch: on day ${last.day} it ended split.`
    : `Rematch: on day ${last.day} the ${(last.a > last.b ? feud.sides.a : feud.sides.b).toLowerCase()} won, ${pctOf(Math.max(last.a, last.b), Math.min(last.a, last.b))}% to ${100 - pctOf(Math.max(last.a, last.b), Math.min(last.a, last.b))}%.`;
  const lines = [feud.by ? `A feud suggested by u/${feud.by}.` : '', rematch].filter(Boolean);
  if (by) { by.hidden = !lines.length; by.textContent = lines.join(' '); }
  document.getElementById('dayNo').textContent = String(feud.day);
  document.getElementById('nameA').textContent = feud.sides.a;
  document.getElementById('nameB').textContent = feud.sides.b;
  document.querySelectorAll('#pick [data-side]').forEach((btn) => {
    const side = btn.dataset.side;
    btn.querySelector('b').textContent = feud.sides[side];
    const glyph = btn.querySelector('.glyph');
    glyph.replaceChildren();
    if (feud.glyphs) {
      const path = document.createElementNS(SVG_NS, 'path');
      Object.entries({ d: feud.glyphs[side], fill: 'none', stroke: '#efe3c8', 'stroke-width': '2' }).forEach(([k, v]) => path.setAttribute(k, v));
      glyph.append(path);
    } else {
      const letter = document.createElementNS(SVG_NS, 'text');
      Object.entries({ x: '27', y: '38', 'text-anchor': 'middle', fill: '#efe3c8', 'font-size': '24', 'font-family': 'IM Fell English SC, serif' }).forEach(([k, v]) => letter.setAttribute(k, v));
      letter.textContent = feud.sides[side].charAt(0);
      glyph.append(letter);
    }
  });
}
// Tomorrow's ballot: three feuds, one vote each, and the winner is posted at midnight.
let ballot = { choices: [], mine: null };
function setBallot(next) {
  ballot = next;
  const lead = [...next.choices].sort((x, y) => y.votes - x.votes)[0];
  const el = document.getElementById('pickNext');
  if (el && lead) el.innerHTML = `Tomorrow's feud is up for a vote. Leading: <em>${lead.question.replace(/[<>&]/g, '')}</em>`;
}
const esc = (t) => String(t).replace(/[<>&]/g, '');
let isMod = false; // moderators can strike players' feuds off the ballot
function renderBallot(box) {
  box.replaceChildren(...ballot.choices.map((choice) => {
    const row = document.createElement('div'); row.className = 'choice';
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-pressed', String(ballot.mine === choice.id));
    const own = Boolean(choice.by && choice.by === myName); // you can't vote for your own feud
    b.disabled = own;
    b.innerHTML = `<span>${esc(choice.question)}${choice.by ? `<small> suggested by ${choice.by === myName ? 'you' : 'u/' + esc(choice.by)}</small>` : ''}</span><small>${choice.votes} ${choice.votes === 1 ? 'vote' : 'votes'}${ballot.mine === choice.id ? ', yours' : ''}${own ? ', yours to campaign for' : ''}</small>`;
    b.onclick = async () => {
      const note = box.nextElementSibling;
      sound.tick();
      try { applyState(await api(`next?${after()}`, { topic: choice.id })); renderBallot(box); note.textContent = 'Your vote is in. You can change it until midnight.'; }
      catch (error) { note.textContent = error.message; }
    };
    row.append(b);
    if (isMod && choice.by) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'chip remove'; remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove \u201c${choice.question}\u201d from the ballot`);
      remove.onclick = async () => {
        const note = box.nextElementSibling;
        try { applyState(await api(`unsuggest?${after()}`, { topic: choice.id })); renderBallot(box); note.textContent = 'Removed. The next most voted feud runs instead.'; }
        catch (error) { note.textContent = error.message; }
      };
      row.append(remove);
    }
    return row;
  }));
}

// Your own feud for tomorrow: a question and two sides. It joins the ballot with your vote on it.
function renderSuggest(box, ballotBox) {
  if (ballot.suggested) { box.innerHTML = '<p>Your feud is on the ballot. Get people to vote for it.</p>'; return; }
  box.innerHTML = `<p>Or suggest your own. If it wins, it goes up tomorrow with your name on it.</p>
    <div class="write"><input name="question" maxlength="90" placeholder="The question, like: Socks with sandals?" aria-label="Your feud's question" /></div>
    <div class="write"><input name="a" maxlength="24" placeholder="One side" aria-label="First side" /><input name="b" maxlength="24" placeholder="The other" aria-label="Second side" /></div>
    <p class="hint">Open the war council for both sides: one argument each. They start the debate if your feud wins.</p>
    <div class="write"><input name="argA" maxlength="120" placeholder="Why the first side wins" aria-label="An argument for the first side" /></div>
    <div class="write"><input name="argB" maxlength="120" placeholder="Why the other side wins" aria-label="An argument for the second side" /><button class="vote" type="button">Suggest</button></div>
    <p class="suggestNote" role="status"></p>`;
  const field = (name) => box.querySelector(`[name="${name}"]`).value.trim();
  box.querySelector('.vote').onclick = async () => {
    const note = box.querySelector('.suggestNote');
    if (!field('question') || !field('a') || !field('b')) { note.textContent = 'Write a question and name both sides.'; return; }
    try {
      applyState(await api(`suggest?${after()}`, { question: field('question'), a: field('a'), b: field('b'), argA: field('argA'), argB: field('argB') }));
      renderBallot(ballotBox); renderSuggest(box, ballotBox);
    } catch (error) { note.textContent = error.message; }
  };
}

// ---------- the shared war: the server keeps the log, every client replays it ----------
const POLL_MS = 3000;
let myRecord = null; // your run across days, from the server
let week = { n: 1, top: [] }; // this week's generals so far
let myName = null, lastSeq = 0, replaying = false, busy = false, quietShown = false;
async function api(path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch (error) {
    console.warn('War server unreachable', error);
    throw new Error('Can\u2019t reach the war. Check your connection.');
  }
  const out = await res.json().catch(() => null);
  if (!out || !out.ok) throw new Error((out && out.error) || 'The war server stumbled. Try again.');
  return out.data;
}
const after = () => `after=${lastSeq}&isle=${isles.viewing}`;
// One move from the log. Returns the points it scored, or null if the board had already moved on.
const dayLog = []; // every move so far today, for the replay
function applyMove(m) {
  lastSeq = Math.max(lastSeq, m.seq);
  dayLog.push(m);
  if (m.t === 'bot') { crowdMove(m.seed); return 0; }
  const c = cell(m.q, m.r), by = m.by === myName ? 'you' : m.by;
  if (m.t === 'build') {
    if (!isFree(c)) return null;
    const gained = move(c, m.kind, m.side, by);
    if (by === 'you') spend(m.kind, gained);
    return gained;
  }
  if (!canCharge(c, m.side)) return null;
  const said = m.cry && args.find((a) => a.id === m.cry.id);
  const cry = m.cry ? { ...(said || { text: '', by: m.by, side: m.side, replies: [] }), id: m.cry.id, power: m.cry.power } : null;
  const gained = assault(c, m.side, by, cry, m.fleet || 0);
  if (by === 'you') spend('charge', gained);
  return gained;
}
// Your own moves come back through the log too, so a reload restores your hand and points.
function spend(kind, gained) {
  const slot = hand.find((x) => !x.used && x.kind === kind);
  if (slot) slot.used = true;
  myPoints += gained;
}
function applyState(state) {
  myName = state.me.name;
  isles = state.isles;
  myRecord = state.me.record;
  week = state.week;
  setBallot(state.next);
  setCouncil(state.args, state.myVotes);
  const results = state.moves.filter((m) => m.seq > lastSeq).map((m) => ({ m, gained: applyMove(m) }));
  setCouncil(state.args, state.myVotes); // again, so cries carry the hexes they just took
  document.getElementById('here').textContent = String(Math.max(1, state.here));
  document.querySelectorAll('#pick [data-side] small').forEach((el) => { el.textContent = `${state.sworn[el.closest('button').dataset.side]} sworn in`; });
  if (state.quiet && !quietShown) { quietShown = true; log('<span>The front has gone quiet. The island is decided at midnight.</span>', mySide || 'a'); offerMidnight(); }
  syncRally();
  return results;
}
// Send a move, then replay everything up to and including it.
async function submit(path, body) {
  if (busy) return null;
  busy = true;
  try {
    const results = applyState(await api(`${path}?${after()}`, body));
    const mine = [...results].reverse().find(({ m }) => m.by === myName && m.t !== 'bot');
    return mine || null;
  } catch (error) {
    statusEl.textContent = error.message;
    return null;
  } finally {
    busy = false;
  }
}
// ---------- replay the day: the whole log again on the map, from the morning, then back to now ----------
const REPLAY_MS = 7000, REPLAY_STEP_MAX_MS = 200;
let replayingDay = false;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
async function replayDay() {
  if (replayingDay || busy) return;
  replayingDay = true; busy = true; hover = null; picked = null; battles.length = 0;
  document.querySelector('.sheet')?.remove();
  const now = [...cells.values()].map((c) => ({ c, side: c.side, kind: c.kind, by: c.by }));
  const morning = I.makeIsland(isleSeed(TODAY, isles.viewing));
  for (const [k, c] of cells) Object.assign(c, { side: morning.get(k).side, kind: morning.get(k).kind, by: morning.get(k).by, bornAt: undefined, flipAt: undefined, label: null });
  tally(); draw();
  const moves = [...dayLog].sort((x, y) => x.seq - y.seq), step = Math.min(REPLAY_STEP_MAX_MS, REPLAY_MS / Math.max(1, moves.length));
  try {
    for (let i = 0; i < moves.length; i++) {
      const o = I.play(cells, moves[i]), t = performance.now();
      if (o) { o.c.bornAt = t; o.flipped.forEach((f) => { f.flipAt = t; }); sound.build(false); }
      statusEl.textContent = `Replaying the day: move ${i + 1} of ${moves.length}`;
      tally(); draw();
      await pause(step);
    }
    await pause(900);
  } finally {
    now.forEach(({ c, side, kind, by }) => Object.assign(c, { side, kind, by, bornAt: undefined, flipAt: undefined, label: null }));
    replayingDay = false; busy = false;
    tally(); renderCards(); draw();
    statusEl.textContent = moves.length ? 'That was the day so far. Your move.' : 'Nothing has happened yet today. Make the first move.';
  }
}

async function poll() {
  if (!document.hidden && !busy) {
    try { applyState(await api(`state?${after()}`)); }
    catch (error) { console.warn('Poll failed', error); }
  }
  setTimeout(poll, POLL_MS);
}

// ---------- training: a new player unlocks one action at a time ----------
// Camps first, then surrounding, then charges, then the war council. After that the whole game is open.
const LESSONS = [
  { title: 'Camps', text: 'Place a camp on any empty hex. Next to your own land is safest.' },
  { title: 'Surround', text: 'Surround an enemy camp on every side and it becomes yours. The dotted hexes would capture one right now.' },
  { title: 'Charge', text: 'You can now build towers and charge. A charge attacks an enemy hex beside your land: beat its defence and it\u2019s yours. The dotted hexes are ones you\u2019d win.' },
  { title: 'War council', text: 'Charges can now shout battle cries. Open the war council and upvote an argument you agree with: every upvote makes it hit harder.' },
];
const TRAINED = LESSONS.length, LESSON_KEY = 'feudlands.lesson';
function readLesson() {
  try { const n = Number(localStorage.getItem(LESSON_KEY)); return Number.isInteger(n) && n >= 0 && n <= TRAINED ? n : 0; }
  catch { return 0; } // storage blocked: training simply starts over
}
let lesson = readLesson();
const trained = () => lesson >= TRAINED;
function saveLesson() {
  try { localStorage.setItem(LESSON_KEY, String(lesson)); }
  catch (error) { console.warn('Training progress was not saved', error); }
}
function startingHand() {
  const piece = (kind) => ({ kind, used: false });
  if (lesson < 2) return [piece('camp'), piece('camp'), piece('camp')];
  if (lesson < 3) return [piece('camp'), piece('tower'), piece('charge')];
  return [piece('camp'), piece('tower'), piece('charge'), piece('charge')];
}
function advanceLesson(to) {
  if (lesson >= to) return;
  const from = lesson; lesson = Math.min(to, TRAINED); saveLesson();
  if (from < 2 && lesson >= 2) hand.push({ kind: 'tower', used: false }, { kind: 'charge', used: false });
  if (from < 3 && lesson >= 3) hand.push({ kind: 'charge', used: false });
  if (trained()) { grantedRally = reinforcements(mySide); statusEl.textContent = 'Training done. Everything is open: banners, rebuttals, and the council\u2019s rallies.'; }
  showHeaderLinks(); renderCards(); coach(); draw();
}
function coach() {
  const el = document.getElementById('coach');
  if (!mySide || trained()) { el.hidden = true; return; }
  el.hidden = false;
  el.querySelector('b').textContent = `Training ${lesson + 1} of ${TRAINED}: ${LESSONS[lesson].title}`;
  el.querySelector('span').textContent = LESSONS[lesson].text;
}
// Hexes the current lesson points at, drawn dotted on the map.
function lessonHexes() {
  if (!mySide || trained()) return [];
  const kind = pickedKind(), all = [...cells.values()];
  if (lesson === 1 && kind !== 'charge') return all.filter((c) => isFree(c) && wouldCapture(c, mySide) > 0);
  if (lesson === 2 && kind === 'charge') return all.filter((c) => canCharge(c, mySide) && attackOf(c, mySide, null) > defenceOf(c));
  return [];
}

// ---------- your hand: today's pieces ----------
const hand = startingHand();
const cardsEl = document.getElementById('cards'), statusEl = document.getElementById('status');
let myPoints = 0;
const pickedKind = () => (picked === null ? null : hand[picked].kind);
// Identical pieces stack into one card with a count, so council rallies never crowd the hand.
const HAND_ORDER = ['camp', 'tower', 'charge'];
function renderCards() {
  cardsEl.innerHTML = '';
  HAND_ORDER.forEach((kind) => {
    const slots = hand.map((slot, i) => ({ slot, i })).filter(({ slot }) => slot.kind === kind);
    if (!slots.length) return;
    const free = slots.filter(({ slot }) => !slot.used);
    const fromCouncil = free.filter(({ slot }) => slot.rally).length;
    const isPicked = picked !== null && hand[picked].kind === kind;
    const b = document.createElement('button');
    b.className = 'card'; b.type = 'button'; b.setAttribute('aria-pressed', String(isPicked)); b.disabled = !free.length || !mySide || (isles.mine !== null && !onOwnIsle());
    const cv = document.createElement('canvas'); cv.width = 112; cv.height = 112; b.append(cv);
    const count = free.length > 1 ? ` <span class="count">\u00d7${free.length}</span>` : '';
    const note = !free.length ? 'Placed' : fromCouncil ? `${KINDS[kind].rule}. ${fromCouncil} sent by the council` : KINDS[kind].rule;
    b.insertAdjacentHTML('beforeend', `<b>${KINDS[kind].name}${count}</b><small>${note}</small>`);
    b.onclick = () => { picked = isPicked ? null : free[0].i; statusEl.textContent = picked === null ? '' : kind === 'charge' ? 'Pick an enemy hex that touches your land.' : 'Place it to box in an enemy camp.'; renderCards(); draw(); };
    cardsEl.append(b);
    const prev = g, saved = size; g = cv.getContext('2d'); size = 20;
    const hex = [...Array(6)].map((_, k) => { const a = Math.PI / 180 * (60 * k - 30); return { x: 56 + 50 * Math.cos(a), y: 56 + 50 * Math.sin(a) }; });
    wash(hex, C.land, rng(5), 0.35, 3);
    drawPiece(kind, mySide || 'a', { x: 56, y: 62 }, 44, rng(9));
    g = prev; size = saved;
  });
}

function showRank() {
  const el = document.getElementById('rank'); if (!el || !mySide) return;
  const [, name] = rankOf('you'), next = RANKS.find(([min]) => min > statOf('you').total);
  const run = myRecord ? ` ${myRecord.streak} ${myRecord.streak === 1 ? 'day' : 'days'} at war${myRecord.wins ? `, ${myRecord.wins} ${myRecord.wins === 1 ? 'win' : 'wins'}` : ''}.` : '';
  el.textContent = `${name} of the ${SIDES[mySide].name.toLowerCase()}${next ? `, ${next[0] - statOf('you').total} hexes to ${next[1]}` : ''}.${run}`;
}

// ---------- choosing a side ----------
document.querySelectorAll('#pick button').forEach((btn) => btn.addEventListener('click', async () => {
  if (!myName) { document.getElementById('pickNote').textContent = 'Log in to Reddit to join the war. You can still watch.'; return; }
  try { applyState(await api(`side?${after()}`, { side: btn.dataset.side })); }
  catch (error) { document.getElementById('pickNote').textContent = error.message; return; }
  if (isles.mine !== null && isles.mine !== isles.viewing) { goIsle(isles.mine); return; } // your regiment fights elsewhere
  joinSide(btn.dataset.side);
}));
function joinSide(side) {
  if (mySide) return;
  mySide = side;
  document.getElementById('pick')?.remove();
  showHeaderLinks();
  grantedRally = reinforcements(mySide);
  statusEl.textContent = onOwnIsle() || isles.mine === null ? 'Pick a piece.' : `You're watching ${isleName(isles.viewing)}. Your fight is on ${isleName(isles.mine)}: tap it above.`;
  document.getElementById('skipTraining').onclick = () => advanceLesson(TRAINED);
  coach(); renderCards(); draw();
}
// Sound sits in the top line, beside the day, so the links row keeps its room.
const soundBtn = document.getElementById('toggleSound');
const labelSound = () => { soundBtn.textContent = sound.soundOn() ? 'Sound on' : 'Sound off'; soundBtn.setAttribute('aria-pressed', String(sound.soundOn())); };
soundBtn.onclick = () => { sound.setSound(!sound.soundOn()); labelSound(); };
labelSound();
// The header only offers what you've unlocked.
function showHeaderLinks() {
  // Short labels, so every link fits on one line beside the map and on a phone.
  const links = [['openRules', 'Rules', openRules, true], ['openCouncil', 'Council', openCouncil, lesson >= 3], ['openGallery', 'Banners', openGallery, trained()], ['openEasel', 'Draw', openEasel, trained()], ['openMidnight', 'Midnight', openMidnight, true], ['replayDay', 'Replay', replayDay, true]];
  const you = document.getElementById('you');
  you.innerHTML = '<span id="rank"></span>' + links.filter(([, , , open]) => open).map(([id, label]) => `<button type="button" id="${id}">${label}</button>`).join('');
  links.forEach(([id, , open]) => { const b = document.getElementById(id); if (b) b.onclick = open; });
  showRank();
}

// ---------- banner gallery: upvote the one that flies over your side ----------
const main = document.querySelector('main');
function sheet(html) { const el = document.createElement('section'); el.className = 'sheet'; el.innerHTML = html; main.append(el); el.querySelector('.close').onclick = () => el.remove(); return el; }
function openGallery() {
  const side = mySide, name = SIDES[side].name.toLowerCase();
  const el = sheet(`<header><h2>Banners of the ${name}</h2><button class="close" type="button">Back to the war</button></header>
    <p>The most upvoted banner flies over every camp of the ${name}, with its maker's name.</p><div class="gallery"></div>`);
  const grid = el.querySelector('.gallery');
  const render = () => {
    grid.innerHTML = '';
    const top = flying(side);
    [...banners[side]].sort((x, y) => y.votes - x.votes).forEach((b) => {
      const card = document.createElement('div'); card.className = 'banner';
      if (b === top) card.insertAdjacentHTML('beforeend', '<span class="flying">flying today</span>');
      const cv = document.createElement('canvas'); cv.width = BW; cv.height = BH; cv.getContext('2d').drawImage(b.img, 0, 0); card.append(cv);
      card.insertAdjacentHTML('beforeend', `<span class="by">${b.by === 'you' ? 'yours' : 'u/' + b.by}</span>`);
      const v = document.createElement('button'); v.className = 'vote'; v.type = 'button'; v.setAttribute('aria-pressed', String(b.voted));
      v.textContent = `▲ ${b.votes}`;
      v.onclick = () => { b.voted = !b.voted; b.votes += b.voted ? 1 : -1; render(); draw(); renderCards(); };
      card.append(v); grid.append(card);
    });
  };
  render();
}

// ---------- the war council: arguments win reinforcements ----------
// In the real game these are the post's comments; their upvotes count for the writer's side.
const RALLY_EVERY = 25;
// The council lives on the server: every argument, rebuttal and vote is shared by the whole post.
let args = [];
const takenBy = {}; // hexes each cry has taken today, counted from the move log
function setCouncil(list, myVotes) {
  const own = (by) => (by === myName ? 'you' : by);
  const row = (a) => ({ ...a, by: own(a.by), vote: myVotes[a.id] || 0, taken: takenBy[a.id] || 0, replies: [] });
  const top = list.filter((a) => !a.parent).map(row), byId = new Map(top.map((a) => [a.id, a]));
  list.filter((a) => a.parent && byId.has(a.parent)).forEach((r) => byId.get(r.parent).replies.push(row(r)));
  args = top;
}
const sideVotes = (side) => args.filter((a) => a.side === side).reduce((n, a) => n + Math.max(0, a.votes), 0);
const reinforcements = (side) => Math.floor(sideVotes(side) / RALLY_EVERY);
let grantedRally = 0;
const MAX_RALLY_CHARGES = 3; // council reinforcements per fighter per day
const rallyCharges = () => hand.filter((s) => s.rally).length;
function syncRally() {
  // Each rally earned by your side's arguments puts one more charge in your hand, up to MAX_RALLY_CHARGES a day.
  if (!mySide || !trained()) return;
  const owed = Math.min(reinforcements(mySide) - grantedRally, MAX_RALLY_CHARGES - rallyCharges());
  for (let i = 0; i < owed; i++) hand.push({ kind: 'charge', used: false, rally: true });
  if (owed > 0) { grantedRally += owed; statusEl.textContent = `The council rallied the ${SIDES[mySide].name.toLowerCase()}: +${owed} charge in your hand.`; renderCards(); }
}
// A vote or a post in the council. True when the server took it; the error shows in the sheet otherwise.
async function council(path, body) {
  sound.tick();
  try {
    const data = await api(`${path}?${after()}`, body);
    applyState(path === 'argue' ? data.state : data);
    return true;
  } catch (error) {
    const note = document.querySelector('.sheet .councilNote');
    if (note) note.textContent = error.message; else statusEl.textContent = error.message;
    return false;
  }
}
function openCouncil() {
  const el = sheet(`<header><h2>War council</h2><button class="close" type="button">Back to the war</button></header>
    <p>Argue for your side and rebut theirs. Upvote what's true, downvote what's nonsense. A rebuttal's score is taken off the cry it answers: an argument's score is its strength as a battle cry, and every ${RALLY_EVERY} points a side's arguments earn send each of its fighters an extra charge.</p>
    <div class="rally"></div><p class="councilNote" role="status"></p>
    <div class="write"><input maxlength="120" placeholder="Why the ${SIDES[mySide].name.toLowerCase()} deserve the island" aria-label="Your argument" /><button class="vote" type="button">Post</button></div>
    <div class="council"></div>`);
  const list = el.querySelector('.council'), rally = el.querySelector('.rally');
  const render = () => {
    rally.innerHTML = ['a', 'b'].map((sd) => `<div style="color:${SIDES[sd].ink}"><b>${SIDES[sd].name}</b>${sideVotes(sd)} upvotes, ${reinforcements(sd)} ${reinforcements(sd) === 1 ? 'rally' : 'rallies'}<br><small>${RALLY_EVERY - (sideVotes(sd) % RALLY_EVERY)} to the next</small></div>`).join('');
    list.innerHTML = '';
    [...args].sort((x, y) => y.votes - x.votes).forEach((a) => {
      const row = document.createElement('div'); row.className = 'arg'; row.style.borderColor = SIDES[a.side].ink;
      row.innerHTML = `<div style="flex:1"><q>${a.text.replace(/[<>&]/g, '')}</q><small>${a.by === 'you' ? 'you' : titled(a.by)}, for the ${SIDES[a.side].name.toLowerCase()}${a.taken ? `, has taken ${a.taken} ${a.taken === 1 ? 'hex' : 'hexes'}` : ''}</small></div>`;
      const box = document.createElement('div'); box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.alignItems = 'center'; box.style.gap = '2px';
      for (const dir of [1, -1]) {
        const v = document.createElement('button'); v.className = 'vote'; v.type = 'button'; v.setAttribute('aria-pressed', String(a.vote === dir));
        v.setAttribute('aria-label', dir > 0 ? 'Upvote' : 'Downvote'); v.textContent = dir > 0 ? '\u25B2' : '\u25BC';
        v.onclick = async () => { if (await council('vote', { id: a.id, dir: a.vote === dir ? 0 : dir })) { render(); advanceLesson(TRAINED); } };
        box.append(v);
        if (dir > 0) box.insertAdjacentHTML('beforeend', `<span class="pct">${a.votes}</span>`);
      }
      row.append(box); list.append(row);
      // The thread: the other side's rebuttals, and a way to add one.
      const thread = document.createElement('div'); thread.style.cssText = 'margin:-4px 0 4px 22px;display:flex;flex-direction:column;gap:4px';
      [...a.replies].sort((x, y) => y.votes - x.votes).slice(0, 2).forEach((r, k) => {
        const rr = document.createElement('div'); rr.className = 'arg'; rr.style.borderColor = SIDES[r.side].ink; rr.style.fontSize = '15px';
        rr.innerHTML = `<div style="flex:1"><span style="font-size:15px">${r.text.replace(/[<>&]/g, '')}</span><small>${r.by === 'you' ? 'you' : titled(r.by)}, for the ${SIDES[r.side].name.toLowerCase()}${k === 0 && rawPower(r) ? `, cuts this cry by ${rawPower(r)}` : ''}</small></div>`;
        const vb = document.createElement('div'); vb.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
        for (const dir of [1, -1]) {
          const v = document.createElement('button'); v.className = 'vote'; v.type = 'button'; v.setAttribute('aria-pressed', String(r.vote === dir)); v.setAttribute('aria-label', dir > 0 ? 'Upvote rebuttal' : 'Downvote rebuttal'); v.textContent = dir > 0 ? '\u25B2' : '\u25BC';
          v.onclick = async () => { if (await council('vote', { id: r.id, dir: r.vote === dir ? 0 : dir })) render(); };
          vb.append(v); if (dir > 0) vb.insertAdjacentHTML('beforeend', `<span class="pct">${r.votes}</span>`);
        }
        rr.append(vb); thread.append(rr);
      });
      if (a.side !== mySide) {
        const open = document.createElement('button'); open.className = 'chip'; open.type = 'button'; open.style.alignSelf = 'flex-start'; open.textContent = 'Rebut';
        open.onclick = () => {
          open.replaceWith(Object.assign(document.createElement('div'), { className: 'write', innerHTML: `<input maxlength="120" placeholder="Answer the ${SIDES[a.side].name.toLowerCase()}" aria-label="Your rebuttal" /><button class="vote" type="button">Post</button>` }));
          const w = thread.querySelector('.write'); w.querySelector('input').focus();
          w.querySelector('.vote').onclick = async () => { const t = w.querySelector('input').value.trim(); if (!t) return; if (await council('argue', { text: t, parent: a.id })) render(); };
        };
        thread.append(open);
      }
      list.append(thread);
    });
  };
  const input = el.querySelector('input');
  el.querySelector('.write .vote').onclick = async () => {
    const text = input.value.trim(); if (!text) return;
    if (await council('argue', { text })) { input.value = ''; render(); advanceLesson(TRAINED); }
  };
  render();
}

// ---------- the easel: draw on a heraldic shield ----------
function openEasel() {
  const side = mySide, ink = SIDES[side].ink;
  const el = sheet(`<header><h2>Draw a banner</h2><button class="close" type="button">Cancel</button></header>
    <p>Start from a division, add your own mark, then raise it for a vote.</p>
    <div class="easel"><canvas width="${BW * 2}" height="${BH * 2}"></canvas>
    <div class="row" data-role="div"></div><div class="row" data-role="pens"></div>
    <div class="row"><button class="chip" type="button" data-act="charge">Add a charge</button><button class="chip" type="button" data-act="clear">Start over</button></div>
    <button class="raise" type="button">Raise it</button></div>`);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const strokes = document.createElement('canvas'); strokes.width = BW * 2; strokes.height = BH * 2; const sctx = strokes.getContext('2d');
  let div = 'plain', pen = TINCTURE.gold, chargeIdx = -1, chargeKind = null;
  const charges = ['star', 'crescent', 'paw', 'cross', 'sun'];
  const paint = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.save(); shieldPath(ctx); ctx.clip();
    division(ctx, div, ink, TINCTURE.gold);
    if (chargeKind) charge(ctx, chargeKind, BW / 2, BH * .44, 26, TINCTURE.silver);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(strokes, 0, 0); ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.restore(); frame(ctx);
  };
  const divRow = el.querySelector('[data-role="div"]');
  DIVISIONS.forEach((d) => { const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.textContent = d === 'pale' ? 'halves' : d === 'bend' ? 'diagonal' : d; b.setAttribute('aria-pressed', String(d === div)); b.onclick = () => { div = d; divRow.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); paint(); }; divRow.append(b); });
  const penRow = el.querySelector('[data-role="pens"]');
  [TINCTURE.gold, TINCTURE.silver, C.ink, ink].forEach((col) => { const b = document.createElement('button'); b.className = 'swatch'; b.type = 'button'; b.style.background = col; b.setAttribute('aria-label', 'Pen colour'); b.setAttribute('aria-pressed', String(col === pen)); b.onclick = () => { pen = col; penRow.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; penRow.append(b); });
  el.querySelector('[data-act="charge"]').onclick = () => { chargeIdx = (chargeIdx + 1) % charges.length; chargeKind = charges[chargeIdx]; paint(); };
  el.querySelector('[data-act="clear"]').onclick = () => { sctx.clearRect(0, 0, strokes.width, strokes.height); chargeKind = null; chargeIdx = -1; div = 'plain'; paint(); };
  let last = null;
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); last = at(e); });
  cv.addEventListener('pointermove', (e) => {
    if (!last) return; const p = at(e);
    sctx.strokeStyle = pen; sctx.lineWidth = 9; sctx.lineCap = 'round'; sctx.beginPath(); sctx.moveTo(last.x, last.y); sctx.lineTo(p.x, p.y); sctx.stroke();
    last = p; paint();
  });
  cv.addEventListener('pointerup', () => { last = null; });
  el.querySelector('.raise').onclick = () => {
    const out = document.createElement('canvas'); out.width = BW; out.height = BH; const o = out.getContext('2d'); o.drawImage(cv, 0, 0, BW, BH);
    banners[side].push({ by: 'you', votes: 1, voted: true, img: out });
    el.remove(); openGallery();
  };
  paint();
}

// ---------- input ----------
const tip = document.getElementById('tip');
const pointer = (e) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
canvas.addEventListener('pointermove', (e) => {
  const p = pointer(e), c = hexAt(p.x, p.y);
  if (c !== hover) { hover = c; draw(); }
  if (c && c.side && picked === null) { tip.style.display = 'block'; tip.style.left = p.x + 'px'; tip.style.top = p.y + 'px'; tip.textContent = `${KINDS[c.kind].name} of the ${SIDES[c.side].name.toLowerCase()}, raised by ${c.by === 'you' ? 'you' : 'u/' + c.by}`; }
  else tip.style.display = 'none';
});
canvas.addEventListener('pointerleave', () => { hover = null; tip.style.display = 'none'; draw(); });
canvas.addEventListener('pointerdown', async (e) => {
  const p = pointer(e), c = hexAt(p.x, p.y), kind = pickedKind();
  if (!kind || !mySide || replayingDay) return;
  if (!onOwnIsle()) { statusEl.textContent = `You're watching ${isleName(isles.viewing)}. Your fight is on ${isleName(isles.mine)}.`; return; }
  if (kind === 'charge') {
    if (!canCharge(c, mySide)) { statusEl.textContent = 'Charge an enemy hex that touches your land.'; return; }
    if (lesson < 3) { plainCharge(c); return; }
    openCry(c); return;
  }
  if (!isFree(c)) { statusEl.textContent = 'That hex is held or under water.'; return; }
  const sent = await submit('build', { kind, q: c.q, r: c.r });
  if (!sent) return;
  if (sent.gained === null) { statusEl.textContent = 'Someone got there first. Pick another hex.'; return; }
  const captured = sent.gained > 1;
  picked = null; hover = null;
  afterMove();
  if (captured) advanceLesson(2);
  else if (lesson === 0) advanceLesson(1);
  else if (lesson === 1 && !hand.some((s) => !s.used && s.kind === 'camp')) advanceLesson(2); // nobody to surround today: move on anyway
});
// Once the day has nothing left to do, offer its ending instead of a still map.
function offerMidnight() {
  const el = document.getElementById('dayEnd');
  el.hidden = false; el.querySelector('button').onclick = openMidnight;
}
function afterMove() {
  const left = hand.filter((s) => !s.used).length;
  if (!left) offerMidnight();
  statusEl.textContent = left ? `${myPoints} points for the ${SIDES[mySide].name.toLowerCase()} so far. ${left} left.` : `${myPoints} points today. The island is decided at midnight.`;
  renderCards();
}
// While learning, a charge has no battle cry, and the result explains its numbers.
async function plainCharge(target) {
  const atk = attackOf(target, mySide, null), def = defenceOf(target), near = ownNear(target, mySide);
  if (!await sendCharge(target, null)) return;
  statusEl.textContent = `Your attack ${atk} (1, plus ${near} for your land around it) against their defence ${def}: ${atk > def ? 'taken' : 'held off'}.`;
  advanceLesson(3);
}
// True once the charge is on the board.
async function sendCharge(target, cryId) {
  const sent = await submit('charge', { q: target.q, r: target.r, cry: cryId });
  if (!sent) return false;
  picked = null; hover = null;
  afterMove();
  if (sent.gained === null) { statusEl.textContent = 'The front moved before you got there. Your charge was spent on nothing.'; return false; }
  return true;
}
// Before a charge you choose which of your side's arguments to shout.
function openCry(target) {
  const def = defenceOf(target), name = SIDES[mySide].name.toLowerCase();
  const el = sheet(`<header><h2>Battle cry</h2><button class="close" type="button">Hold back</button></header>
    <p>The ${SIDES[target.side].name.toLowerCase()} defend this hex with <b>${def}</b>: ${STRENGTH[target.kind]} for the ${target.kind}, ${ownNear(target, target.side)} for their land around it, ${HOME} for holding it. Your attack is <b>${attackOf(target, mySide, null)}</b> before a battle cry: 1 for the charge, ${ownNear(target, mySide)} for your land around it${myFleet() ? ` and ${myFleet()} from your fleets on the islands next door` : ''}. Beat ${def} to take it.</p>
    <p>Pick a battle cry. Every ${CRY_VOTES} upvotes it has in the war council add 1 to your attack.</p>
    <div class="write"><input maxlength="120" placeholder="Or write your own" aria-label="Your own battle cry" /><button class="vote" type="button">Shout it</button></div>
    <p style="font-size:13px">A new cry starts with no strength. It goes to the war council, and every ${CRY_VOTES} points it earns there make each charge that shouts it stronger. You're credited with every hex it takes.</p>
    <div class="council"></div>`);
  const list = el.querySelector('.council');
  el.querySelector('.write .vote').onclick = async () => {
    const text = el.querySelector('.write input').value.trim(); if (!text) return;
    el.remove();
    try { const { id, state } = await api(`argue?${after()}`, { text }); applyState(state); sendCharge(target, id); }
    catch (error) { statusEl.textContent = error.message; }
  };
  const options = [...args].filter((a) => a.side === mySide).sort((x, y) => y.votes - x.votes).slice(0, 4);
  [...options, null].forEach((cry) => {
    const atk = attackOf(target, mySide, cry), wins = atk > def;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'arg'; row.style.borderColor = SIDES[mySide].ink; row.style.textAlign = 'left'; row.style.font = 'inherit'; row.style.cursor = 'pointer'; row.style.color = 'inherit';
    row.innerHTML = `<div style="flex:1">${cry ? `<q>${cry.text.replace(/[<>&]/g, '')}</q><small>${cry.by === 'you' ? 'you' : titled(cry.by)}, ${cry.votes} points, +${cryPower(cry)}${rebuttalOf(cry) && rawPower(rebuttalOf(cry)) ? ` (rebutted by ${titled(rebuttalOf(cry).by)}, \u2212${rawPower(rebuttalOf(cry))})` : ''}</small>` : '<q>No battle cry</q><small>Just you and your neighbours</small>'}</div><span class="vote" style="border-color:${wins ? SIDES[mySide].ink : 'rgba(58,42,28,.4)'}">${wins ? `Takes it, ${atk} to ${def}` : `Held off, ${atk} to ${def}`}</span>`;
    row.onclick = () => { el.remove(); sendCharge(target, cry ? cry.id : null); };
    list.append(row);
  });
}
// ---------- how to play: shown once you pick a side, and from the header ----------
function openRules() {
  const name = SIDES[mySide].name.toLowerCase(), enemy = SIDES[mySide === 'a' ? 'b' : 'a'].name.toLowerCase();
  const el = sheet(`<header><h2>How to play</h2><button class="close" type="button">Close</button></header>
    <div class="rules"><ol>
      <li>You fight for the <span style="color:${SIDES[mySide].ink}">${name}</span>. Whoever holds more of the island at midnight wins the day.</li>
      <li><b>Camp</b>: put it on any empty hex. Surround an enemy camp on every side and it becomes yours. A <b>tower</b> can't be surrounded.</li>
      <li><b>Charge</b>: attack a ${enemy.replace(/s$/, '')} hex that touches your land. You take it if your attack is higher than its defence. A tie means they hold.</li>
      <li>Attack is 1, plus 1 for each of your hexes touching it, plus your battle cry. Defence is 1 for a camp or 3 for a tower, plus 1 for each of their hexes touching it, plus 1 for holding it.</li>
      <li>The war is fought over a chain of <b>islands</b>. You fight on yours and can watch the others. Hold an island and your side's <b>fleet</b> adds 1 to every charge on the islands beside it.</li>
      <li>Battle cries are arguments from the <b>war council</b>. Every ${CRY_VOTES} upvotes make a cry 1 stronger, and a good rebuttal from the other side weakens it. Argue well and your side hits harder.</li>
    </ol></div>
    <button class="go" type="button">To war</button>`);
  el.querySelector('.go').onclick = () => el.remove();
  return el;
}
// ---------- midnight: the day's result, pinned under the post ----------
// What the day meant for you. A day you skipped still says how close it was, so tomorrow has a reason.
const hexes = (n) => `${n} ${n === 1 ? 'hex' : 'hexes'}`;
// Share posts your line as your own comment under the feud. The server writes the line from the log.
async function shareLine(statusEl, button) {
  button.disabled = true;
  try {
    const { text } = await api('share', {});
    statusEl.textContent = `Posted under the feud with the map: \u201c${text}\u201d`;
  } catch (error) {
    statusEl.textContent = error.message;
    button.disabled = false;
  }
}
function yourDay(a, b, win) {
  const margin = Math.abs(a - b);
  if (!mySide) return { title: 'You sat this one out', line: margin ? `The ${SIDES[win].name.toLowerCase()} won by ${hexes(margin)}. Pick a side tomorrow.` : 'It ended dead even. One fighter would have settled it.' };
  const name = SIDES[mySide].name.toLowerCase(), won = margin > 0 && win === mySide;
  const played = hand.some((slot) => slot.used), mine = statOf('you').today;
  if (!played) {
    if (!margin) return { title: 'Your side needed you', line: `It ended dead even. One more ${name.replace(/s$/, '')} would have won it.` };
    return won
      ? { title: 'They won without you', line: `The ${name} held on by ${hexes(margin)}. Tomorrow, take your share of it.` }
      : { title: 'Your side needed you', line: `The ${name} lost by ${hexes(margin)}. Your pieces could have closed that.` };
  }
  const tail = `${hexes(mine)} taken, ${myPoints} points. Rank: ${rankOf('you')[1]}.`, sign = `Feudlands, day ${TODAY}`;
  if (won && mine >= margin) return { title: 'You were the margin', line: `The ${name} won by ${hexes(margin)} and you took ${mine}. ${myPoints} points. Rank: ${rankOf('you')[1]}.`, share: `I was the margin: the ${name} won by ${hexes(margin)}. ${sign}` };
  return { title: 'Your day', line: tail, share: mine ? `I took ${hexes(mine)} for the ${name}. ${sign}` : null };
}
function openMidnight() {
  sound.bell();
  hover = null; picked = null; draw();
  let a = 0, b = 0; for (const c of cells.values()) { if (c.side === 'a') a++; if (c.side === 'b') b++; }
  const win = a >= b ? 'a' : 'b', pa = Math.round((Math.max(a, b) / Math.max(1, a + b)) * 100);
  const generals = Object.entries(stats).filter(([, st]) => st.today > 0).sort((x, y) => y[1].today - x[1].today);
  const [gen, genStat] = generals[0] || ['nobody', { today: 0 }];
  const cry = [...args].filter((x) => x.taken).sort((x, y) => y.taken - x.taken)[0] || [...args].sort((x, y) => y.votes - x.votes)[0];
  const day = yourDay(a, b, win);
  const el = sheet(`<header><h2>Midnight</h2><button class="close" type="button">Back to the war</button></header>
    <p>The day so far. The war goes on until 00:00 UTC; then this is pinned under the post and tomorrow's feud goes up.</p>
    <img alt="The island at midnight" style="width:100%;border:1px solid rgba(58,42,28,.3)" src="${canvas.toDataURL('image/png')}" />
    <h2 style="color:${a === b ? C.ink : SIDES[win].ink}">${a === b ? 'The island is split, 50% to 50%' : `The ${SIDES[win].name.toLowerCase()} hold the island, ${pa}% to ${100 - pa}%`}</h2>
    <div class="arg" style="border-color:${C.ink}"><div style="flex:1"><q>General of the day</q><small>${genStat.today ? `${gen === 'you' ? 'You' : titled(gen)}, ${genStat.today} ${genStat.today === 1 ? 'hex' : 'hexes'} taken` : 'Nobody yet. Take one hex and it\u2019s you.'}</small></div></div>
    <div class="arg" style="border-color:${SIDES[cry.side].ink}"><div style="flex:1"><q>${cry.text.replace(/[<>&]/g, '')}</q><small>Cry of the day, by ${cry.by === 'you' ? 'you' : titled(cry.by)}${cry.taken ? `, took ${cry.taken} ${cry.taken === 1 ? 'hex' : 'hexes'}` : ''}</small></div></div>
    <div class="arg" style="border-color:${mySide ? SIDES[mySide].ink : C.ink}"><div style="flex:1"><q>${day.title}</q><small>${day.line}</small>${day.share ? `<p class="brag"><button type="button" class="vote">Share with the map</button><span role="status"></span></p>` : ''}</div></div>
    <p><button type="button" class="vote replay">Replay the day</button> <small>Watch the whole day again on the map, from the morning.</small></p>
    <h2>Week ${week.n}</h2>
    <p>Hexes taken by real fighters this week. After seven feuds the leader becomes General of the week, in their flair.</p>
    ${week.top.length ? `<ol class="week">${week.top.map((r) => `<li${r.name === myName ? ' class="me"' : ''}><span>${r.name === myName ? 'You' : 'u/' + esc(r.name)}</span><small>${r.hexes} ${r.hexes === 1 ? 'hex' : 'hexes'}, ${r.wins} ${r.wins === 1 ? 'win' : 'wins'}</small></li>`).join('')}</ol>` : '<p><em>Nobody has taken a hex this week yet. The first one leads.</em></p>'}
    <h2>Tomorrow's feud</h2>
    <p>Vote for what the island fights over tomorrow. The winner goes up as a new post at midnight.</p>
    <div class="ballot"></div><p class="councilNote" role="status"></p>
    <div class="suggest"></div>`);
  el.querySelector('.replay').onclick = replayDay;
  renderBallot(el.querySelector('.ballot'));
  renderSuggest(el.querySelector('.suggest'), el.querySelector('.ballot'));
  const brag = el.querySelector('.brag');
  if (brag) brag.querySelector('button').onclick = () => shareLine(brag.querySelector('span'), brag.querySelector('button'));
  return el;
}
new ResizeObserver(() => { layout(); draw(); }).observe(canvas);
async function start() {
  tally(); renderCards(); layout(); draw();
  try {
    replaying = true;
    const state = await api(VIEW === null ? 'state' : `state?isle=${Number(VIEW)}`);
    myName = state.me.name;
    isles = state.isles;
    setFeud(state.feud);
    layout();
    applyState(state);
    // Your side from earlier today. Joined after the council loads, so rallies already earned aren't handed out again.
    if (state.me.side) joinSide(state.me.side);
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    replaying = false;
  }
  if (mySide && hand.some((slot) => slot.used)) afterMove();
  api('mod').then((m) => { isMod = m.mod; }).catch((error) => console.warn('Could not check moderator status', error));
  tally(); renderCards(); draw();
  setTimeout(poll, POLL_MS);
}
sound.unlockOnFirstTap();
document.fonts.ready.then(start);
// Test hook: ?debug exposes the board so scripted playthroughs can find hexes.
if (new URLSearchParams(location.search).has('debug')) window.feud = { I, sound, cells, center, lessonHexes, canCharge, isFree, hand, get lesson() { return lesson; }, get mySide() { return mySide; }, get seq() { return lastSeq; }, get points() { return myPoints; } };
