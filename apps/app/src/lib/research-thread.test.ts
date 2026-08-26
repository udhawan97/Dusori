import { describe, expect, it } from 'vitest';

import type { ResearchRunRecord, SourceRecord } from '@dusori/core';

import {
  renderResearchThreadHtml,
  renderResearchThreadMarkdown,
  hasLegacyReferenceClaims,
  orderedResearchRuns,
  researchAnswerRun,
  researchSourceState,
  researchThreadPreview,
  researchThreadFilename,
} from './research-thread.js';

const run: ResearchRunRecord = {
  at: '2026-08-25T18:30:00.000Z',
  eligibleCount: 2,
  newKeys: 2,
  providers: [
    { count: 2, id: 'github', label: 'GitHub', outcome: 'found' },
    { count: 0, id: 'wikipedia', label: 'Wikipedia', outcome: 'empty' },
  ],
  questionText: 'How do durable research threads work?',
  searchText: 'How do durable research threads work?',
  synthesisOutcome: 'written',
};

function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    fetchedAt: '2026-08-25T18:30:00.000Z',
    method: 'url',
    readState: 'read',
    sha256: 'a'.repeat(64),
    title: 'Threaded research systems',
    url: 'https://example.org/threaded-research',
    claims: [
      {
        at: '2026-08-25T18:30:00.000Z',
        heading: 'Structure',
        text: 'A useful thread keeps the question, evidence, and outcome together.',
      },
    ],
    ...overrides,
  };
}

const input = {
  generatedAt: '2026-08-25T18:35:00.000Z',
  outputStyle: 'brief' as const,
  runs: [run],
  sources: [source()],
  synthesisMarkdown:
    '---\ntitle: "Synthesis"\n---\n\n# Synthesis — Research\n\n## What matters\n\n- “A useful thread keeps the question, evidence, and outcome together.” — [Threaded research systems](https://example.org/threaded-research)',
  synthesisRunAt: run.at,
  topicSlug: 'research-systems',
  topicTitle: 'Research systems',
};

describe('research thread exports', () => {
  it('builds a bounded channel preview while leaving the full synthesis for document view', () => {
    const preview = researchThreadPreview(
      '# Synthesis — Research\n\nAssembled from quoted passages.\n\n## What matters\n\n### Memory\n\n- Spacing improves recall.\n\n## Cross-source coverage\n\nCoverage detail.\n\n## Open questions\n\n- What changes over time?\n\n## What this synthesis is\n\nThe complete evidence warning.',
    );

    expect(preview).toContain('Spacing improves recall');
    expect(preview).toContain('What changes over time?');
    expect(preview).not.toContain('Coverage detail');
    expect(preview).not.toContain('The complete evidence warning');
  });

  it('keeps the question, receipt, sources, synthesis, and evidence boundary together', () => {
    const markdown = renderResearchThreadMarkdown(input);

    expect(markdown).toContain('# Research thread — Research systems');
    expect(markdown).toContain('How do durable research threads work?');
    expect(markdown).toContain('**GitHub** — found 2');
    expect(markdown).toContain('Read evidence · 1 quoted passage');
    expect(markdown).toContain('## Built answer');
    expect(markdown).toContain('A saved reference is not evidence');
  });

  it('never promotes a legacy reference claim into read evidence', () => {
    const reference = source({ readState: 'reference', title: 'Reference only' });
    const markdown = renderResearchThreadMarkdown({ ...input, sources: [reference] });

    expect(researchSourceState(reference)).toEqual({ claimCount: 0, label: 'Reference' });
    expect(markdown).toContain('0 of 1 saved sources currently support 0 quoted passages');
    expect(markdown).toContain('Reference');
    expect(markdown).not.toContain('Reference · 1 quoted passage');
  });

  it('withholds a legacy synthesis when a reference carries unsupported claims', () => {
    const reference = source({ readState: 'reference', title: 'Legacy reference' });
    const markdown = renderResearchThreadMarkdown({ ...input, sources: [reference] });

    expect(hasLegacyReferenceClaims([reference])).toBe(true);
    expect(markdown).toContain('built answer is withheld');
    expect(markdown).not.toContain('A useful thread keeps the question');
  });

  it('renders a script-free, sanitized standalone HTML document', async () => {
    const html = await renderResearchThreadHtml({
      ...input,
      topicTitle: '<script>alert(1)</script>',
      runs: [
        {
          ...run,
          providers: [
            {
              count: 0,
              id: 'unsafe',
              label: 'Unsafe provider',
              message: 'Bearer secret-provider-payload',
              outcome: 'failed',
            },
          ],
          searchText: 'Question\n![remote](https://tracker.example/pixel.png)',
        },
      ],
      sources: [
        source({
          path: '/Users/person/private/source.md',
          url: 'https://alice:secret@example.org/threaded-research',
        }),
      ],
      synthesisMarkdown:
        '# Synthesis\n\nSafe text.\n\n![remote](https://tracker.example/pixel.png)\n\n<script>alert(2)</script>',
    });

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('Bearer secret-provider-payload');
    expect(html).not.toContain('/Users/person/private/source.md');
    expect(html).not.toContain('alice:secret');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("img-src 'none'");
    expect(html).toContain('Safe text.');
    expect(html).toContain('@media print');
  });

  it('neutralizes active Markdown embeds and raw HTML before every export format', async () => {
    const hostile = {
      ...input,
      synthesisMarkdown:
        '# Synthesis\n\n![tracking pixel](https://tracker.example/pixel.png)\n\n<script>alert(1)</script>\n\n[Safe citation](https://example.org/source)',
    };
    const markdown = renderResearchThreadMarkdown(hostile);
    const html = await renderResearchThreadHtml(hostile);

    expect(markdown).toContain('\\![tracking pixel]');
    expect(markdown).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markdown).toContain('[Safe citation](https://example.org/source)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Safe citation');
  });

  it('shows the newest four trail runs first and can expand newest-first', () => {
    const runs = Array.from({ length: 6 }, (_item, index) => ({
      ...run,
      at: `2026-08-25T18:${String(index).padStart(2, '0')}:00.000Z`,
      questionText: `Question ${index}`,
    }));

    expect(orderedResearchRuns(runs).map((item) => item.questionText)).toEqual([
      'Question 5',
      'Question 4',
      'Question 3',
      'Question 2',
    ]);
    expect(orderedResearchRuns(runs, true)[0]?.questionText).toBe('Question 5');
  });

  it('attributes an edited synthesis to its producing run, not a later proposal', () => {
    const proposed: ResearchRunRecord = {
      ...run,
      at: '2026-08-25T19:30:00.000Z',
      questionText: 'Which newer workflow should replace it?',
      searchText: 'Research systems Which newer workflow should replace it?',
      synthesisOutcome: 'proposed',
    };
    const provenanceInput = { ...input, runs: [run, proposed], synthesisRunAt: run.at };
    const markdown = renderResearchThreadMarkdown(provenanceInput);

    expect(researchAnswerRun(provenanceInput.runs, provenanceInput.synthesisRunAt)).toBe(run);
    expect(markdown).toContain('How do durable research threads work?');
    expect(markdown).toContain('did not replace the completed answer');
    expect(markdown).toContain('proposal was saved separately');
    expect(markdown).not.toMatch(/## Question\s+Which newer workflow/u);
  });

  it('keeps the same answer provenance when an empty run follows a proposal', () => {
    const proposed: ResearchRunRecord = {
      ...run,
      at: '2026-08-25T19:30:00.000Z',
      questionText: 'Which newer workflow should replace it?',
      synthesisOutcome: 'proposed',
    };
    const empty: ResearchRunRecord = {
      ...run,
      at: '2026-08-25T20:30:00.000Z',
      eligibleCount: 0,
      newKeys: 0,
      providers: [{ count: 0, id: 'github', label: 'GitHub', outcome: 'empty' }],
      questionText: 'What changed after that?',
      synthesisOutcome: undefined,
    };
    const markdown = renderResearchThreadMarkdown({
      ...input,
      runs: [run, proposed, empty],
      synthesisRunAt: run.at,
    });

    expect(markdown).toMatch(/## Question\s+How do durable research threads work\?/u);
    expect(markdown).toContain('update for “What changed after that?” did not replace');
    expect(markdown).toContain('proposal was saved separately');
  });

  it('stops claiming a proposal is pending after the learner keeps the current synthesis', () => {
    const kept: ResearchRunRecord = {
      ...run,
      at: '2026-08-25T19:30:00.000Z',
      questionText: 'Which newer workflow should replace it?',
      synthesisOutcome: 'kept',
    };
    const markdown = renderResearchThreadMarkdown({
      ...input,
      runs: [run, kept],
      synthesisRunAt: run.at,
    });

    expect(markdown).toMatch(/## Question\s+How do durable research threads work\?/u);
    expect(markdown).toContain('did not replace the completed answer');
    expect(markdown).not.toContain('proposal was saved separately');
  });

  it('attributes an accepted proposal export to the newly written run', () => {
    const accepted: ResearchRunRecord = {
      ...run,
      at: '2026-08-25T19:30:00.000Z',
      questionText: 'Which newer workflow should replace it?',
      synthesisOutcome: 'written',
    };
    const markdown = renderResearchThreadMarkdown({
      ...input,
      runs: [run, accepted],
      synthesisRunAt: accepted.at,
    });

    expect(markdown).toMatch(/## Question\s+Which newer workflow should replace it\?/u);
    expect(markdown).not.toContain('did not replace the completed answer');
  });

  it('labels legacy lookup counts as unrecorded instead of inventing zero', () => {
    const markdown = renderResearchThreadMarkdown({
      ...input,
      runs: [{ ...run, eligibleCount: undefined }],
    });

    expect(markdown).toContain('retained-result count was not recorded');
    expect(markdown).not.toContain('0 relevant results retained');
  });

  it('produces stable local filenames', () => {
    expect(researchThreadFilename('AI + Safety', 'md')).toBe('dusori-research-AI-Safety.md');
    expect(researchThreadFilename('', 'html')).toBe('dusori-research-topic.html');
  });
});
