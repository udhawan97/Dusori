import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, isTauri } = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri }));

import {
  TauriStorageAdapter,
  checkForDesktopUpdate,
  discardDesktopUpdate,
  downloadDesktopUpdate,
  installDesktopUpdate,
  restartDesktopApp,
  startDesktopSession,
} from './index.js';

describe('Tauri frontend contract', () => {
  beforeEach(() => {
    invoke.mockReset();
    isTauri.mockReturnValue(true);
  });

  it('obtains companion credentials only through IPC', async () => {
    invoke.mockResolvedValue({ origin: 'http://127.0.0.1:43210', token: 'session-token' });
    await expect(startDesktopSession()).resolves.toEqual({
      origin: 'http://127.0.0.1:43210',
      token: 'session-token',
    });
    expect(invoke).toHaveBeenCalledWith('desktop_session', undefined);
  });

  it('keeps check, install, and restart as separate explicit commands', async () => {
    invoke
      .mockResolvedValueOnce({ available: true, version: '0.12.1' })
      .mockResolvedValueOnce({ available: true, version: '0.12.1' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('0.12.1');
    await checkForDesktopUpdate();
    await downloadDesktopUpdate();
    await discardDesktopUpdate();
    await expect(installDesktopUpdate({ hasUnsavedWrites: false })).resolves.toBe('0.12.1');
    await restartDesktopApp({ hasUnsavedWrites: false });
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      'check_for_update',
      'download_update',
      'discard_downloaded_update',
      'install_downloaded_update',
      'restart_app',
    ]);
  });

  it('blocks install and restart while the app reports unsaved writes', async () => {
    await expect(installDesktopUpdate({ hasUnsavedWrites: true })).rejects.toThrow(/Save/u);
    await expect(restartDesktopApp({ hasUnsavedWrites: true })).rejects.toThrow(/Save/u);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('preserves optimistic-write conflicts from native storage', async () => {
    invoke.mockRejectedValue('DUSORI_STORAGE_CONFLICT|topics/ai/note.md|expected-hash|actual-hash');
    const storage = new TauriStorageAdapter();
    await expect(
      storage.write('topics/ai/note.md', 'new text', { expectedHash: 'expected-hash' }),
    ).rejects.toMatchObject({
      actualHash: 'actual-hash',
      expectedHash: 'expected-hash',
      path: 'topics/ai/note.md',
    });
  });
});
