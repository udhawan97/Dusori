import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const ResultSchema = z.object({
  abstractText: z.string().nullish(),
  authorString: z.string().nullish(),
  citedByCount: z.number().int().nonnegative().optional(),
  doi: z.string().nullish(),
  firstPublicationDate: z.string().nullish(),
  id: z.string(),
  isOpenAccess: z.string().nullish(),
  journalInfo: z
    .object({ journal: z.object({ title: z.string().nullish() }).optional() })
    .optional(),
  pmcid: z.string().nullish(),
  pmid: z.string().nullish(),
  source: z.string(),
  title: z.string(),
});
const SearchSchema = z.object({ resultList: z.object({ result: z.array(ResultSchema) }) });

type EuropePmcResult = z.infer<typeof ResultSchema>;

const maxAbstractCharacters = 100_000;

function plainText(input: string | null | undefined): string {
  return (input ?? '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&#39;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
}

function validIdentifier(input: string): boolean {
  return /^[A-Z0-9._-]+$/iu.test(input);
}

function doiOf(result: EuropePmcResult): string | null {
  const doi = plainText(result.doi);
  return /^10\.\d{4,9}\/\S+$/iu.test(doi) ? doi : null;
}

function articleUrl(result: EuropePmcResult): string {
  const doi = doiOf(result);
  if (doi) return `https://doi.org/${doi}`;
  return `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`;
}

function publishedAtOf(result: EuropePmcResult): string | undefined {
  const date = result.firstPublicationDate ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/u.test(date)) return date;
  if (/^\d{4}$/u.test(date)) return `${date}-01-01`;
  return undefined;
}

export const EUROPE_PMC_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to Europe PMC (www.ebi.ac.uk) over HTTPS. Nothing else from your workspace is sent. Europe PMC is a public life-sciences literature index and needs no key or account. Allow on this device?";

export const europePmcProvider: ResearchProvider = {
  id: 'europepmc',
  label: 'Europe PMC',
  disclosure: EUROPE_PMC_DISCLOSURE,
  origins: ['https://www.ebi.ac.uk'],

  capturedVia: (candidate) => (candidate.meta._abstract ? 'api-abstract' : 'search-reference'),

  describeMeta: (candidate) =>
    [
      candidate.meta.citations,
      candidate.meta.journal,
      candidate.meta.year,
      candidate.meta.author,
      candidate.meta.openAccess,
    ]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://www.ebi.ac.uk/europepmc/webservices/rest/search');
    url.search = new URLSearchParams({
      format: 'json',
      pageSize: '8',
      query: query.searchText,
      resultType: 'core',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Europe PMC search could not read the articles API.');
    const parsed = SearchSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Europe PMC returned an unfamiliar search format.');

    const results = parsed.data.resultList.result
      .filter((result) => validIdentifier(result.source) && validIdentifier(result.id))
      .slice(0, 8);
    return results.map((result, index) => {
      const abstract = plainText(result.abstractText).slice(0, maxAbstractCharacters);
      const author = plainText(result.authorString).slice(0, 160);
      const journal = plainText(result.journalInfo?.journal?.title);
      const publishedAt = publishedAtOf(result);
      const citations = result.citedByCount;
      const doi = doiOf(result);
      return {
        ...(citations === undefined ? {} : { communityScore: citations }),
        key: `europepmc:${result.source}:${result.id}`,
        kind: 'paper' as const,
        meta: {
          ...(abstract ? { _abstract: abstract } : {}),
          ...(author ? { author } : {}),
          ...(citations === undefined ? {} : { citations: `${citations} citations` }),
          ...(doi ? { doi } : {}),
          ...(journal ? { journal } : {}),
          ...(result.isOpenAccess === 'Y' ? { openAccess: 'open-access record' } : {}),
          ...(result.pmcid ? { pmcid: result.pmcid } : {}),
          ...(result.pmid ? { pmid: result.pmid } : {}),
          ...(publishedAt ? { year: publishedAt.slice(0, 4) } : {}),
        },
        provider: 'europepmc',
        ...(publishedAt ? { publishedAt } : {}),
        score: results.length - index,
        snippet: abstract.length > 240 ? `${abstract.slice(0, 240).trimEnd()}…` : abstract,
        title: plainText(result.title).slice(0, 160),
        url: articleUrl(result),
      };
    });
  },

  async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
    const abstract = candidate.meta._abstract ?? '';
    const identifiers = [
      candidate.meta.doi ? `- DOI: ${candidate.meta.doi}` : '',
      candidate.meta.pmid ? `- PMID: ${candidate.meta.pmid}` : '',
      candidate.meta.pmcid ? `- PMCID: ${candidate.meta.pmcid}` : '',
    ].filter(Boolean);
    const body = abstract
      ? `${identifiers.length ? `${identifiers.join('\n')}\n\n` : ''}## Abstract\n\n${abstract}`
      : `${identifiers.length ? `${identifiers.join('\n')}\n\n` : ''}Europe PMC returned metadata but no abstract for this record. This saved item is a citation reference, not the full paper.`;
    return {
      capturedVia: abstract ? 'api-abstract' : 'search-reference',
      content: cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, body),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
