<script lang="ts">
  import { History } from '@lucide/svelte';

  import type { ResearchRunRecord } from '@dusori/core';
  import { orderedResearchRuns, researchRunQuestion } from '$lib/research-thread';

  export let runs: ResearchRunRecord[] = [];

  let showAll = false;
  $: visible = orderedResearchRuns(runs, showAll);

  function outcomeLabel(outcome: 'empty' | 'failed' | 'found', count: number): string {
    if (outcome === 'found') return `found ${count}`;
    if (outcome === 'empty') return 'nothing matched';
    return 'failed';
  }
</script>

{#if runs.length > 0}
  <section class="research-trail" aria-labelledby="research-trail-title">
    <div class="trail-heading">
      <History aria-hidden="true" size={18} />
      <div>
        <h3 id="research-trail-title">Research trail</h3>
        <p>
          Every scan this topic has run, kept in your workspace. A provider that failed is reported
          as a failure, never as an empty result.
        </p>
      </div>
    </div>

    <ol class="trail-list" aria-label="Research trail runs">
      {#each visible as run (run.at)}
        <li>
          <p class="trail-when">
            <time datetime={run.at}>{run.at.slice(0, 10)} · {run.at.slice(11, 16)}</time>
            <span class="trail-query">“{researchRunQuestion(run)}”</span>
            {#if run.newKeys > 0}<span class="trail-new">{run.newKeys} new</span>{/if}
          </p>
          {#if run.providers.length > 0}
            <ul class="trail-providers">
              {#each run.providers as outcome (outcome.id)}
                <li data-outcome={outcome.outcome}>
                  <strong>{outcome.label}</strong>
                  <span>{outcomeLabel(outcome.outcome, outcome.count)}</span>
                  {#if outcome.message}<small>{outcome.message}</small>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>

    {#if runs.length > 4}
      <button class="trail-toggle" type="button" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Show recent runs only' : `Show all ${runs.length} runs`}
      </button>
    {/if}
  </section>
{/if}

<style>
  .research-trail {
    margin-block-start: var(--space-lg);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .trail-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    color: var(--color-accent-text);
  }

  .trail-heading h3 {
    color: var(--color-ink);
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .trail-heading p {
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .trail-list {
    margin: var(--space-md) 0 0;
    padding: 0;
    list-style: none;
  }

  .trail-list > li {
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .trail-when {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-xs);
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .trail-query {
    color: var(--color-ink);
  }

  .trail-new {
    color: var(--color-accent-text);
  }

  .trail-providers {
    margin: var(--space-2xs) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .trail-providers li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs) var(--space-xs);
    align-items: baseline;
    padding-block: 0.15rem;
  }

  .trail-providers strong {
    font-family: var(--font-display);
    font-weight: 500;
  }

  .trail-providers span {
    color: var(--color-muted);
  }

  .trail-providers small {
    flex-basis: 100%;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .trail-providers li[data-outcome='failed'] span,
  .trail-providers li[data-outcome='failed'] small {
    color: var(--color-accent-text);
  }

  .trail-toggle {
    min-height: 2.75rem;
    margin-block-start: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
