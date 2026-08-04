# Design — Dusori

A locked design system for the Dusori app, website, documentation, and public artifacts. Every page reads this file before visual work. Extend this system when a new need appears; do not invent page-local palettes or typography.

## Genre

Atmospheric editorial: a nocturnal learning desk with Japanese spatial restraint and subtle Indian knowledge geometry. Function stays primary. Cultural references come from the supplied ensō, katana, and rangoli identity—not decorative pastiche.

## Macrostructure family

- Marketing pages: Workbench-led Split Studio with one dominant real product capture, an icon-led download shelf, and a ruled proof sequence.
- App pages: Reading Studio with a quiet four-destination header (`Learn`, `Sources`, `Map`, `Settings`), one primary reading canvas, a contextual evidence margin, and a source shelf that is always one action away. Research opens as a task sheet inside the current topic; it is not a destination. The constellation is a secondary representation of the same path and always has an Outline equivalent.
- Content pages: Long Document with a narrow reading measure and ruled navigation.

The app must never return to a dashboard rail full of product modules. Its governing sequence is `continue → read → annotate → explicitly mark learned or review → see what changed`. A screen gets one dominant next action. Saved sources, provider state, update controls, and recovery actions use literal labels rather than mystery icons.

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

Dark is the first-run default. Light is an explicit persisted choice.

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

## Learning Studio interaction contract

- `Learn` opens on one evidence-backed Continue recommendation, its reason, **Choose another**, **Not now**, and an honest empty-queue action.
- `Sources` is the only durable saved-source shelf. Preview never saves. **Save & read** both persists and opens, and the source count includes manifest records only.
- `Map` renders concept and objective relationships derived from the workspace. It never infers mastery, and its Outline exposes the same nodes and actions without spatial navigation.
- `Settings` owns provider permissions, local/desktop storage, import/export, updates, and privacy. It does not own learning content.
- `Ask inside <topic>` is a persistent composer location, not an automatically stored chat. Without AI it searches local notes and sources and returns cited matches. A question or response becomes durable only through an explicit **Save to note** action.
- **Mark learned** is always labeled as self-declared and maps to the portable `roadmap.md` checkbox. **Reopen** reverses it. Saved and Reviewed remain separate facts.
- Provider capability (`Ready`, `Setup required`, `Disabled`) stays separate from run outcome (`Found`, `Empty`, `Failed`). Failures remain visible.

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
