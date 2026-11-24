import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Feud, BOT_TICK_MS, BOT_MOVES_PER_DAY } from '../src/server/feud.ts';
import { memoryStore } from '../src/server/memoryStore.ts';

const T0 = 1_000_000 * BOT_TICK_MS;

test('two players see the same log in the same order', async () => {
  const store = memoryStore();
  await new Feud(store, 'p', 'ann', T0).chooseSide('a');
  await new Feud(store, 'p', 'bob', T0).chooseSide('b');
  await new Feud(store, 'p', 'ann', T0).build('camp', 1, 2);
  await new Feud(store, 'p', 'bob', T0).build('tower', -1, 0);
  const ann = await new Feud(store, 'p', 'ann', T0).state(0);
  const bob = await new Feud(store, 'p', 'bob', T0).state(0);
  const real = (s: typeof ann) => s.moves.filter((m) => m.t !== 'bot').map((m) => [m.by, m.side, m.t]);
  assert.deepEqual(real(ann), [['ann', 'a', 'build'], ['bob', 'b', 'build']]);
  assert.deepEqual(ann.moves.map((m) => m.seq), bob.moves.map((m) => m.seq));
  assert.equal(ann.me.side, 'a');
  assert.equal(bob.here, 2); // ann and bob both looked in
});

test('only moves after the given seq come back', async () => {
  const store = memoryStore();
  const f = new Feud(store, 'p', 'ann', T0);
  await f.chooseSide('a'); await f.build('camp', 0, 0);
  const all = await f.state(0), last = all.moves.at(-1)!.seq;
  assert.equal((await f.state(last)).moves.length, 0);
});

test('a side, once picked, stays picked', async () => {
  const store = memoryStore(), f = new Feud(store, 'p', 'ann', T0);
  await f.chooseSide('a'); await f.chooseSide('b');
  assert.equal((await f.state(0)).me.side, 'a');
});

test('guests and fighters without a side cannot move', async () => {
  const store = memoryStore();
  await assert.rejects(new Feud(store, 'p', null, T0).build('camp', 0, 0), /Log in/);
  await assert.rejects(new Feud(store, 'p', 'ann', T0).build('camp', 0, 0), /Pick a side/);
});

test('rejects bad pieces, hexes off the map and too many builds', async () => {
  const store = memoryStore(), f = new Feud(store, 'p', 'ann', T0);
  await f.chooseSide('a');
  await assert.rejects(f.build('castle', 0, 0), /Unknown piece/);
  await assert.rejects(f.build('camp', 99, 0), /off the map/);
  await assert.rejects(f.build('camp', 0.5, 0), /off the map/);
  for (let i = 0; i < 6; i++) await f.build('camp', i, 0);
  await assert.rejects(f.build('camp', 7, 0), /all you get/);
});

test('a charge carries its cry power, cut by the best rebuttal', async () => {
  const store = memoryStore();
  const ann = new Feud(store, 'p', 'ann', T0); await ann.chooseSide('a');
  const st = await ann.state(0); // seeds the council: s1 has 48 votes, its rebuttal s7 has 26
  assert.ok(st.args.length >= 10);
  await ann.charge(0, 0, 's1');
  const charge = (await ann.state(0)).moves.find((m) => m.t === 'charge');
  assert.ok(charge && charge.t === 'charge');
  assert.equal(charge.cry?.power, 1); // floor(48/20) - floor(26/20) = 2 - 1
  await assert.rejects(ann.charge(0, 0, 's2'), /own side/);
});

test('votes toggle and never count twice', async () => {
  const store = memoryStore(), f = new Feud(store, 'p', 'ann', T0);
  await f.chooseSide('a');
  const before = (await f.state(0)).args.find((a) => a.id === 's5')!.votes;
  await f.vote('s5', 1); await f.vote('s5', 1);
  assert.equal((await f.state(0)).args.find((a) => a.id === 's5')!.votes, before + 1);
  await f.vote('s5', -1);
  const st = await f.state(0);
  assert.equal(st.args.find((a) => a.id === 's5')!.votes, before - 1);
  assert.equal(st.myVotes.s5, -1);
});

test('arguments are cleaned, and rebuttals only answer the other side', async () => {
  const store = memoryStore(), f = new Feud(store, 'p', 'ann', T0);
  await f.chooseSide('a');
  const id = await f.argue('  <b>Cats</b> rule  ', null);
  const mine = (await f.state(0)).args.find((a) => a.id === id)!;
  assert.equal(mine.text, 'bCats/b rule'); assert.equal(mine.votes, 1);
  await assert.rejects(f.argue('', null), /Write something/);
  await assert.rejects(f.argue('no', 's1'), /other side/);
  assert.ok(await f.argue('yes', 's2'));
});

test('the crowd moves once per tick however many people watch, and stops for the day', async () => {
  const store = memoryStore();
  await new Feud(store, 'p', 'ann', T0).state(0);
  await new Feud(store, 'p', 'bob', T0 + 10).state(0);
  let st = await new Feud(store, 'p', 'ann', T0 + 20).state(0);
  assert.equal(st.moves.filter((m) => m.t === 'bot').length, 1);
  for (let i = 1; i <= BOT_MOVES_PER_DAY + 5; i++) st = await new Feud(store, 'p', 'ann', T0 + i * BOT_TICK_MS).state(0);
  assert.equal(st.moves.filter((m) => m.t === 'bot').length, BOT_MOVES_PER_DAY);
  assert.equal(st.quiet, true);
});

import { resultsComment } from '../src/server/feud.ts';
import { isFree, makeIsland, tallyDay, wouldCapture } from '../src/shared/island.ts';
import { FEUD_DAY } from '../src/shared/rules.ts';


test('the crowd plays the same day the same way every time', async () => {
  const store = memoryStore();
  for (let i = 0; i < 30; i++) await new Feud(store, 'p', 'ann', T0 + i * BOT_TICK_MS).state(0);
  const { moves } = await new Feud(store, 'p', 'ann', T0).state(0);
  assert.deepEqual(tallyDay(FEUD_DAY, moves), tallyDay(FEUD_DAY, [...moves].reverse()));
  const day = tallyDay(FEUD_DAY, moves);
  assert.ok(day.a > 0 && day.b > 0);
});

test('results credit real players only, never the demo crowd', async () => {
  const store = memoryStore(), ann = new Feud(store, 'p', 'ann', T0);
  await ann.chooseSide('a');
  for (let i = 1; i < 20; i++) await new Feud(store, 'p', 'bob', T0 + i * BOT_TICK_MS).state(0);
  const r = await ann.results();
  assert.equal(r.general, null);
  assert.equal(r.cry, null); // the seeded arguments belong to the crowd
  assert.deepEqual(r.sworn, { a: 1, b: 0 });
  const text = resultsComment(r);
  assert.match(text, /^\*\*Midnight, day 12: /);
  assert.doesNotMatch(text, /u\/(quietfox|tea_and_maps|oldsalt)/);
});

test('share refuses a fighter with nothing taken, and only brags once', async () => {
  const store = memoryStore(), ann = new Feud(store, 'p', 'ann', T0);
  await ann.chooseSide('b');
  await assert.rejects(ann.shareLine(), /Take a hex first/);
  // The morning leaves a cats' camp the dogs can box in with one camp.
  const island = makeIsland(FEUD_DAY);
  const boxIn = [...island.values()].find((c) => isFree(c) && wouldCapture(island, c, 'b') > 0)!;
  await ann.build('camp', boxIn.q, boxIn.r);
  assert.ok((await ann.results()).hexes.ann > 0);
  const line = await ann.shareLine();
  assert.match(line, /Feudlands, day 12$/);
  await assert.rejects(ann.shareLine(), /already shared/);
  await ann.unshare();
  assert.equal(await ann.shareLine(), line);
});

test('the results comment names the leader and the split', () => {
  const text = resultsComment({ a: 30, b: 20, sworn: { a: 3, b: 2 }, general: { name: 'ann', hexes: 4 }, cry: { text: 'Meow', by: 'ann', side: 'a', hexes: 2 }, hexes: {} });
  assert.equal(text, '**Midnight, day 12: the cats hold the island, 60% to 40%** (30 hexes to 20).\n\n- General of the day: u/ann, 4 hexes taken\n- Cry of the day: “Meow” by u/ann, took 2 hexes\n- Sworn in: 3 for the cats, 2 for the dogs');
  assert.match(resultsComment({ a: 25, b: 25, sworn: { a: 1, b: 1 }, general: null, cry: null, hexes: {} }), /split, 50% to 50%/);
});
