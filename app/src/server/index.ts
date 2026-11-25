import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, media, reddit, redis, RichTextBuilder } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { api } from './api.ts';
import {
  ballotNotice, creditMaker, crownGeneral, endsWeek, Feud, flairText, POSTS_KEY, resolveTopic, resultsComment, weekBoard, weekMapPng, weekPost,
} from './feud.ts';
import { DEFAULT_TOPIC, type Topic } from '../shared/topics.ts';
import { weekOf, type FighterRecord, type WeekRow } from '../shared/rules.ts';

/** Feuds older than this have had their midnight. */
const OPEN_FOR_MS = 36 * 60 * 60 * 1000;
const DAILY_KEY = 'feud:daily';

const titleOf = (topic: Topic, day: number) =>
  `Feudlands, day ${day}: ${topic.question} Pick a side and take the island${topic.by ? ` (feud suggested by u/${topic.by})` : ''}`;

/** Shows a fighter's run next to their name. Flair is a bonus: a subreddit without user flair must not break the game. */
async function setFlair(username: string, record: FighterRecord): Promise<void> {
  try {
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    await reddit.setUserFlair({ subredditName, username, text: flairText(record) });
  } catch (error) {
    console.error(`Could not set flair for ${username}`, error);
  }
}

/** The latest feud post, which holds tomorrow's ballot. */
async function newestFeud(): Promise<string | null> {
  const posts = await redis.zRange(POSTS_KEY, 0, Number.MAX_SAFE_INTEGER, { by: 'score' });
  return posts.at(-1)?.member ?? null;
}

/** What to post next: the latest feud's ballot winner, one day later. The very first feud is cats or dogs, day 1. */
async function nextFeud(): Promise<{ topic: string; day: number }> {
  const newest = await newestFeud();
  if (!newest) return { topic: DEFAULT_TOPIC.id, day: 1 };
  const feud = new Feud(redis, newest, null);
  return { topic: await feud.winner(), day: (await feud.info()).day + 1 };
}

async function postFeud(topic: string, day: number): Promise<string> {
  const chosen = await resolveTopic(redis, topic);
  const post = await reddit.submitCustomPost({ title: titleOf(chosen, day), entry: 'default' });
  await Feud.open(redis, post.id, topic, day);
  await redis.zAdd(POSTS_KEY, { member: post.id, score: Date.now() });
  const maker = await creditMaker(redis, chosen, day);
  if (maker) await setFlair(maker.name, maker.record);
  return post.id;
}

/** Pins the day's result under a feud, once. */
async function closeDay(postId: string, tomorrow: Topic | null): Promise<boolean> {
  const doneKey = `feud:${postId}:closed`;
  if (await redis.get(doneKey)) return false;
  const feud = new Feud(redis, postId, null), results = await feud.results();
  const text = resultsComment(results, tomorrow);
  const comment = await submitWithMap(postId, text, feud);
  await comment.distinguish(true);
  await redis.set(doneKey, comment.id);
  await feud.remember(results);
  const winners = await feud.creditWinners(results);
  for (const { name, record } of winners) await setFlair(name, record);
  await feud.addToWeek(results, winners.map((w) => w.name));
  if (endsWeek(results.feud.day)) await postWeek(weekOf(results.feud.day));
  return true;
}

/**
 * The results comment with the day replayed as a GIF under the headline: the front moving from morning to midnight.
 * If the animation fails it falls back to a still map, and then to the words alone.
 */
async function submitWithMap(postId: string, text: string, feud: Feud) {
  const id = postId as `t3_${string}`;
  try {
    const { mediaUrl } = await media.upload({ url: `data:image/gif;base64,${(await feud.dayGif()).toString('base64')}`, type: 'gif' });
    return await reddit.submitComment({ id, richtext: markdownToRichtext(text, { mediaUrl, animated: true }), runAs: 'APP' });
  } catch (error) {
    console.error('Could not attach the day\u2019s animation, trying a still map', error);
  }
  try {
    const mediaUrl = await uploadPng(await feud.mapPng());
    return await reddit.submitComment({ id, richtext: markdownToRichtext(text, { mediaUrl, animated: false }), runAs: 'APP' });
  } catch (error) {
    console.error('Could not attach the map, posting the results without it', error);
    return reddit.submitComment({ id, text, runAs: 'APP' });
  }
}

/** Puts a PNG on Reddit's media host and returns its URL. */
async function uploadPng(png: Buffer): Promise<string> {
  const { mediaUrl } = await media.upload({ url: `data:image/png;base64,${png.toString('base64')}`, type: 'image' });
  return mediaUrl;
}

/** Turns the results Markdown (a bold headline, a list, a closing line) into rich text with the map after the headline. */
function markdownToRichtext(text: string, map: { mediaUrl: string; animated: boolean }): RichTextBuilder {
  const plainText = (line: string) => line.replace(/\*\*/g, '');
  const [head, ...rest] = text.split('\n');
  const items = rest.filter((l) => l.startsWith('- ')).map((l) => plainText(l.slice(2)));
  const after = rest.filter((l) => l.trim() && !l.startsWith('- '));
  const rt = new RichTextBuilder().heading({ level: 3 }, (h) => { h.rawText(plainText(head)); });
  if (map.animated) rt.animatedImage({ mediaUrl: map.mediaUrl, caption: 'The day on the island, morning to midnight' });
  else rt.image({ mediaUrl: map.mediaUrl, caption: 'The island at midnight' });
  if (items.length) rt.list({ ordered: false }, (list) => { items.forEach((item) => list.item((li) => { li.paragraph((p) => { p.text({ text: item }); }); })); });
  after.forEach((line) => rt.paragraph((p) => { p.text({ text: plainText(line) }); }));
  return rt;
}

/** The weekly post with the week's islands in a grid. If the picture fails, the table still goes up. */
async function submitWeek(subredditName: string, title: string, body: string, week: number, board: WeekRow[]) {
  try {
    const grid = await weekMapPng(redis, week);
    if (!grid) throw new Error('No closed days this week');
    const mediaUrl = await uploadPng(grid);
    const richtext = new RichTextBuilder()
      .paragraph((p) => { p.text({ text: 'Seven feuds, seven islands. Here is how the front moved this week, day by day.' }); })
      .image({ mediaUrl, caption: `Week ${week}, one island per day, in order` })
      .heading({ level: 3 }, (h) => { h.rawText('The generals'); })
      .list({ ordered: true }, (list) => {
        board.forEach((r) => list.item((li) => { li.paragraph((p) => { p.text({ text: `u/${r.name}: ${r.hexes} ${r.hexes === 1 ? 'hex' : 'hexes'} taken, ${r.wins} ${r.wins === 1 ? 'day' : 'days'} won` }); }); }));
      })
      .paragraph((p) => { p.text({ text: `u/${board[0].name} is General of week ${week}. A new week starts at the next feud.` }); });
    return await reddit.submitPost({ subredditName, title, richtext });
  } catch (error) {
    console.error('Could not post the week with its map, posting the table alone', error);
    return reddit.submitPost({ subredditName, title, text: body });
  }
}

const WEEKS_POSTED_KEY = 'feud:weeks-posted';
/** The weekly table of generals, once per week, and the General's flair. */
async function postWeek(week: number): Promise<void> {
  if (!(await redis.hSetNX(WEEKS_POSTED_KEY, String(week), 'posting'))) return;
  try {
    const board = await weekBoard(redis, week);
    if (!board.length) return; // nobody real fought: no table of bots
    const { title, body } = weekPost(week, board);
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    const post = await submitWeek(subredditName, title, body, week, board);
    await redis.hSet(WEEKS_POSTED_KEY, { [String(week)]: post.id });
    await setFlair(board[0].name, await crownGeneral(redis, board[0].name, week));
  } catch (error) {
    await redis.hDel(WEEKS_POSTED_KEY, [String(week)]);
    console.error(`Could not post week ${week}`, error);
  }
}

async function isModerator(username: string): Promise<boolean> {
  try {
    const subredditName = context.subredditName ?? (await reddit.getCurrentSubreddit()).name;
    return (await reddit.getModerators({ subredditName, username }).all()).length > 0;
  } catch (error) {
    console.error(`Could not check whether ${username} moderates`, error);
    return false;
  }
}

const postUrl = (postId: string) => `https://reddit.com/r/${context.subredditName}/comments/${postId}`;

const internal = new Hono();

internal.post('/menu/post-feud', async (c) => {
  try {
    const { topic, day } = await nextFeud();
    const postId = await postFeud(topic, day);
    return c.json<UiResponse>({ navigateTo: postUrl(postId) }, 200);
  } catch (error) {
    console.error('Could not post the feud', error);
    return c.json<UiResponse>({ showToast: 'Could not post the feud' }, 400);
  }
});

internal.post('/triggers/on-app-install', async (c) => {
  try {
    const { topic, day } = await nextFeud();
    const postId = await postFeud(topic, day);
    return c.json<TriggerResponse>({ status: 'success', message: `Feud posted as ${postId}` }, 200);
  } catch (error) {
    console.error('Could not post the first feud', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'Could not post the first feud' }, 400);
  }
});

// Midnight: pin the results under every open feud, then post tomorrow's feud, the one the council voted for.
internal.post('/scheduler/midnight', async (c) => {
  const now = Date.now(), newest = await newestFeud(), plan = await nextFeud();
  const posts = await redis.zRange(POSTS_KEY, now - OPEN_FOR_MS, now, { by: 'score' });
  let closed = 0;
  for (const { member: postId } of posts) {
    try { if (await closeDay(postId, postId === newest ? await resolveTopic(redis, plan.topic) : null)) closed++; }
    catch (error) { console.error(`Could not close the day for ${postId}`, error); }
  }
  // One new feud per UTC date, even if the task fires twice.
  const date = new Date(now).toISOString().slice(0, 10);
  let posted: string | null = null;
  if (await redis.hSetNX(DAILY_KEY, date, 'posting')) {
    try {
      posted = await postFeud(plan.topic, plan.day);
      await redis.hSet(DAILY_KEY, { [date]: posted });
    } catch (error) {
      await redis.hDel(DAILY_KEY, [date]);
      console.error('Could not post tomorrow\u2019s feud', error);
    }
  }
  return c.json({ status: 'ok', closed, posted }, 200);
});

// 23:00 UTC: if a player's suggestion is about to become tomorrow's post, tell the moderators while they can still stop it.
internal.post('/scheduler/ballot-check', async (c) => {
  try {
    const newest = await newestFeud();
    if (!newest) return c.json({ status: 'ok', notified: false }, 200);
    const { choices } = await new Feud(redis, newest, null).next();
    const leader = choices.reduce((best, x) => (x.votes > best.votes ? x : best));
    if (!leader.by) return c.json({ status: 'ok', notified: false }, 200);
    const notice = ballotNotice(await resolveTopic(redis, leader.id), leader.votes, postUrl(newest));
    const subredditId = (await reddit.getCurrentSubreddit()).id;
    await reddit.modMail.createModNotification({ subject: notice.subject, bodyMarkdown: notice.body, subredditId });
    return c.json({ status: 'ok', notified: true }, 200);
  } catch (error) {
    console.error('Could not check tomorrow\u2019s ballot', error);
    return c.json({ status: 'error' }, 500);
  }
});

internal.post('/menu/close-day', async (c) => {
  const postId = context.postId;
  if (!postId) return c.json<UiResponse>({ showToast: 'Use this on a feud post' }, 400);
  try {
    const done = await closeDay(postId, postId === (await newestFeud()) ? await resolveTopic(redis, (await nextFeud()).topic) : null);
    return c.json<UiResponse>({ showToast: done ? 'Results pinned under the feud' : 'This feud already has its results' }, 200);
  } catch (error) {
    console.error('Could not close the day', error);
    return c.json<UiResponse>({ showToast: 'Could not post the results' }, 400);
  }
});

const app = new Hono();
app.route('/internal', internal);
app.route('/api', api({
  store: redis,
  postId: () => context.postId,
  username: async () => (await reddit.getCurrentUsername()) ?? null,
  setFlair,
  isModerator,
  commentAsUser: async (postId, text, map) => {
    const id = postId as `t3_${string}`;
    if (map) {
      try {
        const mediaUrl = await uploadPng(map);
        const richtext = new RichTextBuilder().paragraph((p) => { p.text({ text }); }).image({ mediaUrl, caption: 'The island right now' });
        await reddit.submitComment({ id, richtext, runAs: 'USER' });
        return;
      } catch (error) {
        console.error('Could not share with the map, sharing the line alone', error);
      }
    }
    await reddit.submitComment({ id, text, runAs: 'USER' });
  },
}));

serve({ fetch: app.fetch, createServer, port: getServerPort() });
