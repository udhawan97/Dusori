import type { StorageAdapter } from '../adapters.js';
import type { Workspace } from '../schemas/workspace.js';
import { deriveMissionOverview, type MissionOverview } from '../research/mission.js';
import {
  buildTodaySummary,
  buildWorkspaceRecap,
  nextScheduledReview,
  type NextScheduledReview,
  type TodayTopicSummary,
  type WorkspaceRecap,
} from './loop.js';
import { buildTodayFocus, type TodayFocus } from './today-focus.js';

export interface TodayProjectionTotals {
  activeTopics: number;
  completedObjectives: number;
  totalObjectives: number;
  topics: number;
}

export interface TodayProjection {
  summaries: TodayTopicSummary[];
  focus: TodayFocus;
  missions: Array<MissionOverview & { title: string }>;
  recap: WorkspaceRecap;
  nextReview: NextScheduledReview | null;
  totals: TodayProjectionTotals;
}

/**
 * Reads one complete Today snapshot from current workspace evidence. It never writes or repairs
 * state, and it captures one clock value so queue, recap, review, and mission age agree.
 */
export async function projectToday(
  storage: StorageAdapter,
  workspace: Workspace,
  now = new Date(),
): Promise<TodayProjection> {
  const [summaries, recap] = await Promise.all([
    buildTodaySummary(storage, workspace),
    buildWorkspaceRecap(storage, workspace, { now }),
  ]);
  const [focus, missions] = await Promise.all([
    buildTodayFocus(storage, workspace, summaries, now),
    Promise.all(
      summaries
        .filter((summary) => summary.status !== 'complete')
        .map(async (summary) => ({
          ...(await deriveMissionOverview(storage, summary.slug, now)),
          title: summary.title,
        })),
    ),
  ]);
  return {
    focus,
    missions,
    nextReview: nextScheduledReview(summaries, now),
    recap,
    summaries,
    totals: {
      activeTopics: summaries.filter((summary) => summary.status === 'active').length,
      completedObjectives: summaries.reduce(
        (count, summary) => count + summary.progress.completed,
        0,
      ),
      topics: summaries.length,
      totalObjectives: summaries.reduce((count, summary) => count + summary.progress.total, 0),
    },
  };
}
