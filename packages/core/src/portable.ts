import JSZip from 'jszip';

import type { StorageAdapter } from './adapters.js';
import { ProposalLedgerSchema } from './conflict/proposal-ledger.js';
import { SourceManifestSchema, TopicStateSchema, WorkspaceSchema } from './schemas/workspace.js';
import { normalizeWorkspacePath, topicRoot } from './workspace/paths.js';

const maxWorkspaceFiles = 5_000;
const maxWorkspaceBytes = 64 * 1024 * 1024;
const maxWorkspaceFileBytes = 8 * 1024 * 1024;
const maxArchiveCompressionRatio = 200;
const maxWorkspacePathBytes = 640;
const maxWorkspacePathSegments = 16;
export const workspaceImportRecoveryRoot = '.dusori-import-recovery';

interface WorkspaceImportFile {
  content: string;
  path: string;
}

export interface WorkspaceImportPreview {
  fileCount: number;
  topicCount: number;
  totalBytes: number;
  workspaceName: string;
}

export interface PreparedWorkspaceImport {
  readonly files: readonly WorkspaceImportFile[];
  readonly preview: WorkspaceImportPreview;
}

interface ZipEntrySizeMetadata {
  compressedSize?: number;
  uncompressedSize?: number;
}

function entrySizeMetadata(entry: JSZip.JSZipObject): ZipEntrySizeMetadata {
  // JSZip does not expose central-directory sizes in its public type, but it has already parsed
  // and bounds-checked these numeric fields before returning from loadAsync. Reading them lets us
  // reject an archive bomb before `entry.async()` allocates the expanded string.
  return (entry as JSZip.JSZipObject & { _data?: ZipEntrySizeMetadata })._data ?? {};
}

function preflightArchiveEntries(entries: readonly JSZip.JSZipObject[]): void {
  let declaredExpandedBytes = 0;
  for (const entry of entries) {
    const { compressedSize, uncompressedSize } = entrySizeMetadata(entry);
    if (
      typeof compressedSize !== 'number' ||
      !Number.isSafeInteger(compressedSize) ||
      compressedSize < 0 ||
      typeof uncompressedSize !== 'number' ||
      !Number.isSafeInteger(uncompressedSize) ||
      uncompressedSize < 0
    ) {
      throw new Error('The workspace archive has invalid size metadata.');
    }
    if (uncompressedSize > maxWorkspaceFileBytes) {
      throw new Error('A file in this workspace expands beyond the 8 MiB per-file limit.');
    }
    declaredExpandedBytes += uncompressedSize;
    if (declaredExpandedBytes > maxWorkspaceBytes) {
      throw new Error('The expanded workspace is larger than 64 MiB.');
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      uncompressedSize / Math.max(1, compressedSize) > maxArchiveCompressionRatio
    ) {
      throw new Error('The workspace archive uses an unsafe compression ratio.');
    }
  }
}

function parseJsonFile(files: Map<string, string>, path: string, label: string): unknown {
  const content = files.get(path);
  if (content === undefined) throw new Error(`The import is missing ${label}: ${path}`);
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`The import's ${label} is invalid JSON: ${path}`);
  }
}

function validatePreparedFiles(files: readonly WorkspaceImportFile[]): WorkspaceImportPreview {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const workspaceResult = WorkspaceSchema.safeParse(
    parseJsonFile(byPath, 'dusori.json', 'workspace index'),
  );
  if (!workspaceResult.success) throw new Error("The import's workspace index is invalid.");

  for (const topic of workspaceResult.data.topics) {
    const root = `Topics/${topic.slug}`;
    for (const required of ['Overview.md', 'roadmap.md', 'TUTOR.md']) {
      const path = `${root}/${required}`;
      if (!byPath.has(path))
        throw new Error(`The import is missing a required topic file: ${path}`);
    }

    const stateResult = TopicStateSchema.safeParse(
      parseJsonFile(byPath, `${root}/state.json`, 'topic state'),
    );
    if (!stateResult.success || stateResult.data.topicSlug !== topic.slug) {
      throw new Error(`The import's topic state is invalid: ${topic.slug}`);
    }

    const manifestResult = SourceManifestSchema.safeParse(
      parseJsonFile(byPath, `${root}/Sources/manifest.json`, 'source manifest'),
    );
    if (!manifestResult.success) {
      throw new Error(`The import's source manifest is invalid: ${topic.slug}`);
    }
    for (const source of manifestResult.data.sources) {
      const sourcePath = source.path?.startsWith('Topics/')
        ? source.path
        : source.path
          ? `${root}/${source.path}`
          : undefined;
      if (sourcePath && !byPath.has(sourcePath)) {
        throw new Error(`The import is missing a recorded source file: ${sourcePath}`);
      }
    }

    const proposalLedgerPath = `${root}/proposals.json`;
    if (byPath.has(proposalLedgerPath)) {
      const proposalResult = ProposalLedgerSchema.safeParse(
        parseJsonFile(byPath, proposalLedgerPath, 'proposal ledger'),
      );
      if (!proposalResult.success || proposalResult.data.topicSlug !== topic.slug) {
        throw new Error(`The import's proposal ledger is invalid: ${topic.slug}`);
      }
      for (const proposal of proposalResult.data.proposals.filter(
        (entry) => entry.resolution === 'pending',
      )) {
        for (const path of [proposal.currentPath, proposal.proposalPath]) {
          if (!byPath.has(path)) {
            throw new Error(`The import is missing a pending proposal file: ${path}`);
          }
        }
      }
    }
  }

  return {
    fileCount: files.length,
    topicCount: workspaceResult.data.topics.length,
    totalBytes: files.reduce(
      (total, file) => total + new TextEncoder().encode(file.content).byteLength,
      0,
    ),
    workspaceName: workspaceResult.data.name,
  };
}

async function snapshotStorage(storage: StorageAdapter): Promise<WorkspaceImportFile[]> {
  const files = (await storage.list('', true))
    .filter((entry) => entry.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path));
  const snapshots: WorkspaceImportFile[] = [];
  for (const entry of files) {
    const snapshot = await storage.read(entry.path);
    if (snapshot) snapshots.push({ content: snapshot.content, path: entry.path });
  }
  return snapshots;
}

async function writeFiles(
  storage: StorageAdapter,
  files: readonly WorkspaceImportFile[],
): Promise<void> {
  for (const file of files) {
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    if (parent) await storage.ensureDirectory(parent);
    await storage.write(file.path, file.content, { expectedHash: null });
  }
}

function prefixedFiles(
  prefix: string,
  files: readonly WorkspaceImportFile[],
): WorkspaceImportFile[] {
  return files.map((file) => ({ content: file.content, path: `${prefix}/${file.path}` }));
}

async function clearLiveWorkspace(storage: StorageAdapter): Promise<void> {
  const entries = (await storage.list('', false))
    .filter((entry) => entry.path !== workspaceImportRecoveryRoot)
    .sort((left, right) => right.path.length - left.path.length);
  for (const entry of entries) await storage.remove(entry.path, true);
}

export async function exportWorkspace(storage: StorageAdapter): Promise<Uint8Array> {
  const zip = new JSZip();
  const files = (await storage.list('', true)).filter((entry) => entry.kind === 'file');
  for (const entry of files) {
    const snapshot = await storage.read(entry.path);
    if (snapshot) zip.file(entry.path, snapshot.content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * One topic as a portable bundle. This is deliberately not a workspace archive: importing a topic
 * into an existing workspace needs merge rules — what happens to a slug that already exists, how
 * two `state.json` files reconcile — that do not exist yet. The bundle carries a note saying so,
 * because a zip full of familiar-looking paths otherwise reads as something Dusori can import.
 */
export async function exportTopic(storage: StorageAdapter, slug: string): Promise<Uint8Array> {
  // topicRoot slugifies, so a traversal attempt resolves to an ordinary topic path or to nothing.
  const root = topicRoot(slug);
  const entries = (await storage.list('', true)).filter(
    (entry) => entry.kind === 'file' && entry.path.startsWith(`${root}/`),
  );
  if (entries.length === 0) throw new Error(`That topic has no files to export: ${root}`);

  const zip = new JSZip();
  for (const entry of entries) {
    const snapshot = await storage.read(entry.path);
    if (snapshot) zip.file(entry.path, snapshot.content);
  }
  zip.file(
    'TOPIC-BUNDLE.md',
    `# Topic bundle: ${root.slice('Topics/'.length)}\n\n` +
      'This archive holds one Dusori topic. It is **not a complete workspace**, so Dusori cannot ' +
      'import it the way it imports a workspace archive.\n\n' +
      'The files are ordinary Markdown and JSON. Copy the `Topics/` folder into another Dusori ' +
      'workspace, or read them in any editor.\n',
  );
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function prepareWorkspaceImport(
  archive: Uint8Array | ArrayBuffer,
): Promise<PreparedWorkspaceImport> {
  if (archive.byteLength > maxWorkspaceBytes) {
    throw new Error('This workspace archive is larger than 64 MiB.');
  }
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > maxWorkspaceFiles) {
    throw new Error(
      `This workspace contains more than ${maxWorkspaceFiles.toLocaleString()} files.`,
    );
  }
  preflightArchiveEntries(entries);

  const paths = new Set<string>();
  const files: WorkspaceImportFile[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const originalName =
      (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    if (
      new TextEncoder().encode(originalName).byteLength > maxWorkspacePathBytes ||
      originalName.replaceAll('\\', '/').split('/').filter(Boolean).length >
        maxWorkspacePathSegments
    ) {
      throw new Error('The workspace archive contains an excessively deep or long path.');
    }
    const path = normalizeWorkspacePath(originalName);
    if (!path) continue;
    if (paths.has(path))
      throw new Error(`The workspace archive contains a duplicate path: ${path}`);
    paths.add(path);
    const content = await entry.async('string');
    const contentBytes = new TextEncoder().encode(content).byteLength;
    if (contentBytes > maxWorkspaceFileBytes) {
      throw new Error('A file in this workspace expands beyond the 8 MiB per-file limit.');
    }
    totalBytes += contentBytes;
    if (totalBytes > maxWorkspaceBytes) {
      throw new Error('The expanded workspace is larger than 64 MiB.');
    }
    files.push({ content, path });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return { files, preview: validatePreparedFiles(files) };
}

export async function replaceWorkspace(
  storage: StorageAdapter,
  prepared: PreparedWorkspaceImport,
): Promise<void> {
  if ((await storage.list('', false)).some((entry) => entry.path === workspaceImportRecoveryRoot)) {
    throw new Error(
      `A previous import left a durable recovery copy at ${workspaceImportRecoveryRoot}. Export or recover it before replacing this workspace again.`,
    );
  }
  const backup = await snapshotStorage(storage);
  const backupRoot = `${workspaceImportRecoveryRoot}/backup`;
  const stagedRoot = `${workspaceImportRecoveryRoot}/staged`;

  // Both complete copies are written before the first live file is removed. If staging itself
  // fails, the original workspace is still untouched. The backup stays in the same durable
  // storage adapter until the replacement has fully committed.
  try {
    await storage.ensureDirectory(backupRoot);
    await writeFiles(storage, prefixedFiles(backupRoot, backup));
    await storage.ensureDirectory(stagedRoot);
    await writeFiles(storage, prefixedFiles(stagedRoot, prepared.files));
  } catch (stagingError) {
    await storage.remove(workspaceImportRecoveryRoot, true).catch(() => undefined);
    throw new Error(
      `Workspace import could not be staged; the current workspace was not changed: ${stagingError instanceof Error ? stagingError.message : 'unknown storage error'}`,
      { cause: stagingError },
    );
  }

  try {
    await clearLiveWorkspace(storage);
    await writeFiles(storage, prepared.files);
  } catch (commitError) {
    try {
      await clearLiveWorkspace(storage);
      await writeFiles(storage, backup);
    } catch (rollbackError) {
      throw new AggregateError(
        [commitError, rollbackError],
        `Workspace import failed and automatic restoration also failed. The untouched durable backup remains at ${backupRoot}.`,
        { cause: rollbackError },
      );
    }
    await storage.remove(workspaceImportRecoveryRoot, true).catch(() => undefined);
    const message = commitError instanceof Error ? commitError.message : 'unknown storage error';
    throw new Error(`Workspace import failed; the previous workspace was restored: ${message}`, {
      cause: commitError,
    });
  }

  await storage.remove(workspaceImportRecoveryRoot, true);
}

export async function importWorkspace(
  storage: StorageAdapter,
  archive: Uint8Array | ArrayBuffer,
): Promise<void> {
  await replaceWorkspace(storage, await prepareWorkspaceImport(archive));
}

export async function clearWorkspace(storage: StorageAdapter): Promise<void> {
  const entries = (await storage.list('', false)).sort(
    (left, right) => right.path.length - left.path.length,
  );
  for (const entry of entries) await storage.remove(entry.path, true);
}
