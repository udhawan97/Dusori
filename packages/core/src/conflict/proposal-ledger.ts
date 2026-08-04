import { z } from 'zod';

import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { normalizeWorkspacePath, topicRoot } from '../workspace/paths.js';

const contentHash = z.string().regex(/^[a-f0-9]{64}$/u);

export const ProposalResolutionSchema = z.enum(['pending', 'accepted', 'kept']);

export const ProposalEntrySchema = z
  .object({
    createdAt: z.string().datetime(),
    currentContentHashAtCreation: contentHash,
    currentPath: z.string().min(1).max(500),
    expectedContentHash: contentHash,
    proposalPath: z.string().min(1).max(500),
    resolution: ProposalResolutionSchema,
    resolvedAt: z.string().datetime().optional(),
  })
  .passthrough()
  .superRefine((entry, context) => {
    if (entry.resolution === 'pending' && entry.resolvedAt !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A pending proposal cannot have a resolution time.',
        path: ['resolvedAt'],
      });
    }
    if (entry.resolution !== 'pending' && entry.resolvedAt === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'A resolved proposal needs a resolution time.',
        path: ['resolvedAt'],
      });
    }
  });

export const ProposalLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    topicSlug: z.string().min(1).max(80),
    proposals: z.array(ProposalEntrySchema),
  })
  .passthrough()
  .superRefine((ledger, context) => {
    const root = `Topics/${ledger.topicSlug}/`;
    const seen = new Set<string>();
    ledger.proposals.forEach((proposal, index) => {
      for (const field of ['currentPath', 'proposalPath'] as const) {
        let normalized = '';
        try {
          normalized = normalizeWorkspacePath(proposal[field]);
        } catch {
          // The common issue below also covers absolute and traversal paths.
        }
        if (
          normalized !== proposal[field] ||
          !normalized.startsWith(root) ||
          !normalized.endsWith('.md')
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Proposal paths must be Markdown inside their recorded topic.',
            path: ['proposals', index, field],
          });
        }
      }
      if (proposal.currentPath === proposal.proposalPath) {
        context.addIssue({
          code: 'custom',
          message: 'The proposal file must be separate from its current document.',
          path: ['proposals', index, 'proposalPath'],
        });
      }
      if (seen.has(proposal.proposalPath)) {
        context.addIssue({
          code: 'custom',
          message: 'Proposal paths must be unique.',
          path: ['proposals', index, 'proposalPath'],
        });
      }
      seen.add(proposal.proposalPath);
    });
  });

export type ProposalEntry = z.infer<typeof ProposalEntrySchema>;
export type ProposalLedger = z.infer<typeof ProposalLedgerSchema>;
export type ProposalResolution = z.infer<typeof ProposalResolutionSchema>;

export interface PendingProposal extends ProposalEntry {
  topicSlug: string;
}

export function proposalLedgerPath(topicSlug: string): string {
  return `${topicRoot(topicSlug)}/proposals.json`;
}

function emptyLedger(topicSlug: string): ProposalLedger {
  return { proposals: [], schemaVersion: 1, topicSlug };
}

function parseLedger(content: string, path: string, topicSlug: string): ProposalLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`The proposal ledger is invalid JSON: ${path}`);
  }
  const result = ProposalLedgerSchema.safeParse(parsed);
  if (!result.success || result.data.topicSlug !== topicSlug) {
    throw new Error(`The proposal ledger is invalid: ${path}`);
  }
  return result.data;
}

export async function readProposalLedger(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<ProposalLedger> {
  const path = proposalLedgerPath(topicSlug);
  const snapshot = await storage.read(path);
  return snapshot ? parseLedger(snapshot.content, path, topicSlug) : emptyLedger(topicSlug);
}

async function updateProposalLedger(
  storage: StorageAdapter,
  topicSlug: string,
  update: (ledger: ProposalLedger) => ProposalLedger,
): Promise<ProposalLedger> {
  const path = proposalLedgerPath(topicSlug);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = await storage.read(path);
    const current = snapshot
      ? parseLedger(snapshot.content, path, topicSlug)
      : emptyLedger(topicSlug);
    const next = ProposalLedgerSchema.parse(update(current));
    try {
      await storage.write(path, `${JSON.stringify(next, null, 2)}\n`, {
        expectedHash: snapshot?.hash ?? null,
      });
      return next;
    } catch (error) {
      if (!(error instanceof StorageConflictError) || attempt === 2) throw error;
    }
  }
  throw new Error('The proposal ledger changed repeatedly. Try again.');
}

function assertTopicMarkdownPath(topicSlug: string, path: string, label: string): string {
  const normalized = normalizeWorkspacePath(path);
  const root = `${topicRoot(topicSlug)}/`;
  if (!normalized.startsWith(root) || !normalized.endsWith('.md')) {
    throw new Error(`${label} must be Markdown inside the selected topic.`);
  }
  return normalized;
}

export async function recordPendingProposal(
  storage: StorageAdapter,
  input: {
    createdAt: string;
    currentContentHash: string;
    currentPath: string;
    expectedContentHash: string;
    proposalPath: string;
    topicSlug: string;
  },
): Promise<ProposalLedger> {
  const currentPath = assertTopicMarkdownPath(
    input.topicSlug,
    input.currentPath,
    'The proposal target',
  );
  const proposalPath = assertTopicMarkdownPath(
    input.topicSlug,
    input.proposalPath,
    'The proposal file',
  );
  const entry = ProposalEntrySchema.parse({
    createdAt: input.createdAt,
    currentContentHashAtCreation: input.currentContentHash,
    currentPath,
    expectedContentHash: input.expectedContentHash,
    proposalPath,
    resolution: 'pending',
  });
  return updateProposalLedger(storage, input.topicSlug, (ledger) => {
    const existing = ledger.proposals.find((proposal) => proposal.proposalPath === proposalPath);
    if (existing) return ledger;
    return { ...ledger, proposals: [...ledger.proposals, entry] };
  });
}

export async function resolvePendingProposal(
  storage: StorageAdapter,
  topicSlug: string,
  proposalPath: string,
  resolution: Exclude<ProposalResolution, 'pending'>,
  now = new Date(),
): Promise<ProposalLedger> {
  const normalized = assertTopicMarkdownPath(topicSlug, proposalPath, 'The proposal file');
  return updateProposalLedger(storage, topicSlug, (ledger) => {
    const proposal = ledger.proposals.find((entry) => entry.proposalPath === normalized);
    if (!proposal) throw new Error(`The pending proposal is not recorded: ${normalized}`);
    if (proposal.resolution === resolution) return ledger;
    if (proposal.resolution !== 'pending') {
      throw new Error(`The proposal was already resolved as ${proposal.resolution}.`);
    }
    return {
      ...ledger,
      proposals: ledger.proposals.map((entry) =>
        entry.proposalPath === normalized
          ? { ...entry, resolution, resolvedAt: now.toISOString() }
          : entry,
      ),
    };
  });
}

export async function readPendingProposals(
  storage: StorageAdapter,
  topicSlug: string,
): Promise<PendingProposal[]> {
  const ledger = await readProposalLedger(storage, topicSlug);
  return ledger.proposals
    .filter((proposal) => proposal.resolution === 'pending')
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.proposalPath.localeCompare(right.proposalPath),
    )
    .map((proposal) => ({ ...proposal, topicSlug }));
}
