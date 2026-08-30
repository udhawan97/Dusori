import type { StorageAdapter } from '../adapters.js';
import { buildWorkspaceGraph, type WorkspaceGraphNodeKind } from '../graph/workspace-graph.js';
import {
  buildTodaySummary,
  buildWorkspaceRecap,
  type TodayTopicSummary,
} from '../learning/loop.js';
import {
  addDaysUtc,
  localDateOf,
  readReviewSchedule,
  type ReviewSchedule,
} from '../learning/review.js';
import type { Workspace } from '../schemas/workspace.js';
import { readSourceManifest } from '../sources/import.js';

export interface ActivityPoint {
  count: number;
  date: string;
}

export interface ArtifactMixItem {
  count: number;
  kind: 'foundation' | 'note' | 'source' | 'update';
  label: string;
}

export interface ConnectedArtifact {
  connections: number;
  kind: WorkspaceGraphNodeKind;
  label: string;
  path: string;
}

export interface ProviderMixItem {
  count: number;
  id: string;
  label: string;
}

export interface TagCount {
  count: number;
  tag: string;
}

export interface ReviewDuePoint {
  count: number;
  date: string;
}

export interface ReviewPressure {
  dueToday: number;
  overdue: number;
  /** Topics carrying a review schedule. */
  scheduled: number;
  /** Topics never marked reviewed, which keep the deterministic queue order. */
  unscheduled: number;
  upcoming: ReviewDuePoint[];
}

export interface TopicInsight {
  activityCount: number;
  noteCount: number;
  objectiveCompleted: number;
  objectivePercent: number;
  objectiveTotal: number;
  slug: string;
  sourceCount: number;
  status: TodayTopicSummary['status'];
  title: string;
  updatedAt: string;
}

export interface WorkspaceInsightTotals {
  activeDays: number;
  artifactCount: number;
  connectedArtifactPercent: number;
  linkHealthPercent: number;
  noteCount: number;
  objectiveCompleted: number;
  objectiveTotal: number;
  resolvedLinks: number;
  sourceCount: number;
  topicCount: number;
  unresolvedLinks: number;
}

export interface WorkspaceInsights {
  activity: ActivityPoint[];
  artifactMix: ArtifactMixItem[];
  hubs: ConnectedArtifact[];
  providers: ProviderMixItem[];
  reviewPressure: ReviewPressure;
  tags: TagCount[];
  topics: TopicInsight[];
  totals: WorkspaceInsightTotals;
}

export interface WorkspaceInsightOptions {
  days?: number;
  now?: Date;
}

const providerLabels: Record<string, string> = {
  arxiv: 'arXiv',
  companion: 'Companion fetch',
  github: 'GitHub',
  hackernews: 'Hacker News',
  manual: 'Added manually',
  mslearn: 'Microsoft Learn',
  npm: 'npm',
  openalex: 'OpenAlex',
  reddit: 'Reddit',
  stackexchange: 'Stack Exchange',
  websearch: 'Web search',
  wikipedia: 'Wikipedia',
};

function labelProvider(id: string): string {
  return (
    providerLabels[id] ??
    id.replace(/[-_]+/gu, ' ').replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase())
  );
}

function dateSeries(days: number, now: Date): ActivityPoint[] {
  const end = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const points: ActivityPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - offset);
    points.push({ count: 0, date: date.toISOString().slice(0, 10) });
  }
  return points;
}

function percentage(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

/**
 * Counts what the review queue is actually holding. Derived from each topic's `review.json` on
 * read: no schedule is created here, no study time is estimated, and a topic that has never been
 * reviewed is reported as unscheduled rather than as overdue.
 */
function reviewPressureFrom(
  schedules: Array<ReviewSchedule | null>,
  days: number,
  now: Date,
): ReviewPressure {
  const today = localDateOf(now);
  const upcoming: ReviewDuePoint[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    upcoming.push({ count: 0, date: addDaysUtc(today, offset) });
  }
  const upcomingByDate = new Map(upcoming.map((point) => [point.date, point]));

  let dueToday = 0;
  let overdue = 0;
  let scheduled = 0;
  for (const schedule of schedules) {
    if (!schedule) continue;
    scheduled += 1;
    if (schedule.dueOn < today) overdue += 1;
    else if (schedule.dueOn === today) dueToday += 1;
    const point = upcomingByDate.get(schedule.dueOn);
    if (point) point.count += 1;
  }

  return {
    dueToday,
    overdue,
    scheduled,
    unscheduled: schedules.length - scheduled,
    upcoming,
  };
}

/** Counts tags across the graph, grouping spellings that differ only by case under the first seen. */
function tagCounts(nodes: Array<{ tags?: string[] }>): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const node of nodes) {
    for (const tag of node.tags ?? []) {
      const key = tag.toLocaleLowerCase();
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { count: 1, tag });
    }
  }
  return [...counts.values()].sort(
    (left, right) => right.count - left.count || left.tag.localeCompare(right.tag),
  );
}

function artifactMix(nodes: Array<{ kind: WorkspaceGraphNodeKind }>): ArtifactMixItem[] {
  const counts: Record<ArtifactMixItem['kind'], number> = {
    foundation: 0,
    note: 0,
    source: 0,
    update: 0,
  };
  for (const node of nodes) {
    if (node.kind === 'annotation') counts.note += 1;
    else if (node.kind === 'note' || node.kind === 'source' || node.kind === 'update') {
      counts[node.kind] += 1;
    } else {
      counts.foundation += 1;
    }
  }
  return [
    { count: counts.foundation, kind: 'foundation', label: 'Foundations' },
    { count: counts.note, kind: 'note', label: 'Notes' },
    { count: counts.source, kind: 'source', label: 'Sources' },
    { count: counts.update, kind: 'update', label: 'Updates' },
  ];
}

/**
 * Reads exact, local workspace evidence and derives a bounded analytics snapshot.
 * Nothing is indexed, persisted, uploaded, or inferred about study time.
 */
export async function buildWorkspaceInsights(
  storage: StorageAdapter,
  workspace: Workspace,
  options: WorkspaceInsightOptions = {},
): Promise<WorkspaceInsights> {
  const days = Math.min(30, Math.max(7, Math.trunc(options.days ?? 14)));
  const now = options.now ?? new Date();
  const [graph, summaries, recap, manifests, schedules] = await Promise.all([
    buildWorkspaceGraph(storage),
    buildTodaySummary(storage, workspace),
    buildWorkspaceRecap(storage, workspace, { days, limit: 100, now }),
    Promise.all(
      workspace.topics.map((topic) =>
        readSourceManifest(storage, topic.slug).catch(() => ({
          schemaVersion: 1 as const,
          sources: [],
        })),
      ),
    ),
    // An unreadable schedule is left for the explicit repair path, exactly as an invalid
    // source manifest is: this report never fixes a machine file it happens to read.
    Promise.all(
      workspace.topics.map((topic) =>
        readReviewSchedule(storage, topic.slug, now).catch(() => null),
      ),
    ),
  ]);

  const activity = dateSeries(days, now);
  const activityByDate = new Map(activity.map((point) => [point.date, point]));
  const activityByTopic = new Map<string, number>();
  for (const entry of recap.entries) {
    const point = activityByDate.get(entry.date);
    if (point) point.count += 1;
    activityByTopic.set(entry.slug, (activityByTopic.get(entry.slug) ?? 0) + 1);
  }

  const providers = new Map<string, number>();
  let sourceCount = 0;
  manifests.forEach((manifest) => {
    sourceCount += manifest.sources.length;
    manifest.sources.forEach((source) => {
      const id = source.origin?.provider ?? 'manual';
      providers.set(id, (providers.get(id) ?? 0) + 1);
    });
  });

  // Research events are virtual Map receipts, not standalone workspace documents. Keep Insights'
  // file-derived artifact counts and tag distribution stable while the Map exposes those receipts.
  const artifactNodes = graph.nodes.filter((node) => node.kind !== 'event');
  const linkEdges = graph.edges.filter((edge) => edge.kind === 'links');
  const connected = new Set(linkEdges.flatMap((edge) => [edge.source, edge.target]));
  const linkDegree = new Map<string, number>();
  linkEdges.forEach((edge) => {
    linkDegree.set(edge.source, (linkDegree.get(edge.source) ?? 0) + 1);
    linkDegree.set(edge.target, (linkDegree.get(edge.target) ?? 0) + 1);
  });
  const nodesById = new Map(artifactNodes.map((node) => [node.id, node]));
  const hubs = [...linkDegree]
    .map(([id, connections]) => {
      const node = nodesById.get(id);
      return node
        ? {
            connections,
            kind: node.kind,
            label: node.label,
            path: node.path,
          }
        : null;
    })
    .filter((hub): hub is ConnectedArtifact => hub !== null)
    .sort(
      (left, right) =>
        right.connections - left.connections ||
        left.label.localeCompare(right.label) ||
        left.path.localeCompare(right.path),
    )
    .slice(0, 5);

  const topics = summaries
    .map((summary, index): TopicInsight => {
      const topicNodes = artifactNodes.filter((node) => node.topicSlug === summary.slug);
      return {
        activityCount: activityByTopic.get(summary.slug) ?? 0,
        noteCount: topicNodes.filter((node) => node.kind === 'note' || node.kind === 'annotation')
          .length,
        objectiveCompleted: summary.progress.completed,
        objectivePercent: summary.progress.percent,
        objectiveTotal: summary.progress.total,
        slug: summary.slug,
        sourceCount: manifests[index]?.sources.length ?? 0,
        status: summary.status,
        title: summary.title,
        updatedAt: summary.updatedAt,
      };
    })
    .sort(
      (left, right) =>
        right.activityCount - left.activityCount ||
        right.sourceCount - left.sourceCount ||
        left.title.localeCompare(right.title),
    );

  const objectiveCompleted = summaries.reduce(
    (total, summary) => total + summary.progress.completed,
    0,
  );
  const objectiveTotal = summaries.reduce((total, summary) => total + summary.progress.total, 0);
  const totalWikilinks = linkEdges.length + graph.unresolvedLinks.length;

  return {
    activity,
    artifactMix: artifactMix(artifactNodes),
    hubs,
    providers: [...providers]
      .map(([id, count]) => ({ count, id, label: labelProvider(id) }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    reviewPressure: reviewPressureFrom(schedules, days, now),
    tags: tagCounts(artifactNodes),
    topics,
    totals: {
      activeDays: activity.filter((point) => point.count > 0).length,
      artifactCount: artifactNodes.length,
      connectedArtifactPercent: percentage(connected.size, artifactNodes.length),
      linkHealthPercent: totalWikilinks === 0 ? 100 : percentage(linkEdges.length, totalWikilinks),
      noteCount: artifactNodes.filter((node) => node.kind === 'note' || node.kind === 'annotation')
        .length,
      objectiveCompleted,
      objectiveTotal,
      resolvedLinks: linkEdges.length,
      sourceCount,
      topicCount: workspace.topics.length,
      unresolvedLinks: graph.unresolvedLinks.length,
    },
  };
}
