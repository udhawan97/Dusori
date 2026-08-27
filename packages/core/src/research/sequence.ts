import type { StorageAdapter } from '../adapters.js';
import type { SourceRecord } from '../schemas/workspace.js';
import {
  addSource,
  readSourceManifest,
  recordSourceFetchFailure,
  type AddedSource,
} from '../sources/import.js';
import { writeTopicSynthesis, type WriteSynthesisResult } from './artifacts.js';
import { runResearchAgent, type ResearchRunResult } from './agent.js';
import { readSourcesIntoClaims } from './claims.js';
import { withAbortingFetchTimeout } from './fetch-timeout.js';
import type { RankedCandidate } from './rank.js';
import {
  recordActiveResearchSynthesisOutcome,
  recordResearchSynthesisOutcome,
  recordResearchThreadEvent,
} from './research-file.js';
import type { RenderSynthesisOptions } from './synthesis.js';
import { isReadableResearchCapture, type ResearchProvider, type ResearchQuery } from './types.js';

export type ResearchSequenceStage = 'searching' | 'evaluating' | 'saving' | 'reading' | 'writing';

export type ResearchSourceOutcomeStatus = 'duplicate' | 'failed' | 'readable' | 'reference';

export interface ResearchSourceOutcome {
  candidate: RankedCandidate;
  message: string;
  record?: SourceRecord;
  status: ResearchSourceOutcomeStatus;
}

export interface ResearchSequenceProgress {
  stage: ResearchSequenceStage;
  candidate?: RankedCandidate;
  source?: ResearchSourceOutcome;
}

export type ResearchSequenceStatus =
  'brief-proposed' | 'brief-ready' | 'needs-readable-evidence' | 'no-results';

export interface ResearchSequenceResult extends ResearchRunResult {
  status: ResearchSequenceStatus;
  sources: ResearchSourceOutcome[];
  readCount: number;
  claimCount: number;
  aiUnavailable: boolean;
  synthesis?: WriteSynthesisResult;
  /** Research completed, but a secondary typed activity write did not. */
  activityWarning?: string;
}

export interface RunResearchSequenceInput {
  storage: StorageAdapter;
  topicSlug: string;
  topicTitle: string;
  /** The exact question used to build the query and the persisted run trail. */
  query: ResearchQuery;
  /** Only providers whose exact consent scope is already allowed. */
  providers: ResearchProvider[];
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  limit?: number;
  /** Set only when this question is a follow-up to a completed thread. */
  parentThreadId?: string;
  /** Supplied only after separate AI consent. Failure always falls back deterministically. */
  enhanceSynthesis?: (sources: SourceRecord[]) => Promise<RenderSynthesisOptions>;
  onProgress?: (progress: ResearchSequenceProgress) => void;
}

export interface SaveApprovedResearchCandidateInput {
  storage: StorageAdapter;
  topicSlug: string;
  topicTitle: string;
  /** The exact result the learner approved from a completed research run. */
  candidate: RankedCandidate;
  /** The already-consented provider that produced the candidate. */
  provider: ResearchProvider;
  fetchImpl?: typeof fetch;
  now?: Date;
  timeoutMs?: number;
  /** Supplied only when the separate AI synthesis scope is already allowed. */
  enhanceSynthesis?: (sources: SourceRecord[]) => Promise<RenderSynthesisOptions>;
}

export interface SaveApprovedResearchCandidateResult {
  source: ResearchSourceOutcome;
  readCount: number;
  claimCount: number;
  aiUnavailable: boolean;
  synthesis?: WriteSynthesisResult;
  /** A post-save read or synthesis problem. The approved source itself remains saved. */
  warning?: string;
}

const defaultTimeoutMs = 12_000;

function report(
  observer: RunResearchSequenceInput['onProgress'],
  progress: ResearchSequenceProgress,
): void {
  try {
    observer?.(progress);
  } catch {
    // Progress is advisory. Rendering must never decide whether research commits.
  }
}

async function withCaptureTimeout(
  provider: ResearchProvider,
  candidate: RankedCandidate,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Awaited<ReturnType<ResearchProvider['capture']>>> {
  return withAbortingFetchTimeout(
    fetchImpl,
    timeoutMs,
    `${provider.label} took too long to read this result. The browser-ready reference was kept.`,
    (scopedFetch) => provider.capture(candidate, scopedFetch),
  );
}

function savedStatus(saved: AddedSource, readable: boolean): ResearchSourceOutcomeStatus {
  if (saved.deduplicated && !saved.upgraded) return 'duplicate';
  return readable ? 'readable' : 'reference';
}

function savedMessage(saved: AddedSource, readable: boolean, captureFailure: string): string {
  const message = captureFailure
    ? `${captureFailure} Open the original or paste text.`
    : saved.tombstoned
      ? 'Kept out of active research because you removed this source.'
      : saved.restored
        ? 'Restored to active research.'
        : saved.upgraded
          ? 'Readable text added to the saved reference.'
          : saved.deduplicated
            ? 'Already saved in this topic.'
            : readable
              ? 'Readable provider text saved.'
              : 'Reference saved; the original page was not fetched.';
  return `${message}${saved.warning ? ` ${saved.warning}` : ''}`;
}

async function saveCandidate(
  input: Pick<RunResearchSequenceInput, 'storage' | 'topicSlug'>,
  provider: ResearchProvider,
  candidate: RankedCandidate,
  now: Date,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ResearchSourceOutcome> {
  let capture: { content?: string; title: string; url: string } = {
    title: candidate.title,
    url: candidate.url,
  };
  let capturedVia = provider.capturedVia(candidate);
  let captureFailure = '';
  try {
    const captured = await withCaptureTimeout(provider, candidate, fetchImpl, timeoutMs);
    capture = captured;
    capturedVia = captured.capturedVia ?? capturedVia;
    if (provider.capturePolicy === 'reference-only' && isReadableResearchCapture(capturedVia)) {
      capturedVia = 'search-reference';
    }
  } catch (error) {
    captureFailure =
      error instanceof Error
        ? error.message
        : `${provider.label} could not capture this result. The reference was kept.`;
    capturedVia = 'search-reference';
  }

  try {
    const saved = await addSource(
      input.storage,
      {
        ...(capture.content === undefined ? {} : { content: capture.content }),
        method: 'url',
        origin: {
          capturedAt: now.toISOString(),
          capturedVia,
          provider: provider.id,
        },
        provenance: {
          author: candidate.meta.author ?? candidate.meta.channel ?? candidate.meta.byline,
          publishedAt: candidate.publishedAt,
          publisher: provider.label,
          readState: isReadableResearchCapture(capturedVia) ? 'readable' : 'reference',
          whySelected: candidate.reasons.slice(0, 8),
        },
        title: capture.title,
        topicSlug: input.topicSlug,
        url: capture.url,
      },
      now,
    );
    let record = saved.record;
    if (captureFailure) {
      record = await recordSourceFetchFailure(
        input.storage,
        {
          message: captureFailure,
          sha256: saved.record.sha256,
          state: 'failed',
          topicSlug: input.topicSlug,
        },
        now,
      );
    }
    const readable = isReadableResearchCapture(capturedVia);
    let activityWarning = '';
    if (!saved.deduplicated || saved.restored || saved.upgraded) {
      try {
        await recordResearchThreadEvent(
          input.storage,
          input.topicSlug,
          {
            readState: record.readState,
            sourcePath: record.path,
            sourceSha256: record.sha256,
            type: 'source-saved',
          },
          now,
        );
      } catch {
        activityWarning = ' The source was saved, but thread activity could not be updated.';
      }
    }
    return {
      candidate,
      message: `${savedMessage(saved, readable, captureFailure)}${activityWarning}`,
      record,
      status: captureFailure ? 'failed' : savedStatus(saved, readable),
    };
  } catch (error) {
    return {
      candidate,
      message: error instanceof Error ? error.message : 'This result could not be saved.',
      status: 'failed',
    };
  }
}

async function recordReadActivity(
  storage: StorageAdapter,
  topicSlug: string,
  read: Awaited<ReturnType<typeof readSourcesIntoClaims>>['read'],
  now: Date,
): Promise<string | undefined> {
  try {
    for (const source of read) {
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
      );
    }
    return undefined;
  } catch {
    return 'Readable evidence was saved, but thread activity could not be updated.';
  }
}

/**
 * Saves one exact candidate only after the UI has recorded the learner's approval. This function
 * never searches or broadens provider access: the candidate and its matching, already-consented
 * provider must both come from the completed run that rendered the approval control.
 */
export async function saveApprovedResearchCandidate(
  input: SaveApprovedResearchCandidateInput,
): Promise<SaveApprovedResearchCandidateResult> {
  if (input.candidate.provider !== input.provider.id) {
    throw new Error('The approved result no longer matches its research provider.');
  }

  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  const source = await saveCandidate(
    input,
    input.provider,
    input.candidate,
    now,
    fetchImpl,
    timeoutMs,
  );
  if (!source.record) {
    return { aiUnavailable: false, claimCount: 0, readCount: 0, source };
  }

  let readCount = 0;
  let claimCount = 0;
  let activityWarning: string | undefined;
  try {
    const read = await readSourcesIntoClaims(input.storage, input.topicSlug, now);
    readCount = read.read.length;
    claimCount = read.read.reduce((total, entry) => total + entry.claims, 0);
    activityWarning = await recordReadActivity(input.storage, input.topicSlug, read.read, now);
  } catch (error) {
    return {
      aiUnavailable: false,
      claimCount,
      readCount,
      source,
      warning:
        error instanceof Error
          ? `The source was saved, but its readable text could not be indexed yet: ${error.message}`
          : 'The source was saved, but its readable text could not be indexed yet.',
    };
  }

  if (claimCount === 0) {
    return { aiUnavailable: false, claimCount, readCount, source, warning: activityWarning };
  }

  let synthesisOptions: RenderSynthesisOptions = {};
  let aiUnavailable = false;
  if (input.enhanceSynthesis) {
    try {
      const manifest = await readSourceManifest(input.storage, input.topicSlug, now);
      synthesisOptions = await input.enhanceSynthesis(manifest.sources);
    } catch {
      aiUnavailable = true;
    }
  }
  try {
    const synthesis = await writeTopicSynthesis(
      input.storage,
      input.topicSlug,
      input.topicTitle,
      now,
      synthesisOptions,
    );
    await recordActiveResearchSynthesisOutcome(
      input.storage,
      input.topicSlug,
      synthesis.status === 'written' ? 'written' : 'proposed',
      now,
      synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
    );
    return { aiUnavailable, claimCount, readCount, source, synthesis, warning: activityWarning };
  } catch (error) {
    return {
      aiUnavailable,
      claimCount,
      readCount,
      source,
      warning: [
        activityWarning,
        error instanceof Error
          ? `The source was saved, but the brief could not refresh yet: ${error.message}`
          : 'The source was saved, but the brief could not refresh yet.',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }
}

/**
 * The complete research transaction: search allowed providers, preserve the run trail, save each
 * capture independently, extract quotable evidence, and write or propose the brief. The UI owns
 * consent and presentation; this seam owns ordering, partial failure, provenance, and fallback.
 */
export async function runResearchSequence(
  input: RunResearchSequenceInput,
): Promise<ResearchSequenceResult> {
  if (!input.query.searchText.trim()) throw new Error('Research needs a non-empty question.');
  if (input.providers.length === 0) {
    return {
      aiUnavailable: false,
      claimCount: 0,
      eligibleCount: 0,
      overflow: [],
      readCount: 0,
      run: null,
      shortlist: [],
      skipped: [],
      sources: [],
      status: 'no-results',
    };
  }

  const now = input.now ?? new Date();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  report(input.onProgress, { stage: 'searching' });
  const discovery = await runResearchAgent({
    fetchImpl,
    limit: input.limit,
    now,
    providers: input.providers,
    parentThreadId: input.parentThreadId,
    query: input.query,
    storage: input.storage,
    timeoutMs,
    topicSlug: input.topicSlug,
  });
  report(input.onProgress, { stage: 'evaluating' });
  if (discovery.shortlist.length === 0) {
    return {
      ...discovery,
      aiUnavailable: false,
      claimCount: 0,
      readCount: 0,
      sources: [],
      status: 'no-results',
    };
  }

  const providers = new Map(input.providers.map((provider) => [provider.id, provider]));
  const sources: ResearchSourceOutcome[] = [];
  for (const candidate of discovery.shortlist) {
    report(input.onProgress, { candidate, stage: 'saving' });
    const provider = providers.get(candidate.provider);
    if (!provider) {
      const outcome: ResearchSourceOutcome = {
        candidate,
        message: `The ${candidate.provider} provider is no longer available.`,
        status: 'failed',
      };
      sources.push(outcome);
      report(input.onProgress, { candidate, source: outcome, stage: 'saving' });
      continue;
    }
    const outcome = await saveCandidate(input, provider, candidate, now, fetchImpl, timeoutMs);
    sources.push(outcome);
    report(input.onProgress, { candidate, source: outcome, stage: 'saving' });
  }

  report(input.onProgress, { stage: 'reading' });
  const read = await readSourcesIntoClaims(input.storage, input.topicSlug, now);
  const readCount = read.read.length;
  const claimCount = read.read.reduce((total, entry) => total + entry.claims, 0);
  const activityWarning = await recordReadActivity(input.storage, input.topicSlug, read.read, now);
  if (claimCount === 0) {
    return {
      ...discovery,
      aiUnavailable: false,
      claimCount,
      readCount,
      sources,
      status: 'needs-readable-evidence',
      activityWarning,
    };
  }

  report(input.onProgress, { stage: 'writing' });
  let synthesisOptions: RenderSynthesisOptions = {};
  let aiUnavailable = false;
  if (input.enhanceSynthesis) {
    try {
      const manifest = await readSourceManifest(input.storage, input.topicSlug, now);
      synthesisOptions = await input.enhanceSynthesis(manifest.sources);
    } catch {
      aiUnavailable = true;
    }
  }
  const synthesis = await writeTopicSynthesis(
    input.storage,
    input.topicSlug,
    input.topicTitle,
    now,
    synthesisOptions,
  );
  if (discovery.run) {
    await recordResearchSynthesisOutcome(
      input.storage,
      input.topicSlug,
      discovery.run.at,
      synthesis.status === 'written' ? 'written' : 'proposed',
      now,
      synthesis.status === 'written' ? synthesis.path : synthesis.conflict.proposalPath,
    );
  }
  return {
    ...discovery,
    aiUnavailable,
    claimCount,
    readCount,
    sources,
    status: synthesis.status === 'written' ? 'brief-ready' : 'brief-proposed',
    synthesis,
    activityWarning,
  };
}
