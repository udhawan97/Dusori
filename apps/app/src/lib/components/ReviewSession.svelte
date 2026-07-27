<script lang="ts">
  import { ArrowLeft, ArrowRight, BookOpen, Eye, Sparkles, X } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    applyAiRecallPrompts,
    buildRecallSession,
    recallAiRequest,
    type AiCapability,
    type CompanionAiClient,
    type RecallSession,
    type ReviewOutcome,
    type StorageAdapter,
  } from '@dusori/core';

  import { modal } from '$lib/actions/modal';
  import { grantConsent, hasConsent } from '$lib/consent';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let objective: string;
  export let ai: CompanionAiClient | null = null;
  /** True while the parent records the outcome, so the session cannot rate twice. */
  export let rating = false;
  export let onRate: (outcome: ReviewOutcome) => void = () => undefined;
  export let onClose: () => void = () => undefined;

  // Its own scope: ranking sends public candidate metadata, this sends text out of the
  // learner's own workspace. Consent to the narrower disclosure must not be reused here.
  const consentScope = 'companion-ai-recall';
  const disclosure =
    'Sharper prompts send this objective and up to four short excerpts (320 characters each) from the sources you approved for this topic to the AI provider configured in your local companion. Your notes, roadmap, and review history are not sent. Allow on this device?';

  let loading = true;
  let error = '';
  let session: RecallSession | null = null;
  let referenceCount = 0;
  let emptyState: 'no-readable-sources' | 'no-sources' | '' = '';
  let index = 0;
  let revealed: string[] = [];
  let aiCapability: AiCapability | null = null;
  let aiNotice = '';
  let askingConsent = false;
  let improving = false;
  // localStorage cannot be a reactive dependency; this tick is what re-reads it after a grant.
  let consentTick = 0;
  let closeButton: HTMLButtonElement;
  let consentAllowButton: HTMLButtonElement;
  let consentInvoker: HTMLButtonElement | null = null;

  $: prompts = session?.prompts ?? [];
  $: current = prompts[index] ?? null;
  $: onLastPrompt = prompts.length > 0 && index === prompts.length - 1;
  $: isRevealed = current ? revealed.includes(current.id) : false;
  $: aiAllowed = Boolean(aiCapability) && (void consentTick, hasConsent(consentScope));

  onMount(() => {
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      const result = await buildRecallSession(storage, { objective, topicSlug, topicTitle });
      if (result.status === 'ready') {
        session = result.session;
        emptyState = '';
      } else {
        session = null;
        emptyState = result.status;
        referenceCount = result.status === 'no-readable-sources' ? result.referenceCount : 0;
      }
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'Dusori could not read this topic’s sources.';
    } finally {
      loading = false;
    }
    await tick();
    closeButton?.focus();
    await readAiCapability();
    if (session && aiCapability && hasConsent(consentScope)) await improvePrompts();
  }

  async function readAiCapability(): Promise<void> {
    aiCapability = ai ? ((await ai.capabilities())[0] ?? null) : null;
  }

  /**
   * Advisory only: the model may reword the prompts. Count, order, evidence and the rating
   * actions are structurally out of its reach, and any failure keeps the deterministic prompts.
   */
  async function improvePrompts(): Promise<void> {
    if (!ai || !aiCapability || !session || improving) return;
    improving = true;
    try {
      const rewritten = await ai.recallPrompts(recallAiRequest(session));
      const applied = applyAiRecallPrompts(session, rewritten, aiCapability.model);
      aiNotice =
        applied === session
          ? 'The model’s prompts did not match this session, so these stayed deterministic.'
          : '';
      session = applied;
    } catch {
      aiNotice = 'Sharper prompts were unavailable, so these stayed deterministic.';
    } finally {
      improving = false;
    }
  }

  async function askConsent(invoker: HTMLButtonElement): Promise<void> {
    askingConsent = true;
    consentInvoker = invoker;
    await tick();
    consentAllowButton?.focus();
  }

  async function allowAi(): Promise<void> {
    if (!grantConsent(consentScope)) {
      aiNotice = 'This browser would not store the choice, so prompts stay deterministic.';
    }
    askingConsent = false;
    consentTick += 1;
    await tick();
    consentInvoker?.focus();
    consentInvoker = null;
    if (hasConsent(consentScope)) await improvePrompts();
  }

  async function declineAi(): Promise<void> {
    askingConsent = false;
    await tick();
    consentInvoker?.focus();
    consentInvoker = null;
  }

  function reveal(): void {
    if (current && !revealed.includes(current.id)) revealed = [...revealed, current.id];
  }

  function step(delta: number): void {
    index = Math.min(Math.max(index + delta, 0), Math.max(prompts.length - 1, 0));
  }

  function handleCancel(): void {
    if (askingConsent) void declineAi();
    else if (!rating) onClose();
  }
</script>

<dialog
  use:modal
  class="review-session"
  aria-labelledby="review-session-title"
  oncancel={(event) => {
    event.preventDefault();
    handleCancel();
  }}
>
  <div class="session-heading">
    <div>
      <p class="dialog-kicker">Source-grounded review</p>
      <h2 id="review-session-title">{topicTitle}</h2>
      <p class="objective">{objective}</p>
    </div>
    <button
      class="icon-action"
      bind:this={closeButton}
      aria-label="Close review session"
      disabled={rating}
      onclick={onClose}
    >
      <X aria-hidden="true" size={19} />
    </button>
  </div>

  <div class="session-scroll">
    {#if loading}
      <p class="quiet-note" role="status">Reading this topic’s sources…</p>
    {:else if error}
      <p class="dialog-error" role="alert">{error}</p>
    {:else if emptyState === 'no-sources'}
      <div class="session-empty">
        <BookOpen aria-hidden="true" size={20} />
        <div>
          <p>This topic has no sources yet.</p>
          <span
            >Add one in Research — paste your own text, add a file, or approve a found source — then
            start the review again.</span
          >
        </div>
      </div>
    {:else if emptyState === 'no-readable-sources'}
      <div class="session-empty">
        <BookOpen aria-hidden="true" size={20} />
        <div>
          <p>
            {referenceCount === 1
              ? 'This topic’s source is a URL reference'
              : `All ${referenceCount} of this topic’s sources are URL references`} without captured text.
          </p>
          <span>
            A review needs words on this device. Fetch a page’s readable text with the local
            companion, or paste the text into the source yourself. Dusori never fetches a page on
            its own.
          </span>
        </div>
      </div>
    {:else if current}
      <div class="session-body">
        <div class="prompt-meta">
          <p class="step-count" aria-live="polite">Prompt {index + 1} of {prompts.length}</p>
          <p class="prompt-origin">
            {#if current.generatedBy === 'ai' && session?.model}
              Written by {session.model} · unverified
            {:else}
              Deterministic prompt
            {/if}
          </p>
        </div>

        <p class="prompt-text" aria-live="polite">{current.prompt}</p>

        {#if isRevealed}
          <figure class="evidence">
            <figcaption>
              <strong>{current.evidence.title}</strong>
              <span>Section: {current.evidence.heading}</span>
              <code>{current.evidence.path}</code>
            </figcaption>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
            <blockquote role="region" aria-label="Source excerpt" tabindex="0">
              {current.evidence.excerpt}
            </blockquote>
            <p class="evidence-note">
              {current.evidence.truncated ? 'Excerpt shortened. ' : ''}Open the file above to read
              the rest; it may have changed since this session opened.
            </p>
          </figure>
        {:else}
          <button class="quiet reveal-action" onclick={reveal}>
            <Eye aria-hidden="true" size={17} />
            Reveal the source
          </button>
        {/if}

        <div class="session-nav">
          <button class="quiet" disabled={index === 0} onclick={() => step(-1)}>
            <ArrowLeft aria-hidden="true" size={16} /> Back
          </button>
          <button class="quiet" disabled={onLastPrompt} onclick={() => step(1)}>
            Next <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>

        {#if aiCapability}
          <div class="ai-row">
            {#if askingConsent}
              <div class="ai-disclosure">
                <p class="dialog-kicker">Egress disclosure</p>
                <p>{disclosure}</p>
                <div class="dialog-actions">
                  <button class="quiet" onclick={declineAi}>Keep prompts deterministic</button>
                  <button class="primary" bind:this={consentAllowButton} onclick={allowAi}>
                    Allow sharper prompts
                  </button>
                </div>
              </div>
            {:else if aiAllowed}
              <p class="ai-chip">
                <Sparkles aria-hidden="true" size={14} />
                {improving ? 'Asking the companion…' : `Sharper prompts · ${aiCapability.model}`}
              </p>
            {:else}
              <button
                class="ai-chip ai-chip-action"
                onclick={(event) => void askConsent(event.currentTarget)}
              >
                <Sparkles aria-hidden="true" size={14} />
                Allow sharper prompts · {aiCapability.model}
              </button>
            {/if}
          </div>
        {/if}

        {#if aiNotice}
          <p class="quiet-note" role="status">{aiNotice}</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Pinned: the decision and the way out stay on screen however long a prompt runs. -->
  <div class="session-foot">
    {#if current}
      <div class="rating">
        <p class="rating-label">
          {onLastPrompt
            ? 'How did that go? Only this choice changes your review schedule.'
            : 'Rate this topic on the last prompt. Nothing so far has changed your schedule.'}
        </p>
        {#if onLastPrompt}
          <div class="dialog-actions">
            <button class="quiet" disabled={rating} onclick={() => onRate('again')}>
              Needs work
            </button>
            <button class="primary" disabled={rating} onclick={() => onRate('good')}>
              {rating ? 'Recording…' : 'Got it'}
            </button>
          </div>
        {/if}
      </div>
    {/if}
    <p class="session-footer">
      Answer in your head or in your own note. This session stores nothing and scores nothing: the
      prompts are generated from your sources to make you recall, and only your rating changes the
      review schedule.
    </p>
    {#if !loading}
      <button class="quiet" disabled={rating} onclick={onClose}>Close without rating</button>
    {/if}
  </div>
</dialog>

<style>
  /* Hallmark · component: review session · genre: editorial utility · theme: inherited custom
   * states: default · hover · focus · disabled · loading · error
   * contrast: pass · pre-emit critique: P5 H5 E5 S5 R5 V4
   */
  /* Heading and foot are fixed rows; only the prompt itself scrolls, so the rating and the way
   * out never fall below the fold on a short screen. */
  .review-session {
    display: grid;
    width: min(38rem, calc(100% - 2 * var(--page-gutter)));
    max-height: calc(100dvh - (2 * var(--page-gutter)));
    margin: auto;
    padding: var(--space-lg);
    overflow: hidden;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--space-lg);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-paper);
    box-shadow: 0 var(--space-sm) var(--space-xl)
      color-mix(in oklch, var(--color-ink) 24%, transparent);
  }

  .review-session::backdrop {
    background: color-mix(in oklch, var(--color-ink) 72%, transparent);
  }

  h2,
  p,
  figure,
  blockquote {
    margin: 0;
  }

  .session-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  h2 {
    margin-block-start: var(--space-2xs);
    font-family: var(--font-display);
    font-size: var(--text-lg);
    line-height: 1.15;
    /* Breaks between words first; a single over-long word still breaks rather than overflowing. */
    overflow-wrap: break-word;
  }

  .session-scroll {
    display: grid;
    align-content: start;
    gap: var(--space-lg);
    overflow: auto;
    overscroll-behavior: contain;
  }

  .session-foot {
    display: grid;
    gap: var(--space-md);
  }

  .dialog-kicker,
  .step-count,
  .prompt-origin,
  .evidence figcaption span,
  .evidence figcaption code {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .objective {
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .session-body {
    display: grid;
    gap: var(--space-lg);
  }

  .prompt-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--space-xs);
    padding-block-end: var(--space-xs);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .prompt-origin {
    color: var(--color-muted);
  }

  .prompt-text {
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: 1.4;
  }

  .evidence {
    display: grid;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .evidence figcaption {
    display: grid;
    gap: var(--space-2xs);
  }

  .evidence figcaption strong {
    font-family: var(--font-display);
  }

  .evidence figcaption code,
  .evidence figcaption span {
    overflow-wrap: anywhere;
    text-transform: none;
  }

  blockquote {
    max-height: 14rem;
    padding-inline-start: var(--space-md);
    overflow: auto;
    border-inline-start: 2px solid var(--color-accent);
    font-size: var(--text-sm);
    line-height: 1.6;
    overscroll-behavior: contain;
  }

  blockquote:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .evidence-note,
  .quiet-note,
  .session-footer,
  .rating-label,
  .session-empty span {
    color: var(--color-muted);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .session-footer {
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .session-empty {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
    color: var(--color-accent-text);
  }

  .session-empty p {
    color: var(--color-ink);
    font-size: var(--text-sm);
  }

  .session-empty span {
    display: block;
    margin-block-start: var(--space-2xs);
  }

  .session-nav,
  .dialog-actions {
    display: grid;
    gap: var(--space-xs);
  }

  button {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-2xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper);
    color: var(--color-accent-text);
    font: inherit;
    cursor: pointer;
  }

  button:focus-visible {
    outline-color: var(--color-focus);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .primary {
    background: var(--color-ink);
    color: var(--color-paper);
    font-weight: 700;
  }

  .icon-action {
    width: calc(var(--space-xl) + var(--space-2xs));
    flex: none;
    padding: 0;
  }

  .ai-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    padding: var(--space-2xs) var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .ai-chip-action {
    min-height: 2.25rem;
  }

  .ai-disclosure {
    display: grid;
    gap: var(--space-sm);
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .ai-disclosure p:not(.dialog-kicker) {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  .rating {
    display: grid;
    gap: var(--space-sm);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .dialog-error {
    color: var(--color-error);
    font-size: var(--text-sm);
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover:not(:disabled) {
      background: var(--color-paper-2);
      color: var(--color-ink);
    }

    .primary:hover:not(:disabled) {
      background: var(--color-accent-text);
      color: var(--color-paper);
    }
  }

  @media (min-width: 30rem) {
    .session-nav,
    .dialog-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 26rem) {
    .review-session {
      padding: var(--space-md);
      gap: var(--space-md);
    }

    h2 {
      font-size: var(--text-md);
    }
  }
</style>
