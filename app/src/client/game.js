// ---------- seeded randomness ----------
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = (q, r, s = 0) => { let h = (q * 374761393 + r * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

const C = { ink: '#3a2a1c', inkSoft: '#7a6347', sea: '#6f9a95', land: '#e6d3a3', paper: '#efe3c8' };
const SIDES = { a: { name: 'Cats', ink: '#2f5d8a' }, b: { name: 'Dogs', ink: '#b5452f' } };
const TODAY = 12, INK_MS = 700, LABEL_MS = 2600, BATTLE_MS = 3400;
const battles = [];

// ---------- today's island (a new shape every day) ----------
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const EDGE = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
const key = (q, r) => q + ',' + r;
const RADIUS = 7;
const cells = new Map();
for (let q = -RADIUS - 2; q <= RADIUS + 2; q++) for (let r = -RADIUS - 2; r <= RADIUS + 2; r++) {
  const d = (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2;
  if (d > RADIUS + 1) continue;
  const coast = RADIUS - 1.2 + (hash(q, r, TODAY) - 0.5) * 2.4 + Math.sin(q * 0.9 + r * 0.4 + TODAY) * 0.8;
  cells.set(key(q, r), { q, r, land: d <= coast, side: null, kind: null, by: null });
}
const cell = (q, r) => cells.get(key(q, r));
const landNeighbours = (c) => DIRS.map(([dq, dr]) => cell(c.q + dq, c.r + dr)).filter((n) => n && n.land);
const isFree = (c) => c && c.land && !c.side;

// ---------- the rules ----------
// Camp: claims a hex. Tower: claims a hex and can never be captured.
// Capture: an enemy camp whose every land neighbour is yours turns to your side.
const KINDS = {
  camp: { name: 'Camp', rule: 'Claims one hex' },
  tower: { name: 'Tower', rule: 'Claims a hex. Can\u2019t be boxed in' },
  charge: { name: 'Charge', rule: 'Attack an enemy hex beside your land' },
};
function captures(side) {
  const flipped = [];
  for (const c of cells.values()) {
    if (!c.land || !c.side || c.side === side || c.kind === 'tower') continue;
    const near = landNeighbours(c);
    if (near.length && near.every((n) => n.side === side)) flipped.push(c);
  }
  return flipped;
}
// How many enemy hexes would fall if this side built here (for the preview).
function wouldCapture(c, side) {
  const was = c.side; c.side = side; c.kind = 'camp';
  const n = captures(side).length;
  c.side = was; c.kind = null;
  return n;
}

// Charge: attack an enemy hex that touches your land.
// Attack = you + your pieces around the target + your battle cry (an argument: +1 per 20 upvotes).
// Defence = the piece (camp 1, tower 3) + its own side's pieces around it + 1 for holding the ground.
const STRENGTH = { camp: 1, tower: 3 };
const ownNear = (c, side) => landNeighbours(c).filter((n) => n.side === side).length;
const CRY_VOTES = 20, HOME = 1;
// A cry's strength is its score, minus the score of the best rebuttal the other side has posted under it.
const rawPower = (x) => Math.max(0, Math.floor(x.votes / CRY_VOTES));
const rebuttalOf = (cry) => (cry && cry.replies && cry.replies.length ? [...cry.replies].sort((x, y) => y.votes - x.votes)[0] : null);
const cryPower = (cry) => (cry ? Math.max(0, rawPower(cry) - (rebuttalOf(cry) ? rawPower(rebuttalOf(cry)) : 0)) : 0);
const canCharge = (c, side) => Boolean(c && c.land && c.side && c.side !== side && ownNear(c, side) > 0);
const attackOf = (c, side, cry) => 1 + ownNear(c, side) + cryPower(cry);
const defenceOf = (c) => STRENGTH[c.kind] + ownNear(c, c.side) + HOME;

// ---------- ranks: earned by hexes taken, across all days ----------
const RANKS = [[0, 'Recruit', 'Rct.'], [3, 'Private', 'Pvt.'], [8, 'Corporal', 'Cpl.'], [15, 'Sergeant', 'Sgt.'], [25, 'Captain', 'Capt.'], [40, 'General', 'Gen.']];
const stats = {};
const statOf = (name) => (stats[name] ||= { total: 0, today: 0 });
const rankOf = (name) => [...RANKS].reverse().find(([min]) => statOf(name).total >= min);
const titled = (name) => (name === 'you' ? 'you' : `${rankOf(name)[2]} u/${name}`);
function credit(name, n) { const st = statOf(name); st.total += n; st.today += n; }

// ---------- the morning so far: both sides already fighting ----------
const NAMES = ['quietfox', 'tea_and_maps', 'mod_kettle', 'lofi_owl', 'pixelpuddle', 'oldsalt', 'fernweh', 'brick_by_brick', 'nightjar', 'cartographer_k', 'sundial', 'gravelpit'];
const sideOf = (name) => (NAMES.indexOf(name) % 2 === 0 ? 'a' : 'b');
(function morning() {
  const rand = rng(TODAY);
  const land = [...cells.values()].filter((c) => c.land);
  // Each side starts from its own shore and pushes inland.
  const anchors = { a: { q: -4, r: 2 }, b: { q: 4, r: -2 } };
  for (let i = 0; i < 66; i++) {
    const side = i % 2 ? 'a' : 'b', home = anchors[side];
    const pool = land.filter(isFree).sort((x, y) => Math.hypot(x.q - home.q, x.r - home.r) - Math.hypot(y.q - home.q, y.r - home.r) + (rand() - 0.5) * 6);
    const c = pool[0]; if (!c) break;
    const by = NAMES.filter((n) => sideOf(n) === side)[Math.floor(rand() * 5)] || NAMES[0];
    Object.assign(c, { side, kind: rand() < 0.15 ? 'tower' : 'camp', by });
  }
})();

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
      g.fillText(`${atk} vs ${def}`, p.x + size * .8, p.y - size * .6);
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
function assault(c, side, by, cry) {
  const now = performance.now(), atk = attackOf(c, side, cry), def = defenceOf(c), won = atk > def, enemy = c.side;
  for (let i = battles.length - 1; i >= 0; i--) if (now - battles[i].at > BATTLE_MS) battles.splice(i, 1);
  battles.push({ c, side, at: now, cry, rebut: rebuttalOf(cry), won, seed: Math.floor(now) });
  if (won) {
    Object.assign(c, { side, kind: 'camp', by, flipAt: now + 900, label: null });
    const boxed = captures(side);
    boxed.forEach((f) => Object.assign(f, { side, flipAt: now + 1200, label: 'captured', by }));
    credit(by, 1 + boxed.length);
    if (cry) { cry.taken = (cry.taken || 0) + 1 + boxed.length; credit(cry.by, 0); }
  }
  const who = by === 'you' ? 'You' : titled(by);
  log(`<span>${who} charged the ${SIDES[enemy].name.toLowerCase()}, ${atk} vs ${def}: ${won ? 'taken' : 'held'}</span><em>${won ? '+3' : '+0'}</em>`, side);
  setTimeout(() => { tally(); showRank(); }, 900); animate();
  return won ? 3 : 0;
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
  let a = 0, b = 0;
  for (const c of cells.values()) { if (c.side === 'a') a++; if (c.side === 'b') b++; }
  const pa = Math.round((a / Math.max(1, a + b)) * 100);
  document.getElementById('rope').style.width = pa + '%';
  document.getElementById('pctA').textContent = pa + '%';
  document.getElementById('pctB').textContent = (100 - pa) + '%';
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
  const now = performance.now();
  Object.assign(c, { side, kind, by, bornAt: now, label: titled(by) });
  const flipped = captures(side);
  flipped.forEach((f) => Object.assign(f, { side, flipAt: now + 350, label: 'captured', by }));
  credit(by, flipped.length);
  const who = by === 'you' ? 'You' : titled(by);
  log(flipped.length ? `<span>${who} took ${flipped.length} from the ${SIDES[side === 'a' ? 'b' : 'a'].name.toLowerCase()}</span><em>+${1 + flipped.length * 2}</em>` : `<span>${who} raised a ${KINDS[kind].name.toLowerCase()}</span><em>+1</em>`, side);
  tally(); showRank(); animate();
  return 1 + flipped.length * 2;
}
// Other players look for the move that captures the most, else push the front line.
const crowd = rng(99);
// The demo crowd plays a day's worth of moves, then the front goes quiet. It waits while the tab is hidden.
const CROWD_MOVES_PER_DAY = 80, HIDDEN_RECHECK_MS = 2000;
const FREE_LAND_KEPT = 0.25; // the crowd stops building once only this share of land is free, so you always have room
let crowdMoves = 0;
function someoneMoves() {
  if (document.hidden) { setTimeout(someoneMoves, HIDDEN_RECHECK_MS); return; }
  if (crowdMoves >= CROWD_MOVES_PER_DAY) { log('<span>The front has gone quiet. The island is decided at midnight.</span>', mySide || 'a'); offerMidnight(); return; }
  crowdMoves++;
  const by = NAMES[Math.floor(crowd() * NAMES.length)], side = sideOf(by);
  const land = [...cells.values()].filter((c) => c.land);
  const crowded = land.filter(isFree).length <= land.length * FREE_LAND_KEPT;
  if (crowded || crowd() < 0.45) {
    const cry = [...args].filter((a) => a.side === side).sort((x, y) => y.votes - x.votes)[Math.floor(crowd() * 2)] || null;
    const targets = [...cells.values()].filter((c) => canCharge(c, side)).map((c) => ({ c, v: attackOf(c, side, cry) - defenceOf(c) + crowd() })).sort((x, y) => y.v - x.v);
    if (targets[0]) { assault(targets[0].c, side, by, cry); setTimeout(someoneMoves, 3000 + crowd() * 3000); return; }
  }
  const free = crowded ? [] : [...cells.values()].filter(isFree);
  const scored = free.map((c) => ({ c, v: wouldCapture(c, side) * 5 + landNeighbours(c).filter((n) => n.side).length + crowd() * 2 }));
  scored.sort((x, y) => y.v - x.v);
  const pick = scored[Math.floor(crowd() * Math.min(3, scored.length))];
  if (pick) move(pick.c, crowd() < 0.15 ? 'tower' : 'camp', side, by);
  document.getElementById('here').textContent = String(27 + Math.floor(crowd() * 9));
  // The council never sleeps: someone upvotes an argument now and then.
  if (crowd() < 0.7) { const a = args[Math.floor(crowd() * args.length)]; const target = a.replies.length && crowd() < 0.4 ? a.replies[0] : a; target.votes += 1 + Math.floor(crowd() * 3); syncRally(); }
  setTimeout(someoneMoves, 2200 + crowd() * 3000);
}

// ---------- your hand: three pieces a day ----------
const hand = [{ kind: 'camp', used: false }, { kind: 'tower', used: false }, { kind: 'charge', used: false }, { kind: 'charge', used: false }];
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
    b.className = 'card'; b.type = 'button'; b.setAttribute('aria-pressed', String(isPicked)); b.disabled = !free.length || !mySide;
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
  el.textContent = `${name} of the ${SIDES[mySide].name.toLowerCase()}${next ? `, ${next[0] - statOf('you').total} hexes to ${next[1]}` : ''}.`;
}

// ---------- choosing a side ----------
document.querySelectorAll('#pick button').forEach((btn) => btn.addEventListener('click', () => {
  mySide = btn.dataset.side;
  document.getElementById('pick').remove();
  const you = document.getElementById('you');
  you.innerHTML = '<span id="rank"></span><button type="button" id="openCouncil">War council</button><button type="button" id="openGallery">Banners</button><button type="button" id="openEasel">Draw one</button><button type="button" id="openMidnight">Midnight</button>';
  document.getElementById('openMidnight').onclick = openMidnight;
  showRank();
  document.getElementById('openGallery').onclick = openGallery;
  document.getElementById('openEasel').onclick = openEasel;
  document.getElementById('openCouncil').onclick = openCouncil;
  grantedRally = reinforcements(mySide);
  statusEl.textContent = 'Pick a piece.';
  renderCards();
}));

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
const args = [
  { side: 'a', by: fightersOf('a')[0], text: 'A cat will never make you walk it in the rain at 6 am.', votes: 48 },
  { side: 'b', by: fightersOf('b')[0], text: 'Nobody has ever been rescued from a fire by a cat.', votes: 44 },
  { side: 'a', by: fightersOf('a')[1], text: 'Cats invented the internet. Dogs just chew the cables.', votes: 31 },
  { side: 'b', by: fightersOf('b')[1], text: 'A dog is happy to see you every single time. Every. Time.', votes: 27 },
  { side: 'a', by: fightersOf('a')[2], text: 'Quiet, clean, and judges your life choices for free.', votes: 12 },
  { side: 'b', by: fightersOf('b')[2], text: 'Try taking a cat on a hike.', votes: 9 },
].map((a) => ({ ...a, vote: 0, taken: 0, replies: [] }));
// Rebuttals from the other side, threaded under each argument.
[[0, 'The walk in the rain is the best part of the day. Ask any dog.', 26],
 [1, 'Nobody has been rescued from a fire by a goldfish either. Not a job requirement.', 41],
 [2, 'Dogs invented loyalty. Try running a forum without it.', 8],
 [3, 'Happy to see you, the mailman, and a sock.', 19]].forEach(([i, text, votes]) => {
  const a = args[i], side = a.side === 'a' ? 'b' : 'a';
  a.replies.push({ side, by: fightersOf(side)[3 + (i % 2)], text, votes, vote: 0 });
});
const sideVotes = (side) => args.filter((a) => a.side === side).reduce((n, a) => n + Math.max(0, a.votes), 0);
const reinforcements = (side) => Math.floor(sideVotes(side) / RALLY_EVERY);
let grantedRally = 0;
const MAX_RALLY_CHARGES = 3; // council reinforcements per fighter per day
const rallyCharges = () => hand.filter((s) => s.rally).length;
function syncRally() {
  // Each rally earned by your side's arguments puts one more charge in your hand, up to MAX_RALLY_CHARGES a day.
  if (!mySide) return;
  const owed = Math.min(reinforcements(mySide) - grantedRally, MAX_RALLY_CHARGES - rallyCharges());
  for (let i = 0; i < owed; i++) hand.push({ kind: 'charge', used: false, rally: true });
  if (owed > 0) { grantedRally += owed; statusEl.textContent = `The council rallied the ${SIDES[mySide].name.toLowerCase()}: +${owed} charge in your hand.`; renderCards(); }
}
function openCouncil() {
  const el = sheet(`<header><h2>War council</h2><button class="close" type="button">Back to the war</button></header>
    <p>Argue for your side and rebut theirs. Upvote what's true, downvote what's nonsense. A rebuttal's score is taken off the cry it answers: an argument's score is its strength as a battle cry, and every ${RALLY_EVERY} points a side's arguments earn send each of its fighters an extra charge.</p>
    <div class="rally"></div>
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
        v.onclick = () => { a.votes -= a.vote; a.vote = a.vote === dir ? 0 : dir; a.votes += a.vote; render(); syncRally(); };
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
          v.onclick = () => { r.votes -= r.vote; r.vote = r.vote === dir ? 0 : dir; r.votes += r.vote; render(); };
          vb.append(v); if (dir > 0) vb.insertAdjacentHTML('beforeend', `<span class="pct">${r.votes}</span>`);
        }
        rr.append(vb); thread.append(rr);
      });
      if (a.side !== mySide) {
        const open = document.createElement('button'); open.className = 'chip'; open.type = 'button'; open.style.alignSelf = 'flex-start'; open.textContent = 'Rebut';
        open.onclick = () => {
          open.replaceWith(Object.assign(document.createElement('div'), { className: 'write', innerHTML: `<input maxlength="120" placeholder="Answer the ${SIDES[a.side].name.toLowerCase()}" aria-label="Your rebuttal" /><button class="vote" type="button">Post</button>` }));
          const w = thread.querySelector('.write'); w.querySelector('input').focus();
          w.querySelector('.vote').onclick = () => { const t = w.querySelector('input').value.trim(); if (!t) return; a.replies.push({ side: mySide, by: 'you', text: t, votes: 1, vote: 1 }); render(); };
        };
        thread.append(open);
      }
      list.append(thread);
    });
  };
  const input = el.querySelector('input');
  el.querySelector('.write .vote').onclick = () => {
    const text = input.value.trim(); if (!text) return;
    args.push({ side: mySide, by: 'you', text, votes: 1, vote: 1, taken: 0, replies: [] }); input.value = ''; render(); syncRally();
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
canvas.addEventListener('pointerdown', (e) => {
  const p = pointer(e), c = hexAt(p.x, p.y), kind = pickedKind();
  if (!kind || !mySide) return;
  if (kind === 'charge') {
    if (!canCharge(c, mySide)) { statusEl.textContent = 'Charge an enemy hex that touches your land.'; return; }
    openCry(c, picked); return;
  }
  if (!isFree(c)) { statusEl.textContent = 'That hex is held or under water.'; return; }
  myPoints += move(c, kind, mySide, 'you');
  hand[picked].used = true; picked = null; hover = null;
  afterMove();
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
// Before a charge you choose which of your side's arguments to shout.
function openCry(target, slotIndex) {
  const def = defenceOf(target), name = SIDES[mySide].name.toLowerCase();
  const el = sheet(`<header><h2>Battle cry</h2><button class="close" type="button">Hold back</button></header>
    <p>The ${SIDES[target.side].name.toLowerCase()} hold this hex with ${def}. Shout one of the ${name}' arguments: every ${CRY_VOTES} upvotes it has adds 1 to your charge.</p>
    <div class="write"><input maxlength="120" placeholder="Or write your own" aria-label="Your own battle cry" /><button class="vote" type="button">Shout it</button></div>
    <p style="font-size:13px">A new cry starts with no strength. It goes to the war council, and every ${CRY_VOTES} points it earns there make each charge that shouts it stronger. You're credited with every hex it takes.</p>
    <div class="council"></div>`);
  const list = el.querySelector('.council');
  el.querySelector('.write .vote').onclick = () => {
    const text = el.querySelector('.write input').value.trim(); if (!text) return;
    const cry = { side: mySide, by: 'you', text, votes: 1, vote: 1, taken: 0, replies: [] }; args.push(cry);
    el.remove(); myPoints += assault(target, mySide, 'you', cry); hand[slotIndex].used = true; picked = null; hover = null; afterMove();
  };
  const options = [...args].filter((a) => a.side === mySide).sort((x, y) => y.votes - x.votes).slice(0, 4);
  [...options, null].forEach((cry) => {
    const atk = attackOf(target, mySide, cry), wins = atk > def;
    const row = document.createElement('button'); row.type = 'button'; row.className = 'arg'; row.style.borderColor = SIDES[mySide].ink; row.style.textAlign = 'left'; row.style.font = 'inherit'; row.style.cursor = 'pointer'; row.style.color = 'inherit';
    row.innerHTML = `<div style="flex:1">${cry ? `<q>${cry.text.replace(/[<>&]/g, '')}</q><small>${cry.by === 'you' ? 'you' : titled(cry.by)}, ${cry.votes} points, +${cryPower(cry)}${rebuttalOf(cry) && rawPower(rebuttalOf(cry)) ? ` (rebutted by ${titled(rebuttalOf(cry).by)}, \u2212${rawPower(rebuttalOf(cry))})` : ''}</small>` : '<q>No battle cry</q><small>Just you and your neighbours</small>'}</div><span class="vote" style="border-color:${wins ? SIDES[mySide].ink : 'rgba(58,42,28,.4)'}">${atk} vs ${def}</span>`;
    row.onclick = () => {
      el.remove();
      myPoints += assault(target, mySide, 'you', cry);
      hand[slotIndex].used = true; picked = null; hover = null;
      afterMove();
    };
    list.append(row);
  });
}
// ---------- midnight: the day's result, pinned under the post ----------
// What the day meant for you. A day you skipped still says how close it was, so tomorrow has a reason.
const hexes = (n) => `${n} ${n === 1 ? 'hex' : 'hexes'}`;
// In the real post Share drops this line as a comment under the day's post; here it goes to the clipboard.
async function shareLine(text, statusEl) {
  try { await navigator.clipboard.writeText(text); statusEl.textContent = `Copied: \u201c${text}\u201d`; }
  catch { statusEl.textContent = `Copy this: \u201c${text}\u201d`; }
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
  hover = null; picked = null; draw();
  let a = 0, b = 0; for (const c of cells.values()) { if (c.side === 'a') a++; if (c.side === 'b') b++; }
  const win = a >= b ? 'a' : 'b', pa = Math.round((Math.max(a, b) / Math.max(1, a + b)) * 100);
  const generals = Object.entries(stats).filter(([, st]) => st.today > 0).sort((x, y) => y[1].today - x[1].today);
  const [gen, genStat] = generals[0] || ['nobody', { today: 0 }];
  const cry = [...args].filter((x) => x.taken).sort((x, y) => y.taken - x.taken)[0] || [...args].sort((x, y) => y.votes - x.votes)[0];
  const day = yourDay(a, b, win);
  const el = sheet(`<header><h2>Midnight</h2><button class="close" type="button">Back to the war</button></header>
    <p>At 00:00 UTC the war stops and this goes up as a pinned comment under the post.</p>
    <img alt="The island at midnight" style="width:100%;border:1px solid rgba(58,42,28,.3)" src="${canvas.toDataURL('image/png')}" />
    <h2 style="color:${a === b ? C.ink : SIDES[win].ink}">${a === b ? 'The island is split, 50% to 50%' : `The ${SIDES[win].name.toLowerCase()} hold the island, ${pa}% to ${100 - pa}%`}</h2>
    <div class="arg" style="border-color:${C.ink}"><div style="flex:1"><q>General of the day</q><small>${gen === 'you' ? 'You' : titled(gen)}, ${genStat.today} ${genStat.today === 1 ? 'hex' : 'hexes'} taken</small></div></div>
    <div class="arg" style="border-color:${SIDES[cry.side].ink}"><div style="flex:1"><q>${cry.text.replace(/[<>&]/g, '')}</q><small>Cry of the day, by ${cry.by === 'you' ? 'you' : titled(cry.by)}${cry.taken ? `, took ${cry.taken} ${cry.taken === 1 ? 'hex' : 'hexes'}` : ''}</small></div></div>
    <div class="arg" style="border-color:${mySide ? SIDES[mySide].ink : C.ink}"><div style="flex:1"><q>${day.title}</q><small>${day.line}</small>${day.share ? `<p class="brag"><button type="button" class="vote">Share</button><span role="status"></span></p>` : ''}</div></div>
    <p>Tomorrow's feud: <em>Pineapple on pizza?</em></p>`);
  const brag = el.querySelector('.brag');
  if (brag) brag.querySelector('button').onclick = () => shareLine(day.share, brag.querySelector('span'));
  return el;
}
new ResizeObserver(() => { layout(); draw(); }).observe(canvas);
document.fonts.ready.then(() => { tally(); renderCards(); layout(); draw(); setTimeout(someoneMoves, 1500); });
