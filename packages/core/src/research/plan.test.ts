import { describe, expect, it } from 'vitest';

import { buildResearchQuery } from './plan.js';

describe('research query planning', () => {
  it('cleans objective markup and derives deterministic search terms', () => {
    expect(
      buildResearchQuery('Azure administration', {
        title: '**Configure** [[Microsoft Entra ID|Microsoft Entra ID]] for the _tenant_',
      }),
    ).toEqual({
      objectiveTitle: 'Configure Microsoft Entra ID for the tenant',
      searchText: 'Azure administration Configure Microsoft Entra ID for the tenant',
      terms: ['configure', 'microsoft', 'entra', 'id', 'tenant', 'azure', 'administration'],
      topicTitle: 'Azure administration',
    });
  });

  it('carries the topic into a scaffold objective that names no subject', () => {
    const query = buildResearchQuery('AI Fundamentals', {
      title: 'Explain the central mechanism in your own words.',
    });

    expect(query.searchText).toBe(
      'AI Fundamentals Explain the central mechanism in your own words.',
    );
    expect(query.terms).toEqual([
      'explain',
      'central',
      'mechanism',
      'your',
      'own',
      'words',
      'ai',
      'fundamentals',
    ]);
  });

  it('never repeats a term the objective already carries', () => {
    const query = buildResearchQuery('Machine learning', {
      title: 'Explain supervised machine models',
    });

    expect(query.terms).toEqual(['explain', 'supervised', 'machine', 'models', 'learning']);
  });

  it('falls back to the objective alone when the topic title is blank', () => {
    const query = buildResearchQuery('   ', { title: 'Describe neural networks' });

    expect(query.searchText).toBe('Describe neural networks');
    expect(query.terms).toEqual(['describe', 'neural', 'networks']);
  });
});
