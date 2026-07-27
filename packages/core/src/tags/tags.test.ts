import { describe, expect, it } from 'vitest';

import { extractTags, matchesTag, parseTagQuery } from './tags.js';

describe('extractTags', () => {
  it('reads a yaml list under tags in frontmatter', () => {
    const content = [
      '---',
      'title: Notes',
      'tags:',
      '  - alpha',
      '  - beta',
      '---',
      '',
      'Body.',
    ].join('\n');
    expect(extractTags(content)).toEqual(['alpha', 'beta']);
  });

  it('reads a comma separated tags line in frontmatter', () => {
    const content = ['---', 'tags: alpha, beta', '---', '', 'Body.'].join('\n');
    expect(extractTags(content)).toEqual(['alpha', 'beta']);
  });

  it('reads a bracketed tags line in frontmatter', () => {
    const content = ['---', 'tags: [alpha, beta]', '---', '', 'Body.'].join('\n');
    expect(extractTags(content)).toEqual(['alpha', 'beta']);
  });

  it('reads inline hash tags from the body', () => {
    expect(extractTags('Study #kubernetes today, then #networking.')).toEqual([
      'kubernetes',
      'networking',
    ]);
  });

  it('treats a markdown heading as a heading and never as a tag', () => {
    const content = ['# Heading', '', '## Another heading', '', 'Real #tag here.'].join('\n');
    expect(extractTags(content)).toEqual(['tag']);
  });

  it('ignores hash tags inside a fenced code block', () => {
    const content = [
      'Before #kept.',
      '',
      '```bash',
      '# comment',
      'echo "#ignored"',
      '```',
      '',
    ].join('\n');
    expect(extractTags(content)).toEqual(['kept']);
  });

  it('ignores hash tags inside inline backticks', () => {
    expect(extractTags('Use `#ignored` but keep #kept.')).toEqual(['kept']);
  });

  it('ignores a url fragment', () => {
    expect(extractTags('See https://example.com/page#section for more.')).toEqual([]);
  });

  it('ignores a bare numeric hash', () => {
    expect(extractTags('Issue #123 is unrelated to #alpha.')).toEqual(['alpha']);
  });

  it('supports nested obsidian style tags', () => {
    expect(extractTags('Filed under #cloud/azure today.')).toEqual(['cloud/azure']);
  });

  it('merges frontmatter and inline tags, deduplicated case insensitively', () => {
    const content = ['---', 'tags: Alpha', '---', '', 'Body mentions #alpha and #beta.'].join('\n');
    expect(extractTags(content)).toEqual(['Alpha', 'beta']);
  });

  it('returns an empty list when a document has no tags', () => {
    expect(extractTags('---\ntitle: Plain\n---\n\nNothing here.')).toEqual([]);
  });

  it('does not treat a hash glued to a word as a tag', () => {
    expect(extractTags('colour#ffffff stays out.')).toEqual([]);
  });
});

describe('parseTagQuery', () => {
  it('splits tag operators away from free text terms', () => {
    expect(parseTagQuery('tag:azure networking notes')).toEqual({
      tags: ['azure'],
      text: 'networking notes',
    });
  });

  it('collects several tag operators', () => {
    expect(parseTagQuery('tag:azure tag:cloud/aws')).toEqual({
      tags: ['azure', 'cloud/aws'],
      text: '',
    });
  });

  it('leaves a query without operators untouched', () => {
    expect(parseTagQuery('plain search')).toEqual({ tags: [], text: 'plain search' });
  });

  it('ignores an empty tag operator', () => {
    expect(parseTagQuery('tag: real')).toEqual({ tags: [], text: 'tag: real' });
  });
});

describe('matchesTag', () => {
  it('compares tags case insensitively', () => {
    expect(matchesTag(['Alpha'], 'alpha')).toBe(true);
  });

  it('rejects a tag the document does not carry', () => {
    expect(matchesTag(['alpha'], 'beta')).toBe(false);
  });
});
