import { z } from 'zod';

const maxResults = 8;
const maxThumbnailBytes = 2 * 1024 * 1024;
const videoId = /^[A-Za-z0-9_-]{11}$/u;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const youtubeSearchUpstream = 'https://www.googleapis.com/youtube/v3/search';
const youtubeVideosUpstream = 'https://www.googleapis.com/youtube/v3/videos';
const youtubeThumbnailUpstream = 'https://i.ytimg.com';
const unreachableMessage = 'The configured YouTube metadata provider could not be reached.';
const notConfiguredMessage =
  'YouTube search is not configured. Set YOUTUBE_API_KEY for the official YouTube Data API ' +
  'free quota, or set INVIDIOUS_URL to a self-hosted Invidious instance, before launching the companion.';

export type YouTubeFailureReason =
  'fetch-failed' | 'invalid-id' | 'not-configured' | 'too-large' | 'unsupported-type';

export type YouTubeEnv = Record<string, string | undefined>;

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly reason: YouTubeFailureReason,
  ) {
    super(message);
    this.name = 'YouTubeError';
  }
}

export interface YouTubeOptions {
  env?: YouTubeEnv;
  fetchImpl?: typeof fetch;
}

export interface YouTubeResult {
  author: string;
  id: string;
  lengthSeconds: number;
  publishedAt?: string;
  summary: string;
  title: string;
  url: string;
  viewCount: number;
}

export interface YouTubeThumbnail {
  body: Uint8Array;
  contentType: string;
}

const SearchSchema = z.array(
  z.object({
    author: z.string().optional(),
    description: z.string().nullable().optional(),
    lengthSeconds: z.number().optional(),
    published: z.number().optional(),
    title: z.string(),
    videoId: z.string(),
    viewCount: z.number().optional(),
  }),
);

const OfficialSearchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string() }),
      snippet: z
        .object({
          channelTitle: z.string().optional(),
          description: z.string().optional(),
          publishedAt: z.string().optional(),
          title: z.string().optional(),
        })
        .optional(),
    }),
  ),
});

const OfficialVideosSchema = z.object({
  items: z.array(
    z.object({
      contentDetails: z.object({ duration: z.string().optional() }).optional(),
      id: z.string(),
      snippet: z
        .object({
          channelTitle: z.string().optional(),
          description: z.string().optional(),
          publishedAt: z.string().optional(),
          title: z.string().optional(),
        })
        .optional(),
      statistics: z.object({ viewCount: z.string().optional() }).optional(),
    }),
  ),
});

export type YouTubeConfig =
  { kind: 'invidious'; base: string; host: string } | { kind: 'youtube-data-api' };

function invidiousConfig(env: YouTubeEnv): Extract<YouTubeConfig, { kind: 'invidious' }> | null {
  const raw = env.INVIDIOUS_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { base: url.origin, host: url.host, kind: 'invidious' };
  } catch {
    return null;
  }
}

/** Reports the configured route without exposing an API key to the browser capability response. */
export function youtubeConfig(env: YouTubeEnv = process.env): YouTubeConfig | null {
  if (env.YOUTUBE_API_KEY?.trim()) return { kind: 'youtube-data-api' };
  return invidiousConfig(env);
}

function configured(env: YouTubeEnv): YouTubeConfig {
  const config = youtubeConfig(env);
  if (!config) throw new YouTubeError(notConfiguredMessage, 'not-configured');
  return config;
}

function officialKey(env: YouTubeEnv): string {
  const value = env.YOUTUBE_API_KEY?.trim() ?? '';
  if (!value) throw new YouTubeError(notConfiguredMessage, 'not-configured');
  return value;
}

function checkedId(id: string): string {
  if (!videoId.test(id)) {
    throw new YouTubeError('That is not a YouTube video id.', 'invalid-id');
  }
  return id;
}

// Failures collapse to one fixed message: an upstream error may echo the request, and the
// instance address is the operator's business rather than the browser's.
async function request(url: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: '*/*' } });
  } catch {
    throw new YouTubeError(unreachableMessage, 'fetch-failed');
  }
  if (!response.ok) throw new YouTubeError(unreachableMessage, 'fetch-failed');
  return response;
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function publishedDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString().slice(0, 10);
}

function nonnegativeInteger(value: string | number | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function durationSeconds(value: string | undefined): number {
  if (!value) return 0;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/u.exec(value);
  if (!match) return 0;
  return (
    nonnegativeInteger(match[1]) * 86_400 +
    nonnegativeInteger(match[2]) * 3_600 +
    nonnegativeInteger(match[3]) * 60 +
    nonnegativeInteger(match[4])
  );
}

async function searchOfficialYouTube(
  query: string,
  env: YouTubeEnv,
  fetchImpl: typeof fetch,
): Promise<YouTubeResult[]> {
  const key = officialKey(env);
  const searchUrl = new URL(youtubeSearchUpstream);
  searchUrl.search = new URLSearchParams({
    key,
    maxResults: String(maxResults),
    part: 'snippet',
    q: query,
    safeSearch: 'moderate',
    type: 'video',
  }).toString();
  const search = OfficialSearchSchema.safeParse(
    await (await request(searchUrl.toString(), fetchImpl)).json().catch(() => null),
  );
  if (!search.success) throw new YouTubeError(unreachableMessage, 'fetch-failed');
  const ids = search.data.items.map((item) => item.id.videoId).filter((id) => videoId.test(id));
  if (ids.length === 0) return [];

  const videosUrl = new URL(youtubeVideosUpstream);
  videosUrl.search = new URLSearchParams({
    id: ids.join(','),
    key,
    part: 'contentDetails,snippet,statistics',
  }).toString();
  const videos = OfficialVideosSchema.safeParse(
    await (await request(videosUrl.toString(), fetchImpl)).json().catch(() => null),
  );
  if (!videos.success) throw new YouTubeError(unreachableMessage, 'fetch-failed');
  const byId = new Map(videos.data.items.map((item) => [item.id, item]));

  return ids.flatMap((id) => {
    const item = byId.get(id);
    if (!item) return [];
    const title = collapse(item.snippet?.title);
    if (!title) return [];
    const date = publishedDate(item.snippet?.publishedAt);
    return [
      {
        author: collapse(item.snippet?.channelTitle),
        id,
        lengthSeconds: durationSeconds(item.contentDetails?.duration),
        ...(date ? { publishedAt: date } : {}),
        summary: collapse(item.snippet?.description),
        title,
        url: `https://www.youtube.com/watch?v=${id}`,
        viewCount: nonnegativeInteger(item.statistics?.viewCount),
      },
    ];
  });
}

async function searchInvidious(
  query: string,
  config: Extract<YouTubeConfig, { kind: 'invidious' }>,
  fetchImpl: typeof fetch,
): Promise<YouTubeResult[]> {
  const url = new URL(`${config.base}/api/v1/search`);
  url.search = new URLSearchParams({
    q: query,
    sort_by: 'view_count',
    type: 'video',
  }).toString();

  const response = await request(url.toString(), fetchImpl);
  const parsed = SearchSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new YouTubeError(unreachableMessage, 'fetch-failed');

  return parsed.data
    .filter((video) => videoId.test(video.videoId))
    .slice(0, maxResults)
    .map((video) => ({
      author: collapse(video.author),
      id: video.videoId,
      lengthSeconds: Math.max(0, Math.trunc(video.lengthSeconds ?? 0)),
      ...(video.published
        ? { publishedAt: new Date(video.published * 1000).toISOString().slice(0, 10) }
        : {}),
      summary: collapse(video.description),
      title: collapse(video.title),
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      viewCount: Math.max(0, Math.trunc(video.viewCount ?? 0)),
    }));
}

export async function searchYouTube(
  query: string,
  { env = process.env, fetchImpl = fetch }: YouTubeOptions = {},
): Promise<YouTubeResult[]> {
  const config = configured(env);
  if (config.kind === 'invidious') return searchInvidious(query, config, fetchImpl);
  try {
    return await searchOfficialYouTube(query, env, fetchImpl);
  } catch (error) {
    const fallback = invidiousConfig(env);
    if (!fallback) throw error;
    return searchInvidious(query, fallback, fetchImpl);
  }
}

export async function fetchYouTubeThumbnail(
  id: string,
  { env = process.env, fetchImpl = fetch }: YouTubeOptions = {},
): Promise<YouTubeThumbnail> {
  const config = configured(env);
  const checked = checkedId(id);
  const url =
    config.kind === 'youtube-data-api'
      ? `${youtubeThumbnailUpstream}/vi/${checked}/mqdefault.jpg`
      : `${config.base}/vi/${checked}/mqdefault.jpg`;
  let response: Response;
  try {
    response = await request(url, fetchImpl);
  } catch (error) {
    const fallback = config.kind === 'youtube-data-api' ? invidiousConfig(env) : null;
    if (!fallback) throw error;
    response = await request(`${fallback.base}/vi/${checked}/mqdefault.jpg`, fetchImpl);
  }

  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  if (!imageTypes.has(contentType)) {
    throw new YouTubeError('That thumbnail was not an image.', 'unsupported-type');
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maxThumbnailBytes) {
    throw new YouTubeError('That thumbnail is larger than 2 MiB.', 'too-large');
  }
  return { body, contentType };
}
