/**
 * PDF text extraction lives in the app, never in `@dusori/core`. pdfjs is a browser library of
 * roughly a megabyte, and it is imported lazily here so the offline application shell does not
 * carry it for the many sessions that never open a PDF. Core stays testable under Node.
 *
 * Extraction is local. Nothing about the file leaves the device.
 */

/** Pages read from one import. A long book is a reference, not a source Dusori should swallow. */
export const maxPdfPages = 400;

const noTextMessage =
  'This PDF has no extractable text — it is most likely a scan of pages rather than a text ' +
  'document. Dusori ships no OCR, so add it as a URL reference or paste the text you need.';

/**
 * Assembles pages of lines of glyph runs into one document. Pure, so the rules that actually
 * matter — how runs join, which line breaks survive, what an empty page does, and what a scan
 * reports — are testable without a real PDF.
 *
 * The line breaks are the point. An outline parser anchors on the start of a line, so a page
 * flattened into one string has no outline left in it.
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

/** Reads one PDF's text in the browser. The pdfjs import happens here so it stays out of the shell. */
export async function extractPdfText(file: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Bundled with the app rather than fetched: the shell must work offline and the strict
  // content-security policy allows no external script origin.
  const worker = await import('pdfjs-dist/build/pdf.worker.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  // Teardown lives on the loading task, which also aborts the worker; the document proxy has none.
  const loading = pdfjs.getDocument({ data: await file.arrayBuffer() });
  try {
    const document = await loading.promise;
    const pages: string[][][] = [];
    const count = Math.min(document.numPages, maxPdfPages);
    for (let number = 1; number <= count; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(groupTextItemLines(content.items));
    }
    return assemblePdfText(pages);
  } finally {
    await loading.destroy();
  }
}
