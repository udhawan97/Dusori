import type { StorageAdapter } from '../adapters.js';
import { SourceManifestSchema } from '../schemas/workspace.js';

export type WorkspaceSearchResultKind =
  'note' | 'roadmap' | 'source' | 'update' | 'workspace' | 'document';

export interface WorkspaceSearchResult {
  kind: WorkspaceSearchResultKind;
  matchCount: number;
  path: string;
  snippet: string;
  title: string;
  topicSlug?: string;
}

export interface WorkspaceSearchOptions {
  limit?: number;
}

function normalized(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase();
}

function titleFor(path: string, content: string): string {
  const frontmatter = /^---\s*\n([\s\S]*?)\n---/u.exec(content)?.[1] ?? '';
  const frontmatterTitle = /^title:\s*["']?(.+?)["']?\s*$/imu.exec(frontmatter)?.[1]?.trim();
  const heading = /^#\s+(.+?)\s*$/mu.exec(content)?.[1]?.trim();
  const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.(?:md|txt)$/iu, '');
  return frontmatterTitle || heading || filename.replace(/[-_]+/gu, ' ');
}

function topicSlugFor(path: string): string | undefined {
  const match = /^Topics\/([^/]+)\//u.exec(path);
  return match?.[1];
}

function kindFor(path: string): WorkspaceSearchResultKind {
  if (path === 'home.md') return 'workspace';
  if (/\/Notes\//u.test(path)) return 'note';
  if (/\/Sources\/items\//u.test(path)) return 'source';
  if (/\/Updates\//u.test(path)) return 'update';
  if (/\/roadmap\.md$/u.test(path)) return 'roadmap';
  return 'document';
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += Math.max(needle.length, 1);
  }
  return count;
}

function snippetFor(content: string, firstTerm: string): string {
  const searchable = content
    .replace(/^---\s*\n[\s\S]*?\n---\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const matchAt = normalized(searchable).indexOf(firstTerm);
  const start = Math.max(0, matchAt - 56);
  const end = Math.min(searchable.length, matchAt + firstTerm.length + 112);
  return `${start > 0 ? '…' : ''}${searchable.slice(start, end).trim()}${end < searchable.length ? '…' : ''}`;
}

function isSearchable(path: string): boolean {
  return (
    /\.(?:md|txt)$/iu.test(path) && !path.startsWith('.dusori/') && !path.includes('/Conflicts/')
  );
}

/** Searches portable workspace prose in memory without creating an index or changing files. */
export async function searchWorkspace(
  storage: StorageAdapter,
  query: string,
  options: WorkspaceSearchOptions = {},
): Promise<WorkspaceSearchResult[]> {
  const terms = [...new Set(normalized(query).split(/\s+/u).filter(Boolean))];
  if (terms.length === 0) return [];
  const limit = Math.max(1, options.limit ?? 20);
  const entries = await storage.list('', true);
  const results: Array<WorkspaceSearchResult & { titleMatches: number }> = [];
  const sourceTitles = new Map<string, string>();

  for (const entry of entries) {
    if (entry.kind !== 'file' || !/\/Sources\/manifest\.json$/u.test(entry.path)) continue;
    const snapshot = await storage.read(entry.path);
    if (!snapshot) continue;
    try {
      const manifest = SourceManifestSchema.safeParse(JSON.parse(snapshot.content));
      if (manifest.success) {
        for (const source of manifest.data.sources) {
          if (source.path) sourceTitles.set(source.path, source.title);
        }
      }
    } catch {
      // Search is read-only: invalid machine files are left for the explicit repair path.
    }
  }

  for (const entry of entries) {
    if (entry.kind !== 'file' || !isSearchable(entry.path)) continue;
    const snapshot = await storage.read(entry.path);
    if (!snapshot) continue;
    const searchable = normalized(snapshot.content);
    if (!terms.every((term) => searchable.includes(term))) continue;
    const title = sourceTitles.get(entry.path) ?? titleFor(entry.path, snapshot.content);
    results.push({
      kind: kindFor(entry.path),
      matchCount: terms.reduce((sum, term) => sum + countOccurrences(searchable, term), 0),
      path: entry.path,
      snippet: snippetFor(snapshot.content, terms[0]!),
      title,
      titleMatches: terms.filter((term) => normalized(title).includes(term)).length,
      ...(topicSlugFor(entry.path) ? { topicSlug: topicSlugFor(entry.path) } : {}),
    });
  }

  return results
    .sort(
      (left, right) =>
        right.titleMatches - left.titleMatches ||
        right.matchCount - left.matchCount ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit)
    .map(({ kind, matchCount, path, snippet, title, topicSlug }) => ({
      kind,
      matchCount,
      path,
      snippet,
      title,
      ...(topicSlug ? { topicSlug } : {}),
    }));
}
