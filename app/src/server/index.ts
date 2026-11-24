import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { context, createServer, getServerPort, reddit } from '@devvit/web/server';
import type { TriggerResponse, UiResponse } from '@devvit/web/shared';

const FEUD_TITLE = 'Feudlands: Cats or dogs? Pick a side and take the island';

async function postFeud(): Promise<string> {
  const post = await reddit.submitCustomPost({ title: FEUD_TITLE, entry: 'default' });
  return post.id;
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

const app = new Hono();
app.route('/internal', internal);

serve({ fetch: app.fetch, createServer, port: getServerPort() });
