<script lang="ts">
  import { AlertTriangle, BookMarked, Eye, Search, X } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    addSource,
    buildResearchQuery,
    createMsLearnProvider,
    dismissSuggestion,
    filterResearchSuggestions,
    readTopicProgress,
    researchProviders,
    wikipediaProvider,
    type CompanionResearchClient,
    type ResearchCandidate,
    type ResearchCapture,
    type ResearchProvider,
    type ResearchProviderId,
    type RoadmapObjective,
    type StorageAdapter,
  } from '@dusori/core';

  import MarkdownView from './MarkdownView.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let onSourceSaved: () => void = () => undefined;
  export let companion: CompanionResearchClient | null = null;

  $: providers = companion
    ? [
        createMsLearnProvider({ ranked: (query) => companion.searchMsLearnRanked(query) }),
        wikipediaProvider,
      ]
    : [...researchProviders];

  const networkAlternative =
    'Search needs a network connection. Paste text or add a URL reference from the source library instead.';

  let objectives: RoadmapObjective[] = [];
  let objectiveIndex = 0;
  let loadingObjectives = true;
  let loadingProvider: ResearchProviderId | null = null;
  let searchedProvider: ResearchProviderId | null = null;
  let results: ResearchCandidate[] = [];
  let searchErrors: Partial<Record<ResearchProviderId, string>> = {};
  let actionError: { key: string; message: string } | null = null;
  let previewingKey = '';
  let consentProvider: ResearchProvider | null = null;
  let consentInvoker: HTMLButtonElement | null = null;
  let consentAllowButton: HTMLButtonElement;
  let preview: {
    candidate: ResearchCandidate;
    capture: ResearchCapture;
    provider: ResearchProvider;
  } | null = null;
  let previewInvoker: HTMLButtonElement | null = null;
  let previewCloseButton: HTMLButtonElement;
  let adding = false;
  let previewError = '';

  $: selectedObjective = objectives.find((objective) => objective.index === objectiveIndex) ?? null;

  onMount(() => {
    void loadObjectives();
  });

  async function loadObjectives(): Promise<void> {
    loadingObjectives = true;
    try {
      const progress = await readTopicProgress(storage, topicSlug);
      objectives = progress.objectives;
      objectiveIndex = progress.nextObjective?.index ?? progress.objectives[0]?.index ?? 0;
    } catch {
      objectives = [];
    } finally {
      loadingObjectives = false;
    }
  }

  function consentKey(provider: ResearchProvider): string {
    return `dusori-research-consent:${provider.id}`;
  }

  function hasConsent(provider: ResearchProvider): boolean {
    try {
      return localStorage.getItem(consentKey(provider)) === 'allowed';
    } catch {
      return false;
    }
  }

  async function requestSearch(
    provider: ResearchProvider,
    invoker: HTMLButtonElement,
  ): Promise<void> {
    if (!selectedObjective) return;
    if (hasConsent(provider)) {
      await searchProvider(provider);
      return;
    }
    consentProvider = provider;
    consentInvoker = invoker;
    await tick();
    consentAllowButton?.focus();
  }

  async function allowSearch(): Promise<void> {
    if (!consentProvider) return;
    const provider = consentProvider;
    try {
      localStorage.setItem(consentKey(provider), 'allowed');
    } catch {
      searchErrors = { ...searchErrors, [provider.id]: networkAlternative };
      return;
    }
    consentProvider = null;
    await searchProvider(provider);
  }

  async function declineSearch(): Promise<void> {
    consentProvider = null;
    await tick();
    consentInvoker?.focus();
    consentInvoker = null;
  }

  async function searchProvider(provider: ResearchProvider): Promise<void> {
    if (!selectedObjective) return;
    loadingProvider = provider.id;
    searchedProvider = provider.id;
    searchErrors = { ...searchErrors, [provider.id]: '' };
    actionError = null;
    results = [];
    try {
      const candidates = await provider.search(
        buildResearchQuery(topicTitle, selectedObjective),
        fetch,
      );
      results = await filterResearchSuggestions(storage, topicSlug, candidates);
    } catch {
      searchErrors = { ...searchErrors, [provider.id]: networkAlternative };
    } finally {
      loadingProvider = null;
      consentInvoker = null;
    }
  }

  function providerFor(candidate: ResearchCandidate): ResearchProvider {
    return providers.find((provider) => provider.id === candidate.provider)!;
  }

  function metadata(candidate: ResearchCandidate): string {
    if (candidate.provider === 'mslearn') {
      return [
        candidate.meta.duration_in_minutes ? `${candidate.meta.duration_in_minutes} min` : '',
        candidate.meta.levels ?? '',
        candidate.meta.products ?? '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    return [
      candidate.meta.wordcount ? `${candidate.meta.wordcount} words` : '',
      candidate.meta.size ? `${candidate.meta.size} bytes` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  async function openPreview(
    candidate: ResearchCandidate,
    invoker: HTMLButtonElement,
  ): Promise<void> {
    const provider = providerFor(candidate);
    previewingKey = candidate.key;
    actionError = null;
    try {
      const capture = await provider.capture(candidate, fetch);
      preview = { candidate, capture, provider };
      previewInvoker = invoker;
      previewError = '';
      await tick();
      previewCloseButton?.focus();
    } catch {
      actionError = { key: candidate.key, message: networkAlternative };
    } finally {
      previewingKey = '';
    }
  }

  async function closePreview(restoreFocus = true): Promise<void> {
    preview = null;
    previewError = '';
    await tick();
    if (restoreFocus) previewInvoker?.focus();
    previewInvoker = null;
  }

  async function addPreviewToSources(): Promise<void> {
    if (!preview) return;
    adding = true;
    previewError = '';
    try {
      await addSource(storage, {
        content: preview.capture.content,
        method: 'url',
        origin: {
          capturedAt: new Date().toISOString(),
          capturedVia: preview.provider.id === 'mslearn' ? 'catalog-reference' : 'api-extract',
          provider: preview.provider.id,
        },
        title: preview.capture.title,
        topicSlug,
        url: preview.capture.url,
      });
      const acceptedKey = preview.candidate.key;
      results = results.filter((candidate) => candidate.key !== acceptedKey);
      onSourceSaved();
      await closePreview(false);
    } catch (caught) {
      previewError =
        caught instanceof Error ? caught.message : 'Dusori could not add this research source.';
    } finally {
      adding = false;
    }
  }

  async function dismiss(candidate: ResearchCandidate): Promise<void> {
    actionError = null;
    try {
      await dismissSuggestion(storage, topicSlug, { key: candidate.key, title: candidate.title });
      results = results.filter((result) => result.key !== candidate.key);
    } catch {
      actionError = {
        key: candidate.key,
        message: 'Dismissal could not be saved. The suggestion is still visible; try again.',
      };
    }
  }

  function handleEscape(): void {
    if (preview) void closePreview();
    else if (consentProvider) void declineSearch();
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && handleEscape()} />

<section
  class="research-panel"
  aria-labelledby="research-title"
  aria-busy={Boolean(loadingProvider)}
>
  <div class="research-heading">
    <div>
      <h2 id="research-title">Research</h2>
      <p>Find a useful next source from the objective you are working on.</p>
    </div>
    <BookMarked aria-hidden="true" size={22} strokeWidth={1.5} />
  </div>

  {#if loadingObjectives}
    <p class="research-empty">Reading the topic roadmap…</p>
  {:else if objectives.length === 0}
    <div class="research-empty">
      <p>No roadmap objectives yet.</p>
      <span>Import a curriculum or add a Markdown task before searching.</span>
    </div>
  {:else}
    <label for="research-objective">Research objective</label>
    <select id="research-objective" bind:value={objectiveIndex} disabled={Boolean(loadingProvider)}>
      {#each objectives as objective (objective.index)}
        <option value={objective.index}>
          {objective.completed ? 'Complete · ' : ''}{objective.title}
        </option>
      {/each}
    </select>

    <div class="provider-actions" aria-label="Research providers">
      {#each providers as provider (provider.id)}
        <div class="provider-action">
          <button
            disabled={Boolean(loadingProvider)}
            onclick={(event) => void requestSearch(provider, event.currentTarget)}
          >
            <Search aria-hidden="true" size={17} />
            {loadingProvider === provider.id
              ? `Searching ${provider.label}…`
              : `Search ${provider.label}`}
          </button>
          {#if searchErrors[provider.id]}
            <p class="action-error" role="alert">{searchErrors[provider.id]}</p>
          {/if}
        </div>
      {/each}
    </div>

    {#if results.length > 0}
      <ol class="result-list" aria-label="Research suggestions">
        {#each results as candidate, index (candidate.key)}
          <li>
            <div class="result-heading">
              <span class="rank" aria-label={`Rank ${index + 1}`}
                >{String(index + 1).padStart(2, '0')}</span
              >
              <div>
                <span class="provider-tag">{providerFor(candidate).label}</span>
                <h3>{candidate.title}</h3>
              </div>
            </div>
            <div class="result-snippet"><MarkdownView content={candidate.snippet} /></div>
            {#if metadata(candidate)}
              <p class="result-meta">{metadata(candidate)}</p>
            {/if}
            <div class="result-actions">
              <button
                disabled={previewingKey === candidate.key}
                onclick={(event) => void openPreview(candidate, event.currentTarget)}
              >
                <Eye aria-hidden="true" size={16} />
                {previewingKey === candidate.key ? 'Preparing…' : 'Preview'}
              </button>
              <button class="quiet" onclick={() => void dismiss(candidate)}>Dismiss</button>
            </div>
            {#if actionError?.key === candidate.key}
              <p class="action-error" role="alert">{actionError.message}</p>
            {/if}
          </li>
        {/each}
      </ol>
    {:else if searchedProvider && !loadingProvider && !searchErrors[searchedProvider]}
      <div class="research-empty">
        <p>No suggestions matched this objective.</p>
        <span>Paste text or add a URL reference from the source library instead.</span>
      </div>
    {:else}
      <div class="research-empty">
        <p>The web stays quiet until you choose a provider.</p>
        <span>Only the selected objective text leaves this device after consent.</span>
      </div>
    {/if}
  {/if}
</section>

{#if consentProvider}
  <div class="dialog-backdrop">
    <dialog open class="research-dialog consent-dialog" aria-labelledby="consent-title">
      <p class="dialog-kicker">Egress disclosure</p>
      <h2 id="consent-title">Allow {consentProvider.label} search?</h2>
      <p>{consentProvider.disclosure}</p>
      <div class="dialog-actions">
        <button class="quiet" onclick={declineSearch}>Keep search off</button>
        <button class="primary" bind:this={consentAllowButton} onclick={allowSearch}
          >Allow search</button
        >
      </div>
    </dialog>
  </div>
{/if}

{#if preview}
  <div class="dialog-backdrop">
    <dialog open class="research-dialog preview-dialog" aria-labelledby="preview-title">
      <div class="preview-heading">
        <div>
          <p class="dialog-kicker">{preview.provider.label}</p>
          <h2 id="preview-title">Preview research source</h2>
        </div>
        <button
          class="icon-action"
          bind:this={previewCloseButton}
          aria-label="Close preview"
          onclick={() => void closePreview()}
        >
          <X aria-hidden="true" size={19} />
        </button>
      </div>
      <div class="rendered-preview"><MarkdownView content={preview.capture.content} /></div>
      <div class="source-markdown">
        <p>Source markdown</p>
        <pre>{preview.capture.content}</pre>
      </div>
      {#if previewError}
        <p class="dialog-error" role="alert">
          <AlertTriangle aria-hidden="true" size={17} />
          <span>{previewError}</span>
        </p>
      {/if}
      <div class="dialog-actions">
        <button class="quiet" disabled={adding} onclick={() => void closePreview()}
          >Close preview</button
        >
        <button class="primary" disabled={adding} onclick={addPreviewToSources}>
          {adding ? 'Adding source…' : 'Add to sources'}
        </button>
      </div>
    </dialog>
  </div>
{/if}

<style>
  .research-panel {
    display: grid;
    gap: var(--space-lg);
  }

  .research-heading,
  .result-heading,
  .preview-heading {
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
    font-family: var(--font-display);
    line-height: 1.2;
  }

  h2 {
    font-size: var(--text-md);
  }

  h3 {
    margin-block-start: var(--space-2xs);
    font-size: var(--text-base);
  }

  .research-heading p,
  .research-empty span {
    display: block;
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  label {
    margin-block-end: calc(-1 * var(--space-md));
    font-size: var(--text-sm);
    font-weight: 700;
  }

  select,
  button {
    min-width: 0;
    min-height: calc(var(--space-xl) + var(--space-2xs));
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    font: inherit;
  }

  select {
    width: 100%;
    padding: var(--space-xs) var(--space-sm);
    background: var(--color-paper);
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    cursor: pointer;
    background: var(--color-ink);
    color: var(--color-paper);
    font-weight: 700;
  }

  select:focus-visible,
  button:focus-visible {
    outline-color: var(--color-focus);
  }

  button:disabled,
  select:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .provider-actions,
  .provider-action,
  .result-list,
  .result-actions,
  .source-markdown {
    display: grid;
    gap: var(--space-xs);
  }

  .provider-action > button {
    width: 100%;
  }

  .research-empty {
    padding-block: var(--space-sm);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .research-empty p {
    font-weight: 700;
  }

  .result-list {
    margin: 0;
    padding: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
    list-style: none;
  }

  .result-list > li {
    display: grid;
    gap: var(--space-sm);
    padding-block: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .result-heading {
    justify-content: flex-start;
  }

  .rank {
    flex: 0 0 auto;
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .provider-tag,
  .dialog-kicker,
  .source-markdown > p {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .result-snippet {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .result-snippet :global(.markdown p) {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .result-meta {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .result-actions {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  button.quiet,
  .icon-action {
    background: var(--color-paper);
    color: var(--color-accent-text);
  }

  .action-error,
  .dialog-error {
    color: var(--color-error);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .dialog-backdrop {
    position: fixed;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--page-gutter);
    inset: 0;
    background: color-mix(in oklch, var(--color-ink) 72%, transparent);
  }

  .research-dialog {
    position: relative;
    display: grid;
    width: min(42rem, 100%);
    max-height: calc(100dvh - (2 * var(--page-gutter)));
    padding: var(--space-lg);
    overflow: auto;
    margin: 0;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-paper);
    box-shadow: 0 var(--space-sm) var(--space-xl)
      color-mix(in oklch, var(--color-ink) 24%, transparent);
    gap: var(--space-lg);
  }

  .consent-dialog {
    max-width: 34rem;
  }

  .consent-dialog > p:not(.dialog-kicker) {
    color: var(--color-muted);
    line-height: 1.6;
  }

  .dialog-actions {
    display: grid;
    gap: var(--space-xs);
  }

  .dialog-actions button {
    width: 100%;
  }

  .icon-action {
    width: calc(var(--space-xl) + var(--space-2xs));
    padding: 0;
  }

  .rendered-preview {
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .rendered-preview :global(.markdown h1) {
    font-size: var(--text-lg);
  }

  .rendered-preview :global(.markdown h2) {
    margin-block-start: var(--space-lg);
    font-size: var(--text-md);
  }

  .rendered-preview :global(.markdown p),
  .rendered-preview :global(.markdown li) {
    font-size: var(--text-sm);
  }

  pre {
    max-height: 16rem;
    margin: 0;
    padding: var(--space-md);
    overflow: auto;
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
    color: var(--color-ink);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .dialog-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
  }

  @media (hover: hover) and (pointer: fine) {
    button.quiet:hover,
    .icon-action:hover,
    select:hover {
      background: var(--color-paper-2);
      color: var(--color-ink);
    }

    button:not(.quiet, .icon-action):hover {
      transform: translateY(-1px);
    }
  }

  @media (min-width: 40rem) {
    .dialog-actions {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    button:hover {
      transform: none;
    }
  }
</style>
