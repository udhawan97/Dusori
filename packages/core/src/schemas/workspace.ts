import { z } from 'zod';

export const schemaVersion = 1 as const;

export const FileVersionSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
  modifiedAt: z.number().nonnegative(),
});

export const TopicIndexSchema = z.object({
  createdAt: z.string().datetime(),
  slug: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
});

export const WorkspaceSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  name: z.string().min(1).max(160),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  topics: z.array(TopicIndexSchema),
  fileIndex: z.record(z.string(), FileVersionSchema),
});

export const TopicStateSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  topicSlug: z.string().min(1).max(80),
  status: z.enum(['active', 'paused', 'complete']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  fileIndex: z.record(z.string(), FileVersionSchema),
});

// Known provider values: 'mslearn', 'wikipedia', 'companion'.
// Known capturedVia values: 'catalog-reference', 'api-extract', 'page-extract'.
// Tolerant strings, not enums, so a future provenance value never breaks a reader again.
export const SourceOriginSchema = z.object({
  provider: z.string().min(1).max(40),
  capturedVia: z.string().min(1).max(40),
  capturedAt: z.string().datetime(),
});

export const SourceRecordSchema = z.object({
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
});

export const SourceManifestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  sources: z.array(SourceRecordSchema),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type TopicState = z.infer<typeof TopicStateSchema>;
export type SourceOrigin = z.infer<typeof SourceOriginSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
