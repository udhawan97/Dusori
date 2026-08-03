import { describe, expect, it } from 'vitest';

import type { SourceRecord } from '../schemas/workspace.js';
import { buildTopicSynthesis, renderSynthesisMarkdown } from './synthesis.js';

const now = new Date('2026-08-02T10:00:00.000Z');
const at = now.toISOString();

function source(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    fetchedAt: at,
    method: 'url',
    origin: { capturedAt: at, capturedVia: 'api-extract', provider: 'wikipedia' },
    path: 'Topics/t/Sources/items/abc123456789-spaced-repetition.md',
    sha256: 'a'.repeat(64),
    title: 'Spaced repetition',
    url: 'https://en.wikipedia.org/wiki/Spaced_repetition',
    ...overrides,
  };
}

const wiki = source({
  claims: [
    {
      at,
      heading: 'Forgetting curve',
      text: 'Reviews at increasing intervals counter forgetting.',
    },
  ],
  publishedAt: '2024-03-01',
});
const paper = source({
  claims: [
    { at, heading: 'The forgetting curve', text: 'Distributed practice beats massed practice.' },
  ],
  origin: { capturedAt: at, capturedVia: 'api-extract', provider: 'openalex' },
  path: 'Topics/t/Sources/items/def123456789-distributed-practice.md',
  publishedAt: '2006-05-01',
  sha256: 'b'.repeat(64),
  title: 'Distributed practice review',
  url: 'https://api.openalex.org/works/W1',
});
const solo = source({
  claims: [
    { at, heading: 'Tooling', text: 'Anki schedules cards with a modified SM-2 algorithm.' },
  ],
  path: 'Topics/t/Sources/items/ghi123456789-anki.md',
  publishedAt: '2023-01-01',
  sha256: 'c'.repeat(64),
  title: 'Anki manual',
  url: 'https://docs.ankiweb.net/',
});

describe('topic synthesis', () => {
  it('clusters claims whose headings mean the same thing across sources', () => {
    const synthesis = buildTopicSynthesis({
      now,
      sources: [wiki, paper],
      topicTitle: 'Spaced repetition learning',
    });

    expect(synthesis.clusters).toHaveLength(1);
    expect(synthesis.clusters[0]?.sourceCount).toBe(2);
    expect(synthesis.claimCount).toBe(2);
    expect(synthesis.thinEvidence).toEqual([]);
  });

  it('marks a single-source cluster as thin evidence', () => {
    const synthesis = buildTopicSynthesis({
      now,
      sources: [wiki, paper, solo],
      topicTitle: 'Spaced repetition learning',
    });

    expect(synthesis.thinEvidence.map((cluster) => cluster.heading)).toEqual(['Tooling']);
  });

  it('names lenses with nothing saved instead of implying nothing exists', () => {
    const synthesis = buildTopicSynthesis({
      now,
      sources: [wiki],
      topicTitle: 'Spaced repetition learning',
    });

    expect(synthesis.missingLenses).toEqual(['Academic', 'Community', 'Video', 'Web']);
    expect(synthesis.openQuestions.some((question) => question.includes('academic'))).toBe(true);
  });

  it('cites every quoted passage back to its source file', () => {
    const markdown = renderSynthesisMarkdown(
      buildTopicSynthesis({
        now,
        sources: [wiki, paper],
        topicTitle: 'Spaced repetition learning',
      }),
    );

    expect(markdown).toContain('generated: synthesis');
    expect(markdown).toContain(
      '“Reviews at increasing intervals counter forgetting.” — [[abc123456789-spaced-repetition|Spaced repetition]]',
    );
    expect(markdown).toContain('Every line below is quoted from a source you approved.');
    // Nothing may appear that is not traceable: each bullet under What matters carries a citation.
    for (const line of markdown.split('\n').filter((entry) => entry.startsWith('- “'))) {
      expect(line).toMatch(/—\s+(?:\[\[|\[)/u);
    }
  });

  it('builds a timeline only once three sources carry dates', () => {
    const two = renderSynthesisMarkdown(
      buildTopicSynthesis({ now, sources: [wiki, paper], topicTitle: 'T' }),
    );
    const three = renderSynthesisMarkdown(
      buildTopicSynthesis({ now, sources: [wiki, paper, solo], topicTitle: 'T' }),
    );

    expect(two).not.toContain('## Timeline');
    expect(three).toContain('## Timeline');
    expect(three.indexOf('**2006**')).toBeLessThan(three.indexOf('**2023**'));
  });

  it('names the model when AI wrote the overview, and keeps quotes regardless', () => {
    const markdown = renderSynthesisMarkdown(
      buildTopicSynthesis({ now, sources: [wiki, paper], topicTitle: 'T' }),
      { aiModel: 'llama3', aiOverview: 'Spacing works because retrieval strengthens memory.' },
    );

    expect(markdown).toContain('written by llama3');
    expect(markdown).toContain('Spacing works because retrieval strengthens memory.');
    expect(markdown).toContain('“Distributed practice beats massed practice.”');
  });

  it('says plainly when nothing has been read yet', () => {
    const markdown = renderSynthesisMarkdown(
      buildTopicSynthesis({ now, sources: [source({ claims: undefined })], topicTitle: 'T' }),
    );

    expect(markdown).toContain('No source has been read into quotable passages yet.');
    expect(markdown).not.toContain('## What matters');
  });
});
