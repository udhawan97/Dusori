import { describe, expect, it, vi } from 'vitest';

import { openLibraryProvider } from './openlibrary.js';
import { isReadableResearchCapture } from '../types.js';

const query = {
  objectiveTitle: 'Understand distributed systems',
  searchText: 'Distributed systems Understand distributed systems',
  terms: ['understand', 'distributed', 'systems'],
  topicTitle: 'Distributed systems',
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('Open Library research provider', () => {
  it('turns public book-search records into book candidates', async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        docs: [
          {
            author_name: ['Martin Kleppmann'],
            edition_count: 12,
            first_publish_year: 2017,
            first_sentence: ['Data systems have changed radically.'],
            isbn: ['978-1-4493-7332-0', 'invalid-isbn'],
            key: '/works/OL17898000W',
            subject: ['Distributed systems'],
            title: 'Designing Data-Intensive Applications',
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const [candidate] = await openLibraryProvider.search(query, fetchImpl);

    expect(candidate).toMatchObject({
      key: 'openlibrary:OL17898000W',
      kind: 'book',
      identifiers: [
        { scheme: 'openlibrary', value: 'OL17898000W' },
        { scheme: 'isbn', value: '978-1-4493-7332-0' },
        { scheme: 'isbn', value: 'invalid-isbn' },
      ],
      provider: 'openlibrary',
      publishedAt: '2017-01-01',
      snippet: 'Data systems have changed radically.',
      url: 'https://openlibrary.org/works/OL17898000W',
    });
    expect(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('isbn');
  });

  it('captures a work description but keeps a missing description as a reference', async () => {
    const candidate = {
      key: 'openlibrary:OL17898000W',
      meta: {},
      provider: 'openlibrary',
      score: 1,
      snippet: '',
      title: 'Designing Data-Intensive Applications',
      url: 'https://openlibrary.org/works/OL17898000W',
    };
    const readableFetch = vi.fn(async () =>
      response({ description: { value: 'A guide to reliable data systems.' } }),
    ) as unknown as typeof fetch;

    const readable = await openLibraryProvider.capture(candidate, readableFetch);
    expect(readable.capturedVia).toBe('catalog-description');
    expect(readable.content).toContain('## Catalog description');
    expect(isReadableResearchCapture(readable.capturedVia ?? '')).toBe(false);
    expect(readable.content).toContain('A guide to reliable data systems.');

    const referenceFetch = vi.fn(async () => response({})) as unknown as typeof fetch;
    const reference = await openLibraryProvider.capture(candidate, referenceFetch);
    expect(reference.capturedVia).toBe('search-reference');
    expect(reference.content).toContain('no description');
  });
});
