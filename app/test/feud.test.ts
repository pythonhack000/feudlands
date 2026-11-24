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
import { LEGACY_DAY as FEUD_DAY } from '../src/shared/rules.ts';


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

const CATS = { day: 12, topic: 'cats-dogs', question: 'Cats or dogs?', sides: { a: 'Cats', b: 'Dogs' }, glyphs: null };
test('the results comment names the leader, the split and tomorrow', () => {
  const text = resultsComment({ feud: CATS, a: 30, b: 20, sworn: { a: 3, b: 2 }, general: { name: 'ann', hexes: 4 }, cry: { text: 'Meow', by: 'ann', side: 'a', hexes: 2 }, hexes: {} }, { question: 'Pineapple on pizza?' });
  assert.equal(text, '**Midnight, day 12: the cats hold the island, 60% to 40%** (30 hexes to 20).\n\n- General of the day: u/ann, 4 hexes taken\n- Cry of the day: \u201cMeow\u201d by u/ann, took 2 hexes\n- Sworn in: 3 for the cats, 2 for the dogs\n\nTomorrow\'s feud, picked by the council: **Pineapple on pizza?**');
  assert.match(resultsComment({ feud: CATS, a: 25, b: 25, sworn: { a: 1, b: 1 }, general: null, cry: null, hexes: {} }), /split, 50% to 50%/);
});

test('a post without a topic is the old cats or dogs feud, day 12', async () => {
  const info = await new Feud(memoryStore(), 'old', null, T0).info();
  assert.equal(info.question, 'Cats or dogs?'); assert.equal(info.day, 12);
});

test('a new feud fights over its own topic, with its own opening arguments', async () => {
  const store = memoryStore();
  await Feud.open(store, 'p2', 'pineapple', 13);
  const st = await new Feud(store, 'p2', 'ann', T0).state(0);
  assert.equal(st.feud.question, 'Pineapple on pizza?');
  assert.deepEqual(st.feud.sides, { a: 'Pineapples', b: 'Purists' });
  assert.equal(st.feud.day, 13);
  assert.ok(st.args.some((a) => a.text.startsWith('Sweet and salty')));
  assert.ok(st.args.filter((a) => a.parent).every((r) => st.args.find((a) => a.id === r.parent)!.side !== r.side));
  const r = await new Feud(store, 'p2', null, T0).results();
  assert.match(resultsComment(r), /^\*\*Midnight, day 13: /);
});

test('tomorrow\'s ballot: one vote each, movable, and the most votes wins', async () => {
  const store = memoryStore();
  const ann = new Feud(store, 'p', 'ann', T0), bob = new Feud(store, 'p', 'bob', T0), cy = new Feud(store, 'p', 'cy', T0);
  const { choices } = await ann.next();
  assert.equal(choices.length, 3);
  assert.ok(!choices.some((c) => c.id === 'cats-dogs'));
  assert.equal(await ann.winner(), choices[0].id); // nobody voted: the first choice
  await ann.voteNext(choices[2].id); await bob.voteNext(choices[2].id); await cy.voteNext(choices[1].id);
  assert.equal(await ann.winner(), choices[2].id);
  await ann.voteNext(choices[1].id); await ann.voteNext(choices[1].id);
  const after = await ann.next();
  assert.deepEqual(after.choices.map((c) => c.votes), [0, 2, 1]);
  assert.equal(after.mine, choices[1].id);
  assert.equal(await ann.winner(), choices[1].id);
  await assert.rejects(ann.voteNext('cats-dogs'), /ballot/);
  await assert.rejects(new Feud(store, 'p', null, T0).voteNext(choices[0].id), /Log in/);
});

test('a feud signs up for midnight the first time anyone opens it', async () => {
  const store = memoryStore();
  await new Feud(store, 't3_abc', null, T0).state(0);
  await new Feud(store, 't3_abc', null, T0 + 1).state(0);
  assert.deepEqual(await store.zRange('feud:posts', 0, Number.MAX_SAFE_INTEGER, { by: 'score' }), [{ member: 't3_abc', score: T0 }]);
});

import { flairText, resolveTopic } from '../src/server/feud.ts';

test('a player suggests a feud: cleaned, on the ballot with their vote, one per day', async () => {
  const store = memoryStore(), ann = new Feud(store, 'p', 'ann', T0);
  const id = await ann.suggest('  Socks with <b>sandals</b>  ', 'Yes', 'Never');
  const next = await ann.next();
  const mine = next.choices.find((c) => c.id === id)!;
  assert.equal(mine.question, 'Socks with bsandals/b?');
  assert.equal(mine.by, 'ann'); assert.equal(mine.votes, 1);
  assert.equal(next.mine, id); assert.equal(next.suggested, true);
  await assert.rejects(ann.suggest('Another one here?', 'A', 'B'), /already suggested/);
  const bob = new Feud(store, 'p', 'bob', T0);
  await assert.rejects(bob.suggest('Hi?', 'A', 'B'), /real question/);
  await assert.rejects(bob.suggest('Which is best?', 'Same', 'same'), /different names/);
  await assert.rejects(bob.suggest('Visit www.spam.com today?', 'A', 'B'), /No links/);
  await assert.rejects(bob.suggest('Is u/someone right?', 'A', 'B'), /No links/);
  await assert.rejects(new Feud(store, 'p', null, T0).suggest('Who wins this?', 'A', 'B'), /Log in/);
});

test('a suggested feud can win and become a post, credited to its author, with an empty council', async () => {
  const store = memoryStore(), ann = new Feud(store, 'p', 'ann', T0);
  const id = await ann.suggest('Socks with sandals?', 'Yes', 'Never');
  await new Feud(store, 'p', 'bob', T0).voteNext(id);
  assert.equal(await ann.winner(), id);
  await Feud.open(store, 'p2', id, 13);
  const st = await new Feud(store, 'p2', 'cy', T0).state(0);
  assert.equal(st.feud.question, 'Socks with sandals?');
  assert.equal(st.feud.by, 'ann');
  assert.deepEqual(st.feud.sides, { a: 'Yes', b: 'Never' });
  assert.equal(st.args.length, 0);
  for (let i = 1; i < 5; i++) await new Feud(store, 'p2', 'cy', T0 + i * BOT_TICK_MS).state(0); // the crowd still plays
  assert.equal((await resolveTopic(store, id)).by, 'ann');
  assert.match(resultsComment(await new Feud(store, 'p2', null, T0).results(), await resolveTopic(store, id)), /suggested by u\/ann/);
});

test('streaks count consecutive days, reset after a gap, and wins go to the winning side', async () => {
  const store = memoryStore();
  for (const [post, day] of [['d1', 1], ['d2', 2], ['d3', 3], ['d5', 5]] as const) await Feud.open(store, post, 'cats-dogs', day);
  const swear = (post: string) => new Feud(store, post, 'ann', T0).chooseSide('a');
  assert.equal((await swear('d1'))!.streak, 1);
  assert.equal(await swear('d1'), null); // same day, nothing new
  assert.equal((await swear('d2'))!.streak, 2);
  assert.equal((await swear('d3'))!.streak, 3);
  const gap = (await swear('d5'))!;
  assert.equal(gap.streak, 1); assert.equal(gap.best, 3);
  await new Feud(store, 'd5', 'bob', T0).chooseSide('b');
  const r = await new Feud(store, 'd5', null, T0).results();
  const winners = await new Feud(store, 'd5', null, T0).creditWinners({ ...r, a: 40, b: 30 });
  assert.deepEqual(winners.map((w) => w.name), ['ann']);
  assert.equal(winners[0].record.wins, 1);
  assert.deepEqual(await new Feud(store, 'd5', null, T0).creditWinners({ ...r, a: 30, b: 30 }), []);
  assert.equal(flairText(winners[0].record), 'Feudlands: 1 day at war, 1 win');
  assert.equal(flairText({ streak: 4, best: 4, wins: 0, lastDay: 9 }), 'Feudlands: 4 days at war');
  assert.equal((await new Feud(store, 'd5', 'ann', T0).state(0)).me.record?.wins, 1);
});
