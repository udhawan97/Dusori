<script lang="ts">
  import {
    ArrowUpRight,
    CircleAlert,
    Library,
    Plus,
    Route,
    Search,
    ShieldCheck,
  } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';

  import {
    angleById,
    buildAngleQuery,
    buildResearchQuery,
    evidenceClaims,
    isMissionStale,
    isUsableAiCapability,
    lensFor,
    loadResearchProviderCatalog,
    missionLensLabels,
    readResearchFile,
    readSourceManifest,
    researchAngles,
    runResearchSequence,
    saveApprovedResearchCandidate,
    setAutoRefresh,
    setResearchOutputStyle,
    type CompanionAiClient,
    type CompanionResearchClient,
    type RankedCandidate,
    type ResearchProviderCatalogEntry,
    type ResearchProviderSession,
    type ResearchProvider,
    type ResearchOutputStyle,
    type ResearchRunRecord,
    type ResearchThread as ResearchThreadRecord,
    type ResearchThreadEvent,
    type ResearchSequenceResult,
    type ResearchSequenceProgress,
    type SourceRecord,
    type StorageAdapter,
  } from '@dusori/core';

  import { modal } from '$lib/actions/modal';
  import { denyConsent, grantConsent, hasConsent, readConsent } from '$lib/consent';
  import { openExternalFromDesktop } from '$lib/open-external';
  import { createAiSynthesisOptions } from '$lib/research-synthesis';
  import {
    hasLegacyReferenceClaims,
    researchSnapshotCursor,
    researchSynthesisArtifactIsCurrent,
  } from '$lib/research-thread';
  import MarkdownView from './MarkdownView.svelte';
  import ResearchThread from './ResearchThread.svelte';

  export let storage: StorageAdapter;
  export let topicSlug: string;
  export let topicTitle: string;
  export let companion: CompanionResearchClient | null = null;
  export let ai: CompanionAiClient | null = null;
  export let autoStart = false;
  export let initialQuestion = '';
  export let providerRecoveryReturn = false;
  export let focusEventId = '';
  export let onAutoStartHandled: () => void = () => undefined;
  export let onProviderRecoveryReturnHandled: () => void = () => undefined;
  export let onQuestionChange: (question: string) => void = () => undefined;
  export let onReviewProviderChoices: () => void = () => undefined;
  export let onSourceSaved: (path?: string) => void = () => undefined;
  export let onOpenSources: () => void = () => undefined;
  export let onOpenMap: () => void = () => undefined;
  export let onThreadChanged: () => void = () => undefined;

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

  const outputStyles: Array<{
    description: string;
    label: string;
    value: ResearchOutputStyle;
  }> = [
    {
      description: 'A balanced brief with key themes, tensions, gaps, and follow-up questions.',
      label: 'Evidence brief',
      value: 'brief',
    },
    {
      description: 'Groups themes by multi-source support and single-source gaps.',
      label: 'Source coverage',
      value: 'comparison',
    },
    {
      description: 'Leads with dated material and says plainly when the chronology is incomplete.',
      label: 'Timeline',
      value: 'timeline',
    },
    {
      description:
        'Organizes key ideas as a reviewable guide with questions to test understanding.',
      label: 'Study guide',
      value: 'study-guide',
    },
  ];

  const workflowSteps = ['Find', 'Rank', 'Save', 'Read', 'Build'];

  const stageCopy: Record<Stage, string> = {
    complete: 'Thread ready',
    evaluating: 'Evaluating relevance, authority, recency, and variety',
    idle: 'Ready for a question',
    'needs-reading': 'References found; readable text is still needed',
    reading: 'Reading saved text into quoted passages',
    saving: 'Saving the diverse shortlist',
    searching: 'Searching allowed providers',
    writing: 'Building the source-backed answer',
  };

  let providers: ResearchProvider[] = [];
  let availableProviders: ResearchProvider[] = [];
  let providerAvailability: readonly ResearchProviderCatalogEntry[] = [];
  let providerSession: ResearchProviderSession | null = null;
  let aiModel = '';
  let question = initialQuestion.trim() || topicTitle;
  let userQuestionDraft = '';
  let questionDraftRevision = 0;
  let initializedQuestionTopic = topicTitle ? topicSlug : '';
  let selectedAngleId = 'overview';
  let outputStyle: ResearchOutputStyle = 'brief';
  let stage: Stage = 'idle';
  let runResult: ResearchSequenceResult | null = null;
  let latestRun: ResearchRunRecord | null = null;
  let researchRuns: ResearchRunRecord[] = [];
  let researchThreads: ResearchThreadRecord[] = [];
  let researchEvents: ResearchThreadEvent[] = [];
  let answeredThreadId = '';
  let sourceProgress: SourceProgress[] = [];
  let savedSources: SourceRecord[] = [];
  let discoveredCount = 0;
  let readCount = 0;
  let claimCount = 0;
  let runError = '';
  let providerChoiceRecovery = false;
  let status = '';
  let showOverflow = false;
  let savingExtraKey = '';
  let approvedExtraKeys = new Set<string>();
  let extraFeedback: Record<string, string> = {};
  let latestBriefPath = '';
  let synthesisMarkdown = '';
  let synthesisGeneratedAt = '';
  let synthesisRunAt = '';
  let autoRefreshEnabled = false;
  let autoRefreshBusy = false;
  let autoStarted = false;
  let consentOpen = false;
  let consentProviders: ResearchProvider[] = [];
  let selectedScopes: string[] = [];
  let consentRevision = 0;
  let consentDialog: HTMLDialogElement;
  let researchButton: HTMLButtonElement;
  let deskElement: HTMLElement;

  $: running = ['searching', 'evaluating', 'saving', 'reading', 'writing'].includes(stage);
  $: savingExtra = savingExtraKey.length > 0;
  $: threadReady = Boolean(latestBriefPath && synthesisMarkdown && claimCount > 0);
  $: selectedAngle = angleById(selectedAngleId);
  $: currentQuery = selectedAngle
    ? buildAngleQuery(topicTitle, selectedAngle)
    : buildResearchQuery(topicTitle, { title: question.trim() || topicTitle });
  $: browserSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(currentQuery.searchText)}`;
  $: relevantProviders = providerSession?.select(currentQuery) ?? availableProviders;
  $: relevantAllowedProviders = providersWithConsent(relevantProviders, consentRevision, 'allowed');
  $: relevantUndecidedProviders = providersWithConsent(
    relevantProviders,
    consentRevision,
    'undecided',
  );
  $: relevantSourceMix = [
    ...new Set(relevantProviders.map((provider) => missionLensLabels[lensFor(provider.id)])),
  ];
  $: outputStyleDescription =
    outputStyles.find((candidate) => candidate.value === outputStyle)?.description ?? '';
  $: syncQuestionForTopic(topicSlug, topicTitle);
  onMount(() => {
    void initialize();
  });

  async function initialize(): Promise<void> {
    const returningFromProviderRecovery = providerRecoveryReturn;
    const cachedQuestion = initialQuestion.trim();
    const draftRevisionAtStart = questionDraftRevision;
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
    const staleRefreshDue = await restoreResultState();
    const userEditedDuringInitialization = questionDraftRevision !== draftRevisionAtStart;
    const cachedDraftDiffersFromLatestRun = Boolean(
      cachedQuestion && cachedQuestion !== question.trim(),
    );
    const protectedDraft = userEditedDuringInitialization ? userQuestionDraft : cachedQuestion;
    const draftProtectionActive = userEditedDuringInitialization || cachedDraftDiffersFromLatestRun;
    if (returningFromProviderRecovery || draftProtectionActive) {
      question = protectedDraft;
      selectedAngleId =
        researchAngles.find((angle) => visibleAngleQuestion(angle) === protectedDraft)?.id ??
        'custom';
      if (returningFromProviderRecovery) onProviderRecoveryReturnHandled();
    }
    if (autoStart && !autoStarted && !draftProtectionActive) {
      autoStarted = true;
      onAutoStartHandled();
      await beginResearch();
    } else if (staleRefreshDue && !returningFromProviderRecovery && !draftProtectionActive) {
      await refreshStaleResearch();
    } else if (autoStart && !autoStarted) {
      autoStarted = true;
      onAutoStartHandled();
    }
  }

  function scopeOf(provider: ResearchProvider): string {
    return provider.consentScope ?? provider.id;
  }

  function syncQuestionForTopic(slug: string, title: string): void {
    if (!slug || !title || initializedQuestionTopic === slug) return;
    initializedQuestionTopic = slug;
    selectedAngleId = 'overview';
    question = initialQuestion.trim() || title;
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
    if (evidenceClaims(record).length > 0) return 'read';
    if (record.fetchState) return 'failed';
    if (record.readState === 'reference') return 'reference';
    return record.readState === 'readable' ? 'readable' : 'duplicate';
  }

  function messageFor(record: SourceRecord): string {
    if (record.fetchMessage) return record.fetchMessage;
    const claims = evidenceClaims(record);
    if (claims.length > 0) {
      return `${claims.length} quoted ${claims.length === 1 ? 'passage' : 'passages'}`;
    }
    return record.readState === 'reference'
      ? 'Reference saved. Read the original page or paste text before it can support claims.'
      : 'Saved text is ready to inspect.';
  }

  async function readResultSnapshot() {
    const synthesisPath = `Topics/${topicSlug}/Synthesis.md`;
    const [manifest, research, synthesis] = await Promise.all([
      readSourceManifest(storage, topicSlug),
      readResearchFile(storage, topicSlug),
      storage.read(synthesisPath),
    ]);
    return { manifest, research, synthesis };
  }

  async function restoreResultState(): Promise<boolean> {
    try {
      const synthesisPath = `Topics/${topicSlug}/Synthesis.md`;
      let snapshot = await readResultSnapshot();
      if (storage.kind === 'opfs') {
        // Chromium can expose one preceding snapshot while a page is reopening the OPFS tree.
        // Compare complete result bundles and keep the one with the newest typed activity.
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 32));
        const next = await readResultSnapshot();
        if (researchSnapshotCursor(next.research) >= researchSnapshotCursor(snapshot.research)) {
          snapshot = next;
        }
        if (
          !researchSynthesisArtifactIsCurrent(
            snapshot.research?.events ?? [],
            snapshot.research?.synthesisRunAt,
            snapshot.synthesis?.hash,
          )
        ) {
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 64));
          const reconciled = await readResultSnapshot();
          if (
            researchSnapshotCursor(reconciled.research) >= researchSnapshotCursor(snapshot.research)
          ) {
            snapshot = reconciled;
          }
        }
      }
      const { manifest, research, synthesis } = snapshot;
      savedSources = manifest.sources;
      readCount = manifest.sources.filter((source) => evidenceClaims(source).length > 0).length;
      claimCount = manifest.sources.reduce(
        (total, source) => total + evidenceClaims(source).length,
        0,
      );
      latestRun = research?.runs?.at(-1) ?? null;
      researchRuns = research?.runs ?? [];
      researchThreads = research?.threads ?? [];
      researchEvents = research?.events ?? [];
      const synthesisRunIndex = researchRuns.findLastIndex(
        (run) => run.at === research?.synthesisRunAt,
      );
      const editedSynthesisWasPreserved =
        synthesisRunIndex >= 0 &&
        researchRuns
          .slice(synthesisRunIndex + 1)
          .some((run) => run.synthesisOutcome === 'proposed' || run.synthesisOutcome === 'kept');
      latestBriefPath =
        synthesis && (!manifest.synthesisStaleAt || editedSynthesisWasPreserved)
          ? synthesisPath
          : '';
      synthesisMarkdown = latestBriefPath ? (synthesis?.content ?? '') : '';
      synthesisRunAt = research?.synthesisRunAt ?? '';
      answeredThreadId =
        researchRuns.find((run) => run.at === research?.synthesisRunAt)?.threadId ?? '';
      synthesisGeneratedAt = synthesis
        ? new Date(synthesis.modifiedAt).toISOString()
        : (latestRun?.at ?? new Date().toISOString());
      autoRefreshEnabled = research?.autoRefresh ?? false;
      outputStyle = research?.outputStyle ?? 'brief';
      if (latestRun?.angleId && angleById(latestRun.angleId)) {
        selectedAngleId = latestRun.angleId;
        const angle = angleById(latestRun.angleId);
        question = angle ? visibleAngleQuestion(angle) : topicTitle;
      } else if (latestRun) {
        selectedAngleId = 'custom';
        question = questionForRun(latestRun);
      }
      discoveredCount =
        latestRun?.eligibleCount ??
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
      if (hasLegacyReferenceClaims(manifest.sources)) {
        latestBriefPath = '';
        synthesisMarkdown = '';
        stage = 'needs-reading';
        status =
          'An older reference carried claims without readable evidence. The built answer is hidden until research is rebuilt from read source text.';
      } else if (manifest.synthesisStaleAt && !editedSynthesisWasPreserved) {
        synthesisMarkdown = '';
        stage = 'idle';
        status =
          'Saved evidence changed, so the previous brief is marked stale. Research again to rebuild it.';
      } else if (latestRun && discoveredCount === 0) {
        const previousAnswerVisible = Boolean(
          latestBriefPath && synthesisMarkdown && claimCount > 0,
        );
        stage = previousAnswerVisible ? 'complete' : 'idle';
        const failed = latestRun.providers.filter(
          (provider) => provider.outcome === 'failed',
        ).length;
        const empty = latestRun.providers.filter((provider) => provider.outcome === 'empty').length;
        const preservation = previousAnswerVisible
          ? ' The previous completed answer remains visible and is not presented as this update.'
          : '';
        status =
          failed > 0 && empty === 0
            ? `The latest lookup failed at every provider.${preservation}`
            : failed > 0
              ? `The latest lookup found no sources; some providers also failed.${preservation}`
              : `The latest lookup completed, but found no relevant sources.${preservation} Try a more specific question or search in your browser.`;
      } else if (research?.runs?.length && claimCount === 0 && manifest.sources.length > 0) {
        stage = 'needs-reading';
      } else if (claimCount > 0) stage = 'complete';
      return isMissionStale(research);
    } catch {
      savedSources = [];
      researchRuns = [];
      researchThreads = [];
      researchEvents = [];
      answeredThreadId = '';
      synthesisMarkdown = '';
      synthesisGeneratedAt = '';
      synthesisRunAt = '';
      latestBriefPath = '';
      latestRun = null;
      claimCount = 0;
      readCount = 0;
      return false;
    }
  }

  async function refreshThreadState(): Promise<void> {
    await restoreResultState();
    onThreadChanged();
  }

  function notifyResearchActivity(): void {
    onSourceSaved();
    onThreadChanged();
  }

  function questionForRun(run: ResearchRunRecord): string {
    if (run.questionText?.trim()) return run.questionText.trim();
    const topic = topicTitle.trim();
    if (run.searchText === topic) return topic;
    const expandedPrefix = `${topic} `;
    return run.searchText.startsWith(expandedPrefix)
      ? run.searchText.slice(expandedPrefix.length).trim()
      : run.searchText;
  }

  function queryForRun(run: ResearchRunRecord) {
    const angle = run.angleId ? angleById(run.angleId) : null;
    return angle
      ? buildAngleQuery(topicTitle, angle)
      : buildResearchQuery(topicTitle, { title: questionForRun(run) });
  }

  async function refreshStaleResearch(): Promise<void> {
    const query = latestRun ? queryForRun(latestRun) : currentQuery;
    const relevant = providerSession?.select(query) ?? availableProviders;
    const allowed = relevant.filter((provider) => hasConsent(scopeOf(provider)));
    if (allowed.length === 0) {
      status =
        'This thread is due for an update, but none of its matching providers is currently allowed. Update it manually after reviewing provider choices.';
      providerChoiceRecovery = true;
      return;
    }
    await research(allowed, query);
  }

  async function toggleAutoRefresh(enabled: boolean): Promise<void> {
    if (autoRefreshBusy || running) return;
    autoRefreshBusy = true;
    runError = '';
    try {
      const research = await setAutoRefresh(storage, topicSlug, enabled);
      autoRefreshEnabled = research.autoRefresh ?? false;
      status = autoRefreshEnabled
        ? 'Dusori will recheck this topic after seven days using only providers already allowed on this device.'
        : 'Automatic rechecking is off. You can still update this thread whenever you choose.';
    } catch (caught) {
      runError =
        caught instanceof Error
          ? caught.message
          : 'The update preference could not be saved. Try again.';
    } finally {
      autoRefreshBusy = false;
    }
  }

  async function beginResearch(): Promise<void> {
    if (running || savingExtra || !question.trim()) return;
    runError = '';
    providerChoiceRecovery = false;
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
      providerChoiceRecovery = true;
      return;
    }
    await research(allowed, currentQuery, true);
  }

  function toggleScope(scope: string, selected: boolean): void {
    selectedScopes = selected
      ? [...new Set([...selectedScopes, scope])]
      : selectedScopes.filter((item) => item !== scope);
  }

  function restoreResearchFocus(): void {
    void tick().then(() => queueMicrotask(() => researchButton?.focus()));
  }

  function closeConsent(restoreFocus = true): void {
    consentOpen = false;
    consentProviders = [];
    selectedScopes = [];
    if (restoreFocus) restoreResearchFocus();
  }

  async function confirmConsent(): Promise<void> {
    let stored = true;
    for (const provider of consentProviders) {
      const scope = scopeOf(provider);
      stored =
        (selectedScopes.includes(scope) ? grantConsent(scope) : denyConsent(scope)) && stored;
    }
    consentRevision += 1;
    closeConsent(false);
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
      providerChoiceRecovery = true;
      return;
    }
    await research(allowed, currentQuery, true);
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

  async function orientToCompletedThread(): Promise<void> {
    await tick();
    const heading = deskElement.querySelector<HTMLElement>('#thread-title');
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  async function research(
    providerList: ResearchProvider[],
    query = currentQuery,
    orientOnComplete = false,
  ): Promise<void> {
    stage = 'searching';
    sourceProgress = [];
    showOverflow = false;
    savingExtraKey = '';
    approvedExtraKeys = new Set();
    extraFeedback = {};
    latestBriefPath = '';
    runError = '';
    providerChoiceRecovery = false;
    try {
      await setResearchOutputStyle(storage, topicSlug, outputStyle);
      const routedProviders =
        providerSession?.select(query, new Set(providerList.map(scopeOf))) ?? providerList;
      const answeredRun = researchRuns.find((run) => run.at === synthesisRunAt);
      const visibleQuestion = query.questionText ?? query.objectiveTitle;
      const parentThreadId =
        answeredThreadId &&
        answeredRun &&
        questionForRun(answeredRun).trim() !== visibleQuestion.trim()
          ? answeredThreadId
          : undefined;
      const result = await runResearchSequence({
        enhanceSynthesis:
          ai && aiModel && hasConsent('companion-ai')
            ? (sources) => createAiSynthesisOptions(ai, aiModel, topicTitle, sources)
            : undefined,
        fetchImpl: fetch,
        limit: 8,
        onProgress: observeResearch,
        parentThreadId,
        providers: routedProviders,
        query,
        storage,
        topicSlug,
        topicTitle,
      });
      runResult = result;
      latestRun = result.run;
      discoveredCount = result.eligibleCount;
      if (result.status === 'no-results') {
        await restoreResultState();
        onThreadChanged();
        if (orientOnComplete) restoreResearchFocus();
        return;
      }
      readCount = result.readCount;
      claimCount = result.claimCount;
      await restoreResultState();
      if (result.status === 'needs-readable-evidence') {
        stage = 'needs-reading';
        status = `${result.shortlist.length} references saved, but none contains quotable source text yet.${result.activityWarning ? ` ${result.activityWarning}` : ''}`;
        notifyResearchActivity();
        return;
      }
      if (result.status === 'brief-ready' && result.synthesis?.status === 'written') {
        stage = 'complete';
        latestBriefPath = result.synthesis.path;
        status = `Thread assembled from ${result.synthesis.synthesis.claimCount} quoted passages across ${result.synthesis.synthesis.readCount} sources.${
          result.overflow.length > 0
            ? ` ${result.overflow.length} more ranked ${result.overflow.length === 1 ? 'result is' : 'results are'} ready for your review.`
            : ''
        }${
          result.aiUnavailable
            ? ' AI was unavailable, so the evidence-first fallback was used.'
            : ''
        }${result.activityWarning ? ` ${result.activityWarning}` : ''}`;
        notifyResearchActivity();
        if (orientOnComplete) await orientToCompletedThread();
      } else {
        stage = 'complete';
        status = `Your edited brief was kept. A refreshed proposal is waiting in Needs attention.${result.activityWarning ? ` ${result.activityWarning}` : ''}`;
        notifyResearchActivity();
        if (orientOnComplete) await orientToCompletedThread();
      }
    } catch (caught) {
      stage = sourceProgress.length > 0 ? 'needs-reading' : 'idle';
      runError =
        caught instanceof Error
          ? caught.message
          : 'Research could not finish. Saved references remain available below.';
      await restoreResultState();
      onThreadChanged();
    }
  }

  function chooseAngle(id: string): void {
    const angle = angleById(id);
    if (!angle || running) return;
    selectedAngleId = angle.id;
    question = visibleAngleQuestion(angle);
    userQuestionDraft = question;
    questionDraftRevision += 1;
    onQuestionChange(question);
  }

  function visibleAngleQuestion(angle: (typeof researchAngles)[number]): string {
    return angle.suffix ? `${topicTitle}: ${angle.suffix}` : topicTitle;
  }

  function useCustomQuestion(value: string): void {
    question = value;
    selectedAngleId = 'custom';
    userQuestionDraft = question;
    questionDraftRevision += 1;
    onQuestionChange(question);
  }

  function workflowState(index: number): 'complete' | 'current' | 'blocked' | 'pending' {
    const current = {
      complete: 5,
      evaluating: 1,
      idle: -1,
      'needs-reading': 3,
      reading: 3,
      saving: 2,
      searching: 0,
      writing: 4,
    }[stage];
    if (stage === 'needs-reading' && index === 3) return 'blocked';
    if (index < current) return 'complete';
    if (index === current) return 'current';
    return 'pending';
  }

  function selectRecommendedProviders(): void {
    selectedScopes = [...new Set(consentProviders.map(scopeOf))];
  }

  function providerKind(provider: ResearchProvider): string {
    return `${missionLensLabels[lensFor(provider.id)]} · ${
      provider.capturePolicy === 'reference-only' ? 'Reference only' : 'Readable when available'
    }`;
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
      notifyResearchActivity();
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

<section bind:this={deskElement} class="desk" aria-labelledby="research-title" aria-busy={running}>
  <div class="desk-heading">
    <div>
      <h2 id="research-title">Start with a direction.</h2>
      <p>
        Use a proven angle or ask your own question. Dusori records the route from search to saved
        evidence.
      </p>
    </div>
    <Route aria-hidden="true" size={24} strokeWidth={1.5} />
  </div>

  <fieldset class="angle-picker">
    <legend>Research direction</legend>
    <div>
      {#each researchAngles as angle (angle.id)}
        <button
          type="button"
          aria-pressed={selectedAngleId === angle.id}
          disabled={running}
          onclick={() => chooseAngle(angle.id)}>{angle.title}</button
        >
      {/each}
    </div>
    <p>{selectedAngle?.intent ?? 'A question written in your own words.'}</p>
  </fieldset>

  <form
    class="query"
    onsubmit={(event) => {
      event.preventDefault();
      void beginResearch();
    }}
  >
    <label for="research-question">Your question</label>
    <div class="query-row">
      <input
        id="research-question"
        value={question}
        required
        maxlength="240"
        disabled={running}
        placeholder="What do you want to understand?"
        oninput={(event) => useCustomQuestion(event.currentTarget.value)}
      />
      <button
        bind:this={researchButton}
        class="primary"
        disabled={running || savingExtra || !question.trim()}
      >
        <Search aria-hidden="true" size={17} />
        {running ? 'Researching…' : 'Research and build'}
      </button>
    </div>
    <div class="output-choice">
      <label for="research-output">Build as</label>
      <select id="research-output" bind:value={outputStyle} disabled={running}>
        {#each outputStyles as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <p>{outputStyleDescription} Saved locally as <code>Synthesis.md</code>.</p>
    </div>
  </form>

  <div class="provider-summary">
    <ShieldCheck aria-hidden="true" size={17} />
    <span>
      {relevantProviders.length} research provider{relevantProviders.length === 1 ? '' : 's'} match this
      direction{relevantSourceMix.length ? ` across ${relevantSourceMix.join(', ')}` : ''}. {relevantAllowedProviders.length}
      allowed now · {relevantUndecidedProviders.length} need a choice. Results are ranked with relevance,
      authority, recency, and variety signals.
    </span>
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

  <section class="research-path" aria-labelledby="research-path-title" aria-live="polite">
    <div class="path-heading">
      <div>
        <p class="eyebrow">Live research path</p>
        <strong id="research-path-title">{stageCopy[stage]}</strong>
      </div>
      <span
        >{discoveredCount} found · {savedSources.length} saved · {readCount} read · {claimCount}
        quotes</span
      >
    </div>
    <ol>
      {#each workflowSteps as step, index (step)}
        <li data-state={workflowState(index)}>
          <span aria-hidden="true">{index + 1}</span>
          <strong>{step}</strong>
        </li>
      {/each}
    </ol>
    <div class="path-actions">
      <button type="button" onclick={onOpenSources}>
        <Library aria-hidden="true" size={16} /> Manage sources
      </button>
      <button type="button" onclick={onOpenMap}>
        <Route aria-hidden="true" size={16} /> Trace connections
      </button>
    </div>
  </section>

  {#if runError}
    <div class="error-with-action">
      <p class="error" role="alert"><CircleAlert aria-hidden="true" size={17} /> {runError}</p>
      {#if providerChoiceRecovery}
        <button class="recovery-action" type="button" onclick={onReviewProviderChoices}>
          <ShieldCheck aria-hidden="true" size={16} /> Review provider choices
        </button>
      {/if}
    </div>
  {/if}
  {#if status}
    <div class:message-with-action={providerChoiceRecovery}>
      <p class="notice" role="status">{status}</p>
      {#if providerChoiceRecovery}
        <button class="recovery-action" type="button" onclick={onReviewProviderChoices}>
          <ShieldCheck aria-hidden="true" size={16} /> Review provider choices
        </button>
      {/if}
    </div>
  {/if}
  {#if threadReady}
    <ResearchThread
      {topicSlug}
      {topicTitle}
      {synthesisMarkdown}
      synthesisRunAt={synthesisRunAt || undefined}
      {outputStyle}
      sources={savedSources}
      runs={researchRuns}
      threads={researchThreads}
      events={researchEvents}
      threadId={answeredThreadId || undefined}
      {focusEventId}
      {storage}
      generatedAt={synthesisGeneratedAt}
      {autoRefreshEnabled}
      busy={running || savingExtra || autoRefreshBusy}
      onUpdate={() => void beginResearch()}
      onToggleAutoRefresh={(enabled) => void toggleAutoRefresh(enabled)}
      {onOpenSources}
      {onOpenMap}
      onOpenDocument={(path) => onSourceSaved(path)}
      onOpenExternal={(event, url) => void openExternal(event, url)}
      onThreadChanged={() => void refreshThreadState()}
    />
  {/if}

  {#if latestRun && !threadReady}
    <details class="latest-run" role="region" aria-label="Latest lookup">
      <summary><strong>Latest lookup</strong> · {questionForRun(latestRun)}</summary>
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
    </details>
  {:else if runResult?.skipped.length}
    <ul class="provider-failures" aria-label="Provider outcomes">
      {#each runResult.skipped as skipped (skipped.id)}
        <li><strong>{skipped.label} failed.</strong> {skipped.message}</li>
      {/each}
    </ul>
  {/if}

  {#if sourceProgress.length > 0 && (!threadReady || running || stage === 'needs-reading')}
    <details class="source-results" open={running || stage === 'needs-reading'}>
      <summary>
        {sourceProgress.length}
        {sourceProgress.length === 1 ? 'source' : 'sources'} in this run
      </summary>
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
    </details>
  {/if}

  {#if stage === 'needs-reading'}
    <div class="next-step">
      <strong>References are useful, but they are not evidence yet.</strong>
      <p>
        Read a page through the local companion, open the original in your browser, or paste text
        you are allowed to use. The brief refreshes after readable text arrives.
      </p>
      <div class="next-actions">
        <button type="button" onclick={onOpenSources}>Open Sources</button>
        <a
          href={browserSearchUrl}
          target="_blank"
          rel="noreferrer"
          onclick={(event) => void openExternal(event, browserSearchUrl)}>Search in browser</a
        >
      </div>
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
          Only providers relevant to this question are shown. Choices stay separately on this
          device; closing records nothing.
        </span>
        <span class="consent-detail">
          Selected providers receive only this topic and objective. Notes, saved pages, and
          unrelated files never leave.
        </span>
      </p>
    </div>
    <div class="consent-scroll">
      <div class="consent-recommendation">
        <span>A varied set gives the ranking step more to compare.</span>
        <button type="button" class="quiet" onclick={selectRecommendedProviders}
          >Select recommended</button
        >
      </div>
      <ul>
        {#each consentProviders as provider (scopeOf(provider))}
          <li>
            <label>
              <input
                type="checkbox"
                checked={selectedScopes.includes(scopeOf(provider))}
                onchange={(event) => toggleScope(scopeOf(provider), event.currentTarget.checked)}
              />
              <span>
                <strong>{provider.label}</strong>
                <small>{providerKind(provider)}</small>
              </span>
            </label>
            <details>
              <summary>What is shared</summary>
              <p>{provider.disclosure}</p>
            </details>
          </li>
        {/each}
      </ul>
    </div>
    <div class="dialog-actions">
      <button class="quiet" aria-label="Decide later" onclick={() => closeConsent()}>
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
  /* Hallmark · macrostructure: guided research sequence · genre: atmospheric editorial · theme: design.md
   * states: idle · loading · partial · blocked · complete · pre-emit critique: P5 H5 E4 S5 R5 V4
   * contrast: pass (40–41) · honest: pass (46) · tokens: pass (48) · responsive: pass (49)
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
  .angle-picker {
    min-width: 0;
    margin: 0;
    padding: var(--space-md) 0;
    border: 0;
    border-block: var(--rule-hair) solid var(--color-rule);
  }
  .angle-picker legend,
  .query > label,
  .output-choice > label {
    padding: 0;
    font-size: var(--text-sm);
    font-weight: 700;
  }
  .angle-picker > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
  }
  .angle-picker button {
    min-height: 2.35rem;
    padding-inline: var(--space-sm);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .angle-picker button[aria-pressed='true'] {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }
  .angle-picker p {
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .query {
    display: grid;
    gap: var(--space-xs);
  }
  .query-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
  }
  input,
  select,
  button,
  a {
    font: inherit;
  }
  input,
  select {
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
  select:focus-visible,
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
    transition:
      background-color 180ms var(--ease-out),
      color 180ms var(--ease-out),
      transform 100ms var(--ease-out);
  }
  button:active {
    transform: translateY(1px);
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
  .output-choice {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2xs) var(--space-sm);
    align-items: center;
    margin-block-start: var(--space-sm);
  }
  .output-choice select {
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
  }
  .output-choice p {
    grid-column: 1 / -1;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .output-choice code {
    font-family: var(--font-mono);
    font-size: 0.9em;
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
  .research-path {
    display: grid;
    gap: var(--space-md);
    min-width: 0;
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
    color: var(--color-ink);
  }
  .path-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-xs) var(--space-lg);
  }
  .eyebrow {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .path-heading > span {
    color: var(--color-muted);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }
  .research-path ol {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .research-path li {
    position: relative;
    display: grid;
    gap: var(--space-2xs);
    min-width: 0;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }
  .research-path li:not(:last-child)::after {
    position: absolute;
    inset-block-start: 0.7rem;
    inset-inline: 1.7rem 0.25rem;
    block-size: var(--rule-hair);
    background: var(--color-rule);
    content: '';
  }
  .research-path li > span {
    position: relative;
    z-index: 1;
    display: grid;
    inline-size: 1.4rem;
    block-size: 1.4rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 50%;
    background: var(--color-paper-2);
    font-family: var(--font-mono);
    place-items: center;
  }
  .research-path li[data-state='complete'],
  .research-path li[data-state='current'] {
    color: var(--color-ink);
  }
  .research-path li[data-state='complete'] > span {
    border-color: var(--color-success);
    background: var(--color-success);
    color: var(--color-paper);
  }
  .research-path li[data-state='current'] > span,
  .research-path li[data-state='blocked'] > span {
    border-color: var(--color-accent-text);
    color: var(--color-accent-text);
  }
  .research-path li[data-state='blocked'] {
    color: var(--color-accent-text);
  }
  .path-actions,
  .next-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
  }
  .path-actions button,
  .next-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    min-height: 2.35rem;
    padding-inline: var(--space-sm);
    font-size: var(--text-sm);
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
  .error-with-action {
    display: grid;
    justify-items: start;
    gap: var(--space-xs);
  }
  .message-with-action {
    display: grid;
    justify-items: start;
    gap: var(--space-xs);
  }
  .recovery-action {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    border-color: var(--color-error);
    color: var(--color-error);
    font-weight: 700;
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
  .latest-run,
  .source-results {
    border-block-start: var(--rule-hair) solid var(--color-rule);
    padding-block-start: var(--space-sm);
  }
  .latest-run summary,
  .source-results summary {
    min-height: 2.75rem;
    color: var(--color-accent-text);
    cursor: pointer;
  }
  .latest-run .provider-failures {
    margin-block-start: var(--space-xs);
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
  .next-actions {
    align-items: center;
    margin-block-start: var(--space-xs);
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
  .consent-recommendation {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-xs);
    padding-block: var(--space-sm);
    border-block: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .consent-recommendation button {
    min-height: 2.35rem;
    padding-inline: var(--space-sm);
  }
  .consent li {
    padding-block-end: var(--space-sm);
    border-block-end: var(--rule-hair) solid var(--color-rule);
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
  .consent label small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
  .consent li > details {
    margin-inline-start: 2.4rem;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }
  .consent li > details summary {
    min-height: 2rem;
    color: var(--color-accent-text);
    cursor: pointer;
    font-size: var(--text-xs);
  }
  .consent li > details p {
    padding-block-start: var(--space-2xs);
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
    .output-choice {
      grid-template-columns: auto minmax(14rem, 0.5fr) minmax(16rem, 1fr);
    }
    .output-choice p {
      grid-column: auto;
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
    input,
    select {
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
    button {
      transition-duration: 0.01ms;
    }
  }
</style>
