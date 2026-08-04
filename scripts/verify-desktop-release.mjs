import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { basename, extname, join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '..');
const configPath = resolve(repositoryRoot, 'apps/desktop/src-tauri/tauri.conf.json');
const fixedEndpoint = 'https://github.com/udhawan97/Dusori/releases/latest/download/latest.json';
const requiredPlatforms = new Map([
  ['aarch64-apple-darwin', 'darwin-aarch64'],
  ['x86_64-apple-darwin', 'darwin-x86_64'],
  ['x86_64-pc-windows-msvc', 'windows-x86_64'],
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function updaterPublicKey() {
  const value = process.env.DUSORI_UPDATER_PUBLIC_KEY?.trim() ?? '';
  if (value.length < 32 || value.includes('NOT_PROVISIONED') || /PRIVATE KEY/iu.test(value)) {
    throw new Error(
      'DUSORI_UPDATER_PUBLIC_KEY is missing or invalid. Commit/provide only the updater public key.',
    );
  }
  return value;
}

const config = JSON.parse(await readFile(configPath, 'utf8'));
const endpoints = config.plugins?.updater?.endpoints;
if (!Array.isArray(endpoints) || endpoints.length !== 1 || endpoints[0] !== fixedEndpoint) {
  throw new Error(`Desktop updater must use only ${fixedEndpoint}.`);
}
if (config.bundle?.createUpdaterArtifacts !== true || config.plugins?.updater?.dialog !== false) {
  throw new Error('Signed updater artifacts must be enabled and native updater dialogs disabled.');
}
if (!String(config.plugins?.updater?.pubkey).includes('NOT_PROVISIONED')) {
  throw new Error(
    'The source config must retain its safe placeholder; release builds use an ignored overlay.',
  );
}

const writeConfig = argument('--write-config');
if (writeConfig) {
  const releaseConfig = structuredClone(config);
  releaseConfig.plugins.updater.pubkey = updaterPublicKey();
  const destination = resolve(repositoryRoot, writeConfig);
  await writeFile(destination, `${JSON.stringify(releaseConfig, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`Wrote release-only Tauri config: ${destination}\n`);
}

async function filesBelow(directory) {
  const output = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) output.push(...(await filesBelow(path)));
    else output.push(path);
  }
  return output;
}

const collectRoot = argument('--collect');
if (collectRoot) {
  const target = argument('--target');
  const output = resolve(repositoryRoot, argument('--output') ?? 'release-assets');
  if (!requiredPlatforms.has(target)) throw new Error(`Unsupported release target: ${target}`);
  const source = resolve(repositoryRoot, collectRoot);
  const files = await filesBelow(source);
  const signed = files.filter((file) => file.endsWith('.sig'));
  if (signed.length === 0)
    throw new Error(`No signed updater artifact was produced for ${target}.`);
  await mkdir(output, { recursive: true });
  for (const file of files) {
    const name = basename(file);
    if (!/\.(?:dmg|exe|sig|gz|zip)$/iu.test(name)) continue;
    const signatureSuffix = name.endsWith('.sig') ? '.sig' : '';
    const unsignedName = signatureSuffix ? name.slice(0, -4) : name;
    const extension = unsignedName.endsWith('.app.tar.gz')
      ? '.app.tar.gz'
      : unsignedName.endsWith('.nsis.zip')
        ? '.nsis.zip'
        : extname(unsignedName);
    const stem = unsignedName.slice(0, -extension.length).replaceAll(/[^a-z0-9._-]+/giu, '-');
    await cp(file, join(output, `${stem}-${target}${extension}${signatureSuffix}`));
  }
  process.stdout.write(`Collected signed desktop artifacts for ${target}.\n`);
}

const artifactsRoot = argument('--artifacts');
const latestPath = argument('--write-latest');
if (artifactsRoot || latestPath) {
  if (!artifactsRoot || !latestPath) {
    throw new Error('--artifacts and --write-latest must be provided together.');
  }
  const version = argument('--version');
  const tag = argument('--tag');
  if (!version || tag !== `v${version}` || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('Release version and immutable v<version> tag must match exactly.');
  }
  updaterPublicKey();
  const directory = resolve(repositoryRoot, artifactsRoot);
  const files = await filesBelow(directory);
  const platforms = {};
  for (const [target, platform] of requiredPlatforms) {
    const signatures = files.filter((file) => file.includes(target) && file.endsWith('.sig'));
    const signature =
      signatures.find((file) => file.includes('.app.tar.gz.sig')) ??
      signatures.find((file) => file.endsWith('.exe.sig')) ??
      signatures[0];
    if (!signature) throw new Error(`Missing updater signature for ${target}.`);
    const artifact = signature.slice(0, -4);
    await stat(artifact).catch(() => {
      throw new Error(`Signature has no matching updater artifact: ${signature}`);
    });
    const assetName = basename(artifact);
    const signatureValue = (await readFile(signature, 'utf8')).trim();
    if (signatureValue.length < 32) throw new Error(`Invalid updater signature: ${signature}`);
    execFileSync(
      'cargo',
      [
        'run',
        '--quiet',
        '--locked',
        '--manifest-path',
        resolve(repositoryRoot, 'scripts/updater-signature-verifier/Cargo.toml'),
        '--',
        artifact,
        signature,
      ],
      { env: process.env, stdio: 'inherit' },
    );
    platforms[platform] = {
      signature: signatureValue,
      url: `https://github.com/udhawan97/Dusori/releases/download/${tag}/${encodeURIComponent(assetName)}`,
    };
  }
  const latest = {
    version,
    notes: `Dusori ${version} desktop update. See the release page for verified changes and platform caveats.`,
    pub_date: new Date().toISOString(),
    platforms,
  };
  const destination = resolve(repositoryRoot, latestPath);
  await writeFile(destination, `${JSON.stringify(latest, null, 2)}\n`);
  process.stdout.write(`Verified three signed updater targets and wrote ${destination}.\n`);
}

if (process.argv.includes('--config-only')) {
  process.stdout.write(
    'Desktop release configuration is structurally valid and safely unprovisioned.\n',
  );
}
