import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArxivProxyError, searchArxiv } from './research-arxiv.js';

async function fixture(): Promise<string> {
  return readFile(join(import.meta.dirname, '__fixtures__', 'arxiv-search.xml'), 'utf8');
}

function stubFetch(body: string, init?: ResponseInit): typeof fetch {
  return (async () =>
    new Response(body, {
      headers: { 'content-type': 'application/atom+xml' },
      ...init,
    })) as unknown as typeof fetch;
}

describe('searchArxiv', () => {
  it('requests the hardcoded upstream with the expected query parameters', async () => {
    let requested = '';
    const body = await fixture();
    await searchArxiv('attention is all you need', (async (input: string | URL | Request) => {
      requested = String(input);
      return new Response(body, { headers: { 'content-type': 'application/atom+xml' } });
    }) as unknown as typeof fetch);
    expect(requested).toContain('https://export.arxiv.org/api/query?');
    expect(requested).toContain('search_query=all%3Aattention+is+all+you+need');
    expect(requested).toContain('start=0');
    expect(requested).toContain('max_results=8');
    expect(requested).toContain('sortBy=relevance');
  });

  it('parses the Atom feed into trimmed results', async () => {
    const results = await searchArxiv('attention', stubFetch(await fixture()));
    expect(results).toHaveLength(3);
    expect(results.length).toBeLessThanOrEqual(8);
    for (const result of results) {
      expect(result.id).toMatch(/^http/u);
      expect(result.title).toBeTruthy();
      expect(result.title).not.toMatch(/\s{2,}|\n/u);
      expect(result.summary).not.toMatch(/\s{2,}|\n/u);
      expect(result.url.startsWith('http')).toBe(true);
      expect(result.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
    expect(results[0]?.title).toBe(
      'Do You Even Need Attention? A Stack of Feed-Forward Layers Does Surprisingly Well on ImageNet',
    );
    expect(results[0]?.url).toBe('https://arxiv.org/abs/2105.02723v1');
  });

  it('decodes HTML entities in titles and summaries', async () => {
    const feed = `<feed><entry>
        <id>http://arxiv.org/abs/1</id>
        <title>Cats &amp; Dogs &lt;together&gt; &quot;now&quot; &#39;ok&#39; &#x41;</title>
        <summary>a &amp; b</summary>
        <published>2020-01-01T00:00:00Z</published>
      </entry></feed>`;
    const results = await searchArxiv('x', stubFetch(feed));
    expect(results[0]?.title).toBe(`Cats & Dogs <together> "now" 'ok' A`);
    expect(results[0]?.summary).toBe('a & b');
  });

  it('falls back to the entry id when no alternate link is present', async () => {
    const feed = `<feed><entry>
        <id>http://arxiv.org/abs/2</id>
        <title>No link</title>
        <summary>s</summary>
        <published>2020-01-01T00:00:00Z</published>
        <link href="http://arxiv.org/pdf/2" rel="related" type="application/pdf"/>
      </entry></feed>`;
    const results = await searchArxiv('x', stubFetch(feed));
    expect(results[0]?.url).toBe('http://arxiv.org/abs/2');
  });

  it('skips a malformed entry instead of failing the whole feed', async () => {
    const feed = `<feed>
        <entry><summary>no id and no title</summary></entry>
        <entry><id>http://arxiv.org/abs/3</id><title>Good</title></entry>
      </feed>`;
    const results = await searchArxiv('x', stubFetch(feed));
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Good');
    expect(results[0]?.summary).toBe('');
    expect(results[0]?.publishedAt).toBe('');
  });

  it('caps the results at eight even when the feed returns more', async () => {
    const entries = Array.from(
      { length: 12 },
      (_unused, index) =>
        `<entry><id>http://arxiv.org/abs/${index}</id><title>T${index}</title></entry>`,
    ).join('');
    const results = await searchArxiv('x', stubFetch(`<feed>${entries}</feed>`));
    expect(results).toHaveLength(8);
  });

  it('returns an empty list for a feed with no entries', async () => {
    const results = await searchArxiv('x', stubFetch('<feed></feed>'));
    expect(results).toEqual([]);
  });

  it('throws ArxivProxyError when the upstream responds with an error status', async () => {
    await expect(searchArxiv('x', stubFetch('down', { status: 503 }))).rejects.toBeInstanceOf(
      ArxivProxyError,
    );
  });

  it('throws ArxivProxyError when fetch itself fails', async () => {
    await expect(
      searchArxiv('x', (async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ArxivProxyError);
  });

  it('throws ArxivProxyError when the body is not an Atom feed at all', async () => {
    await expect(searchArxiv('x', stubFetch('{"json":true}'))).rejects.toBeInstanceOf(
      ArxivProxyError,
    );
  });
});
