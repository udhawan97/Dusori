import { describe, expect, it } from 'vitest';

import {
  automaticUpdatePreferenceKey,
  readAutomaticDownloadedUpdate,
  resolveUpdatePlatform,
  runAutomaticUpdateCheck,
  type UpdatePlatform,
} from './app-updates';

describe('resolveUpdatePlatform', () => {
  it('keeps ordinary browser and server tests independent from Tauri', async () => {
    const platform = await resolveUpdatePlatform();

    expect(platform.kind).toBe('browser');
    await expect(platform.check()).rejects.toThrow(/hosted app updates/u);
  });
});

describe('runAutomaticUpdateCheck', () => {
  function memoryStorage(values: Record<string, string> = {}) {
    const state = new Map(Object.entries(values));
    return {
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => state.set(key, value),
    };
  }

  it('checks and downloads on application start after the learner opts in, without installing', async () => {
    const calls: string[] = [];
    const update = {
      available: true,
      body: 'Verified release',
      currentVersion: '0.11.3',
      date: '2026-08-04T00:00:00Z',
      version: '0.12.0',
    };
    const platform: UpdatePlatform = {
      kind: 'desktop',
      async check() {
        calls.push('check');
        return update;
      },
      async discard() {
        calls.push('discard');
      },
      async download() {
        calls.push('download');
        return update;
      },
      async installAndRestart() {
        calls.push('install');
      },
    };
    const preferenceStorage = memoryStorage({ [automaticUpdatePreferenceKey]: 'true' });
    const stateStorage = memoryStorage();

    await expect(
      runAutomaticUpdateCheck({
        preferenceStorage,
        resolvePlatform: async () => platform,
        stateStorage,
      }),
    ).resolves.toMatchObject({ kind: 'downloaded', update });
    expect(calls).toEqual(['check', 'download']);
    expect(readAutomaticDownloadedUpdate(stateStorage)).toEqual(update);
  });

  it('does nothing before opt-in', async () => {
    let resolved = false;
    const result = await runAutomaticUpdateCheck({
      preferenceStorage: memoryStorage(),
      resolvePlatform: async () => {
        resolved = true;
        throw new Error('must not resolve native update support');
      },
      stateStorage: memoryStorage(),
    });

    expect(result.kind).toBe('disabled');
    expect(resolved).toBe(false);
  });
});
