import {
  CitationMetadataSchema,
  type CitationIdentifier,
  type CitationMetadata,
} from '../schemas/workspace.js';

export interface KnownCitationIdentifierInput {
  scheme: string;
  value: string;
}

export interface KnownCitationMetadataInput {
  candidateKey?: string;
  capturedAt: Date;
  consentScope?: string;
  identifiers?: readonly KnownCitationIdentifierInput[];
  itemType?: string;
  meta?: Readonly<Record<string, string>>;
  provider?: string;
  url?: string;
}

export type KnownCitationValuesInput = Omit<
  KnownCitationMetadataInput,
  'capturedAt' | 'consentScope' | 'itemType'
>;

const schemeOrder = ['doi', 'pmid', 'pmcid', 'arxiv', 'isbn', 'openalex', 'openlibrary'];

function decoded(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function urlPath(input: string, hosts: readonly string[]): string | null {
  try {
    const url = new URL(input);
    return hosts.includes(url.hostname.toLowerCase()) ? decoded(url.pathname) : null;
  } catch {
    return null;
  }
}

function validIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/u.test(value)) return false;
  const sum = [...value].reduce(
    (total, character, index) =>
      total + (character === 'X' ? 10 : Number(character)) * (10 - index),
    0,
  );
  return sum % 11 === 0;
}

function validIsbn13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  const sum = [...value].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return sum % 10 === 0;
}

/** Normalizes only identifier schemes Dusori understands; malformed values fail closed. */
export function normalizeCitationIdentifier(
  schemeInput: string,
  valueInput: string,
): CitationIdentifier | null {
  const scheme = schemeInput.trim().toLowerCase().replaceAll('_', '-');
  let value = valueInput.normalize('NFKC').trim();

  if (scheme === 'doi') {
    const path = urlPath(value, ['doi.org', 'dx.doi.org']);
    value = (path ?? value.replace(/^doi\s*:\s*/iu, '')).replace(/^\//u, '');
    return /^10\.\d{4,9}\/[^\s?#]{1,200}$/iu.test(value)
      ? { scheme: 'doi', value: value.toLowerCase() }
      : null;
  }

  if (scheme === 'isbn') {
    value = value
      .replace(/^(?:urn:)?isbn(?:-1[03])?\s*:\s*/iu, '')
      .replace(/[\s-]/gu, '')
      .toUpperCase();
    return validIsbn10(value) || validIsbn13(value) ? { scheme: 'isbn', value } : null;
  }

  if (scheme === 'arxiv') {
    const path = urlPath(value, ['arxiv.org', 'www.arxiv.org']);
    value = (path ?? value.replace(/^arxiv\s*:\s*/iu, ''))
      .replace(/^\/(?:abs|pdf)\//u, '')
      .replace(/\.pdf$/iu, '')
      .replace(/^\//u, '')
      .toLowerCase();
    return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/u.test(value)
      ? { scheme: 'arxiv', value }
      : null;
  }

  if (scheme === 'pmid') {
    const path = urlPath(value, ['pubmed.ncbi.nlm.nih.gov']);
    value = (path ?? value.replace(/^pmid\s*:\s*/iu, '')).replaceAll('/', '');
    return /^[1-9]\d{0,11}$/u.test(value) ? { scheme: 'pmid', value } : null;
  }

  if (scheme === 'pmcid') {
    const path = urlPath(value, ['ncbi.nlm.nih.gov', 'www.ncbi.nlm.nih.gov']);
    const pathMatch = /\/pmc\/articles\/(PMC\d+)/iu.exec(path ?? '');
    value = (pathMatch?.[1] ?? value.replace(/^pmcid\s*:\s*/iu, '')).toUpperCase();
    return /^PMC[1-9]\d{0,11}$/u.test(value) ? { scheme: 'pmcid', value } : null;
  }

  if (scheme === 'openalex') {
    const path = urlPath(value, ['openalex.org']);
    value = (path ?? value.replace(/^openalex\s*:\s*/iu, '')).replaceAll('/', '').toUpperCase();
    return /^W[1-9]\d*$/u.test(value) ? { scheme: 'openalex', value } : null;
  }

  if (scheme === 'openlibrary') {
    const path = urlPath(value, ['openlibrary.org']);
    value = (path ?? value.replace(/^openlibrary\s*:\s*/iu, ''))
      .replace(/^\/works\//u, '')
      .replaceAll('/', '')
      .toUpperCase();
    return /^OL[1-9]\d*W$/u.test(value) ? { scheme: 'openlibrary', value } : null;
  }

  return null;
}

function urlIdentifiers(url: string | undefined): KnownCitationIdentifierInput[] {
  if (!url) return [];
  const candidates = [
    ['doi', url],
    ['arxiv', url],
    ['pmid', url],
    ['pmcid', url],
    ['openalex', url],
    ['openlibrary', url],
  ] as const;
  return candidates
    .map(([scheme, value]) => normalizeCitationIdentifier(scheme, value))
    .filter((identifier): identifier is CitationIdentifier => Boolean(identifier));
}

function keyIdentifiers(
  provider: string | undefined,
  candidateKey: string | undefined,
): KnownCitationIdentifierInput[] {
  if (!provider || !candidateKey) return [];
  const prefix = `${provider}:`;
  if (!candidateKey.startsWith(prefix)) return [];
  const value = candidateKey.slice(prefix.length);
  if (provider === 'crossref') return [{ scheme: 'doi', value }];
  if (provider === 'arxiv') return [{ scheme: 'arxiv', value }];
  if (provider === 'openalex') return [{ scheme: 'openalex', value }];
  if (provider === 'openlibrary') return [{ scheme: 'openlibrary', value }];
  if (provider === 'europepmc') {
    const [source, id] = value.split(':');
    if (source === 'MED' && id) return [{ scheme: 'pmid', value: id }];
  }
  return [];
}

function dedupeIdentifiers(inputs: readonly KnownCitationIdentifierInput[]): CitationIdentifier[] {
  const identifiers = new Map<string, CitationIdentifier>();
  for (const input of inputs) {
    const normalized = normalizeCitationIdentifier(input.scheme, input.value);
    if (normalized) identifiers.set(`${normalized.scheme}:${normalized.value}`, normalized);
  }
  return [...identifiers.values()].sort((left, right) => {
    const leftOrder = schemeOrder.indexOf(left.scheme);
    const rightOrder = schemeOrder.indexOf(right.scheme);
    return (
      (leftOrder < 0 ? schemeOrder.length : leftOrder) -
        (rightOrder < 0 ? schemeOrder.length : rightOrder) || left.value.localeCompare(right.value)
    );
  });
}

export function citationIdentifiersFromKnownValues(
  input: KnownCitationValuesInput,
): CitationIdentifier[] {
  const meta = input.meta ?? {};
  return dedupeIdentifiers([
    ...(input.identifiers ?? []),
    ...keyIdentifiers(input.provider, input.candidateKey),
    ...urlIdentifiers(input.url),
    ...(['doi', 'isbn', 'arxiv', 'pmid', 'pmcid'] as const)
      .filter((scheme) => Boolean(meta[scheme]))
      .map((scheme) => ({ scheme, value: meta[scheme]! })),
  ]).slice(0, 16);
}

function boundedText(value: string | undefined, maximum: number): string | undefined {
  const text = value?.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim();
  return text || undefined;
}

/** Builds citation metadata from values already in memory. This function performs no I/O. */
export function citationMetadataFromKnownValues(
  input: KnownCitationMetadataInput,
): CitationMetadata | undefined {
  const meta = input.meta ?? {};
  const identifiers = citationIdentifiersFromKnownValues(input);
  if (identifiers.length === 0) return undefined;

  return CitationMetadataSchema.parse({
    schemaVersion: 'dusori-citation-v1',
    identifiers,
    containerTitle: boundedText(meta.journal ?? meta.venue, 200),
    itemType: input.itemType,
    provenance: [
      input.provider
        ? {
            capturedAt: input.capturedAt.toISOString(),
            consentScope: input.consentScope ?? input.provider,
            method: 'provider-result',
            provider: input.provider,
          }
        : { capturedAt: input.capturedAt.toISOString(), method: 'source-url' },
    ],
  });
}

export function mergeCitationMetadata(
  current: CitationMetadata | undefined,
  incoming: CitationMetadata | undefined,
): CitationMetadata | undefined {
  if (!current) return incoming;
  if (!incoming) return current;
  const provenance = new Map(
    current.provenance.map((receipt) => [
      [receipt.method, receipt.provider ?? '', receipt.consentScope ?? ''].join(':'),
      receipt,
    ]),
  );
  for (const receipt of incoming.provenance) {
    const key = [receipt.method, receipt.provider ?? '', receipt.consentScope ?? ''].join(':');
    if (!provenance.has(key)) provenance.set(key, receipt);
  }
  return CitationMetadataSchema.parse({
    schemaVersion: 'dusori-citation-v1',
    identifiers: dedupeIdentifiers([...current.identifiers, ...incoming.identifiers]).slice(0, 16),
    containerTitle: incoming.containerTitle ?? current.containerTitle,
    itemType: incoming.itemType ?? current.itemType,
    provenance: [...provenance.values()].slice(0, 8),
  });
}

const identifierLabels: Readonly<Record<string, string>> = {
  arxiv: 'arXiv',
  doi: 'DOI',
  isbn: 'ISBN',
  openalex: 'OpenAlex',
  openlibrary: 'Open Library',
  pmcid: 'PMCID',
  pmid: 'PMID',
};

export function citationIdentifierText(identifier: CitationIdentifier): string {
  return `${identifierLabels[identifier.scheme] ?? identifier.scheme}: ${identifier.value}`;
}
