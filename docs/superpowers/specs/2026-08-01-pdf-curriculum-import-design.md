# A PDF exam guide can become a roadmap

**Status:** approved · **Date:** 2026-08-01 · **Target release:** next

## Problem

Dusori can already read a PDF's text on the device
(`apps/app/src/lib/pdf-text.ts`) and already turns an AWS exam guide outline into
a roadmap (`packages/core/src/curriculum/import.ts`). The two never meet. A
learner holding the exact PDF the curriculum importer was written for must open
it in another reader, select the outline by hand, and paste it in.

`docs/product/spec.md:86` lists this as explicitly not built: a PDF can be a
source, not yet a roadmap.

The gap is not the wiring. It is that the extractor destroys the one thing the
parser needs. `assemblePdfText` collapses every run of whitespace in a page to a
single space (`pdf-text.ts:24`), so one page becomes one line. All three
curriculum adapters are line-oriented: they `split('\n')` and anchor on line
starts — `^Domain\s+(\d{1,2})\s*:` (`import.ts:202`),
`^Task\s+Statement\s+(\d{1,2})\.\d{1,2}` (`import.ts:203`), and
`^(#{1,6})\s+` or `^(\s*)(?:[-*+]\s+|\d+[.)]\s+)` (`import.ts:112`,
`import.ts:119`). Fed a page-per-line document, every one of them fails.

The AWS adapter was already written for text a human copied out of a PDF viewer.
It strips `•◦▪‣·o` bullets (`import.ts:201`), rejoins a task statement wrapped
mid-sentence (`import.ts:274`), and merges the summary table that repeats each
domain (`import.ts:252`). That machinery exists and is tested. It needs lines.

## Change

### The extractor keeps the document's own line breaks

`assemblePdfText` changes shape from pages of glyph runs to pages of lines of
glyph runs:

```ts
readonly (readonly (readonly string[])[])[]
//  pages →       lines →       runs
```

Runs join with a space and then collapse whitespace — today's rule, which was
always about glyph runs *within* a line and stays correct. Lines join with
`\n`. Pages join with `\n\n`. An empty line is dropped rather than left as a
gap, matching how an empty page is already dropped. `maxPdfPages` and the
scanned-document message are unchanged.

Dropping empty lines is deliberate and has a consequence worth stating. A blank
line closes an open task statement in the AWS adapter (`import.ts:240`), so a
whitespace-only run emitted mid-outline would truncate a wrapped statement.
Dropping such lines keeps the wrap-rejoining behaviour intact. Genuine vertical
space in a PDF produces no text items at all, so nothing real is lost.

`extractPdfText` groups `getTextContent().items` into lines on `hasEOL`
(`TextItem.hasEOL: boolean`, pdfjs-dist 6.1.200). Order matters inside the
loop: push `item.str` when it is non-empty, *then* close the line when
`item.hasEOL` is set. pdfjs emits standalone end-of-line markers carrying
`str: ''`, and today's `.filter(Boolean)` (`pdf-text.ts:48`) would swallow them.

This is one extraction path, not a mode. PDF sources take the same output.
Hard-wrapped prose gains single newlines, which Markdown joins when rendering,
so a stored source reads as it did while becoming more faithful to its page.

### The curriculum importer can choose a PDF

`CurriculumImporter.svelte` gains a `.pdf` file input above the outline
textarea and a `reading` flag. On selection it lazily imports `$lib/pdf-text`,
extracts, and writes the result into `outline`. If `sourceTitle` is still empty
it is filled from the filename without its extension; the learner can change it.

The extracted text lands in the textarea the learner already reviews, so the
cover page, the summary table, and the in-scope-services appendix can be
trimmed before previewing. Everything downstream — **Preview roadmap**,
`parseCurriculum`, the objective list, **Apply roadmap**, `applyCurriculum`,
and the conflict-to-proposal path — is unchanged.

The lazy import is the same one `SourceLibrary.svelte:218` uses, for the same
reason: pdfjs is roughly a megabyte and must stay out of the offline shell for
the sessions that never open a PDF.

### `@dusori/core` does not change

No new export, no new adapter, no schema version. Extraction stays in the app
layer so core remains testable under Node, which is the seam `pdf-text.ts:1`
exists to protect.

## What is reused unchanged

- `parseCurriculum` already rejects text over 512 KiB by name
  (`import.ts:355`). A long PDF reports that cap on **Preview roadmap** with its
  text still in the textarea to trim. The component adds no size check of its
  own, and must not truncate silently.
- `parseCurriculum` already names every supported outline when none matches
  (`import.ts:365`), which is the whole of the non-AWS-PDF behaviour.
- `parseCurriculum` already normalises `\r\n` to `\n` (`import.ts:353`).
- `applyCurriculum` already writes the roadmap under an expected hash, saves the
  outline text to `Sources/`, and produces a sibling proposal when the roadmap
  changed underneath.
- The component's existing `error` string and its `aria-live` region report
  every failure, including a scanned PDF and a corrupt file.

## Scope

A PDF realistically matches the AWS exam guide adapter and no other. Microsoft
Learn requires a `## Skills measured` heading (`import.ts:154`) and structured
Markdown requires at least one `#` heading (`import.ts:311`); extracted PDF text
has neither. A PDF of any other shape reports that no format matched, and its
text remains in the textarea to edit by hand.

Out of scope, and unchanged on the not-built list: OCR for a scanned PDF, a
PDF-native outline adapter that guesses at bullet glyphs and ALL-CAPS headers,
and any loosening of the Markdown adapter's matcher.

## Risk

`hasEOL` is pdfjs's own inference from the text matrix rather than a value the
file states. It should be set for runs placed at distinct vertical offsets. If
it proves unreliable, the fallback is grouping runs by `item.transform[5]`, the
y coordinate, with a small tolerance. Verify this before building on it; the
end-to-end test below is what proves it.

## Testing

Test-first.

Unit, `apps/app/src/lib/pdf-text.test.ts` — existing cases migrate to the
pages-of-lines shape, plus:

- two lines on one page keep their line break
- runs within a line still collapse to single spaces
- an empty line is dropped without leaving a blank gap
- a page whose lines are all empty is dropped
- a scan still throws naming the scan, and the page cap still applies

Integration, a new `apps/app/src/lib/curriculum-pdf.test.ts` — the case that
proves the feature. An AWS-shaped fixture carrying `Domain N:` lines,
`Task Statement N.N:` lines, `•` bullets, and a task statement wrapped
mid-sentence runs `assemblePdfText` then `parseCurriculum`, asserting the
domains, the task statements, and the rejoined sentence. This fails before the
change and passes after.

End to end, `tests/e2e/dusori.spec.ts` — `samplePdf` (`dusori.spec.ts:940`)
gains one `Td`/`Tj` pair per line so it can build a multi-line PDF. One journey
chooses an exam-guide PDF in the curriculum importer, previews, applies, and
asserts the roadmap and the saved source. The existing single-line PDF source
journeys keep passing, which is what confirms the shared extractor did not
regress.
