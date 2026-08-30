<script lang="ts">
  import { AlertTriangle, Check, FilePlus2, RotateCcw, Trash2 } from '@lucide/svelte';
  import {
    addSource,
    citationIdentifierText,
    evidenceClaims,
    lensFor,
    maxSourceBytes,
    normalizeTags,
    readSourceManifest,
    readSourcesIntoClaims,
    recordActiveResearchSynthesisOutcome,
    recordResearchThreadEvent,
    recordSourceFetchFailure,
    removeSourceFromResearch,
    restoreSourceToResearch,
    upgradeSource,
    writeTopicSynthesis,
    type CompanionFetchError,
    type CompanionResearchClient,
    type MissionLens,
    type RemovedSource,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';

  import { createLatestRequestGate } from '$lib/latest-request';
  import { handleExternalLink } from '$lib/open-external';
  import {
    filterSavedSources,
    sourceFilterCounts,
    type SourceShelfFilter,
  } from '$lib/source-reading';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle = topicSlug;
  export let companion: CompanionResearchClient | null = null;
  export let revision = 0;
  export let onSourceSaved: () => void = () => undefined;
  export let onOpenSource: (path: string) => void = () => undefined;

  let method: 'paste' | 'file' | 'url' = 'paste';
  let extracting = false;
  let title = '';
  let sourceTagsText = '';
  let pastedText = '';
  let url = '';
  let selectedFile: File | null = null;
  let sources: SourceRecord[] = [];
  let removedSources: RemovedSource[] = [];
  let loading = true;
  let saving = false;
  let error = '';
  let success = '';
  let sourceQuery = '';
  let shelfFilter: SourceShelfFilter = 'all';
  let shelfTopicSlug = '';
  let addSourceDetails: HTMLDetailsElement;

  let fetchingSha = '';
  let upgradeError = '';
  let removingSha = '';
  let restoringSha = '';
  const refreshGate = createLatestRequestGate();

  type SourceGroupId = MissionLens | 'manual';
  const sourceGroupOrder: readonly SourceGroupId[] = [
    'academic',
    'docs',
    'books',
    'community',
    'video',
    'web',
    'manual',
  ];
  const sourceGroupCopy: Record<SourceGroupId, { description: string; label: string }> = {
    academic: { description: 'Papers, abstracts, and scholarly indexes', label: 'Academic' },
    books: { description: 'Books, catalogs, and long-form references', label: 'Books' },
    community: { description: 'Practitioner discussion and field experience', label: 'Community' },
    docs: {
      description: 'Official documentation and primary repositories',
      label: 'Documentation',
    },
    manual: { description: 'Text, files, and links you added yourself', label: 'Your material' },
    video: { description: 'Talks, lectures, and captioned media', label: 'Video' },
    web: { description: 'General web references and reporting', label: 'Web' },
  };

  $: filterCounts = sourceFilterCounts(sources);
  $: visibleSources = filterSavedSources(sources, sourceQuery, shelfFilter);
  $: visibleSourceGroups = sourceGroupOrder
    .map((id) => ({
      ...sourceGroupCopy[id],
      id,
      sources: visibleSources.filter((source) => sourceGroupFor(source) === id),
    }))
    .filter((group) => group.sources.length > 0);
  $: resetShelfForTopic(topicSlug);

  function resetShelfForTopic(slug: string): void {
    if (slug === shelfTopicSlug) return;
    shelfTopicSlug = slug;
    sourceQuery = '';
    shelfFilter = 'all';
  }

  function hostOf(record: SourceRecord): string {
    try {
      return new URL(record.url ?? '').host;
    } catch {
      return '';
    }
  }

  function sourceGroupFor(record: SourceRecord): SourceGroupId {
    return record.origin ? lensFor(record.origin.provider) : 'manual';
  }

  function clearFeedback(): void {
    error = '';
    success = '';
    upgradeError = '';
  }

  async function recordSavedSourceActivity(record: SourceRecord): Promise<string> {
    try {
      await recordResearchThreadEvent(storage, topicSlug, {
        readState: record.readState,
        sourcePath: record.path,
        sourceSha256: record.sha256,
        type: 'source-saved',
      });
      return '';
    } catch {
      return ' The source was saved, but thread activity could not be updated.';
    }
  }

  async function recordReadActivity(
    read: Awaited<ReturnType<typeof readSourcesIntoClaims>>['read'],
  ): Promise<string> {
    try {
      for (const source of read) {
        await recordResearchThreadEvent(storage, topicSlug, {
          claimCount: source.claims,
          sourceContentSha256: source.sourceContentSha256,
          sourcePath: source.path,
          sourceSha256: source.sourceSha256,
          type: 'source-read',
        });
      }
      return '';
    } catch {
      return ' Thread activity could not be updated.';
    }
  }

  async function openExternal(event: MouseEvent, externalUrl: string): Promise<void> {
    try {
      await handleExternalLink(event, externalUrl);
    } catch (caught) {
      upgradeError =
        caught instanceof Error ? caught.message : 'The system browser could not open this URL.';
    }
  }

  async function fetchSource(record: SourceRecord): Promise<void> {
    if (!companion || fetchingSha || !record.url) return;
    fetchingSha = record.sha256;
    clearFeedback();
    try {
      let page;
      try {
        page = await companion.fetchPage(record.url);
      } catch (caught) {
        const typed = caught as CompanionFetchError;
        const message =
          caught instanceof Error
            ? caught.message
            : 'The page could not be read. Dusori kept the reference.';
        try {
          await recordSourceFetchFailure(storage, {
            message,
            sha256: record.sha256,
            state: ['access-denied', 'blocked-host', 'redirect-host'].includes(typed.reason)
              ? 'blocked'
              : 'failed',
            ...(typed.status === undefined ? {} : { status: typed.status }),
            topicSlug,
          });
          await refresh();
        } catch {
          // The original page failure is still the most useful message.
        }
        upgradeError = message;
        return;
      }

      const itemFile = record.path ? await storage.read(record.path) : null;
      if (!itemFile) {
        upgradeError = 'The page was read, but this source file is missing. Reload and try again.';
        return;
      }
      let upgradeWarning = '';
      try {
        const upgraded = await upgradeSource(storage, {
          expectedContentHash: itemFile.hash,
          page,
          sha256: record.sha256,
          topicSlug,
        });
        upgradeWarning = upgraded.warning ?? '';
        upgradeWarning += await recordSavedSourceActivity(upgraded.record);
        if (!upgraded.indexed) {
          await refresh().catch(() => undefined);
          success =
            upgraded.warning ??
            'Readable text was saved locally, but the source index could not be updated.';
          onSourceSaved();
          if (record.path) onOpenSource(record.path);
          return;
        }
      } catch (caught) {
        upgradeError =
          caught instanceof Error
            ? `The page was read, but its text could not be saved: ${caught.message}`
            : 'The page was read, but its text could not be saved.';
        return;
      }

      await refresh().catch(() => undefined);
      success = `Readable text saved from ${hostOf(record)}.${upgradeWarning ? ` ${upgradeWarning}` : ''}`;
      onSourceSaved();
      if (record.path) onOpenSource(record.path);

      try {
        const read = await readSourcesIntoClaims(storage, topicSlug);
        const threadWarning = await recordReadActivity(read.read);
        const claims = read.read.reduce((total, entry) => total + entry.claims, 0);
        if (claims > 0) {
          const synthesis = await writeTopicSynthesis(storage, topicSlug, topicTitle);
          await recordActiveResearchSynthesisOutcome(
            storage,
            topicSlug,
            synthesis.status === 'written' ? 'written' : 'proposed',
            new Date(),
            synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
          );
          success =
            synthesis.status === 'written'
              ? `Readable text saved from ${hostOf(record)}. The research brief is current.${upgradeWarning ? ` ${upgradeWarning}` : ''}${threadWarning}`
              : `Readable text saved from ${hostOf(record)}. Your edited brief was kept; a refreshed proposal is waiting in Needs attention.${upgradeWarning ? ` ${upgradeWarning}` : ''}${threadWarning}`;
        }
      } catch (caught) {
        upgradeError =
          caught instanceof Error
            ? `Readable text was saved, but the brief could not refresh yet: ${caught.message}`
            : 'Readable text was saved, but the brief could not refresh yet.';
      }
    } finally {
      fetchingSha = '';
    }
  }

  async function removeFromResearch(record: SourceRecord): Promise<void> {
    if (removingSha) return;
    removingSha = record.sha256;
    clearFeedback();
    try {
      const result = await removeSourceFromResearch(storage, {
        sha256: record.sha256,
        topicSlug,
      });
      await refresh().catch(() => undefined);
      success = `${record.title} was removed from active research. Its local item is retained for Restore.${result.warning ? ` ${result.warning}` : ''}`;
      onSourceSaved();
      try {
        const read = await readSourcesIntoClaims(storage, topicSlug);
        if (read.read.length > 0) {
          const synthesis = await writeTopicSynthesis(storage, topicSlug, topicTitle);
          await recordActiveResearchSynthesisOutcome(
            storage,
            topicSlug,
            synthesis.status === 'written' ? 'written' : 'proposed',
            new Date(),
            synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
          );
        }
      } catch (caught) {
        upgradeError =
          caught instanceof Error
            ? `The source was removed, but the brief could not refresh yet: ${caught.message}`
            : 'The source was removed, but the brief could not refresh yet.';
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'This source could not be removed.';
    } finally {
      removingSha = '';
    }
  }

  async function restoreRemoved(entry: RemovedSource): Promise<void> {
    if (restoringSha) return;
    restoringSha = entry.record.sha256;
    clearFeedback();
    try {
      const result = await restoreSourceToResearch(storage, {
        sha256: entry.record.sha256,
        topicSlug,
      });
      await refresh().catch(() => undefined);
      success = `${entry.record.title} was restored to active research.${result.warning ? ` ${result.warning}` : ''}`;
      onSourceSaved();
      try {
        await readSourcesIntoClaims(storage, topicSlug);
        const synthesis = await writeTopicSynthesis(storage, topicSlug, topicTitle);
        await recordActiveResearchSynthesisOutcome(
          storage,
          topicSlug,
          synthesis.status === 'written' ? 'written' : 'proposed',
          new Date(),
          synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
        );
      } catch (caught) {
        upgradeError =
          caught instanceof Error
            ? `The source was restored, but the brief could not refresh yet: ${caught.message}`
            : 'The source was restored, but the brief could not refresh yet.';
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'This source could not be restored.';
    } finally {
      restoringSha = '';
    }
  }

  $: void refreshForRevision(revision, storage, topicSlug);

  async function refreshForRevision(
    currentRevision: number,
    currentStorage: StorageAdapter,
    currentTopicSlug: string,
  ): Promise<void> {
    if (currentRevision < 0) return;
    await refresh(currentStorage, currentTopicSlug);
  }

  async function refresh(
    currentStorage: StorageAdapter = storage,
    currentTopicSlug: string = topicSlug,
  ): Promise<void> {
    const request = refreshGate.begin();
    loading = true;
    try {
      const manifest = await readSourceManifest(currentStorage, currentTopicSlug);
      const nextSources = manifest.sources;
      if (!refreshGate.isCurrent(request)) return;
      error = '';
      sources = nextSources;
      removedSources = manifest.removedSources ?? [];
    } catch (caught) {
      if (!refreshGate.isCurrent(request)) return;
      error = caught instanceof Error ? caught.message : 'Dusori could not read these sources.';
    } finally {
      if (refreshGate.isCurrent(request)) loading = false;
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
      const tags = normalizeTags(sourceTagsText.split(/[,\s]+/u));
      let result;
      if (method === 'paste') {
        result = await addSource(storage, {
          content: pastedText,
          method,
          ...(tags.length ? { tags } : {}),
          title,
          topicSlug,
        });
      } else if (method === 'url') {
        result = await addSource(storage, {
          method,
          ...(tags.length ? { tags } : {}),
          title,
          topicSlug,
          url,
        });
      } else {
        if (!selectedFile) throw new Error('Choose a Markdown, text, or PDF file to add.');
        if (selectedFile.size > maxSourceBytes) {
          throw new Error('This source is larger than 2 MiB. Split it into smaller files.');
        }
        const markdown = /\.(?:markdown|md)$/iu.test(selectedFile.name);
        const pdf = /\.pdf$/iu.test(selectedFile.name);
        const text = /\.(?:markdown|md|txt)$/iu.test(selectedFile.name);
        if (!text && !pdf) throw new Error('Choose a .md, .markdown, .txt, or .pdf file.');

        let content: string;
        if (pdf) {
          extracting = true;
          try {
            // Local extraction: the file never leaves the device, and a scan without a text
            // layer reports that cause instead of saving an empty source.
            const { extractPdfText } = await import('$lib/pdf-text');
            content = await extractPdfText(selectedFile);
          } finally {
            extracting = false;
          }
          if (new TextEncoder().encode(content).byteLength > maxSourceBytes) {
            throw new Error(
              'The text in this PDF is larger than 2 MiB. Add the chapters you need separately.',
            );
          }
        } else {
          content = await selectedFile.text();
        }

        result = await addSource(storage, {
          content,
          mediaType: markdown ? 'text/markdown' : 'text/plain',
          method,
          originalName: selectedFile.name,
          ...(tags.length ? { tags } : {}),
          title,
          topicSlug,
        });
      }

      await refresh();
      sourceTagsText = '';
      // The write already succeeded. refresh() sets `error` on its own when the read-back
      // fails, and `error` outranks `success` in the feedback region, so clear it here to
      // avoid reporting a completed add as a failure.
      error = '';
      success = result.deduplicated
        ? result.upgraded
          ? `Readable text was added to the saved source.${result.warning ? ` ${result.warning}` : ''}`
          : 'That source is already in this topic.'
        : `Source added to this topic.${result.warning ? ` ${result.warning}` : ' The activity log was updated.'}`;
      if (!result.deduplicated || result.restored || result.upgraded) {
        success += await recordSavedSourceActivity(result.record);
        title = '';
        pastedText = '';
        url = '';
        selectedFile = null;
        addSourceDetails.open = false;
        onSourceSaved();
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
    const evidence =
      source.method !== 'url'
        ? methodLabel(source)
        : source.readState === 'read'
          ? 'Read evidence'
          : source.readState === 'readable'
            ? 'Readable evidence'
            : 'URL reference';
    const origin = source.publisher ?? source.origin?.provider;
    const evidenceCount = evidenceClaims(source).length;
    const claims = evidenceCount
      ? ` · ${evidenceCount} quoted ${evidenceCount === 1 ? 'passage' : 'passages'}`
      : '';
    return `${evidence}${origin ? ` · ${origin}` : ''}${claims}${size}`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KiB`;
  }
</script>

<section
  class="source-library"
  aria-labelledby="source-library-title"
  aria-busy={loading || saving}
>
  <div class="source-heading">
    <div>
      <h2 id="source-library-title">Saved sources</h2>
      <p>
        Keep the material beside your notes. Manual URLs stay as references until you choose Read;
        consented providers may return readable abstracts, READMEs, or extracts that Dusori saves
        locally. Dusori never fetches arbitrary result pages automatically.
      </p>
    </div>
    <span class="source-count" aria-label={`${sources.length} saved sources`}>{sources.length}</span
    >
  </div>

  <details class="add-source-details" bind:this={addSourceDetails}>
    <summary>Add your own source</summary>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label for="source-method">Source type</label>
      <select id="source-method" bind:value={method} disabled={saving} onchange={changeMethod}>
        <option value="paste">Pasted text</option>
        <option value="file">Local file</option>
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

      <label for="source-tags">Tags <span class="optional">optional</span></label>
      <input
        id="source-tags"
        bind:value={sourceTagsText}
        maxlength="400"
        disabled={saving}
        placeholder="evidence, cloud/design"
        aria-describedby="source-tags-help"
      />
      <p class="field-help" id="source-tags-help">
        Comma or space separated. Tags create views; the source stays in this topic.
      </p>

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
        <span class="field-label">Markdown, text, or PDF file</span>
        <label class="file-picker" class:has-file={selectedFile}>
          <FilePlus2 aria-hidden="true" size={18} />
          <span>{selectedFile?.name ?? 'Choose a local file'}</span>
          <input
            type="file"
            accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
            disabled={saving}
            onchange={chooseFile}
          />
        </label>
        <p class="field-help">
          .md, .markdown, .txt, or .pdf · up to 2 MiB. A PDF is read on this device; a scanned PDF
          with no text layer cannot be read, as Dusori ships no OCR.
        </p>
        {#if extracting}
          <p class="field-help" aria-live="polite">Reading the PDF on this device…</p>
        {/if}
      {/if}

      <button class="add-source" disabled={saving || loading}>
        {saving ? 'Saving source…' : 'Save source'}
      </button>
    </form>
  </details>

  <div class="source-feedback" aria-live="polite">
    {#if upgradeError}
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

  {#if !loading && sources.length > 0}
    <div class="source-tools">
      <label for="source-search">Find a saved source</label>
      <input
        id="source-search"
        type="search"
        bind:value={sourceQuery}
        placeholder="Title, identifier, publisher, provider, or host"
      />
      <div class="source-filters" role="group" aria-label="Filter saved sources">
        <button
          type="button"
          aria-pressed={shelfFilter === 'all'}
          onclick={() => (shelfFilter = 'all')}>All <span>{filterCounts.all}</span></button
        >
        <button
          type="button"
          aria-pressed={shelfFilter === 'evidence'}
          onclick={() => (shelfFilter = 'evidence')}
          >Evidence <span>{filterCounts.evidence}</span></button
        >
        <button
          type="button"
          aria-pressed={shelfFilter === 'references'}
          onclick={() => (shelfFilter = 'references')}
          >References <span>{filterCounts.references}</span></button
        >
      </div>
      <p class="source-results" aria-live="polite">
        {visibleSources.length === sources.length && !sourceQuery.trim()
          ? `${sources.length} ${sources.length === 1 ? 'source' : 'sources'} on this shelf.`
          : `${visibleSources.length} of ${sources.length} sources shown.`}
      </p>
    </div>
  {/if}

  {#if loading}
    <p class="source-empty">Reading saved sources…</p>
  {:else if sources.length === 0}
    <div class="source-empty">
      <p>No sources yet.</p>
      <span>Add text, a local file, or a URL reference above.</span>
    </div>
  {:else if visibleSources.length === 0}
    <div class="source-empty">
      <p>No sources match this view.</p>
      <span>Change the search or evidence filter; nothing was removed.</span>
    </div>
  {:else}
    <ul class="source-groups" aria-label="Saved sources">
      {#each visibleSourceGroups as group (group.id)}
        <li class="source-group">
          <header>
            <div>
              <h3 id={`source-group-${group.id}`}>{group.label}</h3>
              <p>{group.description}</p>
            </div>
            <span>{group.sources.length}</span>
          </header>
          <div class="source-list" role="list" aria-labelledby={`source-group-${group.id}`}>
            {#each group.sources as source (source.sha256)}
              <article role="listitem">
                {#if source.path}
                  <button class="source-title" onclick={() => onOpenSource(source.path!)}>
                    {source.title}
                  </button>
                {:else}
                  <strong>{source.title}</strong>
                {/if}
                <span>{sourceDetail(source)}</span>
                {#if source.whySelected?.length}
                  <p class="source-reason">Saved because {source.whySelected.join(' · ')}</p>
                {/if}
                {#if source.tags?.length}
                  <p class="source-tags" aria-label="Source tags">
                    {source.tags.map((tag) => `#${tag}`).join(' · ')}
                  </p>
                {/if}
                {#if source.citation?.identifiers.length}
                  <p class="source-identifiers" aria-label="Citation identifiers">
                    {source.citation.identifiers.map(citationIdentifierText).join(' · ')}
                  </p>
                {/if}
                {#if source.fetchMessage}
                  <p class="source-row-error" role="status">{source.fetchMessage}</p>
                {/if}
                {#if source.url}
                  <a
                    class="original-link"
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    onclick={(event) => void openExternal(event, source.url!)}>Open original</a
                  >
                {/if}
                {#if source.method === 'url' && companion}
                  <button
                    class="upgrade-source"
                    disabled={Boolean(fetchingSha) || saving}
                    onclick={() => void fetchSource(source)}
                  >
                    {fetchingSha === source.sha256 ? 'Reading…' : `Read from ${hostOf(source)}`}
                  </button>
                {/if}
                <button
                  class="remove-source"
                  disabled={Boolean(removingSha) || saving}
                  onclick={() => void removeFromResearch(source)}
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {removingSha === source.sha256 ? 'Removing…' : 'Remove from research'}
                </button>
              </article>
            {/each}
          </div>
        </li>
      {/each}
    </ul>
    {#if !companion && sources.some((source) => source.method === 'url')}
      <p class="field-help">
        Run the companion (npx @udhawan97/dusori) to fetch full page content.
      </p>
    {/if}
  {/if}

  {#if removedSources.length > 0}
    <details class="removed-sources">
      <summary
        >{removedSources.length} removed {removedSources.length === 1
          ? 'source'
          : 'sources'}</summary
      >
      <p class="field-help">
        Removed items do not count toward research, claims, synthesis, or Map. Their local source
        files stay in this workspace so Restore still works after a relaunch.
      </p>
      <ul>
        {#each removedSources as entry (entry.record.sha256)}
          <li>
            <span>{entry.record.title}</span>
            <button disabled={Boolean(restoringSha)} onclick={() => void restoreRemoved(entry)}>
              <RotateCcw aria-hidden="true" size={15} />
              {restoringSha === entry.record.sha256 ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<style>
  /* Hallmark · macrostructure: grouped evidence shelf · genre: editorial utility · theme: custom
   * states: default · hover · focus · active · disabled · loading · error · success
   * contrast: pass (40–41) · pre-emit critique: P5 H5 E5 S5 R5 V4 · responsive: pass (49)
   */
  .source-library {
    display: grid;
    gap: var(--space-lg);
  }

  .source-heading {
    order: 0;
  }
  .add-source-details {
    order: 1;
  }
  .source-feedback {
    order: 2;
  }
  .source-tools {
    order: 3;
  }
  .source-groups,
  .source-empty {
    order: 4;
  }
  .removed-sources {
    order: 5;
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
    margin-block-start: var(--space-md);
  }

  .add-source-details,
  .removed-sources {
    border-block-start: var(--rule-hair) solid var(--color-rule);
    padding-block-start: var(--space-sm);
  }

  .add-source-details summary,
  .removed-sources summary {
    min-height: 2.75rem;
    color: var(--color-accent-text);
    cursor: pointer;
    font-weight: 700;
  }

  label,
  .field-label {
    margin-block-start: var(--space-xs);
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .optional {
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 400;
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

  .source-tools {
    display: grid;
    gap: var(--space-xs);
    padding-block: var(--space-md);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .source-tools label {
    margin: 0;
  }

  .source-filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }

  .source-filters button {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 999px;
    background: transparent;
    color: var(--color-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-sm);
  }

  .source-filters button[aria-pressed='true'] {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .source-filters span {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .source-results {
    min-height: 1lh;
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-xs);
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

  .source-groups {
    display: grid;
    gap: var(--space-xl);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .source-group {
    min-width: 0;
  }

  .source-group > header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-md);
    padding-block-end: var(--space-xs);
  }

  .source-group h3,
  .source-group p {
    margin: 0;
  }

  .source-group h3 {
    font-family: var(--font-display);
    font-size: var(--text-md);
  }

  .source-group header p {
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .source-group header > span {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .source-list {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .source-list [role='listitem'] {
    display: grid;
    gap: var(--space-2xs);
    min-width: 0;
    padding-block: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .source-reason {
    max-width: 68ch;
    margin: var(--space-2xs) 0;
    overflow-wrap: anywhere;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .source-tags {
    margin: var(--space-2xs) 0;
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .source-identifiers {
    margin: var(--space-2xs) 0;
    overflow-wrap: anywhere;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .upgrade-source,
  .remove-source,
  .removed-sources button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2xs);
    width: fit-content;
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-xs);
    font-weight: 700;
    white-space: nowrap;
  }

  .remove-source {
    color: var(--color-error);
  }

  .removed-sources ul {
    display: grid;
    gap: var(--space-xs);
    margin: var(--space-sm) 0 0;
    padding: 0;
    list-style: none;
  }

  .removed-sources li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding-block: var(--space-xs);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .source-list strong,
  .source-list .source-title,
  .source-list a {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    color: var(--color-ink);
    font-size: var(--text-sm);
    font-weight: 700;
    white-space: normal;
  }

  .source-row-error {
    margin: 0;
    color: var(--color-error);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .source-title {
    width: 100%;
    min-height: 2.75rem;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: start;
    cursor: pointer;
  }

  .source-list a {
    color: var(--color-accent-text);
    text-underline-offset: 0.2em;
  }

  .source-list .original-link {
    width: max-content;
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .source-list span {
    min-width: 0;
    overflow-wrap: anywhere;
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

    .upgrade-source:hover:not(:disabled) {
      background: var(--color-paper-2);
    }

    .source-filters button:hover:not([aria-pressed='true']) {
      background: var(--color-paper-2);
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
