# Graph view: Obsidian-style adjustability and declutter — design

Date: 2026-07-22
Status: approved (autonomous session; defaults documented inline)

## Problem

The knowledge constellation is a static SVG scaled to fit its stage. On real
workspaces it reads as cluttered and hard to parse:

- No zoom or pan. Large graphs shrink until dots and labels collide; small
  graphs waste the stage.
- Node spacing is fixed by ring geometry (~30 px between fan members), so
  density cannot be relieved.
- Labels are all-or-nothing (structural/hub always, others only on hover), and
  they shrink with the fit scale.
- Nothing is adjustable. The user asked for Obsidian-style controls: zoom and
  link length at minimum.

## Goals

1. Freely explorable canvas: wheel/pinch zoom toward the cursor, drag to pan,
   plus keyboard-operable zoom controls and a reset-view action.
2. Adjustable layout: sliders for **link length** and **spacing** (repulsion),
   Obsidian-style, with settled motion while adjusting.
3. Declutter by default: physics separates collisions; labels appear
   progressively with zoom; hover highlights a node's neighborhood.
4. Keep the constellation's topical legibility (home center, topic clusters).
5. Keep every existing e2e contract: roles, names, `.node`/`.hub` classes,
   selection behavior, axe-clean.

## Non-goals (deliberate)

- Node dragging/pinning (Obsidian has it; not asked; adds pointer-capture and
  pin-state complexity). Add later if wanted.
- Filters, color groups, text-fade-threshold slider, arrows (Obsidian extras).
  Zoom-aware labels cover the fade behavior without a knob.
- New dependencies. No d3-force; the repo is deliberately dependency-light and
  the sim is ~100 lines of pure TypeScript.
- Persisting the camera. Forces persist; the view always opens fitted.

## Approaches considered

- **A. Static layout + viewBox zoom only.** Smallest diff, but spacing stays
  fixed, so the core clutter complaint survives. Rejected.
- **B. Full Obsidian clone (continuous d3-style sim, dragging, filters,
  groups).** Delivers everything, but throws away the tested deterministic
  layout, adds a dependency or a large custom engine, and most knobs weren't
  asked for. Rejected.
- **C. Hybrid (chosen).** Keep `layoutWorkspaceGraph` as the deterministic
  seed; relax it with a small custom force pass whose parameters are the
  sliders; put a camera on top. Obsidian feel, testable core, no new deps.

## Design

### Module: `apps/app/src/lib/graph-sim.ts` (new, pure)

- `relaxGraphLayout(nodes, edges, params): PositionedWorkspaceGraphNode[]` —
  position-based relaxation, deterministic (fixed iteration order, no
  randomness; exactly-coincident points separate by index-derived angle).
  Forces per tick:
  - Link springs toward `params.linkDistance` for `links` edges; `contains`
    edges use a shorter structural rest length scaled from the same knob.
  - All-pairs repulsion with strength `params.repelStrength` and a cutoff;
    per-node radius (degree-grown) sets the minimum separation floor.
  - Anchor springs: `home` pinned; `overview` nodes weakly anchored to their
    constellation seats so topic clusters stay put and readable.
  - Geometric step decay; stop at displacement epsilon or max ticks.
  - `relaxTick(...)` exposed so the component can animate the settle.
- Camera math: `zoomCameraAt(camera, focus, factor)`, `clampCamera`,
  `fitCamera(bounds, stage)` — pure, tested. Zoom range 0.5×–6× of fit.
- Settings codec: `readGraphViewSettings()` / `writeGraphViewSettings()` using
  localStorage key `dusori-graph-view`; parse defensively and clamp every
  number to its slider range (localStorage is a trust boundary).
- Degree-based radius: `nodeVisualRadius(node, degree)` = base kind radius,
  artifacts grow mildly with wikilink degree (cap ~+6 px).

### Component: `KnowledgeGraph.svelte`

- Stage becomes a clipped viewport (`overflow: hidden`, hairline border):
  the svg fills it and `viewBox` derives from `camera {x, y, zoom}` and the
  measured stage size. One user unit still equals one CSS pixel at fit zoom.
- Input: wheel zooms toward the cursor (trackpad pinch arrives as
  ctrl+wheel); background drag pans (pointer capture; a real drag suppresses
  the click-clears-selection handler); Escape and selection behavior
  unchanged.
- Controls panel, top-right overlay, collapsible via a 44 px settings toggle
  ("Graph controls"): zoom out/in buttons + zoom slider + "Fit view" button,
  then "Link length" and "Spacing" sliders. All native `<input type="range">`
  styled with existing tokens; marigold knowledge-axis accents; mono
  microcopy; visible focus. Slider changes re-heat the sim (graph-settle
  motion, transform-only, from current positions).
- Labels: keep structural/hub always-on. Non-structural labels fade in when
  zoom crosses ~1.4× fit (class toggle on the svg), and still reveal on
  hover/focus/selection at any zoom. A single `--graph-label-scale` var
  counter-scales font-size by `clamp(1/zoom, 1, 1.8)` so labels stay near
  token size when zoomed out.
- Hover: with a fine pointer and no active selection, hovering a node fades
  non-neighbors (reuses `neighborIds`); lighter opacity than selection fade.
- Reduced motion: relaxation runs to completion synchronously (no settle
  animation), zoom stays instant (it already is — viewBox math, no tween).
- Header metrics line and artifact index unchanged.

### Accessibility

- Every camera/force function reachable by keyboard: buttons and sliders are
  native focusable controls; sliders carry `aria-label` and visible value
  text. Wheel/drag are enhancements, not the only path.
- Nodes keep `role="button"`, tabindex, aria-pressed, Enter/Space/Escape.
- Controls toggle uses `aria-expanded`; panel is `role="group"` with a label.
- Axe-clean gate stays in e2e.

### Testing

- Vitest (`graph-sim.test.ts`): determinism; convergence (settles under max
  ticks on the scale fixture); link-distance slider monotonicity (larger
  param → larger mean linked-pair distance); repulsion floor (no pair closer
  than combined radii after settle); home stays pinned; camera zoom-at-point
  invariance (focus point maps to same stage point after zoom); clamping; and
  settings codec round-trip + hostile localStorage values.
- e2e (`dusori.spec.ts`): extend the existing graph test to open the controls
  panel, drag the link-length slider, assert the layout responds (viewBox or
  node position delta) and stays axe-clean; new assertions that settings
  survive reload (localStorage) and zoom buttons change the viewBox.
- Existing graph-layout tests unchanged (layout remains the seed).

### Docs and design-contract

- Update the component's Hallmark header (states line) and
  `KnowledgeGraph.preview.html` state contract with the controls states.
- One-line docs touch on the knowledge-graph page describing the adjustable
  view, if that page enumerates interactions.
- CHANGELOG entry under the next unreleased version.

## Risks

- Sim thrash on slider drag → ticks are cheap (O(n²) with n ≤ few hundred;
  ponytail ceiling noted in code) and rAF-coalesced.
- Playwright clicking moving nodes → existing tests select via keyboard and
  the index list; new tests interact with static controls only.
- Label halo (`paint-order: stroke`) already guards label-over-edge
  readability at any zoom.
