import type { StorageAdapter } from '../adapters.js';
import {
  acceptMarkdownUpdate,
  appendTopicUpdate,
  proposeMarkdownUpdate,
  type MarkdownConflict,
} from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, type TopicState, type Workspace } from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';

const taskLine = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/u;
const sectionLine = /^(#{2,6})\s+(.+?)\s*#*\s*$/u;
const updateLine = /^\s*-\s+(.+?)\s*$/u;

export interface RoadmapObjective {
  completed: boolean;
  depth: number;
  index: number;
  title: string;
}

export type RoadmapEntry =
  ({ kind: 'objective' } & RoadmapObjective) | { depth: number; kind: 'section'; title: string };

export interface TopicProgress {
  completed: number;
  entries: RoadmapEntry[];
  nextObjective: RoadmapObjective | null;
  objectives: RoadmapObjective[];
  percent: number;
  total: number;
}

export interface RecentTopicActivity {
  date: string;
  text: string;
}

export interface TodayTopicSummary {
  progress: TopicProgress;
  recentActivity: RecentTopicActivity[];
  slug: string;
  status: TopicState['status'];
  title: string;
  updatedAt: string;
}

export type RoadmapUpdateResult =
  | { conflict: MarkdownConflict; progress: TopicProgress; status: 'conflict' }
  | { content: string; progress: TopicProgress; state: TopicState; status: 'updated' };

function plainObjectiveTitle(value: string): string {
  return value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
    .replace(/\[\[([^\]]+)\]\]/gu, '$1')
    .trim();
}

function plainActivityText(value: string): string {
  return value
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/gu, '$2')
    .replace(/\[\[([^\]]+)\]\]/gu, (_match, path: string) => path.split('/').at(-1) ?? path)
    .trim();
}

export function parseRoadmapObjectives(content: string): RoadmapObjective[] {
  const objectives: RoadmapObjective[] = [];
  for (const line of content.split('\n')) {
    const match = taskLine.exec(line);
    if (!match) continue;
    objectives.push({
      completed: match[2]?.toLowerCase() === 'x',
      depth: Math.floor((match[1]?.replaceAll('\t', '  ').length ?? 0) / 2),
      index: objectives.length,
      title: plainObjectiveTitle(match[3] ?? ''),
    });
  }
  return objectives;
}

export function parseRoadmapEntries(content: string): RoadmapEntry[] {
  const entries: RoadmapEntry[] = [];
  let objectiveIndex = 0;
  for (const line of content.split('\n')) {
    const task = taskLine.exec(line);
    if (task) {
      entries.push({
        completed: task[2]?.toLowerCase() === 'x',
        depth: Math.floor((task[1]?.replaceAll('\t', '  ').length ?? 0) / 2) + 1,
        index: objectiveIndex,
        kind: 'objective',
        title: plainObjectiveTitle(task[3] ?? ''),
      });
      objectiveIndex += 1;
      continue;
    }
    const section = sectionLine.exec(line);
    if (section) {
      entries.push({
        depth: Math.max(0, (section[1]?.length ?? 2) - 2),
        kind: 'section',
        title: plainObjectiveTitle(section[2] ?? ''),
      });
    }
  }
  return entries;
}

export function progressFromRoadmap(content: string): TopicProgress {
  const objectives = parseRoadmapObjectives(content);
  const completed = objectives.filter((objective) => objective.completed).length;
  const total = objectives.length;
  return {
    completed,
    entries: parseRoadmapEntries(content),
    nextObjective: objectives.find((objective) => !objective.completed) ?? null,
    objectives,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
    total,
  };
}

export function setRoadmapObjectiveCompleted(
  content: string,
  objectiveIndex: number,
  completed: boolean,
): string {
  let currentObjective = -1;
  let changed = false;
  const next = content.split('\n').map((line) => {
    const match = taskLine.exec(line);
    if (!match) return line;
    currentObjective += 1;
    if (currentObjective !== objectiveIndex) return line;
    changed = true;
    return line.replace(/\[([ xX])\]/u, completed ? '[x]' : '[ ]');
  });
  if (!changed) throw new Error('That roadmap objective no longer exists. Reload the roadmap.');
  return next.join('\n');
}

export async function readTopicProgress(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<TopicProgress> {
  const roadmap = await storage.read(`${topicRoot(topicSlug)}/roadmap.md`);
  if (!roadmap) throw new Error('The topic roadmap is missing.');
  return progressFromRoadmap(roadmap.content);
}

export async function updateRoadmapObjective(
  storage: StorageAdapter,
  topicSlug: string,
  objectiveIndex: number,
  completed: boolean,
  now = new Date(),
): Promise<RoadmapUpdateResult> {
  const roadmap = await storage.read(`${topicRoot(topicSlug)}/roadmap.md`);
  if (!roadmap) throw new Error('The topic roadmap is missing.');
  const currentProgress = progressFromRoadmap(roadmap.content);
  const objective = currentProgress.objectives[objectiveIndex];
  if (!objective) throw new Error('That roadmap objective no longer exists. Reload the roadmap.');

  const content = setRoadmapObjectiveCompleted(roadmap.content, objectiveIndex, completed);
  const proposed = await proposeMarkdownUpdate(storage, topicSlug, 'roadmap.md', content, now);
  if ('proposalPath' in proposed) {
    return { conflict: proposed, progress: currentProgress, status: 'conflict' };
  }

  const state = await acceptMarkdownUpdate(
    storage,
    topicSlug,
    'roadmap.md',
    content,
    proposed.currentHash,
    now,
    `- ${completed ? 'Completed' : 'Reopened'} “${objective.title}” in [[../../../roadmap]].`,
  );
  return { content, progress: progressFromRoadmap(content), state, status: 'updated' };
}

export async function setTopicStatus(
  storage: StorageAdapter,
  topicSlug: string,
  status: TopicState['status'],
  now = new Date(),
): Promise<TopicState> {
  const statePath = `${topicRoot(topicSlug)}/state.json`;
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  if (state.status === status) return state;
  const stateFile = await storage.read(statePath);
  if (!stateFile) throw new Error('The topic state is missing.');
  const nextState = TopicStateSchema.parse({
    ...state,
    status,
    updatedAt: now.toISOString(),
  });
  await storage.write(statePath, `${JSON.stringify(nextState, null, 2)}\n`, {
    expectedHash: stateFile.hash,
  });
  const label = status === 'complete' ? 'Completed' : status === 'paused' ? 'Paused' : 'Resumed';
  await appendTopicUpdate(storage, topicSlug, `- ${label} this topic.`, now);
  return nextState;
}

export async function readRecentTopicActivity(
  storage: StorageAdapter,
  topicSlug: string,
  limit = 3,
): Promise<RecentTopicActivity[]> {
  const updateRoot = `${topicRoot(topicSlug)}/Updates`;
  const files = (await storage.list(updateRoot, true))
    .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md'))
    .sort((left, right) => right.path.localeCompare(left.path));
  const activity: RecentTopicActivity[] = [];
  for (const entry of files) {
    const file = await storage.read(entry.path);
    if (!file) continue;
    const date = entry.path.slice(-13, -3);
    for (const line of file.content.split('\n').reverse()) {
      const match = updateLine.exec(line);
      if (!match) continue;
      activity.push({ date, text: plainActivityText(match[1] ?? '') });
      if (activity.length === limit) return activity;
    }
  }
  return activity;
}

export async function buildTodaySummary(
  storage: StorageAdapter,
  workspace: Workspace,
): Promise<TodayTopicSummary[]> {
  return Promise.all(
    workspace.topics.map(async (topic) => {
      const root = topicRoot(topic.slug);
      const [state, progress, recentActivity] = await Promise.all([
        readMachineFile(storage, `${root}/state.json`, TopicStateSchema),
        readTopicProgress(storage, topic.slug),
        readRecentTopicActivity(storage, topic.slug),
      ]);
      return {
        progress,
        recentActivity,
        slug: topic.slug,
        status: state.status,
        title: topic.title,
        updatedAt: state.updatedAt,
      };
    }),
  );
}
