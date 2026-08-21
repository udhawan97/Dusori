<script lang="ts">
  import { AlertCircle, FileText, LoaderCircle, Orbit, Search } from '@lucide/svelte';
  import { onMount } from 'svelte';

  import {
    buildWorkspaceGraph,
    readResearchFile,
    readSourceManifest,
    type StorageAdapter,
    type WorkspaceGraph,
    type WorkspaceGraphNode,
  } from '@dusori/core';

  import { buildGraphAtlas, type GraphAtlas } from '$lib/graph-atlas';
  import type { GraphMode } from '$lib/workspace-navigation';

  export let storage: StorageAdapter;
  export let onOpen: (path: string) => void;
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
  let artifactKind: 'all' | 'note' | 'source' | 'update' = 'all';
  let artifactTag = '';
  let topicEvidence: TopicEvidence[] = [];

  function evidenceFor(slug: string): TopicEvidence | undefined {
    return topicEvidence.find((topic) => topic.slug === slug);
  }

  function kindLabel(node: WorkspaceGraphNode): string {
    const labels: Record<string, string> = {
      document: 'Document',
      home: 'Workspace',
      note: 'Note',
      overview: 'Overview',
      roadmap: 'Roadmap',
      source: 'Source',
      tutor: 'Preferences',
      update: 'Update',
    };
    return labels[node.kind] ?? node.kind;
  }

  onMount(async () => {
    try {
      graph = await buildWorkspaceGraph(storage);
      atlas = buildGraphAtlas(graph);
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
                (total, source) => total + (source.claims?.length ?? 0),
                0,
              ),
              discovered: research?.seen?.length ?? 0,
              freshness: latest?.at
                ? `Last researched ${latest.at.slice(0, 10)}`
                : 'Not researched yet',
              label: topic.label,
              read: manifest.sources.filter((source) => (source.claims?.length ?? 0) > 0).length,
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
  $: noteCount = graph?.nodes.filter((node) => node.kind === 'note').length ?? 0;
  $: sourceCount = graph?.nodes.filter((node) => node.kind === 'source').length ?? 0;
  $: wikilinkCount = graph?.edges.filter((edge) => edge.kind === 'links').length ?? 0;
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
      >Visual map</button
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
        <dt>Wikilinks</dt>
        <dd>{wikilinkCount}</dd>
      </div>
      <div>
        <dt>Unresolved</dt>
        <dd>{graph.unresolvedLinks.length}</dd>
      </div>
    </dl>

    {#if mode === 'visual'}
      <section class="atlas" aria-label="Workspace evidence atlas">
        <div class="atlas-intro">
          <p class="kicker">Evidence atlas</p>
          <h2>Each topic has its own room.</h2>
          <p>
            Sources, notes, briefs, and updates stay in separate lanes. Relationships to another
            topic are counted below the room instead of crossing through its contents.
          </p>
        </div>

        <div class="topic-grid">
          {#each atlas.topics as topic (topic.slug)}
            {@const evidence = evidenceFor(topic.slug)}
            <article class="topic-room" aria-labelledby={`atlas-${topic.slug}`}>
              <div class="room-heading">
                <div>
                  <p class="room-number">Topic · {topic.slug}</p>
                  <h3 id={`atlas-${topic.slug}`}>{topic.label}</h3>
                </div>
                <small>{evidence?.freshness ?? 'Not researched yet'}</small>
              </div>

              <dl class="evidence-spine" aria-label={`${topic.label} research progress`}>
                <div>
                  <dt>Discovered</dt>
                  <dd>{evidence?.discovered ?? 0}</dd>
                </div>
                <div>
                  <dt>Saved</dt>
                  <dd>{evidence?.saved ?? 0}</dd>
                </div>
                <div>
                  <dt>Read</dt>
                  <dd>{evidence?.read ?? 0}</dd>
                </div>
                <div>
                  <dt>Quoted</dt>
                  <dd>{evidence?.claims ?? 0}</dd>
                </div>
              </dl>

              <div class="lane-grid">
                {#each topic.lanes as lane (lane.id)}
                  <section class="lane" aria-labelledby={`${topic.slug}-${lane.id}`}>
                    <div class="lane-heading">
                      <h4 id={`${topic.slug}-${lane.id}`}>{lane.label}</h4>
                      <span>{lane.nodes.length}</span>
                    </div>
                    {#if lane.nodes.length}
                      <ul>
                        {#each lane.nodes as node (node.id)}
                          <li>
                            <button type="button" onclick={() => onOpen(node.path)}>
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

              {#if topic.connections.length}
                <p class="connections">
                  <strong>Connects to</strong>
                  {topic.connections
                    .map(
                      (connection) =>
                        `${connection.label} (${connection.count} ${connection.count === 1 ? 'link' : 'links'})`,
                    )
                    .join(' · ')}
                </p>
              {/if}
            </article>
          {/each}
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
                  <button type="button" onclick={() => onOpen(node.path)}>
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
          {#each ['all', 'note', 'source', 'update'] as kind (kind)}
            <button
              type="button"
              aria-pressed={artifactKind === kind}
              onclick={() => (artifactKind = kind as 'all' | 'note' | 'source' | 'update')}
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
              <button type="button" onclick={() => onOpen(node.path)}>
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
  /* Hallmark · component: research atlas · genre: quiet editorial index · theme: design.md
   * signature: an evidence spine followed by four named artifact lanes
   * states: outline · atlas · loading · error · empty · filtered · contrast: pass
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
  .atlas-intro > p:last-child,
  .room-heading small,
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

  .topic-grid {
    display: grid;
    gap: var(--space-2xl);
    margin-block-start: var(--space-xl);
  }

  .topic-room {
    min-width: 0;
    padding: var(--space-xl);
    border: var(--rule-hair) solid var(--color-border);
    border-block-start: 0.28rem solid var(--color-marigold);
    background: var(--color-paper-raised, var(--color-paper));
  }

  .room-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-md);
  }

  .room-heading h3 {
    margin-block-start: 0.2rem;
    font-size: clamp(1.55rem, 2.4vw, 2.15rem);
    overflow-wrap: anywhere;
  }

  .room-heading small {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
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

  .lane-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-md);
    margin-block-start: var(--space-lg);
  }

  .lane {
    min-width: 0;
    padding-inline-start: var(--space-sm);
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

  .lane ul,
  .workspace-shelf ul,
  .artifact-index ul {
    display: grid;
    gap: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .lane li,
  .workspace-shelf li,
  .artifact-index li {
    min-width: 0;
    border-block-start: var(--rule-hair) solid var(--color-rule);
  }

  .lane button,
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

  .lane button {
    display: grid;
    gap: 0.1rem;
    padding: var(--space-sm) 0;
  }

  .lane button span,
  .workspace-shelf button span,
  .artifact-index button span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .lane button small,
  .workspace-shelf button small,
  .artifact-index button small {
    color: var(--color-muted);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
  }

  .lane button:hover span,
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
    color: var(--color-danger, #9a2c2c);
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

  @media (max-width: 58rem) {
    .lane-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
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

    .topic-room,
    .artifact-index {
      padding: var(--space-md);
    }

    .room-heading {
      display: grid;
    }

    .lane-grid,
    .workspace-shelf ul,
    .artifact-index > ul {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner :global(svg) {
      animation: none;
    }
  }
</style>
