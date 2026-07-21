import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, type TopicState } from '../schemas/workspace.js';
import {
  normalizeWorkspacePath,
  proposedPath,
  topicRoot,
  updateLogPath,
} from '../workspace/paths.js';

export interface MarkdownConflict {
  currentContent: string;
  currentContentHash: string;
  currentPath: string;
  expectedContentHash: string;
  proposalContent: string;
  proposalPath: string;
  updatePath: string;
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
  const updatePath = await appendTopicUpdate(
    storage,
    topicSlug,
    `- Conflict detected in [[../../${relativePath.replace(/\.md$/u, '')}]]. External content stayed in place; Dusori wrote [[../../${proposalPath.slice(root.length + 1).replace(/\.md$/u, '')}|a proposed version]].`,
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
): Promise<TopicState> {
  const root = topicRoot(topicSlug);
  const path = normalizeWorkspacePath(`${root}/${relativePath}`);
  const statePath = `${root}/state.json`;
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  const written = await storage.write(path, nextContent, { expectedHash });
  const nextState = TopicStateSchema.parse({
    ...state,
    updatedAt: now.toISOString(),
    fileIndex: {
      ...state.fileIndex,
      [path]: { hash: written.hash, modifiedAt: written.modifiedAt },
    },
  });
  const stateFile = await storage.read(statePath);
  await storage.write(statePath, `${JSON.stringify(nextState, null, 2)}\n`, {
    expectedHash: stateFile?.hash,
  });
  await appendTopicUpdate(
    storage,
    topicSlug,
    updateLine ??
      `- Accepted an explicit update to [[../../${relativePath.replace(/\.md$/u, '')}]].`,
    now,
  );
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
