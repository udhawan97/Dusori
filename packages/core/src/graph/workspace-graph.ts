import type { StorageAdapter } from '../adapters.js';
import { ResearchFileSchema } from '../research/research-file.js';
import type { ResearchThreadEvent } from '../research/thread-events.js';
import { SourceManifestSchema } from '../schemas/workspace.js';
import { extractTags, normalizeTags } from '../tags/tags.js';
import { extractRecordRelations, type WorkspaceRelationKind } from './record-relations.js';

export type WorkspaceGraphNodeKind =
  | 'home'
  | 'overview'
  | 'roadmap'
  | 'tutor'
  | 'note'
  | 'annotation'
  | 'source'
  | 'update'
  | 'event'
  | 'document';

export interface WorkspaceGraphNode {
  id: string;
  kind: WorkspaceGraphNodeKind;
  label: string;
  path: string;
  tags?: string[];
  topicSlug?: string;
  eventId?: string;
  threadId?: string;
  eventType?: ResearchThreadEvent['type'];
}

export interface WorkspaceGraphEdge {
  id: string;
  kind: 'contains' | 'links' | 'relation' | 'activity';
  source: string;
  target: string;
  explanation: string;
  relation?: WorkspaceRelationKind;
}

export interface UnresolvedWorkspaceLink {
  source: string;
  target: string;
}

export interface WorkspaceGraph {
  edges: WorkspaceGraphEdge[];
  nodes: WorkspaceGraphNode[];
  unresolvedLinks: UnresolvedWorkspaceLink[];
}

export function backlinksFor(graph: WorkspaceGraph, targetPath: string): WorkspaceGraphNode[] {
  const linkedSourceIds = new Set(
    graph.edges
      .filter((edge) => edge.kind === 'links' && edge.target === targetPath)
      .map((edge) => edge.source),
  );
  return graph.nodes
    .filter((node) => linkedSourceIds.has(node.id))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function topicSlug(path: string): string | undefined {
  const match = /^Topics\/([^/]+)\//u.exec(path);
  return match?.[1];
}

function nodeKind(path: string, content: string): WorkspaceGraphNodeKind {
  if (path === 'Home.md') return 'home';
  if (path.endsWith('/Overview.md')) return 'overview';
  if (path.endsWith('/roadmap.md')) return 'roadmap';
  if (path.endsWith('/TUTOR.md')) return 'tutor';
  if (path.includes('/Notes/')) {
    const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1] ?? '';
    return /^annotation:\s*source-(?:note|quote)\s*$/imu.test(frontmatter) ? 'annotation' : 'note';
  }
  if (path.includes('/Sources/')) return 'source';
  if (path.includes('/Updates/')) return 'update';
  return 'document';
}

function eventLabel(event: ResearchThreadEvent): string {
  if (event.type === 'question-created') return 'Question started';
  if (event.type === 'follow-up-created') return 'Follow-up started';
  if (event.type === 'research-completed') return 'Lookup completed';
  if (event.type === 'source-saved') return 'Source saved';
  if (event.type === 'source-read') return 'Evidence read';
  if (event.type === 'quote-added') return 'Quote saved';
  if (event.type === 'note-added') return 'Source note saved';
  if (event.type === 'synthesis-written') return 'Answer written';
  if (event.type === 'synthesis-proposed') return 'Answer proposed';
  if (event.type === 'export-created') return 'Export created';
  return 'Question redacted';
}

function eventTargets(event: ResearchThreadEvent): string[] {
  if (event.type === 'source-saved') return event.sourcePath ? [event.sourcePath] : [];
  if (event.type === 'source-read') return [event.sourcePath];
  if (event.type === 'quote-added' || event.type === 'note-added') {
    return [event.notePath, event.sourcePath];
  }
  if (event.type === 'synthesis-written' || event.type === 'synthesis-proposed') {
    return event.artifactPath ? [event.artifactPath] : [];
  }
  return [];
}

function documentLabel(path: string, content: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1] ?? '';
  const title = /^title:\s*(.+?)\s*$/imu.exec(frontmatter)?.[1];
  if (title) return title.replace(/^['"]|['"]$/gu, '');
  const heading = /^#\s+(.+?)\s*$/mu.exec(content)?.[1];
  if (heading) return heading;
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.(?:md|txt)$/iu, '');
  return filename.replaceAll('-', ' ');
}

function normalizeRelativePath(fromDirectory: string, target: string): string | null {
  const segments = target.startsWith('/') ? [] : fromDirectory.split('/').filter(Boolean);
  for (const segment of target.replace(/^\//u, '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.length) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.md$/iu, '');
}

/**
 * Resolves one Obsidian wikilink to a workspace path, or null when nothing — or more than one
 * document — answers to it. It needs the workspace's paths and nothing else, so a reader can
 * follow a link without building the graph, which would read every file to do it.
 */
export function resolveWikilink(
  fromPath: string,
  rawTarget: string,
  paths: ReadonlySet<string>,
): string | null {
  const target = rawTarget.split('|', 1)[0]!.split('#', 1)[0]!.trim();
  if (!target) return null;
  const targetWithExtension = /\.(?:md|txt)$/iu.test(target) ? target : `${target}.md`;
  const directory = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const candidates = new Set<string>();

  candidates.add(targetWithExtension.replace(/^\//u, ''));
  const relative = normalizeRelativePath(directory, targetWithExtension);
  if (relative) candidates.add(relative);
  const slug = topicSlug(fromPath);
  if (slug) candidates.add(`Topics/${slug}/${targetWithExtension}`);

  for (const candidate of candidates) {
    if (paths.has(candidate)) return candidate;
  }

  const targetBasename = target.slice(target.lastIndexOf('/') + 1);
  const wanted = withoutMarkdownExtension(targetBasename).toLocaleLowerCase();
  const basenameMatches = [...paths].filter((path) => {
    const basename = withoutMarkdownExtension(path.slice(path.lastIndexOf('/') + 1));
    return basename.toLocaleLowerCase() === wanted.toLocaleLowerCase();
  });
  return basenameMatches.length === 1 ? basenameMatches[0]! : null;
}

export async function buildWorkspaceGraph(storage: StorageAdapter): Promise<WorkspaceGraph> {
  const entries = await storage.list('', true);
  const removedSourcePaths = new Set<string>();
  const sourceTitlesByPath = new Map<string, string>();
  const sourceTagsByPath = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\/Sources\/manifest\.json$/u.test(entry.path)) continue;
    const snapshot = await storage.read(entry.path);
    if (!snapshot) continue;
    try {
      const manifest = SourceManifestSchema.parse(JSON.parse(snapshot.content));
      for (const source of manifest.sources) {
        if (source.path) {
          sourceTitlesByPath.set(source.path, source.title);
          if (source.tags?.length) sourceTagsByPath.set(source.path, source.tags);
        }
      }
      for (const removed of manifest.removedSources ?? []) {
        if (removed.record.path) removedSourcePaths.add(removed.record.path);
      }
    } catch {
      // Workspace health reports an invalid manifest. The graph must not guess at tombstones in it.
    }
  }
  const allDocumentPaths = entries
    .filter((entry) => entry.kind === 'file' && /\.(?:md|txt)$/iu.test(entry.path))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
  const paths = allDocumentPaths.filter((path) => !removedSourcePaths.has(path));
  const contentByPath = new Map<string, string>();
  const nodes: WorkspaceGraphNode[] = [];

  for (const path of paths) {
    const content = (await storage.read(path))?.content ?? '';
    contentByPath.set(path, content);
    const tags = normalizeTags([...(sourceTagsByPath.get(path) ?? []), ...extractTags(content)]);
    nodes.push({
      id: path,
      kind: nodeKind(path, content),
      label: sourceTitlesByPath.get(path) ?? documentLabel(path, content),
      path,
      ...(tags.length ? { tags } : {}),
      ...(topicSlug(path) ? { topicSlug: topicSlug(path) } : {}),
    });
  }

  const eventRecords: Array<{
    event: ResearchThreadEvent;
    eventNodeId: string;
  }> = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\/research\.json$/u.test(entry.path)) continue;
    const snapshot = await storage.read(entry.path);
    if (!snapshot) continue;
    try {
      const research = ResearchFileSchema.parse(JSON.parse(snapshot.content));
      const tagsByThread = new Map(
        (research.threads ?? []).map((thread) => [thread.threadId, thread.tags ?? []]),
      );
      for (const event of research.events ?? []) {
        const eventNodeId = `research-event:${event.eventId}`;
        const tags = tagsByThread.get(event.threadId) ?? [];
        nodes.push({
          eventId: event.eventId,
          eventType: event.type,
          id: eventNodeId,
          kind: 'event',
          label: eventLabel(event),
          path: entry.path,
          ...(tags.length ? { tags } : {}),
          threadId: event.threadId,
          topicSlug: research.topicSlug,
        });
        eventRecords.push({ event, eventNodeId });
      }
    } catch {
      // Workspace health and the Research Desk own malformed-ledger recovery. The map stays inert.
    }
  }

  // Tombstoned source files remain on disk so the user can restore them. Resolve links against
  // that complete set, then suppress edges to removed sources. Otherwise a deliberate removal
  // would be misreported as a broken wikilink even though the retained target still exists.
  const resolvablePathSet = new Set(allDocumentPaths);
  const edges: WorkspaceGraphEdge[] = [];
  const unresolvedLinks: UnresolvedWorkspaceLink[] = [];
  const edgeIds = new Set<string>();
  const addEdge = (
    source: string,
    target: string,
    kind: WorkspaceGraphEdge['kind'],
    explanation: string,
    relation?: WorkspaceRelationKind,
  ): void => {
    const id = `${kind}:${source}->${target}${relation ? `:${relation}` : ''}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ explanation, id, kind, ...(relation ? { relation } : {}), source, target });
  };

  for (const overview of nodes.filter((node) => node.kind === 'overview')) {
    for (const node of nodes) {
      if (node.id !== overview.id && node.topicSlug === overview.topicSlug) {
        addEdge(
          overview.id,
          node.id,
          'contains',
          `Topic overview contains the stored ${node.kind}: ${node.label}.`,
        );
      }
    }
  }

  for (const source of nodes) {
    const content = contentByPath.get(source.path) ?? '';
    for (const match of content.matchAll(/\[\[([^\]]+)\]\]/gu)) {
      const rawTarget = match[1]!.split('|', 1)[0]!.split('#', 1)[0]!.trim();
      const resolved = resolveWikilink(source.path, rawTarget, resolvablePathSet);
      if (resolved && !removedSourcePaths.has(resolved)) {
        addEdge(
          source.id,
          resolved,
          'links',
          `Stored wikilink in ${source.label} points to ${
            nodes.find((node) => node.id === resolved)?.label ?? resolved
          }.`,
        );
      } else if (!resolved && rawTarget)
        unresolvedLinks.push({ source: source.id, target: rawTarget });
    }
    for (const relation of extractRecordRelations(content)) {
      const resolved = resolveWikilink(source.path, relation.target, resolvablePathSet);
      if (resolved && !removedSourcePaths.has(resolved)) {
        addEdge(
          source.id,
          resolved,
          'relation',
          `Learner-authored ${relation.relation} relation stored in ${source.label}.`,
          relation.relation,
        );
      } else if (!resolved) {
        unresolvedLinks.push({ source: source.id, target: relation.target });
      }
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const { event, eventNodeId } of eventRecords) {
    for (const target of eventTargets(event)) {
      if (!nodeIds.has(target) || removedSourcePaths.has(target)) continue;
      addEdge(
        eventNodeId,
        target,
        'activity',
        `${eventLabel(event)}: typed activity points to the stored artifact ${
          nodes.find((node) => node.id === target)?.label ?? target
        }.`,
      );
    }
  }

  return {
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    nodes,
    unresolvedLinks: unresolvedLinks.sort((left, right) =>
      `${left.source}:${left.target}`.localeCompare(`${right.source}:${right.target}`),
    ),
  };
}
