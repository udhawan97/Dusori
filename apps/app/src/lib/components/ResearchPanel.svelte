<script lang="ts">
  import { AlertTriangle, BookMarked, Check, Eye, Search, Sparkles, X } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    addSource,
    applyAiRerank,
    briefNoteTitle,
    buildAiBrief,
    buildDeterministicBrief,
    buildResearchQuery,
    buildUpgradedContent,
    createNote,
    createResearchProviders,
    dismissSuggestion,
    readTopicProgress,
    runResearchAgent,
    type AiCapability,
    type BriefSource,
    type CompanionAiClient,
    type CompanionResearchClient,
    type RankedCandidate,
    type ResearchCapture,
    type ResearchProvider,
    type ResearchRunResult,
    type RoadmapObjective,
    type StorageAdapter,
  } from '@dusori/core';

  import { modal } from '$lib/actions/modal';
  import { grantConsent, hasConsent as deviceHasConsent } from '$lib/consent';
  import MarkdownView from './MarkdownView.svelte';
  import VideoThumbnail from './VideoThumbnail.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let onSourceSaved: () => void = () => undefined;
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let onAutoStartHandled: () => void = () => undefined;

  // A companion upgrades Microsoft Learn to ranked search and unlocks the two providers the
  // browser cannot reach itself, so the list is built rather than declared.
  $: providers = createResearchProviders({ companion });

  // The AI chip appears only when the companion reports a configured provider; keys stay in
  // the companion's environment and the app only ever learns an id and a model name.
  let aiCapability: AiCapability | null = null;
  $: void readAiCapability(ai);

  async function readAiCapability(client: CompanionAiClient | null): Promise<void> {
    aiCapability = client ? ((await client.capabilities())[0] ?? null) : null;
  }

  // Reuses the provider consent machinery: same storage key shape, same dialog, its own scope.
  const aiConsent: ResearchProvider = {
    capture: () => Promise.reject(new Error('not a search provider')),
    capturedVia: () => 'ai',
    consentScope: 'companion-ai',
    describeMeta: () => '',
    disclosure:
      "Ranking sends each found candidate's title, summary, and address, plus this topic's name and the objective's text, to the AI provider configured in your local companion. Nothing else from your workspace is sent. Allow on this device?",
    id: 'companion-ai',
    label: 'AI ranking',
    // Ranking is the companion's own call to the AI provider; the page reaches nothing.
    origins: [],
    search: () => Promise.resolve([]),
  };

  const networkAlternative =
    'Search needs a network connection. Paste text or add a URL reference from the source library instead.';

  let objectives: RoadmapObjective[] = [];
  let objectiveIndex = 0;
  let loadingObjectives = true;
  let running = false;
  let runResult: ResearchRunResult | null = null;
  let runError = '';
  let showOverflow = false;
  let notices: string[] = [];
  let actionError: { key: string; message: string } | null = null;
  let previewingKey = '';
  let consentProvider: ResearchProvider | null = null;
  let consentInvoker: HTMLButtonElement | null = null;
  let consentAllowButton: HTMLButtonElement;
  let consentTick = 0;
  let preview: {
    candidate: RankedCandidate;
    capture: ResearchCapture;
    provider: ResearchProvider;
  } | null = null;
  let previewInvoker: HTMLButtonElement | null = null;
  let previewCloseButton: HTMLButtonElement;
  let fetchFullContent = true;
  let adding = false;
  let previewError = '';
  let approved: BriefSource[] = [];
  let writingBrief = false;
  let briefPath = '';
  let briefError = '';
  let autoStarted = false;

  $: selectedObjective = objectives.find((objective) => objective.index === objectiveIndex) ?? null;
  $: consented = readConsented(providers, consentTick);
  $: enabledProviders = providers.filter((provider) => consented.has(provider.id));
  $: aiAllowed = readConsented([aiConsent], consentTick).has(aiConsent.id);
  $: shortlist = runResult?.shortlist ?? [];
  $: overflow = runResult?.overflow ?? [];

  onMount(() => {
    void loadObjectives();
  });

  async function loadObjectives(): Promise<void> {
    loadingObjectives = true;
    let nextObjective: RoadmapObjective | null = null;
    try {
      const progress = await readTopicProgress(storage, topicSlug);
      objectives = progress.objectives;
      nextObjective = progress.nextObjective ?? progress.objectives[0] ?? null;
      objectiveIndex = nextObjective?.index ?? 0;
    } catch {
      objectives = [];
    } finally {
      loadingObjectives = false;
    }
    await tick();
    await maybeAutoRun(nextObjective);
  }

  // Keyed by consentScope so a variant that widens egress (companion-ranked search, AI) asks
  // for its own consent rather than inheriting a narrower disclosure's answer.
  function scopeOf(provider: ResearchProvider): string {
    return provider.consentScope ?? provider.id;
  }

  function hasConsent(provider: ResearchProvider): boolean {
    return deviceHasConsent(scopeOf(provider));
  }

  // The tick argument is what re-runs this after a consent is granted; localStorage itself
  // cannot be a reactive dependency.
  function readConsented(list: ResearchProvider[], tick: number): Set<string> {
    void tick;
    return new Set(list.filter(hasConsent).map((provider) => provider.id));
  }

  async function requestConsent(
    provider: ResearchProvider,
    invoker: HTMLButtonElement,
  ): Promise<void> {
    consentProvider = provider;
    consentInvoker = invoker;
    await tick();
    consentAllowButton?.focus();
  }

  async function allowProvider(): Promise<void> {
    if (!consentProvider) return;
    if (grantConsent(scopeOf(consentProvider))) consentTick += 1;
    else runError = networkAlternative;
    consentProvider = null;
    await tick();
    consentInvoker?.focus();
    consentInvoker = null;
    await maybeAutoRun(selectedObjective);
  }

  async function declineProvider(): Promise<void> {
    consentProvider = null;
    await tick();
    consentInvoker?.focus();
    consentInvoker = null;
  }

  async function runWith(
    objective: RoadmapObjective | null,
    providerList: ResearchProvider[],
  ): Promise<void> {
    if (!objective || providerList.length === 0) return;
    running = true;
    runError = '';
    notices = [];
    showOverflow = false;
    actionError = null;
    try {
      const query = buildResearchQuery(topicTitle, objective);
      const result = await runResearchAgent({
        fetchImpl: fetch,
        providers: providerList,
        query,
        storage,
        topicSlug,
      });
      runResult = await withAiRanking(query, result);
    } catch {
      runError = networkAlternative;
      runResult = null;
    } finally {
      running = false;
    }
  }

  async function run(): Promise<void> {
    await runWith(selectedObjective, enabledProviders);
  }

  async function maybeAutoRun(objective: RoadmapObjective | null): Promise<void> {
    const allowedProviders = providers.filter(hasConsent);
    if (!autoStart || autoStarted || !objective || allowedProviders.length === 0 || running) return;
    autoStarted = true;
    onAutoStartHandled();
    await tick();
    await runWith(objective, allowedProviders);
  }

  // Advisory only: the AI reorders and annotates what the deterministic ranker found; a
  // failure keeps the deterministic order and says so, and never fails the run.
  async function withAiRanking(
    query: ReturnType<typeof buildResearchQuery>,
    result: ResearchRunResult,
  ): Promise<ResearchRunResult> {
    if (!ai || !aiCapability || !hasConsent(aiConsent)) return result;
    const candidates = [...result.shortlist, ...result.overflow];
    if (candidates.length === 0) return result;
    try {
      const reranked = applyAiRerank(candidates, await ai.rerank(query, candidates));
      const limit = result.shortlist.length;
      return {
        ...result,
        overflow: reranked.slice(limit),
        shortlist: reranked.slice(0, limit),
      };
    } catch {
      notices = [...notices, 'AI ranking was unavailable; showing the deterministic order.'];
      return result;
    }
  }

  function providerFor(candidate: RankedCandidate): ResearchProvider {
    return providers.find((provider) => provider.id === candidate.provider)!;
  }

  function kindLabel(candidate: RankedCandidate): string {
    const labels: Record<string, string> = {
      article: 'Article',
      course: 'Course',
      docs: 'Docs',
      paper: 'Paper',
      qa: 'Q&A',
      repo: 'Repository',
      video: 'Video',
    };
    return candidate.kind ? (labels[candidate.kind] ?? candidate.kind) : '';
  }

  // A reference stub is worth upgrading to the page's real text; a capture that already holds
  // the content (a Wikipedia extract, a README) is not.
  function isReferenceStub(candidate: RankedCandidate, provider: ResearchProvider): boolean {
    return provider.capturedVia(candidate) === 'search-reference';
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./u, '');
    } catch {
      return url;
    }
  }

  async function openPreview(
    candidate: RankedCandidate,
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
      fetchFullContent = Boolean(companion) && isReferenceStub(candidate, provider);
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
    const { candidate, capture, provider } = preview;
    let content = capture.content;
    // A capture that could only learn what it got by trying (a video's captions) reports it
    // itself; everything else keeps the provider's up-front answer.
    let capturedVia = capture.capturedVia ?? provider.capturedVia(candidate);
    let notice = '';

    if (companion && fetchFullContent && isReferenceStub(candidate, provider)) {
      try {
        const page = await companion.fetchPage(capture.url);
        content = buildUpgradedContent({ title: capture.title, url: capture.url }, page);
        capturedVia = 'page-extract';
      } catch (caught) {
        // The reference is still worth keeping; say plainly that the full text is missing.
        notice = `${capture.title} was saved as a reference. ${
          caught instanceof Error ? caught.message : 'The full page could not be fetched.'
        }`;
      }
    }

    try {
      await addSource(storage, {
        content,
        method: 'url',
        origin: {
          capturedAt: new Date().toISOString(),
          capturedVia,
          provider: provider.id,
        },
        title: capture.title,
        topicSlug,
        url: capture.url,
      });
      approved = [
        ...approved,
        {
          providerLabel: provider.label,
          reasons: candidate.reasons,
          title: capture.title,
          url: capture.url,
          ...(candidate.kind === undefined ? {} : { kind: candidate.kind }),
        },
      ];
      if (runResult) {
        runResult = {
          ...runResult,
          overflow: runResult.overflow.filter((item) => item.key !== candidate.key),
          shortlist: runResult.shortlist.filter((item) => item.key !== candidate.key),
        };
      }
      if (notice) notices = [...notices, notice];
      onSourceSaved();
      await closePreview(false);
    } catch (caught) {
      previewError =
        caught instanceof Error ? caught.message : 'Dusori could not add this research source.';
    } finally {
      adding = false;
    }
  }

  async function dismiss(candidate: RankedCandidate): Promise<void> {
    actionError = null;
    try {
      await dismissSuggestion(storage, topicSlug, {
        key: candidate.key,
        title: candidate.title,
        url: candidate.url,
      });
      if (runResult) {
        runResult = {
          ...runResult,
          overflow: runResult.overflow.filter((item) => item.key !== candidate.key),
          shortlist: runResult.shortlist.filter((item) => item.key !== candidate.key),
        };
      }
    } catch {
      actionError = {
        key: candidate.key,
        message: 'Dismissal could not be saved. The suggestion is still visible; try again.',
      };
    }
  }

  async function writeBrief(): Promise<void> {
    if (!selectedObjective || approved.length === 0) return;
    writingBrief = true;
    briefError = '';
    try {
      const now = new Date();
      const query = buildResearchQuery(topicTitle, selectedObjective);
      let content: string;
      if (ai && aiCapability && hasConsent(aiConsent)) {
        try {
          content = buildAiBrief(
            query,
            await ai.writeBrief(query, approved),
            aiCapability.model,
            now,
          );
        } catch {
          content = buildDeterministicBrief(query, approved, now, { aiUnavailable: true });
        }
      } else {
        content = buildDeterministicBrief(query, approved, now);
      }
      const note = await createNote(storage, topicSlug, briefNoteTitle(query, now), now, {
        content,
      });
      briefPath = note.path;
      onSourceSaved();
    } catch (caught) {
      briefError =
        caught instanceof Error ? caught.message : 'Dusori could not write the research brief.';
    } finally {
      writingBrief = false;
    }
  }

  function handleEscape(): void {
    if (preview) void closePreview();
    else if (consentProvider) void declineProvider();
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && handleEscape()} />

<section class="research-panel" aria-labelledby="research-title" aria-busy={running}>
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
    <select id="research-objective" bind:value={objectiveIndex} disabled={running}>
      {#each objectives as objective (objective.index)}
        <option value={objective.index}>
          {objective.completed ? 'Complete · ' : ''}{objective.title}
        </option>
      {/each}
    </select>

    <div class="provider-consents" aria-label="Research providers">
      <p class="field-label">
        Providers
        <span class="quiet-note">
          {enabledProviders.length} of {providers.length} allowed
        </span>
      </p>
      <ul class="consent-list">
        {#each providers as provider (provider.id)}
          <li>
            {#if consented.has(provider.id)}
              <span class="provider-chip allowed">
                <Check aria-hidden="true" size={14} />
                {provider.label}
              </span>
            {:else}
              <button
                class="provider-chip"
                disabled={running}
                onclick={(event) => void requestConsent(provider, event.currentTarget)}
              >
                Allow {provider.label}
              </button>
            {/if}
          </li>
        {/each}
        {#if aiCapability}
          <li>
            {#if aiAllowed}
              <span class="provider-chip allowed">
                <Check aria-hidden="true" size={14} />
                AI ranking · {aiCapability.model}
              </span>
            {:else}
              <button
                class="provider-chip"
                disabled={running}
                onclick={(event) => void requestConsent(aiConsent, event.currentTarget)}
              >
                Allow AI ranking · {aiCapability.model}
              </button>
            {/if}
          </li>
        {/if}
      </ul>
    </div>

    <!-- The note below already said why the button is dead, but nothing tied the two together, so
       the reason reached neither assistive technology nor anyone who read the button first. -->
    <button
      class="primary run-action"
      disabled={running || enabledProviders.length === 0}
      aria-describedby={enabledProviders.length === 0 ? 'research-scan-blocked' : undefined}
      onclick={run}
    >
      <Search aria-hidden="true" size={17} />
      {running ? 'Scanning the allowed providers…' : 'Scan for strong sources'}
    </button>

    {#if enabledProviders.length === 0}
      <p class="quiet-note" id="research-scan-blocked">
        {autoStart
          ? 'Allow at least one provider to scan. You choose once, and this topic’s research begins.'
          : 'Allow at least one provider above to scan. Each states what it receives.'}
      </p>
    {/if}

    {#if runError}
      <p class="action-error" role="alert">{runError}</p>
    {/if}

    {#each notices as notice (notice)}
      <p class="notice" role="status">{notice}</p>
    {/each}

    {#if runResult?.skipped.length}
      <ul class="skipped-list" aria-label="Skipped providers">
        {#each runResult.skipped as skip (skip.id)}
          <li><strong>{skip.label} skipped.</strong> {skip.message}</li>
        {/each}
      </ul>
    {/if}

    {#if shortlist.length > 0}
      <ol class="result-list" aria-label="Research shortlist">
        {#each shortlist as candidate, index (candidate.key)}
          <li>
            <div class="result-heading">
              <span class="rank" aria-label={`Rank ${index + 1}`}
                >{String(index + 1).padStart(2, '0')}</span
              >
              <div>
                <span class="provider-tag">
                  {providerFor(candidate).label}
                  {#if kindLabel(candidate)}· {kindLabel(candidate)}{/if}
                </span>
                {#if candidate.isNew}<span class="new-badge">New</span>{/if}
                <h3>{candidate.title}</h3>
              </div>
            </div>
            {#if companion && candidate.meta.thumbnail}
              <VideoThumbnail
                {companion}
                title={candidate.title}
                videoId={candidate.meta.thumbnail}
              />
            {/if}
            {#if candidate.snippet}
              <div class="result-snippet"><MarkdownView content={candidate.snippet} /></div>
            {/if}
            {#if candidate.reasons.length > 0}
              <p class="result-signals">{candidate.reasons.join(' · ')}</p>
            {/if}
            {#if candidate.aiNote}
              <p class="ai-note">AI: {candidate.aiNote}</p>
            {/if}
            {#if providerFor(candidate).describeMeta(candidate)}
              <p class="result-meta">{providerFor(candidate).describeMeta(candidate)}</p>
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

      {#if overflow.length > 0 && !showOverflow}
        <button class="quiet" onclick={() => (showOverflow = true)}>
          Show {overflow.length} more {overflow.length === 1 ? 'result' : 'results'}
        </button>
      {/if}

      {#if showOverflow}
        <ol class="result-list" aria-label="Further research results">
          {#each overflow as candidate (candidate.key)}
            <li>
              <div class="result-heading">
                <div>
                  <span class="provider-tag">
                    {providerFor(candidate).label}
                    {#if kindLabel(candidate)}· {kindLabel(candidate)}{/if}
                  </span>
                  {#if candidate.isNew}<span class="new-badge">New</span>{/if}
                  <h3>{candidate.title}</h3>
                </div>
              </div>
              {#if candidate.reasons.length > 0}
                <p class="result-signals">{candidate.reasons.join(' · ')}</p>
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
      {/if}
    {:else if runResult && !running}
      <div class="research-empty">
        <p>No new suggestions matched this objective.</p>
        <span>Paste text or add a URL reference from the source library instead.</span>
      </div>
    {:else if !running}
      <div class="research-empty">
        <p>The web stays quiet until you run a search.</p>
        <span>Each provider states exactly what it receives before its first search.</span>
      </div>
    {/if}

    {#if approved.length > 0}
      <div class="brief-action">
        <p class="field-label">
          Research brief
          <span class="quiet-note">
            {approved.length}
            {approved.length === 1 ? 'source' : 'sources'} approved this session
          </span>
        </p>
        {#if briefPath}
          <p class="notice" role="status">Brief written to {briefPath}.</p>
        {:else}
          <button disabled={writingBrief} onclick={writeBrief}>
            <Sparkles aria-hidden="true" size={16} />
            {writingBrief ? 'Writing brief…' : 'Write research brief'}
          </button>
        {/if}
        {#if briefError}
          <p class="action-error" role="alert">{briefError}</p>
        {/if}
      </div>
    {/if}
  {/if}
</section>

{#if consentProvider}
  <dialog
    use:modal
    class="research-dialog consent-dialog"
    aria-labelledby="consent-title"
    oncancel={(event) => {
      event.preventDefault();
      void declineProvider();
    }}
  >
    <p class="dialog-kicker">Egress disclosure</p>
    <h2 id="consent-title">Allow {consentProvider.label} search?</h2>
    <p>{consentProvider.disclosure}</p>
    <div class="dialog-actions">
      <button class="quiet" onclick={declineProvider}>Keep search off</button>
      <button class="primary" bind:this={consentAllowButton} onclick={allowProvider}
        >Allow search</button
      >
    </div>
  </dialog>
{/if}

{#if preview}
  <dialog
    use:modal
    class="research-dialog preview-dialog"
    aria-labelledby="preview-title"
    oncancel={(event) => {
      event.preventDefault();
      if (!adding) void closePreview();
    }}
  >
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
    <div class="preview-body">
      <div class="rendered-preview"><MarkdownView content={preview.capture.content} /></div>
      <details class="source-markdown">
        <summary>Source markdown</summary>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
        <pre role="region" aria-label="Source markdown" tabindex="0">{preview.capture.content}</pre>
      </details>
    </div>
    {#if companion && isReferenceStub(preview.candidate, preview.provider)}
      <label class="fetch-option">
        <input type="checkbox" bind:checked={fetchFullContent} disabled={adding} />
        <span>
          Also fetch the readable text from <strong>{hostOf(preview.capture.url)}</strong> through the
          local companion, replacing this reference with the page itself.
        </span>
      </label>
    {/if}
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

  label,
  .field-label {
    margin-block-end: calc(-1 * var(--space-md));
    font-size: var(--text-sm);
    font-weight: 700;
  }

  .field-label {
    margin-block-end: 0;
  }

  .quiet-note {
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 400;
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

  .result-list,
  .result-actions,
  .provider-consents,
  .brief-action {
    display: grid;
    gap: var(--space-xs);
  }

  .run-action {
    width: 100%;
  }

  .consent-list {
    display: flex;
    flex-wrap: wrap;
    margin: 0;
    padding: 0;
    gap: var(--space-xs);
    list-style: none;
  }

  .provider-chip {
    min-height: calc(var(--space-lg) + var(--space-2xs));
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-accent-text);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  span.provider-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    color: var(--color-muted);
  }

  .source-markdown > summary {
    min-height: 2.75rem;
    padding-block: var(--space-xs);
    cursor: pointer;
  }

  .source-markdown > summary:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .source-markdown[open] > summary {
    margin-block-end: var(--space-xs);
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
  .source-markdown > summary {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .new-badge {
    margin-inline-start: var(--space-xs);
    padding-inline: var(--space-2xs);
    border: var(--rule-hair) solid var(--color-accent-text);
    border-radius: var(--radius-sm);
    color: var(--color-accent-text);
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

  .result-signals {
    color: var(--color-accent-text);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .ai-note {
    color: var(--color-muted);
    font-size: var(--text-sm);
    font-style: italic;
    line-height: 1.45;
  }

  .result-meta {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .skipped-list {
    display: grid;
    margin: 0;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
    gap: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
    list-style: none;
  }

  .notice {
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
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

  .research-dialog {
    display: grid;
    width: min(42rem, calc(100% - 2 * var(--page-gutter)));
    max-height: calc(100dvh - (2 * var(--page-gutter)));
    padding: var(--space-lg);
    overflow: auto;
    margin: auto;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-paper);
    box-shadow: 0 var(--space-sm) var(--space-xl)
      color-mix(in oklch, var(--color-ink) 24%, transparent);
    gap: var(--space-lg);
  }

  .research-dialog::backdrop {
    background: color-mix(in oklch, var(--color-ink) 72%, transparent);
  }

  .consent-dialog {
    max-width: 34rem;
  }

  /* The capture can run to tens of thousands of pixels, so only the body scrolls: the heading
   * and both dialog actions stay reachable without leaving the accept decision below the fold. */
  .preview-dialog {
    overflow: hidden;
    grid-template-rows: auto minmax(0, 1fr) auto auto;
  }

  .preview-body {
    display: grid;
    overflow: auto;
    gap: var(--space-lg);
    overscroll-behavior: contain;
  }

  .fetch-option {
    display: flex;
    align-items: flex-start;
    margin: 0;
    gap: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.45;
  }

  .fetch-option input {
    min-width: 1.15rem;
    min-height: 1.15rem;
    margin-block-start: 0.15rem;
    accent-color: var(--color-accent-text);
  }

  .fetch-option input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
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

  pre:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .dialog-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
  }

  @media (hover: hover) and (pointer: fine) {
    button.quiet:hover,
    .provider-chip:hover,
    .icon-action:hover,
    select:hover {
      background: var(--color-paper-2);
      color: var(--color-ink);
    }

    button:not(.quiet, .icon-action, .provider-chip):hover {
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
