<script lang="ts">
  import { GraduationCap } from '@lucide/svelte';

  import {
    learnPagePath,
    readLearnPage,
    withLearnPageTheme,
    type StorageAdapter,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  /** Bumped by the panel that rebuilds the page, so a rebuild reloads what is shown here. */
  export let revision = 0;

  let page: string | null = null;
  let loading = true;
  let open = false;

  $: void load(topicSlug, revision);

  async function load(slug: string, tick: number): Promise<void> {
    void tick;
    loading = true;
    try {
      const stored = await readLearnPage(storage, slug);
      // The file itself stays theme-neutral so it follows the reader's own preference when
      // opened alone; only what is shown inside Dusori is stamped to match this surface.
      page =
        stored === null
          ? null
          : withLearnPageTheme(
              stored,
              document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
            );
    } catch {
      page = null;
    } finally {
      loading = false;
    }
  }
</script>

{#if !loading && page}
  <section class="learn-panel" aria-labelledby="learn-panel-title">
    <div class="learn-heading">
      <GraduationCap aria-hidden="true" size={18} />
      <div>
        <h3 id="learn-panel-title">Learning page</h3>
        <p>
          Built from this topic's quoted passages. It runs in a sandbox with no access to your
          workspace, and the file itself makes no network request.
        </p>
      </div>
    </div>

    <div class="learn-actions">
      <button aria-expanded={open} onclick={() => (open = !open)}>
        {open ? 'Hide learning page' : 'Open learning page'}
      </button>
      <code>{learnPagePath(topicSlug)}</code>
    </div>

    {#if open}
      <!-- allow-scripts without allow-same-origin: the page keeps its own interactivity while
           staying in an opaque origin that cannot reach this app, its storage, or its cookies. -->
      <iframe
        title={`Learning page for ${topicTitle}`}
        sandbox="allow-scripts"
        srcdoc={page}
        loading="lazy"
      ></iframe>
    {/if}
  </section>
{/if}

<style>
  .learn-panel {
    margin-block-start: var(--space-lg);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .learn-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    color: var(--color-accent-text);
  }

  .learn-heading h3 {
    color: var(--color-ink);
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .learn-heading p {
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .learn-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-sm);
  }

  .learn-actions button {
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .learn-actions code {
    overflow: hidden;
    color: var(--color-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  iframe {
    width: 100%;
    height: min(38rem, 70vh);
    margin-block-start: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
  }
</style>
