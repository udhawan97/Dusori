<script lang="ts">
  import { Activity, ArrowUpRight, Link2, Orbit, RefreshCw } from '@lucide/svelte';

  import {
    buildWorkspaceInsights,
    type StorageAdapter,
    type Workspace,
    type WorkspaceInsights,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let workspace: Workspace;
  export let revision = 0;
  export let onOpen: (path: string) => void = () => undefined;
  export let onOpenTopic: (slug: string) => void = () => undefined;

  let insights: WorkspaceInsights | null = null;
  let loading = true;
  let error = '';

  $: void load(revision, storage, workspace);

  $: activityPeak = Math.max(1, ...(insights?.activity.map((point) => point.count) ?? [1]));
  $: providerPeak = Math.max(1, ...(insights?.providers.map((provider) => provider.count) ?? [1]));
  $: tagPeak = Math.max(1, ...(insights?.tags.map((tag) => tag.count) ?? [1]));
  $: orbitStyle = evidenceOrbit(insights);

  async function load(
    _revision: number,
    currentStorage: StorageAdapter,
    currentWorkspace: Workspace,
  ): Promise<void> {
    loading = true;
    error = '';
    try {
      insights = await buildWorkspaceInsights(currentStorage, currentWorkspace);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not read local insights.';
    } finally {
      loading = false;
    }
  }

  function shortDate(date: string): string {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(
      new Date(`${date}T00:00:00.000Z`),
    );
  }

  function evidenceOrbit(value: WorkspaceInsights | null): string {
    if (!value) return 'background: var(--color-paper-2)';
    const total = value.artifactMix.reduce((sum, item) => sum + item.count, 0);
    if (total === 0) return 'background: var(--color-paper-2)';
    const colors = [
      'var(--orbit-foundation)',
      'var(--orbit-note)',
      'var(--orbit-source)',
      'var(--orbit-update)',
    ];
    let cursor = 0;
    const stops = value.artifactMix.map((item, index) => {
      const start = cursor;
      cursor += (item.count / total) * 100;
      return `${colors[index]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    });
    return `background: conic-gradient(${stops.join(', ')})`;
  }

  function relativeWidth(value: number, peak: number): string {
    return `${Math.max(value === 0 ? 0 : 9, (value / peak) * 100)}%`;
  }
</script>

<section class="insights" aria-labelledby="insights-title" aria-busy={loading}>
  <header class="insights-hero">
    <div>
      <p class="kicker">Local evidence · no telemetry</p>
      <h1 id="insights-title">Your learning has a shape.</h1>
      <p>
        These signals come from the files you own: objectives, notes, sources, links, and dated
        updates. Dusori does not estimate study time or invent a score.
      </p>
    </div>
    <button
      aria-label="Refresh local insights"
      disabled={loading}
      onclick={() => void load(revision, storage, workspace)}
    >
      <RefreshCw aria-hidden="true" size={18} />
      Refresh
    </button>
  </header>

  {#if loading}
    <div class="insight-state" role="status">
      <Activity aria-hidden="true" size={22} />
      Reading local learning signals…
    </div>
  {:else if error}
    <div class="insight-state error" role="alert">{error}</div>
  {:else if insights}
    <dl class="signal-strip">
      <div>
        <dt>Objectives complete</dt>
        <dd>{insights.totals.objectiveCompleted}<span>/{insights.totals.objectiveTotal}</span></dd>
      </div>
      <div>
        <dt>Approved sources</dt>
        <dd>{insights.totals.sourceCount}</dd>
      </div>
      <div>
        <dt>Artifacts connected</dt>
        <dd>{insights.totals.connectedArtifactPercent}<span>%</span></dd>
      </div>
      <div>
        <dt>Active days · 14</dt>
        <dd>{insights.totals.activeDays}</dd>
      </div>
    </dl>

    <div class="insight-grid">
      <section class="pulse-panel" aria-labelledby="pulse-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Fourteen-day pulse</p>
            <h2 id="pulse-title">Recorded activity</h2>
          </div>
          <Activity aria-hidden="true" size={25} />
        </div>
        <div class="pulse-chart" role="img" aria-label="Activity recorded over the past 14 days">
          {#each insights.activity as point (point.date)}
            <div class="pulse-column">
              <span
                class:active={point.count > 0}
                style={`height: ${Math.max(point.count === 0 ? 4 : 14, (point.count / activityPeak) * 100)}%`}
                title={`${shortDate(point.date)}: ${point.count} recorded changes`}
              ></span>
              <small>{point.date === insights.activity.at(-1)?.date ? 'Now' : ''}</small>
            </div>
          {/each}
        </div>
        <p class="panel-note">
          A pulse is a dated update entry—not a timer, streak, or surveillance signal.
        </p>
      </section>

      <section class="orbit-panel" aria-labelledby="orbit-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Evidence orbit</p>
            <h2 id="orbit-title">Artifact mix</h2>
          </div>
          <Orbit aria-hidden="true" size={25} />
        </div>
        <div class="orbit-layout">
          <div class="orbit" style={orbitStyle}>
            <div>
              <strong>{insights.totals.artifactCount}</strong>
              <span>artifacts</span>
            </div>
          </div>
          <ul class="orbit-legend">
            {#each insights.artifactMix as item (item.kind)}
              <li class={item.kind}>
                <span></span>
                <strong>{item.label}</strong>
                <small>{item.count}</small>
              </li>
            {/each}
          </ul>
        </div>
        <div class="link-health">
          <Link2 aria-hidden="true" size={17} />
          <span>
            {insights.totals.linkHealthPercent}% link health · {insights.totals.resolvedLinks}
            resolved · {insights.totals.unresolvedLinks} unresolved
          </span>
        </div>
      </section>

      <section class="topic-panel" aria-labelledby="topic-depth-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Topic depth</p>
            <h2 id="topic-depth-title">Where evidence is forming</h2>
          </div>
          <span class="topic-count">{insights.totals.topicCount}</span>
        </div>
        {#if insights.topics.length}
          <ul class="topic-list">
            {#each insights.topics as topic (topic.slug)}
              <li>
                <button onclick={() => onOpenTopic(topic.slug)}>
                  <div>
                    <span class="topic-status">{topic.status}</span>
                    <strong>{topic.title}</strong>
                    <small>
                      {topic.noteCount} notes · {topic.sourceCount} sources · {topic.activityCount}
                      recent changes
                    </small>
                  </div>
                  <div class="topic-progress">
                    <span>{topic.objectivePercent}%</span>
                    <i style={`--progress: ${topic.objectivePercent}%`}></i>
                  </div>
                  <ArrowUpRight aria-hidden="true" size={17} />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">Create a topic to begin shaping this workspace.</p>
        {/if}
      </section>

      <section class="connections-panel" aria-labelledby="connections-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Connection gravity</p>
            <h2 id="connections-title">Most linked artifacts</h2>
          </div>
          <Link2 aria-hidden="true" size={25} />
        </div>
        {#if insights.hubs.length}
          <ol class="hub-list">
            {#each insights.hubs as hub, index (hub.path)}
              <li>
                <button onclick={() => onOpen(hub.path)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{hub.label}</strong>
                    <small>{hub.kind}</small>
                  </div>
                  <b>{hub.connections}</b>
                </button>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty-copy">Add wikilinks between notes to reveal the first knowledge hubs.</p>
        {/if}
      </section>

      <section class="provenance-panel" aria-labelledby="review-pressure-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Review queue</p>
            <h2 id="review-pressure-title">What is due</h2>
          </div>
        </div>
        <ul class="pressure-figures">
          <li><strong>{insights.reviewPressure.overdue}</strong><small>overdue</small></li>
          <li><strong>{insights.reviewPressure.dueToday}</strong><small>due today</small></li>
          <li><strong>{insights.reviewPressure.scheduled}</strong><small>scheduled</small></li>
          <li><strong>{insights.reviewPressure.unscheduled}</strong><small>unscheduled</small></li>
        </ul>
        {#if insights.reviewPressure.upcoming.some((point) => point.count > 0)}
          <ol class="pressure-bars" aria-label="Reviews due over the coming days">
            {#each insights.reviewPressure.upcoming as point (point.date)}
              <li>
                <span
                  class:has-due={point.count > 0}
                  style={`height: ${Math.min(100, point.count * 34 + (point.count ? 16 : 4))}%`}
                  title={`${point.count} due on ${point.date}`}
                ></span>
                <small>{point.date.slice(8)}</small>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="empty-copy">
            Nothing is scheduled in this window. Marking a topic reviewed sets its next date.
          </p>
        {/if}
      </section>

      <section class="provenance-panel" aria-labelledby="provenance-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Provenance</p>
            <h2 id="provenance-title">Source mix</h2>
          </div>
        </div>
        {#if insights.providers.length}
          <ul class="provider-list">
            {#each insights.providers as provider (provider.id)}
              <li>
                <div>
                  <strong>{provider.label}</strong>
                  <small>{provider.count}</small>
                </div>
                <span><i style={`width: ${relativeWidth(provider.count, providerPeak)}`}></i></span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">Approved research sources will appear here by provider.</p>
        {/if}
      </section>

      <section class="provenance-panel" aria-labelledby="tags-title">
        <div class="panel-heading">
          <div>
            <p class="kicker">Vocabulary</p>
            <h2 id="tags-title">Tags</h2>
          </div>
        </div>
        {#if insights.tags.length}
          <ul class="provider-list">
            {#each insights.tags.slice(0, 12) as tag (tag.tag)}
              <li>
                <div>
                  <strong>#{tag.tag}</strong>
                  <small>{tag.count}</small>
                </div>
                <span><i style={`width: ${relativeWidth(tag.count, tagPeak)}`}></i></span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">
            Tags written as <code>#name</code> or in frontmatter will be counted here.
          </p>
        {/if}
      </section>
    </div>
  {/if}
</section>

<style>
  .pressure-figures {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr));
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .pressure-figures li {
    display: grid;
    gap: 0.1rem;
  }

  .pressure-figures strong {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    line-height: 1.1;
  }

  .pressure-figures small,
  .pressure-bars small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .pressure-bars {
    display: grid;
    height: 5rem;
    align-items: end;
    margin: var(--space-sm) 0 0;
    padding: 0;
    gap: 2px;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    list-style: none;
  }

  .pressure-bars li {
    display: grid;
    height: 100%;
    align-content: end;
    gap: 0.15rem;
    justify-items: center;
  }

  .pressure-bars span {
    width: 100%;
    border-radius: 2px;
    background: var(--color-rule);
  }

  .pressure-bars span.has-due {
    background: var(--insight-blue);
  }

  .insights {
    --insight-blue: light-dark(oklch(51% 0.14 250), oklch(72% 0.11 245));
    --insight-mint: light-dark(oklch(53% 0.11 166), oklch(75% 0.1 166));
    --orbit-foundation: var(--color-rule);
    --orbit-note: var(--insight-blue);
    --orbit-source: var(--color-marigold);
    --orbit-update: var(--color-accent);
    width: min(100%, 84rem);
    margin-inline: auto;
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
  }

  .insights-hero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-xl);
    padding-block: var(--space-xl);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .insights-hero > div {
    max-width: 60rem;
  }

  .kicker {
    margin: 0;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  h1 {
    max-width: 14ch;
    margin-block-start: var(--space-md);
    font-size: clamp(2.7rem, 6vw, 6rem);
    letter-spacing: -0.04em;
    line-height: 0.95;
  }

  .insights-hero p:last-child {
    max-width: 62ch;
    margin-block: var(--space-lg) 0;
    color: var(--color-muted);
    font-size: var(--text-md);
  }

  .insights-hero button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
  }

  .signal-strip {
    display: grid;
    margin: 0;
    border-inline: var(--rule-hair) solid var(--color-rule);
  }

  .signal-strip div {
    display: grid;
    min-height: 8.5rem;
    align-content: space-between;
    padding: var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .signal-strip dt {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .signal-strip dd {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2rem, 4vw, 3.8rem);
    line-height: 1;
  }

  .signal-strip dd span {
    color: var(--color-muted);
    font-size: 0.45em;
  }

  .insight-grid {
    display: grid;
    margin-block-start: var(--space-xl);
    gap: var(--space-xl);
  }

  .insight-grid > section {
    min-width: 0;
    padding: var(--space-xl);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .panel-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-lg);
  }

  .panel-heading h2 {
    margin-block-start: var(--space-xs);
    font-size: var(--text-lg);
  }

  .panel-heading > :global(svg) {
    flex: none;
    color: var(--insight-blue);
  }

  .pulse-chart {
    display: grid;
    height: 14rem;
    align-items: end;
    gap: clamp(0.2rem, 1vw, 0.65rem);
    margin-block-start: var(--space-xl);
    padding-block-start: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    grid-template-columns: repeat(14, minmax(0, 1fr));
  }

  .pulse-column {
    display: grid;
    height: 100%;
    align-items: end;
    grid-template-rows: minmax(0, 1fr) 1.4rem;
  }

  .pulse-column > span {
    display: block;
    width: 100%;
    min-height: 4px;
    background: var(--color-rule);
    transition: height var(--dur-long) var(--ease-out);
  }

  .pulse-column > span.active {
    background: linear-gradient(to top, var(--insight-blue), var(--color-marigold));
  }

  .pulse-column small {
    align-self: center;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-align: center;
  }

  .panel-note,
  .empty-copy {
    margin-block: var(--space-md) 0;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .orbit-layout {
    display: grid;
    align-items: center;
    gap: var(--space-xl);
    margin-block-start: var(--space-xl);
  }

  .orbit {
    display: grid;
    width: min(15rem, 64vw);
    aspect-ratio: 1;
    margin-inline: auto;
    border-radius: 50%;
    place-items: center;
    transform: rotate(-26deg);
  }

  .orbit > div {
    display: grid;
    width: 67%;
    aspect-ratio: 1;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 50%;
    background: var(--color-paper-2);
    place-content: center;
    text-align: center;
    transform: rotate(26deg);
  }

  .orbit strong {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    line-height: 1;
  }

  .orbit span,
  .orbit-legend small,
  .topic-list small,
  .hub-list small,
  .provider-list small {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .orbit-legend,
  .topic-list,
  .hub-list,
  .provider-list {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .orbit-legend {
    gap: var(--space-xs);
  }

  .orbit-legend li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-xs);
  }

  .orbit-legend li > span {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--orbit-foundation);
  }

  .orbit-legend .note > span {
    background: var(--orbit-note);
  }

  .orbit-legend .source > span {
    background: var(--orbit-source);
  }

  .orbit-legend .update > span {
    background: var(--orbit-update);
  }

  .link-health {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xl);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .topic-count {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 50%;
    color: var(--color-marigold);
    font-family: var(--font-mono);
    place-items: center;
  }

  .topic-list,
  .hub-list,
  .provider-list {
    gap: var(--space-2xs);
    margin-block-start: var(--space-lg);
  }

  .topic-list button,
  .hub-list button {
    display: grid;
    width: 100%;
    min-height: 4.5rem;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-sm);
    border: var(--rule-hair) solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    text-align: start;
    cursor: pointer;
  }

  .topic-list button {
    grid-template-columns: minmax(0, 1fr) 5rem auto;
  }

  .topic-list button > div:first-child,
  .hub-list button > div {
    display: grid;
    min-width: 0;
  }

  .topic-status {
    color: var(--insight-mint);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .topic-list strong,
  .hub-list strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .topic-progress {
    display: grid;
    gap: var(--space-2xs);
  }

  .topic-progress span {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: end;
  }

  .topic-progress i {
    display: block;
    height: 3px;
    background: linear-gradient(
      to right,
      var(--insight-blue) var(--progress),
      var(--color-rule) var(--progress)
    );
  }

  .hub-list button {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .hub-list button > span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .hub-list b {
    color: var(--color-marigold);
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .provider-list {
    gap: var(--space-md);
  }

  .provider-list li {
    display: grid;
    gap: var(--space-xs);
  }

  .provider-list li > div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .provider-list li > span {
    display: block;
    height: 0.45rem;
    overflow: hidden;
    background: var(--color-rule);
  }

  .provider-list i {
    display: block;
    height: 100%;
    background: linear-gradient(to right, var(--color-marigold), var(--insight-blue));
  }

  .insight-state {
    display: flex;
    min-height: 24rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    color: var(--color-muted);
  }

  .insight-state.error {
    color: var(--color-error);
  }

  @media (hover: hover) and (pointer: fine) {
    .insights-hero button:hover,
    .topic-list button:hover,
    .hub-list button:hover {
      border-color: var(--color-rule);
      background: var(--color-paper);
    }
  }

  @media (max-width: 41.999rem) {
    .insights-hero {
      display: grid;
    }

    .insights-hero button {
      width: 100%;
      justify-content: center;
    }
  }

  @media (min-width: 42rem) {
    .signal-strip {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .signal-strip div:nth-child(even) {
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }

    .orbit-layout {
      grid-template-columns: minmax(12rem, 0.8fr) minmax(10rem, 1fr);
    }
  }

  @media (min-width: 72rem) {
    .signal-strip {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .signal-strip div + div {
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }

    .insight-grid {
      grid-template-columns: repeat(12, minmax(0, 1fr));
    }

    .pulse-panel {
      grid-column: span 7;
    }

    .orbit-panel {
      grid-column: span 5;
    }

    .topic-panel {
      grid-column: span 7;
    }

    .connections-panel {
      grid-column: span 5;
    }

    .provenance-panel {
      grid-column: 8 / span 5;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse-column > span {
      transition: none;
    }
  }
</style>
