import type { StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, type TopicState } from '../schemas/workspace.js';
import { normalizeWorkspacePath, slugify, topicRoot } from '../workspace/paths.js';

export interface CreatedNote {
  content: string;
  path: string;
  state: TopicState;
  updatePath: string;
}

function cleanNoteTitle(input: string): string {
  const title = input.trim();
  const hasControlCharacter = [...title].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (!title || title.length > 160 || hasControlCharacter) {
    throw new Error('Use a one-line note title between 1 and 160 characters.');
  }
  return title;
}

function noteTemplate(title: string, topicSlug: string, now: Date): string {
  return `---\ntitle: ${JSON.stringify(title)}\ntopic: ${topicSlug}\ncreated: ${now.toISOString().slice(0, 10)}\n---\n\n# ${title}\n\nStart with one idea, one source, and one question.\n`;
}

export interface CreateNoteOptions {
  /**
   * Complete note body, frontmatter included, for callers that generate a note rather than
   * opening a blank one. The caller owns the whole document so a generated note can mark
   * itself as generated in its own frontmatter.
   */
  content?: string;
  /**
   * Where inside the topic to create the note, relative to the topic root, defaulting to
   * `Notes/<slug>.md`. A caller that must land on an exact filename — creating the file a
   * wikilink already names, where slugifying would leave the link unresolved — sets it here.
   * The path must stay inside the topic and end in `.md`.
   */
  relativePath?: string;
}

export async function createNote(
  storage: StorageAdapter,
  topicSlug: string,
  titleInput: string,
  now = new Date(),
  options: CreateNoteOptions = {},
): Promise<CreatedNote> {
  const title = cleanNoteTitle(titleInput);
  const root = topicRoot(topicSlug);
  const relative = options.relativePath ?? `Notes/${slugify(title)}.md`;
  const path = normalizeWorkspacePath(`${root}/${relative}`);
  if (!path.startsWith(`${root}/`) || !path.endsWith('.md')) {
    throw new Error('A note must be created inside its topic as Markdown.');
  }
  if (await storage.read(path)) throw new Error(`A note named “${title}” already exists.`);

  const statePath = `${root}/state.json`;
  const stateFile = await storage.read(statePath);
  if (!stateFile) throw new Error('The topic state is missing.');
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  const content = options.content ?? noteTemplate(title, topicSlug, now);
  const parent = path.slice(0, path.lastIndexOf('/'));
  await storage.ensureDirectory(parent);
  const written = await storage.write(path, content, { expectedHash: null });

  let stateWritten = false;
  try {
    const nextState = TopicStateSchema.parse({
      ...state,
      updatedAt: now.toISOString(),
      fileIndex: {
        ...state.fileIndex,
        [path]: { hash: written.hash, modifiedAt: written.modifiedAt },
      },
    });
    await storage.write(statePath, `${JSON.stringify(nextState, null, 2)}\n`, {
      expectedHash: stateFile.hash,
    });
    stateWritten = true;
    const updatePath = await appendTopicUpdate(
      storage,
      topicSlug,
      `- Created [[../../../${path.slice(root.length + 1).replace(/\.md$/u, '')}|${title}]].`,
      now,
    );
    return { content, path, state: nextState, updatePath };
  } catch (error) {
    if (!stateWritten) await storage.remove(path);
    throw new Error('Dusori could not finish creating the note.', { cause: error });
  }
}
