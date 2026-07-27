import { cappedMarkdown } from '../../sources/capped.js';
import type { YouTubeTranscript } from '../companion.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

export const YOUTUBE_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to the Invidious instance you configured in the companion, through the local companion. Approving a video also asks that instance for its captions and its thumbnail. Your browser never contacts YouTube or Google, and nothing else from your workspace is sent. Allow on this device?";

export type YouTubeSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;
export type YouTubeTranscriptFetch = (videoId: string) => Promise<YouTubeTranscript>;

function videoIdOf(candidate: ResearchCandidate): string {
  return candidate.meta.thumbnail ?? candidate.key.replace(/^youtube:/u, '');
}

/**
 * Videos earn their place on public view counts, but a video only becomes a source Dusori can
 * use when its captions come with it — everything downstream (search, graph, briefs, review
 * prompts) reads text. A video without captions is captured as an honest reference instead.
 */
export function createYouTubeProvider(options: {
  search: YouTubeSearch;
  transcript: YouTubeTranscriptFetch;
}): ResearchProvider {
  return {
    disclosure: YOUTUBE_DISCLOSURE,
    id: 'youtube',
    label: 'YouTube',

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

      try {
        const transcript = await options.transcript(videoIdOf(candidate));
        return {
          capturedVia: 'youtube-transcript',
          content: cappedMarkdown(
            heading,
            `Captions (${transcript.label}) captured on ${date} through your Invidious instance. Captions are often machine-generated and can be wrong; check the video before trusting a line.\n\n## Transcript\n\n${transcript.text}\n`,
          ),
          title: candidate.title,
          url: candidate.url,
        };
      } catch {
        return {
          capturedVia: 'youtube-reference',
          content: cappedMarkdown(
            heading,
            `${candidate.snippet}\n\nNo captions were available for this video on ${date}, so Dusori stored the reference only. Watch it and write your own notes — a video without captions has no text for search, briefs, or review prompts.\n`,
          ),
          title: candidate.title,
          url: candidate.url,
        };
      }
    },
  };
}
