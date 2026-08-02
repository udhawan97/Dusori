import { describe, expect, it } from 'vitest';

import { assemblePdfText, groupTextItemLines, maxPdfPages } from './pdf-text';

describe('assemblePdfText', () => {
  it('joins the glyph runs of a line in reading order', () => {
    expect(assemblePdfText([[['Attention', 'weighs', 'every', 'token.']]])).toBe(
      'Attention weighs every token.',
    );
  });

  it('keeps the line breaks an outline parser reads', () => {
    expect(assemblePdfText([[['Domain 1: Design.'], ['Task Statement 1.1: Scope.']]])).toBe(
      'Domain 1: Design.\nTask Statement 1.1: Scope.',
    );
  });

  it('separates pages with a blank line so sections stay distinguishable', () => {
    expect(assemblePdfText([[['Page one.']], [['Page two.']]])).toBe('Page one.\n\nPage two.');
  });

  it('collapses the run of spaces pdf extraction leaves between glyph runs', () => {
    expect(assemblePdfText([[['Byte   pair', '  encoding  ', 'merges.']]])).toBe(
      'Byte pair encoding merges.',
    );
  });

  it('drops a whitespace-only line rather than closing a wrapped sentence', () => {
    expect(assemblePdfText([[['Task Statement 1.2: Design secure'], ['   '], ['workloads.']]])).toBe(
      'Task Statement 1.2: Design secure\nworkloads.',
    );
  });

  it('drops a page that carries no text rather than leaving a gap', () => {
    expect(assemblePdfText([[['Page one.']], [['   ']], [['Page three.']]])).toBe(
      'Page one.\n\nPage three.',
    );
  });

  it('names the scanned-document cause when a pdf has no text layer at all', () => {
    expect(() => assemblePdfText([[], [['  ']], []])).toThrow(/no extractable text/iu);
  });

  it('says a scan needs another route rather than implying dusori will read it', () => {
    expect(() => assemblePdfText([[]])).toThrow(/scan/iu);
  });

  it('rejects nothing when the pdf reports no pages at all', () => {
    expect(() => assemblePdfText([])).toThrow(/no extractable text/iu);
  });

  it('caps how many pages one import will read', () => {
    expect(maxPdfPages).toBeGreaterThan(0);
    const pages = Array.from({ length: maxPdfPages + 10 }, (_page, index) => [[`Page ${index}.`]]);

    const text = assemblePdfText(pages);

    expect(text).toContain(`Page ${maxPdfPages - 1}.`);
    expect(text).not.toContain(`Page ${maxPdfPages}.`);
  });
});

describe('groupTextItemLines', () => {
  it('closes a line on the end-of-line pdfjs infers', () => {
    expect(
      groupTextItemLines([
        { hasEOL: true, str: 'Domain 1: Design.' },
        { hasEOL: false, str: 'Task Statement 1.1: Scope.' },
      ]),
    ).toEqual([['Domain 1: Design.'], ['Task Statement 1.1: Scope.']]);
  });

  it('keeps a line break reported by a marker carrying no text of its own', () => {
    expect(
      groupTextItemLines([
        { hasEOL: false, str: 'Domain 1: Design.' },
        { hasEOL: true, str: '' },
        { hasEOL: false, str: 'Task Statement 1.1: Scope.' },
      ]),
    ).toEqual([['Domain 1: Design.'], ['Task Statement 1.1: Scope.']]);
  });

  it('gathers the glyph runs of one line together', () => {
    expect(
      groupTextItemLines([
        { hasEOL: false, str: 'Task ' },
        { hasEOL: false, str: 'Statement' },
        { hasEOL: true, str: ' 1.1' },
      ]),
    ).toEqual([['Task ', 'Statement', ' 1.1']]);
  });

  it('ignores a marked-content boundary that carries no glyph run', () => {
    expect(
      groupTextItemLines([{ type: 'beginMarkedContent' }, { hasEOL: true, str: 'Domain 1.' }]),
    ).toEqual([['Domain 1.']]);
  });
});
