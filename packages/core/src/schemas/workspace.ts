import { z } from 'zod';

export const schemaVersion = 1 as const;

export const FileVersionSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/u),
    modifiedAt: z.number().nonnegative(),
  })
  .passthrough();

export const TopicIndexSchema = z
  .object({
    createdAt: z.string().datetime(),
    slug: z.string().min(1).max(80),
    title: z.string().min(1).max(160),
  })
  .passthrough();

export const WorkspaceSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    name: z.string().min(1).max(160),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    topics: z.array(TopicIndexSchema),
    fileIndex: z.record(z.string(), FileVersionSchema),
  })
  .passthrough();

export const TopicStateSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    topicSlug: z.string().min(1).max(80),
    status: z.enum(['active', 'paused', 'complete']),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    fileIndex: z.record(z.string(), FileVersionSchema),
  })
  .passthrough();

// Known provider values: 'mslearn', 'wikipedia', 'companion'.
// Known capturedVia values: 'catalog-reference', 'api-extract', 'page-extract'.
// Tolerant strings, not enums, so a future provenance value never breaks a reader again.
export const SourceOriginSchema = z
  .object({
    provider: z.string().min(1).max(40),
    capturedVia: z.string().min(1).max(40),
    capturedAt: z.string().datetime(),
  })
  .passthrough();

/**
 * One verbatim excerpt from a source's own local text, with where it was found. Never
 * paraphrased and never model-written: a claim the workspace cannot quote is not a claim.
 */
export const SourceClaimSchema = z
  .object({
    text: z.string().min(1).max(600),
    heading: z.string().min(1).max(160).optional(),
    at: z.string().datetime(),
  })
  .passthrough();

export const SourceRecordSchema = z
  .object({
    fetchedAt: z.string().datetime(),
    mediaType: z.enum(['text/markdown', 'text/plain']).optional(),
    method: z.enum(['file', 'paste', 'url']),
    origin: SourceOriginSchema.optional(),
    originalName: z.string().min(1).max(255).optional(),
    path: z.string().min(1).max(320).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    size: z.number().int().nonnegative().optional(),
    title: z.string().min(1).max(160),
    url: z.url().optional(),
    // Research provenance. Tolerant strings for the same reason as `origin` above: a provider
    // reports what it has, and a workspace written by a newer build must stay readable.
    // `publishedAt` is not `.datetime()` because providers report date-only values too.
    publishedAt: z.string().min(4).max(40).optional(),
    publisher: z.string().min(1).max(160).optional(),
    author: z.string().min(1).max(160).optional(),
    /** Why the ranker put this in front of the learner, kept verbatim at accept time. */
    whySelected: z.array(z.string().min(1).max(160)).max(8).optional(),
    readState: z.enum(['read', 'readable', 'reference']).optional(),
    claims: z.array(SourceClaimSchema).max(12).optional(),
  })
  .passthrough();

export const SourceManifestSchema = z
  .object({
    schemaVersion: z.literal(schemaVersion),
    sources: z.array(SourceRecordSchema),
  })
  .passthrough();

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type TopicState = z.infer<typeof TopicStateSchema>;
export type SourceOrigin = z.infer<typeof SourceOriginSchema>;
export type SourceClaim = z.infer<typeof SourceClaimSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
