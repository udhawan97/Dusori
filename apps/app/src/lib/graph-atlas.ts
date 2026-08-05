import type { WorkspaceGraph, WorkspaceGraphNode } from '@dusori/core';

export type GraphAtlasLaneId = 'sources' | 'notes' | 'briefs' | 'updates';

export interface GraphAtlasLane {
  id: GraphAtlasLaneId;
  label: string;
  nodes: WorkspaceGraphNode[];
}

export interface GraphAtlasConnection {
  count: number;
  label: string;
  slug: string;
}

export interface GraphAtlasTopic {
  connections: GraphAtlasConnection[];
  label: string;
  lanes: GraphAtlasLane[];
  slug: string;
}

export interface GraphAtlas {
  topics: GraphAtlasTopic[];
  workspace: WorkspaceGraphNode[];
}

const laneOrder: Array<{ id: GraphAtlasLaneId; label: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'notes', label: 'Notes' },
  { id: 'briefs', label: 'Briefs & learning' },
  { id: 'updates', label: 'Updates' },
];

function laneFor(node: WorkspaceGraphNode): GraphAtlasLaneId {
  if (node.kind === 'source') return 'sources';
  if (node.kind === 'note') return 'notes';
  if (node.kind === 'update') return 'updates';
  return 'briefs';
}

function nodeOrder(left: WorkspaceGraphNode, right: WorkspaceGraphNode): number {
  if (left.kind === 'overview' && right.kind !== 'overview') return -1;
  if (right.kind === 'overview' && left.kind !== 'overview') return 1;
  return left.label.localeCompare(right.label) || left.path.localeCompare(right.path);
}

/**
 * Converts a relationship graph into a legible evidence atlas. Every artifact keeps exactly one
 * visible home, while cross-topic relationships become counted labels instead of crossing lines.
 */
export function buildGraphAtlas(graph: WorkspaceGraph): GraphAtlas {
  const topicNodes = new Map<string, WorkspaceGraphNode[]>();
  const workspace: WorkspaceGraphNode[] = [];
  for (const node of graph.nodes) {
    if (!node.topicSlug) {
      workspace.push(node);
      continue;
    }
    topicNodes.set(node.topicSlug, [...(topicNodes.get(node.topicSlug) ?? []), node]);
  }

  const labelBySlug = new Map(
    [...topicNodes].map(([slug, nodes]) => [
      slug,
      nodes.find((node) => node.kind === 'overview')?.label ?? slug,
    ]),
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const topics = [...topicNodes]
    .map(([slug, nodes]): GraphAtlasTopic => {
      const connectionCounts = new Map<string, number>();
      for (const edge of graph.edges) {
        if (edge.kind !== 'links') continue;
        const sourceSlug = nodeById.get(edge.source)?.topicSlug;
        const targetSlug = nodeById.get(edge.target)?.topicSlug;
        const connectedSlug =
          sourceSlug === slug && targetSlug && targetSlug !== slug
            ? targetSlug
            : targetSlug === slug && sourceSlug && sourceSlug !== slug
              ? sourceSlug
              : null;
        if (!connectedSlug) continue;
        connectionCounts.set(connectedSlug, (connectionCounts.get(connectedSlug) ?? 0) + 1);
      }
      return {
        connections: [...connectionCounts]
          .map(([targetSlug, count]) => ({
            count,
            label: labelBySlug.get(targetSlug) ?? targetSlug,
            slug: targetSlug,
          }))
          .sort((left, right) => left.label.localeCompare(right.label)),
        label: labelBySlug.get(slug) ?? slug,
        lanes: laneOrder.map((lane) => ({
          ...lane,
          nodes: nodes.filter((node) => laneFor(node) === lane.id).sort(nodeOrder),
        })),
        slug,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  return { topics, workspace: workspace.sort(nodeOrder) };
}
