// Local workshop server: serves the site with the headers the in-browser model needs (multi-threading)
// and forwards /api to the online gallery. Usage: npm run atelier  (then open http://localhost:8080)
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = normalize(join(import.meta.dirname, '..'));
const PORT = Number(process.env.PORT || 8080);
const GALLERY = process.env.ATELIER_GALLERY || 'https://pixelgpt-iagora.vercel.app';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
  '.woff2': 'font/woff2', '.png': 'image/png', '.bin': 'application/octet-stream'
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'GET' ? undefined : Buffer.concat(await Array.fromAsync(req));
    try {
      const target = new URL(url.pathname + url.search, GALLERY);
      const upstream = await fetch(target, {
        method: req.method, body,
        headers: { 'content-type': req.headers['content-type'] ?? 'application/json', origin: target.origin,
          'x-gallery-password': req.headers['x-gallery-password'] ?? '' }
      });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'La galerie en ligne est injoignable (pas de connexion internet ?).' }));
    }
    return;
  }
  let path = url.pathname === '/' ? '/index.html' : url.pathname === '/galerie' ? '/galerie.html' : url.pathname;
  const file = normalize(join(ROOT, decodeURIComponent(path)));
  if (!file.startsWith(ROOT + '/') || /\/(node_modules|src|tools|api|\.)/.test(file.slice(ROOT.length))) {
    res.writeHead(404).end();
    return;
  }
  try {
    const { size } = statSync(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': size,
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache'
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Atelier pixel art IAgora : http://localhost:${PORT}`));
