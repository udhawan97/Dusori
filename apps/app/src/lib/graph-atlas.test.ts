import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph } from '@dusori/core';

import { buildGraphAtlas } from './graph-atlas';

const graph: WorkspaceGraph = {
  edges: [
    {
      id: 'links:Topics/alpha/Notes/one.md->Topics/beta/Overview.md',
      kind: 'links',
      source: 'Topics/alpha/Notes/one.md',
      target: 'Topics/beta/Overview.md',
    },
  ],
  nodes: [
    { id: 'Home.md', kind: 'home', label: 'Workspace', path: 'Home.md' },
    {
      id: 'Topics/alpha/Overview.md',
      kind: 'overview',
      label: 'Alpha',
      path: 'Topics/alpha/Overview.md',
      topicSlug: 'alpha',
    },
    {
      id: 'Topics/alpha/Notes/one.md',
      kind: 'note',
      label: 'One',
      path: 'Topics/alpha/Notes/one.md',
      topicSlug: 'alpha',
    },
    {
      id: 'Topics/alpha/Sources/source.md',
      kind: 'source',
      label: 'Source',
      path: 'Topics/alpha/Sources/source.md',
      topicSlug: 'alpha',
    },
    {
      id: 'Topics/beta/Overview.md',
      kind: 'overview',
      label: 'Beta',
      path: 'Topics/beta/Overview.md',
      topicSlug: 'beta',
    },
  ],
  unresolvedLinks: [],
};

describe('graph evidence atlas', () => {
  it('places every topic artifact once in a named lane and keeps workspace files separate', () => {
    const atlas = buildGraphAtlas(graph);
    const alpha = atlas.topics.find((topic) => topic.slug === 'alpha');

    expect(
      alpha?.lanes.find((lane) => lane.id === 'sources')?.nodes.map((node) => node.label),
    ).toEqual(['Source']);
    expect(
      alpha?.lanes.find((lane) => lane.id === 'notes')?.nodes.map((node) => node.label),
    ).toEqual(['One']);
    expect(
      alpha?.lanes.find((lane) => lane.id === 'briefs')?.nodes.map((node) => node.label),
    ).toEqual(['Alpha']);
    expect(atlas.workspace.map((node) => node.label)).toEqual(['Workspace']);
  });

  it('summarizes cross-topic links without drawing crossing lines', () => {
    const atlas = buildGraphAtlas(graph);
    const alpha = atlas.topics.find((topic) => topic.slug === 'alpha');
    const beta = atlas.topics.find((topic) => topic.slug === 'beta');

    expect(alpha?.connections).toEqual([{ count: 1, label: 'Beta', slug: 'beta' }]);
    expect(beta?.connections).toEqual([{ count: 1, label: 'Alpha', slug: 'alpha' }]);
  });
});
