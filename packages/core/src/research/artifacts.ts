import type { StorageAdapter } from '../adapters.js';
import {
  acceptMarkdownUpdate,
  appendTopicUpdate,
  proposeMarkdownUpdate,
  type MarkdownConflict,
} from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema } from '../schemas/workspace.js';
import { readSourceManifest } from '../sources/import.js';
import { proposedPath, topicRoot } from '../workspace/paths.js';
import { renderLearnPage } from './learn-page.js';
import {
  buildTopicSynthesis,
  renderSynthesisMarkdown,
  type RenderSynthesisOptions,
  type TopicSynthesis,
} from './synthesis.js';

export const synthesisFileName = 'Synthesis.md';
export const learnPageRelativePath = 'Learning/learn.html';

export type WriteSynthesisResult =
  | { status: 'written'; path: string; synthesis: TopicSynthesis }
  | { status: 'conflict'; conflict: MarkdownConflict; synthesis: TopicSynthesis };

async function trackFile(
  storage: StorageAdapter,
  topicSlug: string,
  path: string,
  hash: string,
  modifiedAt: number,
  now: Date,
): Promise<void> {
  const statePath = `${topicRoot(topicSlug)}/state.json`;
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  const next = TopicStateSchema.parse({
    ...state,
    fileIndex: { ...state.fileIndex, [path]: { hash, modifiedAt } },
    updatedAt: now.toISOString(),
  });
  const snapshot = await storage.read(statePath);
  await storage.write(statePath, `${JSON.stringify(next, null, 2)}\n`, {
    expectedHash: snapshot?.hash,
  });
}

/**
 * Writes the topic's synthesis. A first write creates the file, which the storage rules allow;
 * a regeneration over a document the learner has since edited never overwrites it — it becomes
 * a sibling proposal with the usual diff, exactly like a roadmap conflict.
 */
export async function writeTopicSynthesis(
  storage: StorageAdapter,
  topicSlug: string,
  topicTitle: string,
  now = new Date(),
  options: RenderSynthesisOptions = {},
): Promise<WriteSynthesisResult> {
  const root = topicRoot(topicSlug);
  const path = `${root}/${synthesisFileName}`;
  const manifest = await readSourceManifest(storage, topicSlug, now);
  const synthesis = buildTopicSynthesis({ now, sources: manifest.sources, topicTitle });
  const content = renderSynthesisMarkdown(synthesis, options);

  const existing = await storage.read(path);
  if (!existing) {
    const written = await storage.write(path, content, { expectedHash: null });
    await trackFile(storage, topicSlug, path, written.hash, written.modifiedAt, now);
    await appendTopicUpdate(
      storage,
      topicSlug,
      `- Wrote [[../../../Synthesis|the topic synthesis]] from ${synthesis.readCount} read ${
        synthesis.readCount === 1 ? 'source' : 'sources'
      }.`,
      now,
    );
    return { path, status: 'written', synthesis };
  }

  const proposal = await proposeMarkdownUpdate(storage, topicSlug, synthesisFileName, content, now);
  if ('status' in proposal && proposal.status === 'ready') {
    await acceptMarkdownUpdate(
      storage,
      topicSlug,
      synthesisFileName,
      content,
      proposal.currentHash,
      now,
      `- Rebuilt [[../../../Synthesis|the topic synthesis]] from ${synthesis.claimCount} quoted passages.`,
    );
    return { path, status: 'written', synthesis };
  }
  return { conflict: proposal as MarkdownConflict, status: 'conflict', synthesis };
}

export function learnPagePath(topicSlug: string): string {
  return `${topicRoot(topicSlug)}/${learnPageRelativePath}`;
}

/** The stored learning page, or null when this topic has never built one. */
export async function readLearnPage(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<string | null> {
  const file = await storage.read(learnPagePath(topicSlug));
  return file?.content ?? null;
}

export type WriteLearnPageResult =
  | { status: 'written'; path: string; synthesis: TopicSynthesis }
  | { status: 'proposed'; path: string; proposalPath: string; synthesis: TopicSynthesis };

/**
 * Writes the generated learning page. The file is machine-owned, but an external edit is still
 * never destroyed: a changed file keeps its content and the new page lands beside it.
 */
export async function writeLearnPage(
  storage: StorageAdapter,
  topicSlug: string,
  topicTitle: string,
  now = new Date(),
): Promise<WriteLearnPageResult> {
  const root = topicRoot(topicSlug);
  const path = `${root}/${learnPageRelativePath}`;
  const manifest = await readSourceManifest(storage, topicSlug, now);
  const synthesis = buildTopicSynthesis({ now, sources: manifest.sources, topicTitle });
  const html = renderLearnPage(synthesis);

  await storage.ensureDirectory(`${root}/Learning`);
  const existing = await storage.read(path);
  const state = await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const tracked = state.fileIndex[path];

  if (existing && tracked && existing.hash !== tracked.hash) {
    const proposal = proposedPath(path, now);
    await storage.write(proposal, html, { expectedHash: null });
    await appendTopicUpdate(
      storage,
      topicSlug,
      `- The learning page changed outside Dusori, so the rebuilt page was written to \`${proposal}\` instead.`,
      now,
    );
    return { path, proposalPath: proposal, status: 'proposed', synthesis };
  }

  const written = await storage.write(path, html, { expectedHash: existing?.hash ?? null });
  await trackFile(storage, topicSlug, path, written.hash, written.modifiedAt, now);
  await appendTopicUpdate(
    storage,
    topicSlug,
    `- Built the learning page from ${synthesis.claimCount} quoted ${
      synthesis.claimCount === 1 ? 'passage' : 'passages'
    }.`,
    now,
  );
  return { path, status: 'written', synthesis };
}
