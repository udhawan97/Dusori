import type { StorageAdapter } from '../adapters.js';
import { SourceManifestSchema } from '../schemas/workspace.js';
import { buildWorkspaceGraph, type WorkspaceGraph } from './workspace-graph.js';

export type WorkspaceHealthIssueKind =
  | 'invalid-source-manifest'
  | 'missing-source-manifest'
  | 'missing-source-file'
  | 'unresolved-link'
  | 'untracked-source-file';

export interface WorkspaceHealthIssue {
  kind: WorkspaceHealthIssueKind;
  message: string;
  path: string;
  target?: string;
  topicSlug?: string;
}

export interface WorkspaceHealth {
  checkedDocuments: number;
  graph: WorkspaceGraph;
  issues: WorkspaceHealthIssue[];
  status: 'healthy' | 'attention';
}

function topicSlug(path: string): string | undefined {
  return /^Topics\/([^/]+)\//u.exec(path)?.[1];
}

/** Inspects links and source manifests without repairing, quarantining, or changing workspace files. */
export async function inspectWorkspaceHealth(storage: StorageAdapter): Promise<WorkspaceHealth> {
  const entries = await storage.list('', true);
  const filePaths = new Set(
    entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  );
  const topicSlugs = new Set(
    entries.map((entry) => topicSlug(entry.path)).filter((slug): slug is string => Boolean(slug)),
  );
  const graph = await buildWorkspaceGraph(storage);
  const issues: WorkspaceHealthIssue[] = graph.unresolvedLinks.map((link) => ({
    kind: 'unresolved-link',
    message: `Wikilink target “${link.target}” could not be found.`,
    path: link.source,
    target: link.target,
    ...(topicSlug(link.source) ? { topicSlug: topicSlug(link.source) } : {}),
  }));

  for (const slug of [...topicSlugs].sort((left, right) => left.localeCompare(right))) {
    const root = `Topics/${slug}`;
    const manifestPath = `${root}/Sources/manifest.json`;
    const itemPrefix = `${root}/Sources/items/`;
    const itemPaths = [...filePaths].filter((path) => path.startsWith(itemPrefix));
    const snapshot = await storage.read(manifestPath);
    if (!snapshot) {
      issues.push({
        kind: 'missing-source-manifest',
        message: 'This topic is missing its source manifest.',
        path: manifestPath,
        topicSlug: slug,
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.content);
    } catch {
      parsed = null;
    }
    const manifest = SourceManifestSchema.safeParse(parsed);
    if (!manifest.success) {
      issues.push({
        kind: 'invalid-source-manifest',
        message: 'This source manifest is invalid. Dusori left it untouched.',
        path: manifestPath,
        topicSlug: slug,
      });
      continue;
    }

    const trackedPaths = new Set(
      manifest.data.sources
        .map((source) => source.path)
        .filter((path): path is string => Boolean(path)),
    );
    for (const source of manifest.data.sources) {
      if (!source.path || filePaths.has(source.path)) continue;
      issues.push({
        kind: 'missing-source-file',
        message: `The source “${source.title}” is tracked, but its file is missing.`,
        path: manifestPath,
        target: source.path.slice(source.path.lastIndexOf('/') + 1),
        topicSlug: slug,
      });
    }
    for (const path of itemPaths) {
      if (trackedPaths.has(path)) continue;
      issues.push({
        kind: 'untracked-source-file',
        message: 'This source file is not listed in the topic manifest.',
        path,
        topicSlug: slug,
      });
    }
  }

  issues.sort((left, right) =>
    `${left.kind}:${left.path}:${left.target ?? ''}`.localeCompare(
      `${right.kind}:${right.path}:${right.target ?? ''}`,
    ),
  );
  return {
    checkedDocuments: graph.nodes.length,
    graph,
    issues,
    status: issues.length === 0 ? 'healthy' : 'attention',
  };
}
