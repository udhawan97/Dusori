<script lang="ts">
  import {
    AlertCircle,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    FileText,
    LoaderCircle,
    Minus,
    Orbit,
    Plus,
    RotateCcw,
    Search,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    buildWorkspaceGraph,
    evidenceClaims,
    readResearchFile,
    readSourceManifest,
    type StorageAdapter,
    type WorkspaceGraph,
    type WorkspaceGraphNode,
  } from '@dusori/core';

  import { buildGraphAtlas, type GraphAtlas, type GraphAtlasTopic } from '$lib/graph-atlas';
  import type { GraphMode } from '$lib/workspace-navigation';

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;
  export let onOpenEvent: (topicSlug: string, eventId: string) => void = () => undefined;
  export let mode: GraphMode = 'outline';
  export let onModeChange: (mode: GraphMode) => void = () => undefined;

  interface TopicEvidence {
    claims: number;
    discovered: number;
    freshness: string;
    label: string;
    read: number;
    saved: number;
    slug: string;
  }

  let graph: WorkspaceGraph | null = null;
  let atlas: GraphAtlas | null = null;
  let loading = true;
  let error = '';
  let artifactQuery = '';
  let artifactKind: 'all' | 'annotation' | 'event' | 'note' | 'source' | 'update' = 'all';
  let artifactTag = '';
  let topicEvidence: TopicEvidence[] = [];
  let selectedTopicSlug = '';
  let mapScale = 0.92;
  let mapTilt = 34;
  let mapRotation = -8;
  let mapPanX = 0;
  let mapPanY = 0;
  let draggingMap = false;
  let dragX = 0;
  let dragY = 0;

  function evidenceFor(slug: string): TopicEvidence | undefined {
    return topicEvidence.find((topic) => topic.slug === slug);
  }

  function kindLabel(node: WorkspaceGraphNode): string {
    const labels: Record<string, string> = {
      document: 'Document',
      event: 'Research event',
      home: 'Workspace',
      annotation: 'Annotation',
      note: 'Note',
      overview: 'Overview',
      roadmap: 'Roadmap',
      source: 'Source',
      tutor: 'Preferences',
      update: 'Update',
    };
    return labels[node.kind] ?? node.kind;
  }

  function openNode(node: WorkspaceGraphNode): void {
    if (node.kind === 'event' && node.topicSlug && node.eventId) {
      onOpenEvent(node.topicSlug, node.eventId);
      return;
    }
    onOpen(node.path);
  }

  onMount(async () => {
    try {
      graph = await buildWorkspaceGraph(storage);
      atlas = buildGraphAtlas(graph);
      selectedTopicSlug = atlas.topics[0]?.slug ?? '';
      topicEvidence = await Promise.all(
        atlas.topics.map(async (topic): Promise<TopicEvidence> => {
          try {
            const [manifest, research] = await Promise.all([
              readSourceManifest(storage, topic.slug),
              readResearchFile(storage, topic.slug),
            ]);
            const latest = research?.runs?.at(-1);
            return {
              claims: manifest.sources.reduce(
                (total, source) => total + evidenceClaims(source).length,
                0,
              ),
              discovered: research?.seen?.length ?? 0,
              freshness: latest?.at
                ? `Last researched ${latest.at.slice(0, 10)}`
                : 'Not researched yet',
              label: topic.label,
              read: manifest.sources.filter((source) => evidenceClaims(source).length > 0).length,
              saved: manifest.sources.length,
              slug: topic.slug,
            };
          } catch {
            return {
              claims: 0,
              discovered: 0,
              freshness: 'Research state unavailable',
              label: topic.label,
              read: 0,
              saved: 0,
              slug: topic.slug,
            };
          }
        }),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The research map could not be built.';
    } finally {
      loading = false;
    }
  });

  $: workspaceTags = [
    ...new Map(
      (graph?.nodes ?? [])
        .flatMap((node) => node.tags ?? [])
        .map((tag) => [tag.toLocaleLowerCase(), tag] as const),
    ).values(),
  ].sort((left, right) => left.localeCompare(right));
  $: artifactNodes = (graph?.nodes ?? []).filter((node) => {
    const matchesKind = artifactKind === 'all' || node.kind === artifactKind;
    const matchesTag =
      !artifactTag || (node.tags ?? []).some((tag) => tag.toLocaleLowerCase() === artifactTag);
    const query = artifactQuery.trim().toLocaleLowerCase();
    const haystack = `${node.label} ${node.path} ${(node.tags ?? []).join(' ')}`;
    return matchesKind && matchesTag && (!query || haystack.toLocaleLowerCase().includes(query));
  });
  $: noteCount =
    graph?.nodes.filter((node) => node.kind === 'note' || node.kind === 'annotation').length ?? 0;
  $: sourceCount = graph?.nodes.filter((node) => node.kind === 'source').length ?? 0;
  $: selectedTopic =
    atlas?.topics.find((topic) => topic.slug === selectedTopicSlug) ?? atlas?.topics[0] ?? null;

  function artifactCount(topic: GraphAtlasTopic): number {
    return topic.lanes.reduce((total, lane) => total + lane.nodes.length, 0);
  }

  function evidenceDepth(topic: GraphAtlasTopic): number {
    const evidence = evidenceFor(topic.slug);
    return Math.min(
      3.25,
      0.25 +
        (evidence?.saved ?? 0) * 0.16 +
        (evidence?.read ?? 0) * 0.2 +
        (evidence?.claims ?? 0) * 0.025,
    );
  }

  function selectTopic(slug: string): void {
    selectedTopicSlug = slug;
  }

  function changeZoom(delta: number): void {
    mapScale = Math.min(1.2, Math.max(0.72, Number((mapScale + delta).toFixed(2))));
  }

  function rotateMap(delta: number): void {
    mapRotation = Math.max(-28, Math.min(28, mapRotation + delta));
  }

  function resetMap(): void {
    mapScale = 0.92;
    mapTilt = 34;
    mapRotation = -8;
    mapPanX = 0;
    mapPanY = 0;
  }

  function panMap(deltaX: number, deltaY: number): void {
    mapPanX = Math.max(-4800, Math.min(4800, mapPanX + deltaX));
    mapPanY = Math.max(-4800, Math.min(4800, mapPanY + deltaY));
  }

  function startMapDrag(event: PointerEvent): void {
    if ((event.target as Element | null)?.closest('button')) return;
    draggingMap = true;
    dragX = event.clientX;
    dragY = event.clientY;
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function moveMap(event: PointerEvent): void {
    if (!draggingMap) return;
    const deltaX = event.clientX - dragX;
    const deltaY = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    if (event.shiftKey) {
      mapRotation = Math.max(-28, Math.min(28, mapRotation + deltaX * 0.12));
      mapTilt = Math.max(22, Math.min(58, mapTilt - deltaY * 0.12));
    } else {
      panMap(deltaX, deltaY);
    }
  }

  function stopMapDrag(event: PointerEvent): void {
    draggingMap = false;
    if (
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }
</script>

<section class="knowledge-graph" aria-labelledby="graph-title">
  <header>
    <div>
      <p class="kicker">Research trail · built from local artifacts</p>
      <h1 id="graph-title">Research map</h1>
      {#if graph}
        <p>
          {graph.nodes.length} research artifacts · {graph.edges.length} connections · no inferred mastery
        </p>
      {:else}
        <p>Your topics, sources, quotes, and notes, arranged locally.</p>
      {/if}
    </div>
    <Orbit aria-hidden="true" size={36} strokeWidth={1.25} />
  </header>

  <div class="mode-switch" role="group" aria-label="Map view">
    <button aria-pressed={mode === 'outline'} onclick={() => onModeChange('outline')}
      >Outline</button
    >
    <button aria-pressed={mode === 'visual'} onclick={() => onModeChange('visual')}
      >Depth map</button
    >
  </div>

  {#if loading}
    <div class="graph-state" aria-live="polite">
      <span class="spinner"><LoaderCircle aria-hidden="true" size={24} /></span>
      Mapping local files…
    </div>
  {:else if error}
    <div class="graph-state error" role="alert">
      <AlertCircle aria-hidden="true" size={24} />
      {error}
    </div>
  {:else if graph && graph.nodes.length === 0}
    <div class="graph-state">Create a topic to place its artifacts on the map.</div>
  {:else if graph && atlas}
    <dl class="graph-ledger">
      <div>
        <dt>Notes</dt>
        <dd>{noteCount}</dd>
      </div>
      <div>
        <dt>Sources</dt>
        <dd>{sourceCount}</dd>
      </div>
      <div>
        <dt>Explained edges</dt>
        <dd>{graph.edges.length}</dd>
      </div>
      <div>
        <dt>Unresolved</dt>
        <dd>{graph.unresolvedLinks.length}</dd>
      </div>
    </dl>

    {#if mode === 'visual'}
      <section class="atlas" aria-label="Interactive research depth map">
        <div class="atlas-intro">
          <div>
            <p class="kicker">Evidence landscape</p>
            <h2>See where your research has depth.</h2>
          </div>
          <div class="map-controls" role="group" aria-label="Depth map controls">
            <button type="button" aria-label="Zoom out" onclick={() => changeZoom(-0.08)}>
              <Minus aria-hidden="true" size={16} />
            </button>
            <span aria-live="polite">{Math.round(mapScale * 100)}%</span>
            <button type="button" aria-label="Zoom in" onclick={() => changeZoom(0.08)}>
              <Plus aria-hidden="true" size={16} />
            </button>
            <button type="button" onclick={() => rotateMap(-8)}>Turn left</button>
            <button type="button" onclick={() => rotateMap(8)}>Turn right</button>
            <button type="button" aria-label="Move map left" onclick={() => panMap(-120, 0)}>
              <ArrowLeft aria-hidden="true" size={16} />
            </button>
            <button type="button" aria-label="Move map right" onclick={() => panMap(120, 0)}>
              <ArrowRight aria-hidden="true" size={16} />
            </button>
            <button type="button" aria-label="Move map up" onclick={() => panMap(0, -160)}>
              <ArrowUp aria-hidden="true" size={16} />
            </button>
            <button type="button" aria-label="Move map down" onclick={() => panMap(0, 160)}>
              <ArrowDown aria-hidden="true" size={16} />
            </button>
            <button type="button" aria-label="Reset depth map" onclick={resetMap}>
              <RotateCcw aria-hidden="true" size={16} /> Reset
            </button>
          </div>
        </div>

        <p class="map-instruction" id="depth-map-instructions">
          Drag empty space to pan; Shift-drag tilts and turns. Taller topic islands contain more
          saved, read, and quoted evidence. Select or focus any topic to inspect its actual files.
        </p>

        <label class="topic-focus">
          Focus topic
          <select bind:value={selectedTopicSlug}>
            {#each atlas.topics as topic (topic.slug)}
              <option value={topic.slug}>{topic.label}</option>
            {/each}
          </select>
        </label>

        <div class="depth-layout">
          <div
            class="map-frame"
            class:dragging={draggingMap}
            aria-label="Rotatable topic landscape"
            aria-describedby="depth-map-instructions"
            role="group"
            onpointerdown={startMapDrag}
            onpointermove={moveMap}
            onpointerup={stopMapDrag}
            onpointercancel={stopMapDrag}
          >
            <div
              class="map-plane"
              style={`--map-scale: ${mapScale}; --map-tilt: ${mapTilt}deg; --map-rotation: ${mapRotation}deg; --map-pan-x: ${mapPanX}px; --map-pan-y: ${mapPanY}px;`}
            >
              {#each atlas.topics as topic, index (topic.slug)}
                {@const evidence = evidenceFor(topic.slug)}
                <button
                  type="button"
                  class="topic-island"
                  aria-pressed={selectedTopic?.slug === topic.slug}
                  aria-label={`${topic.label}, ${artifactCount(topic)} artifacts, ${evidence?.claims ?? 0} quoted passages`}
                  style={`--depth: ${evidenceDepth(topic)}rem; --side-depth: ${Math.max(0.5, evidenceDepth(topic) * 0.55)}rem; --topic-index: ${index};`}
                  onclick={() => selectTopic(topic.slug)}
                >
                  <span class="island-index">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{topic.label}</strong>
                  <small>{artifactCount(topic)} artifacts · {evidence?.claims ?? 0} quotes</small>
                </button>
              {/each}
            </div>
          </div>

          {#if selectedTopic}
            {@const selectedEvidence = evidenceFor(selectedTopic.slug)}
            <aside class="topic-inspector" aria-labelledby={`atlas-${selectedTopic.slug}`}>
              <div class="inspector-heading">
                <div>
                  <p class="room-number">Selected topic</p>
                  <h3 id={`atlas-${selectedTopic.slug}`}>{selectedTopic.label}</h3>
                </div>
                <small>{selectedEvidence?.freshness ?? 'Not researched yet'}</small>
              </div>

              <dl class="evidence-spine" aria-label={`${selectedTopic.label} research progress`}>
                <div>
                  <dt>Found</dt>
                  <dd>{selectedEvidence?.discovered ?? 0}</dd>
                </div>
                <div>
                  <dt>Saved</dt>
                  <dd>{selectedEvidence?.saved ?? 0}</dd>
                </div>
                <div>
                  <dt>Read</dt>
                  <dd>{selectedEvidence?.read ?? 0}</dd>
                </div>
                <div>
                  <dt>Quoted</dt>
                  <dd>{selectedEvidence?.claims ?? 0}</dd>
                </div>
              </dl>

              <div class="inspector-lanes">
                {#each selectedTopic.lanes as lane (lane.id)}
                  <section aria-labelledby={`${selectedTopic.slug}-${lane.id}`}>
                    <div class="lane-heading">
                      <h4 id={`${selectedTopic.slug}-${lane.id}`}>{lane.label}</h4>
                      <span>{lane.nodes.length}</span>
                    </div>
                    {#if lane.nodes.length}
                      <ul>
                        {#each lane.nodes as node (node.id)}
                          <li>
                            <button type="button" onclick={() => openNode(node)}>
                              <span>{node.label}</span>
                              <small>{kindLabel(node)}</small>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <p class="empty-lane">Nothing here yet</p>
                    {/if}
                  </section>
                {/each}
              </div>

              {#if selectedTopic.edges.length}
                <details class="edge-inspector">
                  <summary>Why these {selectedTopic.edges.length} edges exist</summary>
                  <ul>
                    {#each selectedTopic.edges as edge (edge.id)}
                      <li>
                        <p>{edge.explanation}</p>
                        <div>
                          <button type="button" onclick={() => openNode(edge.source)}>
                            {edge.source.label}
                          </button>
                          <span aria-hidden="true">→</span>
                          <button type="button" onclick={() => openNode(edge.target)}>
                            {edge.target.label}
                          </button>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}

              {#if selectedTopic.connections.length}
                <div class="connections">
                  <strong>Connected topics</strong>
                  <div>
                    {#each selectedTopic.connections as connection (connection.slug)}
                      <button type="button" onclick={() => selectTopic(connection.slug)}>
                        {connection.label} · {connection.count}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
            </aside>
          {/if}
        </div>

        {#if atlas.workspace.length}
          <section class="workspace-shelf" aria-labelledby="workspace-shelf-title">
            <div>
              <p class="kicker">Shared shelf</p>
              <h3 id="workspace-shelf-title">Workspace documents</h3>
            </div>
            <ul>
              {#each atlas.workspace as node (node.id)}
                <li>
                  <button type="button" onclick={() => openNode(node)}>
                    <FileText aria-hidden="true" size={16} strokeWidth={1.5} />
                    <span>{node.label}</span>
                    <small>{kindLabel(node)}</small>
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </section>
    {:else}
      <aside class="artifact-index" aria-label="Map outline">
        <div class="artifact-heading">
          <div>
            <p class="kicker">Artifact finder</p>
            <h2>Every local document</h2>
          </div>
          <span>{artifactNodes.length}</span>
        </div>
        <label class="artifact-search">
          <span class="sr-only">Search graph artifacts</span>
          <Search aria-hidden="true" size={15} />
          <input bind:value={artifactQuery} type="search" placeholder="Find an artifact" />
        </label>
        <div class="artifact-filters" role="group" aria-label="Filter graph artifacts">
          {#each ['all', 'annotation', 'event', 'note', 'source', 'update'] as kind (kind)}
            <button
              type="button"
              aria-pressed={artifactKind === kind}
              onclick={() =>
                (artifactKind = kind as
                  'all' | 'annotation' | 'event' | 'note' | 'source' | 'update')}
            >
              {kind === 'all' ? 'All' : `${kind[0]?.toLocaleUpperCase()}${kind.slice(1)}s`}
            </button>
          {/each}
        </div>
        {#if workspaceTags.length}
          <div class="artifact-filters tag-filters" role="group" aria-label="Filter graph by tag">
            {#each workspaceTags as tag (tag)}
              <button
                type="button"
                aria-pressed={artifactTag === tag.toLocaleLowerCase()}
                onclick={() =>
                  (artifactTag =
                    artifactTag === tag.toLocaleLowerCase() ? '' : tag.toLocaleLowerCase())}
              >
                #{tag}
              </button>
            {/each}
          </div>
        {/if}
        <ul aria-label="Map documents">
          {#each artifactNodes as node (node.id)}
            <li>
              <button type="button" onclick={() => openNode(node)}>
                <FileText aria-hidden="true" size={16} strokeWidth={1.5} />
                <span title={node.label}>{node.label}</span>
                <small>{kindLabel(node)}</small>
              </button>
            </li>
          {/each}
        </ul>
        {#if artifactNodes.length === 0}
          <p class="unresolved">No artifacts match this filter.</p>
        {/if}
      </aside>
    {/if}

    {#if graph.unresolvedLinks.length}
      <p class="unresolved footer-note">
        {graph.unresolvedLinks.length} unresolved wikilink{graph.unresolvedLinks.length === 1
          ? ''
          : 's'} remain visible in Workspace health.
      </p>
    {/if}
  {/if}
</section>

<style>
  /* Hallmark · macrostructure: evidence depth landscape · genre: quiet editorial index · theme: design.md
   * signature: a rotatable evidence landscape with real artifact lanes and inspector
   * states: outline · depth-map · selected · dragging · loading · error · empty
   * pre-emit critique: P5 H5 E4 S5 R5 V5 · contrast: pass (40–41) · responsive: pass (49)
   */
  .knowledge-graph {
    min-height: calc(100dvh - 4.5rem);
    padding: var(--space-xl) var(--page-gutter) var(--space-3xl);
    background: var(--color-paper);
  }

  header,
  .mode-switch,
  .graph-ledger,
  .atlas,
  .artifact-index,
  .footer-note,
  .graph-state {
    width: min(100%, 76rem);
    margin-inline: auto;
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-lg);
    padding-block-end: var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  h1,
  h2,
  h3,
  h4,
  p {
    margin: 0;
  }

  h1 {
    margin-block-start: var(--space-xs);
    font-size: clamp(2.2rem, 5vw, 4.6rem);
  }

  header p:last-child,
  .footer-note {
    color: var(--color-muted);
  }

  header > :global(svg) {
    flex: none;
    color: var(--color-marigold);
  }

  .kicker,
  .room-number {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .mode-switch {
    display: flex;
    gap: 0;
    margin-block-start: var(--space-md);
  }

  .mode-switch button,
  .artifact-filters button {
    min-height: 2.35rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
    background: transparent;
    color: var(--color-muted);
    font: inherit;
  }

  .mode-switch button + button,
  .artifact-filters button + button {
    margin-inline-start: calc(-1 * var(--rule-hair));
  }

  .mode-switch button[aria-pressed='true'],
  .artifact-filters button[aria-pressed='true'] {
    position: relative;
    border-color: var(--color-accent-text);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .graph-ledger {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-block-start: var(--space-xl);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .graph-ledger div {
    padding: var(--space-sm) var(--space-md);
  }

  .graph-ledger div + div {
    border-inline-start: var(--rule-hair) solid var(--color-rule);
  }

  .graph-ledger dt,
  .evidence-spine dt {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .graph-ledger dd,
  .evidence-spine dd {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-lg);
  }

  .atlas,
  .artifact-index {
    margin-block-start: var(--space-2xl);
  }

  .atlas-intro {
    display: grid;
    grid-template-columns: minmax(14rem, 0.55fr) minmax(18rem, 1fr);
    gap: var(--space-xs) var(--space-xl);
    align-items: end;
    padding-block-end: var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  .atlas-intro .kicker {
    grid-column: 1 / -1;
  }

  .atlas-intro h2 {
    font-size: clamp(1.7rem, 3vw, 2.65rem);
  }

  .evidence-spine {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: var(--space-lg) 0 0;
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .evidence-spine div {
    position: relative;
    padding: var(--space-sm) var(--space-md);
  }

  .evidence-spine div::before {
    position: absolute;
    inset-block-start: calc(-1 * var(--rule-hair));
    inset-inline: 0;
    height: 0.2rem;
    background: var(--color-marigold);
    content: '';
  }

  .evidence-spine div + div {
    border-inline-start: var(--rule-hair) solid var(--color-rule);
  }

  .lane-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-xs);
    padding-block-end: var(--space-xs);
  }

  .lane-heading h4 {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
  }

  .lane-heading span,
  .artifact-heading > span {
    color: var(--color-accent-text);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .workspace-shelf ul,
  .artifact-index ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .workspace-shelf li,
  .artifact-index li {
    min-width: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .workspace-shelf button,
  .artifact-index li button {
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    text-align: start;
  }

  .workspace-shelf button span,
  .artifact-index button span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .workspace-shelf button small,
  .artifact-index button small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .workspace-shelf button:hover span,
  .artifact-index li button:hover span {
    color: var(--color-accent-text);
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }

  .empty-lane {
    padding-block: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-style: italic;
  }

  .connections {
    margin-block-start: var(--space-lg);
    padding-block-start: var(--space-sm);
    border-block-start: var(--rule-hair) solid var(--color-rule);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .connections strong {
    margin-inline-end: var(--space-xs);
    color: var(--color-ink);
  }

  .workspace-shelf {
    display: grid;
    grid-template-columns: minmax(12rem, 0.4fr) minmax(18rem, 1fr);
    gap: var(--space-xl);
    margin-block-start: var(--space-2xl);
    padding-block: var(--space-lg);
    border-block: var(--rule-hair) solid var(--color-rule);
  }

  .workspace-shelf ul {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-shelf button,
  .artifact-index li button {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-sm);
    align-items: center;
    padding: var(--space-sm);
  }

  .artifact-index {
    padding: var(--space-xl);
    border: var(--rule-hair) solid var(--color-border);
  }

  .artifact-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .artifact-heading h2 {
    margin-block-start: var(--space-xs);
    font-size: var(--text-xl);
  }

  .artifact-search {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-lg);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
  }

  .artifact-search input {
    width: 100%;
    min-height: 2.75rem;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--color-ink);
    font: inherit;
  }

  .artifact-filters {
    display: flex;
    flex-wrap: wrap;
    margin-block-start: var(--space-sm);
  }

  .tag-filters button {
    min-height: 2rem;
    font-size: var(--text-xs);
  }

  .artifact-index > ul {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 var(--space-lg);
    margin-block-start: var(--space-lg);
  }

  .unresolved {
    margin-block-start: var(--space-md);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .graph-state {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    min-height: 14rem;
    color: var(--color-muted);
  }

  .graph-state.error {
    color: var(--color-accent-text);
  }

  .atlas-intro {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-md) var(--space-xl);
  }

  .atlas-intro .kicker {
    grid-column: auto;
  }

  .atlas-intro h2 {
    margin-block-start: var(--space-xs);
  }

  .map-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2xs);
  }

  .map-controls button,
  .connections button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2xs);
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  .map-controls > span {
    min-width: 3rem;
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
  }

  .map-instruction {
    max-width: 72ch;
    margin-block-start: var(--space-md);
    color: var(--color-muted);
    font-size: var(--text-sm);
  }

  .topic-focus {
    width: min(100%, 28rem);
    display: grid;
    gap: var(--space-2xs);
    margin-block-start: var(--space-md);
    color: var(--color-muted);
    font-size: var(--text-xs);
    font-weight: 700;
  }

  .topic-focus select {
    width: 100%;
    min-height: 2.75rem;
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-radius: var(--radius-sm);
    outline: 2px solid transparent;
    outline-offset: 1px;
    background: var(--color-paper);
    color: var(--color-ink);
  }

  .topic-focus select:focus-visible {
    outline-color: var(--color-focus);
  }

  .topic-focus select:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .depth-layout {
    display: grid;
    gap: var(--space-xl);
    margin-block-start: var(--space-lg);
  }

  .map-frame {
    position: relative;
    min-width: 0;
    min-height: clamp(24rem, 62dvh, 40rem);
    overflow: hidden;
    border: var(--rule-hair) solid var(--color-border);
    background: var(--color-paper-2);
    color: var(--color-ink);
    cursor: grab;
    perspective: 72rem;
    touch-action: none;
  }

  .map-frame.dragging {
    cursor: grabbing;
  }

  .map-plane {
    position: absolute;
    inset: 50% auto auto 50%;
    width: min(44rem, calc(100% - 2rem));
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 14rem));
    justify-content: center;
    gap: var(--space-2xl);
    padding: var(--space-xl);
    transform: translate(calc(-50% + var(--map-pan-x)), calc(-50% + var(--map-pan-y)))
      rotateX(var(--map-tilt)) rotateZ(var(--map-rotation)) scale(var(--map-scale));
    transform-origin: center;
    transform-style: preserve-3d;
    transition: transform 180ms var(--ease-out);
  }

  .map-frame.dragging .map-plane {
    transition: none;
  }

  .topic-island {
    position: relative;
    min-width: 0;
    min-height: 9rem;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-border);
    border-block-start: 0.22rem solid var(--color-marigold);
    background: var(--color-paper-raised, var(--color-paper));
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    text-align: start;
    box-shadow: 0 var(--side-depth) 0 var(--color-rule);
    transform: translateZ(var(--depth));
    transform-style: preserve-3d;
  }

  .topic-island::after {
    position: absolute;
    inset: 100% 0 auto;
    block-size: var(--side-depth);
    border: var(--rule-hair) solid var(--color-border);
    border-block-start: 0;
    background: var(--color-rule);
    color: var(--color-ink);
    content: '';
    transform: rotateX(-90deg);
    transform-origin: top;
  }

  .topic-island[aria-pressed='true'] {
    border-color: var(--color-accent-text);
    background: var(--color-ink);
    color: var(--color-paper);
  }

  .topic-island > span,
  .topic-island > strong,
  .topic-island > small {
    position: relative;
    z-index: 1;
    display: block;
  }

  .island-index {
    color: var(--color-marigold);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .topic-island strong {
    margin-block-start: var(--space-xs);
    overflow-wrap: anywhere;
  }

  .topic-island small {
    margin-block-start: var(--space-sm);
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.66rem;
  }

  .topic-island[aria-pressed='true'] small {
    color: var(--color-paper-2);
  }

  .topic-inspector {
    min-width: 0;
    padding: var(--space-md);
    border: var(--rule-hair) solid var(--color-border);
  }

  .inspector-heading {
    display: grid;
    gap: var(--space-xs);
  }

  .inspector-heading h3 {
    margin-block-start: var(--space-2xs);
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }

  .inspector-heading small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .inspector-lanes {
    display: grid;
    gap: var(--space-md);
    margin-block-start: var(--space-lg);
  }

  .inspector-lanes section {
    min-width: 0;
  }

  .inspector-lanes ul {
    display: grid;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .inspector-lanes li {
    min-width: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .inspector-lanes li button {
    width: 100%;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-sm);
    align-items: center;
    min-height: 2.75rem;
    padding: var(--space-xs) 0;
    border: 0;
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: inherit;
    text-align: start;
  }

  .inspector-lanes li button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inspector-lanes li button small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    text-transform: uppercase;
  }

  .connections {
    margin-block-start: var(--space-lg);
  }

  .edge-inspector {
    margin-block-start: var(--space-lg);
    padding-block-start: var(--space-md);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .edge-inspector summary {
    cursor: pointer;
    font-weight: 700;
  }

  .edge-inspector ul {
    display: grid;
    gap: var(--space-sm);
    max-height: 22rem;
    margin: var(--space-sm) 0 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }

  .edge-inspector li {
    padding: var(--space-sm);
    background: var(--color-paper-2);
  }

  .edge-inspector p {
    color: var(--color-muted);
    font-size: var(--text-xs);
  }

  .edge-inspector li > div {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
  }

  .edge-inspector button {
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: var(--color-accent-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connections > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-block-start: var(--space-xs);
  }

  .spinner :global(svg) {
    animation: spin 1s linear infinite;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (min-width: 64rem) {
    .depth-layout {
      grid-template-columns: minmax(0, 1.45fr) minmax(18rem, 0.7fr);
      align-items: start;
    }

    .topic-inspector {
      max-height: 40rem;
      overflow: auto;
    }
  }

  @media (max-width: 40rem) {
    .knowledge-graph {
      padding-block-start: var(--space-md);
    }

    header > :global(svg) {
      display: none;
    }

    .graph-ledger,
    .evidence-spine {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .graph-ledger div:nth-child(3),
    .evidence-spine div:nth-child(3) {
      border-inline-start: 0;
    }

    .graph-ledger div:nth-child(n + 3),
    .evidence-spine div:nth-child(n + 3) {
      border-block-start: var(--rule-hair) solid var(--color-rule);
    }

    .atlas-intro,
    .workspace-shelf {
      grid-template-columns: 1fr;
      gap: var(--space-md);
    }

    .artifact-index {
      padding: var(--space-md);
    }

    .workspace-shelf ul,
    .artifact-index > ul {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .map-plane {
      transition-duration: 0.01ms;
    }

    .spinner :global(svg) {
      animation: none;
    }
  }
</style>
