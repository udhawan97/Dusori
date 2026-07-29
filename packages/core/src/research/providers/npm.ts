import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const PackageSchema = z.object({
  date: z.string().nullish(),
  description: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
  links: z.object({ npm: z.string().nullish() }).nullish(),
  name: z.string(),
  version: z.string().nullish(),
});

const SearchResponseSchema = z.object({
  objects: z.array(
    z.object({
      package: PackageSchema,
      score: z.object({ detail: z.object({ popularity: z.number() }).nullish() }).nullish(),
    }),
  ),
});

const ManifestSchema = z.object({ name: z.string(), readme: z.string().nullish() });

/** Exactly what npm itself permits: an optional lowercase scope, then a lowercase package name. */
const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9._-]*\/)?[a-z0-9~][a-z0-9._-]*$/u;

function packageName(candidate: ResearchCandidate): string {
  const name = candidate.key.slice('npm:'.length);
  if (!PACKAGE_NAME.test(name)) throw new Error('npm returned an invalid package name.');
  return name;
}

export const NPM_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to the npm registry (registry.npmjs.org) over HTTPS. Nothing else from your workspace is sent. The public registry needs no key or account. Allow on this device?";

export const npmProvider: ResearchProvider = {
  id: 'npm',
  label: 'npm',
  disclosure: NPM_DISCLOSURE,
  origins: ['https://registry.npmjs.org'],

  capturedVia: () => 'api-extract',

  describeMeta: (candidate: ResearchCandidate): string =>
    [candidate.meta.version ? `v${candidate.meta.version}` : '', candidate.meta.keywords ?? '']
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://registry.npmjs.org/-/v1/search');
    url.search = new URLSearchParams({ size: '8', text: query.searchText }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('npm search could not read the registry search API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('npm returned an unfamiliar search format.');

    const objects = parsed.data.objects.slice(0, 8);
    return objects.map((object, index) => {
      const packageInfo = object.package;
      const popularity = object.score?.detail?.popularity;
      const keywords = packageInfo.keywords ?? [];
      return {
        // Popularity arrives as a 0–1 ratio; the shared ranker compares whole community signals.
        ...(popularity === undefined || popularity === null
          ? {}
          : { communityScore: Math.round(popularity * 100) }),
        key: `npm:${packageInfo.name}`,
        kind: 'docs' as const,
        meta: {
          ...(keywords.length ? { keywords: keywords.slice(0, 5).join(', ') } : {}),
          ...(packageInfo.version ? { version: packageInfo.version } : {}),
        },
        provider: 'npm',
        ...(packageInfo.date ? { publishedAt: packageInfo.date.slice(0, 10) } : {}),
        score: objects.length - index,
        snippet: (packageInfo.description ?? '').replace(/\s+/gu, ' ').trim(),
        title: packageInfo.name,
        url: packageInfo.links?.npm ?? `https://www.npmjs.com/package/${packageInfo.name}`,
      };
    });
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const name = packageName(candidate);
    // A scoped name carries a slash that would otherwise read as another registry path segment.
    const response = await fetchImpl(`https://registry.npmjs.org/${name.replace('/', '%2F')}`);
    if (!response.ok) throw new Error('npm capture could not read the package manifest.');
    const parsed = ManifestSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('npm returned an unfamiliar package format.');

    const readme = (parsed.data.readme ?? '').trim();
    const body =
      readme ||
      'This package publishes no readme. The registry entry above is a reference; read the repository for documentation.';
    return {
      content: cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, body),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
