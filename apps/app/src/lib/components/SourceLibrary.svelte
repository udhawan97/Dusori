<script lang="ts">
  import { AlertTriangle, Check, FilePlus2 } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    StorageConflictError,
    addSource,
    buildUpgradedContent,
    maxSourceBytes,
    readSourceManifest,
    upgradeSource,
    type CompanionResearchClient,
    type FetchedPage,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let companion: CompanionResearchClient | null = null;

  let method: 'paste' | 'file' | 'url' = 'paste';
  let title = '';
  let pastedText = '';
  let url = '';
  let selectedFile: File | null = null;
  let sources: SourceRecord[] = [];
  let loading = true;
  let saving = false;
  let error = '';
  let success = '';

  let confirming: SourceRecord | null = null;
  let confirmFetchButton: HTMLButtonElement;
  let confirmInvoker: HTMLButtonElement | null = null;
  let fetchingSha = '';
  let upgradePreview: {
    content: string;
    expectedContentHash: string;
    page: FetchedPage;
    record: SourceRecord;
  } | null = null;
  let upgradeCloseButton: HTMLButtonElement;
  let replacing = false;
  let upgradeError = '';

  function hostOf(record: SourceRecord): string {
    try {
      return new URL(record.url ?? '').host;
    } catch {
      return '';
    }
  }

  function clearFeedback(): void {
    error = '';
    success = '';
    upgradeError = '';
  }

  async function openConfirm(record: SourceRecord, invoker: HTMLButtonElement): Promise<void> {
    confirming = record;
    confirmInvoker = invoker;
    upgradeError = '';
    await tick();
    confirmFetchButton?.focus();
  }

  async function cancelConfirm(): Promise<void> {
    confirming = null;
    await tick();
    confirmInvoker?.focus();
    confirmInvoker = null;
  }

  async function confirmFetch(): Promise<void> {
    if (!confirming || !companion || fetchingSha) return;
    const record = confirming;
    confirming = null;
    fetchingSha = record.sha256;
    clearFeedback();
    try {
      const page = await companion.fetchPage(record.url ?? '');
      // upgradeSource guards against external edits with the hash we read here.
      const itemFile = record.path ? await storage.read(record.path) : null;
      if (!itemFile) throw new Error('This source file is missing. Reload and try again.');
      upgradePreview = {
        content: buildUpgradedContent(record, page),
        expectedContentHash: itemFile.hash,
        page,
        record,
      };
      await tick();
      upgradeCloseButton?.focus();
    } catch (caught) {
      upgradeError =
        caught instanceof Error ? caught.message : 'The companion could not fetch this page.';
      await tick();
      confirmInvoker?.focus();
      confirmInvoker = null;
    } finally {
      fetchingSha = '';
    }
  }

  async function closeUpgradePreview(): Promise<void> {
    upgradePreview = null;
    await tick();
    confirmInvoker?.focus();
    confirmInvoker = null;
  }

  async function replaceContent(): Promise<void> {
    if (!upgradePreview) return;
    replacing = true;
    clearFeedback();
    try {
      await upgradeSource(storage, {
        expectedContentHash: upgradePreview.expectedContentHash,
        page: upgradePreview.page,
        sha256: upgradePreview.record.sha256,
        topicSlug,
      });
      upgradePreview = null;
      await refresh();
      // The write above already succeeded, so it must be reported as a success
      // even if this read-back failed and left `error` set (feedback renders
      // upgradeError, then error, then success).
      error = '';
      success = 'Source upgraded to full page content and recorded in the update log.';
      await tick();
      confirmInvoker?.focus();
      confirmInvoker = null;
    } catch (caught) {
      upgradeError =
        caught instanceof StorageConflictError
          ? 'This source changed outside Dusori. Review the file, then try again.'
          : caught instanceof Error
            ? caught.message
            : 'Dusori could not upgrade this source.';
    } finally {
      replacing = false;
    }
  }

  function handleEscape(): void {
    if (upgradePreview) {
      if (replacing) return;
      void closeUpgradePreview();
    } else if (confirming) {
      void cancelConfirm();
    }
  }

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    loading = true;
    try {
      sources = (await readSourceManifest(storage, topicSlug)).sources;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not read these sources.';
    } finally {
      loading = false;
    }
  }

  function changeMethod(): void {
    selectedFile = null;
    error = '';
    success = '';
  }

  function chooseFile(event: Event): void {
    selectedFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    error = '';
    success = '';
    if (selectedFile && !title.trim()) {
      title = selectedFile.name.replace(/\.(?:markdown|md|txt)$/iu, '');
    }
  }

  async function submit(): Promise<void> {
    saving = true;
    clearFeedback();
    try {
      let result;
      if (method === 'paste') {
        result = await addSource(storage, {
          content: pastedText,
          method,
          title,
          topicSlug,
        });
      } else if (method === 'url') {
        result = await addSource(storage, { method, title, topicSlug, url });
      } else {
        if (!selectedFile) throw new Error('Choose a Markdown or text file to add.');
        if (selectedFile.size > maxSourceBytes) {
          throw new Error('This source is larger than 2 MiB. Split it into smaller text files.');
        }
        const markdown = /\.(?:markdown|md)$/iu.test(selectedFile.name);
        const text = /\.(?:markdown|md|txt)$/iu.test(selectedFile.name);
        if (!text) throw new Error('Choose a .md, .markdown, or .txt file.');
        result = await addSource(storage, {
          content: await selectedFile.text(),
          mediaType: markdown ? 'text/markdown' : 'text/plain',
          method,
          originalName: selectedFile.name,
          title,
          topicSlug,
        });
      }

      await refresh();
      success = result.deduplicated
        ? 'That source is already in this topic.'
        : 'Source added to this topic and its update log.';
      if (!result.deduplicated) {
        title = '';
        pastedText = '';
        url = '';
        selectedFile = null;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not add this source.';
    } finally {
      saving = false;
    }
  }

  function methodLabel(source: SourceRecord): string {
    if (source.method === 'file') return 'Local file';
    if (source.method === 'url') return 'URL reference';
    return 'Pasted text';
  }

  function sourceDetail(source: SourceRecord): string {
    const size = source.size === undefined ? '' : ` · ${formatBytes(source.size)}`;
    return `${methodLabel(source)}${size}`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && handleEscape()} />

<section
  class="source-library"
  aria-labelledby="source-library-title"
  aria-busy={loading || saving}
>
  <div class="source-heading">
    <div>
      <h2 id="source-library-title">Sources</h2>
      <p>Keep the material beside your notes. URL contents are never fetched automatically.</p>
    </div>
    <span class="source-count" aria-label={`${sources.length} saved sources`}>{sources.length}</span
    >
  </div>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void submit();
    }}
  >
    <label for="source-method">Source type</label>
    <select id="source-method" bind:value={method} disabled={saving} onchange={changeMethod}>
      <option value="paste">Pasted text</option>
      <option value="file">Local text file</option>
      <option value="url">URL reference</option>
    </select>

    <label for="source-title">Source title</label>
    <input
      id="source-title"
      bind:value={title}
      required
      maxlength="160"
      disabled={saving}
      aria-invalid={error && !title.trim() ? 'true' : undefined}
    />

    {#if method === 'paste'}
      <label for="source-text">Source text</label>
      <textarea
        id="source-text"
        bind:value={pastedText}
        required
        maxlength={maxSourceBytes}
        disabled={saving}
        aria-describedby="source-limit"
        aria-invalid={error && !pastedText.trim() ? 'true' : undefined}></textarea>
      <p class="field-help" id="source-limit">Plain text · up to 2 MiB</p>
    {:else if method === 'url'}
      <label for="source-url">Web address</label>
      <input
        id="source-url"
        type="url"
        bind:value={url}
        required
        inputmode="url"
        placeholder="https://example.org/article"
        disabled={saving}
        aria-describedby="url-help"
        aria-invalid={error && !url.trim() ? 'true' : undefined}
      />
      <p class="field-help" id="url-help">Saved as a reference; opened only when you choose.</p>
    {:else}
      <span class="field-label">Markdown or text file</span>
      <label class="file-picker" class:has-file={selectedFile}>
        <FilePlus2 aria-hidden="true" size={18} />
        <span>{selectedFile?.name ?? 'Choose a local file'}</span>
        <input
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          disabled={saving}
          onchange={chooseFile}
        />
      </label>
      <p class="field-help">.md, .markdown, or .txt · up to 2 MiB</p>
    {/if}

    <button class="add-source" disabled={saving || loading}>
      {saving ? 'Adding source…' : 'Add source'}
    </button>
  </form>

  <div class="source-feedback" aria-live="polite">
    <!-- The preview dialog renders upgradeError itself while it is open; showing it
         here too would announce the same failure twice. -->
    {#if upgradeError && !upgradePreview}
      <p class="source-message error" role="alert">
        <AlertTriangle aria-hidden="true" size={17} />
        <span>{upgradeError}</span>
      </p>
    {:else if error}
      <p class="source-message error" role="alert">
        <AlertTriangle aria-hidden="true" size={17} />
        <span>{error}</span>
      </p>
    {:else if success}
      <p class="source-message success">
        <Check aria-hidden="true" size={17} />
        <span>{success}</span>
      </p>
    {/if}
  </div>

  {#if loading}
    <p class="source-empty">Reading saved sources…</p>
  {:else if sources.length === 0}
    <div class="source-empty">
      <p>No sources yet.</p>
      <span>Add text, a local file, or a URL reference above.</span>
    </div>
  {:else}
    <ul class="source-list" aria-label="Saved sources">
      {#each sources as source (source.sha256)}
        <li>
          {#if source.url}
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
          {:else}
            <strong>{source.title}</strong>
          {/if}
          <span>{sourceDetail(source)}</span>
          {#if source.method === 'url' && companion}
            <button
              class="upgrade-source"
              disabled={Boolean(fetchingSha) || saving}
              onclick={(event) =>
                void openConfirm(source, event.currentTarget as HTMLButtonElement)}
            >
              {fetchingSha === source.sha256 ? 'Fetching…' : 'Fetch full content'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !companion && sources.some((source) => source.method === 'url')}
      <p class="field-help">Run the companion (npx dusori) to fetch full page content.</p>
    {/if}
  {/if}
</section>

{#if confirming}
  <div class="dialog-backdrop">
    <dialog open class="upgrade-dialog" aria-labelledby="upgrade-confirm-title">
      <h3 id="upgrade-confirm-title">Fetch full page content?</h3>
      <p>
        Sends this address to {hostOf(confirming)} from your machine via the local companion. The page's
        readable text will replace this source's stub content.
      </p>
      <p class="upgrade-url"><code>{confirming.url}</code></p>
      <div class="upgrade-actions">
        <button
          bind:this={confirmFetchButton}
          class="primary-action"
          onclick={() => void confirmFetch()}
        >
          Fetch page
        </button>
        <button onclick={() => void cancelConfirm()}>Keep reference only</button>
      </div>
    </dialog>
  </div>
{/if}

{#if upgradePreview}
  <div class="dialog-backdrop">
    <dialog open class="upgrade-dialog" aria-labelledby="upgrade-preview-title">
      <h3 id="upgrade-preview-title">Preview fetched content</h3>
      {#if upgradePreview.page.truncated}
        <p>This page was longer than the 2 MiB source limit and was truncated.</p>
      {/if}
      <p>Source markdown</p>
      <pre>{upgradePreview.content}</pre>
      {#if upgradeError}
        <p class="source-message error" role="alert">
          <AlertTriangle aria-hidden="true" size={17} />
          <span>{upgradeError}</span>
        </p>
      {/if}
      <div class="upgrade-actions">
        <button class="primary-action" disabled={replacing} onclick={() => void replaceContent()}>
          {replacing ? 'Replacing…' : 'Replace content'}
        </button>
        <button
          bind:this={upgradeCloseButton}
          disabled={replacing}
          onclick={() => void closeUpgradePreview()}
        >
          Keep the stub
        </button>
      </div>
    </dialog>
  </div>
{/if}

<style>
  /* Hallmark · component: source library · genre: editorial utility · theme: custom
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass · pre-emit critique: P5 H5 E5 S5 R5 V4
   */
  .source-library {
    display: grid;
    gap: var(--space-lg);
  }

  .source-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
    line-height: 1.2;
  }

  .source-heading p {
    margin-block: var(--space-xs) 0;
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .source-count {
    display: grid;
    min-width: 2rem;
    min-height: 2rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 50%;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    place-items: center;
  }

  form {
    display: grid;
    gap: var(--space-xs);
  }

  label,
  .field-label {
    margin-block-start: var(--space-xs);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  input,
  select,
  textarea,
  .file-picker,
  .add-source {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
  }

  input,
  select,
  textarea {
    padding: var(--space-xs) var(--space-sm);
  }

  textarea {
    min-height: 7rem;
    resize: vertical;
  }

  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  .file-picker:focus-within,
  .add-source:focus-visible {
    outline-color: var(--color-focus);
  }

  [aria-invalid='true'] {
    border-color: var(--color-error);
  }

  input:disabled,
  select:disabled,
  textarea:disabled,
  .add-source:disabled,
  .upgrade-source:disabled,
  .upgrade-actions button:disabled,
  .file-picker:has(input:disabled) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .file-picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    cursor: pointer;
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .file-picker span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-picker.has-file {
    border-color: var(--color-accent-text);
  }

  .file-picker input {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .field-help {
    min-height: 1lh;
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .add-source {
    margin-block-start: var(--space-sm);
    padding-inline: var(--space-md);
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
    cursor: pointer;
    font-weight: 700;
    transition:
      background-color var(--dur-short) var(--ease-out),
      transform var(--dur-micro) var(--ease-out);
  }

  .add-source:active {
    transform: translateY(1px);
  }

  .source-feedback {
    min-height: 1lh;
  }

  .source-message {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .source-message :global(svg) {
    flex: 0 0 auto;
    margin-block-start: var(--space-3xs);
  }

  .source-message.error {
    color: var(--color-error);
  }

  .source-message.success {
    color: var(--color-success);
  }

  .source-empty {
    margin: 0;
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .source-empty p {
    margin: 0;
    color: var(--color-ink);
    font-weight: 700;
  }

  .source-empty span {
    display: block;
    margin-block-start: var(--space-2xs);
  }

  .source-list {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .source-list li {
    display: grid;
    gap: var(--space-2xs);
    padding-block: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .source-list strong,
  .source-list a {
    display: block;
    min-width: 0;
    overflow: hidden;
    color: var(--color-ink);
    font-size: var(--text-sm);
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-list a {
    color: var(--color-accent-text);
    text-underline-offset: 0.2em;
  }

  .source-list span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .upgrade-source {
    min-height: 2.75rem;
    padding: var(--space-xs) var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
  }

  .dialog-backdrop {
    position: fixed;
    z-index: var(--z-modal);
    display: grid;
    inset: 0;
    padding: var(--page-gutter);
    background: color-mix(in srgb, var(--color-ink) 72%, transparent);
    place-items: center;
  }

  .upgrade-dialog {
    position: relative;
    width: min(38rem, 100%);
    max-height: calc(100dvh - 2 * var(--page-gutter));
    margin: 0;
    padding: var(--space-lg);
    overflow: auto;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
  }

  .upgrade-dialog pre {
    max-height: 45vh;
    overflow: auto;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .upgrade-url code {
    overflow-wrap: anywhere;
  }

  .upgrade-dialog .source-message {
    margin-block-start: var(--space-sm);
  }

  .upgrade-actions {
    display: flex;
    gap: var(--space-sm);
    margin-block-start: var(--space-md);
    flex-wrap: wrap;
  }

  .upgrade-actions button {
    min-height: 2.75rem;
    padding: var(--space-xs) var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
    font: inherit;
  }

  .upgrade-actions .primary-action {
    background: var(--color-ink);
    color: var(--color-paper);
  }

  @media (hover: hover) and (pointer: fine) {
    input:hover,
    select:hover,
    textarea:hover,
    .file-picker:hover {
      background: var(--color-paper-2);
    }

    .add-source:hover:not(:disabled) {
      background: var(--color-accent-text);
    }

    .upgrade-source:hover:not(:disabled),
    .upgrade-actions button:hover:not(:disabled) {
      background: var(--color-paper-2);
    }

    .upgrade-actions .primary-action:hover:not(:disabled) {
      background: var(--color-accent-text);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .add-source {
      transition-property: background-color;
    }

    .add-source:active {
      transform: none;
    }
  }
</style>
