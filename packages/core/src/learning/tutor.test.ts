import { describe, expect, it } from 'vitest';

import {
  applyAiTutorProposal,
  parseTutorPreferences,
  renderTutorPreferences,
  tutorDepths,
} from './tutor.js';

const file = [
  '---',
  'title: Cloud native learning preferences',
  'topic: cloud-native',
  'depth: layered',
  '---',
  '',
  '# Learning preferences',
  '',
  '- Prefer concrete examples before abstractions.',
  '- Keep source provenance visible.',
  '- Ask exactly three self-check questions per study note.',
  '',
].join('\n');

describe('parseTutorPreferences', () => {
  it('reads the depth and the preference bullets', () => {
    expect(parseTutorPreferences(file)).toEqual({
      depth: 'layered',
      preferences: [
        'Prefer concrete examples before abstractions.',
        'Keep source provenance visible.',
        'Ask exactly three self-check questions per study note.',
      ],
    });
  });

  it('falls back to a known depth when the file names an unfamiliar one', () => {
    const parsed = parseTutorPreferences(file.replace('depth: layered', 'depth: whatever'));

    expect(tutorDepths).toContain(parsed.depth);
  });

  it('reads a file with no bullets as having no preferences yet', () => {
    expect(
      parseTutorPreferences('---\ndepth: brief\n---\n\n# Learning preferences\n').preferences,
    ).toEqual([]);
  });
});

describe('renderTutorPreferences', () => {
  it('changes the depth without disturbing other frontmatter', () => {
    const next = renderTutorPreferences(file, {
      depth: 'deep',
      preferences: parseTutorPreferences(file).preferences,
    });

    expect(next).toContain('depth: deep');
    expect(next).toContain('title: Cloud native learning preferences');
    expect(next).toContain('topic: cloud-native');
    expect(next).not.toContain('depth: layered');
  });

  it('replaces the bullet list in place and keeps the heading', () => {
    const next = renderTutorPreferences(file, {
      depth: 'layered',
      preferences: ['Only one preference now.'],
    });

    expect(next).toContain('# Learning preferences');
    expect(next).toContain('- Only one preference now.');
    expect(next).not.toContain('Keep source provenance visible.');
  });

  it('round-trips through parse without drift', () => {
    const parsed = parseTutorPreferences(file);

    expect(parseTutorPreferences(renderTutorPreferences(file, parsed))).toEqual(parsed);
  });

  it('refuses a depth outside the known set', () => {
    expect(() =>
      renderTutorPreferences(file, { depth: 'whatever', preferences: ['One.'] }),
    ).toThrow(/depth/iu);
  });

  it('refuses an empty preference list, which would erase the file meaning', () => {
    expect(() => renderTutorPreferences(file, { depth: 'brief', preferences: [] })).toThrow(
      /at least one/iu,
    );
  });

  it('refuses a preference that is not a single readable line', () => {
    expect(() =>
      renderTutorPreferences(file, { depth: 'brief', preferences: ['line one\nline two'] }),
    ).toThrow(/single line/iu);
  });

  it('refuses an over-long preference', () => {
    expect(() =>
      renderTutorPreferences(file, { depth: 'brief', preferences: ['x'.repeat(201)] }),
    ).toThrow(/200/u);
  });
});

describe('applyAiTutorProposal', () => {
  it('accepts a proposal that still parses as learning preferences', () => {
    const proposed = renderTutorPreferences(file, {
      depth: 'deep',
      preferences: ['Show a worked example first.', 'Name every source.'],
    });

    expect(applyAiTutorProposal(file, proposed)).toBe(proposed);
  });

  it('keeps the current file when a proposal has no preferences at all', () => {
    expect(applyAiTutorProposal(file, '---\ndepth: brief\n---\n\n# Learning preferences\n')).toBe(
      file,
    );
  });

  it('keeps the current file when a proposal is empty', () => {
    expect(applyAiTutorProposal(file, '   ')).toBe(file);
  });

  it('keeps the current file when a proposal is far longer than a preferences page', () => {
    const bloated = renderTutorPreferences(file, {
      depth: 'deep',
      preferences: ['A fine preference.'],
    }).concat('x'.repeat(20_000));

    expect(applyAiTutorProposal(file, bloated)).toBe(file);
  });

  it('normalises a proposal through render, so a model cannot smuggle in other content', () => {
    const sneaky = [
      '---',
      'depth: deep',
      '---',
      '',
      '# Learning preferences',
      '',
      '- A fine preference.',
      '',
      '## Extra section the model added',
      '',
      'Prose that does not belong on a preferences page.',
    ].join('\n');

    const applied = applyAiTutorProposal(file, sneaky);

    expect(applied).not.toContain('Extra section the model added');
    expect(applied).toContain('- A fine preference.');
    expect(applied).toContain('depth: deep');
  });
});
