import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { companionHelp, parseCompanionArguments } from './cli-options.js';
import { createServer } from './server.js';
import { companionVersion } from './version.js';

function openBrowser(url: string): void {
  if (process.env.DUSORI_NO_OPEN === '1') return;
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const arguments_ = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(command, arguments_, { detached: true, stdio: 'ignore' }).unref();
}

function validSessionToken(value: string): boolean {
  if (!/^\S{32,512}$/u.test(value)) return false;
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

const options = parseCompanionArguments(process.argv.slice(2));
if (options.kind === 'help') {
  process.stdout.write(companionHelp);
} else if (options.kind === 'version') {
  process.stdout.write(`${companionVersion}\n`);
} else {
  const configuredToken = process.env.DUSORI_SESSION_TOKEN?.trim();
  if (options.apiOnly && !configuredToken) {
    throw new Error('DUSORI_SESSION_TOKEN is required for --api-only.');
  }
  if (options.apiOnly && options.allowedOrigins.length === 0) {
    throw new Error('Provide at least one exact --origin for --api-only.');
  }
  if (configuredToken && !validSessionToken(configuredToken)) {
    throw new Error('DUSORI_SESSION_TOKEN must be 32-512 non-space characters.');
  }
  const token = configuredToken ?? randomBytes(32).toString('base64url');
  const server = await createServer({
    ...(options.allowedOrigins.length > 0 ? { allowedOrigins: options.allowedOrigins } : {}),
    root: options.root ? resolve(options.root) : undefined,
    serveStatic: !options.apiOnly,
    token,
  });

  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (!address || typeof address === 'string')
    throw new Error('Dusori could not obtain a loopback port.');
  const url = `http://127.0.0.1:${address.port}/`;

  if (options.apiOnly) {
    process.stdout.write(
      `DUSORI_READY ${JSON.stringify({ apiVersion: 1, host: '127.0.0.1', port: address.port })}\n`,
    );
  } else {
    process.stdout.write(`Dusori is running for this terminal session.\n${url}\n`);
  }
  if (!options.root && !options.apiOnly) {
    process.stdout.write(
      'Folder access is off. Restart with --root /path/to/Dusori to enable it.\n',
    );
  }
  if (!options.apiOnly) openBrowser(url);

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await server.close();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void close());
  process.once('SIGTERM', () => void close());
  process.once('SIGHUP', () => void close());
}
