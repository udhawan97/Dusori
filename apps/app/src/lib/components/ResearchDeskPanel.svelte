<script lang="ts">
  import { ArrowUpRight, CircleAlert, Library, Search, ShieldCheck } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    addSource,
    buildResearchQuery,
    createResearchProviders,
    readResearchFile,
    readSourceManifest,
    readSourcesIntoClaims,
    recordSourceFetchFailure,
    runResearchAgent,
    selectProvidersForQuery,
    writeTopicSynthesis,
    type CompanionResearchClient,
    type RankedCandidate,
    type ResearchCapability,
    type ResearchProvider,
    type ResearchRunResult,
    type ResearchRunRecord,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';

  import { modal } from '$lib/actions/modal';
  import { denyConsent, grantConsent, hasConsent, readConsent } from '$lib/consent';
  import { openExternalFromDesktop } from '$lib/open-external';
  import MarkdownView from './MarkdownView.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let companion: CompanionResearchClient | null = null;
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

  const companionOnlyProviderIds = new Set(['arxiv', 'reddit', 'websearch', 'youtube']);
  const captureTimeoutMs = 12_000;
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
  let capabilities = new Map<string, ResearchCapability>();
  let question = topicTitle;
  let stage: Stage = 'idle';
  let runResult: ResearchRunResult | null = null;
  let latestRun: ResearchRunRecord | null = null;
  let sourceProgress: SourceProgress[] = [];
  let savedSources: SourceRecord[] = [];
  let discoveredCount = 0;
  let readCount = 0;
  let claimCount = 0;
  let runError = '';
  let status = '';
  let showOverflow = false;
  let autoStarted = false;
  let consentOpen = false;
  let consentProviders: ResearchProvider[] = [];
  let selectedScopes: string[] = [];
  let consentRevision = 0;
  let consentDialog: HTMLDialogElement;

  const providerCatalog = [
    { id: 'mslearn', label: 'Microsoft Learn', mode: 'browser' },
    { id: 'wikipedia', label: 'Wikipedia', mode: 'browser' },
    { id: 'openalex', label: 'OpenAlex', mode: 'browser' },
    { id: 'github', label: 'GitHub', mode: 'browser' },
    { id: 'stackexchange', label: 'Stack Exchange', mode: 'browser' },
    { id: 'hackernews', label: 'Hacker News', mode: 'browser' },
    { id: 'npm', label: 'npm', mode: 'browser' },
    { id: 'arxiv', label: 'arXiv', mode: 'companion' },
    { id: 'reddit', label: 'Reddit', mode: 'companion' },
    { id: 'websearch', label: 'Web search', mode: 'companion' },
    { id: 'youtube', label: 'YouTube', mode: 'companion' },
  ] as const;

  $: running = ['searching', 'evaluating', 'saving', 'reading', 'writing'].includes(stage);
  $: allowedProviders = providersWithConsent(availableProviders, consentRevision, 'allowed');
  $: undecidedProviders = providersWithConsent(availableProviders, consentRevision, 'undecided');
  $: browserSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(question.trim() || topicTitle)}`;
  $: relevantProviderCount = selectProvidersForQuery(
    allowedProviders,
    buildResearchQuery(topicTitle, { title: question.trim() || topicTitle }),
  ).length;
  $: providerAvailability = providerCatalog.map((entry) => {
    const provider = providers.find((candidate) => candidate.id === entry.id);
    const capability = capabilities.get(entry.id);
    if (entry.mode === 'browser') {
      return {
        ...entry,
        available: Boolean(provider),
        detail: provider ? 'Ready in this app' : 'Unavailable in this build',
      };
    }
    if (!companion) {
      return {
        ...entry,
        available: false,
        detail: 'Requires the free local companion',
      };
    }
    return {
      ...entry,
      available: Boolean(provider && capability?.available),
      detail:
        provider && capability?.available
          ? 'Ready through the local companion'
          : capability?.reason === 'not-configured'
            ? 'Not configured in the local companion'
            : capability?.reason || 'Not configured in the local companion',
    };
  });

  onMount(() => {
    void initialize();
  });

  async function initialize(): Promise<void> {
    providers = createResearchProviders({ companion });
    if (companion) {
      try {
        capabilities = new Map(
          (await companion.capabilities()).map((capability) => [capability.id, capability]),
        );
      } catch {
        capabilities = new Map();
      }
    }
    availableProviders = providers.filter(providerAvailable);
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
    _revision: number,
    state: 'allowed' | 'undecided',
  ): ResearchProvider[] {
    return candidates.filter((provider) =>
      state === 'allowed'
        ? hasConsent(scopeOf(provider))
        : readConsent(scopeOf(provider)) === 'undecided',
    );
  }

  function providerAvailable(provider: ResearchProvider): boolean {
    if (!companion) return !companionOnlyProviderIds.has(provider.id);
    const capability = capabilities.get(provider.id);
    return capability ? capability.available : !companionOnlyProviderIds.has(provider.id);
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

  function isReadableCapture(capturedVia: string): boolean {
    return ['api-abstract', 'api-extract', 'page-extract', 'readme-extract'].includes(capturedVia);
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
    if (running || !question.trim()) return;
    runError = '';
    status = '';
    const undecided = availableProviders.filter(
      (provider) => readConsent(scopeOf(provider)) === 'undecided',
    );
    if (undecided.length > 0) {
      consentProviders = undecided;
      selectedScopes = [];
      consentOpen = true;
      await tick();
      consentDialog.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
      return;
    }
    const allowed = availableProviders.filter((provider) => hasConsent(scopeOf(provider)));
    if (allowed.length === 0) {
      runError =
        'No research provider is allowed. Reset a provider decision in Settings to continue.';
      return;
    }
    await research(allowed);
  }

  function toggleScope(scope: string, selected: boolean): void {
    selectedScopes = selected
      ? [...new Set([...selectedScopes, scope])]
      : selectedScopes.filter((item) => item !== scope);
  }

  function closeConsent(): void {
    consentOpen = false;
    consentProviders = [];
    selectedScopes = [];
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
    const allowed = availableProviders.filter((provider) => hasConsent(scopeOf(provider)));
    if (allowed.length === 0) {
      runError =
        'Every provider was kept off. Reset a provider decision in Settings when you want to research.';
      return;
    }
    await research(allowed);
  }

  async function captureWithTimeout(
    provider: ResearchProvider,
    candidate: RankedCandidate,
  ): Promise<Awaited<ReturnType<ResearchProvider['capture']>>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        provider.capture(candidate, fetch),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                `${provider.label} took too long to read this result. The browser-ready reference was kept.`,
              ),
            );
          }, captureTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function updateProgress(key: string, update: Partial<SourceProgress>): void {
    sourceProgress = sourceProgress.map((entry) =>
      entry.key === key ? { ...entry, ...update } : entry,
    );
  }

  async function saveCandidate(candidate: RankedCandidate): Promise<void> {
    const provider = providers.find((item) => item.id === candidate.provider);
    if (!provider) return;
    const base: SourceProgress = {
      host: hostOf(candidate.url),
      key: candidate.key,
      message: 'Saving provider capture…',
      state: 'saving',
      title: candidate.title,
      url: candidate.url,
    };
    sourceProgress = [...sourceProgress, base];

    let capture: { content?: string; title: string; url: string } = {
      title: candidate.title,
      url: candidate.url,
    };
    let capturedVia = provider.capturedVia(candidate);
    let captureFailure = '';
    try {
      const captured = await captureWithTimeout(provider, candidate);
      capture = captured;
      capturedVia = captured.capturedVia ?? capturedVia;
    } catch (caught) {
      captureFailure =
        caught instanceof Error
          ? caught.message
          : `${provider.label} could not capture this result. The reference was kept.`;
      capturedVia = 'search-reference';
    }

    try {
      const saved = await addSource(storage, {
        ...(capture.content === undefined ? {} : { content: capture.content }),
        method: 'url',
        origin: {
          capturedAt: new Date().toISOString(),
          capturedVia,
          provider: provider.id,
        },
        provenance: {
          author: candidate.meta.author ?? candidate.meta.channel ?? candidate.meta.byline,
          publishedAt: candidate.publishedAt,
          publisher: provider.label,
          readState: isReadableCapture(capturedVia) ? 'readable' : 'reference',
          whySelected: candidate.reasons.slice(0, 8),
        },
        title: capture.title,
        topicSlug,
        url: capture.url,
      });
      if (captureFailure) {
        await recordSourceFetchFailure(storage, {
          message: captureFailure,
          sha256: saved.record.sha256,
          state: 'failed',
          topicSlug,
        });
      }
      const readable = isReadableCapture(capturedVia);
      const savedMessage = captureFailure
        ? `${captureFailure} Open the original or paste text.`
        : saved.restored
          ? 'Restored to active research.'
          : saved.upgraded
            ? 'Readable text added to the saved reference.'
            : saved.deduplicated
              ? 'Already saved in this topic.'
              : readable
                ? 'Readable provider text saved.'
                : 'Reference saved; the original page was not fetched.';
      updateProgress(candidate.key, {
        key: saved.record.sha256,
        message: `${savedMessage}${saved.warning ? ` ${saved.warning}` : ''}`,
        state: captureFailure
          ? 'failed'
          : saved.deduplicated && !saved.upgraded
            ? 'duplicate'
            : readable
              ? 'readable'
              : 'reference',
      });
    } catch (caught) {
      updateProgress(candidate.key, {
        message: caught instanceof Error ? caught.message : 'This result could not be saved.',
        state: 'failed',
      });
    }
  }

  async function research(providerList: ResearchProvider[]): Promise<void> {
    stage = 'searching';
    sourceProgress = [];
    showOverflow = false;
    runError = '';
    try {
      const query = buildResearchQuery(topicTitle, { title: question.trim() });
      const routedProviders = selectProvidersForQuery(providerList, query);
      const result = await runResearchAgent({
        fetchImpl: fetch,
        limit: 5,
        providers: routedProviders,
        query,
        storage,
        topicSlug,
      });
      runResult = result;
      latestRun = result.run;
      discoveredCount = result.shortlist.length + result.overflow.length;
      stage = 'evaluating';
      await tick();
      if (result.shortlist.length === 0) {
        stage = 'idle';
        const failed = result.skipped.length;
        status =
          failed === routedProviders.length
            ? 'Every provider failed this lookup. Saved research is unchanged.'
            : failed > 0
              ? 'No relevant sources were found, and some providers failed. Saved research is unchanged.'
              : 'No relevant sources were found. Try a more specific question or search in your browser.';
        return;
      }
      stage = 'saving';
      for (const candidate of result.shortlist) await saveCandidate(candidate);
      onSourceSaved();

      stage = 'reading';
      const read = await readSourcesIntoClaims(storage, topicSlug);
      readCount = read.read.length;
      claimCount = read.read.reduce((total, entry) => total + entry.claims, 0);
      await restoreResultState();
      if (claimCount === 0) {
        stage = 'needs-reading';
        status = `${result.shortlist.length} references saved, but none contains quotable source text yet.`;
        onSourceSaved();
        return;
      }

      stage = 'writing';
      const synthesis = await writeTopicSynthesis(storage, topicSlug, topicTitle);
      if (synthesis.status === 'written') {
        stage = 'complete';
        status = `Brief assembled from ${synthesis.synthesis.claimCount} quoted passages across ${synthesis.synthesis.readCount} sources.`;
        onSourceSaved(synthesis.path);
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
      <button class="primary" disabled={running || !question.trim()}>
        <Search aria-hidden="true" size={17} />
        {running ? 'Researching…' : 'Research topic'}
      </button>
    </div>
  </form>

  <div class="provider-summary">
    <ShieldCheck aria-hidden="true" size={17} />
    <span
      >{allowedProviders.length} allowed · {relevantProviderCount} relevant here · {undecidedProviders.length}
      undecided · AI stays separate</span
    >
  </div>

  <details class="provider-setup">
    <summary>Research providers and setup</summary>
    <p>
      Browser providers need only your consent. Web search, social, video, and arXiv use the free
      local companion so keys and cross-origin requests stay off the hosted app.
    </p>
    <ul aria-label="Research provider availability">
      {#each providerAvailability as provider (provider.id)}
        <li>
          <span class:ready={provider.available} aria-hidden="true"></span>
          <strong>{provider.label}</strong>
          <small>{provider.detail}</small>
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
      <ul class="overflow" aria-label="Further research results">
        {#each runResult.overflow as candidate (candidate.key)}
          <li>
            <span>{providerLabel(candidate)} · {hostOf(candidate.url)}</span>
            <strong>{candidate.title}</strong>
            {#if candidate.snippet}<MarkdownView content={candidate.snippet} />{/if}
            <p>{candidate.reasons.join(' · ')}</p>
            <a
              href={candidate.url}
              target="_blank"
              rel="noreferrer"
              onclick={(event) => void openExternal(event, candidate.url)}>Open original</a
            >
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
    oncancel={(event) => {
      event.preventDefault();
      closeConsent();
    }}
  >
    <p class="dialog-label">One-time provider choices</p>
    <h2 id="consent-title">Choose where this question may go.</h2>
    <p>
      Each choice is stored separately on this device. Clearing a box records “denied”; closing this
      sheet records nothing. A selected provider receives this question and may return abstracts,
      READMEs, or extracts that Dusori saves locally. Notes, saved page bodies, and unrelated
      workspace files are never sent.
    </p>
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
    <div class="dialog-actions">
      <button class="quiet" onclick={closeConsent}>Decide later</button>
      <button class="quiet" onclick={() => void confirmConsent()}>Keep all off</button>
      <button
        class="primary"
        disabled={selectedScopes.length === 0}
        onclick={() => void confirmConsent()}
      >
        Save choices and research
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
  .consent {
    position: fixed;
    inset: 0;
    width: min(42rem, calc(100% - 2rem));
    max-height: min(80dvh, 44rem);
    margin: auto;
    padding: var(--space-lg);
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
  .consent > p:not(.dialog-label) {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
  }
  .consent ul {
    display: grid;
    gap: var(--space-sm);
    margin-block: var(--space-lg);
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
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-xs);
  }
  @media (min-width: 40rem) {
    .query-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .source-progress li {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
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
