import type { StorageAdapter } from '../adapters.js';
import { readSourceManifest } from '../sources/import.js';

/** Longest excerpt shown beside a prompt, ellipsis included. */
export const maxRecallExcerptCharacters = 320;
/** Shortest run of prose that counts as readable local content. */
export const minRecallExcerptCharacters = 40;
/** Longest prompt text accepted from the optional AI rewrite. */
export const maxRecallPromptCharacters = 400;

const maxObjectiveCharacters = 120;
const maxHeadingCharacters = 80;
const maxSourceReads = 12;
const maxSourcesInOneSession = 4;
const maxSectionsPerSource = 2;
const maxExcerpts = 4;
const maxContributionPrompts = 3;

export interface RecallEvidence {
  /** Bounded, Markdown-flattened quotation from the source file. */
  excerpt: string;
  heading: string;
  /** Workspace-relative path, shown so a prompt is always traceable to a local file. */
  path: string;
  title: string;
  truncated: boolean;
}

export type RecallPromptKind = 'compare' | 'contribution' | 'explain';

export interface RecallPrompt {
  evidence: RecallEvidence;
  generatedBy: 'ai' | 'template';
  id: string;
  kind: RecallPromptKind;
  prompt: string;
}

export interface RecallSession {
  /** Set only when a model rewrote the prompt text, so the app can name it. */
  model?: string;
  objective: string;
  prompts: RecallPrompt[];
  topicSlug: string;
  topicTitle: string;
}

export interface RecallSessionInput {
  objective: string;
  topicSlug: string;
  topicTitle: string;
}

export type RecallSessionResult =
  | { session: RecallSession; status: 'ready' }
  | { status: 'no-sources' }
  | { referenceCount: number; status: 'no-readable-sources' };

export interface RecallAiExcerpt {
  excerpt: string;
  heading: string;
  title: string;
}

export interface RecallAiRequest {
  excerpts: RecallAiExcerpt[];
  objective: string;
}

interface Section {
  body: string;
  heading: string;
}

const headingLine = /^(#{1,6})\s+(.+?)\s*#*$/u;
const bulletLine = /^\s*(?:[-*+]|\d+[.)])\s+/u;
/**
 * The provenance preamble Dusori writes itself when it captures a URL, plus the sentence that
 * marks a reference stored without its page. Neither is the source's own prose, so neither
 * counts as readable content.
 */
const provenanceLine =
  /^(?:Original URL:|Resolved URL:|Fetched URL:|Byline:|Site:|Fetched from .+ on \d{4}-\d{2}-\d{2} via the local companion\.$)/u;
const referenceSentence = 'Dusori stored this reference without fetching its contents.';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  return end === -1 ? content : content.slice(end + 4);
}

/** Flattens Markdown to a readable quotation. Source text stays data: never rendered as Markdown. */
function flattenMarkdown(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/gu, '$1')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/\*([^*]+)\*/gu, '$1')
    .replace(/`+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function bound(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(/[\s,;:.–—-]+$/u, '')}…`;
}

/** Heading-led sections of a source file, keeping only those with real prose under them. */
function readableSections(content: string, fallbackHeading: string): Section[] {
  const collected: { heading: string; parts: string[] }[] = [];
  let current = { heading: fallbackHeading, parts: [] as string[] };

  for (const raw of stripFrontmatter(content).split('\n')) {
    const line = raw.trim();
    const heading = headingLine.exec(line);
    if (heading) {
      collected.push(current);
      current = { heading: flattenMarkdown(heading[2] ?? ''), parts: [] };
      continue;
    }
    if (!line || line === referenceSentence || provenanceLine.test(line)) continue;
    current.parts.push(line.replace(bulletLine, '').replace(/^>\s*/u, ''));
  }
  collected.push(current);

  return collected
    .map((section) => ({
      body: flattenMarkdown(section.parts.join(' ')),
      heading: section.heading || fallbackHeading,
    }))
    .filter((section) => section.body.length >= minRecallExcerptCharacters);
}

function toEvidence(section: Section, title: string, path: string): RecallEvidence {
  const excerpt = bound(section.body, maxRecallExcerptCharacters);
  return {
    excerpt,
    heading: section.heading,
    path,
    title,
    truncated: excerpt !== section.body,
  };
}

/** Round-robin across sources so three prompts reach three sources before repeating one. */
function interleave(perSource: RecallEvidence[][]): RecallEvidence[] {
  const ordered: RecallEvidence[] = [];
  for (let depth = 0; depth < maxSectionsPerSource; depth += 1) {
    for (const source of perSource) {
      const item = source[depth];
      if (item) ordered.push(item);
    }
  }
  return ordered.slice(0, maxExcerpts);
}

function buildPrompts(objective: string, evidence: RecallEvidence[]): RecallPrompt[] {
  const shortObjective = bound(objective, maxObjectiveCharacters);
  const first = evidence[0];
  if (!first) return [];
  return [
    {
      evidence: first,
      generatedBy: 'template',
      id: 'explain',
      kind: 'explain',
      prompt: `Explain “${shortObjective}” in your own words before revealing the source.`,
    },
    ...evidence.slice(0, maxContributionPrompts).map((item, index) => ({
      evidence: item,
      generatedBy: 'template' as const,
      id: `contribution-${index + 1}`,
      kind: 'contribution' as const,
      prompt: `What does “${bound(item.heading, maxHeadingCharacters)}” in ${bound(
        item.title,
        maxHeadingCharacters,
      )} contribute to “${shortObjective}”?`,
    })),
    {
      evidence: evidence[maxContributionPrompts] ?? first,
      generatedBy: 'template',
      id: 'compare',
      kind: 'compare',
      prompt: 'Compare your explanation with this excerpt. What did you omit or misunderstand?',
    },
  ];
}

/**
 * Reads the topic's approved sources and returns 3–5 deterministic active-recall prompts, each
 * tied to a local file and a bounded excerpt. Reads only: starting a session writes nothing, so
 * it can never touch the review schedule.
 */
export async function buildRecallSession(
  storage: StorageAdapter,
  input: RecallSessionInput,
  now = new Date(),
): Promise<RecallSessionResult> {
  const manifest = await readSourceManifest(storage, input.topicSlug, now);
  if (manifest.sources.length === 0) return { status: 'no-sources' };

  const perSource: RecallEvidence[][] = [];
  let examined = 0;
  for (const record of manifest.sources) {
    if (perSource.length >= maxSourcesInOneSession || examined >= maxSourceReads) break;
    examined += 1;
    const file = record.path ? await storage.read(record.path) : null;
    if (!file || !record.path) continue;
    const sections = readableSections(file.content, record.title).slice(0, maxSectionsPerSource);
    if (sections.length === 0) continue;
    perSource.push(
      sections.map((section) => toEvidence(section, record.title, record.path as string)),
    );
  }

  if (perSource.length === 0) {
    return { referenceCount: examined, status: 'no-readable-sources' };
  }

  return {
    session: {
      objective: input.objective,
      prompts: buildPrompts(input.objective, interleave(perSource)),
      topicSlug: input.topicSlug,
      topicTitle: input.topicTitle,
    },
    status: 'ready',
  };
}

/**
 * The complete payload the optional AI rewrite may send: the objective and the same bounded
 * excerpts already on screen. A pure function so a test can prove nothing else leaves the device.
 */
export function recallAiRequest(session: RecallSession): RecallAiRequest {
  return {
    excerpts: session.prompts.map((prompt) => ({
      excerpt: prompt.evidence.excerpt,
      heading: prompt.evidence.heading,
      title: prompt.evidence.title,
    })),
    objective: bound(session.objective, maxRecallPromptCharacters),
  };
}

/**
 * Applies rewritten prompt text position by position. Advisory only: a reply with the wrong
 * count, an empty entry, or an over-long entry keeps the deterministic session, and evidence,
 * ordering, prompt count, and prompt kinds are never taken from the model.
 */
export function applyAiRecallPrompts(
  session: RecallSession,
  texts: string[],
  model: string,
): RecallSession {
  if (texts.length !== session.prompts.length) return session;
  const cleaned = texts.map((text) => text.replace(/\s+/gu, ' ').trim());
  if (cleaned.some((text) => text.length === 0 || text.length > maxRecallPromptCharacters)) {
    return session;
  }
  return {
    ...session,
    model,
    prompts: session.prompts.map((prompt, index) => ({
      ...prompt,
      generatedBy: 'ai',
      prompt: cleaned[index] as string,
    })),
  };
}
