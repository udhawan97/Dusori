import type { StorageAdapter } from '../adapters.js';
import { appendTopicUpdate } from '../conflict/write-protocol.js';
import { readMachineFile } from '../schemas/read-machine-file.js';
import { TopicStateSchema, type TopicState } from '../schemas/workspace.js';
import { slugify, topicRoot } from '../workspace/paths.js';

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

export async function createNote(
  storage: StorageAdapter,
  topicSlug: string,
  titleInput: string,
  now = new Date(),
): Promise<CreatedNote> {
  const title = cleanNoteTitle(titleInput);
  const root = topicRoot(topicSlug);
  const path = `${root}/Notes/${slugify(title)}.md`;
  if (await storage.read(path)) throw new Error(`A note named “${title}” already exists.`);

  const statePath = `${root}/state.json`;
  const stateFile = await storage.read(statePath);
  if (!stateFile) throw new Error('The topic state is missing.');
  const state = await readMachineFile(storage, statePath, TopicStateSchema, now);
  const content = noteTemplate(title, topicSlug, now);
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
      `- Created [[../../../Notes/${slugify(title)}|${title}]].`,
      now,
    );
    return { content, path, state: nextState, updatePath };
  } catch (error) {
    if (!stateWritten) await storage.remove(path);
    throw new Error('Dusori could not finish creating the note.', { cause: error });
  }
}
