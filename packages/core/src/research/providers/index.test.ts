import { describe, expect, it } from 'vitest';

import { buildResearchQuery } from '../plan.js';
import { researchProviders, selectProvidersForQuery } from './index.js';

describe('research provider routing', () => {
  it('keeps specialist developer catalogs out of a broad history question', () => {
    const selected = selectProvidersForQuery(
      [...researchProviders],
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

  it('uses developer catalogs for a programming question', () => {
    const selected = selectProvidersForQuery(
      [...researchProviders],
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

  it('adds Microsoft Learn only when the question is about Microsoft technology', () => {
    const selected = selectProvidersForQuery(
      [...researchProviders],
      buildResearchQuery('Microsoft Entra ID', { title: 'Configure an Azure tenant' }),
    );

    expect(selected.map((provider) => provider.id)).toContain('mslearn');
  });

  it.each(['AI-103', 'AI-901'])('routes the %s certification code to Microsoft Learn', (code) => {
    const selected = selectProvidersForQuery(
      [...researchProviders],
      buildResearchQuery(code, { title: `Study plan for ${code}` }),
    );

    expect(selected.map((provider) => provider.id)).toContain('mslearn');
  });
});
