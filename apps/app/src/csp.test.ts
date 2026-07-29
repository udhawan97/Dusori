import { readFileSync } from 'node:fs';

import { createResearchProviders, type CompanionResearchClient } from '@dusori/core';
import { describe, expect, it } from 'vitest';

/** Only the shape matters here: the test reads what a provider declares, never calls it. */
const unusedCompanion: CompanionResearchClient = {
  fetchPage: () => Promise.reject(new Error('unused')),
  searchArxiv: () => Promise.reject(new Error('unused')),
  searchMsLearnRanked: () => Promise.reject(new Error('unused')),
  searchWeb: () => Promise.reject(new Error('unused')),
};

const appHtml = readFileSync(new URL('./app.html', import.meta.url), 'utf8');

/** The origins `app.html` permits the page to call, read from the shipped policy itself. */
function connectSrc(): string[] {
  const policy = /http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/su.exec(appHtml)?.[1];
  if (!policy) throw new Error('app.html declares no Content-Security-Policy.');
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'));
  if (!directive) throw new Error('The app Content-Security-Policy declares no connect-src.');
  return directive.split(/\s+/u).slice(1);
}

/**
 * A provider that reaches its API from the browser is dead on the deployed app unless the
 * policy names its origin, and the failure only shows up at search time. Deriving the list
 * from the registry means adding a provider cannot quietly skip this.
 */
describe('the app policy permits every origin its providers call from the browser', () => {
  const allowed = connectSrc();
  // Both lists, because a running companion changes which providers exist and the
  // upgraded Microsoft Learn still falls back to fetching the catalog from the browser.
  const providers = [
    ...createResearchProviders(),
    ...createResearchProviders({ companion: unusedCompanion }),
  ];

  for (const provider of providers) {
    for (const origin of provider.origins) {
      it(`allows ${provider.id} to reach ${origin}`, () => {
        expect(allowed).toContain(origin);
      });
    }
  }
});
