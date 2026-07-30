import type { StorageAdapter } from '../adapters.js';
import { readPendingProposals, type PendingProposal } from '../conflict/proposal-ledger.js';
import {
  inspectWorkspaceHealth,
  type WorkspaceHealthIssue,
  type WorkspaceHealthIssueKind,
} from '../graph/workspace-health.js';
import type { Workspace } from '../schemas/workspace.js';
import { buildReviewQueue, type ReviewQueueItem, type TodayTopicSummary } from './loop.js';
import { inspectSourceReadiness } from './recall.js';
import { localDateOf } from './review.js';

export type ContinueLearningAction =
  'open-roadmap' | 'open-topic' | 'research-objective' | 'start-review';

export interface ContinueLearningItem extends ReviewQueueItem {
  action: ContinueLearningAction;
  canStartReview: boolean;
  sourceReady: boolean;
}

export interface ProposalAttentionItem {
  action: 'review-proposal';
  createdAt: string;
  currentPath: string;
  detail: string;
  kind: 'proposal';
  priority: 'integrity';
  proposalPath: string;
  title: string;
  topicSlug: string;
  topicTitle: string;
}

export interface HealthAttentionItem {
  action: 'open-workspace-health';
  count: number;
  detail: string;
  issueKinds: WorkspaceHealthIssueKind[];
  kind: 'health';
  priority: 'hygiene' | 'integrity';
  title: string;
}

export type NeedsAttentionItem = HealthAttentionItem | ProposalAttentionItem;

export interface TodayFocus {
  continueLearning: ContinueLearningItem[];
  needsAttention: NeedsAttentionItem[];
}

const integrityIssueKinds = new Set<WorkspaceHealthIssueKind>([
  'invalid-proposal-ledger',
  'invalid-source-manifest',
  'missing-proposal-file',
  'missing-proposal-target',
  'missing-source-file',
  'missing-source-manifest',
  'untracked-source-file',
]);

function actionFor(
  item: ReviewQueueItem,
  sourceReady: boolean,
  today: string,
): ContinueLearningAction {
  if (item.status === 'paused') return 'open-topic';
  if (!item.objective || item.objective.startsWith('Add the first reviewable objective')) {
    return 'open-roadmap';
  }
  if (item.dueOn !== null && item.dueOn <= today && sourceReady) return 'start-review';
  if (!sourceReady) return 'research-objective';
  return 'open-roadmap';
}

function hasReviewableObjective(item: ReviewQueueItem): boolean {
  return Boolean(
    item.objective && !item.objective.startsWith('Add the first reviewable objective'),
  );
}

function uniqueIssueKinds(issues: WorkspaceHealthIssue[]): WorkspaceHealthIssueKind[] {
  return [...new Set(issues.map((issue) => issue.kind))].sort();
}

function documentLabel(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, '');
  return name || 'document';
}

async function loadablePendingProposals(
  storage: StorageAdapter,
  workspace: Workspace,
): Promise<Array<PendingProposal & { topicTitle: string }>> {
  const bySlug = new Map(workspace.topics.map((topic) => [topic.slug, topic.title]));
  const perTopic = await Promise.all(
    workspace.topics.map(async (topic) => {
      try {
        return await readPendingProposals(storage, topic.slug);
      } catch {
        // Workspace health reports the invalid ledger without making Today disappear.
        return [];
      }
    }),
  );
  const pending = perTopic.flat();
  const loadable = await Promise.all(
    pending.map(async (proposal) => {
      const [current, proposed] = await Promise.all([
        storage.read(proposal.currentPath),
        storage.read(proposal.proposalPath),
      ]);
      return current && proposed
        ? { ...proposal, topicTitle: bySlug.get(proposal.topicSlug) ?? proposal.topicSlug }
        : null;
    }),
  );
  return loadable.filter(
    (proposal): proposal is PendingProposal & { topicTitle: string } => proposal !== null,
  );
}

/**
 * Builds the two Today lanes from current local evidence. It writes no state and performs no
 * repairs; the owning workflows remain responsible for every action.
 */
export async function buildTodayFocus(
  storage: StorageAdapter,
  workspace: Workspace,
  summaries: TodayTopicSummary[],
  now = new Date(),
): Promise<TodayFocus> {
  const today = localDateOf(now);
  const [health, pending, readiness] = await Promise.all([
    inspectWorkspaceHealth(storage),
    loadablePendingProposals(storage, workspace),
    Promise.all(
      summaries.map(async (summary) => {
        try {
          return [summary.slug, await inspectSourceReadiness(storage, summary.slug)] as const;
        } catch {
          return [
            summary.slug,
            { approvedSources: 0, readableSources: 0, sourceReady: false },
          ] as const;
        }
      }),
    ),
  ]);
  const readinessBySlug = new Map(readiness);
  const continueLearning = buildReviewQueue(summaries, 5, now).map((item) => {
    const sourceReady = readinessBySlug.get(item.slug)?.sourceReady ?? false;
    return {
      ...item,
      action: actionFor(item, sourceReady, today),
      canStartReview: item.status === 'active' && sourceReady && hasReviewableObjective(item),
      sourceReady,
    };
  });

  const proposalItems: ProposalAttentionItem[] = pending.map((proposal) => ({
    action: 'review-proposal',
    createdAt: proposal.createdAt,
    currentPath: proposal.currentPath,
    detail: `${proposal.topicTitle} · the current document remains active`,
    kind: 'proposal',
    priority: 'integrity',
    proposalPath: proposal.proposalPath,
    title: `Review proposal for ${documentLabel(proposal.currentPath)}`,
    topicSlug: proposal.topicSlug,
    topicTitle: proposal.topicTitle,
  }));
  const integrityIssues = health.issues.filter((issue) => integrityIssueKinds.has(issue.kind));
  const hygieneIssues = health.issues.filter((issue) => !integrityIssueKinds.has(issue.kind));
  const healthItems: HealthAttentionItem[] = [
    ...(integrityIssues.length
      ? [
          {
            action: 'open-workspace-health' as const,
            count: integrityIssues.length,
            detail: 'Source or proposal records need inspection before they are trusted.',
            issueKinds: uniqueIssueKinds(integrityIssues),
            kind: 'health' as const,
            priority: 'integrity' as const,
            title: 'Workspace integrity needs attention',
          },
        ]
      : []),
    ...(hygieneIssues.length
      ? [
          {
            action: 'open-workspace-health' as const,
            count: hygieneIssues.length,
            detail: 'Unresolved links do not block learning and can be reviewed when convenient.',
            issueKinds: uniqueIssueKinds(hygieneIssues),
            kind: 'health' as const,
            priority: 'hygiene' as const,
            title: 'Workspace links can be tidied',
          },
        ]
      : []),
  ];

  return { continueLearning, needsAttention: [...proposalItems, ...healthItems] };
}
