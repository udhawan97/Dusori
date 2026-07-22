import { describe, expect, it, vi } from 'vitest';

import { githubProvider } from './github.js';

const query = {
  objectiveTitle: 'Configure Microsoft Entra ID',
  searchText: 'Azure administration Configure Microsoft Entra ID',
  terms: ['configure', 'microsoft', 'entra', 'id', 'azure', 'administration'],
  topicTitle: 'Azure administration',
};

const searchFixture = {
  incomplete_results: false,
  items: [
    {
      description: 'A curated list of delightful Azure administration tooling.',
      full_name: 'contoso/azure-admin-kit',
      html_url: 'https://github.com/contoso/azure-admin-kit',
      language: 'TypeScript',
      license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT' },
      pushed_at: '2026-06-01T09:12:33Z',
      stargazers_count: 4200,
    },
    {
      description: null,
      full_name: 'fabrikam/entra-scripts',
      html_url: 'https://github.com/fabrikam/entra-scripts',
      language: null,
      license: null,
      pushed_at: '2025-01-09T23:00:00Z',
      stargazers_count: 12,
    },
  ],
  total_count: 2,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('GitHub research provider', () => {
  it('maps repositories to ranked candidates and describes their metadata', async () => {
    let requested = '';
    const fetchImpl = (async (input: string | URL | Request) => {
      requested = String(input);
      return response(searchFixture);
    }) as unknown as typeof fetch;
    const results = await githubProvider.search(query, fetchImpl);

    expect(requested).toContain('https://api.github.com/search/repositories?');
    expect(requested).toContain('q=Azure+administration+Configure+Microsoft+Entra+ID');
    expect(requested).toContain('sort=stars');
    expect(requested).toContain('order=desc');
    expect(requested).toContain('per_page=8');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      communityScore: 4200,
      key: 'github:contoso/azure-admin-kit',
      kind: 'repo',
      meta: {
        language: 'TypeScript',
        license: 'MIT',
        stars: '4200',
        updated: '2026-06-01',
      },
      provider: 'github',
      publishedAt: '2026-06-01T09:12:33.000Z',
      score: 2,
      snippet: 'A curated list of delightful Azure administration tooling.',
      title: 'contoso/azure-admin-kit',
      url: 'https://github.com/contoso/azure-admin-kit',
    });
    expect(results[1]).toEqual({
      communityScore: 12,
      key: 'github:fabrikam/entra-scripts',
      kind: 'repo',
      meta: { stars: '12', updated: '2025-01-09' },
      provider: 'github',
      publishedAt: '2025-01-09T23:00:00.000Z',
      score: 1,
      snippet: '',
      title: 'fabrikam/entra-scripts',
      url: 'https://github.com/fabrikam/entra-scripts',
    });

    expect(githubProvider.describeMeta(results[0]!)).toBe(
      '4.2k stars · TypeScript · MIT · updated 2026-06-01',
    );
    expect(githubProvider.describeMeta(results[1]!)).toBe('12 stars · updated 2025-01-09');
  });

  it('reports a friendly error when the search API refuses', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response({ message: 'rate limited' }, 403)),
    ) as unknown as typeof fetch;

    await expect(githubProvider.search(query, fetchImpl)).rejects.toThrow(
      'GitHub search could not read the repository search API.',
    );
  });

  it('reports a friendly error when the search shape is unfamiliar', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response({ items: [{ full_name: 42 }] })),
    ) as unknown as typeof fetch;

    await expect(githubProvider.search(query, fetchImpl)).rejects.toThrow(
      'GitHub returned an unfamiliar search format.',
    );
  });

  it('captures the README and decodes non-ASCII content correctly', async () => {
    const readme = '# azure-admin-kit\n\nUn café ☕ and 日本語 in the intro.';
    let requested = '';
    const fetchImpl = (async (input: string | URL | Request) => {
      requested = String(input);
      return response({ content: `${base64(readme)}\n`, encoding: 'base64', name: 'README.md' });
    }) as unknown as typeof fetch;
    const [candidate] = await githubProvider.search(query, (async () =>
      response(searchFixture)) as unknown as typeof fetch);

    const capture = await githubProvider.capture(candidate!, fetchImpl);

    expect(requested).toBe('https://api.github.com/repos/contoso/azure-admin-kit/readme');
    expect(capture).toEqual({
      content: `# contoso/azure-admin-kit\n\nOriginal URL: <https://github.com/contoso/azure-admin-kit>\n\n${readme}\n`,
      title: 'contoso/azure-admin-kit',
      url: 'https://github.com/contoso/azure-admin-kit',
    });
    expect(githubProvider.capturedVia(candidate!)).toBe('readme-extract');
  });

  it('falls back to an honest reference stub when the repository has no README', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T10:00:00.000Z'));
    const fetchImpl = vi.fn(async () =>
      Promise.resolve(response({ message: 'Not Found' }, 404)),
    ) as unknown as typeof fetch;
    const [candidate] = await githubProvider.search(query, (async () =>
      response(searchFixture)) as unknown as typeof fetch);

    const capture = await githubProvider.capture(candidate!, fetchImpl);

    expect(capture.content).toContain('# contoso/azure-admin-kit');
    expect(capture.content).toContain('Original URL: <https://github.com/contoso/azure-admin-kit>');
    expect(capture.content).toContain('README unavailable');
    expect(capture.content).toContain('A curated list of delightful Azure administration tooling.');
    expect(capture.content).toContain(
      'This is a GitHub reference captured on 2026-07-21, not a snapshot of the repository.',
    );
    vi.useRealTimers();
  });
});
