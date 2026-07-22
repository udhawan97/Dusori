---
title: Curriculum import
description: Turn a pasted official or structured Markdown outline into a reviewable topic roadmap.
---

Curriculum import is an offline transformation. Dusori reads text you paste, shows the extracted hierarchy, and waits for **Apply roadmap** before changing `roadmap.md`. It does not fetch the optional source URL and does not use AI.

## Supported outlines

- **Microsoft Learn study guide:** recognizes the English `Skills measured` section, ignores the duplicated “Skills at a glance” list, and keeps skill-group percentages when present.
- **AWS Certification exam guide:** recognizes the plain text copied out of an official AWS exam guide PDF — `Domain N:` lines with their percentages and `Task Statement N.N:` sentences, including lines the PDF wraps mid-sentence. The duplicated content-outline summary is merged, and “Knowledge of” / “Skills in” bullets are left out so the roadmap stays reviewable.
- **Structured Markdown syllabus:** accepts ordinary Markdown headings followed by bullet, numbered, or checklist items. This adapter is language-neutral.
- **Automatic detection:** tries the Microsoft Learn structure first, then the AWS exam guide structure, then structured Markdown.

Paste only the useful outline. The input limit is 512 KiB and one import can create at most 200 roadmap items. Dusori reads pasted text only: open a PDF exam guide, select the content outline, and copy it — attaching the PDF file itself or fetching a page is not supported.

## Preview and apply

1. Open a topic and its inspector.
2. Under **Curriculum**, choose **Import curriculum**.
3. Add a source title, an optional official `http://` or `https://` URL, and the outline text.
4. Choose **Preview roadmap**. Review the adapter name, item count, hierarchy, and percentages.
5. Choose **Apply roadmap** only when the preview is correct.

The original pasted outline is stored in `Sources/items/` and recorded in `Sources/manifest.json`. The generated roadmap links back to that local source and retains the official URL as provenance when supplied. Requirements can change; use that URL to review the publisher’s current guide yourself.

## External edits stay protected

`roadmap.md` is user-owned Markdown. If its current hash differs from Dusori’s last-seen version, applying a curriculum does not overwrite it. Dusori writes a dated `.proposed-…md` sibling, records the conflict in `Updates/`, and shows the changed lines.

Choose **Keep current roadmap** to leave the external version active, or **Use imported roadmap** to accept the previewed import explicitly. Both the original outline and the conflict record remain portable in workspace ZIP exports and readable in Obsidian.
