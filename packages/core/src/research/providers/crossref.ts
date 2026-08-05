import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const AuthorSchema = z.object({ family: z.string().optional(), given: z.string().optional() });
const DateSchema = z.object({ 'date-parts': z.array(z.array(z.number().int())).optional() });
const WorkSchema = z.object({
  DOI: z.string(),
  URL: z.string().optional(),
  abstract: z.string().nullish(),
  author: z.array(AuthorSchema).optional(),
  'container-title': z.array(z.string()).optional(),
  'is-referenced-by-count': z.number().int().nonnegative().optional(),
  published: DateSchema.optional(),
  title: z.array(z.string()).min(1),
  type: z.string().optional(),
});
const SearchSchema = z.object({ message: z.object({ items: z.array(WorkSchema) }) });
const WorkResponseSchema = z.object({ message: WorkSchema });

type CrossrefWork = z.infer<typeof WorkSchema>;

function plainText(input: string | null | undefined): string {
  return (input ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim();
}

function authorsOf(work: CrossrefWork): string {
  return (work.author ?? [])
    .map((author) => [author.given, author.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

function dateOf(work: CrossrefWork): string | undefined {
  const parts = work.published?.['date-parts']?.[0];
  if (!parts?.[0]) return undefined;
  const [year, month = 1, day = 1] = parts;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function doiOf(candidate: ResearchCandidate): string {
  const doi = candidate.key.slice('crossref:'.length);
  if (!/^10\.\d{4,9}\/\S+$/iu.test(doi)) throw new Error('Crossref returned an invalid DOI.');
  return doi;
}

function workUrl(work: CrossrefWork): string {
  return `https://doi.org/${work.DOI}`;
}

export const CROSSREF_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to Crossref (api.crossref.org) over HTTPS. Nothing else from your workspace is sent. Crossref is a public scholarly metadata index and needs no key or account. Allow on this device?";

export const crossrefProvider: ResearchProvider = {
  id: 'crossref',
  label: 'Crossref',
  disclosure: CROSSREF_DISCLOSURE,
  origins: ['https://api.crossref.org'],

  capturedVia: () => 'api-abstract',

  describeMeta: (candidate) =>
    [candidate.meta.citations, candidate.meta.venue, candidate.meta.year, candidate.meta.authors]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://api.crossref.org/works');
    url.search = new URLSearchParams({
      'query.bibliographic': query.searchText,
      rows: '8',
      select: 'DOI,title,abstract,author,published,container-title,is-referenced-by-count,type,URL',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Crossref search could not read the works API.');
    const parsed = SearchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Crossref returned an unfamiliar search format.');

    const works = parsed.data.message.items.slice(0, 8);
    return works.map((work, index) => {
      const publishedAt = dateOf(work);
      const venue = work['container-title']?.[0] ?? '';
      const authors = authorsOf(work);
      const citations = work['is-referenced-by-count'];
      const abstract = plainText(work.abstract);
      return {
        ...(citations === undefined ? {} : { communityScore: citations }),
        key: `crossref:${work.DOI}`,
        kind: 'paper' as const,
        meta: {
          ...(authors ? { authors } : {}),
          ...(citations === undefined ? {} : { citations: `${citations} citations` }),
          ...(venue ? { venue } : {}),
          ...(publishedAt ? { year: publishedAt.slice(0, 4) } : {}),
        },
        provider: 'crossref',
        ...(publishedAt ? { publishedAt } : {}),
        score: works.length - index,
        snippet: abstract.length > 240 ? `${abstract.slice(0, 240).trimEnd()}…` : abstract,
        title: plainText(work.title[0] ?? ''),
        url: workUrl(work),
      };
    });
  },

  async capture(candidate: ResearchCandidate, fetchImpl: typeof fetch): Promise<ResearchCapture> {
    const doi = doiOf(candidate);
    const response = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!response.ok) throw new Error('Crossref capture could not read the work.');
    const parsed = WorkResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Crossref returned an unfamiliar work format.');
    const abstract = plainText(parsed.data.message.abstract);
    const body =
      abstract ||
      'Crossref has no abstract for this work. This saved item is a citation; read the publisher page for the full text.';
    return {
      capturedVia: abstract ? 'api-abstract' : 'search-reference',
      content: cappedMarkdown(
        `# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n${abstract ? '## Abstract\n\n' : ''}`,
        body,
      ),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
