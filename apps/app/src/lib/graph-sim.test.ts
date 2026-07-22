import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph, WorkspaceGraphNode, WorkspaceGraphNodeKind } from '@dusori/core';

import { NODE_RADIUS, layoutWorkspaceGraph } from './graph-layout.js';
import {
  GRAPH_VIEW_LIMITS,
  GRAPH_VIEW_STORAGE_KEY,
  graphBounds,
  nodeVisualRadius,
  readGraphViewSettings,
  writeGraphViewSettings,
} from './graph-sim.js';

function node(id: string, kind: WorkspaceGraphNodeKind, topicSlug?: string): WorkspaceGraphNode {
  return { id, kind, label: id, path: id, ...(topicSlug ? { topicSlug } : {}) };
}

function memoryStorage(initial: Record<string, string> = {}): {
  data: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('graph view settings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(readGraphViewSettings(memoryStorage())).toEqual({
      linkDistance: GRAPH_VIEW_LIMITS.linkDistance.fallback,
      repelStrength: GRAPH_VIEW_LIMITS.repelStrength.fallback,
    });
  });

  it('round-trips written settings', () => {
    const storage = memoryStorage();
    writeGraphViewSettings(storage, { linkDistance: 200, repelStrength: 0.85 });
    expect(readGraphViewSettings(storage)).toEqual({ linkDistance: 200, repelStrength: 0.85 });
  });

  it('clamps hostile stored values to the slider ranges', () => {
    const storage = memoryStorage({
      [GRAPH_VIEW_STORAGE_KEY]: JSON.stringify({ linkDistance: 9999, repelStrength: -3 }),
    });
    expect(readGraphViewSettings(storage)).toEqual({
      linkDistance: GRAPH_VIEW_LIMITS.linkDistance.max,
      repelStrength: GRAPH_VIEW_LIMITS.repelStrength.min,
    });
  });

  it('falls back per-field on garbage payloads', () => {
    for (const payload of ['not json', '42', '"str"', JSON.stringify({ linkDistance: 'wide' })]) {
      const storage = memoryStorage({ [GRAPH_VIEW_STORAGE_KEY]: payload });
      expect(readGraphViewSettings(storage)).toEqual({
        linkDistance: GRAPH_VIEW_LIMITS.linkDistance.fallback,
        repelStrength: GRAPH_VIEW_LIMITS.repelStrength.fallback,
      });
    }
  });
});

describe('nodeVisualRadius', () => {
  it('keeps structural radii and grows artifacts mildly with degree', () => {
    expect(nodeVisualRadius(node('Home.md', 'home'), 9)).toBe(NODE_RADIUS.home);
    expect(nodeVisualRadius(node('t/Overview.md', 'overview'), 9)).toBe(NODE_RADIUS.overview);
    expect(nodeVisualRadius(node('a.md', 'note'), 0)).toBe(10);
    expect(nodeVisualRadius(node('b.md', 'note'), 2)).toBe(13);
    expect(nodeVisualRadius(node('c.md', 'note'), 40)).toBe(16);
  });
});

describe('graphBounds', () => {
  it('covers every node with label margins', () => {
    const graph: WorkspaceGraph = {
      edges: [],
      nodes: [node('Home.md', 'home'), node('Topics/a/Overview.md', 'overview', 'a')],
      unresolvedLinks: [],
    };
    const layout = layoutWorkspaceGraph(graph);
    const bounds = graphBounds(layout.nodes, new Map());
    for (const positioned of layout.nodes) {
      expect(positioned.x).toBeGreaterThan(bounds.minX);
      expect(positioned.x).toBeLessThan(bounds.maxX);
      expect(positioned.y).toBeGreaterThan(bounds.minY);
      expect(positioned.y).toBeLessThan(bounds.maxY);
    }
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(120);
  });

  it('returns a small default box for an empty graph', () => {
    expect(graphBounds([], new Map())).toEqual({ maxX: 80, maxY: 80, minX: 0, minY: 0 });
  });
});
