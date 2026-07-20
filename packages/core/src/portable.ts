import JSZip from 'jszip';

import type { StorageAdapter } from './adapters.js';
import { readMachineFile } from './schemas/read-machine-file.js';
import { SourceManifestSchema, TopicStateSchema, WorkspaceSchema } from './schemas/workspace.js';
import { normalizeWorkspacePath } from './workspace/paths.js';

export async function exportWorkspace(storage: StorageAdapter): Promise<Uint8Array> {
  const zip = new JSZip();
  const files = (await storage.list('', true)).filter((entry) => entry.kind === 'file');
  for (const entry of files) {
    const snapshot = await storage.read(entry.path);
    if (snapshot) zip.file(entry.path, snapshot.content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function importWorkspace(
  storage: StorageAdapter,
  archive: Uint8Array | ArrayBuffer,
): Promise<void> {
  const zip = await JSZip.loadAsync(archive);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    const path = normalizeWorkspacePath(entry.name);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parent) await storage.ensureDirectory(parent);
    await storage.write(path, await entry.async('string'), { expectedHash: null });
  }

  const workspace = await readMachineFile(storage, 'dusori.json', WorkspaceSchema);
  for (const topic of workspace.topics) {
    const root = `Topics/${topic.slug}`;
    await readMachineFile(storage, `${root}/state.json`, TopicStateSchema);
    await readMachineFile(storage, `${root}/Sources/manifest.json`, SourceManifestSchema);
  }
}

export async function clearWorkspace(storage: StorageAdapter): Promise<void> {
  const entries = (await storage.list('', false)).sort(
    (left, right) => right.path.length - left.path.length,
  );
  for (const entry of entries) await storage.remove(entry.path, true);
}
