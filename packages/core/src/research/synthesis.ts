import type { SourceClaim, SourceRecord } from '../schemas/workspace.js';
import { lensFor, missionLensLabels, missionLenses } from './mission.js';
import type { ResearchOutputStyle } from './research-file.js';

export interface SynthesisClaim extends SourceClaim {
  sourceTitle: string;
  sourceUrl?: string;
  sourcePath?: string;
  /** Wikilink target for the source's own file, so a claim always points home. */
  sourceLink?: string;
}

export interface SynthesisCluster {
  heading: string;
  claims: SynthesisClaim[];
  /** Distinct sources backing this cluster. One means the evidence is thin. */
  sourceCount: number;
}

export interface TopicSynthesis {
  topicTitle: string;
  generatedAt: string;
  sourceCount: number;
  readCount: number;
  claimCount: number;
  clusters: SynthesisCluster[];
  /** Clusters carried by a single source, named so the document can say so plainly. */
  thinEvidence: SynthesisCluster[];
  timeline: { year: string; title: string; url?: string }[];
  openQuestions: string[];
  /** Lenses with no saved source, so a gap reads as a gap and not as an absence of material. */
  missingLenses: string[];
}

const stopwords = new Set([
  'a',
  'about',
  'after',
  'also',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'both',
  'but',
  'by',
  'can',
  'for',
  'from',
  'had',
  'has',
  'have',
  'how',
  'in',
  'into',
  'is',
  'it',
  'its',
  'may',
  'more',
  'most',
  'not',
  'of',
  'on',
  'or',
  'over',
  'own',
  'result',
  'results',
  'said',
  'same',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'under',
  'up',
  'was',
  'were',
  'what',
  'when',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
]);

function sourceLinkFor(record: SourceRecord): string | undefined {
  if (!record.path) return undefined;
  const name = record.path.split('/').at(-1) ?? '';
  return name.replace(/\.(?:md|txt)$/u, '');
}

/**
 * The single evidence boundary for synthesis and progress surfaces. A saved reference may retain
 * legacy claim-shaped data, but it cannot support a claim until its text was actually read.
 */
export function evidenceClaims(record: SourceRecord): NonNullable<SourceRecord['claims']> {
  return record.readState === 'read' ? (record.claims ?? []) : [];
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/gu, ' ');
}

/** Content words of a heading, used to merge headings that mean the same thing. */
function headingKey(heading: string): string {
  const words = normalizeHeading(heading)
    .replace(/[^a-z0-9]+/gu, ' ')
    .split(' ')
    .filter((word) => word && !stopwords.has(word));
  return words.length > 0 ? words.sort().join(' ') : normalizeHeading(heading);
}

function collectClaims(sources: SourceRecord[]): SynthesisClaim[] {
  return sources.flatMap((record) =>
    evidenceClaims(record).map((claim) => ({
      ...claim,
      sourceLink: sourceLinkFor(record),
      sourcePath: record.path,
      sourceTitle: record.title,
      sourceUrl: record.url,
    })),
  );
}

/**
 * Groups claims by what their headings are about, so the same idea from three sources sits
 * together and disagreement becomes visible instead of being averaged away.
 */
function clusterClaims(claims: SynthesisClaim[]): SynthesisCluster[] {
  const groups = new Map<string, { heading: string; claims: SynthesisClaim[] }>();
  for (const claim of claims) {
    const heading = claim.heading ?? claim.sourceTitle;
    const key = headingKey(heading);
    const group = groups.get(key);
    if (group) group.claims.push(claim);
    else groups.set(key, { claims: [claim], heading });
  }
  return [...groups.values()]
    .map((group) => ({
      claims: group.claims,
      heading: group.heading,
      sourceCount: new Set(group.claims.map((claim) => claim.sourceTitle)).size,
    }))
    .sort(
      (left, right) =>
        right.sourceCount - left.sourceCount ||
        right.claims.length - left.claims.length ||
        left.heading.localeCompare(right.heading),
    );
}

function buildTimeline(sources: SourceRecord[]): { year: string; title: string; url?: string }[] {
  return sources
    .filter((record) => record.publishedAt)
    .map((record) => ({
      title: record.title,
      url: record.url,
      year: String(record.publishedAt).slice(0, 4),
    }))
    .filter((entry) => /^\d{4}$/u.test(entry.year))
    .sort(
      (left, right) => left.year.localeCompare(right.year) || left.title.localeCompare(right.title),
    );
}

/**
 * Questions the evidence itself raises: lenses with nothing saved, and ideas only one source
 * supports. Deterministic, so a workspace with no AI still gets an honest research agenda.
 */
function deriveOpenQuestions(
  topicTitle: string,
  thin: SynthesisCluster[],
  missingLenses: string[],
): string[] {
  const questions = thin
    .slice(0, 3)
    .map((cluster) => `Does another source confirm what "${cluster.heading}" claims?`);
  for (const lens of missingLenses.slice(0, 2)) {
    questions.push(`What would ${lens.toLowerCase()} sources add to ${topicTitle}?`);
  }
  return questions;
}

export interface BuildSynthesisInput {
  topicTitle: string;
  sources: SourceRecord[];
  now: Date;
}

export function buildTopicSynthesis(input: BuildSynthesisInput): TopicSynthesis {
  const read = input.sources.filter((record) => evidenceClaims(record).length > 0);
  const claims = collectClaims(read);
  const clusters = clusterClaims(claims);
  const thinEvidence = clusters.filter((cluster) => cluster.sourceCount === 1);

  const covered = new Set(
    input.sources
      .filter((record) => record.origin)
      .map((record) => lensFor(record.origin!.provider)),
  );
  const missingLenses = missionLenses
    .filter((lens) => !covered.has(lens))
    .map((lens) => missionLensLabels[lens]);

  return {
    claimCount: claims.length,
    clusters,
    generatedAt: input.now.toISOString(),
    missingLenses,
    openQuestions: deriveOpenQuestions(input.topicTitle, thinEvidence, missingLenses),
    readCount: read.length,
    sourceCount: input.sources.length,
    thinEvidence,
    timeline: buildTimeline(read),
    topicTitle: input.topicTitle,
  };
}

function citation(claim: SynthesisClaim): string {
  if (claim.sourceLink) return `[[${claim.sourceLink}|${claim.sourceTitle}]]`;
  if (claim.sourceUrl) return `[${claim.sourceTitle}](${claim.sourceUrl})`;
  return claim.sourceTitle;
}

export interface RenderSynthesisOptions {
  /** Verbatim source passages selected and ordered by an optional model. */
  aiOverview?: string;
  aiModel?: string;
  /** The learner-selected structure for the durable research artifact. */
  outputStyle?: ResearchOutputStyle;
}

function appendEvidenceDigest(lines: string[], synthesis: TopicSynthesis): void {
  lines.push('## Evidence digest', '');
  for (const cluster of synthesis.clusters.slice(0, 5)) {
    const passageCount = cluster.claims.length;
    lines.push(
      `- **${cluster.heading}** — ${cluster.sourceCount} ${cluster.sourceCount === 1 ? 'source' : 'sources'} · ${passageCount} ${passageCount === 1 ? 'passage' : 'passages'}`,
    );
  }
  lines.push('');
}

function appendKeyIdeas(
  lines: string[],
  synthesis: TopicSynthesis,
  options: RenderSynthesisOptions,
  heading = 'What matters',
): void {
  lines.push(`## ${heading}`, '');
  if (options.aiOverview) lines.push(options.aiOverview.trim(), '');
  for (const cluster of synthesis.clusters.slice(0, 5)) {
    lines.push(`### ${cluster.heading}`, '');
    for (const claim of cluster.claims.slice(0, 4)) {
      lines.push(`- “${claim.text}” — ${citation(claim)}`);
    }
    lines.push('');
  }
}

function appendComparison(lines: string[], synthesis: TopicSynthesis): void {
  lines.push('## Agreements and tensions', '');
  const supported = synthesis.clusters.filter((cluster) => cluster.sourceCount > 1);
  if (supported.length > 0) {
    lines.push('Backed by more than one source:', '');
    for (const cluster of supported) {
      const sources = [...new Set(cluster.claims.map((claim) => claim.sourceTitle))];
      lines.push(
        `- **${cluster.heading}** — ${cluster.sourceCount} sources: ${sources.join('; ')}`,
      );
    }
    lines.push('');
  } else {
    lines.push('No idea here is yet supported by more than one source.', '');
  }
  if (synthesis.thinEvidence.length > 0) {
    lines.push('Thin evidence — a single source each, treat as unconfirmed:', '');
    for (const cluster of synthesis.thinEvidence.slice(0, 8)) {
      lines.push(`- ${cluster.heading} — only ${cluster.claims[0]?.sourceTitle ?? 'one source'}`);
    }
    lines.push('');
  }
}

function appendTimeline(lines: string[], synthesis: TopicSynthesis, always = false): void {
  if (!always && synthesis.timeline.length < 3) return;
  lines.push('## Timeline', '');
  if (synthesis.timeline.length === 0) {
    lines.push('No saved source carries a usable publication year yet.', '');
    return;
  }
  if (always && synthesis.timeline.length < 3) {
    lines.push(
      `Only ${synthesis.timeline.length} dated ${synthesis.timeline.length === 1 ? 'source is' : 'sources are'} saved, so this chronology is incomplete.`,
      '',
    );
  }
  for (const entry of synthesis.timeline) {
    lines.push(
      `- **${entry.year}** — ${entry.url ? `[${entry.title}](${entry.url})` : entry.title}`,
    );
  }
  lines.push('');
}

function appendQuestions(
  lines: string[],
  synthesis: TopicSynthesis,
  heading = 'Open questions',
): void {
  if (synthesis.openQuestions.length === 0) return;
  lines.push(`## ${heading}`, '');
  for (const question of synthesis.openQuestions) lines.push(`- ${question}`);
  lines.push('');
}

/**
 * The honest synthesis: evidence passages are verbatim quotes with links back to saved sources.
 * Dusori-generated structure, counts, questions, and coverage notices are labeled as such.
 */
export function renderSynthesisMarkdown(
  synthesis: TopicSynthesis,
  options: RenderSynthesisOptions = {},
): string {
  const day = synthesis.generatedAt.slice(0, 10);
  const outputStyle = options.outputStyle ?? 'brief';
  const lines: string[] = [
    '---',
    `title: ${JSON.stringify(`Synthesis — ${synthesis.topicTitle}`)}`,
    `topic: ${synthesis.topicTitle}`,
    `created: ${day}`,
    'generated: synthesis',
    `structure: ${outputStyle}`,
    '---',
    '',
    `# Synthesis — ${synthesis.topicTitle}`,
    '',
    options.aiModel
      ? `Assembled on ${day} from ${synthesis.readCount} of ${synthesis.sourceCount} saved sources (${synthesis.claimCount} quoted passages). ${options.aiModel} produced the overview from bounded saved passages. Quoted bullets remain verbatim and cited; headings, grouping, counts, questions, and gap notices are generated.`
      : `Assembled on ${day} from ${synthesis.readCount} of ${synthesis.sourceCount} saved sources (${synthesis.claimCount} quoted passages). Quoted bullets are verbatim and cited; headings, grouping, counts, questions, and gap notices are generated locally by Dusori.`,
    '',
  ];

  if (synthesis.claimCount === 0) {
    lines.push(
      'No source has been read into quotable passages yet. Save a source and run “Read these”, then regenerate this synthesis.',
      '',
    );
    return `${lines.join('\n')}`;
  }

  appendEvidenceDigest(lines, synthesis);
  if (outputStyle === 'comparison') {
    appendComparison(lines, synthesis);
    appendKeyIdeas(lines, synthesis, options);
    appendTimeline(lines, synthesis);
    appendQuestions(lines, synthesis);
  } else if (outputStyle === 'timeline') {
    appendTimeline(lines, synthesis, true);
    appendKeyIdeas(lines, synthesis, options, 'Evidence by theme');
    appendComparison(lines, synthesis);
    appendQuestions(lines, synthesis);
  } else if (outputStyle === 'study-guide') {
    appendKeyIdeas(lines, synthesis, options, 'Key ideas');
    appendQuestions(lines, synthesis, 'Check your understanding');
    appendComparison(lines, synthesis);
    appendTimeline(lines, synthesis);
  } else {
    appendKeyIdeas(lines, synthesis, options);
    appendComparison(lines, synthesis);
    appendTimeline(lines, synthesis);
    appendQuestions(lines, synthesis);
  }

  if (synthesis.missingLenses.length > 0) {
    lines.push(
      `Nothing saved yet from: ${synthesis.missingLenses.join(', ')}. That is a gap in coverage, not evidence of absence.`,
      '',
    );
  }

  lines.push(
    '## What this synthesis is',
    '',
    'Evidence bullets above are quoted verbatim from saved source text, with a link back to it. A model overview, when present, is generated from bounded saved passages. Dusori generated the headings, grouping, counts, questions, and gap notices; neither Dusori nor the model judged whether the claims are true. Read the sources before relying on any of this.',
    '',
  );

  return lines.join('\n');
}
