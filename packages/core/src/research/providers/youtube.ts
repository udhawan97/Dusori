import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

export const YOUTUBE_DISCLOSURE =
  "Searching sends this topic's name and the objective's text through your local companion to the official YouTube Data API, or to the self-hosted Invidious instance you configured as a fallback. Dusori receives video metadata and references only; it does not harvest captions or media. Your browser contacts only the companion, and nothing else from your workspace is sent. Allow on this device?";

export type YouTubeSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

/**
 * YouTube discovery is reference and metadata only. Transcript text may still enter a workspace
 * through the ordinary paste/file source flow when the learner owns it, supplied it, or has
 * permission to use it; this provider never harvests captions from a third-party service.
 */
export function createYouTubeProvider(options: { search: YouTubeSearch }): ResearchProvider {
  return {
    disclosure: YOUTUBE_DISCLOSURE,
    id: 'youtube',
    label: 'YouTube',
    // Search goes through the companion; the page fetches nothing.
    origins: [],

    // Never 'search-reference': a YouTube watch page has no readable article to upgrade to, so
    // the page-fetch path must not be offered for these captures.
    capturedVia: () => 'youtube-reference',

    describeMeta: (candidate: ResearchCandidate): string =>
      [
        candidate.meta.channel ?? '',
        candidate.meta.views ? `${candidate.meta.views} views` : '',
        candidate.meta.duration ?? '',
        candidate.meta.published ? `published ${candidate.meta.published}` : '',
      ]
        .filter(Boolean)
        .join(' · '),

    async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
      return (await options.search(query)).slice(0, 8);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const heading = [
        `# ${candidate.title}`,
        '',
        `Original URL: <${candidate.url}>`,
        ...(candidate.meta.channel ? ['', `Channel: ${candidate.meta.channel}`] : []),
        ...(candidate.meta.duration ? ['', `Duration: ${candidate.meta.duration}`] : []),
        ...(candidate.meta.views ? ['', `Views when captured: ${candidate.meta.views}`] : []),
        '',
        '',
      ].join('\n');

      return {
        capturedVia: 'youtube-reference',
        content: cappedMarkdown(
          heading,
          `${candidate.snippet}\n\nSaved as a video reference on ${date}. Dusori does not harvest captions. You can add transcript text through Paste or File only when you supplied it, own it, or are authorized to use it.\n`,
        ),
        title: candidate.title,
        url: candidate.url,
      };
    },
  };
}
