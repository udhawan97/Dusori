import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { maxSourceBytes } from '@dusori/core';

import { isBlockedAddress } from './address-guard.js';

export type FetchFailureReason =
  | 'invalid-url'
  | 'blocked-host'
  | 'redirect-host'
  | 'access-denied'
  | 'too-many-redirects'
  | 'timeout'
  | 'unsupported-type'
  | 'too-large'
  | 'fetch-failed'
  | 'extraction-failed';

export class FetchPageError extends Error {
  constructor(
    message: string,
    readonly reason: FetchFailureReason,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FetchPageError';
  }
}

export interface FetchedPageResult {
  title: string;
  text: string;
  byline?: string;
  siteName?: string;
  finalUrl: string;
  fetchedAt: string;
  truncated: boolean;
}

export type LookupImpl = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export interface FetchPageOptions {
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
  /** Test seam for proving that production requests receive the validated address. */
  pinnedFetchImpl?: PinnedFetchImpl;
  timeoutMs?: number;
  now?: () => Date;
}

export type PinnedFetchImpl = (
  url: URL,
  address: string,
  family: number,
  signal: AbortSignal,
) => Promise<Response>;

export const maxFetchBytes = 4 * 1024 * 1024;
const maxRedirects = 3;
const redirectStatuses = [301, 302, 303, 307, 308];
const allowedTypes = ['text/html', 'application/xhtml+xml', 'text/plain'];
const blockedMessage =
  "This address points at a private network and won't be fetched. Paste the text instead.";
const noTextMessage = 'No readable article text was found on this page. Paste the text instead.';
const shortArticleMessage =
  'The readable text on this page was too short to store as a source. Paste the text instead.';
function timeoutMessage(timeoutMs: number): string {
  return `This page took longer than ${timeoutMs / 1000} seconds. Try again, or paste the text instead.`;
}

function isAbortTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

function timeoutFetchError(timeoutMs: number): FetchPageError {
  return new FetchPageError(timeoutMessage(timeoutMs), 'timeout');
}

function parseTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchPageError(
      'That URL is not valid. Use a complete http:// or https:// address.',
      'invalid-url',
    );
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FetchPageError('Only http:// and https:// pages can be fetched.', 'invalid-url');
  }
  if (url.username || url.password) {
    throw new FetchPageError(
      'Remove the username or password from this URL before fetching it.',
      'invalid-url',
    );
  }
  return url;
}

async function resolvePublicHost(
  url: URL,
  lookupImpl: LookupImpl,
): Promise<{ address: string; family: number }> {
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new FetchPageError(blockedMessage, 'blocked-host');
    return { address: host, family: isIP(host) };
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(host, { all: true });
  } catch {
    throw new FetchPageError(
      'That address could not be resolved. Check the URL or your connection.',
      'fetch-failed',
    );
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new FetchPageError(blockedMessage, 'blocked-host');
  }
  return addresses[0]!;
}

/**
 * Node's normal fetch would resolve the hostname again after the guard, leaving a DNS-rebinding
 * gap. The production request therefore uses the already-validated address while preserving the
 * URL hostname for the Host header and TLS certificate check.
 */
async function pinnedFetch(
  url: URL,
  address: string,
  family: number,
  signal: AbortSignal,
): Promise<Response> {
  const lookupPinned: LookupFunction = (_hostname, _options, callback) => {
    callback(null, address, family);
  };
  return new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      {
        headers: {
          accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
          'user-agent': 'Dusori companion readable-page fetch',
        },
        lookup: lookupPinned,
        method: 'GET',
        signal,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
          else if (value !== undefined) headers.set(name, value);
        }
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            headers,
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function guardedResponse(
  initial: URL,
  fetchImpl: typeof fetch | undefined,
  pinnedFetchImpl: PinnedFetchImpl,
  lookupImpl: LookupImpl,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ finalUrl: URL; response: Response }> {
  let current = initial;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const resolved = await resolvePublicHost(current, lookupImpl);
    let response: Response;
    try {
      response =
        fetchImpl === undefined
          ? await pinnedFetchImpl(current, resolved.address, resolved.family, signal)
          : await fetchImpl(current.toString(), { redirect: 'manual', signal });
    } catch (error) {
      if (isAbortTimeout(error)) throw timeoutFetchError(timeoutMs);
      throw new FetchPageError(
        'This page could not be fetched. Check the URL or your connection.',
        'fetch-failed',
      );
    }
    if (redirectStatuses.includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        await response.body?.cancel().catch(() => undefined);
        throw new FetchPageError(
          'This page redirected without a destination. Save the URL as a reference instead.',
          'fetch-failed',
        );
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        await response.body?.cancel().catch(() => undefined);
        throw new FetchPageError(
          'This page redirected to an invalid address. Save the URL as a reference instead.',
          'fetch-failed',
        );
      }
      current = parseTarget(next.toString());
      if (current.origin !== initial.origin) {
        await response.body?.cancel().catch(() => undefined);
        throw new FetchPageError(
          `This page redirected to ${current.host}, which was not the host you approved. Open the original in your browser instead.`,
          'redirect-host',
        );
      }
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if ([401, 403, 429].includes(response.status)) {
        const description =
          response.status === 429 ? 'limited automated reading' : 'blocked automated reading';
        throw new FetchPageError(
          `This site ${description} (status ${response.status}). Dusori kept the reference; open the original in your browser or paste text you are allowed to use.`,
          'access-denied',
          response.status,
        );
      }
      throw new FetchPageError(
        `This page answered with status ${response.status}. Dusori kept the reference; open the original in your browser or paste the text instead.`,
        'fetch-failed',
        response.status,
      );
    }
    return { finalUrl: current, response };
  }
  throw new FetchPageError(
    'This page redirected more than 3 times. Save the URL as a reference instead.',
    'too-many-redirects',
  );
}

function tooLarge(): FetchPageError {
  return new FetchPageError(
    'This page is larger than 4 MiB. Paste the part you need instead.',
    'too-large',
  );
}

async function readBody(
  response: Response,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<{ text: string; type: string }> {
  const type =
    (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!allowedTypes.includes(type)) {
    await response.body?.cancel().catch(() => undefined);
    throw new FetchPageError(
      'Only HTML and plain-text pages can be fetched. Keep the URL as a reference instead.',
      'unsupported-type',
    );
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxFetchBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) {
    throw new FetchPageError(
      'This page had no readable content. Paste the text instead.',
      'fetch-failed',
    );
  }
  const reader = response.body.getReader();
  // response.body isn't necessarily wired to `signal` (e.g. in tests, or with a
  // fetch implementation that doesn't propagate abort into its body stream), so
  // race every read against the signal ourselves rather than assuming it hangs
  // together with the initial fetchImpl() call above.
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxFetchBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } catch (error) {
    // Best-effort: never let a cancel failure mask the real error below.
    await reader.cancel().catch(() => {});
    if (isAbortTimeout(error)) throw timeoutFetchError(timeoutMs);
    // The too-large branch above already threw its own typed FetchPageError
    // (and cancelled the reader itself); pass it through unchanged.
    if (error instanceof FetchPageError) throw error;
    throw new FetchPageError(
      'This page could not be fetched. Check the URL or your connection.',
      'fetch-failed',
    );
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), type };
}

interface Extracted {
  byline?: string;
  siteName?: string;
  text: string;
  title: string;
}

// Readability's own "is this actually an article" bar (its DEFAULT_CHAR_THRESHOLD).
// Once every flag-relaxation retry inside Readability fails to clear this bar, it
// gives up and returns whatever scrap of text it found (e.g. a handful of words
// from a nav bar) instead of null — so an empty-string check alone does not
// reject non-article pages. Re-apply the same bar here as a length check.
const minArticleChars = 500;

function extract(html: string, url: URL): Extracted {
  const { document } = parseHTML(html);
  let article: ReturnType<InstanceType<typeof Readability>['parse']>;
  try {
    article = new Readability(document as any).parse();
  } catch {
    article = null;
  }
  const text = article?.textContent?.trim() ?? '';
  if (!text) {
    throw new FetchPageError(noTextMessage, 'extraction-failed');
  }
  if (text.length < minArticleChars) {
    throw new FetchPageError(shortArticleMessage, 'extraction-failed');
  }
  return {
    byline: article?.byline ?? undefined,
    siteName: article?.siteName ?? undefined,
    text,
    title: (article?.title ?? document.title ?? '').trim() || url.hostname,
  };
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function capText(text: string): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.byteLength <= maxSourceBytes) return { text, truncated: false };
  const sliced = new TextDecoder().decode(bytes.slice(0, maxSourceBytes)).replace(/�$/u, '');
  return { text: sliced, truncated: true };
}

export async function fetchReadablePage(
  rawUrl: string,
  options: FetchPageOptions = {},
): Promise<FetchedPageResult> {
  const lookupImpl = options.lookupImpl ?? (lookup as unknown as LookupImpl);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const signal = AbortSignal.timeout(timeoutMs);
  const target = parseTarget(rawUrl);
  const { finalUrl, response } = await guardedResponse(
    target,
    options.fetchImpl,
    options.pinnedFetchImpl ?? pinnedFetch,
    lookupImpl,
    signal,
    timeoutMs,
  );
  const body = await readBody(response, signal, timeoutMs);
  const page =
    body.type === 'text/plain'
      ? {
          text: body.text.trim(),
          title: finalUrl.pathname.split('/').filter(Boolean).at(-1) ?? finalUrl.hostname,
        }
      : extract(body.text, finalUrl);
  const normalized = normalizeText(page.text);
  if (!normalized) throw new FetchPageError(noTextMessage, 'extraction-failed');
  const capped = capText(normalized);
  return {
    byline: 'byline' in page ? page.byline : undefined,
    fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    finalUrl: finalUrl.toString(),
    siteName: 'siteName' in page ? page.siteName : undefined,
    text: capped.text,
    title: page.title,
    truncated: capped.truncated,
  };
}
