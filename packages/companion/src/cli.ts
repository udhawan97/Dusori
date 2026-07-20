import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { createServer } from './server.js';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function openBrowser(url: string): void {
  if (process.env.DUSORI_NO_OPEN === '1') return;
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const arguments_ = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, arguments_, { detached: true, stdio: 'ignore' }).unref();
}

const rootArgument = argument('--root');
const token = randomBytes(32).toString('base64url');
const server = await createServer({
  root: rootArgument ? resolve(rootArgument) : undefined,
  token,
});

await server.listen({ host: '127.0.0.1', port: 0 });
const address = server.server.address();
if (!address || typeof address === 'string')
  throw new Error('Dusori could not obtain a loopback port.');
const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;

process.stdout.write(`Dusori is running for this terminal session.\n${url}\n`);
if (!rootArgument) {
  process.stdout.write('Folder access is off. Restart with --root /path/to/Dusori to enable it.\n');
}
openBrowser(url);

const close = async () => {
  await server.close();
  process.exit(0);
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
