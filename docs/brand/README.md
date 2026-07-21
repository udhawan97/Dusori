# Dusori identity

Dusori's mark is an **open ensō** containing rangoli geometry, crossed by one katana. The circle carries Japanese editorial restraint while the centered geometry adds a subtle Indian influence. The opening keeps the identity light, imperfect, and open to revision.

## Files

- `apps/site/public/brand/dusori-mark.svg` — primary transparent mark
- `apps/site/public/brand/dusori-mark-mono.svg` — one-color reproduction
- `apps/site/public/brand/dusori-mark-reversed.svg` — dark-surface reproduction
- `apps/site/public/brand/dusori-lockup.svg` — horizontal presentation lockup
- `docs/assets/dusori-readme-logo-inverted.svg` — animated reversed monochrome README lockup on black
- `apps/app/static/icons/icon-192.svg` and `icon-512.svg` — PWA icons
- `apps/site/public/favicon.svg` — site favicon
- `logo-concepts.svg` — the three-direction review sheet

The product UI composes the mark with live Shippori Mincho text. This keeps the wordmark crisp, accessible, and consistent with the bundled font rather than depending on text embedded in an image.

## Usage

- Preserve the mark's proportions. Do not rotate, stretch, add effects, or add motifs outside the supplied geometry.
- Keep clear space equal to the diameter of the vermilion point around the mark.
- Use the primary mark on paper surfaces, the reversed mark on ink surfaces, and the mono mark where only one color is available.
- Minimum size is 16 px for the mark and 96 px wide for the horizontal lockup.
- Vermilion remains the action axis, not a decorative fill. Marigold carries the rangoli-inspired knowledge geometry.
- Product icons and compact marks stay static. The marketing hero and README lockup may animate the exact supplied geometry as a finite reveal, with a reduced-motion fallback.

## Palette

- Paper: `#f7f1e8`
- Ink: `#1a1511`
- Black: `#14100d`
- Vermilion: `#cb4832`

The core SVG geometry stays unchanged. Presentation motion is reserved for the marketing hero and README lockup; it must settle to the original mark, never loop forever, and disappear under reduced motion.
