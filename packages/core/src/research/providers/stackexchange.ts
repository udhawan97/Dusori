import { z } from 'zod';

import { cappedMarkdown } from '../../sources/capped.js';
import type {
  ResearchCandidate,
  ResearchCapture,
  ResearchProvider,
  ResearchQuery,
} from '../types.js';

const searchUrl = 'https://api.stackexchange.com/2.3/search/advanced';
const snippetLimit = 300;

const QuestionSchema = z.object({
  answer_count: z.number().int().nonnegative(),
  creation_date: z.number().int().nonnegative(),
  link: z.string(),
  question_id: z.number().int().nonnegative(),
  score: z.number().int(),
  title: z.string(),
  accepted_answer_id: z.number().int().nonnegative().optional(),
  body: z.string().optional(),
  is_answered: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
});
const SearchResponseSchema = z.object({ items: z.array(QuestionSchema) });
type Question = z.infer<typeof QuestionSchema>;

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

/** Trims to roughly `limit` characters without leaving a half-written word behind. */
function truncateWords(input: string, limit: number): string {
  if (input.length <= limit) return input;
  const cut = input.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

function questionMeta(question: Question): Record<string, string> {
  const accepted = question.is_answered === true && question.accepted_answer_id !== undefined;
  return {
    ...(accepted ? { accepted: 'yes' } : {}),
    answers: String(question.answer_count),
    ...(question.tags?.length ? { tags: question.tags.join(', ') } : {}),
    votes: String(question.score),
  };
}

function signalLines(candidate: ResearchCandidate): string[] {
  const lines = [
    `- Votes: ${candidate.meta.votes ?? '0'}`,
    `- Answers: ${candidate.meta.answers ?? '0'}`,
  ];
  lines.push(`- Accepted answer: ${candidate.meta.accepted === 'yes' ? 'yes' : 'no'}`);
  if (candidate.meta.tags) lines.push(`- Tags: ${candidate.meta.tags}`);
  return lines;
}

export const STACK_EXCHANGE_DISCLOSURE =
  "Searching sends this topic's name and the objective's text to Stack Exchange (api.stackexchange.com) over HTTPS. Nothing else from your workspace is sent. Allow on this device?";

export const stackExchangeProvider: ResearchProvider = {
  id: 'stackexchange',
  label: 'Stack Overflow',
  disclosure: STACK_EXCHANGE_DISCLOSURE,
  origins: ['https://api.stackexchange.com'],

  // Stack Exchange's API returns the question body itself; answers remain outside this capture.
  capturedVia: () => 'api-extract',

  describeMeta: (candidate: ResearchCandidate): string =>
    [
      candidate.meta.votes ? `${candidate.meta.votes} votes` : '',
      candidate.meta.answers ? `${candidate.meta.answers} answers` : '',
      candidate.meta.accepted === 'yes' ? 'accepted' : '',
      candidate.meta.tags ?? '',
    ]
      .filter(Boolean)
      .join(' · '),

  async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
    const url = new URL(searchUrl);
    url.search = new URLSearchParams({
      // `withbody` is the filter that makes the API include question bodies at all.
      filter: 'withbody',
      order: 'desc',
      pagesize: '8',
      q: query.searchText,
      site: 'stackoverflow',
      sort: 'votes',
    }).toString();
    const response = await fetchImpl(url.toString());
    if (!response.ok) throw new Error('Stack Overflow search could not read the search API.');
    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('Stack Overflow returned an unfamiliar search format.');
    const items = parsed.data.items.slice(0, 8);
    return items.map((question, index) => ({
      communityScore: question.score,
      key: `stackexchange:${question.question_id}`,
      kind: 'qa' as const,
      meta: questionMeta(question),
      provider: 'stackexchange',
      // The API reports epoch seconds, not milliseconds.
      publishedAt: new Date(question.creation_date * 1000).toISOString(),
      score: items.length - index,
      snippet: truncateWords(plainSnippet(question.body ?? ''), snippetLimit),
      title: plainSnippet(question.title),
      url: question.link,
    }));
  },

  // A search result already carries the question body, so capture stays offline.
  async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
    const date = new Date().toISOString().slice(0, 10);
    const body = [
      candidate.snippet,
      '',
      '## Signals',
      '',
      ...signalLines(candidate),
      '',
      `This is a Stack Overflow reference captured on ${date}, not a snapshot of the page.`,
    ].join('\n');
    return {
      content: cappedMarkdown(`# ${candidate.title}\n\nOriginal URL: <${candidate.url}>\n\n`, body),
      title: candidate.title,
      url: candidate.url,
    };
  },
};
