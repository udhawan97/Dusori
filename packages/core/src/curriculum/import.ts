import type { StorageAdapter } from '../adapters.js';
import {
  acceptMarkdownUpdate,
  proposeMarkdownUpdate,
  type MarkdownConflict,
} from '../conflict/write-protocol.js';
import { addSource } from '../sources/import.js';
import { topicRoot } from '../workspace/paths.js';

export const maxCurriculumBytes = 512 * 1024;

export type CurriculumAdapterId = 'aws-exam-guide' | 'microsoft-learn' | 'structured-markdown';
export type CurriculumAdapterSelection = 'auto' | CurriculumAdapterId;

export interface CurriculumImportInput {
  adapterId: CurriculumAdapterSelection;
  content: string;
  sourceTitle: string;
  sourceUrl?: string;
}

export interface CurriculumObjective {
  depth: 1 | 2 | 3;
  title: string;
  weight?: string;
}

export interface CurriculumDraft {
  adapterId: CurriculumAdapterId;
  adapterLabel: string;
  objectives: CurriculumObjective[];
  sourceContent: string;
  sourceTitle: string;
  sourceUrl?: string;
}

export interface CurriculumAdapter {
  readonly id: CurriculumAdapterId;
  readonly label: string;
  matches(input: CurriculumImportInput): boolean;
  parse(input: CurriculumImportInput): CurriculumObjective[];
}

export type CurriculumApplyResult =
  | {
      conflict: MarkdownConflict;
      roadmapContent: string;
      sourceDeduplicated: boolean;
      sourcePath: string;
      status: 'conflict';
    }
  | {
      roadmapContent: string;
      sourceDeduplicated: boolean;
      sourcePath: string;
      status: 'applied';
    };

interface OutlineLine {
  level: number;
  text: string;
  type: 'heading' | 'item';
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function cleanSourceTitle(input: string): string {
  const title = input.trim();
  const hasControlCharacter = [...title].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!title || title.length > 160 || hasControlCharacter) {
    throw new Error('Use a one-line source title between 1 and 160 characters.');
  }
  return title;
}

function cleanObjectiveTitle(input: string): string {
  return input
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]*>/gu, '')
    .replace(/[*_`~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

function parseSourceUrl(input?: string): string | undefined {
  if (!input?.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('That source URL is not valid. Use a complete http:// or https:// address.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Curriculum sources must use an http:// or https:// address.');
  }
  if (url.username || url.password) {
    throw new Error('Remove the username or password from this source URL.');
  }
  return url.toString();
}

function outlineLines(content: string): OutlineLine[] {
  const result: OutlineLine[] = [];
  for (const rawLine of content.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(rawLine.trim());
    if (heading) {
      const marker = heading[1];
      const text = heading[2];
      if (marker && text) result.push({ level: marker.length, text, type: 'heading' });
      continue;
    }
    const item = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?(.+)$/u.exec(rawLine);
    if (item) {
      const indentation = item[1];
      const text = item[2];
      if (indentation === undefined || !text) continue;
      result.push({
        level: Math.floor(indentation.replace(/\t/gu, '  ').length / 2),
        text,
        type: 'item',
      });
    }
  }
  return result;
}

function clampDepth(depth: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(3, depth)) as 1 | 2 | 3;
}

function splitWeight(input: string): { title: string; weight?: string } {
  const match = /^(.*?)\s*\((\d{1,3}\s*[–-]\s*\d{1,3}\s*%)\)\s*$/u.exec(input);
  if (!match) return { title: cleanObjectiveTitle(input) };
  const title = match[1];
  const weight = match[2];
  if (title === undefined || weight === undefined) return { title: cleanObjectiveTitle(input) };
  return {
    title: cleanObjectiveTitle(title),
    weight: weight.replace(/\s*[-–]\s*/u, '–').replace(/\s+/gu, ''),
  };
}

const microsoftLearnAdapter: CurriculumAdapter = {
  id: 'microsoft-learn',
  label: 'Microsoft Learn study guide',
  matches(input) {
    return /(?:^|\n)#{1,3}\s+Skills measured(?:\s+as of\s+.+)?(?:\n|$)/iu.test(input.content);
  },
  parse(input) {
    const lines = outlineLines(input.content);
    const objectives: CurriculumObjective[] = [];
    let insideSkills = false;
    let activeSection = false;
    let currentHeadingLevel = 0;

    for (const line of lines) {
      if (line.type === 'heading') {
        const label = cleanObjectiveTitle(line.text);
        if (/^skills measured(?:\s+as of\s+.+)?$/iu.test(label)) {
          insideSkills = true;
          activeSection = false;
          continue;
        }
        if (!insideSkills) continue;
        if (
          /^(?:study resources|change log|additional resources|resources for study)$/iu.test(label)
        ) {
          break;
        }
        if (/^(?:audience profile|skills at a glance)$/iu.test(label)) {
          activeSection = false;
          currentHeadingLevel = line.level;
          continue;
        }
        if (line.level <= 2) continue;
        activeSection = true;
        currentHeadingLevel = line.level;
        const weighted = splitWeight(label);
        objectives.push({
          depth: clampDepth(line.level - 2),
          title: weighted.title,
          ...(weighted.weight ? { weight: weighted.weight } : {}),
        });
        continue;
      }
      if (!insideSkills || !activeSection) continue;
      const title = cleanObjectiveTitle(line.text);
      if (title) objectives.push({ depth: clampDepth(currentHeadingLevel - 1), title });
    }
    return objectives;
  },
};

const awsBulletPrefix = /^(?:[•◦▪‣·o]|[-*+]|\d+[.)])\s+/u;
const awsDomainLine = /^Domain\s+(\d{1,2})\s*:\s*(.+)$/iu;
const awsTaskLine = /^Task\s+Statement\s+(\d{1,2})\.\d{1,2}\s*[:.]?\s*(.*)$/iu;
const awsSectionLabel = /^(?:Knowledge\s+of|Skills\s+in)\s*:?$/iu;
const awsTrailingWeight = /\(?\s*(\d{1,3}(?:\.\d+)?)\s*%[^)]*\)?\s*$/u;

interface AwsTask {
  domainNumber: number;
  title: string;
}

function awsPlainLine(rawLine: string): { hadBullet: boolean; text: string } {
  const unhashed = rawLine.trim().replace(/^#{1,6}\s+/u, '');
  const hadBullet = awsBulletPrefix.test(unhashed);
  const text = (hadBullet ? unhashed.replace(awsBulletPrefix, '') : unhashed)
    .replace(/^[*_]+\s*/u, '')
    .replace(/\s*[*_]+$/u, '')
    .trim();
  return { hadBullet, text };
}

const awsExamGuideAdapter: CurriculumAdapter = {
  id: 'aws-exam-guide',
  label: 'AWS Certification exam guide',
  matches(input) {
    const lines = input.content.split('\n').map((line) => awsPlainLine(line).text);
    return (
      lines.some((line) => awsDomainLine.test(line)) &&
      lines.some((line) => awsTaskLine.test(line) || /%\s+of\s+scored\s+content/iu.test(line))
    );
  },
  parse(input) {
    const domains = new Map<number, { title: string; weight?: string }>();
    const domainOrder: number[] = [];
    const tasks: AwsTask[] = [];
    let openTask: AwsTask | null = null;

    for (const rawLine of input.content.split('\n')) {
      const { hadBullet, text } = awsPlainLine(rawLine);
      if (!text) {
        openTask = null;
        continue;
      }
      const domain = awsDomainLine.exec(text);
      if (domain?.[1] && domain[2] !== undefined) {
        const domainNumber = Number(domain[1]);
        const weightMatch = awsTrailingWeight.exec(domain[2]);
        const weight = weightMatch?.[1] ? `${weightMatch[1]}%` : undefined;
        const title = cleanObjectiveTitle(
          weightMatch ? domain[2].slice(0, weightMatch.index) : domain[2],
        );
        const existing = domains.get(domainNumber);
        if (existing) {
          if (!existing.title && title) existing.title = title;
          if (!existing.weight && weight) existing.weight = weight;
        } else {
          domains.set(domainNumber, { title, ...(weight ? { weight } : {}) });
          domainOrder.push(domainNumber);
        }
        openTask = null;
        continue;
      }
      const task = awsTaskLine.exec(text);
      if (task?.[1]) {
        const record: AwsTask = { domainNumber: Number(task[1]), title: task[2] ?? '' };
        tasks.push(record);
        openTask = /\.$/u.test(record.title.trim()) ? null : record;
        continue;
      }
      if (hadBullet || awsSectionLabel.test(text)) {
        openTask = null;
        continue;
      }
      if (openTask) {
        openTask.title = `${openTask.title} ${text}`.trim();
        if (/\.$/u.test(openTask.title)) openTask = null;
      }
    }

    const taskTitle = (task: AwsTask): string =>
      cleanObjectiveTitle(task.title.replace(/\.\s*$/u, ''));
    const objectives: CurriculumObjective[] = [];
    for (const domainNumber of domainOrder) {
      const entry = domains.get(domainNumber);
      if (entry?.title) {
        objectives.push({
          depth: 1,
          title: entry.title,
          ...(entry.weight ? { weight: entry.weight } : {}),
        });
      }
      for (const task of tasks) {
        if (task.domainNumber !== domainNumber) continue;
        const title = taskTitle(task);
        if (title) objectives.push({ depth: 2, title });
      }
    }
    for (const task of tasks) {
      if (domains.has(task.domainNumber)) continue;
      const title = taskTitle(task);
      if (title) objectives.push({ depth: domains.size > 0 ? 2 : 1, title });
    }
    return objectives;
  },
};

const structuredMarkdownAdapter: CurriculumAdapter = {
  id: 'structured-markdown',
  label: 'Structured Markdown syllabus',
  matches(input) {
    const lines = outlineLines(input.content);
    return lines.some((line) => line.type === 'heading') && lines.length >= 2;
  },
  parse(input) {
    const lines = outlineLines(input.content);
    const headings = lines.filter((line) => line.type === 'heading');
    const firstHeading = headings[0];
    const includeFirstHeading = firstHeading?.level !== 1 || headings.length === 1;
    const includedHeadings = includeFirstHeading ? headings : headings.slice(1);
    const baseHeadingLevel = Math.min(...includedHeadings.map((line) => line.level), 6);
    const objectives: CurriculumObjective[] = [];
    let currentDepth: 0 | 1 | 2 | 3 = 0;
    let skippedFirstHeading = false;

    for (const line of lines) {
      if (line.type === 'heading') {
        if (!includeFirstHeading && !skippedFirstHeading && line === firstHeading) {
          skippedFirstHeading = true;
          continue;
        }
        const title = cleanObjectiveTitle(line.text);
        if (!title) continue;
        currentDepth = clampDepth(line.level - baseHeadingLevel + 1);
        objectives.push({ depth: currentDepth, title });
        continue;
      }
      const title = cleanObjectiveTitle(line.text);
      if (!title || currentDepth === 0) continue;
      objectives.push({ depth: clampDepth(currentDepth + Math.max(1, line.level + 1)), title });
    }
    return objectives;
  },
};

export const curriculumAdapters: readonly CurriculumAdapter[] = [
  microsoftLearnAdapter,
  awsExamGuideAdapter,
  structuredMarkdownAdapter,
];

export function parseCurriculum(input: CurriculumImportInput): CurriculumDraft {
  const sourceTitle = cleanSourceTitle(input.sourceTitle);
  const content = input.content.replace(/\r\n?/gu, '\n').trim();
  if (!content) throw new Error('Paste a syllabus or certification outline before previewing it.');
  if (byteLength(content) > maxCurriculumBytes) {
    throw new Error('This curriculum is larger than 512 KiB. Keep only the official outline.');
  }
  const sourceUrl = parseSourceUrl(input.sourceUrl);
  const adapter =
    input.adapterId === 'auto'
      ? curriculumAdapters.find((candidate) => candidate.matches({ ...input, content }))
      : curriculumAdapters.find((candidate) => candidate.id === input.adapterId);
  if (!adapter) {
    throw new Error(
      'Dusori could not recognize this outline. Paste a Microsoft Learn study guide, an AWS exam guide, or Markdown with headings and list items — or choose the format manually.',
    );
  }
  const objectives = adapter.parse({ ...input, content, sourceTitle, sourceUrl });
  if (objectives.length < 2 || !objectives.some((objective) => objective.depth === 1)) {
    throw new Error(
      'Dusori found too little structure. Include at least one heading and two headings or list items.',
    );
  }
  if (objectives.length > 200) {
    throw new Error('This outline has more than 200 items. Split it into smaller curricula.');
  }
  const sourceContent = `${sourceUrl ? `Official page: <${sourceUrl}>\n\n` : ''}${content}\n`;
  return {
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    objectives,
    sourceContent,
    sourceTitle,
    sourceUrl,
  };
}

export function renderCurriculumRoadmap(draft: CurriculumDraft, sourcePath?: string): string {
  const sourceLink = sourcePath
    ? `[[${sourcePath.replace(/\.md$/u, '')}|${draft.sourceTitle}]]`
    : draft.sourceTitle;
  const lines = [
    '---',
    `title: ${JSON.stringify(`${draft.sourceTitle} roadmap`)}`,
    'type: dusori-roadmap',
    'origin: imported-curriculum',
    `adapter: ${draft.adapterId}`,
    ...(draft.sourceUrl ? [`sourceUrl: ${JSON.stringify(draft.sourceUrl)}`] : []),
    '---',
    '',
    '# Roadmap',
    '',
    `> Imported curriculum from ${sourceLink}. Review the official source when requirements change.`,
    '',
  ];

  for (const objective of draft.objectives) {
    const title = `${objective.title}${objective.weight ? ` (${objective.weight})` : ''}`;
    if (objective.depth === 1) lines.push(`## ${title}`, '');
    else if (objective.depth === 2) lines.push(`- [ ] ${title}`);
    else lines.push(`  - [ ] ${title}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export async function applyCurriculum(
  storage: StorageAdapter,
  topicSlug: string,
  draft: CurriculumDraft,
  now = new Date(),
): Promise<CurriculumApplyResult> {
  const source = await addSource(
    storage,
    {
      content: draft.sourceContent,
      mediaType: 'text/markdown',
      method: 'paste',
      title: draft.sourceTitle,
      topicSlug,
    },
    now,
  );
  const relativeSourcePath = source.path.slice(`${topicRoot(topicSlug)}/`.length);
  const roadmapContent = renderCurriculumRoadmap(draft, relativeSourcePath);
  const proposal = await proposeMarkdownUpdate(
    storage,
    topicSlug,
    'roadmap.md',
    roadmapContent,
    now,
  );
  if ('proposalPath' in proposal) {
    return {
      conflict: proposal,
      roadmapContent,
      sourceDeduplicated: source.deduplicated,
      sourcePath: source.path,
      status: 'conflict',
    };
  }
  await acceptMarkdownUpdate(
    storage,
    topicSlug,
    'roadmap.md',
    roadmapContent,
    proposal.currentHash,
    now,
  );
  return {
    roadmapContent,
    sourceDeduplicated: source.deduplicated,
    sourcePath: source.path,
    status: 'applied',
  };
}
