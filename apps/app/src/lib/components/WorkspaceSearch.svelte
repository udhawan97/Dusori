<script lang="ts">
  import { FileText, LoaderCircle, Search } from '@lucide/svelte';

  import { searchWorkspace, type StorageAdapter, type WorkspaceSearchResult } from '@dusori/core';

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;

  let query = '';
  let results: WorkspaceSearchResult[] = [];
  let searched = false;
  let searching = false;
  let error = '';

  async function submit(): Promise<void> {
    if (!query.trim() || searching) return;
    searched = true;
    searching = true;
    error = '';
    try {
      results = await searchWorkspace(storage, query);
    } catch (cause) {
      results = [];
      error = cause instanceof Error ? cause.message : 'The workspace could not be searched.';
    } finally {
      searching = false;
    }
  }
</script>

<section class="workspace-search" aria-labelledby="workspace-search-title">
  <p class="kicker">Local discovery</p>
  <h2 id="workspace-search-title">Search workspace</h2>
  <p class="privacy">
    Markdown and text are read in this session. No index or query leaves Dusori.
  </p>

  <form
    role="search"
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <label for="workspace-search-query">Words to find</label>
    <div class="search-row">
      <input
        id="workspace-search-query"
        type="search"
        bind:value={query}
        autocomplete="off"
        placeholder="contextual weighting"
      />
      <button aria-label="Search local workspace" disabled={!query.trim() || searching}>
        {#if searching}
          <span class="spinner"><LoaderCircle aria-hidden="true" size={18} /></span>
        {:else}
          <Search aria-hidden="true" size={18} />
        {/if}
      </button>
    </div>
  </form>

  <div class="search-status" aria-live="polite">
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else if searched && !searching && results.length === 0}
      <p>No local documents contain every search word.</p>
    {:else if results.length > 0}
      <p>{results.length} {results.length === 1 ? 'result' : 'results'}</p>
    {/if}
  </div>

  {#if results.length > 0}
    <ol aria-label="Workspace search results">
      {#each results as result (result.path)}
        <li>
          <button type="button" onclick={() => onOpen(result.path)}>
            <FileText aria-hidden="true" size={17} />
            <span>
              <strong>{result.title}</strong>
              <small>{result.kind} · {result.path}</small>
              <span class="snippet">{result.snippet}</span>
            </span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .workspace-search {
    display: grid;
    gap: var(--space-sm);
  }

  .kicker,
  h2,
  p {
    margin: 0;
  }

  .kicker {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h2 {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .privacy,
  .search-status {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  form,
  label {
    display: grid;
    gap: var(--space-xs);
  }

  label {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .search-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.75rem;
  }

  input,
  .search-row button,
  li button {
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper);
    color: var(--color-ink);
  }

  input {
    min-width: 0;
    padding-inline: var(--space-sm);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    font: inherit;
  }

  .search-row button {
    display: grid;
    border-inline-start: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    cursor: pointer;
    place-items: center;
  }

  input:focus-visible,
  button:focus-visible {
    z-index: 1;
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .spinner {
    display: grid;
    animation: spin 0.8s linear infinite;
    place-items: center;
  }

  ol {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: grid;
    width: 100%;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-sm);
    padding: var(--space-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: start;
  }

  li button > span {
    min-width: 0;
  }

  strong,
  small,
  .snippet {
    display: block;
  }

  strong {
    font-family: var(--font-display);
  }

  small {
    overflow: hidden;
    margin-block: 0.15rem var(--space-xs);
    color: var(--color-muted);
    font-family: var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .error {
    color: var(--color-error);
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
