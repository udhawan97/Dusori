import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { appBasePath } from '../../../config/site.mjs';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const packageManifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
const repositoryManifest = JSON.parse(
  await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
);
const versionSource = await readFile(resolve(packageRoot, 'src/version.ts'), 'utf8');
const sourceVersion = /companionVersion\s*=\s*'([^']+)'/u.exec(versionSource)?.[1];

if (
  packageManifest.version !== repositoryManifest.version ||
  packageManifest.version !== sourceVersion
) {
  throw new Error(
    `Version mismatch: root=${repositoryManifest.version}, package=${packageManifest.version}, runtime=${sourceVersion ?? 'missing'}`,
  );
}

const cliPath = resolve(packageRoot, 'dist/cli.js');
const appPath = resolve(packageRoot, `public${appBasePath}/index.html`);
const serviceWorkerPath = resolve(packageRoot, `public${appBasePath}/service-worker.js`);
await Promise.all([access(cliPath), access(appPath), access(serviceWorkerPath)]);
if (!(await readFile(cliPath, 'utf8')).startsWith('#!/usr/bin/env node')) {
  throw new Error('The packaged CLI is missing its Node.js executable header.');
}

process.stdout.write(
  `Companion package ${packageManifest.version} is version-aligned and contains its CLI, app shell, and service worker.\n`,
);
