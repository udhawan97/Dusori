import { describe, expect, it, vi } from 'vitest';

import { stackExchangeProvider } from './stackexchange.js';

const query = {
  objectiveTitle: 'Infer literal types from const assertions',
  searchText: 'TypeScript generics Infer literal types from const assertions',
  terms: ['infer', 'literal', 'types', 'const', 'assertions', 'typescript', 'generics'],
  topicTitle: 'TypeScript generics',
};

const searchFixture = {
  items: [
    {
      accepted_answer_id: 17380846,
      answer_count: 7,
      body: '<p>I want a generic that uses <code>keyof</code> with <em>&quot;const&quot;</em> assertions &amp; still infers.</p>\n<pre><code>const x = 1;</code></pre>',
      creation_date: 1372956516,
      is_answered: true,
      link: 'https://stackoverflow.com/questions/17380845/how-to-use-keyof',
      question_id: 17380845,
      score: 412,
      tags: ['typescript', 'generics'],
      title: 'How do I use &quot;keyof&quot; with generics &amp; unions?',
    },
    {
      answer_count: 2,
      body: '<p>My build fails with <code>TS2589</code>.</p>',
      creation_date: 1500000000,
      is_answered: true,
      link: 'https://stackoverflow.com/questions/50084013/ts2589',
      question_id: 50084013,
      score: 31,
      tags: ['typescript'],
      title: 'Type instantiation is excessively deep',
    },
    {
      answer_count: 0,
      body: '<p>Plain question body.</p>',
      creation_date: 1600000000,
      is_answered: false,
      link: 'https://stackoverflow.com/questions/64000000/plain',
      question_id: 64000000,
      score: 4,
      title: 'A question with no tags',
    },
  ],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn(async () => Promise.resolve(response(body, status)));
}

describe('Stack Exchange research provider', () => {
  it('maps questions to candidates with decoded text and community signals', async () => {
    const requests: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input));
      return Promise.resolve(response(searchFixture));
    }) as unknown as typeof fetch;

    const results = await stackExchangeProvider.search(query, fetchImpl);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      communityScore: 412,
      key: 'stackexchange:17380845',
      kind: 'qa',
      meta: { accepted: 'yes', answers: '7', tags: 'typescript, generics', votes: '412' },
      provider: 'stackexchange',
      publishedAt: '2013-07-04T16:48:36.000Z',
      score: 3,
      snippet:
        'I want a generic that uses keyof with "const" assertions & still infers. const x = 1;',
      title: 'How do I use "keyof" with generics & unions?',
      url: 'https://stackoverflow.com/questions/17380845/how-to-use-keyof',
    });

    const requested = requests[0] ?? '';
    expect(requested).toContain('https://api.stackexchange.com/2.3/search/advanced');
    expect(requested).toContain('filter=withbody');
    expect(requested).toContain('site=stackoverflow');
    expect(requested).toContain('sort=votes');
    expect(requested).toContain('order=desc');
    expect(requested).toContain('pagesize=8');
    expect(requested).toContain('q=TypeScript+generics+Infer+literal+types+from+const+assertions');
  });

  it('omits accepted without an accepted answer id and omits tags when absent', async () => {
    const results = await stackExchangeProvider.search(
      query,
      fetchReturning(searchFixture) as unknown as typeof fetch,
    );

    expect(results[1]?.meta).toEqual({ answers: '2', tags: 'typescript', votes: '31' });
    expect(results[2]?.meta).toEqual({ answers: '0', votes: '4' });
    expect(results[2]?.score).toBe(1);
  });

  it('converts epoch seconds to an ISO published date', async () => {
    const results = await stackExchangeProvider.search(
      query,
      fetchReturning(searchFixture) as unknown as typeof fetch,
    );

    expect(results[1]?.publishedAt).toBe('2017-07-14T02:40:00.000Z');
    expect(results[2]?.publishedAt).toBe('2020-09-13T12:26:40.000Z');
  });

  it('truncates a long snippet at a word boundary', async () => {
    const results = await stackExchangeProvider.search(
      query,
      fetchReturning({
        items: [
          {
            ...searchFixture.items[0],
            body: `<p>${'supercalifragilistic '.repeat(30)}</p>`,
          },
        ],
      }) as unknown as typeof fetch,
    );

    const snippet = results[0]?.snippet ?? '';
    expect(snippet.length).toBeLessThanOrEqual(301);
    // Cut lands on the space at index 293, so the last word stays whole.
    expect(snippet).toBe(`${'supercalifragilistic '.repeat(13)}supercalifragilistic…`);
  });

  it('reports a friendly error when the API refuses the request', async () => {
    await expect(
      stackExchangeProvider.search(
        query,
        fetchReturning({ error_message: 'throttled' }, 400) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Stack Overflow search could not read the search API.');
  });

  it('reports a friendly error when the response shape is unfamiliar', async () => {
    await expect(
      stackExchangeProvider.search(
        query,
        fetchReturning({ questions: [] }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('Stack Overflow returned an unfamiliar search format.');
  });

  it('captures a reference stub without a second request and without raw HTML', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('capture must not fetch');
    });
    const [candidate] = await stackExchangeProvider.search(
      query,
      fetchReturning(searchFixture) as unknown as typeof fetch,
    );

    const capture = await stackExchangeProvider.capture(
      candidate!,
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(capture.title).toBe('How do I use "keyof" with generics & unions?');
    expect(capture.url).toBe('https://stackoverflow.com/questions/17380845/how-to-use-keyof');
    expect(capture.content).toContain('# How do I use "keyof" with generics & unions?');
    expect(capture.content).toContain(
      'Original URL: <https://stackoverflow.com/questions/17380845/how-to-use-keyof>',
    );
    expect(capture.content).toContain('## Signals');
    expect(capture.content).toContain('- Votes: 412');
    expect(capture.content).toContain('- Answers: 7');
    expect(capture.content).toContain('- Accepted answer: yes');
    expect(capture.content).toContain('- Tags: typescript, generics');
    expect(capture.content).toMatch(
      /This is a Stack Overflow reference captured on \d{4}-\d{2}-\d{2}, not a snapshot of the page\./u,
    );
    expect(capture.content).not.toMatch(/<\/?[a-z][a-z\d]*(?:\s[^>]*)?>/iu);
    expect(capture.content).not.toMatch(/&(?:[a-z]+|#\d+|#x[\da-f]+);/iu);
  });

  it('describes a candidate in one line', async () => {
    const results = await stackExchangeProvider.search(
      query,
      fetchReturning(searchFixture) as unknown as typeof fetch,
    );

    expect(stackExchangeProvider.describeMeta(results[0]!)).toBe(
      '412 votes · 7 answers · accepted · typescript, generics',
    );
    expect(stackExchangeProvider.describeMeta(results[2]!)).toBe('4 votes · 0 answers');
    expect(stackExchangeProvider.capturedVia(results[0]!)).toBe('search-reference');
  });
});
