import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';
import { api } from './api.ts';
import { Feud, POSTS_KEY, resultsComment } from './feud.ts';

const FEUD_TITLE = 'Feudlands: Cats or dogs? Pick a side and take the island';

/** Feuds older than this have had their midnight. */
const OPEN_FOR_MS = 36 * 60 * 60 * 1000;

async function postFeud(): Promise<string> {
  const post = await reddit.submitCustomPost({ title: FEUD_TITLE, entry: 'default' });
  await redis.zAdd(POSTS_KEY, { member: post.id, score: Date.now() });
  return post.id;
}

/** Pins the day's result under a feud, once. */
async function closeDay(postId: string): Promise<boolean> {
  const doneKey = `feud:${postId}:closed`;
  if (await redis.get(doneKey)) return false;
  const results = await new Feud(redis, postId, null).results();
  const comment = await reddit.submitComment({ id: postId as `t3_${string}`, text: resultsComment(results), runAs: 'APP' });
  await comment.distinguish(true);
  await redis.set(doneKey, comment.id);
  return true;
}

const postUrl = (postId: string) => `https://reddit.com/r/${context.subredditName}/comments/${postId}`;

const internal = new Hono();

internal.post('/menu/post-feud', async (c) => {
  try {
    const postId = await postFeud();
    return c.json<UiResponse>({ navigateTo: postUrl(postId) }, 200);
  } catch (error) {
    console.error('Could not post the feud', error);
    return c.json<UiResponse>({ showToast: 'Could not post the feud' }, 400);
  }
});

internal.post('/triggers/on-app-install', async (c) => {
  try {
    const postId = await postFeud();
    return c.json<TriggerResponse>({ status: 'success', message: `Feud posted as ${postId}` }, 200);
  } catch (error) {
    console.error('Could not post the first feud', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'Could not post the first feud' }, 400);
  }
});

internal.post('/scheduler/midnight', async (c) => {
  const since = Date.now() - OPEN_FOR_MS;
  const posts = await redis.zRange(POSTS_KEY, since, Date.now(), { by: 'score' });
  let closed = 0;
  for (const { member: postId } of posts) {
    try { if (await closeDay(postId)) closed++; }
    catch (error) { console.error(`Could not close the day for ${postId}`, error); }
  }
  return c.json({ status: 'ok', closed }, 200);
});

internal.post('/menu/close-day', async (c) => {
  const postId = context.postId;
  if (!postId) return c.json<UiResponse>({ showToast: 'Use this on a feud post' }, 400);
  try {
    const done = await closeDay(postId);
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
  commentAsUser: async (postId, text) => {
    await reddit.submitComment({ id: postId as `t3_${string}`, text, runAs: 'USER' });
  },
}));

serve({ fetch: app.fetch, createServer, port: getServerPort() });
