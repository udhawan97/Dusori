import { describe, expect, it } from 'vitest';

import type { WorkspaceGraph, WorkspaceGraphNode, WorkspaceGraphNodeKind } from '@dusori/core';

import { NODE_RADIUS, layoutWorkspaceGraph, wikilinkDegrees } from './graph-layout.js';
import {
  GRAPH_VIEW_LIMITS,
  GRAPH_VIEW_STORAGE_KEY,
  cameraLimits,
  createGraphRelaxation,
  relaxGraphLayout,
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

function linkedFixture(): WorkspaceGraph {
  const nodes = [node('Home.md', 'home')];
  const edges: WorkspaceGraph['edges'] = [];
  for (const slug of ['alpha', 'beta']) {
    const overview = `Topics/${slug}/Overview.md`;
    nodes.push(node(overview, 'overview', slug));
    edges.push({ id: `c:${overview}`, kind: 'contains', source: 'Home.md', target: overview });
    for (let index = 0; index < 6; index += 1) {
      const child = `Topics/${slug}/Notes/${index}.md`;
      nodes.push(node(child, 'note', slug));
      edges.push({ id: `c:${child}`, kind: 'contains', source: overview, target: child });
    }
  }
  edges.push(
    {
      id: 'l:1',
      kind: 'links',
      source: 'Topics/alpha/Notes/0.md',
      target: 'Topics/beta/Notes/0.md',
    },
    {
      id: 'l:2',
      kind: 'links',
      source: 'Topics/alpha/Notes/1.md',
      target: 'Topics/alpha/Notes/2.md',
    },
    {
      id: 'l:3',
      kind: 'links',
      source: 'Topics/beta/Notes/3.md',
      target: 'Topics/alpha/Notes/0.md',
    },
  );
  return { edges, nodes, unresolvedLinks: [] };
}

function settle(
  graph: WorkspaceGraph,
  params: { linkDistance: number; repelStrength: number },
): ReturnType<typeof relaxGraphLayout> {
  const seed = layoutWorkspaceGraph(graph);
  return relaxGraphLayout(seed.nodes, graph.edges, params, wikilinkDegrees(graph));
}

function meanLinkedDistance(
  graph: WorkspaceGraph,
  settled: { nodes: { id: string; x: number; y: number }[] },
): number {
  const byId = new Map(settled.nodes.map((entry) => [entry.id, entry]));
  const links = graph.edges.filter((edge) => edge.kind === 'links');
  const total = links.reduce((sum, edge) => {
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    return sum + Math.hypot(source.x - target.x, source.y - target.y);
  }, 0);
  return total / links.length;
}

describe('graph relaxation', () => {
  const params = { linkDistance: 110, repelStrength: 0.5 };

  it('is deterministic', () => {
    expect(settle(linkedFixture(), params)).toEqual(settle(linkedFixture(), params));
  });

  it('settles before the tick ceiling and keeps every coordinate finite', () => {
    const result = settle(linkedFixture(), params);
    expect(result.ticks).toBeLessThan(300);
    for (const positioned of result.nodes) {
      expect(Number.isFinite(positioned.x)).toBe(true);
      expect(Number.isFinite(positioned.y)).toBe(true);
    }
  });

  it('keeps home pinned at its seat', () => {
    const graph = linkedFixture();
    const seed = layoutWorkspaceGraph(graph);
    const home = seed.nodes.find((entry) => entry.kind === 'home')!;
    const settledHome = settle(graph, params).nodes.find((entry) => entry.kind === 'home')!;
    expect(settledHome.x).toBeCloseTo(home.x, 5);
    expect(settledHome.y).toBeCloseTo(home.y, 5);
  });

  it('stretches wikilinks when the link length knob grows', () => {
    const graph = linkedFixture();
    const short = meanLinkedDistance(
      graph,
      settle(graph, { linkDistance: 60, repelStrength: 0.5 }),
    );
    const long = meanLinkedDistance(
      graph,
      settle(graph, { linkDistance: 240, repelStrength: 0.5 }),
    );
    expect(long).toBeGreaterThan(short * 1.15);
  });

  it('never leaves two nodes overlapping', () => {
    const graph = linkedFixture();
    const degrees = wikilinkDegrees(graph);
    const settled = settle(graph, { linkDistance: 60, repelStrength: 0 });
    const byId = new Map(graph.nodes.map((entry) => [entry.id, entry]));
    for (let a = 0; a < settled.nodes.length; a += 1) {
      for (let b = a + 1; b < settled.nodes.length; b += 1) {
        const left = settled.nodes[a]!;
        const right = settled.nodes[b]!;
        const floor =
          nodeVisualRadius(byId.get(left.id)!, degrees.get(left.id) ?? 0) +
          nodeVisualRadius(byId.get(right.id)!, degrees.get(right.id) ?? 0);
        expect(Math.hypot(left.x - right.x, left.y - right.y)).toBeGreaterThanOrEqual(floor - 0.5);
      }
    }
  });

  it('reheats and keeps ticking after a parameter change', () => {
    const graph = linkedFixture();
    const seed = layoutWorkspaceGraph(graph);
    const sim = createGraphRelaxation(seed.nodes, graph.edges, params, wikilinkDegrees(graph));
    while (!sim.tick(16)) {
      // settle fully
    }
    expect(sim.tick()).toBe(true);
    sim.reheat({ linkDistance: 240, repelStrength: 0.5 });
    expect(sim.tick()).toBe(false);
    while (!sim.tick(16)) {
      // settle again
    }
    expect(sim.tick()).toBe(true);
  });

  it('separates exactly coincident nodes deterministically', () => {
    const overlapping = [
      { ...node('a.md', 'note'), x: 100, y: 100 },
      { ...node('b.md', 'note'), x: 100, y: 100 },
    ];
    const first = relaxGraphLayout(overlapping, [], params, new Map());
    const second = relaxGraphLayout(overlapping, [], params, new Map());
    expect(first).toEqual(second);
    const [left, right] = first.nodes;
    expect(Math.hypot(left!.x - right!.x, left!.y - right!.y)).toBeGreaterThan(15);
  });
});
