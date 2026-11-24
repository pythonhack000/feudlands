// The game's HTTP API. Every route answers with the same envelope: { ok, data } or { ok, error }.
import { Hono, type Context } from 'hono';
import type { Envelope } from '../shared/rules.ts';
import { Feud, FeudError, type Store } from './feud.ts';

export interface ApiDeps {
  store: Store;
  postId(): string | undefined;
  /** Who is asking. Devvit knows from its own context; the local war reads a cookie. */
  username(c: Context): Promise<string | null>;
}

export function api(deps: ApiDeps): Hono {
  const app = new Hono();

  const handle = <T>(work: (feud: Feud, body: Record<string, unknown>, c: Context) => Promise<T>) => async (c: Context) => {
    try {
      const post = deps.postId();
      if (!post) throw new FeudError('Open the feud from its post', 404);
      const body = c.req.method === 'POST' ? await readBody(c) : {};
      const feud = new Feud(deps.store, post, await deps.username(c));
      return c.json<Envelope<T>>({ ok: true, data: await work(feud, body, c) });
    } catch (error) {
      if (error instanceof FeudError) return c.json<Envelope<T>>({ ok: false, error: error.message }, error.status);
      console.error('Feud request failed', error);
      return c.json<Envelope<T>>({ ok: false, error: 'The war server stumbled. Try again.' }, 500);
    }
  };
  const after = (c: Context) => Math.max(0, Number.parseInt(c.req.query('after') ?? '0', 10) || 0);

  app.get('/state', handle((feud, _body, c) => feud.state(after(c))));
  app.post('/side', handle(async (feud, body, c) => { await feud.chooseSide(body.side); return feud.state(after(c)); }));
  app.post('/build', handle(async (feud, body, c) => { await feud.build(body.kind, body.q, body.r); return feud.state(after(c)); }));
  app.post('/charge', handle(async (feud, body, c) => { await feud.charge(body.q, body.r, body.cry ?? null); return feud.state(after(c)); }));
  app.post('/argue', handle(async (feud, body, c) => ({ id: await feud.argue(body.text, body.parent ?? null), state: await feud.state(after(c)) })));
  app.post('/vote', handle(async (feud, body, c) => { await feud.vote(body.id, body.dir); return feud.state(after(c)); }));

  return app;
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through to the error below
  }
  throw new FeudError('Bad request');
}
