import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph, WorkspaceGraphNode, WorkspaceGraphNodeKind } from '@dusori/core';

import { NODE_RADIUS, layoutWorkspaceGraph, neighborIds, wikilinkDegrees } from './graph-layout.js';

function node(id: string, kind: WorkspaceGraphNodeKind, topicSlug?: string): WorkspaceGraphNode {
  return { id, kind, label: id, path: id, ...(topicSlug ? { topicSlug } : {}) };
}

function graph(nodes: WorkspaceGraphNode[], edges: WorkspaceGraph['edges'] = []): WorkspaceGraph {
  return { edges, nodes, unresolvedLinks: [] };
}

function radius(kind: WorkspaceGraphNodeKind): number {
  if (kind === 'home') return NODE_RADIUS.home;
  if (kind === 'overview') return NODE_RADIUS.overview;
  return NODE_RADIUS.artifact;
}

function scaleFixture(): WorkspaceGraph {
  const nodes = [node('Home.md', 'home')];
  for (let topicIndex = 0; topicIndex < 8; topicIndex += 1) {
    const slug = `topic-${topicIndex}`;
    nodes.push(node(`Topics/${slug}/Overview.md`, 'overview', slug));
    for (let childIndex = 0; childIndex < 12; childIndex += 1) {
      nodes.push(node(`Topics/${slug}/Notes/${childIndex}.md`, 'note', slug));
    }
  }
  for (let index = 0; index < 15; index += 1) {
    nodes.push(node(`Documents/${index}.md`, 'document'));
  }
  return graph(nodes);
}

describe('layoutWorkspaceGraph', () => {
  it('is deterministic for the same graph', () => {
    const fixture = scaleFixture();
    expect(layoutWorkspaceGraph(fixture)).toEqual(layoutWorkspaceGraph(fixture));
  });

  it('keeps a scale fixture non-overlapping and inside finite bounds', () => {
    const layout = layoutWorkspaceGraph(scaleFixture());
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
      const left = layout.nodes[leftIndex]!;
      const leftRadius = radius(left.kind);
      expect(left.x - leftRadius).toBeGreaterThanOrEqual(0);
      expect(left.y - leftRadius).toBeGreaterThanOrEqual(0);
      expect(left.x + leftRadius).toBeLessThanOrEqual(layout.width);
      expect(left.y + leftRadius).toBeLessThanOrEqual(layout.height);

      for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
        const right = layout.nodes[rightIndex]!;
        const distance = Math.hypot(left.x - right.x, left.y - right.y);
        expect(distance).toBeGreaterThanOrEqual(leftRadius + radius(right.kind) + 4);
      }
    }
  });

  it('places the strongest wikilink-affinity pair at adjacent angles', () => {
    const nodes = [
      node('Home.md', 'home'),
      node('Topics/a/Overview.md', 'overview', 'a'),
      node('Topics/b/Overview.md', 'overview', 'b'),
      node('Topics/c/Overview.md', 'overview', 'c'),
    ];
    const fixture = graph(
      nodes,
      [1, 2, 3].map((index) => ({
        id: `a-c-${index}`,
        kind: 'links' as const,
        source: 'Topics/a/Overview.md',
        target: 'Topics/c/Overview.md',
      })),
    );
    const layout = layoutWorkspaceGraph(fixture);
    const byId = new Map(layout.nodes.map((item) => [item.id, item]));
    const home = byId.get('Home.md')!;
    const a = byId.get('Topics/a/Overview.md')!;
    const c = byId.get('Topics/c/Overview.md')!;
    const aAngle = Math.atan2(a.y - home.y, a.x - home.x);
    const cAngle = Math.atan2(c.y - home.y, c.x - home.x);
    const clockwiseDifference = (cAngle - aAngle + Math.PI * 2) % (Math.PI * 2);
    expect(clockwiseDifference).toBeCloseTo((Math.PI * 2) / 3);
  });

  it('lays out a single topic with finite bounds and no overlaps', () => {
    const fixture = graph([
      node('Home.md', 'home'),
      node('Topics/only/Overview.md', 'overview', 'only'),
      node('Topics/only/Notes/one.md', 'note', 'only'),
      node('Topics/only/Notes/two.md', 'note', 'only'),
    ]);
    const layout = layoutWorkspaceGraph(fixture);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
    for (let leftIndex = 0; leftIndex < layout.nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < layout.nodes.length; rightIndex += 1) {
        const left = layout.nodes[leftIndex]!;
        const right = layout.nodes[rightIndex]!;
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(
          radius(left.kind) + radius(right.kind) + 4,
        );
      }
    }
  });

  it('returns positive finite bounds for an empty graph', () => {
    expect(layoutWorkspaceGraph(graph([]))).toEqual({ nodes: [], width: 80, height: 80 });
  });
});

describe('graph emphasis helpers', () => {
  const fixture = graph(
    [
      node('a.md', 'document'),
      node('b.md', 'document'),
      node('c.md', 'document'),
      node('d.md', 'document'),
    ],
    [
      { id: 'contains:a-b', kind: 'contains', source: 'a.md', target: 'b.md' },
      { id: 'links:a-c', kind: 'links', source: 'a.md', target: 'c.md' },
      { id: 'links:b-c', kind: 'links', source: 'b.md', target: 'c.md' },
    ],
  );

  it('counts only wikilink edges in both directions', () => {
    expect([...wikilinkDegrees(fixture)]).toEqual([
      ['a.md', 1],
      ['b.md', 1],
      ['c.md', 2],
      ['d.md', 0],
    ]);
  });

  it('includes both edge kinds, both directions, and self in neighbors', () => {
    expect([...neighborIds(fixture, 'a.md')].sort()).toEqual(['a.md', 'b.md', 'c.md']);
    expect([...neighborIds(fixture, 'c.md')].sort()).toEqual(['a.md', 'b.md', 'c.md']);
    expect([...neighborIds(fixture, 'd.md')]).toEqual(['d.md']);
  });
});
