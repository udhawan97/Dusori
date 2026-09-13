import type { StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { WorkspaceSchema, type Workspace } from '../schemas/workspace.js';
import { writeWorkspaceTopics } from './create.js';
import { topicRoot } from './paths.js';

/**
 * Permanently removes a topic: erases its file tree and drops it from the workspace index and
 * Home.md. Irreversible — the UI gates this behind a typed confirmation. Archived topics are
 * deleted the same way; the shelf flag only controls visibility.
 */
export async function deleteTopic(
  storage: StorageAdapter,
  slug: string,
  now = new Date(),
): Promise<Workspace> {
  const workspace = await readMachineFile(storage, 'dusori.json', WorkspaceSchema, now);
  if (!workspace.topics.some((topic) => topic.slug === slug)) {
    throw new Error(`There is no topic named ${slug} to delete.`);
  }
  // topicRoot slugifies, so a traversal attempt resolves to an ordinary topic path or to nothing.
  await storage.remove(topicRoot(slug), true);
  const nextTopics = workspace.topics.filter((topic) => topic.slug !== slug);
  const { workspace: nextWorkspace } = await writeWorkspaceTopics(
    storage,
    workspace,
    nextTopics,
    now,
  );
  return nextWorkspace;
}

/**
 * Shelves or un-shelves a topic without touching its files. Archived topics keep every note and
 * source but drop out of the active rail and Home.md, so a user can try topics freely and hide the
 * ones they are done with.
 */
export async function setTopicArchived(
  storage: StorageAdapter,
  slug: string,
  archived: boolean,
  now = new Date(),
): Promise<Workspace> {
  const workspace = await readMachineFile(storage, 'dusori.json', WorkspaceSchema, now);
  if (!workspace.topics.some((topic) => topic.slug === slug)) {
    throw new Error(`There is no topic named ${slug} to archive.`);
  }
  const nextTopics = workspace.topics.map((topic) =>
    topic.slug === slug ? { ...topic, archived } : topic,
  );
  const { workspace: nextWorkspace } = await writeWorkspaceTopics(
    storage,
    workspace,
    nextTopics,
    now,
  );
  return nextWorkspace;
}
