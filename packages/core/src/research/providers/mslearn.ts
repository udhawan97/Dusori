import { z } from 'zod';

import { compareCandidateScores, scoreCandidate } from '../score.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const catalogUrl = 'https://learn.microsoft.com/api/catalog/?type=modules';

const ModuleSchema = z.object({
  title: z.string(),
  summary: z.string(),
  url: z.url(),
  uid: z.string(),
  popularity: z.number(),
  duration_in_minutes: z.number().optional(),
  levels: z.array(z.string()).optional(),
  products: z.array(z.string()).optional(),
});

const CatalogSchema = z.object({ modules: z.array(ModuleSchema) });
type CatalogModule = z.infer<typeof ModuleSchema>;

let catalogPromise: Promise<CatalogModule[]> | null = null;

async function readCatalog(fetchImpl: typeof fetch): Promise<CatalogModule[]> {
  catalogPromise ??= (async () => {
    const response = await fetchImpl(catalogUrl);
    if (!response.ok) throw new Error('Microsoft Learn search could not read the module catalog.');
    const parsed = CatalogSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Microsoft Learn returned an unfamiliar catalog format.');
    }
    return parsed.data.modules;
  })().catch((error: unknown) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

function moduleMeta(module: CatalogModule): Record<string, string> {
  return {
    ...(module.duration_in_minutes === undefined
      ? {}
      : { duration_in_minutes: String(module.duration_in_minutes) }),
    ...(module.levels?.length ? { levels: module.levels.join(', ') } : {}),
    ...(module.products?.length ? { products: module.products.join(', ') } : {}),
  };
}

function metadataLines(candidate: ResearchCandidate): string[] {
  const suffix = candidate.key.slice('mslearn:'.length);
  const lines = suffix.startsWith('http') ? [] : [`- Module UID: ${suffix}`];
  const duration = candidate.meta.duration_in_minutes;
  if (duration) lines.push(`- Duration: ${duration} minutes`);
  if (candidate.meta.levels) lines.push(`- Levels: ${candidate.meta.levels}`);
  if (candidate.meta.products) lines.push(`- Products: ${candidate.meta.products}`);
  return lines;
}

async function catalogSearch(
  query: ResearchQuery,
  fetchImpl: typeof fetch,
): Promise<ResearchCandidate[]> {
  const modules = await readCatalog(fetchImpl);
  return modules
    .map((module) => ({
      key: `mslearn:${module.uid}`,
      meta: moduleMeta(module),
      popularity: module.popularity,
      provider: 'mslearn' as const,
      score: scoreCandidate(query, module),
      snippet: module.summary,
      title: module.title.replace(/\s+/gu, ' ').trim(),
      url: module.url,
    }))
    .sort(compareCandidateScores)
    .slice(0, 8)
    .map((candidate) => ({
      key: candidate.key,
      meta: candidate.meta,
      provider: candidate.provider,
      score: candidate.score,
      snippet: candidate.snippet,
      title: candidate.title,
      url: candidate.url,
    }));
}

export const MS_LEARN_DISCLOSURE =
  "Searching sends this objective's text to Microsoft Learn (learn.microsoft.com) over HTTPS. Nothing else from your workspace is sent. Allow on this device?";

export type RankedMsLearnSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

export function createMsLearnProvider(
  options: { ranked?: RankedMsLearnSearch } = {},
): ResearchProvider {
  return {
    disclosure: MS_LEARN_DISCLOSURE,
    id: 'mslearn',
    label: 'Microsoft Learn',

    async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
      if (options.ranked) {
        try {
          const ranked = await options.ranked(query);
          if (ranked.length > 0) return ranked.slice(0, 8);
        } catch {
          // Ranked search is an enhancement; fall back to the shipped catalog scoring.
        }
      }
      return catalogSearch(query, fetchImpl);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const isRanked = candidate.key.slice('mslearn:'.length).startsWith('http');
      const closing = isRanked
        ? `This is a Microsoft Learn search reference captured on ${date}, not a snapshot of the page.`
        : `This is a Microsoft Learn catalog reference captured on ${date}, not a snapshot of the module page.`;
      const content = [
        `# ${candidate.title}`,
        '',
        `Original URL: <${candidate.url}>`,
        '',
        candidate.snippet,
        '',
        '## Catalog metadata',
        '',
        ...metadataLines(candidate),
        '',
        closing,
        '',
      ].join('\n');
      return { content, title: candidate.title, url: candidate.url };
    },
  };
}

export const msLearnProvider: ResearchProvider = createMsLearnProvider();
