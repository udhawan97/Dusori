import { describe, expect, it } from 'vitest';

import {
  boundResearchThreadActivity,
  researchThreadParentState,
  researchThreadReplyState,
  type ResearchThread,
  type ResearchThreadEvent,
} from './thread-events.js';

const threadId = `thread-${'a'.repeat(24)}`;
const at = '2026-08-28T12:00:00.000Z';

function eventId(index: number): string {
  return `event-${index.toString(16).padStart(24, '0')}`;
}

describe('research thread retention targets', () => {
  it('retains a minimal tombstone when compaction removes an event that a live note replies to', () => {
    const identity: ResearchThreadEvent = {
      at,
      eventId: eventId(0),
      questionText: 'How does this work?',
      threadId,
      type: 'question-created',
    };
    const source: ResearchThreadEvent = {
      at,
      eventId: eventId(1),
      readState: 'read',
      sourcePath: 'Topics/example/Sources/items/source.md',
      sourceSha256: 'b'.repeat(64),
      threadId,
      type: 'source-saved',
    };
    const fillers: ResearchThreadEvent[] = Array.from({ length: 498 }, (_item, index) => ({
      at,
      eligibleCount: 0,
      eventId: eventId(index + 2),
      providers: [],
      runAt: at,
      threadId,
      type: 'research-completed',
    }));
    const reply: ResearchThreadEvent = {
      at,
      eventId: eventId(500),
      notePath: 'Topics/example/Notes/source-note.md',
      noteSha256: 'c'.repeat(64),
      replyToEventId: source.eventId,
      sourcePath: 'Topics/example/Sources/items/source.md',
      sourceSha256: 'b'.repeat(64),
      threadId,
      type: 'note-added',
    };

    const bounded = boundResearchThreadActivity(
      [identity, source, ...fillers, reply],
      new Set([threadId]),
    );

    expect(bounded.events).toHaveLength(500);
    expect(bounded.events.some((event) => event.eventId === source.eventId)).toBe(false);
    expect(bounded.eventTombstones).toEqual([
      { at, eventId: source.eventId, reason: 'compacted', threadId },
    ]);
    expect(
      researchThreadReplyState(
        reply,
        new Set(bounded.events.map((event) => event.eventId)),
        bounded.eventTombstones,
      ),
    ).toBe('tombstone');
  });

  it('distinguishes a retained parent tombstone from an actually broken parent target', () => {
    const thread: ResearchThread = {
      createdAt: at,
      outputStyle: 'brief',
      parentThreadId: `thread-${'b'.repeat(24)}`,
      questionText: 'What changed?',
      threadId,
    };

    expect(
      researchThreadParentState(thread, new Set([threadId]), [
        { at, reason: 'deleted', threadId: thread.parentThreadId! },
      ]),
    ).toBe('tombstone');
    expect(researchThreadParentState(thread, new Set([threadId]), [])).toBe('missing');
  });
});
