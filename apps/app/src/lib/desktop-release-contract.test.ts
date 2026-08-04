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
    const readmeAppIcon = read('apps/site/public/brand/dusori-app-icon-dark.svg').trim();
    const desktopIconSource = read('apps/desktop/src-tauri/icons/icon-source.svg').trim();
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
    expect(desktopIconSource).toBe(readmeAppIcon);
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

  it('opens the packaged window at the Svelte base instead of an index.html route', () => {
    const rustShell = read('apps/desktop/src-tauri/src/lib.rs');

    expect(rustShell).toContain('const DESKTOP_APP_PATH: &str = "Dusori/app/";');
    expect(rustShell).not.toContain('const DESKTOP_APP_PATH: &str = "Dusori/app/index.html";');
  });

  it('directs affected v0.12.0 and v0.12.1 users to a reachable manual repair', () => {
    const originalDesktopRelease = read('apps/site/src/content/docs/docs/releases/v0-12-0.md');
    const supersededRelease = read('apps/site/src/content/docs/docs/releases/v0-12-1.md');
    const recoveryDocs = [
      read('README.md'),
      read('apps/site/src/pages/index.astro'),
      read('apps/site/src/content/docs/docs/getting-started.md'),
      read('apps/site/src/content/docs/docs/updates.md'),
      originalDesktopRelease,
      supersededRelease,
      read('apps/site/src/content/docs/docs/releases/v0-12-2.md'),
    ];

    for (const document of recoveryDocs) {
      expect(document).toContain('v0.12.0');
      expect(document).toContain('v0.12.1');
      expect(document).toContain('launch-time 404');
      expect(document).toContain('Settings is inaccessible');
      expect(document).toMatch(/(?:manual(?:ly)?[^\n]*v0\.12\.2|v0\.12\.2[^\n]*manual(?:ly)?)/iu);
      expect(document).toMatch(/in-app updates\s+resume from v0\.12\.2 onward/iu);
    }
    expect(originalDesktopRelease).toContain(
      '[Download current v0.12.2](https://github.com/udhawan97/Dusori/releases/tag/v0.12.2)',
    );
    expect(originalDesktopRelease).not.toContain('[Open v0.12.0 release downloads]');
    expect(supersededRelease).toContain(
      '[Download current v0.12.2](https://github.com/udhawan97/Dusori/releases/tag/v0.12.2)',
    );
    expect(supersededRelease).not.toContain('[Download v0.12.1]');
  });

  it('does not advertise an Intel Mac download', () => {
    const landingPage = read('apps/site/src/pages/index.astro');
    const readme = read('README.md');

    expect(landingPage).not.toMatch(/macIntelInstallerHref|Download Intel \.dmg/u);
    expect(readme).not.toMatch(/macOS — Intel|Download Intel `\.dmg`/u);
  });
});
