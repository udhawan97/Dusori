import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph, WorkspaceGraphNode, WorkspaceGraphNodeKind } from '@dusori/core';

import { topicColor, topicHues, visibleNodeIds } from './graph-filters.js';
import { wikilinkDegrees } from './graph-layout.js';

function node(id: string, kind: WorkspaceGraphNodeKind, topicSlug?: string): WorkspaceGraphNode {
  return { id, kind, label: id, path: id, ...(topicSlug ? { topicSlug } : {}) };
}

function fixture(): WorkspaceGraph {
  return {
    edges: [
      { id: 'c:1', kind: 'contains', source: 'Home.md', target: 'Topics/a/Overview.md' },
      {
        id: 'l:1',
        kind: 'links',
        source: 'Topics/a/Notes/linked.md',
        target: 'Topics/a/Sources/cited.md',
      },
    ],
    nodes: [
      node('Home.md', 'home'),
      node('Topics/a/Overview.md', 'overview', 'a'),
      node('Topics/a/Notes/linked.md', 'note', 'a'),
      node('Topics/a/Notes/orphan.md', 'note', 'a'),
      node('Topics/a/Sources/cited.md', 'source', 'a'),
      node('Topics/a/Updates/2026-07-22.md', 'update', 'a'),
    ],
    unresolvedLinks: [],
  };
}

describe('visibleNodeIds', () => {
  const graph = fixture();
  const degrees = wikilinkDegrees(graph);

  it('shows everything by default', () => {
    const visible = visibleNodeIds(graph, { hiddenKinds: [], hideOrphans: false }, degrees);
    expect(visible.size).toBe(graph.nodes.length);
  });

  it('hides filtered kinds but never home or overview', () => {
    const visible = visibleNodeIds(
      graph,
      { hiddenKinds: ['note', 'source', 'update'], hideOrphans: false },
      degrees,
    );
    expect([...visible].sort()).toEqual(['Home.md', 'Topics/a/Overview.md']);
  });

  it('hides wikilink orphans when asked, keeping structural nodes', () => {
    const visible = visibleNodeIds(graph, { hiddenKinds: [], hideOrphans: true }, degrees);
    expect(visible.has('Topics/a/Notes/orphan.md')).toBe(false);
    expect(visible.has('Topics/a/Updates/2026-07-22.md')).toBe(false);
    expect(visible.has('Topics/a/Notes/linked.md')).toBe(true);
    expect(visible.has('Home.md')).toBe(true);
    expect(visible.has('Topics/a/Overview.md')).toBe(true);
  });
});

describe('topic colors', () => {
  it('assigns stable, distinct hues regardless of node order', () => {
    const graph: WorkspaceGraph = {
      edges: [],
      nodes: [
        node('Topics/gamma/Overview.md', 'overview', 'gamma'),
        node('Topics/alpha/Overview.md', 'overview', 'alpha'),
        node('Topics/beta/Overview.md', 'overview', 'beta'),
      ],
      unresolvedLinks: [],
    };
    const reversed: WorkspaceGraph = {
      edges: [],
      nodes: [...graph.nodes].reverse(),
      unresolvedLinks: [],
    };
    const hues = topicHues(graph);
    expect(topicHues(reversed)).toEqual(hues);
    expect(hues.get('alpha')).toBe(72);
    expect(new Set(hues.values()).size).toBe(3);
    for (const hue of hues.values()) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });

  it('formats a token-grammar oklch color', () => {
    expect(topicColor(72)).toBe('oklch(67% 0.14 72)');
  });
});
