import type { StorageAdapter } from '../adapters.js';
import type { Workspace } from '../schemas/workspace.js';
import { readResearchFile } from './research-file.js';
import {
  researchThreadParentState,
  researchThreadReplyState,
  type ResearchThread,
  type ResearchThreadEvent,
  type ResearchThreadTargetState,
} from './thread-events.js';

export type ResearchUpdateArtifactState = 'available' | 'missing' | 'none';

export interface FollowedResearchUpdateEvent {
  artifactPath?: string;
  artifactState: ResearchUpdateArtifactState;
  event: ResearchThreadEvent;
  replyState?: ResearchThreadTargetState;
}

export interface FollowedResearchUpdate {
  events: FollowedResearchUpdateEvent[];
  followedAt: string;
  latestActivityAt: string;
  parentState?: ResearchThreadTargetState;
  questionText: string;
  redacted: boolean;
  threadId: string;
  topicSlug: string;
  topicTitle: string;
}

export interface FollowedResearchUpdatesInbox {
  items: FollowedResearchUpdate[];
  unavailableTopics: string[];
}

function artifactPath(event: ResearchThreadEvent): string | undefined {
  if (event.type === 'source-saved' || event.type === 'source-read') return event.sourcePath;
  if (event.type === 'quote-added' || event.type === 'note-added') return event.notePath;
  if (event.type === 'synthesis-written' || event.type === 'synthesis-proposed') {
    return event.artifactPath;
  }
  return undefined;
}

async function projectThreadEvents(
  storage: StorageAdapter,
  thread: ResearchThread,
  events: readonly ResearchThreadEvent[],
  eventTombstones: Parameters<typeof researchThreadReplyState>[2],
): Promise<FollowedResearchUpdateEvent[]> {
  const liveEventIds = new Set(events.map((event) => event.eventId));
  const recent = events
    .filter((event) => event.threadId === thread.threadId && event.at >= thread.followedAt!)
    .slice(-8)
    .reverse();
  return Promise.all(
    recent.map(async (event) => {
      const path = artifactPath(event);
      return {
        ...(path ? { artifactPath: path } : {}),
        artifactState: path ? ((await storage.read(path)) ? 'available' : 'missing') : 'none',
        event,
        ...(researchThreadReplyState(event, liveEventIds, eventTombstones)
          ? { replyState: researchThreadReplyState(event, liveEventIds, eventTombstones)! }
          : {}),
      };
    }),
  );
}

/** Purely derives a local inbox. Reading it never arms refresh, grants consent, or contacts a provider. */
export async function readFollowedResearchUpdates(
  storage: StorageAdapter,
  topics: Workspace['topics'],
  now = new Date(),
): Promise<FollowedResearchUpdatesInbox> {
  const unavailableTopics: string[] = [];
  const items = (
    await Promise.all(
      topics.map(async (topic): Promise<FollowedResearchUpdate[]> => {
        let research;
        try {
          research = await readResearchFile(storage, topic.slug, now);
        } catch {
          unavailableTopics.push(topic.title);
          return [];
        }
        if (!research) return [];
        const threads = research.threads ?? [];
        const liveThreadIds = new Set(threads.map((thread) => thread.threadId));
        return Promise.all(
          threads
            .filter((thread) => Boolean(thread.followedAt))
            .map(async (thread) => {
              const events = await projectThreadEvents(
                storage,
                thread,
                research.events ?? [],
                research.eventTombstones ?? [],
              );
              return {
                events,
                followedAt: thread.followedAt!,
                latestActivityAt: events[0]?.event.at ?? thread.followedAt!,
                ...(researchThreadParentState(
                  thread,
                  liveThreadIds,
                  research.threadTombstones ?? [],
                )
                  ? {
                      parentState: researchThreadParentState(
                        thread,
                        liveThreadIds,
                        research.threadTombstones ?? [],
                      )!,
                    }
                  : {}),
                questionText: thread.questionText,
                redacted: Boolean(thread.redactedAt),
                threadId: thread.threadId,
                topicSlug: topic.slug,
                topicTitle: topic.title,
              };
            }),
        );
      }),
    )
  )
    .flat()
    .sort((left, right) => right.latestActivityAt.localeCompare(left.latestActivityAt));

  return { items, unavailableTopics };
}
