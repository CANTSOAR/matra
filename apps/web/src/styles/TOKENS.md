# Matra design tokens

All tokens live on `:root` in `global.css`. Matra is **bright by default, whatever the device's dark-mode setting**;
the darker "Dim" palette applies only when she turns it on (header button; `:root[data-theme='dim']`, set by
`lib/theme.ts`, kept in sessionStorage for that tab only so nothing stays on a shared device). Use them through `var(--matra-…)`; never hard-code colours.
Fonts are self-hosted (`main.tsx` imports `@fontsource-variable/fraunces/soft.css` and
`@fontsource-variable/nunito-sans/index.css`). Never load fonts or images from a third party —
the production CSP (`font-src 'self'`) blocks it, and it would leak visits.

Feel: a calm, kind, private room, bright and warm rather than techy or edgy. Warm cream paper, deep warm ink, a
rose-clay accent, sage as the quiet second voice. Soft, diffuse shadows instead of hard borders; pill-shaped buttons;
generous rounding. Never cutesy, never alarming. Dim is a warm dusk, not a dark cave.

## Colour

| Token | Light | Dim | Use |
|---|---|---|---|
| `--matra-bg` | `#fdf8f3` | `#2c2522` | Page background (warm cream / warm charcoal). |
| `--matra-surface` | `#fffefc` | `#362e2a` | Cards, inputs, dialogs. |
| `--matra-surface-2` | `#f9f2eb` | `#312925` | Recessed wells: consent text, next-step rows, metadata tiles. |
| `--matra-text` | `#2e2622` | `#f2eae2` | Body and heading text. Never pure black. |
| `--matra-muted` | `#6a5d55` | `#bcaea2` | Secondary text, hints, timestamps. |
| `--matra-accent` | `#a04f38` | `#e8a184` | Rose-clay primary: primary buttons, links, active nav, focus. |
| `--matra-accent-contrast` | `#ffffff` | `#2a1610` | Text/icons on `--matra-accent`. |
| `--matra-accent-soft` | `#faece5` | `#46332b` | Tinted background for selected / suggestion / active states. |
| `--matra-accent-strong` | `#84402c` | `#f0b49a` | Hover/pressed accent. |
| `--matra-warm` | `#e8a87c` | `#d9976d` | Apricot. Decorative fills only (brand mark, meter, bullets, quote rules) — not for text on light backgrounds. |
| `--matra-warm-soft` | `#fdf1e7` | `#3e2f25` | Gentle warm panel background. |
| `--matra-sage` | `#4f6e5a` | `#a3c0aa` | Calm secondary: eyebrows, support/resources, "safe" accents. Text-safe. |
| `--matra-sage-soft` | `#ebf3ec` | `#2f3a33` | Sage panel / badge background. |
| `--matra-success` | `#356b47` | `#93cba2` | Verified, done, "has access". |
| `--matra-success-soft` | `#e5f1e8` | `#29392e` | Success badge background. |
| `--matra-caution` | `#86560f` | `#e9bd6c` | Important notes (can't reset, metadata kept). Calm, not alarming. |
| `--matra-caution-soft` | `#fbefdc` | `#45371f` | Caution panel background. |
| `--matra-danger` | `#a3302a` | `#ff9e8f` | Errors and destructive actions only. |
| `--matra-border` | `#f0e6dc` | `#463b35` | Hairlines between list items (decorative). |
| `--matra-border-strong` | `#9c8a7e` | `#94827a` | Form-control edges (meets 3:1 non-text contrast). |
| `--matra-focus` | `#7a3a26` | `#f0b49a` | Focus ring (3px outline). |

Legacy aliases kept for older code: `--matra-ok(-soft)` → success, `--matra-warn(-soft)` → caution,
`--matra-care(-soft)` → sage, `--font-sans` → body font, `--font-mono`.

### Contrast (WCAG 2.x, computed)

The table below predates the 2026-11 brightening. Rechecked after it: light pairs moved by under 0.3 (text on bg
14.05, muted on bg 6.01, accent on bg 5.42, accent on accent-soft 4.96, sage on sage-soft 5.00); Dim is lower than
the old dark column but every text pair passes AA (text on bg 12.65, muted on surface 6.14, accent on surface 6.24,
accent on accent-soft 5.58; border-strong on surface 3.63).

| Pair | Light | Dim |
|---|---|---|
| text on bg | 13.77 | 14.67 |
| text on surface | 14.59 | 13.32 |
| text on accent-soft | 12.41 | 11.45 |
| muted on bg | 5.89 | 8.08 |
| muted on surface | 6.25 | 7.33 |
| muted on accent-soft | 5.31 | 6.30 |
| accent on bg (links) | 5.31 | 8.20 |
| accent on surface | 5.63 | 7.45 |
| accent on accent-soft | 4.79 | 6.40 |
| accent-contrast on accent (buttons) | 5.72 | 8.08 |
| sage on bg | 5.26 | 8.88 |
| sage on surface | 5.57 | 8.06 |
| sage on sage-soft | 4.83 | 6.94 |
| success on success-soft | 5.40 | 7.33 |
| success on surface | 6.18 | 8.53 |
| caution on caution-soft | 5.51 | 7.54 |
| caution on surface | 6.17 | 9.03 |
| danger on surface | 6.86 | 7.96 |
| danger on bg | 6.47 | 8.76 |
| ink `#2e2622` on warm | 7.29 | — |
| border-strong on surface (UI, ≥3) | 3.25 | 3.76 |
| focus on bg (UI, ≥3) | 7.93 | 9.73 |

All text pairs pass AA (4.5:1); all but the accent-on-soft pairs also pass AAA for large text.
Quick exit stays fixed high-contrast: white on `#2e2622` (14.8:1) in both modes.

## Type

| Token | Value | Use |
|---|---|---|
| `--matra-font-display` | `'Fraunces Variable', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` | h1–h3, brand, big numbers. Use `font-variation-settings: 'SOFT' 100` and weight 440–560 for a soft, kind serif. |
| `--matra-font-body` | `'Nunito Sans Variable', system-ui, …, sans-serif` | Everything else. Body is 17.5px / 1.65. |
| `--matra-font-mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Hashes, fingerprints, passphrase suggestions. |

Headings: h1 `clamp(1.85rem … 2.5rem)` (welcome hero up to 3.4rem), h2 1.4rem, h3 1.15rem, `text-wrap: balance`.
`.eyebrow` (small uppercase sage label) sits above page titles.

## Shape, depth, space, motion

| Token | Value | Use |
|---|---|---|
| `--matra-radius` | `16px` | Inputs (14px), inner panels, badges' container elements. Buttons are pill-shaped. |
| `--matra-radius-lg` | `26px` | Cards, tiles, greeting panel. |
| `--matra-radius-pill` | `999px` | Badges, nav pills, Quick exit. |
| `--matra-shadow` | three soft warm-brown layers | Default card elevation (replaces hard borders). |
| `--matra-shadow-lg` | deeper three-layer shadow | Hovered tiles, dialogs, popovers. |
| `--matra-space-1 … 8` | `4, 8, 12, 16, 24, 32, 48, 64px` | 4px-based spacing scale (gaps, padding, section rhythm). |
| `--matra-ease` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Gentle ease-out for every transition. |
| `--matra-duration` | `280ms` | Default transition length. |

Motion: screens fade-and-rise 8px on mount (`matra-rise`, 420ms); buttons/tiles lift 1–2px on hover.
Everything is disabled under `prefers-reduced-motion: reduce`.

## Handy classes

`card` (+ `soft`, `sage`, `warm`, `warn`, `quiet`), `badge` (+ `ok`, `warn`, `sage`, `neutral`),
`btn` (+ `btn-primary`, `btn-quiet`, `btn-danger`, `btn-small`, `btn-large`), `field`/`hint`, `check`,
`eyebrow`, `stack` / `stack-lg` / `stack-xl`, `row`, `grid-2`, `grid-3`, `bullets`,
`status-tile`, `next-step`, `dot-icon` (+ `sage`, `warm`), `details.disclosure`, `consent-text`, `fingerprint`.
Line icons: `components/icons.tsx` (inline SVG, aria-hidden).
