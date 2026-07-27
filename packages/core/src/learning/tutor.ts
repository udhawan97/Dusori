/**
 * `TUTOR.md` is user-owned Markdown, so editing it is structured rather than free-form: Dusori
 * reads the depth and the preference bullets, changes those, and writes the file back with
 * everything else left exactly as the learner wrote it.
 *
 * Nothing here writes to storage. The caller goes through the ordinary conflict-safe path —
 * propose, show the diff, accept — the same one `roadmap.md` uses.
 */

export const tutorDepths = ['brief', 'layered', 'deep'] as const;
export type TutorDepth = (typeof tutorDepths)[number];

export const maxTutorPreferences = 12;
export const maxTutorPreferenceCharacters = 200;
/** A preferences page is short by nature; anything much longer is not one. */
export const maxTutorProposalCharacters = 8_000;

export interface TutorPreferences {
  depth: string;
  preferences: string[];
}

const FRONTMATTER = /^(---\s*\n)([\s\S]*?)(\n---)/u;
const BULLET = /^[ \t]*[-*+][ \t]+(.+?)[ \t]*$/u;

function isKnownDepth(value: string): value is TutorDepth {
  return (tutorDepths as readonly string[]).includes(value);
}

function bodyOf(content: string): string {
  return content.replace(FRONTMATTER, '').replace(/^\s*\n/u, '');
}

/** Reads the current preferences. An unfamiliar depth reads as the default rather than failing. */
export function parseTutorPreferences(content: string): TutorPreferences {
  const frontmatter = FRONTMATTER.exec(content)?.[2] ?? '';
  const declared = /^depth:\s*(.+?)\s*$/imu.exec(frontmatter)?.[1]?.toLocaleLowerCase() ?? '';
  const preferences: string[] = [];
  for (const line of bodyOf(content).split('\n')) {
    const bullet = BULLET.exec(line);
    if (bullet?.[1]) preferences.push(bullet[1]);
  }
  return { depth: isKnownDepth(declared) ? declared : 'layered', preferences };
}

function assertValid(next: TutorPreferences): void {
  if (!isKnownDepth(next.depth)) {
    throw new Error(`Choose a depth of ${tutorDepths.join(', ')}.`);
  }
  if (next.preferences.length === 0) {
    throw new Error('Keep at least one learning preference.');
  }
  if (next.preferences.length > maxTutorPreferences) {
    throw new Error(`Keep at most ${maxTutorPreferences} learning preferences.`);
  }
  for (const preference of next.preferences) {
    const trimmed = preference.trim();
    if (!trimmed || /[\n\r]/u.test(preference)) {
      throw new Error('Each learning preference must be a single line of text.');
    }
    if (trimmed.length > maxTutorPreferenceCharacters) {
      throw new Error(
        `Keep each learning preference under ${maxTutorPreferenceCharacters} characters.`,
      );
    }
  }
}

function withDepth(content: string, depth: string): string {
  const frontmatter = FRONTMATTER.exec(content);
  if (!frontmatter) return `---\ndepth: ${depth}\n---\n\n${content}`;
  const [, open = '', body = '', close = ''] = frontmatter;
  const next = /^depth:\s*.*$/imu.test(body)
    ? body.replace(/^depth:\s*.*$/imu, `depth: ${depth}`)
    : `${body}\ndepth: ${depth}`;
  return content.replace(FRONTMATTER, `${open}${next}${close}`);
}

/**
 * Writes the preferences back into the file. Only the depth line and the bullet block change; any
 * prose, extra frontmatter, or heading the learner added stays untouched.
 */
export function renderTutorPreferences(content: string, next: TutorPreferences): string {
  assertValid(next);
  const bullets = next.preferences.map((preference) => `- ${preference.trim()}`);
  const withNewDepth = withDepth(content, next.depth);

  const lines = withNewDepth.split('\n');
  const first = lines.findIndex((line) => BULLET.test(line));
  if (first < 0) {
    const heading = lines.findIndex((line) => /^#\s+/u.test(line));
    const at = heading < 0 ? lines.length : heading + 1;
    lines.splice(at, 0, '', ...bullets);
    return lines.join('\n');
  }

  let last = first;
  while (last + 1 < lines.length && BULLET.test(lines[last + 1] ?? '')) last += 1;
  lines.splice(first, last - first + 1, ...bullets);
  return lines.join('\n');
}

/**
 * Accepts a model's proposed preferences page, or keeps the current one. Advisory in the same way
 * every other AI path here is: the proposal is parsed and re-rendered onto the current file, so a
 * model can change the depth and the bullets and nothing else. It is still never applied without
 * the learner accepting the diff.
 */
export function applyAiTutorProposal(content: string, proposed: string): string {
  if (!proposed.trim() || proposed.length > maxTutorProposalCharacters) return content;
  try {
    const parsed = parseTutorPreferences(proposed);
    return renderTutorPreferences(content, parsed);
  } catch {
    return content;
  }
}
