const upstream = 'https://export.arxiv.org/api/query';
const maxResults = 8;
const unreachableMessage = 'arXiv could not be reached.';
const unfamiliarMessage = 'arXiv returned an unfamiliar feed format.';

const entityMap: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  quot: '"',
};

export interface ArxivResult {
  id: string;
  publishedAt: string;
  summary: string;
  title: string;
  url: string;
}

export class ArxivProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArxivProxyError';
  }
}

// Deliberately a narrow reader for one known feed (the arXiv Atom API), not a
// general XML parser: it only looks for the handful of elements we render, and
// skips anything it does not recognise rather than failing the whole response.
// Swap in a real parser only if we ever need to read arbitrary XML.
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    const lowered = entity.toLowerCase();
    if (lowered.startsWith('#x')) {
      const code = Number.parseInt(lowered.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (lowered.startsWith('#')) {
      const code = Number.parseInt(lowered.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return entityMap[lowered] ?? match;
  });
}

function text(entry: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'iu').exec(entry);
  if (!match?.[1]) return '';
  return decodeEntities(match[1]).replace(/\s+/gu, ' ').trim();
}

function alternateLink(entry: string): string {
  for (const [tag] of entry.matchAll(/<link\b[^>]*\/?>/giu)) {
    if (!/\brel\s*=\s*["']alternate["']/iu.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/iu.exec(tag);
    if (href?.[1]) return decodeEntities(href[1]).trim();
  }
  return '';
}

export async function searchArxiv(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArxivResult[]> {
  const url = new URL(upstream);
  url.search = new URLSearchParams({
    max_results: String(maxResults),
    search_query: `all:${query}`,
    sortBy: 'relevance',
    start: '0',
  }).toString();

  let response: Response;
  try {
    response = await fetchImpl(url.toString());
  } catch {
    throw new ArxivProxyError(unreachableMessage);
  }
  if (!response.ok) throw new ArxivProxyError(unreachableMessage);

  const body = await response.text().catch(() => '');
  if (!/<feed\b/iu.test(body)) throw new ArxivProxyError(unfamiliarMessage);

  const results: ArxivResult[] = [];
  for (const [entry] of body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/giu)) {
    const id = text(entry, 'id');
    const title = text(entry, 'title');
    if (!id || !title) continue;
    results.push({
      id,
      publishedAt: text(entry, 'published'),
      summary: text(entry, 'summary'),
      title,
      url: alternateLink(entry) || id,
    });
    if (results.length === maxResults) break;
  }
  return results;
}
