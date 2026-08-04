import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

function read(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

describe('desktop release contract', () => {
  it('ships macOS only for Apple silicon while retaining Windows x64', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    const verifier = read('scripts/verify-desktop-release.mjs');
    const sidecar = read('scripts/build-desktop-sidecar.mjs');
    const rustBuild = read('apps/desktop/src-tauri/build.rs');

    expect(workflow).toContain('target: aarch64-apple-darwin');
    expect(workflow).toContain('target: x86_64-pc-windows-msvc');
    expect(workflow).toContain('env -u CI pnpm --filter @dusori/desktop exec tauri build');
    expect(workflow).not.toContain('target: x86_64-apple-darwin');
    expect(verifier).not.toContain("['x86_64-apple-darwin', 'darwin-x86_64']");
    expect(sidecar).not.toContain("platform === 'darwin' && arch === 'x64'");
    expect(rustBuild).toContain('target == "x86_64-apple-darwin"');
  });

  it('declares native icons and a branded DMG layout', () => {
    const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as {
      bundle?: {
        icon?: string[];
        macOS?: {
          dmg?: {
            background?: string;
            windowSize?: { width?: number; height?: number };
            appPosition?: { x?: number; y?: number };
            applicationFolderPosition?: { x?: number; y?: number };
          };
        };
      };
    };

    expect(config.bundle?.icon).toEqual([
      'icons/32x32.png',
      'icons/128x128.png',
      'icons/128x128@2x.png',
      'icons/icon.icns',
      'icons/icon.ico',
    ]);
    expect(config.bundle?.macOS?.dmg).toMatchObject({
      background: 'dmg/background.png',
      windowSize: { width: 720, height: 460 },
      appPosition: { x: 180, y: 230 },
      applicationFolderPosition: { x: 540, y: 230 },
    });
  });

  it('stops the companion if the desktop parent exits unexpectedly', () => {
    const sidecar = read('scripts/build-desktop-sidecar.mjs');
    const rustShell = read('apps/desktop/src-tauri/src/lib.rs');

    expect(rustShell).toContain('DUSORI_DESKTOP_PARENT_PID');
    expect(sidecar).toContain('process.kill(parentPid, 0)');
    expect(sidecar).toContain('void close()');
  });

  it('does not advertise an Intel Mac download', () => {
    const landingPage = read('apps/site/src/pages/index.astro');
    const readme = read('README.md');

    expect(landingPage).not.toMatch(/macIntelInstallerHref|Download Intel \.dmg/u);
    expect(readme).not.toMatch(/macOS — Intel|Download Intel `\.dmg`/u);
  });
});
