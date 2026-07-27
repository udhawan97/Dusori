import { describe, expect, it } from 'vitest';

import { assemblePdfText, maxPdfPages } from './pdf-text';

describe('assemblePdfText', () => {
  it('joins the text items of a page in reading order', () => {
    expect(assemblePdfText([['Attention', 'weighs', 'every', 'token.']])).toBe(
      'Attention weighs every token.',
    );
  });

  it('separates pages with a blank line so sections stay distinguishable', () => {
    expect(assemblePdfText([['Page one.'], ['Page two.']])).toBe('Page one.\n\nPage two.');
  });

  it('collapses the run of spaces pdf extraction leaves between glyph runs', () => {
    expect(assemblePdfText([['Byte   pair', '  encoding  ', 'merges.']])).toBe(
      'Byte pair encoding merges.',
    );
  });

  it('drops a page that carries no text rather than leaving a gap', () => {
    expect(assemblePdfText([['Page one.'], ['   '], ['Page three.']])).toBe(
      'Page one.\n\nPage three.',
    );
  });

  it('names the scanned-document cause when a pdf has no text layer at all', () => {
    expect(() => assemblePdfText([[], ['  '], []])).toThrow(/no extractable text/iu);
  });

  it('says a scan needs another route rather than implying dusori will read it', () => {
    expect(() => assemblePdfText([[]])).toThrow(/scan/iu);
  });

  it('rejects nothing when the pdf reports no pages at all', () => {
    expect(() => assemblePdfText([])).toThrow(/no extractable text/iu);
  });

  it('caps how many pages one import will read', () => {
    expect(maxPdfPages).toBeGreaterThan(0);
    const pages = Array.from({ length: maxPdfPages + 10 }, (_page, index) => [`Page ${index}.`]);

    const text = assemblePdfText(pages);

    expect(text).toContain(`Page ${maxPdfPages - 1}.`);
    expect(text).not.toContain(`Page ${maxPdfPages}.`);
  });
});
