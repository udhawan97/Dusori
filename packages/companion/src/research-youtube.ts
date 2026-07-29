import { z } from 'zod';

const maxResults = 8;
const maxThumbnailBytes = 2 * 1024 * 1024;
const videoId = /^[A-Za-z0-9_-]{11}$/u;
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const unreachableMessage = 'The configured Invidious instance could not be reached.';
const notConfiguredMessage =
  'YouTube search is not configured. Set INVIDIOUS_URL to an Invidious instance ' +
  '(self-hosted or public) before launching the companion.';

export type YouTubeFailureReason =
  | 'fetch-failed'
  | 'invalid-id'
  | 'no-captions'
  | 'not-configured'
  | 'too-large'
  | 'unsupported-type';

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

export interface YouTubeTranscript {
  label: string;
  text: string;
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

const CaptionsSchema = z.object({
  captions: z.array(
    z.object({
      label: z.string(),
      language_code: z.string().optional(),
      url: z.string(),
    }),
  ),
});

/** The instance is operator-configured, exactly like SEARXNG_URL; Dusori ships no default host. */
export function youtubeConfig(
  env: YouTubeEnv = process.env,
): { base: string; host: string } | null {
  const raw = env.INVIDIOUS_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { base: url.origin, host: url.host };
  } catch {
    return null;
  }
}

function configured(env: YouTubeEnv): { base: string; host: string } {
  const config = youtubeConfig(env);
  if (!config) throw new YouTubeError(notConfiguredMessage, 'not-configured');
  return config;
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

export async function searchYouTube(
  query: string,
  { env = process.env, fetchImpl = fetch }: YouTubeOptions = {},
): Promise<YouTubeResult[]> {
  const { base } = configured(env);
  const url = new URL(`${base}/api/v1/search`);
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

/** WebVTT to prose: cue numbers, timing lines, inline tags, and repeated rolling lines removed. */
export function transcriptFromVtt(vtt: string): string {
  const lines: string[] = [];
  for (const raw of vtt.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = raw
      .replace(/<[^>]*>/gu, '')
      .replace(/&nbsp;/gu, ' ')
      .trim();
    if (!line) continue;
    if (line === 'WEBVTT' || /^(?:Kind|Language|NOTE|STYLE):?/u.test(line)) continue;
    if (line.includes('-->') || /^\d+$/u.test(line)) continue;
    if (lines.at(-1) === line) continue;
    lines.push(line);
  }
  // Rolling captions repeat the previous line inside the next cue; drop a line already ending
  // the text so the prose reads once.
  const text: string[] = [];
  for (const line of lines) {
    if (text.at(-1) === line) continue;
    text.push(line);
  }
  return text.join(' ').replace(/\s+/gu, ' ').trim();
}

export async function fetchYouTubeTranscript(
  id: string,
  { env = process.env, fetchImpl = fetch }: YouTubeOptions = {},
): Promise<YouTubeTranscript> {
  const { base } = configured(env);
  const checked = checkedId(id);

  const listed = await request(`${base}/api/v1/captions/${checked}`, fetchImpl);
  const parsed = CaptionsSchema.safeParse(await listed.json().catch(() => null));
  if (!parsed.success) throw new YouTubeError(unreachableMessage, 'fetch-failed');

  const tracks = parsed.data.captions;
  const track =
    tracks.find((entry) => entry.language_code?.toLowerCase().startsWith('en')) ?? tracks[0];
  if (!track) {
    throw new YouTubeError('This video has no captions to capture.', 'no-captions');
  }

  let trackUrl: URL;
  try {
    trackUrl = new URL(track.url, `${base}/`);
  } catch {
    throw new YouTubeError(unreachableMessage, 'fetch-failed');
  }
  // The instance is the only host this proxy ever talks to, whatever the listing says.
  if (trackUrl.origin !== base) throw new YouTubeError(unreachableMessage, 'fetch-failed');

  const text = transcriptFromVtt(await (await request(trackUrl.toString(), fetchImpl)).text());
  if (!text) throw new YouTubeError('This video has no captions to capture.', 'no-captions');
  return { label: collapse(track.label) || 'Captions', text };
}

export async function fetchYouTubeThumbnail(
  id: string,
  { env = process.env, fetchImpl = fetch }: YouTubeOptions = {},
): Promise<YouTubeThumbnail> {
  const { base } = configured(env);
  const checked = checkedId(id);
  const response = await request(`${base}/vi/${checked}/mqdefault.jpg`, fetchImpl);

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
