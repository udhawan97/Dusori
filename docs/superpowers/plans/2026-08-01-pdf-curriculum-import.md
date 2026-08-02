# PDF Curriculum Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner can choose an AWS exam guide PDF in the curriculum importer and get a reviewable roadmap, instead of copying the outline out of another reader by hand.

**Architecture:** PDF text extraction stays in the app layer (`apps/app/src/lib/pdf-text.ts`); `@dusori/core` does not change. The extractor stops collapsing every page to a single line and instead keeps the document's own line breaks, which is the one thing the line-oriented curriculum adapters need. `CurriculumImporter.svelte` gains a `.pdf` input that writes extracted text into the outline textarea the learner already reviews; everything downstream is untouched.

**Tech Stack:** TypeScript, Svelte 5, SvelteKit, pdfjs-dist 6.1.200, Vitest, Playwright, pnpm workspaces.

## Global Constraints

- `@dusori/core` must not import pdfjs. Extraction lives in the app layer only (`apps/app/src/lib/pdf-text.ts:1-7`).
- pdfjs is imported lazily at its call sites so the offline shell does not carry ~1 MB for sessions that never open a PDF.
- Extraction is local. The file never leaves the device, and no new network origin is introduced.
- No new dependency, no schema version, no core export.
- Existing PDF **source** import journeys must keep passing — the extractor is shared.
- Never silently truncate oversized text; `parseCurriculum` already reports the 512 KiB cap by name (`packages/core/src/curriculum/import.ts:355`).
- Spec: `docs/superpowers/specs/2026-08-01-pdf-curriculum-import-design.md`.

## Verified Facts

These were confirmed empirically before this plan was written. Do not re-litigate them:

- `TextItem.hasEOL: boolean` exists in pdfjs-dist 6.1.200 and **is set correctly** for lines drawn at successive `Td` offsets. One item per line, `hasEOL: true` on every line but the last.
- In a `Buffer.from(pdf, 'latin1')` PDF with Helvetica, `·` (U+00B7) round-trips and pdfjs reads it back as `•`. A literal `•` (U+2022) mangles to `"`. Both `·` and `•` are inside the adapter's bullet class `[•◦▪‣·o]` (`import.ts:201`), so a fixture must use `·` in its source text.
- This worktree needed `pnpm install --frozen-lockfile` and `pnpm --filter @dusori/app exec svelte-kit sync` before Vitest could resolve `apps/app/tsconfig.json`. Both have been run; 8/8 existing `pdf-text` tests pass.

## File Structure

- **Modify** `apps/app/src/lib/pdf-text.ts` — line-preserving assembly plus a new pure `groupTextItemLines` export. The only non-trivial logic change.
- **Modify** `apps/app/src/lib/pdf-text.test.ts` — existing cases migrate to the new shape; new cases cover line keeping and EOL grouping.
- **Create** `apps/app/src/lib/curriculum-pdf.test.ts` — the integration test proving extracted PDF text parses into roadmap objectives.
- **Modify** `apps/app/src/lib/components/CurriculumImporter.svelte` — a `.pdf` input that fills the outline textarea.
- **Modify** `tests/e2e/dusori.spec.ts` — `samplePdf` gains multi-line support; one new journey.
- **Modify** `CHANGELOG.md`, `docs/product/spec.md`, `README.md` — shipped/not-built bookkeeping.

---

### Task 1: The extractor keeps line breaks

**Files:**
- Modify: `apps/app/src/lib/pdf-text.ts:20-29`
- Test: `apps/app/src/lib/pdf-text.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `assemblePdfText(pages: readonly (readonly (readonly string[])[])[]): string` — pages of lines of glyph runs. `maxPdfPages` and the scanned-document message are unchanged.

- [ ] **Step 1: Write the failing tests**

Replace the whole body of `apps/app/src/lib/pdf-text.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

import { assemblePdfText, maxPdfPages } from './pdf-text';

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
    expect(
      assemblePdfText([[['Task Statement 1.2: Design secure'], ['   '], ['workloads.']]]),
    ).toBe('Task Statement 1.2: Design secure\nworkloads.');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/app/src/lib/pdf-text.test.ts`
Expected: FAIL. The nested-array cases produce `Domain 1: Design., Task Statement 1.1: Scope.` (array coercion inside `join`) rather than a newline.

- [ ] **Step 3: Replace `assemblePdfText`**

In `apps/app/src/lib/pdf-text.ts`, replace the existing function (lines 16-29) with:

```ts
/**
 * Assembles pages of lines of glyph runs into one document. Pure, so the rules that actually
 * matter — how runs join, which line breaks survive, what an empty page does, and what a scan
 * reports — are testable without a real PDF.
 */
export function assemblePdfText(pages: readonly (readonly (readonly string[])[])[]): string {
  const rendered: string[] = [];
  for (const page of pages.slice(0, maxPdfPages)) {
    const lines: string[] = [];
    for (const line of page) {
      // pdfjs emits a text item per glyph run, so runs are joined and then whitespace collapsed.
      const text = line.join(' ').replace(/\s+/gu, ' ').trim();
      // A blank line closes an open task statement in the curriculum adapters, so a
      // whitespace-only line is dropped rather than allowed to truncate a wrapped sentence.
      if (text) lines.push(text);
    }
    if (lines.length > 0) rendered.push(lines.join('\n'));
  }
  if (rendered.length === 0) throw new Error(noTextMessage);
  return rendered.join('\n\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/app/src/lib/pdf-text.test.ts`
Expected: PASS, 10 tests. `extractPdfText` will not typecheck yet — Task 2 fixes it.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/pdf-text.ts apps/app/src/lib/pdf-text.test.ts
git commit -m "feat(app): keep pdf line breaks when assembling extracted text"
```

---

### Task 2: Group pdfjs runs into lines

**Files:**
- Modify: `apps/app/src/lib/pdf-text.ts:31-54`
- Test: `apps/app/src/lib/pdf-text.test.ts`

**Interfaces:**
- Consumes: `assemblePdfText` from Task 1.
- Produces: `groupTextItemLines(items: readonly PdfPageItem[]): string[][]` and the exported type `PdfPageItem = { readonly hasEOL: boolean; readonly str: string } | { readonly type: string }`. `extractPdfText(file: Blob): Promise<string>` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append to `apps/app/src/lib/pdf-text.test.ts`, and add `groupTextItemLines` to the import on line 3:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/app/src/lib/pdf-text.test.ts`
Expected: FAIL with `groupTextItemLines is not a function` / no exported member.

- [ ] **Step 3: Add the grouping and rewire `extractPdfText`**

In `apps/app/src/lib/pdf-text.ts`, add above `extractPdfText`:

```ts
/** The two shapes pdfjs reports on a page: a glyph run, or a marked-content boundary. */
export type PdfPageItem =
  | { readonly hasEOL: boolean; readonly str: string }
  | { readonly type: string };

/**
 * Groups a page's glyph runs into lines. pdfjs infers the line break itself and reports it as
 * `hasEOL`, sometimes on a marker item carrying no text of its own — so the run is taken first
 * and the line closed afterwards, or those breaks would be dropped along with the empty string.
 */
export function groupTextItemLines(items: readonly PdfPageItem[]): string[][] {
  const lines: string[][] = [];
  let current: string[] = [];
  for (const item of items) {
    if (!('str' in item)) continue;
    if (item.str) current.push(item.str);
    if (item.hasEOL) {
      lines.push(current);
      current = [];
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
```

Then replace the page loop inside `extractPdfText` (currently lines 43-50) with:

```ts
    const pages: string[][][] = [];
    const count = Math.min(document.numPages, maxPdfPages);
    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(groupTextItemLines(content.items));
    }
    return assemblePdfText(pages);
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run apps/app/src/lib/pdf-text.test.ts`
Expected: PASS, 14 tests.

Run: `pnpm --filter @dusori/app typecheck`
Expected: no errors. `content.items` is `(TextItem | TextMarkedContent)[]`; both members are assignable to `PdfPageItem`.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/pdf-text.ts apps/app/src/lib/pdf-text.test.ts
git commit -m "feat(app): group extracted pdf runs into the lines pdfjs reports"
```

---

### Task 3: Prove extracted text parses into a roadmap

**Files:**
- Create: `apps/app/src/lib/curriculum-pdf.test.ts`

**Interfaces:**
- Consumes: `assemblePdfText` (Task 1) and `parseCurriculum` from `@dusori/core`.
- Produces: nothing later tasks depend on. This is the acceptance test for the core half of the feature.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/curriculum-pdf.test.ts`:

```ts
import { parseCurriculum } from '@dusori/core';
import { describe, expect, it } from 'vitest';

import { assemblePdfText } from './pdf-text';

/** One page of an AWS exam guide as pdfjs reports it: lines of glyph runs. */
const examGuidePage: string[][] = [
  ['AWS Certified Solutions Architect', ' - Associate (SAA-C03)'],
  ['Domain 1: Design Secure Architectures (30% of scored content)'],
  ['Task Statement 1.1: Design secure access to AWS resources.'],
  ['Task Statement 1.2: Design secure workloads and'],
  ['applications.'],
  ['Knowledge of:'],
  ['• Access controls and management across multiple accounts'],
  ['Domain 2: Design Resilient Architectures (26% of scored content)'],
  ['Task Statement 2.1: Design scalable and loosely coupled architectures.'],
];

describe('an extracted pdf exam guide', () => {
  it('parses into the domains and task statements of a roadmap', () => {
    const draft = parseCurriculum({
      adapterId: 'auto',
      content: assemblePdfText([examGuidePage]),
      sourceTitle: 'AWS SAA-C03 exam guide',
    });

    expect(draft.adapterId).toBe('aws-exam-guide');
    expect(draft.objectives).toEqual([
      { depth: 1, title: 'Design Secure Architectures', weight: '30%' },
      { depth: 2, title: 'Design secure access to AWS resources' },
      { depth: 2, title: 'Design secure workloads and applications' },
      { depth: 1, title: 'Design Resilient Architectures', weight: '26%' },
      { depth: 2, title: 'Design scalable and loosely coupled architectures' },
    ]);
  });

  it('finds no structure at all once those line breaks are collapsed away', () => {
    const collapsed = assemblePdfText([[examGuidePage.flat()]]);

    expect(() =>
      parseCurriculum({ adapterId: 'auto', content: collapsed, sourceTitle: 'Exam guide' }),
    ).toThrow(/could not recognize/iu);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run apps/app/src/lib/curriculum-pdf.test.ts`
Expected: PASS, 2 tests. Both are green once Task 1 landed — the first documents what the feature delivers, the second documents why the line breaks are load-bearing. If the first fails, the fault is in Task 1's assembly, not in core.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/curriculum-pdf.test.ts
git commit -m "test(app): extracted pdf exam guide text parses into roadmap objectives"
```

---

### Task 4: Choose a PDF in the curriculum importer

**Files:**
- Modify: `apps/app/src/lib/components/CurriculumImporter.svelte`

**Interfaces:**
- Consumes: `extractPdfText` (Task 2) via `import('$lib/pdf-text')`.
- Produces: the `Exam guide PDF` labelled file input that Task 5's journey drives.

- [ ] **Step 1: Add the reading state and handler**

In the `<script>` block, after `let success = '';` (line 32), add:

```ts
  let pdfName = '';
  let reading = false;
```

After the `edit()` function (line 51), add:

```ts
  async function readPdf(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    reading = true;
    error = '';
    success = '';
    try {
      // Local extraction: the file never leaves the device, and a scan without a text layer
      // reports that cause instead of filling the outline with nothing.
      const { extractPdfText } = await import('$lib/pdf-text');
      outline = await extractPdfText(file);
      pdfName = file.name;
      if (!sourceTitle.trim()) sourceTitle = file.name.replace(/\.pdf$/iu, '');
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Dusori could not read this PDF.';
    } finally {
      reading = false;
      // Cleared so choosing the same file again still fires a change.
      input.value = '';
    }
  }
```

In `startAnother()` (line 139), add `pdfName = '';` beside the other resets.

- [ ] **Step 2: Add the input to the editing form**

In the `editing` branch, insert immediately before `<label for="curriculum-outline">Outline text</label>` (line 206):

```svelte
      <label for="curriculum-pdf">Exam guide PDF <span>optional</span></label>
      <input
        id="curriculum-pdf"
        type="file"
        accept=".pdf,application/pdf"
        disabled={working || reading}
        onchange={readPdf}
        aria-describedby="curriculum-pdf-help"
      />
      <p class="field-help" id="curriculum-pdf-help">
        {#if reading}
          Reading the PDF on this device…
        {:else if pdfName}
          Read {pdfName} into the outline below. Edit it before previewing.
        {:else}
          Read on this device and never uploaded. A scanned PDF says so.
        {/if}
      </p>
```

Change the section's busy flag on line 151 from `aria-busy={working}` to `aria-busy={working || reading}`, and the submit button on line 219 from `disabled={working}` to `disabled={working || reading}`.

- [ ] **Step 3: Style the file input**

In the `<style>` block, after the `.field-help` rule (line 440), add:

```css
  input[type='file'] {
    cursor: pointer;
    padding-block: var(--space-2xs);
  }
```

- [ ] **Step 4: Verify it builds and typechecks**

Run: `pnpm --filter @dusori/app typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/components/CurriculumImporter.svelte
git commit -m "feat(app): read an exam guide pdf into the curriculum outline"
```

---

### Task 5: End-to-end journey

**Files:**
- Modify: `tests/e2e/dusori.spec.ts:940-960` (`samplePdf`) and add one test after the AWS paste journey at line 1321.

**Interfaces:**
- Consumes: the `Exam guide PDF` input from Task 4 and the existing `awsExamGuide` fixture (`dusori.spec.ts:71`).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Make `samplePdf` multi-line**

Replace `samplePdf` (lines 936-960) with:

```ts
/** PDF strings are parenthesised, so a literal parenthesis or backslash must be escaped. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/gu, '\\$1');
}

/**
 * A real, minimal PDF, so the import path is exercised end to end. Each line is drawn at its own
 * offset, which is what makes pdfjs report the line breaks an outline parser needs. Passing no
 * text produces a structurally valid page with an empty content stream — what a scan looks like
 * to a reader. Text is encoded latin1, so `·` reads back as a bullet and `•` would not survive.
 */
function samplePdf(text: string | readonly string[]): Buffer {
  const lines = (typeof text === 'string' ? [text] : text).filter((line) => line.trim());
  const stream = lines.length
    ? `BT /F1 12 Tf 40 740 Td ${lines
        .map((line, index) => `${index === 0 ? '' : '0 -16 Td '}(${escapePdfText(line)}) Tj`)
        .join(' ')} ET`
    : '';
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
```

- [ ] **Step 2: Write the failing journey**

Insert after line 1321 (the end of the AWS paste journey):

```ts
test('curriculum import reads an AWS exam guide straight from its PDF', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  if (!(await page.getByRole('heading', { name: 'Curriculum' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Import curriculum' }).click();

  // The same outline the paste journey uses, delivered as a PDF. `·` is what latin1 can carry,
  // and pdfjs reads it back as the bullet the adapter already knows.
  await page.getByLabel('Exam guide PDF').setInputFiles({
    buffer: samplePdf(awsExamGuide.replace(/•/gu, '·').split('\n')),
    mimeType: 'application/pdf',
    name: 'saa-c03-exam-guide.pdf',
  });

  // The filename seeds the title, and the extracted text is editable before previewing.
  await expect(page.getByLabel('Source title').last()).toHaveValue('saa-c03-exam-guide');
  await expect(page.getByLabel('Outline text')).toHaveValue(/Task Statement 1\.1/u);

  await page.getByRole('button', { name: 'Preview roadmap' }).click();

  await expect(page.getByText('AWS Certification exam guide', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '9 roadmap items' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design Secure Architectures (30%)',
  );
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design secure workloads and applications',
  );
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText('Design Secure Architectures');
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
});
```

- [ ] **Step 3: Build and run the e2e suite**

The e2e server serves `dist/`, so a build is required first.

Run: `pnpm build && npx playwright test`
Expected: PASS, including the two pre-existing PDF **source** journeys (`imports a PDF by reading its text on this device`, `a PDF with no text layer says so instead of saving an empty source`) — those passing is what confirms the shared extractor did not regress.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dusori.spec.ts
git commit -m "test(e2e): import an aws exam guide from its pdf"
```

---

### Task 6: Documentation and release bookkeeping

**Files:**
- Modify: `CHANGELOG.md` (the `[Unreleased]` → `### Added` list)
- Modify: `docs/product/spec.md:86` (remove the not-built line) and the curriculum paragraph
- Modify: `README.md:132` (the "Import a study guide" capability row)

- [ ] **Step 1: Add the changelog entry**

Under `## [Unreleased]` → `### Added` in `CHANGELOG.md`, add as the first bullet:

```markdown
- An AWS exam guide can be imported straight from its PDF. Choose the file and Dusori reads it on your device, fills the outline box with the text, and seeds the title from the filename; you trim the cover page or the appendix, preview, and apply exactly as with pasted text. The extracted text keeps the guide's own line breaks, which is what lets the domains and task statements be recognized at all — a PDF read as one block per page has no outline in it. A PDF of any other shape says no format matched and leaves its text in the box to edit. The file never leaves your device, and a scanned PDF still says it has no text layer rather than importing nothing.
```

- [ ] **Step 2: Update the product spec**

In `docs/product/spec.md`, delete the line `- PDF curriculum extraction (a PDF can be a source, not yet a roadmap)` from **Explicitly not built yet** (line 86), and append this sentence to the paragraph describing curriculum import:

```markdown
An AWS exam guide can also be read directly from a PDF: extraction happens on the device, preserves the guide's line breaks so the outline is recognizable, and lands in the same reviewable outline field as pasted text. Other PDF shapes report that no format matched. OCR for a scanned PDF and a PDF-native outline adapter remain unbuilt.
```

- [ ] **Step 3: Update the README capability row**

In `README.md` line 132, change the "Import a study guide" description to:

```markdown
| 🧭  | Import a study guide               | A reviewable roadmap from pasted text or an AWS exam guide PDF, preserving the original outline in `Sources/` |
```

- [ ] **Step 4: Verify the full gate**

Run: `pnpm check`
Expected: format, lint, typecheck, unit tests, and build all pass.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/product/spec.md README.md
git commit -m "docs: record pdf exam guide import as shipped"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: line-preserving assembly → Task 1; `hasEOL` grouping and its ordering rule → Task 2; the `@dusori/core` no-change constraint → Global Constraints (no task touches core); the importer's PDF input, filename-seeded title, and editable textarea → Task 4; reuse of the 512 KiB cap, the no-format-matched message, and the conflict path → asserted by not writing code for them, listed under Global Constraints; the scope decision that only the AWS adapter matches → Task 3's second test and Task 6's copy; testing → Tasks 1, 2, 3, 5.

**Risk section.** The spec's `hasEOL` risk was verified empirically before this plan was written and is recorded under Verified Facts. The `transform[5]` fallback is not needed and no task implements it.

**Type consistency.** `assemblePdfText` takes `readonly (readonly (readonly string[])[])[]` in Task 1 and is called with `string[][][]` in Task 2 and `[examGuidePage]` (`string[][][]`) in Task 3 — mutable arrays are assignable to readonly ones. `groupTextItemLines` returns `string[][]`, which is one page's worth, matching what `pages.push(...)` expects.
