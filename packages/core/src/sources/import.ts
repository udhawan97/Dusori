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
      url: string;
    });

export interface AddedSource {
  deduplicated: boolean;
  path: string;
  record: SourceRecord;
  updatePath?: string;
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
      return { deduplicated: true, path: duplicate.path ?? path, record: duplicate };
    }

    await storage.ensureDirectory(`${root}/Sources/items`);
    try {
      await storage.write(path, sourceContent, { expectedHash: null });
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
      const existing = await storage.read(path);
      if (!existing || existing.hash !== (await sha256(sourceContent))) throw error;
    }

    const record = SourceRecordSchema.parse({
      fetchedAt: now.toISOString(),
      mediaType: input.method === 'url' ? 'text/markdown' : (input.mediaType ?? 'text/plain'),
      method: input.method,
      originalName: input.method === 'file' ? input.originalName : undefined,
      origin: input.method === 'url' ? input.origin : undefined,
      path,
      sha256: contentHash,
      size,
      title,
      url,
    });
    const nextManifest = SourceManifestSchema.parse({
      schemaVersion,
      sources: [...manifest.sources, record],
    });
    try {
      await storage.write(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, {
        expectedHash: manifestFile.hash,
      });
      const relativePath = path.slice(`${root}/`.length).replace(/\.md$/u, '');
      const updatePath = await appendTopicUpdate(
        storage,
        input.topicSlug,
        `- Added ${input.method} source [[../../../${relativePath}|${title}]].`,
        now,
      );
      return { deduplicated: false, path, record, updatePath };
    } catch (error) {
      if (!(error instanceof StorageConflictError) || attempt === 2) throw error;
    }
  }

  throw new Error('The source manifest changed repeatedly. Try adding the source again.');
}
