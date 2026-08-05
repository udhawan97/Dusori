import { describe, expect, it } from 'vitest';

import { renderMarkdown, wikilinkTarget } from './markdown';

describe('untrusted markdown rendering', () => {
  it('removes machine frontmatter and unsafe HTML while preserving safe links', async () => {
    const rendered = await renderMarkdown(`---
title: Hidden metadata
---

# Safe heading

<script>alert('no')</script>

[unsafe](javascript:alert('no'))

[[Notes/one|Safe note]]
`);

    expect(rendered.html).toContain('<h1>Safe heading</h1>');
    expect(rendered.html).toContain('Safe note');
    expect(rendered.html).not.toContain('Hidden metadata');
    expect(rendered.html).not.toContain('<script');
    expect(rendered.html).not.toContain('javascript:');
  });

  it('marks ordinary web links to open outside the reading room', async () => {
    const rendered = await renderMarkdown(
      'Original URL: <https://example.org/research?q=attention>\n',
    );

    expect(rendered.html).toContain('target="_blank"');
    expect(rendered.html).toContain('rel="nofollow noopener noreferrer"');
  });

  it('leaves code blocks reachable by keyboard because they scroll sideways', async () => {
    const rendered = await renderMarkdown(['```', 'const wide = 1;', '```', ''].join('\n'));

    expect(rendered.html).toContain('<pre aria-label="Code block" role="region" tabindex="0">');
  });

  it('does not make an author-supplied pre focusable, since sanitizing drops it', async () => {
    const rendered = await renderMarkdown('<pre onclick="alert(1)">raw</pre>\n');

    expect(rendered.html).not.toContain('onclick');
  });
});

describe('wikilink hrefs', () => {
  it('decodes the target a rendered wikilink carries', async () => {
    const rendered = await renderMarkdown('See [[Topics/ai/Notes/second look|the note]].\n');
    const href = /href="([^"]+)"/u.exec(rendered.html)?.[1];

    expect(wikilinkTarget(href ?? null)).toBe('Topics/ai/Notes/second look');
  });

  it('decodes a target holding a heading anchor, since resolution strips it later', () => {
    expect(wikilinkTarget('#wiki-roadmap%23Objectives')).toBe('roadmap#Objectives');
  });

  it('ignores every href that is not a wikilink', () => {
    expect(wikilinkTarget('#section-two')).toBeNull();
    expect(wikilinkTarget('https://example.com/#wiki-spoof')).toBeNull();
    expect(wikilinkTarget('')).toBeNull();
    expect(wikilinkTarget(null)).toBeNull();
  });

  it('returns null rather than throwing on a malformed escape', () => {
    expect(wikilinkTarget('#wiki-%E0%A4%A')).toBeNull();
  });

  it('returns null for a wikilink with an empty target', () => {
    expect(wikilinkTarget('#wiki-')).toBeNull();
  });
});
