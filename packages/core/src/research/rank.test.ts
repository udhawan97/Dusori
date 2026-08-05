import { describe, expect, it } from 'vitest';

import { rankCandidates, selectDiverse, type RankedCandidate } from './rank.js';
import type { ResearchCandidate, ResearchQuery } from './types.js';

const now = new Date('2026-07-21T00:00:00.000Z');

const query: ResearchQuery = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id'],
  topicTitle: 'Azure administration',
};

function candidate(overrides: Partial<ResearchCandidate> & { key: string }): ResearchCandidate {
  return {
    meta: {},
    provider: 'test',
    score: 0,
    snippet: 'An unrelated body of text.',
    title: 'An unrelated page',
    url: 'https://unknown.example/page',
    ...overrides,
  };
}

function pick(ranked: RankedCandidate[], key: string): RankedCandidate {
  const found = ranked.find((item) => item.key === key);
  if (!found) throw new Error(`no ranked candidate named ${key}`);
  return found;
}

describe('rankCandidates', () => {
  it('normalises community signal within a provider, not across providers', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({ communityScore: 40_000, key: 'gh:1', provider: 'github' }),
        candidate({ communityScore: 300, key: 'hn:1', provider: 'hackernews' }),
        candidate({ communityScore: 40, key: 'gh:2', provider: 'github' }),
        candidate({ communityScore: 3, key: 'hn:2', provider: 'hackernews' }),
      ],
      { now },
    );

    // Each provider's leader earns full community credit in its own unit.
    expect(pick(ranked, 'gh:1').rankScore).toBeCloseTo(pick(ranked, 'hn:1').rankScore, 10);
  });

  it('reports the community reason in the provider unit, falling back to a generic phrase', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({
          communityScore: 40_231,
          key: 'gh:1',
          meta: { community: '40,231 stars' },
          provider: 'github',
        }),
        candidate({ communityScore: 312, key: 'hn:1', provider: 'hackernews' }),
      ],
      { now },
    );

    expect(pick(ranked, 'gh:1').reasons).toContain('40,231 stars');
    expect(pick(ranked, 'hn:1').reasons).toContain('312 community points');
  });

  it('treats a missing publication date as neutral rather than as ancient', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({ key: 'fresh', publishedAt: '2026-03-01' }),
        candidate({ key: 'undated' }),
        candidate({ key: 'stale', publishedAt: '2015-01-01' }),
      ],
      { now },
    );

    const score = (key: string): number => pick(ranked, key).rankScore;
    expect(score('fresh')).toBeGreaterThan(score('undated'));
    expect(score('undated')).toBeGreaterThan(score('stale'));
    expect(pick(ranked, 'undated').reasons).toEqual([]);
    expect(pick(ranked, 'fresh').reasons).toContain('published 2026');
  });

  it('adds no date reason when the decay lands exactly on the neutral value', () => {
    const midpoint = new Date(now.getTime() - 3.5 * 365.25 * 24 * 60 * 60 * 1000).toISOString();
    const ranked = rankCandidates(
      query,
      [candidate({ key: 'dated', publishedAt: midpoint }), candidate({ key: 'undated' })],
      { now },
    );

    expect(pick(ranked, 'dated').rankScore).toBe(pick(ranked, 'undated').rankScore);
    expect(pick(ranked, 'dated').reasons).toEqual([]);
  });

  it('ignores an unparseable publication date', () => {
    const ranked = rankCandidates(query, [candidate({ key: 'bad', publishedAt: 'soon' })], { now });
    expect(pick(ranked, 'bad').reasons).toEqual([]);
  });

  it('boosts a reputable host, penalises an aggregator, and leaves unknown hosts alone', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({ key: 'docs', url: 'https://developer.mozilla.org/en-US/docs/Web' }),
        candidate({ key: 'unknown', url: 'https://blog.example/post' }),
        candidate({ key: 'farm', url: 'https://www.w3schools.com/js/default.asp' }),
      ],
      { now },
    );

    expect(ranked.map((item) => item.key)).toEqual(['docs', 'unknown', 'farm']);
    expect(pick(ranked, 'docs').reasons).toContain('official documentation');
    expect(pick(ranked, 'unknown').reasons).toEqual([]);
    expect(pick(ranked, 'farm').reasons).toContain('low-signal aggregator');
  });

  it('lists a reason only for components that actually moved the score', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({
          communityScore: 90,
          key: 'matched',
          publishedAt: '2026-01-05',
          snippet: 'How to configure a tenant.',
          title: 'Microsoft Entra overview',
          url: 'https://learn.microsoft.com/entra',
        }),
        candidate({ key: 'inert' }),
      ],
      { now },
    );

    expect(pick(ranked, 'matched').reasons).toEqual([
      'matches 3 question terms',
      '90 community points',
      'published 2026',
      'official documentation',
    ]);
    expect(pick(ranked, 'inert').reasons).toEqual([]);
  });

  it('uses a singular reason phrase for a single term match', () => {
    const ranked = rankCandidates(query, [candidate({ key: 'one', title: 'Entra' })], { now });
    expect(pick(ranked, 'one').reasons).toEqual(['matches 1 question term']);
  });

  it('marks nothing as new on a first run and only unseen keys afterwards', () => {
    const candidates = [candidate({ key: 'a' }), candidate({ key: 'b' })];

    expect(rankCandidates(query, candidates, { now }).map((item) => item.isNew)).toEqual([
      false,
      false,
    ]);

    const second = rankCandidates(query, candidates, { now, seen: new Set(['a']) });
    expect(pick(second, 'a').isNew).toBe(false);
    expect(pick(second, 'b').isNew).toBe(true);
  });

  it('breaks ties deterministically regardless of input order', () => {
    const candidates = [
      candidate({ key: 'z', title: 'Zebra', url: 'https://unknown.example/z' }),
      candidate({ key: 'a', title: 'Alpha', url: 'https://unknown.example/a' }),
      candidate({ key: 'm', title: 'Alpha', url: 'https://unknown.example/m' }),
    ];
    const order = (input: ResearchCandidate[]): string[] =>
      rankCandidates(query, input, { now }).map((item) => item.key);

    expect(order(candidates)).toEqual(['a', 'm', 'z']);
    expect(order([...candidates].reverse())).toEqual(['a', 'm', 'z']);
  });

  it('does not mutate the input array', () => {
    const candidates = [candidate({ key: 'z', title: 'Zebra' }), candidate({ key: 'a' })];
    rankCandidates(query, candidates, { now });
    expect(candidates.map((item) => item.key)).toEqual(['z', 'a']);
  });

  it('returns an empty list for no candidates', () => {
    expect(rankCandidates(query, [], { now })).toEqual([]);
  });

  it('rejects loose token matches when the query carries a required phrase', () => {
    const certificationQuery: ResearchQuery = {
      ...query,
      requiredPhrases: ['ai 901'],
      searchText: 'AI-901 preparation',
      terms: ['ai', '901', 'preparation'],
    };
    const ranked = rankCandidates(
      certificationQuery,
      [
        candidate({ key: 'exact', title: 'AI-901 exam preparation' }),
        candidate({ key: 'loose', title: '901 AI tools used in society' }),
      ],
      { now },
    );

    expect(ranked.map((item) => item.key)).toEqual(['exact']);
  });

  it('keeps generic research instructions from admitting an unrelated ordinary-topic result', () => {
    const ordinaryQuery: ResearchQuery = {
      objectiveTitle: 'Explain the central mechanism in your own words',
      searchText: 'Spaced repetition Explain the central mechanism in your own words',
      subjectTerms: ['spaced', 'repetition'],
      terms: ['explain', 'central', 'mechanism', 'words', 'spaced', 'repetition'],
      topicTitle: 'Spaced repetition',
    };
    const ranked = rankCandidates(
      ordinaryQuery,
      [
        candidate({ key: 'relevant', title: 'The mechanism of spaced repetition' }),
        candidate({ key: 'filler', title: 'Explain the central mechanism in cell division' }),
      ],
      { now },
    );

    expect(selectDiverse(ranked).shortlist.map((item) => item.key)).toEqual(['relevant']);
  });
});

describe('selectDiverse', () => {
  const ranked = rankCandidates(
    query,
    [
      candidate({ key: 'r1', kind: 'repo', title: 'Configure Microsoft Entra ID' }),
      candidate({ key: 'r2', kind: 'repo', title: 'Configure Microsoft Entra' }),
      candidate({ key: 'r3', kind: 'repo', title: 'Configure Microsoft' }),
      candidate({ key: 'r4', kind: 'repo', title: 'Configure' }),
      candidate({ key: 'r5', kind: 'repo', snippet: 'configure a thing', title: 'Repo five' }),
      candidate({ key: 'd1', kind: 'docs', snippet: 'no matches here', title: 'Docs page' }),
    ],
    { now },
  );

  it('ranks the fixture as expected before diversity is applied', () => {
    expect(ranked.map((item) => item.key)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'd1']);
  });

  it('does not promote an unrelated page merely to add another kind', () => {
    const { shortlist, overflow } = selectDiverse(ranked);
    expect(shortlist.map((item) => item.key)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
    expect(overflow.map((item) => item.key)).toEqual(['d1']);
  });

  it('treats candidates without a kind as their own bucket', () => {
    const mixed = rankCandidates(
      query,
      [
        candidate({ key: 'a', kind: 'repo', title: 'Configure Microsoft Entra ID' }),
        candidate({ key: 'b', kind: 'repo', title: 'Configure Microsoft Entra' }),
        candidate({ key: 'c', snippet: 'nothing', title: 'Configure' }),
      ],
      { now },
    );

    expect(selectDiverse(mixed, 2).shortlist.map((item) => item.key)).toEqual(['a', 'c']);
  });

  it('honours a custom limit and returns everything else as overflow', () => {
    const { shortlist, overflow } = selectDiverse(ranked, 2);
    expect(shortlist).toHaveLength(2);
    expect(overflow).toHaveLength(4);
  });

  it('prefers distinct hosts and providers when comparable results exist', () => {
    const varied = rankCandidates(
      query,
      [
        candidate({
          key: 'a1',
          kind: 'docs',
          provider: 'alpha',
          title: 'Configure Microsoft Entra ID',
          url: 'https://alpha.example/one',
        }),
        candidate({
          key: 'a2',
          kind: 'docs',
          provider: 'alpha',
          title: 'Configure Microsoft Entra',
          url: 'https://alpha.example/two',
        }),
        candidate({
          key: 'b1',
          kind: 'paper',
          provider: 'beta',
          title: 'Configure Microsoft',
          url: 'https://beta.example/paper',
        }),
        candidate({
          key: 'c1',
          kind: 'qa',
          provider: 'gamma',
          title: 'Configure',
          url: 'https://gamma.example/question',
        }),
      ],
      { now },
    );

    expect(selectDiverse(varied, 3).shortlist.map((item) => item.key)).toEqual(['a1', 'b1', 'c1']);
  });

  it('drops invalid and non-web candidates before ranking', () => {
    const ranked = rankCandidates(
      query,
      [
        candidate({ key: 'valid', title: 'Configure', url: 'https://example.org/' }),
        candidate({ key: 'file', title: 'Configure', url: 'file:///tmp/source' }),
        candidate({ key: 'blank', title: '   ', url: 'https://example.org/blank' }),
      ],
      { now },
    );
    expect(ranked.map((item) => item.key)).toEqual(['valid']);
  });
});
