import { z } from 'zod';

import { maxSourceBytes } from '../../sources/import.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const SearchResultSchema = z.object({
  pageid: z.number().int().nonnegative(),
  snippet: z.string(),
  title: z.string(),
  size: z.number().int().nonnegative().optional(),
  wordcount: z.number().int().nonnegative().optional(),
});
const SearchResponseSchema = z.object({
  query: z.object({ search: z.array(SearchResultSchema) }),
});
const ExtractPageSchema = z.object({
  extract: z.string(),
  pageid: z.number().int().nonnegative(),
  title: z.string(),
});
const ExtractResponseSchema = z.object({
  query: z.object({ pages: z.record(z.string(), ExtractPageSchema) }),
});

function decodeEntity(entity: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  if (entity.startsWith('#x')) {
    const value = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  if (entity.startsWith('#')) {
    const value = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : `&${entity};`;
  }
  return named[entity] ?? `&${entity};`;
}

function plainSnippet(input: string): string {
  return input
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (_match, entity: string) =>
      decodeEntity(entity.toLowerCase()),
    )
    .replace(/\s+/gu, ' ')
    .trim();
}

function pageId(candidate: ResearchCandidate): string {
  const id = candidate.key.slice('wikipedia:'.length);
  if (!/^\d+$/u.test(id)) throw new Error('Wikipedia returned an invalid page identifier.');
  return id;
}

function cappedContent(title: string, url: string, extract: string): string {
  const prefix = `# ${title}\n\nOriginal URL: <${url}>\n\n`;
  const content = `${prefix}${extract}\n`;
  const encoder = new TextEncoder();
  if (encoder.encode(content).byteLength <= maxSourceBytes) return content;

  const marker = '\n\n[truncated]\n';
  const available =
    maxSourceBytes - encoder.encode(prefix).byteLength - encoder.encode(marker).byteLength;
  const bytes = encoder.encode(extract);
  const truncated = new TextDecoder().decode(bytes.slice(0, Math.max(0, available)));
  let result = `${prefix}${truncated}${marker}`;
  while (encoder.encode(result).byteLength > maxSourceBytes) {
    result = `${prefix}${truncated.slice(0, -(encoder.encode(result).byteLength - maxSourceBytes))}${marker}`;
  }
  return result;
}

export const WIKIPEDIA_DISCLOSURE =
  "Searching sends this objective's text to Wikipedia (en.wikipedia.org) over HTTPS. Nothing else from your workspace is sent. Allow on this device?";

export const wikipediaProvider: ResearchProvider = {
  id: 'wikipedia',
  label: 'Wikipedia',
  disclosure: WIKIPEDIA_DISCLOSURE,

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      list: 'search',
      origin: '*',
      srlimit: '8',
      srsearch: query.objectiveTitle,
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Wikipedia search could not read the search API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Wikipedia returned an unfamiliar search format.');
    const results = parsed.data.query.search.slice(0, 8);
    return results.map((result, index) => ({
      key: `wikipedia:${result.pageid}`,
      meta: {
        ...(result.size === undefined ? {} : { size: String(result.size) }),
        ...(result.wordcount === undefined ? {} : { wordcount: String(result.wordcount) }),
      },
      provider: 'wikipedia',
      score: results.length - index,
      snippet: plainSnippet(result.snippet),
      title: result.title.replace(/\s+/gu, ' ').trim(),
      url: `https://en.wikipedia.org/?curid=${result.pageid}`,
    }));
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const id = pageId(candidate);
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      explaintext: '1',
      format: 'json',
      origin: '*',
      pageids: id,
      prop: 'extracts',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Wikipedia capture could not read the page extract.');
    const parsed = ExtractResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Wikipedia returned an unfamiliar extract format.');
    const page = parsed.data.query.pages[id];
    if (!page) throw new Error('Wikipedia did not return the selected page.');
    return {
      content: cappedContent(candidate.title, candidate.url, page.extract),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
