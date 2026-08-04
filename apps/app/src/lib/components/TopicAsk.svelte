<script lang="ts">
  import { ArrowRight, Search, X } from '@lucide/svelte';

  import type { StorageAdapter } from '@dusori/core';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let onOpen: (path: string) => void;

  type LocalMatch = { path: string; title: string; excerpt: string };

  let query = '';
  let submittedQuery = '';
  let results: LocalMatch[] = [];
  let searching = false;
  let open = false;
  let error = '';

  function titleFrom(path: string, content: string): string {
    const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
    return (
      heading ||
      path
        .split('/')
        .at(-1)
        ?.replace(/\.(?:md|txt)$/iu, '') ||
      path
    );
  }

  function excerptAround(content: string, needle: string): string {
    const plain = content
      .replace(/^#{1,6}\s+/gmu, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/\s+/gu, ' ')
      .trim();
    const index = plain.toLocaleLowerCase().indexOf(needle);
    const start = Math.max(0, index - 72);
    const excerpt = plain.slice(start, start + 220);
    return `${start > 0 ? '…' : ''}${excerpt}${start + 220 < plain.length ? '…' : ''}`;
  }

  async function searchTopic(): Promise<void> {
    const term = query.trim();
    if (!term) return;
    searching = true;
    error = '';
    submittedQuery = term;
    try {
      const entries = await storage.list(`Topics/${topicSlug}`, true);
      const needle = term.toLocaleLowerCase();
      const matches: LocalMatch[] = [];
      for (const entry of entries) {
        if (entry.kind !== 'file' || !/\.(?:md|txt)$/iu.test(entry.path)) continue;
        const file = await storage.read(entry.path);
        if (!file || !file.content.toLocaleLowerCase().includes(needle)) continue;
        matches.push({
          excerpt: excerptAround(file.content, needle),
          path: entry.path,
          title: titleFrom(entry.path, file.content),
        });
        if (matches.length === 8) break;
      }
      results = matches;
    } catch (caught) {
      results = [];
      error = caught instanceof Error ? caught.message : 'Dusori could not search this topic.';
    } finally {
      searching = false;
    }
  }

  function closeResults(): void {
    open = false;
    query = '';
    submittedQuery = '';
    results = [];
    error = '';
  }
</script>

<section class:open class="topic-ask" aria-label={`Ask inside ${topicTitle}`}>
  <form
    role="search"
    onsubmit={(event) => {
      event.preventDefault();
      open = true;
      void searchTopic();
    }}
  >
    <Search aria-hidden="true" size={17} strokeWidth={1.6} />
    <label class="sr-only" for="topic-question">Ask inside {topicTitle}</label>
    <input
      id="topic-question"
      type="search"
      bind:value={query}
      placeholder={`Ask inside ${topicTitle}`}
      autocomplete="off"
    />
    <button type="submit" disabled={searching || !query.trim()}>
      <span>{searching ? 'Searching…' : 'Search local notes'}</span>
      <ArrowRight aria-hidden="true" size={16} />
    </button>
  </form>

  {#if open}
    <div class="answer" aria-live="polite">
      <div class="answer-heading">
        <div>
          <p>Local answer trail</p>
          <strong>{submittedQuery}</strong>
        </div>
        <button class="close" aria-label="Close local search results" onclick={closeResults}>
          <X aria-hidden="true" size={18} />
        </button>
      </div>
      {#if error}
        <p class="message error" role="alert">{error}</p>
      {:else if searching}
        <p class="message">Searching this topic on your device…</p>
      {:else if results.length === 0}
        <p class="message">
          No saved note or source contains that phrase. Try fewer words, or find a new source.
        </p>
      {:else}
        <ol aria-label="Local topic matches">
          {#each results as result (result.path)}
            <li>
              <button onclick={() => onOpen(result.path)}>
                <strong>{result.title}</strong>
                <span>{result.excerpt}</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
      <p class="privacy">No model was called and no question history was saved.</p>
    </div>
  {/if}
</section>

<style>
  .topic-ask {
    position: sticky;
    z-index: calc(var(--z-sticky) - 1);
    top: 4.5rem;
    padding: var(--space-xs) var(--page-gutter);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    background: color-mix(in srgb, var(--color-paper) 96%, transparent);
    backdrop-filter: blur(12px);
  }

  form {
    display: grid;
    width: min(100%, 58rem);
    min-height: 2.75rem;
    align-items: center;
    margin-inline: auto;
    padding-inline-start: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    grid-template-columns: auto minmax(0, 1fr) auto;
    background: var(--color-paper-2);
  }

  input {
    min-width: 0;
    min-height: 2.7rem;
    padding-inline: var(--space-sm);
    border: 0;
    outline: 0;
    background: transparent;
  }

  form:focus-within {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  form > button {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    gap: var(--space-xs);
    margin-inline-end: var(--space-2xs);
    padding-inline: var(--space-sm);
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--color-ink);
    color: var(--color-paper);
    cursor: pointer;
    font-size: var(--text-xs);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .answer {
    width: min(100%, 58rem);
    max-height: min(55dvh, 32rem);
    margin: var(--space-xs) auto 0;
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    overflow-y: auto;
    background: var(--color-paper);
    box-shadow: 0 1rem 2rem color-mix(in srgb, var(--color-ink) 12%, transparent);
  }

  .answer-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .answer-heading p,
  .privacy {
    margin: 0;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .close {
    display: grid;
    min-width: 2.75rem;
    min-height: 2.75rem;
    padding: 0;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  ol {
    display: grid;
    gap: var(--space-xs);
    margin: var(--space-md) 0;
    padding: 0;
    list-style: none;
  }

  li button {
    display: grid;
    width: 100%;
    min-height: 2.75rem;
    gap: var(--space-2xs);
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    text-align: start;
    white-space: normal;
    cursor: pointer;
  }

  li span,
  .message {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .error {
    color: var(--color-error);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  @media (max-width: 32rem) {
    form > button span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    form > button {
      min-width: 2.25rem;
      justify-content: center;
      padding: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .topic-ask {
      backdrop-filter: none;
    }
  }
</style>
