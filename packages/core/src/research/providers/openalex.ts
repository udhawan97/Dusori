import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const InvertedIndexSchema = z.record(z.string(), z.array(z.number().int().nonnegative()));

const WorkSchema = z.object({
  abstract_inverted_index: InvertedIndexSchema.nullish(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string() }) })).optional(),
  cited_by_count: z.number().int().nonnegative().optional(),
  display_name: z.string(),
  doi: z.string().nullish(),
  id: z.string(),
  primary_location: z
    .object({
      landing_page_url: z.string().nullish(),
      source: z.object({ display_name: z.string() }).nullish(),
    })
    .nullish(),
  publication_date: z.string().nullish(),
  publication_year: z.number().int().nullish(),
  type: z.string().nullish(),
});

const SearchResponseSchema = z.object({ results: z.array(WorkSchema) });

type Work = z.infer<typeof WorkSchema>;

/**
 * OpenAlex ships abstracts as an inverted index — every word mapped to the positions it occupies —
 * because publishers license the index but not the running text. Rebuilding it locally is what
 * turns a citation into a readable source without fetching the paper itself.
 */
function abstractFrom(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }
  return words.join(' ').replace(/\s+/gu, ' ').trim();
}

function workKey(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

function workId(candidate: ResearchCandidate): string {
  const id = candidate.key.slice('openalex:'.length);
  if (!/^W\d+$/u.test(id)) throw new Error('OpenAlex returned an invalid work identifier.');
  return id;
}

function workUrl(work: Work): string {
  return work.doi ?? work.primary_location?.landing_page_url ?? work.id;
}

function truncateSnippet(text: string): string {
  return text.length > 240 ? `${text.slice(0, 240).trimEnd()}…` : text;
}

export const OPENALEX_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to OpenAlex (api.openalex.org) over HTTPS. Nothing else from your workspace is sent. OpenAlex is an open scholarly index and needs no key or account. Allow on this device?";

export const openAlexProvider: ResearchProvider = {
  id: 'openalex',
  label: 'OpenAlex',
  disclosure: OPENALEX_DISCLOSURE,
  origins: ['https://api.openalex.org'],

  capturedVia: () => 'api-extract',

  describeMeta: (candidate: ResearchCandidate): string =>
    [
      candidate.meta.citations ? `${candidate.meta.citations} citations` : '',
      candidate.meta.venue ?? '',
      candidate.meta.year ?? '',
      candidate.meta.authors ?? '',
    ]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://api.openalex.org/works');
    url.search = new URLSearchParams({
      'per-page': '8',
      search: query.searchText,
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('OpenAlex search could not read the works API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('OpenAlex returned an unfamiliar search format.');

    const works = parsed.data.results.slice(0, 8);
    return works.map((work, index) => {
      const authors = (work.authorships ?? []).map((entry) => entry.author.display_name);
      const venue = work.primary_location?.source?.display_name ?? '';
      return {
        ...(work.cited_by_count === undefined ? {} : { communityScore: work.cited_by_count }),
        key: `openalex:${workKey(work.id)}`,
        kind: 'paper' as const,
        meta: {
          ...(authors.length ? { authors: authors.slice(0, 3).join(', ') } : {}),
          ...(work.cited_by_count === undefined ? {} : { citations: String(work.cited_by_count) }),
          ...(venue ? { venue } : {}),
          ...(work.publication_year ? { year: String(work.publication_year) } : {}),
        },
        provider: 'openalex',
        ...(work.publication_date ? { publishedAt: work.publication_date } : {}),
        score: works.length - index,
        snippet: truncateSnippet(abstractFrom(work.abstract_inverted_index)),
        title: work.display_name.replace(/\s+/gu, ' ').trim(),
        url: workUrl(work),
      };
    });
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const id = workId(candidate);
    const response = await fetchImpl(`https://api.openalex.org/works/${id}`);
    if (!response.ok) throw new Error('OpenAlex capture could not read the work.');
    const parsed = WorkSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('OpenAlex returned an unfamiliar work format.');

    const abstract = abstractFrom(parsed.data.abstract_inverted_index);
    const body =
      abstract ||
      'OpenAlex has no abstract for this work. The record above is a citation; read the publisher page for the full text.';
    return {
      capturedVia: abstract ? 'api-abstract' : 'search-reference',
      content: cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, body),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
