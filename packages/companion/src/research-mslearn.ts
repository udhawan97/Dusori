import { z } from 'zod';

const upstream = 'https://learn.microsoft.com/api/search';
const maxResults = 8;
const unreachableMessage = 'Microsoft Learn ranked search could not be reached.';
const unfamiliarMessage = 'Microsoft Learn returned an unfamiliar search format.';

const UpstreamSchema = z.object({
  results: z.array(
    z.object({
      description: z.string().nullable().optional(),
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
  url.search = new URLSearchParams({
    $top: String(maxResults),
    locale: 'en-us',
    search: query,
  }).toString();

  let response: Response;
  try {
    response = await fetchImpl(url.toString());
  } catch {
    throw new MsLearnProxyError(unreachableMessage);
  }
  if (!response.ok) throw new MsLearnProxyError(unreachableMessage);

  const parsed = UpstreamSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MsLearnProxyError(unfamiliarMessage);

  return parsed.data.results.slice(0, maxResults).flatMap((result) => {
    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(result.url, upstream);
    } catch {
      return [];
    }
    if (resolvedUrl.origin !== url.origin) return [];
    return [
      {
        summary: result.description ?? '',
        title: result.title.replace(/\s+/gu, ' ').trim(),
        url: resolvedUrl.toString(),
      },
    ];
  });
}
