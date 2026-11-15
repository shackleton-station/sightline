# Test report: 2026-11-14 (Ravi)

What I ran on `main` at `aaeee7e`, what I found, and what I need the team to answer. No app code was changed.
Section 0 is the independent check of the landing calculations. Sections 1–3 cover CI and the live site.
**Re-checked on `main` at `9f94738`** (after PRs #12–#58), including the features added since: see the next section.

## Re-check on `9f94738` (evening of 2026-11-14)

Everything in section 0 was run again on the new `main`, and the features added since the morning were checked the
same way: my own code, sharing nothing with the app's maths, on the shipped data. No app code was changed.

| # | Check | Scope | Result |
| --- | --- | --- | --- |
| CI | Same steps as CI | pipeline and web | **All green.** pytest 185 passed, 3 skipped; ruff clean; `tsc -b` clean; vitest 1,401 passed, 11 skipped; lint 0 errors (22 warnings); build OK |
| V1–V5 | Positions, horizon flags, summaries, physics | all 13 sites, 2026–2049 | **Unchanged**: the shipped data is the same files as in the morning (only `shadow.json` is new). Same 305 rounding slivers and 8 values off by 0.1 from rounding |
| V6 | Mission verdict vs brute force, now with the longer limits of #46 (30-day missions, 168 h darkness) | 150 missions, 2027 and 2045–2049: **7.9 M landing hours** | **0 mismatches** |
| O1 | Landing odds (#33, #42) vs a Monte Carlo of random landings | 60 random maps, round and stretched spreads, straight and turned approach paths, 400,000 landings each | Worst difference **0.17 points** (noise allowance 0.4) |
| O2 | The accuracy radius holds 99% of landings | 4 accuracies and stretches | 98.98–99.01% |
| O3 | The largest accuracy offered keeps landings on the map ("all but about 1 in 3,000") | stretch 1–4, 3 directions | 1 in 3,540 fall off: **as claimed** |
| O4 | "A better place to aim" is the best aim within reach, and its odds are right | 25 maps, every aim on the same grid, judged by simulation | **0** wrong odds, **0** better aims missed |
| O1b | Does O1 catch bugs? I mirrored the approach direction in the simulation | 30 maps | Fails with a **15-point** difference, so yes |
| L1 | Mission success layer (#52, #55) vs simulation and vs the panel's own odds | 20 maps, 240 aim points | Round spreads and straight approach paths: **exact** (≤ 0.04 points). Turned paths at tight accuracy: up to **1.4 points** off (finding F6) |
| S1 | Distance to permanently shadowed ground (#22), from NASA's own LPSR maps (downloaded myself; pixels placed by the PDS labels, regions by my own flood fill) | all 7 sites on the maps, nearest patch and nearest region ≥ 10 km², 60/120/240 m maps | All **14 distances within 5 m** (shipped to 10 m). Same regions, same areas on the 60 m map (Shackleton 233.5 km²). The 4-neighbour rule would move only Connecting Ridge's region, 11.42 → 11.48 km |
| C1 | "Sun and Earth together, %" in Compare (#44) | 31,200 landings | **0 mismatches** |
| C2 | "Nearest site of the same group where that date fits" (#24) | 22,429 landings that don't fit (4,145 with a site offered) | **0 mismatches** (right site, right distance, and none offered exactly when none fits) |
| C3 | Planner Find tab (#35): days in each month a landing fits | 60 missions × 13 sites × 24 months: 12,480 site-months | **0 mismatches** |
| P1 | "Sunlight on a panel, W/m²" (#44) | formula read, not simulated | 1361 W/m² × share of the Sun's disc in view × cos(Sun elevation), averaged over the mission: right for a vertical panel turned to the Sun, before losses, as its hover text says |

New findings:

- **F6 (low): the success layer is slightly off for turned approach paths at tight accuracy.** With a 50 m accuracy,
  ×2–3 along the path and the path at 20° or 120°, the colour at a point is up to 1.4 points from the odds the panel
  gives for the same point (the panel matches the simulation). Round spreads and paths straight up or across are
  exact. The cause is in the code's own words: the third, slanted blur pass reads each pixel at its middle rather than
  over its width. It changes a colour, never a number shown, so it isn't worth a change before the pitch.
- **F7 (Misha, Ravi's area): Compare's "best" tie rule.** The front page and planner mark a sunlit winner on a 0.5
  point difference, while the classic Compare calls anything within the measured error "Too close" (5–21 points).
  On 2027 data, 14-day mission, the four ridge sites: 2–19% of landings where two sites differ get a front-page
  winner that the classic page calls "Too close", with gaps up to 21 points (about 72 h). Question to Misha (Q9).

Re-run (from `web/`):

```sh
python3 -I ../docs/test-report/verify/verify_data.py public/data
npx tsx ../docs/test-report/verify/mission_check.ts "$PWD/public/data" 2027,2045,2046,2047,2048,2049
npx tsx ../docs/test-report/verify/odds_check.ts          # O1–O4
npx tsx ../docs/test-report/verify/layer_check.ts 20 400000
npx tsx ../docs/test-report/verify/compare_check.ts public/data 2027,2028 60
# S1 needs NASA's three LPSR_*_201608.TIF maps (2.3 MB, https://pgda.gsfc.nasa.gov/data/MoonIllumination/) in a folder:
../pipeline/.venv/bin/python -I ../docs/test-report/verify/shadow_check.py <that folder> public/data
```

## 30-second version (to say out loud)

> I checked the landing answers independently, with my own code rather than ours. Sun and Earth positions
> match my own JPL Horizons queries within 0.006°. "Sun up" and "Earth up" agree with the terrain horizon in
> 5.4 million out of 5.4 million hourly checks. The physics holds: 29.53 days between sunrises, about 50% sun
> at the equator, and the farside never sees Earth. The "fits / next good landing" logic matches a brute-force
> version at every one of 5.9 million landing hours. My checker does catch a deliberately planted
> off-by-one bug, so it isn't just passing everything. All CI checks pass. What's left is judgment, not
> bugs: "Sun up" counts any sliver of the disk, and our ridge sites run above NASA's map. Separately, two
> layout issues need a real phone.

## 0. Are the landing answers right? (independent verification)

The scripts are in [`test-report/verify/`](test-report/verify/). They don't import the pipeline's code: each
one recomputes from the shipped data (`web/public/data/`) or asks JPL directly.

| # | Check | Scope | Result |
| --- | --- | --- | --- |
| V1 | Sun/Earth azimuth and elevation vs **my own** JPL Horizons queries (apparent, airless, geodetic site) | Shackleton Rim 2027-05-14, Apollo 11 2031-09-03, Chang'e 4 2045-02-20, Sun + Earth, 7 h each (42 points) | Worst separation **0.006°**, which is the app's 0.01° rounding. The Sun's disk is about 0.53° across |
| V2 | "Sun up" / "Earth up" recomputed as *disk center elevation − horizon(azimuth) > −angular radius*, from `horizon.json` | all 13 sites, every hour 2026–2049: 2,734,992 hours, 5.45 M judgments | **0 disagreements** (17,823 hours within 0.01° of the line were not judged, because rounding can't decide them) |
| V3 | Monthly summaries (sun %, Earth %, both %, longest dark, longest silence, sun windows) recomputed from the hourly track | 3,744 site-months | All match, except 8 values that differ by 0.1 where a value lands exactly on .x5 (e.g. 459/720 = 63.75%). That's floating-point rounding, not a bug |
| V4 | Yearly files (`year-YYYY.json`) and overview files (`overview/YYYY.json`, which drive the grid and planner) vs the hourly tracks | 624 overview series, every month | **All identical** |
| V5 | Physics sanity | all sites | Days between sunrises at low latitudes: **29.530** (synodic month 29.531). Equatorial sun 48–50%. Nearside sites see Earth 100% of the time, farside Chang'e 4 0%. Polar Sun stays within 90° − lat + 1.54° (e.g. de Gerlache ±2.89°). Apollo 11 Sun reaches 89.9° |
| V6 | App's **mission verdict** (`viableHours`, `landingProblems`, `nextViable`, `betterDate`) vs a brute-force version written from the rules | 260 random missions (1–28 days; limits 0 h to none; Sun/Earth at landing on/off; Earth clearance 0/2/5°) on 2027 and 2045–2049 (including the end of the data): **5.9 M landing hours** | **0 mismatches** |
| V6b | Does V6 catch bugs? I planted an off-by-one (`>` changed to `>=`) in the brute-force copy | 40 missions | 3,789 mismatches, so the harness does catch bugs |

Notes:
- 305 hours show `sun_up: true` with `sun_frac: 0.0`. That's not a bug: the fraction is rounded to 3 decimals,
  so these are slivers under 0.05% of the disk.
- V1 only covers 42 points. The team's own `compare_horizons.py` covers every hour (VALIDATION §1). V1 shows the
  same thing with code that shares nothing with ours.

What this does **not** prove, and why it matters:
- **The terrain horizon itself.** V2 checks that the flags follow `horizon.json`, not that `horizon.json` is
  right. The pipeline's own comparison against NASA (VALIDATION §2) says our four **ridge sites run 3 to 24 points
  above NASA's sunlit share**. That's the biggest accuracy caveat, and it applies straight to site comparisons.
- **The rules are choices.** See Q6 and Q7.

Re-run:

```sh
python3 -I docs/test-report/verify/verify_data.py web/public/data
web/node_modules/.bin/esbuild docs/test-report/verify/mission_check.ts --bundle --platform=node --format=esm --outfile=/tmp/mc.mjs
node /tmp/mc.mjs web/public/data 2045,2046,2047,2048,2049 104
```

## 1. Automated checks (same steps as CI)

| Area | Step | Result |
| --- | --- | --- |
| pipeline | `uv sync --locked` | OK |
| pipeline | `ruff check .` | All checks passed |
| pipeline | `ruff format --check .` | 60 files already formatted |
| pipeline | `pytest` | **179 passed, 3 skipped** (the skipped ones need SPICE kernels cached locally) |
| web | `npm ci` (Node 22) | OK |
| web | `tsc -b` | 0 errors |
| web | `vitest run` | **1,223 passed, 11 skipped** in 126 files. The 2 skipped files need the Firestore emulator (`plans/firestorePlans.emulator.test.ts`, `shared/firestoreStats.emulator.test.ts`) |
| web | `npm run lint` | 0 errors, 32 warnings (see F4) |
| web | `build`, `build:worker`, `build:plans`, `build:copilot`, `build:server` | all succeed; one warning that some chunks are over 500 kB |

## 2. Live site (https://shackletonstation.dev)

| Path | Status | Note |
| --- | --- | --- |
| `/`, `/classic/`, `/planner/`, `/atlas/`, `/briefing/`, `/surface/`, `/scout/`, `/privacy/`, `/terms/` | 200 | all under 0.4 s |
| `/data/range.json` | 200 | covers 2026-01-01 to 2050-01-01, 210,384 hours, matches the README |
| `/api/plans` | 401 | expected without sign-in |
| `/robots.txt` | 404 | minor; see Q4 |
| `/favicon.ico` | 404 | harmless: the pages declare `/sightline-icon.svg` |

Headless Chrome screenshots at 390×844 (phone) and 1280×800 (desktop): 12 runs, **no console errors**. The only
console message was a Three.js shader warning (`use of potentially uninitialized variable (f_lightAt)`) on the
home page.

## 3. Findings

| # | What | Where | Severity | Status |
| --- | --- | --- | --- | --- |
| F1 | At 390 px, content looks cut off on the right: the Planner's third slider ("Longest … Earth") and the "Earth counts as in view" dropdown, plus Scout's "Sound" button, chat card and footer line. [Planner](test-report/sl-planner-390.png) · [Scout](test-report/sl-scout-390.png) | `/planner/`, `/scout/` | Medium, if real (PROGRESS says "no sideways overflow") | **Needs a real phone.** Headless window sizing can differ from a phone's viewport |
| F2 | The home page screenshot is completely black after 12 s, at both widths | `/` | High if it happens on phones, otherwise none | **Needs a real phone.** Most likely WebGL with no GPU in headless Chrome. This matches the open item "3D view went blank on Rodrigo's phone, retest pending" |
| F3 | `relief()` divides by `(high - low)`. When the 1st and 99th percentiles are equal (flat or nearly flat terrain), it produces NaN, which is cast to `uint8`, so the pixel values are undefined. `test_global_relief_centers_on_zero_longitude` triggers it and still passes | `pipeline/src/clps/maps.py:33` | Low (real lunar terrain is rarely this flat) | Suggested fix: return a mid-gray image when `high <= low`, and make the test fail on RuntimeWarning. Rodrigo's call |
| F4 | 32 lint warnings, 0 errors. 14 are React Compiler "existing memoization could not be preserved" in `Sightline.tsx`, which means the compiler skips optimizing the main screen. 11 are setState inside an effect | `web/src/sightline/Sightline.tsx` | Low (performance only) | I checked the `exhaustive-deps` warning on `firstBetter` (line 251): the hook lists the fields it uses on purpose, so it is **not** a bug |
| F5 | Largest JS chunk is `GlobeViewerGpu` at 617 kB, plus a 527 kB wasm and three.js at 353 kB | web build | Low | Matters on phones on venue Wi-Fi; see Q3 |

## 4. Questions for the team

1. **Misha:** Is the Planner/Scout layout at 390 px meant to scroll sideways, or is that a bug (F1)? Can I check it on my phone today and report back?
2. **Misha / Rodrigo:** Was the phone retest of the 3D view (PROGRESS, Phase 4) ever done? If not, I'll do it with the home page (F2).
3. **Pat / Sebastian:** Is the globe chunk loaded only when needed? What does the first load cost on a phone over slow Wi-Fi (F5)?
4. **Rodrigo:** Should I open an issue for F3? Do we want a `robots.txt`?
6. **Rodrigo:** "Sun up" means *any sliver* of the disk, and that's also how the longest dark during the mission
   is counted. A panel gets almost nothing from a 1% sliver. The app warns about a thin Sun *at landing* (under 50%
   of the disk), but not during the mission. Should the power limit count by disk share, or should Plan at least
   say so?
7. **Rodrigo / Misha:** The site comparison (my area) compares ridge sites whose Sun share runs 3–24 points
   above NASA's map. The table says "Too close" under about 21 points. Is that what we want judges to see, or should
   the comparison show NASA's figure beside ours?
8. **Everyone:** Which of the "Checks only a person can do" (PROGRESS / OPEN_QUESTIONS #14, #15, #19) should I take?
9. **Misha:** Compare's "best" marks (F7). Should the front page and planner (a) use the classic page's measured-error
   tie when the sites differ, keeping the 0.5-point tie for one site on two dates; (b) keep 0.5 and say that small
   gaps are within the model's error; or (c) keep the two rules different on purpose? I'd suggest (a) and can open
   the PR. The error was measured on 18.6-year averages, not 14-day windows, so this is a judgment call.

## 5. Manual checklist I can run (real devices)

- [ ] Each tab on a real phone (Chrome on Android or Safari on iPhone): anything cut off, or anything that scrolls sideways? (F1)
- [ ] Home page globe on a phone: does it draw, and does it go blank after a few minutes? (F2)
- [ ] Scout voice and microphone, in Chrome on a laptop and Safari on a phone (#14)
- [ ] Follow the presenter with two phones (#15). If it fails once, tell Rodrigo to set `follow = false`
- [ ] Save and list a plan while signed in with a Google account (#19)
- [ ] The stopwatch user test in `docs/USER_TEST.md`, with someone who has never seen the app

## How to reproduce

```sh
cd pipeline && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd web && npm ci && npx tsc -b && npx vitest run && npm run lint && npm run build
```
