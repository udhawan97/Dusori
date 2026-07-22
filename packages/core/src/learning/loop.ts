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
import { readReviewSchedule, utcDateOf, type ReviewSchedule } from './review.js';

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
  review: ReviewSchedule | null;
  slug: string;
  status: TopicState['status'];
  title: string;
  updatedAt: string;
}

export interface ReviewQueueItem {
  dueOn: string | null;
  objective: string;
  progressPercent: number;
  reason: string;
  slug: string;
  status: TopicState['status'];
  title: string;
  updatedAt: string;
}

export interface WorkspaceRecapEntry extends RecentTopicActivity {
  slug: string;
  title: string;
}

export interface WorkspaceRecap {
  entries: WorkspaceRecapEntry[];
  from: string;
  to: string;
  topicsTouched: number;
}

export interface WorkspaceRecapOptions {
  days?: number;
  limit?: number;
  now?: Date;
}

export interface NextScheduledReview {
  dueOn: string;
  slug: string;
  title: string;
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
      const [state, progress, recentActivity, review] = await Promise.all([
        readMachineFile(storage, `${root}/state.json`, TopicStateSchema),
        readTopicProgress(storage, topic.slug),
        readRecentTopicActivity(storage, topic.slug),
        readReviewSchedule(storage, topic.slug),
      ]);
      return {
        progress,
        recentActivity,
        review,
        slug: topic.slug,
        status: state.status,
        title: topic.title,
        updatedAt: state.updatedAt,
      };
    }),
  );
}

/** Orders unfinished topics from explicit local state; deadlines exist only where the learner recorded a review. */
export function buildReviewQueue(
  summaries: TodayTopicSummary[],
  limit = 5,
  now = new Date(),
): ReviewQueueItem[] {
  const today = utcDateOf(now);
  const statusPriority: Record<TopicState['status'], number> = {
    active: 0,
    paused: 1,
    complete: 2,
  };
  const dueGroup = (summary: TodayTopicSummary): number => {
    if (summary.status !== 'active' || summary.review === null) return 1;
    return summary.review.dueOn <= today ? 0 : 2;
  };
  return summaries
    .filter((summary) => summary.status !== 'complete' && dueGroup(summary) !== 2)
    .sort(
      (left, right) =>
        statusPriority[left.status] - statusPriority[right.status] ||
        dueGroup(left) - dueGroup(right) ||
        (left.review !== null &&
        right.review !== null &&
        dueGroup(left) === 0 &&
        dueGroup(right) === 0
          ? left.review.dueOn.localeCompare(right.review.dueOn)
          : 0) ||
        left.updatedAt.localeCompare(right.updatedAt) ||
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug),
    )
    .slice(0, Math.max(0, limit))
    .map((summary) => ({
      dueOn: summary.review?.dueOn ?? null,
      objective:
        summary.progress.nextObjective?.title ??
        (summary.progress.total
          ? 'Review the finished roadmap and decide whether to complete this topic.'
          : 'Add the first reviewable objective to this roadmap.'),
      progressPercent: summary.progress.percent,
      reason:
        summary.status === 'paused'
          ? 'Paused · resume when ready'
          : summary.review !== null && summary.review.dueOn <= today
            ? summary.review.dueOn === today
              ? 'Due today · spaced review'
              : `Overdue since ${summary.review.dueOn} · spaced review`
            : 'Active · least recently updated first',
      slug: summary.slug,
      status: summary.status,
      title: summary.title,
      updatedAt: summary.updatedAt,
    }));
}

/** The earliest not-yet-due active topic, so an empty queue can say what returns when. */
export function nextScheduledReview(
  summaries: TodayTopicSummary[],
  now = new Date(),
): NextScheduledReview | null {
  const today = utcDateOf(now);
  const upcoming = summaries
    .filter(
      (summary): summary is TodayTopicSummary & { review: ReviewSchedule } =>
        summary.status === 'active' && summary.review !== null && summary.review.dueOn > today,
    )
    .sort(
      (left, right) =>
        left.review.dueOn.localeCompare(right.review.dueOn) ||
        left.title.localeCompare(right.title) ||
        left.slug.localeCompare(right.slug),
    );
  const first = upcoming[0];
  return first ? { dueOn: first.review.dueOn, slug: first.slug, title: first.title } : null;
}

/** Reads a bounded, recent-first recap from dated update files without writing summary state. */
export async function buildWorkspaceRecap(
  storage: StorageAdapter,
  workspace: Workspace,
  options: WorkspaceRecapOptions = {},
): Promise<WorkspaceRecap> {
  const days = Math.min(90, Math.max(1, Math.trunc(options.days ?? 7)));
  const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 12)));
  const now = options.now ?? new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(`${to}T00:00:00.000Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  const from = fromDate.toISOString().slice(0, 10);
  const entries: Array<WorkspaceRecapEntry & { sequence: number }> = [];
  let sequence = 0;

  for (const topic of workspace.topics) {
    const updateRoot = `${topicRoot(topic.slug)}/Updates`;
    const files = (await storage.list(updateRoot, true))
      .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md'))
      .sort((left, right) => right.path.localeCompare(left.path));
    for (const entry of files) {
      const date = /(\d{4}-\d{2}-\d{2})\.md$/u.exec(entry.path)?.[1];
      if (!date || date < from || date > to) continue;
      const file = await storage.read(entry.path);
      if (!file) continue;
      for (const line of file.content.split('\n').reverse()) {
        const match = updateLine.exec(line);
        if (!match) continue;
        entries.push({
          date,
          sequence: sequence++,
          slug: topic.slug,
          text: plainActivityText(match[1] ?? ''),
          title: topic.title,
        });
      }
    }
  }

  const bounded = entries
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.title.localeCompare(right.title) ||
        left.sequence - right.sequence,
    )
    .slice(0, limit)
    .map(({ date, slug, text, title }) => ({ date, slug, text, title }));
  return {
    entries: bounded,
    from,
    to,
    topicsTouched: new Set(bounded.map((entry) => entry.slug)).size,
  };
}
