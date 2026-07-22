import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

/** Hacker News stories carry no body of their own, so the snippet stays a single line. */
const snippetLimit = 240;

// `url` and `story_text` are null on Ask HN posts, and the rest of the payload
// (highlights, tags, relevancy scores) is deliberately left unparsed so a change
// on Algolia's side cannot break a search that never read those fields.
const HitSchema = z.object({
  created_at: z.string(),
  objectID: z.string(),
  points: z.number(),
  title: z.string(),
  author: z.string().nullish(),
  num_comments: z.number().nullish(),
  story_text: z.string().nullish(),
  url: z.string().nullish(),
});
const SearchResponseSchema = z.object({ hits: z.array(HitSchema) });

const entities: Record<string, string> = {
  '&#x27;': "'",
  '&#x2f;': '/',
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '"',
};

function plainText(input: string): string {
  return input
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:#x27|#x2f|amp|gt|lt|quot);/giu, (match) => entities[match.toLowerCase()] ?? match)
    .replace(/\s+/gu, ' ')
    .trim();
}

function itemUrl(objectID: string): string {
  return `https://news.ycombinator.com/item?id=${objectID}`;
}

function discussionUrl(candidate: ResearchCandidate): string {
  return candidate.meta.discussion ?? itemUrl(candidate.key.slice('hackernews:'.length));
}

/** Only what the API actually reported: no story text means no snippet, not a guess. */
function storySnippet(
  author: string | null | undefined,
  storyText: string | null | undefined,
): string {
  if (!storyText) return '';
  const text = plainText(storyText);
  const excerpt = text.length > snippetLimit ? `${text.slice(0, snippetLimit).trim()}…` : text;
  return author ? `${author}: ${excerpt}` : excerpt;
}

function metaLine(candidate: ResearchCandidate): string {
  return [
    candidate.meta.points ? `${candidate.meta.points} points` : '',
    candidate.meta.comments ? `${candidate.meta.comments} comments` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const HACKER_NEWS_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to the Hacker News search API (hn.algolia.com) over HTTPS. Nothing else from your workspace is sent. Allow on this device?";

export const hackerNewsProvider: ResearchProvider = {
  id: 'hackernews',
  label: 'Hacker News',
  disclosure: HACKER_NEWS_DISCLOSURE,

  capturedVia: () => 'search-reference',

  describeMeta: metaLine,

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL('https://hn.algolia.com/api/v1/search');
    url.search = new URLSearchParams({
      hitsPerPage: '8',
      query: query.searchText,
      tags: 'story',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Hacker News search could not read the search API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Hacker News returned an unfamiliar search format.');
    const results = parsed.data.hits.slice(0, 8);
    return results.map((hit, index) => ({
      communityScore: hit.points,
      key: `hackernews:${hit.objectID}`,
      kind: 'article' as const,
      meta: {
        ...(hit.num_comments === undefined || hit.num_comments === null
          ? {}
          : { comments: String(hit.num_comments) }),
        discussion: itemUrl(hit.objectID),
        points: String(hit.points),
      },
      provider: 'hackernews',
      publishedAt: hit.created_at,
      score: results.length - index,
      snippet: storySnippet(hit.author, hit.story_text),
      title: hit.title.replace(/\s+/gu, ' ').trim(),
      // Ask HN and Show HN posts have no external link; the thread is the artifact.
      url: hit.url ?? itemUrl(hit.objectID),
    }));
  },

  async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
    const date = new Date().toISOString().slice(0, 10);
    const detail = metaLine(candidate);
    const discussion = `<${discussionUrl(candidate)}>`;
    const body = [
      ...(candidate.snippet ? [candidate.snippet, ''] : []),
      '## Discussion',
      '',
      detail ? `${discussion} — ${detail}` : discussion,
      '',
      `This is a Hacker News reference captured on ${date}, not a snapshot of the page.`,
    ].join('\n');
    return {
      content: cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, body),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
