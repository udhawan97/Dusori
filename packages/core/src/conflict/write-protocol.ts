import { StorageConflictError, type FileSnapshot, type StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, type TopicState } from '../schemas/workspace.js';
import {
  normalizeWorkspacePath,
  proposedPath,
  topicRoot,
  updateLogPath,
} from '../workspace/paths.js';
import { recordPendingProposal, resolvePendingProposal } from './proposal-ledger.js';

export interface MarkdownConflict {
  currentContent: string;
  currentContentHash: string;
  currentPath: string;
  expectedContentHash: string;
  proposalContent: string;
  proposalPath: string;
  updatePath: string;
}

/** Apply only this file's version to the exact state snapshot protected by the write guard. */
export async function recordTopicFileVersion(
  storage: StorageAdapter,
  topicSlug: string,
  file: Pick<FileSnapshot, 'path' | 'hash' | 'modifiedAt'>,
  now: Date,
): Promise<TopicState> {
  const statePath = `${topicRoot(topicSlug)}/state.json`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(statePath);
    if (!snapshot) throw new Error(`Required machine file is missing: ${statePath}`);
    const state = TopicStateSchema.parse(JSON.parse(snapshot.content));
    const current = await storage.read(file.path);
    // A later save may have completed while this one waited or retried. Do not roll its
    // index back, and do not adopt external bytes as though Dusori had written them.
    // Reading the document after the state snapshot means a later cooperating state commit
    // either is already reflected here or makes the guarded write conflict and retry.
    if (current?.hash !== file.hash) return state;
    const next = TopicStateSchema.parse({
      ...state,
      updatedAt: now.toISOString(),
      fileIndex: {
        ...state.fileIndex,
        [file.path]: {
          ...state.fileIndex[file.path],
          hash: file.hash,
          modifiedAt: file.modifiedAt,
        },
      },
    });
    try {
      await storage.write(statePath, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot.hash,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
    }
  }
  throw new Error(
    'Topic state changed repeatedly. The document was saved; retry its state update.',
  );
}

export async function appendTopicUpdate(
  storage: StorageAdapter,
  topicSlug: string,
  line: string,
  now: Date,
): Promise<string> {
  const path = updateLogPath(topicSlug, now);
  await storage.ensureDirectory(path.slice(0, path.lastIndexOf('/')));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await storage.read(path);
    const base = current?.content ?? `# ${now.toISOString().slice(0, 10)}\n\n`;
    try {
      await storage.write(path, `${base.trimEnd()}\n\n${line}\n`, {
        expectedHash: current?.hash ?? null,
      });
      return path;
    } catch (error) {
      if (!(error instanceof StorageConflictError) || attempt === 1) throw error;
    }
  }
  return path;
}

export async function proposeMarkdownUpdate(
  storage: StorageAdapter,
  topicSlug: string,
  relativePath: string,
  nextContent: string,
  now = new Date(),
): Promise<MarkdownConflict | { status: 'ready'; currentHash: string; path: string }> {
  const root = topicRoot(topicSlug);
  const normalized = normalizeWorkspacePath(`${root}/${relativePath}`);
  if (!normalized.startsWith(`${root}/`) || !normalized.endsWith('.md')) {
    throw new Error('Only markdown inside the selected topic can be proposed.');
  }

  const statePath = `${root}/state.json`;
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  const current = await storage.read(normalized);
  const expected = state.fileIndex[normalized];
  if (!current || !expected) throw new Error(`Tracked markdown file is missing: ${normalized}`);

  if (current.hash === expected.hash) {
    return { status: 'ready', currentHash: current.hash, path: normalized };
  }

  const proposalPath = proposedPath(normalized, now);
  await storage.write(proposalPath, nextContent, { expectedHash: null });
  await recordPendingProposal(storage, {
    createdAt: now.toISOString(),
    currentContentHash: current.hash,
    currentPath: normalized,
    expectedContentHash: expected.hash,
    proposalPath,
    topicSlug,
  });
  const updatePath = await appendTopicUpdate(
    storage,
    topicSlug,
    `- Conflict detected in [[../../../${relativePath.replace(/\.md$/u, '')}]]. External content stayed in place; Dusori wrote [[../../../${proposalPath.slice(root.length + 1).replace(/\.md$/u, '')}|a proposed version]].`,
    now,
  );
  return {
    currentContent: current.content,
    currentContentHash: current.hash,
    currentPath: normalized,
    expectedContentHash: expected.hash,
    proposalContent: nextContent,
    proposalPath,
    updatePath,
  };
}

export async function acceptMarkdownUpdate(
  storage: StorageAdapter,
  topicSlug: string,
  relativePath: string,
  nextContent: string,
  expectedHash: string,
  now = new Date(),
  updateLine?: string,
  proposalPath?: string,
): Promise<TopicState> {
  const root = topicRoot(topicSlug);
  const path = normalizeWorkspacePath(`${root}/${relativePath}`);
  const statePath = `${root}/state.json`;
  await readMachineFile(storage, statePath, TopicStateSchema, now);
  const written = await storage.write(path, nextContent, { expectedHash });
  const nextState = await recordTopicFileVersion(storage, topicSlug, written, now);
  await appendTopicUpdate(
    storage,
    topicSlug,
    updateLine ??
      `- Accepted an explicit update to [[../../../${relativePath.replace(/\.md$/u, '')}]].`,
    now,
  );
  if (proposalPath) {
    await resolvePendingProposal(storage, topicSlug, proposalPath, 'accepted', now);
  }
  return nextState;
}

export function lineDiff(
  before: string,
  after: string,
): Array<{ kind: 'same' | 'add' | 'remove'; line: string }> {
  const left = before.split('\n');
  const right = after.split('\n');
  const result: Array<{ kind: 'same' | 'add' | 'remove'; line: string }> = [];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) result.push({ kind: 'same', line: left[index] ?? '' });
    else {
      const leftLine = left[index];
      const rightLine = right[index];
      if (leftLine !== undefined) result.push({ kind: 'remove', line: leftLine });
      if (rightLine !== undefined) result.push({ kind: 'add', line: rightLine });
    }
  }
  return result;
}
