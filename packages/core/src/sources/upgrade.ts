import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import type { FetchedPage } from '../research/companion.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import {
  SourceManifestSchema,
  SourceRecordSchema,
  TopicStateSchema,
  schemaVersion,
  type SourceManifest,
  type SourceRecord,
} from '../schemas/workspace.js';
import { topicRoot } from '../workspace/paths.js';
import { cappedMarkdown } from './capped.js';

/** The parts of a source this builder actually reads. */
export interface UpgradableSource {
  title: string;
  url?: string;
}

/**
 * Accepts a bare title and URL as well as a manifest record, so a research capture that has no
 * record yet produces the same document shape as an upgrade of one that does.
 */
export function buildUpgradedContent(
  record: SourceRecord | UpgradableSource,
  page: FetchedPage,
): string {
  const host = new URL(page.finalUrl).host;
  const fetchedOn = page.fetchedAt.slice(0, 10);
  const prefix = [
    `# ${record.title}`,
    '',
    record.url ? `Original URL: <${record.url}>` : `Fetched URL: <${page.finalUrl}>`,
    ...(record.url && page.finalUrl !== record.url ? ['', `Resolved URL: <${page.finalUrl}>`] : []),
    ...(page.byline ? ['', `Byline: ${page.byline}`] : []),
    ...(page.siteName ? ['', `Site: ${page.siteName}`] : []),
    '',
    `Fetched from ${host} on ${fetchedOn} via the local companion.`,
    '',
    '',
  ].join('\n');
  return cappedMarkdown(prefix, page.text.replace(/\r\n?/gu, '\n'));
}

export interface UpgradedSource {
  /** True only when the manifest points at the newly saved readable text. */
  indexed: boolean;
  path: string;
  record: SourceRecord;
  updatePath?: string;
  /** The readable source commit succeeded, but the secondary activity log did not. */
  warning?: string;
}

export async function upgradeSource(
  storage: StorageAdapter,
  input: { topicSlug: string; sha256: string; page: FetchedPage; expectedContentHash: string },
  now = new Date(),
): Promise<UpgradedSource> {
  const root = topicRoot(input.topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  const manifestPath = `${root}/Sources/manifest.json`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    let manifest: SourceManifest;
    try {
      manifest = SourceManifestSchema.parse(JSON.parse(manifestFile.content));
    } catch {
      throw new Error('The source manifest is invalid. Restore or re-import a valid workspace.');
    }

    const record = manifest.sources.find(
      (source) => source.method === 'url' && source.sha256 === input.sha256,
    );
    if (!record?.path || !record.url) {
      throw new Error('This URL source is missing from the manifest. Refresh and try again.');
    }

    const content = buildUpgradedContent(record, input.page);
    const itemFile = await storage.read(record.path);
    if (!itemFile) {
      throw new Error('This source file is missing. Restore it from a backup, then try again.');
    }

    // Idempotent guard: if a previous attempt in this same call (or an earlier,
    // partially-failed call) already wrote the exact upgraded content, skip
    // rewriting it. Recomputing content is deterministic, so this never masks
    // a real difference. Otherwise, the file's current hash must still match
    // what the caller last read (expectedContentHash) -- optimistic
    // concurrency, the same idiom storage.write uses everywhere else. Any
    // mismatch is a genuine external edit and must surface as a conflict
    // rather than being silently clobbered.
    if (itemFile.content !== content) {
      if (itemFile.hash !== input.expectedContentHash) {
        throw new StorageConflictError(record.path, input.expectedContentHash, itemFile.hash);
      }
      await storage.write(record.path, content, { expectedHash: input.expectedContentHash });
    }

    const nextRecord = SourceRecordSchema.parse({
      ...record,
      fetchedAt: now.toISOString(),
      mediaType: 'text/markdown',
      origin: {
        ...record.origin,
        capturedAt: now.toISOString(),
        capturedVia: 'page-extract',
        provider: 'companion',
      },
      fetchCheckedAt: undefined,
      fetchMessage: undefined,
      fetchState: undefined,
      fetchStatus: undefined,
      readState: 'readable',
      size: new TextEncoder().encode(content).byteLength,
    });
    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      schemaVersion,
      sources: manifest.sources.map((source) => (source === record ? nextRecord : source)),
      synthesisStaleAt: now.toISOString(),
      synthesisStaleReason: `Readable text was added for source: ${record.title}`,
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
    } catch (error) {
      if (error instanceof StorageConflictError && attempt < 2) continue;
      return {
        indexed: false,
        path: record.path,
        record: nextRecord,
        warning:
          'Readable text was saved locally, but the source index could not be updated. Retry Read to finish indexing.',
      };
    }

    const relativePath = record.path.slice(`${root}/`.length).replace(/\.md$/u, '');
    let updatePath: string | undefined;
    let warning: string | undefined;
    try {
      updatePath = await appendTopicUpdate(
        storage,
        input.topicSlug,
        `- Upgraded url source [[../../../${relativePath}|${record.title}]] to full page content.`,
        now,
      );
    } catch {
      warning = 'The readable source was saved, but the activity log could not be updated.';
    }
    return { indexed: true, path: record.path, record: nextRecord, updatePath, warning };
  }

  throw new Error('The source manifest changed repeatedly. Try upgrading the source again.');
}
