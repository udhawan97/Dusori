export const workspaceRelationKinds = [
  'supports',
  'challenges',
  'updates',
  'background-for',
  'follow-up-to',
] as const;

export type WorkspaceRelationKind = (typeof workspaceRelationKinds)[number];

export interface WorkspaceRecordRelation {
  relation: WorkspaceRelationKind;
  target: string;
}

const frontmatterPattern = /^---\s*\n([\s\S]*?)\n---/u;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === 'string' ? parsed : '';
    } catch {
      return '';
    }
  }
  return trimmed.replace(/^'|'$/gu, '');
}

function isRelationKind(value: string): value is WorkspaceRelationKind {
  return (workspaceRelationKinds as readonly string[]).includes(value);
}

/**
 * Reads the deliberately small portable relation subset Dusori writes in Markdown frontmatter.
 * Unknown types and malformed entries remain inert instead of becoming inferred graph edges.
 */
export function extractRecordRelations(content: string): WorkspaceRecordRelation[] {
  const frontmatter = frontmatterPattern.exec(content)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => /^relations:\s*$/u.test(line.trim()));
  if (start < 0) return [];

  const relations: WorkspaceRecordRelation[] = [];
  let relation = '';
  let target = '';
  const commit = (): void => {
    if (!isRelationKind(relation) || !target || target.length > 640) return;
    if (!relations.some((item) => item.relation === relation && item.target === target)) {
      relations.push({ relation, target });
    }
  };

  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !/^\s/u.test(line)) break;
    const relationMatch = /^\s*-\s+type:\s*(.+?)\s*$/u.exec(line);
    if (relationMatch) {
      commit();
      relation = unquote(relationMatch[1]!);
      target = '';
      continue;
    }
    const targetMatch = /^\s+target:\s*(.+?)\s*$/u.exec(line);
    if (targetMatch) target = unquote(targetMatch[1]!);
  }
  commit();
  return relations;
}
