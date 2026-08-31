<script lang="ts">
  import { dev } from '$app/environment';
  import { pushState, replaceState } from '$app/navigation';
  import { base } from '$app/paths';
  import {
    Download,
    FileText,
    FolderOpen,
    HardDrive,
    Library,
    Map,
    Menu,
    PanelRightClose,
    PanelRightOpen,
    Pencil,
    Plus,
    Save,
    Search,
    Settings,
    ShieldCheck,
    Upload,
    X,
  } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';

  import {
    WorkspaceSchema,
    acceptMarkdownUpdate,
    createCompanionAiClient,
    createCompanionResearchClient,
    createNote,
    recordResearchThreadEvent,
    sha256,
    createTopic,
    createWorkspace,
    exportTopic,
    exportWorkspace,
    lineDiff,
    inspectMachineFileRecoveries,
    prepareWorkspaceImport,
    proposeMarkdownUpdate,
    readMachineFile,
    readSourceManifest,
    replaceWorkspace,
    resolvePendingProposal,
    resolveResearchSynthesisProposal,
    resolveWikilink,
    slugify,
    type CompanionAiClient,
    type CompanionResearchClient,
    type MarkdownConflict,
    type ProposalAttentionItem,
    type SourceRecord,
    type StorageAdapter,
    type Workspace,
  } from '@dusori/core';
  import { FsaStorageAdapter, pickDirectory, restoreDirectoryHandle } from '@dusori/storage-fsa';
  import {
    BrowserStorageSelectionError,
    createBrowserStorage,
    openBrowserStorage,
  } from '@dusori/storage-opfs';

  import {
    isCompanionHealth,
    resolveCompanionOrigin,
    stripCompanionCredentials,
  } from '$lib/companion-origin';
  import { containTab, modal } from '$lib/actions/modal';
  import { resolveDesktopStorage, startBundledDesktopSession } from '$lib/desktop-platform';
  import { runAutomaticUpdateCheck } from '$lib/app-updates';
  import { startSystemAppearanceSync } from '$lib/appearance';
  import { wikilinkTarget } from '$lib/markdown';
  import { handleExternalLink, isExternalHttpUrl } from '$lib/open-external';
  import {
    parseWorkspaceLocation,
    transitionWorkspaceNavigation,
    workspaceNavigationUrl,
    type WorkspaceNavigationIntent,
    type WorkspaceNavigationState,
    type WorkspaceView,
    type GraphMode,
  } from '$lib/workspace-navigation';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import CurriculumImporter from '$lib/components/CurriculumImporter.svelte';
  import LearningLoop from '$lib/components/LearningLoop.svelte';
  import LearningInsights from '$lib/components/LearningInsights.svelte';
  import KnowledgeGraph from '$lib/components/KnowledgeGraph.svelte';
  import ResearchWorkspace from '$lib/components/ResearchWorkspace.svelte';
  import SourceReader from '$lib/components/SourceReader.svelte';
  import AppSettings from '$lib/components/AppSettings.svelte';
  import MachineFileRecovery from '$lib/components/MachineFileRecovery.svelte';
  import SourceLibrary from '$lib/components/SourceLibrary.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import TopicAsk from '$lib/components/TopicAsk.svelte';
  import TutorPreferences from '$lib/components/TutorPreferences.svelte';
  import WorkspaceSearch from '$lib/components/WorkspaceSearch.svelte';
  import WorkspaceHealth from '$lib/components/WorkspaceHealth.svelte';
  import {
    buildSourceQuoteLocator,
    normalizeSelectedPassage,
    parseSourceAnnotationMetadata,
    resolveSourceQuoteLocator,
    sourceAnnotationTemplate,
    sourceEvidenceState,
    type SourcePassage,
  } from '$lib/source-reading';

  let storage: StorageAdapter | null = null;
  let workspace: Workspace | null = null;
  let workspaceRestoring = true;
  let machineRecoveryPending = false;
  let machineRecoveryReason = '';
  let desktopRuntime = false;
  let storageLabel = '';
  // An example belongs in the placeholder. Seeding the value here meant a first Enter created a
  // topic — and a folder — named after the example instead of what the reader came to learn.
  let topicTitle = '';
  let topicKind: 'certification' | 'general' = 'general';
  let selectedSlug = '';
  let notePath = '';
  let noteContent = '';
  let noteDraft = '';
  let annotationAnchorStatus: {
    message: string;
    state: 'anchored' | 'stale' | 'unanchored';
  } | null = null;
  let editingNote = false;
  let editableNote = false;
  let newNoteTitle = '';
  let workspaceView: WorkspaceView = 'note';
  let graphMode: GraphMode = 'outline';
  let conflict: MarkdownConflict | null = null;
  let busy = false;
  let error = '';
  let setupErrorElement: HTMLParagraphElement | null = null;
  let setupErrorTarget: 'browser' | 'folder' | 'import' | null = null;
  let status = '';
  let inspectorOpen = false;
  let mobileNavOpen = false;
  let online = true;
  let navigationElement: HTMLElement | null = null;
  let navigationCloseButton: HTMLButtonElement | null = null;
  let mobileMenuButton: HTMLButtonElement | null = null;
  let companionStatus = 'Not connected';
  let companionClient: CompanionResearchClient | null = null;
  let companionAiClient: CompanionAiClient | null = null;
  let artifactRevision = 0;
  let learningRevision = 0;
  let researchAutoStartSlug = '';
  let researchFocusEventId = '';
  let providerRecoverySlug = '';
  let providerRecoveryReturnSlug = '';
  let researchQuestionDrafts: Record<string, string> = {};
  let obsidianGuideOpen = false;
  let obsidianDialog: HTMLDialogElement;
  let obsidianCloseButton: HTMLButtonElement;
  let statusTimer: number | undefined;
  let creatingTopic = false;
  let previousSlug = '';
  let conflictPanel: HTMLElement | undefined;
  let conflictAcceptButton: HTMLButtonElement | undefined;
  let workspaceHealthPanel: HTMLElement | undefined;
  let workspaceHealthComponent: WorkspaceHealth | undefined;
  let canvasElement: HTMLElement | undefined;
  let certificationSetupSlug = '';
  const dismissedCertificationSetups = new SvelteSet<string>();
  let savedSourceCount = 0;
  let sourceCountRequest = 0;
  let readingSources: SourceRecord[] = [];

  const unlockHint = 'Select or create a topic to open these views.';
  // Workspace restoration can normalize the visible URL as soon as the component mounts. Keep
  // the launch query long enough to consume a one-time companion credential before that happens.
  const launchSearch = typeof window === 'undefined' ? '' : window.location.search;

  $: diff = conflict
    ? lineDiff(conflict.currentContent, conflict.proposalContent).filter(
        (row) => row.kind !== 'same',
      )
    : [];
  $: editableNote = Boolean(
    selectedSlug &&
    workspaceView === 'note' &&
    notePath.startsWith(`Topics/${selectedSlug}/Notes/`) &&
    notePath.endsWith('.md'),
  );
  $: void refreshSavedSourceCount(storage, selectedSlug, artifactRevision);

  onMount(() => {
    const stopAppearanceSync = startSystemAppearanceSync();
    desktopRuntime = '__TAURI_INTERNALS__' in window;
    const desktop = window.matchMedia('(min-width: 60rem)');
    const syncInspector = () => {
      if (!desktop.matches) inspectorOpen = false;
    };
    syncInspector();
    desktop.addEventListener('change', syncInspector);
    const restoreView = () => void applyLocationView();
    window.addEventListener('popstate', restoreView);
    // navigator.onLine read straight from the template is a plain property, so nothing invalidates
    // it; the header kept reporting whatever was true at first paint. Mirror it into state instead.
    const syncOnline = () => (online = navigator.onLine);
    syncOnline();
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    void restoreWorkspace();
    // This belongs to the application shell rather than Settings: an opted-in learner who opens
    // straight into Learn must still receive the automatic signed check and download.
    void runAutomaticUpdateCheck().catch(() => {
      // Offline or withdrawn feeds do not interrupt the local learning workspace. Settings keeps
      // the explicit retry and recovery path available.
    });
    void registerServiceWorker();
    void connectCompanionFromUrl();
    return () => {
      stopAppearanceSync();
      desktop.removeEventListener('change', syncInspector);
      window.removeEventListener('popstate', restoreView);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  });

  /**
   * The drawer covers the canvas but is not a dialog, so the browser gives it none of a modal's
   * focus behaviour. Opening moves focus into it, dismissing hands focus back to the control that
   * opened it, and `containTab` keeps Tab from wandering into the canvas underneath.
   */
  async function openMobileNav(): Promise<void> {
    mobileNavOpen = true;
    await tick();
    navigationCloseButton?.focus();
  }

  function dismissMobileNav(): void {
    mobileNavOpen = false;
    mobileMenuButton?.focus();
  }

  /** Starts a user-requested view at its own heading instead of inheriting another view's scroll. */
  async function orientView(): Promise<void> {
    await tick();
    window.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    const heading = canvasElement?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  /** Reflects the open view in the URL so reload, Back and Forward all land where the user was. */
  function syncLocation(replace = false): void {
    const next = workspaceNavigationUrl(
      { documentPath: notePath, graphMode, topicSlug: selectedSlug, view: workspaceView },
      location.pathname,
      location.search,
    );
    if (next === `${location.pathname}${location.search}`) return;
    if (replace) replaceState(next, {});
    else pushState(next, {});
  }

  function currentNavigationState(): WorkspaceNavigationState {
    return {
      creatingTopic,
      documentPath: notePath,
      graphMode,
      topicCreationReturnSlug: previousSlug,
      topicSlug: selectedSlug,
      view: workspaceView,
    };
  }

  function commitNavigation(
    intent: WorkspaceNavigationIntent,
    record = true,
    replace = false,
  ): boolean {
    const decision = transitionWorkspaceNavigation(currentNavigationState(), intent, {
      history: record ? (replace ? 'replace' : 'push') : 'none',
      pathname: location.pathname,
      search: location.search,
    });
    if (decision.rejected) {
      status = decision.rejected;
      return false;
    }
    if (decision.state.view !== workspaceView && status.startsWith('Topic created.')) {
      window.clearTimeout(statusTimer);
      status = '';
    }
    if (workspaceView === 'settings' && decision.state.view !== 'settings') {
      providerRecoverySlug = '';
    }
    stopEditingNote();
    creatingTopic = decision.state.creatingTopic;
    previousSlug = decision.state.topicCreationReturnSlug;
    selectedSlug = decision.state.topicSlug;
    workspaceView = decision.state.view;
    graphMode = decision.state.graphMode;
    notePath = decision.state.documentPath;
    conflict = null;
    inspectorOpen = false;
    mobileNavOpen = false;
    if (decision.history !== 'none' && decision.url !== `${location.pathname}${location.search}`) {
      if (decision.history === 'replace') replaceState(decision.url, {});
      else pushState(decision.url, {});
    }
    if (decision.orient) void orientView();
    return true;
  }

  /** Applies the view described by the current URL. Never writes history back. */
  async function applyLocationView(): Promise<void> {
    if (!storage || !workspace) return;
    const restored = parseWorkspaceLocation(
      location.search,
      new Set(workspace.topics.map((topic) => topic.slug)),
    );
    if (!restored) return;
    const { documentPath: path, graphMode: restoredGraphMode, topicSlug: slug, view } = restored;
    const requested = new URLSearchParams(location.search);
    const normalizeLocation =
      requested.get('view') !== view ||
      (view === 'note' ? requested.get('path') !== path : requested.has('path')) ||
      (view === 'graph'
        ? requested.get('map') !== (restoredGraphMode === 'visual' ? 'visual' : null)
        : requested.has('map'));
    if (view === 'graph') openGraph(false, restoredGraphMode);
    else if (view === 'insights') openInsights(false);
    else if (view === 'research') openResearch(slug, false);
    else if (view === 'today') {
      await prepareCertificationSetup(slug);
      openToday(slug, false);
    } else if (view === 'roadmap') await openRoadmap(slug, false);
    else if (view === 'settings') openSettings(false);
    else if (view === 'sources') openSources(slug, false);
    else if (view === 'note' && path) await openGraphDocument(path, false);
    else openResearch(slug, false);
    if (normalizeLocation) syncLocation(true);
  }

  async function refreshSavedSourceCount(
    currentStorage: StorageAdapter | null,
    slug: string,
    revision: number,
  ): Promise<void> {
    void revision;
    const request = ++sourceCountRequest;
    if (!currentStorage || !slug) {
      savedSourceCount = 0;
      return;
    }
    try {
      const manifest = await readSourceManifest(currentStorage, slug);
      if (request === sourceCountRequest) savedSourceCount = manifest.sources.length;
    } catch {
      if (request === sourceCountRequest) savedSourceCount = 0;
    }
  }

  async function registerServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register(`${base}/service-worker.js`, { scope: `${base}/` });
      } catch {
        // The app remains functional without installation support.
      }
    }
  }

  async function connectCompanionFromUrl(): Promise<void> {
    if (desktopRuntime) {
      try {
        const session = await startBundledDesktopSession();
        if (!session) throw new Error('The bundled desktop session is unavailable.');
        companionClient = createCompanionResearchClient({
          baseUrl: session.origin,
          token: session.token,
        });
        companionAiClient = createCompanionAiClient({
          baseUrl: session.origin,
          token: session.token,
        });
        companionStatus = 'Connected to the bundled local research service';
      } catch {
        companionClient = null;
        companionAiClient = null;
        companionStatus = 'The bundled local research service could not start.';
      }
      return;
    }
    const parameters = new URLSearchParams(launchSearch);
    const token = parameters.get('token');
    if (!token) {
      if (dev || location.hostname === 'udhawan97.github.io') return;
      try {
        const response = await fetch(`${location.origin}/api/health`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const health: unknown = await response.json().catch(() => null);
        if (!isCompanionHealth(health)) return;
        companionClient = createCompanionResearchClient({ baseUrl: location.origin });
        companionAiClient = createCompanionAiClient({ baseUrl: location.origin });
        companionStatus = 'Connected securely for this desktop session';
      } catch {
        // A normal hosted/browser session has no same-origin companion endpoint.
      }
      return;
    }
    const requested = parameters.get('companion') ?? location.origin;
    const cleanQuery = stripCompanionCredentials(launchSearch);
    // This runs during first mount, before SvelteKit's client router is guaranteed to be attached.
    // Native history replacement removes the launch secret without initiating app navigation.
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${location.hash}`,
    );
    const companion = resolveCompanionOrigin(requested, location.origin);
    if (!companion) {
      companionClient = null;
      companionAiClient = null;
      companionStatus =
        'Connection was denied. Allow local-network access, or open the URL printed by npx @udhawan97/dusori.';
      return;
    }
    try {
      const response = await fetch(`${companion}/api/health`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Companion returned ${response.status}.`);
      const health: unknown = await response.json().catch(() => null);
      if (!isCompanionHealth(health)) throw new Error('Unrecognized companion health response.');
      companionClient = createCompanionResearchClient({ baseUrl: companion, token });
      companionAiClient = createCompanionAiClient({ baseUrl: companion, token });
      companionStatus = 'Connected for this session';
    } catch {
      companionClient = null;
      companionAiClient = null;
      companionStatus =
        'Connection was denied. Allow local-network access, or open the URL printed by npx @udhawan97/dusori.';
    }
  }

  async function restoreWorkspace(): Promise<void> {
    try {
      const native = await resolveDesktopStorage();
      if (native) {
        if (!(await native.read('dusori.json'))) {
          await createWorkspace(native, 'My research workspace');
        }
        await activateStorage(native, 'Desktop workspace · on this device', true);
        return;
      }
      const saved = await restoreDirectoryHandle();
      if (saved) {
        const adapter = new FsaStorageAdapter(saved);
        if (await adapter.read('dusori.json')) {
          await activateStorage(adapter, `Folder · ${saved.name}`, true);
          return;
        }
      }
      const adapter = await openBrowserStorage();
      if (adapter) await activateStorage(adapter, 'Browser workspace · private', true);
    } catch (caught) {
      // Restoration is best-effort. Setup remains available.
      if (desktopRuntime) {
        error = 'Dusori could not open its desktop workspace. Restart the app and try again.';
      } else if (caught instanceof BrowserStorageSelectionError) {
        setupErrorTarget = 'browser';
        error = caught.message;
      }
    } finally {
      workspaceRestoring = false;
    }
  }

  /**
   * `restoreView` is for the initial page load only. Creating or importing a workspace starts at
   * Today instead of reviving a view that belonged to the workspace being replaced.
   */
  async function activateStorage(
    adapter: StorageAdapter,
    label: string,
    restoreView = false,
  ): Promise<void> {
    storage = adapter;
    storageLabel = label;
    machineRecoveryPending = false;
    machineRecoveryReason = '';
    try {
      workspace = await readMachineFile(adapter, 'dusori.json', WorkspaceSchema);
    } catch (cause) {
      const recoveries = await inspectMachineFileRecoveries(adapter).catch(() => []);
      if (!recoveries.some((plan) => plan.path === 'dusori.json')) throw cause;
      workspace = null;
      machineRecoveryPending = true;
      machineRecoveryReason =
        cause instanceof Error ? cause.message : 'A machine-owned workspace file is invalid.';
      return;
    }
    const first = workspace.topics[0];
    if (!first) {
      if (restoreView) await applyLocationView();
      else await orientView();
      return;
    }
    await prepareCertificationSetup(first.slug);
    openResearch(first.slug, false);
    if (restoreView) await applyLocationView();
    else {
      syncLocation(true);
      await orientView();
    }
  }

  async function resumeRecoveredWorkspace(): Promise<void> {
    if (!storage) return;
    await activateStorage(storage, storageLabel, true);
    artifactRevision += 1;
    learningRevision += 1;
  }

  async function createBrowserWorkspace(): Promise<void> {
    await perform(async () => {
      const adapter = await createBrowserStorage();
      await createWorkspace(adapter, 'My research workspace');
      await activateStorage(adapter, 'Browser workspace · private');
      status = 'Browser workspace created. Nothing was uploaded.';
    }, 'browser');
  }

  async function connectFolder(): Promise<void> {
    await perform(async () => {
      const adapter = await pickDirectory();
      if (!(await adapter.read('dusori.json')))
        await createWorkspace(adapter, 'My research workspace');
      await activateStorage(adapter, `Folder · ${adapter.root.name}`);
      status = 'Folder connected. Dusori writes only inside this selected root.';
    }, 'folder');
  }

  async function openObsidianGuide(): Promise<void> {
    obsidianGuideOpen = true;
    await tick();
    obsidianCloseButton?.focus();
  }

  function closeObsidianGuide(): void {
    obsidianGuideOpen = false;
  }

  async function addTopic(): Promise<void> {
    if (!storage || !topicTitle.trim()) return;
    await perform(async () => {
      const creatingKind = topicKind;
      const created = await createTopic(storage!, topicTitle.trim(), new Date(), {
        kind: creatingKind,
      });
      workspace = created.workspace;
      topicTitle = '';
      if (creatingKind === 'certification') {
        dismissedCertificationSetups.delete(created.topicSlug);
        certificationSetupSlug = created.topicSlug;
        researchAutoStartSlug = '';
        openToday(created.topicSlug);
        status = created.workspaceHomeConflict
          ? 'Certification topic created. Home.md had external changes, so a proposal was written beside it.'
          : 'Certification topic created without making a network request. Add the exact official outline when ready.';
      } else {
        certificationSetupSlug = '';
        researchAutoStartSlug = created.topicSlug;
        openResearch(created.topicSlug);
        status = created.workspaceHomeConflict
          ? 'Topic created. Home.md had external changes, so a proposal was written beside it.'
          : 'Topic created. Research is ready for the providers you explicitly allow.';
      }
      topicKind = 'general';
    });
  }

  /** Reveals the topic form again once a workspace already has topics. */
  function startNewTopic(): void {
    commitNavigation({ kind: 'start-topic' });
  }

  function cancelNewTopic(): void {
    const slug = previousSlug;
    if (commitNavigation({ kind: 'cancel-topic' }, false) && slug) void openTopic(slug);
  }

  async function openTopic(slug: string): Promise<void> {
    if (!storage) return;
    await prepareCertificationSetup(slug);
    const synthesis = await storage.read(`Topics/${slug}/Synthesis.md`);
    const manifest = await readSourceManifest(storage, slug).catch(() => null);
    if (synthesis && !manifest?.synthesisStaleAt) {
      await openGraphDocument(`Topics/${slug}/Synthesis.md`);
    } else openResearch(slug);
  }

  function showImportedRoadmap(content: string): void {
    if (!commitNavigation({ kind: 'open', topicSlug: selectedSlug, view: 'roadmap' })) return;
    noteContent = content;
    learningRevision += 1;
    artifactRevision += 1;
    announceStatus('Curriculum applied. The imported roadmap is open.');
  }

  function refreshArtifacts(): void {
    artifactRevision += 1;
  }

  function openToday(slug = selectedSlug, record = true): void {
    commitNavigation({ kind: 'open', topicSlug: slug, view: 'today' }, record);
  }

  async function prepareCertificationSetup(slug: string): Promise<void> {
    const topic = workspace?.topics.find((candidate) => candidate.slug === slug);
    if (!storage || topic?.kind !== 'certification' || dismissedCertificationSetups.has(slug)) {
      if (certificationSetupSlug === slug) certificationSetupSlug = '';
      return;
    }
    const roadmap = await storage.read(`Topics/${slug}/roadmap.md`);
    certificationSetupSlug = roadmap?.content.includes('origin: imported-curriculum') ? '' : slug;
  }

  async function openLearning(slug = selectedSlug, record = true): Promise<void> {
    if (!slug) return;
    await prepareCertificationSetup(slug);
    openToday(slug, record);
  }

  async function openRoadmap(slug = selectedSlug, record = true): Promise<void> {
    if (!storage || !slug) return;
    const path = `Topics/${slug}/roadmap.md`;
    noteContent = (await storage.read(path))?.content ?? '';
    commitNavigation({ kind: 'open', topicSlug: slug, view: 'roadmap' }, record);
  }

  function openResearch(slug = selectedSlug, record = true): void {
    researchFocusEventId = '';
    commitNavigation({ kind: 'open', topicSlug: slug, view: 'research' }, record);
  }

  function openResearchEvent(slug: string, eventId: string): void {
    researchFocusEventId = eventId;
    commitNavigation({ kind: 'open', topicSlug: slug, view: 'research' }, true);
  }

  function openSources(slug = selectedSlug, record = true): void {
    commitNavigation({ kind: 'open', topicSlug: slug, view: 'sources' }, record);
  }

  function openSettings(record = true): void {
    commitNavigation({ kind: 'open', view: 'settings' }, record);
  }

  function rememberResearchQuestion(slug: string, question: string): void {
    if (!slug || researchQuestionDrafts[slug] === question) return;
    researchQuestionDrafts = { ...researchQuestionDrafts, [slug]: question };
  }

  async function reviewProviderChoices(slug: string): Promise<void> {
    if (!slug) return;
    providerRecoverySlug = slug;
    openSettings();
    await tick();
    const heading = document.getElementById('provider-choices-title');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function returnToResearch(): void {
    const slug = providerRecoverySlug;
    providerRecoverySlug = '';
    if (slug) {
      providerRecoveryReturnSlug = slug;
      openResearch(slug);
    }
  }

  function openGraph(record = true, mode: GraphMode = 'outline'): void {
    commitNavigation({ graphMode: mode, kind: 'open', view: 'graph' }, record);
  }

  function setGraphMode(mode: GraphMode): void {
    commitNavigation({ graphMode: mode, kind: 'set-graph-mode' }, true, true);
  }

  function openInsights(record = true): void {
    commitNavigation({ kind: 'open', view: 'insights' }, record);
  }

  async function openGraphDocument(path: string, record = true): Promise<void> {
    if (!storage) return;
    const content = (await storage.read(path))?.content ?? '';
    if (!commitNavigation({ documentPath: path, kind: 'open', view: 'note' }, record)) return;
    noteContent = content;
    annotationAnchorStatus = await inspectAnnotationAnchor(content);
    await refreshReadingSources(path);
  }

  async function inspectAnnotationAnchor(
    content: string,
  ): Promise<{ message: string; state: 'anchored' | 'stale' | 'unanchored' } | null> {
    const metadata = parseSourceAnnotationMetadata(content);
    if (!storage || !metadata?.locator) return null;
    const source = await storage.read(metadata.sourcePath);
    if (!source) {
      return {
        message: 'The local source is missing. The original quote remains in this note.',
        state: 'unanchored',
      };
    }
    const resolution = await resolveSourceQuoteLocator({
      locator: metadata.locator,
      recordedSourceContentHash: metadata.sourceContentHash,
      sourceContent: source.content,
      sourceContentHash: source.hash,
    });
    if (resolution.status === 'anchored') {
      return {
        message:
          resolution.method === 'position'
            ? 'Anchored to the verified position in this exact local source copy.'
            : 'Anchored by verified quote context in this exact local source copy.',
        state: 'anchored',
      };
    }
    return resolution.status === 'stale'
      ? {
          message:
            'The local source changed. Dusori retained the original quote and did not silently re-anchor it.',
          state: 'stale',
        }
      : {
          message:
            'This local copy no longer has one unambiguous anchor. The original quote remains in the note.',
          state: 'unanchored',
        };
  }

  async function refreshReadingSources(path: string): Promise<void> {
    const topicSlug = /^Topics\/([^/]+)\/Sources\/items\//u.exec(path)?.[1] ?? '';
    if (!storage || !topicSlug) {
      readingSources = [];
      return;
    }
    try {
      readingSources = (await readSourceManifest(storage, topicSlug)).sources;
    } catch {
      // The document itself remains readable. Workspace health owns invalid manifest recovery.
      readingSources = [];
    }
  }

  // Delegated from the note sheet rather than from MarkdownView, which also renders research
  // snippets and fetched captures. Only a document already inside the workspace steers navigation.
  async function followWikilink(event: MouseEvent): Promise<void> {
    if (!storage) return;
    const anchor = (event.target as Element | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (isExternalHttpUrl(href)) {
      try {
        await handleExternalLink(event, href, desktopRuntime);
      } catch {
        announceStatus('The system browser could not open this link.');
      }
      return;
    }
    const target = wikilinkTarget(href);
    if (!target) return;
    event.preventDefault();
    const entries = await storage.list('', true);
    const paths = new Set(
      entries
        .filter((entry) => entry.kind === 'file' && /\.(?:md|txt)$/iu.test(entry.path))
        .map((entry) => entry.path),
    );
    const resolved = resolveWikilink(notePath, target, paths);
    if (!resolved) {
      // Creating the page a link names stays with workspace health, which asks first.
      announceStatus(`“${target}” is not a document here yet. Workspace health can create it.`);
      return;
    }
    await openGraphDocument(resolved);
  }

  async function openSearchDocument(path: string): Promise<void> {
    await openGraphDocument(path);
  }

  function handleRoadmapChanged(slug: string, content: string): void {
    if (slug === selectedSlug) noteContent = content;
    learningRevision += 1;
    artifactRevision += 1;
  }

  function stopEditingNote(): void {
    editingNote = false;
    noteDraft = '';
  }

  function beginEditingNote(): void {
    if (!editableNote) return;
    noteDraft = noteContent;
    editingNote = true;
  }

  function noteRelativePath(path = notePath): string {
    const prefix = `Topics/${selectedSlug}/`;
    if (!path.startsWith(prefix)) throw new Error('This note is outside the selected topic.');
    return path.slice(prefix.length);
  }

  async function saveNote(): Promise<void> {
    if (!storage || !selectedSlug || !editableNote) return;
    await perform(async () => {
      const relativePath = noteRelativePath();
      const result = await proposeMarkdownUpdate(storage!, selectedSlug, relativePath, noteDraft);
      if ('proposalPath' in result) {
        conflict = result;
        noteContent = result.currentContent;
        stopEditingNote();
        status = 'An external edit stayed active. Review the proposed note before accepting it.';
        await tick();
        conflictPanel?.scrollIntoView({ block: 'start' });
        conflictAcceptButton?.focus();
        return;
      }
      await acceptMarkdownUpdate(
        storage!,
        selectedSlug,
        relativePath,
        noteDraft,
        result.currentHash,
        new Date(),
        `- Saved an explicit edit to [[../../../${relativePath.replace(/\.md$/u, '')}]].`,
      );
      noteContent = noteDraft;
      annotationAnchorStatus = await inspectAnnotationAnchor(noteDraft);
      stopEditingNote();
      status = 'Note saved locally and recorded in the update log.';
    });
  }

  async function createStudyNote(): Promise<void> {
    if (!storage || !selectedSlug || !newNoteTitle.trim()) return;
    await perform(async () => {
      const created = await createNote(storage!, selectedSlug, newNoteTitle);
      newNoteTitle = '';
      if (!commitNavigation({ documentPath: created.path, kind: 'open', view: 'note' })) return;
      noteContent = created.content;
      noteDraft = created.content;
      annotationAnchorStatus = null;
      editingNote = true;
      status = 'Note created. Add the first useful idea, then save it.';
    });
  }

  async function annotateCurrentSource(passage?: SourcePassage): Promise<void> {
    if (!storage || !selectedSlug || !notePath.includes('/Sources/items/')) return;
    await perform(async () => {
      const currentSource = readingSources.find((source) => source.path === notePath);
      if (!currentSource) throw new Error('This reading copy is not in the active source shelf.');
      const currentSourceFile = await storage!.read(notePath);
      if (!currentSourceFile) throw new Error('This local reading copy is missing.');
      if (passage && sourceEvidenceState(currentSource) === 'reference') {
        throw new Error('Add readable local text before quoting this reference.');
      }
      const locatedPassage = passage
        ? {
            ...passage,
            locator: await buildSourceQuoteLocator({
              exact: passage.text,
              sourceContent: currentSourceFile.content,
              sourceContentHash: currentSourceFile.hash,
            }),
            text: normalizeSelectedPassage(passage.text),
          }
        : undefined;
      const sourceName = noteContent.match(/^#\s+(.+)$/mu)?.[1]?.trim() ?? currentSource.title;
      const baseTitle = `Notes on ${sourceName}`.slice(0, 160);
      let title = baseTitle;
      let suffix = 2;
      while (await storage!.read(`Topics/${selectedSlug}/Notes/${slugify(title)}.md`)) {
        const suffixText = ` ${suffix}`;
        title = `${baseTitle.slice(0, 160 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      const createdAt = new Date();
      const content = sourceAnnotationTemplate({
        createdAt,
        ...(locatedPassage ? { passage: locatedPassage } : {}),
        source: currentSource,
        sourceContentHash: currentSourceFile.hash,
        title,
        topicSlug: selectedSlug,
      });
      const created = await createNote(storage!, selectedSlug, title, createdAt, { content });
      let activityWarning = '';
      try {
        await recordResearchThreadEvent(
          storage!,
          selectedSlug,
          {
            notePath: created.path,
            noteSha256: await sha256(created.content),
            ...(passage
              ? { quoteSha256: await sha256(normalizeSelectedPassage(passage.text)) }
              : {}),
            sourcePath: notePath,
            sourceSha256: currentSource.sha256,
            type: 'note-added',
          },
          createdAt,
        );
      } catch {
        activityWarning = ' The note was saved, but thread activity could not be updated.';
      }
      if (!commitNavigation({ documentPath: created.path, kind: 'open', view: 'note' })) return;
      noteContent = created.content;
      noteDraft = created.content;
      annotationAnchorStatus = await inspectAnnotationAnchor(created.content);
      editingNote = true;
      status = passage
        ? `Quoted passage and source context saved locally. Add what it changes, then save your note.${activityWarning}`
        : `Source-linked note created. Add what mattered, then save it locally.${activityWarning}`;
    });
  }

  async function runConflictProof(): Promise<void> {
    if (!storage || !selectedSlug) return;
    await perform(async () => {
      const firstNotePath = `Topics/${selectedSlug}/Notes/001-first-look.md`;
      const firstNote = await storage!.read(firstNotePath);
      if (!firstNote) throw new Error('The first study note is missing.');
      const externallyEdited = `${firstNote.content.trimEnd()}\n\n> External edit: this sentence must survive.\n`;
      await storage!.write(firstNotePath, externallyEdited);
      const proposed = `${firstNote.content.trimEnd()}\n\n## Proposed next step\n\nConnect this note to one verified source.\n`;
      const result = await proposeMarkdownUpdate(
        storage!,
        selectedSlug,
        'Notes/001-first-look.md',
        proposed,
      );
      // The proof is only convincing if its result is on screen: show the note the proposal
      // concerns, then bring the diff and its accept action into view.
      if (!commitNavigation({ documentPath: firstNotePath, kind: 'open', view: 'note' })) return;
      noteContent = (await storage!.read(firstNotePath))?.content ?? externallyEdited;
      if ('proposalPath' in result) conflict = result;
      status = 'External content stayed in place. Dusori wrote a separate proposal and update log.';
    });
    // The accept control is disabled while `perform` is busy, so focus only after the operation
    // releases it. Focusing a disabled control silently does nothing and leaves the decision below
    // the viewport when this proof is launched from another view.
    if (!conflict) return;
    await tick();
    conflictAcceptButton?.scrollIntoView({ block: 'center' });
    conflictAcceptButton?.focus();
  }

  /** Brings an existing proposal back on screen from the inspector. */
  async function showConflict(): Promise<void> {
    if (!conflict) return;
    const visibleConflict = conflict;
    if (
      !commitNavigation({
        documentPath: visibleConflict.currentPath,
        kind: 'open',
        view: 'note',
      })
    )
      return;
    conflict = visibleConflict;
    await tick();
    conflictPanel?.scrollIntoView({ block: 'start' });
    conflictAcceptButton?.focus();
  }

  async function openPendingProposal(item: ProposalAttentionItem): Promise<void> {
    if (!storage) return;
    await perform(async () => {
      const [current, proposed] = await Promise.all([
        storage!.read(item.currentPath),
        storage!.read(item.proposalPath),
      ]);
      if (!current) throw new Error(`The proposal target is missing: ${item.currentPath}`);
      if (!proposed) throw new Error(`The proposal file is missing: ${item.proposalPath}`);
      if (
        !commitNavigation({
          documentPath: item.currentPath,
          kind: 'open',
          topicSlug: item.topicSlug,
          view: 'note',
        })
      )
        return;
      noteContent = current.content;
      conflict = {
        currentContent: current.content,
        currentContentHash: current.hash,
        currentPath: item.currentPath,
        expectedContentHash: current.hash,
        proposalContent: proposed.content,
        proposalPath: item.proposalPath,
        updatePath: '',
      };
      await tick();
      conflictPanel?.scrollIntoView({ block: 'start' });
      conflictAcceptButton?.focus();
    });
    await tick();
    conflictAcceptButton?.scrollIntoView({ block: 'nearest' });
    conflictAcceptButton?.focus();
  }

  async function openWorkspaceHealth(): Promise<void> {
    inspectorOpen = true;
    mobileNavOpen = false;
    await workspaceHealthComponent?.refresh();
    await tick();
    workspaceHealthPanel?.scrollIntoView({ block: 'start' });
  }

  async function acceptConflict(): Promise<void> {
    if (!storage || !selectedSlug || !conflict) return;
    await perform(async () => {
      const pending = conflict!;
      const now = new Date();
      await acceptMarkdownUpdate(
        storage!,
        selectedSlug,
        noteRelativePath(pending.currentPath),
        pending.proposalContent,
        pending.currentContentHash,
        now,
        undefined,
        pending.proposalPath,
      );
      await resolveResearchSynthesisProposal(
        storage!,
        selectedSlug,
        pending.proposalPath,
        'accepted',
        now,
      );
      noteContent = pending.proposalContent;
      conflict = null;
      artifactRevision += 1;
      learningRevision += 1;
      status = 'You accepted the proposal. Dusori updated the note and logged that decision.';
    });
  }

  async function keepConflict(): Promise<void> {
    if (!storage || !selectedSlug || !conflict) return;
    await perform(async () => {
      const pending = conflict!;
      const now = new Date();
      await resolvePendingProposal(storage!, selectedSlug, pending.proposalPath, 'kept', now);
      await resolveResearchSynthesisProposal(
        storage!,
        selectedSlug,
        pending.proposalPath,
        'kept',
        now,
      );
      conflict = null;
      learningRevision += 1;
      status = 'You kept the current document. The proposal remains as readable history.';
    });
  }

  function downloadArchive(archive: Uint8Array, filename: string): void {
    const bytes = new Uint8Array(archive.byteLength);
    bytes.set(archive);
    const blob = new Blob([bytes.buffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function downloadWorkspace(): Promise<void> {
    if (!storage) return;
    await perform(async () => {
      const archive = await exportWorkspace(storage!);
      downloadArchive(archive, `dusori-workspace-${new Date().toISOString().slice(0, 10)}.zip`);
      status = 'Workspace exported as a portable ZIP.';
    });
  }

  async function downloadTopic(): Promise<void> {
    if (!storage || !selectedSlug) return;
    await perform(async () => {
      const archive = await exportTopic(storage!, selectedSlug);
      downloadArchive(
        archive,
        `dusori-topic-${selectedSlug}-${new Date().toISOString().slice(0, 10)}.zip`,
      );
      status =
        'Topic exported as a portable ZIP. It holds one topic, so it is not a workspace archive Dusori can import.';
    });
  }

  async function uploadWorkspace(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await perform(async () => {
      const prepared = await prepareWorkspaceImport(await file.arrayBuffer());
      const { fileCount, topicCount, workspaceName } = prepared.preview;
      const replacing = Boolean(storage && (await storage.read('dusori.json')));
      const confirmed = window.confirm(
        `${replacing ? 'Replace this browser workspace with' : 'Import'} “${workspaceName}”?\n\n` +
          `${topicCount} topic${topicCount === 1 ? '' : 's'} · ${fileCount} files\n\n` +
          `The archive was validated before this confirmation.${
            replacing
              ? ' If storage fails during replacement, Dusori will restore the current workspace.'
              : ''
          }`,
      );
      if (!confirmed) return;
      const adapter = storage ?? (await createBrowserStorage());
      await replaceWorkspace(adapter, prepared);
      await activateStorage(adapter, 'Browser workspace · imported');
      status = 'Workspace validated and imported safely.';
    }, 'import');
    input.value = '';
  }

  async function perform(
    action: () => Promise<void>,
    target: 'browser' | 'folder' | 'import' | null = null,
  ): Promise<void> {
    busy = true;
    setupErrorTarget = target;
    error = '';
    status = '';
    try {
      await action();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not complete that action.';
      if (target) {
        await tick();
        setupErrorElement?.scrollIntoView({ block: 'nearest' });
        setupErrorElement?.focus();
      }
    } finally {
      busy = false;
      if (status) scheduleStatusClear(status);
    }
  }

  function announceStatus(message: string): void {
    status = message;
    scheduleStatusClear(message);
  }

  function scheduleStatusClear(message: string): void {
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (status === message) status = '';
    }, 3200);
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      obsidianGuideOpen = false;
      if (mobileNavOpen) dismissMobileNav();
      inspectorOpen = false;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && selectedSlug) {
      event.preventDefault();
      openResearch();
    }
    // The drawer covers the canvas without being a dialog, so nothing stops Tab reaching what is
    // behind it. Held at the window: a listener on the <nav> would be an interaction handler on a
    // non-interactive element.
    if (mobileNavOpen && navigationElement) containTab(navigationElement, event);
  }}
/>

<svelte:head>
  <title>Dusori — local-first research</title>
  <meta
    name="description"
    content="A local-first research desk that finds, saves, and synthesizes source-backed evidence."
  />
</svelte:head>

{#if workspaceRestoring}
  <main class="startup-state" aria-busy="true">
    <span class="brand-symbol" aria-hidden="true">
      <img
        class="brand-mark-light"
        src={`${base}/brand/dusori-mark.svg`}
        alt=""
        width="28"
        height="28"
      />
      <img
        class="brand-mark-dark"
        src={`${base}/brand/dusori-mark-reversed.svg`}
        alt=""
        width="28"
        height="28"
      />
    </span>
    <p>Opening your Research Desk…</p>
  </main>
{:else if machineRecoveryPending && storage}
  <main class="recovery-shell">
    <header class="setup-header">
      <a class="wordmark" href="../">
        <span class="brand-symbol" aria-hidden="true">
          <img
            class="brand-mark-light"
            src={`${base}/brand/dusori-mark.svg`}
            alt=""
            width="28"
            height="28"
          />
          <img
            class="brand-mark-dark"
            src={`${base}/brand/dusori-mark-reversed.svg`}
            alt=""
            width="28"
            height="28"
          />
        </span>
        <span>Dusori</span>
      </a>
      <ThemeToggle />
    </header>
    <MachineFileRecovery
      {storage}
      blocking
      reason={machineRecoveryReason}
      onRecovered={() => resumeRecoveredWorkspace()}
    />
  </main>
{:else if !workspace}
  <main class="setup-shell">
    <header class="setup-header">
      <a class="wordmark" href="../">
        <span class="brand-symbol" aria-hidden="true">
          <img
            class="brand-mark-light"
            src={`${base}/brand/dusori-mark.svg`}
            alt=""
            width="28"
            height="28"
          />
          <img
            class="brand-mark-dark"
            src={`${base}/brand/dusori-mark-reversed.svg`}
            alt=""
            width="28"
            height="28"
          />
        </span>
        <span>Dusori</span>
      </a>
      <div class="setup-actions">
        <a class="quiet-link" href="../docs/">Read docs</a>
        <ThemeToggle />
      </div>
    </header>

    <section class="setup-intro" aria-labelledby="setup-title">
      <p class="kicker">Local-first · free · no account</p>
      <h1 id="setup-title">Make a research desk you can keep.</h1>
      <p>
        <span class="setup-copy-wide">
          Start privately in this browser, or grant access to one folder. Dusori stores plain
          Markdown and JSON, then finds sources only through providers you allow. It does not upload
          your notes.
        </span>
        <span class="setup-copy-compact">
          Start in this browser or connect one folder. Your notes stay on this device.
        </span>
      </p>
    </section>

    {#if !desktopRuntime}
      <section class="setup-options" aria-label="Workspace choices">
        <article>
          <HardDrive aria-hidden="true" size={24} strokeWidth={1.5} />
          <h2>Browser workspace</h2>
          <p>Works across modern browsers. Export regularly for a portable backup.</p>
          <button class="primary-button" disabled={busy} onclick={createBrowserWorkspace}>
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
          {#if error && setupErrorTarget === 'browser'}
            <p
              class="message error setup-error"
              role="alert"
              tabindex="-1"
              bind:this={setupErrorElement}
            >
              {error}
            </p>
          {/if}
        </article>

        <article>
          <FolderOpen aria-hidden="true" size={24} strokeWidth={1.5} />
          <h2>Connect a folder</h2>
          <p>
            Chromium desktop only. Choose a Dusori folder, including one inside an Obsidian vault.
          </p>
          <button
            class="secondary-button"
            disabled={busy || !('showDirectoryPicker' in globalThis)}
            onclick={connectFolder}
          >
            Connect folder
          </button>
          <button class="text-button" disabled={busy} onclick={openObsidianGuide}>
            Use Dusori with Obsidian
          </button>
          {#if error && setupErrorTarget === 'folder'}
            <p
              class="message error setup-error"
              role="alert"
              tabindex="-1"
              bind:this={setupErrorElement}
            >
              {error}
            </p>
          {/if}
        </article>
      </section>
    {/if}

    {#if obsidianGuideOpen}
      <dialog
        use:modal
        class="obsidian-dialog"
        aria-labelledby="obsidian-title"
        bind:this={obsidianDialog}
        oncancel={(event) => {
          event.preventDefault();
          closeObsidianGuide();
        }}
      >
        <div class="dialog-heading">
          <div>
            <p class="kicker">Obsidian · least privilege</p>
            <h2 id="obsidian-title">Connect only a Dusori folder.</h2>
          </div>
          <button
            class="icon-button"
            bind:this={obsidianCloseButton}
            aria-label="Close Obsidian guide"
            onclick={closeObsidianGuide}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <ol>
          <li>Open or create your vault in Obsidian.</li>
          <li>Create a folder named <strong>Dusori</strong> inside that vault.</li>
          <li>Select that Dusori folder here — never the whole vault.</li>
        </ol>
        <p class="privacy-note">
          <span class="privacy-icon">
            <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.5} />
          </span>
          <span
            ><strong>No Obsidian plugin is required.</strong> Dusori reads and writes only the folder
            you approve.</span
          >
        </p>
        {#if 'showDirectoryPicker' in globalThis}
          <button class="primary-button" disabled={busy} onclick={connectFolder}>
            Select my Dusori folder
          </button>
        {:else}
          <p class="message">Folder connection needs Chrome or Edge on desktop.</p>
          <a class="quiet-link" href="#workspace-import" onclick={closeObsidianGuide}>
            Use ZIP import instead
          </a>
        {/if}
      </dialog>
    {/if}

    {#if !desktopRuntime}
      <div class="setup-import">
        <label class="import-link" id="workspace-import">
          <Upload aria-hidden="true" size={17} />
          Import an exported workspace
          <input type="file" accept=".zip,application/zip" onchange={uploadWorkspace} />
        </label>
        {#if error && setupErrorTarget === 'import'}
          <p
            class="message error setup-error"
            role="alert"
            tabindex="-1"
            bind:this={setupErrorElement}
          >
            {error}
          </p>
        {/if}
      </div>
    {/if}

    {#if error && !setupErrorTarget}<p class="message error" role="alert">{error}</p>{/if}
    <p class="setup-footnote">
      No AI is required. No telemetry or background service runs. Web research starts only after
      provider consent.
    </p>
  </main>
{:else}
  <main
    class:inspector-closed={!inspectorOpen}
    class:mobile-nav-open={mobileNavOpen}
    class="workbench"
  >
    <nav
      bind:this={navigationElement}
      class:open={mobileNavOpen}
      class="studio-header"
      id="workspace-navigation"
      aria-label="Dusori Research Desk"
    >
      <div class="studio-brand">
        <span class="brand-symbol" aria-hidden="true">
          <img
            class="brand-mark-light"
            src={`${base}/brand/dusori-mark.svg`}
            alt=""
            width="28"
            height="28"
          />
          <img
            class="brand-mark-dark"
            src={`${base}/brand/dusori-mark-reversed.svg`}
            alt=""
            width="28"
            height="28"
          />
        </span>
        <span>Dusori</span>
        <button
          bind:this={navigationCloseButton}
          class="studio-close"
          aria-label="Close workspace navigation"
          onclick={dismissMobileNav}
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <div class="studio-section">
        <p>Research Desk</p>
        <button
          class:active={workspaceView === 'research'}
          class="studio-link"
          disabled={!selectedSlug}
          title={selectedSlug ? undefined : unlockHint}
          onclick={() => openResearch()}
        >
          <Search aria-hidden="true" size={18} />
          Research
        </button>
        <button
          class:active={workspaceView === 'sources'}
          class="studio-link"
          disabled={!selectedSlug}
          title={selectedSlug ? undefined : unlockHint}
          onclick={() => openSources()}
        >
          <Library aria-hidden="true" size={18} />
          <span class="studio-link-label">Sources</span>
          <span class="nav-count" aria-label={`${savedSourceCount} saved sources`}
            >{savedSourceCount}</span
          >
        </button>
        <button
          class:active={workspaceView === 'graph'}
          class="studio-link"
          disabled={!workspace.topics.length}
          title={workspace.topics.length ? undefined : unlockHint}
          onclick={() => openGraph()}
        >
          <Map aria-hidden="true" size={18} />
          Map
        </button>
        <button
          class:active={workspaceView === 'settings'}
          class="studio-link"
          onclick={() => openSettings()}
        >
          <Settings aria-hidden="true" size={18} />
          Settings
        </button>
        {#if !selectedSlug}
          <p class="studio-hint">{unlockHint}</p>
        {/if}
      </div>
      <div class="studio-section topic-list">
        <p>Topics</p>
        {#each workspace.topics as topic (topic.slug)}
          <button
            class:active={topic.slug === selectedSlug}
            class="studio-link"
            title={topic.title}
            onclick={() => openTopic(topic.slug)}
          >
            <FileText aria-hidden="true" size={18} />
            <span class="studio-link-label">{topic.title}</span>
          </button>
        {/each}
        <button class:active={creatingTopic} class="studio-link new-topic" onclick={startNewTopic}>
          <Plus aria-hidden="true" size={18} />
          <span class="studio-link-label">New topic</span>
        </button>
      </div>
      <div class="studio-meta">
        <span>{storageLabel}</span>
        <span>{online ? 'Online · local data' : 'Offline · ready'}</span>
      </div>
    </nav>

    {#if mobileNavOpen}
      <button
        class="studio-backdrop"
        aria-label="Close workspace navigation"
        onclick={dismissMobileNav}
      ></button>
    {/if}

    <section class="canvas" id="note" bind:this={canvasElement}>
      <header class="canvas-bar">
        <button
          bind:this={mobileMenuButton}
          class="mobile-menu"
          aria-label="Open workspace navigation"
          aria-controls="workspace-navigation"
          aria-expanded={mobileNavOpen}
          onclick={openMobileNav}
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        <div>
          <p class="path-label">
            {workspaceView === 'today'
              ? 'Learn · today'
              : workspaceView === 'sources'
                ? `Sources · ${savedSourceCount} saved`
                : workspaceView === 'research'
                  ? 'Research · question to brief'
                  : workspaceView === 'graph'
                    ? 'Map · research outline'
                    : workspaceView === 'insights'
                      ? 'Learn · evidence and reflection'
                      : workspaceView === 'roadmap'
                        ? 'Learn · your path'
                        : workspaceView === 'settings'
                          ? 'Settings · workspace controls'
                          : notePath || 'Workspace ready'}
          </p>
          <p class="save-state">Plain Markdown · changes stay local</p>
        </div>
        {#if selectedSlug && workspaceView !== 'research'}
          <button class="research-pill" onclick={() => openResearch()}>
            <Search aria-hidden="true" size={16} />
            <span>Research this topic…</span>
            <kbd>⌘K</kbd>
          </button>
        {/if}
        <div class="canvas-actions">
          {#if editableNote && !editingNote}
            <button class="icon-button" aria-label="Edit note" onclick={beginEditingNote}>
              <Pencil aria-hidden="true" size={19} />
            </button>
          {/if}
          <ThemeToggle />
          <button
            class="icon-button"
            aria-label={inspectorOpen ? 'Close inspector' : 'Open inspector'}
            aria-pressed={inspectorOpen}
            onclick={() => (inspectorOpen = !inspectorOpen)}
          >
            {#if inspectorOpen}
              <PanelRightClose aria-hidden="true" size={20} />
            {:else}
              <PanelRightOpen aria-hidden="true" size={20} />
            {/if}
          </button>
        </div>
      </header>

      {#if selectedSlug && storage && workspaceView === 'note'}
        <TopicAsk
          {storage}
          topicSlug={selectedSlug}
          topicTitle={workspace.topics.find((topic) => topic.slug === selectedSlug)?.title ??
            selectedSlug}
          onOpen={(path) => void openGraphDocument(path)}
        />
      {/if}

      {#if workspaceView === 'settings' && storage}
        <AppSettings
          {storage}
          storageKind={storage?.kind ?? 'unknown'}
          {storageLabel}
          {companionStatus}
          ai={companionAiClient}
          {online}
          {busy}
          hasTopic={Boolean(selectedSlug)}
          hasUnsavedWrites={editingNote || Boolean(conflict) || busy}
          onExportWorkspace={() => void downloadWorkspace()}
          onExportTopic={() => void downloadTopic()}
          onImportWorkspace={(event) => void uploadWorkspace(event)}
          onOpenLegacyLearning={() => void openLearning()}
          providerRecoveryActive={Boolean(providerRecoverySlug)}
          onReturnToResearch={returnToResearch}
          onMachineFileRecovered={() => resumeRecoveredWorkspace()}
        />
      {:else if selectedSlug}
        {#if workspaceView === 'sources' && storage}
          <section class="sources-studio" aria-labelledby="sources-view-title">
            <header>
              <div>
                <p class="kicker">Your evidence shelf · {savedSourceCount} saved</p>
                <h1 id="sources-view-title">Sources</h1>
                <p>
                  Everything saved for this topic is here, including the diverse first shelf from
                  each research run. References and readable evidence are labeled separately.
                </p>
              </div>
              <button class="primary-button" onclick={() => openResearch()}>
                <Search aria-hidden="true" size={18} /> Research further
              </button>
            </header>
            <SourceLibrary
              {storage}
              topicSlug={selectedSlug}
              topicTitle={workspace.topics.find((topic) => topic.slug === selectedSlug)?.title ??
                selectedSlug}
              companion={companionClient}
              revision={artifactRevision}
              onSourceSaved={refreshArtifacts}
              onOpenSource={(path) => void openGraphDocument(path)}
            />
          </section>
        {:else if workspaceView === 'note'}
          {#if editingNote}
            <section class="note-editor" aria-labelledby="note-editor-title">
              <div class="note-editor-heading">
                <div>
                  <p class="kicker">Local Markdown</p>
                  <h1 id="note-editor-title">Edit note</h1>
                </div>
                <p>External changes remain protected by a reviewable proposal.</p>
              </div>
              <label for="note-markdown">Markdown note</label>
              <textarea id="note-markdown" bind:value={noteDraft} spellcheck="true"></textarea>
              <div class="note-editor-actions">
                <button class="secondary-button" disabled={busy} onclick={stopEditingNote}
                  >Cancel</button
                >
                <button class="primary-button" disabled={busy} onclick={saveNote}>
                  <Save aria-hidden="true" size={18} />
                  {busy ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </section>
          {:else}
            {#if notePath.includes('/Sources/items/')}
              <SourceReader
                content={noteContent}
                currentPath={notePath}
                sources={readingSources}
                onAnnotate={(passage) => void annotateCurrentSource(passage)}
                onFollowLink={(event) => void followWikilink(event)}
                onOpenAll={() => openSources()}
                onOpenSource={(path) => void openGraphDocument(path)}
              />
            {:else}
              {#if annotationAnchorStatus}
                <aside
                  class="annotation-anchor-status"
                  data-state={annotationAnchorStatus.state}
                  aria-live="polite"
                >
                  <strong>
                    {annotationAnchorStatus.state === 'anchored'
                      ? 'Quote anchor verified'
                      : 'Quote kept, anchor needs attention'}
                  </strong>
                  <p>{annotationAnchorStatus.message}</p>
                </aside>
              {/if}
              <!-- svelte-ignore a11y_click_events_have_key_events (delegation only: every target is a rendered <a>, which Enter already activates) -->
              <!-- svelte-ignore a11y_no_static_element_interactions (the sheet is a container; the links inside carry the roles) -->
              <div class="note-sheet" onclick={(event) => void followWikilink(event)}>
                <MarkdownView content={noteContent} />
              </div>
            {/if}
          {/if}
        {:else if workspaceView === 'graph' && storage}
          <KnowledgeGraph
            {storage}
            mode={graphMode}
            onModeChange={setGraphMode}
            onOpen={(path) => void openGraphDocument(path)}
            onOpenEvent={openResearchEvent}
          />
        {:else if workspaceView === 'research' && storage && workspace}
          {#key `${selectedSlug}-${learningRevision}`}
            <ResearchWorkspace
              {storage}
              topicSlug={selectedSlug}
              topicTitle={workspace.topics.find((topic) => topic.slug === selectedSlug)?.title ??
                selectedSlug}
              topics={workspace.topics}
              companion={companionClient}
              ai={companionAiClient}
              autoStart={researchAutoStartSlug === selectedSlug}
              initialQuestion={researchQuestionDrafts[selectedSlug] ?? ''}
              providerRecoveryReturn={providerRecoveryReturnSlug === selectedSlug}
              focusEventId={researchFocusEventId}
              onAutoStartHandled={() => (researchAutoStartSlug = '')}
              onProviderRecoveryReturnHandled={() => {
                if (providerRecoveryReturnSlug === selectedSlug) providerRecoveryReturnSlug = '';
              }}
              onQuestionChange={(question) => rememberResearchQuestion(selectedSlug, question)}
              onReviewProviderChoices={() => void reviewProviderChoices(selectedSlug)}
              onArtifactSaved={refreshArtifacts}
              onOpenSource={(path) => void openGraphDocument(path)}
              onOpenSources={() => openSources()}
              onOpenMap={() => openGraph(true, 'visual')}
              onOpenResearch={(slug) => openResearch(slug)}
            />
          {/key}
        {:else if workspaceView === 'insights' && storage && workspace}
          <LearningInsights
            {storage}
            {workspace}
            revision={artifactRevision + learningRevision}
            onOpen={(path) => void openGraphDocument(path)}
            onOpenTopic={(slug) => openToday(slug)}
          />
        {:else if storage && workspace}
          {#if workspaceView === 'today' && certificationSetupSlug === selectedSlug}
            <section class="certification-setup" aria-labelledby="certification-setup-title">
              <div>
                <p class="kicker">Certification setup · no lookup made</p>
                <h1 id="certification-setup-title">Add the exact official outline.</h1>
                <p>
                  Paste or import the certification owner's current outline. Dusori does not guess a
                  code, silently substitute another exam, or contact a provider before consent.
                </p>
              </div>
              <CurriculumImporter
                {storage}
                topicSlug={selectedSlug}
                onRoadmapApplied={(content) => {
                  certificationSetupSlug = '';
                  showImportedRoadmap(content);
                }}
                onSourceSaved={refreshArtifacts}
              />
              <button
                class="text-button"
                onclick={() => {
                  dismissedCertificationSetups.add(selectedSlug);
                  certificationSetupSlug = '';
                  announceStatus('Official outline setup deferred. Your topic remains unchanged.');
                }}>Not now</button
              >
            </section>
          {:else}
            <LearningLoop
              {storage}
              {workspace}
              ai={companionAiClient}
              topicSlug={selectedSlug}
              view={workspaceView === 'roadmap' ? 'roadmap' : 'today'}
              revision={learningRevision}
              onArtifactSaved={refreshArtifacts}
              onOpenProposal={(proposal) => void openPendingProposal(proposal)}
              onOpenRoadmap={(slug) => void openRoadmap(slug)}
              onOpenResearch={(slug) => openResearch(slug)}
              onOpenInsights={() => openInsights()}
              onOpenTopic={(slug) => openToday(slug)}
              onOpenWorkspaceHealth={() => void openWorkspaceHealth()}
              onRoadmapChanged={handleRoadmapChanged}
              onStatus={announceStatus}
            />
          {/if}
        {/if}
      {:else}
        <section class="empty-topic" aria-labelledby="new-topic-title">
          <p class="kicker">One question · research follows</p>
          <h1 id="new-topic-title">
            {workspace.topics.length
              ? 'Open another line of inquiry.'
              : 'What do you want to understand?'}
          </h1>
          <p>
            Dusori creates a portable topic, searches the providers you choose, saves a varied first
            shelf, and opens the source-backed brief it can honestly build.
          </p>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void addTopic();
            }}
          >
            <fieldset class="topic-kind">
              <legend>What kind of research is this?</legend>
              <label>
                <input type="radio" bind:group={topicKind} value="general" />
                <span>
                  <strong>General topic</strong>
                  <small>Build a source-backed brief from the providers you choose.</small>
                </span>
              </label>
              <label>
                <input type="radio" bind:group={topicKind} value="certification" />
                <span>
                  <strong>Certification</strong>
                  <small>Start with the exact code and official outline—never a guess.</small>
                </span>
              </label>
            </fieldset>
            <label for="topic-title">Topic name</label>
            <div class="input-row">
              <input
                id="topic-title"
                bind:value={topicTitle}
                required
                maxlength="160"
                placeholder={topicKind === 'certification'
                  ? 'AI-103'
                  : 'History of the printing press'}
                aria-describedby="topic-help"
              />
              <button class="primary-button" disabled={busy || !topicTitle.trim()}>
                {busy ? 'Opening desk…' : 'Create topic'}
              </button>
            </div>
            <p id="topic-help">
              {topicKind === 'certification'
                ? 'Use the exact certification code. Dusori stays offline until you provide the official outline or approve a provider.'
                : 'Use a clear subject or question. First use shows one grouped provider disclosure; later research is one action.'}
            </p>
            {#if previousSlug}
              <button class="text-button" type="button" disabled={busy} onclick={cancelNewTopic}>
                Cancel and go back
              </button>
            {/if}
          </form>
        </section>
      {/if}

      {#if conflict}
        <section
          class="conflict-panel"
          bind:this={conflictPanel}
          tabindex="-1"
          aria-labelledby="conflict-title"
        >
          <div class="conflict-heading">
            <ShieldCheck aria-hidden="true" size={24} strokeWidth={1.5} />
            <div>
              <p class="kicker">Write protection worked</p>
              <h2 id="conflict-title">Your external edit stayed untouched.</h2>
            </div>
          </div>
          <p>
            Dusori wrote <code>{conflict.proposalPath}</code> beside the note and recorded the event in
            the dated update log.
          </p>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region needs keyboard access) -->
          <div class="diff" role="region" aria-label="Proposed change diff" tabindex="0">
            {#each diff as row, index (`${index}-${row.kind}`)}
              <div class:added={row.kind === 'add'} class:removed={row.kind === 'remove'}>
                <span aria-hidden="true"
                  >{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span
                >
                <code>{row.line || ' '}</code>
              </div>
            {/each}
          </div>
          <div class="proposal-actions">
            <button class="secondary-button" disabled={busy} onclick={keepConflict}>
              Keep current document
            </button>
            <button
              bind:this={conflictAcceptButton}
              class="primary-button accept-proposal"
              disabled={busy}
              onclick={acceptConflict}
            >
              Accept this proposal
            </button>
          </div>
        </section>
      {/if}
    </section>

    {#if inspectorOpen}
      <button
        class="inspector-backdrop"
        aria-label="Close workspace details"
        onclick={() => (inspectorOpen = false)}
      ></button>
    {/if}
    <!-- Kept mounted while closed so a pasted curriculum outline and local search state survive. -->
    <aside
      class:open={inspectorOpen}
      class="inspector"
      aria-label="Workspace details"
      inert={!inspectorOpen}
    >
      <button
        class="inspector-close"
        aria-label="Close workspace details"
        onclick={() => (inspectorOpen = false)}
      >
        <X aria-hidden="true" size={20} />
      </button>
      <section>
        <p class="kicker">Storage</p>
        <h2>
          {storage?.kind === 'tauri'
            ? 'Desktop workspace'
            : storage?.kind === 'fsa'
              ? 'Connected folder'
              : 'Browser workspace'}
        </h2>
        <p>{storageLabel}</p>
      </section>

      {#if storage}
        <WorkspaceSearch {storage} onOpen={(path) => void openSearchDocument(path)} />
        <div bind:this={workspaceHealthPanel}>
          <WorkspaceHealth
            bind:this={workspaceHealthComponent}
            {storage}
            currentPath={notePath}
            onOpen={(path) => void openSearchDocument(path)}
            onArtifactsChanged={() => (artifactRevision += 1)}
          />
        </div>
      {/if}

      {#if selectedSlug && storage}
        <section class="new-note-panel">
          <p class="kicker">Notes</p>
          <h2>Create a study note</h2>
          <p>Dusori writes portable Markdown and records the new file in this topic.</p>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void createStudyNote();
            }}
          >
            <label for="new-note-title">New note title</label>
            <input
              id="new-note-title"
              bind:value={newNoteTitle}
              maxlength="160"
              required
              placeholder="Evidence map"
            />
            <button class="inspector-action" disabled={busy || !newNoteTitle.trim()}>
              <Plus aria-hidden="true" size={18} />
              Create note
            </button>
          </form>
        </section>

        <div class="curriculum-slot">
          {#key selectedSlug}
            <CurriculumImporter
              {storage}
              topicSlug={selectedSlug}
              onRoadmapApplied={showImportedRoadmap}
              onSourceSaved={refreshArtifacts}
            />
          {/key}
        </div>
      {/if}

      <section>
        <p class="kicker">Portability</p>
        <button class="inspector-action" disabled={busy} onclick={downloadWorkspace}>
          <Download aria-hidden="true" size={18} />
          Export workspace
        </button>
        {#if selectedSlug}
          <button class="inspector-action" disabled={busy} onclick={downloadTopic}>
            <Download aria-hidden="true" size={18} />
            Export this topic
          </button>
        {/if}
        <label class="inspector-action file-action">
          <Upload aria-hidden="true" size={18} />
          Import workspace
          <input type="file" accept=".zip,application/zip" onchange={uploadWorkspace} />
        </label>
        <p class="portability-note">
          A topic bundle holds one topic's files. It is a portable copy, not a workspace archive
          Dusori can import.
        </p>
      </section>

      {#if selectedSlug && storage}
        <section>
          <!-- Keyed on the topic only: the panel reloads itself after saving, and rekeying on
               artifactRevision would discard the confirmation it just showed. -->
          {#key selectedSlug}
            <TutorPreferences
              {storage}
              topicSlug={selectedSlug}
              topicTitle={workspace?.topics.find((topic) => topic.slug === selectedSlug)?.title ??
                selectedSlug}
              aiClient={companionAiClient}
              onSaved={() => (artifactRevision += 1)}
            />
          {/key}
        </section>
      {/if}

      {#if selectedSlug}
        <section>
          <p class="kicker">Safety proof</p>
          <p>Exercise the stale-write path without replacing the current note.</p>
          {#if conflict}
            <button class="inspector-action" onclick={showConflict}>
              <ShieldCheck aria-hidden="true" size={18} />
              Review the proposal
            </button>
          {:else}
            <button class="inspector-action" disabled={busy} onclick={runConflictProof}>
              <ShieldCheck aria-hidden="true" size={18} />
              Run conflict proof
            </button>
          {/if}
        </section>
      {/if}

      <section class="companion-state">
        <p class="kicker">Local companion</p>
        <p>{companionStatus}</p>
      </section>
    </aside>

    {#if error || status}
      <div class="mobile-status" aria-live="polite">
        {#if error}<span class="error">{error}</span>{:else}{status}{/if}
      </div>
    {/if}
  </main>
{/if}

<style>
  .startup-state {
    display: grid;
    min-height: 100dvh;
    align-content: center;
    justify-items: center;
    gap: var(--space-sm);
    color: var(--color-muted);
  }

  .startup-state p {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .setup-shell {
    width: min(100%, 82rem);
    min-height: 100dvh;
    margin-inline: auto;
    padding: var(--space-md) var(--page-gutter) var(--space-2xl);
  }

  .recovery-shell {
    display: grid;
    width: min(100%, 82rem);
    min-height: 100dvh;
    align-content: start;
    gap: clamp(var(--space-xl), 7vh, var(--space-2xl));
    margin-inline: auto;
    padding: var(--space-md) var(--page-gutter) var(--space-2xl);
  }

  .setup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-block-end: var(--space-md);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 600;
    text-decoration: none;
  }

  .wordmark img {
    flex: none;
    inline-size: 1.75rem;
    block-size: 1.75rem;
  }

  .brand-symbol {
    position: relative;
    display: grid;
    flex: none;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    place-items: center;
  }

  .brand-symbol img {
    position: absolute;
    inset: 0;
  }

  .brand-mark-dark {
    display: none;
  }

  :global(html[data-theme='dark']) .brand-mark-light {
    display: none;
  }

  :global(html[data-theme='dark']) .brand-mark-dark {
    display: block;
  }

  .setup-actions {
    display: flex;
    align-items: center;
    gap: var(--space-md);
  }

  .quiet-link,
  .import-link,
  .text-button {
    color: var(--color-accent-text);
    text-underline-offset: 0.25em;
  }

  .text-button {
    display: block;
    min-height: 2.75rem;
    margin-block-start: var(--space-sm);
    padding: 0;
    border: 0;
    background: transparent;
    text-decoration: underline;
    cursor: pointer;
  }

  /* The hero reserved most of the first screen, which pushed both workspace choices — the only way
   * to start — below the fold at every size we support. It keeps its display type; it no longer
   * keeps the whole viewport. */
  .setup-intro {
    display: grid;
    align-content: end;
    min-height: min(38dvh, 22rem);
    padding-block: var(--space-2xl) var(--space-xl);
  }

  .setup-intro h1,
  .empty-topic h1 {
    max-width: 12ch;
    font-size: var(--text-display);
  }

  .setup-intro > p:last-child,
  .empty-topic > p {
    max-width: 52ch;
    font-size: var(--text-md);
  }

  .setup-copy-compact {
    display: none;
  }

  .kicker,
  .path-label,
  .studio-section > p {
    margin: 0;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .setup-options {
    display: grid;
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .setup-options article {
    padding-block: var(--space-xl);
  }

  .setup-options article + article {
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .setup-options h2 {
    margin-block-start: var(--space-md);
    font-size: var(--text-lg);
  }

  .primary-button,
  .secondary-button,
  .inspector-action,
  .icon-button,
  .mobile-menu,
  .studio-link {
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    transition:
      background-color var(--dur-short) var(--ease-out),
      color var(--dur-short) var(--ease-out),
      transform var(--dur-micro) var(--ease-out);
  }

  .primary-button,
  .secondary-button {
    padding-inline: var(--space-lg);
  }

  .primary-button {
    border-color: var(--color-ink);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .primary-button:active,
  .secondary-button:active,
  .inspector-action:active,
  .icon-button:active {
    transform: translateY(1px);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .import-link {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    gap: var(--space-xs);
    margin-block-start: var(--space-lg);
    cursor: pointer;
  }

  .setup-import {
    margin-block-start: var(--space-lg);
  }

  .setup-import .import-link {
    margin-block-start: 0;
  }

  .setup-error {
    max-width: 52ch;
    margin-block: var(--space-sm) 0;
    outline: none;
  }

  .import-link input,
  .file-action input {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .import-link:focus-within,
  .file-action:focus-within {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  .setup-footnote,
  .message {
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .error {
    color: var(--color-error);
  }

  .obsidian-dialog {
    width: min(100%, 38rem);
    max-height: calc(100dvh - 2rem);
    overflow: auto;
    padding: var(--space-xl);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-md);
    outline: none;
    background: var(--color-paper);
    box-shadow: 0 2rem 6rem color-mix(in srgb, var(--color-ink) 55%, transparent);
  }

  .obsidian-dialog::backdrop {
    background: color-mix(in srgb, var(--color-ink) 72%, transparent);
  }

  .dialog-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .dialog-heading h2 {
    margin-block-start: var(--space-xs);
  }

  .obsidian-dialog ol {
    display: grid;
    gap: var(--space-md);
    margin-block: var(--space-xl);
    padding-inline-start: var(--space-lg);
  }

  .privacy-note {
    display: flex;
    align-items: start;
    gap: var(--space-sm);
    padding-block: var(--space-md);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .privacy-icon {
    display: grid;
    flex: none;
    color: var(--color-marigold, var(--color-accent-text));
    place-items: center;
  }

  .workbench {
    display: grid;
    min-height: 100dvh;
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-header,
  .inspector {
    display: none;
  }

  .studio-header.open {
    position: fixed;
    z-index: var(--z-modal);
    inset: 0 auto 0 0;
    display: flex;
    width: min(85vw, 20rem);
    flex-direction: column;
    padding: var(--space-lg) var(--space-md);
    border-inline-end: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
    box-shadow: 1rem 0 3rem color-mix(in srgb, var(--color-ink) 16%, transparent);
  }

  .studio-backdrop {
    position: fixed;
    z-index: calc(var(--z-modal) - 1);
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--color-ink) 30%, transparent);
  }

  .inspector.open {
    position: fixed;
    z-index: var(--z-modal);
    inset: 0 0 0 auto;
    display: flex;
    width: min(88vw, 22rem);
    flex-direction: column;
    gap: var(--space-xl);
    padding: var(--space-xl) var(--space-lg);
    border-inline-start: var(--rule-hair) solid var(--color-rule);
    overflow-y: auto;
    background: var(--color-paper-2);
    box-shadow: -1rem 0 3rem color-mix(in srgb, var(--color-ink) 16%, transparent);
  }

  .inspector-backdrop {
    position: fixed;
    z-index: calc(var(--z-modal) - 1);
    inset: 0;
    border: 0;
    background: color-mix(in srgb, var(--color-ink) 30%, transparent);
  }

  .inspector-close {
    display: grid;
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin-inline-start: auto;
    padding: 0;
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .inspector section + section,
  .curriculum-slot,
  .curriculum-slot + section {
    padding-block-start: var(--space-lg);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .inspector h2 {
    margin-block-start: var(--space-xs);
    font-size: var(--text-md);
  }

  .inspector p {
    font-size: var(--text-sm);
  }

  .portability-note {
    margin-block-start: var(--space-xs);
    color: var(--color-muted);
    font-size: var(--text-sm);
    line-height: 1.5;
  }

  .inspector-action {
    position: relative;
    display: flex;
    width: 100%;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
    padding-inline: var(--space-sm);
    text-align: start;
  }

  .studio-brand {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .studio-close {
    display: grid;
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin-inline-start: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .studio-section {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: var(--space-xl);
    /* An auto track would grow to the longest topic name and push the topic shelf over the canvas. */
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-link {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border-color: transparent;
    color: var(--color-ink);
    text-align: start;
    text-decoration: none;
  }

  .studio-link.active {
    border-color: var(--color-rule);
    background: var(--color-paper);
  }

  /* Flex children shrink by default, so a long topic name took its overflow out of the icon as
   * well as the label and squashed an 18px mark to a sliver. Only the label may give ground. */
  .studio-link > :global(svg) {
    flex: none;
  }

  /* A topic name can run to 160 characters; truncate in place instead of spilling over the
   * canvas. The full name stays in the button's title and in the graph artifact index. */
  .studio-link-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .studio-link.new-topic {
    color: var(--color-accent-text);
    font-weight: 700;
  }

  .nav-count {
    min-width: 1.5rem;
    margin-inline-start: auto;
    padding-inline: var(--space-2xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: 999px;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .studio-hint {
    color: var(--color-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .studio-meta {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: auto;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .canvas {
    min-width: 0;
  }

  .canvas-bar {
    position: sticky;
    z-index: var(--z-sticky);
    top: 0;
    display: flex;
    min-height: 4.5rem;
    align-items: center;
    gap: var(--space-sm);
    justify-content: space-between;
    padding: var(--space-sm) var(--page-gutter);
    border-block-end: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
  }

  .canvas-bar > div {
    min-width: 0;
    flex: 1;
  }

  .canvas-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-xs);
  }

  .research-pill {
    display: none;
    min-width: 0;
    min-height: 2.75rem;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: 999px;
    background: var(--color-paper-2);
    color: var(--color-muted);
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }

  .research-pill span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .research-pill kbd {
    padding: var(--space-3xs) var(--space-2xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .research-pill:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  @media (min-width: 48rem) {
    .research-pill {
      display: inline-flex;
      max-width: 19rem;
    }
  }

  .path-label {
    overflow: hidden;
    color: var(--color-ink);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .save-state {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .icon-button,
  .mobile-menu {
    display: grid;
    inline-size: 2.75rem;
    padding: 0;
    place-items: center;
  }

  .note-sheet,
  .note-editor,
  .empty-topic,
  .conflict-panel {
    width: min(100%, 54rem);
    margin-inline: auto;
    padding: var(--space-2xl) var(--page-gutter);
  }

  .sources-studio {
    width: min(100%, 66rem);
    margin-inline: auto;
    padding: var(--space-2xl) var(--page-gutter) var(--space-3xl);
  }

  .sources-studio > header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-lg);
    padding-block-end: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .sources-studio h1 {
    margin-block-start: var(--space-xs);
    font-size: clamp(2.5rem, 7vw, 4.75rem);
  }

  .sources-studio header p:last-child {
    margin-block-end: 0;
    color: var(--color-muted);
  }

  .sources-studio .primary-button {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-xs);
  }

  .sources-studio :global(.source-library) {
    margin-block-start: var(--space-xl);
  }

  .note-editor {
    display: grid;
    gap: var(--space-md);
  }

  .note-editor-heading {
    display: flex;
    align-items: end;
    gap: var(--space-lg);
    justify-content: space-between;
  }

  .note-editor-heading h1 {
    margin-block-start: var(--space-xs);
  }

  .note-editor-heading > p {
    max-width: 24rem;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .note-editor label,
  .new-note-panel label {
    font-weight: 700;
  }

  .note-editor textarea {
    width: 100%;
    min-height: min(62dvh, 40rem);
    resize: vertical;
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper-2);
    color: var(--color-ink);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.65;
  }

  .note-editor textarea:focus-visible {
    outline-color: var(--color-focus);
  }

  .note-editor-actions {
    display: flex;
    gap: var(--space-sm);
    justify-content: flex-end;
  }

  .note-editor-actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
  }

  .annotation-anchor-status {
    width: min(100%, 54rem);
    margin: var(--space-lg) auto 0;
    padding: var(--space-sm) var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-paper-2);
    color: var(--color-ink);
  }

  .annotation-anchor-status[data-state='anchored'] {
    border-color: var(--color-accent-text);
  }

  .annotation-anchor-status[data-state='stale'],
  .annotation-anchor-status[data-state='unanchored'] {
    border-color: var(--color-muted);
  }

  .annotation-anchor-status p {
    margin: var(--space-2xs) 0 0;
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .new-note-panel form {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: var(--space-md);
  }

  .empty-topic {
    display: grid;
    min-height: calc(100dvh - 4.5rem);
    align-content: center;
  }

  .empty-topic form {
    max-width: 42rem;
    margin-block-start: var(--space-xl);
  }

  .topic-kind {
    display: grid;
    gap: var(--space-xs);
    margin: 0 0 var(--space-lg);
    padding: 0;
    border: 0;
  }

  .topic-kind legend {
    margin-block-end: var(--space-xs);
    font-weight: 700;
  }

  .topic-kind label {
    display: grid;
    min-height: 4.5rem;
    align-items: start;
    gap: var(--space-sm);
    margin: 0;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    grid-template-columns: auto minmax(0, 1fr);
    cursor: pointer;
  }

  .topic-kind input {
    min-height: 0;
    margin-block-start: 0.3rem;
    accent-color: var(--color-accent);
  }

  .topic-kind strong,
  .topic-kind small {
    display: block;
  }

  .topic-kind small {
    color: var(--color-muted);
  }

  .certification-setup {
    display: grid;
    width: min(100%, 58rem);
    gap: var(--space-xl);
    margin-inline: auto;
    padding: var(--space-2xl) var(--page-gutter) var(--space-3xl);
  }

  .certification-setup > div:first-child {
    padding-block-end: var(--space-xl);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .certification-setup h1 {
    max-width: 14ch;
    margin-block-start: var(--space-xs);
    font-size: clamp(2.25rem, 7vw, 4.5rem);
  }

  .certification-setup > div:first-child > p:last-child {
    color: var(--color-muted);
    font-size: var(--text-md);
  }

  .empty-topic label {
    display: block;
    margin-block-end: var(--space-xs);
    font-weight: 700;
  }

  .input-row {
    display: grid;
    gap: var(--space-sm);
  }

  input {
    min-width: 0;
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper);
  }

  input:focus-visible {
    outline-color: var(--color-focus);
  }

  .conflict-panel {
    margin-block-end: var(--space-3xl);
    border-block: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
  }

  .conflict-heading {
    display: flex;
    align-items: flex-start;
    gap: var(--space-md);
  }

  .conflict-heading h2 {
    margin-block-start: var(--space-xs);
    font-size: var(--text-lg);
  }

  .diff {
    overflow: auto;
    margin-block-start: var(--space-lg);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper);
    font-size: var(--text-sm);
  }

  .diff:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .diff > div {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    padding-inline: var(--space-sm);
  }

  .diff .added {
    border-inline-start: 3px solid var(--color-success);
  }

  .diff .removed {
    border-inline-start: 3px solid var(--color-error);
  }

  .proposal-actions {
    display: grid;
    gap: var(--space-sm);
    margin-block-start: var(--space-lg);
  }

  @media (min-width: 38rem) {
    .proposal-actions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .mobile-status {
    position: fixed;
    z-index: var(--z-toast);
    inset: auto var(--space-md) var(--space-md) auto;
    width: min(22rem, calc(100vw - 2 * var(--space-md)));
    padding: var(--space-sm) var(--space-md);
    border: var(--rule-hair) solid var(--color-rule);
    background: var(--color-paper-2);
    font-size: var(--text-sm);
    /* An announcement with nothing to click. Now that the research controls sit inside the first
     * screen, an opaque toast over them would swallow a provider consent click for its lifetime. */
    pointer-events: none;
  }

  @media (hover: hover) and (pointer: fine) {
    .primary-button:hover,
    .secondary-button:hover,
    .inspector-action:hover,
    .icon-button:hover,
    .mobile-menu:hover,
    .studio-link:hover {
      background: var(--color-paper-2);
    }

    .primary-button:hover {
      background: var(--color-accent-text);
      color: var(--color-paper);
    }
  }

  @media (min-width: 40rem) {
    .setup-options {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .setup-options article {
      padding-inline: var(--space-xl);
    }

    .setup-options article:first-child {
      padding-inline-start: 0;
    }

    .setup-options article + article {
      border-block-start: 0;
      border-inline-start: var(--rule-hair) solid var(--color-rule);
    }

    .input-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }

  /* At the smallest supported widths the full display treatment made the primary start action
   * only partly visible. Keep the same promise and hierarchy, but use a compact reading measure so
   * the complete 44px action remains available even on a 320x568 screen. */
  @media (max-width: 24rem) {
    .setup-intro {
      min-height: 0;
      padding-block: var(--space-lg) var(--space-md);
    }

    .setup-intro h1 {
      font-size: 2.25rem;
      line-height: 1.06;
    }

    .setup-intro > p:last-child {
      margin-block: var(--space-xs) 0;
      font-size: var(--text-base);
      line-height: 1.45;
    }

    .setup-copy-wide {
      display: none;
    }

    .setup-copy-compact {
      display: inline;
    }

    .setup-options article {
      padding-block: var(--space-md);
    }

    .setup-options h2 {
      margin-block-start: var(--space-sm);
    }

    .sources-studio > header {
      align-items: stretch;
      flex-direction: column;
    }
  }

  @media (min-width: 60rem) {
    /* Desktop has the width the hero was spending on empty space to its right. Setting the two
     * workspace choices beside it puts the primary action in the first screen without touching
     * the type scale. */
    .setup-shell {
      display: grid;
      align-content: start;
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      column-gap: var(--space-3xl);
    }

    .setup-shell > :global(*) {
      grid-column: 1 / -1;
    }

    .setup-intro {
      min-height: 0;
      grid-column: 1;
      padding-block-end: var(--space-2xl);
    }

    .setup-options {
      grid-row: 2;
      grid-column: 2;
      align-self: center;
      grid-template-columns: minmax(0, 1fr);
    }

    .setup-options article {
      padding-inline: 0;
    }

    .setup-options article + article {
      border-block-start: var(--rule-hair) solid var(--color-rule);
      border-inline-start: 0;
    }

    .workbench,
    .workbench.inspector-closed {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
    }

    .studio-header {
      position: sticky;
      z-index: calc(var(--z-sticky) + 1);
      top: 0;
      display: grid;
      width: 100%;
      height: auto;
      min-height: 4.5rem;
      align-items: center;
      gap: var(--space-lg);
      padding: var(--space-xs) var(--page-gutter);
      border-inline-end: 0;
      border-block-end: var(--rule-hair) solid var(--color-rule);
      grid-template-columns: auto auto minmax(0, 1fr);
      background: color-mix(in srgb, var(--color-paper) 96%, transparent);
      box-shadow: none;
    }

    .studio-section {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: var(--space-2xs);
      margin-block-start: 0;
    }

    .studio-section > p {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
    }

    .studio-link {
      width: auto;
      flex: none;
      padding-inline: var(--space-sm);
    }

    .topic-list {
      justify-content: flex-end;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .topic-list .studio-link-label {
      max-width: 10rem;
    }

    .studio-meta {
      display: none;
    }

    .canvas {
      grid-row: 2;
      grid-column: 1;
    }

    .canvas-bar {
      position: static;
    }

    .canvas > :global(.topic-ask) {
      top: 4.5rem;
    }

    .inspector {
      position: fixed;
      z-index: var(--z-modal);
      inset: 0 0 0 auto;
      display: flex;
      width: min(88vw, 22rem);
      height: 100dvh;
      flex-direction: column;
      gap: var(--space-xl);
      padding: var(--space-xl) var(--space-lg);
      border-inline-start: var(--rule-hair) solid var(--color-rule);
      overflow-y: auto;
      background: var(--color-paper-2);
      box-shadow: -1rem 0 3rem color-mix(in srgb, var(--color-ink) 16%, transparent);
    }

    /* Closed means hidden, not unmounted, so inspector drafts survive. */
    .inspector:not(.open) {
      display: none;
    }

    .mobile-menu {
      display: none;
    }

    .studio-close,
    .studio-backdrop {
      display: none;
    }

    .mobile-status {
      inset-inline-end: var(--space-md);
    }
  }
</style>
