<script lang="ts">
  import {
    AlertTriangle,
    CheckCircle2,
    FileText,
    Link2,
    LoaderCircle,
    RefreshCcw,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    backlinksFor,
    inspectWorkspaceHealth,
    type StorageAdapter,
    type WorkspaceHealth,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let currentPath = '';
  export let onOpen: (path: string) => void;

  let health: WorkspaceHealth | null = null;
  let loading = true;
  let error = '';

  async function refresh(): Promise<void> {
    loading = true;
    error = '';
    try {
      health = await inspectWorkspaceHealth(storage);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Workspace health could not be inspected.';
    } finally {
      loading = false;
    }
  }

  function canOpen(path: string): boolean {
    return health?.graph.nodes.some((node) => node.path === path) ?? false;
  }

  onMount(() => void refresh());

  $: backlinks = health && currentPath ? backlinksFor(health.graph, currentPath) : [];
</script>

<section class="workspace-health" aria-labelledby="workspace-health-title" aria-busy={loading}>
  <div class="health-heading">
    <div>
      <p class="kicker">Link integrity</p>
      <h2 id="workspace-health-title">Workspace health</h2>
    </div>
    <button
      class="refresh"
      aria-label="Refresh workspace health"
      disabled={loading}
      onclick={refresh}
    >
      <RefreshCcw aria-hidden="true" size={17} />
    </button>
  </div>

  {#if loading && !health}
    <p class="state">
      <span class="spinner"><LoaderCircle aria-hidden="true" size={18} /></span> Inspecting files…
    </p>
  {:else if error}
    <p class="state error" role="alert"><AlertTriangle aria-hidden="true" size={18} /> {error}</p>
  {:else if health}
    <div class:attention={health.status === 'attention'} class="summary" aria-live="polite">
      {#if health.status === 'healthy'}
        <CheckCircle2 aria-hidden="true" size={19} />
        <span><strong>Healthy</strong> · {health.checkedDocuments} documents checked</span>
      {:else}
        <AlertTriangle aria-hidden="true" size={19} />
        <span
          ><strong>{health.issues.length} {health.issues.length === 1 ? 'issue' : 'issues'}</strong>
          · {health.checkedDocuments} documents checked</span
        >
      {/if}
    </div>

    {#if health.issues.length > 0}
      <ul class="issue-list" aria-label="Workspace health issues">
        {#each health.issues as issue (`${issue.kind}:${issue.path}:${issue.target ?? ''}`)}
          <li>
            {#if canOpen(issue.path)}
              <button type="button" onclick={() => onOpen(issue.path)}>
                <AlertTriangle aria-hidden="true" size={16} />
                <span><strong>{issue.message}</strong><small>{issue.path}</small></span>
              </button>
            {:else}
              <div>
                <AlertTriangle aria-hidden="true" size={16} />
                <span><strong>{issue.message}</strong><small>{issue.path}</small></span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="backlinks">
      <p><Link2 aria-hidden="true" size={16} /> Linked from</p>
      {#if !currentPath}
        <span>Open a document to see its backlinks.</span>
      {:else if backlinks.length === 0}
        <span>No workspace documents link here yet.</span>
      {:else}
        <ul aria-label="Backlinks to current document">
          {#each backlinks as backlink (backlink.id)}
            <li>
              <button type="button" onclick={() => onOpen(backlink.path)}>
                <FileText aria-hidden="true" size={16} />
                <span>{backlink.label}<small>{backlink.path}</small></span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .workspace-health {
    display: grid;
    gap: var(--space-sm);
  }

  .health-heading,
  .summary,
  .state,
  .backlinks > p,
  li button,
  .issue-list li > div {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
  }

  .health-heading {
    justify-content: space-between;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    margin-block-start: var(--space-xs);
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .kicker {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .refresh {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .refresh:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .summary,
  .state {
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    color: var(--color-success);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .summary.attention,
  .state.error {
    color: var(--color-error);
  }

  .spinner {
    display: grid;
    animation: spin 0.8s linear infinite;
    place-items: center;
  }

  .issue-list,
  .backlinks ul {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button,
  .issue-list li > div {
    width: 100%;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    text-align: start;
  }

  li button {
    cursor: pointer;
  }

  li button > span,
  .issue-list li > div > span {
    min-width: 0;
  }

  li strong,
  li small {
    display: block;
  }

  li strong,
  .backlinks li button > span {
    font-size: var(--text-sm);
    font-weight: 700;
    line-height: 1.4;
  }

  li small {
    overflow: hidden;
    margin-block-start: 0.15rem;
    color: var(--color-muted);
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .backlinks {
    display: grid;
    gap: var(--space-xs);
    padding-block-start: var(--space-sm);
  }

  .backlinks > p {
    align-items: center;
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .backlinks > span {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
