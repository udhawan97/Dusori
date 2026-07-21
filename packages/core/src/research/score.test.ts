import { describe, expect, it } from 'vitest';

import { buildResearchQuery } from './plan.js';
import { compareCandidateScores, scoreCandidate } from './score.js';
import type { ResearchQuery } from './types.js';

const query: ResearchQuery = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id'],
  topicTitle: 'Azure administration',
};

describe('research candidate scoring', () => {
  it('weights each title match three times more than a summary match', () => {
    expect(
      scoreCandidate(query, {
        popularity: 42,
        summary: 'Configure identity access.',
        title: 'Microsoft Entra ID',
      }),
    ).toBe(10);
  });

  it('ranks a scaffold objective on topic instead of on its filler words', () => {
    // The regression this guards: with objective terms alone, "How I Met Your Mother" scored on
    // the word "your" and outranked every artificial-intelligence article.
    const scaffold = buildResearchQuery('AI Fundamentals', {
      title: 'Explain the central mechanism in your own words.',
    });

    const onTopic = scoreCandidate(scaffold, {
      summary: 'A tour of modern AI systems.',
      title: 'AI fundamentals for beginners',
    });
    const offTopic = scoreCandidate(scaffold, {
      summary: 'Sitcom about how the narrator met the mother.',
      title: 'How I Met Your Mother',
    });

    expect(onTopic).toBeGreaterThan(offTopic);
  });

  it('still lets an objective that names its own subject lead the ranking', () => {
    const rich = buildResearchQuery('AI Fundamentals', {
      title: 'Explain supervised and unsupervised learning',
    });

    const onObjective = scoreCandidate(rich, {
      summary: 'How labelled and unlabelled data train a model.',
      title: 'Supervised and unsupervised learning',
    });
    const topicOnly = scoreCandidate(rich, {
      summary: 'A general overview.',
      title: 'AI fundamentals',
    });

    expect(onObjective).toBeGreaterThan(topicOnly);
  });

  it('orders by score, popularity, and a deterministic lexical fallback', () => {
    const candidates = [
      { key: 'z', popularity: 10, score: 5, title: 'Zebra', url: 'https://example.com/z' },
      { key: 'b', popularity: 20, score: 5, title: 'Beta', url: 'https://example.com/b' },
      { key: 'a', popularity: 20, score: 5, title: 'Alpha', url: 'https://example.com/a' },
      { key: 'low', popularity: 999, score: 4, title: 'Low', url: 'https://example.com/low' },
    ];

    expect(candidates.sort(compareCandidateScores).map((candidate) => candidate.key)).toEqual([
      'a',
      'b',
      'z',
      'low',
    ]);
  });
});
