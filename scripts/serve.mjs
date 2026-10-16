// Local development: http://localhost:8768/bingo/ — the page as CloudFront serves it, with the API running in-process on
// an in-memory store (games last until the server stops). No AWS needed.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler, useStore } from '../lambda/index.mjs';
import { memoryStore } from '../lambda/store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8768);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
useStore(memoryStore());

// What deploy/bingo-index.js does on CloudFront: /bingo/ and game links (/bingo/KPTZ) get the page
const pageFor = uri => (uri.endsWith('/') || !extname(uri) ? '/bingo/index.html' : uri);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/bingo/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const r = await handler({
      rawPath: url.pathname, requestContext: { http: { method: req.method } },
      headers: Object.fromEntries(Object.entries(req.headers)), body: chunks.length ? Buffer.concat(chunks).toString() : undefined,
    });
    res.writeHead(r.statusCode, r.headers).end(r.body);
    return;
  }
  if (url.pathname === '/' || url.pathname === '/bingo') return res.writeHead(301, { location: '/bingo/' }).end();
  if (!url.pathname.startsWith('/bingo/')) return res.writeHead(404).end('Not found');
  const rel = pageFor(url.pathname).slice('/bingo/'.length);
  // game.mjs lives with the Lambda; deploy/deploy.sh copies it to js/ for the site
  const file = rel === 'js/game.mjs' ? join(ROOT, 'lambda/game.mjs') : join(ROOT, 'public', normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      .end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(PORT, () => console.log(`Buzzword Bingo on http://localhost:${PORT}/bingo/`));
