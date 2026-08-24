import type { SourceRecord } from '@dusori/core';

export type SourceShelfFilter = 'all' | 'evidence' | 'references';

export interface SourcePassage {
  heading?: string;
  text: string;
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

function sourceLink(sourcePath: string, title: string): string {
  const relative = sourcePath.replace(/^Topics\/[^/]+\//u, '').replace(/\.(?:md|txt)$/u, '');
  return `[[../${relative}|${title}]]`;
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
        text: normalizeSelectedPassage(input.passage.text),
      }
    : undefined;
  if (passage && !passage.text) throw new Error('Select a passage before quoting it.');
  if (passage && passage.text.length > maxAnnotationQuoteCharacters) {
    throw new Error(`Select at most ${maxAnnotationQuoteCharacters.toLocaleString()} characters.`);
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
