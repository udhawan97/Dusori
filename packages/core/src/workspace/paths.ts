const invalidCharacters = /[<>:"\\|?*]/u;
const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

export function normalizeWorkspacePath(input: string): string {
  if (input.startsWith('/') || /^[a-z]:[\\/]/iu.test(input)) {
    throw new Error('Workspace paths must be relative.');
  }

  const normalized = input.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (!normalized) return '';

  for (const segment of normalized.split('/')) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Workspace paths cannot contain empty, dot, or parent segments.');
    }
    const hasControlCharacter = [...segment].some((character) => character.charCodeAt(0) <= 31);
    if (
      segment.length > 80 ||
      invalidCharacters.test(segment) ||
      hasControlCharacter ||
      windowsReserved.test(segment)
    ) {
      throw new Error(`Workspace path segment is not portable: ${segment}`);
    }
  }
  return normalized;
}

export function slugify(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/u, '');

  if (!slug || windowsReserved.test(slug)) {
    throw new Error('Use a topic name that produces a portable filename.');
  }
  return slug;
}

export function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, '-');
}

export function topicRoot(slug: string): string {
  return `Topics/${slugify(slug)}`;
}

export function updateLogPath(slug: string, date: Date): string {
  const [year = '', month = '', day = ''] = date.toISOString().slice(0, 10).split('-');
  return `${topicRoot(slug)}/Updates/${year}/${month}/${year}-${month}-${day}.md`;
}

export function proposedPath(path: string, date: Date): string {
  const normalized = normalizeWorkspacePath(path);
  const dot = normalized.lastIndexOf('.');
  const suffix = `.proposed-${safeTimestamp(date)}`;
  return dot === -1
    ? `${normalized}${suffix}.md`
    : `${normalized.slice(0, dot)}${suffix}${normalized.slice(dot)}`;
}
