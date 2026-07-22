import type { WorkspaceGraphEdge, WorkspaceGraphNode } from '@dusori/core';

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
  const indexById = new Map(bodies.map((body, index) => [body.node.id, index]));
  const springs = edges.flatMap((edge) => {
    const sourceIndex = indexById.get(edge.source);
    const targetIndex = indexById.get(edge.target);
    if (sourceIndex === undefined || targetIndex === undefined || sourceIndex === targetIndex) {
      return [];
    }
    return [{ kind: edge.kind, sourceIndex, targetIndex }];
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
      const source = bodies[spring.sourceIndex]!;
      const target = bodies[spring.targetIndex]!;
      const rest =
        spring.kind === 'links'
          ? current.linkDistance
          : current.linkDistance * CONTAINS_REST_SCALE;
      const stiffness = spring.kind === 'links' ? LINK_STIFFNESS : CONTAINS_STIFFNESS;
      const { distance, ux, uy } = unitBetween(source, target, index);
      const move = (distance - rest) * stiffness * step * 0.5;
      moves[spring.sourceIndex]!.x += ux * move;
      moves[spring.sourceIndex]!.y += uy * move;
      moves[spring.targetIndex]!.x -= ux * move;
      moves[spring.targetIndex]!.y -= uy * move;
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
