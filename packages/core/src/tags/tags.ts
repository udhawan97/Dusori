/**
 * Tags are derived from ordinary Markdown, never from a machine file. A tag is either declared in
 * `tags:` frontmatter or written inline as `#tag`, matching what Obsidian already understands, so a
 * vault edited outside Dusori keeps the same tags.
 */

const FRONTMATTER = /^---\s*\n([\s\S]*?)\n---/u;

/**
 * A `#` only opens a tag when it starts a word and is followed by a letter. That single rule is what
 * keeps `# Heading` a heading (space), `## Sub` a heading (leading `#`), `#123` an issue reference
 * (digit), and `page#section` a URL fragment (preceded by a word character).
 */
const INLINE_TAG = /(?<![\p{L}\p{N}_#])#(\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*)/gu;

const FENCED_CODE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gmu;
const INLINE_CODE = /`[^`\n]*`/gu;

function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/gu, '')
    .split(/[,\s]+/u)
    .map((entry) => entry.trim().replace(/^["']|["']$/gu, ''))
    .filter(Boolean);
}

function frontmatterTags(frontmatter: string): string[] {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => /^tags:/iu.test(line.trim()));
  if (index < 0) return [];

  const inline = lines[index]!.slice(lines[index]!.indexOf(':') + 1).trim();
  if (inline) return splitList(inline);

  const collected: string[] = [];
  for (const line of lines.slice(index + 1)) {
    const item = /^[ \t]*-[ \t]+(.+?)[ \t]*$/u.exec(line);
    if (!item) break;
    collected.push(item[1]!.replace(/^["']|["']$/gu, ''));
  }
  return collected.filter(Boolean);
}

/** Strips frontmatter and every code span so a `#` written as code is never read as a tag. */
function scannableBody(content: string): string {
  return content.replace(FRONTMATTER, '').replace(FENCED_CODE, '').replace(INLINE_CODE, '');
}

/** Canonical portable tag spelling used by machine records and graph facets. */
export function normalizeTag(value: string): string {
  return value.normalize('NFKC').trim().replace(/^#+/u, '').toLocaleLowerCase();
}

export function normalizeTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/**
 * Every tag on a document, frontmatter first and then body order. Duplicates are removed
 * case-insensitively while the first spelling is kept, so `Alpha` and `alpha` are one tag displayed
 * the way the author first wrote it.
 */
export function extractTags(content: string): string[] {
  const frontmatter = FRONTMATTER.exec(content)?.[1] ?? '';
  const found = [...frontmatterTags(frontmatter)];
  for (const match of scannableBody(content).matchAll(INLINE_TAG)) found.push(match[1]!);
  return normalizeTags(found);
}

export interface TagQuery {
  tags: string[];
  text: string;
}

/**
 * Splits `tag:` operators out of a search query. A bare `tag:` with nothing after it is not an
 * operator and stays in the free-text half, so a search for the literal word is still possible.
 */
export function parseTagQuery(query: string): TagQuery {
  const tags: string[] = [];
  const text: string[] = [];
  for (const token of query.trim().split(/\s+/u).filter(Boolean)) {
    const match = /^tag:(.+)$/iu.exec(token);
    if (match) tags.push(match[1]!);
    else text.push(token);
  }
  return { tags, text: text.join(' ') };
}

export function matchesTag(tags: readonly string[], wanted: string): boolean {
  const key = wanted.toLocaleLowerCase();
  return tags.some((tag) => tag.toLocaleLowerCase() === key);
}
