# Companion Research Service (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/api/research/fetch` (SSRF-guarded readability extraction) and a ranked MS Learn search proxy to the companion, and an "upgrade URL source to full content" flow to the app, per the approved spec `docs/superpowers/specs/2026-07-21-companion-research-service-design.md`.

**Architecture:** The companion (Fastify 5, loopback + per-launch token + origin allowlist) gains two endpoints; `@dusori/core` gains a zod-parsed companion client, a conflict-safe `upgradeSource`, and a ranked-search-capable MS Learn provider factory; the SvelteKit app lights the features up only when it was served by the companion (token in URL).

**Tech Stack:** TypeScript 6, zod 4 (`z.url()`, `z.string().datetime()`), Fastify 5 (`server.inject` tests), vitest 4, Playwright, Svelte 5 with legacy props (`export let`) and lowercase event attributes (`onclick=`), `@mozilla/readability` + `linkedom` (companion only), pnpm 11 / Node 24.

## Global Constraints

- `schemaVersion` stays `1`. Never bump it.
- Source cap: `maxSourceBytes = 2 * 1024 * 1024` (import from core; never redefine). Fetch body cap: 4 MiB. Redirect cap: 3 hops. Fetch timeout: 15 s.
- New production dependencies allowed ONLY in `packages/companion`: `@mozilla/readability`, `linkedom` (install with `--save-exact`; the repo pins exact versions). No new app or core dependencies.
- Error copy is a complete sentence naming the exact alternative, e.g. "This address points at a private network and won't be fetched. Paste the text instead." Match the tone of existing messages in `packages/core/src/sources/import.ts`.
- Provider ids stay `'mslearn' | 'wikipedia'`; consent localStorage keys stay `dusori-research-consent:<id>`.
- For `method: 'url'` source records, `sha256` is the hash of the URL (dedupe key + file-name stem). `upgradeSource` must never change it.
- All commands run from the repo root. Unit tests: `pnpm test:unit` (or `pnpm vitest run <file>` for one file). Full gate: `pnpm check`, then `pnpm test:e2e`.
- Commit after every task with the message given in its final step.

---

### Task 1: Companion address guard

**Files:**
- Create: `packages/companion/src/address-guard.ts`
- Test: `packages/companion/src/address-guard.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, `node:net` only).
- Produces: `isBlockedAddress(address: string): boolean` — `true` for every private/reserved/multicast IPv4 or IPv6 literal AND for any string that is not an IP literal (only resolved addresses may reach it).

- [ ] **Step 1: Write the failing test**

```ts
// packages/companion/src/address-guard.test.ts
import { describe, expect, it } from 'vitest';

import { isBlockedAddress } from './address-guard.js';

const blocked = [
  '0.0.0.1',
  '10.0.0.5',
  '100.64.1.1',
  '127.0.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.0.0.1',
  '192.168.1.1',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fec0::1',
  '::ffff:10.0.0.1',
  '::ffff:a00:1',
  'not-an-ip',
  'localhost',
];

const allowed = ['1.1.1.1', '8.8.8.8', '93.184.215.14', '172.15.0.1', '172.32.0.1', '192.167.0.1', '198.17.0.1', '2606:4700:4700::1111', '2620:fe::fe'];

describe('isBlockedAddress', () => {
  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(allowed)('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/companion/src/address-guard.test.ts`
Expected: FAIL — cannot resolve `./address-guard.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/companion/src/address-guard.ts
import { isIP } from 'node:net';

function ipv4ToInt(address: string): number {
  return address.split('.').reduce((total, octet) => total * 256 + Number.parseInt(octet, 10), 0);
}

const blockedV4Ranges: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function blockedV4(address: string): boolean {
  const value = ipv4ToInt(address);
  return blockedV4Ranges.some(
    ([base, bits]) => value >>> (32 - bits) === ipv4ToInt(base) >>> (32 - bits),
  );
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;

  const dottedMapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/u.exec(normalized);
  if (dottedMapped) return blockedV4(dottedMapped[1]);
  const hexMapped = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/u.exec(normalized);
  if (hexMapped) {
    const high = Number.parseInt(hexMapped[1], 16);
    const low = Number.parseInt(hexMapped[2], 16);
    return blockedV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  const firstGroup = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // unique local fc00::/7
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfeff) return true; // link-local + site-local
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/companion/src/address-guard.test.ts`
Expected: PASS (all rows).

- [ ] **Step 5: Commit**

```bash
git add packages/companion/src/address-guard.ts packages/companion/src/address-guard.test.ts
git commit -m "feat(companion): add private-address guard for research fetching"
```

---

### Task 2: Companion guarded fetch + readability extraction

**Files:**
- Modify: `packages/companion/package.json` (via pnpm)
- Create: `packages/companion/src/research-fetch.ts`
- Create: `packages/companion/src/__fixtures__/article.html`
- Test: `packages/companion/src/research-fetch.test.ts`

**Interfaces:**
- Consumes: `isBlockedAddress` (Task 1); `maxSourceBytes` from `@dusori/core`.
- Produces:
  - `type FetchFailureReason = 'invalid-url' | 'blocked-host' | 'too-many-redirects' | 'timeout' | 'unsupported-type' | 'too-large' | 'fetch-failed' | 'extraction-failed'`
  - `class FetchPageError extends Error { readonly reason: FetchFailureReason }`
  - `interface FetchedPageResult { title: string; text: string; byline?: string; siteName?: string; finalUrl: string; fetchedAt: string; truncated: boolean }`
  - `type LookupImpl = (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>`
  - `interface FetchPageOptions { fetchImpl?: typeof fetch; lookupImpl?: LookupImpl; timeoutMs?: number; now?: () => Date }`
  - `fetchReadablePage(rawUrl: string, options?: FetchPageOptions): Promise<FetchedPageResult>`
  - `const maxFetchBytes = 4 * 1024 * 1024`

- [ ] **Step 1: Install the extraction dependencies**

Run: `pnpm --filter dusori add --save-exact @mozilla/readability linkedom`
Expected: `packages/companion/package.json` `dependencies` gains exact-pinned `@mozilla/readability` and `linkedom`. (`@dusori/core` is already a devDependency and is bundled by tsup, so importing `maxSourceBytes` from it is fine.)

- [ ] **Step 2: Create the article fixture**

Readability needs ≳500 characters of article text; keep paragraphs long.

```html
<!-- packages/companion/src/__fixtures__/article.html -->
<!doctype html>
<html lang="en">
  <head>
    <title>Attention in transformers — Example Journal</title>
    <meta name="author" content="A. Vaswani" />
  </head>
  <body>
    <nav><a href="/">Home</a><a href="/archive">Archive</a><a href="/about">About</a></nav>
    <article>
      <h1>Attention in transformers</h1>
      <p>
        Attention lets each token weigh the other tokens in its context. Instead of compressing a
        sequence into one fixed vector, the model computes a score between every pair of positions
        and uses those scores to build a weighted mixture of value vectors. This single change is
        what allows transformers to relate distant words directly, without stepping through every
        intermediate position the way recurrent networks must.
      </p>
      <p>
        Multi-head attention runs several of these scoring functions in parallel, each with its own
        learned projections. One head can track syntactic agreement while another follows
        coreference, and the model concatenates their outputs into a single representation. The
        heads are cheap because the projections shrink the working dimension before the dot
        products are taken, keeping the total cost close to a single full-width attention pass.
      </p>
      <p>
        The quadratic cost in sequence length remains the practical limit. Every token attends to
        every other token, so doubling the context quadruples the work. Most long-context variants
        trade exactness for reach: sliding windows, low-rank approximations, or routing schemes
        that let a token attend to a selected subset instead of the whole sequence.
      </p>
    </article>
    <footer><p>© Example Journal. Subscribe for more.</p></footer>
  </body>
</html>
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/companion/src/research-fetch.test.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FetchPageError, fetchReadablePage, maxFetchBytes, type LookupImpl } from './research-fetch.js';

const publicLookup: LookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];
const privateLookup: LookupImpl = async () => [{ address: '10.0.0.5', family: 4 }];

function htmlResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return error instanceof FetchPageError ? error.reason : 'unexpected';
  }
}

describe('fetchReadablePage', () => {
  it('extracts readable text, title, and byline from an article page', async () => {
    const html = await readFile(join(import.meta.dirname, '__fixtures__', 'article.html'), 'utf8');
    const page = await fetchReadablePage('https://example.org/attention', {
      fetchImpl: async () => htmlResponse(html),
      lookupImpl: publicLookup,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });
    expect(page.title).toContain('Attention in transformers');
    expect(page.text).toContain('weigh the other tokens');
    expect(page.text).not.toContain('Subscribe for more');
    expect(page.finalUrl).toBe('https://example.org/attention');
    expect(page.fetchedAt).toBe('2026-07-21T00:00:00.000Z');
    expect(page.truncated).toBe(false);
  });

  it('returns plain text bodies without extraction', async () => {
    const page = await fetchReadablePage('https://example.org/notes.txt', {
      fetchImpl: async () => new Response('plain body text', { headers: { 'content-type': 'text/plain' } }),
      lookupImpl: publicLookup,
    });
    expect(page.text).toBe('plain body text');
    expect(page.title).toBe('notes.txt');
  });

  it('rejects invalid and non-http URLs before any network use', async () => {
    expect(await reason(fetchReadablePage('not a url', { lookupImpl: publicLookup }))).toBe('invalid-url');
    expect(await reason(fetchReadablePage('ftp://example.org/x', { lookupImpl: publicLookup }))).toBe('invalid-url');
    expect(await reason(fetchReadablePage('https://user:pw@example.org/', { lookupImpl: publicLookup }))).toBe('invalid-url');
  });

  it('blocks private IP literals and privately-resolving hosts without fetching', async () => {
    let fetched = 0;
    const spy = (async () => {
      fetched += 1;
      return htmlResponse('<p>x</p>');
    }) as unknown as typeof fetch;
    expect(await reason(fetchReadablePage('http://127.0.0.1/admin', { fetchImpl: spy, lookupImpl: publicLookup }))).toBe('blocked-host');
    expect(await reason(fetchReadablePage('http://internal.test/', { fetchImpl: spy, lookupImpl: privateLookup }))).toBe('blocked-host');
    expect(fetched).toBe(0);
  });

  it('re-validates every redirect hop and blocks redirects into private space', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://example.org/start') {
        return new Response(null, { headers: { location: 'http://internal.test/secret' }, status: 302 });
      }
      return htmlResponse('<p>x</p>');
    }) as unknown as typeof fetch;
    const lookupImpl: LookupImpl = async (hostname) =>
      hostname === 'internal.test' ? [{ address: '192.168.0.9', family: 4 }] : [{ address: '93.184.215.14', family: 4 }];
    expect(await reason(fetchReadablePage('https://example.org/start', { fetchImpl, lookupImpl }))).toBe('blocked-host');
  });

  it('gives up after three redirects', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) =>
      new Response(null, {
        headers: { location: `${String(input)}0` },
        status: 301,
      })) as unknown as typeof fetch;
    expect(await reason(fetchReadablePage('https://example.org/r', { fetchImpl, lookupImpl: publicLookup }))).toBe('too-many-redirects');
  });

  it('rejects unsupported content types and oversized bodies', async () => {
    expect(
      await reason(
        fetchReadablePage('https://example.org/file.pdf', {
          fetchImpl: async () => new Response('x', { headers: { 'content-type': 'application/pdf' } }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('unsupported-type');
    expect(
      await reason(
        fetchReadablePage('https://example.org/huge', {
          fetchImpl: async () => htmlResponse('x', { 'content-length': String(maxFetchBytes + 1) }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('too-large');
    expect(
      await reason(
        fetchReadablePage('https://example.org/stream', {
          fetchImpl: async () => htmlResponse('y'.repeat(maxFetchBytes + 16)),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('too-large');
  });

  it('maps HTTP failures and empty extractions to typed reasons', async () => {
    expect(
      await reason(
        fetchReadablePage('https://example.org/missing', {
          fetchImpl: async () => new Response('gone', { status: 404 }),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('fetch-failed');
    expect(
      await reason(
        fetchReadablePage('https://example.org/empty', {
          fetchImpl: async () => htmlResponse('<html><body><nav>menu</nav></body></html>'),
          lookupImpl: publicLookup,
        }),
      ),
    ).toBe('extraction-failed');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run packages/companion/src/research-fetch.test.ts`
Expected: FAIL — cannot resolve `./research-fetch.js`.

- [ ] **Step 5: Write the implementation**

```ts
// packages/companion/src/research-fetch.ts
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import { maxSourceBytes } from '@dusori/core';

import { isBlockedAddress } from './address-guard.js';

export type FetchFailureReason =
  | 'invalid-url'
  | 'blocked-host'
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
  timeoutMs?: number;
  now?: () => Date;
}

export const maxFetchBytes = 4 * 1024 * 1024;
const maxRedirects = 3;
const redirectStatuses = [301, 302, 303, 307, 308];
const allowedTypes = ['text/html', 'application/xhtml+xml', 'text/plain'];
const blockedMessage = "This address points at a private network and won't be fetched. Paste the text instead.";
const noTextMessage = 'No readable article text was found on this page. Paste the text instead.';

function parseTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchPageError('That URL is not valid. Use a complete http:// or https:// address.', 'invalid-url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new FetchPageError('Only http:// and https:// pages can be fetched.', 'invalid-url');
  }
  if (url.username || url.password) {
    throw new FetchPageError('Remove the username or password from this URL before fetching it.', 'invalid-url');
  }
  return url;
}

async function assertPublicHost(url: URL, lookupImpl: LookupImpl): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/gu, '');
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new FetchPageError(blockedMessage, 'blocked-host');
    return;
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(host, { all: true });
  } catch {
    throw new FetchPageError('That address could not be resolved. Check the URL or your connection.', 'fetch-failed');
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new FetchPageError(blockedMessage, 'blocked-host');
  }
}

async function guardedResponse(
  initial: URL,
  fetchImpl: typeof fetch,
  lookupImpl: LookupImpl,
  signal: AbortSignal,
): Promise<{ finalUrl: URL; response: Response }> {
  let current = initial;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertPublicHost(current, lookupImpl);
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), { redirect: 'manual', signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new FetchPageError('This page took longer than 15 seconds. Try again, or paste the text instead.', 'timeout');
      }
      throw new FetchPageError('This page could not be fetched. Check the URL or your connection.', 'fetch-failed');
    }
    if (redirectStatuses.includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new FetchPageError('This page redirected without a destination. Save the URL as a reference instead.', 'fetch-failed');
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FetchPageError('This page redirected to an invalid address. Save the URL as a reference instead.', 'fetch-failed');
      }
      current = parseTarget(next.toString());
      continue;
    }
    if (!response.ok) {
      throw new FetchPageError(`This page answered with status ${response.status}. Check the URL, or paste the text instead.`, 'fetch-failed');
    }
    return { finalUrl: current, response };
  }
  throw new FetchPageError('This page redirected more than 3 times. Save the URL as a reference instead.', 'too-many-redirects');
}

function tooLarge(): FetchPageError {
  return new FetchPageError('This page is larger than 4 MiB. Paste the part you need instead.', 'too-large');
}

async function readBody(response: Response): Promise<{ text: string; type: string }> {
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!allowedTypes.includes(type)) {
    throw new FetchPageError('Only HTML and plain-text pages can be fetched. Keep the URL as a reference instead.', 'unsupported-type');
  }
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxFetchBytes) throw tooLarge();
  if (!response.body) {
    throw new FetchPageError('This page had no readable content. Paste the text instead.', 'fetch-failed');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxFetchBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
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

function extract(html: string, url: URL): Extracted {
  const { document } = parseHTML(html);
  let article: ReturnType<InstanceType<typeof Readability>['parse']> = null;
  try {
    article = new Readability(document as unknown as Document).parse();
  } catch {
    article = null;
  }
  const text = article?.textContent?.trim() ?? '';
  if (!text) throw new FetchPageError(noTextMessage, 'extraction-failed');
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
  const fetchImpl = options.fetchImpl ?? fetch;
  const lookupImpl = options.lookupImpl ?? (lookup as unknown as LookupImpl);
  const signal = AbortSignal.timeout(options.timeoutMs ?? 15_000);
  const target = parseTarget(rawUrl);
  const { finalUrl, response } = await guardedResponse(target, fetchImpl, lookupImpl, signal);
  const body = await readBody(response);
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/companion/src/research-fetch.test.ts`
Expected: PASS. If the first fixture assertion fails because Readability kept the nav/footer, lengthen the fixture's article paragraphs (Readability's default `charThreshold` is 500) — do not weaken the assertions.

- [ ] **Step 7: Commit**

```bash
git add packages/companion/package.json pnpm-lock.yaml packages/companion/src/research-fetch.ts packages/companion/src/research-fetch.test.ts packages/companion/src/__fixtures__/article.html
git commit -m "feat(companion): add SSRF-guarded readability page fetching"
```

---

### Task 3: Companion MS Learn ranked-search module

**Files:**
- Create: `packages/companion/src/research-mslearn.ts`
- Create: `packages/companion/src/__fixtures__/mslearn-search.json`
- Test: `packages/companion/src/research-mslearn.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `interface RankedResult { summary: string; title: string; url: string }`, `class MsLearnProxyError extends Error`, `searchMsLearnRanked(query: string, fetchImpl?: typeof fetch): Promise<RankedResult[]>`.

- [ ] **Step 1: Capture a real fixture**

Run:

```bash
curl -s 'https://learn.microsoft.com/api/search?search=entra%20id&locale=en-us&%24top=2' > packages/companion/src/__fixtures__/mslearn-search.json
```

Then open the file and confirm it has the verified shape `{ "results": [{ "title": ..., "url": ..., "description": ..., ...extra fields... }] }` with absolute `url` values. Keep the extra fields (`displayUrl`, `descriptions`, `breadcrumbs`, …) — they prove the lenient parse. If offline, hand-write the file with that exact shape, two results, plus the extra fields.

- [ ] **Step 2: Write the failing test**

```ts
// packages/companion/src/research-mslearn.test.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MsLearnProxyError, searchMsLearnRanked } from './research-mslearn.js';

async function fixture(): Promise<string> {
  return readFile(join(import.meta.dirname, '__fixtures__', 'mslearn-search.json'), 'utf8');
}

describe('searchMsLearnRanked', () => {
  it('parses the ranked search response leniently and trims the results', async () => {
    const body = await fixture();
    let requested = '';
    const results = await searchMsLearnRanked('entra id', (async (input: RequestInfo | URL) => {
      requested = String(input);
      return new Response(body, { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch);
    expect(requested).toContain('https://learn.microsoft.com/api/search?');
    expect(requested).toContain('search=entra+id');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(8);
    for (const result of results) {
      expect(result.title).toBeTruthy();
      expect(result.url.startsWith('https://learn.microsoft.com/')).toBe(true);
      expect(typeof result.summary).toBe('string');
    }
  });

  it('throws MsLearnProxyError on upstream failure and unfamiliar shapes', async () => {
    await expect(
      searchMsLearnRanked('x', (async () => new Response('down', { status: 503 })) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
    await expect(
      searchMsLearnRanked('x', (async () => Response.json({ unexpected: true })) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(MsLearnProxyError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/companion/src/research-mslearn.test.ts`
Expected: FAIL — cannot resolve `./research-mslearn.js`.

- [ ] **Step 4: Write the implementation**

```ts
// packages/companion/src/research-mslearn.ts
import { z } from 'zod';

const upstream = 'https://learn.microsoft.com/api/search';

const UpstreamSchema = z.object({
  results: z.array(
    z.object({
      description: z.string().optional(),
      title: z.string(),
      url: z.string(),
    }),
  ),
});

export interface RankedResult {
  summary: string;
  title: string;
  url: string;
}

export class MsLearnProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MsLearnProxyError';
  }
}

export async function searchMsLearnRanked(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RankedResult[]> {
  const url = new URL(upstream);
  url.search = new URLSearchParams({ $top: '8', locale: 'en-us', search: query }).toString();
  let response: Response;
  try {
    response = await fetchImpl(url.toString());
  } catch {
    throw new MsLearnProxyError('Microsoft Learn ranked search could not be reached.');
  }
  if (!response.ok) throw new MsLearnProxyError('Microsoft Learn ranked search could not be reached.');
  const parsed = UpstreamSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MsLearnProxyError('Microsoft Learn returned an unfamiliar search format.');
  return parsed.data.results.slice(0, 8).map((result) => ({
    summary: result.description ?? '',
    title: result.title.replace(/\s+/gu, ' ').trim(),
    url: new URL(result.url, 'https://learn.microsoft.com/').toString(),
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/companion/src/research-mslearn.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/companion/src/research-mslearn.ts packages/companion/src/research-mslearn.test.ts packages/companion/src/__fixtures__/mslearn-search.json
git commit -m "feat(companion): add ranked Microsoft Learn search module"
```

---

### Task 4: Companion routes `/api/research/fetch` and `/api/research/mslearn-search`

**Files:**
- Modify: `packages/companion/src/server.ts`
- Test: `packages/companion/src/server.test.ts`

**Interfaces:**
- Consumes: `fetchReadablePage`, `FetchPageError`, `LookupImpl` (Task 2); `searchMsLearnRanked`, `MsLearnProxyError` (Task 3).
- Produces: `ServerOptions` gains `research?: { fetchImpl?: typeof fetch; lookupImpl?: LookupImpl }`. Routes (both behind the existing token + origin hook):
  - `POST /api/research/fetch` body `{ url }` → 200 `FetchedPageResult` | 400/502 `{ error, reason }`
  - `GET /api/research/mslearn-search?q=` → 200 `{ results: RankedResult[] }` | 502 `{ error, reason: 'fetch-failed' }`

- [ ] **Step 1: Write the failing tests** — append to the `describe('companion boundary', …)` block in `packages/companion/src/server.test.ts`, and add a fixture-backed server helper. Add these imports at the top of the file:

```ts
import { readFile } from 'node:fs/promises';
import type { LookupImpl } from './research-fetch.js';
```

Append inside the describe block:

```ts
  it('guards the research routes with the same token and origin rules', async () => {
    const { server } = await fixture();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: '/api/research/fetch',
          payload: { url: 'https://example.org/' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/research/mslearn-search?q=entra',
          headers: headers(token, 'https://evil.example'),
        })
      ).statusCode,
    ).toBe(403);
  });

  it('fetches, extracts, and reports typed failures on /api/research/fetch', async () => {
    const html = await readFile(new URL('./__fixtures__/article.html', import.meta.url), 'utf8');
    const publicLookup: LookupImpl = async () => [{ address: '93.184.215.14', family: 4 }];
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        fetchImpl: (async () =>
          new Response(html, { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch,
        lookupImpl: publicLookup,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);

    const ok = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { url: 'https://example.org/attention' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ finalUrl: 'https://example.org/attention', truncated: false });
    expect(ok.json().text).toContain('weigh the other tokens');

    const blocked = await server.inject({
      method: 'POST',
      url: '/api/research/fetch',
      headers: { ...headers(), 'content-type': 'application/json' },
      payload: { url: 'http://127.0.0.1/admin' },
    });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json()).toMatchObject({ reason: 'blocked-host' });
  });

  it('proxies ranked Microsoft Learn search behind the token', async () => {
    const body = await readFile(new URL('./__fixtures__/mslearn-search.json', import.meta.url), 'utf8');
    const root = await mkdtemp(join(tmpdir(), 'dusori-root-'));
    const server = await createServer({
      research: {
        fetchImpl: (async () =>
          new Response(body, { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
      },
      root,
      staticDirectory: join(root, 'missing'),
      token,
    });
    servers.push(server);
    const response = await server.inject({
      method: 'GET',
      url: '/api/research/mslearn-search?q=entra%20id',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results.length).toBeGreaterThan(0);
    expect(response.json().results[0]).toHaveProperty('title');
    expect(response.json().results[0]).toHaveProperty('url');
    expect(response.json().results[0]).toHaveProperty('summary');
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run packages/companion/src/server.test.ts`
Expected: existing tests PASS; the three new tests FAIL (404 route not found / missing `research` option).

- [ ] **Step 3: Implement the routes** in `packages/companion/src/server.ts`.

Add imports after the existing local imports:

```ts
import { FetchPageError, fetchReadablePage, type LookupImpl } from './research-fetch.js';
import { MsLearnProxyError, searchMsLearnRanked } from './research-mslearn.js';
```

Extend `ServerOptions`:

```ts
export interface ServerOptions {
  root?: string;
  staticDirectory?: string;
  token: string;
  hostedOrigin?: string;
  research?: { fetchImpl?: typeof fetch; lookupImpl?: LookupImpl };
}
```

Add after the `POST /api/workspace/file` route, before the static-assets block:

```ts
const FetchBody = z.object({ url: z.string().min(1) });
const badRequestReasons = new Set([
  'blocked-host',
  'invalid-url',
  'too-large',
  'too-many-redirects',
  'unsupported-type',
]);

server.post('/api/research/fetch', async (request, reply) => {
  const body = FetchBody.parse(request.body);
  try {
    return await fetchReadablePage(body.url, options.research ?? {});
  } catch (error) {
    if (error instanceof FetchPageError) {
      return reply
        .code(badRequestReasons.has(error.reason) ? 400 : 502)
        .send({ error: error.message, reason: error.reason });
    }
    throw error;
  }
});

server.get('/api/research/mslearn-search', async (request, reply) => {
  const query = z.object({ q: z.string().min(1) }).parse(request.query);
  try {
    return { results: await searchMsLearnRanked(query.q, options.research?.fetchImpl) };
  } catch (error) {
    if (error instanceof MsLearnProxyError) {
      return reply.code(502).send({ error: error.message, reason: 'fetch-failed' });
    }
    throw error;
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/companion/src/server.test.ts`
Expected: PASS (all, including the pre-existing boundary tests).

- [ ] **Step 5: Commit**

```bash
git add packages/companion/src/server.ts packages/companion/src/server.test.ts
git commit -m "feat(companion): expose research fetch and ranked-search routes"
```

---

### Task 5: Widen `SourceOriginSchema` to tolerant strings

**Files:**
- Modify: `packages/core/src/schemas/workspace.ts:34-38`
- Test: `packages/core/src/sources/import.test.ts` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `SourceOrigin` becomes `{ provider: string; capturedVia: string; capturedAt: string }`. Existing writers (`'mslearn'`/`'wikipedia'` literals) remain assignable.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/sources/import.test.ts`:

```ts
describe('source origin schema', () => {
  it('accepts companion and future provenance values as tolerant strings', () => {
    const record = SourceRecordSchema.parse({
      fetchedAt: '2026-07-21T00:00:00.000Z',
      method: 'url',
      origin: {
        capturedAt: '2026-07-21T00:00:00.000Z',
        capturedVia: 'page-extract',
        provider: 'companion',
      },
      sha256: 'a'.repeat(64),
      title: 'Example',
      url: 'https://example.org/',
    });
    expect(record.origin?.provider).toBe('companion');
    expect(() =>
      SourceRecordSchema.parse({
        fetchedAt: '2026-07-21T00:00:00.000Z',
        method: 'url',
        origin: { capturedAt: '2026-07-21T00:00:00.000Z', capturedVia: 'page-extract', provider: '' },
        sha256: 'a'.repeat(64),
        title: 'Example',
        url: 'https://example.org/',
      }),
    ).toThrow();
  });
});
```

If `SourceRecordSchema` is not already imported in that test file, add it to the existing `@dusori/core`-internal import from `../schemas/workspace.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/sources/import.test.ts`
Expected: FAIL — `'companion'` rejected by the enum.

- [ ] **Step 3: Widen the schema** — replace lines 34–38 of `packages/core/src/schemas/workspace.ts`:

```ts
// Known provider values: 'mslearn', 'wikipedia', 'companion'.
// Known capturedVia values: 'catalog-reference', 'api-extract', 'page-extract'.
// Tolerant strings, not enums, so a future provenance value never breaks a reader again.
export const SourceOriginSchema = z.object({
  provider: z.string().min(1).max(40),
  capturedVia: z.string().min(1).max(40),
  capturedAt: z.string().datetime(),
});
```

- [ ] **Step 4: Run the full core suite to verify nothing depended on the enum**

Run: `pnpm vitest run packages/core`
Expected: PASS. Then run `pnpm typecheck`; expected: clean (Phase 1 writers use literal values that are still valid strings).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas/workspace.ts packages/core/src/sources/import.test.ts
git commit -m "feat(core): widen source origin provenance to tolerant strings"
```

---

### Task 6: Extract shared `cappedMarkdown` helper

**Files:**
- Create: `packages/core/src/sources/capped.ts`
- Modify: `packages/core/src/research/providers/wikipedia.ts:3,66-82`
- Modify: `packages/core/src/index.ts` (no change needed — `sources/import.js` already exported; add `export * from './sources/capped.js';` after it)
- Test: `packages/core/src/sources/capped.test.ts`

**Interfaces:**
- Consumes: `maxSourceBytes` from `./import.js`.
- Produces: `cappedMarkdown(prefix: string, body: string): string` — returns `prefix + body + '\n'`, byte-capped at `maxSourceBytes` with a trailing `'\n\n[truncated]\n'` marker when over.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/sources/capped.test.ts
import { describe, expect, it } from 'vitest';

import { cappedMarkdown } from './capped.js';
import { maxSourceBytes } from './import.js';

describe('cappedMarkdown', () => {
  it('returns prefix, body, and a trailing newline when under the cap', () => {
    expect(cappedMarkdown('# Title\n\n', 'body')).toBe('# Title\n\nbody\n');
  });

  it('truncates to the source cap with a visible marker', () => {
    const result = cappedMarkdown('# Title\n\n', 'x'.repeat(maxSourceBytes + 1024));
    expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(maxSourceBytes);
    expect(result.endsWith('\n\n[truncated]\n')).toBe(true);
    expect(result.startsWith('# Title\n\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/sources/capped.test.ts`
Expected: FAIL — cannot resolve `./capped.js`.

- [ ] **Step 3: Implement, generalizing the existing Wikipedia logic verbatim**

```ts
// packages/core/src/sources/capped.ts
import { maxSourceBytes } from './import.js';

const marker = '\n\n[truncated]\n';

export function cappedMarkdown(prefix: string, body: string): string {
  const encoder = new TextEncoder();
  const content = `${prefix}${body}\n`;
  if (encoder.encode(content).byteLength <= maxSourceBytes) return content;

  const available =
    maxSourceBytes - encoder.encode(prefix).byteLength - encoder.encode(marker).byteLength;
  const bytes = encoder.encode(body);
  const truncated = new TextDecoder().decode(bytes.slice(0, Math.max(0, available)));
  let result = `${prefix}${truncated}${marker}`;
  while (encoder.encode(result).byteLength > maxSourceBytes) {
    result = `${prefix}${truncated.slice(0, -(encoder.encode(result).byteLength - maxSourceBytes))}${marker}`;
  }
  return result;
}
```

Then in `packages/core/src/research/providers/wikipedia.ts`:
- Replace the import `import { maxSourceBytes } from '../../sources/import.js';` with `import { cappedMarkdown } from '../../sources/capped.js';`
- Replace the whole `cappedContent` function (lines 66–82) with:

```ts
function cappedContent(title: string, url: string, extract: string): string {
  return cappedMarkdown(`# ${title}\n\nOriginal URL: <${url}>\n\n`, extract);
}
```

Add to `packages/core/src/index.ts` after the `sources/import.js` line:

```ts
export * from './sources/capped.js';
```

- [ ] **Step 4: Run the capped test and the Wikipedia provider tests**

Run: `pnpm vitest run packages/core/src/sources/capped.test.ts packages/core/src/research/providers/wikipedia.test.ts`
Expected: PASS both — the Wikipedia truncation behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/capped.ts packages/core/src/sources/capped.test.ts packages/core/src/research/providers/wikipedia.ts packages/core/src/index.ts
git commit -m "refactor(core): extract shared capped-markdown source helper"
```

---

### Task 7: Core companion research client

**Files:**
- Create: `packages/core/src/research/companion.ts`
- Modify: `packages/core/src/research/index.ts` (add `export * from './companion.js';`)
- Test: `packages/core/src/research/companion.test.ts`

**Interfaces:**
- Consumes: `ResearchCandidate`, `ResearchQuery` from `./types.js`.
- Produces:
  - `type FetchedPage = { title: string; text: string; byline?: string; siteName?: string; finalUrl: string; fetchedAt: string; truncated: boolean }`
  - `class CompanionFetchError extends Error { readonly reason: string }`
  - `interface CompanionResearchClient { fetchPage(url: string): Promise<FetchedPage>; searchMsLearnRanked(query: ResearchQuery): Promise<ResearchCandidate[]> }`
  - `createCompanionResearchClient(options: { baseUrl: string; token: string; fetchImpl?: typeof fetch }): CompanionResearchClient`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/research/companion.test.ts
import { describe, expect, it } from 'vitest';

import { CompanionFetchError, createCompanionResearchClient } from './companion.js';
import type { ResearchQuery } from './types.js';

const query: ResearchQuery = { objectiveTitle: 'Configure Entra ID', terms: ['entra'], topicTitle: 'AZ-104' };

const page = {
  fetchedAt: '2026-07-21T00:00:00.000Z',
  finalUrl: 'https://example.org/attention',
  text: 'Attention lets each token weigh the other tokens in its context.',
  title: 'Attention in transformers',
  truncated: false,
};

function client(fetchImpl: typeof fetch) {
  return createCompanionResearchClient({ baseUrl: 'http://127.0.0.1:8000/', fetchImpl, token: 'secret' });
}

describe('createCompanionResearchClient', () => {
  it('POSTs the URL with the bearer token and parses the fetched page', async () => {
    let captured: { init?: RequestInit; input?: string } = {};
    const result = await client((async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { init, input: String(input) };
      return Response.json(page);
    }) as unknown as typeof fetch).fetchPage('https://example.org/attention');
    expect(result).toEqual(page);
    expect(captured.input).toBe('http://127.0.0.1:8000/api/research/fetch');
    expect(captured.init?.method).toBe('POST');
    expect(new Headers(captured.init?.headers).get('authorization')).toBe('Bearer secret');
    expect(JSON.parse(String(captured.init?.body))).toEqual({ url: 'https://example.org/attention' });
  });

  it('surfaces companion failure sentences and reasons as CompanionFetchError', async () => {
    const failing = client((async () =>
      Response.json(
        { error: "This address points at a private network and won't be fetched. Paste the text instead.", reason: 'blocked-host' },
        { status: 400 },
      )) as unknown as typeof fetch);
    await expect(failing.fetchPage('http://10.0.0.5/')).rejects.toMatchObject({
      message: "This address points at a private network and won't be fetched. Paste the text instead.",
      reason: 'blocked-host',
    });
    const dead = client((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(dead.fetchPage('https://example.org/')).rejects.toBeInstanceOf(CompanionFetchError);
  });

  it('maps ranked search results into descending-score mslearn candidates', async () => {
    const results = await client((async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        'http://127.0.0.1:8000/api/research/mslearn-search?q=Configure%20Entra%20ID',
      );
      return Response.json({
        results: [
          { summary: 'First summary.', title: 'First', url: 'https://learn.microsoft.com/en-us/first' },
          { summary: 'Second summary.', title: 'Second', url: 'https://learn.microsoft.com/en-us/second' },
        ],
      });
    }) as unknown as typeof fetch).searchMsLearnRanked(query);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      key: 'mslearn:https://learn.microsoft.com/en-us/first',
      provider: 'mslearn',
      score: 2,
      snippet: 'First summary.',
      title: 'First',
      url: 'https://learn.microsoft.com/en-us/first',
    });
    expect(results[1].score).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/research/companion.test.ts`
Expected: FAIL — cannot resolve `./companion.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/research/companion.ts
import { z } from 'zod';

import type { ResearchCandidate, ResearchQuery } from './types.js';

const FetchedPageSchema = z.object({
  byline: z.string().optional(),
  fetchedAt: z.string().datetime(),
  finalUrl: z.url(),
  siteName: z.string().optional(),
  text: z.string().min(1),
  title: z.string().min(1),
  truncated: z.boolean(),
});

export type FetchedPage = z.infer<typeof FetchedPageSchema>;

const RankedResponseSchema = z.object({
  results: z.array(z.object({ summary: z.string(), title: z.string(), url: z.url() })),
});

const FailureSchema = z.object({ error: z.string().optional(), reason: z.string().optional() });

export class CompanionFetchError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'CompanionFetchError';
  }
}

export interface CompanionResearchClient {
  fetchPage(url: string): Promise<FetchedPage>;
  searchMsLearnRanked(query: ResearchQuery): Promise<ResearchCandidate[]>;
}

export interface CompanionClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

const fallbackError = 'The companion could not fetch this page. Check that it is still running.';

export function createCompanionResearchClient(options: CompanionClientOptions): CompanionResearchClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/+$/u, '');
  const authorization = { Authorization: `Bearer ${options.token}` };

  async function failureFrom(response: Response): Promise<CompanionFetchError> {
    const parsed = FailureSchema.safeParse(await response.json().catch(() => null));
    return new CompanionFetchError(
      parsed.success && parsed.data.error ? parsed.data.error : fallbackError,
      parsed.success && parsed.data.reason ? parsed.data.reason : 'fetch-failed',
    );
  }

  return {
    async fetchPage(url) {
      const response = await fetchImpl(`${base}/api/research/fetch`, {
        body: JSON.stringify({ url }),
        headers: { ...authorization, 'Content-Type': 'application/json' },
        method: 'POST',
      }).catch(() => null);
      if (!response) throw new CompanionFetchError(fallbackError, 'fetch-failed');
      if (!response.ok) throw await failureFrom(response);
      const parsed = FetchedPageSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) {
        throw new CompanionFetchError('The companion returned an unfamiliar fetch format.', 'fetch-failed');
      }
      return parsed.data;
    },

    async searchMsLearnRanked(query) {
      const url = `${base}/api/research/mslearn-search?q=${encodeURIComponent(query.objectiveTitle)}`;
      const response = await fetchImpl(url, { headers: authorization }).catch(() => null);
      if (!response?.ok) throw new Error('Microsoft Learn ranked search could not be reached.');
      const parsed = RankedResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new Error('The companion returned an unfamiliar search format.');
      return parsed.data.results.map((result, index, all) => ({
        key: `mslearn:${result.url}`,
        meta: {},
        provider: 'mslearn' as const,
        score: all.length - index,
        snippet: result.summary,
        title: result.title,
        url: result.url,
      }));
    },
  };
}
```

Add to `packages/core/src/research/index.ts`:

```ts
export * from './companion.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/research/companion.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/research/companion.ts packages/core/src/research/companion.test.ts packages/core/src/research/index.ts
git commit -m "feat(core): add zod-parsed companion research client"
```

---

### Task 8: Core `upgradeSource` with conflict-safe rewrite

**Files:**
- Create: `packages/core/src/sources/upgrade.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './sources/upgrade.js';`)
- Test: `packages/core/src/sources/upgrade.test.ts`

**Interfaces:**
- Consumes: `cappedMarkdown` (Task 6), `FetchedPage` (Task 7), `appendTopicUpdate`, `readMachineFile`, workspace schemas, `topicRoot`, `StorageAdapter`, `StorageConflictError`.
- Produces:
  - `buildUpgradedContent(record: SourceRecord, page: FetchedPage): string`
  - `upgradeSource(storage: StorageAdapter, input: { topicSlug: string; sha256: string; page: FetchedPage }, now?: Date): Promise<{ path: string; record: SourceRecord; updatePath?: string }>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/sources/upgrade.test.ts
import { describe, expect, it } from 'vitest';

import { StorageConflictError } from '../adapters.js';
import type { FetchedPage } from '../research/companion.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { addSource, maxSourceBytes, readSourceManifest } from './import.js';
import { buildUpgradedContent, upgradeSource } from './upgrade.js';

const now = new Date('2026-07-21T15:30:00.000Z');

const page: FetchedPage = {
  byline: 'A. Vaswani',
  fetchedAt: '2026-07-21T15:30:00.000Z',
  finalUrl: 'https://example.org/attention-final',
  siteName: 'Example Journal',
  text: 'Attention lets each token weigh the other tokens in its context.',
  title: 'Attention in transformers',
  truncated: false,
};

async function urlSourceFixture() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Dusori', now);
  await createTopic(storage, 'Transformers', now);
  const added = await addSource(
    storage,
    { method: 'url', title: 'Attention paper', topicSlug: 'transformers', url: 'https://example.org/attention' },
    now,
  );
  return { added, storage };
}

describe('buildUpgradedContent', () => {
  it('writes provenance and the resolved URL when it differs', () => {
    const content = buildUpgradedContent(
      {
        fetchedAt: now.toISOString(),
        method: 'url',
        sha256: 'a'.repeat(64),
        title: 'Attention paper',
        url: 'https://example.org/attention',
      },
      page,
    );
    expect(content).toContain('# Attention paper');
    expect(content).toContain('Original URL: <https://example.org/attention>');
    expect(content).toContain('Resolved URL: <https://example.org/attention-final>');
    expect(content).toContain('Byline: A. Vaswani');
    expect(content).toContain('Site: Example Journal');
    expect(content).toContain('Fetched from example.org on 2026-07-21 via the local companion.');
    expect(content).toContain('weigh the other tokens');
  });

  it('caps oversized text with the shared truncation marker', () => {
    const content = buildUpgradedContent(
      { fetchedAt: now.toISOString(), method: 'url', sha256: 'a'.repeat(64), title: 'Big', url: 'https://example.org/big' },
      { ...page, text: 'x'.repeat(maxSourceBytes + 1024) },
    );
    expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(maxSourceBytes);
    expect(content.endsWith('\n\n[truncated]\n')).toBe(true);
  });
});

describe('upgradeSource', () => {
  it('replaces the stub, updates the manifest record, and logs the update', async () => {
    const { added, storage } = await urlSourceFixture();
    const upgraded = await upgradeSource(
      storage,
      { page, sha256: added.record.sha256, topicSlug: 'transformers' },
      now,
    );

    const item = await storage.read(upgraded.path);
    expect(item?.content).toContain('weigh the other tokens');

    const manifest = await readSourceManifest(storage, 'transformers', now);
    const record = manifest.sources.find((source) => source.sha256 === added.record.sha256);
    expect(record).toMatchObject({
      mediaType: 'text/markdown',
      method: 'url',
      origin: { capturedVia: 'page-extract', provider: 'companion' },
      path: added.path,
      sha256: added.record.sha256,
      title: 'Attention paper',
      url: 'https://example.org/attention',
    });
    expect(record?.size).toBe(new TextEncoder().encode(item?.content ?? '').byteLength);

    const log = await storage.read(upgraded.updatePath ?? '');
    expect(log?.content).toContain('Upgraded url source');
    expect(log?.content).toContain('Attention paper');
  });

  it('raises StorageConflictError when the item file changed outside Dusori', async () => {
    const { added, storage } = await urlSourceFixture();
    const item = await storage.read(added.path);
    storage.files.set(added.path, { content: `${item?.content ?? ''}external edit\n`, modifiedAt: 99 });
    await expect(
      upgradeSource(storage, { page, sha256: added.record.sha256, topicSlug: 'transformers' }, now),
    ).rejects.toBeInstanceOf(StorageConflictError);
  });

  it('rejects unknown source ids with a friendly sentence', async () => {
    const { storage } = await urlSourceFixture();
    await expect(
      upgradeSource(storage, { page, sha256: 'b'.repeat(64), topicSlug: 'transformers' }, now),
    ).rejects.toThrow('This URL source is missing from the manifest. Refresh and try again.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/sources/upgrade.test.ts`
Expected: FAIL — cannot resolve `./upgrade.js`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/sources/upgrade.ts
import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import type { FetchedPage } from '../research/companion.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import {
  SourceManifestSchema,
  SourceRecordSchema,
  TopicStateSchema,
  schemaVersion,
  type SourceManifest,
  type SourceRecord,
} from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';
import { cappedMarkdown } from './capped.js';

export function buildUpgradedContent(record: SourceRecord, page: FetchedPage): string {
  const host = new URL(page.finalUrl).host;
  const fetchedOn = page.fetchedAt.slice(0, 10);
  const prefix = [
    `# ${record.title}`,
    '',
    `Original URL: <${record.url ?? page.finalUrl}>`,
    ...(record.url && page.finalUrl !== record.url ? ['', `Resolved URL: <${page.finalUrl}>`] : []),
    ...(page.byline ? ['', `Byline: ${page.byline}`] : []),
    ...(page.siteName ? ['', `Site: ${page.siteName}`] : []),
    '',
    `Fetched from ${host} on ${fetchedOn} via the local companion.`,
    '',
    '',
  ].join('\n');
  return cappedMarkdown(prefix, page.text.replace(/\r\n?/gu, '\n'));
}

export interface UpgradedSource {
  path: string;
  record: SourceRecord;
  updatePath?: string;
}

export async function upgradeSource(
  storage: StorageAdapter,
  input: { topicSlug: string; sha256: string; page: FetchedPage },
  now = new Date(),
): Promise<UpgradedSource> {
  const root = topicRoot(input.topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const manifestPath = `${root}/Sources/manifest.json`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    let manifest: SourceManifest;
    try {
      manifest = SourceManifestSchema.parse(JSON.parse(manifestFile.content));
    } catch {
      throw new Error('The source manifest is invalid. Restore or re-import a valid workspace.');
    }

    const record = manifest.sources.find(
      (source) => source.method === 'url' && source.sha256 === input.sha256,
    );
    if (!record?.path || !record.url) {
      throw new Error('This URL source is missing from the manifest. Refresh and try again.');
    }

    const content = buildUpgradedContent(record, input.page);
    const itemFile = await storage.read(record.path);
    if (!itemFile) {
      throw new Error('This source file is missing. Restore it from a backup, then try again.');
    }
    await storage.write(record.path, content, { expectedHash: itemFile.hash });

    const nextRecord = SourceRecordSchema.parse({
      ...record,
      fetchedAt: now.toISOString(),
      mediaType: 'text/markdown',
      origin: {
        capturedAt: now.toISOString(),
        capturedVia: 'page-extract',
        provider: 'companion',
      },
      size: new TextEncoder().encode(content).byteLength,
    });
    const nextManifest = SourceManifestSchema.parse({
      schemaVersion,
      sources: manifest.sources.map((source) => (source === record ? nextRecord : source)),
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
    } catch (error) {
      if (error instanceof StorageConflictError && attempt < 2) continue;
      throw error;
    }

    const relativePath = record.path.slice(`${root}/`.length).replace(/\.md$/u, '');
    const updatePath = await appendTopicUpdate(
      storage,
      input.topicSlug,
      `- Upgraded url source [[../../../${relativePath}|${record.title}]] to full page content.`,
      now,
    );
    return { path: record.path, record: nextRecord, updatePath };
  }

  throw new Error('The source manifest changed repeatedly. Try upgrading the source again.');
}
```

Add to `packages/core/src/index.ts` after the `sources/capped.js` line:

```ts
export * from './sources/upgrade.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/sources/upgrade.test.ts`
Expected: PASS. (If the external-edit test fails because `MemoryStorageAdapter.files` entries need a specific shape, mirror the `MemoryFile` interface — `{ content, modifiedAt }` — exactly as in `packages/core/src/testing/memory-storage.ts:11-14`.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources/upgrade.ts packages/core/src/sources/upgrade.test.ts packages/core/src/index.ts
git commit -m "feat(core): add conflict-safe URL source upgrade"
```

---

### Task 9: MS Learn provider factory with ranked path and silent fallback

**Files:**
- Modify: `packages/core/src/research/providers/mslearn.ts`
- Test: `packages/core/src/research/providers/mslearn.test.ts` (append)

**Interfaces:**
- Consumes: `ResearchCandidate[]` produced by `CompanionResearchClient.searchMsLearnRanked` (Task 7).
- Produces: `type RankedMsLearnSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>`; `createMsLearnProvider(options?: { ranked?: RankedMsLearnSearch }): ResearchProvider`; `msLearnProvider` stays exported and behaviorally identical (`msLearnProvider = createMsLearnProvider()`).

- [ ] **Step 1: Write the failing tests** — append to `packages/core/src/research/providers/mslearn.test.ts` (reuse that file's existing query/fixture helpers; the snippets below assume a `ResearchQuery` named `query` exists — if the file names it differently, use its name):

```ts
describe('createMsLearnProvider ranked path', () => {
  const rankedCandidate = {
    key: 'mslearn:https://learn.microsoft.com/en-us/ranked',
    meta: {},
    provider: 'mslearn' as const,
    score: 1,
    snippet: 'Ranked summary.',
    title: 'Ranked module',
    url: 'https://learn.microsoft.com/en-us/ranked',
  };

  it('uses the ranked search when provided and never touches the catalog', async () => {
    let catalogCalls = 0;
    const provider = createMsLearnProvider({ ranked: async () => [rankedCandidate] });
    const results = await provider.search(query, (async () => {
      catalogCalls += 1;
      return Response.json({ modules: [] });
    }) as unknown as typeof fetch);
    expect(results).toEqual([rankedCandidate]);
    expect(catalogCalls).toBe(0);
  });

  it('falls back to catalog scoring when the ranked search fails or is empty', async () => {
    for (const ranked of [async () => Promise.reject(new Error('down')), async () => []]) {
      const provider = createMsLearnProvider({ ranked });
      const results = await provider.search(query, (async () =>
        Response.json({
          modules: [
            {
              popularity: 0.5,
              summary: 'Configure identity.',
              title: 'Configure Microsoft Entra ID',
              uid: 'learn.entra',
              url: 'https://learn.microsoft.com/en-us/training/modules/entra',
            },
          ],
        })) as unknown as typeof fetch);
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('mslearn:learn.entra');
    }
  });

  it('captures ranked candidates without a bogus module UID line', async () => {
    const provider = createMsLearnProvider();
    const capture = await provider.capture(rankedCandidate, fetch);
    expect(capture.content).not.toContain('Module UID: https://');
    expect(capture.content).toContain('# Ranked module');
    expect(capture.content).toContain('Original URL: <https://learn.microsoft.com/en-us/ranked>');
  });
});
```

Add `createMsLearnProvider` to that file's import from `./mslearn.js`.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm vitest run packages/core/src/research/providers/mslearn.test.ts`
Expected: existing tests PASS; new tests FAIL (`createMsLearnProvider` is not exported).

- [ ] **Step 3: Refactor `mslearn.ts` to a factory.** Keep `MS_LEARN_DISCLOSURE`, `readCatalog`, `moduleMeta` unchanged. Replace `metadataLines`, add the type, extract the catalog search, and replace the `msLearnProvider` const:

```ts
function metadataLines(candidate: ResearchCandidate): string[] {
  const suffix = candidate.key.slice('mslearn:'.length);
  const lines = suffix.startsWith('http') ? [] : [`- Module UID: ${suffix}`];
  const duration = candidate.meta.duration_in_minutes;
  if (duration) lines.push(`- Duration: ${duration} minutes`);
  if (candidate.meta.levels) lines.push(`- Levels: ${candidate.meta.levels}`);
  if (candidate.meta.products) lines.push(`- Products: ${candidate.meta.products}`);
  return lines;
}

async function catalogSearch(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
  const modules = await readCatalog(fetchImpl);
  return modules
    .map((module) => ({
      key: `mslearn:${module.uid}`,
      meta: moduleMeta(module),
      popularity: module.popularity,
      provider: 'mslearn' as const,
      score: scoreCandidate(query, module),
      snippet: module.summary,
      title: module.title.replace(/\s+/gu, ' ').trim(),
      url: module.url,
    }))
    .sort(compareCandidateScores)
    .slice(0, 8)
    .map((candidate) => ({
      key: candidate.key,
      meta: candidate.meta,
      provider: candidate.provider,
      score: candidate.score,
      snippet: candidate.snippet,
      title: candidate.title,
      url: candidate.url,
    }));
}

export type RankedMsLearnSearch = (query: ResearchQuery) => Promise<ResearchCandidate[]>;

export function createMsLearnProvider(
  options: { ranked?: RankedMsLearnSearch } = {},
): ResearchProvider {
  return {
    disclosure: MS_LEARN_DISCLOSURE,
    id: 'mslearn',
    label: 'Microsoft Learn',

    async search(query: ResearchQuery, fetchImpl: typeof fetch): Promise<ResearchCandidate[]> {
      if (options.ranked) {
        try {
          const ranked = await options.ranked(query);
          if (ranked.length > 0) return ranked.slice(0, 8);
        } catch {
          // Ranked search is an enhancement; fall back to the shipped catalog scoring.
        }
      }
      return catalogSearch(query, fetchImpl);
    },

    async capture(candidate: ResearchCandidate): Promise<ResearchCapture> {
      const date = new Date().toISOString().slice(0, 10);
      const isRanked = candidate.key.slice('mslearn:'.length).startsWith('http');
      const closing = isRanked
        ? `This is a Microsoft Learn search reference captured on ${date}, not a snapshot of the page.`
        : `This is a Microsoft Learn catalog reference captured on ${date}, not a snapshot of the module page.`;
      const content = [
        `# ${candidate.title}`,
        '',
        `Original URL: <${candidate.url}>`,
        '',
        candidate.snippet,
        '',
        '## Catalog metadata',
        '',
        ...metadataLines(candidate),
        '',
        closing,
        '',
      ].join('\n');
      return { content, title: candidate.title, url: candidate.url };
    },
  };
}

export const msLearnProvider: ResearchProvider = createMsLearnProvider();
```

Note: for ranked candidates `metadataLines` returns `[]`, so the "## Catalog metadata" heading is followed only by the closing sentence — acceptable; do not special-case it further.

- [ ] **Step 4: Run the provider tests and the whole core suite**

Run: `pnpm vitest run packages/core`
Expected: PASS — including all pre-existing mslearn tests (the catalog path is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/research/providers/mslearn.ts packages/core/src/research/providers/mslearn.test.ts
git commit -m "feat(core): let the MS Learn provider use companion ranked search"
```

---

### Task 10: App companion client state

**Files:**
- Modify: `apps/app/src/routes/+page.svelte` (companion connection ~lines 60, 94-107, and the `ResearchPanel`/`SourceLibrary` instantiations ~lines 729-743)

**Interfaces:**
- Consumes: `createCompanionResearchClient`, `CompanionResearchClient` from `@dusori/core`.
- Produces: `companionClient: CompanionResearchClient | null` page state, passed as the `companion` prop to both `ResearchPanel` and `SourceLibrary` (props created in Tasks 11 and 12).

- [ ] **Step 1: Add the client state.** In the `@dusori/core` import block at the top of `+page.svelte`, add `createCompanionResearchClient` and `type CompanionResearchClient`. Next to `let companionStatus = 'Not connected';` add:

```ts
let companionClient: CompanionResearchClient | null = null;
```

Replace the body of `connectCompanionFromUrl` so a healthy check also builds the client:

```ts
async function connectCompanionFromUrl(): Promise<void> {
  const parameters = new URLSearchParams(location.search);
  const token = parameters.get('token');
  if (!token) return;
  const companion = parameters.get('companion') ?? location.origin;
  try {
    const response = await fetch(`${companion}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Companion returned ${response.status}.`);
    companionClient = createCompanionResearchClient({ baseUrl: companion, token });
    companionStatus = 'Connected for this session';
  } catch {
    companionClient = null;
    companionStatus =
      'Connection was denied. Allow local-network access, or open the URL printed by npx dusori.';
  }
}
```

- [ ] **Step 2: Pass the prop to both components** (they gain the prop in Tasks 11/12 — order within this PR does not matter for the final build, but `pnpm typecheck` will fail until Tasks 11 and 12 land, so commit this task together with them if running checks between tasks):

```svelte
<ResearchPanel
  {storage}
  topicSlug={selectedSlug}
  topicTitle={workspace.topics.find((topic) => topic.slug === selectedSlug)?.title ?? selectedSlug}
  onSourceSaved={refreshSources}
  companion={companionClient}
/>
```

```svelte
<SourceLibrary {storage} topicSlug={selectedSlug} companion={companionClient} />
```

- [ ] **Step 3: Hold the commit until Task 12's checks pass** (Tasks 10–12 form one compile unit; each keeps its own test steps, and Task 12's commit step commits all three files).

---

### Task 11: ResearchPanel ranked-search wiring

**Files:**
- Modify: `apps/app/src/lib/components/ResearchPanel.svelte`

**Interfaces:**
- Consumes: `CompanionResearchClient` (Task 7), `createMsLearnProvider` (Task 9), existing `researchProviders`, `wikipediaProvider`.
- Produces: `export let companion: CompanionResearchClient | null = null;` — when set, MS Learn searches route through the companion proxy under the unchanged `mslearn` consent.

- [ ] **Step 1: Wire the providers.** Add `createMsLearnProvider`, `wikipediaProvider`, and `type CompanionResearchClient` to the existing `@dusori/core` import. Below the existing props add:

```ts
export let companion: CompanionResearchClient | null = null;

$: providers = companion
  ? [
      createMsLearnProvider({ ranked: (query) => companion.searchMsLearnRanked(query) }),
      wikipediaProvider,
    ]
  : [...researchProviders];
```

Then replace the two remaining uses of `researchProviders` below the import with `providers`:
- in `providerFor`: `providers.find((provider) => provider.id === candidate.provider)!`
- in the template's provider-button loop (`{#each researchProviders as provider}` → `{#each providers as provider}` — locate with a search for `researchProviders` in the file; the import line keeps its name).

- [ ] **Step 2: Verify no behavior change without a companion**

Run: `pnpm --filter @dusori/app typecheck` — expected: clean (this also type-checks Task 10's prop). Manual reasoning check: with `companion = null`, `providers` is exactly `researchProviders`, so consent gates, labels, and the catalog path are untouched.

- [ ] **Step 3: Hold the commit — Task 12 commits the app slice.**

---

### Task 12: SourceLibrary upgrade flow (confirm → fetch → preview → replace)

**Files:**
- Modify: `apps/app/src/lib/components/SourceLibrary.svelte`

**Interfaces:**
- Consumes: `CompanionResearchClient.fetchPage` (Task 7), `buildUpgradedContent`, `upgradeSource` (Task 8), `StorageConflictError`, `FetchedPage` from `@dusori/core`.
- Produces: the user-facing upgrade flow; no exports.

- [ ] **Step 1: Extend the script.** Add to the `@dusori/core` import: `StorageConflictError`, `buildUpgradedContent`, `upgradeSource`, `type CompanionResearchClient`, `type FetchedPage`. Change the svelte import to `import { onMount, tick } from 'svelte';`. Below the existing props/state add:

```ts
export let companion: CompanionResearchClient | null = null;

let confirming: SourceRecord | null = null;
let confirmFetchButton: HTMLButtonElement;
let confirmInvoker: HTMLButtonElement | null = null;
let fetchingSha = '';
let upgradePreview: { content: string; page: FetchedPage; record: SourceRecord } | null = null;
let upgradeCloseButton: HTMLButtonElement;
let replacing = false;
let upgradeError = '';

function hostOf(record: SourceRecord): string {
  try {
    return new URL(record.url ?? '').host;
  } catch {
    return '';
  }
}

async function openConfirm(record: SourceRecord, invoker: HTMLButtonElement): Promise<void> {
  confirming = record;
  confirmInvoker = invoker;
  upgradeError = '';
  await tick();
  confirmFetchButton?.focus();
}

async function cancelConfirm(): Promise<void> {
  confirming = null;
  await tick();
  confirmInvoker?.focus();
  confirmInvoker = null;
}

async function confirmFetch(): Promise<void> {
  if (!confirming || !companion) return;
  const record = confirming;
  confirming = null;
  fetchingSha = record.sha256;
  upgradeError = '';
  try {
    const page = await companion.fetchPage(record.url ?? '');
    upgradePreview = { content: buildUpgradedContent(record, page), page, record };
    await tick();
    upgradeCloseButton?.focus();
  } catch (caught) {
    upgradeError =
      caught instanceof Error ? caught.message : 'The companion could not fetch this page.';
    await tick();
    confirmInvoker?.focus();
    confirmInvoker = null;
  } finally {
    fetchingSha = '';
  }
}

async function closeUpgradePreview(): Promise<void> {
  upgradePreview = null;
  await tick();
  confirmInvoker?.focus();
  confirmInvoker = null;
}

async function replaceContent(): Promise<void> {
  if (!upgradePreview) return;
  replacing = true;
  upgradeError = '';
  try {
    await upgradeSource(storage, {
      page: upgradePreview.page,
      sha256: upgradePreview.record.sha256,
      topicSlug,
    });
    upgradePreview = null;
    await refresh();
    success = 'Source upgraded to full page content and recorded in the update log.';
  } catch (caught) {
    upgradeError =
      caught instanceof StorageConflictError
        ? 'This source changed outside Dusori. Review the file, then try again.'
        : caught instanceof Error
          ? caught.message
          : 'Dusori could not upgrade this source.';
  } finally {
    replacing = false;
  }
}

function dialogKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  if (replacing) return;
  if (upgradePreview) void closeUpgradePreview();
  else if (confirming) void cancelConfirm();
}
```

- [ ] **Step 2: Extend the template.** In the source list `{#each}` item (after the `<span>{sourceDetail(source)}</span>` line), add:

```svelte
{#if source.method === 'url' && companion}
  <button
    class="upgrade-source"
    disabled={fetchingSha === source.sha256 || saving}
    onclick={(event) => void openConfirm(source, event.currentTarget as HTMLButtonElement)}
  >
    {fetchingSha === source.sha256 ? 'Fetching…' : 'Fetch full content'}
  </button>
{/if}
```

After the closing `</ul>` of the source list, add the hint:

```svelte
{#if !companion && sources.some((source) => source.method === 'url')}
  <p class="field-help">Run the companion (npx dusori) to fetch full page content.</p>
{/if}
```

In the `source-feedback` live region, add an `upgradeError` branch before the `error` branch:

```svelte
{#if upgradeError}
  <p class="source-message error" role="alert">
    <AlertTriangle aria-hidden="true" size={17} />
    <span>{upgradeError}</span>
  </p>
{:else if error}
```

(keep the existing `error` / `success` branches following it).

At the end of the section (before `</section>`), add the two dialogs, following the native-`<dialog open>` pattern used by `ResearchPanel.svelte:338,354`:

```svelte
{#if confirming}
  <dialog open class="upgrade-dialog" aria-labelledby="upgrade-confirm-title" onkeydown={dialogKeydown}>
    <h3 id="upgrade-confirm-title">Fetch full page content?</h3>
    <p>
      Sends this address to {hostOf(confirming)} from your machine via the local companion. The
      page's readable text will replace this source's stub content.
    </p>
    <p class="upgrade-url"><code>{confirming.url}</code></p>
    <div class="upgrade-actions">
      <button bind:this={confirmFetchButton} class="primary-action" onclick={() => void confirmFetch()}>
        Fetch page
      </button>
      <button onclick={() => void cancelConfirm()}>Keep reference only</button>
    </div>
  </dialog>
{/if}

{#if upgradePreview}
  <dialog open class="upgrade-dialog" aria-labelledby="upgrade-preview-title" onkeydown={dialogKeydown}>
    <h3 id="upgrade-preview-title">Preview fetched content</h3>
    {#if upgradePreview.page.truncated}
      <p>This page was longer than the 2 MiB source limit and was truncated.</p>
    {/if}
    <p>Source markdown</p>
    <pre>{upgradePreview.content}</pre>
    <div class="upgrade-actions">
      <button class="primary-action" disabled={replacing} onclick={() => void replaceContent()}>
        {replacing ? 'Replacing…' : 'Replace content'}
      </button>
      <button bind:this={upgradeCloseButton} disabled={replacing} onclick={() => void closeUpgradePreview()}>
        Keep the stub
      </button>
    </div>
  </dialog>
{/if}
```

- [ ] **Step 3: Add styles** to the component `<style>` block (reusing the design tokens already used in this file):

```css
.upgrade-source {
  min-height: 2.75rem;
  padding: var(--space-xs) var(--space-sm);
  border: var(--rule-hair) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-paper);
  color: var(--color-ink);
  font: inherit;
}

.upgrade-dialog {
  position: fixed;
  inset: 0;
  z-index: 10;
  margin: auto;
  width: min(38rem, calc(100vw - 2 * var(--space-lg)));
  max-height: 80vh;
  overflow: auto;
  padding: var(--space-lg);
  border: var(--rule-hair) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-paper);
  color: var(--color-ink);
}

.upgrade-dialog pre {
  max-height: 45vh;
  overflow: auto;
  padding: var(--space-sm);
  border: var(--rule-hair) solid var(--color-rule);
  font-size: var(--text-xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.upgrade-url code {
  overflow-wrap: anywhere;
}

.upgrade-actions {
  display: flex;
  gap: var(--space-sm);
  margin-block-start: var(--space-md);
  flex-wrap: wrap;
}

.upgrade-actions button {
  min-height: 2.75rem;
  padding: var(--space-xs) var(--space-md);
  border: var(--rule-hair) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-paper);
  color: var(--color-ink);
  font: inherit;
}

.upgrade-actions .primary-action {
  background: var(--color-ink);
  color: var(--color-paper);
}
```

(`--color-ink`, `--color-paper`, `--color-border`, `--color-rule`, and the spacing/radius/text tokens are all already used elsewhere in this component's style block — no new tokens.)

- [ ] **Step 4: Verify the app slice compiles and existing unit tests pass**

Run: `pnpm --filter @dusori/app typecheck && pnpm test:unit`
Expected: clean typecheck, all unit tests PASS.

- [ ] **Step 5: Commit Tasks 10–12 together**

```bash
git add apps/app/src/routes/+page.svelte apps/app/src/lib/components/ResearchPanel.svelte apps/app/src/lib/components/SourceLibrary.svelte
git commit -m "feat(app): add companion-gated source upgrade and ranked search"
```

---

### Task 13: End-to-end coverage

**Files:**
- Modify: `tests/e2e/dusori.spec.ts` (append one test; reuse the existing helpers `createBrowserWorkspace`, `createTopic`, `expectNoSeriousA11yViolations`)

- [ ] **Step 1: Append the test.** The app is served at `/Dusori/app/` (see `tests/e2e/dusori.spec.ts:77`); reloading with `?token=` makes `connectCompanionFromUrl` treat the page origin as the companion, so `page.route` fixtures are same-origin and CORS-free.

```ts
test('companion fetch upgrades a URL source after a per-fetch confirm', async ({ page }) => {
  const fetchCalls: string[] = [];
  await page.route('**/api/health', async (route) => {
    await route.fulfill({ json: { uptime: 1, version: '0.2.0' } });
  });
  await page.route('**/api/research/fetch', async (route) => {
    fetchCalls.push(route.request().headers()['authorization'] ?? '');
    await route.fulfill({
      json: {
        fetchedAt: '2026-07-21T00:00:00.000Z',
        finalUrl: 'https://example.org/attention',
        text: 'Attention lets each token weigh the other tokens in its context.',
        title: 'Attention in transformers',
        truncated: false,
      },
    });
  });

  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Attention paper');
  await page.getByLabel('Web address').fill('https://example.org/attention');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Attention paper');

  // Without a companion token the upgrade action is absent and the hint shows.
  await expect(page.getByRole('button', { name: 'Fetch full content' })).toHaveCount(0);
  await expect(page.getByText('Run the companion (npx dusori) to fetch full page content.')).toBeVisible();

  // Reload as if served by the companion.
  await page.goto('/Dusori/app/?token=e2e-companion-token');
  // The browser workspace must survive the reload. The existing test
  // "dismissed research suggestions stay gone after reload" (same file) already
  // handles post-reload workspace reopening — copy its exact post-reload step here
  // (e.g. re-selecting the browser workspace) before asserting.
  await expect(page.getByText('Connected for this session')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Attention paper');

  const fetchButton = page.getByRole('button', { name: 'Fetch full content' });
  await fetchButton.click();
  const confirm = page.getByRole('dialog', { name: 'Fetch full page content?' });
  await expect(confirm).toContainText('example.org');
  await expect(confirm).toContainText('https://example.org/attention');
  await confirm.getByRole('button', { name: 'Keep reference only' }).click();
  expect(fetchCalls).toHaveLength(0);

  await fetchButton.click();
  await page
    .getByRole('dialog', { name: 'Fetch full page content?' })
    .getByRole('button', { name: 'Fetch page' })
    .click();
  const preview = page.getByRole('dialog', { name: 'Preview fetched content' });
  await expect(preview.locator('pre')).toContainText('weigh the other tokens');
  await expect(preview.locator('pre')).toContainText('# Attention paper');
  await preview.getByRole('button', { name: 'Replace content' }).click();

  await expect(
    page.getByText('Source upgraded to full page content and recorded in the update log.'),
  ).toBeVisible();
  expect(fetchCalls).toEqual(['Bearer e2e-companion-token']);
  await expectNoSeriousA11yViolations(page);
});
```

- [ ] **Step 2: Build and run the e2e suite**

Run: `pnpm build && pnpm test:e2e`
Expected: all tests PASS, including the pre-existing research tests. If the dialog-name assertions fail, the accessible name comes from `aria-labelledby` — confirm the `<h3 id=…>` ids in Task 12 match.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/dusori.spec.ts
git commit -m "test(e2e): cover companion source upgrade flow"
```

---

### Task 14: Documentation

**Files:**
- Modify: `README.md`, `docs/product/spec.md`, `docs/adr/003-portable-file-contract.md`, `docs/adr/004-loopback-companion.md`, `apps/site/src/content/docs/docs/sources.md`, `CHANGELOG.md`

- [ ] **Step 1: README.** In the product table, extend the **Sources** row's second cell to end with "…and companion-powered full-content upgrades". Replace the roadmap sentence (README.md:60) with:

> Key-based search, Ollama transforms, generated schedules, and unattended work remain roadmap items. With the optional local companion running, Dusori also fetches the readable text of a URL source you explicitly confirm and proxies Microsoft Learn's ranked search; the hosted app alone stays keyless and limited to the Microsoft Learn catalog and English Wikipedia APIs.

- [ ] **Step 2: Product spec.** Run `grep -n "not built\|Arbitrary page fetching\|not yet" docs/product/spec.md`, move page fetching and ranked MS Learn search out of the not-built list, and add one sentence to the research section:

> With the local companion running, a URL source can be upgraded to the page's readable text after a per-fetch confirmation that names the exact host; the companion validates addresses against private networks, follows at most three re-validated redirects, and caps pages at 4 MiB.

- [ ] **Step 3: ADR-003 appendix.** Add at the end:

> **2026-07 (v0.3.0):** `SourceRecord.origin.provider` and `origin.capturedVia` widened from closed enums to validated non-empty strings (known values: `mslearn`, `wikipedia`, `companion` / `catalog-reference`, `api-extract`, `page-extract`). A v0.2.0 reader that encounters `provider: 'companion'` shows its friendly machine-file schema error until it updates; content files are untouched. The widening makes this the last provenance value that can break a reader.

- [ ] **Step 4: ADR-004 note.** Add at the end:

> **2026-07 update:** the "minimal root-confined file operations only" milestone is superseded. The companion now also exposes `/api/research/fetch` (SSRF-guarded readability extraction: private-address rejection per redirect hop, 3-hop cap, HTML/plain-text only, 4 MiB cap, 15 s timeout) and `/api/research/mslearn-search` (hardcoded proxy for `learn.microsoft.com/api/search`). Both sit behind the same per-launch token and exact origin allowlist. Residual DNS-rebinding risk between validation and connect is accepted for a loopback-bound, token-gated personal tool fetching user-chosen URLs.

- [ ] **Step 5: Site docs.** In `apps/site/src/content/docs/docs/sources.md`, add a section:

> ## Full-content upgrades with the companion
>
> URL references stay unfetched by default. When the app is opened through the local companion (`npx dusori`), each URL source gains a **Fetch full content** action. A confirmation names the exact host before anything is sent; the fetched page is reduced to readable text, previewed exactly as it will be written, and only replaces the stub when you choose **Replace content**. The upgrade is recorded in the topic's update log, and the source keeps its URL, title, and place in the graph.

- [ ] **Step 6: CHANGELOG.** Under `## [Unreleased]`, add:

```markdown
### Added

- Companion research service: `/api/research/fetch` turns a user-confirmed URL into readable text with SSRF guards (private-address rejection on every redirect hop, 3-hop cap, HTML/plain-text only, 4 MiB fetch cap, 15 s timeout), and `/api/research/mslearn-search` proxies Microsoft Learn's ranked search.
- **Fetch full content** action on URL sources when the app runs through the companion: per-fetch confirmation naming the exact host, exact-content preview, conflict-safe replacement, and an update-log entry.
- Research panel uses ranked Microsoft Learn results through the companion when available, falling back silently to local catalog scoring.

### Safety and portability

- Source provenance (`origin.provider`, `origin.capturedVia`) widened to tolerant strings so future values never break a reader; upgraded sources record `companion` / `page-extract` provenance and keep their URL-hash identity.
```

- [ ] **Step 7: Verify formatting and commit**

Run: `pnpm format && pnpm format:check`
Expected: clean.

```bash
git add README.md docs/product/spec.md docs/adr/003-portable-file-contract.md docs/adr/004-loopback-companion.md apps/site/src/content/docs/docs/sources.md CHANGELOG.md
git commit -m "docs: document the companion research service"
```

---

### Task 15: Full verification gate

- [ ] **Step 1: Run the complete repo gate**

Run: `pnpm check`
Expected: format:check, lint, typecheck, all unit suites, and the Pages build all pass.

- [ ] **Step 2: Run the e2e suite against the built artifact**

Run: `pnpm test:e2e`
Expected: PASS, including the new companion upgrade test and every pre-existing flow.

- [ ] **Step 3: Fix anything that failed, re-run both, then commit any stragglers**

```bash
git status --short
# commit only if fixes were needed:
git add -A && git commit -m "fix: settle verification fallout from companion research service"
```
