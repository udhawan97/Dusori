import type { StorageAdapter } from '../adapters.js';

export type WorkspaceGraphNodeKind =
  'home' | 'overview' | 'roadmap' | 'tutor' | 'note' | 'source' | 'update' | 'document';

export interface WorkspaceGraphNode {
  id: string;
  kind: WorkspaceGraphNodeKind;
  label: string;
  path: string;
  topicSlug?: string;
}

export interface WorkspaceGraphEdge {
  id: string;
  kind: 'contains' | 'links';
  source: string;
  target: string;
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

function nodeKind(path: string): WorkspaceGraphNodeKind {
  if (path === 'Home.md') return 'home';
  if (path.endsWith('/Overview.md')) return 'overview';
  if (path.endsWith('/roadmap.md')) return 'roadmap';
  if (path.endsWith('/TUTOR.md')) return 'tutor';
  if (path.includes('/Notes/')) return 'note';
  if (path.includes('/Sources/')) return 'source';
  if (path.includes('/Updates/')) return 'update';
  return 'document';
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

function resolveWikilink(
  source: WorkspaceGraphNode,
  rawTarget: string,
  nodesByPath: Map<string, WorkspaceGraphNode>,
): string | null {
  const target = rawTarget.split('|', 1)[0]!.split('#', 1)[0]!.trim();
  if (!target) return null;
  const targetWithExtension = /\.(?:md|txt)$/iu.test(target) ? target : `${target}.md`;
  const directory = source.path.includes('/')
    ? source.path.slice(0, source.path.lastIndexOf('/'))
    : '';
  const candidates = new Set<string>();

  candidates.add(targetWithExtension.replace(/^\//u, ''));
  const relative = normalizeRelativePath(directory, targetWithExtension);
  if (relative) candidates.add(relative);
  if (source.topicSlug) candidates.add(`Topics/${source.topicSlug}/${targetWithExtension}`);

  for (const candidate of candidates) {
    if (nodesByPath.has(candidate)) return candidate;
  }

  const targetBasename = target.slice(target.lastIndexOf('/') + 1);
  const wanted = withoutMarkdownExtension(targetBasename).toLocaleLowerCase();
  const basenameMatches = [...nodesByPath.keys()].filter((path) => {
    const basename = withoutMarkdownExtension(path.slice(path.lastIndexOf('/') + 1));
    return basename.toLocaleLowerCase() === wanted.toLocaleLowerCase();
  });
  return basenameMatches.length === 1 ? basenameMatches[0]! : null;
}

export async function buildWorkspaceGraph(storage: StorageAdapter): Promise<WorkspaceGraph> {
  const entries = await storage.list('', true);
  const paths = entries
    .filter((entry) => entry.kind === 'file' && /\.(?:md|txt)$/iu.test(entry.path))
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
  const contentByPath = new Map<string, string>();
  const nodes: WorkspaceGraphNode[] = [];

  for (const path of paths) {
    const content = (await storage.read(path))?.content ?? '';
    contentByPath.set(path, content);
    nodes.push({
      id: path,
      kind: nodeKind(path),
      label: documentLabel(path, content),
      path,
      ...(topicSlug(path) ? { topicSlug: topicSlug(path) } : {}),
    });
  }

  const nodesByPath = new Map(nodes.map((node) => [node.path, node]));
  const edges: WorkspaceGraphEdge[] = [];
  const unresolvedLinks: UnresolvedWorkspaceLink[] = [];
  const edgeIds = new Set<string>();
  const addEdge = (source: string, target: string, kind: WorkspaceGraphEdge['kind']): void => {
    const id = `${kind}:${source}->${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ id, kind, source, target });
  };

  for (const overview of nodes.filter((node) => node.kind === 'overview')) {
    for (const node of nodes) {
      if (node.id !== overview.id && node.topicSlug === overview.topicSlug) {
        addEdge(overview.id, node.id, 'contains');
      }
    }
  }

  for (const source of nodes) {
    const content = contentByPath.get(source.path) ?? '';
    for (const match of content.matchAll(/\[\[([^\]]+)\]\]/gu)) {
      const rawTarget = match[1]!.split('|', 1)[0]!.split('#', 1)[0]!.trim();
      const resolved = resolveWikilink(source, rawTarget, nodesByPath);
      if (resolved) addEdge(source.id, resolved, 'links');
      else if (rawTarget) unresolvedLinks.push({ source: source.id, target: rawTarget });
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
