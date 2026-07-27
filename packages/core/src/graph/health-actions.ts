import type { StorageAdapter } from '../adapters.js';
import { createNote, type CreatedNote } from '../notes/edit.js';
import { normalizeWorkspacePath, topicRoot } from '../workspace/paths.js';
import type { WorkspaceHealthIssue } from './workspace-health.js';

/**
 * The one repair that stays inside the storage rules: creating a file that does not exist yet.
 * New files may be created automatically; existing Markdown may not be rewritten without an
 * explicit acceptance, so nothing here touches a document the learner already wrote.
 */
interface ResolvedTarget {
  path: string;
  title: string;
}

function resolveTarget(issue: WorkspaceHealthIssue): ResolvedTarget | null {
  if (issue.kind !== 'unresolved-link' || !issue.topicSlug || !issue.target) return null;
  const target = issue.target.trim();
  if (!target || target.startsWith('/')) return null;

  const root = topicRoot(issue.topicSlug);
  const withExtension = /\.md$/iu.test(target) ? target : `${target}.md`;
  // A bare name belongs with the notes; a path is taken as written inside the topic.
  const relative = withExtension.includes('/') ? withExtension : `Notes/${withExtension}`;

  let path: string;
  try {
    path = normalizeWorkspacePath(`${root}/${relative}`);
  } catch {
    return null;
  }
  if (!path.startsWith(`${root}/`) || !path.endsWith('.md')) return null;

  const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, '');
  return { path, title: basename };
}

/** Whether this finding can be answered by creating one new file. */
export function isCreatableLinkTarget(issue: WorkspaceHealthIssue): boolean {
  return resolveTarget(issue) !== null;
}

/**
 * Creates the document an unresolved wikilink already names, at the exact name the link uses so
 * the link resolves afterwards. Goes through the ordinary note path, so the file is tracked in
 * `state.json` and the action is appended to the dated update log.
 */
export async function createMissingLinkTarget(
  storage: StorageAdapter,
  issue: WorkspaceHealthIssue,
  now = new Date(),
): Promise<CreatedNote> {
  if (issue.kind !== 'unresolved-link') {
    throw new Error('Only an unresolved wikilink can be answered by creating a file.');
  }
  const resolved = resolveTarget(issue);
  if (!resolved) throw new Error('That wikilink target is not inside its topic.');

  const content =
    `---\ntitle: ${JSON.stringify(resolved.title)}\ntopic: ${issue.topicSlug}\n` +
    `created: ${now.toISOString().slice(0, 10)}\nprovenance: link-target\n---\n\n` +
    `# ${resolved.title}\n\n` +
    `Created because [[${issue.path.replace(/\.md$/u, '')}]] links here and the page did not ` +
    `exist yet. The link came from \`${issue.path}\`.\n`;

  return createNote(storage, issue.topicSlug!, resolved.title, now, {
    content,
    relativePath: resolved.path.slice(topicRoot(issue.topicSlug!).length + 1),
  });
}
