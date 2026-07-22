import type { WorkspaceGraph, WorkspaceGraphNode } from '@dusori/core';

/**
 * Constellation layout: count-scaled rings with wikilink-affinity ordering
 * (idea: Graphify-Labs/graphify, MIT) and geometry self-audit tests
 * (idea: tt-a1i/archify, MIT). Implemented independently; no code copied.
 */

export const NODE_RADIUS = { home: 28, overview: 21, artifact: 12 } as const;

export interface PositionedWorkspaceGraphNode extends WorkspaceGraphNode {
  x: number;
  y: number;
}

export interface WorkspaceGraphLayout {
  nodes: PositionedWorkspaceGraphNode[];
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface TopicGroup {
  children: WorkspaceGraphNode[];
  discRadius: number;
  overview?: WorkspaceGraphNode;
  slug: string;
}

const CHILDREN_PER_RING = 10;
const FAN_SPAN = Math.PI * 1.36;
export const LABEL_HALF_WIDTH = 60;
export const LABEL_HEIGHT = 56;
const BOUNDS_PADDING = 40;

/**
 * Node labels are drawn in the mono face at 14px, whose advance is ~0.6em. Keeping the drawn
 * text inside the width the layout reserves (2 × LABEL_HALF_WIDTH) is what stops a long title
 * from printing across a neighbouring node.
 */
const LABEL_ADVANCE = 8.4;
export const LABEL_MAX_CHARS = Math.floor((LABEL_HALF_WIDTH * 2) / LABEL_ADVANCE);

/** Shortens a node label to the width the constellation reserves for it. */
export function fitGraphLabel(label: string, maxChars: number = LABEL_MAX_CHARS): string {
  const text = label.trim().replace(/\s+/gu, ' ');
  const budget = Math.max(1, maxChars);
  if (text.length <= budget) return text;
  return `${text.slice(0, budget - 1).trimEnd()}…`;
}

function nodeRadius(node: WorkspaceGraphNode): number {
  if (node.kind === 'home') return NODE_RADIUS.home;
  if (node.kind === 'overview') return NODE_RADIUS.overview;
  return NODE_RADIUS.artifact;
}

function topicDiscRadius(childCount: number): number {
  if (childCount === 0) return 96;
  const outermostRing = Math.floor((childCount - 1) / CHILDREN_PER_RING);
  return 64 + 44 * outermostRing + NODE_RADIUS.artifact + 28;
}

function topicGroups(nodes: WorkspaceGraphNode[]): TopicGroup[] {
  const nodesByTopic = new Map<string, WorkspaceGraphNode[]>();
  for (const node of nodes) {
    if (!node.topicSlug) continue;
    const topicNodes = nodesByTopic.get(node.topicSlug) ?? [];
    topicNodes.push(node);
    nodesByTopic.set(node.topicSlug, topicNodes);
  }

  return [...nodesByTopic]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slug, topicNodes]) => {
      const overview = topicNodes.find((node) => node.kind === 'overview');
      const children = topicNodes.filter((node) => node.id !== overview?.id);
      return {
        children,
        discRadius: topicDiscRadius(children.length),
        ...(overview ? { overview } : {}),
        slug,
      };
    });
}

function orderedTopicSlugs(graph: WorkspaceGraph, groups: TopicGroup[]): string[] {
  const slugs = groups.map((group) => group.slug);
  if (slugs.length < 2) return slugs;

  const topicByNode = new Map(graph.nodes.map((node) => [node.id, node.topicSlug]));
  const affinity = new Map<string, Map<string, number>>(
    slugs.map((slug) => [slug, new Map(slugs.map((other) => [other, 0]))]),
  );

  for (const edge of graph.edges) {
    if (edge.kind !== 'links') continue;
    const sourceTopic = topicByNode.get(edge.source);
    const targetTopic = topicByNode.get(edge.target);
    if (!sourceTopic || !targetTopic || sourceTopic === targetTopic) continue;
    affinity
      .get(sourceTopic)
      ?.set(targetTopic, (affinity.get(sourceTopic)?.get(targetTopic) ?? 0) + 1);
    affinity
      .get(targetTopic)
      ?.set(sourceTopic, (affinity.get(targetTopic)?.get(sourceTopic) ?? 0) + 1);
  }

  const totalAffinity = (slug: string): number =>
    [...(affinity.get(slug)?.values() ?? [])].reduce((total, count) => total + count, 0);
  const connected = slugs.filter((slug) => totalAffinity(slug) > 0);
  const isolated = slugs.filter((slug) => totalAffinity(slug) === 0);
  if (connected.length === 0) return isolated;

  let strongestPair: [string, string] | undefined;
  let strongestCount = -1;
  for (let leftIndex = 0; leftIndex < connected.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < connected.length; rightIndex += 1) {
      const pair: [string, string] = [connected[leftIndex]!, connected[rightIndex]!];
      const count = affinity.get(pair[0])?.get(pair[1]) ?? 0;
      const pairKey = pair.join('\0');
      const strongestKey = strongestPair?.join('\0') ?? '';
      if (
        count > strongestCount ||
        (count === strongestCount && pairKey.localeCompare(strongestKey) < 0)
      ) {
        strongestPair = pair;
        strongestCount = count;
      }
    }
  }

  if (!strongestPair) return [...connected, ...isolated];
  const ordered = [...strongestPair];
  const placed = new Set(ordered);
  while (placed.size < connected.length) {
    const candidate = connected
      .filter((slug) => !placed.has(slug))
      .map((slug) => ({
        slug,
        affinity: ordered.reduce(
          (total, placedSlug) => total + (affinity.get(slug)?.get(placedSlug) ?? 0),
          0,
        ),
      }))
      .sort(
        (left, right) => right.affinity - left.affinity || left.slug.localeCompare(right.slug),
      )[0]!;
    ordered.push(candidate.slug);
    placed.add(candidate.slug);
  }

  return [...ordered, ...isolated];
}

function constellationRadius(orderedGroups: TopicGroup[]): number {
  if (orderedGroups.length === 0) return 185;
  let radius = Math.max(
    185,
    ...orderedGroups.map((group) => NODE_RADIUS.home + group.discRadius + 48),
  );
  if (orderedGroups.length < 2) return radius;

  const chordFactor = 2 * Math.sin(Math.PI / orderedGroups.length);
  for (let index = 0; index < orderedGroups.length; index += 1) {
    const current = orderedGroups[index]!;
    const next = orderedGroups[(index + 1) % orderedGroups.length]!;
    radius = Math.max(radius, (current.discRadius + next.discRadius + 48) / chordFactor);
  }
  return radius;
}

function placeTopicChildren(
  group: TopicGroup,
  center: Point,
  topicAngle: number,
  points: Map<string, Point>,
): void {
  for (let ringStart = 0; ringStart < group.children.length; ringStart += CHILDREN_PER_RING) {
    const ringIndex = ringStart / CHILDREN_PER_RING;
    const ring = group.children.slice(ringStart, ringStart + CHILDREN_PER_RING);
    const ringRadius = 64 + 44 * ringIndex;
    for (let memberIndex = 0; memberIndex < ring.length; memberIndex += 1) {
      const childAngle =
        ring.length === 1
          ? topicAngle
          : topicAngle - FAN_SPAN / 2 + (memberIndex * FAN_SPAN) / (ring.length - 1);
      points.set(ring[memberIndex]!.id, {
        x: center.x + Math.cos(childAngle) * ringRadius,
        y: center.y + Math.sin(childAngle) * ringRadius,
      });
    }
  }
}

function positionedBounds(nodes: PositionedWorkspaceGraphNode[]): {
  bottom: number;
  left: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const radius = nodeRadius(node);
    minX = Math.min(minX, node.x - Math.max(radius, LABEL_HALF_WIDTH));
    maxX = Math.max(maxX, node.x + Math.max(radius, LABEL_HALF_WIDTH));
    minY = Math.min(minY, node.y - radius);
    maxY = Math.max(maxY, node.y + Math.max(radius, LABEL_HEIGHT));
  }
  return { bottom: maxY, left: minX, maxX, maxY, minX, minY };
}

export function wikilinkDegrees(graph: WorkspaceGraph): Map<string, number> {
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (edge.kind !== 'links') continue;
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

export function neighborIds(graph: WorkspaceGraph, id: string): Set<string> {
  const neighbors = new Set([id]);
  for (const edge of graph.edges) {
    if (edge.source === id) neighbors.add(edge.target);
    if (edge.target === id) neighbors.add(edge.source);
  }
  return neighbors;
}

export function layoutWorkspaceGraph(graph: WorkspaceGraph): WorkspaceGraphLayout {
  if (graph.nodes.length === 0) return { nodes: [], width: 80, height: 80 };

  const groups = topicGroups(graph.nodes);
  const orderedSlugs = orderedTopicSlugs(graph, groups);
  const groupBySlug = new Map(groups.map((group) => [group.slug, group]));
  const orderedGroups = orderedSlugs.map((slug) => groupBySlug.get(slug)!);
  const ringRadius = constellationRadius(orderedGroups);
  const points = new Map<string, Point>();

  const home = graph.nodes.find((node) => node.kind === 'home');
  if (home) points.set(home.id, { x: 0, y: 0 });

  for (let index = 0; index < orderedGroups.length; index += 1) {
    const group = orderedGroups[index]!;
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / orderedGroups.length;
    const center = { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
    if (group.overview) points.set(group.overview.id, center);
    placeTopicChildren(group, center, angle, points);
  }

  const placed = graph.nodes
    .filter((node) => points.has(node.id))
    .map((node) => ({ ...node, ...points.get(node.id)! }));
  const placedBounds = placed.length
    ? positionedBounds(placed)
    : { bottom: 0, left: 0, maxX: 0, maxY: 0, minX: 0, minY: 0 };
  const unplaced = graph.nodes.filter((node) => !points.has(node.id));
  for (let index = 0; index < unplaced.length; index += 1) {
    const column = index % 10;
    const row = Math.floor(index / 10);
    points.set(unplaced[index]!.id, {
      x: placedBounds.left + LABEL_HALF_WIDTH + column * 82,
      y: placedBounds.bottom + 56 + row * 56,
    });
  }

  const rawNodes = graph.nodes.map((node) => ({ ...node, ...points.get(node.id)! }));
  const bounds = positionedBounds(rawNodes);
  const translateX = BOUNDS_PADDING - bounds.minX;
  const translateY = BOUNDS_PADDING - bounds.minY;
  return {
    nodes: rawNodes.map((node) => ({
      ...node,
      x: node.x + translateX,
      y: node.y + translateY,
    })),
    width: bounds.maxX - bounds.minX + BOUNDS_PADDING * 2,
    height: bounds.maxY - bounds.minY + BOUNDS_PADDING * 2,
  };
}
