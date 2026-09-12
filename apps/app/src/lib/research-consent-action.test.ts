import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { consentKey } from './consent';
import { applyResearchConsent } from './research-consent-action';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  } as Storage;
}

describe('research consent action boundary', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every relevant provider off and never calls the positive continuation', async () => {
    const dispatch = vi.fn(async () => undefined);
    await applyResearchConsent('deny', ['wikipedia', 'openalex'], ['wikipedia'], dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(localStorage.getItem(consentKey('wikipedia'))).toBe('denied');
    expect(localStorage.getItem(consentKey('openalex'))).toBe('denied');
  });

  it('calls the continuation only after selected choices are stored', async () => {
    const dispatch = vi.fn(async () => undefined);
    await applyResearchConsent('allow', ['wikipedia', 'openalex'], ['wikipedia'], dispatch);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(localStorage.getItem(consentKey('wikipedia'))).toBe('allowed');
    expect(localStorage.getItem(consentKey('openalex'))).toBe('denied');
  });
});
