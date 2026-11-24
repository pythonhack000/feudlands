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
