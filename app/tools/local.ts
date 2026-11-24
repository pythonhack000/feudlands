// Plays the built game locally against an in-memory war, no Reddit needed.
// npm run build && node tools/local.ts   then open http://localhost:5190/game.html
// The `as` cookie picks who you are, so two browser profiles can fight each other.
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { api } from '../src/server/api.ts';
import { memoryStore } from '../src/server/memoryStore.ts';
import { Feud, resultsComment } from '../src/server/feud.ts';
import { topicById } from '../src/shared/topics.ts';

const PORT = Number(process.env.PORT ?? 5190);
const store = memoryStore();
const app = new Hono();
app.route('/api', api({
  store,
  postId: () => 'local',
  username: async (c) => getCookie(c, 'as') ?? 'local_player',
  commentAsUser: async (postId, text) => { console.log(`[comment on ${postId}] ${text}`); },
}));
app.use('/*', serveStatic({ root: './dist/client' }));

const local = () => new Feud(store, 'local', null);
app.get('/local/results', async (c) => c.text(resultsComment(await local().results(), topicById(await local().winner()).question)));
// Switch the local feud's topic before anyone opens it: /local/open?topic=pineapple&day=13
app.get('/local/open', async (c) => { await Feud.open(store, 'local', c.req.query('topic') ?? 'cats-dogs', Number(c.req.query('day') ?? 1)); return c.text('ok'); });

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Feudlands local war on http://localhost:${PORT}/game.html`));
