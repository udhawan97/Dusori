import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../dist/pages');
const port = Number(process.env.DUSORI_PREVIEW_PORT ?? 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

createServer(async (request, response) => {
  const requestPath = decodeURIComponent(
    new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname,
  );
  const withoutBase = requestPath.startsWith('/dusori/')
    ? requestPath.slice('/dusori'.length)
    : requestPath === '/dusori'
      ? '/'
      : requestPath;
  const candidate = normalize(join(root, withoutBase));
  if (!candidate.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  let file = candidate;
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    if (withoutBase.startsWith('/app/')) file = join(root, 'app/index.html');
    else file = join(root, '404.html');
  }

  response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Dusori preview: http://127.0.0.1:${port}/dusori/\n`);
});
