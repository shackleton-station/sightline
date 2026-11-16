# Sightline

**Where to land on the Moon, and when.** Sightline shows when the Sun (power) and Earth (a direct radio link)
are in view from a landing site on the Moon, above the real terrain horizon, hour by hour, and whether a
landing on a given date fits a mission's limits.

Team **Shackleton Station**, NASA Space Apps Challenge 2026 (Nov 14–15, Bethesda): Rodrigo (captain), Pat,
Misha, Jessica, Ravi, Sebastian.

Built on our team's own pre-event practice code; reuse approved by the Bethesda Local Lead.

**Live:** https://lunarsightline.com (shackletonstation.dev forwards there; the site as it was before this one-screen design is kept at
[`/classic/`](https://lunarsightline.com/classic/))

**By the numbers**

- **21 GB** of NASA terrain read
- **210,384** hours covered, 2026 to 2049
- **2,471,696** points of the south pole, each with its own skyline
- **1.04 trillion** Sun and Earth answers computed
- **5,469,984** checks against JPL Horizons
- **235** dated photos from orbit compared

The Guide shows the same six, worked out from the data files as the page reads them
(`web/src/lib/dataScale.ts`); a test keeps this list the same as the data's.

## What it does

- **Watch.** The Moon from over its south pole, lit as it is at this hour, with time playing. Each site's
  dot shows what is in view there at that moment: the Sun, Earth, both or neither, by shape and color.
- **Plan.** Pick a site, a landing date and hour, and a mission (how long it lasts, how much darkness and
  radio silence it can take, how steep the ground may be). Sightline answers in words: it fits, it fits with
  little margin, or it does not and why, with the next landing that does.
- **The skyline.** All 360° of the real horizon at the site, with the Sun and Earth on it and the paths they
  follow.
- **The river.** One row per scenario on one time axis, by day, month or year: when the Sun and Earth are up.
- **Scenarios.** Up to four, side by side: sunlit share, longest dark, Earth in view, longest radio
  silence, slope. No blended score.
- **Scout.** A co-pilot (marked "AI") that answers questions about sites and dates. It can only call the
  same functions the app uses, and it never types a number: the server fills every figure in from the
  computed data.
- **Share.** A scenario is a link. A saved plan gets a short link and a written brief.

13 sites, every hour from 2026 to 2049.

## Using the site

Scout's tour follows one landing plan across the whole screen, step by step, in nineteen steps and
four chapters: a landing that does not fit, why, what to do when the date slips, why to trust the
answer and how to hand it on. It takes about two and a half minutes to read and about seven and a half to hear. Each time
the front page is opened it is the first thing a visitor sees: one card centered over the Moon, on a
page dimmed a little, with what Sightline answers, what the tour takes to read, "Take the tour" and
"Skip". Skip, Escape or a press outside the card closes it until the page is opened again; "Don't
show this again", small under the buttons, keeps it away in that browser. The chip "Take the tour" is
in Watch on every visit, and the tour is always the first thing in the **Guide** (on a phone, also
under **More**). A link that carries a plan never gets the welcome.

It drives the real screen. Wherever the story moves to another part of the screen, the step first
rings the control a visitor would press ("Plan a landing", the site list for a point typed in, the Moon for a point pressed, the mission, Surface, Compare, Planner and
its Compare tab, Landing accuracy, Site and Layers, Guide, Scout, Share, Brief), and the first Next, which
then reads "Show it", presses it for them; where it opened a page or another view, the way back is
ringed for a moment as the reader moves on. So a reader who closes the tour knows which button led
where. Each card explains its step in two sentences that stand by themselves, and the page is shaded
a little except what the step is about. The card keeps one home, the lower left corner, with Back and
Next always in the same place; it moves to the lower right only where it would cover what the step is
about. The arrow keys (or a clicker's Page Down and Page Up) step it and Escape closes it; a dot for
each step, grouped by chapter, goes straight to it; closing at any step puts the screen back as it
was, and "Start planning" on the last step leaves the story's plan on screen. **Listen** plays each
step's longer spoken line in Scout's voice (AI-generated; off until pressed), and **Play through**
moves on by itself when a line ends, making each press as the voice reaches it. The steps, with the
words on each card:

*The problem*

1. **A hard place to land.** A lander needs the Sun for power and Earth for a direct radio link. At the Moon's south pole both only skim the horizon, so the hills decide when each is in view.
2. **Plan a landing.** Press Plan a landing: the front page is the Moon to watch, and this button starts a plan. Choose where, a listed site or any coordinates, and when, in UTC.
3. **Or any point at all.** A landing need not be at a listed site. Choose Custom point in the site list, type a latitude and a longitude, and press Go: Sightline works out that point's own skyline and answers for it.
4. **Or press the Moon.** Or just press the Moon: wherever you press becomes the plan's site, with its own skyline and its own answer. This point, close to Connecting Ridge, is sunlit 35% of the mission.
5. **What it must survive.** Press the mission to see what it must survive: 14 days, at most 24 h dark or 24 h of radio silence. Advanced can ask that Earth's center clear the skyline by 2° or 5°.

*One landing, answered*

6. **Does it fit?** Does it fit those limits? The answer comes first, fits, fits with little margin or does not fit, and why. Under it: the Sun's elevation, each body's share of the mission, the slope.
7. **What the lander sees.** So why does it not fit? Press Surface to stand at the site: the Sun and Earth are low over the real skyline, each with the time until it sets.
8. **Hour by hour.** Now run the 14 days forward. Gold is the Sun, blue is Earth, green is both: the gaps are why this landing fails. Play it, or step out to a year.

*The plan changes*

9. **The date slips.** Launch dates slip, and this one has to. One press adds the next landing that fits beside the first: the same site, on 22 June.
10. **Another option.** Now the plan holds two scenarios, A and B: each letter is a site and a landing hour. Press + for another, up to four; − on a letter drops it.
11. **Another site, same date?** Would another site save 6 May? Press Compare: C and D, two more sites near the pole on that date, do not fit either. A star marks each row's best.
12. **Every site, every month.** Press Planner to see every listed site against every month. In May 2027 no site at the pole has a landing that fits; in June, Connecting Ridge has three days.
13. **Compare in depth.** Press the Planner's Compare tab to weigh A to D in full: At a glance colors each figure by your limits, and only B fits. Export saves the table, or every hour, as a file.
14. **What if it misses?** Press Landing accuracy: B fits on its aim point, but no lander comes down exactly there. Of the landings within reach, 38% fit; aim 44 m away, and 60% do.

*Trust it, and use it*

15. **NASA's maps and tools.** Press Site and Layers to look at the ground itself, under NASA's own maps. Every plan opens in Quickmap, Moon Trek and JPL Horizons.
16. **Can it be trusted?** Press Guide for the proof: every number is checked against NASA three ways, with JPL Horizons, NASA's sunlight map and dated photos. It says what Sightline cannot tell you.
17. **Ask Scout.** Or just ask: press Scout. He answers in plain words from the same data, and never writes a number himself: the server fills in every figure.
18. **Share the plan.** Press Share: its link holds every scenario, landing hour and limit, so it opens as this same plan. Copy link copies it.
19. **Hand it on.** Last, the Brief writes the scenario on show out in full, to read or print. That was the story: every feature, Canada's rover too, has its own short guide, listed in the Guide.

The tour is the story; every control it does not stop at has a feature guide of its own, two to four
cards in the tour's look, with no voice. There are eighteen, all listed in the Guide: Read the answer, The mission's limits, Compare scenarios, The Planner, Find a landing, Compare in full, Landing accuracy, Views and layers, On the surface, The time bar, A custom point, Share a plan, The written brief, The Library, Check it in NASA's tools, Ask Scout, A real mission: Canada's rover, The front page. Layers,
Compare, the Share list, a custom point's form, the time bar's menu, the written brief and the Planner
(for the tab on show) also offer theirs as "Show me how". The keys are listed in the Guide, under
"Keys".

The steps, their words and what each one rings are in one file, `web/src/sightline/tour5.json`, which
the tour, the Guide and the voice files (`web/public/tour/voice5/`, made by
`web/scripts/tour-voice.mjs --tour=five`) all read, so they say the same thing. The feature guides
(`guides.json`) run on the same engine with the same look. The earlier eight-step tour's file,
`tour.json`, is kept for the walkthrough video's recorder and names the Guide's videos; the screen no
longer runs its steps.

## Where the numbers come from

Every number on screen is computed by this repository's pipeline from NASA data: the LOLA laser altimeter's
terrain models for the horizon at each site, and NAIF SPICE kernels for where the Sun and Earth are. The
results are checked against JPL Horizons and against NASA's published illumination and Earth-visibility maps
for the south pole. How far to trust them, with the measured differences: [`docs/VALIDATION.md`](docs/VALIDATION.md).
Every dataset, kernel, library and image, with its source and terms: [`REFERENCES.md`](REFERENCES.md).

AI tools were used to build this, and every task is listed: [`AI_USAGE.md`](AI_USAGE.md).

## Run

```sh
cd pipeline && uv sync && uv run python scripts/run_all.py   # the first run downloads about 21 GB of terrain and kernels
cd web && npm install && npm run dev                         # http://localhost:5173
```

On Windows, `run.cmd` (or `.\run.ps1`) is the web line for every day: it stops leftover dev servers holding the
ports, installs only when `package-lock.json` changed, starts the app on :5173, and cleans up on Ctrl+C. `-Local`
also runs the server stack (`npm run dev:server`, needs Git Bash); add `-FakeModel` to call no cloud at all.

The pipeline's results for the listed sites are committed under `web/public/data/`, so the web app runs
without the pipeline.

## How it is hosted

Google Cloud, all of it declared in Terraform ([`infra/`](infra/README.md)). Four Cloud Run services, each
with its own image, identity and deploy: the web server (`web/server/`), saved plans (`web/plans/`), the
co-pilot (`web/copilot/`) and a private worker that counts questions (`web/events-worker/`). A global load
balancer with a CDN and an edge firewall sends each path to its service on `lunarsightline.com`. Terrain
tiles and video come straight from a Cloud Storage bucket through the CDN.

There are no stored keys. GitHub Actions signs in to Google Cloud by proving which repository, branch and
workflow it runs from, and the co-pilot signs in to the Anthropic API as its own Google service account.
Merging to `main` deploys, one service at a time, each new version tested before visitors reach it:
[`docs/DEPLOY.md`](docs/DEPLOY.md).

## Read more

- [`docs/DETAILS.md`](docs/DETAILS.md): how it works, every decision and why, known limits
- [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md): the services and what each may touch
- [`docs/SETUP.md`](docs/SETUP.md): setting up a machine to work on it
- [`docs/PROGRESS.md`](docs/PROGRESS.md): what is done and what is next · [`CLAUDE.md`](CLAUDE.md): rules for agents
- [`AI_USAGE.md`](AI_USAGE.md) · [`REFERENCES.md`](REFERENCES.md) · [`FRICTION_LOG.md`](FRICTION_LOG.md)
