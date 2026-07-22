# Graph View Obsidian-Style Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the knowledge graph explorable (zoom/pan) and adjustable (link length + spacing sliders) Obsidian-style, decluttered by physics separation, zoom-aware labels, and hover neighborhood highlighting.

**Architecture:** Keep `layoutWorkspaceGraph` as a deterministic seed; add a pure position-based relaxation module (`graph-sim.ts`) whose parameters are the sliders, plus pure camera math; `KnowledgeGraph.svelte` drives the sim with rAF (sync under reduced motion) and renders through a camera-derived viewBox.

**Tech Stack:** Svelte 5 (legacy `$:` component style), TypeScript, Vitest, Playwright. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-graph-view-obsidian-controls-design.md`.
- No new npm dependencies.
- Design tokens only (design.md): hairline rules, `--radius-sm`, 44 px (2.75rem) controls, marigold = knowledge axis, mono microcopy, visible focus, reduced-motion = no spatial movement.
- Keep every existing e2e contract: heading "Knowledge constellation", group "Workspace knowledge graph", `.node` role=button + tabindex + aria-pressed, `.hub` class, `.selection-action`, list "Graph documents", axe-clean.
- Accessible names must not substring-collide with existing Playwright queries (`name: 'Graph'` nav button): toggle = "View controls", sliders = "Zoom level", "Link length", "Spacing", buttons = "Zoom in", "Zoom out", "Fit view".
- ESLint in this worktree needs `--no-ignore` (it silently skips worktree files otherwise).
- Run all commands from the worktree root.

---

### Task 1: graph-sim foundation — settings codec, visual radius, bounds

**Files:**
- Create: `apps/app/src/lib/graph-sim.ts`
- Create: `apps/app/src/lib/graph-sim.test.ts`
- Modify: `apps/app/src/lib/graph-layout.ts` (export `LABEL_HALF_WIDTH`, `LABEL_HEIGHT`)

**Interfaces:**
- Consumes: `NODE_RADIUS`, `PositionedWorkspaceGraphNode` from `./graph-layout.js`; `WorkspaceGraphNode` from `@dusori/core`.
- Produces: `GraphViewSettings {linkDistance:number; repelStrength:number}`, `GRAPH_VIEW_LIMITS`, `GRAPH_VIEW_STORAGE_KEY`, `readGraphViewSettings(storage)`, `writeGraphViewSettings(storage, settings)`, `nodeVisualRadius(node, degree): number`, `GraphBounds {minX;minY;maxX;maxY}`, `graphBounds(nodes, degrees): GraphBounds`.

- [x] **Step 1: Export label constants from graph-layout**

In `apps/app/src/lib/graph-layout.ts` change:

```ts
const LABEL_HALF_WIDTH = 60;
const LABEL_HEIGHT = 56;
```

to:

```ts
export const LABEL_HALF_WIDTH = 60;
export const LABEL_HEIGHT = 56;
```

- [x] **Step 2: Write the failing tests**

Create `apps/app/src/lib/graph-sim.test.ts`:

```ts
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
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  data: Map<string, string>;
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
    expect(graphBounds([], new Map())).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 80 });
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: FAIL — cannot resolve `./graph-sim.js`.

- [x] **Step 4: Write the implementation**

Create `apps/app/src/lib/graph-sim.ts`:

```ts
import type { WorkspaceGraphNode } from '@dusori/core';

import {
  LABEL_HALF_WIDTH,
  LABEL_HEIGHT,
  NODE_RADIUS,
  type PositionedWorkspaceGraphNode,
} from './graph-layout.js';

/**
 * Obsidian-style adjustability for the constellation: a deterministic
 * position-based relaxation seeded by layoutWorkspaceGraph, the camera math
 * behind zoom/pan, and the persisted view settings. No randomness anywhere so
 * the same workspace always settles into the same picture.
 */

export interface GraphViewSettings {
  linkDistance: number;
  repelStrength: number;
}

export const GRAPH_VIEW_LIMITS = {
  linkDistance: { fallback: 110, max: 260, min: 40, step: 5 },
  repelStrength: { fallback: 0.5, max: 1, min: 0, step: 0.05 },
} as const;

export const GRAPH_VIEW_STORAGE_KEY = 'dusori-graph-view';

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/** localStorage is user-editable input; every field is validated and clamped. */
export function readGraphViewSettings(storage: Pick<Storage, 'getItem'>): GraphViewSettings {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(GRAPH_VIEW_STORAGE_KEY) ?? 'null');
  } catch {
    parsed = undefined;
  }
  const record =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return {
    linkDistance: clampNumber(
      record['linkDistance'],
      GRAPH_VIEW_LIMITS.linkDistance.min,
      GRAPH_VIEW_LIMITS.linkDistance.max,
      GRAPH_VIEW_LIMITS.linkDistance.fallback,
    ),
    repelStrength: clampNumber(
      record['repelStrength'],
      GRAPH_VIEW_LIMITS.repelStrength.min,
      GRAPH_VIEW_LIMITS.repelStrength.max,
      GRAPH_VIEW_LIMITS.repelStrength.fallback,
    ),
  };
}

export function writeGraphViewSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: GraphViewSettings,
): void {
  storage.setItem(GRAPH_VIEW_STORAGE_KEY, JSON.stringify(settings));
}

/** Wikilink-degree-grown artifact dots make hubs legible at a glance. */
export function nodeVisualRadius(node: WorkspaceGraphNode, degree: number): number {
  if (node.kind === 'home') return NODE_RADIUS.home;
  if (node.kind === 'overview') return NODE_RADIUS.overview;
  return 10 + Math.min(6, degree * 1.5);
}

export interface GraphBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export function graphBounds(
  nodes: PositionedWorkspaceGraphNode[],
  degrees: Map<string, number>,
): GraphBounds {
  if (nodes.length === 0) return { maxX: 80, maxY: 80, minX: 0, minY: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const radius = nodeVisualRadius(node, degrees.get(node.id) ?? 0);
    minX = Math.min(minX, node.x - Math.max(radius, LABEL_HALF_WIDTH));
    maxX = Math.max(maxX, node.x + Math.max(radius, LABEL_HALF_WIDTH));
    minY = Math.min(minY, node.y - radius - 12);
    maxY = Math.max(maxY, node.y + Math.max(radius, LABEL_HEIGHT));
  }
  return { maxX, maxY, minX, minY };
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: PASS (8 tests).

- [x] **Step 6: Commit**

```bash
git add apps/app/src/lib/graph-sim.ts apps/app/src/lib/graph-sim.test.ts apps/app/src/lib/graph-layout.ts
git commit -m "feat(app): graph view settings codec, degree radius, bounds"
```

---

### Task 2: Camera math

**Files:**
- Modify: `apps/app/src/lib/graph-sim.ts` (append)
- Modify: `apps/app/src/lib/graph-sim.test.ts` (append)

**Interfaces:**
- Consumes: `GraphBounds` from Task 1.
- Produces: `GraphCamera {x;y;zoom}`, `StageSize {width;height}`, `CameraLimits {minZoom;maxZoom;bounds}`, `fitCamera(bounds, stage)`, `cameraLimits(fitZoom, bounds)`, `clampCamera(camera, limits)`, `zoomCameraAt(camera, focus, factor, limits)`, `panCamera(camera, dxPx, dyPx, limits)`, `cameraViewBox(camera, stage): string`, `screenToWorld(camera, stage, point)`, `sliderToZoom(value, limits)`, `zoomToSlider(zoom, limits)`.

- [x] **Step 1: Write the failing tests** (append to `graph-sim.test.ts`; extend the import from `./graph-sim.js` with the new names)

```ts
import {
  cameraLimits,
  cameraViewBox,
  clampCamera,
  fitCamera,
  panCamera,
  screenToWorld,
  sliderToZoom,
  zoomCameraAt,
  zoomToSlider,
  type GraphBounds,
} from './graph-sim.js';

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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: FAIL — `fitCamera` not exported.

- [x] **Step 3: Write the implementation** (append to `graph-sim.ts`)

```ts
export interface GraphCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface StageSize {
  height: number;
  width: number;
}

export interface CameraLimits {
  bounds: GraphBounds;
  maxZoom: number;
  minZoom: number;
}

const ZOOM_OUT_FACTOR = 0.5;
const ZOOM_IN_FACTOR = 6;

/** Fit keeps one user unit at one CSS pixel for small graphs (zoom caps at 1). */
export function fitCamera(bounds: GraphBounds, stage: StageSize): GraphCamera {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.max(0.05, Math.min(1, stage.width / width, stage.height / height));
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom };
}

export function cameraLimits(fitZoom: number, bounds: GraphBounds): CameraLimits {
  return { bounds, maxZoom: fitZoom * ZOOM_IN_FACTOR, minZoom: fitZoom * ZOOM_OUT_FACTOR };
}

export function clampCamera(camera: GraphCamera, limits: CameraLimits): GraphCamera {
  return {
    x: Math.min(limits.bounds.maxX, Math.max(limits.bounds.minX, camera.x)),
    y: Math.min(limits.bounds.maxY, Math.max(limits.bounds.minY, camera.y)),
    zoom: Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom)),
  };
}

export function zoomCameraAt(
  camera: GraphCamera,
  focus: { x: number; y: number },
  factor: number,
  limits: CameraLimits,
): GraphCamera {
  const zoom = Math.min(limits.maxZoom, Math.max(limits.minZoom, camera.zoom * factor));
  const scale = camera.zoom / zoom;
  return clampCamera(
    {
      x: focus.x - (focus.x - camera.x) * scale,
      y: focus.y - (focus.y - camera.y) * scale,
      zoom,
    },
    limits,
  );
}

export function panCamera(
  camera: GraphCamera,
  dxPx: number,
  dyPx: number,
  limits: CameraLimits,
): GraphCamera {
  return clampCamera(
    { x: camera.x - dxPx / camera.zoom, y: camera.y - dyPx / camera.zoom, zoom: camera.zoom },
    limits,
  );
}

export function cameraViewBox(camera: GraphCamera, stage: StageSize): string {
  const width = stage.width / camera.zoom;
  const height = stage.height / camera.zoom;
  return `${camera.x - width / 2} ${camera.y - height / 2} ${width} ${height}`;
}

export function screenToWorld(
  camera: GraphCamera,
  stage: StageSize,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: camera.x + (point.x - stage.width / 2) / camera.zoom,
    y: camera.y + (point.y - stage.height / 2) / camera.zoom,
  };
}

/** The slider walks zoom in log space so both halves of the range feel even. */
export function sliderToZoom(value: number, limits: CameraLimits): number {
  const ratio = limits.maxZoom / limits.minZoom;
  return limits.minZoom * Math.pow(ratio, Math.min(1, Math.max(0, value)));
}

export function zoomToSlider(zoom: number, limits: CameraLimits): number {
  const ratio = limits.maxZoom / limits.minZoom;
  return Math.log(zoom / limits.minZoom) / Math.log(ratio);
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: PASS (14 tests).

- [x] **Step 5: Commit**

```bash
git add apps/app/src/lib/graph-sim.ts apps/app/src/lib/graph-sim.test.ts
git commit -m "feat(app): pure camera math for graph zoom and pan"
```

---

### Task 3: Deterministic relaxation simulation

**Files:**
- Modify: `apps/app/src/lib/graph-sim.ts` (append)
- Modify: `apps/app/src/lib/graph-sim.test.ts` (append)

**Interfaces:**
- Consumes: `GraphViewSettings`, `nodeVisualRadius` (Task 1); `WorkspaceGraphEdge` from `@dusori/core`; `PositionedWorkspaceGraphNode` from `./graph-layout.js`.
- Produces: `GraphRelaxation { nodes: PositionedWorkspaceGraphNode[]; tick(count?): boolean; reheat(params): void; settle(): number }`, `createGraphRelaxation(seed, edges, params, degrees)`, `relaxGraphLayout(seed, edges, params, degrees): { nodes; ticks }`.

- [x] **Step 1: Write the failing tests** (append; extend imports with `createGraphRelaxation`, `relaxGraphLayout`, and `wikilinkDegrees` from `./graph-layout.js`)

```ts
import { wikilinkDegrees } from './graph-layout.js';
import { createGraphRelaxation, relaxGraphLayout } from './graph-sim.js';

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
    { id: 'l:1', kind: 'links', source: 'Topics/alpha/Notes/0.md', target: 'Topics/beta/Notes/0.md' },
    { id: 'l:2', kind: 'links', source: 'Topics/alpha/Notes/1.md', target: 'Topics/alpha/Notes/2.md' },
    { id: 'l:3', kind: 'links', source: 'Topics/beta/Notes/3.md', target: 'Topics/alpha/Notes/0.md' },
  );
  return { edges, nodes, unresolvedLinks: [] };
}

function settle(graph: WorkspaceGraph, params: { linkDistance: number; repelStrength: number }) {
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
    const short = meanLinkedDistance(graph, settle(graph, { linkDistance: 60, repelStrength: 0.5 }));
    const long = meanLinkedDistance(graph, settle(graph, { linkDistance: 240, repelStrength: 0.5 }));
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
```

- [x] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: FAIL — `createGraphRelaxation` not exported.

- [x] **Step 3: Write the implementation** (append to `graph-sim.ts`; add `WorkspaceGraphEdge` to the `@dusori/core` type import)

```ts
export interface GraphRelaxation {
  readonly nodes: PositionedWorkspaceGraphNode[];
  reheat(params: GraphViewSettings): void;
  settle(): number;
  tick(count?: number): boolean;
}

const MAX_TICKS = 300;
const SETTLE_EPSILON = 0.3;
const STEP_DECAY = 0.96;
const REHEAT_STEP = 0.65;
const CONTAINS_REST_SCALE = 0.7;
const CONTAINS_STIFFNESS = 0.4;
const LINK_STIFFNESS = 0.22;
const OVERVIEW_ANCHOR = 0.12;
const SEPARATION_GAP = 4;
const MAX_TICK_TRAVEL = 24;
const GOLDEN_ANGLE = 2.399963229728653;

interface SimBody {
  anchorStrength: number;
  anchorX: number;
  anchorY: number;
  node: PositionedWorkspaceGraphNode;
  pinned: boolean;
  radius: number;
}

function unitBetween(
  source: SimBody,
  target: SimBody,
  fallbackIndex: number,
): { distance: number; ux: number; uy: number } {
  const dx = target.node.x - source.node.x;
  const dy = target.node.y - source.node.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) {
    const angle = fallbackIndex * GOLDEN_ANGLE;
    return { distance: 0, ux: Math.cos(angle), uy: Math.sin(angle) };
  }
  return { distance, ux: dx / distance, uy: dy / distance };
}

/**
 * ponytail: O(n^2) pairwise repulsion per tick; a quadtree pays off only past
 * a few thousand nodes, far beyond a personal workspace.
 */
export function createGraphRelaxation(
  seed: PositionedWorkspaceGraphNode[],
  edges: WorkspaceGraphEdge[],
  params: GraphViewSettings,
  degrees: Map<string, number>,
): GraphRelaxation {
  const nodes = seed.map((entry) => ({ ...entry }));
  const bodies: SimBody[] = nodes.map((entry) => ({
    anchorStrength: entry.kind === 'overview' ? OVERVIEW_ANCHOR : 0,
    anchorX: entry.x,
    anchorY: entry.y,
    node: entry,
    pinned: entry.kind === 'home',
    radius: nodeVisualRadius(entry, degrees.get(entry.id) ?? 0),
  }));
  const bodyById = new Map(bodies.map((body) => [body.node.id, body]));
  const springs = edges.flatMap((edge) => {
    const source = bodyById.get(edge.source);
    const target = bodyById.get(edge.target);
    if (!source || !target || source === target) return [];
    return [{ kind: edge.kind, source, target }];
  });

  let current: GraphViewSettings = { ...params };
  let step = 1;
  let ticksRun = 0;
  let settled = false;

  function projectSeparation(): void {
    for (let round = 0; round < 12; round += 1) {
      let corrected = false;
      for (let a = 0; a < bodies.length; a += 1) {
        for (let b = a + 1; b < bodies.length; b += 1) {
          const left = bodies[a]!;
          const right = bodies[b]!;
          const floor = left.radius + right.radius;
          const { distance, ux, uy } = unitBetween(left, right, a * bodies.length + b);
          if (distance >= floor) continue;
          corrected = true;
          const push = (floor - distance) / (left.pinned || right.pinned ? 1 : 2);
          if (!left.pinned) {
            left.node.x -= ux * push;
            left.node.y -= uy * push;
          }
          if (!right.pinned) {
            right.node.x += ux * push;
            right.node.y += uy * push;
          }
        }
      }
      if (!corrected) return;
    }
  }

  function tickOnce(): number {
    const repelRange = 40 + 160 * current.repelStrength;
    const moves = bodies.map(() => ({ x: 0, y: 0 }));

    for (let index = 0; index < springs.length; index += 1) {
      const spring = springs[index]!;
      const rest =
        spring.kind === 'links'
          ? current.linkDistance
          : current.linkDistance * CONTAINS_REST_SCALE;
      const stiffness = spring.kind === 'links' ? LINK_STIFFNESS : CONTAINS_STIFFNESS;
      const { distance, ux, uy } = unitBetween(spring.source, spring.target, index);
      const move = (distance - rest) * stiffness * step * 0.5;
      const sourceIndex = bodies.indexOf(spring.source);
      const targetIndex = bodies.indexOf(spring.target);
      moves[sourceIndex]!.x += ux * move;
      moves[sourceIndex]!.y += uy * move;
      moves[targetIndex]!.x -= ux * move;
      moves[targetIndex]!.y -= uy * move;
    }

    for (let a = 0; a < bodies.length; a += 1) {
      for (let b = a + 1; b < bodies.length; b += 1) {
        const left = bodies[a]!;
        const right = bodies[b]!;
        const contact = left.radius + right.radius + SEPARATION_GAP;
        const range = contact + repelRange;
        const { distance, ux, uy } = unitBetween(left, right, a * bodies.length + b);
        if (distance >= range) continue;
        const overlap = (range - distance) / range;
        const push = overlap * overlap * range * 0.12 * step;
        moves[a]!.x -= ux * push;
        moves[a]!.y -= uy * push;
        moves[b]!.x += ux * push;
        moves[b]!.y += uy * push;
      }
    }

    let maxShift = 0;
    for (let index = 0; index < bodies.length; index += 1) {
      const body = bodies[index]!;
      if (body.pinned) continue;
      let dx = moves[index]!.x + (body.anchorX - body.node.x) * body.anchorStrength * step;
      let dy = moves[index]!.y + (body.anchorY - body.node.y) * body.anchorStrength * step;
      const travel = Math.hypot(dx, dy);
      const cap = MAX_TICK_TRAVEL * step;
      if (travel > cap) {
        dx = (dx / travel) * cap;
        dy = (dy / travel) * cap;
      }
      body.node.x += dx;
      body.node.y += dy;
      maxShift = Math.max(maxShift, Math.hypot(dx, dy));
    }
    return maxShift;
  }

  function tick(count = 1): boolean {
    if (settled) return true;
    for (let iteration = 0; iteration < count; iteration += 1) {
      const shift = tickOnce();
      ticksRun += 1;
      step *= STEP_DECAY;
      if (shift < SETTLE_EPSILON || ticksRun >= MAX_TICKS) {
        projectSeparation();
        settled = true;
        return true;
      }
    }
    return false;
  }

  return {
    nodes,
    reheat(next: GraphViewSettings): void {
      current = { ...next };
      step = Math.max(step, REHEAT_STEP);
      ticksRun = 0;
      settled = false;
    },
    settle(): number {
      while (!tick(16)) {
        // run to completion
      }
      return ticksRun;
    },
    tick,
  };
}

export function relaxGraphLayout(
  seed: PositionedWorkspaceGraphNode[],
  edges: WorkspaceGraphEdge[],
  params: GraphViewSettings,
  degrees: Map<string, number>,
): { nodes: PositionedWorkspaceGraphNode[]; ticks: number } {
  const simulation = createGraphRelaxation(seed, edges, params, degrees);
  const ticks = simulation.settle();
  return { nodes: simulation.nodes, ticks };
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/app/src/lib/graph-sim.test.ts`
Expected: PASS (21 tests). If `stretches wikilinks` fails, raise `LINK_STIFFNESS` to 0.3; if `never leaves two nodes overlapping` fails, raise `projectSeparation` rounds to 24. Do not weaken assertions.

- [x] **Step 5: Run the full existing unit suite (regression)**

Run: `npx vitest run apps/app/src/lib`
Expected: PASS including `graph-layout.test.ts`.

- [x] **Step 6: Commit**

```bash
git add apps/app/src/lib/graph-sim.ts apps/app/src/lib/graph-sim.test.ts
git commit -m "feat(app): deterministic force relaxation for the knowledge graph"
```

---

### Task 4: KnowledgeGraph.svelte integration

**Files:**
- Modify: `apps/app/src/lib/components/KnowledgeGraph.svelte`

**Interfaces:**
- Consumes: everything Tasks 1–3 produce, plus existing `layoutWorkspaceGraph`, `neighborIds`, `wikilinkDegrees`, `fitGraphLabel`, `LABEL_MAX_CHARS`.
- Produces: accessible names used by Task 5 e2e: buttons "View controls" (aria-expanded), "Zoom in", "Zoom out", "Fit view"; sliders "Zoom level", "Link length", "Spacing"; svg keeps `aria-label="Workspace knowledge graph"`; panel group `aria-label="Graph view controls"`.

- [x] **Step 1: Replace the script block** with:

```svelte
<script lang="ts">
  import { AlertCircle, FileText, LoaderCircle, Orbit, SlidersHorizontal, ZoomIn, ZoomOut } from '@lucide/svelte';
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
  let pan: { moved: boolean; pointerId: number; lastX: number; lastY: number; startX: number; startY: number } | null =
    null;
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
   * Labelling every dot tangles the constellation at fit zoom. Structural nodes stay labelled;
   * the rest reveal on hover, focus, selection, or once the camera crosses the reveal zoom.
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
    camera = fitCamera(graphBounds(positioned, degrees), { height: stageHeight, width: stageWidth });
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
  $: hoverNeighbors =
    graph && hoveredId && !selectedId ? neighborIds(graph, hoveredId) : null;
  $: selectedNode = graph?.nodes.find((node) => node.id === selectedId);
</script>
```

- [x] **Step 2: Replace the `.graph-stage` markup** (svg + new stage wrapper + controls; artifact index unchanged). The `{#if selectedNode}` block above it stays as is.

```svelte
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
```

(The artifact index body and everything after it stay unchanged.)

- [x] **Step 3: Update styles.** Update the Hallmark header comment states line to:

```
   * states: default · hover · focus · active · disabled · loading · error · success/settled
   *         · controls open/closed · panning · zoomed label reveal · reduced-motion instant settle
```

Replace `.constellation { ... }` with, and add after it:

```css
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
    gap: var(--space-3xs, 0.25rem);
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
```

Add label sizing + reveal + hover dimming rules (the `text` rule gains `font-size`; keep the rest of the existing `text` rule):

```css
  text {
    fill: var(--color-muted);
    font-family: var(--font-mono);
    font-size: calc(14px * var(--graph-label-scale, 1));
    /* A label may still pass an artifact dot; the paper halo keeps both readable. */
    paint-order: stroke;
    stroke: var(--color-paper);
    stroke-width: 4px;
    stroke-linejoin: round;
    text-anchor: middle;
  }
```

After the `.node:not(.labelled):hover text, ...` rule add:

```css
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
```

If `--space-3xs` is not defined in `apps/app/src/styles/tokens.css`, use `0.25rem` directly.

- [x] **Step 4: Typecheck and lint**

Run: `pnpm --filter @dusori/app typecheck`
Expected: 0 errors.
Run: `npx eslint --no-ignore apps/app/src/lib/graph-sim.ts apps/app/src/lib/graph-sim.test.ts apps/app/src/lib/components/KnowledgeGraph.svelte`
Expected: 0 errors (fix any reported issues; keep behavior identical).

- [x] **Step 5: Run the existing graph e2e tests**

Run: `npx playwright test tests/e2e/dusori.spec.ts -g "knowledge graph"`
Expected: PASS (the keyboard-selection flow, hub class, and axe scan all still hold).

- [x] **Step 6: Commit**

```bash
git add apps/app/src/lib/components/KnowledgeGraph.svelte
git commit -m "feat(app): zoomable, adjustable knowledge graph with Obsidian-style controls"
```

---

### Task 5: e2e coverage + preview state contract

**Files:**
- Modify: `tests/e2e/dusori.spec.ts` (add one test after `knowledge graph renders portable artifacts and opens a selected note`)
- Modify: `apps/app/src/lib/components/KnowledgeGraph.preview.html` (state list additions)

**Interfaces:**
- Consumes: accessible names from Task 4.
- Produces: regression coverage for zoom, sliders, persistence, fit view.

- [x] **Step 1: Write the failing e2e test** (insert after the existing graph test; reuse `createBrowserWorkspace`, `createTopic`, `expectNoSeriousA11yViolations` helpers already in the file)

```ts
test('graph view zooms, adjusts forces, and remembers the sliders', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Graph' }).click();
  const svg = page.locator('svg.constellation');
  await expect(svg).toBeVisible();
  const fitted = await svg.getAttribute('viewBox');

  await page.getByRole('button', { name: 'View controls' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await svg.getAttribute('viewBox');
  expect(zoomed).not.toBe(fitted);

  const linkLength = page.getByLabel('Link length');
  await linkLength.fill('220');
  await page.getByLabel('Spacing').fill('0.9');
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Knowledge constellation' })).toBeVisible();
  await page.getByRole('button', { name: 'View controls' }).click();
  await expect(page.getByLabel('Link length')).toHaveValue('220');
  await expect(page.getByLabel('Spacing')).toHaveValue('0.9');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit view' }).click();
  await expect(svg).toHaveAttribute('viewBox', /.+/u);
});
```

- [x] **Step 2: Run it to verify current behavior** (it should pass only once Task 4 is in place; if run before Task 4 it fails on "View controls")

Run: `npx playwright test tests/e2e/dusori.spec.ts -g "remembers the sliders"`
Expected: PASS after Task 4.

- [x] **Step 3: Update the preview state contract.** In `KnowledgeGraph.preview.html`, extend the states list with rows for the new controls (follow the file's existing row markup): "controls toggle — default / hover / focus / expanded", "zoom buttons — default / hover / focus / disabled-at-limit (visual only, buttons stay enabled and clamp)", "range slider — default / focus (marigold accent)", "fit view — default / hover / focus", "labels — hidden at fit zoom / revealed past 1.4× fit / hover reveal", "stage — grab / grabbing while panning".

- [x] **Step 4: Run the full graph e2e group**

Run: `npx playwright test tests/e2e/dusori.spec.ts -g "graph"`
Expected: PASS (old + new tests).

- [x] **Step 5: Commit**

```bash
git add tests/e2e/dusori.spec.ts apps/app/src/lib/components/KnowledgeGraph.preview.html
git commit -m "test(e2e): graph zoom, force sliders, and persistence coverage"
```

---

### Task 6: Docs, changelog, full verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: the docs page describing the knowledge graph, if it describes interactions (locate with `grep -rn "Portable knowledge graph" apps docs --include='*.astro' --include='*.md' -l`)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–5.
- Produces: release-notes entry; user-facing docs sentence.

- [x] **Step 1: CHANGELOG entry.** Under a `## Unreleased` heading (create it above the newest version heading if absent), add:

```markdown
### Changed

- The knowledge graph is now explorable and adjustable, Obsidian-style: zoom
  toward the cursor (wheel/pinch, buttons, or slider), drag to pan, and tune
  link length and spacing with sliders that persist per browser. Labels fade
  in as you zoom, hovering highlights a node's neighborhood, and hub dots grow
  with their wikilink degree.
```

- [x] **Step 2: Docs touch.** If the located docs page enumerates graph interactions, add one sentence in the same voice: "Zoom, pan, and the link-length and spacing sliders are local view settings; they never touch your files." Skip if the page only describes the file format.

- [x] **Step 3: Full verification suite**

```bash
npx vitest run
pnpm --filter @dusori/app typecheck
npx eslint --no-ignore apps/app/src/lib/graph-sim.ts apps/app/src/lib/graph-sim.test.ts apps/app/src/lib/components/KnowledgeGraph.svelte
pnpm --filter @dusori/app build
npx playwright test
```

Expected: all green.

- [x] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog and docs for adjustable knowledge graph"
```

(Include the docs page file in the `git add` if Step 2 touched one.)
