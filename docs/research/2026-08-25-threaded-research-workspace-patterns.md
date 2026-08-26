# Open-source patterns for a thread-like research workspace

**Date:** 2026-08-25

**Scope:** question threads, source-linked discussion, research history, organization, and
Markdown/HTML/PDF export

**Decision posture:** borrow product patterns; reuse code only after a file-level license and
dependency review

## Executive recommendation

Dusori should not become a general chat service or a second reference manager. Its strongest path
is a **local research thread**: one durable question, its chosen perspective, its explicit provider
runs, saved and read sources, quoted passages, follow-up questions, and generated artifacts. The
thread should be navigable both as a chronological activity stream and as evidence-linked branches.

Six mature patterns fit that direction:

1. **Make each question a durable, narrow thread.** Zulip's topic model keeps related discussion
   coherent across both live and asynchronous use; its URLs address a topic around a stable message
   identifier rather than relying only on a mutable label
   ([Zulip overview](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/README.md),
   [topic permalink construction](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/web/src/internal_url.ts)).
2. **Offer a local followed-threads inbox.** Mattermost keeps replies under a root message, allows
   explicit follow/unfollow, and provides a recent/unread Threads view
   ([Mattermost conversation organization](https://github.com/mattermost/mattermost/blob/f21b0299d326fe0a90cadb10a68160374350af03/docs/main/end-user-guide/collaborate/organize-conversations.mdx)).
   In Dusori, following should mean “show new local research activity,” never “contact providers in
   the background.”
3. **Connect history to exact evidence.** Discourse models ordered post revisions and a long-topic
   timeline, while Hypothesis stores several selectors and verifies the exact quoted text before
   anchoring it
   ([Discourse revision model](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/app/models/post_revision.rb),
   [Discourse topic timeline system test](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/spec/system/topic_timeline_drag_spec.rb),
   [Hypothesis anchor strategy](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/src/annotator/anchoring/html.ts)).
4. **Keep hierarchy, facets, and relationships distinct.** Zotero separately represents nested
   collections, tags, and related items; Logseq likewise combines hierarchical blocks with page
   references and properties
   ([Zotero collections](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/data/collection.js),
   [Zotero item relationships](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/data/item.js),
   [Logseq Markdown model](https://github.com/logseq/logseq/blob/3b9c0d0b9264bb69d76a3539b813e94819e20f07/docs/logseq-markdown-syntax.md)).
5. **Keep discovery, evidence, and writing as visible stages.** PaperQA separates search, evidence
   gathering, chunk ranking, and cited answer generation. STORM similarly performs research and
   outline construction before writing, and uses perspective-guided questions
   ([PaperQA pipeline](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/README.md),
   [STORM workflow](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/README.md)).
   Dusori should borrow the separation, not either project's autonomous runtime or provider
   defaults.
6. **Separate a lossless archive from presentation exports.** Joplin distinguishes lossless JEX/raw
   exports from HTML/PDF presentation exports; Logseq's Markdown-mirror design treats generated
   files as one-way derivatives; Pandoc and Quarto demonstrate a shared Markdown publishing path
   across HTML/PDF and citation formats
   ([Joplin import/export](https://github.com/laurent22/joplin/blob/b6889d3e7daa4e964fcd564ee8c67001461516e8/readme/apps/import_export.md),
   [Logseq Markdown mirror ADR](https://github.com/logseq/logseq/blob/3b9c0d0b9264bb69d76a3539b813e94819e20f07/docs/adr/0016-markdown-mirror.md),
   [Pandoc manual](https://github.com/jgm/pandoc/blob/5727e108278a73a78876d737e306a0a713d6dadd/MANUAL.txt),
   [Quarto overview](https://github.com/quarto-dev/quarto-cli/blob/d4cb49f1e70fb34e4cdf38edbb2f938c3ce7cc21/README.md)).

The bounded product move is therefore: add stable research-thread identity and a local event trail;
derive an updates inbox and timeline from that trail; improve quote locators for local reading
copies; add tags and explicit related links without duplicating files; and export a cited research
packet from the same stored evidence used by `Synthesis.md`.

## Fit with Dusori today

Dusori already has most of the trust boundary needed for this design:

| Existing Dusori behavior                                                                                                                                                      | What it proves                                                                          | Remaining gap                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`research.json`](../../packages/core/src/research/research-file.ts) stores the last 50 provider runs, search text, perspective, outcomes, and result counts.                 | Research execution is already durable and bounded.                                      | A run is not yet a stable user-facing thread, has no parent/follow-up identity, and does not connect later save/read/quote/build events. |
| [`source-reading.ts`](../../apps/app/src/lib/source-reading.ts) records the local source path, SHA-256 fingerprint, optional heading, and normalized selected passage.        | A quoted claim can point to a particular local reading copy.                            | It lacks position/context/page locators; a changed fingerprint should leave the annotation stale rather than relocate it automatically.  |
| [`write-protocol.ts`](../../packages/core/src/conflict/write-protocol.ts) writes dated update logs and protects external Markdown edits with proposals.                       | Generated updates can coexist safely with user edits.                                   | The log is prose, not a structured activity index that can drive filtering or a timeline.                                                |
| [`artifacts.ts`](../../packages/core/src/research/artifacts.ts) creates durable `Synthesis.md` and `Learning/learn.html`, proposing rather than overwriting when appropriate. | Markdown and HTML already share the stored evidence boundary.                           | There is no general cited research-packet profile or PDF output contract.                                                                |
| [`portable.ts`](../../packages/core/src/portable.ts) snapshots workspace files into a ZIP, validates complete imports, and labels a topic bundle as non-importable.           | Dusori already distinguishes a complete workspace archive from a readable topic bundle. | Presentation exports need equally explicit round-trip and provenance semantics.                                                          |
| [`create.ts`](../../packages/core/src/workspace/create.ts) creates topic-local Notes, Updates, Sources, and Backups.                                                          | The filesystem remains the canonical local organization.                                | Faceted organization and explicit cross-links should not require moving or duplicating source files.                                     |

The current question-led Research view and five-stage Find → Rank → Save → Read → Build path are
compatible with these recommendations. The missing connection is a durable identity and event model
that carries the learner from the original question through later artifacts.

## Pattern findings

### 1. Question threads: use a topic model, not a chat river

Zulip describes its core differentiator as topic-based threading that supports both synchronous and
asynchronous discussion. A topic link is built from stream, topic, and a stable nearby message ID,
and topic-history logic can find a message near the requested point
([Zulip README](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/README.md),
[internal topic URLs](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/web/src/internal_url.ts),
[topic history](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/web/src/stream_topic_history.ts)).

**Dusori pattern:** give every asked question a stable `threadId`; preserve its original question,
perspective, and output style; allow a follow-up question to carry `parentThreadId`; and address the
thread by ID while keeping its title editable. The visual form can resemble conversation, but each
entry should be a typed research event rather than free-form chat.

**Do not borrow:** presence, direct messages, reactions, typing indicators, servers, or a general
message backend. They solve collaboration rather than research continuity.

Mattermost adds a useful second layer: users can follow/unfollow threads, see reply activity in a
central Threads view, filter unread items, and are automatically following when they participate or
are mentioned
([Mattermost conversation organization](https://github.com/mattermost/mattermost/blob/f21b0299d326fe0a90cadb10a68160374350af03/docs/main/end-user-guide/collaborate/organize-conversations.mdx)).

**Dusori adaptation:** make following explicit and local. A followed thread appears in an Updates
inbox when saved sources, reading state, quotes, research runs, or artifacts change. Following never
changes either auto-refresh or provider consent. An armed stale-topic refresh may run when Dusori
opens only while the provider's separate per-device, payload-scoped egress consent remains valid.
Viewing, following, mapping, or exporting a thread never arms refresh or grants provider consent.

### 2. History: show what changed, but do not turn history into evidence

Discourse stores ordered revisions and visibility state. Its serializers also enforce whether a
viewer may inspect edit history
([revision model](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/app/models/post_revision.rb),
[edit-history permission test](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/spec/serializers/post_serializer_spec.rb)).
The topic timeline is a navigational control for long discussions, including drag-to-position
behavior tested at the system level
([timeline test](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/spec/system/topic_timeline_drag_spec.rb)).

**Dusori pattern:** record structured, append-oriented events such as:

- `question-created` / `follow-up-created`;
- `research-started` / `research-completed` with provider outcomes;
- `source-saved`, `source-read`, or `source-marked-reference`;
- `quote-added` with source and annotation identity;
- `note-added` or `follow-up-added`, optionally carrying `replyToEventId`, `sourceRef`, and
  `annotationRef`;
- `synthesis-written` or `synthesis-proposed` with the resulting content hash; and
- `export-created` with an export-manifest hash.

The timeline should filter by these types and link directly to the stored artifact. It should not
claim that a provider run, revision, or generated heading is evidence. Only locally eligible source
claims may support synthesis, preserving Dusori's central evidence boundary.

A user note or source-linked reply is interpretation unless it points to an eligible quoted claim;
the link supplies context, not automatic evidential status.

For artifact revisions, store identity, timestamp, parent hash, and output hash; generate a diff on
demand from available local content. Avoid duplicating complete large documents inside every event.
The event log must be stored as an ordinary canonical workspace file so it participates in the
lossless workspace archive. Define maximum event count, field sizes, and total bytes plus the
retention/compaction policy before shipping. State the bound plainly, and preserve a tombstone with
only ID, timestamp, and type when a retained event replies to or references a pruned event; a
tombstone must retain no quote, source text, or provider payload. Never leave a dangling reference or
imply a permanent audit ledger.

Use an allowlisted event schema and define deletion semantics with it. Deleting a source should
scrub its event payloads to bounded tombstones, or the confirmation must warn precisely which
history will remain; deleting a thread should remove its owned event log while preserving only
minimal tombstones required by retained external references. Previously exported archives remain
independent copies and are not retroactively redacted, so deletion UI must say so.

Joplin's note-history design is a useful caution: it creates revisions periodically and applies a
configurable retention period across synchronized devices
([Joplin note history](https://github.com/laurent22/joplin/blob/b6889d3e7daa4e964fcd564ee8c67001461516e8/readme/apps/note_history.md)).
Dusori does not need periodic snapshots or sync-derived retention. Content-hash events at meaningful
research transitions better fit its local-first, conflict-aware filesystem.

### 3. Quote anchoring: strengthen local locators without fetching the live page

Hypothesis represents text quotes with `exact`, `prefix`, and `suffix` context and also has position
selectors. Its HTML anchoring attempts several selectors, checks that the recovered quote equals the
stored exact text, and falls back among strategies. Its PDF anchoring uses page text and cached
position/quote information
([selector types](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/src/annotator/anchoring/types.ts),
[HTML anchor verification](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/src/annotator/anchoring/html.ts),
[PDF anchoring](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/src/annotator/anchoring/pdf.ts)).

**Dusori pattern:** retain `source_content_sha256` as the authority and optionally add a bounded
locator for locally captured readable sources:

```json
{
  "normalizationVersion": "dusori-source-text-v1",
  "normalizedContentSha256": "…",
  "exact": "selected passage",
  "prefix": "short preceding context",
  "suffix": "short following context",
  "start": 1840,
  "end": 1856,
  "pageIndex": 6,
  "pageLabel": "7"
}
```

Use only fields meaningful for that source type. Version the normalization algorithm; define indexes
as Unicode code-point or UTF-16 offsets; and strictly bound prefix, suffix, exact, and total locator
sizes. Make offsets document-wide in the versioned normalized reading text derived from the
fingerprinted local file, and store that normalized text's hash. For paged material, use a zero-based
`pageIndex` plus optional displayed `pageLabel`, following Hypothesis's explicit page-selector
semantics
([Hypothesis `PageSelector`](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/src/types/api.ts)).
Resolve position first when the fingerprint and normalization version are unchanged, verify `exact`,
then try prefix/suffix matching. If the file hash changed or a match is ambiguous, show the annotation
as stale/unanchored and retain its original quote. Never silently re-anchor against a live URL, and
never create a quote locator for a reference-only record.

This is an inspiration-only adaptation. Dusori's current source annotation already has the more
important content fingerprint; adopting Hypothesis's application architecture would add unrelated
browser-extension and service complexity.

### 4. Organization: collections, tags, and related links answer different questions

Zotero collections can nest and carry stable library/key/version identity. Items separately manage
collection membership, tags, and related-item links; its report renderer includes tags and
bidirectional related items, and its import/export tests verify related-item relations survive
export
([collection model](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/data/collection.js),
[item model](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/data/item.js),
[report relationships](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/report.js),
[relation export test](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/test/tests/importExportTest.js)).

Logseq's file syntax shows the complementary local-first model: hierarchical blocks, page
references, tags, and properties coexist in plain text
([Logseq Markdown syntax](https://github.com/logseq/logseq/blob/3b9c0d0b9264bb69d76a3539b813e94819e20f07/docs/logseq-markdown-syntax.md)).

**Dusori pattern:**

- keep topic directories as physical ownership and export boundaries;
- add normalized tags as optional facets for sources, notes, and research threads;
- add explicit typed relations such as `supports`, `challenges`, `updates`, `background-for`, and
  `follow-up-to`; and
- let saved searches or views combine tags and relations without copying the underlying file.

Relation labels describe the learner's organization, not a verified factual conclusion. A
`supports` link should point to an eligible quoted claim if it is displayed as evidential support;
otherwise label it as a user-authored relationship. The Depth map can render these stored
relationships, but must not infer missing edges with a model and present them as fact.

Avoid a second free-form folder system inside each topic. It would compete with the filesystem and
make ZIP portability harder. A single source may appear in several tag/filter views while retaining
one canonical local record.

### 5. Research orchestration: visible branches, grounded evidence, human control

PaperQA documents a pipeline that searches, gathers evidence, ranks chunks with contextual
summaries, and produces answers with in-text citations. It also distinguishes metadata and full-text
search behavior
([PaperQA README](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/README.md)).
STORM's pre-writing stage collects references and builds an outline before writing; it generates
perspective-guided questions and grounds simulated research conversations in retrieved sources.
Co-STORM additionally exposes a dynamically updated hierarchical mind map, while its own README
warns that generated reports are not publication-ready
([STORM README](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/README.md)).

**Dusori pattern:** preserve the existing Find → Rank → Save → Read → Build boundary and make each
branch inspectable:

- a learner-created question or follow-up starts the branch;
- perspective terms influence the query but remain separate from required topic terms;
- provider outcomes and ranked candidates stay discovery records;
- saved reference-only records remain useful leads but cannot become claims;
- read local sources and normalized quoted annotations form the evidence layer; and
- generated outlines, counts, questions, gaps, and prose remain clearly distinguished from
  normalized cited passages.

For the Depth map, use saved artifacts and explicit thread/source/annotation relations as nodes and
edges. The graph becomes more useful when selecting a node explains _why the edge exists_ and links
to the underlying file or event. A dynamic visual should never manufacture research history.

**Do not integrate now:** PaperQA's Python/LLM runtime or STORM's agent stack. Both would duplicate
Dusori's provider routing and create new model/network consent surfaces. Their separation and
interaction patterns are the useful parts.

### 6. Export: canonical archive, cited packet, presentation render

Joplin explicitly distinguishes lossless, re-importable JEX/raw exports that preserve metadata from
presentation-oriented HTML/PDF exports
([Joplin import/export](https://github.com/laurent22/joplin/blob/b6889d3e7daa4e964fcd564ee8c67001461516e8/readme/apps/import_export.md)).
Logseq's Markdown-mirror ADR makes a generated mirror one-way, keeps stable identity separate from
human filenames, avoids import/watch feedback loops, writes atomically, and treats collisions or
unsafe paths as errors rather than guesses. It also says the mirror is not a backup or bidirectional
sync mechanism
([Logseq Markdown mirror ADR](https://github.com/logseq/logseq/blob/3b9c0d0b9264bb69d76a3539b813e94819e20f07/docs/adr/0016-markdown-mirror.md)).

**Dusori contract:** expose three deliberately different products:

1. **Workspace archive:** the existing validated ZIP that round-trips workspace file contents and
   required structures. This is the only round-trip format; it does not promise filesystem metadata
   or empty-directory preservation.
2. **Research packet:** deterministic Markdown containing the question/thread path, output,
   eligible cited passages, source list, research gaps, and provenance appendix. Reference-only
   sources may appear in a clearly separate “leads” section but never support claims.
3. **Presentation render:** standalone HTML and optional PDF produced from the research-packet
   model. These are readable derivatives, not import or backup formats.

Every packet/render should carry or accompany an `export-manifest.json` with the thread/topic IDs,
included local paths and content hashes, creation time, output style, eligible claim count, source
list, and renderer/version. It should state whether the output is complete or omitted a source/file.
For browser print-to-PDF, offer the manifest as a separate download and state that the standalone PDF
is readable but is not a complete provenance package. This makes the export reproducible without
pretending that the generated prose is primary evidence.

Before export, show the learner the reference-only leads, topic-relative local paths, and metadata
that will be included. Never traverse a cross-topic relation automatically: include another topic
only after explicit selection, and list unresolved or omitted targets in the manifest. Allowlist
provider outcome fields and sanitize their human-readable messages; never export raw response
bodies, headers, credentials, request payloads, or arbitrary provider metadata.

Serialize every untrusted question, quote, note, provider label/message, source field, and synthesis
field as escaped literal Markdown. Neutralize raw HTML and image/media/embed syntax, and construct
external links only from validated HTTP(S) URLs that require a learner click. Do not concatenate
stored Markdown into a packet merely because it came from a local file.

Manubot resolves persistent scholarly identifiers into structured citation data and generates
citation outputs for Pandoc-oriented publishing. Its Rootstock template versions Markdown source
and produces HTML/PDF outputs
([Manubot citation/output overview](https://github.com/manubot/manubot/blob/859dd15850d7e89184e75c3a63e9d9e3f9ab9873/README.md),
[Rootstock publishing workflow](https://github.com/manubot/rootstock/blob/f44f9bbe35441a8acd51a5898e6e739acaf54c1c/README.md),
[Rootstock CC BY 4.0 license](https://github.com/manubot/rootstock/blob/f44f9bbe35441a8acd51a5898e6e739acaf54c1c/LICENSE.md)).
Dusori can borrow the idea of storing normalized persistent identifiers and CSL-compatible citation
metadata alongside its source manifest. Resolver results should be cached with provenance and allow
manual correction. Export must not perform surprise network resolution; any lookup remains a
separately consented provider action.

Pandoc supports Markdown, HTML, PDF, citations, templates, and filters, but its PDF routes require
one of several external engines and conversions to less expressive formats can be lossy
([Pandoc manual](https://github.com/jgm/pandoc/blob/5727e108278a73a78876d737e306a0a713d6dadd/MANUAL.txt),
[Pandoc overview](https://github.com/jgm/pandoc/blob/5727e108278a73a78876d737e306a0a713d6dadd/README.md)).
Quarto shows how a shared project profile can add citations, cross-references, and consistent
options across several output formats on top of Pandoc
([Quarto README](https://github.com/quarto-dev/quarto-cli/blob/d4cb49f1e70fb34e4cdf38edbb2f938c3ce7cc21/README.md)).

**Bounded implementation:** keep built-in Markdown deterministic and make HTML/PDF network-inert.
Escape every dynamic field; remove raw HTML, remote images/media/embeds, CSS URLs, remote fonts, and
remote assets; apply a restrictive Content Security Policy; and expose external HTTP(S) URLs only as
links activated by the learner. Use topic-relative local paths only. Start PDF with a print-specific
HTML stylesheet and an explicit user print/save action. If direct PDF export later becomes necessary,
place Pandoc or Quarto behind an optional local process adapter with a capability check. The adapter
must use fixed trusted configuration and templates, disable workspace-supplied extensions, filters,
includes, and execution hooks, deny network access, and operate in a bounded temporary directory. Do
not download tools automatically. Record the executable/version plus normalized, redacted arguments
without absolute paths or usernames; feed it only explicitly selected local inputs; and let renderer
failure leave the canonical Markdown and ZIP untouched.

## Recommended delivery sequence

### P0a — smallest connected slice, no new runtime dependency

1. Add one durable thread ID plus optional parent identity to the stored research model.
2. Record bounded typed events for question, run, source save/read, quote, and synthesis/proposal.
3. Render one thread activity view, linking events to their local artifacts and showing provider
   outcomes without upgrading discovery results to evidence.
4. Add an always-available deterministic Markdown research packet and export manifest.

Migration should be additive: a legacy run can display under a synthetic “Earlier research” group,
without inventing a historical question ID or parent relation.

### P0b — validate semantics, then add the inbox

1. Validate event migration, retention, compaction, broken-target behavior, and archive round-trip.
   Include delete/redaction behavior and the warning that prior archives remain independent copies.
2. Add explicit follow/unfollow and derive the local followed-threads Updates inbox from the proven
   event model.
3. Add source-linked note/reply events and export events.

### P1 — improve evidence navigation and organization

1. Add optional exact/prefix/suffix/position/page locators to new local-source annotations while
   retaining the content hash and original quote.
2. Add normalized tags and explicit related-record links without moving or duplicating files.
3. Teach the Depth map to explain each stored edge and jump to source, annotation, event, or
   artifact.
4. Add HTML rendering from the same packet model and a print stylesheet for user-initiated PDF.

### P2 — only after measured export demand

1. Normalize DOI, ISBN, arXiv, PMID/PMCID, and other already-known identifiers into a
   citation-metadata record; require consent for resolver calls and cache their provenance.
2. Offer an optional local Pandoc/Quarto adapter for direct PDF and advanced citation styles.
3. Validate export fixtures for Unicode, long URLs, nested lists, tables, page breaks, missing
   metadata, stale annotations, and mixed eligible/reference-only sources.

## Explicit non-goals and safeguards

- No Slack clone, multi-user server, presence, reactions, or real-time messaging.
- No cloud activity feed; the inbox is derived from local stored events.
- No provider call merely because a thread is followed, exported, or viewed on the map. Opening may
  run only a separately armed stale-topic refresh whose provider egress consent remains valid; it
  never grants consent or arms refresh.
- No model-created relationship displayed as research provenance.
- No reference-only record in evidence counts, quotes, AI payloads, synthesis claims, or cited
  exports.
- No silent re-anchoring against a live webpage after the local source fingerprint changes.
- No claim that HTML/PDF is a lossless or re-importable workspace format.
- No remote-loadable content or raw provider payloads in a presentation export.
- No raw HTML, remote embeds, or unescaped untrusted fields in the Markdown packet.
- No automatic installation of Pandoc, Quarto, a browser, TeX, or another renderer.
- No code copying from inspiration repositories without checking the exact file and transitive
  license obligations.

## Source and license matrix

Star counts below are approximate GitHub counts observed on 2026-08-25; they establish that the
general-purpose projects are widely followed on GitHub, not that their designs or sources are
automatically reputable. Hypothesis, Manubot, and Rootstock are included as domain-specific
exemplars because their anchoring, citation, and publishing designs directly address the evidence
problem.

| Project                                                                                                 | Approx. stars | License at reviewed revision                                                                                                                                                                                                                                                           | Use here                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [Zulip](https://github.com/zulip/zulip/tree/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9)                   |           26k | [Apache-2.0](https://github.com/zulip/zulip/blob/d01fc67b90a2dd7cdbdcc57edd6607dff9682ee9/LICENSE)                                                                                                                                                                                     | Topic/thread identity inspiration only.                                     |
| [Mattermost](https://github.com/mattermost/mattermost/tree/f21b0299d326fe0a90cadb10a68160374350af03)    |           39k | [Mixed terms by directory/build](https://github.com/mattermost/mattermost/blob/f21b0299d326fe0a90cadb10a68160374350af03/LICENSE.txt)                                                                                                                                                   | Followed-thread inbox inspiration only; review any exact file before reuse. |
| [Discourse](https://github.com/discourse/discourse/tree/ed9f07d9f5cebcd9160c149cd179de98256e5dea)       |           48k | [GPL-2.0](https://github.com/discourse/discourse/blob/ed9f07d9f5cebcd9160c149cd179de98256e5dea/LICENSE.txt)                                                                                                                                                                            | Timeline/revision inspiration only.                                         |
| [Logseq](https://github.com/logseq/logseq/tree/3b9c0d0b9264bb69d76a3539b813e94819e20f07)                |           45k | [AGPL-3.0](https://github.com/logseq/logseq/blob/3b9c0d0b9264bb69d76a3539b813e94819e20f07/LICENSE.md)                                                                                                                                                                                  | Local graph and derived-output patterns only.                               |
| [Zotero](https://github.com/zotero/zotero/tree/6d8198bbfa4ab3f9dcdc6721250728119764de9a)                |           15k | [Repository COPYING: AGPL-3.0](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/COPYING); [cited JS headers: AGPL-3.0-or-later](https://github.com/zotero/zotero/blob/6d8198bbfa4ab3f9dcdc6721250728119764de9a/chrome/content/zotero/xpcom/data/item.js) | Collection/tag/relation patterns only.                                      |
| [PaperQA](https://github.com/Future-House/paper-qa/tree/57e89f7223b0960d5ee5ea048c69e3c47e088572)       |            9k | [Apache-2.0](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/LICENSE)                                                                                                                                                                           | Evidence-pipeline inspiration; no runtime integration proposed.             |
| [STORM](https://github.com/stanford-oval/storm/tree/fb951af7744dab086e34962e9bc6fe878e145f83)           |           31k | [MIT](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/LICENSE)                                                                                                                                                                                    | Perspective/branch/map inspiration; no runtime integration proposed.        |
| [Hypothesis client](https://github.com/hypothesis/client/tree/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a) |          700+ | [BSD-2-Clause root; MIT annotator subcomponent](https://github.com/hypothesis/client/blob/b4d085a2f893aa6de3b61d8b8bc3ae4d0f24fc1a/LICENSE)                                                                                                                                            | Selector design inspiration only.                                           |
| [Joplin](https://github.com/laurent22/joplin/tree/b6889d3e7daa4e964fcd564ee8c67001461516e8)             |           56k | [AGPL-3.0-or-later, with subdirectory exceptions](https://github.com/laurent22/joplin/blob/b6889d3e7daa4e964fcd564ee8c67001461516e8/LICENSE)                                                                                                                                           | Archive/presentation distinction and history inspiration only.              |
| [Pandoc](https://github.com/jgm/pandoc/tree/5727e108278a73a78876d737e306a0a713d6dadd)                   |           46k | [GPL-2.0-or-later](https://github.com/jgm/pandoc/blob/5727e108278a73a78876d737e306a0a713d6dadd/pandoc.cabal)                                                                                                                                                                           | Optional separately installed executable, not embedded code.                |
| [Quarto CLI](https://github.com/quarto-dev/quarto-cli/tree/d4cb49f1e70fb34e4cdf38edbb2f938c3ce7cc21)    |            6k | [MIT](https://github.com/quarto-dev/quarto-cli/blob/d4cb49f1e70fb34e4cdf38edbb2f938c3ce7cc21/COPYING.md)                                                                                                                                                                               | Optional publishing-profile reference; likely unnecessary for P0.           |
| [Manubot](https://github.com/manubot/manubot/tree/859dd15850d7e89184e75c3a63e9d9e3f9ab9873)             |          470+ | [BSD-2-Clause Plus Patent](https://github.com/manubot/manubot/blob/859dd15850d7e89184e75c3a63e9d9e3f9ab9873/LICENSE.md)                                                                                                                                                                | Persistent-ID/citation manifest inspiration only.                           |
| [Manubot Rootstock](https://github.com/manubot/rootstock/tree/f44f9bbe35441a8acd51a5898e6e739acaf54c1c) |          480+ | [CC BY 4.0](https://github.com/manubot/rootstock/blob/f44f9bbe35441a8acd51a5898e6e739acaf54c1c/LICENSE.md)                                                                                                                                                                             | Versioned publishing-workflow inspiration only.                             |

License labels are pinned observations, not legal advice. Mattermost, Joplin, Hypothesis, Zotero,
and Rootstock require particular care at the file, subcomponent, or repository boundary. If Dusori
later imports code, ships a binary, invokes an executable, or distributes a modified component,
review the exact revision, files, notices, and distribution model at that time.

## Bottom line

The famous projects converge on one useful idea for Dusori: continuity comes from durable identity,
structured activity, and exact links—not from a stationary roadmap or a generic chat box. Dusori
can achieve that without weakening its evidence rules: a question thread may contain discovery,
updates, generated organization, and presentation exports, but only locally read, provenance-bound
claims may support its answers.
