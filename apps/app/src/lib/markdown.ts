import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

export interface RenderedMarkdown {
  html: string;
  mermaid: string[];
}

interface HastNode {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type: string;
}

// Rendered code blocks scroll sideways on long lines, and a scroll container
// that nothing can focus is unreachable by keyboard (axe
// scrollable-region-focusable, WCAG 2.1.1). Svelte cannot annotate these
// elements because they arrive as an HTML string, so the attributes are added
// to the tree instead -- after rehype-sanitize, so the sanitizer's allowlist
// stays closed to anything the note itself supplies.
function keepCodeBlocksKeyboardReachable() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (node.tagName === 'pre') {
        node.properties = {
          ...node.properties,
          ariaLabel: 'Code block',
          role: 'region',
          tabIndex: 0,
        };
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

const wikilinkHrefPrefix = '#wiki-';

/**
 * Reads back the target `renderMarkdown` encoded into a wikilink href. It lives beside the
 * emitter so the two halves cannot drift, and returns null for every other kind of link, which
 * keeps ordinary anchors behaving like ordinary anchors.
 */
export function wikilinkTarget(href: string | null): string | null {
  if (!href?.startsWith(wikilinkHrefPrefix)) return null;
  const encoded = href.slice(wikilinkHrefPrefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    // A hand-edited href can carry a malformed escape; that is not a link to follow.
    return null;
  }
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
    .use(keepCodeBlocksKeyboardReachable)
    .use(rehypeStringify)
    .process(wikilinked);
  return { html: String(file), mermaid };
}
