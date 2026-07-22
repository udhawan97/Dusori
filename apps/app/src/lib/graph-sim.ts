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
