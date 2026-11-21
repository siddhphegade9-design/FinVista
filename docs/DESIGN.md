# Design system: Midnight Ink + Mint

FinVista's interface uses five brand colours. Every colour on every page comes from
`frontend/css/tokens.css`; components refer to tokens, never to raw hex values.

## Palette

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#111C24` | Midnight Ink. Page background and navigation. |
| `--ivory` | `#F5F2EA` | Warm Ivory. Primary text on dark; the light surface used for the final call to action on the home page. |
| `--mint` | `#A8E6C1` | Soft Mint. Primary actions, active navigation, focus, positive values. |
| `--slate` | `#52616A` | Slate. Borders, dividers, rules, neutral bars. |
| `--gold` | `#D5A66F` | Muted Gold. Estimates and projections, warnings, rare highlights. |

Derived steps (same hues, different lightness) are defined beside them: `--bg-1` to `--bg-3`
for surfaces, `--mint-hover`, `--mint-deep`, `--slate-light`, and `-rgb` channel tokens so
translucent tints stay on-palette, for example `rgba(var(--mint-rgb), 0.12)`.

**One functional addition:** `--negative` (`#E5978A`, a muted terracotta). Expenses,
over-budget states and errors need a red to carry meaning, and none of the five brand colours
can do that. It is kept desaturated so it sits with gold and ivory.

## Colour roles

- **Mint carries the energy.** Primary buttons, the current page (tinted and marked), focus
  rings, links, positive numbers, section labels, card-title markers, the avatar, and solid
  stripes on the dashboard's stat tiles. Colour is used confidently but always flat.
- **Gold means "estimate".** Forecast bars, projected values, "estimate", "projected" and
  "simulation" tags, and dashed forecast lines are gold everywhere, so estimates are never
  mistaken for recorded figures. Gold is also the warning colour (a budget close to its limit).
- **Flat, never glowing.** Cards are ink surfaces with hairline ivory-alpha borders, and
  accents are solid shapes: stripes, markers, filled badges, the mint block behind the home
  page's product preview. There are no glows, no glass blur and no decorative gradients.
- **Charts** read `--chart-1` to `--chart-8` through `js/core/chartTheme.js`. Income and
  expenses always use `--positive` and `--negative` (via `chartColors()`), never a palette
  position, so their meaning cannot drift.

## Contrast (WCAG 2.1)

Raw Slate is only 2.7:1 on Ink, so it is used for lines and shapes, not body text. Text uses
lighter Slate tints instead.

| Foreground on Ink `#111C24` | Ratio |
|---|---|
| Ivory `--text-1` | 15.4:1 |
| `--text-2` `#B3BCBE` | 9.0:1 |
| `--text-3` `#8B989F` | 5.8:1 (5.3:1 on cards) |
| Mint | 12.1:1 |
| Gold | 7.8:1 |
| Terracotta `--negative` | 7.5:1 |
| Ink text on a Mint button | 12.1:1 |

## Logo

`assets/brand/finvista-logo.png`, `finvista-badge.png`, `finvista-wordmark.png` and the
`finvista-icon-*.png` files are the owner's supplied artwork, recoloured to this palette
(Ivory lettering, Mint arrow, Ink background) with shapes unchanged. The wordmark used in the
app has a transparent background. The untouched originals are kept as `*-original.png`.
`assets/favicon.svg` is the browser-tab icon, in the same colours.

The only theme is dark. There is no light/dark switch.
