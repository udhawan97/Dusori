import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dusori-package-'));

try {
  await execute('pnpm', ['--filter', 'dusori', 'pack', '--pack-destination', temporaryDirectory], {
    cwd: repositoryRoot,
  });
  const tarballName = (await readdir(temporaryDirectory)).find((name) => name.endsWith('.tgz'));
  if (!tarballName) throw new Error('pnpm pack did not produce a companion tarball.');
  const tarball = join(temporaryDirectory, tarballName);
  const help = await execute(
    'npm',
    ['exec', '--yes', '--package', tarball, '--', 'dusori', '--help'],
    { cwd: temporaryDirectory },
  );
  if (!help.stdout.includes('npx dusori --root /path/to/Dusori')) {
    throw new Error('The packed companion did not expose the expected help command.');
  }
  const version = await execute(
    'npm',
    ['exec', '--yes', '--package', tarball, '--', 'dusori', '--version'],
    { cwd: temporaryDirectory },
  );
  process.stdout.write(`Packed CLI smoke passed for dusori ${version.stdout.trim()}.\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
