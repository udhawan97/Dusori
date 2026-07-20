import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface RenderedMarkdown {
  html: string;
  mermaid: string[];
}

export async function renderMarkdown(markdown: string): Promise<RenderedMarkdown> {
  const mermaid: string[] = [];
  const withoutFrontmatter = markdown.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/u, '');
  const withoutDiagrams = withoutFrontmatter.replace(
    /```mermaid\s*\n([\s\S]*?)```/gu,
    (_, source: string) => {
      mermaid.push(source.trim());
      return '\n';
    },
  );
  const wikilinked = withoutDiagrams.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu,
    (_, path, label) => {
      const text = String(label ?? path)
        .replaceAll('[', '')
        .replaceAll(']', '');
      const target = encodeURIComponent(String(path));
      return `[${text}](#wiki-${target})`;
    },
  );
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify)
    .process(wikilinked);
  return { html: String(file), mermaid };
}
