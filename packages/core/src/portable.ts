import JSZip from 'jszip';

import type { StorageAdapter } from './adapters.js';
import { ProposalLedgerSchema } from './conflict/proposal-ledger.js';
import { ResearchFileSchema } from './research/research-file.js';
import { SourceManifestSchema, TopicStateSchema, WorkspaceSchema } from './schemas/workspace.js';
import { normalizeWorkspacePath, topicRoot } from './workspace/paths.js';
import { coordinateStorage } from './workspace/coordinated-storage.js';

const maxWorkspaceFiles = 5_000;
const maxWorkspaceBytes = 64 * 1024 * 1024;
const maxWorkspaceFileBytes = 8 * 1024 * 1024;
const maxArchiveCompressionRatio = 200;
const maxWorkspacePathBytes = 640;
const maxWorkspacePathSegments = 16;
export const workspaceImportRecoveryRoot = '.dusori-import-recovery';
const reservedWorkspaceRoots = new Set([workspaceImportRecoveryRoot, '.dusori-recovery']);

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

    const researchPath = `${root}/research.json`;
    if (byPath.has(researchPath)) {
      const researchResult = ResearchFileSchema.safeParse(
        parseJsonFile(byPath, researchPath, 'research activity'),
      );
      if (!researchResult.success || researchResult.data.topicSlug !== topic.slug) {
        throw new Error(`The import's research activity is invalid: ${topic.slug}`);
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

async function snapshotStorage(
  storage: StorageAdapter,
  excludeInternalRecovery = false,
): Promise<WorkspaceImportFile[]> {
  const files = (await storage.list('', true))
    .filter(
      (entry) =>
        entry.kind === 'file' && (!excludeInternalRecovery || !isReservedWorkspacePath(entry.path)),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const snapshots: WorkspaceImportFile[] = [];
  for (const entry of files) {
    const snapshot = await storage.read(entry.path);
    if (snapshot) snapshots.push({ content: snapshot.content, path: entry.path });
  }
  return snapshots;
}

function snapshotsMatch(
  left: readonly WorkspaceImportFile[],
  right: readonly WorkspaceImportFile[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (file, index) => file.path === right[index]?.path && file.content === right[index]?.content,
    )
  );
}

function isSnapshotSubset(
  subset: readonly WorkspaceImportFile[],
  complete: readonly WorkspaceImportFile[],
): boolean {
  const byPath = new Map(complete.map((file) => [file.path, file.content]));
  return subset.every((file) => byPath.get(file.path) === file.content);
}

function archiveAliasKey(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.normalize('NFC').toLowerCase())
    .join('/');
}

function isReservedWorkspacePath(path: string): boolean {
  return reservedWorkspaceRoots.has(archiveAliasKey(path).split('/')[0] ?? '');
}

function registerArchivePath(path: string, aliases: Map<string, string>): void {
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      throw new Error(`The workspace archive contains a non-portable path: ${path}`);
    }
  }

  const key = archiveAliasKey(path);
  const root = key.split('/')[0] ?? '';
  if (reservedWorkspaceRoots.has(root)) {
    throw new Error(`The workspace archive uses Dusori's reserved recovery path: ${path}`);
  }
  const existing = aliases.get(key);
  if (existing) {
    throw new Error(`The workspace archive contains aliased paths: ${existing} and ${path}`);
  }
  for (let index = 1; index < segments.length; index += 1) {
    const ancestorKey = archiveAliasKey(segments.slice(0, index).join('/'));
    const ancestor = aliases.get(ancestorKey);
    if (ancestor) {
      throw new Error(`The workspace archive uses a file as a directory: ${ancestor} and ${path}`);
    }
  }
  const descendant = [...aliases.entries()].find(([candidate]) => candidate.startsWith(`${key}/`));
  if (descendant) {
    throw new Error(
      `The workspace archive uses a file as a directory: ${path} and ${descendant[1]}`,
    );
  }
  aliases.set(key, path);
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

async function restoreRelocatedWorkspace(
  storage: StorageAdapter,
  recoveryRoot: string,
  files: readonly WorkspaceImportFile[],
): Promise<void> {
  for (const file of files) {
    if (await storage.read(file.path)) {
      throw new Error(
        `Workspace recovery stopped because ${file.path} was recreated externally. Its pre-replacement bytes remain at ${recoveryRoot}/${file.path}.`,
      );
    }
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
    if (parent) await storage.ensureDirectory(parent);
    await storage.move(`${recoveryRoot}/${file.path}`, file.path);
  }
}

async function relocateLiveWorkspace(
  storage: StorageAdapter,
  recoveryRoot: string,
  expected: readonly WorkspaceImportFile[],
): Promise<WorkspaceImportFile[]> {
  const entries = (await storage.list('', true)).filter(
    (entry) => !isReservedWorkspacePath(entry.path),
  );
  const files = entries
    .filter((entry) => entry.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path));
  const relocated: WorkspaceImportFile[] = [];

  try {
    for (const entry of files) {
      const destination = `${recoveryRoot}/${entry.path}`;
      const parent = destination.slice(0, destination.lastIndexOf('/'));
      await storage.ensureDirectory(parent);
      await storage.move(entry.path, destination);
      const snapshot = await storage.read(destination);
      if (!snapshot) throw new Error(`Workspace file disappeared while moving it: ${entry.path}`);
      relocated.push({ content: snapshot.content, path: entry.path });
    }

    const directories = entries
      .filter((entry) => entry.kind === 'directory')
      .sort((left, right) => right.path.length - left.path.length);
    for (const entry of directories) await storage.remove(entry.path, false);

    const remaining = await snapshotStorage(storage, true);
    if (remaining.length > 0 || !snapshotsMatch(expected, relocated)) {
      throw new Error('The workspace changed immediately before replacement.');
    }
    return relocated;
  } catch (error) {
    try {
      await restoreRelocatedWorkspace(storage, recoveryRoot, relocated);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Workspace import stopped after a late external edit. Live bytes were preserved, and any displaced bytes remain at ${recoveryRoot}.`,
        { cause: restoreError },
      );
    }
    throw error;
  }
}

export async function exportWorkspace(storage: StorageAdapter): Promise<Uint8Array> {
  const zip = new JSZip();
  // Recovery archives belong to this device's repair workflow, not to an importable workspace.
  // Exporting must leave those live copies untouched while producing an archive we can import.
  const files = (await storage.list('', true)).filter(
    (entry) => entry.kind === 'file' && !isReservedWorkspacePath(entry.path),
  );
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
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(archive);
  } catch (cause) {
    throw new Error(
      'This file is not a valid Dusori workspace export. Choose a .zip exported by Dusori and try again.',
      { cause },
    );
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > maxWorkspaceFiles) {
    throw new Error(
      `This workspace contains more than ${maxWorkspaceFiles.toLocaleString()} files.`,
    );
  }
  preflightArchiveEntries(entries);

  const aliases = new Map<string, string>();
  const validatedEntries: { entry: JSZip.JSZipObject; path: string }[] = [];
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
    registerArchivePath(path, aliases);
    validatedEntries.push({ entry, path });
  }
  // Check the complete path set before allocating any expanded file content.
  for (const { entry, path } of validatedEntries) {
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

async function replaceWorkspaceUnlocked(
  storage: StorageAdapter,
  prepared: PreparedWorkspaceImport,
): Promise<void> {
  if (
    (await storage.list('', false)).some(
      (entry) => archiveAliasKey(entry.path) === workspaceImportRecoveryRoot,
    )
  ) {
    throw new Error(
      `A previous import left a durable recovery copy at ${workspaceImportRecoveryRoot}. Recover or copy that directory separately before replacing this workspace again; normal workspace exports omit internal recovery copies.`,
    );
  }
  if (storage.supportsSafeWorkspaceRelocation !== true) {
    throw new Error(
      'This storage target cannot safely replace the workspace because it does not guarantee safe file relocation. The current workspace was not changed.',
    );
  }
  const backup = await snapshotStorage(storage, true);
  const backupRoot = `${workspaceImportRecoveryRoot}/backup`;
  const commitRoot = `${workspaceImportRecoveryRoot}/commit`;
  const failedRoot = `${workspaceImportRecoveryRoot}/failed-import`;
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

  const current = await snapshotStorage(storage, true);
  if (!snapshotsMatch(backup, current)) {
    await storage.remove(workspaceImportRecoveryRoot, true).catch(() => undefined);
    throw new Error(
      'Workspace import stopped because the current workspace changed while the replacement was being staged. No live workspace files were removed.',
    );
  }

  let relocated: WorkspaceImportFile[];
  try {
    relocated = await relocateLiveWorkspace(storage, commitRoot, backup);
  } catch (commitGuardError) {
    throw new Error(
      `Workspace import stopped because the current workspace changed immediately before replacement. Recovery copies remain at ${workspaceImportRecoveryRoot}: ${commitGuardError instanceof Error ? commitGuardError.message : 'unknown storage error'}`,
      { cause: commitGuardError },
    );
  }

  try {
    await writeFiles(storage, prepared.files);
  } catch (commitError) {
    let displacedImport: WorkspaceImportFile[];
    try {
      const failedImport = await snapshotStorage(storage, true);
      displacedImport = await relocateLiveWorkspace(storage, failedRoot, failedImport);
      await restoreRelocatedWorkspace(storage, commitRoot, relocated);
    } catch (rollbackError) {
      throw new AggregateError(
        [commitError, rollbackError],
        `Workspace import failed and automatic restoration also failed. The untouched durable backup remains at ${backupRoot}.`,
        { cause: rollbackError },
      );
    }
    if (isSnapshotSubset(displacedImport, prepared.files)) {
      await storage.remove(workspaceImportRecoveryRoot, true).catch(() => undefined);
    }
    const message = commitError instanceof Error ? commitError.message : 'unknown storage error';
    const recoveryNote = isSnapshotSubset(displacedImport, prepared.files)
      ? ''
      : ` External or unexpected bytes remain at ${workspaceImportRecoveryRoot}.`;
    throw new Error(
      `Workspace import failed; the previous workspace was restored: ${message}.${recoveryNote}`,
      { cause: commitError },
    );
  }

  await storage.remove(workspaceImportRecoveryRoot, true);
}

export async function replaceWorkspace(
  storage: StorageAdapter,
  prepared: PreparedWorkspaceImport,
): Promise<void> {
  const coordinated = coordinateStorage(storage);
  return coordinated.runExclusiveWorkspaceMutation((inner) =>
    replaceWorkspaceUnlocked(inner, prepared),
  );
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
