import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  acceptMarkdownUpdate,
  addSource,
  createTopic,
  createWorkspace,
  isLocalSynthesis,
  readProposalLedger,
  readResearchFile,
  readSourceManifest,
  readSourcesIntoClaims,
  recordResearchRun,
  recordResearchSynthesisOutcome,
  resolvePendingProposal,
  resolveResearchSynthesisProposal,
  synthesisResearchProvenanceMatches,
  writeTopicSynthesis,
} from '@dusori/core';
import { MemoryStorageAdapter } from '../../../../packages/core/src/testing/memory-storage.js';
import { buildLocalResearch } from './local-research';
import { buildResearchThreadExportBundle, renderResearchThreadHtml } from './research-thread';

const now = new Date('2026-09-11T12:00:00.000Z');
const later = new Date('2026-09-11T13:00:00.000Z');

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const storage = new MemoryStorageAdapter();
  await createWorkspace(storage, 'Fixture', now);
  const topic = await createTopic(storage, 'Local reading', now);
  const slug = topic.topicSlug;
  const path = `Topics/${slug}/Synthesis.md`;
  const researchPath = `Topics/${slug}/research.json`;
  await addSource(
    storage,
    {
      content:
        '# Evidence\n\nRetrieval practice improves later recall when learners actively reconstruct an answer from memory before checking it.\n',
      method: 'paste',
      title: 'Local evidence',
      topicSlug: slug,
    },
    now,
  );
  await readSourcesIntoClaims(storage, slug, now);
  await recordResearchRun(
    storage,
    slug,
    {
      candidates: [],
      questionText: 'Earlier provider question?',
      searchText: 'Earlier provider question?',
      providers: [{ count: 0, id: 'older-provider', label: 'Earlier Provider', outcome: 'empty' }],
    },
    now,
  );
  await writeTopicSynthesis(storage, slug, 'Local reading', now);
  await recordResearchSynthesisOutcome(storage, slug, now.toISOString(), 'written', now, path);
  // A generic proposal resolver must not select this unrelated proposed provider run.
  const proposedAt = new Date('2026-09-11T12:30:00.000Z');
  await recordResearchRun(
    storage,
    slug,
    {
      candidates: [],
      questionText: 'Unrelated proposal?',
      searchText: 'Unrelated proposal?',
      providers: [],
    },
    proposedAt,
  );
  await recordResearchSynthesisOutcome(
    storage,
    slug,
    proposedAt.toISOString(),
    'proposed',
    proposedAt,
  );
  await addSource(
    storage,
    {
      content:
        '# New local evidence\n\nSpacing practice across several days improves retention because learners reconstruct the material after a meaningful delay between sessions.\n',
      method: 'paste',
      title: 'New local evidence',
      topicSlug: slug,
    },
    later,
  );
  return { storage, slug, path, researchPath };
}

async function assertLocalExport({ storage, slug, path }: Awaited<ReturnType<typeof fixture>>) {
  // Reconstruct exclusively from persisted snapshots, with deliberately stale caller identity.
  const research = await readResearchFile(storage, slug);
  const artifact = await storage.read(path);
  expect(isLocalSynthesis(artifact!.content)).toBe(true);
  const input = {
    generatedAt: later.toISOString(),
    outputStyle: 'brief' as const,
    runs: research!.runs!,
    sources: (await readSourceManifest(storage, slug)).sources,
    synthesisMarkdown: artifact!.content,
    synthesisRunAt: now.toISOString(),
    threadId: research!.runs![0]!.threadId,
    threads: research!.threads,
    topicSlug: slug,
    topicTitle: 'Local reading',
  };
  const bundle = await buildResearchThreadExportBundle(storage, input, 'markdown', later);
  expect(bundle.content).toContain('Local source brief');
  expect(bundle.content).toContain('Retrieval practice improves later recall');
  expect(bundle.content).toContain('Spacing practice across several days');
  expect(bundle.content).not.toContain('Earlier provider question');
  expect(bundle.content).not.toContain('Earlier Provider');
  expect(bundle.content).not.toContain('Unrelated proposal');
  expect(bundle.manifest.thread).toEqual({ question: 'Local reading' });
  expect(await renderResearchThreadHtml(input)).not.toContain('Earlier Provider');
}

describe('artifact-local synthesis provenance', () => {
  it.each(['accepted', 'kept'] as const)(
    '%s recovered proposal resolves its embedded receipt, not a later unrelated proposal',
    async (resolution) => {
      const { storage, slug, path } = await fixture();
      const receiptAt = new Date('2026-09-11T12:45:00.000Z');
      const recovered = (
        await recordResearchRun(
          storage,
          slug,
          {
            candidates: [],
            providers: [],
            questionText: 'Recovered R?',
            searchText: 'Recovered R?',
          },
          receiptAt,
        )
      ).runs!.at(-1)!;
      const original = (await storage.read(path))!.content + '\nLearner edit.\n';
      await storage.externalWrite(path, original);
      await buildLocalResearch(storage, slug, 'Local reading', { now: later, run: recovered });
      const proposal = (await readProposalLedger(storage, slug)).proposals.at(-1)!;
      expect(proposal.createdAt).not.toBe(recovered.at);
      const unrelatedAt = new Date('2026-09-11T13:30:00.000Z');
      await recordResearchRun(
        storage,
        slug,
        {
          candidates: [],
          providers: [],
          questionText: 'Unrelated U?',
          searchText: 'Unrelated U?',
        },
        unrelatedAt,
      );
      const before = await recordResearchSynthesisOutcome(
        storage,
        slug,
        unrelatedAt.toISOString(),
        'proposed',
        unrelatedAt,
      );
      const proposed = (await storage.read(proposal.proposalPath))!;
      const resolvedAt = new Date('2026-09-11T14:00:00.000Z');
      if (resolution === 'accepted') {
        await acceptMarkdownUpdate(
          storage,
          slug,
          'Synthesis.md',
          proposed.content,
          (await storage.read(path))!.hash,
          resolvedAt,
          undefined,
          proposal.proposalPath,
        );
      } else {
        await resolvePendingProposal(storage, slug, proposal.proposalPath, 'kept', resolvedAt);
      }
      const after = (await resolveResearchSynthesisProposal(
        storage,
        slug,
        proposal.proposalPath,
        resolution,
        resolvedAt,
      ))!;
      expect(after.runs?.filter((run) => run.at !== recovered.at)).toEqual(
        before.runs?.filter((run) => run.at !== recovered.at),
      );
      expect(after.events?.filter((event) => event.threadId !== recovered.threadId)).toEqual(
        before.events?.filter((event) => event.threadId !== recovered.threadId),
      );
      expect(after.runs?.find((run) => run.at === recovered.at)?.synthesisOutcome).toBe(
        resolution === 'accepted' ? 'written' : 'kept',
      );
      if (resolution === 'accepted') {
        expect(after.synthesisRunAt).toBe(recovered.at);
        expect(
          synthesisResearchProvenanceMatches(
            (await storage.read(path))!.content,
            after.runs!,
            after.synthesisRunAt,
          ),
        ).toBe(true);
      } else {
        expect(after.synthesisRunAt).toBe(before.synthesisRunAt);
        expect((await storage.read(path))!.content).toBe(original);
      }
    },
  );

  it('withholds recovered-run bytes after a failed association instead of using the earlier answer', async () => {
    const { storage, slug, path, researchPath } = await fixture();
    const receiptAt = new Date('2026-09-11T12:45:00.000Z');
    const recorded = await recordResearchRun(
      storage,
      slug,
      {
        candidates: [],
        providers: [],
        questionText: 'Recovered question?',
        searchText: 'Recovered question?',
      },
      receiptAt,
    );
    const recovered = recorded.runs!.at(-1)!;
    const write = storage.write.bind(storage);
    let artifactWritten = false;
    const spy = vi.spyOn(storage, 'write').mockImplementation(async (target, content, options) => {
      if (target === researchPath && artifactWritten) throw new Error('Association unavailable');
      const result = await write(target, content, options);
      if (target === path) artifactWritten = true;
      return result;
    });
    const fetchSpy = vi.fn(() => {
      throw new Error('Network forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      buildLocalResearch(storage, slug, 'Local reading', { now: later, run: recovered }),
    ).rejects.toThrow('Association unavailable');
    spy.mockRestore();

    const artifact = (await storage.read(path))!;
    const research = (await readResearchFile(storage, slug))!;
    expect(artifact.content).toContain(`research_run_at: "${recovered.at}"`);
    expect(research.synthesisRunAt).toBe(now.toISOString());
    expect(research.runs).toEqual(recorded.runs);
    // The same guard is used by ResearchDesk restoration and the export boundary.
    expect(
      synthesisResearchProvenanceMatches(artifact.content, research.runs!, research.synthesisRunAt),
    ).toBe(false);
    const input = {
      generatedAt: later.toISOString(),
      outputStyle: 'brief' as const,
      runs: research.runs!,
      sources: (await readSourceManifest(storage, slug)).sources,
      synthesisMarkdown: artifact.content,
      synthesisRunAt: research.synthesisRunAt,
      threadId: research.runs![0]!.threadId,
      threads: research.threads,
      topicSlug: slug,
      topicTitle: 'Local reading',
    };
    const bundle = await buildResearchThreadExportBundle(storage, input, 'markdown', later);
    expect(bundle.content).toContain('The research receipt has not been linked');
    expect(bundle.content).not.toContain('Spacing practice across several days');
    expect(bundle.content).not.toContain('Earlier provider question');
    expect(bundle.manifest.thread).toEqual({ question: 'Local reading' });
    expect(await renderResearchThreadHtml(input)).not.toContain(
      'Spacing practice across several days',
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    const linked = await recordResearchSynthesisOutcome(
      storage,
      slug,
      recovered.at,
      'written',
      later,
      path,
    );
    expect(
      synthesisResearchProvenanceMatches(artifact.content, linked.runs!, linked.synthesisRunAt),
    ).toBe(true);
    const exported = await buildResearchThreadExportBundle(
      storage,
      {
        ...input,
        runs: linked.runs!,
        synthesisRunAt: linked.synthesisRunAt,
      },
      'markdown',
      later,
    );
    expect(exported.content).toContain('Recovered question?');
    expect(exported.manifest.thread.threadId).toBe(recovered.threadId);
    expect(exported.content).toContain('Spacing practice across several days');
    expect(exported.content).not.toContain('The research receipt has not been linked');
  });

  it('survives a failed ledger write after replacing the provider answer', async () => {
    const subject = await fixture();
    const { storage, slug, path, researchPath } = subject;
    const before = await readResearchFile(storage, slug);
    const write = storage.write.bind(storage);
    let artifactWritten = false;
    const spy = vi.spyOn(storage, 'write').mockImplementation(async (target, content, options) => {
      if (target === researchPath && artifactWritten) throw new Error('Ledger unavailable');
      const result = await write(target, content, options);
      if (target === path) artifactWritten = true;
      return result;
    });
    const fetchSpy = vi.fn(() => {
      throw new Error('Network forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await buildLocalResearch(storage, slug, 'Local reading', { now: later });
    spy.mockRestore();
    expect(artifactWritten).toBe(true);
    expect(result.message).toContain('research history link could not be updated');
    expect(await readResearchFile(storage, slug)).toEqual(before);
    await assertLocalExport(subject);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'kept'] as const)(
    '%s local proposal preserves unrelated provider history',
    async (resolution) => {
      const subject = await fixture();
      const { storage, slug, path } = subject;
      const original = (await storage.read(path))!.content + '\nLearner wording to preserve.\n';
      await storage.externalWrite(path, original);
      const before = await readResearchFile(storage, slug);
      await buildLocalResearch(storage, slug, 'Local reading', { now: later });
      const proposal = (await readProposalLedger(storage, slug)).proposals.at(-1)!;
      const proposed = (await storage.read(proposal.proposalPath))!;
      expect(isLocalSynthesis(proposed.content)).toBe(true);
      if (resolution === 'accepted') {
        await acceptMarkdownUpdate(
          storage,
          slug,
          'Synthesis.md',
          proposed.content,
          (await storage.read(path))!.hash,
          later,
          undefined,
          proposal.proposalPath,
        );
        // Even an interruption before the resolver cannot attach these bytes to the old answer.
        await assertLocalExport(subject);
      } else {
        await resolvePendingProposal(storage, slug, proposal.proposalPath, 'kept', later);
      }
      await resolveResearchSynthesisProposal(
        storage,
        slug,
        proposal.proposalPath,
        resolution,
        later,
      );
      const after = await readResearchFile(storage, slug);
      expect(after?.runs).toEqual(before?.runs);
      expect(after?.events).toEqual(before?.events);
      if (resolution === 'accepted') {
        expect(after?.synthesisRunAt).toBeUndefined();
        expect(after?.synthesisDetachedAt).toBe(later.toISOString());
        await assertLocalExport(subject);
      } else {
        expect(after).toEqual(before);
        expect((await storage.read(path))!.content).toBe(original);
        expect(isLocalSynthesis(original)).toBe(false);
      }
    },
  );

  it('does not interpret quoted body text as artifact provenance', () => {
    expect(isLocalSynthesis('---\ngenerated: synthesis\n---\n\nprovenance: local-text\n')).toBe(
      false,
    );
  });
});
