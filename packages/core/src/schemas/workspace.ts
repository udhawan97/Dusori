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

export const SourceRecordSchema = z.object({
  fetchedAt: z.string().datetime(),
  method: z.enum(['file', 'paste', 'url']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  title: z.string().min(1),
  url: z.url().optional(),
});

export const SourceManifestSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  sources: z.array(SourceRecordSchema),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type TopicState = z.infer<typeof TopicStateSchema>;
export type SourceManifest = z.infer<typeof SourceManifestSchema>;
