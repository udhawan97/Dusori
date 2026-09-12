import {
  detachResearchSynthesis,
  readResearchFile,
  readSourcesIntoClaims,
  recordResearchRun,
  recordResearchSynthesisOutcome,
  recordResearchThreadEvent,
  writeTopicSynthesis,
  type ResearchRunRecord,
  type ResearchSequenceResult,
  type StorageAdapter,
} from '@dusori/core';

export type PendingResearchReceipt = NonNullable<ResearchSequenceResult['receiptFailure']>;

// Keep the exact failed receipt across view unmounts without writing into an unavailable workspace.
const pendingReceipts = new WeakMap<StorageAdapter, Map<string, PendingResearchReceipt>>();

export function hasPendingResearchReceipts(storage: StorageAdapter): boolean {
  return Boolean(pendingReceipts.get(storage)?.size);
}

export function pendingResearchReceipt(
  storage: StorageAdapter,
  topicSlug: string,
): PendingResearchReceipt | undefined {
  return pendingReceipts.get(storage)?.get(topicSlug);
}

export function retainResearchReceipt(
  storage: StorageAdapter,
  topicSlug: string,
  receipt: PendingResearchReceipt,
): void {
  let topics = pendingReceipts.get(storage);
  if (!topics) {
    topics = new Map();
    pendingReceipts.set(storage, topics);
  }
  topics.set(topicSlug, receipt);
}

export async function retryResearchReceipt(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<ResearchRunRecord | undefined> {
  const pending = pendingResearchReceipt(storage, topicSlug);
  if (!pending) return;
  // A previous response may have failed after persistence. Avoid duplicating its exact run.
  const current = await readResearchFile(storage, topicSlug);
  const existing = current?.runs?.find(
    (run) =>
      run.at === pending.at &&
      run.searchText === pending.receipt.searchText &&
      run.questionText === pending.receipt.questionText,
  );
  const persisted =
    existing ??
    (
      await recordResearchRun(storage, topicSlug, pending.receipt, new Date(pending.at))
    ).runs?.findLast((run) => run.at === pending.at);
  if (!persisted) throw new Error('The research receipt is still missing. Retry saving it.');
  pendingReceipts.get(storage)?.delete(topicSlug);
  return persisted;
}

/** Local text only: no provider or AI capability is accepted by this continuation. */
export async function buildLocalResearch(
  storage: StorageAdapter,
  topicSlug: string,
  topicTitle: string,
  options: { run?: ResearchRunRecord; now?: Date } = {},
): Promise<{ message: string; path?: string }> {
  if (pendingResearchReceipt(storage, topicSlug))
    throw new Error(
      'Save the pending research receipt in Research before building from local text.',
    );
  const now = options.now ?? new Date();
  const run = options.run;
  const read = await readSourcesIntoClaims(storage, topicSlug, now);
  const claimCount = read.read.reduce((total, source) => total + source.claims, 0);
  const remaining = read.unreadable.length
    ? ` ${read.unreadable.length} sources still need readable, quotable text.`
    : '';
  if (!claimCount)
    return {
      message: `No brief was built: the saved text has no quotable passages.${remaining} No original pages were fetched.`,
    };
  let warning = '';
  if (run?.threadId) {
    try {
      for (const source of read.read)
        await recordResearchThreadEvent(
          storage,
          topicSlug,
          {
            claimCount: source.claims,
            sourceContentSha256: source.sourceContentSha256,
            sourcePath: source.path,
            sourceSha256: source.sourceSha256,
            type: 'source-read',
          },
          now,
          run.threadId,
        );
    } catch {
      warning = ' Some reading activity could not be recorded.';
    }
  }
  const synthesis = await writeTopicSynthesis(storage, topicSlug, topicTitle, now, {
    ...(run ? { researchRun: run } : { provenance: 'local-text' }),
  });
  if (run) {
    await recordResearchSynthesisOutcome(
      storage,
      topicSlug,
      run.at,
      synthesis.status === 'written' ? 'written' : 'proposed',
      now,
      synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
    );
  } else if (synthesis.status === 'written') {
    try {
      await detachResearchSynthesis(storage, topicSlug, now);
    } catch {
      // The artifact itself already carries local provenance; a stale ledger cannot claim it.
      warning += ' The brief was saved, but its research history link could not be updated.';
    }
  }
  return {
    message: `${synthesis.status === 'written' ? 'Brief built' : 'Your edited brief was kept; a refreshed proposal is in Needs attention'} from ${claimCount} quoted passages across ${read.read.length} local sources.${remaining}${warning} No original pages were fetched.`,
    path: synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
  };
}
