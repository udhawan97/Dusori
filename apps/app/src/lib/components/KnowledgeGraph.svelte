<script lang="ts">
  import {
    AlertCircle,
    FileText,
    LoaderCircle,
    Orbit,
    SlidersHorizontal,
    ZoomIn,
    ZoomOut,
  } from '@lucide/svelte';
  import { onDestroy, onMount } from 'svelte';

  import {
    buildWorkspaceGraph,
    type StorageAdapter,
    type WorkspaceGraph,
    type WorkspaceGraphNode,
  } from '@dusori/core';

  import {
    LABEL_MAX_CHARS,
    fitGraphLabel,
    layoutWorkspaceGraph,
    neighborIds,
    wikilinkDegrees,
    type PositionedWorkspaceGraphNode,
  } from '$lib/graph-layout';
  import {
    GRAPH_VIEW_LIMITS,
    cameraLimits,
    cameraViewBox,
    clampCamera,
    createGraphRelaxation,
    fitCamera,
    graphBounds,
    nodeVisualRadius,
    panCamera,
    readGraphViewSettings,
    screenToWorld,
    sliderToZoom,
    writeGraphViewSettings,
    zoomCameraAt,
    zoomToSlider,
    type GraphCamera,
    type GraphRelaxation,
    type GraphViewSettings,
  } from '$lib/graph-sim';

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;

  let graph: WorkspaceGraph | null = null;
  let loading = true;
  let error = '';
  let selectedId: string | null = null;
  let hoveredId: string | null = null;
  let stageWidth = 0;
  let stageHeight = 0;
  let controlsOpen = false;
  let settings: GraphViewSettings = {
    linkDistance: GRAPH_VIEW_LIMITS.linkDistance.fallback,
    repelStrength: GRAPH_VIEW_LIMITS.repelStrength.fallback,
  };
  let simulation: GraphRelaxation | null = null;
  let positioned: PositionedWorkspaceGraphNode[] = [];
  let camera: GraphCamera | null = null;
  let settleFrame = 0;
  let pan: {
    lastX: number;
    lastY: number;
    moved: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null = null;
  let suppressBackgroundClick = false;

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function nodeRadius(node: WorkspaceGraphNode): number {
    return nodeVisualRadius(node, degrees.get(node.id) ?? 0);
  }

  function nodeRingRadius(node: WorkspaceGraphNode): number {
    return nodeRadius(node) + (node.kind === 'home' ? 12 : 9);
  }

  function edgePath(
    source: PositionedWorkspaceGraphNode,
    target: PositionedWorkspaceGraphNode,
  ): string {
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2 - 18;
    return `M ${source.x} ${source.y} Q ${middleX} ${middleY} ${target.x} ${target.y}`;
  }

  function visualLabel(node: WorkspaceGraphNode): string {
    const label =
      node.kind === 'home'
        ? 'Workspace'
        : node.kind === 'roadmap'
          ? 'Roadmap'
          : node.kind === 'tutor'
            ? 'Preferences'
            : node.kind === 'update'
              ? node.label.replace(/ update$/u, '')
              : node.label;
    // A hub node appends "· hub", so it gets a smaller budget. The full label stays in the
    // node title and in the artifact index beside the constellation.
    return fitGraphLabel(label, isHub(node) ? LABEL_MAX_CHARS - 5 : LABEL_MAX_CHARS);
  }

  function wikilinkLabel(count: number): string {
    return `${count} wikilink${count === 1 ? '' : 's'}`;
  }

  function isHub(node: WorkspaceGraphNode): boolean {
    return (degrees.get(node.id) ?? 0) >= 3;
  }

  /**
   * Labelling every dot tangles the constellation at fit zoom. Structural nodes stay
   * labelled; the rest reveal on hover, focus, selection, or once the camera crosses the
   * reveal zoom, and every node is listed in full in the artifact index.
   */
  function alwaysLabelled(node: WorkspaceGraphNode): boolean {
    return node.kind === 'home' || node.kind === 'overview' || isHub(node);
  }

  function nodeTitle(node: WorkspaceGraphNode): string {
    const degree = degrees.get(node.id) ?? 0;
    if (degree >= 3) return `${node.label}, hub - ${wikilinkLabel(degree)}`;
    if (degree > 0) return `${node.label}, ${wikilinkLabel(degree)}`;
    return node.label;
  }

  function nodeAriaLabel(node: WorkspaceGraphNode): string {
    const degree = degrees.get(node.id) ?? 0;
    return [
      node.label,
      node.kind,
      ...(degree > 0 ? [wikilinkLabel(degree)] : []),
      ...(degree >= 3 ? ['hub'] : []),
    ].join(', ');
  }

  function toggleSelection(id: string): void {
    selectedId = selectedId === id ? null : id;
  }

  function handleNodeClick(event: MouseEvent, id: string): void {
    event.stopPropagation();
    toggleSelection(id);
  }

  function handleNodeKeydown(event: KeyboardEvent, id: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      toggleSelection(id);
    } else if (event.key === 'Escape') {
      selectedId = null;
    }
  }

  function ensureSettling(): void {
    if (!simulation) return;
    if (reducedMotion) {
      simulation.settle();
      positioned = [...simulation.nodes];
      return;
    }
    if (settleFrame) return;
    const frame = (): void => {
      if (!simulation) {
        settleFrame = 0;
        return;
      }
      const done = simulation.tick(3);
      positioned = [...simulation.nodes];
      settleFrame = done ? 0 : requestAnimationFrame(frame);
    };
    settleFrame = requestAnimationFrame(frame);
  }

  function startSimulation(built: WorkspaceGraph): void {
    const seed = layoutWorkspaceGraph(built);
    simulation = createGraphRelaxation(seed.nodes, built.edges, settings, wikilinkDegrees(built));
    positioned = [...simulation.nodes];
    ensureSettling();
  }

  function updateSettings(patch: Partial<GraphViewSettings>): void {
    settings = { ...settings, ...patch };
    writeGraphViewSettings(localStorage, settings);
    simulation?.reheat(settings);
    ensureSettling();
  }

  function fitView(): void {
    if (positioned.length === 0 || stageWidth === 0 || stageHeight === 0) return;
    camera = fitCamera(graphBounds(positioned, degrees), {
      height: stageHeight,
      width: stageWidth,
    });
  }

  function applyZoom(factor: number): void {
    if (!camera) return;
    camera = zoomCameraAt(camera, { x: camera.x, y: camera.y }, factor, limits);
  }

  function handleZoomSlider(value: number): void {
    if (!camera) return;
    camera = clampCamera({ ...camera, zoom: sliderToZoom(value, limits) }, limits);
  }

  function handleWheel(event: WheelEvent): void {
    if (!camera) return;
    event.preventDefault();
    // A trackpad pinch reaches the page as ctrl+wheel with small deltas.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0022));
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const focus = screenToWorld(
      camera,
      { height: stageHeight, width: stageWidth },
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
    );
    camera = zoomCameraAt(camera, focus, factor, limits);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (!camera || event.button !== 0) return;
    pan = {
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!camera || !pan || event.pointerId !== pan.pointerId) return;
    if (!pan.moved && Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) > 4) {
      pan.moved = true;
    }
    if (!pan.moved) return;
    camera = panCamera(camera, event.clientX - pan.lastX, event.clientY - pan.lastY, limits);
    pan.lastX = event.clientX;
    pan.lastY = event.clientY;
  }

  function handlePointerEnd(event: PointerEvent): void {
    if (!pan || event.pointerId !== pan.pointerId) return;
    suppressBackgroundClick = pan.moved;
    pan = null;
  }

  function handleBackgroundClick(): void {
    if (suppressBackgroundClick) {
      suppressBackgroundClick = false;
      return;
    }
    selectedId = null;
  }

  onMount(async () => {
    settings = readGraphViewSettings(localStorage);
    try {
      graph = await buildWorkspaceGraph(storage);
      startSimulation(graph);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The graph could not be built.';
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (settleFrame) cancelAnimationFrame(settleFrame);
  });

  $: degrees = graph ? wikilinkDegrees(graph) : new Map<string, number>();
  $: nodesById = new Map(positioned.map((node) => [node.id, node]));
  $: homeNode = positioned.find((node) => node.kind === 'home');
  $: stage = { height: stageHeight, width: stageWidth };
  $: bounds = graphBounds(positioned, degrees);
  $: fitZoom = stageWidth > 0 && stageHeight > 0 ? fitCamera(bounds, stage).zoom : 1;
  $: limits = cameraLimits(fitZoom, bounds);
  $: if (!camera && stageWidth > 0 && stageHeight > 0 && positioned.length > 0) fitView();
  $: viewBox = camera
    ? cameraViewBox(camera, stage)
    : `${bounds.minX} ${bounds.minY} ${bounds.maxX - bounds.minX} ${bounds.maxY - bounds.minY}`;
  // Obsidian-style text fade: past 1.4x of fit zoom every label is worth its pixels.
  $: showAllLabels = camera !== null && camera.zoom >= fitZoom * 1.4;
  // Labels hold near token size while zoomed out instead of shrinking with the world.
  $: labelScale = camera ? Math.min(1.8, Math.max(1, 1 / camera.zoom)) : 1;
  $: zoomSliderValue = camera ? zoomToSlider(camera.zoom, limits) : 0;
  // Select-to-focus fading after chanhx/crabviz (AGPL-3.0): idea only,
  // implemented from scratch; no code copied or derived.
  $: selectionNeighbors = graph && selectedId ? neighborIds(graph, selectedId) : new Set<string>();
  $: hoverNeighbors = graph && hoveredId && !selectedId ? neighborIds(graph, hoveredId) : null;
  $: selectedNode = graph?.nodes.find((node) => node.id === selectedId);
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape') selectedId = null;
  }}
/>

<section class="knowledge-graph" aria-labelledby="graph-title">
  <header>
    <div>
      <p class="kicker">Portable graph · no database</p>
      <h1 id="graph-title">Knowledge constellation</h1>
      {#if graph}
        <p>{graph.nodes.length} artifacts · {graph.edges.length} connections</p>
      {:else}
        <p>Your Markdown relationships, drawn locally.</p>
      {/if}
    </div>
    <Orbit aria-hidden="true" size={36} strokeWidth={1.25} />
  </header>

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
    <div class="graph-state">Create a topic to place its artifacts on the graph.</div>
  {:else if graph}
    {#if selectedNode}
      <div class="selection-action">
        <button type="button" onclick={() => onOpen(selectedNode.path)}>
          Open {selectedNode.label}
        </button>
      </div>
    {/if}
    <div class="graph-stage">
      <div
        class="constellation-stage"
        class:panning={pan?.moved}
        bind:clientWidth={stageWidth}
        bind:clientHeight={stageHeight}
      >
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <svg
          class="constellation"
          class:labels-revealed={showAllLabels}
          style={`--graph-label-scale: ${labelScale}`}
          role="group"
          aria-label="Workspace knowledge graph"
          {viewBox}
          preserveAspectRatio="xMidYMid meet"
          onclick={handleBackgroundClick}
          onkeydown={(event) => {
            if (event.key === 'Escape') selectedId = null;
          }}
          onwheel={handleWheel}
          onpointerdown={handlePointerDown}
          onpointermove={handlePointerMove}
          onpointerup={handlePointerEnd}
          onpointercancel={handlePointerEnd}
        >
          <defs>
            <radialGradient id="dusori-glow">
              <stop offset="0" stop-color="var(--graph-glow)" stop-opacity="0.22" />
              <stop offset="1" stop-color="var(--graph-glow)" stop-opacity="0" />
            </radialGradient>
          </defs>
          {#if homeNode}
            <circle class="halo" cx={homeNode.x} cy={homeNode.y} r="250" />
          {/if}
          {#each graph.edges as edge (edge.id)}
            {@const source = nodesById.get(edge.source)}
            {@const target = nodesById.get(edge.target)}
            {#if source && target}
              <path
                class:link={edge.kind === 'links'}
                class:faded={selectedId !== null &&
                  edge.source !== selectedId &&
                  edge.target !== selectedId}
                class:dimmed={hoverNeighbors !== null &&
                  !(hoverNeighbors.has(edge.source) && hoverNeighbors.has(edge.target))}
                d={edgePath(source, target)}
              />
            {/if}
          {/each}
          {#each positioned as node (node.id)}
            <g
              class:home={node.kind === 'home'}
              class:overview={node.kind === 'overview'}
              class:hub={isHub(node)}
              class:labelled={alwaysLabelled(node)}
              class:selected={selectedId === node.id}
              class:faded={selectedId !== null && !selectionNeighbors.has(node.id)}
              class:dimmed={hoverNeighbors !== null && !hoverNeighbors.has(node.id)}
              class="node"
              role="button"
              tabindex="0"
              aria-label={nodeAriaLabel(node)}
              aria-pressed={selectedId === node.id}
              onclick={(event) => handleNodeClick(event, node.id)}
              onkeydown={(event) => handleNodeKeydown(event, node.id)}
              onpointerenter={() => (hoveredId = node.id)}
              onpointerleave={() => (hoveredId = null)}
            >
              <title>{nodeTitle(node)}</title>
              <circle cx={node.x} cy={node.y} r={nodeRadius(node)} />
              <circle class="node-ring" cx={node.x} cy={node.y} r={nodeRingRadius(node)} />
              <text x={node.x} y={node.y + nodeRingRadius(node) + 16}
                >{visualLabel(node)}{#if isHub(node)}<tspan class="hub-label">
                    · hub</tspan
                  >{/if}</text
              >
            </g>
          {/each}
        </svg>

        <div class="graph-controls">
          <button
            type="button"
            class="controls-toggle"
            aria-label="View controls"
            aria-expanded={controlsOpen}
            onclick={() => (controlsOpen = !controlsOpen)}
          >
            <SlidersHorizontal aria-hidden="true" size={18} />
          </button>
          {#if controlsOpen}
            <div class="controls-panel" role="group" aria-label="Graph view controls">
              <div class="zoom-row">
                <button type="button" aria-label="Zoom out" onclick={() => applyZoom(1 / 1.3)}>
                  <ZoomOut aria-hidden="true" size={16} />
                </button>
                <input
                  type="range"
                  aria-label="Zoom level"
                  min="0"
                  max="1"
                  step="0.01"
                  value={zoomSliderValue}
                  oninput={(event) => handleZoomSlider(Number(event.currentTarget.value))}
                />
                <button type="button" aria-label="Zoom in" onclick={() => applyZoom(1.3)}>
                  <ZoomIn aria-hidden="true" size={16} />
                </button>
              </div>
              <label class="control-slider">
                <span>Link length</span>
                <input
                  type="range"
                  min={GRAPH_VIEW_LIMITS.linkDistance.min}
                  max={GRAPH_VIEW_LIMITS.linkDistance.max}
                  step={GRAPH_VIEW_LIMITS.linkDistance.step}
                  value={settings.linkDistance}
                  oninput={(event) =>
                    updateSettings({ linkDistance: Number(event.currentTarget.value) })}
                />
              </label>
              <label class="control-slider">
                <span>Spacing</span>
                <input
                  type="range"
                  min={GRAPH_VIEW_LIMITS.repelStrength.min}
                  max={GRAPH_VIEW_LIMITS.repelStrength.max}
                  step={GRAPH_VIEW_LIMITS.repelStrength.step}
                  value={settings.repelStrength}
                  oninput={(event) =>
                    updateSettings({ repelStrength: Number(event.currentTarget.value) })}
                />
              </label>
              <button type="button" class="fit-view" onclick={fitView}>Fit view</button>
            </div>
          {/if}
        </div>
      </div>

      <aside class="artifact-index" aria-label="Graph artifact index">
        <p class="kicker">Open an artifact</p>
        <ul aria-label="Graph documents">
          {#each graph.nodes as node (node.id)}
            <li>
              <button onclick={() => onOpen(node.path)}>
                <FileText aria-hidden="true" size={16} strokeWidth={1.5} />
                <span title={node.label}>{node.label}</span>
                <small>{node.kind}</small>
              </button>
            </li>
          {/each}
        </ul>
        {#if graph.unresolvedLinks.length}
          <p class="unresolved">
            {graph.unresolvedLinks.length} unresolved wikilink{graph.unresolvedLinks.length === 1
              ? ''
              : 's'}
          </p>
        {/if}
      </aside>
    </div>
  {/if}
</section>

<style>
  /* Hallmark · component: knowledge graph · genre: atmospheric editorial · theme: design.md
   * states: default · hover · focus · active · disabled · loading · error · success/settled
   *         · controls open/closed · panning · zoomed label reveal · reduced-motion instant settle
   * contrast: pass · pre-emit critique: P5 H5 E5 S5 R5 V5
   */
  .knowledge-graph {
    --graph-glow: var(--color-marigold);
    min-height: calc(100dvh - 4.5rem);
    padding: var(--space-xl) var(--page-gutter) var(--space-2xl);
    background:
      radial-gradient(
        circle at 50% 36%,
        color-mix(in srgb, var(--color-marigold) 7%, transparent),
        transparent 38%
      ),
      var(--color-paper);
  }

  header {
    display: flex;
    width: min(100%, 76rem);
    align-items: start;
    justify-content: space-between;
    gap: var(--space-lg);
    margin-inline: auto;
    padding-block-end: var(--space-lg);
    border-block-end: var(--rule-hair) solid var(--color-rule);
  }

  h1 {
    margin-block: var(--space-xs) 0;
    font-size: clamp(2.2rem, 5vw, 4.6rem);
  }

  header p:last-child {
    color: var(--color-muted);
  }

  header > :global(svg) {
    flex: none;
    color: var(--color-marigold);
  }

  .graph-stage {
    display: grid;
    width: min(100%, 76rem);
    margin-inline: auto;
    grid-template-columns: minmax(0, 1fr);
  }

  .selection-action {
    display: flex;
    width: min(100%, 76rem);
    margin: var(--space-md) auto 0;
  }

  .selection-action button {
    min-height: 2.75rem;
    padding-inline: var(--space-md);
    border: var(--rule-hair) solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-accent);
    color: var(--color-paper);
    font: 700 var(--text-sm) / 1 var(--font-body);
    cursor: pointer;
  }

  .selection-action button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .constellation-stage {
    position: relative;
    height: clamp(24rem, 62dvh, 36rem);
    overflow: hidden;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
  }

  .constellation {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
    touch-action: none;
  }

  .constellation-stage.panning .constellation {
    cursor: grabbing;
  }

  .graph-controls {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-sm);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2xs);
  }

  .controls-toggle {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    color: var(--color-marigold);
    cursor: pointer;
    place-items: center;
  }

  .controls-toggle[aria-expanded='true'] {
    border-color: var(--color-marigold);
  }

  .controls-panel {
    display: grid;
    width: 15rem;
    padding: var(--space-sm);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper);
    gap: var(--space-xs);
  }

  .zoom-row {
    display: grid;
    align-items: center;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-2xs);
  }

  .zoom-row button {
    display: grid;
    width: 2.75rem;
    height: 2.75rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    place-items: center;
  }

  .control-slider {
    display: grid;
    min-height: 2.75rem;
    align-content: center;
    gap: var(--space-3xs);
  }

  .control-slider span {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .controls-panel input[type='range'] {
    width: 100%;
    min-height: 1.25rem;
    accent-color: var(--color-marigold);
  }

  .fit-view {
    min-height: 2.75rem;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    font: 400 var(--text-sm) / 1 var(--font-body);
  }

  .controls-toggle:focus-visible,
  .zoom-row button:focus-visible,
  .fit-view:focus-visible,
  .controls-panel input[type='range']:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  .halo {
    fill: url('#dusori-glow');
    stroke: var(--color-rule);
    stroke-dasharray: 2 14;
  }

  path {
    fill: none;
    stroke: var(--color-rule);
    stroke-width: 1;
    transition: opacity var(--dur-short) var(--ease-out);
  }

  path.link {
    stroke: color-mix(in srgb, var(--color-marigold) 70%, var(--color-rule));
    stroke-width: 1.5;
  }

  .node circle:first-child {
    fill: var(--color-paper-2);
    stroke: var(--color-border);
    stroke-width: 1.5;
    transition:
      fill var(--dur-short) var(--ease-out),
      stroke var(--dur-short) var(--ease-out);
  }

  .node {
    cursor: pointer;
    outline: none;
    transition: opacity var(--dur-short) var(--ease-out);
  }

  .node.overview circle:first-child {
    fill: var(--color-marigold);
    stroke: var(--color-paper);
  }

  .node.home circle:first-child {
    fill: var(--color-accent);
    stroke: var(--color-paper);
  }

  .node-ring {
    fill: none;
    stroke: var(--color-rule);
    stroke-dasharray: 3 5;
    transition:
      stroke var(--dur-short) var(--ease-out),
      stroke-width var(--dur-short) var(--ease-out);
  }

  .node.hub .node-ring {
    stroke: var(--color-marigold);
    stroke-width: 2;
    stroke-dasharray: none;
  }

  .node:focus-visible .node-ring {
    stroke: var(--color-focus);
    stroke-width: 3;
    stroke-dasharray: none;
  }

  .node.selected .node-ring,
  .node.selected:focus-visible .node-ring {
    stroke: var(--color-accent);
    stroke-width: 3;
    stroke-dasharray: none;
  }

  .node.faded {
    opacity: 0.25;
  }

  path.faded {
    opacity: 0.15;
  }

  text {
    fill: var(--color-muted);
    font-family: var(--font-mono);
    /* Held near token size while zoomed out; grows with the world past 1x. */
    font-size: calc(14px * var(--graph-label-scale, 1));
    /* A label may still pass an artifact dot; the paper halo keeps both readable. */
    paint-order: stroke;
    stroke: var(--color-paper);
    stroke-width: 4px;
    stroke-linejoin: round;
    text-anchor: middle;
  }

  .node:not(.labelled) text {
    opacity: 0;
    transition: opacity var(--dur-short) var(--ease-out);
  }

  .node:not(.labelled):hover text,
  .node:not(.labelled):focus-visible text,
  .node:not(.labelled).selected text {
    opacity: 1;
  }

  .constellation.labels-revealed .node:not(.labelled) text {
    opacity: 1;
  }

  @media (hover: hover) and (pointer: fine) {
    .node.dimmed {
      opacity: 0.35;
    }

    path.dimmed {
      opacity: 0.2;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .node:not(.labelled) text {
      transition: none;
    }
  }

  .hub-label {
    fill: var(--color-marigold);
    font-size: 0.72em;
    font-weight: 700;
  }

  .artifact-index {
    padding-block-start: var(--space-lg);
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .artifact-index ul {
    display: grid;
    gap: var(--space-2xs);
    margin: var(--space-sm) 0 0;
    padding: 0;
    list-style: none;
  }

  .artifact-index button {
    display: grid;
    width: 100%;
    min-height: 2.75rem;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-xs);
    padding-inline: var(--space-sm);
    border: var(--rule-hair) solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-ink);
    text-align: start;
    cursor: pointer;
  }

  .artifact-index small,
  .unresolved {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .artifact-index button span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .artifact-index button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }

  .artifact-index button:active {
    transform: translateY(1px);
  }

  .artifact-index button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .graph-state {
    display: flex;
    min-height: 24rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    color: var(--color-muted);
  }

  .graph-state.error {
    color: var(--color-error);
  }

  .spinner {
    display: grid;
    animation: graph-spin 1s linear infinite;
    place-items: center;
  }

  @keyframes graph-spin {
    to {
      transform: rotate(1turn);
    }
  }

  @media (hover: hover) and (pointer: fine) {
    .artifact-index button:hover {
      border-color: var(--color-rule);
      background: var(--color-paper-2);
    }
  }

  @media (min-width: 60rem) {
    .graph-stage {
      grid-template-columns: minmax(0, 1fr) 17rem;
      gap: var(--space-xl);
    }

    .artifact-index {
      max-height: 38rem;
      margin-block-start: var(--space-xl);
      padding-block-start: 0;
      padding-inline-start: var(--space-lg);
      border-block-start: 0;
      border-inline-start: var(--rule-hair) solid var(--color-rule);
      overflow-y: auto;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
    .node circle:first-child {
      transition: none;
    }
    path,
    .node,
    .node-ring {
      transition: none !important;
    }
    .artifact-index button:active {
      transform: none;
    }
  }
</style>
