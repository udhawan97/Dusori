import type {
  ResearchOutputStyle,
  ResearchRunRecord,
  ResearchThread,
  SourceRecord,
  StorageAdapter,
} from '@dusori/core';
import { evidenceClaims, sha256 } from '@dusori/core';

import { renderMarkdown } from './markdown.js';

export interface ResearchThreadExportInput {
  generatedAt: string;
  outputStyle: ResearchOutputStyle;
  runs: ResearchRunRecord[];
  sources: SourceRecord[];
  synthesisMarkdown: string;
  synthesisRunAt?: string;
  topicSlug: string;
  topicTitle: string;
  threadId?: string;
  threads?: ResearchThread[];
}

export type ResearchThreadExportFormat = 'html' | 'markdown' | 'pdf';

export interface ResearchThreadExportManifest {
  schemaVersion: 1;
  kind: 'dusori-research-packet-manifest';
  complete: boolean;
  createdAt: string;
  topic: { slug: string; title: string };
  thread: {
    threadId?: string;
    parentThreadId?: string;
    question: string;
  };
  format: ResearchThreadExportFormat;
  outputStyle: ResearchOutputStyle;
  eligibleClaimCount: number;
  files: Array<{ path: string; role: 'research-ledger' | 'source' | 'synthesis'; sha256: string }>;
  sources: Array<{
    title: string;
    evidenceState: 'Read evidence' | 'Readable text' | 'Reference';
    localPath?: string;
    localContentSha256?: string;
    recordSha256: string;
    url?: string;
  }>;
  omittedPaths: string[];
  renderer: 'dusori-built-in-research-packet-v1';
  roundTrip: false;
}

export interface ResearchThreadExportBundle {
  content: string;
  manifest: ResearchThreadExportManifest;
  manifestJson: string;
  manifestSha256: string;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function markdownText(value: string): string {
  return value
    .replace(/[\r\n]+/gu, ' ')
    .trim()
    .replace(/([\\`*_[\]{}()<>#+.!|-])/gu, '\\$1');
}

function markdownLink(label: string, value: string | undefined): string {
  const safe = safeHttpUrl(value);
  return safe ? `[${markdownText(label)}](<${safe}>)` : markdownText(label);
}

function safeTopicPath(value: string | undefined, topicSlug: string): string | undefined {
  if (!value || value.startsWith('/') || value.includes('\\')) return undefined;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  return value.startsWith(`Topics/${topicSlug}/`) ? value : undefined;
}

function synthesisBody(markdown: string): string {
  return markdown
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, '')
    .replace(/^#\s+[^\n]+\n+/u, '')
    .trim();
}

interface MarkdownSection {
  heading: string;
  lines: string[];
}

function synthesisSections(markdown: string): { intro: string[]; sections: MarkdownSection[] } {
  const intro: string[] = [];
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | undefined;
  for (const line of synthesisBody(markdown).split('\n')) {
    const heading = /^##\s+(.+)$/u.exec(line)?.[1]?.trim();
    if (heading) {
      current = { heading, lines: [line] };
      sections.push(current);
    } else if (current) current.lines.push(line);
    else intro.push(line);
  }
  return { intro, sections };
}

function boundedMarkdown(lines: string[], maxNonEmpty: number): string {
  let nonEmpty = 0;
  const selected: string[] = [];
  for (const line of lines) {
    if (line.trim()) nonEmpty += 1;
    if (nonEmpty > maxNonEmpty) break;
    selected.push(line);
  }
  return selected.join('\n').trim();
}

/**
 * Keeps the thread conversational: a short answer and its live gaps stay in the channel while the
 * complete, unmodified synthesis remains available in Document view and in every export.
 */
export function researchThreadPreview(markdown: string): string {
  const { intro, sections } = synthesisSections(markdown);
  const primaryNames = [
    'What matters',
    'Key ideas',
    'Evidence by theme',
    'Cross-source coverage',
    'Timeline',
  ];
  const primary = primaryNames
    .map((name) => sections.find((section) => section.heading === name))
    .find(Boolean);
  const gaps = sections.find((section) =>
    ['Open questions', 'Research gaps'].includes(section.heading),
  );
  const parts = [
    boundedMarkdown(intro, 2),
    primary ? boundedMarkdown(primary.lines, 10) : '',
    gaps ? boundedMarkdown(gaps.lines, 5) : '',
  ].filter(Boolean);
  return parts.join('\n\n').trim() || synthesisBody(markdown);
}

function networkInertMarkdown(markdown: string): string {
  return markdown.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/!\[/gu, '\\![');
}

export function orderedResearchRuns(
  runs: ResearchRunRecord[],
  showAll = false,
): ResearchRunRecord[] {
  const selected = showAll ? runs : runs.slice(-4);
  return [...selected].reverse();
}

export function researchRunQuestion(run: ResearchRunRecord): string {
  return run.questionText ?? run.searchText;
}

function researchRunHasResults(run: ResearchRunRecord): boolean {
  return (
    (run.eligibleCount ?? run.providers.reduce((total, provider) => total + provider.count, 0)) > 0
  );
}

/** Resolves the run whose answer is actually stored, never a later non-replacing proposal. */
export function researchAnswerRun(
  runs: ResearchRunRecord[],
  synthesisRunAt?: string,
): ResearchRunRecord | undefined {
  if (synthesisRunAt) {
    const associated = [...runs].reverse().find((run) => run.at === synthesisRunAt);
    if (associated) return associated;
  }
  const explicit = [...runs].reverse().find((run) => run.synthesisOutcome === 'written');
  if (explicit) return explicit;
  // Ledgers written before answer provenance existed have no outcome field. Keep them readable,
  // but once any explicit outcome exists, fail closed instead of guessing which run owns the file.
  if (runs.some((run) => run.synthesisOutcome !== undefined)) return undefined;
  return [...runs].reverse().find(researchRunHasResults) ?? runs.at(-1);
}

function proposedRunAfterAnswer(
  runs: ResearchRunRecord[],
  answerRun: ResearchRunRecord | undefined,
): ResearchRunRecord | undefined {
  if (!answerRun) return undefined;
  const answerIndex = runs.findLastIndex((run) => run.at === answerRun.at);
  return [...runs.slice(answerIndex + 1)]
    .reverse()
    .find((run) => run.synthesisOutcome === 'proposed');
}

export function researchSourceState(source: SourceRecord): {
  claimCount: number;
  label: 'Read evidence' | 'Readable text' | 'Reference';
} {
  const claimCount = evidenceClaims(source).length;
  if (claimCount > 0) return { claimCount, label: 'Read evidence' };
  if (source.readState === 'readable') return { claimCount: 0, label: 'Readable text' };
  return { claimCount: 0, label: 'Reference' };
}

export function hasLegacyReferenceClaims(sources: SourceRecord[]): boolean {
  return sources.some(
    (source) => source.readState === 'reference' && (source.claims?.length ?? 0) > 0,
  );
}

export function researchThreadFilename(topicSlug: string, extension: 'html' | 'md'): string {
  const slug = topicSlug.replace(/[^a-z0-9-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'topic';
  return `dusori-research-${slug}.${extension}`;
}

export function researchThreadManifestFilename(topicSlug: string): string {
  const slug = topicSlug.replace(/[^a-z0-9-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'topic';
  return `dusori-research-${slug}.manifest.json`;
}

/**
 * Builds a portable thread receipt without upgrading saved references into evidence. Quoted
 * passages live only inside the existing synthesis, whose evidence boundary is enforced in core.
 */
export function renderResearchThreadMarkdown(input: ResearchThreadExportInput): string {
  const latestRun = input.runs.at(-1);
  const answerRun = researchAnswerRun(input.runs, input.synthesisRunAt);
  const nonReplacingProposal = proposedRunAfterAnswer(input.runs, answerRun);
  const readCount = input.sources.filter((source) => evidenceClaims(source).length > 0).length;
  const claimCount = input.sources.reduce(
    (total, source) => total + evidenceClaims(source).length,
    0,
  );
  const lines = [
    '---',
    `title: ${JSON.stringify(`Research thread — ${input.topicTitle}`)}`,
    `topic: ${JSON.stringify(input.topicTitle)}`,
    `generated: ${input.generatedAt}`,
    `structure: ${input.outputStyle}`,
    ...(input.threadId ? [`thread_id: ${input.threadId}`] : []),
    '---',
    '',
    `# Research thread — ${markdownText(input.topicTitle)}`,
    '',
    `Exported from Dusori on ${input.generatedAt.slice(0, 10)}. ${readCount} of ${input.sources.length} saved sources currently support ${claimCount} quoted ${claimCount === 1 ? 'passage' : 'passages'}.`,
    '',
  ];

  if (answerRun) {
    lines.push(
      '## Question',
      '',
      markdownText(researchRunQuestion(answerRun)),
      '',
      '## Completed lookup receipt',
      '',
      answerRun.eligibleCount === undefined
        ? `Run on ${answerRun.at.slice(0, 16).replace('T', ' ')} UTC. The retained-result count was not recorded by this older version of Dusori.`
        : `Run on ${answerRun.at.slice(0, 16).replace('T', ' ')} UTC. ${answerRun.eligibleCount} relevant ${answerRun.eligibleCount === 1 ? 'result' : 'results'} retained after eligibility filtering.`,
      '',
    );
    for (const provider of answerRun.providers) {
      const outcome =
        provider.outcome === 'found'
          ? `found ${provider.count}`
          : provider.outcome === 'empty'
            ? 'returned no results'
            : 'failed';
      lines.push(`- **${markdownText(provider.label)}** — ${outcome}`);
    }
    lines.push('');
  }

  if (
    latestRun &&
    (latestRun.synthesisOutcome === 'proposed' || (answerRun && latestRun.at !== answerRun.at))
  ) {
    lines.push(
      '## Latest update',
      '',
      `The ${latestRun.at.slice(0, 16).replace('T', ' ')} UTC update for “${markdownText(researchRunQuestion(latestRun))}” did not replace the completed answer.${nonReplacingProposal ? ' A refreshed proposal was saved separately because Synthesis.md had learner edits.' : ''} Its provider outcomes remain in the research trail.`,
      '',
    );
  }

  lines.push('## Sources collected', '');
  if (input.sources.length === 0) lines.push('No sources are saved yet.', '');
  for (const source of input.sources) {
    const state = researchSourceState(source);
    const detail = [
      state.label,
      state.claimCount > 0
        ? `${state.claimCount} quoted ${state.claimCount === 1 ? 'passage' : 'passages'}`
        : undefined,
      source.publisher ? markdownText(source.publisher) : undefined,
      source.publishedAt ? markdownText(source.publishedAt) : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`### ${markdownLink(source.title, source.url)}`, '', detail, '');
    if (source.author) lines.push(`- Author: ${markdownText(source.author)}`);
    if (source.origin?.provider) lines.push(`- Provider: ${markdownText(source.origin.provider)}`);
    if (source.whySelected?.length)
      lines.push(`- Selected because: ${source.whySelected.map(markdownText).join('; ')}`);
    const sourcePath = safeTopicPath(source.path, input.topicSlug);
    if (sourcePath) lines.push(`- Saved copy: \`${sourcePath.replaceAll('`', '')}\``);
    lines.push('');
  }

  const synthesis = hasLegacyReferenceClaims(input.sources)
    ? ''
    : networkInertMarkdown(synthesisBody(input.synthesisMarkdown));
  lines.push(
    '## Built answer',
    '',
    synthesis ||
      (hasLegacyReferenceClaims(input.sources)
        ? 'The built answer is withheld because an older reference carried claims without readable evidence. Rebuild it from read source text.'
        : 'No synthesis has been built yet.'),
    '',
  );

  if (input.runs.length > 1) {
    lines.push('## Research trail', '');
    for (const run of orderedResearchRuns(input.runs, true)) {
      lines.push(
        `- ${run.at.slice(0, 16).replace('T', ' ')} UTC — ${markdownText(researchRunQuestion(run))} · ${run.newKeys} new`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Evidence boundary',
    '',
    'A saved reference is not evidence until its text has been read into quoted passages. Dusori preserves provider outcomes and source links, but does not judge whether a quoted claim is true. Read the originals before relying on this export.',
    '',
  );
  return lines.join('\n');
}

/**
 * Builds the presentation file and its separate provenance manifest from the same local snapshots.
 * A missing recorded path makes the manifest incomplete instead of silently omitting the gap.
 */
export async function buildResearchThreadExportBundle(
  storage: StorageAdapter,
  input: ResearchThreadExportInput,
  format: ResearchThreadExportFormat,
  createdAt = new Date(),
): Promise<ResearchThreadExportBundle> {
  const content =
    format === 'markdown'
      ? renderResearchThreadMarkdown(input)
      : await renderResearchThreadHtml(input);
  const requested = new Map<string, 'research-ledger' | 'source' | 'synthesis'>([
    [`Topics/${input.topicSlug}/research.json`, 'research-ledger'],
    [`Topics/${input.topicSlug}/Synthesis.md`, 'synthesis'],
  ]);
  for (const source of input.sources) {
    const path = safeTopicPath(source.path, input.topicSlug);
    if (path) requested.set(path, 'source');
  }

  const files: ResearchThreadExportManifest['files'] = [];
  const omittedPaths: string[] = [];
  for (const [path, role] of requested) {
    const snapshot = await storage.read(path);
    if (snapshot) files.push({ path, role, sha256: snapshot.hash });
    else omittedPaths.push(path);
  }
  const fileHashes = new Map(files.map((file) => [file.path, file.sha256]));
  const answerRun = researchAnswerRun(input.runs, input.synthesisRunAt);
  const thread = input.threads?.find((candidate) => candidate.threadId === input.threadId);
  const manifest: ResearchThreadExportManifest = {
    complete: omittedPaths.length === 0,
    createdAt: createdAt.toISOString(),
    eligibleClaimCount: input.sources.reduce(
      (total, source) => total + evidenceClaims(source).length,
      0,
    ),
    files,
    format,
    kind: 'dusori-research-packet-manifest',
    omittedPaths,
    outputStyle: input.outputStyle,
    renderer: 'dusori-built-in-research-packet-v1',
    roundTrip: false,
    schemaVersion: 1,
    sources: input.sources.map((source) => {
      const localPath = safeTopicPath(source.path, input.topicSlug);
      return {
        evidenceState: researchSourceState(source).label,
        ...(localPath ? { localPath } : {}),
        ...(localPath && fileHashes.has(localPath)
          ? { localContentSha256: fileHashes.get(localPath)! }
          : {}),
        recordSha256: source.sha256,
        title: source.title,
        ...(safeHttpUrl(source.url) ? { url: safeHttpUrl(source.url)! } : {}),
      };
    }),
    thread: {
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(thread?.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
      question:
        thread?.questionText ?? (answerRun ? researchRunQuestion(answerRun) : input.topicTitle),
    },
    topic: { slug: input.topicSlug, title: input.topicTitle },
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    content,
    manifest,
    manifestJson,
    manifestSha256: await sha256(manifestJson),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function networkInertHtml(value: string): string {
  return value.replace(
    /<(?:audio|embed|iframe|img|link|object|picture|source|track|video)\b[^>]*>(?:\s*<\/(?:audio|iframe|object|picture|video)>)?/giu,
    '',
  );
}

/** A self-contained, network-inert HTML export suitable for saving or system Print → PDF. */
export async function renderResearchThreadHtml(input: ResearchThreadExportInput): Promise<string> {
  const markdown = renderResearchThreadMarkdown(input);
  const rendered = await renderMarkdown(markdown);
  const title = escapeHtml(`Research thread — ${input.topicTitle}`);
  const body = networkInertHtml(rendered.html);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; media-src 'none'; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'">
  <meta name="referrer" content="no-referrer">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --paper: oklch(96% 0.014 80);
      --paper-2: oklch(93% 0.016 80);
      --ink: oklch(20% 0.012 55);
      --muted: oklch(44% 0.01 60);
      --rule: oklch(80% 0.012 75);
      --accent: oklch(46% 0.16 32);
      --font-display: "Shippori Mincho", "Yu Mincho", serif;
      --font-body: "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", sans-serif;
      --font-mono: "IBM Plex Mono", ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    html, body { overflow-x: clip; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font-body);
      font-size: 16px;
      line-height: 1.62;
    }
    main { width: min(100% - 2rem, 48rem); margin: 0 auto; padding: 3rem 0 5rem; }
    h1, h2, h3 { overflow-wrap: anywhere; font-family: var(--font-display); font-style: normal; line-height: 1.18; }
    h1 { font-size: clamp(2.2rem, 7vw, 4rem); letter-spacing: -0.025em; }
    h2 { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--rule); font-size: 1.75rem; }
    h3 { margin-top: 1.5rem; font-size: 1.2rem; }
    p, li { max-width: 72ch; }
    a { color: var(--accent); text-underline-offset: 0.18em; }
    blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 2px solid var(--accent); color: var(--muted); }
    code { font-family: var(--font-mono); font-size: 0.9em; }
    pre { overflow: auto; padding: 1rem; background: var(--paper-2); }
    @page { margin: 18mm; }
    @media print {
      main { width: auto; padding: 0; }
      h1, h2, h3 { break-after: avoid; }
      a { color: var(--ink); text-decoration: none; }
      a[href^="http"]::after { content: " (" attr(href) ")"; color: var(--muted); font-family: var(--font-mono); font-size: 0.72em; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}
