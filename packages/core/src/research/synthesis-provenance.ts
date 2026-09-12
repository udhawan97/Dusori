import type { ResearchRunRecord } from './research-file.js';

function synthesisFrontmatter(markdown: string): string {
  return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown)?.[1] ?? '';
}

/** Artifact-local provenance survives interruption before separate research history is saved. */
export function isLocalSynthesis(markdown: string): boolean {
  return /^provenance: local-text\r?$/mu.test(synthesisFrontmatter(markdown));
}

/** An explicit recovered-run artifact cannot fall back to an earlier answer after a failed link. */
export function synthesisResearchProvenanceMatches(
  markdown: string,
  runs: ResearchRunRecord[],
  synthesisRunAt?: string,
): boolean {
  const frontmatter = synthesisFrontmatter(markdown);
  if (!/^provenance: research-run\r?$/mu.test(frontmatter)) return true;
  return Boolean(synthesisResearchRun(markdown, runs, synthesisRunAt));
}

/** Undefined means legacy; null means an explicit marker with an invalid identity. */
export function synthesisResearchIdentity(
  markdown: string,
): Pick<ResearchRunRecord, 'at' | 'threadId'> | null | undefined {
  const frontmatter = synthesisFrontmatter(markdown);
  if (!/^provenance: research-run\r?$/mu.test(frontmatter)) return undefined;
  try {
    const at: unknown = JSON.parse(/^research_run_at: (.+)\r?$/mu.exec(frontmatter)?.[1] ?? 'null');
    const threadId: unknown = JSON.parse(
      /^research_thread_id: (.+)\r?$/mu.exec(frontmatter)?.[1] ?? 'null',
    );
    if (typeof at !== 'string' || (threadId !== null && typeof threadId !== 'string')) return null;
    return { at, ...(threadId === null ? {} : { threadId }) };
  } catch {
    return null;
  }
}

/** Resolves only the exact committed identity embedded in a recovered-run artifact. */
export function synthesisResearchRun(
  markdown: string,
  runs: ResearchRunRecord[],
  synthesisRunAt?: string,
): ResearchRunRecord | undefined {
  const identity = synthesisResearchIdentity(markdown);
  if (!identity || identity.at !== synthesisRunAt) return undefined;
  return runs.find(
    (run) =>
      run.at === identity.at &&
      run.synthesisOutcome === 'written' &&
      run.threadId === identity.threadId,
  );
}
