import { z } from 'zod';

import { companionVersion } from './version.js';

const tokenUpstream = 'https://www.reddit.com/api/v1/access_token';
const searchUpstream = 'https://oauth.reddit.com/search';
const maxResults = 8;
const unreachableMessage = 'Reddit could not be reached.';
const unfamiliarMessage = 'Reddit returned an unfamiliar listing format.';
const notConfiguredMessage =
  'Reddit search is not configured. Create a "script" app at ' +
  'https://www.reddit.com/prefs/apps and set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET ' +
  'before launching the companion.';

/**
 * Reddit requires a descriptive user agent and refuses generic ones. This runs on the learner's own
 * machine, so it names the companion and its version.
 */
const userAgent = `dusori-companion/${companionVersion} (local research companion)`;

const TokenSchema = z.object({ access_token: z.string().min(1) });

const ListingSchema = z.object({
  data: z.object({
    children: z.array(
      z.object({
        data: z.object({
          created_utc: z.number().nullish(),
          id: z.string(),
          num_comments: z.number().nullish(),
          over_18: z.boolean().nullish(),
          permalink: z.string().nullish(),
          score: z.number().nullish(),
          selftext: z.string().nullish(),
          subreddit: z.string().nullish(),
          title: z.string(),
        }),
      }),
    ),
  }),
});

export type RedditEnv = Record<string, string | undefined>;
export type RedditFailureReason = 'fetch-failed' | 'not-configured';

export interface RedditResult {
  comments: number;
  id: string;
  publishedAt: string;
  score: number;
  subreddit: string;
  summary: string;
  title: string;
  url: string;
}

export interface RedditSearchOptions {
  env?: RedditEnv;
  fetchImpl?: typeof fetch;
}

export class RedditProxyError extends Error {
  constructor(
    message: string,
    readonly reason: RedditFailureReason = 'fetch-failed',
  ) {
    super(message);
    this.name = 'RedditProxyError';
  }
}

/** Reports whether Reddit is usable without ever revealing the credential. */
export function redditConfig(env: RedditEnv = process.env): { label: string } | null {
  const id = env.REDDIT_CLIENT_ID?.trim();
  const secret = env.REDDIT_CLIENT_SECRET?.trim();
  return id && secret ? { label: 'Reddit' } : null;
}

function isoDate(createdUtc: number | null | undefined): string {
  if (typeof createdUtc !== 'number' || !Number.isFinite(createdUtc)) return '';
  return new Date(createdUtc * 1000).toISOString().slice(0, 10);
}

function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

/**
 * Reddit withdrew anonymous access to its JSON endpoints, so an app-only OAuth token is the only
 * route left. The credential never leaves the companion process.
 */
async function appToken(env: RedditEnv, fetchImpl: typeof fetch): Promise<string> {
  const id = env.REDDIT_CLIENT_ID?.trim() ?? '';
  const secret = env.REDDIT_CLIENT_SECRET?.trim() ?? '';
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');

  let response: Response;
  try {
    response = await fetchImpl(tokenUpstream, {
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      method: 'POST',
    });
  } catch {
    throw new RedditProxyError(unreachableMessage);
  }
  if (!response.ok) throw new RedditProxyError(unreachableMessage);

  const parsed = TokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new RedditProxyError(unfamiliarMessage);
  return parsed.data.access_token;
}

export async function searchReddit(
  query: string,
  options: RedditSearchOptions = {},
): Promise<RedditResult[]> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!redditConfig(env)) throw new RedditProxyError(notConfiguredMessage, 'not-configured');

  const token = await appToken(env, fetchImpl);
  const url = new URL(searchUpstream);
  url.search = new URLSearchParams({
    limit: String(maxResults * 2),
    q: query,
    sort: 'relevance',
    type: 'link',
  }).toString();

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent },
    });
  } catch {
    throw new RedditProxyError(unreachableMessage);
  }
  // Reddit rate-limits app-only clients; that is an outage from the app's point of view, and the
  // research run reports a visible skip rather than failing every other provider.
  if (!response.ok) throw new RedditProxyError(unreachableMessage);

  const parsed = ListingSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new RedditProxyError(unfamiliarMessage);

  const results: RedditResult[] = [];
  for (const child of parsed.data.data.children) {
    const post = child.data;
    if (!post.title.trim() || post.over_18) continue;
    results.push({
      comments: post.num_comments ?? 0,
      id: post.id,
      publishedAt: isoDate(post.created_utc),
      score: post.score ?? 0,
      subreddit: post.subreddit ?? '',
      summary: collapse(post.selftext ?? ''),
      title: collapse(post.title),
      url: post.permalink
        ? `https://www.reddit.com${post.permalink}`
        : `https://redd.it/${post.id}`,
    });
    if (results.length === maxResults) break;
  }
  return results;
}
