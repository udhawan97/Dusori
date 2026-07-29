import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

export const REDDIT_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to Reddit (oauth.reddit.com) over HTTPS, through the local companion. Nothing else from your workspace is sent. Reddit no longer answers anonymous clients, so this needs your own free Reddit app credential set in the companion; without it the provider is skipped. Allow on this device?";

export type RedditSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

/**
 * Reddit sends no CORS headers, refuses a generic user agent, and withdrew anonymous access to its
 * JSON endpoints, so reaching it needs an app-only OAuth token. This provider therefore only exists
 * when the companion is running to hold that credential and make the call. The app never talks to
 * a Reddit host directly.
 */
export function createRedditProvider(options: { search: RedditSearch }): ResearchProvider {
  return {
    disclosure: REDDIT_DISCLOSURE,
    id: 'reddit',
    label: 'Reddit',
    // The companion runs the search; the page never calls reddit.com itself.
    origins: [],

    capturedVia: (candidate: ResearchCandidate): string =>
      candidate.snippet ? 'api-extract' : 'search-reference',

    describeMeta: (candidate: ResearchCandidate): string =>
      [
        candidate.meta.subreddit ?? '',
        candidate.meta.community ?? '',
        candidate.meta.comments ? `${candidate.meta.comments} comments` : '',
        candidate.meta.published ? `posted ${candidate.meta.published}` : '',
      ]
        .filter(Boolean)
        .join(' · '),

    async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
      return (await options.search(query)).slice(0, 8);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const header = [
        `# ${candidate.title}`,
        '',
        `Original URL: <${candidate.url}>`,
        candidate.meta.subreddit ? `\n- Subreddit: ${candidate.meta.subreddit}` : '',
        candidate.meta.community ? `\n- Score: ${candidate.meta.community}` : '',
        '\n\n',
      ].join('');

      // A self post carries its own text; a link post is only a pointer, and saying so is more
      // honest than saving an empty body that looks like a failed capture.
      const body = candidate.snippet
        ? `${candidate.snippet}\n\nCaptured from the post text on ${date}. Replies are not included; open the thread to read the discussion.\n`
        : `This Reddit post has no text of its own — it links elsewhere or is a discussion thread. Captured as a reference on ${date}; open the thread to read it.\n`;

      return {
        content: cappedMarkdown(header, body),
        title: candidate.title,
        url: candidate.url,
      };
    },
  };
}
