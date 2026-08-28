<script lang="ts">
  import { Bell, FileWarning, MessageSquareText, MoveRight } from '@lucide/svelte';

  import {
    readFollowedResearchUpdates,
    type FollowedResearchUpdate,
    type FollowedResearchUpdateEvent,
    type StorageAdapter,
    type Workspace,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let topics: Workspace['topics'] = [];
  export let revision = 0;
  export let onOpenTopic: (topicSlug: string) => void = () => undefined;
  export let onOpenDocument: (path: string) => void = () => undefined;

  let items: FollowedResearchUpdate[] = [];
  let unavailableTopics: string[] = [];
  let error = '';
  let request = 0;

  $: void loadUpdates(storage, topics, revision);

  async function loadUpdates(
    currentStorage: StorageAdapter,
    currentTopics: Workspace['topics'],
    currentRevision: number,
  ): Promise<void> {
    void currentRevision;
    const currentRequest = ++request;
    error = '';
    try {
      const inbox = await readFollowedResearchUpdates(currentStorage, currentTopics);
      if (currentRequest !== request) return;
      items = inbox.items;
      unavailableTopics = inbox.unavailableTopics;
    } catch (caught) {
      if (currentRequest !== request) return;
      items = [];
      unavailableTopics = [];
      error = caught instanceof Error ? caught.message : 'Updates could not be read.';
    }
  }

  function displayDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function eventLabel(item: FollowedResearchUpdateEvent): string {
    const event = item.event;
    if (event.type === 'research-completed') return 'Lookup completed';
    if (event.type === 'source-saved') return 'Source saved';
    if (event.type === 'source-read') return 'Evidence read';
    if (event.type === 'quote-added') return 'Quote saved';
    if (event.type === 'note-added') return 'Source note added';
    if (event.type === 'synthesis-written') return 'Answer updated';
    if (event.type === 'synthesis-proposed') return 'Answer proposal saved';
    if (event.type === 'export-created') return `${event.format.toUpperCase()} export created`;
    if (event.type === 'thread-redacted') return 'Question redacted';
    if (event.type === 'follow-up-created') return 'Follow-up started';
    return 'Question started';
  }

  function eventDetail(item: FollowedResearchUpdateEvent): string {
    if (item.replyState === 'tombstone')
      return 'Replies to earlier activity retained without content.';
    if (item.replyState === 'missing')
      return 'The activity this replied to is no longer available.';
    if (item.artifactState === 'missing') return 'The linked local artifact is missing.';
    if (item.event.type === 'research-completed') {
      return `${item.event.eligibleCount} relevant retained. Discovery history is not evidence.`;
    }
    if (item.event.type === 'note-added') {
      return item.event.quoteSha256
        ? 'A local note preserved an exact source quote.'
        : 'A local interpretation note was linked to its source.';
    }
    return 'Saved local activity.';
  }
</script>

{#if items.length > 0 || error || unavailableTopics.length > 0}
  <section class="updates-inbox" aria-labelledby="updates-inbox-title">
    <header>
      <div>
        <p><Bell aria-hidden="true" size={15} /> Local updates</p>
        <h2 id="updates-inbox-title">Followed research</h2>
      </div>
      <span>{items.length} followed</span>
    </header>
    <p class="inbox-boundary">
      Derived only from saved activity in this workspace. Opening or following never contacts a
      provider, grants consent, or enables refresh.
    </p>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else if items.length > 0}
      <ol class="followed-list">
        {#each items as item (item.threadId)}
          <li>
            <article>
              <header>
                <p>{item.topicTitle}</p>
                <span>{displayDate(item.latestActivityAt)}</span>
              </header>
              <h3>{item.redacted ? 'Redacted question' : item.questionText}</h3>
              {#if item.parentState === 'tombstone'}
                <p class="target-note">
                  Its parent was removed; a question-free tombstone preserves the link.
                </p>
              {:else if item.parentState === 'missing'}
                <p class="target-note">
                  <FileWarning aria-hidden="true" size={14} /> Parent link is unavailable.
                </p>
              {/if}
              {#if item.events.length === 0}
                <p class="no-activity">Following now; no newer local activity yet.</p>
              {:else}
                <ol class="event-list">
                  {#each item.events.slice(0, 3) as activity (activity.event.eventId)}
                    <li>
                      <MessageSquareText aria-hidden="true" size={15} />
                      <div>
                        <strong>{eventLabel(activity)}</strong>
                        <span>{displayDate(activity.event.at)}</span>
                        <p>{eventDetail(activity)}</p>
                        {#if activity.artifactPath && activity.artifactState === 'available'}
                          <button
                            type="button"
                            onclick={() => onOpenDocument(activity.artifactPath!)}
                          >
                            Open artifact <MoveRight aria-hidden="true" size={14} />
                          </button>
                        {/if}
                      </div>
                    </li>
                  {/each}
                </ol>
              {/if}
              <button class="open-topic" type="button" onclick={() => onOpenTopic(item.topicSlug)}>
                Open research <MoveRight aria-hidden="true" size={15} />
              </button>
            </article>
          </li>
        {/each}
      </ol>
    {/if}

    {#if unavailableTopics.length}
      <p class="unavailable" role="status">
        Activity could not be read for {unavailableTopics.join(', ')}. Open that topic for recovery.
      </p>
    {/if}
  </section>
{/if}

<style>
  .updates-inbox {
    display: grid;
    gap: var(--space-sm);
    margin-block: var(--space-xl);
    padding: var(--space-lg);
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
  }

  .updates-inbox > header,
  .followed-list article > header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-xs) var(--space-md);
  }

  .updates-inbox p,
  .updates-inbox h2,
  .updates-inbox h3 {
    margin: 0;
  }

  .updates-inbox > header p {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .updates-inbox h2 {
    margin-block-start: var(--space-2xs);
    font-size: var(--text-lg);
  }

  .updates-inbox > header > span,
  .followed-list article > header span,
  .event-list span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .inbox-boundary,
  .unavailable,
  .target-note,
  .no-activity,
  .event-list p {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .followed-list,
  .event-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .followed-list {
    display: grid;
    gap: var(--space-md);
  }

  .followed-list > li {
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .followed-list article {
    display: grid;
    gap: var(--space-xs);
  }

  .followed-list article > header p {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .followed-list h3 {
    max-width: 42ch;
    overflow-wrap: anywhere;
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .event-list {
    display: grid;
    margin-block-start: var(--space-xs);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .event-list li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-xs);
    padding-block: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .event-list li > div {
    display: grid;
    min-width: 0;
    gap: var(--space-2xs);
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-accent-text);
    cursor: pointer;
    font: inherit;
  }

  .event-list button {
    justify-self: start;
    min-height: 2.35rem;
    margin-block-start: var(--space-2xs);
    font-size: var(--text-sm);
  }

  .open-topic {
    justify-self: start;
    margin-block-start: var(--space-xs);
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 3px;
  }

  .error {
    color: var(--color-error);
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover {
      background: var(--color-paper);
    }
  }

  @media (max-width: 39.99rem) {
    .updates-inbox {
      padding: var(--space-md);
    }
  }
</style>
