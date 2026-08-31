<script lang="ts">
  import {
    Archive,
    AlertTriangle,
    CheckCircle2,
    FileWarning,
    LoaderCircle,
    RefreshCcw,
    ShieldCheck,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    applyMachineFileRecovery,
    inspectMachineFileRecoveries,
    type AppliedMachineFileRecovery,
    type MachineFileRecoveryPlan,
    type StorageAdapter,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let blocking = false;
  export let reason = '';
  export let onRecovered: (recovery: AppliedMachineFileRecovery) => void | Promise<void> = () =>
    undefined;

  let plans: MachineFileRecoveryPlan[] = [];
  let selectedPath = '';
  let loading = true;
  let applying = false;
  let confirmed = false;
  let error = '';
  let status = '';

  $: selected = plans.find((plan) => plan.path === selectedPath) ?? plans[0];

  function choose(plan: MachineFileRecoveryPlan): void {
    selectedPath = plan.path;
    confirmed = false;
    error = '';
    status = '';
  }

  async function refresh(): Promise<void> {
    loading = true;
    error = '';
    try {
      plans = await inspectMachineFileRecoveries(storage);
      if (!plans.some((plan) => plan.path === selectedPath)) selectedPath = plans[0]?.path ?? '';
      confirmed = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Machine files could not be inspected.';
    } finally {
      loading = false;
    }
  }

  async function applySelected(): Promise<void> {
    if (!selected?.proposedContent || !confirmed) return;
    applying = true;
    error = '';
    status = '';
    try {
      const recovered = await applyMachineFileRecovery(storage, selected);
      status = `Repair applied. The exact original remains at ${recovered.archivePath}.`;
      await refresh();
      await onRecovered(recovered);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The reviewed repair could not be applied.';
    } finally {
      applying = false;
    }
  }

  onMount(() => void refresh());
</script>

<section
  class:blocking
  class="recovery-ledger"
  aria-labelledby="machine-recovery-title"
  aria-busy={loading || applying}
>
  <header class="recovery-heading">
    <div>
      <p class="kicker">Local integrity · preview first</p>
      <h2 id="machine-recovery-title">
        {blocking ? 'Your files are still here.' : 'Machine-file recovery'}
      </h2>
      <p class="intro">
        {blocking
          ? 'Dusori stopped before changing an invalid workspace file. Review the original and the exact proposed replacement below.'
          : 'Dusori checks its own JSON without touching your Markdown. A repair archives the exact original before one hash-guarded replacement.'}
      </p>
      {#if reason}<p class="reason" role="alert">{reason}</p>{/if}
    </div>
    <button
      class="refresh"
      aria-label="Inspect machine files again"
      disabled={loading || applying}
      onclick={refresh}
    >
      <RefreshCcw aria-hidden="true" size={18} />
    </button>
  </header>

  {#if loading && plans.length === 0}
    <p class="state">
      <span class="spinner"><LoaderCircle aria-hidden="true" size={18} /></span> Inspecting local JSON…
    </p>
  {:else if error && plans.length === 0}
    <p class="state failure" role="alert"><AlertTriangle aria-hidden="true" size={18} /> {error}</p>
  {:else if plans.length === 0}
    <p class="state healthy" aria-live="polite">
      <CheckCircle2 aria-hidden="true" size={18} /> No invalid recognized machine files were found.
    </p>
  {:else}
    <div class="recovery-workbench">
      <nav class="file-register" aria-label="Invalid machine files">
        <p>
          <FileWarning aria-hidden="true" size={17} />
          <strong>{plans.length} {plans.length === 1 ? 'file needs' : 'files need'} review</strong>
        </p>
        <ol>
          {#each plans as plan (plan.path)}
            <li>
              <button
                type="button"
                class:active={selected?.path === plan.path}
                aria-current={selected?.path === plan.path ? 'true' : undefined}
                onclick={() => choose(plan)}
              >
                <span>{plan.label}</span>
                <small>{plan.path}</small>
              </button>
            </li>
          {/each}
        </ol>
      </nav>

      {#if selected}
        <article class="repair-sheet" aria-labelledby="selected-machine-file">
          <header>
            <div>
              <p class="step">Review · {selected.kind.replaceAll('-', ' ')}</p>
              <h3 id="selected-machine-file">{selected.path}</h3>
            </div>
            <span class="hash"
              >{selected.expectedHash.slice(0, 12)} · {selected.originalBytes} bytes</span
            >
          </header>

          <p class="issue"><AlertTriangle aria-hidden="true" size={17} /> {selected.issue}</p>

          <div class="preservation-sequence" aria-label="Recovery sequence">
            <section>
              <p class="step"><span>1</span> Preserve</p>
              <h4>Original file</h4>
              <textarea
                readonly
                aria-label={`Original ${selected.path}`}
                value={selected.originalExcerpt}></textarea>
              {#if selected.originalTruncated}
                <p class="truncation">
                  Preview limited here; the archive keeps every original byte.
                </p>
              {/if}
            </section>

            <section>
              <p class="step"><span>2</span> Preview</p>
              <h4>{selected.proposedContent ? 'Proposed replacement' : 'Manual recovery only'}</h4>
              {#if selected.proposedContent}
                <textarea
                  readonly
                  aria-label={`Proposed ${selected.path}`}
                  value={selected.proposedContent}></textarea>
              {:else}
                <div class="manual-only">
                  <ShieldCheck aria-hidden="true" size={20} />
                  <p>Dusori will not invent data just to make this file pass validation.</p>
                </div>
              {/if}
            </section>
          </div>

          <div class="repair-decision">
            <div>
              <p class="step"><span>3</span> Decide</p>
              <p>{selected.repairSummary}</p>
            </div>
            {#if selected.proposedContent}
              <label>
                <input type="checkbox" bind:checked={confirmed} disabled={applying} />
                <span>I reviewed this exact replacement.</span>
              </label>
              <button
                class="apply-repair"
                disabled={!confirmed || applying}
                onclick={applySelected}
              >
                <Archive aria-hidden="true" size={17} />
                {applying ? 'Archiving and applying…' : 'Archive original and apply repair'}
              </button>
            {/if}
          </div>

          {#if error}
            <p class="state failure" role="alert">
              <AlertTriangle aria-hidden="true" size={18} />
              {error}
            </p>
          {/if}
          {#if status}
            <p class="state healthy" aria-live="polite">
              <CheckCircle2 aria-hidden="true" size={18} />
              {status}
            </p>
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</section>

<style>
  .recovery-ledger {
    display: grid;
    gap: var(--space-lg);
    padding: var(--space-lg);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-md);
    background:
      linear-gradient(
        90deg,
        transparent 0 3rem,
        color-mix(in srgb, var(--color-error) 34%, transparent) 3rem calc(3rem + 1px),
        transparent calc(3rem + 1px)
      ),
      color-mix(in srgb, var(--color-paper) 96%, var(--color-ink));
  }

  .recovery-ledger.blocking {
    width: min(100%, 74rem);
    margin-inline: auto;
    padding: clamp(var(--space-lg), 4vw, var(--space-2xl));
    box-shadow: 0 1.5rem 5rem color-mix(in srgb, var(--color-ink) 12%, transparent);
  }

  .recovery-heading,
  .file-register > p,
  .repair-sheet > header,
  .issue,
  .state,
  .step,
  .manual-only,
  .apply-repair {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
  }

  .recovery-heading {
    justify-content: space-between;
    padding-inline-start: 3.25rem;
  }

  h2,
  h3,
  h4,
  p,
  ol {
    margin: 0;
  }

  h2,
  h3,
  h4 {
    font-family: var(--font-display);
  }

  h2 {
    margin-block: var(--space-xs);
    font-size: clamp(var(--text-lg), 3vw, var(--text-xl));
  }

  h3 {
    max-width: 48ch;
    overflow-wrap: anywhere;
    font-size: var(--text-md);
  }

  h4 {
    margin-block: var(--space-xs);
    font-size: var(--text-sm);
  }

  .kicker,
  .step,
  .hash,
  .file-register small,
  .truncation {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .kicker,
  .step {
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .intro,
  .reason,
  .repair-decision > div > p:last-child {
    max-width: 68ch;
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.55;
  }

  .reason {
    margin-block-start: var(--space-xs);
    color: var(--color-error);
  }

  .refresh {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: 50%;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .refresh:disabled,
  .apply-repair:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .state,
  .issue {
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .state :global(svg),
  .issue :global(svg),
  .file-register :global(svg),
  .manual-only :global(svg) {
    flex: none;
  }

  .healthy {
    color: var(--color-success);
  }

  .failure,
  .issue {
    color: var(--color-error);
  }

  .spinner {
    animation: spin 0.8s linear infinite;
  }

  .recovery-workbench {
    display: grid;
    grid-template-columns: minmax(12rem, 0.34fr) minmax(0, 1fr);
    gap: var(--space-lg);
    padding-inline-start: 3.25rem;
  }

  .file-register {
    align-self: start;
  }

  .file-register > p {
    margin-block-end: var(--space-sm);
    color: var(--color-error);
    font-size: var(--text-sm);
  }

  .file-register ol {
    display: grid;
    gap: 1px;
    padding: 0;
    background: var(--color-rule);
    list-style: none;
  }

  .file-register button {
    width: 100%;
    min-height: 3.75rem;
    padding: var(--space-sm);
    border: 0;
    background: var(--color-paper);
    color: var(--color-ink);
    cursor: pointer;
    text-align: start;
  }

  .file-register button.active {
    background: color-mix(in srgb, var(--color-accent) 12%, var(--color-paper));
    box-shadow: inset 3px 0 0 var(--color-accent);
  }

  .file-register span,
  .file-register small {
    display: block;
  }

  .file-register span {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .file-register small {
    overflow: hidden;
    margin-block-start: 0.2rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .repair-sheet {
    display: grid;
    min-width: 0;
    gap: var(--space-md);
  }

  .repair-sheet > header {
    justify-content: space-between;
    gap: var(--space-md);
  }

  .hash {
    flex: none;
    padding: 0.35rem 0.55rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 999px;
  }

  .preservation-sequence {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .preservation-sequence > section {
    min-width: 0;
    padding-block: var(--space-md);
  }

  .preservation-sequence > section + section {
    padding-inline-start: var(--space-md);
    border-inline-start: var(--rule-hair) solid var(--color-rule);
  }

  .preservation-sequence > section:first-child {
    padding-inline-end: var(--space-md);
  }

  .step span {
    display: inline-grid;
    width: 1.35rem;
    height: 1.35rem;
    border: var(--rule-hair) solid currentColor;
    border-radius: 50%;
    place-items: center;
  }

  textarea {
    width: 100%;
    min-height: 10rem;
    max-height: 18rem;
    overflow: auto;
    margin: 0;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--color-ink) 4%, var(--color-paper));
    color: var(--color-ink);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    line-height: 1.55;
    resize: vertical;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .truncation {
    margin-block-start: var(--space-xs);
    line-height: 1.45;
  }

  .manual-only {
    min-height: 8rem;
    padding: var(--space-md);
    border: var(--rule-hair) dashed var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .repair-decision {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-md);
  }

  .repair-decision label {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--text-sm);
  }

  .repair-decision input {
    width: 1.1rem;
    height: 1.1rem;
    accent-color: var(--color-accent);
  }

  .apply-repair {
    align-items: center;
    min-height: 2.75rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-ink);
    border-radius: var(--radius-sm);
    background: var(--color-ink);
    color: var(--color-paper);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
    font-weight: 700;
  }

  button:focus-visible,
  textarea:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 52rem) {
    .recovery-ledger,
    .recovery-ledger.blocking {
      padding: var(--space-md);
      background: color-mix(in srgb, var(--color-paper) 96%, var(--color-ink));
    }

    .recovery-heading,
    .recovery-workbench {
      padding-inline-start: 0;
    }

    .recovery-workbench,
    .preservation-sequence,
    .repair-decision {
      grid-template-columns: 1fr;
    }

    .preservation-sequence > section + section {
      padding-inline-start: 0;
      border-block-start: var(--rule-hair) solid var(--color-rule);
      border-inline-start: 0;
    }

    .preservation-sequence > section:first-child {
      padding-inline-end: 0;
    }

    .repair-decision {
      align-items: stretch;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }
</style>
