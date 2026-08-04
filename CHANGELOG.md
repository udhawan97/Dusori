# Changelog

All notable Dusori changes are documented here. Dusori follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Documentation

- Replaced the stale v0.9.1 social preview with the current v0.12.0 Learning Studio hero, made browser/download choices direct and version-correct, simplified documentation navigation, and synchronized provider and updater guidance.

## [0.12.0] - 2026-08-04

### Learning Studio

- Rebuilt the app around four predictable destinations — Learn, Sources, Map, and Settings — and the daily sequence Continue, Read, Annotate, explicitly Mark learned or review, then inspect Map/Outline.
- Made Sources a manifest-backed evidence shelf and separated candidate Preview from Save source and Save & read. Saved text opens in a focused Reading room.
- Added topic-local file search and a linear Outline beside the Obsidian-style galaxy, without remote chat history or a graph database.
- Kept objective completion, topic status, and review outcomes as three separate explicit states; navigation still never claims progress or mastery.

### Desktop and updates

- Added open-source Tauri builds for macOS Apple silicon, macOS Intel, and Windows x64, each with a target-native Node.js 24 companion sidecar.
- Added a signed GitHub release updater with separate check, download, install, and relaunch operations. Automatic opt-in covers checks and downloads only; installation waits for the learner and is blocked by unsaved work.
- Added a three-target matching-version-tag release workflow that cryptographically verifies updater signatures and stages an exact-asset draft containing `latest.json` plus `SHA256SUMS.txt`; publication happens only after the draft is downloaded and independently checked.
- Documented that v0.12.0 OS installers are not Apple-notarized or Microsoft code-signed even though the in-app update artifacts carry a separate Dusori signature.

### Safety, compatibility, and research

- Kept the companion’s per-run credential out of the opened URL, stdout, and logs; bundled pages use a restricted same-origin cookie and desktop API-only sessions use an environment-provided token with an exact origin.
- Made workspace machine-file readers tolerant of compatible future fields and preserved those fields across supported writes; bounded import preflight completes before destination mutation.
- Separated provider availability from per-run found, empty, and failed outcomes.
- Changed YouTube capture to metadata/reference-only, preferring the official Data API v3 through `YOUTUBE_API_KEY` with an optional self-hosted `INVIDIOUS_URL` fallback. Dusori no longer harvests captions; authorized transcript text can be added through the ordinary Paste or File path.
- Rewrote the README, website, documentation, security policy, provider matrix, updater recovery guide, product contract, and architecture decisions around the v0.12.0 behavior.

## [0.11.3] - 2026-08-03

### Fixed

- When optional synthesis AI fails, the fallback notice now appears only after the deterministic output has finished writing. Without an edit conflict, `Synthesis.md` has been replaced; with one, the learner's edited file remains active and the fallback is ready as a conflict-safe proposal.

## [0.11.2] - 2026-08-03

### Fixed

- Research controls fit their container at 320px instead of widening the page, and the first-run workspace action remains fully visible and at least 44px tall in a 320×568 viewport.
- Synthesis and learning-page actions remain unavailable until the topic has at least one saved source and one quoted passage. The handlers repeat the check before writing, so a forced or stale control cannot create a zero-evidence artifact.
- Accepting a preview now moves keyboard focus to the persistent saved-source confirmation; closing without accepting still restores the preview control.
- Insights format UTC-keyed activity dates in UTC, matching dated update paths and recap bounds instead of moving an entry across days in another device timezone.
- Synthesis and learning-page actions now enter their busy state and clear prior feedback before asynchronously rechecking evidence, so a new request cannot appear to inherit an earlier success.
- Overlapping source-library refreshes apply only the newest result, and repeated read requests enter their busy state before the first asynchronous check.

## [0.11.1] - 2026-08-03

### Fixed

- The AI permission in Research now names everything it covers. It always granted ranking, research briefs, and the synthesis overview together, but its wording described only ranking — so the synthesis overview could send quoted passages under a consent that never mentioned them. The dialog now states all three and what each sends.
- **Understand this topic** no longer claims "Nothing here contacts the network" when AI is allowed; it names the model the synthesis overview is sent to. The same correction was made on the Sources documentation page.
- Corrected the README's network-and-privacy list, which said optional AI receives "only the disclosed query plus candidate or accepted-source metadata". Three features send text from sources you already saved, and the list now says which and how much.

### Documentation

- The public surfaces now describe the research-first product: the landing page, README, and docs index lead with research, and the landing page's four-step loop, capability list, page title, and social card were still describing the pre-v0.10.0 product.
- Added the research view as the lead screenshot on both the README and the landing page, captured from the current build.
- Getting started now covers **Read saved sources**, **Build synthesis**, **Create learning page**, and **Keep this topic fresh**, and ends with a troubleshooting section instead of a v0.2.0 migration warning.
- The workspace file contract, conflict-safety rules, and browser-support provider count were missing `Synthesis.md`, `Learning/learn.html`, and two of the seven keyless providers.
- Provider naming now matches the app: the Stack Exchange provider is labeled **Stack Overflow**.
- Restored the correct review-excerpt figure (up to four 320-character excerpts) and fixed the CHANGELOG comparison links, which had no entries for 0.10.0 or 0.11.0.

## [0.11.0] - 2026-08-03

### Added

- The generated learning page can be opened inside Dusori. It renders in a sandbox that allows its own scripts but denies it the app's origin, so it keeps its interactivity while being unable to reach your workspace, storage, or cookies. The stored file stays theme-neutral and follows your system preference when opened directly; only the embedded copy is matched to the app's theme.
- **Keep this topic fresh.** A per-topic setting lets Dusori re-scan a topic when you open it and it has gone seven days without a scan, using only the providers you already allowed. It never runs on a first visit, never more than once per session, and never while Dusori is closed. The refresh says what it found, including when it found nothing new.
- With the companion and a configured AI provider, the synthesis gains two or three paragraphs of overview prose written over the passages your workspace already quotes. The prose is labeled with its model; the quotations, their citations, thin-evidence marking, and the evidence table stay deterministic, and an unavailable model writes the document without commentary and says so.

## [0.10.0] - 2026-08-02

Dusori becomes research-first: you name a topic you want to understand, and the research it does is visible, inspectable, and traceable back to the evidence.

### Added

- **Research missions on Today.** The workspace opens with what Dusori has looked for, what it found, and what it has actually read — sources discovered, saved, read, and quoted, when the topic was last refreshed, and which kinds of source it has nothing from yet. Every number is derived from files in your workspace, so a mission cannot claim progress the files do not show.
- **A durable research trail.** Every scan is recorded in the topic's `research.json`: when it ran, the exact text providers received, which angle asked the question, how many results were new, and one line per provider saying whether it found results, completed with nothing, or failed — with the failure's own message. The trail survives reload, so a provider outage is still reported as an outage tomorrow instead of decaying into "nothing found".
- **Research angles.** A topic can be researched from five prepared questions — definition and scope, how it works, debates and criticism, practice and tools, recent developments — instead of only through a roadmap objective. Each angle sends the topic's own name plus that angle's words.
- **Reading saved sources into quoted passages.** One action reads the text you already approved and stores up to twelve verbatim excerpts per source, each tagged with the heading it sat under. Nothing is paraphrased and no model is involved; a source that holds only an unfetched reference says so and names how to get its text.
- **A cited synthesis.** `Synthesis.md` groups those quotations by what they are about, shows which ideas more than one source supports, marks single-source ideas as thin evidence, builds a timeline once three sources carry dates, and lists the questions the evidence itself raises. Every line is a quotation with a link back to its source file. Regenerating it over a synthesis you have edited writes a proposal instead of overwriting your work.
- **A learning page you can keep.** `Learning/learn.html` is a self-contained interactive page — concepts with their supporting quotations, an optional timeline, and reveal-style check-yourself prompts that score nothing and store nothing. It has no external requests of any kind, works offline, opens outside Dusori, and travels in your ZIP export.
- Saved research sources now keep why they were chosen. The ranker's reasons, the publisher, the author where a provider reports one, and the publication date are stored on the source record instead of being shown once and discarded.

### Changed

- Research now asks about the topic by default rather than about a scaffold objective. Creating "Spaced repetition learning" and scanning previously sent "Spaced repetition learning Establish the terms and boundaries." to providers, which surfaced _Go (game)_ and _Glossary of computer science_ while missing the topic's own article; it now surfaces _Spaced repetition_, _Spaced learning_, _Rote learning_, _Flashcard_, and _Forgetting curve_.

### Fixed

- **Today**'s lanes now stack based on the width they actually have rather than the width of the window. With the inspector open on a 1200px screen the two lanes were squeezed until each item's actions overlapped its own text.

## [0.9.1] - 2026-08-02

### Fixed

- npm publishing now refuses to run unless the checked-out release tag, the workflow event revision, and the packaged source are the same commit, keeping package provenance tied to the exact code in the tarball.
- The README, website, documentation, and download artwork now lead with the current `npx @udhawan97/dusori@latest` path while preserving the browser and source-ZIP choices.

## [0.9.0] - 2026-08-01

### Added

- An AWS Certification exam guide can be imported straight from its PDF. Choose the file and Dusori reads it on your device, fills the outline box with the text, and takes the source title from the filename; you trim the cover page or the appendix, preview, and apply exactly as with pasted text. The extraction now keeps the guide's own line breaks, which is what lets its domains and task statements be recognized at all — a page read as one block has no outline left in it. A PDF of any other shape says no format matched and leaves its text in the box to edit by hand. The file never leaves your device, and a scanned PDF still says it has no text layer rather than importing nothing.

## [0.8.1] - 2026-08-01

### Added

- A topic's status can be set from its card on **Today**. Active, Paused, and Complete sit under each topic in the ledger, using the same controls, the same hash-guarded write, and the same update-log entry as the roadmap view — so a paused topic can be resumed where you noticed it was paused, instead of only from inside the topic. Each card names its own topic on every control, and a change to one topic no longer disables the buttons on the others.
- Wikilinks are followable. A `[[link]]` in any document you read inside Dusori now opens what it names, by the same rules the knowledge graph already uses to draw its edges — a path from the workspace root, a path relative to the document you are reading, a bare name inside the same topic, or a filename that exactly one document in the workspace answers to. A link naming a page that does not exist, or a name two documents share, says so and changes nothing; creating the page an unresolved link names remains workspace health's job, where you are asked first. Links are followed only in your own workspace documents — a research result's Markdown never steers the app.

### Changed

- **Continue learning** now names which source gap it means. A topic with nothing saved reads "no sources yet"; a topic whose saved sources hold no readable text on this device reads "2 sources saved, none readable on this device". Both used to read "research needed", which sent you to run another discovery scan even when the sources were already there and only needed their text fetched or pasted. The count is what the manifest records and the readability is what Dusori actually read, so the two are never reported as a fraction of each other. Where the button takes you is unchanged.

### Fixed

- Source-grounded review keeps **Back** and **Next** in the pinned decision area, so the controls are visible and hit-testable at 320×720, 375×812, and other short phone viewports instead of sitting below an unmarked inner scroll fold.
- A scan where every allowed research provider fails now renders one honest failure state with a retry action. It no longer pairs a provider failure with “No new suggestions matched,” which is reserved for providers that completed successfully and returned no candidates.
- User-requested workspace view changes reset the inherited document scroll and focus the destination heading. Today, Research, roadmap, graph, insights, notes, and the new-topic form no longer begin partially hidden beneath the sticky canvas bar.
- Research keeps its first provider consent control in the opening viewport at 320×720 and 375×812. The phone layout retains the Discover / Compare / Capture explanation with tighter, approval-first copy instead of making the first action a full screen away.

## [0.8.0] - 2026-07-30

### Added

- **Today** now opens with two workspace-wide, file-derived lanes. **Continue learning** routes due source-grounded reviews, objectives that need research, ordinary roadmap continuation, and paused topics without changing progress. **Needs attention** gives integrity issues priority, keeps unresolved-link hygiene secondary, and routes every item back to its existing owning workflow.
- Pending Markdown proposals now have a schema-versioned, hash-guarded `Topics/<slug>/proposals.json` lifecycle ledger. Proposal review survives reloads; accepting the proposal or keeping the current document resolves the attention item while preserving both Markdown versions. Historical proposal files are left untouched and are never guessed to be pending.

## [0.7.1] - 2026-07-29

### Fixed

- Reopening Dusori without a network connection works from the view you left. The app writes the open topic and view into its own URL, but the offline lookup ignored the query string and its fallback pointed at a shell that was cached under the server root instead of the app, so any return after real use ended on the browser's error page. The shell is now precached and matched where the app actually lives.
- The first run offers a workspace without scrolling. The setup hero reserved most of the opening screen, which left both workspace choices — the only way to begin — below the fold at every supported size. On desktop the choices now sit beside the hero, which keeps its display type.
- Research, the view a new topic opens on, shows its objective and provider controls in the first screen instead of a full-height headline followed by a screen of scrolling.
- Naming a topic starts from an empty field. The form arrived pre-filled with the example "AI Fundamentals" as a real value, so a first Enter created a topic and folder named after the example.
- The mobile navigation drawer takes keyboard focus when it opens, keeps Tab inside itself while it covers the canvas, and returns focus to the menu button when dismissed.
- The workspace rail reports connectivity as it changes rather than freezing on whatever was true when the page first painted.
- A long topic name truncates its own label instead of also crushing its icon to a sliver.
- The disabled **Scan for strong sources** button now names the permission it is waiting for through an accessible description, and the status toast no longer swallows clicks aimed at the controls beneath it.
- OpenAlex and npm discovery work from the hosted app. Their providers now declare the remote hosts they use, and the deployed content-security policy allows exactly those hosts.
- Research run history, result dismissal, and source import now preserve the useful retry-exhausted message when a concurrent workspace edit cannot be reconciled, instead of replacing it with a generic conflict.
- Publishing a GitHub release now starts the npm companion workflow against that exact tag. The workflow verifies the tag, package, and runtime versions agree, runs the full repository and packed-package gates, and publishes the scoped package with provenance.

## [0.7.0] - 2026-07-28

### Added

- Nodes can be placed by hand. Dragging a node pins it where it is dropped rather than letting it drift back, and its neighbors resettle around the new position. A focused node moves from the keyboard too — arrow keys nudge it, Shift takes a larger step — so placement never requires a pointer. **Release pins** returns every placed node to the layout.
- The graph filters on what the workspace already knows instead of a query language: **Show on the graph** chips toggle Notes, Sources, Updates, Documents, and Meta, and **Hide orphans** drops artifacts carrying no wikilinks. The workspace center and topic centers always stay visible, and the panel reports how many artifacts survive the filter.
- **Color by** switches artifact dots between **Kind** and **Topic**. Topic hues are derived from the topic name and shown in a legend, so the same workspace always draws the same colors. Filters and the color choice persist per browser alongside the force sliders.

### Changed

- The Artifact finder now narrows within what the graph is drawing rather than searching the whole workspace independently, so hiding a kind on the stage also removes it from the list. The graph filter decides what exists on screen; the finder locates something inside it.

## [0.6.0] - 2026-07-27

### Changed

- The knowledge graph is now explorable and adjustable, Obsidian-style: zoom toward the cursor (wheel or pinch, plus keyboard-operable buttons and a slider), drag to pan, and tune **Link length** and **Spacing** with sliders that persist per browser. The constellation seed is relaxed by a deterministic force pass, so linked notes pull together while everything keeps a readable distance; labels fade in as you zoom, hovering highlights a node's neighborhood, artifact dots grow with their wikilink degree, and reduced-motion users get an instant settled layout.
- Research and Insights are first-class workspace views. Creating a topic now opens Research and begins one automatic discovery run as soon as at least one provider is allowed; later scans remain explicit.
- The graph now opens with a notes/sources/wikilinks health ledger and a searchable, filterable artifact finder beside the constellation.

### Added

- **Start review** on the **Review next** queue opens a source-grounded session: three to five deterministic active-recall prompts built from the topic's current roadmap objective and the sources you already approved for it. Each prompt names its source title, section, and workspace path, and holds a bounded excerpt back until you ask to see it. Only sources whose readable text is on this device are used; a URL stored as a reference is named with the two manual ways to give it text, and Dusori still never fetches a page on its own. Each prompt has an answer box; what you type stays in the session until you choose **Save answers as a note**, which writes one ordinary Markdown note holding your answers verbatim with each prompt quoted, labelled by generator, and pointing at its source file. Leaving with unsaved answers asks once. Sessions are otherwise ephemeral — opening, walking, revealing, and abandoning write nothing — and only the final explicit "Got it" or "Needs work" reaches the existing schedule. No score, streak, or mastery claim is produced.
- With the companion running and an AI provider configured, **Allow sharper prompts** can reword those questions. It asks for its own consent, separate from AI ranking, because it sends the objective and up to four short source excerpts and nothing else. The model can change wording only: prompt count, order, evidence, and the review actions are fixed, generated wording names the model that wrote it, and a refusal, a malformed answer, or a twenty-second timeout keeps the deterministic prompts with a visible note.
- A **YouTube** research provider, through an Invidious instance you configure in the companion (`INVIDIOUS_URL`). Results are ordered by view count, and approving a video downloads its captions so it becomes an ordinary readable source that search, the graph, briefs, and review prompts can all use; a video without captions is stored as an honest reference instead. Dusori ships no default instance, and your browser never contacts YouTube, Google, or `ytimg.com` — even the thumbnail is proxied by the companion and rendered from local bytes, so the app's content-security policy gains no new remote origin.
- Curriculum import now recognizes AWS Certification exam guides: paste the content outline copied from an official AWS exam guide PDF and Dusori extracts the weighted `Domain N:` sections and `Task Statement N.N:` items, merging the duplicated summary table and rejoining lines the PDF wraps mid-sentence. When no format matches, the error now names every supported outline instead of a generic hint.
- A deterministic research agent queries every consented provider concurrently, survives partial failures, ranks candidates from explainable public signals, and preserves a diverse top-five shortlist. Keyless browser providers now include Hacker News, GitHub, and Stack Exchange alongside Microsoft Learn and Wikipedia.
- The local companion adds arXiv and configurable Brave, Tavily, or SearXNG general web search. Optional Ollama, Anthropic, or OpenAI assistance can advise ranking and write a model-named brief from approved sources; deterministic behavior remains the fallback.
- Local Insights derives a fourteen-day activity pulse, objective progress, artifact mix, link health, topic depth, connected hubs, and source provenance without telemetry, inferred study time, or a proprietary score.
- **Tags**, read from the Markdown you already write: a `tags:` list in frontmatter or an inline `#tag` in the body, exactly as Obsidian understands them, so a vault edited outside Dusori keeps the same tags. Search gains a `tag:name` filter and shows the tags it found; the graph carries tags onto each node and filters by them; Insights counts your tag vocabulary. Nothing is indexed or stored — tags are read from the files each time, and a Markdown heading, an issue number like `#123`, a URL fragment, and anything inside code are never mistaken for one.
- Two more keyless research providers your browser can reach on its own: **OpenAlex** for scholarly work and the **npm registry** for packages. Both reach real readable text rather than a bare link — OpenAlex abstracts are rebuilt locally from the inverted index publishers license, and an npm capture saves the published readme. Each has its own egress disclosure naming its exact host.
- A **Reddit** research provider through the companion. Reddit no longer answers anonymous clients, so this needs a free Reddit app of your own: set `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` before launching the companion. The credential never leaves the companion process, an unconfigured companion simply skips the provider, and posts marked over 18 are left out. A self post is captured as its own text; a link post is captured as an honest reference.
- **Export this topic** writes one topic's files as a portable ZIP. It is a copy to keep or read elsewhere, not a workspace archive Dusori can import back, and both the button and a note inside the archive say so.
- Insights now reports **what the review queue is holding**: how many topics are overdue, how many are due today, how many carry a schedule at all, and a bounded histogram of what falls due over the coming days. Derived on read like everything else there — no stored index, no estimated study time, no mastery claim.
- Workspace health can now **create the page an unresolved wikilink already names**, at the exact name the link uses, so the link resolves afterwards. This only ever adds a file that does not exist yet; Markdown you already wrote is never rewritten without your explicit acceptance. The new file records which document linked to it, and the action is appended to the topic's dated update log.
- Two more review prompt kinds. A **cloze** hides the longest word of a source's own opening sentence — nothing is invented, and the excerpt still shows the answer when you ask. A **locate** prompt asks which of your sources covers a section, and appears once a topic has a second source to tell apart. Sessions still run three to five prompts, open with explain and close with compare, and name a source title, section, and workspace path on every prompt.
- **PDF sources.** Choose a `.pdf` and Dusori reads its text on your device; the file never leaves it. The extracted text becomes an ordinary local source, hashed and logged like any other, and is searchable, linkable, and usable in review prompts. A scanned PDF with no text layer says exactly that instead of saving an empty source — Dusori ships no OCR. The PDF reader is fetched only the first time you import one, so the offline app shell does not grow for sessions that never use it.
- A **learning preferences editor** for each topic's `TUTOR.md`: set the depth, then add, remove, or reorder preferences. Dusori shows a diff and writes only when you accept it, through the same protocol `roadmap.md` uses, so an edit made outside Dusori becomes a sibling proposal instead of being overwritten. Only the depth line and the bullet list are rewritten — any prose, extra frontmatter, or heading you added stays as you wrote it.
- With the companion, a configured AI provider, and its own separate consent, a model can propose those preferences instead. It sends the topic title, the current preferences, and the change you type — no note, source, or other file. Its reply is re-read and re-rendered onto your file, so it can change the depth and the bullets and nothing else, an unusable reply changes nothing, and the proposal still reaches you as a diff naming the model.

### Fixed

- The preview server had no MIME type for `.mjs`, so a bundled worker was served as `application/octet-stream` and browsers refused to run it. PDF import could not have worked from a local build before this.

### Accessibility

- Every scrollable panel is now reachable by keyboard (WCAG 2.1.1): the note and roadmap proposal diffs, the fetched-source and research capture previews, and rendered Markdown code blocks each take focus, carry a name, and show a focus ring. Previously a keyboard or screen-reader user could not scroll them at all. Because rendered code blocks arrive as sanitized HTML, they are annotated in the Markdown pipeline after sanitizing, so a note cannot supply those attributes itself. The accessibility end-to-end checks now feed each of these panels content longer than its own height, since the underlying rule only reports a region once it truly overflows.

## [0.5.0] - 2026-07-22

### Added

- Optional spaced review on the **Review next** queue: marking a topic reviewed ("Got it" / "Needs work") schedules its next due date from a fixed 1–60 day interval ladder, stored in a new machine-owned `Topics/<slug>/review.json`. Due topics rise to the top of the queue, scheduled topics rest until due, and topics never marked reviewed keep the existing deterministic order. Review actions append to the dated update log, so they appear in recent activity and the seven-day recap.
- A cross-platform local runner: `npm run setup` and `npm start` build and launch Dusori from a clone on macOS, Windows, and Linux without a manual pnpm bootstrap.

### Safety and portability

- The review schedule is derived from the device's local calendar day, so a one-day interval means the next local day rather than the next UTC boundary.
- `review.json` is machine-owned, schema-versioned, and written under the same expected-hash guard as every other machine file; a conflicting write re-reads the current schedule and reapplies the outcome instead of overwriting it. Older builds ignore the file, ZIP export and import carry it through untouched, and deleting it only forgets the schedule.
- Scheduling stays explicit: no calendar entry, notification, background task, or closed-app work is created.

## [0.4.0] - 2026-07-21

### Added

- Create and edit portable Markdown study notes inside Dusori, using the existing proposal-and-explicit-acceptance protocol when another editor changes a file first.
- Local full-text search across Markdown and text files, with case- and accent-insensitive matching, source titles from manifests, bounded snippets, and no persisted index or network request.
- Backlinks derived from resolved wikilink edges plus an explicit, non-mutating workspace health check for unresolved links, invalid or missing source manifests, missing tracked sources, and untracked source files.
- Deterministic **Review next** ordering and a bounded seven-day workspace recap derived from topic state, roadmaps, and dated update files; no deadlines or background schedule are generated.
- Companion package metadata, `--help` / `--version`, packed-tarball smoke verification, and a provenance-ready manual npm publish workflow.

### Changed

- ZIP imports are fully validated in memory before confirmation and replacement; if a storage write fails, Dusori restores the previous workspace snapshot.
- Import confirmation now names the incoming workspace and reports topic and file counts.
- Generated roadmap, conflict, accepted-update, note, and source log wikilinks resolve correctly from nested dated update folders.

### Safety and portability

- Search, backlinks, health, review ordering, and recap remain read-only local projections; none creates a database, index, schedule, or hidden summary file.
- Workspace health never quarantines or repairs an invalid manifest implicitly. It reports the exact file and leaves recovery to the user.
- The public companion command is `npx @udhawan97/dusori@0.4.0 --root /path/to/Dusori`; the loopback, per-run token, root confinement, and terminal-lifetime boundaries are unchanged.

## [0.3.0] - 2026-07-21

### Added

- Companion research service: `/api/research/fetch` turns a user-confirmed URL into readable text with SSRF guards (blocked-address checks against private, reserved, and other non-public ranges on every redirect hop, a 3-hop cap, HTML/plain-text only, a 4 MiB fetch cap, and a 15 s timeout), and `/api/research/mslearn-search` proxies Microsoft Learn's ranked search.
- **Fetch full content** action on URL sources when the app runs through the companion: per-fetch confirmation naming the exact host, exact-content preview, conflict-safe replacement, and an update-log entry.
- Research panel uses ranked Microsoft Learn results through the companion when available, falling back silently to local catalog scoring.

### Changed

- Companion launch credentials are consumed into memory and immediately removed from the address and current history entry without dropping normal topic or view parameters.
- Connection status now requires a versioned Dusori companion health contract; an unrelated loopback server returning HTML or wrong-service JSON is no longer shown as connected.
- Source, research, and Obsidian guide dialogs now use the browser's modal top layer, contain forward and reverse keyboard focus, close once on Escape, and restore focus to their invoker.

### Safety and portability

- Source provenance (`origin.provider`, `origin.capturedVia`) widened to tolerant strings so future values never break a reader; upgraded sources record `companion` / `page-extract` provenance and keep their URL-hash identity.
- **Compatibility:** v0.2.0 can rename `Sources/manifest.json` after reading the newer `companion` provenance value. Source content is untouched, but users should update before reopening an upgraded workspace; if the rename already happened, update and rename the `.invalid-<timestamp>` manifest back.

## [0.2.0] - 2026-07-21

### Added

- Consent-gated, objective-led research using the keyless Microsoft Learn catalog and English Wikipedia APIs.
- Deterministically ranked suggestions with sanitized snippets, exact source previews, persistent dismissal, and normal source-library acceptance.

### Changed

- Scale the browser-local knowledge constellation to workspace size and order topics by wikilink affinity, with deterministic geometry audits that prevent node collisions and clipping.
- Mark wikilink hubs with marigold rings and let pointer and keyboard users focus a node, dim unrelated artifacts, and open the selection directly.
- Refine the public Dusori identity with the supplied ensō, rangoli, and katana geometry plus reduced-motion-aware animation.

### Safety and portability

- Accepted research captures remain URL sources, deduplicate by URL, record provider origin, append the topic update log, and appear in the portable graph.
- Provider consent stays on the device; all network access uses injected browser fetch, and the offline service worker ignores cross-origin API responses.
- Topic `research.json` files use schema validation and hash-guarded writes so concurrent dismissals are merged instead of silently lost.

## [0.1.0] - 2026-07-20

### Added

- Free, accountless browser workspace backed by origin-private storage, with ZIP import and export.
- User-approved folder access on supported Chromium browsers, including a least-privilege Obsidian setup flow.
- Portable Markdown and JSON topic structure with sanitized Markdown and strict Mermaid rendering.
- Today and Roadmap views with checkable progress, explicit topic status, and dated update history.
- Local source capture and preview-first curriculum import.
- Portable knowledge graph built from topic containment and Obsidian-style `[[wikilinks]]`.
- Installable offline PWA with a dark-first Japanese and Indian visual identity.
- Optional loopback-only, token-protected local companion foundation.

### Safety and portability

- External Markdown edits stay active; conflicting Dusori writes become explicit dated proposals.
- No account, telemetry, hosted application backend, graph database, paid service, plugin, or AI model is required.

### Known limitations

- Direct folder access requires a supported Chromium browser; other browsers use ZIP portability.
- Remote fetching, PDF extraction, search, Ollama transformations, generated schedules, and unattended work are not implemented.
- The optional companion is versioned in the repository but is not published to npm in this release.

[Unreleased]: https://github.com/udhawan97/Dusori/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/udhawan97/Dusori/compare/v0.11.3...v0.12.0
[0.11.3]: https://github.com/udhawan97/Dusori/compare/v0.11.2...v0.11.3
[0.11.2]: https://github.com/udhawan97/Dusori/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/udhawan97/Dusori/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/udhawan97/Dusori/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/udhawan97/Dusori/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/udhawan97/Dusori/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/udhawan97/Dusori/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/udhawan97/Dusori/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/udhawan97/Dusori/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/udhawan97/Dusori/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/udhawan97/Dusori/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/udhawan97/Dusori/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/udhawan97/Dusori/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/udhawan97/Dusori/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/udhawan97/Dusori/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/udhawan97/Dusori/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/udhawan97/Dusori/releases/tag/v0.1.0
