#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { appBasePath } from '../config/site.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const packageManifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
const pnpmVersion = packageManifest.packageManager?.match(/^pnpm@(.+)$/u)?.[1];
const companionCli = resolve(repositoryRoot, 'packages/companion/dist/cli.js');
const companionApp = resolve(repositoryRoot, `packages/companion/public${appBasePath}/index.html`);
const dependencyMarker = resolve(repositoryRoot, 'node_modules/.modules.yaml');

function printHelp() {
  process.stdout.write(`Dusori local setup

Usage:
  npm start                   Set up when needed, then open Dusori locally
  npm start -- --root <path>  Open Dusori with access to one workspace folder
  npm run setup               Install dependencies and build without starting

Requirements:
  Node.js 24 LTS. pnpm is downloaded at the repository-pinned version; no global
  pnpm installation or platform-specific setup script is needed.
`);
}

function requireSupportedNode() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (major === 24) return;

  throw new Error(
    `Dusori requires Node.js 24 LTS; this terminal is using ${process.version}. ` +
      'Install Node.js 24 from https://nodejs.org/en/download and run the command again.',
  );
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function run(command, arguments_, label) {
  process.stdout.write(`\n${label}\n`);

  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio: 'inherit',
    });

    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      rejectPromise(new Error(`${label} failed with ${outcome}.`));
    });
  });
}

function pnpmArguments(arguments_) {
  if (!pnpmVersion) throw new Error('package.json must pin packageManager to pnpm@<version>.');
  return ['exec', '--yes', `--package=pnpm@${pnpmVersion}`, '--', 'pnpm', ...arguments_];
}

async function runPnpm(arguments_, label) {
  const npmArguments = pnpmArguments(arguments_);
  if (process.env.npm_execpath) {
    await run(process.execPath, [process.env.npm_execpath, ...npmArguments], label);
    return;
  }

  if (process.platform === 'win32') {
    await run(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd', ...npmArguments],
      label,
    );
    return;
  }

  await run('npm', npmArguments, label);
}

async function setup() {
  process.stdout.write(
    `Setting up Dusori with Node ${process.versions.node} and pnpm ${pnpmVersion}.\n`,
  );
  await runPnpm(['install', '--frozen-lockfile'], 'Installing the pinned dependencies…');
  await runPnpm(['--filter', '@dusori/app', 'build'], 'Building the browser app…');
  await runPnpm(['--filter', '@udhawan97/dusori', 'build'], 'Building the local companion…');
  process.stdout.write('\nDusori is ready. Start it any time with npm start.\n');
}

async function localBuildExists() {
  const results = await Promise.all(
    [dependencyMarker, companionCli, companionApp].map((path) => exists(path)),
  );
  return results.every(Boolean);
}

async function main() {
  const [command = 'start', ...companionArguments] = process.argv.slice(2);

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
  } else if (command === 'setup') {
    requireSupportedNode();
    await setup();
  } else if (command === 'start') {
    requireSupportedNode();
    if (!(await localBuildExists())) {
      process.stdout.write('This is the first local run; Dusori will set itself up once.\n');
      await setup();
    }
    await run(process.execPath, [companionCli, ...companionArguments], 'Starting Dusori…');
  } else {
    printHelp();
    throw new Error(`Unknown command: ${command}`);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nDusori setup stopped: ${message}\n`);
  process.exitCode = 1;
}
