<script lang="ts">
  import { AlertCircle, FileText, LoaderCircle, Orbit } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    buildWorkspaceGraph,
    type StorageAdapter,
    type WorkspaceGraph,
    type WorkspaceGraphNode,
  } from '@dusori/core';

  import {
    LABEL_MAX_CHARS,
    NODE_RADIUS,
    fitGraphLabel,
    layoutWorkspaceGraph,
    neighborIds,
    wikilinkDegrees,
    type PositionedWorkspaceGraphNode,
  } from '$lib/graph-layout';

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;

  let graph: WorkspaceGraph | null = null;
  let loading = true;
  let error = '';
  let selectedId: string | null = null;
  let stageWidth = 0;

  function nodeRadius(node: WorkspaceGraphNode): number {
    if (node.kind === 'home') return NODE_RADIUS.home;
    if (node.kind === 'overview') return NODE_RADIUS.overview;
    return NODE_RADIUS.artifact;
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
   * Ring members sit ~30px apart, far closer than any label is wide, so labelling every dot
   * tangles the constellation. The structural nodes stay labelled; the rest reveal their label
   * on hover, focus, or selection, and every node is listed in full in the artifact index.
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

  onMount(async () => {
    try {
      graph = await buildWorkspaceGraph(storage);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The graph could not be built.';
    } finally {
      loading = false;
    }
  });

  $: layout = layoutWorkspaceGraph(graph ?? { edges: [], nodes: [], unresolvedLinks: [] });
  // A viewBox sized to the node bounds alone gets stretched to fill the stage, magnifying every
  // label with it. Widening the box to the measured stage keeps one user unit at one CSS pixel,
  // so labels stay at their token size and the layout is centred in the leftover space.
  $: viewBoxWidth = Math.max(layout.width, stageWidth);
  $: viewBoxX = -(viewBoxWidth - layout.width) / 2;
  $: positioned = layout.nodes;
  $: nodesById = new Map(positioned.map((node) => [node.id, node]));
  $: homeNode = positioned.find((node) => node.kind === 'home');
  $: degrees = graph ? wikilinkDegrees(graph) : new Map<string, number>();
  // Select-to-focus fading after chanhx/crabviz (AGPL-3.0): idea only,
  // implemented from scratch; no code copied or derived.
  $: selectionNeighbors = graph && selectedId ? neighborIds(graph, selectedId) : new Set<string>();
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
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        class="constellation"
        bind:clientWidth={stageWidth}
        role="group"
        aria-label="Workspace knowledge graph"
        viewBox={`${viewBoxX} 0 ${viewBoxWidth} ${layout.height}`}
        preserveAspectRatio="xMidYMid meet"
        onclick={() => (selectedId = null)}
        onkeydown={(event) => {
          if (event.key === 'Escape') selectedId = null;
        }}
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
            class="node"
            role="button"
            tabindex="0"
            aria-label={nodeAriaLabel(node)}
            aria-pressed={selectedId === node.id}
            onclick={(event) => handleNodeClick(event, node.id)}
            onkeydown={(event) => handleNodeKeydown(event, node.id)}
          >
            <title>{nodeTitle(node)}</title>
            <circle cx={node.x} cy={node.y} r={nodeRadius(node)} />
            <circle class="node-ring" cx={node.x} cy={node.y} r={nodeRingRadius(node)} />
            <text x={node.x} y={node.y + (node.kind === 'home' ? 56 : 39)}
              >{visualLabel(node)}{#if isHub(node)}<tspan class="hub-label">
                  · hub</tspan
                >{/if}</text
            >
          </g>
        {/each}
      </svg>

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

  .constellation {
    width: 100%;
    min-height: 25rem;
    overflow: visible;
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
    font-size: 14px;
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
