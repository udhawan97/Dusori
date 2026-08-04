import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  denyConsent,
  grantConsent,
  hasConsent,
  hasDeniedConsent,
  listConsentDecisions,
  readConsent,
  resetConsent,
} from './consent';

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

describe('provider consent decisions', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('keeps undecided, denied, and allowed distinct while preserving v2 grants', () => {
    expect(readConsent('wikipedia')).toBe('undecided');
    expect(grantConsent('wikipedia')).toBe(true);
    expect(hasConsent('wikipedia')).toBe(true);
    expect(readConsent('wikipedia')).toBe('allowed');

    expect(denyConsent('openalex')).toBe(true);
    expect(hasDeniedConsent('openalex')).toBe(true);
    expect(hasConsent('openalex')).toBe(false);
  });

  it('lists decisions and reset returns one provider to undecided', () => {
    grantConsent('wikipedia');
    denyConsent('openalex');
    expect(listConsentDecisions()).toEqual([
      { decision: 'denied', scope: 'openalex' },
      { decision: 'allowed', scope: 'wikipedia' },
    ]);
    expect(resetConsent('openalex')).toBe(true);
    expect(readConsent('openalex')).toBe('undecided');
    expect(listConsentDecisions()).toEqual([{ decision: 'allowed', scope: 'wikipedia' }]);
  });
});
