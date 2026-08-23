<script lang="ts">
  import { ArrowUpRight, CircleAlert, Library, Plus, Search, ShieldCheck } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    buildResearchQuery,
    isUsableAiCapability,
    loadResearchProviderCatalog,
    readResearchFile,
    readSourceManifest,
    runResearchSequence,
    saveApprovedResearchCandidate,
    type CompanionAiClient,
    type CompanionResearchClient,
    type RankedCandidate,
    type ResearchProviderCatalogEntry,
    type ResearchProviderSession,
    type ResearchProvider,
    type ResearchRunRecord,
    type ResearchSequenceResult,
    type ResearchSequenceProgress,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';

  import { modal } from '$lib/actions/modal';
  import { denyConsent, grantConsent, hasConsent, readConsent } from '$lib/consent';
  import { openExternalFromDesktop } from '$lib/open-external';
  import { createAiSynthesisOptions } from '$lib/research-synthesis';
  import MarkdownView from './MarkdownView.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let onAutoStartHandled: () => void = () => undefined;
  export let onSourceSaved: (path?: string) => void = () => undefined;

  type Stage =
    | 'idle'
    | 'searching'
    | 'evaluating'
    | 'saving'
    | 'reading'
    | 'writing'
    | 'complete'
    | 'needs-reading';
  type SourceState = 'saving' | 'read' | 'readable' | 'reference' | 'duplicate' | 'failed';
  interface SourceProgress {
    key: string;
    title: string;
    url: string;
    host: string;
    state: SourceState;
    message: string;
  }

  const stageCopy: Record<Stage, string> = {
    complete: 'Brief ready',
    evaluating: 'Evaluating relevance, authority, recency, and variety',
    idle: 'Ready for a question',
    'needs-reading': 'References found; readable text is still needed',
    reading: 'Reading saved text into quoted passages',
    saving: 'Saving the diverse shortlist',
    searching: 'Searching allowed providers',
    writing: 'Writing the source-backed brief',
  };

  let providers: ResearchProvider[] = [];
  let availableProviders: ResearchProvider[] = [];
  let providerAvailability: readonly ResearchProviderCatalogEntry[] = [];
  let providerSession: ResearchProviderSession | null = null;
  let aiModel = '';
  let question = topicTitle;
  let stage: Stage = 'idle';
  let runResult: ResearchSequenceResult | null = null;
  let latestRun: ResearchRunRecord | null = null;
  let sourceProgress: SourceProgress[] = [];
  let savedSources: SourceRecord[] = [];
  let discoveredCount = 0;
  let readCount = 0;
  let claimCount = 0;
  let runError = '';
  let status = '';
  let showOverflow = false;
  let savingExtraKey = '';
  let approvedExtraKeys = new Set<string>();
  let extraFeedback: Record<string, string> = {};
  let latestBriefPath = '';
  let autoStarted = false;
  let consentOpen = false;
  let consentProviders: ResearchProvider[] = [];
  let selectedScopes: string[] = [];
  let consentRevision = 0;
  let consentDialog: HTMLDialogElement;
  let researchButton: HTMLButtonElement;

  $: running = ['searching', 'evaluating', 'saving', 'reading', 'writing'].includes(stage);
  $: savingExtra = savingExtraKey.length > 0;
  $: allowedProviders = providersWithConsent(availableProviders, consentRevision, 'allowed');
  $: undecidedProviders = providersWithConsent(availableProviders, consentRevision, 'undecided');
  $: browserSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(question.trim() || topicTitle)}`;
  $: currentQuery = buildResearchQuery(topicTitle, { title: question.trim() || topicTitle });
  $: relevantProviders = providerSession?.select(currentQuery) ?? availableProviders;
  $: relevantAllowedProviderCount = providersWithConsent(
    relevantProviders,
    consentRevision,
    'allowed',
  ).length;
  onMount(() => {
    void initialize();
  });

  async function initialize(): Promise<void> {
    providerSession = await loadResearchProviderCatalog({ companion });
    providers = [...providerSession.providers];
    availableProviders = [...providerSession.availableProviders];
    providerAvailability = providerSession.catalog;
    if (ai) {
      try {
        const capability = (await ai.capabilities())[0];
        aiModel = isUsableAiCapability(capability) ? (capability?.model ?? '') : '';
      } catch {
        aiModel = '';
      }
    }
    await restoreResultState();
    if (autoStart && !autoStarted) {
      autoStarted = true;
      onAutoStartHandled();
      await beginResearch();
    }
  }

  function scopeOf(provider: ResearchProvider): string {
    return provider.consentScope ?? provider.id;
  }

  function providersWithConsent(
    candidates: ResearchProvider[],
    revision: number,
    state: 'allowed' | 'undecided',
  ): ResearchProvider[] {
    void revision;
    return candidates.filter((provider) =>
      state === 'allowed'
        ? hasConsent(scopeOf(provider))
        : readConsent(scopeOf(provider)) === 'undecided',
    );
  }

  function providerDecision(scope: string, revision: number): string {
    void revision;
    const decision = readConsent(scope);
    return decision === 'allowed'
      ? 'Allowed on this device'
      : decision === 'denied'
        ? 'Off on this device'
        : 'Not decided';
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./u, '');
    } catch {
      return 'original site';
    }
  }

  async function openExternal(event: MouseEvent, url: string): Promise<void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    event.preventDefault();
    try {
      await openExternalFromDesktop(url);
    } catch (caught) {
      runError =
        caught instanceof Error
          ? caught.message
          : 'The system browser could not open this research link.';
    }
  }

  function stateFor(record: SourceRecord): SourceState {
    if ((record.claims?.length ?? 0) > 0 && record.readState === 'read') return 'read';
    if (record.fetchState) return 'failed';
    if (record.readState === 'reference') return 'reference';
    return record.readState === 'readable' ? 'readable' : 'duplicate';
  }

  function messageFor(record: SourceRecord): string {
    if (record.fetchMessage) return record.fetchMessage;
    if ((record.claims?.length ?? 0) > 0) {
      return `${record.claims?.length ?? 0} quoted ${(record.claims?.length ?? 0) === 1 ? 'passage' : 'passages'}`;
    }
    return record.readState === 'reference'
      ? 'Reference saved. Read the original page or paste text before it can support claims.'
      : 'Saved text is ready to inspect.';
  }

  async function restoreResultState(): Promise<void> {
    try {
      const [manifest, research] = await Promise.all([
        readSourceManifest(storage, topicSlug),
        readResearchFile(storage, topicSlug),
      ]);
      savedSources = manifest.sources;
      readCount = manifest.sources.filter((source) => (source.claims?.length ?? 0) > 0).length;
      claimCount = manifest.sources.reduce(
        (total, source) => total + (source.claims?.length ?? 0),
        0,
      );
      latestRun = research?.runs?.at(-1) ?? null;
      discoveredCount =
        latestRun?.providers.reduce((total, provider) => total + provider.count, 0) ??
        manifest.sources.length;
      sourceProgress = manifest.sources.map((record) => ({
        host: hostOf(record.url ?? ''),
        key: record.sha256,
        message: messageFor(record),
        state: stateFor(record),
        title: record.title,
        url: record.url ?? '',
      }));
      if (latestRun && discoveredCount === 0) {
        stage = 'idle';
        const failed = latestRun.providers.filter(
          (provider) => provider.outcome === 'failed',
        ).length;
        const empty = latestRun.providers.filter((provider) => provider.outcome === 'empty').length;
        status =
          failed > 0 && empty === 0
            ? 'The latest lookup failed at every provider. No older brief is being presented as its answer.'
            : failed > 0
              ? 'The latest lookup found no sources; some providers also failed. No older brief is being presented as its answer.'
              : 'The latest lookup completed, but found no sources. Try a more specific question or search in your browser.';
      } else if (manifest.synthesisStaleAt) {
        stage = 'idle';
        status =
          'Saved evidence changed, so the previous brief is marked stale. Research again to rebuild it.';
      } else if (research?.runs?.length && claimCount === 0 && manifest.sources.length > 0) {
        stage = 'needs-reading';
      } else if (claimCount > 0) stage = 'complete';
    } catch {
      savedSources = [];
    }
  }

  async function beginResearch(): Promise<void> {
    if (running || savingExtra || !question.trim()) return;
    runError = '';
    status = '';
    const relevant = providerSession?.select(currentQuery) ?? availableProviders;
    const undecided = relevant.filter((provider) => readConsent(scopeOf(provider)) === 'undecided');
    if (undecided.length > 0) {
      consentProviders = undecided;
      selectedScopes = [];
      consentOpen = true;
      await tick();
      consentDialog.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
      return;
    }
    const allowed = relevant.filter((provider) => hasConsent(scopeOf(provider)));
    if (allowed.length === 0) {
      runError =
        'No allowed provider matches this question. Reset a relevant provider decision in Settings or change the question.';
      return;
    }
    await research(allowed);
  }

  function toggleScope(scope: string, selected: boolean): void {
    selectedScopes = selected
      ? [...new Set([...selectedScopes, scope])]
      : selectedScopes.filter((item) => item !== scope);
  }

  function restoreResearchFocus(): void {
    void tick().then(() => queueMicrotask(() => researchButton?.focus()));
  }

  function closeConsent(): void {
    consentOpen = false;
    consentProviders = [];
    selectedScopes = [];
    restoreResearchFocus();
  }

  async function confirmConsent(): Promise<void> {
    let stored = true;
    for (const provider of consentProviders) {
      const scope = scopeOf(provider);
      stored =
        (selectedScopes.includes(scope) ? grantConsent(scope) : denyConsent(scope)) && stored;
    }
    consentRevision += 1;
    closeConsent();
    if (!stored) {
      runError =
        'This device could not remember the provider choices. Check browser storage and try again.';
      return;
    }
    const relevant = providerSession?.select(currentQuery) ?? availableProviders;
    const allowed = relevant.filter((provider) => hasConsent(scopeOf(provider)));
    if (allowed.length === 0) {
      runError =
        'Every relevant provider was kept off. Reset a provider decision in Settings when you want to research.';
      return;
    }
    await research(allowed);
    restoreResearchFocus();
  }

  function updateProgress(key: string, update: Partial<SourceProgress>): void {
    sourceProgress = sourceProgress.map((entry) =>
      entry.key === key ? { ...entry, ...update } : entry,
    );
  }

  function observeResearch(progress: ResearchSequenceProgress): void {
    stage = progress.stage;
    if (progress.candidate && !progress.source) {
      sourceProgress = [
        ...sourceProgress,
        {
          host: hostOf(progress.candidate.url),
          key: progress.candidate.key,
          message: 'Saving provider capture…',
          state: 'saving',
          title: progress.candidate.title,
          url: progress.candidate.url,
        },
      ];
    }
    if (progress.candidate && progress.source) {
      updateProgress(progress.candidate.key, {
        key: progress.source.record?.sha256 ?? progress.candidate.key,
        message: progress.source.message,
        state: progress.source.status,
      });
    }
  }

  async function research(providerList: ResearchProvider[]): Promise<void> {
    stage = 'searching';
    sourceProgress = [];
    showOverflow = false;
    savingExtraKey = '';
    approvedExtraKeys = new Set();
    extraFeedback = {};
    latestBriefPath = '';
    runError = '';
    try {
      const query = buildResearchQuery(topicTitle, { title: question.trim() });
      const routedProviders =
        providerSession?.select(query, new Set(providerList.map(scopeOf))) ?? providerList;
      const result = await runResearchSequence({
        enhanceSynthesis:
          ai && aiModel && hasConsent('companion-ai')
            ? (sources) => createAiSynthesisOptions(ai, aiModel, topicTitle, sources)
            : undefined,
        fetchImpl: fetch,
        limit: 8,
        onProgress: observeResearch,
        providers: routedProviders,
        query,
        storage,
        topicSlug,
        topicTitle,
      });
      runResult = result;
      latestRun = result.run;
      discoveredCount = result.shortlist.length + result.overflow.length;
      if (result.status === 'no-results') {
        stage = 'idle';
        const failed = result.skipped.length;
        status =
          routedProviders.length === 0
            ? 'No allowed provider matches this question. Allow a broader provider or make the question more specific.'
            : failed > 0 && failed === routedProviders.length
              ? 'Every provider failed this lookup. Saved research is unchanged.'
              : failed > 0
                ? 'No relevant sources were found, and some providers failed. Saved research is unchanged.'
                : 'No relevant sources were found. Try a more specific question or search in your browser.';
        return;
      }
      onSourceSaved();
      readCount = result.readCount;
      claimCount = result.claimCount;
      await restoreResultState();
      if (result.status === 'needs-readable-evidence') {
        stage = 'needs-reading';
        status = `${result.shortlist.length} references saved, but none contains quotable source text yet.`;
        onSourceSaved();
        return;
      }
      if (result.status === 'brief-ready' && result.synthesis?.status === 'written') {
        stage = 'complete';
        latestBriefPath = result.synthesis.path;
        status = `Brief assembled from ${result.synthesis.synthesis.claimCount} quoted passages across ${result.synthesis.synthesis.readCount} sources.${
          result.overflow.length > 0
            ? ` ${result.overflow.length} more ranked ${result.overflow.length === 1 ? 'result is' : 'results are'} ready for your review.`
            : ''
        }${
          result.aiUnavailable
            ? ' AI was unavailable, so the evidence-first fallback was used.'
            : ''
        }`;
        if (result.overflow.length === 0) onSourceSaved(result.synthesis.path);
      } else {
        stage = 'complete';
        status = 'Your edited brief was kept. A refreshed proposal is waiting in Needs attention.';
        onSourceSaved();
      }
    } catch (caught) {
      stage = sourceProgress.length > 0 ? 'needs-reading' : 'idle';
      runError =
        caught instanceof Error
          ? caught.message
          : 'Research could not finish. Saved references remain available below.';
      await restoreResultState();
    }
  }

  function providerLabel(candidate: RankedCandidate): string {
    return (
      providers.find((provider) => provider.id === candidate.provider)?.label ?? candidate.provider
    );
  }

  async function approveExtraCandidate(candidate: RankedCandidate): Promise<void> {
    if (savingExtra || approvedExtraKeys.has(candidate.key)) return;
    const provider = providers.find((entry) => entry.id === candidate.provider);
    if (!provider || !hasConsent(scopeOf(provider))) {
      extraFeedback = {
        ...extraFeedback,
        [candidate.key]:
          'This provider is no longer allowed or available. Start a new search after updating its choice.',
      };
      return;
    }

    savingExtraKey = candidate.key;
    extraFeedback = { ...extraFeedback, [candidate.key]: '' };
    try {
      const result = await saveApprovedResearchCandidate({
        candidate,
        enhanceSynthesis:
          ai && aiModel && hasConsent('companion-ai')
            ? (sources) => createAiSynthesisOptions(ai, aiModel, topicTitle, sources)
            : undefined,
        fetchImpl: fetch,
        provider,
        storage,
        topicSlug,
        topicTitle,
      });
      await restoreResultState();
      if (!result.source.record) {
        extraFeedback = { ...extraFeedback, [candidate.key]: result.source.message };
        return;
      }

      approvedExtraKeys = new Set([...approvedExtraKeys, candidate.key]);
      if (result.synthesis?.status === 'written') latestBriefPath = result.synthesis.path;
      onSourceSaved();
      const refreshed =
        result.synthesis?.status === 'written'
          ? ' The brief was refreshed.'
          : result.synthesis?.status === 'conflict'
            ? ' Your edited brief was kept; a refreshed proposal is waiting in Needs attention.'
            : '';
      const aiNote = result.aiUnavailable
        ? ' AI was unavailable, so the evidence-first fallback was used.'
        : '';
      extraFeedback = {
        ...extraFeedback,
        [candidate.key]: result.warning
          ? result.warning
          : `Added to Sources. ${result.source.message}${refreshed}${aiNote}`,
      };
    } catch (caught) {
      extraFeedback = {
        ...extraFeedback,
        [candidate.key]:
          caught instanceof Error ? caught.message : 'This result could not be added to Sources.',
      };
    } finally {
      savingExtraKey = '';
    }
  }
</script>

<section class="desk" aria-labelledby="research-title" aria-busy={running}>
  <div class="desk-heading">
    <div>
      <h2 id="research-title">Research this topic</h2>
      <p>
        Ask plainly. Dusori finds, ranks, saves, reads, and assembles what the allowed providers can
        support.
      </p>
    </div>
    <Library aria-hidden="true" size={22} strokeWidth={1.5} />
  </div>

  <form
    class="query"
    onsubmit={(event) => {
      event.preventDefault();
      void beginResearch();
    }}
  >
    <label for="research-question">Question or topic</label>
    <div class="query-row">
      <input
        id="research-question"
        bind:value={question}
        required
        maxlength="240"
        disabled={running}
        placeholder="What changed the spread of the printing press?"
      />
      <button
        bind:this={researchButton}
        class="primary"
        disabled={running || savingExtra || !question.trim()}
      >
        <Search aria-hidden="true" size={17} />
        {running ? 'Researching…' : 'Research topic'}
      </button>
    </div>
  </form>

  <div class="provider-summary">
    <ShieldCheck aria-hidden="true" size={17} />
    <span
      >{allowedProviders.length} allowed overall · {relevantAllowedProviderCount} relevant and allowed
      here · {undecidedProviders.length} undecided overall · {aiModel
        ? `${aiModel} ready for optional synthesis`
        : 'AI stays separate'}</span
    >
  </div>

  <details class="provider-setup">
    <summary>Research providers and setup</summary>
    <p>
      Browser providers need only your consent. Web search, social, video, and arXiv use the free
      local companion so keys and cross-origin requests stay off the hosted app. A running Ollama
      chat model must pass a structured generation check and still needs its own AI consent.
    </p>
    <ul aria-label="Research provider availability">
      {#each providerAvailability as provider (provider.id)}
        <li>
          <span class:ready={provider.available} aria-hidden="true"></span>
          <strong>{provider.label}</strong>
          <small
            >{provider.detail} · {providerDecision(provider.consentScope, consentRevision)}</small
          >
        </li>
      {/each}
    </ul>
  </details>

  <div class="stage" data-stage={stage} aria-live="polite">
    <span class="stage-mark" aria-hidden="true"></span>
    <div>
      <strong>{stageCopy[stage]}</strong>
      <span
        >{discoveredCount} found · {savedSources.length} saved · {readCount} read · {claimCount} quoted
        passages</span
      >
    </div>
  </div>

  {#if runError}
    <p class="error" role="alert"><CircleAlert aria-hidden="true" size={17} /> {runError}</p>
  {/if}
  {#if status}<p class="notice" role="status">{status}</p>{/if}
  {#if latestBriefPath}
    <button class="text-action" onclick={() => onSourceSaved(latestBriefPath)}>Open brief</button>
  {/if}

  {#if latestRun}
    <section class="latest-run" aria-label="Latest lookup">
      <p><strong>Latest lookup</strong> · {latestRun.searchText}</p>
      <ul class="provider-failures" aria-label="Provider outcomes">
        {#each latestRun.providers as provider (provider.id)}
          <li>
            <strong>{provider.label} {provider.outcome}.</strong>
            {provider.outcome === 'found'
              ? `${provider.count} ${provider.count === 1 ? 'result' : 'results'}`
              : provider.outcome === 'empty'
                ? 'No results returned.'
                : (provider.message ?? 'The provider could not be reached.')}
          </li>
        {/each}
      </ul>
    </section>
  {:else if runResult?.skipped.length}
    <ul class="provider-failures" aria-label="Provider outcomes">
      {#each runResult.skipped as skipped (skipped.id)}
        <li><strong>{skipped.label} failed.</strong> {skipped.message}</li>
      {/each}
    </ul>
  {/if}

  {#if sourceProgress.length > 0}
    <ol class="source-progress" aria-label="Research sources">
      {#each sourceProgress as source (source.key)}
        <li data-state={source.state}>
          <div>
            <span class="state-label">
              {source.state === 'read'
                ? 'Read'
                : source.state === 'readable'
                  ? 'Readable'
                  : source.state === 'reference'
                    ? 'Reference'
                    : source.state === 'failed'
                      ? 'Needs browser'
                      : source.state === 'duplicate'
                        ? 'Already saved'
                        : 'Saving'}
            </span>
            <strong>{source.title}</strong>
            <p>{source.message}</p>
          </div>
          {#if source.url}
            <div class="source-actions">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                onclick={(event) => void openExternal(event, source.url)}
              >
                Open original <ArrowUpRight aria-hidden="true" size={14} />
              </a>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if stage === 'needs-reading'}
    <div class="next-step">
      <strong>References are useful, but they are not evidence yet.</strong>
      <p>
        Open Sources to read a page through the local companion, open the original in your browser,
        or paste text you are allowed to use. The brief refreshes after readable text arrives.
      </p>
      <a
        href={browserSearchUrl}
        target="_blank"
        rel="noreferrer"
        onclick={(event) => void openExternal(event, browserSearchUrl)}
        >Search this question in browser</a
      >
    </div>
  {/if}

  {#if runResult?.overflow.length}
    <button class="text-action" onclick={() => (showOverflow = !showOverflow)}>
      {showOverflow ? 'Hide further results' : `Show ${runResult.overflow.length} more results`}
    </button>
    {#if showOverflow}
      <p class="overflow-intro">
        Review the remaining ranked results. An additional source is saved only when you approve it
        here.
      </p>
      <ul class="overflow" aria-label="Further research results">
        {#each runResult.overflow as candidate (candidate.key)}
          <li>
            <span>{providerLabel(candidate)} · {hostOf(candidate.url)}</span>
            <strong>{candidate.title}</strong>
            {#if candidate.snippet}<MarkdownView content={candidate.snippet} />{/if}
            <p>{candidate.reasons.join(' · ')}</p>
            <div class="overflow-actions">
              <a
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
                onclick={(event) => void openExternal(event, candidate.url)}>Open original</a
              >
              <button
                class="approve-extra"
                aria-label={`Approve and add ${candidate.title} to Sources`}
                disabled={savingExtra || approvedExtraKeys.has(candidate.key)}
                onclick={() => void approveExtraCandidate(candidate)}
              >
                <Plus aria-hidden="true" size={14} />
                {savingExtraKey === candidate.key
                  ? 'Adding…'
                  : approvedExtraKeys.has(candidate.key)
                    ? 'Added to Sources'
                    : 'Approve and add'}
              </button>
            </div>
            {#if extraFeedback[candidate.key]}
              <p
                class:error-feedback={!approvedExtraKeys.has(candidate.key)}
                class="extra-feedback"
                role={approvedExtraKeys.has(candidate.key) ? 'status' : 'alert'}
              >
                {extraFeedback[candidate.key]}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

{#if consentOpen}
  <dialog
    bind:this={consentDialog}
    use:modal
    class="consent"
    aria-labelledby="consent-title"
    aria-describedby="consent-description"
    oncancel={(event) => {
      event.preventDefault();
      closeConsent();
    }}
    onclick={(event) => {
      if (event.target === event.currentTarget) closeConsent();
    }}
  >
    <div class="dialog-heading">
      <p class="dialog-label">One-time provider choices</p>
      <h2 id="consent-title" aria-label="Choose where this question may go.">
        <span class="full-copy">Choose where this question may go.</span>
        <span class="compact-copy" aria-hidden="true">Choose providers</span>
      </h2>
      <p id="consent-description">
        <span>
          Only relevant providers are shown. Choices stay separately on this device; closing records
          nothing.
        </span>
        <span class="consent-detail">
          The full catalog remains under Research providers and setup. Selected providers receive
          only this topic and objective. Notes, saved pages, and unrelated files never leave.
        </span>
      </p>
    </div>
    <div class="consent-scroll">
      <ul>
        {#each consentProviders as provider (scopeOf(provider))}
          <li>
            <label>
              <input
                type="checkbox"
                checked={selectedScopes.includes(scopeOf(provider))}
                onchange={(event) => toggleScope(scopeOf(provider), event.currentTarget.checked)}
              />
              <span><strong>{provider.label}</strong>{provider.disclosure}</span>
            </label>
          </li>
        {/each}
      </ul>
    </div>
    <div class="dialog-actions">
      <button class="quiet" aria-label="Decide later" onclick={closeConsent}>
        <span class="full-copy">Decide later</span>
        <span class="compact-copy" aria-hidden="true">Later</span>
      </button>
      <button class="quiet" aria-label="Keep all off" onclick={() => void confirmConsent()}>
        <span class="full-copy">Keep all off</span>
        <span class="compact-copy" aria-hidden="true">Off</span>
      </button>
      <button
        class="primary"
        aria-label="Save choices and research"
        disabled={selectedScopes.length === 0}
        onclick={() => void confirmConsent()}
      >
        <span class="full-copy">Save choices and research</span>
        <span class="compact-copy" aria-hidden="true">Allow selected</span>
      </button>
    </div>
  </dialog>
{/if}

<style>
  /* Hallmark · component: Research Desk · genre: atmospheric editorial · theme: design.md
   * states: idle · loading · partial · blocked · complete · contrast: pass
   */
  .desk {
    display: grid;
    gap: var(--space-lg);
    min-width: 0;
  }
  .desk-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-md);
  }
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    line-height: 1.15;
  }
  .desk-heading p {
    max-width: 58ch;
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
  }
  .query {
    display: grid;
    gap: var(--space-xs);
  }
  .query label {
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .query-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
  }
  input,
  button,
  a {
    font: inherit;
  }
  input {
    min-width: 0;
    min-height: 3rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper);
    color: var(--color-ink);
  }
  input:focus-visible,
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
  button {
    min-height: 2.75rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    white-space: nowrap;
  }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
    font-weight: 700;
  }
  .provider-summary {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .provider-setup {
    border-block: var(--rule-hair) solid var(--color-rule);
    padding-block: var(--space-sm);
  }
  .provider-setup summary {
    min-height: 2.75rem;
    color: var(--color-accent-text);
    cursor: pointer;
    font-weight: 700;
  }
  .provider-setup > p {
    max-width: 64ch;
    margin-block-end: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .provider-setup ul {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
    gap: var(--space-xs);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .provider-setup li {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0 var(--space-xs);
    align-items: center;
  }
  .provider-setup li > span {
    grid-row: 1 / 3;
    inline-size: 0.55rem;
    block-size: 0.55rem;
    border-radius: 50%;
    background: var(--color-muted);
  }
  .provider-setup li > span.ready {
    background: var(--color-success);
  }
  .provider-setup small {
    color: var(--color-muted);
  }
  .stage {
    display: flex;
    align-items: flex-start;
    gap: var(--space-sm);
    padding-block: var(--space-sm);
    border-block: var(--rule-hair) solid var(--color-rule);
  }
  .stage-mark {
    inline-size: 0.65rem;
    block-size: 0.65rem;
    margin-block-start: 0.35rem;
    border-radius: 50%;
    background: var(--color-marigold);
    flex: 0 0 auto;
  }
  .stage[data-stage='complete'] .stage-mark {
    background: var(--color-success);
  }
  .stage[data-stage='needs-reading'] .stage-mark {
    background: var(--color-accent);
  }
  .stage div {
    display: grid;
    gap: var(--space-2xs);
    min-width: 0;
  }
  .stage span:last-child {
    color: var(--color-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .error,
  .notice {
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    font-size: var(--text-sm);
  }
  .error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    border-color: var(--color-error);
    color: var(--color-error);
  }
  .notice {
    color: var(--color-ink);
  }
  .provider-failures,
  .source-progress,
  .overflow {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .provider-failures {
    display: grid;
    gap: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .source-progress {
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }
  .source-progress li {
    display: grid;
    gap: var(--space-sm);
    padding-block: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }
  .source-progress strong {
    display: block;
    margin-block-start: var(--space-2xs);
    font-family: var(--font-display);
  }
  .source-progress p {
    margin-block-start: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .state-label {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .source-progress [data-state='read'] .state-label {
    color: var(--color-success);
  }
  .source-progress [data-state='readable'] .state-label {
    color: var(--color-accent-text);
  }
  .source-progress [data-state='failed'] .state-label {
    color: var(--color-error);
  }
  .source-actions a,
  .next-step a,
  .overflow a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    color: var(--color-accent-text);
    font-weight: 700;
    white-space: nowrap;
  }
  .next-step {
    display: grid;
    gap: var(--space-xs);
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-accent);
    background: var(--color-paper-2);
    color: var(--color-ink);
  }
  .next-step p {
    color: var(--color-muted);
  }
  .text-action {
    justify-self: start;
    border: 0;
    padding-inline: 0;
    color: var(--color-accent-text);
    text-decoration: underline;
  }
  .overflow-intro {
    max-width: 58ch;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .overflow {
    display: grid;
    gap: var(--space-md);
  }
  .overflow li {
    display: grid;
    gap: var(--space-xs);
    padding-block-end: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }
  .overflow span,
  .overflow p {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }
  .overflow-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .approve-extra {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
  }
  .approve-extra:disabled {
    cursor: default;
  }
  .overflow .extra-feedback {
    color: var(--color-success);
    font-size: var(--text-sm);
  }
  .overflow .extra-feedback.error-feedback {
    color: var(--color-error);
  }
  .consent {
    position: fixed;
    inset: 0;
    width: min(42rem, calc(100% - 1rem));
    display: grid;
    block-size: min(
      calc(100dvh - 1rem - env(safe-area-inset-top) - env(safe-area-inset-bottom)),
      44rem
    );
    max-block-size: none;
    box-sizing: border-box;
    grid-template-rows: auto minmax(0, 1fr) auto;
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-ink);
  }
  .consent::backdrop {
    background: color-mix(in oklch, var(--color-ink) 70%, transparent);
  }
  .dialog-label {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }
  .dialog-heading {
    padding: var(--space-md);
  }
  .dialog-heading > p:not(.dialog-label) {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .dialog-heading > p:not(.dialog-label) span {
    display: inline;
  }
  .compact-copy {
    display: none;
  }
  .consent-scroll {
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0 var(--space-md);
    scrollbar-gutter: stable;
  }
  .consent ul {
    display: grid;
    gap: var(--space-sm);
    margin-block: var(--space-sm) var(--space-lg);
    padding: 0;
    list-style: none;
  }
  .consent label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-sm);
    align-items: start;
  }
  .consent label input {
    inline-size: 1.2rem;
    min-height: 1.2rem;
    margin-block-start: 0.2rem;
    accent-color: var(--color-accent);
  }
  .consent label span {
    display: grid;
    gap: var(--space-2xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .consent label strong {
    color: var(--color-ink);
  }
  .dialog-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-xs);
    padding: var(--space-md) max(var(--space-md), env(safe-area-inset-bottom));
    border-block-start: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
  }
  .dialog-actions button {
    width: 100%;
  }
  .dialog-actions .primary {
    grid-column: 1 / -1;
  }
  @media (max-width: 18rem) {
    .consent {
      width: calc(100% - 0.5rem);
      block-size: calc(100dvh - 0.5rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    }
    .dialog-heading {
      padding: var(--space-xs);
    }
    .dialog-label,
    .full-copy {
      display: none;
    }
    .dialog-heading > p:not(.dialog-label) .consent-detail {
      display: none;
    }
    .compact-copy {
      display: inline;
    }
    .consent-scroll {
      padding-inline: var(--space-xs);
    }
    .dialog-actions {
      padding: var(--space-xs) max(var(--space-xs), env(safe-area-inset-bottom));
    }
    .dialog-actions button {
      min-width: 0;
      padding-inline: var(--space-xs);
    }
  }
  @media (max-height: 18rem) {
    .dialog-heading > p:not(.dialog-label) {
      display: none;
    }
  }
  @media (min-width: 40rem) {
    .query-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .source-progress li {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
    }
    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .dialog-actions button {
      width: auto;
    }
  }
  @media (pointer: coarse) {
    button,
    input {
      min-height: 3rem;
    }
  }
  @media (hover: hover) and (pointer: fine) {
    button:hover {
      background: var(--color-paper-2);
    }
    .primary:hover {
      background: var(--color-accent);
      color: var(--color-accent-ink);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      scroll-behavior: auto;
    }
  }
</style>
