import { describe, expect, it } from 'vitest';

import { resolveCompanionOrigin } from './companion-origin.js';

const pageOrigin = 'https://app.dusori.example';

describe('resolveCompanionOrigin', () => {
  it('accepts an exact match of the page origin', () => {
    expect(resolveCompanionOrigin(pageOrigin, pageOrigin)).toBe(pageOrigin);
  });

  it('accepts loopback origins over http on any port', () => {
    expect(resolveCompanionOrigin('http://127.0.0.1:4173', pageOrigin)).toBe(
      'http://127.0.0.1:4173',
    );
    expect(resolveCompanionOrigin('http://localhost:9999', pageOrigin)).toBe(
      'http://localhost:9999',
    );
  });

  it('accepts a bracketed ::1 loopback origin', () => {
    expect(resolveCompanionOrigin('http://[::1]:4173', pageOrigin)).toBe('http://[::1]:4173');
  });

  it('rejects an arbitrary remote origin', () => {
    expect(resolveCompanionOrigin('https://attacker.example', pageOrigin)).toBeNull();
  });

  it('rejects https on a loopback hostname (protocol must be plain http)', () => {
    expect(resolveCompanionOrigin('https://localhost:4173', pageOrigin)).toBeNull();
  });

  it('rejects a loopback-looking hostname that is not actually loopback', () => {
    expect(resolveCompanionOrigin('http://localhost.attacker.example', pageOrigin)).toBeNull();
  });

  it('returns null for an unparseable value instead of throwing', () => {
    expect(() => resolveCompanionOrigin('not a url', pageOrigin)).not.toThrow();
    expect(resolveCompanionOrigin('not a url', pageOrigin)).toBeNull();
  });
});
