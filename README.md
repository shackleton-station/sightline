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

Scout's tour follows one landing plan across the whole screen, in fourteen steps and four chapters: a
landing that does not fit, why, what to do when the date slips, and why to trust the answer. It takes
about two minutes to read and about five and a half to hear. Its chip, "Take the tour", is in Watch on
every visit, and it is always the first thing in the **Guide** (on a phone, also under **More**). It
drives the real screen: each step puts the app in a prepared state, shades the page a little except
what the step is about, rings that, and explains it in two sentences that stand by themselves. Two
steps press a control for the reader ("Show it"): the next landing that fits, and "+" for another
scenario. The card keeps one home, the lower left corner, with Back and Next always in the same place;
it moves to the lower right only where it would cover what the step is about. The arrow keys (or a
clicker's Page Down and Page Up) step it and Escape closes it; a dot for each step, grouped by chapter,
goes straight to it; closing at any step puts the screen back as it was, and "Start planning" on the
last step leaves the story's plan on screen. **Listen** plays each step's longer spoken line in
Scout's voice (AI-generated; off until pressed), and **Play through** moves on by itself when a line
ends. The steps, with the words on each card:

*The problem*

1. **A hard place to land.** A lander needs the Sun for power and Earth for a direct radio link. At the Moon's south pole both only skim the horizon, so the hills decide when each is in view.
2. **Plan a landing.** Every answer starts from a plan: where, when, and what the mission needs. Pick a site from the list or type any coordinates, then a landing date and hour, in UTC.

*One landing, answered*

3. **Does it fit?** The answer comes first: fits, fits with little margin, or does not fit, and why. Under it are the Sun's elevation and its share of the mission, the same for Earth, and the slope.
4. **What the lander sees.** So why does it not fit? Stand at the site: the Sun and Earth stand low over the real skyline, each with the time until it sets. Under them, the whole horizon at once.
5. **Hour by hour.** Now run the 14 days forward. Gold is the Sun, blue is Earth, green is both: the gaps are why this landing fails. Play it, or step out to a month or a year.

*The plan changes*

6. **The date slips.** Launch dates slip, and this one has to. One press adds the next landing that fits beside the first: the same site, on 22 June.
7. **Another option.** Now the plan holds two scenarios, A and B: each letter is a site and a landing hour. Press + for another, up to four; − on a letter drops it, and Undo brings it back.
8. **Another site, same date?** Would another site save 6 May? C and D are two more sites near the pole on that date, and neither fits. A star marks the best in each row; there is no blended score.
9. **Every site, every month.** Step back to every listed site against every month. In May 2027 no site at the pole has a landing that fits; in June, Connecting Ridge has three days with one.
10. **What if it misses?** B fits on its aim point, but no lander comes down exactly there. Of the landings within reach, 38% fit; aim 44 m away, and 60% do.

*Trust it, and use it*

11. **NASA's maps and tools.** Look at the ground itself, three ways: orbit, site, surface. NASA's own maps lie over it, and every plan opens in Quickmap, Moon Trek and JPL Horizons.
12. **Can it be trusted?** Every number is checked against NASA three ways: JPL Horizons, NASA's own sunlight map, and dated photos from orbit. The Guide also says what Sightline cannot tell you.
13. **Ask Scout.** Or just ask. Scout answers in plain words from the same data, and he never writes a number himself: the server fills in every figure.
14. **Yours to use.** A planner gets every hour as a table and the links to NASA's tools; a class gets the Guide; anyone can ask Scout. Share any plan as a link, or try Canada's rover mission.

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
