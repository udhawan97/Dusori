import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const RepositorySchema = z.object({
  full_name: z.string(),
  html_url: z.string(),
  pushed_at: z.string(),
  stargazers_count: z.number(),
  description: z.string().nullish(),
  language: z.string().nullish(),
  license: z.object({ spdx_id: z.string().nullish() }).nullish(),
});
const SearchResponseSchema = z.object({ items: z.array(RepositorySchema) });
const ReadmeResponseSchema = z.object({ content: z.string() });

type Repository = z.infer<typeof RepositorySchema>;

function repoMeta(repo: Repository, updated: string): Record<string, string> {
  return {
    ...(repo.language ? { language: repo.language } : {}),
    ...(repo.license?.spdx_id ? { license: repo.license.spdx_id } : {}),
    stars: String(repo.stargazers_count),
    updated,
  };
}

function formatStars(stars: string): string {
  const count = Number(stars);
  if (!Number.isFinite(count)) return stars;
  return count > 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function fullName(candidate: ResearchCandidate): string {
  const name = candidate.key.slice('github:'.length);
  if (!/^[^/]+\/[^/]+$/u.test(name)) throw new Error('GitHub returned an invalid repository name.');
  return name;
}

/** `atob` yields a binary string, so the bytes need decoding before they read as text. */
function decodeBase64(content: string): string {
  const binary = atob(content.replace(/\s/gu, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function readReadme(name: string, fetchImpl: typeof fetch): Promise<string | null> {
  // A repository without a README must still be capturable, so every failure here
  // falls through to the reference stub instead of throwing.
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${name}/readme`);
    if (!response.ok) return null;
    const parsed = ReadmeResponseSchema.safeParse(await response.json());
    return parsed.success ? decodeBase64(parsed.data.content) : null;
  } catch {
    return null;
  }
}

function referenceStub(candidate: ResearchCandidate): string {
  const date = new Date().toISOString().slice(0, 10);
  return [
    `# ${candidate.title}`,
    '',
    `Original URL: <${candidate.url}>`,
    '',
    'README unavailable — GitHub did not return one for this repository.',
    '',
    ...(candidate.snippet ? [candidate.snippet, ''] : []),
    `This is a GitHub reference captured on ${date}, not a snapshot of the repository.`,
    '',
  ].join('\n');
}

export const GITHUB_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to GitHub (api.github.com) over HTTPS. Nothing else from your workspace is sent. Allow on this device?";

export const githubProvider: ResearchProvider = {
  disclosure: GITHUB_DISCLOSURE,
  id: 'github',
  label: 'GitHub',
  origins: ['https://api.github.com'],

  // The capture reports the exact path after the request. A missing README remains a
  // browser-ready reference and must never be promoted into quoted evidence.
  capturedVia: () => 'readme-extract',

  describeMeta: (candidate: ResearchCandidate): string =>
    [
      candidate.meta.stars ? `${formatStars(candidate.meta.stars)} stars` : '',
      candidate.meta.language ?? '',
      candidate.meta.license ?? '',
      candidate.meta.updated ? `updated ${candidate.meta.updated}` : '',
    ]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://api.github.com/search/repositories');
    url.search = new URLSearchParams({
      order: 'desc',
      per_page: '8',
      q: query.searchText,
      sort: 'stars',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('GitHub search could not read the repository search API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('GitHub returned an unfamiliar search format.');
    const items = parsed.data.items;
    return items.map((repo, index) => {
      // `pushed_at` is the "is this still alive?" signal a repository has; its
      // creation date says nothing about whether the code is still maintained.
      const pushedAt = new Date(repo.pushed_at).toISOString();
      return {
        communityScore: repo.stargazers_count,
        key: `github:${repo.full_name}`,
        kind: 'repo' as const,
        meta: repoMeta(repo, pushedAt.slice(0, 10)),
        provider: 'github',
        publishedAt: pushedAt,
        score: items.length - index,
        snippet: repo.description ?? '',
        title: repo.full_name,
        url: repo.html_url,
      };
    });
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const readme = await readReadme(fullName(candidate), fetchImpl);
    return {
      capturedVia: readme === null ? 'search-reference' : 'readme-extract',
      content:
        readme === null
          ? referenceStub(candidate)
          : cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, readme),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
