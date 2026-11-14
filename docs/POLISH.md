# Polish list

What to fix so the app reads as finished, not as a prototype. Written 2026-11-11 after comparing the app
with William Zhu's [Web App Building Standard](https://github.com/william-wei-zhu/web-app-building-standard)
(MIT) and two of his map apps, [Mathlib Map](https://github.com/william-wei-zhu/mathlib-map) and
[BikeSim](https://github.com/william-wei-zhu/bikesim). We take the ideas that fit and keep our own stack and rules.

Each item names the phase of the redesign plan that picks it up. "Done" means it is already true on `main`.

## The five ideas worth taking

1. **Remove before adding.** Every screen gets one question: what can go? One strong element beats three weak ones.
2. **The map is the page.** Mathlib Map has no page without the map behind it. Everything else opens in a
   panel over it, and a search bar jumps anywhere. That is the Mission control layout we already chose.
3. **The five-second test.** A visitor landing cold must know what this is, who it is for and what to do next
   without scrolling. Headlines state the conclusion ("You can land here in May"), not a category ("Summary").
4. **Every state is designed.** Empty, loading, error and invalid input each get their own plain-language
   screen with a way forward, and example inputs one tap away.
5. **Show the work.** A hidden page that walks through what happens behind one click, with real names and
   numbers, for judges, interviewers and LinkedIn readers.

## Checklist

### Sharing and first impression

| Item | State | Phase |
| --- | --- | --- |
| Link preview: description, Open Graph and X tags, a 1200×630 image, defined on the home page | **Done in this PR** (`web/index.html`, `web/public/og.jpg`) | – |
| After the domain's certificate is active, check the card in LinkedIn's Post Inspector | To do | A4 |
| A team mark and one tagline, used in the top bar, the tab icon and the share card | To do: we have a favicon but no mark or tagline | C3 |
| README opens with one sentence and the live link | To do at cutover, when the address changes | A4 |
| Footer: "Built by team Shackleton Station" with the repo link once it is public | To do | C3 |

### Reading comfort

| Item | State | Phase |
| --- | --- | --- |
| No small text. 12 of the 73 `font-size` rules in `index.css` are under 13 px | To do | C2 |
| Text is solid ink on the background, never faded with opacity | Done: `--text` and `--muted` are solid colors in both themes | – |
| One heading or sentence, one style: no accent-colored or italic words inside it | Check during the CSS split | C2 |
| No colored stripe on the left or top edge of cards and callouts | Check during the CSS split | C2 |
| Cards share one style: a thin full border on a quiet surface | To do: sections, tiles and notes differ today | C2 |
| No em-dashes in interface text | Check | C2 |
| The same label everywhere for the same thing (site, month, limits) | Check: the audit found time set in 7 places and a site picked in 4 | C4 |

### Layout and motion

| Item | State | Phase |
| --- | --- | --- |
| Say each fact once. The audit found the same numbers in several sections | To do: the main reason for the redesign | C4 |
| One primary action and one secondary per view | To do | C3 |
| Anything clickable looks clickable before hover | Check every text-styled button | C3 |
| Dragging the globe or the 3D view never selects text or ghost-drags an image | Partly: `user-select: none` is set; add cancelled `dragstart` and check pins | C3 |
| A click on a site dot counts only if the pointer moved less than about 8 px | Check `useGlobeControls` | C3 |
| Nothing overlaps in any state: panel open, chat open, tour card, time bar | To do | C5 |
| Phone widths 320, 360 and 390, and a short 1440×600 window, tested in an emulated context | To do | C5 |
| Motion means something, plays once, and stops for `prefers-reduced-motion`; canvases pause when hidden | Partly: 4 reduced-motion rules exist; check the globe time-lapse and 3D view when the tab is hidden | C3 |

### States

| Item | State | Phase |
| --- | --- | --- |
| Loading shows a phase ("Loading terrain…"), never a frozen screen | Partly | C3 |
| Errors are plain language with a retry | Partly: data errors are shown, with no retry | C3 |
| A question the co-pilot can't use gets a friendly, separate message and example questions | To do | B2 |
| Example questions as one-tap chips for the current site | Planned | B2 |
| Nothing fake: no placeholder numbers, ever | Done: every number comes from the pipeline | – |

### The AI co-pilot

| Item | State | Phase |
| --- | --- | --- |
| Limits keyed on a trusted address (the last forwarded hop), never one the visitor can set | Done on Cloud Run; **recheck behind the load balancer**, which adds a hop | A3 |
| A per-visitor limit and an overall limit | Done: 10 and 30 a minute | – |
| An overall daily ceiling, so a public endpoint can't run up a bill | Done for the co-pilot: 1,500 messages a day overall, 60 per visitor (in memory, per server copy) | – |
| Visitor text is fenced and the model is told it is data, never instructions | Done: fenced in tags with angle brackets stripped; the fixed rules never contain visitor text | – |
| Structured output with a schema | Done for `/api/ask`; keep for the chat | B1 |
| A low temperature for faithful answers | Not set, on purpose: Google advises leaving it at the default for this model family. Faithfulness comes from the reference rule, not the temperature | – |
| Cheap checks before the paid call | Done: method, origin, limits and length all run first | – |
| Numbers come from tools, never from the model | Done: the model writes references such as `{{r2.pct_sun}}`; the server fills them in and refuses any reply with a typed digit. Not caught: a number spelled out in words | – |
| Cache repeated questions | Done: the first question of a conversation is cached in Redis for a day, per view and per deploy | – |

### Trust and showing the work

| Item | State | Phase |
| --- | --- | --- |
| An About and method page: what it is, how the numbers are made, how they were checked | Planned as the Trust tab | C4 |
| A short disclaimer: informational only, not mission planning advice | To do | C4 |
| A hidden "how it works" page at `/how`, not linked and not indexed: one line on the whole flow, then 4 to 6 steps, each one drawing and one precise caption (LOLA terrain, SPICE, Cloud Run, Vertex AI, Terraform, keyless deploys). No secrets on it | To do: new | after C6 |

## What we are not taking

- **His stack** (Next.js, Vercel, Tailwind, Firebase). Ours is React and Vite on Cloud Run, by choice.
- **"Ship to production without asking."** Our rule stays: a PR, green checks, then Rodrigo's OK.
- **His footer credit and share image rules.** The credit is ours, and until we have a mark the share image
  is a frame of the real app.
- **Body text at weight 600 and a 120% root size as a blanket rule.** We take the point behind it: no small
  or faint text.
- **A second AI provider for decisions.** Decisions the app branches on are made in our own tested code.
