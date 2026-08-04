import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

export const ARXIV_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to arXiv (arxiv.org) over HTTPS, through the local companion. Nothing else from your workspace is sent. Allow on this device?";

export type ArxivSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

/**
 * arXiv publishes an Atom feed with no CORS headers, so this provider only exists when the
 * companion is running to proxy it. The app never talks to arxiv.org directly.
 */
export function createArxivProvider(options: { search: ArxivSearch }): ResearchProvider {
  return {
    disclosure: ARXIV_DISCLOSURE,
    id: 'arxiv',
    label: 'arXiv',
    // Every request goes through the companion, so the page never calls arxiv.org itself.
    origins: [],

    // The arXiv API returns the paper's own abstract. It is quotable abstract text, not the
    // paper's full body, so provenance names the narrower capture precisely.
    capturedVia: () => 'api-abstract',

    describeMeta: (candidate: ResearchCandidate): string =>
      candidate.meta.published ? `published ${candidate.meta.published}` : '',

    async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
      return (await options.search(query)).slice(0, 8);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const published = candidate.meta.published
        ? `\n\n- Published: ${candidate.meta.published}`
        : '';
      const content = cappedMarkdown(
        `# ${candidate.title}\n\nOriginal URL: <${candidate.url}>${published}\n\n## Abstract\n\n`,
        `${candidate.snippet}\n\nThis is an arXiv reference captured on ${date}, not a snapshot of the paper.\n`,
      );
      return { content, title: candidate.title, url: candidate.url };
    },
  };
}
