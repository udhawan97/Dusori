import { StorageConflictError, type StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import { sha256 } from '../hash.js';
import {
  SourceManifestSchema,
  SourceRecordSchema,
  TopicStateSchema,
  schemaVersion,
  type SourceManifest,
  type SourceOrigin,
  type SourceRecord,
} from '../schemas/workspace.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { normalizeWorkspacePath, topicRoot } from '../workspace/paths.js';

export const maxSourceBytes = 2 * 1024 * 1024;

interface SourceInputBase {
  tags?: string[];
  title: string;
  topicSlug: string;
}

export type AddSourceInput =
  | (SourceInputBase & {
      content: string;
      mediaType?: 'text/markdown' | 'text/plain';
      method: 'paste';
    })
  | (SourceInputBase & {
      content: string;
      mediaType: 'text/markdown' | 'text/plain';
      method: 'file';
      originalName: string;
    })
  | (SourceInputBase & {
      content?: string;
      method: 'url';
      origin?: SourceOrigin;
      provenance?: SourceProvenance;
      url: string;
    });

/** What the discovering provider reported about the artifact itself, plus why it ranked. */
export interface SourceProvenance {
  author?: string;
  publishedAt?: string;
  publisher?: string;
  whySelected?: string[];
  readState?: 'read' | 'readable' | 'reference';
}

export interface AddedSource {
  deduplicated: boolean;
  path: string;
  record: SourceRecord;
  restored?: boolean;
  /** A weaker rediscovery respected the user's reversible removal and left its item untouched. */
  tombstoned?: boolean;
  /** A URL reference already existed and now has readable provider text. */
  upgraded?: boolean;
  updatePath?: string;
  /** The source commit succeeded, but a secondary activity-log write did not. */
  warning?: string;
}

export interface RemovedSourceResult {
  record: SourceRecord;
  /** The source item is deliberately retained so Restore works after a relaunch. */
  retainedPath?: string;
  updatePath?: string;
  /** The removal commit succeeded, but a secondary activity-log write did not. */
  warning?: string;
}

function cleanTitle(input: string): string {
  const title = input.trim();
  const hasControlCharacter = [...title].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!title || title.length > 160 || hasControlCharacter) {
    throw new Error('Use a one-line source title between 1 and 160 characters.');
  }
  return title;
}

/** A new readable capture invalidates passages and clears any previous fetch failure. */
function withoutDerivedEvidence(record: SourceRecord): SourceRecord {
  const next = { ...record };
  delete next.claims;
  delete next.fetchCheckedAt;
  delete next.fetchMessage;
  delete next.fetchState;
  delete next.fetchStatus;
  return next;
}

function portableStem(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 40)
      .replace(/-+$/u, '') || 'source'
  );
}

function parseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('That URL is not valid. Use a complete http:// or https:// address.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Dusori stores only http:// or https:// URL references.');
  }
  if (url.username || url.password) {
    throw new Error('Remove the username or password from this URL before saving it.');
  }
  return url.toString();
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function sourceExtension(input: AddSourceInput): 'md' | 'txt' {
  if (input.method === 'url' || input.mediaType === 'text/markdown') return 'md';
  return 'txt';
}

function parseManifest(content: string): SourceManifest {
  try {
    return SourceManifestSchema.parse(JSON.parse(content));
  } catch {
    throw new Error('The source manifest is invalid. Restore or re-import a valid workspace.');
  }
}

export async function readSourceManifest(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<SourceManifest> {
  const root = topicRoot(topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  return readMachineFile(storage, `${root}/Sources/manifest.json`, SourceManifestSchema, now);
}

export async function addSource(
  storage: StorageAdapter,
  input: AddSourceInput,
  now = new Date(),
): Promise<AddedSource> {
  const title = cleanTitle(input.title);
  const root = topicRoot(input.topicSlug);
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);

  const url = input.method === 'url' ? parseUrl(input.url) : undefined;
  const sourceContent =
    input.method === 'url'
      ? (input.content?.replace(/\r\n?/gu, '\n') ??
        `# ${title}\n\nOriginal URL: <${url}>\n\nDusori stored this reference without fetching its contents.\n`)
      : input.content.replace(/\r\n?/gu, '\n');
  if ((input.method !== 'url' || input.content !== undefined) && !sourceContent.trim()) {
    throw new Error('This source is empty. Paste text or choose a non-empty file.');
  }
  const size = byteLength(sourceContent);
  if (size > maxSourceBytes) {
    throw new Error('This source is larger than 2 MiB. Split it into smaller text files.');
  }

  const contentHash = await sha256(input.method === 'url' ? url! : sourceContent);
  const extension = sourceExtension(input);
  const path = normalizeWorkspacePath(
    `${root}/Sources/items/${contentHash.slice(0, 12)}-${portableStem(title)}.${extension}`,
  );
  const manifestPath = `${root}/Sources/manifest.json`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    const manifest = parseManifest(manifestFile.content);
    const duplicate = manifest.sources.find(
      (source) => source.method === input.method && source.sha256 === contentHash,
    );
    if (duplicate) {
      if (input.method === 'url' && input.content !== undefined && duplicate.path) {
        if (
          input.provenance?.readState === 'reference' &&
          (duplicate.readState === 'read' || duplicate.readState === 'readable')
        ) {
          return { deduplicated: true, path: duplicate.path, record: duplicate };
        }
        const itemFile = await storage.read(duplicate.path);
        if (!itemFile) {
          throw new Error(
            'This saved URL is missing its local source file. Restore it, then retry.',
          );
        }
        if (itemFile.content !== sourceContent) {
          await storage.write(duplicate.path, sourceContent, { expectedHash: itemFile.hash });
        }
        const preserved = withoutDerivedEvidence(duplicate);
        const provenance = input.provenance;
        const upgradedRecord = SourceRecordSchema.parse({
          ...preserved,
          author: provenance?.author ?? duplicate.author,
          fetchedAt: now.toISOString(),
          mediaType: 'text/markdown',
          origin: input.origin ?? duplicate.origin,
          publishedAt: provenance?.publishedAt ?? duplicate.publishedAt,
          publisher: provenance?.publisher ?? duplicate.publisher,
          readState: provenance?.readState ?? 'readable',
          size,
          title,
          url,
          whySelected: provenance?.whySelected ?? duplicate.whySelected,
        });
        const nextManifest = SourceManifestSchema.parse({
          ...manifest,
          schemaVersion,
          sources: manifest.sources.map((source) =>
            source === duplicate ? upgradedRecord : source,
          ),
          synthesisStaleAt: now.toISOString(),
          synthesisStaleReason: `Readable text was added for source: ${title}`,
        });
        try {
          await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
            expectedHash: manifestFile.hash,
          });
        } catch (error) {
          if (error instanceof StorageConflictError) continue;
          throw error;
        }
        let updatePath: string | undefined;
        let warning: string | undefined;
        try {
          updatePath = await appendTopicUpdate(
            storage,
            input.topicSlug,
            `- Added readable text to saved source **${title}**.`,
            now,
          );
        } catch {
          warning = 'The readable source was saved, but the activity log could not be updated.';
        }
        return {
          deduplicated: true,
          path: duplicate.path,
          record: upgradedRecord,
          updatePath,
          upgraded: true,
          warning,
        };
      }
      return { deduplicated: true, path: duplicate.path ?? path, record: duplicate };
    }

    const removed = (manifest.removedSources ?? []).find(
      (entry) => entry.record.method === input.method && entry.record.sha256 === contentHash,
    );
    if (removed) {
      const restoredPath = removed.record.path ?? path;
      if (
        input.method === 'url' &&
        input.provenance?.readState === 'reference' &&
        (removed.record.readState === 'read' || removed.record.readState === 'readable')
      ) {
        return {
          deduplicated: true,
          path: restoredPath,
          record: removed.record,
          tombstoned: true,
        };
      }
      let restoredRecord = removed.record;
      if (input.method === 'url' && input.content !== undefined) {
        const retained = await storage.read(restoredPath);
        await storage.write(restoredPath, sourceContent, {
          expectedHash: retained?.hash ?? null,
        });
        const preserved = withoutDerivedEvidence(removed.record);
        const provenance = input.provenance;
        restoredRecord = SourceRecordSchema.parse({
          ...preserved,
          author: provenance?.author,
          fetchedAt: now.toISOString(),
          mediaType: 'text/markdown',
          origin: input.origin,
          path: restoredPath,
          publishedAt: provenance?.publishedAt,
          publisher: provenance?.publisher,
          readState: provenance?.readState,
          size,
          title,
          url,
          whySelected: provenance?.whySelected,
        });
      }
      const nextManifest = SourceManifestSchema.parse({
        ...manifest,
        schemaVersion,
        removedSources: (manifest.removedSources ?? []).filter((entry) => entry !== removed),
        sources: [...manifest.sources, restoredRecord],
        synthesisStaleAt: now.toISOString(),
        synthesisStaleReason: 'A source was restored to this research.',
      });
      try {
        await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
          expectedHash: manifestFile.hash,
        });
      } catch (error) {
        if (error instanceof StorageConflictError) continue;
        throw error;
      }
      const relativePath = restoredPath.slice(`${root}/`.length).replace(/\.md$/u, '');
      let updatePath: string | undefined;
      let warning: string | undefined;
      try {
        updatePath = await appendTopicUpdate(
          storage,
          input.topicSlug,
          `- Restored source [[../../../${relativePath}|${title}]] to this research.`,
          now,
        );
      } catch {
        warning = 'The source was restored, but the activity log could not be updated.';
      }
      return {
        deduplicated: true,
        path: restoredPath,
        record: restoredRecord,
        restored: true,
        updatePath,
        warning,
      };
    }

    await storage.ensureDirectory(`${root}/Sources/items`);
    try {
      await storage.write(path, sourceContent, { expectedHash: null });
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
      const existing = await storage.read(path);
      if (!existing || existing.hash !== (await sha256(sourceContent))) throw error;
    }

    const provenance = input.method === 'url' ? input.provenance : undefined;
    const record = SourceRecordSchema.parse({
      author: provenance?.author,
      fetchedAt: now.toISOString(),
      mediaType: input.method === 'url' ? 'text/markdown' : (input.mediaType ?? 'text/plain'),
      method: input.method,
      originalName: input.method === 'file' ? input.originalName : undefined,
      origin: input.method === 'url' ? input.origin : undefined,
      path,
      publishedAt: provenance?.publishedAt,
      publisher: provenance?.publisher,
      readState: provenance?.readState,
      sha256: contentHash,
      size,
      title,
      tags: input.tags,
      url,
      whySelected: provenance?.whySelected,
    });
    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      schemaVersion,
      sources: [...manifest.sources, record],
      synthesisStaleAt: now.toISOString(),
      synthesisStaleReason: `Source added to research: ${title}`,
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
      continue;
    }

    // The source is committed once the manifest write succeeds. Activity-log failure is returned
    // as a warning so the UI never misreports a completed add as a failed one.
    const relativePath = path.slice(`${root}/`.length).replace(/\.md$/u, '');
    let updatePath: string | undefined;
    let warning: string | undefined;
    try {
      updatePath = await appendTopicUpdate(
        storage,
        input.topicSlug,
        `- Added ${input.method} source [[../../../${relativePath}|${title}]].`,
        now,
      );
    } catch {
      warning = 'The source was saved, but the activity log could not be updated.';
    }
    return { deduplicated: false, path, record, updatePath, warning };
  }

  throw new Error('The source manifest changed repeatedly. Try adding the source again.');
}

/**
 * Removes a source from active research without deleting its local item. The tombstone lives in
 * the same CAS-protected manifest, so navigation/relaunch can offer Restore without a second file
 * getting out of sync. Notes are never touched.
 */
export async function removeSourceFromResearch(
  storage: StorageAdapter,
  input: { topicSlug: string; sha256: string },
  now = new Date(),
): Promise<RemovedSourceResult> {
  const root = topicRoot(input.topicSlug);
  const manifestPath = `${root}/Sources/manifest.json`;
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    const manifest = parseManifest(manifestFile.content);
    const record = manifest.sources.find((source) => source.sha256 === input.sha256);
    if (!record) throw new Error('This source is no longer in the active research library.');
    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      removedSources: [
        ...(manifest.removedSources ?? []).filter((entry) => entry.record.sha256 !== record.sha256),
        { record, removedAt: now.toISOString() },
      ],
      schemaVersion,
      sources: manifest.sources.filter((source) => source.sha256 !== record.sha256),
      synthesisStaleAt: now.toISOString(),
      synthesisStaleReason: `Source removed from research: ${record.title}`,
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
    } catch (error) {
      if (error instanceof StorageConflictError) continue;
      throw error;
    }
    let updatePath: string | undefined;
    let warning: string | undefined;
    try {
      updatePath = await appendTopicUpdate(
        storage,
        input.topicSlug,
        `- Removed source **${record.title}** from active research. Its local item was retained for Restore.`,
        now,
      );
    } catch {
      warning = 'The source was removed, but the activity log could not be updated.';
    }
    return { record, retainedPath: record.path, updatePath, warning };
  }
  throw new Error('The source manifest changed repeatedly. Try removing the source again.');
}

export async function restoreSourceToResearch(
  storage: StorageAdapter,
  input: { topicSlug: string; sha256: string },
  now = new Date(),
): Promise<AddedSource> {
  const root = topicRoot(input.topicSlug);
  const manifestPath = `${root}/Sources/manifest.json`;
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    const manifest = parseManifest(manifestFile.content);
    const removed = (manifest.removedSources ?? []).find(
      (entry) => entry.record.sha256 === input.sha256,
    );
    if (!removed) throw new Error('This source is no longer available to restore.');
    if (removed.record.path && !(await storage.read(removed.record.path))) {
      throw new Error('The retained source item is missing. Add the source again instead.');
    }
    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      removedSources: (manifest.removedSources ?? []).filter((entry) => entry !== removed),
      schemaVersion,
      sources: [...manifest.sources, removed.record],
      synthesisStaleAt: now.toISOString(),
      synthesisStaleReason: `Source restored to research: ${removed.record.title}`,
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
    } catch (error) {
      if (error instanceof StorageConflictError) continue;
      throw error;
    }
    let updatePath: string | undefined;
    let warning: string | undefined;
    try {
      updatePath = await appendTopicUpdate(
        storage,
        input.topicSlug,
        `- Restored source **${removed.record.title}** to active research.`,
        now,
      );
    } catch {
      warning = 'The source was restored, but the activity log could not be updated.';
    }
    return {
      deduplicated: true,
      path: removed.record.path ?? '',
      record: removed.record,
      restored: true,
      updatePath,
      warning,
    };
  }
  throw new Error('The source manifest changed repeatedly. Try restoring the source again.');
}

export async function recordSourceFetchFailure(
  storage: StorageAdapter,
  input: {
    topicSlug: string;
    sha256: string;
    message: string;
    state: 'blocked' | 'failed';
    status?: number;
  },
  now = new Date(),
): Promise<SourceRecord> {
  const root = topicRoot(input.topicSlug);
  const manifestPath = `${root}/Sources/manifest.json`;
  await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) throw new Error(`Missing source manifest: ${manifestPath}`);
    const manifest = parseManifest(manifestFile.content);
    const record = manifest.sources.find((source) => source.sha256 === input.sha256);
    if (!record) throw new Error('This URL reference is no longer in the source library.');
    const nextRecord = SourceRecordSchema.parse({
      ...record,
      fetchCheckedAt: now.toISOString(),
      fetchMessage: input.message,
      fetchState: input.state,
      fetchStatus: input.status,
      readState: record.readState === 'read' ? 'read' : 'reference',
    });
    const nextManifest = SourceManifestSchema.parse({
      ...manifest,
      schemaVersion,
      sources: manifest.sources.map((source) =>
        source.sha256 === record.sha256 ? nextRecord : source,
      ),
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
      return nextRecord;
    } catch (error) {
      if (error instanceof StorageConflictError) continue;
      throw error;
    }
  }
  throw new Error('The source manifest changed repeatedly. Try fetching the source again.');
}

export async function clearSynthesisStale(
  storage: StorageAdapter,
  topicSlug: string,
  now = new Date(),
): Promise<void> {
  void now;
  const root = topicRoot(topicSlug);
  const manifestPath = `${root}/Sources/manifest.json`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const manifestFile = await storage.read(manifestPath);
    if (!manifestFile) return;
    const manifest = parseManifest(manifestFile.content);
    if (!manifest.synthesisStaleAt && !manifest.synthesisStaleReason) return;
    const { synthesisStaleAt: _at, synthesisStaleReason: _reason, ...rest } = manifest;
    void _at;
    void _reason;
    try {
      await storage.write(
        manifestPath,
        `${JSON.stringify(SourceManifestSchema.parse({ ...rest, schemaVersion }), null, 2)}\n`,
        { expectedHash: manifestFile.hash },
      );
      return;
    } catch (error) {
      if (error instanceof StorageConflictError) continue;
      throw error;
    }
  }
  throw new Error('The source manifest changed repeatedly while recording fresh synthesis.');
}
