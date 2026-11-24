import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { api } from './api.ts';
import { ballotNotice, creditMaker, Feud, flairText, POSTS_KEY, resolveTopic, resultsComment } from './feud.ts';
import { DEFAULT_TOPIC, type Topic } from '../shared/topics.ts';
import type { FighterRecord } from '../shared/rules.ts';

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
  const comment = await reddit.submitComment({ id: postId as `t3_${string}`, text: resultsComment(results, tomorrow), runAs: 'APP' });
  await comment.distinguish(true);
  await redis.set(doneKey, comment.id);
  await feud.remember(results);
  for (const { name, record } of await feud.creditWinners(results)) await setFlair(name, record);
  return true;
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
  commentAsUser: async (postId, text) => {
    await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: 'USER' });
  },
}));

serve({ fetch: app.fetch, createServer, port: getServerPort() });
