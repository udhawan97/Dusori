import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

export const WEB_SEARCH_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to the web search provider you configured in the companion, over HTTPS, through the local companion. Nothing else from your workspace is sent. Allow on this device?";

export type WebSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

/**
 * General web search carries no community rating of its own, so its candidates lean entirely on
 * the ranking layer: relevance, publication date, and host reputation. The search key lives in
 * the companion, which is why this provider only exists when one is running.
 */
export function createWebSearchProvider(options: { search: WebSearch }): ResearchProvider {
  return {
    disclosure: WEB_SEARCH_DISCLOSURE,
    id: 'websearch',
    label: 'Web search',
    // The companion runs the search; the page only ever calls the companion.
    origins: [],

    capturedVia: () => 'search-reference',

    describeMeta: (candidate: ResearchCandidate): string =>
      [
        candidate.meta.host ?? '',
        candidate.meta.published ? `published ${candidate.meta.published}` : '',
      ]
        .filter(Boolean)
        .join(' · '),

    async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
      return (await options.search(query)).slice(0, 8);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const content = cappedMarkdown(
        `# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`,
        `${candidate.snippet}\n\nThis is a web search reference captured on ${date}, not a snapshot of the page. Fetch full content to replace it with the page's readable text.\n`,
      );
      return { content, title: candidate.title, url: candidate.url };
    },
  };
}
