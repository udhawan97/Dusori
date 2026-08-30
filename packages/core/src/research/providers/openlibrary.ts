import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const SentenceSchema = z.union([z.string(), z.array(z.string())]);
const SearchDocumentSchema = z.object({
  author_name: z.array(z.string()).optional(),
  edition_count: z.number().int().nonnegative().optional(),
  first_publish_year: z.number().int().optional(),
  first_sentence: SentenceSchema.optional(),
  isbn: z.array(z.string()).optional(),
  key: z.string(),
  subject: z.array(z.string()).optional(),
  title: z.string(),
});
const SearchSchema = z.object({ docs: z.array(SearchDocumentSchema) });
const WorkSchema = z.object({
  description: z.union([z.string(), z.object({ value: z.string() })]).nullish(),
  first_sentence: SentenceSchema.nullish(),
});

function textOf(value: z.infer<typeof SentenceSchema> | null | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function workKey(candidate: ResearchCandidate): string {
  const key = candidate.key.slice('openlibrary:'.length);
  if (!/^OL\d+W$/u.test(key)) throw new Error('Open Library returned an invalid work key.');
  return key;
}

export const OPEN_LIBRARY_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to Open Library (openlibrary.org) over HTTPS. Nothing else from your workspace is sent. Open Library's public book index needs no key or account. Allow on this device?";

export const openLibraryProvider: ResearchProvider = {
  id: 'openlibrary',
  label: 'Open Library',
  disclosure: OPEN_LIBRARY_DISCLOSURE,
  origins: ['https://openlibrary.org'],

  capturedVia: () => 'search-reference',

  describeMeta: (candidate) =>
    [candidate.meta.year, candidate.meta.editions, candidate.meta.authors]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://openlibrary.org/search.json');
    url.search = new URLSearchParams({
      fields: 'key,title,author_name,first_publish_year,edition_count,first_sentence,subject,isbn',
      limit: '8',
      q: query.searchText,
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Open Library search could not read the books API.');
    const parsed = SearchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Open Library returned an unfamiliar search format.');

    const works = parsed.data.docs
      .filter((work) => /^\/works\/OL\d+W$/u.test(work.key))
      .slice(0, 8);
    return works.map((work, index) => {
      const firstSentence = textOf(work.first_sentence).replace(/\s+/gu, ' ').trim();
      const subjects = (work.subject ?? []).slice(0, 4).join(', ');
      const authors = (work.author_name ?? []).slice(0, 3).join(', ');
      const snippet = firstSentence || [authors, subjects].filter(Boolean).join(' · ');
      const key = work.key.slice('/works/'.length);
      return {
        identifiers: [
          { scheme: 'openlibrary', value: key },
          ...(work.isbn ?? []).slice(0, 8).map((value) => ({ scheme: 'isbn', value })),
        ],
        key: `openlibrary:${key}`,
        kind: 'book' as const,
        meta: {
          ...(authors ? { authors } : {}),
          ...(work.edition_count === undefined
            ? {}
            : { editions: `${work.edition_count} editions` }),
          ...(work.first_publish_year ? { year: String(work.first_publish_year) } : {}),
        },
        provider: 'openlibrary',
        ...(work.first_publish_year ? { publishedAt: `${work.first_publish_year}-01-01` } : {}),
        score: works.length - index,
        snippet: snippet.length > 240 ? `${snippet.slice(0, 240).trimEnd()}…` : snippet,
        title: work.title.replace(/\s+/gu, ' ').trim(),
        url: `https://openlibrary.org${work.key}`,
      };
    });
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const key = workKey(candidate);
    const response = await fetchImpl(`https://openlibrary.org/works/${key}.json`);
    if (!response.ok) throw new Error('Open Library capture could not read the work.');
    const parsed = WorkSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Open Library returned an unfamiliar work format.');
    const description =
      typeof parsed.data.description === 'string'
        ? parsed.data.description
        : (parsed.data.description?.value ?? textOf(parsed.data.first_sentence));
    const body =
      description.trim() ||
      'Open Library has no description for this work. This saved item is a book reference; open the record to inspect editions or borrowable copies.';
    return {
      capturedVia: description.trim() ? 'catalog-description' : 'search-reference',
      content: cappedMarkdown(
        `# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n## Catalog description\n\n`,
        body,
      ),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
