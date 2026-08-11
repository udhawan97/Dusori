import { describe, expect, it } from 'vitest';

import type { CompanionResearchClient } from '../companion.js';
import { buildResearchQuery } from '../plan.js';
import { loadResearchProviderCatalog, researchProviderPolicy } from './index.js';

const capableCompanion = new Proxy(
  {
    capabilities: async () => [
      { available: true, id: 'mslearn', mode: 'keyless' },
      { available: true, id: 'arxiv' },
      { available: false, id: 'reddit', reason: 'not-configured' },
      { available: true, id: 'websearch' },
      { available: true, id: 'youtube' },
    ],
  },
  { get: (target, property) => Reflect.get(target, property) ?? (() => Promise.resolve([])) },
) as CompanionResearchClient;

describe('research provider routing', () => {
  it('keeps specialist developer catalogs out of a broad history question', async () => {
    const catalog = await loadResearchProviderCatalog();
    const selected = catalog.select(
      buildResearchQuery('History of the printing press', {
        title: 'History of the printing press',
      }),
    );

    expect(selected.map((provider) => provider.id)).toEqual([
      'wikipedia',
      'openalex',
      'crossref',
      'openlibrary',
    ]);
  });

  it('uses developer catalogs for a programming question', async () => {
    const catalog = await loadResearchProviderCatalog();
    const selected = catalog.select(
      buildResearchQuery('TypeScript', { title: 'Compare Svelte component libraries' }),
    );

    expect(selected.map((provider) => provider.id)).toEqual([
      'wikipedia',
      'hackernews',
      'github',
      'stackexchange',
      'openalex',
      'crossref',
      'openlibrary',
      'npm',
    ]);
  });

  it('adds Microsoft Learn only when the question is about Microsoft technology', async () => {
    const catalog = await loadResearchProviderCatalog();
    const selected = catalog.select(
      buildResearchQuery('Microsoft Entra ID', { title: 'Configure an Azure tenant' }),
    );

    expect(selected.map((provider) => provider.id)).toContain('mslearn');
  });

  it.each(['AI-103', 'AI-901'])(
    'routes the %s certification code to Microsoft Learn',
    async (code) => {
      const catalog = await loadResearchProviderCatalog();
      const selected = catalog.select(
        buildResearchQuery(code, { title: `Study plan for ${code}` }),
      );

      expect(selected.map((provider) => provider.id)).toContain('mslearn');
    },
  );

  it('keeps one complete, unique policy record for every provider', async () => {
    const session = await loadResearchProviderCatalog();

    expect(new Set(session.catalog.map((entry) => entry.id)).size).toBe(13);
    for (const entry of session.catalog) {
      expect(entry.label).not.toBe('');
      expect(entry.disclosure).not.toBe('');
      expect(entry.consentLabel).not.toBe('');
      expect(['readable-or-reference', 'reference-only']).toContain(entry.capturePolicy);
      expect(researchProviderPolicy.lensFor(entry.id)).toBe(entry.lens);
    }
    expect(researchProviderPolicy.lensFor('future-provider')).toBe('web');
  });

  it('reports companion availability without weakening browser providers', async () => {
    const session = await loadResearchProviderCatalog({ companion: capableCompanion });
    const byId = new Map(session.catalog.map((entry) => [entry.id, entry]));

    expect(byId.get('wikipedia')?.available).toBe(true);
    expect(byId.get('arxiv')?.available).toBe(true);
    expect(byId.get('reddit')).toMatchObject({
      available: false,
      detail: 'Not configured in the local companion',
    });
    expect(session.availableProviders.map((provider) => provider.id)).not.toContain('reddit');
    expect(byId.get('mslearn')?.consentScope).toBe('mslearn-ranked');
    expect(byId.get('mslearn')?.consentLabel).toBe('Microsoft Learn ranked search');
  });

  it('limits routing to providers whose exact consent scope is allowed', async () => {
    const session = await loadResearchProviderCatalog({ companion: capableCompanion });
    const selected = session.select(
      buildResearchQuery('TypeScript', { title: 'Svelte package choices' }),
      new Set(['wikipedia', 'npm']),
    );

    expect(selected.map((provider) => provider.id)).toEqual(['wikipedia', 'npm']);
  });

  it('falls back to an allowed specialist when no relevance rule matches', async () => {
    const session = await loadResearchProviderCatalog();
    const selected = session.select(
      buildResearchQuery('History', { title: 'History of movable type' }),
      new Set(['npm']),
    );

    expect(selected.map((provider) => provider.id)).toEqual(['npm']);
  });

  it('keeps browser Microsoft Learn usable when companion capability discovery fails', async () => {
    const unhealthyCompanion = new Proxy(capableCompanion, {
      get: (target, property) =>
        property === 'capabilities'
          ? () => Promise.reject(new Error('companion unavailable'))
          : Reflect.get(target, property),
    });
    const session = await loadResearchProviderCatalog({ companion: unhealthyCompanion });
    const microsoftLearn = session.catalog.find((entry) => entry.id === 'mslearn');

    expect(microsoftLearn).toMatchObject({
      available: true,
      consentScope: 'mslearn',
      detail: 'Ready in this app',
    });
    expect(session.availableProviders.find((provider) => provider.id === 'mslearn')).toMatchObject({
      consentScope: 'mslearn',
    });
  });
});
