import type { FileSnapshot, StorageAdapter } from '../adapters.js';
import { sha256 } from '../hash.js';
import {
  firstNoteTemplate,
  homeTemplate,
  initialUpdateTemplate,
  overviewTemplate,
  roadmapTemplate,
  tutorTemplate,
} from '../notes/templates.js';
import {
  SourceManifestSchema,
  TopicStateSchema,
  WorkspaceSchema,
  schemaVersion,
  type TopicState,
  type Workspace,
} from '../schemas/workspace.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { slugify, topicRoot, updateLogPath } from './paths.js';

function fileVersion(snapshot: FileSnapshot): { hash: string; modifiedAt: number } {
  return { hash: snapshot.hash, modifiedAt: snapshot.modifiedAt };
}

async function writeJson(
  storage: StorageAdapter,
  path: string,
  value: unknown,
): Promise<FileSnapshot> {
  return storage.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function createWorkspace(
  storage: StorageAdapter,
  name = 'My learning workspace',
  now = new Date(),
): Promise<Workspace> {
  const existing = await storage.read('dusori.json');
  if (existing) return readMachineFile(storage, 'dusori.json', WorkspaceSchema, now);

  await storage.ensureDirectory('Topics');
  const timestamp = now.toISOString();
  const home = await storage.write('Home.md', homeTemplate(name, []), { expectedHash: null });
  const workspace: Workspace = {
    schemaVersion,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    topics: [],
    fileIndex: { 'Home.md': fileVersion(home) },
  };
  await writeJson(storage, 'dusori.json', workspace);
  return workspace;
}

export interface CreatedTopic {
  notePath: string;
  state: TopicState;
  topicSlug: string;
  updatePath: string;
  workspace: Workspace;
  workspaceHomeConflict: boolean;
}

export async function createTopic(
  storage: StorageAdapter,
  title: string,
  now = new Date(),
): Promise<CreatedTopic> {
  const workspace = await readMachineFile(storage, 'dusori.json', WorkspaceSchema, now);
  const slug = slugify(title);
  if (workspace.topics.some((topic) => topic.slug === slug)) {
    throw new Error(`A topic named ${title} already exists.`);
  }

  const root = topicRoot(slug);
  const directories = ['Notes', 'Updates', 'Sources', 'Backups'];
  await storage.ensureDirectory(root);
  await Promise.all(
    directories.map((directory) => storage.ensureDirectory(`${root}/${directory}`)),
  );

  const input = { createdAt: now.toISOString(), slug, title: title.trim() };
  const updatePath = updateLogPath(slug, now);
  await storage.ensureDirectory(updatePath.slice(0, updatePath.lastIndexOf('/')));

  const markdown = new Map<string, string>([
    [`${root}/Overview.md`, overviewTemplate(input)],
    [`${root}/roadmap.md`, roadmapTemplate(input)],
    [`${root}/TUTOR.md`, tutorTemplate(input)],
    [`${root}/Notes/001-first-look.md`, firstNoteTemplate(input)],
    [updatePath, initialUpdateTemplate(input)],
  ]);
  const snapshots = new Map<string, FileSnapshot>();
  for (const [path, content] of markdown) {
    snapshots.set(path, await storage.write(path, content, { expectedHash: null }));
  }

  const manifest = SourceManifestSchema.parse({ schemaVersion, sources: [] });
  await writeJson(storage, `${root}/Sources/manifest.json`, manifest);

  const fileIndex = Object.fromEntries(
    [...snapshots].map(([path, snapshot]) => [path, fileVersion(snapshot)]),
  );
  const state = TopicStateSchema.parse({
    schemaVersion,
    topicSlug: slug,
    status: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    fileIndex,
  });
  await writeJson(storage, `${root}/state.json`, state);

  const nextTopics = [
    ...workspace.topics,
    { createdAt: now.toISOString(), slug, title: title.trim() },
  ];
  const currentHome = await storage.read('Home.md');
  const expectedHome = workspace.fileIndex['Home.md'];
  let workspaceHomeConflict = false;
  let homeVersion = expectedHome;
  const nextHome = homeTemplate(workspace.name, nextTopics);
  if (currentHome && expectedHome && currentHome.hash === expectedHome.hash) {
    const writtenHome = await storage.write('Home.md', nextHome, {
      expectedHash: expectedHome.hash,
    });
    homeVersion = fileVersion(writtenHome);
  } else {
    workspaceHomeConflict = true;
    const proposal = await storage.write(
      `Home.proposed-${now.toISOString().slice(0, 10)}.md`,
      nextHome,
      {
        expectedHash: null,
      },
    );
    homeVersion ??= fileVersion(proposal);
  }

  const nextWorkspace = WorkspaceSchema.parse({
    ...workspace,
    updatedAt: now.toISOString(),
    topics: nextTopics,
    fileIndex: homeVersion
      ? { ...workspace.fileIndex, 'Home.md': homeVersion }
      : workspace.fileIndex,
  });
  const currentWorkspaceFile = await storage.read('dusori.json');
  await storage.write('dusori.json', `${JSON.stringify(nextWorkspace, null, 2)}\n`, {
    expectedHash: currentWorkspaceFile?.hash,
  });

  return {
    notePath: `${root}/Notes/001-first-look.md`,
    state,
    topicSlug: slug,
    updatePath,
    workspace: nextWorkspace,
    workspaceHomeConflict,
  };
}

export async function workspaceFingerprint(storage: StorageAdapter): Promise<string> {
  const entries = (await storage.list('', true))
    .filter((entry) => entry.kind === 'file')
    .sort((left, right) => left.path.localeCompare(right.path));
  const parts: string[] = [];
  for (const entry of entries) {
    const file = await storage.read(entry.path);
    if (file) parts.push(`${entry.path}:${file.hash}`);
  }
  return sha256(parts.join('\n'));
}
