// Node preload: resolves Reddit domains over DNS-over-HTTPS (Cloudflare).
// Some networks answer Reddit DNS queries with 127.0.0.1; this lets the
// Devvit CLI reach Reddit without changing system DNS settings.
// Usage: NODE_OPTIONS="--require ./tools/reddit-dns.cjs" npx devvit login
const dns = require('node:dns');
const https = require('node:https');

const REDDIT_HOST = /(^|\.)(reddit\.com|redd\.it|redditmedia\.com|redditstatic\.com)$/i;
const DOH_IP = '1.1.1.1';
const cache = new Map();
const originalLookup = dns.lookup;

function resolveOverHttps(hostname) {
  if (cache.has(hostname)) return cache.get(hostname);
  const pending = new Promise((resolve, reject) => {
    const request = https.get(
      {
        host: DOH_IP,
        servername: 'cloudflare-dns.com',
        path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        headers: { accept: 'application/dns-json', host: 'cloudflare-dns.com' },
        timeout: 8000,
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => (body += chunk));
        response.on('end', () => {
          try {
            const answers = (JSON.parse(body).Answer || []).filter((answer) => answer.type === 1);
            if (answers.length === 0) throw new Error(`No A record for ${hostname}`);
            resolve(answers.map((answer) => answer.data));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on('timeout', () => request.destroy(new Error(`DNS-over-HTTPS timed out for ${hostname}`)));
    request.on('error', reject);
  });
  cache.set(hostname, pending);
  pending.catch(() => cache.delete(hostname));
  return pending;
}

dns.lookup = function lookup(hostname, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'object' && options !== null ? options : typeof options === 'number' ? { family: options } : {};
  if (typeof hostname !== 'string') return originalLookup.call(dns, hostname, options, callback);
  if (!REDDIT_HOST.test(hostname)) {
    // Other hosts go through the system first; if it can't find them (Reddit's asset bucket, for one), ask DoH.
    return originalLookup.call(dns, hostname, opts, (error, ...rest) => {
      if (!error || error.code !== 'ENOTFOUND') return done(error, ...rest);
      answerOverHttps(hostname, opts, done);
    });
  }
  answerOverHttps(hostname, opts, done);
};

function answerOverHttps(hostname, opts, done) {
  resolveOverHttps(hostname).then(
    (addresses) => {
      if (opts.all) done(null, addresses.map((address) => ({ address, family: 4 })));
      else done(null, addresses[0], 4);
    },
    (error) => done(error)
  );
}
