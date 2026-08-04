import { chmod, copyFile, cp, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:process';
import { execFile } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repositoryRoot = resolve(import.meta.dirname, '..');
const desktopRoot = resolve(repositoryRoot, 'apps/desktop');
const resources = resolve(desktopRoot, 'resources');
const frontend = resolve(desktopRoot, 'dist');
const companionRequire = createRequire(resolve(repositoryRoot, 'packages/companion/package.json'));
const tsupEntry = companionRequire.resolve('tsup');
const esbuildEntry = createRequire(tsupEntry).resolve('esbuild');
const { build } = await import(pathToFileURL(esbuildEntry).href);
const execFileAsync = promisify(execFile);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hostTarget() {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`Unsupported desktop build host: ${platform}/${arch}`);
}

const target = argument('--target') ?? hostTarget();
const nodeBinary = argument('--node-binary');
const nodeLicense = argument('--node-license');
const skipRuntime = process.argv.includes('--skip-runtime');
const appBuild = resolve(repositoryRoot, 'apps/app/build');

await stat(resolve(appBuild, 'index.html')).catch(() => {
  throw new Error('Build @dusori/app before preparing desktop resources.');
});

await rm(frontend, { recursive: true, force: true });
await mkdir(resolve(frontend, 'Dusori/app'), { recursive: true });
await cp(appBuild, resolve(frontend, 'Dusori/app'), { recursive: true });
await mkdir(resources, { recursive: true });

const launcher = `
const { createServer } = require(${JSON.stringify(resolve(repositoryRoot, 'packages/companion/src/server.ts'))});

(async () => {
  const token = process.env.DUSORI_SESSION_TOKEN;
  const hostedOrigin = process.env.DUSORI_DESKTOP_ORIGIN;
  if (!token || token.length < 32 || !hostedOrigin) process.exit(64);
  const server = await createServer({
    allowedOrigins: [hostedOrigin],
    serveStatic: false,
    token,
  });
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (!address || typeof address === 'string') process.exit(70);
  process.stdout.write('DUSORI_READY ' + JSON.stringify({ port: address.port }) + '\\n');
  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
})().catch(() => process.exit(70));
`;

await build({
  bundle: true,
  define: { 'import.meta.dirname': '__dirname' },
  format: 'cjs',
  logLevel: 'warning',
  outfile: resolve(resources, 'companion.cjs'),
  platform: 'node',
  stdin: {
    contents: launcher,
    loader: 'js',
    resolveDir: repositoryRoot,
    sourcefile: 'dusori-desktop-companion-entry.js',
  },
  target: ['node24'],
});

if (!skipRuntime) {
  if (!nodeBinary) {
    throw new Error('Pass --node-binary <verified Node 24 executable> for a packageable build.');
  }
  if (!nodeLicense) {
    throw new Error('Pass --node-license <LICENSE from the same verified Node 24 archive>.');
  }
  const source = resolve(nodeBinary);
  const licenseSource = resolve(nodeLicense);
  const expectedSuffix = target.includes('windows') ? '.exe' : '';
  if (target.includes('windows') && basename(source).toLowerCase() !== 'node.exe') {
    throw new Error('The Windows desktop runtime must be a verified node.exe.');
  }
  const { stdout: runtimeVersion } = await execFileAsync(source, ['--version']);
  if (runtimeVersion.trim() !== 'v24.18.1') {
    throw new Error(
      `Desktop builds require the pinned Node v24.18.1 runtime, got ${runtimeVersion.trim()}.`,
    );
  }
  if (target.includes('apple-darwin')) {
    const { stdout: linkedLibraries } = await execFileAsync('otool', ['-L', source]);
    const unsafe = linkedLibraries
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' ')[0])
      .find(
        (library) => library && !library.startsWith('/System/') && !library.startsWith('/usr/lib/'),
      );
    if (unsafe) {
      throw new Error(
        `The packaged macOS Node runtime is not self-contained; unexpected dependency: ${unsafe}`,
      );
    }
  }
  const destination = resolve(resources, `node-${target}${expectedSuffix}`);
  await copyFile(source, destination);
  await copyFile(licenseSource, resolve(resources, 'NODE_LICENSE'));
  if (!target.includes('windows')) await chmod(destination, 0o755);
}

process.stdout.write(`Prepared desktop resources for ${target}.\n`);
