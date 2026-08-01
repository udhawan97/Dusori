<script lang="ts">
  import { Compass, Radar, ShieldCheck } from '@lucide/svelte';

  import type { CompanionAiClient, CompanionResearchClient, StorageAdapter } from '@dusori/core';

  import ResearchPanel from './ResearchPanel.svelte';
  import SourceLibrary from './SourceLibrary.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let onAutoStartHandled: () => void = () => undefined;
  export let onArtifactSaved: () => void = () => undefined;

  let sourceRevision = 0;

  function handleSourceSaved(): void {
    sourceRevision += 1;
    onArtifactSaved();
  }
</script>

<section class="research-workspace" aria-labelledby="research-workspace-title">
  <header class="research-hero">
    <div>
      <p class="kicker">Research observatory · {topicTitle}</p>
      <h1 id="research-workspace-title">Let the strongest evidence find you.</h1>
      <p class="hero-copy">
        <span class="hero-copy-wide">
          Scan every allowed provider at once. Dusori ranks the results, explains why they surfaced,
          and keeps the final source choice with you.
        </span>
        <span class="hero-copy-compact">
          Compare allowed providers. Nothing is saved without your approval.
        </span>
      </p>
    </div>
    <div class="radar-mark" aria-hidden="true">
      <span></span>
      <Radar size={42} strokeWidth={1.1} />
    </div>
  </header>

  <ol class="research-orbit" aria-label="Research flow">
    <li>
      <span>01</span>
      <div>
        <strong>Discover</strong>
        <small>Allowed providers search together</small>
      </div>
    </li>
    <li>
      <span>02</span>
      <div>
        <strong>Compare</strong>
        <small>Quality signals stay visible</small>
      </div>
    </li>
    <li>
      <span>03</span>
      <div>
        <strong>Capture</strong>
        <small>Approve before readable text is saved</small>
      </div>
    </li>
  </ol>

  <div class="research-grid">
    <section class="agent-bay" aria-label="Automatic research">
      <div class="bay-label">
        <Compass aria-hidden="true" size={18} />
        <span>Automatic discovery</span>
      </div>
      <ResearchPanel
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
        <span>Approved evidence</span>
      </div>
      {#key `${topicSlug}-${sourceRevision}`}
        <SourceLibrary {storage} {topicSlug} {companion} />
      {/key}
    </aside>
  </div>

  <p class="trust-line">
    Discovery can start automatically after provider consent. No result is added to your topic until
    you approve it.
  </p>
</section>

<style>
  .research-workspace {
    --research-blue: light-dark(oklch(52% 0.14 250), oklch(72% 0.11 245));
    width: min(100%, 84rem);
    margin-inline: auto;
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
  }

  /* This is the view the app opens on straight after a topic is created. A marquee-scale hero left
   * the first control a full screen below the fold, so it reads as a workbench header now: same
   * words, same face, one step down the scale. */
  .research-hero {
    position: relative;
    display: grid;
    min-height: 10rem;
    align-items: end;
    padding: clamp(1.25rem, 2.4vw, 2rem);
    border: var(--rule-hair) solid var(--color-rule);
    overflow: hidden;
    background:
      linear-gradient(
        135deg,
        color-mix(in srgb, var(--research-blue) 13%, transparent),
        transparent 48%
      ),
      radial-gradient(
        circle at 88% 28%,
        color-mix(in srgb, var(--color-marigold) 16%, transparent),
        transparent 26%
      ),
      var(--color-paper-2);
  }

  .research-hero::after {
    position: absolute;
    width: 26rem;
    height: 26rem;
    border: var(--rule-hair) solid color-mix(in srgb, var(--research-blue) 28%, transparent);
    border-radius: 50%;
    content: '';
    inset: -15rem -8rem auto auto;
    box-shadow:
      0 0 0 5rem color-mix(in srgb, var(--research-blue) 4%, transparent),
      0 0 0 10rem color-mix(in srgb, var(--research-blue) 2%, transparent);
    pointer-events: none;
  }

  .research-hero > div:first-child {
    position: relative;
    z-index: 1;
    max-width: 54rem;
  }

  .kicker,
  .bay-label,
  .research-orbit span {
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
    max-width: 24ch;
    margin-block-start: var(--space-xs);
    font-size: clamp(1.9rem, 2.6vw, 3rem);
    letter-spacing: -0.025em;
    line-height: 1.04;
  }

  .hero-copy {
    max-width: 56ch;
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-md);
  }

  .hero-copy-compact {
    display: none;
  }

  .radar-mark {
    position: absolute;
    z-index: 1;
    top: var(--space-xl);
    right: var(--space-xl);
    display: grid;
    width: 5.25rem;
    height: 5.25rem;
    border: var(--rule-hair) solid color-mix(in srgb, var(--research-blue) 55%, var(--color-rule));
    border-radius: 50%;
    color: var(--research-blue);
    place-items: center;
  }

  .radar-mark span {
    position: absolute;
    width: 50%;
    height: 1px;
    background: var(--research-blue);
    transform: translateX(50%);
    transform-origin: left center;
    animation: sweep 5s linear infinite;
  }

  @keyframes sweep {
    to {
      transform: translateX(50%) rotate(1turn);
    }
  }

  .research-orbit {
    display: grid;
    margin: 0;
    padding: 0;
    border-inline: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .research-orbit li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .research-orbit li:first-child {
    color: var(--research-blue);
  }

  .research-orbit div {
    display: grid;
  }

  .research-orbit strong {
    font-family: var(--font-display);
    font-size: var(--text-base);
  }

  .research-orbit small {
    color: var(--color-muted);
  }

  .research-grid {
    display: grid;
    margin-block-start: var(--space-xl);
    border-block: var(--rule-hair) solid var(--color-rule);
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
    color: var(--research-blue);
  }

  .evidence-bay {
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .trust-line {
    padding-block-start: var(--space-lg);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  /* On a phone this is the handoff immediately after topic creation, not a landing page. Keep the
   * three-part explanation, but compress it into a single visual legend so the first consent
   * decision stays in the opening viewport. */
  @media (max-width: 47.99rem) {
    .research-workspace {
      padding-block: var(--space-md) var(--space-2xl);
    }

    .research-hero {
      min-height: 0;
      padding: var(--space-md);
    }

    .hero-copy {
      font-size: var(--text-sm);
    }

    .radar-mark {
      display: none;
    }

    .research-orbit {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .research-orbit li {
      display: grid;
      grid-template-columns: 1fr;
      gap: var(--space-2xs);
      padding: var(--space-sm) var(--space-2xs);
      text-align: center;
    }

    .research-orbit li + li {
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }

    .research-orbit small {
      display: none;
    }

    .research-grid {
      margin-block-start: var(--space-md);
    }

    .agent-bay,
    .evidence-bay {
      padding-block: var(--space-lg);
    }

    .bay-label {
      margin-block-end: var(--space-md);
    }
  }

  @media (max-width: 22rem) {
    .research-hero {
      padding-block: var(--space-sm);
    }

    h1 {
      font-size: 1.75rem;
    }

    .hero-copy-wide {
      display: none;
    }

    .hero-copy-compact {
      display: inline;
    }

    .agent-bay,
    .evidence-bay {
      padding-block: var(--space-md);
    }

    .bay-label {
      margin-block-end: var(--space-sm);
    }
  }

  @media (min-width: 48rem) {
    .research-orbit {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .research-orbit li + li {
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }
  }

  @media (min-width: 72rem) {
    .research-grid {
      grid-template-columns: minmax(0, 1.55fr) minmax(19rem, 0.75fr);
      gap: var(--space-xl);
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

  @media (prefers-reduced-motion: reduce) {
    .radar-mark span {
      animation: none;
      transform: translateX(50%) rotate(-35deg);
    }
  }
</style>
