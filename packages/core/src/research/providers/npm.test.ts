import { describe, expect, it, vi } from 'vitest';

import { maxSourceBytes } from '../../sources/import.js';
import { npmProvider } from './npm.js';

const query = {
  objectiveTitle: 'Talk to the cluster API',
  searchText: 'Kubernetes tooling Talk to the cluster API',
  terms: ['talk', 'cluster', 'api', 'kubernetes', 'tooling'],
  topicTitle: 'Kubernetes tooling',
};

const searchFixture = {
  objects: [
    {
      package: {
        date: '2021-06-01T00:00:00.000Z',
        description: 'Simplified Kubernetes API client.',
        keywords: ['kubernetes', 'client'],
        links: { npm: 'https://www.npmjs.com/package/kubernetes-client' },
        name: 'kubernetes-client',
        version: '9.0.0',
      },
      score: { detail: { maintenance: 0.4, popularity: 0.62, quality: 0.9 }, final: 0.7 },
    },
    {
      package: {
        date: '2016-07-01T00:01:06.938Z',
        description: 'Install Kubernetes from npm',
        name: '@scope/kubernetes',
        version: '1.0.0',
      },
      score: { detail: { maintenance: 0.1, popularity: 0.02, quality: 0.2 }, final: 0.1 },
    },
  ],
};

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('npm research provider', () => {
  it('names its exact egress host in the disclosure', () => {
    expect(npmProvider.disclosure).toContain('registry.npmjs.org');
  });

  it('parses packages into candidates carrying popularity and release date', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      Promise.resolve(response(searchFixture)),
    );

    const results = await npmProvider.search(query, fetchMock as unknown as typeof fetch);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      communityScore: 62,
      key: 'npm:kubernetes-client',
      kind: 'docs',
      provider: 'npm',
      publishedAt: '2021-06-01',
      snippet: 'Simplified Kubernetes API client.',
      title: 'kubernetes-client',
      url: 'https://www.npmjs.com/package/kubernetes-client',
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'text=Kubernetes+tooling+Talk+to+the+cluster+API',
    );
  });

  it('builds a package url when the registry omits the links block', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response(searchFixture)),
    ) as unknown as typeof fetch;

    const results = await npmProvider.search(query, fetchImpl);

    expect(results[1]?.url).toBe('https://www.npmjs.com/package/@scope/kubernetes');
  });

  it('describes the version and keywords on the candidate card', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response(searchFixture)),
    ) as unknown as typeof fetch;

    const [first] = await npmProvider.search(query, fetchImpl);

    expect(npmProvider.describeMeta(first!)).toContain('v9.0.0');
    expect(npmProvider.describeMeta(first!)).toContain('kubernetes');
  });

  it('captures the published readme as the source text', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      Promise.resolve(
        response({ name: 'kubernetes-client', readme: '# kubernetes-client\n\nUsage notes.' }),
      ),
    );
    const candidate = {
      key: 'npm:kubernetes-client',
      meta: {},
      provider: 'npm',
      score: 2,
      snippet: '',
      title: 'kubernetes-client',
      url: 'https://www.npmjs.com/package/kubernetes-client',
    };

    const capture = await npmProvider.capture(candidate, fetchMock as unknown as typeof fetch);

    expect(capture.content).toContain('Usage notes.');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://registry.npmjs.org/kubernetes-client',
    );
  });

  it('escapes the slash in a scoped package name rather than nesting a registry path', async () => {
    const fetchMock = vi.fn<(input: string | URL | Request) => Promise<Response>>(async () =>
      Promise.resolve(response({ name: '@scope/kubernetes', readme: '# scoped' })),
    );

    await npmProvider.capture(
      {
        key: 'npm:@scope/kubernetes',
        meta: {},
        provider: 'npm',
        score: 1,
        snippet: '',
        title: '@scope/kubernetes',
        url: 'https://www.npmjs.com/package/@scope/kubernetes',
      },
      fetchMock as unknown as typeof fetch,
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://registry.npmjs.org/@scope%2Fkubernetes',
    );
  });

  it('refuses a package name the registry could never have returned', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      npmProvider.capture(
        {
          key: 'npm:../../etc/passwd',
          meta: {},
          provider: 'npm',
          score: 1,
          snippet: '',
          title: 'Bad',
          url: 'https://example.com',
        },
        fetchImpl,
      ),
    ).rejects.toThrow(/invalid package name/iu);
  });

  it('explains itself when a package publishes no readme', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response({ name: 'bare', readme: '' })),
    ) as unknown as typeof fetch;

    const capture = await npmProvider.capture(
      {
        key: 'npm:bare',
        meta: {},
        provider: 'npm',
        score: 1,
        snippet: '',
        title: 'bare',
        url: 'https://www.npmjs.com/package/bare',
      },
      fetchImpl,
    );

    expect(capture.content).toContain('publishes no readme');
  });

  it('truncates a long readme below the source cap', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response({ name: 'long', readme: 'é'.repeat(maxSourceBytes) })),
    ) as unknown as typeof fetch;

    const capture = await npmProvider.capture(
      {
        key: 'npm:long',
        meta: {},
        provider: 'npm',
        score: 1,
        snippet: '',
        title: 'long',
        url: 'https://www.npmjs.com/package/long',
      },
      fetchImpl,
    );

    expect(new TextEncoder().encode(capture.content).byteLength).toBeLessThanOrEqual(
      maxSourceBytes,
    );
  });
});
