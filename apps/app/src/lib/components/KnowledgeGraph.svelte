<script lang="ts">
  import { AlertCircle, FileText, LoaderCircle, Orbit } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    buildWorkspaceGraph,
    type StorageAdapter,
    type WorkspaceGraph,
    type WorkspaceGraphNode,
  } from '@dusori/core';

  interface PositionedNode extends WorkspaceGraphNode {
    x: number;
    y: number;
  }

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;

  let graph: WorkspaceGraph | null = null;
  let loading = true;
  let error = '';

  function placeNodes(nodes: WorkspaceGraphNode[]): PositionedNode[] {
    const home = nodes.find((node) => node.kind === 'home');
    const overviews = nodes.filter((node) => node.kind === 'overview');
    const points: Record<string, { x: number; y: number }> = {};
    if (home) points[home.id] = { x: 450, y: overviews.length === 1 ? 448 : 280 };

    overviews.forEach((overview, index) => {
      if (overviews.length === 1) {
        const center = { x: 450, y: 270 };
        points[overview.id] = center;
        const children = nodes.filter(
          (node) => node.topicSlug === overview.topicSlug && node.id !== overview.id,
        );
        children.forEach((node, childIndex) => {
          points[node.id] = {
            x: children.length === 1 ? 450 : 130 + (childIndex * 640) / (children.length - 1),
            y: 122 + (childIndex % 2) * 38,
          };
        });
        return;
      }
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / Math.max(overviews.length, 1);
      const center = { x: 450 + Math.cos(angle) * 185, y: 280 + Math.sin(angle) * 185 };
      points[overview.id] = center;
      const children = nodes.filter(
        (node) => node.topicSlug === overview.topicSlug && node.id !== overview.id,
      );
      children.forEach((node, childIndex) => {
        const childAngle =
          angle - Math.PI * 0.68 + (childIndex * Math.PI * 1.36) / Math.max(children.length - 1, 1);
        points[node.id] = {
          x: center.x + Math.cos(childAngle) * 118,
          y: center.y + Math.sin(childAngle) * 118,
        };
      });
    });

    const unplaced = nodes.filter((node) => !(node.id in points));
    unplaced.forEach((node, index) => {
      points[node.id] = { x: 110 + index * 82, y: 500 };
    });
    return nodes.map((node) => ({ ...node, ...(points[node.id] ?? { x: 450, y: 280 }) }));
  }

  function edgePath(source: PositionedNode, target: PositionedNode): string {
    const middleX = (source.x + target.x) / 2;
    const middleY = (source.y + target.y) / 2 - 18;
    return `M ${source.x} ${source.y} Q ${middleX} ${middleY} ${target.x} ${target.y}`;
  }

  function visualLabel(node: WorkspaceGraphNode): string {
    if (node.kind === 'home') return 'Workspace';
    if (node.kind === 'roadmap') return 'Roadmap';
    if (node.kind === 'tutor') return 'Preferences';
    if (node.kind === 'update') return node.label.replace(/ update$/u, '');
    return node.label;
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

  $: positioned = placeNodes(graph?.nodes ?? []);
  $: nodesById = new Map(positioned.map((node) => [node.id, node]));
</script>

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
    <div class="graph-stage">
      <svg
        class="constellation"
        role="img"
        aria-label="Workspace knowledge graph"
        viewBox="0 0 900 560"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="dusori-glow">
            <stop offset="0" stop-color="var(--graph-glow)" stop-opacity="0.22" />
            <stop offset="1" stop-color="var(--graph-glow)" stop-opacity="0" />
          </radialGradient>
        </defs>
        <circle class="halo" cx="450" cy="280" r="250" />
        {#each graph.edges as edge (edge.id)}
          {@const source = nodesById.get(edge.source)}
          {@const target = nodesById.get(edge.target)}
          {#if source && target}
            <path class:link={edge.kind === 'links'} d={edgePath(source, target)} />
          {/if}
        {/each}
        {#each positioned as node (node.id)}
          <g
            class:home={node.kind === 'home'}
            class:overview={node.kind === 'overview'}
            class="node"
          >
            <title>{node.label}</title>
            <circle
              cx={node.x}
              cy={node.y}
              r={node.kind === 'home' ? 28 : node.kind === 'overview' ? 21 : 12}
            />
            <circle
              class="node-ring"
              cx={node.x}
              cy={node.y}
              r={node.kind === 'home' ? 40 : node.kind === 'overview' ? 30 : 21}
            />
            <text x={node.x} y={node.y + (node.kind === 'home' ? 56 : 39)}>{visualLabel(node)}</text
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
  }

  text {
    fill: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 14px;
    text-anchor: middle;
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
    .artifact-index button:active {
      transform: none;
    }
  }
</style>
