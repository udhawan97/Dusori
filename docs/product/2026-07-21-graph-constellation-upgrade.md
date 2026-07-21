# Knowledge-graph constellation upgrade — plan + Codex prompts

Date: 2026-07-21 · Status: proposal (UD to approve; implement via the two
Codex prompts below, one PR each)

Placed in `docs/product/` because Dusori keeps product plans here and
architecture decisions in `docs/adr/` (Task 1 adds ADR 008). The cited
open-source research behind this plan lives in the Codemble repo:
`Codemble/docs/research/2026-07-20-opensource-graph-architecture-inspiration.md`
(license table, per-project findings). Short version of what transfers:
graphify's constellation/community idea (MIT), archify's geometry-self-audit
idea (MIT), crabviz's click-to-focus idea (AGPL — idea only, never code).

## What the audit of the current Graph surface found

All in `apps/app/src/lib/components/KnowledgeGraph.svelte` (`placeNodes`,
lines ~24–66) against `packages/core/src/graph/workspace-graph.ts`:

- **Fixed radii, fixed canvas.** Topic ring radius is hard-coded 185 and the
  child fan radius 118, inside a hard-coded `viewBox="0 0 900 560"`. Past
  ~6 topics the overview discs collide; adjacent topics' child fans
  interleave well before that.
- **Overflowing fallback row.** Nodes with no topic land at
  `x = 110 + index * 82, y = 500` — off the right edge from the ~10th node.
- **Wikilinks play no part in placement.** Topics sit on the ring in array
  order, so linked topics can sit opposite each other with long arcs across
  the middle.
- **The SVG is `role="img"` and inert.** Graph nodes are not clickable or
  focusable; opening goes only through the artifact index. No hub signal,
  even though the design language says marigold marks connected knowledge.
- What is already right and must stay right: the core graph is deterministic
  (sorted nodes/edges/unresolved), unresolved wikilinks stay visible as a
  count, layout is browser-local and never writes coordinates into the
  workspace, and the whole surface works offline with no AI.

## Constraints (Dusori's own rules, binding on both prompts)

- **Deterministic and browser-local**: the docs promise "The layout is
  deterministic and browser-local. It does not write coordinates into your
  workspace." Same input graph → identical positions. No `Math.random`, no
  clock, ties broken by `localeCompare` like the core already does.
- **Honesty**: never invent an edge or hide unresolved links; every visual
  emphasis derives from edges the core actually built.
- **Free forever**: no new dependencies, no services, no network. Everything
  is plain TypeScript + SVG.
- **Design system** (`design.md`, Hallmark-locked): vermilion = action,
  marigold = connected knowledge. Hub emphasis is therefore marigold; the
  one new action control is vermilion. Reduced motion gets instant states.
- **Accessibility**: the artifact index stays as the accessible path; new
  SVG interactivity must add keyboard + ARIA, not replace the index. Axe
  (already wired via `@axe-core/playwright`) stays green.
- **Credit & cost policy** (same as the Codemble plan): reimplement ideas,
  never copy code. README gains an Acknowledgements section. crabviz is
  AGPL-3.0 — its _idea_ (focus-fade) is free to reimplement; its code is
  never ported. graphify and archify are MIT; dagre/aider et al. are in the
  research file's license table if ever needed.

## Task 1 — scaled deterministic constellation + geometry self-audit

Fixes the scale ceiling. Layout math moves out of the component into a pure,
tested module. Inspired by graphify's constellation/affinity idea and
archify's post-render geometry checks; count-scaled radii echo Codemble's
`layout.py`.

## Task 2 — connected-knowledge emphasis + focus interaction

Makes marigold literal: wikilink-degree hubs, and select-to-focus fading
(crabviz idea) with keyboard access. No layout changes.

## Codex prompt — Task 1

```text
You are working in Dusori (github.com/udhawan97/Dusori), a local-first
learning workbench PWA: pnpm 11 / Node 24 monorepo, Svelte app in apps/app,
core domain in packages/core, Vitest unit tests colocated as *.test.ts,
`pnpm check` = format:check + lint + typecheck + test:unit + build. Read
README.md, design.md, docs/adr/001-dual-execution.md (for ADR format), and
apps/site/src/content/docs/docs/knowledge-graph.md before coding.

TASK: The Graph surface's layout (placeNodes in
apps/app/src/lib/components/KnowledgeGraph.svelte) uses fixed radii (topic
ring 185, child fan 118), a fixed viewBox (900x560), and a fallback row that
walks off-canvas — it collides and clips on real workspaces. Replace it with
a count-scaled, wikilink-aware, deterministic constellation layout in a
pure, tested module.

HARD RULES — violating any of these is a failed task:
- Deterministic: same WorkspaceGraph in → identical positions out. No
  Math.random, no Date, no object-key iteration reaching output order; break
  ties with localeCompare on slug/path (the core already sorts this way).
- Browser-local only: never write coordinates or any new file into the
  user's workspace; never add a dependency; no network.
- Honesty: place only nodes the core produced; keep the unresolved-links
  count exactly as it renders today.
- Do NOT copy code from graphify, archify, Codemble, or any external repo —
  implement from the geometric spec below. If you catch yourself adapting
  external source, stop and say so in the PR body instead.
- Keep the component's Svelte idioms as they are (minimal diff); this task
  does not change interactivity, roles, or the artifact index.

IMPLEMENT — new file apps/app/src/lib/graph-layout.ts:
1. export const NODE_RADIUS = { home: 28, overview: 21, artifact: 12 }
   (artifact = every other kind). The component's <circle r> values must
   read from this map so layout and renderer cannot disagree.
2. export function layoutWorkspaceGraph(graph: WorkspaceGraph):
   { nodes: (WorkspaceGraphNode & { x: number; y: number })[];
     width: number; height: number }
   Algorithm, all in plain math:
   a. Group nodes by topicSlug. For each topic, children (same slug, not the
      overview) fill concentric rings around their overview: capacity 10 per
      ring, ring k (k = 0, 1, ...) radius 64 + 44*k, members in existing
      node order (already path-sorted), each ring spanning the same outward
      fan the current code uses (centered on the topic's angle from Home,
      total span 1.36*PI). Topic disc radius = outermost ring radius +
      NODE_RADIUS.artifact + 28 label clearance (minimum 96).
   b. Order topics around the ring by wikilink affinity: count 'links'
      edges whose endpoints lie in different topics (a node's topic is its
      topicSlug; nodes without one belong to no topic). Greedy order: start
      with the topic pair sharing the most links (ties: slug localeCompare),
      then repeatedly append the unplaced topic with the highest total link
      count to already-placed topics (ties: slug). Topics with zero
      cross-links go last in slug order. One topic → it takes angle -PI/2.
   c. Topic angles: -PI/2 + 2*PI*i/n in that order (n = topic count). Ring
      radius R = the smallest value satisfying ALL of: adjacent topic discs
      clear each other (2*R*sin(PI/n) >= disc_i + disc_j + 48 for each
      adjacent pair, n >= 2), every disc clears Home
      (R >= NODE_RADIUS.home + disc_i + 48), and R >= 185. Home sits at the
      centroid origin; delete the current single-topic special case in
      favor of these general rules (visual change is expected and fine).
   d. Nodes with no topicSlug and kind !== 'home' form a grid below the
      lowest placed content: 10 per row, 82 px column pitch, 56 px row
      pitch, left-aligned to the content's left bound.
   e. Compute bounds over every node circle plus label clearance (labels
      render up to ~56 px below a node and ~60 px wide beyond it), pad 40,
      then translate all coordinates so the top-left bound is (0, 0). Return
      width/height from those bounds.
3. The component: import layoutWorkspaceGraph and NODE_RADIUS, delete
   placeNodes, set viewBox={`0 0 ${layout.width} ${layout.height}`}, and
   drop the fixed halo circle's hard-coded center if it no longer matches
   (recompute it from Home's position). edgePath and everything else stays.

TESTS — apps/app/src/lib/graph-layout.test.ts (Vitest, build WorkspaceGraph
fixtures as plain objects; no storage needed):
- Determinism: two calls on the same fixture are deeply equal.
- Geometry self-audit on a scale fixture (8 topics x 12 children + 15
  topicless documents + Home): no two node circles overlap
  (center distance >= r1 + r2 + 4) and every circle sits inside
  [0, width] x [0, height].
- Affinity: a fixture where topics A and C share 3 links and B shares none
  places A and C at adjacent angles.
- Single topic: no crash, no overlap, finite bounds.
- Empty graph: returns no nodes and positive finite width/height.
- The current fixed-layout behavior is replaced; update any existing test
  that pinned it and list those updates in the PR body.

VERIFY (paste outputs in the PR body):
  pnpm install
  pnpm check          # format:check + lint + typecheck + test:unit + build
  pnpm test:e2e       # if Playwright browsers are available; otherwise say so
Then run `pnpm dev:app`, open the Graph view on a workspace with several
topics, and attach a before/after screenshot.

BOOKKEEPING (same PR):
- CHANGELOG.md: add an "## [Unreleased]" section (Keep a Changelog style,
  matching the 0.1.0 entry's voice) with this change.
- apps/site/src/content/docs/docs/knowledge-graph.md: one sentence that the
  constellation scales with workspace size and orders topics by their
  wikilink affinity — still deterministic, still browser-local, still
  writing nothing into the workspace.
- README.md: add an "Acknowledgements" section at the end (none exists):
  one line each, with links — Graphify-Labs/graphify (MIT) for the
  constellation and link-affinity ideas; tt-a1i/archify (MIT) for the
  geometry self-audit idea. Note "ideas reimplemented independently; no
  code copied."
- docs/adr/008-scaled-constellation-layout.md: follow the existing ADR
  format (see 001) — decision: count-scaled, affinity-ordered,
  deterministic layout in a pure module with geometry self-audit tests;
  consequences include the one-time visual relayout.
- graph-layout.ts header comment: "Constellation layout: count-scaled rings
  with wikilink-affinity ordering (idea: Graphify-Labs/graphify, MIT) and
  geometry self-audit tests (idea: tt-a1i/archify, MIT). Implemented
  independently; no code copied."
- Commit style: Conventional Commits (feat: ...), matching git log. Do not
  bump the version or tag a release.

OUT OF SCOPE: packages/core/src/graph/workspace-graph.ts (graph truth is
not this task), any interactivity/role changes in the SVG, the artifact
index, service worker, site pages beyond the one sentence above.
```

## Codex prompt — Task 2

Run only after Task 1 merges, on a fresh branch.

```text
You are working in Dusori (github.com/udhawan97/Dusori). Read README.md,
design.md, and apps/app/src/lib/components/KnowledgeGraph.svelte first.
Task 1 (docs/product/2026-07-21-graph-constellation-upgrade.md) has already
landed: layout lives in apps/app/src/lib/graph-layout.ts and the component
renders its numbers.

TASK: Make "marigold marks connected knowledge" literal on the Graph
surface, and make graph nodes first-class citizens: hub emphasis by
wikilink degree, plus select-to-focus fading with full keyboard access.
Layout does not change.

HARD RULES:
- Deterministic, view-only: emphasis and fading derive only from edges the
  core built. Never hide the unresolved-links count. No new dependencies.
- Do NOT copy code from crabviz — it is AGPL-3.0. Its focus-fade *idea* is
  reimplemented from scratch here; say so in a comment. graphify's
  "god node" idea (MIT) likewise: idea only.
- Design tokens: hub emphasis uses marigold (connected knowledge). The one
  new action control uses the existing action/vermilion accent. No color is
  the only carrier of meaning: hubs also say "hub" in text/ARIA; fading
  also sets aria-hidden state correctly (see below).
- prefers-reduced-motion: all new states apply instantly (the component
  already has the media query — extend it).
- The artifact index remains the accessible open-a-file path and is not
  restructured.

IMPLEMENT:
1. In apps/app/src/lib/graph-layout.ts add two pure helpers + Vitest tests:
   - wikilinkDegrees(graph): Map<string, number> counting 'links' edges
     touching each node id (both directions; 'contains' excluded).
   - neighborIds(graph, id): Set<string> of ids sharing any edge with id
     (both kinds), plus id itself.
2. Hubs: a node with degree >= 3 gets class "hub": its dashed node-ring
   becomes a solid marigold ring, and its <title> and aria-label append
   "hub - N wikilinks" (otherwise "N wikilinks" when N > 0).
3. Interactivity, in KnowledgeGraph.svelte:
   - The <svg> role changes img → group with the same aria-label (an img
     role strips the roles of children, which would silence everything
     below — this exact bug class was verified in a sibling project).
   - Each node <g> becomes role="button", tabindex="0", aria-label
     "<label>, <kind>[, N wikilinks][, hub]", with click / Enter / Space
     selecting it. aria-pressed reflects selection.
   - Selection fades non-neighbors: nodes outside neighborIds() drop to
     opacity 0.25, edges not touching the selection to 0.15; the selected
     node's ring uses the focus/action accent (selection = action, not
     marigold). Selecting again, pressing Escape, or clicking the SVG
     background clears it.
   - While a node is selected, render one button under the graph header:
     "Open <label>" (action accent) calling the existing onOpen(path).
     Remove it when selection clears.
4. Faded elements stay in the accessibility tree with their labels (fading
   is visual de-emphasis, not removal); do not set aria-hidden on them.

TESTS:
- Vitest for wikilinkDegrees and neighborIds (fixtures as plain objects:
  degrees count only 'links'; neighbors include both kinds + self).
- If Playwright browsers are available, extend the existing e2e/axe pass to
  the Graph view with a node selected (axe must stay green, keyboard path:
  Tab to a node, Enter selects, Escape clears). If not available, say so in
  the PR body.

VERIFY (paste outputs): pnpm install && pnpm check; pnpm test:e2e if
available. Run pnpm dev:app and attach screenshots: hubs visible, one node
selected with non-neighbors faded, reduced-motion unchanged states.

BOOKKEEPING (same PR):
- CHANGELOG.md under [Unreleased].
- apps/site/src/content/docs/docs/knowledge-graph.md: short "Hubs and
  focus" paragraph — hubs = notes many wikilinks touch (marigold ring);
  selecting a node dims what it is not connected to; keyboard supported.
- README.md Acknowledgements (created in Task 1; create if missing) gains:
  chanhx/crabviz (AGPL-3.0 — focus-fade idea only, no code) and a note that
  the hub idea follows Graphify-Labs/graphify's "god nodes" (MIT).
- Component comment above the fade logic: "Select-to-focus fading after
  chanhx/crabviz (AGPL-3.0): idea only, implemented from scratch; no code
  copied or derived."
- Conventional Commits; no version bump, no tag.

OUT OF SCOPE: layout math changes, packages/core, the artifact index's
structure, site pages beyond the paragraph above, any force simulation.
```

## Sequencing and risk

1. Task 1 first and alone — it changes every coordinate once and carries the
   self-audit tests that make Task 2's states safe to build on.
2. Task 2 is view-only on top; its only risk is a11y regressions, which the
   axe e2e pass guards.
3. Both PRs need UD's review; ADR 008 records the layout decision. Neither
   touches workspace files, core graph truth, or portability guarantees.
4. Everything stays free and dependency-free; the license gate for ever
   porting actual code is the research file's table (crabviz AGPL and
   grandalf GPL/EPL are permanently ideas-only).
