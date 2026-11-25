// The war's sounds, synthesised with Web Audio: no files to load, nothing to license.
// Ink and wood for building, steel for charges, a drum and horn for captures, the sea underneath.
const STORE_KEY = 'feudlands.sound';
const MASTER = 0.55, SEA_LEVEL = 0.018; // the sea stays a whisper: louder, it reads as a hum

let ctx = null, master = null, sea = null;
// Offline rendering (for the trailer) schedules sounds at a moment in the future instead of right now.
let offset = 0;
const now = () => ctx.currentTime + offset;
const heard = []; // what played and when, for the trailer's soundtrack (only kept with ?debug)
const note = (name, ...args) => { if (keepLog) heard.push({ name, args, t: Date.now() }); };
const keepLog = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
export const soundLog = () => heard;
let enabled = readEnabled();

function readEnabled() {
  try { return localStorage.getItem(STORE_KEY) !== 'off'; }
  catch { return true; } // storage blocked: sound stays on
}

/** Browsers only allow audio after a tap, so the first tap anywhere starts it. */
export function unlockOnFirstTap() {
  const start = () => { ensure(); window.removeEventListener('pointerdown', start); };
  window.addEventListener('pointerdown', start);
}

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain(); master.gain.value = MASTER; master.connect(ctx.destination);
    startSea();
  }
  if (ctx.state === 'suspended' && !(ctx instanceof OfflineAudioContext)) ctx.resume().catch((error) => console.warn('Sound could not resume', error));
  return ctx;
}

export const soundOn = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem(STORE_KEY, on ? 'on' : 'off'); } catch (error) { console.warn('Sound setting was not saved', error); }
  if (!on && ctx) { ctx.close().catch(() => {}); ctx = null; master = null; sea = null; }
  if (on) ensure();
}

// ---------- building blocks ----------
function noise(seconds) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; return src;
}
function env(node, at, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  node.connect(g); return g;
}
function tone(freq, at, { type = 'sine', peak = 0.3, attack = 0.005, decay = 0.3, glideTo = null, out = master } = {}) {
  const osc = ctx.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(freq, at);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, at + attack + decay);
  env(osc, at, peak, attack, decay).connect(out);
  osc.start(at); osc.stop(at + attack + decay + 0.05);
}
function hiss(at, { from = 2000, to = 2000, q = 1, peak = 0.2, attack = 0.005, decay = 0.2, type = 'bandpass', out = master } = {}) {
  const src = noise(attack + decay + 0.05), f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(to, at + attack + decay);
  src.connect(f); env(f, at, peak, attack, decay).connect(out);
  src.start(at);
}
const quiet = (loud) => (loud ? 1 : 0.35); // other people's moves sit further back

// The sea, always under everything: slow swells of filtered noise.
function startSea() {
  const src = noise(4); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
  const g = ctx.createGain(); g.gain.value = SEA_LEVEL;
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.frequency.value = 0.09; depth.gain.value = SEA_LEVEL * 0.8;
  lfo.connect(depth).connect(g.gain);
  src.connect(f).connect(g).connect(master);
  src.start(); lfo.start();
  sea = g;
}

// ---------- the sounds ----------
/** A camp or tower goes up: a wooden knock and a scratch of the quill. */
export function build(loud = true) {
  note('build', loud);
  if (!ensure()) return;
  const t = now(), k = quiet(loud);
  tone(140, t, { type: 'triangle', peak: 0.35 * k, decay: 0.12, glideTo: 90 });
  hiss(t + 0.03, { from: 3200, to: 5200, q: 3, peak: 0.08 * k, decay: 0.16 });
}

/** Enemy camps boxed in: a drum, then two horn notes rising. */
export function capture(count, loud = true) {
  note('capture', count, loud);
  if (!ensure()) return;
  const t = now(), k = quiet(loud);
  tone(90, t, { type: 'sine', peak: 0.5 * k, decay: 0.35, glideTo: 55 });
  hiss(t, { from: 400, to: 200, q: 0.8, peak: 0.15 * k, decay: 0.2, type: 'lowpass' });
  const horn = (freq, at) => {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400; f.connect(master);
    tone(freq, at, { type: 'sawtooth', peak: 0.12 * k, attack: 0.04, decay: 0.32, out: f });
  };
  horn(294, t + 0.12); horn(count > 1 ? 440 : 392, t + 0.3);
}

/** A charge: steel on steel. */
export function clash(loud = true) {
  note('clash', loud);
  if (!ensure()) return;
  const t = now(), k = quiet(loud);
  hiss(t, { from: 6000, to: 3000, q: 2, peak: 0.25 * k, decay: 0.18, type: 'highpass' });
  [1240, 1870, 2630, 3410].forEach((f, i) => tone(f, t, { type: 'sine', peak: (0.09 - i * 0.015) * k, decay: 0.5 - i * 0.08 }));
  hiss(t + 0.22, { from: 5000, to: 2600, q: 2, peak: 0.12 * k, decay: 0.12, type: 'highpass' });
}

/** The verdict a moment after the clash: a short fanfare, or a dull thud when they hold. */
export function verdict(won, loud = true) {
  note('verdict', won, loud);
  if (!ensure()) return;
  const t = now(), k = quiet(loud);
  if (won) [392, 494, 587].forEach((f, i) => tone(f, t + i * 0.09, { type: 'triangle', peak: 0.16 * k, attack: 0.01, decay: 0.28 }));
  else tone(110, t, { type: 'triangle', peak: 0.3 * k, decay: 0.25, glideTo: 70 });
}

/** A vote in the council or the ballot: a dry tick. */
export function tick() {
  note('tick');
  if (!ensure()) return;
  hiss(now(), { from: 2400, to: 1800, q: 6, peak: 0.12, decay: 0.05 });
}

/** Midnight: a low bell. */
export function bell() {
  note('bell');
  if (!ensure()) return;
  const t = now();
  [220, 441, 663, 884].forEach((f, i) => tone(f, t, { type: 'sine', peak: 0.16 / (i + 1), attack: 0.005, decay: 2.2 - i * 0.3 }));
}

/** Renders a list of sounds into an offline context, for a soundtrack: [{ name, args, at }] with `at` in seconds. */
export async function renderOffline(events, seconds, { sampleRate = 44100, withSea = false } = {}) {
  const was = { ctx, master, sea, enabled };
  ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  master = ctx.createGain(); master.gain.value = MASTER; master.connect(ctx.destination);
  enabled = true; offset = 0;
  if (withSea) startSea();
  const play = { build, capture, clash, verdict, tick, bell };
  for (const e of events) { offset = e.at; play[e.name](...e.args); }
  offset = 0;
  const out = await ctx.startRendering();
  ({ ctx, master, sea, enabled } = was);
  return out;
}
