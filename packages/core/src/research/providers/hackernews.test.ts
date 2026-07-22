import { describe, expect, it, vi } from 'vitest';

import { hackerNewsProvider } from './hackernews.js';

const query = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id', 'azure', 'administration'],
  topicTitle: 'Azure administration',
};

const searchFixture = {
  hits: [
    {
      _tags: ['story', 'author_tptacek', 'story_41521098'],
      author: 'tptacek',
      created_at: '2026-03-04T15:12:07.000Z',
      num_comments: 88,
      objectID: '41521098',
      points: 312,
      story_text: null,
      title: 'Configuring  Microsoft Entra ID without tears',
      url: 'https://example.com/entra-id',
    },
    {
      _tags: ['story', 'ask_hn', 'author_dang', 'story_41398220'],
      author: 'dang',
      created_at: '2026-02-11T09:03:44.000Z',
      num_comments: 41,
      objectID: '41398220',
      points: 128,
      story_text: '<p>We moved our tenant last month.</p> Here&#x27;s what broke.',
      title: 'Ask HN: How do you audit Entra ID roles?',
      url: null,
    },
  ],
  nbHits: 2,
  page: 0,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function fixtureFetch(body: unknown = searchFixture, status = 200): typeof fetch {
  return vi.fn(async () => Promise.resolve(response(body, status))) as unknown as typeof fetch;
}

describe('Hacker News research provider', () => {
  it('maps stories, keeping the permalink for posts without their own URL', async () => {
    const fetchImpl = fixtureFetch();
    const results = await hackerNewsProvider.search(query, fetchImpl);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      communityScore: 312,
      key: 'hackernews:41521098',
      kind: 'article',
      meta: {
        comments: '88',
        discussion: 'https://news.ycombinator.com/item?id=41521098',
        points: '312',
      },
      provider: 'hackernews',
      publishedAt: '2026-03-04T15:12:07.000Z',
      score: 2,
      snippet: '',
      title: 'Configuring Microsoft Entra ID without tears',
      url: 'https://example.com/entra-id',
    });
    expect(results[1]).toMatchObject({
      key: 'hackernews:41398220',
      score: 1,
      snippet: "dang: We moved our tenant last month. Here's what broke.",
      url: 'https://news.ycombinator.com/item?id=41398220',
    });

    const requested = String(vi.mocked(fetchImpl).mock.calls[0]?.[0]);
    expect(requested).toContain('https://hn.algolia.com/api/v1/search?');
    expect(requested).toContain('query=Azure+administration+Configure+Microsoft+Entra+ID');
    expect(requested).toContain('tags=story');
    expect(requested).toContain('hitsPerPage=8');
  });

  it('reports a friendly error when the search API refuses the request', async () => {
    await expect(hackerNewsProvider.search(query, fixtureFetch({}, 503))).rejects.toThrow(
      'Hacker News search could not read the search API.',
    );
  });

  it('reports a friendly error when the response shape is unfamiliar', async () => {
    await expect(
      hackerNewsProvider.search(query, fixtureFetch({ hits: [{ objectID: 41521098 }] })),
    ).rejects.toThrow('Hacker News returned an unfamiliar search format.');
  });

  it('captures an honest discussion reference without fetching anything', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const results = await hackerNewsProvider.search(query, fixtureFetch());
    const capture = await hackerNewsProvider.capture(results[1]!, fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(capture).toMatchObject({
      title: 'Ask HN: How do you audit Entra ID roles?',
      url: 'https://news.ycombinator.com/item?id=41398220',
    });
    expect(capture.content).toBe(
      [
        '# Ask HN: How do you audit Entra ID roles?',
        '',
        'Original URL: <https://news.ycombinator.com/item?id=41398220>',
        '',
        "dang: We moved our tenant last month. Here's what broke.",
        '',
        '## Discussion',
        '',
        '<https://news.ycombinator.com/item?id=41398220> — 128 points · 41 comments',
        '',
        'This is a Hacker News reference captured on 2026-07-21, not a snapshot of the page.',
        '',
      ].join('\n'),
    );
    vi.useRealTimers();
  });

  it('describes points and comments for the candidate card', async () => {
    const results = await hackerNewsProvider.search(query, fixtureFetch());
    expect(hackerNewsProvider.describeMeta(results[0]!)).toBe('312 points · 88 comments');
    expect(hackerNewsProvider.capturedVia(results[0]!)).toBe('search-reference');
  });
});
