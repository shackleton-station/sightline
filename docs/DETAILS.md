# Implementation details and decisions

The long version of the README. Last updated 2026-11-03.

## Where things stand

| Area | State |
| --- | --- |
| Pipeline (kernels, DEM, horizon, ephemeris, visibility, validation, export) | Done for 13 sites, 2027 to 2030 |
| Web app | Done: answer-first screen, Learn and Plan modes, 1-minute tour, site and date picker, grid of every site and month, slip check, nearby ground map, ranked shortlist, map, comparison, landing-window finder, panorama, 3D, Earth comparison; checked at 390 and 1280 px in Chrome |
| Deploy | Live at https://lunarsightline.com; real-phone check pending |
| 3D view | Done, and rebuilt on Three.js on 2026-11-11 (`web/src/three/TerrainViewer.ts`): our LOLA terrain, lit by the pipeline's Sun with shadow maps. Measured against ray-traced terrain on 2026-11-12: 98.6% of points overall, 93.9% in hours with a real mix of lit and shadowed ground; shadows cast from under 1 km away are the weak spot (`docs/VALIDATION.md` §8). The first version went blank after a while on Rodrigo's phone; the Three.js version hasn't been tried on a phone |
| Teammate invites | Misha, Pat, Ravi and Jessica are in the org. Sebastian was invited by email on 2026-11-12; not accepted yet |

## Against the challenge statement

The official title is now **Lunar Landing Site Navigator**. Every objective is phrased as "may include" or
"may consider". The statement's Resources tab hasn't been read yet, and more resources may be added.

| Objective | State here |
| --- | --- |
| Sun and Earth relative to the horizon | **Done**: the main view |
| Time until sunset or Earthset | **Done**: first thing on screen. From hourly data, so accurate to the hour, and terrain-based |
| Solar elevation shown prominently | **Done** |
| Timeline or animation over time | **Done** |
| Actual terrain in the horizon | **Done**: LOLA, 20 m/px |
| Libration and orbital variation | **Done**: included in the SPICE geometry |
| Is a site-date combination viable? | **Done**: enter your limits; see whether a landing works, why not, and the next windows |
| Power metrics | **Done**: solar elevation, duration, and average sunlight on vertical and flat panels, before efficiency and losses |
| Pick dates and times | **Done**: a date picker and slider, every hour from 2027 to 2030 |
| Schedule changes | **Done**: +1 week, month, 3 months or year, with before and after, the next good date, other sites that work, and the ground around the site |
| Alternative sites in the same region | **Done at the four ridge sites**: a map of Sun, Earth and slope every 100 m within 5 km, with better places listed. Elsewhere, custom coordinates, one point at a time |
| Rapid comparison of many scenarios | **Done**: grid of 13 sites by 12 months, per year, responding to mission limits; click a square to open it. A shortlist ranks any site and date options against those limits, with reasons |
| Communication windows | **Done**: time until Earthset, longest gap, and a limit on how far Earth must clear the terrain, since any part of the disk showing is optimistic for radio |
| Coordination between science and engineering teams | **Partly**: a link carries the view, limits and shortlist. Nothing is stored or discussed in the app |
| Steep slopes and deep craters | **Done**: slope at each site (NASA's 5 m value with its uncertainty at ridge sites) and across the nearby map, and shadows in 3D. Rocks don't show at these scales |
| Lunar vs Earth conditions made apparent | **Done**: the Sun's height on Earth and at the site, on one scale |
| Curated sites: Apollo, CLPS, other countries | **Done**: 13 published sites |
| Future CLPS targets | **Missing**: no published coordinates found |
| Side-by-side comparison | **Done**: any two site and month combinations |
| Custom coordinates | **Done, anywhere on the Moon**, computed in the browser using terrain tiles near the point |
| Why small location changes have large impacts | **Done**: compare custom points a few hundred metres apart |
| Readable by educators and the public | **Done**: Learn mode, a 1-minute guided tour, and an explainer using each site's own numbers. Not yet tested with real people: see `docs/USER_TEST.md` |
| Why small changes have large impacts | **Done**: in the explainer, and visible on the nearby map |
| 2D map | **Done**: whole Moon with live day and night, south pole close-up, click to choose |
| 3D surface view | **Done**: sunlight follows the slider, from above or standing at the site, and shadows were checked against the terrain (`docs/VALIDATION.md` §8) |

### First screen

The first thing anyone sees is a plain answer ("Sunlit, and Earth is in view"), time left for each, and how high the Sun is.
Everything else opens on demand, and isn't built or downloaded until then.

| | Before | Now (390 px, Learn) |
| --- | --- | --- |
| Page height | 4,243 px | about 1,700 px |
| Controls | 45 | 25 |
| Words | about 850 | about 270 |
| Answer on screen | about two screens down | first screen |

On the live site, a phone's first load is 175 KB, with the answer on screen in 0.3 to 0.5 s (headless Chrome on a fast
connection, not a real phone). Opening the nearby map adds 28 KB. Opening a spot on it costs about 5.6 MB the first time, for
terrain and positions.

**3D opens by itself only on a large screen with a mouse.** It costs about 19 MB (measured on the live site) and about 5 s,
while the answer shows in well under a second. On a phone it's one tap away instead: phones have data plans, and the
blank 3D view reported on a real phone hasn't been confirmed fixed.

**A link without `mode=` opens in Plan,** so every link made before Learn existed opens as it did. A visit with no link opens
in Learn.

### Second audit against the full statement (2026-11-03)

Five ideas were measured before any were built. The numbers are in `docs/VALIDATION.md` §10.

| Idea | Decision | Why |
| --- | --- | --- |
| Map of nearby ground | **Built, for the four ridge sites** | Answers "alternative sites in the same region". Our top-rated spots land near NASA's 79th to 94th percentile, so it finds good ground. They also read up to 9 points high, so the app calls them places to look, not winners |
| Shortlist with ranking | **Built, with no score** | The statement asks for many site-date combinations. It sorts by meeting the limits, then gaps, because any blended weights would be invented. Pat's idea, without a model or typed requests |
| Height selector for the whole app | **Replaced by a small table** | Height matters a lot, but only 2 m is checked against NASA, and a global setting would multiply every number and tolerance. A read-only table gives the same insight |
| 0 m in that table | **Left out** | Correlation with NASA's map is near zero on well-lit ground (`docs/VALIDATION.md` §3) |
| Earth clearance limit | **Built** | Requiring 5° cuts Earth from 55% to 29% of 2027 at Connecting Ridge. Off by default, so existing results don't move |
| Sun clearance as a limit | **Shown, not a limit** | Sun's disk and panels already have a visible-share number, and no one asked for a limit |
| Slope | **Built** | Only 3 to 12% of the ground within 5 km of the ridge sites is under 5°, so a sunlight map alone would point at walls. IM-1 reads 13.0° against the roughly 12° published |
| Future CLPS targets as named areas | **Not built** | Sources give areas without coordinates, and disagree on Griffin. A feature's center isn't a landing target, and it would look like one |
| Typed requests | **Not built** | Needs a server or an API key, and its numbers couldn't be checked |

### Audit of accuracy (2026-11-03)

Measured in `docs/VALIDATION.md` §11. The calculation is already converged, so effort went to showing uncertainty honestly.

| Idea | Decision | Why |
| --- | --- | --- |
| Show what changes within 100 m | **Built, at the ridge sites** | Within 100 m, a month's Sun varies by 20 to 68 points, and in May each site reads near the top of that range |
| NASA's 100 terrain clones | **Built** | Gives each ridge site a real uncertainty at 1, 2 and 5 m |
| Compare with LROC's map from real photos | **Built into the build** | Independent of any terrain model, and only 6 MB |
| Compare with dated LROC photos | **Built, outside the build** | Tests whether a place is lit at a known moment. It depends on a slow remote archive, so `scripts/check_lroc_photos.py` runs by hand |
| NASA's 5 m slope and its uncertainty | **Built, at the ridge sites** | Closer to a lander's scale, and the uncertainty is shown too |
| Run everything on 5 m terrain | **Not done** | It changes 2 m values by 0.3 points or less, and 5 m tiles are only 16 km wide |
| Finer rays, azimuths or time steps | **Not done** | They change results by 0.04 points or less |

### Scope decisions

Made by Claude Code on 2026-11-02, at Rodrigo's request, then revisited against the full statement:

- **Sites across the whole Moon,** because the statement's first objective lists them. Published coordinates only.
- **Comparison is built here first,** in working pieces. The real submission is still written from scratch.

## What the pipeline computes

```
LOLA terrain ──> horizon mask ──────┐
 (20 m/px DEM)   720 azimuths       ├──> visible disk fraction ──> windows + summary ──> static JSON ──> web app
SPICE kernels ──> Sun/Earth az/el ──┘    per hour
```

1. **Horizon mask** (`horizon.py`): from the site, march along 720 azimuths and keep the highest terrain
   angle per azimuth. Works in 3D Moon-fixed coordinates, so lunar curvature is handled exactly.
2. **Sun and Earth directions** (`ephemeris.py`): apparent position from a fixed surface point, with
   light-time and stellar aberration, in the `MOON_ME` frame.
3. **Visibility** (`visibility.py`, `observation.py`): compares each disk with the horizon at its azimuth.
   A body is "up" if any part of its disk is visible; `sun_frac` holds the visible fraction.
4. **Validation** (`validate.py`): see [`VALIDATION.md`](VALIDATION.md).
5. **Maps** (`maps.py`): shaded-relief images behind the app's map. `run_all.py --maps-only` rebuilds just these.
6. **Export** (`export.py`): JSON in `web/public/data/` and TypeScript types in `web/src/data/contract.ts`.
7. **Custom coordinates** (`custom.py`, `web/src/lib/customModel.ts`): the same geometry again in TypeScript, using
   terrain tiles near the point, so anywhere on the Moon works without a server.

8. **Nearby ground** (`nearby.py`): the full model every 100 m within 5 km of the ridge sites, by month, with slope. `run_all.py --nearby-only` rebuilds just these.

`scripts/run_all.py` runs all of it: about 27 minutes on 16 cores, after downloading about 21 GB. It needs roughly 10 GB of memory, since it holds the whole polar DEM.

## Result

All of 2027, observer 2 m above the surface:

| Site | Sun up | Earth up | Both | Longest Sun gap | Longest Earth gap |
| --- | --- | --- | --- | --- | --- |
| Connecting Ridge | 90.5% | 55.2% | 50.0% | 118 h | 293 h |
| Shackleton Rim | 84.3% | 48.1% | 42.4% | 144 h | 341 h |
| Peak near Shackleton | 85.6% | 55.2% | 51.7% | 277 h | 298 h |
| de Gerlache Rim | 86.1% | 59.8% | 51.3% | 257 h | 268 h |
| Apollo 11 | 48.4% | 100.0% | 48.4% | 357 h | 0 h |
| Apollo 15 | 46.3% | 100.0% | 46.3% | 375 h | 0 h |
| Apollo 17 | 46.7% | 100.0% | 46.7% | 370 h | 0 h |
| Blue Ghost Mission 1 | 49.2% | 100.0% | 49.2% | 356 h | 0 h |
| IM-1 Odysseus | 38.4% | 100.0% | 38.4% | 453 h | 0 h |
| IM-2 Athena | 45.5% | 92.1% | 42.3% | 411 h | 76 h |
| Chandrayaan-3 | 46.8% | 100.0% | 46.8% | 383 h | 0 h |
| SLIM | 46.6% | 100.0% | 46.6% | 370 h | 0 h |
| Chang'e 4 | 51.0% | 0.0% | 0.0% | 363 h | all year |

Sun up by month at the polar ridges, 2027 (percent):

| Site | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Connecting Ridge | 100 | 100 | 89 | 66 | 60 | 72 | 99 | 100 | 100 | 100 | 100 | 100 |
| Shackleton Rim | 97 | 87 | 73 | 57 | 52 | 68 | 85 | 92 | 100 | 100 | 100 | 100 |
| Peak near Shackleton | 96 | 86 | 68 | 62 | 62 | 67 | 86 | 99 | 100 | 100 | 100 | 100 |
| de Gerlache Rim | 100 | 93 | 77 | 61 | 61 | 63 | 83 | 94 | 100 | 100 | 100 | 100 |

## Decisions

| Decision | Why | Alternatives rejected |
| --- | --- | --- |
| **Sites:** Connecting Ridge, Shackleton Rim, Peak near Shackleton, de Gerlache Rim | NASA PGDA product 78 lists 27 sites, but only these four have a working region file. Each location is that file's largest region, so nothing is invented, and the rule was applied before looking at illumination values. | Malapert and Nobile: no working region file. Artemis III regions: searches found no published coordinates. |
| **Other sites:** Apollo 11, 15, 17; Blue Ghost 1; IM-1; IM-2; Chandrayaan-3; SLIM; Chang'e 4 | Each location comes from NASA's NSSDCA, NASA or LROC, linked from the app. All have actually flown; future CLPS targets have no coordinates we could find. | Secondary sources. Unflown targets. |
| **Terrain:** the 20 m polar DEM wherever it reaches (80–90°S), otherwise `ldem_128.img`, 237 m/px, 2.1 GB | Covers the whole Moon, and it's in the same frame as the polar DEM. | USGS 118 m mosaic: 8.5 GB and slow to read in pieces. |
| **Default month:** May 2027 | Least Sun of any 2027 month at Connecting Ridge, so it shows nights and is the worst case for power. | January (`CLAUDE.md`'s example): the Sun never sets there, so the timeline would show nothing. |
| **Data split per month** | The app loads about 130 KB for a month rather than 1.6 MB for a year. | One file per year. |
| **DEM:** `LDEM_80S_20MPP_ADJ.TIF`, 20 m/px, 2.70 GB | Matches the spec's preferred resolution and covers far beyond the range we need. | 5 m site tiles: only 16 km wide. 10 m: 4.8 GB for little gain here. |
| **Horizon range:** 200 km (spec says 150) | Horizon-setting terrain reaches 195 km. Stopping at 150 km is off by up to 0.46° at one azimuth; 200 km matched 280 km exactly. Adds almost no compute time. | 150 km. |
| **Observer height:** 2 m | Spec default. It matters a lot here: Sun goes from 65% at 0 m to 90% at 2 m over 18.6 years. | |
| **Kernels:** `de440s.bsp` + `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf`, frame `MOON_ME` | Same frame as LOLA products. `de440s` is the same DE440 solution at 33 MB instead of 120 MB. | `de421.bsp`: 404 on NAIF now. |
| **Validation beyond the spec:** full 18.6-year run plus 80 random pixels | One pixel on a ridge can't settle anything: neighbouring PGDA pixels range from 45% to 86%. | 1–2 years at the site pixel only. |
| **Well-lit pixels sampled deliberately** (half the 80) | A uniform sample is mostly dark terrain and made agreement look better than it is at the places a mission would choose. | Uniform sampling only. |
| **The UI compares the ground with NASA's map, site by site, and says "not confirmed" where they differ by more than the measured error** | A blanket "validated vs PGDA" badge, as the spec suggested, would overstate it; setting the 2 m figure against a map of the ground understated it. The 2 m figure is given beside it. | "Validated" label; comparing at 2 m. |
| **Hosting: Google Cloud Run behind a load balancer** (since 2026-11-11; before that, Cloudflare Workers static assets) | The typed-question API needed a server, the Gemini calls and credits were already on Google Cloud, and Terraform plus keyless deploys make the setup repeatable for the hackathon app in minutes. | Staying on Cloudflare with a separate key for Vertex AI. AWS (no credits, a second cloud to set up before the event). |
| **Custom coordinates with fine terrain only near the point** | Measured first: horizons need fine terrain only nearby. 20 m within 5 km plus 500 m beyond (south polar region), or 237 m within 40 km plus 7.6 km beyond (elsewhere), matches the full model to within 0.36 Sun points at 90% of test points. A point downloads a few MB and computes in about 0.5 s, with no server. A test holds the browser to Python at 16 points. | A server. Coarse terrain with a 70° limit, our first version: up to 20 points wrong near the poles. |
| **Terrain tiles stay out of Git** | 6,313 files, 1.5 GB: fine for a Cloud Storage bucket, too large for the repo. `npm run upload-tiles` refuses to run without a complete local set, so a fresh checkout can't wipe them from the live site. CI uses a small committed set. | Committing them. |
| **Map relief computed from our own terrain** | Same data as the analysis, no third-party imagery or licensing to track, and small (under 1 MB per image). | Cesium for 2D. Published mosaics. |
| **3D view: our own renderer, not Cesium** (differs from `CLAUDE.md` §2 and §8.5) | We built the Cesium version first and measured it: at 4,000 ground points its shadows matched the terrain only 38.9% of the time, nearly always drawing sunlight where there's none. Cesium's shadow map dropped the far ridges that block a low polar Sun, its meshes are heavily simplified, and its photo textures have old shadows baked in. Tracing sunlight through our own LOLA heights matched 98.1%, needed no token or account, and added 5.9 KB of code instead of 5+ MB. That renderer was replaced on 2026-11-11 by a Three.js one on the same terrain, which scores 98.6% overall and 93.9% in mixed hours (`docs/VALIDATION.md` §8); the reason for not using Cesium stands. | CesiumJS with Cesium Moon Terrain, as specified. Keeping Cesium's camera with our terrain: same shadow map problem. |
| **Shadowed ground is tinted blue** | True lunar shadow is nearly black, so at a low Sun you couldn't see the terrain at all. A faint blue fill shows its shape. It's a display choice, stated under the view, and bright grey always means sunlit. | Accurate black, which hid Shackleton crater entirely. |
| **Shareable links** | The address always holds the sites, months, time and limits, with no server or account. It makes demo shots repeatable and lets people send a planner an exact scenario. | Saved state in the browser only. |
| **Panel sunlight in W/m², before efficiency** | It's what the geometry can actually tell us, and it shows why polar panels stand vertical. The solar constant (1361 W/m²) is the one number not from our pipeline; it's cited in `REFERENCES.md`. | Watts from a specific panel: that needs hardware details we don't have. |
| **Mission limits are user inputs** | The defaults (14 days, at most 24 h without the Sun and 24 h without Earth, both in view at landing; the same on every page and for Scout) are examples, labelled as such, so nothing implies they're real requirements. | Built-in thresholds. |
| **"Too close" in comparisons** | A difference within the error measured against NASA's maps shouldn't pick a winner. Between two sites, the tolerance also includes how differently the model reads at those sites, up to about 21 points in Sun. Gaps within 2 h are too close at hourly resolution; beyond that they have no measured error, which is a known weakness. On the Sightline screen the same tolerance decides the ★ in Compare's three rows that are a share of the mission (sunlit, Earth in view, the two together), in the side panel and in the Planner: between two different sites a lead inside it earns no ★ alone (the sites share it, or none is shown), and a line under the table says so. Two dates at one site keep the half-point tie. The validation files hold results at 0 m and 2 m only, so the 2 m rows are used for every panel and antenna height. A pair that includes a custom point keeps the half-point tie: its own error is worked out only in Classic. | Always naming a winner. A flat 4-point tolerance, which overstated site comparisons. |
| **Shared elevation scale when comparing** | Otherwise the same terrain looks different in each panel. | Per-panel scales. |
| **Static JSON, no server** | Nothing to run or break at demo time. | FastAPI, databases. |
| **Python 3.12** | Inherited from `HANDOFF.md`; no recorded reason for that version and nothing requires it. All 60 tests also pass on 3.15; the full pipeline hasn't been run there. | Upgrading mid-demo, which gains nothing for this project. |
| **No code from other teams' public repos** | The real submission must be our own, built from scratch on Nov 14. | |

## Known limits

- **Sun runs high against PGDA at all four sites** at 2 m, by 3 to 24 points. See
  [`VALIDATION.md`](VALIDATION.md).
- **Landing windows stop at the end of 2030,** so a mission running into 2031 counts as not fitting.
- **Gaps are cut off at month boundaries,** so a gap that spans two months is under-reported.
- **Earth "up" means any part of the disk is visible.** This is PGDA's definition, and PGDA notes it may be
  slightly optimistic for radio-link studies. Antennas are not modeled.
- **Custom points have no check against NASA's maps,** unlike curated sites, and they carry the full model's ridge-top
  gap. The north polar region has only 237 m terrain, against 20 m in the south.
- **Terrain is coarser outside 80–90°S,** at 237 m per pixel, so nearby rocks and small craters aren't captured.
- **`run_all.py` is slow:** the nearby maps take about 11 of its 22 minutes, and the 80-pixel comparison and custom-coordinate accuracy test take most of the rest.
- **Nearby maps cover only the four ridge sites,** the ones with NASA's 60 m maps to check against. Their months have no check: NASA's maps are long-run averages.
- **The shortlist's order has no measured error for gaps,** like the comparison table's. Between ridge sites the model's Sun can differ by up to about 21 points, and the list says so.
- **Slope is at the terrain's scale:** 5 m at ridge sites with an uncertainty of about 2°, 40 m on nearby maps and elsewhere in 80–90°S, and about 474 m beyond. It can't show rocks, or anything a lander's footpads would touch.
- **A ridge site's number describes one point,** near the best within 100 m. The range shows for ridge sites only; other sites have no 5 m terrain.
- **Earth clearance is about terrain only.** Antenna pointing, link budgets and relay satellites aren't modeled.

## Team

Final on 2026-11-12, six people: Rodrigo (captain, `pipeline/`), Misha (`web/`), Pat (CI, deploy, reviews),
Jessica (ideas, story, presentation), Ravi (site comparison and explainer, in `web/` under Misha) and Sebastian
(the server and cloud setup, with Pat).
