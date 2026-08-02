---
title: Curriculum import
description: Turn an official outline — pasted, or read from an AWS exam guide PDF — into a reviewable topic roadmap.
---

Curriculum import is an offline transformation. Dusori reads text you paste or extracts it from a PDF on your device, shows the extracted hierarchy, and waits for **Apply roadmap** before changing `roadmap.md`. It does not fetch the optional source URL and does not use AI.

## Supported outlines

- **Microsoft Learn study guide:** recognizes the English `Skills measured` section, ignores the duplicated “Skills at a glance” list, and keeps skill-group percentages when present.
- **AWS Certification exam guide:** recognizes an official AWS exam guide, either as text you copied out of it or read straight from the PDF file — `Domain N:` lines with their percentages and `Task Statement N.N:` sentences, including lines the PDF wraps mid-sentence. The duplicated content-outline summary is merged, and “Knowledge of” / “Skills in” bullets are left out so the roadmap stays reviewable.
- **Structured Markdown syllabus:** accepts ordinary Markdown headings followed by bullet, numbered, or checklist items. This adapter is language-neutral.
- **Automatic detection:** tries the Microsoft Learn structure first, then the AWS exam guide structure, then structured Markdown.

Keep only the useful outline. The input limit is 512 KiB and one import can create at most 200 roadmap items. Dusori never fetches a page for you.

## Reading an AWS exam guide PDF

Choosing an **Exam guide PDF** reads the file on your device and fills the outline box with its text. Nothing is uploaded. Because the extracted text is editable before you preview it, trim the cover page, the summary table, or the in-scope-services appendix if they get in the way. The filename becomes the source title unless you have already written one.

Extraction keeps the document's own line breaks. That is what makes an outline recognizable at all — every adapter matches structure at the start of a line, so a page read as one block has no `Domain N:` or `Task Statement N.N:` in it.

A PDF of any other shape reports that no format matched and names every outline Dusori supports. Its text stays in the box, so you can edit it into Markdown headings and preview again. A scanned PDF with no text layer says so; Dusori ships no OCR. Microsoft Learn study guides and structured Markdown syllabi still expect pasted text, because both recognize themselves by Markdown headings that extracted PDF text does not carry.

## Preview and apply

1. Open a topic and its inspector.
2. Under **Curriculum**, choose **Import curriculum**.
3. Add a source title, an optional official `http://` or `https://` URL, and the outline — paste it, or choose an **Exam guide PDF** to fill it.
4. Choose **Preview roadmap**. Review the adapter name, item count, hierarchy, and percentages.
5. Choose **Apply roadmap** only when the preview is correct.

The original outline is stored in `Sources/items/` and recorded in `Sources/manifest.json`. The generated roadmap links back to that local source and retains the official URL as provenance when supplied. Requirements can change; use that URL to review the publisher’s current guide yourself.

## External edits stay protected

`roadmap.md` is user-owned Markdown. If its current hash differs from Dusori’s last-seen version, applying a curriculum does not overwrite it. Dusori writes a dated `.proposed-…md` sibling, records the conflict in `Updates/`, and shows the changed lines.

Choose **Keep current roadmap** to leave the external version active, or **Use imported roadmap** to accept the previewed import explicitly. Both the original outline and the conflict record remain portable in workspace ZIP exports and readable in Obsidian.
