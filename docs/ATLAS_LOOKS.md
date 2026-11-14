# The Atlas's three looks: colors, type and status

Written 2026-11-13 from a design canvas made with Claude Code (three directions, each with a main page
and a tutorial overlay, plus a shared kit of icons and fonts). The Atlas (`/atlas/`) is built so that
the same page, data and controls can wear any of the three looks. A link picks one with `&look=a|b|c`;
with none it opens in A.

| Look | Idea | Fonts (UI · numbers) | Status |
| --- | --- | --- | --- |
| **A · Observatory** | Today's Atlas, refined: warm gold on black, controls float over the Moon as pills | Space Grotesk · IBM Plex Mono | On `main` (#214) |
| **B · Mission Control** | Fixed side panels, square edges, denser data; cyan for controls, gold kept for the Sun | Chakra Petch · JetBrains Mono | On `main` (#214) |
| **C · Night Glass** | The Moon first; frosted glass; site, layer, time and Scout in one bottom dock | Sora · DM Mono | On `main` (#214) |

To try them on your machine, follow [`SETUP.md`](SETUP.md), "Try the Atlas's three looks".

Fonts are self-hosted from the `@fontsource` packages (SIL Open Font License), Latin subset only, so the
page makes no call to a font service. Each look's tokens live on the page root in
`web/src/atlas/atlas-looks.css` under `[data-look='…']`; the controls read only the tokens.

## Colors that do not change between looks

These colors carry data. The time bar used to mix four colors (both, Sun only, Earth only, neither) with no key beside it, which visitors could not read; it now has two lanes that each answer one yes-or-no question, labeled by a sun and an Earth icon. The four mixed colors stay for the Sun + Earth layer, whose key is in the layer menu.

| Meaning | Hex | Where |
| --- | --- | --- |
| Time bar, top lane: the Sun is up (any part of its disk) | the look’s Sun color (`--sun-ink`) | time bar |
| Time bar, bottom lane: Earth is up | the look’s Earth color (`--earth`) | time bar |
| Time bar, either lane: hidden | `--lane-off` (A `#2a2433`, B `#161e2a`) | time bar |
| Sun and Earth both in view | `#3fbf86` | Sun + Earth layer and its key |
| Sun only | `#ffc04d` | Sun + Earth layer and its key |
| Earth only | `#4d86e0` | Sun + Earth layer and its key |
| Neither | `#23243a` | Sun + Earth layer and its key |
| Ground in sunlight (Sunlight layer) | `#b9b3a8` | map key |
| Ground in shadow (Sunlight layer) | `#0d1020` | map key |
| Month's Sun ramp, 0% → 50% → 100% | `#171c3a` → `#bd651f` → `#ffe9a8` | Month's Sun layer and its key |

## A · Observatory

Contrast is measured against the surface each color sits on (WCAG ratio; 4.5 is the floor for text).

| Token | Role | Hex | On | Contrast |
| --- | --- | --- | --- | --- |
| `--ink` | Main text | `#f6efe0` | glass `#120f18` | 16.6 |
| `--soft` | Secondary text, idle buttons | `#cfc6b4` | glass | 11.2 |
| `--label` | Small caps labels, hints | `#b3a88f` | glass | 8.1 |
| `--line` | Borders | `#4a3f2c` | | |
| `--line-quiet` | Dividers inside panels | `#2c2533` | | |
| `--gold` | Accent: chosen item, play button, focus ring, Sun chip text | `#e9b44c` | Sun chip | 7.8 |
| `--gold-deep` | Steps already seen in the tour | `#b9862a` | | |
| `--on-gold` | Text on gold | `#20160a` | gold | 9.4 |
| `--glass` | Floating panels | `rgb(18 15 24 / 92%)` | | |
| `--glass-deep` | Open dropdown | `rgb(12 10 17 / 96%)` | | |
| `--horizon` | "Sun on the horizon" chip text | `#f0a35e` | its chip | 7.2 |
| `--horizon-chip` | Its chip | `rgb(189 101 31 / 28%)` | | |
| `--shadow-ink` | "Sun hidden" chip text | `#cfd6ff` | `#171c3a` | 11.6 |
| `--shadow-chip` | Its chip | `#171c3a` | | |
| `--earth-ink` | "Earth in view" chip text | `#9cc2ff` | its chip | 9.2 |
| `--earth` / `--earth-chip` | Earth accent / its chip | `#6ea8ff` / `rgb(110 168 255 / 14%)` | | |

Shape: pills (`--radius: 999px`), panels at 18 px corners. The Scout bubble keeps its own colors and
takes the look's two fonts.

## B · Mission Control

In the CSS, B reuses the shared token names: `--gold` is the accent token the controls read, so in B it holds cyan, and the Sun keeps its own color in `--sun-ink`.

| Token | Role | Hex | On | Contrast |
| --- | --- | --- | --- | --- |
| `--ink` | Main text | `#e8f1f7` | panel `#080b11` | 17.2 |
| `--soft` | Secondary text | `#c2ced9` | panel | 12.3 |
| `--label` | Labels and small caps | `#8696a7` | panel | 6.5 |
| `--line` | Hairline borders | `#1c2633` | | |
| `--gold` (cyan) | Controls, focus, selection, time cursor | `#4fd1c5` | panel | 10.6 |
| `--on-gold` | Text on cyan | `#04110f` | cyan | 10.3 |
| `--sun-ink` | Sun in view | `#f2b84b` | panel | 11.0 |
| `--horizon` | Sun on the horizon | `#f0a35e` | | |
| `--shadow-ink` | Sun hidden (text and border) | `#8b9cff` | panel | 7.8 |
| `--earth-ink` | Earth in view | `#7aa7ff` | panel | 8.3 |
| `--night` / `--glass` | Page / docked panels | `#05070b` / `#080b11` | | |

Shape: 3–4 px corners, 1 px hairlines, chips in small capitals. From 1100 px wide the panels dock: site, month, status and layers in a 21 rem left rail (the layer menu at its foot, opening upward), Scout in a 23 rem right rail, the time bar across the bottom of the map, and the map sized to the space between. Narrower than that, B keeps A's floating layout in its own colors.

## C · Night Glass

| Token | Role | Hex | On | Contrast |
| --- | --- | --- | --- | --- |
| `--ink` | Main text | `#f4f2ec` | glass `#12142a` | 16.2 |
| `--soft` | Secondary text | `#d9d6cc` | glass | 12.5 |
| `--label` | Labels | `#a9acbd` | glass | 8.0 |
| `--gold` / `--sun-ink` | Accent: Sun, chosen item, send button | `#ffd27a` | glass | 12.7 |
| `--on-gold` | Text on the accent | `#1c1405` | sun | 12.8 |
| `--earth-ink` / `--earth` | Earth in view: chip text / time-bar lane | `#aecbff` / `#8ab4ff` | glass | 11.0 |
| `--shadow-ink` | Sun hidden | `#c9d0ff` | glass | 12.0 |
| `--glass` | Panels and dock | `rgb(18 20 34 / 62–86%)` with 22 px blur | | |
| `--lane-off` | Time bar, hidden | `rgb(255 255 255 / 10%)` | | |
| `--night` | Page | `#06070d` | | |

Contrast for C is measured on the panel color without the map; the glass is translucent, so over the brightest lit ground the panels are a little lighter. Text sits on at least 66% opaque glass with a blur.

Shape: 20–28 px corners, frosted panels, the site’s name as a light title. From 1100 px wide the layer menu (opening upward), the time bar and Scout’s face share one dock along the bottom, Scout’s words rise above its right end, and the scale and zoom move to the top right. Narrower than that, C keeps A’s floating layout in its own colors and type.

## Icons (all looks)

One set in `web/src/atlas/icons.tsx`: 24 px grid, 1.6 px round strokes, drawn in the text color so
each look colors them. Sun in view, Sun on the horizon, Sun hidden (a moon), Earth in view, Earth
hidden, layers, play, pause, step, chevron, check, close, Scout's spark, help, target, clock.
