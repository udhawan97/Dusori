import { describe, expect, it } from 'vitest';

import {
  companionApiVersion,
  companionService,
  isCompanionHealth,
  resolveCompanionOrigin,
  stripCompanionCredentials,
} from './companion-origin.js';

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

describe('companion launch contract', () => {
  it('recognizes only the Dusori service and protocol contract', () => {
    expect(
      isCompanionHealth({
        apiVersion: companionApiVersion,
        service: companionService,
        version: '0.3.0',
      }),
    ).toBe(true);
    expect(isCompanionHealth({ version: '0.3.0' })).toBe(false);
    expect(isCompanionHealth('<html>not a companion</html>')).toBe(false);
    expect(
      isCompanionHealth({
        apiVersion: companionApiVersion + 1,
        service: companionService,
        version: '0.3.0',
      }),
    ).toBe(false);
  });

  it('strips launch credentials while retaining the open workspace view', () => {
    expect(
      stripCompanionCredentials(
        '?token=secret&companion=http%3A%2F%2F127.0.0.1%3A4173&topic=ai&view=graph',
      ),
    ).toBe('topic=ai&view=graph');
  });
});
