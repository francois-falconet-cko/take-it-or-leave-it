#!/usr/bin/env node
/**
 * Minimal static file server for the sandbox image.
 * Uses only Node builtins — no npm install at image-build time (air-gapped).
 *
 * Usage: node static-server.mjs [rootDir]
 * Listens on PORT (default 3000). GET / returns 200 when index.html exists.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'out'));
const port = Number(process.env.PORT || 3000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0]);
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(base, cleaned);
  if (!full.startsWith(base)) return null;
  return full;
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': status === 200 ? 'public, max-age=60' : 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  let filePath = safeJoin(root, req.url || '/');
  if (!filePath) {
    send(res, 400, 'Bad Request');
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    send(res, 404, 'Not Found');
    return;
  }

  if (stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      send(res, 404, 'Not Found');
      return;
    }
  }

  const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'public, max-age=60',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath)
    .on('error', () => {
      if (!res.headersSent) send(res, 500, 'Error');
      else res.destroy();
    })
    .pipe(res);
});

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`Missing ${path.join(root, 'index.html')} — run npm run build:static first.`);
  process.exit(1);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Serving ${root} on http://0.0.0.0:${port}`);
});
