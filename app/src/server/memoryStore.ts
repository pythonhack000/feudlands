// An in-memory Store for local runs and tests. Same behaviour as the Redis calls the game uses.
import type { Store } from './feud.ts';

export function memoryStore(): Store {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  const zset = (key: string) => zsets.get(key) ?? zsets.set(key, new Map()).get(key)!;
  return {
    async get(key) { return strings.get(key); },
    async set(key, value) { strings.set(key, value); return 'OK'; },
    async incrBy(key, value) { const n = Number(strings.get(key) ?? 0) + value; strings.set(key, String(n)); return n; },
    async zAdd(key, ...members) { members.forEach(({ member, score }) => zset(key).set(member, score)); return members.length; },
    async zRange(key, start, stop) {
      return [...zset(key)].filter(([, s]) => s >= start && s <= stop).sort((x, y) => x[1] - y[1]).map(([member, score]) => ({ member, score }));
    },
    async hGet(key, field) { return hash(key).get(field); },
    async hSet(key, values) { Object.entries(values).forEach(([f, v]) => hash(key).set(f, v)); return Object.keys(values).length; },
    async hSetNX(key, field, value) { if (hash(key).has(field)) return 0; hash(key).set(field, value); return 1; },
    async hGetAll(key) { return Object.fromEntries(hash(key)); },
    async hIncrBy(key, field, value) { const n = Number(hash(key).get(field) ?? 0) + value; hash(key).set(field, String(n)); return n; },
  };
}
