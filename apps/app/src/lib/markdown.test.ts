import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown';

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

  it('leaves code blocks reachable by keyboard because they scroll sideways', async () => {
    const rendered = await renderMarkdown(['```', 'const wide = 1;', '```', ''].join('\n'));

    expect(rendered.html).toContain('<pre aria-label="Code block" role="region" tabindex="0">');
  });

  it('does not make an author-supplied pre focusable, since sanitizing drops it', async () => {
    const rendered = await renderMarkdown('<pre onclick="alert(1)">raw</pre>\n');

    expect(rendered.html).not.toContain('onclick');
  });
});
