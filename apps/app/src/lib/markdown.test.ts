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
});
