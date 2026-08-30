import { citationIdentifierText, sha256, type SourceRecord } from '@dusori/core';

export type SourceShelfFilter = 'all' | 'evidence' | 'references';

export interface SourcePassage {
  heading?: string;
  locator?: SourceQuoteLocator;
  text: string;
}

export interface SourceQuoteLocator {
  normalizationVersion: 'dusori-source-text-v1';
  normalizedContentSha256: string;
  exact: string;
  prefix?: string;
  suffix?: string;
  start?: number;
  end?: number;
  pageIndex?: number;
  pageLabel?: string;
}

export interface SourceQuoteLocatorInput {
  exact: string;
  sourceContent: string;
  sourceContentHash: string;
}

export interface SourceQuoteResolution {
  status: 'anchored' | 'stale' | 'unanchored';
  method?: 'position' | 'context';
  start?: number;
  end?: number;
}

export interface SourceAnnotationMetadata {
  locator?: SourceQuoteLocator;
  sourceContentHash: string;
  sourcePath: string;
}

export interface SourceAnnotationInput {
  createdAt: Date;
  passage?: SourcePassage;
  source: SourceRecord;
  sourceContentHash: string;
  title: string;
  topicSlug: string;
}

export const maxAnnotationQuoteCharacters = 1200;
export const sourceTextNormalizationVersion = 'dusori-source-text-v1' as const;
const locatorContextCharacters = 120;
const pageMarker = /<!--\s*dusori-page:(\d+)\s+label:([^\s>]+)\s*-->/gu;

export function sourceEvidenceState(source: SourceRecord): 'read' | 'readable' | 'reference' {
  if (source.method !== 'url') return 'read';
  return source.readState ?? 'reference';
}

function searchableSourceText(source: SourceRecord): string {
  let host = '';
  try {
    host = new URL(source.url ?? '').host;
  } catch {
    // A malformed URL belongs to machine-file recovery, but it must not break local shelf search.
  }
  return [
    source.title,
    source.publisher,
    source.author,
    source.origin?.provider,
    host,
    source.originalName,
    ...(source.tags ?? []),
    ...(source.citation?.identifiers.map(citationIdentifierText) ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase();
}

export function filterSavedSources(
  sources: readonly SourceRecord[],
  query: string,
  filter: SourceShelfFilter,
): SourceRecord[] {
  const needle = query
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase();
  return sources.filter((source) => {
    const state = sourceEvidenceState(source);
    if (filter === 'evidence' && state === 'reference') return false;
    if (filter === 'references' && state !== 'reference') return false;
    return !needle || searchableSourceText(source).includes(needle);
  });
}

export function sourceFilterCounts(
  sources: readonly SourceRecord[],
): Record<SourceShelfFilter, number> {
  const references = sources.filter((source) => sourceEvidenceState(source) === 'reference').length;
  return {
    all: sources.length,
    evidence: sources.length - references,
    references,
  };
}

export function normalizeSelectedPassage(input: string): string {
  return input
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** Versioned Unicode-code-point text used only to anchor against the fingerprinted local file. */
export function normalizeSourceText(input: string): string {
  return normalizeSelectedPassage(input.normalize('NFKC'));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function codePointSlice(value: string, start: number, end?: number): string {
  return Array.from(value).slice(start, end).join('');
}

function validSourceQuoteLocator(value: unknown): value is SourceQuoteLocator {
  if (!value || typeof value !== 'object') return false;
  const locator = value as Partial<SourceQuoteLocator>;
  const totalContext =
    (typeof locator.exact === 'string' ? locator.exact.length : 0) +
    (typeof locator.prefix === 'string' ? locator.prefix.length : 0) +
    (typeof locator.suffix === 'string' ? locator.suffix.length : 0);
  return (
    locator.normalizationVersion === sourceTextNormalizationVersion &&
    typeof locator.normalizedContentSha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(locator.normalizedContentSha256) &&
    typeof locator.exact === 'string' &&
    locator.exact.length > 0 &&
    locator.exact.length <= maxAnnotationQuoteCharacters &&
    (locator.prefix === undefined || locator.prefix.length <= locatorContextCharacters) &&
    (locator.suffix === undefined || locator.suffix.length <= locatorContextCharacters) &&
    totalContext <= maxAnnotationQuoteCharacters + locatorContextCharacters * 2 &&
    (locator.start === undefined || (Number.isInteger(locator.start) && locator.start >= 0)) &&
    (locator.end === undefined || (Number.isInteger(locator.end) && locator.end >= 0)) &&
    (locator.start === undefined || locator.end === undefined || locator.end >= locator.start) &&
    (locator.pageIndex === undefined ||
      (Number.isInteger(locator.pageIndex) && locator.pageIndex >= 0)) &&
    (locator.pageLabel === undefined || locator.pageLabel.length <= 40)
  );
}

function frontmatterJsonString(frontmatter: string, field: string): string | undefined {
  const value = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'mu').exec(frontmatter)?.[1];
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Reads only the allowlisted fields written by `sourceAnnotationTemplate`. */
export function parseSourceAnnotationMetadata(content: string): SourceAnnotationMetadata | null {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1];
  if (!frontmatter || !/^annotation:\s*source-(?:note|quote)\s*$/imu.test(frontmatter)) {
    return null;
  }
  const sourcePath = frontmatterJsonString(frontmatter, 'source_path');
  const sourceContentHash = /^source_content_sha256:\s*([a-f0-9]{64})\s*$/imu.exec(
    frontmatter,
  )?.[1];
  if (!sourcePath || !sourceContentHash) return null;
  const locatorText = /^source_locator:\s*(.+?)\s*$/imu.exec(frontmatter)?.[1];
  if (!locatorText) return { sourceContentHash, sourcePath };
  try {
    const locator = JSON.parse(locatorText) as unknown;
    return validSourceQuoteLocator(locator)
      ? { locator, sourceContentHash, sourcePath }
      : { sourceContentHash, sourcePath };
  } catch {
    return { sourceContentHash, sourcePath };
  }
}

function pageAt(
  content: string,
  utf16Position: number,
): Pick<SourceQuoteLocator, 'pageIndex' | 'pageLabel'> {
  let located: Pick<SourceQuoteLocator, 'pageIndex' | 'pageLabel'> = {};
  for (const match of content.matchAll(pageMarker)) {
    if ((match.index ?? 0) > utf16Position) break;
    located = { pageIndex: Number(match[1]), pageLabel: match[2] };
  }
  return located;
}

/** Builds a bounded selector without fetching or consulting the original URL. */
export async function buildSourceQuoteLocator(
  input: SourceQuoteLocatorInput,
): Promise<SourceQuoteLocator> {
  if (!/^[a-f0-9]{64}$/u.test(input.sourceContentHash)) {
    throw new Error('This source reading copy has no valid content fingerprint.');
  }
  const exact = normalizeSourceText(input.exact);
  if (!exact) throw new Error('Select a passage before creating a quote locator.');
  if (exact.length > maxAnnotationQuoteCharacters) {
    throw new Error(`Select at most ${maxAnnotationQuoteCharacters.toLocaleString()} characters.`);
  }
  const normalized = normalizeSourceText(input.sourceContent);
  const first = normalized.indexOf(exact);
  const second = first < 0 ? -1 : normalized.indexOf(exact, first + exact.length);
  const locator: SourceQuoteLocator = {
    exact,
    normalizationVersion: sourceTextNormalizationVersion,
    normalizedContentSha256: await sha256(normalized),
  };
  if (first < 0 || second >= 0) return locator;

  const start = codePointLength(normalized.slice(0, first));
  const end = start + codePointLength(exact);
  const prefix = codePointSlice(normalized, Math.max(0, start - locatorContextCharacters), start);
  const suffix = codePointSlice(normalized, end, end + locatorContextCharacters);
  return {
    ...locator,
    end,
    ...pageAt(normalized, first),
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
    start,
  };
}

/** Position is authoritative only while both the raw and normalized local fingerprints agree. */
export async function resolveSourceQuoteLocator(input: {
  locator: SourceQuoteLocator;
  recordedSourceContentHash: string;
  sourceContent: string;
  sourceContentHash: string;
}): Promise<SourceQuoteResolution> {
  const { locator } = input;
  const normalized = normalizeSourceText(input.sourceContent);
  if (
    input.sourceContentHash !== input.recordedSourceContentHash ||
    locator.normalizationVersion !== sourceTextNormalizationVersion ||
    (await sha256(normalized)) !== locator.normalizedContentSha256
  ) {
    return { status: 'stale' };
  }

  if (locator.start !== undefined && locator.end !== undefined) {
    if (codePointSlice(normalized, locator.start, locator.end) === locator.exact) {
      return {
        end: locator.end,
        method: 'position',
        start: locator.start,
        status: 'anchored',
      };
    }
  }

  const matches: Array<{ start: number; end: number }> = [];
  let cursor = normalized.indexOf(locator.exact);
  while (cursor >= 0) {
    const start = codePointLength(normalized.slice(0, cursor));
    const end = start + codePointLength(locator.exact);
    const prefix = locator.prefix
      ? codePointSlice(normalized, Math.max(0, start - codePointLength(locator.prefix)), start)
      : '';
    const suffix = locator.suffix
      ? codePointSlice(normalized, end, end + codePointLength(locator.suffix))
      : '';
    if (
      (!locator.prefix || prefix === locator.prefix) &&
      (!locator.suffix || suffix === locator.suffix)
    ) {
      matches.push({ end, start });
    }
    cursor = normalized.indexOf(locator.exact, cursor + locator.exact.length);
  }
  return matches.length === 1
    ? { ...matches[0], method: 'context', status: 'anchored' }
    : { status: 'unanchored' };
}

function sourceLink(sourcePath: string, title: string): string {
  const relative = sourcePath.replace(/^Topics\/[^/]+\//u, '').replace(/\.(?:md|txt)$/u, '');
  return `[[../${relative}|${title}]]`;
}

function sourceRelationTarget(sourcePath: string): string {
  return `../${sourcePath.replace(/^Topics\/[^/]+\//u, '')}`;
}

function frontmatterString(input: string): string {
  return JSON.stringify(input);
}

export function sourceAnnotationTemplate(input: SourceAnnotationInput): string {
  if (!input.source.path) throw new Error('This source has no local reading copy to annotate.');
  if (!/^[a-f0-9]{64}$/u.test(input.sourceContentHash)) {
    throw new Error('This source reading copy has no valid content fingerprint.');
  }
  const passage = input.passage
    ? {
        ...(input.passage.heading
          ? { heading: normalizeSelectedPassage(input.passage.heading).slice(0, 160) }
          : {}),
        ...(input.passage.locator ? { locator: input.passage.locator } : {}),
        text: normalizeSelectedPassage(input.passage.text),
      }
    : undefined;
  if (passage && !passage.text) throw new Error('Select a passage before quoting it.');
  if (passage && passage.text.length > maxAnnotationQuoteCharacters) {
    throw new Error(`Select at most ${maxAnnotationQuoteCharacters.toLocaleString()} characters.`);
  }
  if (passage?.locator && passage.locator.exact !== normalizeSourceText(passage.text)) {
    throw new Error('The quote locator does not match the retained quoted passage.');
  }
  if (passage?.locator && !validSourceQuoteLocator(passage.locator)) {
    throw new Error('The quote locator is invalid or exceeds Dusori’s local bounds.');
  }

  const metadata = [
    '---',
    `title: ${frontmatterString(input.title)}`,
    `topic: ${input.topicSlug}`,
    `created: ${input.createdAt.toISOString().slice(0, 10)}`,
    `annotation: ${passage ? 'source-quote' : 'source-note'}`,
    `source_path: ${frontmatterString(input.source.path)}`,
    `source_content_sha256: ${input.sourceContentHash}`,
    ...(passage?.heading ? [`source_heading: ${frontmatterString(passage.heading)}`] : []),
    ...(passage?.locator ? [`source_locator: ${JSON.stringify(passage.locator)}`] : []),
    'tags: [research/annotation]',
    'relations:',
    '  - type: follow-up-to',
    `    target: ${frontmatterString(sourceRelationTarget(input.source.path))}`,
    '---',
  ].join('\n');
  const quote = passage
    ? [
        '',
        '## Quoted passage',
        '',
        ...passage.text.split('\n').map((line) => `> ${line}`),
        ...(passage.heading ? ['', `Section: **${passage.heading}**`] : []),
      ].join('\n')
    : '';

  return `${metadata}\n\n# ${input.title}\n\n## Source\n\n${sourceLink(input.source.path, input.source.title)}${quote}\n\n## Annotation\n\nWrite what this evidence changes, supports, or leaves unresolved.\n`;
}
