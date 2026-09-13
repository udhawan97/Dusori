import type { StorageAdapter } from './adapters.js';
import { readMachineFile } from './schemas/read-machine-file.js';
import {
  SourceManifestSchema,
  TopicStateSchema,
  WorkspaceSchema,
} from './schemas/workspace.js';
import { topicRoot } from './workspace/paths.js';

export interface TopicSection {
  path: string;
  title: string;
  markdown: string;
}

export interface TopicDocument {
  slug: string;
  title: string;
  createdAt: string;
  status: string;
  sections: TopicSection[];
  sources: { title: string; url?: string }[];
}

/** Top-level topic files, in reading order. Notes follow, sorted by filename. */
const orderedTopLevel = ['Overview.md', 'roadmap.md', 'TUTOR.md', 'Synthesis.md'];

function sectionTitle(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/u, '');
}

/**
 * Reads one topic into a format-neutral document: its metadata, readable Markdown sections, and
 * its source list. The format renderers below turn this into Markdown, plain text, or JSON without
 * touching storage again.
 */
export async function collectTopicDocument(
  storage: StorageAdapter,
  slug: string,
  now = new Date(),
): Promise<TopicDocument> {
  const workspace = await readMachineFile(storage, 'dusori.json', WorkspaceSchema, now);
  const index = workspace.topics.find((topic) => topic.slug === slug);
  if (!index) throw new Error(`There is no topic named ${slug} to export.`);

  const root = topicRoot(slug);
  const state = await readMachineFile(storage, `${root}/state.json`, TopicStateSchema, now);

  const sections: TopicSection[] = [];
  for (const name of orderedTopLevel) {
    const file = await storage.read(`${root}/${name}`);
    if (file) sections.push({ path: `${root}/${name}`, title: sectionTitle(name), markdown: file.content });
  }
  const notes = (await storage.list(`${root}/Notes`, true))
    .filter((entry) => entry.kind === 'file' && entry.path.endsWith('.md'))
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const entry of notes) {
    const file = await storage.read(entry.path);
    if (file) sections.push({ path: entry.path, title: sectionTitle(entry.path), markdown: file.content });
  }

  const manifestFile = await storage.read(`${root}/Sources/manifest.json`);
  const sources: TopicDocument['sources'] = [];
  if (manifestFile) {
    const manifest = SourceManifestSchema.parse(JSON.parse(manifestFile.content));
    for (const source of manifest.sources) {
      sources.push(source.url ? { title: source.title, url: source.url } : { title: source.title });
    }
  }

  return {
    slug,
    title: index.title,
    createdAt: state.createdAt,
    status: state.status,
    sections,
    sources,
  };
}

export function topicToMarkdown(doc: TopicDocument): string {
  const parts = [
    `# ${doc.title}`,
    `> Exported from Dusori · ${doc.status} · created ${doc.createdAt.slice(0, 10)}`,
  ];
  for (const section of doc.sections) {
    parts.push(`## ${section.title}`, section.markdown.trim());
  }
  if (doc.sources.length > 0) {
    parts.push(
      '## Sources',
      doc.sources
        .map((source) => (source.url ? `- ${source.title} — ${source.url}` : `- ${source.title}`))
        .join('\n'),
    );
  }
  return `${parts.join('\n\n')}\n`;
}

export function topicToText(doc: TopicDocument): string {
  return topicToMarkdown(doc)
    .replace(/^#{1,6}\s+/gmu, '') // heading markers
    .replace(/^>\s?/gmu, '') // blockquote markers
    .replace(/`{1,3}/gu, '') // code fences and inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1') // links -> link text
    .replace(/[*_]{1,3}(?=\S)([^*_]+)(?<=\S)[*_]{1,3}/gu, '$1'); // bold/italic
}

export function topicToJson(doc: TopicDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
