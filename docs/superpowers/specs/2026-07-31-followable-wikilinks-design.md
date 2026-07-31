# Wikilinks are followable inside Dusori

**Status:** approved · **Date:** 2026-07-31 · **Target release:** next

## Problem

`renderMarkdown` (`apps/app/src/lib/markdown.ts:52-61`) already rewrites
`[[Target]]` into `<a href="#wiki-Target">`. A repo-wide search for `wiki-`
finds exactly one hit: that emitter. Nothing listens for the anchor.

Dusori writes wikilinks into `Home.md`, every `Overview.md`, every dated update,
and every source log. None of them can be followed inside Dusori. The link
renders, invites a click, and does nothing — the workspace is a graph everywhere
except where the user reads it.

## Change

Three pieces, each with one job.

### 1. `resolveWikilink` becomes public and pure

`packages/core/src/graph/workspace-graph.ts:89` already holds the resolution
rules: strip an alias and a heading anchor, add `.md` when absent, then try the
workspace-root candidate, the path relative to the linking document, the topic
root, and finally a unique basename match.

It takes a `WorkspaceGraphNode` and a `Map<string, WorkspaceGraphNode>`, but
reads only `source.path`, `source.topicSlug`, and the map's keys. The signature
narrows to what it actually uses:

```ts
export function resolveWikilink(
  fromPath: string,
  rawTarget: string,
  paths: ReadonlySet<string>,
): string | null;
```

`topicSlug` is derived from `fromPath` with the `topicSlug()` helper already in
the file, so behaviour is unchanged. `buildWorkspaceGraph` passes a path set
built once outside its link loop.

This keeps one implementation of the rules. An app-layer copy would drift from
the graph, and a link that the graph counts as resolved would fail to open.

### 2. `wikilinkTarget` decodes the href

New pure function in `apps/app/src/lib/markdown.ts`, beside the emitter that
produces the href:

```ts
export function wikilinkTarget(href: string | null): string | null;
```

Returns the decoded target for a `#wiki-…` href and `null` for anything else.
It lives next to `renderMarkdown` so the encode and decode halves cannot drift,
and it is covered by the existing `markdown.test.ts`.

### 3. One delegated click handler

`apps/app/src/routes/+page.svelte` attaches a click handler to the
`<div class="note-sheet">` at line 1081. On click it takes the nearest
ancestor `<a>`, asks `wikilinkTarget` for a target, and ignores the event
entirely when there is none — ordinary links keep their ordinary behaviour.

With a target it prevents the default jump, lists the workspace's `.md` and
`.txt` paths with `storage.list('', true)`, resolves against them from the
current `notePath`, and calls the existing `openGraphDocument(resolved)`.

## Boundaries this respects

**The handler is on `.note-sheet`, not inside `MarkdownView`.** `MarkdownView`
also renders untrusted remote text — research result snippets
(`ResearchPanel.svelte:568`) and fetched capture previews (`:720`). Wiring
navigation into the shared component would let a search result's Markdown steer
the app. `.note-sheet` only ever holds a document already in the workspace.

**An unresolved or ambiguous link reports itself and changes nothing.** The
status line names the target and points at workspace health, which already ships
the one repair that creates the page a link names. Creating a file from a stray
click would be an implicit write, which the storage rules do not allow.

**No graph build on click.** `buildWorkspaceGraph` reads the content of every
file in the workspace. `storage.list('', true)` walks directory entries without
reading any of them, and resolution needs nothing but paths.

## Testing

Test-first.

`packages/core/src/graph/workspace-graph.test.ts`:

- A root-relative target resolves.
- A target beside the linking document resolves from a nested folder.
- A bare topic-local name resolves from a dated update folder.
- A unique basename elsewhere in the workspace resolves.
- Two files sharing a basename resolve to `null`.
- An alias and a heading anchor are stripped before matching.
- `buildWorkspaceGraph` edges and unresolved links are unchanged.

`apps/app/src/lib/markdown.test.ts`:

- A `#wiki-` href decodes, including a target with spaces and a slash.
- A plain fragment, an external URL, and `null` all return `null`.

`tests/e2e/dusori.spec.ts`: one journey — open a document holding a wikilink,
click it, and land on the linked document.

## Not in this slice

Rendering an unresolved wikilink differently from a resolved one. That needs
resolution at render time for every link in the document, which is a different
shape from resolving one link on demand.
