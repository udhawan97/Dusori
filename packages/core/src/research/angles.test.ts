import { describe, expect, it } from 'vitest';

import { angleById, buildAngleQuery, researchAngles } from './angles.js';
import { rankCandidates, selectDiverse } from './rank.js';
import { buildResearchQuery } from './plan.js';
import type { ResearchCandidate } from './types.js';

const now = new Date('2026-08-02T10:00:00.000Z');

function candidate(overrides: Partial<ResearchCandidate>): ResearchCandidate {
  return {
    key: 'wikipedia:x',
    meta: {},
    provider: 'wikipedia',
    score: 1,
    snippet: '',
    title: 'Untitled',
    url: 'https://en.wikipedia.org/wiki/Untitled',
    ...overrides,
  };
}

describe('research angles', () => {
  it('always seeds the search with the topic itself', () => {
    for (const angle of researchAngles) {
      const query = buildAngleQuery('Spaced repetition learning', angle);
      expect(query.searchText.startsWith('Spaced repetition learning')).toBe(true);
      expect(query.angleId).toBe(angle.id);
      expect(query.questionText).toBe(
        angle.suffix ? `Spaced repetition learning: ${angle.suffix}` : 'Spaced repetition learning',
      );
      expect(query.terms).toEqual(expect.arrayContaining(['spaced', 'repetition', 'learning']));
    }
  });

  it('sends only the topic for the overview angle', () => {
    const query = buildAngleQuery('Spaced repetition learning', angleById('overview')!);
    expect(query.searchText).toBe('Spaced repetition learning');
  });

  // The live failure this fixes: with the scaffold objective "Establish the terms and
  // boundaries", scoring treated its filler words as equal to the topic's own words, so
  // "Go (game)" and "Glossary of computer science" outranked the topic's own article.
  it('ranks the topic’s own article above a page that only matches the angle words', () => {
    const query = buildAngleQuery('Spaced repetition learning', angleById('mechanism')!);
    const ranked = rankCandidates(
      query,
      [
        candidate({
          key: 'wikipedia:go',
          snippet: 'This rule works to prevent unending repetition in the game of Go.',
          title: 'Go (game)',
        }),
        candidate({
          key: 'wikipedia:spaced',
          snippet: 'Spaced repetition is an evidence-based learning technique.',
          title: 'Spaced repetition',
        }),
      ],
      { now },
    );

    expect(ranked[0]?.key).toBe('wikipedia:spaced');
  });

  it('never auto-saves a page that matches only the angle words', () => {
    const query = buildAngleQuery('Spaced repetition learning', angleById('mechanism')!);
    const ranked = rankCandidates(
      query,
      [
        candidate({
          key: 'wikipedia:irrigation',
          snippet: 'A detailed explanation of how irrigation works in dry climates.',
          title: 'How irrigation works',
        }),
        candidate({
          key: 'wikipedia:spaced',
          snippet: 'How spaced repetition works to support learning over time.',
          title: 'Spaced repetition',
        }),
      ],
      { now },
    );

    expect(ranked[0]?.topicMatches).toBeGreaterThan(0);
    expect(ranked.find((item) => item.key === 'wikipedia:irrigation')?.topicMatches).toBe(0);
    expect(selectDiverse(ranked).shortlist.map((item) => item.key)).toEqual(['wikipedia:spaced']);
  });

  it('keeps an authoritative topic result when an angle adds scoring words it does not use', () => {
    const query = buildAngleQuery('TypeScript', angleById('mechanism')!);
    const ranked = rankCandidates(
      query,
      [
        candidate({
          key: 'typescript:compiler-handbook',
          provider: 'official-docs',
          snippet: 'The compiler handbook documents the TypeScript language and type system.',
          title: 'TypeScript compiler handbook',
          url: 'https://www.typescriptlang.org/docs/handbook/intro.html',
        }),
      ],
      { now },
    );

    expect(ranked[0]?.requiredSubjectMatches).toBe(1);
    expect(selectDiverse(ranked).shortlist.map((item) => item.key)).toEqual([
      'typescript:compiler-handbook',
    ]);
  });

  it('keeps roadmap objectives working, scoring their terms below the topic', () => {
    const query = buildResearchQuery('Azure administration', {
      title: 'Establish the terms and boundaries.',
    });
    const ranked = rankCandidates(
      query,
      [
        candidate({
          key: 'wikipedia:glossary',
          snippet: 'A glossary establishes terms and boundaries across computer science.',
          title: 'Glossary of computer science',
        }),
        candidate({
          key: 'wikipedia:azure',
          snippet: 'Administration of Microsoft Azure resources and identities.',
          title: 'Azure administration',
        }),
      ],
      { now },
    );

    expect(ranked[0]?.key).toBe('wikipedia:azure');
  });
});
