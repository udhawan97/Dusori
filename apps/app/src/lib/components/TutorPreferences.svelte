<script lang="ts">
  import { ArrowDown, ArrowUp, LoaderCircle, Plus, Save, Sparkles, X } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    acceptMarkdownUpdate,
    applyAiTutorProposal,
    lineDiff,
    parseTutorPreferences,
    proposeMarkdownUpdate,
    renderTutorPreferences,
    resolvePendingProposal,
    tutorDepths,
    type CompanionAiClient,
    type MarkdownConflict,
    type StorageAdapter,
  } from '@dusori/core';

  import { grantConsent, hasConsent } from '$lib/consent';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let aiClient: CompanionAiClient | null = null;
  export let onSaved: (() => void) | undefined = undefined;

  const aiScope = 'ai-tutor';
  const aiDisclosure =
    'Rewriting learning preferences sends this topic’s title, its current preference list, and ' +
    'the change you type to the AI provider configured in your companion. No note, source, or ' +
    'other file is sent. The result is only ever a proposal you review as a diff. Allow on this device?';

  let current = '';
  let depth = 'layered';
  let preferences: string[] = [];
  let draft = '';
  let loading = true;
  let saving = false;
  let error = '';
  let status = '';
  let conflict: MarkdownConflict | null = null;
  let aiRequest = '';
  let aiBusy = false;
  let aiModel = '';
  let proposal = '';

  $: path = `Topics/${topicSlug}/TUTOR.md`;
  $: proposalDiff = proposal
    ? lineDiff(current, proposal).filter((row) => row.kind !== 'same')
    : [];
  $: conflictDiff = conflict
    ? lineDiff(conflict.currentContent, conflict.proposalContent).filter(
        (row) => row.kind !== 'same',
      )
    : [];

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      const file = await storage.read(path);
      current = file?.content ?? '';
      const parsed = parseTutorPreferences(current);
      depth = parsed.depth;
      preferences = [...parsed.preferences];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Learning preferences could not be read.';
    } finally {
      loading = false;
    }
  }

  onMount(() => void load());

  function move(index: number, by: number): void {
    const target = index + by;
    if (target < 0 || target >= preferences.length) return;
    const next = [...preferences];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    preferences = next;
  }

  function remove(index: number): void {
    preferences = preferences.filter((_preference, position) => position !== index);
  }

  function add(): void {
    const value = draft.trim();
    if (!value) return;
    preferences = [...preferences, value];
    draft = '';
  }

  /** Everything ends here: a rendered file, a diff, and an explicit acceptance. */
  function stage(next: string): void {
    proposal = next === current ? '' : next;
    status = proposal ? '' : 'Those preferences match the file already.';
  }

  function stageFromEditor(): void {
    error = '';
    try {
      stage(renderTutorPreferences(current, { depth, preferences }));
      aiModel = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Those preferences could not be written.';
    }
  }

  async function askAi(): Promise<void> {
    if (!aiClient || !aiRequest.trim()) return;
    if (!hasConsent(aiScope)) {
      if (!window.confirm(aiDisclosure)) return;
      if (!grantConsent(aiScope)) {
        error = 'This device would not remember that choice, so nothing was sent.';
        return;
      }
    }
    aiBusy = true;
    error = '';
    try {
      const models = (await aiClient.capabilities()).filter(
        (capability) => capability.status !== 'model-failed',
      );
      if (models.length === 0) throw new Error('No AI model passed its readiness check.');
      const proposed = await aiClient.tutorPreferences({
        depth,
        preferences,
        request: aiRequest,
        topicTitle,
      });
      // The model's reply is re-rendered onto the current file, so it can change the depth and
      // the bullets and nothing else. A reply Dusori cannot use leaves the file alone.
      const next = applyAiTutorProposal(
        current,
        renderTutorPreferences(current, {
          depth: proposed.depth,
          preferences: proposed.preferences,
        }),
      );
      if (next === current) {
        status = 'The model did not return usable preferences. Nothing changed.';
        return;
      }
      aiModel = models[0]?.model ?? 'the configured model';
      stage(next);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The companion could not rewrite these.';
    } finally {
      aiBusy = false;
    }
  }

  async function save(): Promise<void> {
    if (!proposal) return;
    saving = true;
    error = '';
    conflict = null;
    try {
      const result = await proposeMarkdownUpdate(storage, topicSlug, 'TUTOR.md', proposal);
      if ('status' in result) {
        await acceptMarkdownUpdate(
          storage,
          topicSlug,
          'TUTOR.md',
          proposal,
          result.currentHash,
          new Date(),
          `- Updated [[../../../TUTOR|learning preferences]]${aiModel ? ` with wording proposed by ${aiModel}` : ''}.`,
        );
        status = 'Learning preferences saved and logged in this topic’s update file.';
        proposal = '';
        aiModel = '';
        await load();
        onSaved?.();
      } else {
        conflict = result;
        status = '';
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Those preferences could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function acceptTutorConflict(): Promise<void> {
    if (!conflict) return;
    saving = true;
    error = '';
    try {
      await acceptMarkdownUpdate(
        storage,
        topicSlug,
        'TUTOR.md',
        conflict.proposalContent,
        conflict.currentContentHash,
        new Date(),
        `- Updated [[../../../TUTOR|learning preferences]] after reviewing an external edit.`,
        conflict.proposalPath,
      );
      conflict = null;
      proposal = '';
      aiModel = '';
      status = 'Learning preferences accepted after reviewing the external edit.';
      await load();
      onSaved?.();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Those preferences could not be accepted.';
    } finally {
      saving = false;
    }
  }

  async function keepTutorConflict(): Promise<void> {
    if (!conflict) return;
    saving = true;
    error = '';
    try {
      await resolvePendingProposal(storage, topicSlug, conflict.proposalPath, 'kept');
      conflict = null;
      proposal = '';
      aiModel = '';
      status = 'Current learning preferences kept. The proposal remains readable.';
      await load();
      onSaved?.();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'That proposal could not be resolved.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="tutor" aria-labelledby="tutor-title">
  <p class="kicker">How this topic is taught</p>
  <h2 id="tutor-title">Learning preferences</h2>
  <p class="help">
    These live in <code>{path}</code> as ordinary Markdown. Dusori proposes a change and shows the diff;
    nothing is replaced until you accept it.
  </p>

  {#if loading}
    <p class="help">
      <span class="spinner"><LoaderCircle aria-hidden="true" size={18} /></span> Reading…
    </p>
  {:else}
    <label class="field">
      <span>Depth</span>
      <select bind:value={depth} onchange={stageFromEditor}>
        {#each tutorDepths as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>

    <ul class="preference-list" aria-label="Learning preferences">
      {#each preferences as preference, index (`${index}:${preference}`)}
        <li>
          <span>{preference}</span>
          <div class="row-actions">
            <button
              type="button"
              aria-label="Move “{preference}” earlier"
              disabled={index === 0}
              onclick={() => {
                move(index, -1);
                stageFromEditor();
              }}><ArrowUp aria-hidden="true" size={15} /></button
            >
            <button
              type="button"
              aria-label="Move “{preference}” later"
              disabled={index === preferences.length - 1}
              onclick={() => {
                move(index, 1);
                stageFromEditor();
              }}><ArrowDown aria-hidden="true" size={15} /></button
            >
            <button
              type="button"
              aria-label="Remove “{preference}”"
              onclick={() => {
                remove(index);
                stageFromEditor();
              }}><X aria-hidden="true" size={15} /></button
            >
          </div>
        </li>
      {/each}
    </ul>

    <form
      class="add-row"
      onsubmit={(event) => {
        event.preventDefault();
        add();
        stageFromEditor();
      }}
    >
      <label class="sr-only" for="tutor-new-preference">New learning preference</label>
      <input
        id="tutor-new-preference"
        bind:value={draft}
        maxlength={200}
        placeholder="Prefer a worked example before the rule"
      />
      <button type="submit" disabled={!draft.trim()}>
        <Plus aria-hidden="true" size={16} /> Add
      </button>
    </form>

    {#if aiClient}
      <form
        class="add-row"
        onsubmit={(event) => {
          event.preventDefault();
          void askAi();
        }}
      >
        <label class="sr-only" for="tutor-ai-request">Ask the model to rewrite these</label>
        <input
          id="tutor-ai-request"
          bind:value={aiRequest}
          maxlength={600}
          placeholder="Ask for a change, e.g. “be stricter about citing sources”"
        />
        <button type="submit" disabled={!aiRequest.trim() || aiBusy}>
          {#if aiBusy}
            <span class="spinner"><LoaderCircle aria-hidden="true" size={16} /></span>
          {:else}
            <Sparkles aria-hidden="true" size={16} />
          {/if}
          Rewrite
        </button>
      </form>
      <p class="help">
        The model may only change the depth and the bullets, and only as a proposal you accept.
      </p>
    {/if}

    {#if proposal}
      <div class="proposal">
        <p class="proposal-title">
          Proposed change{aiModel ? ` · wording from ${aiModel}, unverified` : ''}
        </p>
        <ol class="diff" aria-label="Proposed changes to learning preferences">
          {#each proposalDiff as row, index (`${index}:${row.line}`)}
            <li class={row.kind}>{row.kind === 'add' ? '+' : '−'} {row.line}</li>
          {/each}
        </ol>
        <button class="save" type="button" disabled={saving} onclick={save}>
          <Save aria-hidden="true" size={16} /> Accept and save
        </button>
      </div>
    {/if}

    {#if conflict}
      <div class="proposal conflict" role="alert">
        <p class="help">
          This file changed outside Dusori, so nothing was replaced. Your version is saved as
          <code>{conflict.proposalPath}</code>.
        </p>
        <ol class="diff" aria-label="Proposed learning preference changes">
          {#each conflictDiff as row, index (`conflict:${index}:${row.line}`)}
            <li class={row.kind}>{row.kind === 'add' ? '+' : '−'} {row.line}</li>
          {/each}
        </ol>
        <div class="conflict-actions">
          <button type="button" disabled={saving} onclick={keepTutorConflict}>Keep current</button>
          <button class="save" type="button" disabled={saving} onclick={acceptTutorConflict}>
            <Save aria-hidden="true" size={16} /> Accept proposal
          </button>
        </div>
      </div>
    {/if}

    {#if status}<p class="help" aria-live="polite">{status}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .tutor {
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

  .help {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  code {
    font-family: var(--font-mono);
    font-size: 0.95em;
  }

  .field {
    display: grid;
    gap: var(--space-xs);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  select,
  input {
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
  }

  .preference-list {
    display: grid;
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .preference-list li {
    display: grid;
    align-items: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    grid-template-columns: minmax(0, 1fr) auto;
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .row-actions {
    display: flex;
    gap: 0.15rem;
  }

  .row-actions button,
  .add-row button,
  .conflict-actions button,
  .save {
    display: inline-flex;
    min-height: 2.25rem;
    align-items: center;
    gap: var(--space-2xs, 0.25rem);
    padding-inline: var(--space-xs);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
  }

  .row-actions button {
    min-width: 2rem;
    justify-content: center;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .add-row {
    display: grid;
    gap: var(--space-xs);
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .proposal {
    display: grid;
    gap: var(--space-xs);
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
  }

  .proposal-title {
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .diff {
    display: grid;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    list-style: none;
  }

  .diff .add {
    color: var(--color-success);
  }

  .diff .remove {
    color: var(--color-error);
  }

  .save {
    justify-self: start;
  }

  .conflict {
    color: var(--color-ink);
  }

  .conflict-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
  }

  .sr-only {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .spinner {
    display: inline-grid;
    animation: spin 0.8s linear infinite;
    place-items: center;
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
