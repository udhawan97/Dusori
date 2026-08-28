<script lang="ts">
  import { Library, Map } from '@lucide/svelte';

  import type {
    CompanionAiClient,
    CompanionResearchClient,
    StorageAdapter,
    Workspace,
  } from '@dusori/core';

  import ResearchDeskPanel from './ResearchDeskPanel.svelte';
  import ResearchUpdatesInbox from './ResearchUpdatesInbox.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let topics: Workspace['topics'] = [];
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let initialQuestion = '';
  export let providerRecoveryReturn = false;
  export let onAutoStartHandled: () => void = () => undefined;
  export let onProviderRecoveryReturnHandled: () => void = () => undefined;
  export let onArtifactSaved: () => void = () => undefined;
  export let onOpenSource: (path: string) => void = () => undefined;
  export let onOpenSources: () => void = () => undefined;
  export let onOpenMap: () => void = () => undefined;
  export let onOpenResearch: (topicSlug: string) => void = () => undefined;
  export let onQuestionChange: (question: string) => void = () => undefined;
  export let onReviewProviderChoices: () => void = () => undefined;

  let inboxRevision = 0;

  function handleSourceSaved(path?: string): void {
    onArtifactSaved();
    if (path) onOpenSource(path);
  }

  function handleThreadChanged(): void {
    inboxRevision += 1;
  }
</script>

<section class="research-workspace" aria-labelledby="research-workspace-title">
  <header class="research-hero">
    <div>
      <p class="kicker">Research Desk · {topicTitle}</p>
      <h1 id="research-workspace-title">Keep the whole investigation together.</h1>
      <p class="hero-copy">
        Ask once, then follow the question, source receipt, cited answer, and update history in one
        research thread. Nothing is treated as evidence until Dusori can quote it.
      </p>
    </div>
    <div class="hero-actions" aria-label="Research workspace shortcuts">
      <button type="button" onclick={onOpenSources}>
        <Library aria-hidden="true" size={16} /> Sources
      </button>
      <button type="button" onclick={onOpenMap}>
        <Map aria-hidden="true" size={16} /> Depth map
      </button>
    </div>
  </header>

  <ResearchUpdatesInbox
    {storage}
    {topics}
    revision={inboxRevision}
    onOpenTopic={onOpenResearch}
    onOpenDocument={onOpenSource}
  />

  <ResearchDeskPanel
    {storage}
    {topicSlug}
    {topicTitle}
    {companion}
    {ai}
    {autoStart}
    {initialQuestion}
    {providerRecoveryReturn}
    {onAutoStartHandled}
    {onProviderRecoveryReturnHandled}
    {onQuestionChange}
    {onReviewProviderChoices}
    onSourceSaved={handleSourceSaved}
    {onOpenSources}
    {onOpenMap}
    onThreadChanged={handleThreadChanged}
  />

  <details class="trust-line">
    <summary>How Dusori keeps research under your control</summary>
    <p>
      Each run saves up to eight ranked references. More results require individual approval;
      arbitrary pages are never fetched in the background, and full-page reading always names the
      host first.
    </p>
  </details>
</section>

<style>
  /* Hallmark · macrostructure: provenance-aware research channel · genre: atmospheric editorial · theme: design.md
   * signature: one question-led channel with source and depth-map exits · variation: threaded-result + spatial-evidence
   * states: first-run · configured · running · complete · pre-emit critique: P5 H5 E4 S5 R5 V4
   * contrast: pass (40–41) · nav: N13 · footer: Ft2 · slop: pass (42–49) · mobile: pass (34, 49–57)
   */
  .research-workspace {
    width: min(100%, 66rem);
    margin-inline: auto;
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
  }

  .research-hero {
    display: grid;
    gap: var(--space-md);
    padding-block-end: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .kicker {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .kicker,
  .hero-copy,
  .trust-line {
    margin: 0;
  }

  h1 {
    max-width: 18ch;
    margin-block-start: var(--space-xs);
    font-size: clamp(2.4rem, 6vw, 4.75rem);
    letter-spacing: -0.025em;
    line-height: 1.06;
  }

  .hero-copy {
    max-width: 56ch;
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-md);
  }

  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
  }

  .hero-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: 2.75rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    white-space: nowrap;
  }

  .trust-line {
    margin-block-start: var(--space-xl);
    padding-block-start: var(--space-lg);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .trust-line summary {
    min-height: 2.75rem;
    color: var(--color-accent-text);
    cursor: pointer;
    font-weight: 700;
  }

  .trust-line p {
    max-width: 70ch;
    margin: var(--space-xs) 0 0;
  }

  .hero-actions button:focus-visible,
  .trust-line summary:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (hover: hover) and (pointer: fine) {
    .hero-actions button:hover {
      background: var(--color-paper-2);
    }
  }

  @media (min-width: 48rem) {
    .research-hero {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: end;
    }
  }
</style>
