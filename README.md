# Sightline

**Where to land on the Moon, and when.** Sightline shows when the Sun (power) and Earth (a direct radio link)
are in view from a landing site on the Moon, above the real terrain horizon, hour by hour, and whether a
landing on a given date fits a mission's limits.

Team **Shackleton Station**, NASA Space Apps Challenge 2026 (Nov 14–15, Bethesda): Rodrigo (captain), Pat,
Misha, Jessica, Ravi, Sebastian.

Built on our team's own pre-event practice code; reuse approved by the Bethesda Local Lead.

**Live:** https://lunarsightline.com (shackletonstation.dev forwards there; the site as it was before this one-screen design is kept at
[`/classic/`](https://lunarsightline.com/classic/))

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

Scout gives a tour of the whole screen in twelve steps: about a minute to read through, about five
to hear. Its chip, "Take the tour", is in Watch on every visit, and it is always the first thing in
the **Guide** (on a phone, also under **More**). It drives the real screen: each step puts the app in
a prepared state, shades the page a little except what the step is about, rings that, and shows a
short line. Back, Next and "Close the tour", the arrow keys (or a clicker's Page Down and Page Up)
and Escape; a dot for each step goes straight to it; closing at any step puts the screen back as it
was. **Listen** plays each step's longer spoken line in Scout's voice (AI-generated; off until
pressed), and **Play through** moves on by itself when a line ends: 4 min 47 s in all, which is how a
five-minute presentation runs. The steps, with the line on each card:

1. **The challenge.** A lander needs the Sun for power and Earth for radio. At the pole, both come and go.
2. **Plan a landing.** Three choices: where, when, and which mission.
3. **The verdict.** One answer: it fits, it fits with little margin, or it does not. And why.
4. **The date slipped.** Launches slip. One press adds the next landing that fits.
5. **What the lander sees.** The view from the ground. Under it, the whole horizon at once.
6. **Time.** Green is the Sun and Earth together. Day, month or year.
7. **The ground.** Close on the site, with NASA's own maps over it.
8. **Compare.** Up to four sites and dates, side by side. A star for the best in each row. No blended score.
9. **The Planner.** Every site, every month: where and when a landing fits.
10. **Landing accuracy.** It fits on the aim point. A short way off, most landings do not. A better aim helps.
11. **Can it be trusted?.** Checked against NASA, three ways. And it says what it cannot tell you.
12. **Ask Scout, and try it.** Ask in plain words. Share a plan as a link. lunarsightline.com

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
