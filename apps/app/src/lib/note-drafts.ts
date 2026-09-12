export type NoteDrafts = Record<string, { content: string; original: string }>;

/** Session drafts stay separate from learner-owned files and survive every navigation path. */
export function retainNoteDraft(
  drafts: NoteDrafts,
  path: string,
  content: string,
  original: string,
): NoteDrafts {
  const next = { ...drafts };
  if (content === original) delete next[path];
  else next[path] = { content, original };
  return next;
}

export function discardNoteDraft(drafts: NoteDrafts, path: string): NoteDrafts {
  const next = { ...drafts };
  delete next[path];
  return next;
}
