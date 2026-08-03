<script lang="ts">
  import { ArrowRight, Telescope } from '@lucide/svelte';

  import { missionLensLabels, missionLenses, type MissionOverview } from '@dusori/core';

  export let missions: Array<MissionOverview & { title: string }> = [];
  export let onOpenResearch: (slug: string) => void = () => undefined;

  function freshness(mission: MissionOverview): string {
    if (!mission.lastRunAt) return 'Never scanned';
    const days = Math.floor(
      (Date.now() - new Date(mission.lastRunAt).getTime()) / (24 * 60 * 60 * 1000),
    );
    if (days <= 0) return 'Refreshed today';
    if (days === 1) return 'Refreshed yesterday';
    return `Refreshed ${days} days ago`;
  }

  function failureNote(mission: MissionOverview): string {
    const failed = (mission.lastRun?.providers ?? []).filter(
      (provider) => provider.outcome === 'failed',
    );
    if (failed.length === 0) return '';
    const names = failed.map((provider) => provider.label).join(', ');
    return `${names} ${failed.length === 1 ? 'failed' : 'failed'} on the last scan — results are incomplete, not empty.`;
  }

  function lensTitle(mission: MissionOverview, lens: (typeof missionLenses)[number]): string {
    const count = mission.lensCounts[lens];
    return `${missionLensLabels[lens]}: ${count} saved ${count === 1 ? 'source' : 'sources'}`;
  }
</script>

{#if missions.length > 0}
  <section class="mission-strip" aria-labelledby="missions-title">
    <div class="mission-heading">
      <Telescope aria-hidden="true" size={22} />
      <div>
        <p class="section-label">Derived from research and source files</p>
        <h2 id="missions-title">Research missions</h2>
      </div>
    </div>
    <p class="mission-explainer">
      What Dusori has looked for, what it found, and what it has actually read. Every number comes
      from files in your workspace.
    </p>

    <ol class="mission-list" aria-label="Research missions">
      {#each missions as mission (mission.topicSlug)}
        <li>
          <div class="mission-copy">
            <strong>{mission.title}</strong>
            <p>
              {mission.discovered} discovered · {mission.savedSources} saved · {mission.readSources}
              read
              {#if mission.claimCount > 0}· {mission.claimCount} quoted{/if}
            </p>
            <small>{freshness(mission)}</small>
            {#if failureNote(mission)}
              <small class="mission-warn">{failureNote(mission)}</small>
            {/if}
            <ul class="lens-dots" aria-label={`Source coverage for ${mission.title}`}>
              {#each missionLenses as lens (lens)}
                <li>
                  <span
                    class:filled={mission.lensCounts[lens] > 0}
                    aria-hidden="true"
                    title={lensTitle(mission, lens)}
                  ></span>
                  <span class="lens-text">{lensTitle(mission, lens)}</span>
                </li>
              {/each}
            </ul>
          </div>
          <button
            class="lane-action"
            aria-label={`Open research — ${mission.title}`}
            onclick={() => onOpenResearch(mission.topicSlug)}
          >
            {mission.lastRunAt ? 'Open research' : 'Start research'}
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/if}

<style>
  .mission-strip {
    margin-block-start: var(--space-xl);
    padding: var(--space-lg);
    border-block: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .mission-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    color: var(--color-accent-text);
  }

  .mission-heading h2 {
    margin-block-start: var(--space-2xs);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .mission-explainer {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .mission-list {
    margin: var(--space-md) 0 0;
    padding: 0;
    list-style: none;
  }

  .mission-list > li {
    display: grid;
    align-items: start;
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .mission-copy strong {
    display: block;
    font-family: var(--font-display);
  }

  .mission-copy p {
    margin-block: var(--space-2xs);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .mission-copy small {
    display: block;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .mission-warn {
    margin-block-start: var(--space-2xs);
    color: var(--color-accent-text);
  }

  .lens-dots {
    display: flex;
    gap: var(--space-xs);
    margin: var(--space-xs) 0 0;
    padding: 0;
    list-style: none;
  }

  .lens-dots > li span:first-child {
    display: block;
    width: 0.6rem;
    height: 0.6rem;
    border: var(--rule-hair) solid var(--color-muted);
    border-radius: 50%;
  }

  .lens-dots > li span.filled {
    border-color: var(--color-accent);
    background: var(--color-accent);
  }

  /* The dots are decoration; the text beside them is what a screen reader announces. */
  .lens-text {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .lane-action {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  @container (max-width: 34rem) {
    .mission-list > li {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
