<script lang="ts">
  import { ArrowLeft, ArrowRight, Pencil } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import type { SourceRecord } from '@dusori/core';

  import {
    maxAnnotationQuoteCharacters,
    normalizeSelectedPassage,
    sourceEvidenceState,
    type SourcePassage,
  } from '$lib/source-reading';
  import MarkdownView from './MarkdownView.svelte';

  export let content: string;
  export let currentPath: string;
  export let sources: SourceRecord[] = [];
  export let onAnnotate: (passage?: SourcePassage) => void = () => undefined;
  export let onFollowLink: (event: MouseEvent) => void = () => undefined;
  export let onOpenAll: () => void = () => undefined;
  export let onOpenSource: (path: string) => void = () => undefined;

  let sheet: HTMLElement;
  let selectionPath = '';
  let selectedPassage: SourcePassage | null = null;

  $: readingSources = sources.filter((source): source is SourceRecord & { path: string } =>
    Boolean(source.path),
  );
  $: sourceIndex = readingSources.findIndex((source) => source.path === currentPath);
  $: currentSource = sourceIndex < 0 ? undefined : readingSources[sourceIndex];
  $: canQuote = currentSource ? sourceEvidenceState(currentSource) !== 'reference' : false;
  $: previousSource = sourceIndex > 0 ? readingSources[sourceIndex - 1] : undefined;
  $: nextSource = sourceIndex >= 0 ? readingSources[sourceIndex + 1] : undefined;
  $: resetSelectionForPath(currentPath);
  $: selectionTooLong = Boolean(
    selectedPassage && selectedPassage.text.length > maxAnnotationQuoteCharacters,
  );

  onMount(() => {
    document.addEventListener('selectionchange', captureSelection);
    return () => document.removeEventListener('selectionchange', captureSelection);
  });

  function resetSelectionForPath(path: string): void {
    if (path === selectionPath) return;
    selectionPath = path;
    selectedPassage = null;
  }

  function captureSelection(): void {
    if (!canQuote) {
      selectedPassage = null;
      return;
    }
    const selection = window.getSelection();
    if (!sheet || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      selectedPassage = null;
      return;
    }
    const range = selection.getRangeAt(0);
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const end =
      range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
    if (!start || !end || !sheet.contains(start) || !sheet.contains(end)) {
      selectedPassage = null;
      return;
    }
    const text = normalizeSelectedPassage(selection.toString());
    if (!text) {
      selectedPassage = null;
      return;
    }
    let heading = '';
    for (const candidate of sheet.querySelectorAll<HTMLElement>('h1, h2, h3')) {
      const headingRange = document.createRange();
      headingRange.selectNodeContents(candidate);
      if (range.compareBoundaryPoints(Range.START_TO_START, headingRange) >= 0) {
        heading = candidate.textContent?.trim() ?? '';
      } else break;
    }
    selectedPassage = { ...(heading ? { heading } : {}), text };
  }

  function evidenceLabel(source: SourceRecord | undefined): string {
    if (!source) return 'Local reading copy';
    const state = sourceEvidenceState(source);
    if (state === 'read') return 'Read evidence';
    if (state === 'readable') return 'Readable evidence';
    return 'URL reference';
  }
</script>

<article class="reading-room" aria-label="Reading room">
  <header>
    <div>
      <p class="kicker">
        Reading room{sourceIndex >= 0 ? ` · ${sourceIndex + 1} of ${readingSources.length}` : ''}
      </p>
      <h1 id="reading-room-title">{currentSource?.title ?? 'Saved source'}</h1>
      <p class="source-context">
        <span>{evidenceLabel(currentSource)}</span>
        {#if currentSource?.publisher ?? currentSource?.origin?.provider}
          <span>{currentSource?.publisher ?? currentSource?.origin?.provider}</span>
        {/if}
      </p>
    </div>
    <div class="reading-room-actions">
      <button
        class="primary-button"
        disabled={selectionTooLong}
        onclick={() => onAnnotate(canQuote ? (selectedPassage ?? undefined) : undefined)}
      >
        <Pencil aria-hidden="true" size={17} />
        {!canQuote
          ? 'Add context note'
          : selectionTooLong
            ? 'Shorten the selection'
            : selectedPassage
              ? 'Quote selection in a note'
              : 'Annotate in a study note'}
      </button>
      <button class="secondary-button" onclick={onOpenAll}>All sources</button>
    </div>
  </header>

  <nav class="reading-rail" aria-label="Saved source reading trail">
    <button
      disabled={!previousSource}
      aria-label={previousSource
        ? `Previous source: ${previousSource.title}`
        : 'No previous source'}
      onclick={() => previousSource?.path && onOpenSource(previousSource.path)}
    >
      <ArrowLeft aria-hidden="true" size={16} />
      <span>{previousSource?.title ?? 'Start of shelf'}</span>
    </button>
    <span aria-live="polite">
      {#if selectionTooLong}
        Select at most {maxAnnotationQuoteCharacters.toLocaleString()} characters.
      {:else if !canQuote}
        Add readable local text before quoting this reference.
      {:else if selectedPassage}
        {selectedPassage.text.length.toLocaleString()} characters selected with source context.
      {:else}
        Select a passage to carry its exact words into a local note.
      {/if}
    </span>
    <button
      disabled={!nextSource}
      aria-label={nextSource ? `Next source: ${nextSource.title}` : 'No next source'}
      onclick={() => nextSource?.path && onOpenSource(nextSource.path)}
    >
      <span>{nextSource?.title ?? 'End of shelf'}</span>
      <ArrowRight aria-hidden="true" size={16} />
    </button>
  </nav>

  <!-- svelte-ignore a11y_click_events_have_key_events (delegation only: every target is a rendered <a>, which Enter already activates) -->
  <!-- svelte-ignore a11y_no_static_element_interactions (the sheet is a container; the links inside carry the roles) -->
  <div class="note-sheet" bind:this={sheet} onclick={onFollowLink}>
    <MarkdownView {content} />
  </div>
</article>

<style>
  .reading-room {
    width: min(100%, 62rem);
    margin-inline: auto;
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
  }

  .reading-room > header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-lg);
    padding-block-end: var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .kicker {
    margin: 0;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  h1 {
    max-width: 18ch;
    margin-block: var(--space-xs) 0;
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    line-height: 1.1;
  }

  .source-context {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block: var(--space-sm) 0;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .source-context span + span::before {
    margin-inline-end: var(--space-xs);
    content: '·';
  }

  .reading-room-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
    justify-content: flex-end;
  }

  button {
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .reading-room-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-lg);
  }

  .primary-button {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .reading-rail {
    display: grid;
    align-items: center;
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    grid-template-columns: minmax(0, 1fr);
  }

  .reading-rail button {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border-color: transparent;
    color: var(--color-accent-text);
    font-size: var(--text-sm);
    text-align: start;
  }

  .reading-rail button:last-child {
    justify-content: flex-end;
    text-align: end;
  }

  .reading-rail button span {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reading-rail > span {
    color: var(--color-muted);
    font-size: var(--text-xs);
    text-align: center;
  }

  .note-sheet {
    width: min(100%, 46rem);
    margin-inline: auto;
    padding-block: var(--space-2xl);
  }

  @media (min-width: 52rem) {
    .reading-rail {
      grid-template-columns: minmax(0, 1fr) minmax(15rem, 1.4fr) minmax(0, 1fr);
    }
  }

  @media (max-width: 38rem) {
    .reading-room > header {
      align-items: stretch;
      flex-direction: column;
    }

    .reading-room-actions {
      justify-content: stretch;
    }

    .reading-room-actions button {
      flex: 1 1 100%;
      justify-content: center;
    }
  }
</style>
