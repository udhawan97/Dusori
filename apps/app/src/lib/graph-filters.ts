import type { WorkspaceGraph } from '@dusori/core';

import type { FilterableKind } from './graph-sim.js';

/**
 * Schema-native graph filters and topic coloring. Dusori artifacts already
 * carry a kind and a topic, so the view filters on those directly instead of
 * Obsidian-style search queries, and topic colors need no configuration.
 */

export interface GraphFilterSettings {
  hiddenKinds: FilterableKind[];
  hideOrphans: boolean;
}

/** Home and overview anchor the constellation; filters never remove them. */
export function visibleNodeIds(
  graph: WorkspaceGraph,
  filters: GraphFilterSettings,
  degrees: Map<string, number>,
): Set<string> {
  const hidden = new Set<string>(filters.hiddenKinds);
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    const structural = node.kind === 'home' || node.kind === 'overview';
    if (!structural && hidden.has(node.kind)) continue;
    if (!structural && filters.hideOrphans && (degrees.get(node.id) ?? 0) === 0) continue;
    visible.add(node.id);
  }
  return visible;
}

/** Marigold sits at hue 72; topics fan out evenly from there (design.md grammar). */
const MARIGOLD_HUE = 72;

export function topicHues(graph: WorkspaceGraph): Map<string, number> {
  const slugs = [...new Set(graph.nodes.flatMap((node) => node.topicSlug ?? []))].sort((a, b) =>
    a.localeCompare(b),
  );
  return new Map(
    slugs.map((slug, index) => [slug, (MARIGOLD_HUE + (index * 360) / slugs.length) % 360]),
  );
}

export function topicColor(hue: number): string {
  return `oklch(67% 0.14 ${hue})`;
}
