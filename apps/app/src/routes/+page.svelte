<script lang="ts">
  import { base } from '$app/paths';
  import {
    BookOpen,
    Download,
    FileText,
    FolderOpen,
    HardDrive,
    ListChecks,
    Menu,
    PanelRightClose,
    PanelRightOpen,
    Pencil,
    Plus,
    Save,
    ShieldCheck,
    Share2,
    Upload,
    X,
  } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';

  import {
    WorkspaceSchema,
    acceptMarkdownUpdate,
    createCompanionResearchClient,
    createNote,
    createTopic,
    createWorkspace,
    exportWorkspace,
    lineDiff,
    prepareWorkspaceImport,
    proposeMarkdownUpdate,
    readMachineFile,
    replaceWorkspace,
    type CompanionResearchClient,
    type MarkdownConflict,
    type StorageAdapter,
    type Workspace,
  } from '@dusori/core';
  import { FsaStorageAdapter, pickDirectory, restoreDirectoryHandle } from '@dusori/storage-fsa';
  import { createOpfsStorage } from '@dusori/storage-opfs';

  import {
    isCompanionHealth,
    resolveCompanionOrigin,
    stripCompanionCredentials,
  } from '$lib/companion-origin';
  import { modal } from '$lib/actions/modal';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import CurriculumImporter from '$lib/components/CurriculumImporter.svelte';
  import LearningLoop from '$lib/components/LearningLoop.svelte';
  import KnowledgeGraph from '$lib/components/KnowledgeGraph.svelte';
  import ResearchPanel from '$lib/components/ResearchPanel.svelte';
  import SourceLibrary from '$lib/components/SourceLibrary.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';
  import WorkspaceSearch from '$lib/components/WorkspaceSearch.svelte';
  import WorkspaceHealth from '$lib/components/WorkspaceHealth.svelte';

  let storage: StorageAdapter | null = null;
  let workspace: Workspace | null = null;
  let storageLabel = '';
  let topicTitle = 'AI Fundamentals';
  let selectedSlug = '';
  let notePath = '';
  let noteContent = '';
  let noteDraft = '';
  let editingNote = false;
  let editableNote = false;
  let newNoteTitle = '';
  let workspaceView: 'graph' | 'note' | 'roadmap' | 'today' = 'note';
  let conflict: MarkdownConflict | null = null;
  let busy = false;
  let error = '';
  let status = '';
  let inspectorOpen = false;
  let mobileNavOpen = false;
  let companionStatus = 'Not connected';
  let companionClient: CompanionResearchClient | null = null;
  let sourceRevision = 0;
  let learningRevision = 0;
  let obsidianGuideOpen = false;
  let obsidianDialog: HTMLDialogElement;
  let obsidianCloseButton: HTMLButtonElement;
  let statusTimer: number | undefined;
  let creatingTopic = false;
  let previousSlug = '';
  let conflictPanel: HTMLElement | undefined;

  const unlockHint = 'Select or create a topic to open these views.';

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

  onMount(() => {
    const desktop = window.matchMedia('(min-width: 60rem)');
    const syncInspector = () => (inspectorOpen = desktop.matches);
    syncInspector();
    desktop.addEventListener('change', syncInspector);
    const restoreView = () => void applyLocationView();
    window.addEventListener('popstate', restoreView);
    void restoreWorkspace();
    void registerServiceWorker();
    void connectCompanionFromUrl();
    return () => {
      desktop.removeEventListener('change', syncInspector);
      window.removeEventListener('popstate', restoreView);
    };
  });

  /** Reflects the open view in the URL so reload, Back and Forward all land where the user was. */
  function syncLocation(replace = false): void {
    const parameters = new SvelteURLSearchParams(location.search);
    if (selectedSlug) parameters.set('topic', selectedSlug);
    else parameters.delete('topic');
    if (workspaceView === 'today') parameters.delete('view');
    else parameters.set('view', workspaceView);
    if (workspaceView === 'note' && notePath) parameters.set('path', notePath);
    else parameters.delete('path');

    const query = parameters.toString();
    const next = `${location.pathname}${query ? `?${query}` : ''}`;
    if (next === `${location.pathname}${location.search}`) return;
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }

  /** Applies the view described by the current URL. Never writes history back. */
  async function applyLocationView(): Promise<void> {
    if (!storage || !workspace) return;
    const parameters = new URLSearchParams(location.search);
    const slug = parameters.get('topic') ?? '';
    const known = workspace.topics.some((topic) => topic.slug === slug);
    if (!known) return;
    const view = parameters.get('view');
    const path = parameters.get('path');
    if (view === 'graph') openGraph(false);
    else if (view === 'roadmap') await openRoadmap(slug, false);
    else if (view === 'note' && path) await openGraphDocument(path, false);
    else openToday(slug, false);
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
    const parameters = new URLSearchParams(location.search);
    const token = parameters.get('token');
    if (!token) return;
    const requested = parameters.get('companion') ?? location.origin;
    const cleanQuery = stripCompanionCredentials(location.search);
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${location.hash}`,
    );
    const companion = resolveCompanionOrigin(requested, location.origin);
    if (!companion) {
      companionClient = null;
      companionStatus =
        'Connection was denied. Allow local-network access, or open the URL printed by npx @udhawan97/dusori.';
      return;
    }
    try {
      const response = await fetch(`${companion}/api/health`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Companion returned ${response.status}.`);
      const health: unknown = await response.json().catch(() => null);
      if (!isCompanionHealth(health)) throw new Error('Unrecognized companion health response.');
      companionClient = createCompanionResearchClient({ baseUrl: companion, token });
      companionStatus = 'Connected for this session';
    } catch {
      companionClient = null;
      companionStatus =
        'Connection was denied. Allow local-network access, or open the URL printed by npx @udhawan97/dusori.';
    }
  }

  async function restoreWorkspace(): Promise<void> {
    try {
      const saved = await restoreDirectoryHandle();
      if (saved) {
        const adapter = new FsaStorageAdapter(saved);
        if (await adapter.read('dusori.json')) {
          await activateStorage(adapter, `Folder · ${saved.name}`, true);
          return;
        }
      }
      const adapter = await createOpfsStorage();
      if (await adapter.read('dusori.json'))
        await activateStorage(adapter, 'Browser workspace · private', true);
    } catch {
      // Restoration is best-effort. Setup remains available.
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
    workspace = await readMachineFile(adapter, 'dusori.json', WorkspaceSchema);
    const first = workspace.topics[0];
    if (!first) return;
    openToday(first.slug, false);
    if (restoreView) await applyLocationView();
    else syncLocation(true);
  }

  async function createBrowserWorkspace(): Promise<void> {
    await perform(async () => {
      const adapter = await createOpfsStorage();
      await createWorkspace(adapter, 'My learning workspace');
      await activateStorage(adapter, 'Browser workspace · private');
      status = 'Browser workspace created. Nothing was uploaded.';
    });
  }

  async function connectFolder(): Promise<void> {
    await perform(async () => {
      const adapter = await pickDirectory();
      if (!(await adapter.read('dusori.json')))
        await createWorkspace(adapter, 'My learning workspace');
      await activateStorage(adapter, `Folder · ${adapter.root.name}`);
      status = 'Folder connected. Dusori writes only inside this selected root.';
    });
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
      const created = await createTopic(storage!, topicTitle.trim());
      workspace = created.workspace;
      creatingTopic = false;
      previousSlug = '';
      topicTitle = '';
      await openTopic(created.topicSlug);
      status = created.workspaceHomeConflict
        ? 'Topic created. Home.md had external changes, so a proposal was written beside it.'
        : 'Topic created with its complete portable folder structure.';
    });
  }

  /** Reveals the topic form again once a workspace already has topics. */
  function startNewTopic(): void {
    previousSlug = selectedSlug;
    creatingTopic = true;
    selectedSlug = '';
    notePath = '';
    conflict = null;
    mobileNavOpen = false;
    syncLocation();
  }

  function cancelNewTopic(): void {
    creatingTopic = false;
    const slug = previousSlug;
    previousSlug = '';
    if (slug) openToday(slug);
  }

  async function openTopic(slug: string): Promise<void> {
    if (!storage) return;
    stopEditingNote();
    creatingTopic = false;
    selectedSlug = slug;
    await openDocument('Notes/001-first-look.md');
    conflict = null;
    mobileNavOpen = false;
  }

  async function openDocument(relativePath: string): Promise<void> {
    if (!storage || !selectedSlug) return;
    stopEditingNote();
    workspaceView = 'note';
    notePath = `Topics/${selectedSlug}/${relativePath}`;
    noteContent = (await storage.read(notePath))?.content ?? '';
    conflict = null;
    mobileNavOpen = false;
    syncLocation();
  }

  function showImportedRoadmap(content: string): void {
    workspaceView = 'roadmap';
    notePath = `Topics/${selectedSlug}/roadmap.md`;
    noteContent = content;
    learningRevision += 1;
    conflict = null;
    syncLocation();
    announceStatus('Curriculum applied. The imported roadmap is open.');
  }

  function refreshSources(): void {
    sourceRevision += 1;
  }

  function openToday(slug = selectedSlug, record = true): void {
    if (!slug) return;
    stopEditingNote();
    creatingTopic = false;
    selectedSlug = slug;
    workspaceView = 'today';
    notePath = '';
    conflict = null;
    mobileNavOpen = false;
    if (record) syncLocation();
  }

  async function openRoadmap(slug = selectedSlug, record = true): Promise<void> {
    if (!storage || !slug) return;
    stopEditingNote();
    creatingTopic = false;
    selectedSlug = slug;
    workspaceView = 'roadmap';
    notePath = `Topics/${slug}/roadmap.md`;
    noteContent = (await storage.read(notePath))?.content ?? '';
    conflict = null;
    mobileNavOpen = false;
    if (record) syncLocation();
  }

  function openGraph(record = true): void {
    stopEditingNote();
    creatingTopic = false;
    workspaceView = 'graph';
    notePath = '';
    conflict = null;
    mobileNavOpen = false;
    if (record) syncLocation();
  }

  async function openGraphDocument(path: string, record = true): Promise<void> {
    if (!storage) return;
    stopEditingNote();
    const match = /^Topics\/([^/]+)\//u.exec(path);
    if (match?.[1]) selectedSlug = match[1];
    creatingTopic = false;
    workspaceView = 'note';
    notePath = path;
    noteContent = (await storage.read(path))?.content ?? '';
    conflict = null;
    mobileNavOpen = false;
    if (record) syncLocation();
  }

  async function openSearchDocument(path: string): Promise<void> {
    await openGraphDocument(path);
    if (window.innerWidth < 960) inspectorOpen = false;
  }

  function handleRoadmapChanged(slug: string, content: string): void {
    if (slug === selectedSlug) noteContent = content;
    learningRevision += 1;
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
      stopEditingNote();
      status = 'Note saved locally and recorded in the update log.';
    });
  }

  async function createStudyNote(): Promise<void> {
    if (!storage || !selectedSlug || !newNoteTitle.trim()) return;
    await perform(async () => {
      const created = await createNote(storage!, selectedSlug, newNoteTitle);
      newNoteTitle = '';
      workspaceView = 'note';
      notePath = created.path;
      noteContent = created.content;
      noteDraft = created.content;
      editingNote = true;
      conflict = null;
      mobileNavOpen = false;
      syncLocation();
      status = 'Note created. Add the first useful idea, then save it.';
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
      if ('proposalPath' in result) conflict = result;
      // The proof is only convincing if its result is on screen: show the note the proposal
      // concerns, then bring the diff and its accept action into view.
      workspaceView = 'note';
      notePath = firstNotePath;
      noteContent = (await storage!.read(firstNotePath))?.content ?? externallyEdited;
      syncLocation();
      status = 'External content stayed in place. Dusori wrote a separate proposal and update log.';
      if (window.innerWidth < 960) inspectorOpen = false;
      await tick();
      conflictPanel?.scrollIntoView({ block: 'start' });
    });
  }

  /** Brings an existing proposal back on screen from the inspector. */
  async function showConflict(): Promise<void> {
    if (!conflict) return;
    workspaceView = 'note';
    syncLocation();
    if (window.innerWidth < 960) inspectorOpen = false;
    await tick();
    conflictPanel?.scrollIntoView({ block: 'start' });
  }

  async function acceptConflict(): Promise<void> {
    if (!storage || !selectedSlug || !conflict) return;
    await perform(async () => {
      const pending = conflict!;
      await acceptMarkdownUpdate(
        storage!,
        selectedSlug,
        noteRelativePath(pending.currentPath),
        pending.proposalContent,
        pending.currentContentHash,
      );
      noteContent = pending.proposalContent;
      conflict = null;
      status = 'You accepted the proposal. Dusori updated the note and logged that decision.';
    });
  }

  async function downloadWorkspace(): Promise<void> {
    if (!storage) return;
    await perform(async () => {
      const archive = await exportWorkspace(storage!);
      const bytes = new Uint8Array(archive.byteLength);
      bytes.set(archive);
      const blob = new Blob([bytes.buffer], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `dusori-workspace-${new Date().toISOString().slice(0, 10)}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      status = 'Workspace exported as a portable ZIP.';
    });
  }

  async function uploadWorkspace(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await perform(async () => {
      const adapter = storage ?? (await createOpfsStorage());
      const prepared = await prepareWorkspaceImport(await file.arrayBuffer());
      const { fileCount, topicCount, workspaceName } = prepared.preview;
      const replacing = Boolean(await adapter.read('dusori.json'));
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
      await replaceWorkspace(adapter, prepared);
      await activateStorage(adapter, 'Browser workspace · imported');
      status = 'Workspace validated and imported safely.';
    });
    input.value = '';
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    busy = true;
    error = '';
    status = '';
    try {
      await action();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not complete that action.';
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
      mobileNavOpen = false;
      if (window.innerWidth < 960) inspectorOpen = false;
    }
  }}
/>

<svelte:head>
  <title>Dusori — local-first learning</title>
  <meta name="description" content="A free local-first learning workspace that works without AI." />
</svelte:head>

{#if !workspace}
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
      <h1 id="setup-title">Make a learning space you can keep.</h1>
      <p>
        Start privately in this browser, or grant access to one folder. Dusori stores plain Markdown
        and JSON; it does not upload your notes.
      </p>
    </section>

    <section class="setup-options" aria-label="Workspace choices">
      <article>
        <HardDrive aria-hidden="true" size={24} strokeWidth={1.5} />
        <h2>Browser workspace</h2>
        <p>Works across modern browsers. Export regularly for a portable backup.</p>
        <button class="primary-button" disabled={busy} onclick={createBrowserWorkspace}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
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
      </article>
    </section>

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

    <label class="import-link" id="workspace-import">
      <Upload aria-hidden="true" size={17} />
      Import an exported workspace
      <input type="file" accept=".zip,application/zip" onchange={uploadWorkspace} />
    </label>

    {#if error}<p class="message error" role="alert">{error}</p>{/if}
    <p class="setup-footnote">
      No AI, telemetry, or background service runs. Web research starts only after provider consent.
    </p>
  </main>
{:else}
  <main
    class:inspector-closed={!inspectorOpen}
    class:mobile-nav-open={mobileNavOpen}
    class="workbench"
  >
    <nav class:open={mobileNavOpen} class="rail" id="workspace-navigation" aria-label="Workspace">
      <div class="rail-brand">
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
          class="rail-close"
          aria-label="Close workspace navigation"
          onclick={() => (mobileNavOpen = false)}
        >
          <X aria-hidden="true" size={20} />
        </button>
      </div>
      <div class="rail-section">
        <p>Workspace</p>
        <button
          class:active={workspaceView === 'today'}
          class="rail-link"
          disabled={!selectedSlug}
          title={selectedSlug ? undefined : unlockHint}
          onclick={() => openToday()}
        >
          <BookOpen aria-hidden="true" size={18} />
          Today
        </button>
        <button
          class:active={workspaceView === 'roadmap'}
          class="rail-link"
          disabled={!selectedSlug}
          title={selectedSlug ? undefined : unlockHint}
          onclick={() => openRoadmap()}
        >
          <ListChecks aria-hidden="true" size={18} />
          Roadmap
        </button>
        <button
          class:active={workspaceView === 'graph'}
          class="rail-link"
          disabled={!workspace.topics.length}
          title={workspace.topics.length ? undefined : unlockHint}
          onclick={() => openGraph()}
        >
          <Share2 aria-hidden="true" size={18} />
          Graph
        </button>
        {#if !selectedSlug}
          <p class="rail-hint">{unlockHint}</p>
        {/if}
      </div>
      <div class="rail-section topic-list">
        <p>Topics</p>
        {#each workspace.topics as topic (topic.slug)}
          <button
            class:active={topic.slug === selectedSlug}
            class="rail-link"
            title={topic.title}
            onclick={() => openTopic(topic.slug)}
          >
            <FileText aria-hidden="true" size={18} />
            <span class="rail-link-label">{topic.title}</span>
          </button>
        {/each}
        <button class:active={creatingTopic} class="rail-link new-topic" onclick={startNewTopic}>
          <Plus aria-hidden="true" size={18} />
          <span class="rail-link-label">New topic</span>
        </button>
      </div>
      <div class="rail-meta">
        <span>{storageLabel}</span>
        <span>{navigator.onLine ? 'Online · local data' : 'Offline · ready'}</span>
      </div>
    </nav>

    {#if mobileNavOpen}
      <button
        class="rail-backdrop"
        aria-label="Close workspace navigation"
        onclick={() => (mobileNavOpen = false)}
      ></button>
    {/if}

    <section class="canvas" id="note">
      <header class="canvas-bar">
        <button
          class="mobile-menu"
          aria-label="Open workspace navigation"
          aria-controls="workspace-navigation"
          aria-expanded={mobileNavOpen}
          onclick={() => (mobileNavOpen = true)}
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        <div>
          <p class="path-label">
            {workspaceView === 'today'
              ? 'Today · local activity'
              : workspaceView === 'graph'
                ? 'Graph · portable relationships'
                : notePath || 'Workspace ready'}
          </p>
          <p class="save-state">Plain Markdown · changes stay local</p>
        </div>
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

      {#if selectedSlug}
        {#if workspaceView === 'note'}
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
            <div class="note-sheet">
              <MarkdownView content={noteContent} />
            </div>
          {/if}
        {:else if workspaceView === 'graph' && storage}
          <KnowledgeGraph {storage} onOpen={(path) => void openGraphDocument(path)} />
        {:else if storage && workspace}
          <LearningLoop
            {storage}
            {workspace}
            topicSlug={selectedSlug}
            view={workspaceView === 'roadmap' ? 'roadmap' : 'today'}
            revision={learningRevision}
            onOpenRoadmap={(slug) => void openRoadmap(slug)}
            onRoadmapChanged={handleRoadmapChanged}
            onStatus={announceStatus}
          />
        {/if}
      {:else}
        <section class="empty-topic" aria-labelledby="new-topic-title">
          <p class="kicker">One useful beginning</p>
          <h1 id="new-topic-title">
            {workspace.topics.length ? 'Create another topic.' : 'Create your first topic.'}
          </h1>
          <p>
            Dusori will create the note, roadmap, preferences, state, sources, and update history.
          </p>
          <form
            onsubmit={(event) => {
              event.preventDefault();
              void addTopic();
            }}
          >
            <label for="topic-title">Topic name</label>
            <div class="input-row">
              <input
                id="topic-title"
                bind:value={topicTitle}
                required
                maxlength="160"
                aria-describedby="topic-help"
              />
              <button class="primary-button" disabled={busy || !topicTitle.trim()}>
                {busy ? 'Creating…' : 'Create topic'}
              </button>
            </div>
            <p id="topic-help">Use a name that will still make sense as a folder.</p>
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
          <div class="diff" aria-label="Proposed change diff">
            {#each diff as row, index (`${index}-${row.kind}`)}
              <div class:added={row.kind === 'add'} class:removed={row.kind === 'remove'}>
                <span aria-hidden="true"
                  >{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span
                >
                <code>{row.line || ' '}</code>
              </div>
            {/each}
          </div>
          <button class="primary-button accept-proposal" disabled={busy} onclick={acceptConflict}>
            Accept this proposal
          </button>
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
    <!-- Kept mounted while closed: unmounting would discard a pasted curriculum outline,
         a half-written source, and any research results the user already consented to fetch. -->
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
        <h2>{storage?.kind === 'fsa' ? 'Connected folder' : 'Browser workspace'}</h2>
        <p>{storageLabel}</p>
      </section>

      {#if storage}
        <WorkspaceSearch {storage} onOpen={(path) => void openSearchDocument(path)} />
        <WorkspaceHealth
          {storage}
          currentPath={notePath}
          onOpen={(path) => void openSearchDocument(path)}
        />
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

        <div class="research-slot">
          {#key `${selectedSlug}-${learningRevision}`}
            <ResearchPanel
              {storage}
              topicSlug={selectedSlug}
              topicTitle={workspace.topics.find((topic) => topic.slug === selectedSlug)?.title ??
                selectedSlug}
              onSourceSaved={refreshSources}
              companion={companionClient}
            />
          {/key}
        </div>

        <div class="source-slot">
          {#key `${selectedSlug}-${sourceRevision}`}
            <SourceLibrary {storage} topicSlug={selectedSlug} companion={companionClient} />
          {/key}
        </div>

        <div class="curriculum-slot">
          {#key selectedSlug}
            <CurriculumImporter
              {storage}
              topicSlug={selectedSlug}
              onRoadmapApplied={showImportedRoadmap}
              onSourceSaved={refreshSources}
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
        <label class="inspector-action file-action">
          <Upload aria-hidden="true" size={18} />
          Import workspace
          <input type="file" accept=".zip,application/zip" onchange={uploadWorkspace} />
        </label>
      </section>

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
  .setup-shell {
    width: min(100%, 82rem);
    min-height: 100dvh;
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

  .setup-intro {
    display: grid;
    align-content: end;
    min-height: min(58dvh, 38rem);
    padding-block: var(--space-3xl) var(--space-xl);
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

  .kicker,
  .path-label,
  .rail-section > p {
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
  .rail-link {
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

  .rail,
  .inspector {
    display: none;
  }

  .rail.open {
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

  .rail-backdrop {
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
  .research-slot,
  .source-slot,
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

  .rail-brand {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-family: var(--font-display);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .rail-close {
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

  .rail-section {
    display: grid;
    gap: var(--space-xs);
    margin-block-start: var(--space-xl);
    /* An auto track would grow to the longest topic name and push the rail over the canvas. */
    grid-template-columns: minmax(0, 1fr);
  }

  .rail-link {
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

  .rail-link.active {
    border-color: var(--color-rule);
    background: var(--color-paper);
  }

  /* A topic name can run to 160 characters; truncate in place instead of spilling over the
   * canvas. The full name stays in the button's title and in the graph artifact index. */
  .rail-link-label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rail-link.new-topic {
    color: var(--color-accent-text);
    font-weight: 700;
  }

  .rail-hint {
    color: var(--color-muted);
    font-size: var(--text-xs);
    line-height: 1.45;
  }

  .rail-meta {
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

  .accept-proposal {
    margin-block-start: var(--space-lg);
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
  }

  @media (hover: hover) and (pointer: fine) {
    .primary-button:hover,
    .secondary-button:hover,
    .inspector-action:hover,
    .icon-button:hover,
    .mobile-menu:hover,
    .rail-link:hover {
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

  @media (min-width: 60rem) {
    .workbench {
      grid-template-columns: 15rem minmax(0, 1fr) 20rem;
    }

    .workbench.inspector-closed {
      grid-template-columns: 15rem minmax(0, 1fr);
    }

    .rail,
    .inspector {
      position: sticky;
      top: 0;
      display: flex;
      height: 100dvh;
      flex-direction: column;
      background: var(--color-paper-2);
    }

    /* Closed means hidden, not unmounted, so inspector drafts survive. */
    .inspector:not(.open) {
      display: none;
    }

    .rail {
      width: auto;
      inset: auto;
      padding: var(--space-lg) var(--space-md);
      border-inline-end: var(--rule-hair) solid var(--color-rule);
      box-shadow: none;
    }

    .mobile-menu {
      display: none;
    }

    .rail-close,
    .rail-backdrop,
    .inspector-backdrop,
    .inspector-close {
      display: none;
    }

    .inspector {
      width: auto;
      inset: auto;
      gap: var(--space-xl);
      padding: var(--space-xl) var(--space-lg);
      border-inline-start: var(--rule-hair) solid var(--color-rule);
      overflow-y: auto;
      box-shadow: none;
    }

    .mobile-status {
      inset-inline-end: calc(20rem + var(--space-md));
    }
  }
</style>
