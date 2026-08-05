<script lang="ts">
  import { Compass, ShieldCheck } from '@lucide/svelte';

  import type { CompanionAiClient, CompanionResearchClient, StorageAdapter } from '@dusori/core';

  import ResearchDeskPanel from './ResearchDeskPanel.svelte';
  import SourceLibrary from './SourceLibrary.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let onAutoStartHandled: () => void = () => undefined;
  export let onArtifactSaved: () => void = () => undefined;
  export let onOpenSource: (path: string) => void = () => undefined;

  let sourceRevision = 0;

  function handleSourceSaved(path?: string): void {
    sourceRevision += 1;
    onArtifactSaved();
    if (path) onOpenSource(path);
  }
</script>

<section class="research-workspace" aria-labelledby="research-workspace-title">
  <header class="research-hero">
    <div>
      <p class="kicker">Research Desk · {topicTitle}</p>
      <h1 id="research-workspace-title">Ask once. See what the evidence supports.</h1>
      <p class="hero-copy">
        Dusori searches the providers you chose, keeps a varied first shelf, reads the text it can
        quote, and opens one honest brief. Blocked pages stay useful as browser-ready references.
      </p>
    </div>
  </header>

  <div class="research-grid">
    <section class="agent-bay" aria-label="Automatic research">
      <div class="bay-label">
        <Compass aria-hidden="true" size={18} />
        <span>Provider search</span>
      </div>
      <ResearchDeskPanel
        {storage}
        {topicSlug}
        {topicTitle}
        {companion}
        {ai}
        {autoStart}
        {onAutoStartHandled}
        onSourceSaved={handleSourceSaved}
      />
    </section>

    <aside class="evidence-bay" aria-label="Saved research evidence">
      <div class="bay-label">
        <ShieldCheck aria-hidden="true" size={18} />
        <span>Saved evidence</span>
      </div>
      <SourceLibrary
        {storage}
        {topicSlug}
        {topicTitle}
        {companion}
        revision={sourceRevision}
        onSourceSaved={handleSourceSaved}
        {onOpenSource}
      />
    </aside>
  </div>

  <p class="trust-line">
    A research action saves up to eight ranked references. Arbitrary discovered pages are never
    fetched in the background; full-page reading always names the host first.
  </p>
</section>

<style>
  .research-workspace {
    width: min(100%, 72rem);
    margin-inline: auto;
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
  }

  .research-hero {
    max-width: 62rem;
    padding-block-end: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .kicker,
  .bay-label {
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
    max-width: 16ch;
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

  .research-grid {
    display: grid;
    gap: var(--space-xl);
    margin-block-start: var(--space-2xl);
  }

  .agent-bay,
  .evidence-bay {
    min-width: 0;
    padding-block: var(--space-xl);
  }

  .bay-label {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-end: var(--space-lg);
    color: var(--color-accent-text);
  }

  .evidence-bay {
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .trust-line {
    padding-block-start: var(--space-lg);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  @media (max-width: 32rem) {
    .research-workspace {
      padding-block: var(--space-md) var(--space-2xl);
    }

    .research-hero {
      padding-block-end: var(--space-md);
    }

    .research-hero h1 {
      font-size: 2rem;
    }

    .hero-copy {
      display: none;
    }

    .research-grid {
      margin-block-start: var(--space-md);
    }

    .agent-bay,
    .evidence-bay {
      padding-block: var(--space-md);
    }

    .bay-label {
      margin-block-end: var(--space-sm);
    }
  }

  @media (min-width: 64rem) {
    .research-workspace {
      padding-block-start: var(--space-md);
    }

    .research-hero {
      padding-block-end: var(--space-md);
    }

    .research-hero h1 {
      font-size: 3.4rem;
    }

    .research-grid {
      grid-template-columns: minmax(0, 1.55fr) minmax(19rem, 0.75fr);
      gap: var(--space-xl);
      margin-block-start: var(--space-md);
    }

    .agent-bay,
    .evidence-bay {
      padding-block: var(--space-md);
    }

    .bay-label {
      margin-block-end: var(--space-sm);
    }

    .agent-bay {
      padding-inline-end: var(--space-xl);
    }

    .evidence-bay {
      padding-inline-start: var(--space-xl);
      border-block-start: 0;
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }
  }
</style>
