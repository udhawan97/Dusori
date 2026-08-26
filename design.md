# Design — Dusori

A locked design system for the Dusori app, website, documentation, and public artifacts. Every page reads this file before visual work. Extend this system when a new need appears; do not invent page-local palettes or typography.

## Genre

Atmospheric editorial: a nocturnal learning desk with Japanese spatial restraint and subtle Indian knowledge geometry. Function stays primary. Cultural references come from the supplied ensō, katana, and rangoli identity—not decorative pastiche.

## Macrostructure family

- Marketing pages: Workbench-led Split Studio with one dominant real product capture, an icon-led download shelf, and a ruled proof sequence.
- App pages: Research Desk with one narrow question-led thread and four literal destinations (`Research`, `Sources`, `Map`, `Settings`). A submitted question creates or selects the topic, searches only disclosed providers, captures the diverse shortlist, reads quotable local text, and saves the chosen evidence-backed structure. Optional learning tools live under Settings without gating research. The grouped source shelf and interactive depth map stay one action away. The depth map is a secondary representation and always has a searchable Outline equivalent.
- Content pages: Long Document with a narrow reading measure and ruled navigation.

The app must never return to a dashboard rail full of product modules. Its governing sequence is `ask → find → rank → save → read what is available → build → show gaps → research further`. Research shows this as a live five-step path (`Find`, `Rank`, `Save`, `Read`, `Build`) rather than a stationary roadmap. A screen gets one dominant next action. Saved sources, provider state, update controls, and recovery actions use literal labels rather than mystery icons. Learning objectives, quizzes, and roadmaps are optional legacy tools, not the primary app structure.

## Theme

The supplied identity fixes the four anchors. Vermilion belongs to the blade/action axis; marigold belongs to the wheel/knowledge axis. Neither becomes a large background.

- `--color-night` `oklch(15% 0.012 55)`
- `--color-night-2` `oklch(19% 0.014 60)`
- `--color-paper` `oklch(96% 0.014 80)`
- `--color-paper-2` `oklch(93% 0.016 80)`
- `--color-rule-dark` `oklch(32% 0.014 70)`
- `--color-rule-light` `oklch(80% 0.012 75)`
- `--color-vermilion` `oklch(58% 0.17 32)`
- `--color-marigold` `oklch(67% 0.14 72)`
- `--color-focus` `oklch(72% 0.13 32)`

System is the first-run appearance. Paper, Ink, and Night are explicit local choices in the same palette family; the old light/dark preference migrates to Paper/Night.

## Typography

- Display: Shippori Mincho, weight 600, style normal.
- Body: Zen Kaku Gothic New, weights 400 and 700.
- Mono: IBM Plex Mono, weight 400.
- Display tracking: `-0.02em` for large headings; normal elsewhere.
- Type scale anchor: `--text-display: clamp(2.75rem, 5vw + 1rem, 6rem)`.

## Spacing

Use the existing 4-point named scale in `apps/app/src/styles/tokens.css`. Components consume named tokens only.

## Motion

- Easings: `--ease-out`, `--ease-in`, and `--ease-in-out` from shared tokens.
- Allowed primitives: mark-draw, graph-settle, and state crossfade.
- Animate transform and opacity only.
- Reduced motion: no spatial movement; opacity-only at 150 ms or less.

## Microinteractions stance

- Silent success when the result is already visible.
- Errors stay adjacent to the action that failed.
- Hover styling runs only for hover-capable fine pointers.
- Focus is immediate, visible, and never animated.
- Every unavailable browser capability explains the exact alternative.

## CTA voice

- Primary: ink/paper inversion, rectangular with a slight 4 px corner, direct verb-first copy.
- Secondary: transparent ruled button, vermilion text only for an actual write/navigation action.
- Never use pill CTAs or ornamental badges.

## Per-page allowances

- Marketing may use the animated identity mark and real application screenshots.
- App pages use only functional artifacts: file graph, progress wheel, source provenance, and current state.
- Docs remain typography-led and do not animate content.

## Research Desk interaction contract

- `Research` begins with one visible question. Returning users can go from query to brief in one action; first use adds one grouped disclosure that still records a separate choice for every provider. AI consent remains separate.
- Perspective prompts may reshape the real query, but the user's own question remains the visible source of truth. Output structure (`Brief`, `Comparison`, `Timeline`, or `Study guide`) is chosen before the run and stored with the research file.
- Automatic capture is limited to text, abstracts, metadata, or references returned through the provider API named in its disclosure. Dusori never fetches an arbitrary discovered page in the background.
- The diverse initial shortlist uses relevance, authority, recency where useful, provider, kind, and hostname. Every saved result keeps its ranking reasons. Overflow stays available through **Show more** and refinement.
- The run visibly moves through searching, evaluating, saving, reading, and writing. A provider or source failure never discards the successful work from the same run.
- Only quotable captured text contributes claims. Reference-only and blocked pages never appear as read evidence. If nothing is quotable, the persistent result view separates references found from sources read and offers **Read from <host>**, **Open original**, and paste-text continuations instead of producing a false brief.
- `Sources` is the durable evidence shelf. It groups references by research lens (`Academic`, `Documentation`, `Books`, `Community`, `Video`, `Web`, or `Your material`) without changing provenance. Full-page reading is one host-named action whose click is the exact-host confirmation. Authentication, rate limits, paywalls, redirects to another origin, offline failures, and unsupported pages keep the reference and an immediate browser fallback.
- **Remove from research** is reversible and removes the record from counts, claims, synthesis, and Map without deleting unrelated notes. The retained local item and restore behavior are disclosed.
- `Map` defaults to a searchable Outline and reports discovered, saved, read, quoted, and freshness facts only. It never infers mastery. **Depth map** is an optional rotatable, zoomable CSS-3D evidence landscape with selected-topic isolation, real artifact lanes, and a literal evidence inspector. Its geometry is derived only from saved workspace data.
- `Settings` owns provider decisions and reset controls, appearance, local/desktop storage, import/export, updates, privacy, and the secondary entry to legacy learning tools.
- Provider capability (`Ready`, `Setup required`, `Disabled`) stays separate from run outcome (`Found`, `Empty`, `Failed`). Both survive navigation and relaunch.
- Once `Build` completes, the default result is a single research thread rather than an automatic jump into a separate note. Its fixed message order is question → provider receipt → collected sources → cited answer → update/history controls. A Document view preserves the ordinary `Synthesis.md` reading surface.
- The exact user-visible question is stored separately from the provider-expanded search payload. Reload, manual update, and scheduled recheck reuse that exact question. A failed or empty update is recorded in history and labeled, but does not erase or impersonate the last completed answer.
- Every source reply carries its original link, research lens, evidence state, selection reasons when available, and a direct route to its saved copy. Reference-only items never inherit the styling, counts, or language of read evidence.
- Thread exports are presentation derivatives of the same saved sources, run trail, and synthesis: a network-inert Markdown receipt, a self-contained network-inert HTML document, and the system Print dialog for PDF. Exports retain source links, provider outcomes, generated date, and the evidence-boundary warning; they are never described as workspace backups.
- **Recheck after seven days** is an explicit topic setting. A due refresh uses only providers already allowed on that device, never opens a new provider-consent prompt automatically, and can be disabled from the thread.

## What pages MUST share

- The supplied Dusori mark or lockup.
- Near-black first-run theme and warm-paper light option.
- Shippori Mincho, Zen Kaku Gothic New, and IBM Plex Mono.
- Vermilion for action; marigold for knowledge/provenance.
- Hairline rules, compact radii, 44 px controls, and explicit focus.
- Product-truthful copy with local-first limitations stated at the point of need.

## What pages MAY differ on

- Marketing may use a larger animated mark.
- The app graph may use curved SVG relations and knowledge-wheel geometry.
- Docs may simplify the mark to the favicon cut at compact sizes.

## Exports

### tokens.css

```css
:root {
  --color-night: oklch(15% 0.012 55);
  --color-night-2: oklch(19% 0.014 60);
  --color-paper: oklch(96% 0.014 80);
  --color-paper-2: oklch(93% 0.016 80);
  --color-vermilion: oklch(58% 0.17 32);
  --color-marigold: oklch(67% 0.14 72);
  --color-focus: oklch(72% 0.13 32);
  --font-display: 'Shippori Mincho', 'Yu Mincho', serif;
  --font-body: 'Zen Kaku Gothic New', 'Hiragino Kaku Gothic ProN', sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
  --space-xs: 0.5rem;
  --space-sm: 0.75rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;
  --space-xl: 2.5rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 220ms;
  --radius-sm: 0.25rem;
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-night: oklch(15% 0.012 55);
  --color-paper: oklch(96% 0.014 80);
  --color-vermilion: oklch(58% 0.17 32);
  --color-marigold: oklch(67% 0.14 72);
  --font-display: 'Shippori Mincho', serif;
  --font-body: 'Zen Kaku Gothic New', sans-serif;
  --spacing-md: 1rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "night": { "$value": "oklch(15% 0.012 55)", "$type": "color" },
    "paper": { "$value": "oklch(96% 0.014 80)", "$type": "color" },
    "vermilion": { "$value": "oklch(58% 0.17 32)", "$type": "color" },
    "marigold": { "$value": "oklch(67% 0.14 72)", "$type": "color" }
  },
  "font": {
    "display": { "$value": "Shippori Mincho", "$type": "fontFamily" },
    "body": { "$value": "Zen Kaku Gothic New", "$type": "fontFamily" }
  },
  "space": { "md": { "$value": "1rem", "$type": "dimension" } }
}
```

### shadcn/ui CSS variables

```css
:root {
  --background: 15% 0.012 55;
  --foreground: 96% 0.014 80;
  --primary: 58% 0.17 32;
  --primary-foreground: 96% 0.014 80;
  --secondary: 67% 0.14 72;
  --muted: 32% 0.014 70;
  --muted-foreground: 72% 0.012 70;
  --border: 32% 0.014 70;
  --input: 32% 0.014 70;
  --ring: 72% 0.13 32;
  --radius: 0.25rem;
}
```
