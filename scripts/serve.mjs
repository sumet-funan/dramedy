// Minimal static server for previewing the site locally, using only Node itself.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
};

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const file = normalize(join(ROOT, pathname === '/' ? 'index.html' : decodeURIComponent(pathname)));

  try {
    if (!file.startsWith(ROOT)) throw new Error('Outside the site');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/?demo`));
