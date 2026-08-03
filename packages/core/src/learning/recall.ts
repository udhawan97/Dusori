import type { StorageAdapter } from '../adapters.js';
import { SourceManifestSchema } from '../schemas/workspace.js';
import { readSourceManifest } from '../sources/import.js';
import { topicRoot } from '../workspace/paths.js';

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
/** Prompts between the opening explain and the closing compare, keeping every session at 3–5. */
const maxMiddlePrompts = 3;
const minClozeSentenceCharacters = 40;
const maxClozeSentenceCharacters = 240;
const minClozeWordCharacters = 6;

export interface RecallEvidence {
  /** Bounded, Markdown-flattened quotation from the source file. */
  excerpt: string;
  heading: string;
  /** Workspace-relative path, shown so a prompt is always traceable to a local file. */
  path: string;
  title: string;
  truncated: boolean;
}

export type RecallPromptKind = 'cloze' | 'compare' | 'contribution' | 'explain' | 'locate';

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

export interface SourceReadiness {
  approvedSources: number;
  readableSources: number;
  sourceReady: boolean;
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

export interface Section {
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
export function readableSections(content: string, fallbackHeading: string): Section[] {
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

/**
 * Checks whether a topic has learner-approved text that can be read on this device.
 * Invalid or missing manifests stay untouched here; Workspace health owns their diagnosis.
 */
export async function inspectSourceReadiness(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<SourceReadiness> {
  const manifestFile = await storage.read(`${topicRoot(topicSlug)}/Sources/manifest.json`);
  if (!manifestFile) return { approvedSources: 0, readableSources: 0, sourceReady: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestFile.content);
  } catch {
    return { approvedSources: 0, readableSources: 0, sourceReady: false };
  }
  const manifest = SourceManifestSchema.safeParse(parsed);
  if (!manifest.success) return { approvedSources: 0, readableSources: 0, sourceReady: false };

  let readableSources = 0;
  for (const record of manifest.data.sources.slice(0, maxSourceReads)) {
    if (!record.path) continue;
    const file = await storage.read(record.path);
    if (!file) continue;
    if (readableSections(file.content, record.title).length > 0) readableSources += 1;
  }
  return {
    approvedSources: manifest.data.sources.length,
    readableSources,
    sourceReady: readableSources > 0,
  };
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

/** The excerpt's opening sentence, when it is long enough to hide a word inside and still read. */
function firstSentence(excerpt: string): string | null {
  const sentence = excerpt.split(/(?<=[.!?])\s+/u)[0]?.trim() ?? '';
  const usable =
    sentence.length >= minClozeSentenceCharacters &&
    sentence.length <= maxClozeSentenceCharacters &&
    !sentence.endsWith('…');
  return usable ? sentence : null;
}

/**
 * The longest word in the sentence, ties going to the first. Deterministic by construction: the
 * same excerpt always hides the same word, so a session is reproducible.
 */
function longestWord(sentence: string): string | null {
  let longest = '';
  for (const [word] of sentence.matchAll(new RegExp(`\\p{L}{${minClozeWordCharacters},}`, 'gu'))) {
    if (word.length > longest.length) longest = word;
  }
  return longest || null;
}

/** Hides one word of the source's own sentence. Nothing is generated: the excerpt still shows it. */
function clozePrompt(evidence: RecallEvidence): RecallPrompt | null {
  const sentence = firstSentence(evidence.excerpt);
  if (!sentence) return null;
  const word = longestWord(sentence);
  if (!word) return null;
  // The word came from the sentence and is letters only, so it carries no regex meaning.
  const blanked = sentence.replace(new RegExp(`(?<!\\p{L})${word}(?!\\p{L})`, 'u'), '_____');
  return {
    evidence,
    generatedBy: 'template',
    id: 'cloze',
    kind: 'cloze',
    prompt: `Fill the blank from ${bound(evidence.title, maxHeadingCharacters)} — ${bound(
      evidence.heading,
      maxHeadingCharacters,
    )}: “${blanked}”`,
  };
}

/** Only worth asking once the topic has more than one source to tell apart. */
function locatePrompt(evidence: RecallEvidence[], shortObjective: string): RecallPrompt | null {
  if (new Set(evidence.map((item) => item.title)).size < 2) return null;
  const item = evidence[1] ?? evidence[0];
  if (!item) return null;
  return {
    evidence: item,
    generatedBy: 'template',
    id: 'locate',
    kind: 'locate',
    prompt: `Without looking, which of your sources covers “${bound(
      item.heading,
      maxHeadingCharacters,
    )}”, and what does it add to “${shortObjective}”?`,
  };
}

function buildPrompts(objective: string, evidence: RecallEvidence[]): RecallPrompt[] {
  const shortObjective = bound(objective, maxObjectiveCharacters);
  const first = evidence[0];
  if (!first) return [];

  // Fixed order, and the varied kinds claim their slot before contributions fill what is left,
  // so a session stays between three and five prompts however many sources a topic has.
  const middle: RecallPrompt[] = [];
  const cloze = clozePrompt(first);
  if (cloze) middle.push(cloze);
  const locate = locatePrompt(evidence, shortObjective);
  if (locate) middle.push(locate);
  for (const [index, item] of evidence.entries()) {
    if (middle.length >= maxMiddlePrompts) break;
    middle.push({
      evidence: item,
      generatedBy: 'template',
      id: `contribution-${index + 1}`,
      kind: 'contribution',
      prompt: `What does “${bound(item.heading, maxHeadingCharacters)}” in ${bound(
        item.title,
        maxHeadingCharacters,
      )} contribute to “${shortObjective}”?`,
    });
  }

  return [
    {
      evidence: first,
      generatedBy: 'template',
      id: 'explain',
      kind: 'explain',
      prompt: `Explain “${shortObjective}” in your own words before revealing the source.`,
    },
    ...middle.slice(0, maxMiddlePrompts),
    {
      evidence: evidence.at(-1) ?? first,
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

/** Answers the learner typed during a session, keyed by prompt id. Blank entries are ignored. */
export type RecallAnswers = Record<string, string>;

export function recallAnswerNoteTitle(session: RecallSession, now: Date): string {
  return `Review answers — ${bound(session.objective, maxObjectiveCharacters)} — ${now
    .toISOString()
    .slice(0, 10)}`;
}

/**
 * The one thing a session can persist, and only when the learner asks for it: their own answers,
 * as an ordinary portable note. The answers are reproduced verbatim and the prompts are quoted
 * and labelled, so nothing generated can be mistaken later for the learner's own writing.
 */
export function buildRecallAnswerNote(
  session: RecallSession,
  answers: RecallAnswers,
  now: Date,
): string {
  const answered = session.prompts.flatMap((prompt) => {
    const answer = (answers[prompt.id] ?? '').trim();
    return answer ? [{ answer, prompt }] : [];
  });
  if (answered.length === 0) {
    throw new Error('Write an answer to at least one prompt before saving a note.');
  }

  const title = recallAnswerNoteTitle(session, now);
  const date = now.toISOString().slice(0, 10);
  const origin =
    session.model === undefined
      ? 'Deterministic prompt'
      : `Prompt written by ${session.model}, unverified`;

  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `topic: ${session.topicSlug}`,
    `created: ${date}`,
    '---',
    '',
    `# ${title}`,
    '',
    `Your answers from a review session on ${date}, for **${session.objective}**. The prompts below were generated by Dusori from the sources named under each one; the answers are yours.`,
    '',
    ...answered.flatMap(({ answer, prompt }, position) => [
      `## ${position + 1}. ${prompt.evidence.title} — ${prompt.evidence.heading}`,
      '',
      `> ${prompt.prompt}`,
      '',
      `_${prompt.generatedBy === 'ai' ? origin : 'Deterministic prompt'} · source: \`${prompt.evidence.path}\`_`,
      '',
      answer,
      '',
    ]),
  ].join('\n');
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
