import { describe, expect, it } from 'vitest';

import { compareCandidateScores, scoreCandidate } from './score.js';
import type { ResearchQuery } from './types.js';

const query: ResearchQuery = {
  objectiveTitle: 'Configure Microsoft Entra ID',
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
