import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const TextListSchema = z.union([z.string(), z.array(z.string())]);
const ResultSchema = z
  .object({
    contributor: TextListSchema.nullish(),
    date: z.string().nullish(),
    description: TextListSchema.nullish(),
    id: z.string().nullish(),
    original_format: TextListSchema.nullish(),
    title: z.string(),
    type: TextListSchema.nullish(),
    url: z.string().nullish(),
  })
  .passthrough();
const SearchSchema = z.object({ results: z.array(ResultSchema) });

type LibraryResult = z.infer<typeof ResultSchema>;

export interface LibraryOfCongressProviderOptions {
  minimumIntervalMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function listOf(value: z.infer<typeof TextListSchema> | null | undefined): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function plainText(input: string | null | undefined): string {
  return (input ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#x27;|&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/&#xA;/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function itemUrlOf(result: LibraryResult): string | null {
  for (const candidate of [result.url, result.id]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const segments = url.pathname.split('/').filter(Boolean);
      if (
        url.hostname !== 'www.loc.gov' ||
        segments[0] !== 'item' ||
        segments.length < 2 ||
        segments.slice(1).some((segment) => !/^[A-Z0-9._~-]+$/iu.test(segment))
      ) {
        continue;
      }
      url.protocol = 'https:';
      url.username = '';
      url.password = '';
      url.port = '';
      url.search = '';
      url.hash = '';
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      return url.toString();
    } catch {
      // Heterogeneous records sometimes carry a non-URL identifier; those are not item links.
    }
  }
  return null;
}

function publishedAtOf(input: string | null | undefined): string | undefined {
  const date = input ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) return date;
  if (/^\d{4}$/u.test(date)) return `${date}-01-01`;
  return undefined;
}

function kindOf(formats: string[]): 'article' | 'book' | 'video' {
  const text = formats.join(' ').toLowerCase();
  if (/\b(?:book|printed material)\b/u.test(text)) return 'book';
  if (/\b(?:film|video)\b/u.test(text)) return 'video';
  return 'article';
}

function retryAfterMilliseconds(value: string | null, now: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60 * 60 * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.min(Math.max(date - now, 0), 60 * 60 * 1000);
}

export const LIBRARY_OF_CONGRESS_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to the Library of Congress (www.loc.gov) over HTTPS. Nothing else from your workspace is sent. Its public digital-collections index needs no key or account. Dusori saves catalog references, not collection media. Allow on this device?";

export function createLibraryOfCongressProvider(
  options: LibraryOfCongressProviderOptions = {},
): ResearchProvider {
  const minimumIntervalMs = options.minimumIntervalMs ?? 3_000;
  const now = options.now ?? Date.now;
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let nextStartAt = 0;
  let backoffUntil = 0;
  let gate = Promise.resolve();

  async function reserveRequestStart(): Promise<void> {
    let release = (): void => undefined;
    const previous = gate;
    gate = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      const backoffRemaining = backoffUntil - now();
      if (backoffRemaining > 0) {
        throw new Error('The Library of Congress asked Dusori to wait before another search.');
      }
      const intervalRemaining = nextStartAt - now();
      if (intervalRemaining > 0) await wait(intervalRemaining);
      // A previous request can receive 429 while this reservation is waiting for the ordinary
      // three-second interval. Re-check before starting so queued work cannot slip through a new
      // Retry-After backoff.
      if (backoffUntil - now() > 0) {
        throw new Error('The Library of Congress asked Dusori to wait before another search.');
      }
      nextStartAt = now() + minimumIntervalMs;
    } finally {
      release();
    }
  }

  return {
    id: 'loc',
    label: 'Library of Congress',
    disclosure: LIBRARY_OF_CONGRESS_DISCLOSURE,
    origins: ['https://www.loc.gov'],

    capturedVia: () => 'search-reference',

    describeMeta: (candidate) =>
      [candidate.meta.format, candidate.meta.date, candidate.meta.contributor]
        .filter(Boolean)
        .join(' · '),

    async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
      await reserveRequestStart();
      const url = new URL('https://www.loc.gov/search/');
      url.search = new URLSearchParams({
        at: 'results',
        c: '24',
        fa: 'digitized:true',
        fo: 'json',
        q: query.searchText,
      }).toString();
      const response = await fetchImpl(url.toString());
      if (response.status === 429) {
        backoffUntil = Math.max(
          backoffUntil,
          now() + retryAfterMilliseconds(response.headers.get('retry-after'), now()),
        );
        throw new Error('The Library of Congress rate-limited this search.');
      }
      if (!response.ok) throw new Error('The Library of Congress search API was unavailable.');
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new Error('The Library of Congress returned a non-JSON search response.');
      }
      const parsed = SearchSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error('The Library of Congress returned an unfamiliar search format.');
      }

      const accepted = parsed.data.results
        .flatMap((result) => {
          const url = itemUrlOf(result);
          return url ? [{ result, url }] : [];
        })
        .slice(0, 8);
      return accepted.map(({ result, url }, index) => {
        const description = plainText(listOf(result.description)[0]);
        const contributor = listOf(result.contributor)
          .map(plainText)
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')
          .slice(0, 160);
        const formats = listOf(result.original_format).map(plainText).filter(Boolean);
        const publishedAt = publishedAtOf(result.date);
        const key = new URL(url).pathname.replace(/^\/item\//u, '').replace(/\/$/u, '');
        return {
          key: `loc:${key}`,
          kind: kindOf(formats),
          meta: {
            ...(contributor ? { author: contributor, contributor } : {}),
            ...(result.date ? { date: plainText(result.date) } : {}),
            ...(description ? { _description: description.slice(0, 100_000) } : {}),
            ...(formats.length ? { format: formats.slice(0, 3).join(', ') } : {}),
          },
          provider: 'loc',
          ...(publishedAt ? { publishedAt } : {}),
          score: accepted.length - index,
          snippet:
            description.length > 240 ? `${description.slice(0, 240).trimEnd()}…` : description,
          title: plainText(result.title).slice(0, 160),
          url,
        };
      });
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const description = candidate.meta._description ?? '';
      const details = [
        candidate.meta.format ? `- Format: ${candidate.meta.format}` : '',
        candidate.meta.date ? `- Date: ${candidate.meta.date}` : '',
        candidate.meta.contributor ? `- Contributor: ${candidate.meta.contributor}` : '',
      ].filter(Boolean);
      const body = [
        ...details,
        details.length ? '' : '',
        description || 'The Library of Congress returned no catalog description for this item.',
        '',
        'This is a catalog reference. Dusori did not fetch collection media or infer reuse rights.',
      ].join('\n');
      return {
        capturedVia: 'search-reference',
        content: cappedMarkdown(
          `# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n## Catalog record\n\n`,
          body,
        ),
        title: candidate.title,
        url: candidate.url,
      };
    },
  };
}

export const libraryOfCongressProvider = createLibraryOfCongressProvider();
