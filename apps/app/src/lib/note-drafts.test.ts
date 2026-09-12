import { describe, expect, it } from 'vitest';

import { discardNoteDraft, retainNoteDraft, type NoteDrafts } from './note-drafts';

describe('note drafts', () => {
  it('keeps each document content with its own original across A to B to A to B navigation', () => {
    let drafts: NoteDrafts = {};
    drafts = retainNoteDraft(drafts, 'A.md', 'A edited', 'A original');
    drafts = retainNoteDraft(drafts, 'B.md', 'B edited', 'B original');
    expect(drafts['A.md']).toEqual({ content: 'A edited', original: 'A original' });
    expect(drafts['B.md']).toEqual({ content: 'B edited', original: 'B original' });
    expect(discardNoteDraft(drafts, 'A.md')).toEqual({
      'B.md': { content: 'B edited', original: 'B original' },
    });
  });

  it('drops content that matches its own saved original', () => {
    expect(retainNoteDraft({}, 'A.md', 'same', 'same')).toEqual({});
  });
});
