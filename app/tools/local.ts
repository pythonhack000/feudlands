// Plays the built game locally against an in-memory war, no Reddit needed.
// npm run build && node tools/local.ts   then open http://localhost:5190/game.html
// The `as` cookie picks who you are, so two browser profiles can fight each other.
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { api } from '../src/server/api.ts';
import { memoryStore } from '../src/server/memoryStore.ts';

const PORT = Number(process.env.PORT ?? 5190);
const app = new Hono();
app.route('/api', api({
  store: memoryStore(),
  postId: () => 'local',
  username: async (c) => getCookie(c, 'as') ?? 'local_player',
}));
app.use('/*', serveStatic({ root: './dist/client' }));

serve({ fetch: app.fetch, port: PORT }, () => console.log(`Feudlands local war on http://localhost:${PORT}/game.html`));
