import { describe, expect, it } from 'vitest';

import {
  browserEngineRequiresIndexedDb,
  selectBrowserStorageBackend,
} from './browser-selection.js';

const available = { available: true, hasWorkspace: false };
const unavailable = { available: false, hasWorkspace: false };

describe('browser storage backend selection', () => {
  it('routes Firefox to IndexedDB instead of probing its incomplete OPFS surface', () => {
    expect(
      browserEngineRequiresIndexedDb(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:153.0) Gecko/20100101 Firefox/153.0',
      ),
    ).toBe(true);
    expect(browserEngineRequiresIndexedDb('Mozilla/5.0 AppleWebKit/605.1.15 Safari/605.1.15')).toBe(
      false,
    );
  });

  it('falls back to IndexedDB only for a new workspace with no recorded backend', () => {
    expect(selectBrowserStorageBackend(null, unavailable, available, { create: true })).toBe(
      'indexeddb',
    );
  });

  it('keeps a recorded backend stable instead of silently opening an empty fallback', () => {
    expect(() =>
      selectBrowserStorageBackend('opfs', unavailable, available, { create: true }),
    ).toThrow(/recorded OPFS workspace/u);
    expect(() =>
      selectBrowserStorageBackend('opfs', unavailable, available, { create: false }),
    ).toThrow(/recorded OPFS workspace/u);
  });

  it('reopens the only backend that contains a workspace', () => {
    expect(
      selectBrowserStorageBackend(null, { available: true, hasWorkspace: true }, available, {
        create: false,
      }),
    ).toBe('opfs');
  });

  it('keeps the recorded backend stable when both backends contain workspace data', () => {
    expect(
      selectBrowserStorageBackend(
        'indexeddb',
        { available: true, hasWorkspace: true },
        { available: true, hasWorkspace: true },
        { create: false },
      ),
    ).toBe('indexeddb');
  });

  it('fails closed when both backends contain data but the marker is missing', () => {
    expect(() =>
      selectBrowserStorageBackend(
        null,
        { available: true, hasWorkspace: true },
        { available: true, hasWorkspace: true },
        { create: false },
      ),
    ).toThrow(/two browser workspaces/u);
  });

  it('returns no backend during restoration when neither contains a workspace', () => {
    expect(selectBrowserStorageBackend(null, available, available, { create: false })).toBeNull();
  });
});
