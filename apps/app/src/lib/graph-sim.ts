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
