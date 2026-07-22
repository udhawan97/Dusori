<script lang="ts">
  import { AlertTriangle, Check, ClipboardList, FileCheck2, Pencil } from '@lucide/svelte';

  import {
    acceptMarkdownUpdate,
    applyCurriculum,
    curriculumAdapters,
    lineDiff,
    maxCurriculumBytes,
    parseCurriculum,
    type CurriculumAdapterSelection,
    type CurriculumDraft,
    type MarkdownConflict,
    type StorageAdapter,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let onRoadmapApplied: (content: string) => void = () => undefined;
  export let onSourceSaved: () => void = () => undefined;

  let mode: 'idle' | 'editing' | 'preview' | 'conflict' | 'applied' = 'idle';
  let adapterId: CurriculumAdapterSelection = 'auto';
  let sourceTitle = '';
  let sourceUrl = '';
  let outline = '';
  let draft: CurriculumDraft | null = null;
  let conflict: MarkdownConflict | null = null;
  let working = false;
  let error = '';
  let success = '';

  $: changedRows = conflict
    ? lineDiff(conflict.currentContent, conflict.proposalContent)
        .filter((row) => row.kind !== 'same')
        .slice(0, 80)
    : [];

  function begin(): void {
    mode = 'editing';
    error = '';
    success = '';
  }

  function edit(): void {
    mode = 'editing';
    conflict = null;
    error = '';
    success = '';
  }

  async function preview(): Promise<void> {
    working = true;
    error = '';
    success = '';
    await Promise.resolve();
    try {
      draft = parseCurriculum({
        adapterId,
        content: outline,
        sourceTitle,
        sourceUrl: sourceUrl || undefined,
      });
      mode = 'preview';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not read this curriculum.';
    } finally {
      working = false;
    }
  }

  async function apply(): Promise<void> {
    if (!draft) return;
    working = true;
    error = '';
    success = '';
    try {
      const result = await applyCurriculum(storage, topicSlug, draft);
      onSourceSaved();
      if (result.status === 'conflict') {
        conflict = result.conflict;
        mode = 'conflict';
        return;
      }
      mode = 'applied';
      success = 'Roadmap updated. The original outline is saved with this topic.';
      onRoadmapApplied(result.roadmapContent);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not apply this curriculum.';
    } finally {
      working = false;
    }
  }

  async function replaceAfterConflict(): Promise<void> {
    if (!conflict) return;
    working = true;
    error = '';
    try {
      await acceptMarkdownUpdate(
        storage,
        topicSlug,
        'roadmap.md',
        conflict.proposalContent,
        conflict.currentContentHash,
      );
      const content = conflict.proposalContent;
      conflict = null;
      mode = 'applied';
      success = 'Imported roadmap accepted. The external version remains in the update history.';
      onRoadmapApplied(content);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not replace the roadmap.';
    } finally {
      working = false;
    }
  }

  function startAnother(): void {
    mode = 'editing';
    draft = null;
    conflict = null;
    sourceTitle = '';
    sourceUrl = '';
    outline = '';
    success = '';
    error = '';
  }
</script>

<section class="curriculum-importer" aria-labelledby="curriculum-title" aria-busy={working}>
  <div class="curriculum-heading">
    <div>
      <h2 id="curriculum-title">Curriculum</h2>
      <p>Turn an official study outline into a reviewable topic roadmap.</p>
    </div>
    <ClipboardList aria-hidden="true" size={22} strokeWidth={1.5} />
  </div>

  {#if mode === 'idle'}
    <div class="curriculum-empty">
      <p>No curriculum has been imported in this session.</p>
      <span>Paste an outline; Dusori will not open or fetch its source page.</span>
    </div>
    <button class="curriculum-action" onclick={begin}>
      <ClipboardList aria-hidden="true" size={18} />
      Import curriculum
    </button>
  {:else if mode === 'editing'}
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void preview();
      }}
    >
      <label for="curriculum-adapter">Outline format</label>
      <select id="curriculum-adapter" bind:value={adapterId} disabled={working}>
        <option value="auto">Detect automatically</option>
        {#each curriculumAdapters as adapter (adapter.id)}
          <option value={adapter.id}>{adapter.label}</option>
        {/each}
      </select>

      <label for="curriculum-title-input">Source title</label>
      <input
        id="curriculum-title-input"
        bind:value={sourceTitle}
        required
        maxlength="160"
        disabled={working}
        aria-invalid={error && !sourceTitle.trim() ? 'true' : undefined}
      />

      <label for="curriculum-url">Official page <span>optional</span></label>
      <input
        id="curriculum-url"
        type="url"
        bind:value={sourceUrl}
        inputmode="url"
        placeholder="https://learn.microsoft.com/…"
        disabled={working}
        aria-describedby="curriculum-url-help"
      />
      <p class="field-help" id="curriculum-url-help">Saved for provenance; never fetched.</p>

      <label for="curriculum-outline">Outline text</label>
      <textarea
        id="curriculum-outline"
        bind:value={outline}
        required
        maxlength={maxCurriculumBytes}
        disabled={working}
        aria-describedby="curriculum-outline-help"
        aria-invalid={error && !outline.trim() ? 'true' : undefined}></textarea>
      <p class="field-help" id="curriculum-outline-help">
        Markdown, Microsoft Learn, or AWS exam guide text · up to 512 KiB
      </p>

      <button class:loading={working} class="curriculum-action" disabled={working}>
        {working ? 'Reading outline…' : 'Preview roadmap'}
      </button>
    </form>
  {:else if mode === 'preview' && draft}
    <div class="preview-heading">
      <div>
        <p class="preview-label">{draft.adapterLabel}</p>
        <h3>{draft.objectives.length} roadmap items</h3>
      </div>
      <button class="quiet-action" onclick={edit} disabled={working}>
        <Pencil aria-hidden="true" size={16} />
        Edit
      </button>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
    <ol class="objective-list" aria-label="Curriculum preview" tabindex="0">
      {#each draft.objectives as objective, index (`${index}-${objective.depth}-${objective.title}`)}
        <li class:depth-two={objective.depth === 2} class:depth-three={objective.depth === 3}>
          <span aria-hidden="true">{objective.depth === 1 ? '§' : '□'}</span>
          <span>{objective.title}{objective.weight ? ` (${objective.weight})` : ''}</span>
        </li>
      {/each}
    </ol>
    <p class="preview-note">
      Applying replaces the tracked roadmap only after this preview. External edits trigger a
      separate proposal.
    </p>
    <button class:loading={working} class="curriculum-action" disabled={working} onclick={apply}>
      <FileCheck2 aria-hidden="true" size={18} />
      {working ? 'Applying roadmap…' : 'Apply roadmap'}
    </button>
  {:else if mode === 'conflict' && conflict}
    <div class="conflict-heading">
      <span class="state-icon"><AlertTriangle aria-hidden="true" size={21} /></span>
      <div>
        <h3>The existing roadmap changed.</h3>
        <p>Dusori kept that edit and wrote the imported version beside it.</p>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
    <div class="curriculum-diff" role="region" aria-label="Imported roadmap changes" tabindex="0">
      {#each changedRows as row, index (`${index}-${row.kind}`)}
        <div class:added={row.kind === 'add'} class:removed={row.kind === 'remove'}>
          <span aria-hidden="true">{row.kind === 'add' ? '+' : '−'}</span>
          <code>{row.line || ' '}</code>
        </div>
      {/each}
    </div>
    <p class="preview-note">
      Replace only if the imported outline should become the topic’s active roadmap.
    </p>
    <div class="conflict-actions">
      <button class="quiet-action" onclick={edit} disabled={working}>Keep current roadmap</button>
      <button
        class:loading={working}
        class="curriculum-action"
        onclick={replaceAfterConflict}
        disabled={working}
      >
        {working ? 'Replacing roadmap…' : 'Use imported roadmap'}
      </button>
    </div>
  {:else if mode === 'applied'}
    <div class="applied-state">
      <span class="state-icon"><Check aria-hidden="true" size={22} /></span>
      <div>
        <h3>Curriculum ready.</h3>
        <p>{success}</p>
      </div>
    </div>
    <button class="quiet-action" onclick={startAnother}>Import another outline</button>
  {/if}

  <div class="curriculum-feedback" aria-live="polite">
    {#if error}
      <p class="curriculum-message error" role="alert">
        <span class="message-icon"><AlertTriangle aria-hidden="true" size={17} /></span>
        <span>{error}</span>
      </p>
    {/if}
  </div>
</section>

<style>
  /* Hallmark · component: curriculum importer · genre: editorial utility · theme: inherited custom
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass · pre-emit critique: P5 H5 E4 S5 R5 V4
   */
  .curriculum-importer {
    display: grid;
    gap: var(--space-lg);
  }

  .curriculum-heading,
  .preview-heading,
  .conflict-heading,
  .applied-state {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2,
  h3 {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-display);
    font-style: normal;
    line-height: 1.2;
  }

  h2 {
    font-size: var(--text-md);
  }

  h3 {
    font-size: var(--text-base);
  }

  .curriculum-heading p,
  .conflict-heading p,
  .applied-state p,
  .preview-note {
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .curriculum-empty {
    padding-block: var(--space-sm);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .curriculum-empty p {
    font-weight: 700;
  }

  .curriculum-empty span {
    display: block;
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  form {
    display: grid;
    gap: var(--space-xs);
  }

  label {
    margin-block-start: var(--space-xs);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  label span,
  .field-help,
  .preview-label {
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  input,
  select,
  textarea,
  button {
    min-width: 0;
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    font: inherit;
  }

  input,
  select,
  textarea {
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    background: var(--color-paper);
    color: var(--color-ink);
  }

  textarea {
    min-height: 10rem;
    resize: vertical;
  }

  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  button:focus-visible {
    outline-color: var(--color-focus);
  }

  [aria-invalid='true'] {
    border-color: var(--color-error);
  }

  input:disabled,
  select:disabled,
  textarea:disabled,
  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .field-help {
    min-height: 1lh;
  }

  .curriculum-action,
  .quiet-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    width: 100%;
    padding-inline: var(--space-sm);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--dur-micro) var(--ease-out),
      transform var(--dur-micro) var(--ease-out);
  }

  .curriculum-action {
    margin-block-start: var(--space-xs);
    background: var(--color-ink);
    color: var(--color-paper);
    font-weight: 700;
  }

  .quiet-action {
    background: var(--color-paper);
    color: var(--color-accent-text);
  }

  .preview-heading .quiet-action {
    width: auto;
  }

  .curriculum-action:active,
  .quiet-action:active {
    transform: translateY(1px);
  }

  .curriculum-action.loading {
    cursor: progress;
  }

  .objective-list {
    display: grid;
    max-height: 22rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border-block: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .objective-list:focus-visible,
  .curriculum-diff:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .objective-list li {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr);
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .objective-list li:last-child {
    border-block-end: 0;
  }

  .objective-list li > span:first-child {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .objective-list .depth-two {
    padding-inline-start: var(--space-md);
  }

  .objective-list .depth-three {
    padding-inline-start: var(--space-xl);
    color: var(--color-muted);
  }

  .conflict-heading,
  .applied-state {
    justify-content: flex-start;
  }

  .state-icon,
  .message-icon {
    display: inline-flex;
    flex: 0 0 auto;
  }

  .state-icon {
    color: var(--color-accent-text);
  }

  .curriculum-diff {
    max-height: 16rem;
    overflow: auto;
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
  }

  .curriculum-diff div {
    display: grid;
    grid-template-columns: 1.25rem minmax(0, 1fr);
    gap: var(--space-xs);
    padding: var(--space-2xs) var(--space-xs);
    color: var(--color-ink);
  }

  .curriculum-diff .added {
    color: var(--color-success);
  }

  .curriculum-diff .removed {
    color: var(--color-error);
  }

  .curriculum-diff code {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .conflict-actions {
    display: grid;
    gap: var(--space-xs);
  }

  .curriculum-feedback {
    min-height: 1.5rem;
  }

  .curriculum-message {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    color: var(--color-error);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  @media (hover: hover) and (pointer: fine) {
    input:hover,
    select:hover,
    textarea:hover,
    .quiet-action:hover {
      background: var(--color-paper-2);
      color: var(--color-ink);
    }

    .curriculum-action:hover {
      transform: translateY(-1px);
    }
  }

  @media (min-width: 40rem) {
    .conflict-actions {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .curriculum-action,
    .quiet-action {
      transition-duration: 150ms;
    }

    .curriculum-action:hover,
    .curriculum-action:active,
    .quiet-action:active {
      transform: none;
    }
  }
</style>
