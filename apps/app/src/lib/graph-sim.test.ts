import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph, WorkspaceGraphNode, WorkspaceGraphNodeKind } from '@dusori/core';

import { NODE_RADIUS, layoutWorkspaceGraph } from './graph-layout.js';
import {
  GRAPH_VIEW_LIMITS,
  GRAPH_VIEW_STORAGE_KEY,
  cameraLimits,
  cameraViewBox,
  clampCamera,
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
  type GraphBounds,
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

describe('graph camera', () => {
  const stage = { height: 600, width: 800 };
  const bounds: GraphBounds = { maxX: 1600, maxY: 1200, minX: 0, minY: 0 };

  it('fits large graphs below 1x and never magnifies small graphs past 1x', () => {
    const large = fitCamera(bounds, stage);
    expect(large.zoom).toBeCloseTo(0.5, 5);
    expect(large.x).toBeCloseTo(800, 5);
    expect(large.y).toBeCloseTo(600, 5);
    const small = fitCamera({ maxX: 200, maxY: 100, minX: 0, minY: 0 }, stage);
    expect(small.zoom).toBe(1);
  });

  it('keeps the focused point stationary on screen while zooming', () => {
    const limits = cameraLimits(1, bounds);
    const camera = { x: 100, y: 50, zoom: 1 };
    const focus = { x: 130, y: 80 };
    const before = {
      x: (focus.x - camera.x) * camera.zoom + stage.width / 2,
      y: (focus.y - camera.y) * camera.zoom + stage.height / 2,
    };
    const zoomed = zoomCameraAt(camera, focus, 2, limits);
    const after = {
      x: (focus.x - zoomed.x) * zoomed.zoom + stage.width / 2,
      y: (focus.y - zoomed.y) * zoomed.zoom + stage.height / 2,
    };
    expect(zoomed.zoom).toBeCloseTo(2, 5);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('clamps zoom to 0.5x-6x of fit and the center inside the bounds', () => {
    const limits = cameraLimits(0.8, bounds);
    expect(clampCamera({ x: -500, y: 9000, zoom: 99 }, limits)).toEqual({
      x: 0,
      y: 1200,
      zoom: 0.8 * 6,
    });
    expect(clampCamera({ x: 10, y: 10, zoom: 0.01 }, limits).zoom).toBeCloseTo(0.4, 5);
  });

  it('pans in screen pixels scaled by zoom', () => {
    const limits = cameraLimits(1, bounds);
    const panned = panCamera({ x: 400, y: 300, zoom: 2 }, 100, -50, limits);
    expect(panned.x).toBeCloseTo(350, 5);
    expect(panned.y).toBeCloseTo(325, 5);
  });

  it('derives the viewBox from camera and stage, and inverts screen points', () => {
    const camera = { x: 400, y: 300, zoom: 2 };
    expect(cameraViewBox(camera, stage)).toBe('200 150 400 300');
    expect(screenToWorld(camera, stage, { x: 400, y: 300 })).toEqual({ x: 400, y: 300 });
    expect(screenToWorld(camera, stage, { x: 500, y: 200 })).toEqual({ x: 450, y: 250 });
  });

  it('maps the zoom slider through log space and back', () => {
    const limits = cameraLimits(1, bounds);
    expect(sliderToZoom(0, limits)).toBeCloseTo(limits.minZoom, 5);
    expect(sliderToZoom(1, limits)).toBeCloseTo(limits.maxZoom, 5);
    for (const value of [0, 0.25, 0.5, 1]) {
      expect(zoomToSlider(sliderToZoom(value, limits), limits)).toBeCloseTo(value, 5);
    }
  });
});
