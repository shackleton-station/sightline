# Mission control: the redesign

Written 2026-11-11, after auditing the live site at 1440×900 and 375×812. Goal: the site page should feel
like the landing page does. Companion to [`POLISH.md`](POLISH.md) (the checklist) and the build plan in
[`PROGRESS.md`](PROGRESS.md).

## What the audit found

The landing page is a lit, turning Moon with one headline and three buttons. One click later the visitor is
on a form.

| Seen on the live site page | Measured |
| --- | --- |
| Controls before any picture earns attention | 17 buttons, 4 inputs and 8 collapsed sections on the first screen (Learn mode) |
| Everything interesting is closed | 0 of the 8 sections open; nothing invites a second click |
| Time is set in four places on the first screen | date field, bottom slider, month arrows, "date slipped" buttons |
| The picture is one box among many | the 3D view or horizon chart takes about a third of the window |
| Small text | 18 text elements under 13 px |
| Phone, first screen | header buttons, ask box, site menu, date field and a text card: **no picture**. The chart starts under the 104 px time bar |
| The ask box | sets a site, month and limits. It never answers |
| Continuity | zooming into a site on the globe swaps pages; there is no sense of arriving |

What works and stays: the landing page, the 3D terrain with real shadows, the horizon panorama, the landing
grid, the "date slipped" check, and every number's link back to the pipeline.

## The idea

**The place is the page.** The 3D terrain (or the horizon) fills the window, the way the globe does on the
landing page. Everything else floats over it, and there is exactly one control for time.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◐ Whole Moon   Connecting Ridge ▾   May 2027 ▾        Ask ✦   How it works │  top bar
│                                                                            │
│   Sunlit · Earth in view                               ┌────────────────┐ │
│   Sunset in 36 h · Earthset in 12 d                    │ Now  Land      │ │
│                                                        │ Compare  Learn │ │  mission panel
│              (3D terrain, shadows moving)              │                │ │  (collapsible;
│                                                        │  …             │ │   a bottom sheet
│   [Orbit] [Stand here]                                 └────────────────┘ │   on phones)
│                                                                            │
│ ▶  ░░▓▓▓▓░░░░▓▓▓▓▓▓▓░░░▓▓▓▓●▓▓▓░░░░▓▓▓▓▓░░░   13 May 2027, 12:00 UTC      │  time river
└──────────────────────────────────────────────────────────────────────────┘
```

### The signature moment

**Drag time and watch the month happen.** The time river at the bottom is the slider and the timeline in
one: its track is the month's Sun, Earth and both-up bands. As the visitor drags, the shadows sweep across
the crater, the Sun and Earth markers rise and set, and the one-line status changes. It is the thing to
show a judge in ten seconds, and it is all computed data.

Three more, in order of value:

1. **Arriving.** Choosing a site on the globe flies the camera down into its terrain instead of swapping
   pages; "Whole Moon" flies back out.
2. **Ask, and the place answers.** The co-pilot opens as a drawer. Its answer's buttons move the stage:
   "next landing" jumps the time river to that hour, "compare" splits the stage in two.
3. **Will it survive the night?** In Plan mode, the mission is a bracket on the time river, with a battery
   that fills in sunlight and drains in the dark, from the existing power model. A simple model, labelled
   as one.

### Where everything goes

One home for each thing, so nothing is said twice.

| Today | In Mission control |
| --- | --- |
| Header: 5 buttons | Top bar: Whole Moon, site switcher, month, Ask, How it works. Tour and demo video move into Learn |
| Ask box | Co-pilot drawer (`/api/chat`), with example questions for this site |
| Site menu + coordinates | Site switcher: grouped list with search, and custom coordinates |
| Date field, slider, month arrows | The time river, and a month menu in the top bar |
| Answer card | The status line over the stage, and the **Now** tab |
| 3D / Horizon toggle | Stage modes: Orbit, Stand here, Horizon |
| "Date slipped?", landing grid, limits, landing check, shortlist, nearby ground | **Land** tab, in that order: limits → can you land → slipped → grid → shortlist → nearby |
| Compare button, compare table | **Compare** tab; the stage splits in two |
| Month timeline, year strip, summary, power, mast, Earth vs Moon, explainer, tour, demo video | **Learn** tab |
| "How far to trust this", CSV | **How it works** page, with the pipeline and the tech stack |

### How it works (a visible page)

Reached from the top bar and the landing page. One screen per idea, a drawing and a sentence each:

1. **From NASA data to an answer:** LOLA terrain and SPICE ephemeris → the pipeline → hourly visibility
   for every site → the page.
2. **How we know it's right:** the checks against JPL Horizons and NASA's illumination maps, with the real
   numbers from `validation.json`.
3. **The tech stack, as a diagram:** visitor → load balancer with CDN → Cloud Run (Node, Hono) → Cloud
   Storage and Vertex AI; GitHub Actions → keyless sign-in → deploy; Terraform declares all of it.
4. **How the co-pilot stays honest:** tools over our own functions, numbers filled in by the server.

Diagrams are hand-built SVG in the site's own colors. No secrets on the page.

### Patterns taken from shipped apps

From reading the code of William Zhu's [BikeSim](https://github.com/william-wei-zhu/bikesim) and
[Mathlib Map](https://github.com/william-wei-zhu/mathlib-map) (ideas only; no code copied):

| Pattern | Where it comes from | Where it lands here |
| --- | --- | --- |
| The map is mounted once; pages are panels over it | Mathlib Map's shell | The stage stays; tabs and the co-pilot open over it |
| One pill that always names the next step | BikeSim's "1 · Start, 2 · End, 3 · Ride" | A hint on the stage for a first visit: "Drag the river to move time" |
| Example chips when a panel is empty | BikeSim's "Try a trip" | Example questions in the co-pilot, example limits in Plan |
| A card that names where you are arriving, during the fly-down | BikeSim's ride start | "Arriving at Connecting Ridge · 89.45°S" while the terrain loads |
| A finish card with a verdict and the next action | BikeSim's finish card | After the month plays: the month in one line, then "Next month" and "Compare with the best site" |
| Camera and overlays keep clear of the panel | Both | The site stays centred in the visible part of the stage |
| A bottom sheet whose handle is a real control | Both | The phone panel: tap or swipe the handle to shrink it to a bar |
| Loading that says what is loading, and a fallback with a message | BikeSim's loading card | "Loading terrain…", then the horizon view if 3D can't start |
| A source beside every number an AI gives | His report app's source chips | The co-pilot's sources, shown as chips under each answer |
| A walkthrough in "acts": a drawing, a plain sentence, a line of tech | Mathlib Map's hidden docs page | Our How it works page, but visible |

Lessons he recorded that we take as rules: cut to the one thing people come for; remove decoration that
isn't information; start the view the way people expect (north up, the site in the middle).

### Phones

The stage takes the top 45% of the screen, always visible. The status line sits on it. The mission panel is
a sheet below it that scrolls on its own. The time river is one row, fixed at the bottom.

### Rules for the build

- New code goes in `web/src/shell/` and reuses the existing components; nothing is rewritten that works.
- It ships behind `?ui=next` until it does everything the old page does, then becomes the default and the
  old layout is deleted.
- Every state has a designed screen: loading (what is loading), error (with a retry), empty.
- No text under 13 px. One accent color. Motion plays once and stops for `prefers-reduced-motion`.
- Keyboard: ← → step an hour, Space plays, `/` opens the co-pilot, Esc closes panels.

## Scout: the guided version, started from scratch (2026-11-11)

Rodrigo's verdict on the shell above: better, but still a dashboard. The reference he pointed to is
SavorLM (savorlm.com): a named guide lives on the map and talks in a speech bubble with things to tap, the
side panel asks one question at a time, and the site has a look of its own.

Scout is that idea for the Moon, built as a separate page at `/scout/` (`web/src/scout/`) with its own
styles. It reuses the engines (the globe, the terrain view, the time river) and the co-pilot API, and
nothing of the old page's layout.

| Piece | What it does |
| --- | --- |
| **Scout**, a small gold lander with a face | Lives on the scene. Its solar panels lift when the Sun is up and droop when it isn't; it looks worried when Earth is out of view. Drawn as vector shapes (by an AI assistant; said in the footer) |
| **The speech bubble is the chat** | Scout's own line always describes the hour on screen, from the data. Ask something and the answer appears in the bubble with buttons that move the scene, what was looked up, and follow-ups |
| **One question at a time** | "Where are we landing?" over the whole Moon, with a suggested site; then "What do you want to know? Just ask Scout", with ideas to tap |
| **The Moon is the canvas** | Choosing a site zooms the same Moon in until it fills the stage, lit for the hour on the time river; zooming back out returns to the whole Moon. The close-up 3D ground is a switch away ("Ground, close up"). Near the poles the zoom is gentler, because the view can't tilt all the way to a pole and NASA's color map smears there |
| **Its own look** | Night-sky panel, foil gold, cream type, a serif wordmark |

Known limit: zoomed in at the south pole the color map is soft and streaky (it is a flat map wrapped on a sphere).
A polar map rendered from the LOLA terrain by the pipeline would fix it.

Next for Scout: landing limits and the "date slipped" check as things Scout offers, the finish card after
the month plays, voice (ask aloud, hear the answer), a share card, and a smoother hand-over from globe to
ground. When it does everything the main page does, it becomes the front door.

## Planner: the decision first, with no globe (2026-11-12)

The other three designs put a picture of the Moon first. The Planner is for someone who already knows
the Moon and wants the answer on one screen: a mission planner with a mission in mind, asking which sites
and dates work, what happens if the date slips, and what the nearest alternative is. It is a separate
page at `/planner/` (`web/src/planner/`) with its own styles. There is no 3D, no globe and no map.

| Piece | What it does |
| --- | --- |
| **The mission is the main control** | Mission length, longest time without Sun, longest time without Earth, what must be up at landing, and when Earth counts: a number to type and a slider each. They are the app's own limits with the same bounds, so links carry over |
| **Every site, every month, at once** | One table, 13 sites by 48 months. Each cell is a bar: the month's days with a landing that survives the whole mission, on the scale the Classic grid shades by (up to the best month on the table). No bar means no landing. A ring marks a tight month, 2 days or fewer. Changing a limit redraws all of it, and a count beside the title says how many squares have a landing |
| **The answer is a sheet of paper** | Choosing a square writes a brief beside the grid: the verdict as a sentence, the month's days and landing windows, the best landing and what the mission then looks like, and the slip check ("if it slips by up to N days, is there still a landing, and when is the next one"), with the nearest other sites when the answer is no |
| **A short list, side by side** | Keep a landing and it becomes a card; two or more are ordered by the app's shortlist rule, with the reasons. No blended score |
| **Take it away** | The address is the app's own view link, so every other tab opens on the same site, month, hour and limits. "Share this plan" is the same as elsewhere. Printing gives the brief alone, on one page |

How it differs from the other three: they answer "what is it like there, now"; this answers "where and
when can I land" for every site at once, and puts the limits, which the others keep in a side panel, at
the top. Its look is a timetable on the site's black: hairlines, small capitals, numbers in a fixed-width
face, and one sheet of paper for the answer, which is also what prints. Green, orange and violet mean
what they mean on the other tabs.

What it leaves out on purpose: the Moon, the terrain and the horizon; the hour-by-hour time control (it
works in landing days and windows); the co-pilot; custom coordinates (a link to one opens the default
site and says so, with a way back to Classic); power, mast heights and the validation notes, which stay
on Classic and How it works.

Decisions taken while building it, each stated on the page:

- **Best landing** is the landing whose longest stretch without the Sun is shortest, then without Earth,
  each as far as hourly data can separate landings (`GAP_TIE_H`), then the one with the most room to
  slip. It is the shortlist's order applied inside one month, not a score.
- **Tight** is 2 landing days or fewer. It is a reading aid: the cell's real count is always given.
- **With nothing chosen** the page opens on the default site's first month that has a landing, so the
  first thing seen is a full answer. A link always opens exactly what it names.
- **When nothing works anywhere** the page says what each limit is costing (the count of squares with a
  landing once that limit is taken away) and the longest mission that still fits, both from the same
  functions.

Screenshots: `docs/img/planner/`.

## Atlas: the light is the map (2026-11-12)

Started again from the challenge statement instead of from the last design. A mission planner has to walk
away with four things: **where** the ground gets Sun (power) and Earth (radio), **when**, **how sure** that
is, and a place and date to take to the next meeting. Where each design falls short of that, looked at on
the live site at the same site, month and hour (Connecting Ridge, 13 May 2027, 12:00 UTC):

| Design | What it gives | Where it stops |
| --- | --- | --- |
| Classic | Every number and check there is | A form. The answer is true for 13 listed points; the ground between them appears only as a 10 km grid of squares in a collapsed section |
| Mission control | One screen, the time river, real 3D ground | The 3D ground is about 8 km around one point. In hours with both light and shadow its drawn shadows match the terrain at 93.9% of points and miss a third of those cast from under 1 km (`VALIDATION.md` §8). Nothing says which nearby ground is lit |
| Scout | A guide, a conversation, one Moon | The polar ground is a uniform grey at an hour the data calls "partly sunlit": it is slope shading, so the picture cannot show the thing the challenge is about. Only listed sites answer. The real ground is a separate view |
| Planner | Every site and month against a mission, and a brief to print | No picture, on purpose. The answer is for the same 13 listed points; a planner cannot ask about the ground between them |

The Atlas is one answer to those gaps: **make the picture itself the data.**

| Piece | What it does |
| --- | --- |
| **True light** | Inside a 123 km square on the south pole, every 120 m of ground is lit or dark by the pipeline's own horizon calculation for that spot: the same method as a listed site, run 1,048,576 times (`pipeline/scripts/make_light_grid.py`). Around it a second grid of 300 m pixels carries the same answer out to 85° S (a 307 km square, gold outline; the finer square is outlined inside it). Outside that the map is dimmed slope shading, and says so |
| **One camera** | The whole Moon, the south pole and a ridge are three stops of the same camera on the same globe (`GlobeViewer`), down to about 30 m a pixel. It is the site's one camera (`useMoonCamera`, `lib/trackball.ts`), given a closest zoom that depends on the ground. From 82° S to the pole the view is the way polar maps are printed, 0° longitude (the side facing Earth) up, so the map never turns while the computed square is in the middle of it; between 72° and 82° it eases to north-up |
| **Time is one number** | A month is stored as the hours at which each pixel's Sun and Earth change. The whole month sits on the graphics card; dragging the time river changes one number and uploads nothing |
| **Three ways to color it** | Sunlight now · Sun and Earth now, in the time river's own four colors · the month's share of Sun |
| **Answers anywhere** | Tap any ground in the square: Scout says its Sun, Earth, both and longest dark stretch for the month, with the range across the pixels around it, and the river becomes that spot's month. "Ask Scout about this spot" puts the same ground to the co-pilot, which looks it up in the grid (`spot_light`); "Open this exact point" hands it to Classic's full calculation |
| **The guide stays** | Scout, its bubble and the co-pilot are the same components and the same `/api/chat`; the question box sits under the bubble. The tapped spot's own sentence is written by code from the data; a question about it goes to the co-pilot, whose numbers the server fills in from the same grid |

What was measured to choose this is in `VALIDATION.md` §12; what was cut is in `PROGRESS.md`.

## Briefing: the two-minute story (2026-11-12)

The other tabs are places to look around in. A judge, or a manager with two minutes, needs to be told:
what the question is, what the picture shows, how far to trust it, and what to do. The Briefing
(`/briefing/`, `web/src/briefing/`) is that, played on the Atlas's own picture.

| Piece | What it does |
| --- | --- |
| **Seven chapters** | The question (the whole Moon) · the south pole (the month's Sun) · one month of light (the month played through) · power and radio (Sun and Earth now) · the sites · how sure · the recommendation. Each is a camera stop, a coloring and a few sentences |
| **Every number counted when you press play** | `briefing/script.ts` writes each caption from the pipeline's data: the site tracks, the hourly flags, the light grid (how much of the square had the Sun for half the month, how much sees both now, the range across the pixels round the site) and the grid's validation file. A test tells the default view from the committed data |
| **It ends on a landing** | Each ridge's best landing that month by the Planner's rule, then the shortlist's order across the ridges (meets the limits, least time without the Sun, then without Earth). If no ridge has one that month, the first later landing, said as such. The mission is the one in the link |
| **Scout says it** | Each caption is said in Scout's voice (`POST /api/speak`), with the browser's voice as the fallback and the caption always on screen. The next caption's sound is fetched while the current one plays |
| **Then it hands over** | The last card opens that landing in the Planner, the Atlas or Scout. Play, pause, chapter bars, the arrow keys and Space |

Decisions, each by a measurement:

- **The captions are written by code, not by the co-pilot.** A co-pilot answer takes 2.4 to 13.3 s
  (`SYSTEM_DESIGN.md`) and a visitor may ask 6 a minute; a caption has to be on screen the moment its
  chapter starts, seven times in two minutes. The co-pilot is one tap away at the end instead.
- **Fetch the voice ahead.** Played through with the voice in headless Chrome, the first version ran
  2 min 50 s with 2.6 to 5 s of silence at the start of each chapter while the sound was fetched.
  With shorter captions and the next one fetched ahead it runs 2 min 8 s, and the voice starts within
  0.3 s of the chapter (2.8 s for the first, unless the pointer was on Play first).
- **Say a sentence once a day.** Everyone who plays the same month hears the same seven captions, and
  the voice has a ceiling of 200 texts a day. The server now keeps each spoken text for a day, so a
  repeat costs nothing and counts only against the visitor's minute.

What it leaves out: any choice of site or month on the page (it briefs the link it was opened with,
for the south-pole ridges the light grid holds; other tabs set the link); landing limits (the Planner);
questions (Scout).

## Surface: the view from the lander's eye (2026-11-12)

Every other design looks at the Moon from outside, or unrolls the horizon into a flat chart. The Surface
(`/surface/`, `web/src/surface/`) puts the visitor where the lander's camera would be: standing at the site,
2 m up, looking round at the horizon the pipeline computed, with the Sun crawling along the hills and
Earth hanging low over them. It is for the person who has seen the numbers and wants to know what they
mean on the ground: a judge, a visitor, a planner showing someone else why a ridge matters.

| Piece | What it does |
| --- | --- |
| **The land is the horizon file** | No terrain mesh. The land's top edge is the site's `horizon.json`, its 720 points joined by straight lines, which is how the pipeline reads between them (`three/SurfaceViewer.ts`). Since 2026-11-15 the ground under the edge is a plain fill with nothing drawn on it (it was an illustration of craters and dust for a day, which took away from what is data): lit while the Sun is in view, by the share of its disk in view, a little brighter toward the Sun's azimuth, and dark when the Sun is hidden. No shadows are cast, and the page says which part is data |
| **The Sun and Earth are the track** | Each is a disk at the track's azimuth and elevation for the hour on the time river, at the size it has from the site that hour: the radius is worked out from its distance, as the pipeline does, from the pipeline's own ephemeris files. The land in front hides whatever is below it. A disk the track counts as hidden is outlined, not drawn. Earth's lit part is its true phase; its face is NASA's picture, for looks |
| **Zoom is true** | At the pole everything happens within a few degrees of eye level and the Sun is half a degree across. The page opens zoomed in, at true scale: a view 12° tall, in which the Sun is a disk on the skyline and not a dot. Zooming is like binoculars and changes no shape. There is no height stretch: the picture is always at true scale (an earlier "Stretch heights" button was removed on 2026-11-15) |
| **Looking around** | Drag, pinch or wheel, the arrow keys, and on a phone "Look around by moving your phone", which asks for the motion sensor and then turns the view as the visitor turns. A strip of the whole compass shows which way they face, with the Sun and Earth on it, filled when up and hollow when hidden. "Face the Sun" and "Face Earth" turn to each and then keep it in the middle while time plays |
| **A scale of true elevation** | Down the left edge, with eye level marked. A thin line in each body's colour is its path over the whole month on screen (since 2026-11-15; the hourly dots it replaced are gone), hour to hour from the track: solid where the model has it up, dashed where it is behind the land, broken where it goes behind the visitor |
| **Time, and the answer** | The site's own time river. The answer is the other designs' own words (`answer.ts`, `verdict.ts`, `nextChange.ts`): is the Sun up, is Earth in view, how long until each changes, how much of the Sun's disk shows, and the month in one line |
| **The address** | The app's own view link, so every tab opens on the same site, month, hour and limits. It also says which way the visitor faces: `look=heading_elevation_field`. The other tabs ignore it, and the links to them leave it out. A new address from outside moves the view with no reload |

How it differs from the others: it is the only one with no outside view and no chart, and the only one
where the picture's scale is a control. Its look is a camera's viewfinder on the site's black: hairlines,
small capitals and fixed-width numbers over the picture, one plain sentence for the answer, Sun gold and
Earth blue as everywhere, and orange kept for the one thing that is not true to scale.

Decisions taken while building it, each stated on the page or in `VALIDATION.md` §13:

- **The stretch scales the whole scene along "up".** It multiplies every height above or below eye level
  (the tangent of the elevation), as a relief map does, so eye level stays put and what hides what does
  not change: a disk is covered by exactly the same land, stretched or not.
- **The track decides what is up.** The view follows the skyline's shape under a disk; the track's
  figure treats it as level there. They agree to within 0.06 of the Sun's disk in every hour of the data
  and differ on "any part showing" in 205 of 911,664 checks, each explained. In those hours the page
  goes by the track, so the picture never contradicts the answer beside it.
- **No roll.** The horizon stays level however the phone is held: the motion sensor gives a heading and a
  tilt, and the twist is left out.
- **Turning is relative, tilting is absolute.** The Moon's north is not the room's north, so the view
  starts where it was and turns as the visitor turns; level in the picture is level in the room.

What it leaves out: any ground beyond the skyline (it has no terrain mesh, so no shadows, no slopes and
nothing "over there"); custom coordinates (a link to one opens the first listed site and says so, with a
way back to Classic); landing limits and the slip check (the link carries them through untouched);
the co-pilot; a headset view (not built: there was no way to check one here). Not tried on a real phone:
the motion sensor was exercised with readings played by hand and its ways of failing, and in the iPhone
simulator as far as the permission question.

Screenshots: `docs/img/surface/`.

## Every design is a tab

This demo is for comparing. One bar across the top of every page lists the pages and the designs:

`Whole Moon | Classic · Mission control · Scout · Planner · Atlas · Briefing · Surface | 1-minute tour · Demo video · How it works`

- Each tab is an ordinary link with its own address, so any of them can be shared.
- The designs open on the same site, month and hour that is on screen, so switching tabs compares
  like with like.
- Adding a design is two steps: a line in `web/src/lib/siteTabs.ts`, and `<SiteTabs current="…" />` at
  the top of the new page.

## Build order

1. **Shell:** top bar, full-window stage, status line, time river, and the mission panel with Now, When to land and Learn. (`?ui=next`) **Done 2026-11-11.**
2. **Compare** in the shell, the tour as a card over the stage, and the finish card.
3. **Co-pilot drawer.**
4. **How it works** page with the stack diagram. **Done 2026-11-11** (`#how`).
5. **Phone layout, arriving animation, battery on the river.**
6. ~~Switch over and delete the old layout.~~ **Changed 2026-11-11:** every design stays, each as a tab on the
   one tab bar across the top of every page, so the team can compare them. Choosing one is for the hackathon app.
