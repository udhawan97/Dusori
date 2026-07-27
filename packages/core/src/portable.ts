import JSZip from 'jszip';

import type { StorageAdapter } from './adapters.js';
import { SourceManifestSchema, TopicStateSchema, WorkspaceSchema } from './schemas/workspace.js';
import { normalizeWorkspacePath, topicRoot } from './workspace/paths.js';

const maxWorkspaceFiles = 5_000;
const maxWorkspaceBytes = 64 * 1024 * 1024;

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

  const paths = new Set<string>();
  const files: WorkspaceImportFile[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const originalName =
      (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    const path = normalizeWorkspacePath(originalName);
    if (!path) continue;
    if (paths.has(path))
      throw new Error(`The workspace archive contains a duplicate path: ${path}`);
    paths.add(path);
    const content = await entry.async('string');
    totalBytes += new TextEncoder().encode(content).byteLength;
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
  const backup = await snapshotStorage(storage);
  try {
    await clearWorkspace(storage);
    await writeFiles(storage, prepared.files);
  } catch (error) {
    try {
      await clearWorkspace(storage);
      await writeFiles(storage, backup);
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'Workspace import failed and Dusori could not restore the previous workspace.',
        { cause: rollbackError },
      );
    }
    const message = error instanceof Error ? error.message : 'unknown storage error';
    throw new Error(`Workspace import failed; the previous workspace was restored: ${message}`, {
      cause: error,
    });
  }
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
