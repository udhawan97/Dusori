<script lang="ts">
  import {
    AlertTriangle,
    ArrowRight,
    CalendarDays,
    Check,
    ListOrdered,
    Pause,
    Play,
    RotateCcw,
  } from '@lucide/svelte';

  import {
    acceptMarkdownUpdate,
    buildTodayFocus,
    buildTodaySummary,
    buildWorkspaceRecap,
    lineDiff,
    markTopicReviewed,
    nextScheduledReview,
    resolvePendingProposal,
    setTopicStatus,
    updateRoadmapObjective,
    type CompanionAiClient,
    type ContinueLearningItem,
    type MarkdownConflict,
    type NeedsAttentionItem,
    type NextScheduledReview,
    type ProposalAttentionItem,
    type ReviewOutcome,
    type StorageAdapter,
    type TodayFocus,
    type TodayTopicSummary,
    type TopicState,
    type Workspace,
    type WorkspaceRecap,
  } from '@dusori/core';

  import ReviewSession from './ReviewSession.svelte';

  export let storage: StorageAdapter;
  export let workspace: Workspace;
  export let topicSlug: string;
  export let view: 'roadmap' | 'today';
  export let revision = 0;
  export let ai: CompanionAiClient | null = null;
  export let onArtifactSaved: () => void = () => undefined;
  export let onOpenProposal: (proposal: ProposalAttentionItem) => void = () => undefined;
  export let onOpenRoadmap: (slug: string) => void = () => undefined;
  export let onOpenResearch: (slug: string) => void = () => undefined;
  export let onOpenTopic: (slug: string) => void = () => undefined;
  export let onOpenWorkspaceHealth: () => void = () => undefined;
  export let onRoadmapChanged: (slug: string, content: string) => void = () => undefined;
  export let onStatus: (message: string) => void = () => undefined;

  let summaries: TodayTopicSummary[] = [];
  let focus: TodayFocus = { continueLearning: [], needsAttention: [] };
  let nextReview: NextScheduledReview | null = null;
  let recap: WorkspaceRecap | null = null;
  let loading = true;
  let workingIndex: number | null = null;
  let reviewWorkingSlug: string | null = null;
  // Per topic, not a single flag: the Today ledger renders one control group per topic, and one
  // in-flight write must not freeze the others. Each writes its own hash-guarded state.json.
  let statusWorkingSlug: string | null = null;
  let error = '';
  let success = '';
  let conflict: MarkdownConflict | null = null;
  let pendingObjective: { completed: boolean; index: number; title: string } | null = null;
  let sessionItem: ContinueLearningItem | null = null;

  $: selected = summaries.find((summary) => summary.slug === topicSlug) ?? null;
  $: activeCount = summaries.filter((summary) => summary.status === 'active').length;
  $: completedObjectives = summaries.reduce(
    (count, summary) => count + summary.progress.completed,
    0,
  );
  $: totalObjectives = summaries.reduce((count, summary) => count + summary.progress.total, 0);
  $: changedRows = conflict
    ? lineDiff(conflict.currentContent, conflict.proposalContent)
        .filter((row) => row.kind !== 'same')
        .slice(0, 60)
    : [];
  $: refreshKey = `${view}:${topicSlug}:${revision}:${workspace.updatedAt}`;
  $: {
    void refreshKey;
    void refresh();
  }

  async function refresh(): Promise<void> {
    loading = true;
    error = '';
    try {
      const [nextSummaries, nextRecap] = await Promise.all([
        buildTodaySummary(storage, workspace),
        buildWorkspaceRecap(storage, workspace),
      ]);
      summaries = nextSummaries;
      focus = await buildTodayFocus(storage, workspace, nextSummaries);
      nextReview = nextScheduledReview(nextSummaries);
      recap = nextRecap;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not read learning progress.';
    } finally {
      loading = false;
    }
  }

  async function toggleObjective(index: number, completed: boolean, title: string): Promise<void> {
    workingIndex = index;
    error = '';
    success = '';
    conflict = null;
    pendingObjective = { completed, index, title };
    try {
      const result = await updateRoadmapObjective(storage, topicSlug, index, completed);
      if (result.status === 'conflict') {
        conflict = result.conflict;
        return;
      }
      pendingObjective = null;
      success = completed ? `Completed “${title}”.` : `Reopened “${title}”.`;
      onRoadmapChanged(topicSlug, result.content);
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not update the roadmap.';
      pendingObjective = null;
    } finally {
      workingIndex = null;
    }
  }

  async function changeStatus(
    topic: TodayTopicSummary,
    status: TopicState['status'],
  ): Promise<void> {
    if (topic.status === status) return;
    statusWorkingSlug = topic.slug;
    error = '';
    success = '';
    try {
      await setTopicStatus(storage, topic.slug, status);
      success =
        status === 'complete'
          ? `“${topic.title}” marked complete.`
          : status === 'paused'
            ? `“${topic.title}” paused.`
            : `“${topic.title}” resumed.`;
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not update topic status.';
    } finally {
      statusWorkingSlug = null;
    }
  }

  async function useProgressProposal(): Promise<void> {
    if (!conflict || !pendingObjective) return;
    workingIndex = pendingObjective.index;
    error = '';
    try {
      await acceptMarkdownUpdate(
        storage,
        topicSlug,
        'roadmap.md',
        conflict.proposalContent,
        conflict.currentContentHash,
        new Date(),
        `- ${pendingObjective.completed ? 'Completed' : 'Reopened'} “${pendingObjective.title}” in [[../../../roadmap]] after reviewing an external edit.`,
        conflict.proposalPath,
      );
      const content = conflict.proposalContent;
      success = 'Progress choice accepted after your review.';
      conflict = null;
      pendingObjective = null;
      onStatus(success);
      onRoadmapChanged(topicSlug, content);
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not accept this progress.';
    } finally {
      workingIndex = null;
    }
  }

  async function keepExternalRoadmap(): Promise<void> {
    if (!conflict) return;
    error = '';
    try {
      await resolvePendingProposal(storage, topicSlug, conflict.proposalPath, 'kept');
      conflict = null;
      pendingObjective = null;
      success = 'External roadmap kept. Progress was reloaded.';
      onStatus(success);
      await refresh();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not resolve this proposal.';
    }
  }

  async function markReviewed(item: ContinueLearningItem, outcome: ReviewOutcome): Promise<void> {
    reviewWorkingSlug = item.slug;
    error = '';
    success = '';
    try {
      const schedule = await markTopicReviewed(storage, item.slug, outcome);
      success =
        outcome === 'good'
          ? `Reviewed “${item.title}”. The next review is ${activityDate(schedule.dueOn)}.`
          : `Reviewed “${item.title}”. It returns tomorrow.`;
      await refresh();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'Dusori could not record this review.';
      // markTopicReviewed may have already written the schedule and only
      // failed on the update-log append, so the queue can be stale here.
      // Refresh so it reflects what was actually persisted — otherwise the
      // natural next click double-applies the outcome. refresh() resets
      // `error` at its own start, so set the message after it settles, and
      // guard the call itself so a refresh failure can't escape this catch.
      await refresh().catch(() => undefined);
      error = message;
    } finally {
      reviewWorkingSlug = null;
      // The session exists to prompt one rating. It is over either way, and any failure belongs
      // in the queue's own feedback line rather than behind a dialog.
      sessionItem = null;
    }
  }

  /**
   * The objective a session should test: the topic's next unfinished one, falling back to the
   * queue's own wording when a roadmap has no objectives left to work on.
   */
  function sessionObjective(item: ContinueLearningItem): string {
    const summary = summaries.find((entry) => entry.slug === item.slug);
    return summary?.progress.nextObjective?.title ?? item.objective;
  }

  function activityDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
      new Date(`${value}T12:00:00`),
    );
  }

  function continueActionLabel(item: ContinueLearningItem): string {
    if (item.action === 'start-review') return 'Start review';
    if (item.action === 'research-objective') return 'Research objective';
    if (item.action === 'open-topic') return 'Open topic';
    return 'Open roadmap';
  }

  function continueFrom(item: ContinueLearningItem): void {
    if (item.action === 'start-review') {
      sessionItem = item;
      return;
    }
    if (item.action === 'research-objective') {
      onOpenResearch(item.slug);
      return;
    }
    if (item.action === 'open-topic') {
      onOpenTopic(item.slug);
      return;
    }
    onOpenRoadmap(item.slug);
  }

  function startReview(item: ContinueLearningItem): void {
    sessionItem = item;
  }

  function inspectAttention(item: NeedsAttentionItem): void {
    if (item.action === 'review-proposal') onOpenProposal(item);
    else onOpenWorkspaceHealth();
  }
</script>

<!--
  One control group, two call sites: the roadmap acts on the single topic in view, while the
  Today ledger renders one group per topic. `qualify` only changes accessible naming — on Today
  three identically-labelled buttons per card would otherwise be indistinguishable by name.
-->
{#snippet statusControls(topic: TodayTopicSummary, qualify: boolean)}
  <div
    class="status-controls"
    role="group"
    aria-label={qualify ? `Topic status — ${topic.title}` : 'Topic status'}
  >
    <button
      aria-label={qualify ? `Active — ${topic.title}` : undefined}
      aria-pressed={topic.status === 'active'}
      disabled={statusWorkingSlug === topic.slug}
      onclick={() => void changeStatus(topic, 'active')}
    >
      <Play aria-hidden="true" size={15} /> Active
    </button>
    <button
      aria-label={qualify ? `Paused — ${topic.title}` : undefined}
      aria-pressed={topic.status === 'paused'}
      disabled={statusWorkingSlug === topic.slug}
      onclick={() => void changeStatus(topic, 'paused')}
    >
      <Pause aria-hidden="true" size={15} /> Paused
    </button>
    <button
      aria-label={qualify ? `Complete — ${topic.title}` : undefined}
      aria-pressed={topic.status === 'complete'}
      disabled={statusWorkingSlug === topic.slug}
      onclick={() => void changeStatus(topic, 'complete')}
    >
      <Check aria-hidden="true" size={15} /> Complete
    </button>
  </div>
{/snippet}

<section class="learning-loop" aria-busy={loading} aria-labelledby="learning-loop-title">
  {#if view === 'today'}
    <header class="page-heading">
      <p class="kicker">Local learning loop</p>
      <h1 id="learning-loop-title">Today</h1>
      <p>
        Continue from the next unfinished objective. This view is derived from your roadmap, topic
        state, and dated update files.
      </p>
    </header>

    <dl class="today-ledger" aria-label="Workspace progress summary">
      <div>
        <dt>Active topics</dt>
        <dd>{activeCount}</dd>
      </div>
      <div>
        <dt>Objectives complete</dt>
        <dd>{completedObjectives} / {totalObjectives}</dd>
      </div>
      <div>
        <dt>Storage</dt>
        <dd>Local</dd>
      </div>
    </dl>

    {#if loading}
      <div class="loading-state" role="status">
        <span></span><span></span><span></span>
        <p>Reading local progress…</p>
      </div>
    {:else if summaries.length === 0}
      <div class="empty-state">
        <h2>No topics yet.</h2>
        <p>Create a topic to start a durable learning loop.</p>
      </div>
    {:else}
      <div class="today-lanes">
        <section class="focus-lane continue-lane" aria-labelledby="continue-learning-title">
          <div class="focus-heading">
            <ListOrdered aria-hidden="true" size={22} />
            <div>
              <p class="section-label">Explicit local state</p>
              <h2 id="continue-learning-title">Continue learning</h2>
            </div>
          </div>
          <p class="focus-explainer">
            Due reviews lead, followed by active topics least recently updated. Dusori routes the
            next step without changing progress.
          </p>
          {#if focus.continueLearning.length === 0}
            {#if nextReview}
              <p class="focus-empty">
                Nothing needs continuing now. “{nextReview.title}” returns on {activityDate(
                  nextReview.dueOn,
                )}.
              </p>
            {:else}
              <p class="focus-empty">No unfinished active or paused topics.</p>
            {/if}
          {:else}
            <ol class="focus-list" aria-label="Continue learning">
              {#each focus.continueLearning as item, index (item.slug)}
                <li>
                  <span class="queue-rank">{String(index + 1).padStart(2, '0')}</span>
                  <div class="focus-copy">
                    <strong>{item.title}</strong>
                    <p>{item.objective}</p>
                    <small
                      >{item.reason} · {item.progressPercent}% complete · {item.sourceDetail}</small
                    >
                  </div>
                  <div class="lane-actions">
                    <button
                      class="lane-action"
                      aria-label={`${continueActionLabel(item)} — ${item.title}`}
                      disabled={reviewWorkingSlug !== null}
                      onclick={() => continueFrom(item)}
                    >
                      {continueActionLabel(item)}
                      <ArrowRight aria-hidden="true" size={16} />
                    </button>
                    {#if item.canStartReview && item.action !== 'start-review'}
                      <button
                        class="lane-action secondary-review"
                        aria-label={`Start review — ${item.title}`}
                        disabled={reviewWorkingSlug !== null}
                        onclick={() => startReview(item)}
                      >
                        Start review
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ol>
          {/if}
        </section>

        <section
          class:clear={focus.needsAttention.length === 0}
          class="focus-lane attention-lane"
          aria-labelledby="needs-attention-title"
        >
          <div class="focus-heading">
            <AlertTriangle aria-hidden="true" size={22} />
            <div>
              <p class="section-label">Proven workspace evidence</p>
              <h2 id="needs-attention-title">Needs attention</h2>
            </div>
          </div>
          <p class="focus-explainer">
            Integrity issues lead. Link hygiene stays secondary and never blocks learning.
          </p>
          {#if focus.needsAttention.length === 0}
            <p class="focus-empty clear-state">
              No local evidence needs a decision. This is a current check, not a promise about
              future changes.
            </p>
          {:else}
            <ol class="focus-list attention-list" aria-label="Needs attention">
              {#each focus.needsAttention as item, index (`${item.kind}-${item.title}-${index}`)}
                <li>
                  <span class="attention-mark" data-priority={item.priority} aria-hidden="true"
                  ></span>
                  <div class="focus-copy">
                    <small>{item.priority === 'integrity' ? 'Integrity' : 'Hygiene'}</small>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <button
                    class="lane-action"
                    aria-label={`${item.action === 'review-proposal' ? 'Review proposal' : 'Inspect workspace health'} — ${item.title}`}
                    onclick={() => inspectAttention(item)}
                  >
                    {item.action === 'review-proposal'
                      ? 'Review proposal'
                      : `Inspect ${item.count} ${item.count === 1 ? 'issue' : 'issues'}`}
                    <ArrowRight aria-hidden="true" size={16} />
                  </button>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      </div>

      <section class="workspace-recap" aria-labelledby="workspace-recap-title">
        <div class="focus-heading">
          <CalendarDays aria-hidden="true" size={22} />
          <div>
            <p class="section-label">Dated update files</p>
            <h2 id="workspace-recap-title">7-day recap</h2>
          </div>
        </div>
        {#if recap}
          <p class="focus-explainer">
            {recap.entries.length}
            {recap.entries.length === 1 ? 'event' : 'events'} across
            {recap.topicsTouched}
            {recap.topicsTouched === 1 ? 'topic' : 'topics'}.
          </p>
          {#if recap.entries.length === 0}
            <p class="focus-empty">No update entries in this date range.</p>
          {:else}
            <ul aria-label="Workspace recap">
              {#each recap.entries as entry, index (`${index}-${entry.slug}-${entry.date}-${entry.text}`)}
                <li>
                  <time datetime={entry.date}>{activityDate(entry.date)}</time>
                  <span><strong>{entry.title}</strong>{entry.text}</span>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </section>

      <div class="topic-ledger">
        {#each summaries as summary (summary.slug)}
          <article class:muted={summary.status !== 'active'}>
            <div class="topic-heading">
              <div>
                <p class="status-label">{summary.status}</p>
                <h2>{summary.title}</h2>
              </div>
              <p class="progress-number">
                <strong>{summary.progress.percent}%</strong>
                <span>{summary.progress.completed} of {summary.progress.total}</span>
              </p>
            </div>
            <progress
              max="100"
              value={summary.progress.percent}
              aria-label={`${summary.title}: ${summary.progress.percent}% complete`}
            ></progress>

            <div class="next-step">
              <p class="section-label">Next objective</p>
              <p>
                {summary.progress.nextObjective?.title ??
                  (summary.progress.total
                    ? 'All roadmap objectives are complete.'
                    : 'Add a checklist item to the roadmap.')}
              </p>
              <button class="text-action" onclick={() => onOpenRoadmap(summary.slug)}>
                Open roadmap <ArrowRight aria-hidden="true" size={16} />
              </button>
            </div>

            <div class="topic-status">
              <p class="section-label">Topic status</p>
              {@render statusControls(summary, true)}
            </div>

            {#if summary.recentActivity.length}
              <div class="recent-activity">
                <p class="section-label">Recent local activity</p>
                <ul>
                  <!-- Keyed by position too: the update log legitimately repeats a line when the
                       same action happens twice in one day, and duplicate keys break the view. -->
                  {#each summary.recentActivity as activity, index (`${index}-${activity.date}-${activity.text}`)}
                    <li>
                      <time datetime={activity.date}>{activityDate(activity.date)}</time>
                      <span>{activity.text}</span>
                    </li>
                  {/each}
                </ul>
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  {:else}
    <header class="page-heading">
      <p class="kicker">Topic roadmap</p>
      <h1 id="learning-loop-title">{selected?.title ?? 'Roadmap'}</h1>
      <p>Check off real Markdown tasks. Each change is hash-guarded and added to the update log.</p>
    </header>

    {#if loading}
      <div class="loading-state" role="status">
        <span></span><span></span><span></span>
        <p>Reading roadmap…</p>
      </div>
    {:else if selected}
      <div class="roadmap-meta">
        <div>
          <p class="section-label">Topic status</p>
          {@render statusControls(selected, false)}
        </div>
        <p class="progress-number">
          <strong>{selected.progress.percent}%</strong>
          <span>{selected.progress.completed} of {selected.progress.total}</span>
        </p>
      </div>

      <progress
        max="100"
        value={selected.progress.percent}
        aria-label={`${selected.title}: ${selected.progress.percent}% complete`}
      ></progress>

      {#if conflict}
        <section class="conflict-state" aria-labelledby="roadmap-conflict-title">
          <div class="conflict-heading">
            <AlertTriangle aria-hidden="true" size={22} />
            <div>
              <p class="kicker">External edit protected</p>
              <h2 id="roadmap-conflict-title">The roadmap changed outside Dusori.</h2>
            </div>
          </div>
          <p>
            Your external file is still active. Dusori wrote this progress choice beside it for
            review.
          </p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
          <div
            class="roadmap-diff"
            role="region"
            aria-label="Progress proposal changes"
            tabindex="0"
          >
            {#each changedRows as row, index (`${index}-${row.kind}`)}
              <div class:added={row.kind === 'add'} class:removed={row.kind === 'remove'}>
                <span aria-hidden="true">{row.kind === 'add' ? '+' : '−'}</span>
                <code>{row.line || ' '}</code>
              </div>
            {/each}
          </div>
          <div class="conflict-actions">
            <button class="quiet-action" onclick={keepExternalRoadmap}>Keep external roadmap</button
            >
            <button class="primary-action" onclick={useProgressProposal}>
              Use this progress choice
            </button>
          </div>
        </section>
      {:else if selected.progress.objectives.length}
        <fieldset class="objective-list" disabled={workingIndex !== null}>
          <legend>Roadmap objectives</legend>
          {#each selected.progress.entries as entry, entryIndex (`${entry.kind}-${entryIndex}-${entry.title}`)}
            {#if entry.kind === 'section'}
              <div
                class="objective-section"
                style={`--objective-depth: ${Math.min(entry.depth, 3)}`}
              >
                {entry.title}
              </div>
            {:else}
              <label style={`--objective-depth: ${Math.min(entry.depth, 3)}`}>
                <input
                  type="checkbox"
                  checked={entry.completed}
                  onchange={(event) =>
                    toggleObjective(
                      entry.index,
                      (event.currentTarget as HTMLInputElement).checked,
                      entry.title,
                    )}
                />
                <span class:completed={entry.completed}>{entry.title}</span>
                {#if workingIndex === entry.index}<small>Saving…</small>{/if}
              </label>
            {/if}
          {/each}
        </fieldset>
      {:else}
        <div class="empty-state">
          <RotateCcw aria-hidden="true" size={22} />
          <h2>No checklist items found.</h2>
          <p>
            Add Markdown tasks such as <code>- [ ] Read chapter one</code>, then reopen Roadmap.
          </p>
        </div>
      {/if}

      {#if selected.progress.total > 0 && selected.progress.completed === selected.progress.total}
        <div class="complete-state">
          <Check aria-hidden="true" size={19} />
          <p>Every roadmap objective is complete. Mark the topic complete when it feels durable.</p>
        </div>
      {/if}
    {/if}
  {/if}

  <div class="feedback" aria-live="polite">
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if success}<p class="success">{success}</p>{/if}
  </div>
</section>

{#if sessionItem}
  <ReviewSession
    {ai}
    {storage}
    objective={sessionObjective(sessionItem)}
    rating={reviewWorkingSlug === sessionItem.slug}
    topicSlug={sessionItem.slug}
    topicTitle={sessionItem.title}
    onClose={() => (sessionItem = null)}
    onNoteSaved={onArtifactSaved}
    onRate={(outcome) => {
      if (sessionItem) void markReviewed(sessionItem, outcome);
    }}
  />
{/if}

<style>
  /* Hallmark · component: learning loop · genre: editorial utility · theme: inherited custom
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass · pre-emit critique: P5 H5 E5 S5 R5 V4
   */
  .learning-loop {
    width: min(100%, 58rem);
    margin-inline: auto;
    padding: var(--space-2xl) var(--page-gutter) var(--space-3xl);
  }

  h1,
  h2,
  p,
  dl,
  dd {
    margin: 0;
  }

  h1,
  h2 {
    font-family: var(--font-display);
    font-style: normal;
    line-height: 1.12;
  }

  .page-heading h1 {
    max-width: 14ch;
    margin-block-start: var(--space-xs);
    font-size: clamp(2.4rem, 7vw, 4.75rem);
  }

  .page-heading > p:last-child {
    max-width: 68ch;
    margin-block-start: var(--space-md);
    color: var(--color-muted);
    font-size: var(--text-md);
    line-height: 1.55;
  }

  .kicker,
  .section-label,
  .status-label {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .today-ledger {
    display: grid;
    margin-block-start: var(--space-2xl);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .today-ledger div {
    display: flex;
    min-height: 3.75rem;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .today-ledger div:last-child {
    border-block-end: 0;
  }

  .today-ledger dt {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .today-ledger dd,
  .progress-number strong {
    font-family: var(--font-mono);
  }

  .topic-ledger {
    margin-block-start: var(--space-2xl);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .today-lanes {
    display: grid;
    overflow: hidden;
    border-block: var(--rule-hair) solid var(--color-rule);
    background:
      linear-gradient(var(--color-rule), var(--color-rule)) center / var(--rule-hair) 100% no-repeat,
      var(--color-paper-2);
    grid-template-columns: minmax(0, 1.1fr) minmax(18rem, 0.9fr);
    margin-block-start: var(--space-2xl);
  }

  .focus-lane,
  .workspace-recap {
    min-width: 0;
    padding: var(--space-lg);
  }

  .focus-lane {
    position: relative;
  }

  .focus-lane::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0.2rem;
    background: var(--color-marigold);
    content: '';
  }

  .attention-lane::before {
    background: var(--color-accent);
  }

  .attention-lane.clear::before {
    background: var(--color-success);
  }

  .workspace-recap {
    margin-block-start: var(--space-xl);
    border-block: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .focus-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    color: var(--color-accent-text);
  }

  .focus-heading h2 {
    margin-block-start: var(--space-2xs);
    color: var(--color-ink);
    font-size: var(--text-lg);
  }

  .focus-explainer,
  .focus-empty {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .focus-list,
  .workspace-recap ul {
    margin: var(--space-md) 0 0;
    padding: 0;
    list-style: none;
  }

  .focus-list li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .queue-rank,
  .focus-list small,
  .workspace-recap time {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .focus-list li strong,
  .workspace-recap li strong {
    display: block;
    font-family: var(--font-display);
  }

  .focus-list li p {
    margin-block: var(--space-2xs);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .lane-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    border-color: var(--color-accent-text);
    font-weight: 700;
  }

  .lane-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2xs);
  }

  .secondary-review {
    border-color: var(--color-rule);
    color: var(--color-muted);
  }

  .attention-mark {
    width: 0.5rem;
    height: 0.5rem;
    margin-block-start: 0.35rem;
    border-radius: 50%;
    background: var(--color-accent);
  }

  .attention-mark[data-priority='hygiene'] {
    background: var(--color-muted);
  }

  .clear-state {
    padding-block: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .workspace-recap li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: var(--space-sm);
    padding-block: var(--space-xs);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .topic-ledger article {
    padding-block: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .topic-ledger article.muted {
    background: var(--color-paper-2);
  }

  .topic-heading,
  .roadmap-meta,
  .conflict-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-lg);
  }

  .topic-heading h2 {
    margin-block-start: var(--space-2xs);
    font-size: var(--text-xl);
  }

  .progress-number {
    display: grid;
    flex: none;
    text-align: end;
  }

  .progress-number strong {
    font-size: var(--text-md);
  }

  .progress-number span {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  progress {
    width: 100%;
    height: 0.3rem;
    margin-block-start: var(--space-md);
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: var(--color-rule);
    color: var(--color-accent);
  }

  progress::-webkit-progress-bar {
    background: var(--color-rule);
  }

  progress::-webkit-progress-value {
    background: var(--color-accent);
  }

  progress::-moz-progress-bar {
    background: var(--color-accent);
  }

  .next-step,
  .recent-activity,
  .topic-status {
    margin-block-start: var(--space-lg);
  }

  .topic-status .status-controls {
    margin-block-start: var(--space-xs);
  }

  .next-step > p:nth-child(2) {
    max-width: 68ch;
    margin-block-start: var(--space-xs);
    font-size: var(--text-md);
    line-height: 1.45;
  }

  button {
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    font: inherit;
    cursor: pointer;
  }

  button:focus-visible,
  input:focus-visible {
    outline-color: var(--color-focus);
  }

  button:disabled,
  fieldset:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .objective-list:disabled label {
    cursor: not-allowed;
  }

  .text-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-sm);
    padding-inline: 0;
    border-color: transparent;
    background: transparent;
    color: var(--color-accent-text);
    font-weight: 700;
  }

  .recent-activity ul {
    margin: var(--space-xs) 0 0;
    padding: 0;
    list-style: none;
  }

  .recent-activity li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    gap: var(--space-sm);
    padding-block: var(--space-xs);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .recent-activity time {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .roadmap-meta {
    align-items: flex-end;
    margin-block-start: var(--space-2xl);
    padding-block: var(--space-md);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .status-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
  }

  .status-controls button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    padding-inline: var(--space-sm);
    background: var(--color-paper);
    color: var(--color-muted);
  }

  .status-controls button[aria-pressed='true'] {
    border-color: var(--color-accent-text);
    background: var(--color-paper-2);
    color: var(--color-accent-text);
    font-weight: 700;
  }

  .objective-list {
    min-width: 0;
    margin: var(--space-2xl) 0 0;
    padding: 0;
    border: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .objective-list legend {
    width: 100%;
    padding: 0 0 var(--space-sm);
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .objective-list label {
    display: grid;
    min-height: 3.5rem;
    grid-template-columns: 1.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    padding-inline-start: calc(var(--objective-depth) * var(--space-lg));
    border-block-end: var(--rule-hair) solid var(--color-rule);
    cursor: pointer;
    line-height: 1.45;
  }

  .objective-section {
    padding-block: var(--space-md) var(--space-xs);
    padding-inline-start: calc(var(--objective-depth) * var(--space-lg));
    border-block-end: var(--rule-hair) solid var(--color-rule);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .objective-list input {
    width: 1.25rem;
    height: 1.25rem;
    margin: 0;
    accent-color: var(--color-accent);
  }

  .objective-list .completed {
    color: var(--color-muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }

  .objective-list small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .conflict-state,
  .empty-state,
  .complete-state {
    margin-block-start: var(--space-2xl);
    padding: var(--space-lg);
    border-block: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .conflict-heading {
    justify-content: flex-start;
    color: var(--color-accent-text);
  }

  .conflict-heading h2,
  .empty-state h2 {
    margin-block-start: var(--space-2xs);
    color: var(--color-ink);
    font-size: var(--text-lg);
  }

  .conflict-state > p,
  .empty-state p {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    line-height: 1.5;
  }

  .roadmap-diff {
    max-height: 16rem;
    margin-block-start: var(--space-md);
    overflow: auto;
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper);
  }

  .roadmap-diff:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .roadmap-diff div {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr);
    gap: var(--space-xs);
    padding: var(--space-2xs) var(--space-xs);
  }

  .roadmap-diff .added {
    color: var(--color-success);
  }

  .roadmap-diff .removed {
    color: var(--color-error);
  }

  .roadmap-diff code {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .conflict-actions {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: var(--space-md);
  }

  .primary-action,
  .quiet-action {
    padding-inline: var(--space-sm);
  }

  .primary-action {
    background: var(--color-ink);
    color: var(--color-paper);
    font-weight: 700;
  }

  .text-action:active,
  .status-controls button:active,
  .primary-action:active,
  .quiet-action:active {
    transform: translateY(1px);
  }

  .quiet-action {
    background: var(--color-paper);
    color: var(--color-accent-text);
  }

  .complete-state {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    color: var(--color-success);
  }

  .complete-state p {
    color: var(--color-ink);
  }

  .loading-state {
    display: grid;
    gap: var(--space-sm);
    margin-block-start: var(--space-2xl);
  }

  .loading-state span {
    height: 0.75rem;
    background: var(--color-rule);
  }

  .loading-state span:nth-child(2) {
    width: 72%;
  }

  .loading-state span:nth-child(3) {
    width: 48%;
  }

  .loading-state p,
  .feedback {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .feedback {
    min-height: 1.5rem;
    margin-block-start: var(--space-md);
  }

  .feedback .error {
    color: var(--color-error);
  }

  .feedback .success {
    color: var(--color-success);
  }

  @media (hover: hover) and (pointer: fine) {
    .text-action:hover {
      color: var(--color-ink);
    }

    .status-controls button:hover,
    .quiet-action:hover {
      background: var(--color-paper-2);
      color: var(--color-ink);
    }

    .primary-action:hover {
      background: var(--color-accent-text);
    }

    .objective-list label:hover {
      background: var(--color-paper-2);
    }
  }

  @media (max-width: 50rem) {
    .today-lanes {
      background: var(--color-paper-2);
      grid-template-columns: minmax(0, 1fr);
    }

    .focus-lane + .focus-lane {
      border-block-start: var(--rule-hair) solid var(--color-rule);
    }
  }

  @media (min-width: 40rem) {
    .today-ledger {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .today-ledger div {
      display: grid;
      align-content: center;
      padding-inline: var(--space-md);
      border-block-end: 0;
      border-inline-end: var(--rule-hair) solid var(--color-rule);
    }

    .today-ledger div:first-child {
      padding-inline-start: 0;
    }

    .today-ledger div:last-child {
      padding-inline-end: 0;
      border-inline-end: 0;
    }

    .conflict-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 25rem) {
    .roadmap-meta,
    .topic-heading {
      display: grid;
    }

    .progress-number {
      text-align: start;
    }

    .objective-list label {
      padding-inline-start: calc(var(--objective-depth) * var(--space-sm));
    }

    .focus-list li {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .focus-list .lane-actions,
    .focus-list > li > .lane-action {
      grid-column: 2;
      justify-self: start;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      scroll-behavior: auto !important;
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
