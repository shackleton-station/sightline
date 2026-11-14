# Progress — Demo #1

Resume from the first unchecked item. Update after every meaningful step.

> Everything dated before 2026-11-14 below is the record of the team's pre-event practice build, kept as
> it was written. This repository is built on that code; the Bethesda Local Lead approved the reuse. The
> port into this repository is the last section.

- Repo: private at the time (it held the team's pre-event practice code)
- Board: https://github.com/orgs/shackleton-station/projects/1 ("CLPS Demo #1", project #1, linked to repo)

## Phase 0 — Preflight ✅ (2026-10-14)

- [x] git 2.56.0 · gh 2.102.0 · uv 0.12.24 · Python 3.12.13 (uv-managed, already installed) · node v26.11.1 · npm 11.20.0
- [x] `gh auth`: logged in as the captain's account; scopes `admin:org, gist, project, repo, user, workflow`
      (`project` + `admin:org` added by Rodrigo via `gh auth refresh` — see FRICTION_LOG)
- [x] Org `shackleton-station` reachable; Free plan; Rodrigo is admin; base permission `read`
- [x] Disk free: 1.4 TB
- [x] Nothing installed by the agent

## Phase 1 — GitHub setup ✅ (2026-10-14)

- [x] Repo created (private, README + MIT license)
- [x] Top-level files + `docs/` scaffold, `.gitignore`
- [x] `CLAUDE.md` + `docs/HANDOFF.md` copied in
- [x] Branch protection: **refused by API** (403 "Upgrade to GitHub Pro or make this repository public");
      rulesets refused the same way. Not upgraded. → **PR-only convention** (in README).
- [x] Labels: `pipeline web 3d infra pitch friction blocked question`
- [x] Project board "CLPS Demo #1" (#1)
- [x] 19 issues (#1–#19), each with a Definition of Done, all on the board, no assignees
- [ ] Invites: Misha, Pat, Ravi and Jessica are in the org. Team final on 2026-11-12 (Rodrigo, Pat, Misha, Jessica, Ravi, Sebastian); Sebastian invited by email that day, not accepted yet
- [x] Rodrigo restarted Claude Code inside `<repo>/<repo>/`; parent copies renamed to
      `CLAUDE.bootstrap.md` / `HANDOFF.bootstrap.md` (outer `<repo>/` = bootstrap folder, inner = git repo)

## Phase 2 — Skeletons + CI ✅ (2026-10-14)

Branch `feat/skeletons-ci` (closes #16).

- [x] `pipeline/` uv package `clps` (spiceypy 8.3, numpy, rasterio 1.5, pyproj, pandas, httpx; dev: pytest, ruff) + smoke test
- [x] `web/` Vite 8 react-ts (TS 6, strict) + d3, cesium 1.146, vite-plugin-static-copy 4, vitest 5, wrangler 4; `.env.example`
      — Cesium static copy needs `rename: { stripBase: 4 }` with plugin v4 (see FRICTION_LOG)
- [x] `.github/workflows/ci.yml` (pipeline: uv sync/ruff/pytest · web: npm ci/tsc -b/vitest/build, Node 22)
- [x] README how-to-run
- [x] Local: ruff + pytest + tsc -b + vitest + build all pass; `npm run dev` serves the placeholder page
- [x] CI green on PR #20 (after pinning `setup-uv@v10.3.0`)
- [x] PR #20 squash-merged (2026-10-14)

## Phase 3 — Pipeline (one site, one month) ✅ (2026-11-02)

Synced with the repo on 2026-11-02 (this list had gone stale; #21–#25 were merged 2026-10-14).

- [x] 3.2 kernels: `kernels.py` (#21, closes issue #1), files in `cache/kernels/`
- [x] 3.4 horizon math on synthetic terrain: `horizon.py` (#22); issue #3 stays open until run on the real DEM
- [x] 3.5 visibility math + Sun/Earth tracks: `visibility.py` (#23), `ephemeris.py` (#24); issues #4, #5 stay open until wired up
- [x] 3.6 part 1: Horizons client `horizons.py` + recorded fixture (#25)
- [x] 3.1 site: Connecting Ridge, 89.45267°S 137.14865°W, from NASA PGDA product 78 `Site01_ROIs` record 3 (branch `feat/dem-window`)
- [x] 3.3 DEM: `dem.py` (#26), read from the real 2.70 GB file
- [x] 3.4 real horizon mask + range sensitivity (range raised to 200 km)
- [x] 3.6 part 2: `validate.py`, 18.6-year + 80-pixel PGDA comparison, `docs/VALIDATION.md`
- [x] 3.7 `export.py` + TS types + `scripts/run_all.py` (~3 min, 3.3 GB)
- [x] Re-checked against the official challenge statement (see DETAILS); Resources tab still unread

## Phase 4 — Web app ✅ (core 2026-11-02; 3D 2026-11-03)

- [x] app shell + loaders
- [x] panorama
- [x] slider
- [x] timeline
- [x] summary (states the Sun gap at this site, see VALIDATION.md)
- [x] mobile: checked at 390 px and 1280 px in headless Chrome, no overflow or console errors
- [x] 3D (lazy): own WebGL2 renderer instead of Cesium, see DETAILS and VALIDATION §8. On Rodrigo's phone (2026-11-03): looks good, drags smoothly, went blank after a while. Fix for graphics context loss and memory deployed; retest pending

## Phase 5 — Deploy

- [x] Deployed (Workers static assets, not Pages; see DETAILS): a `workers.dev` address, since retired
- [x] Loads in headless Chrome at 390 and 1280 px
- [ ] Loads on Rodrigo's actual phone

## Phase 6 — Friction report

- [x] `docs/LESSONS.md`

## Demo #2 — comparison, in working pieces

- [x] Piece 1: four published sites, all of 2027, site + month picker
- [x] Piece 2: Scenario A vs B, side by side
- [x] Piece 3: explainer for educators and the public
- [x] Piece 4: 13 sites across the Moon (Apollo, CLPS, other countries), global terrain
- [x] Piece 5: mission viability and landing windows
- [x] Piece 6: custom coordinates, up to 70° latitude
- [x] Piece 7: 2D map with live day and night, click to choose sites or custom points
- [x] Piece 8: shareable links
- [x] Piece 9: custom coordinates anywhere, using fine terrain tiles (1.5 GB, deployed but not in Git)
- [x] Piece 10: panel sunlight and a date picker
- [x] Piece 11: 2027 to 2030 (`config.YEARS`), `overview.json`, `earth-sun/`; 2027 tracks unchanged byte for byte
- [x] Piece 12 (2026-11-13): 2026 to 2049 (`config.FIRST_YEAR`, `LAST_YEAR`). One file per year for flags (`overview/<year>.json`) and headline numbers (`<site>/year-<year>.json`), `range.json` for what the data covers; a page loads four years and fetches more when a date needs them. 2027 to 2030 unchanged byte for byte (`docs/VALIDATION.md` §14)
- [x] Piece 13 (2026-11-13): the same hourly files at 4 m, 5 m and 10 m above the ground for the 13 sites (`scripts/make_heights.py`, `config.OTHER_HEIGHTS`), in the bucket under `tiles/light/heights/`, read by no page yet; for choosing the panel's and the antenna's height later (`docs/VALIDATION.md` §15)

## Better against the full statement (2026-11-03)

- [x] 7. More years: 2027 to 2030 (Piece 11 above)
- [x] 1. Answer first: plain verdict, time left, Sun height, 3D or horizon beside it, time bar always on screen
- [x] 2. Grid of every site and month, responding to mission limits
- [x] 3. "Landing date slipped?": before and after, next good date, other sites
- [x] 4. Learn and Plan modes
- [x] 5. 1-minute guided tour, every number from the data
- [x] 6. The Sun on Earth vs at the site
- [x] Deployed 2026-11-03 and rechecked on the live site, in headless Chrome only: tour 58 s, old links open as before, no console errors
- [ ] User test: kit in `docs/USER_TEST.md`; needs Jessica and two non-engineers
- [ ] Phone retest of the 3D view (still pending from Phase 4)

## Second audit against the statement (2026-11-03)

Rodrigo cleared the demo to keep building here. Decisions and reasons are in DETAILS; measurements in VALIDATION §10.

- [x] Data: nearby maps, slope, Earth clearance, mast heights; existing data unchanged byte for byte (PR #48)
- [x] Earth clearance limit, and terrain clearance shown in Plan
- [x] "Below eye level but still sunlit" explained in Learn
- [x] Slope at each site
- [x] What a taller mast would change
- [x] Map of the ground around each ridge site, with better places to look
- [x] Shortlist ranked against the limits, kept in the link
- [x] Deployed 2026-11-03 and rechecked on the live site, in headless Chrome only: map, shortlist, clearance, mast table, slip link, shared links, old links and the tour (about 52 s), no console errors or sideways overflow

## Audit of the app and its accuracy (2026-11-03)

Measurements are in VALIDATION §11.

- [x] 17 bugs fixed and deployed (PR #51)
- [x] Ranges within 100 m at ridge sites, NASA's 100 clones, 5 m slope, LROC map comparison
- [x] Dated LROC photos: `scripts/check_lroc_photos.py`; ground-level calls beat the out-of-step Sun at all four sites; the 2 m value can't be tested this way
- [x] Deployed 2026-11-03 (PR #51 to #53) and rechecked live, in headless Chrome only: photo notes at all four ridge sites, phone and desktop widths, no console errors or sideways overflow

## Globe from Misha's NASA Globe (2026-11-11)

- [x] `pipeline/scripts/export_features.py`: IAU place names and past landings into `web/public/data/features.json` (also run by `run_all.py`)
- [x] Globe of the whole Moon in the map section (Globe | Flat), lit by the selected hour's Sun; drag or arrow keys to turn; click a dot or any point
- [x] Labels skip any that would overlap or spill off the globe; checked at 375 px and 1280 px in the preview
- [ ] Misha to review; add other past landings from a published table (OPEN_QUESTIONS #11)

## Ideas from other teams' public sites (2026-11-11)

- [x] Power and battery estimate in Plan mode: average panel power for the user's panel, battery for the month's longest night at the user's load
- [x] Download the month's hourly Sun and Earth data as CSV
- [ ] Not built: a blended weighted score (OPEN_QUESTIONS #10 chose ranking with reasons instead); NASA's 9 Artemis III regions (no published center points; OPEN_QUESTIONS #9)

## Landing page and demo video (2026-11-11)

- [x] Globe-first landing page: NASA's color map over our LOLA relief, lit by our ephemeris as a time-lapse; zoom or click into a site to open its views; "Whole Moon" returns to it
- [x] Globe zoom (wheel, pinch, +/-) in the landing page and the map section
- [x] Demo video tab: 76 s, 1080p, Chirp 3 HD narration, English captions; served from R2 with range requests
- [x] Typed-question box on Gemini 3.5 Flash (was Flash-Lite)

## Move to Google Cloud, AI co-pilot, Mission control (plan approved 2026-11-11)

Goals: win at Bethesda, and a project worth showing on LinkedIn. Order: A (Google Cloud) → C1 (view store) →
B (co-pilot) → C2–C6 (Mission control).

- [x] A1: Node server (`web/server/`, Hono) replacing the Worker: pages with cache rules, tiles and video from Cloud Storage, ask API through Vertex AI with no stored keys; Dockerfile; 23 server tests; `scripts/smoke.mjs`
- [x] A2: Terraform in `infra/` (bucket, service accounts, Cloud Run, keyless GitHub sign-in, budget, uptime check); tiles and video uploaded; live at https://clps-web-kotzabbk6a-uk.a.run.app (2026-11-11), smoke test passing
- [x] A2b: team domain `shackletonstation.dev` bought (Cloud Domains); DNS zone, load balancer with CDN and managed certificate in `infra/domain.tf`. The certificate went active the same evening
- [x] A3: keyless deploys from GitHub Actions after CI passes on main (first run succeeded 2026-11-11, commit d3c86e8); rate limits count the visitor behind the load balancer (checked live: the 11th request in a minute is refused through the domain and straight to Cloud Run alike, and a typed address buys nothing); local dev forwards to the live site
- [x] A4: cutover: https://shackletonstation.dev is the site (certificate active 2026-11-11); the old workers.dev address redirects with the view kept (`web/redirect/`); Worker code, wrangler and API keys removed; docs and CLAUDE.md §2/§9 updated. **Left for Rodrigo to decide:** deleting the old R2 bucket for tiles, the old Worker's two secrets, the Vertex API key and the `gemini-worker` service account
- [x] C1: one view store (`web/src/state/`): reducer, provider, URL sync, 19 tests; links always write `mode=`
- [x] B1: co-pilot server (`web/server/chat/`, `POST /api/chat`): Gemini calls ten read-only tools built on the app's own functions (`web/src/lib/*`) over the pipeline's JSON; every number in an answer is a reference the server fills in, and a reply with a typed digit is sent back once, then replaced by the facts; buttons are rebuilt server-side as ordinary app links; 6 messages a minute and 60 a day per visitor, 1,500 a day overall; 20 tests on the real data; `scripts/chat-eval.mjs` asks 12 set questions against a running site
- [ ] B2: chat drawer replacing the ask box
- [ ] Polish list in `docs/POLISH.md` (share preview done; the rest is picked up phase by phase)
- [x] Audit of the live site and the redesign direction: `docs/DESIGN.md` (what was measured, the layout, the signature moment, where each existing piece goes, patterns taken from BikeSim and Mathlib Map)
- [x] C3 (first part): Mission control shell behind `?ui=next` (`web/src/shell/`): full-window 3D or horizon stage, the answer as one line on the picture, the time river (the month's Sun and Earth bands as the slider, landing windows and the mission's span in Plan), and a mission panel with Now, When to land and Learn that reuses the existing sections. Checked at 1440×900 and 375×812, no console errors
- [x] Scout, first slice (`web/src/scout/`, page `/scout/`): a from-scratch guided version after Rodrigo's feedback that the shell was still a dashboard. A mascot guide with a speech-bubble chat (the co-pilot), one question at a time, the Moon then the ground as the canvas, the time river, its own look. Checked at 1440×900 and 375×812 against the live co-pilot. Plan in `docs/DESIGN.md`
- [x] Scout: the site view is the Moon itself zoomed in (one globe throughout, lit by the time river; zoom out to leave), with the 3D ground as a switch; a smaller chat bubble that folds away when Scout is tapped
- [x] Scout: one camera (whole Moon and site close-up are two zooms of it, the site centred, flights ease in and out, a drag glides); the globe is lit by real LOLA slopes (`pipeline/scripts/make_slope_maps.py` writes four slope maps; `web/src/three/GlobeViewer.ts` tilts each pixel's surface by them), and within 9° of the south pole a polar map replaces the smeared color map. Slope shading only: it does not cast one hill's shadow on another, and no number on the page comes from it
- [ ] Scout, next: landing limits and "date slipped" as things Scout offers, finish card, share card, smoother globe-to-ground hand-over; then make it the front door
- [ ] B2: co-pilot drawer in the shell (parked on branch `feat/copilot-drawer`; Scout's bubble replaces it)
- [x] How it works page (`web/src/shell/HowItWorks.tsx`, address `#how`), linked from the landing page and the shell's top bar: data to answer, the checks with this site's live numbers, three flow diagrams of the stack (opening the site, shipping a change, rebuilding the data) with the technologies by layer, and how the co-pilot is kept from typing numbers. Flows turn vertical on phones
- [x] One tab bar on every page (`web/src/components/SiteTabs.tsx`, list in `web/src/lib/siteTabs.ts`): Whole Moon, the three designs of the site page (Classic, Mission control, Scout), 1-minute tour, Demo video, How it works. Every tab is a link with its own address (`#tour` and `#demo` are new), and the three designs open on the same site, month and hour so they can be compared. **Rodrigo's decision (2026-11-11): keep every design, duplicates included, as tabs; this demo is for comparing and learning. The single design is for the hackathon app.** This replaces the old plan to switch to one design and delete the rest
- [x] Redis (Memorystore) for shared state (`web/server/store.ts`, `redisStore.ts`): a sliding-window rate limit as one atomic Lua script, shared by every copy of the server, and a cache for first co-pilot questions (same words, same view, same deploy), with a fallback to memory when Redis is down. Terraform in `infra/data.tf`
- [x] Share a mission plan by link, on Firestore (`web/server/plans/`, `SharePlan`, `PlanPage`, address `#plan=<id>`): the view on screen saved with a name and a note; the server rewrites the view, computes a brief with the co-pilot's tools, and Firestore deletes it after six months. Checked locally against the real database
- [x] Edge firewall (Cloud Armor, `infra/edge.tf`): limits by address at Google's edge, and a scripting-attack rule in watch-only mode. Applied 2026-11-11
- [x] Streaming: the co-pilot sends each lookup as it happens (server-sent events), then the answer; Scout shows "Looking at …" while waiting
- [x] Load test (`web/scripts/load.mjs`, no dependencies, free endpoints only) and `docs/SYSTEM_DESIGN.md`: every system-design topic the project shows, where it lives, its trade-off, and what is not built
- [x] Question log (`web/server/events.ts`, `infra/events.tf`): each co-pilot question goes to Pub/Sub and lands in the BigQuery table `site_events.copilot_questions` (partitioned by day, kept 90 days, nothing about who asked); Scout says so under its question box
- [x] Tracing and objectives (`web/server/trace.ts`, `infra/slo.tf`): every API request is one trace in Cloud Trace with its steps timed; two service-level objectives (99.5% succeed, 90% within 2 s, over 28 days) and an alert on how fast the failure allowance burns. Objectives and alert applied 2026-11-11; **the access grants (publish, write traces, Pub/Sub into BigQuery) wait for Rodrigo's `terraform apply`**
- [x] Canary deploys with automatic rollback (`.github/workflows/deploy.yml`, `web/scripts/canary.mjs`): the new version is tested with no visitors, then takes a tenth of them for a minute, then all; a failed step sends everyone back to the version that was live
- [x] Globe and 3D terrain view on Three.js (`web/src/three/`, Biome keeps it there): globe no longer rebuilt every frame; terrain lit by the pipeline's Sun with cascaded shadows, and Sun and Earth models in the sky. Old shader's dark-beyond-8 km bug found and noted in VALIDATION §8. Re-measure §8 on the new view (OPEN_QUESTIONS #13)
- [x] §8 measured again on the Three.js view (2026-11-12, `web/scripts/shadow-check.mjs`): 98.6% of 13,167 points and 93.9% in the hours with both light and shadow, below the old view's 97.2%; it misses shadows from terrain under about 3 km away. Whether to sharpen them is open (OPEN_QUESTIONS #13)
- [x] Sign-in with Google for plans (`web/server/identity.ts`, `web/src/lib/account.ts`, `AccountBox`): optional; a plan saved while signed in can be listed and deleted by its owner; the server verifies the token's signature, audience and expiry with no library and stores only a fingerprint. **Off until Rodrigo creates an OAuth client id** (steps in `infra/README.md`); not yet tried against real Google sign-in
- [ ] More designs as further tabs: add a line to `siteTabs.ts` and render `<SiteTabs current="…" />` at the top of the new page
- [x] Planner tab (`web/src/planner/`, page `/planner/`, 2026-11-12): the decision first, with no 3D and no globe. The mission's limits are the main control; one table shows every site against every month (the days with a landing that survives the mission) and redraws as a limit changes; choosing a square writes a one-page brief (verdict, landing days and windows, best landing, the slip check with the next landing and the nearest other sites); a short list compares options side by side by the shortlist rule; the address is the app's own view link, and the brief prints on one page. Reuses `grid.ts`, `mission.ts`, `slip.ts` and `shortlist.ts`; 42 new unit tests. Checked in headless Chrome at 1440×900 and 375×812, with the keyboard, and in print; `smoke.mjs` passes against a locally built and served copy. Screenshots in `docs/img/planner/`, write-up in `docs/DESIGN.md`. **Not yet seen by Rodrigo; branch `feat/planner-tab`, no PR**
- [x] Atlas tab (`web/src/atlas/`, page `/atlas/`, 2026-11-12): the light on the polar ground is computed, not shaded. `pipeline/scripts/make_light_grid.py` runs the site pipeline's horizon calculation at each of 1,048,576 pixels (120 m, 61 km each way from the south pole; numba; 31 min on the laptop, no cloud cost) and stores each month as the hours at which each pixel's Sun and Earth change (48 files of about 3.4 MB in the assets bucket: `npm run upload-light`). One camera goes from the whole Moon to about 30 m a pixel on the same globe (`GlobeViewer` with `three/lightLayer.ts`); the time river scrubs it by changing one number; three colorings (sunlight, Sun and Earth, the month's Sun); any ground in the square can be tapped for its own month, with the range across the pixels around it, and opened as an exact point in Classic. Scout, its bubble, voice and the co-pilot are reused. Checked in `VALIDATION.md` §12: no hour differs from the site tracks at the sites' own points; within 1.2 points of NASA's map on average over a million pixels (r 0.99, against 0.67 and 0.11 for two wrong skies); the picture matches the file at all but 249 of 1.9 million pixels; a frame costs about 6 ms. Checked in headless Chrome at 1440×900 and 390×844 against the live co-pilot. Live since 2026-11-12 (PR #105): the deploy's smoke test opens the page and a month file
- [x] Atlas, a wider grid (2026-11-12): a second grid of 1,024 × 1,024 pixels of 300 m carries the computed light out to 85° S (`make_light_grid.py --wide`; 48 files of about 4.5 MB under `tiles/light/wide/` in the bucket, uploaded by the same `npm run upload-light`). Rays that leave the 20 m polar terrain read the whole-Moon map, as a site's horizon does. The picture uses the 120 m grid where it reaches and the 300 m one around it; a tap, the range around it, and the co-pilot's `spot_light` read whichever grid holds the spot and say its pixel size. Checked in `VALIDATION.md` §12: at IM-2 Athena's own point no hour of four years differs from its track; the pixel holding it, 202 m away, differs in 6.7% of Sun hours and 15.4% of Earth hours; within 1.3 points of NASA's map on average over a million pixels (r 0.99, against 0.21 and −0.30 for two wrong skies); on well-lit ground a bare sphere scores better, so nothing confirms it there. A frame still costs about 6 ms. About 45 minutes of laptop time, no cloud compute
- [x] Atlas on a phone (2026-11-12): checked in Safari in the iPhone simulator (iPhone 18 Pro, 402 × 874 points), where the first version had Scout's bubble over the lower half of the map, an idea button cut off, and the scale bar on top of the note under the question box. Now: Scout's own line has no name tag and an icon for the sound switch; the ideas are one row that scrolls sideways; the scale and the way up sit under the key at the top; the note about kept questions shows once the question box or the bubble is in use; the view's middle is between the controls and Scout; while a tapped spot is described, its "Ask Scout about this spot" button stands in for the question box, so the bubble never covers the ground just tapped; the map's key shows in all three colorings. A person has still not held it: the simulator and headless Chrome only. On a short phone (iPhone SE size, about 550 points of page) Scout's own line is hidden until a spot is tapped, and a tapped spot's bubble then covers the middle of the map
- [x] Atlas and Briefing on the site's one camera (2026-11-12): `useAtlasCamera` is gone; `useMoonCamera` takes `maxZoomAt(center)`, the closest zoom for the ground in the middle of the view. Three things changed for every page with it. The usual way up (`screenUp` in `lib/polarCamera.ts`) mixed north and the polar map's way up as an angle, which left a seam along 180° longitude where a drag or a release turned the picture abruptly; mixed as arrows, the seam is one point (77° S, 180°). The turn to north-up now happens between 72° and 82° latitude, not 80° and 87°: the wider grid's square reaches 82.9° S, and in the iPhone simulator a drag that pushed the square off the top was followed by the map turning upside-down. And the picture rights itself at 150° a second at most. Measured in headless Chrome at 1440 × 900 with a mouse (a drag across the pole, on to 85° S at 180°, and across that meridian both ways): a site marker strays from the pointer's step by 0.1 px at most; on the camera it replaces, by 64 to 1,237 px in a step. After each release nothing moves more than 4 px in a frame. Flights from the whole Moon to a ridge end on the site, the usual way up. Tried with real touches in Safari in the iPhone simulator: the same drags, and the flight back. A frame still costs about 5 ms. Emulated touch in headless Chrome did not reach the page, so the phone numbers are the simulator's pictures, not measurements
- [ ] Atlas, cut or not done: the computed ground stops at 85° S (outside it the map is dimmed slope shading); one point per pixel, not an average; no tilted or perspective view (it is a map, seen from above); no microphone on this page; not held on a real phone (the iPhone simulator only) or tried on a slower laptop; landing limits and the slip check are not on this page
- [x] Briefing tab (`web/src/briefing/`, page `/briefing/`, 2026-11-12): the two-minute story of one month at the south pole, on the Atlas's picture, ending on a landing to plan on. Seven chapters (the question, the pole, the month played through, Sun and Earth now, the sites, how sure, the recommendation); every caption's numbers are counted by `briefing/script.ts` from the tracks, the hourly flags, the light grid and its validation file when Play is pressed; the landing is the Planner's best per ridge, ordered across ridges by the shortlist's rule. Scout says each caption (`/api/speak`, browser voice as the fallback), with the next one's sound fetched ahead (`Speaker.prepare` in `web/src/lib/voice.ts`). The server keeps a spoken text for a day (`web/server/voice/speak.ts`), so repeats don't use the day's 200 texts. Measured in headless Chrome with the voice: 2 min 8 s end to end, the voice starting within 0.3 s of each chapter after the first. Checked at 1440×900 and 390×844
- [x] Briefing on a phone (2026-11-13): stepped through all seven chapters in Safari in the iPhone simulator (iPhone 18 Pro, 402 × 874 points) on the live site, then on the fix. Before: the "% of the month's hours" key ran off the right edge; the Sun-and-Earth key was hidden (the shell hides the river's key on phones), so chapters 4 and 7 had colors and no key; Scout's caption covered the bottom of the square and the south-pole sites; the chapter on the four ridges zoomed on one of them, and on a phone only two were on screen; the end's three links stacked and the last was cut off. Now: the keys wrap on phones, with each swatch kept beside its words (`key-pair`, also on the other pages' keys); the play, chapter and sound buttons show only their signs on a phone, so the chapter bars share their row and the caption sits lower, clear of the square in chapters 1 to 4; the sites chapter stays on the south-pole view, where all four ridges are; a flight to a site gives a phone the same ground across its width as a wide screen (the Atlas too); the end's links are one row that scrolls sideways. Desktop keeps the words on the buttons. Not held on a real phone; on a phone a long caption (chapters 6 and 7) still covers the lower part of the view
- [ ] Briefing, cut or not done: it briefs the ridges the light grid holds, for the site, month and mission in the link (no pickers on the page); the co-pilot does not write or check the captions; not listened to by a person (the sound was confirmed as played, not judged); no captions file or transcript download; not tried on a real phone
- [x] The co-pilot answers about a tapped spot (2026-11-12): an eleventh read-only tool, `spot_light` (`web/server/chat/spotTools.ts`), reads the Atlas's light grid for the ground the visitor tapped. The place travels with the request (`spot` beside `view`), never through the model; the server reads the month file from the bucket as a stream and keeps only that pixel and the eight around it (`web/server/chat/light.ts`), because a month is 42 MB unpacked and the server has 512 MB. The answer says it is one 120 m pixel and gives the range nearby. Tried against the real model and bucket from a local server: two questions answered in 5.7 s and 4.6 s, and every number matched the month file read independently in Python. The Atlas has an "Ask Scout about this spot" chip; `chat-eval.mjs` has a tapped-spot question (in the full run, not the deploy's five). Live after the Briefing's deploy: the second play of the briefing came wholly from the speech cache (7 of 7) Checked on the live site after its deploy: all 13 questions of `chat-eval.mjs` pass, the tapped-spot one in 10.5 s with the same numbers
- [x] A tab left open across a deploy recovers (2026-11-12): the 3D view and the globe are fetched only when needed, from files named for their build, so an old page asked the new version for a name it doesn't have and showed "The 3D view could not be downloaded" (seen live that night). `loadPart` in `web/src/data/staleBuild.ts` now wraps every such load (`Moon3DSection`, `GlobeCanvas`, `AtlasCanvas`): if it fails and a newer build is live, the page reloads into it once, on the same view; otherwise the old message shows. The back-forward-cache check now runs on every page, not only the first. Reproduced with two real builds and a small server standing in for a site mid-deploy: old page, 404 for the old file, reload, new page, globe drawn. During the minute a tenth of requests go to a new version, a page can still meet the other version's files; it reloads once and may land on either, and a second miss shows the message
- [x] How it works has a part on the every-pixel map (2026-11-12): how it is made (the same calculation, at every pixel, kept as changes, drawn by the graphics card) and its checks, with the numbers read from `data/light/meta.json` and `validation.json` (`web/src/data/lightChecks.ts`), and links to the Atlas and the Briefing. `docs/INTERVIEW_GUIDE.md` has a section on it (§3.20): what it is, how it works, the checks, the questions to expect with honest answers, and what not to claim
- [x] 3D sky (Mission control and Classic share it): Earth with the NASA Blue Marble texture at true size and real phase, a limb-darkened Sun with corona, elevation and azimuth written above each. Checked in headless Chrome at 1280×800
- [x] Interview guide for teammates (`docs/INTERVIEW_GUIDE.md`, 2026-11-12): how to describe the project honestly, the 30-second and 2-minute answers, one section per built system-design topic (what it is, how ours works with the file to open, the trade-off, follow-up questions with honest answers, what not to claim), what is not built, and LinkedIn text. Checked against the code; no code changed
- [x] Scout's voice (2026-11-12; `web/server/voice/`, `web/src/lib/voice.ts`, `listen.ts`, `speech.ts`, `web/src/scout/useVoice.ts`): ask out loud with the browser's own speech recognition (a microphone beside the question box, the words appear as they are recognized, Cancel), and hear the answer in a Cloud Text-to-Speech voice (`en-US-Chirp3-HD-Leda`) through `POST /api/speak`, with the co-pilot's guards, 900 characters a text and 200 texts a day overall ($5.40 a day at most). The browser's own voice takes over when the server's can't be had. Sound is off until turned on, remembered, never plays on page load, and stops when the answer is put away; the mascot's mouth moves while it plays. Checked in headless Chrome at 1440×900 and 375×812 against the real speech API. **Not done: nobody has listened to it, no real microphone was tried, and the server's own identity hasn't called the API (it starts with the `terraform apply` that sets `VOICE=on`; no access grant is needed)** (OPEN_QUESTIONS #14)
- [x] Surface tab (`web/src/surface/`, page `/surface/`, 2026-11-12): the view from the lander's eye, built from the pipeline's own horizon and positions with no terrain mesh. The land is a dark shape whose top edge is the site's `horizon.json`; the Sun and Earth are disks at the track's azimuth and elevation for the hour on the time river, at the size their distance gives them that hour (from the pipeline's ephemeris files, as `visibility.py` works it out), hidden by the land in front. It opens zoomed in at true scale (a view 12° tall); "Stretch heights ×5" is separate, said on the picture for as long as it is on, and one tap from true scale. Drag, pinch, wheel and arrow keys look around; on a phone "Look around by moving your phone" asks for the motion sensor; a compass strip carries the Sun and Earth; "Face the Sun" and "Face Earth" turn to each and keep it in the middle as time plays. The answer is the other designs' words. The address is the app's view link plus `look=` (and `tall=` when stretched), which the other tabs ignore; a new address from outside moves the view with no reload. New: `lib/surfaceView.ts` (the geometry, tested without a graphics card), `lib/motion.ts`, `three/SurfaceViewer.ts`, `three/skyShading.ts` (the Sun's and Earth's colors, now shared with the 3D terrain view), `web/scripts/surface-shots.mjs` (screenshots, 13 behaviour checks, frame times). Checked in `VALIDATION.md` §13: over all 13 sites and 48 months the share of the Sun's disk the view shows is within 0.054 of the track's in every hour (0.0002 on average), and "any part showing" differs in 110 Sun hours and 95 Earth hours of 455,832 each, every one within the data's rounding or a sliver beside the disk's middle. Looked at in headless Chrome at 1440×900, 1024×768, 375×812 and 844×390, and in Safari in the iPhone simulator; `smoke.mjs` passes its Surface checks against a locally built and served copy. 30 new unit tests, and one more that reports on the whole data set when asked. Screenshots in `docs/img/surface/`, write-up in `docs/DESIGN.md`. **Not yet seen by Rodrigo; branch `feat/surface-tab`, no PR**
- [ ] Surface, cut or not done: not held on a real phone, so the motion sensor has only been exercised with readings played by hand, with its ways of failing (refused, silent, absent), and in the iPhone simulator as far as the permission question and a refusal; no headset (WebXR) view, because there was nothing here to check one with; no ground beyond the skyline (no shadows or slopes); custom coordinates open the first listed site with a note; landing limits are carried in the link but not shown; the land's lighter rim under its top edge and the Sun's glare are ways of drawing, not computed light; frame times were measured on one Mac (and with its processor slowed four times), not on a phone
- [x] Follow the presenter (2026-11-12; `web/server/rooms/`, `web/src/lib/follow.ts`, `followClient.ts`, `web/src/components/Follow.tsx`): "Present" at the end of the tab bar starts a room and shows a large QR code, the link (`/?follow=<room>`), how many are following, and Stop presenting; a phone that opens the link follows the presenter's tab, site, month, hour and limits, with a slim line under the tabs and Stop following. Only the address is shared (a path that must be one of the site's pages, a bounded query and hash). The server fans changes out over server-sent events, through Redis publish/subscribe when there is more than one copy, and counts followers per copy with an expiry; only the newest address is kept at every step; streams end at 55 s, under Cloud Run's limit. Limits: 60 followers a room, 60 streams a copy, 50 rooms, a room ends 10 minutes after its presenter's last publish and 3 hours after it starts; `follow = false` in Terraform (FOLLOW=off) switches it off. Every page now moves when its address is changed from outside: the main app learned that a bare address is the front page (and the front page's own address is now the bare one), the Briefing starts again for a new address, and the Atlas keeps its coloring in the address. Pages say when they rewrite their address (`web/src/lib/address.ts`), so a presenter's change is published at once. 27 new tests (wrong key, joining late, two copies on a stand-in Redis, a missed message repaired, coalescing, caps, what may be published, expiry, the count going down). Checked with `web/scripts/follow-check.mjs` in headless Chrome against a local server: 96 checks across all seven designs; a follower shows a change 13 ms later at the median, with everything on one machine, and 1.3 s at worst, on the Surface, which rewrites its address only once its view settles (`docs/SYSTEM_DESIGN.md`, "Measured"). **Not done: two copies of the server on a real Redis have not run (tests with a stand-in only), no real phone has followed, and it has not been tried on the live site** (OPEN_QUESTIONS #15). How to use it in the pitch: `docs/DEPLOY.md`. Screenshots: `docs/img/follow/`
- [ ] Follow the presenter, not followed because it is not in a page's address: the co-pilot's conversation and anything typed; which way a 3D view or the globe is turned or zoomed (the Surface is the exception: the way it faces is in its address, so a presenter's turn turns the followers); the Atlas's tapped spot; Scout's "Ground, close up"; which side of Mission control's panel is open; the Planner's "if the landing slips by" choice; where the Briefing, the 1-minute tour and the videos have got to (each follower's own starts from its beginning); open dialogs; how far a page is scrolled
- [ ] Still open in the designs: compare and the tour inside Mission control, a finish card, the arriving animation, a bottom-sheet handle on phones
- [x] An easter egg (2026-11-12, Rodrigo's request): a hidden tab at `/hype/` with a 28-second hype video he supplied (AI-generated, marked "AI" in its corner and said so on the page). It has a "✦ Hype" tab in the tab bar on every page (it was hidden behind a typed word for a few hours; Rodrigo asked for it in plain sight). Opening it starts the video with sound where the browser allows; elsewhere it starts silent and the first tap turns the sound on. The video is in the assets bucket (`media/hype.mp4`, 11 MB, re-encoded from his 37 MB file) and the page is marked `noindex`. Nothing on it is data Since 2026-11-14 (his request of the 13th) it is linked from nowhere again: the tab is gone, and typing "hype" on any page, outside a text box, opens it (`web/src/lib/hypeEgg.ts`). On 2026-11-14 (his words: "it should go to its own tab on the new design on the right sidebar named hype. and it should be clean") the word no longer opens that page: on Sightline it puts a "Hype" button in the rail and opens a panel with the video and one line (`web/src/sightline/HypeDrawer.tsx`), kept for the visit; on the other pages it opens Sightline with that panel open (`/#hype`). The old address still answers.
- [x] One camera with no pole problem for the Whole Moon page, Classic and Scout (2026-11-12, `web/src/lib/trackball.ts`, `web/src/components/useMoonCamera.ts`): the old camera always kept north up, so near a pole a small drag swung the whole picture round (Rodrigo: "when I go to the south pole it starts glitching out and moving sporadically"). The new one holds its own orientation: the ground under the pointer stays under the pointer anywhere on the Moon, a release glides to a stop (capped at a quarter of the box), zoom goes toward the pointer, flights follow the great circle, and the picture eases back the usual way up afterwards. Measured in the browser beside the south pole: every marker moves together along the drag, with no spin. The Atlas and Briefing moved onto it the same day (below). On a phone, Scout's site now sits higher so its name clears the bubble
- [x] WebGPU or WebGL2 for the globe, measured (2026-11-12): a comparison page at `/gpu/` (on no tab) draws the whole-Moon globe by WebGL2 (`GlobeViewer`) and by WebGPU (`web/src/three/GlobeViewerGpu.ts`, the shader rewritten in Three's node language) on one scripted camera and Sun, with the time each takes; `web/scripts/gpu-compare.mjs` records it in headless Chrome. Result: WebGPU is not smoother here and costs more to ship, so the site stays on WebGL2 (`docs/SYSTEM_DESIGN.md`, "Measured"). Not ported: the Atlas's light grid. Measured on one Mac in Chrome only

## Architecture plan: one server into four services (plan approved 2026-11-12)

The plan itself is kept outside the repo. What is decided is in `docs/decisions/`, and the numbers before and
after each phase are in `docs/ARCHITECTURE_BASELINE.md`. One phase or step, one pull request.

- [x] Phase 0, the "before" picture (2026-11-12, no code or cloud change): `docs/ARCHITECTURE_BASELINE.md` has the live site's numbers with the commands to repeat them (from one laptop: a page 38 to 42 ms median, a terrain tile 27 ms from the CDN and 135 ms through the server, opening a saved plan 178 ms, a cached co-pilot answer 201 ms; an uncached answer 4.7 s median on the server's own clock; CDN hits 21.5% of all requests and 82.7% of what the server lets it keep; a copy starts in 2 to 3 s; the container's settings), what each future service reads and calls, the permissions each identity will need against the five the one identity has today, and 16 places where the code will not split cleanly. `docs/decisions/0001-four-services.md` is the first decision record. Not measured: a real cold start (one copy is kept warm), the real cost per day (no billing data could be read; a list-price estimate is given), and a median for uncached questions through the public address (two samples). One test plan, `3a4tqevu`, was saved on the live site for timing
- [x] `CLAUDE.md` §2 and §9 updated for the plan (who runs `terraform apply`; four services and the `stats` database). The wording is written and waits for Rodrigo's own OK (OPEN_QUESTIONS #16) Done: §2 describes the four services and the `stats` database, §9 Terraform through GitHub and the Mac path (pull requests 135, 140, 147 and 151), as Rodrigo allowed on 2026-11-12
- [x] Phase 1, `events-worker` (built, applied, deployed and checked on 2026-11-12; the five checks and what they showed are in `docs/ARCHITECTURE_PHASE_1.md`, section 6): a second, private Cloud Run service (`web/events-worker/`) that receives each co-pilot question event by Pub/Sub push and keeps the day's counts (questions, from the cache, from the facts, model busy, failed; never a question's words) in a Firestore database of its own, `stats`. An event is counted once however often it arrives: one atomic write creates a record of the event's id only if it is new and adds to the counter. The counter is split across 8 documents and added up on read. The co-pilot now writes each event to an outbox in Redis before it answers and publishes from there, so an event that fails to publish is sent later and not lost; each event has its own id and carries the request's trace in a message attribute. The How it works page shows today's counts through a new read-only endpoint, `GET /api/stats`. Shared code moved to `web/shared/` (tracing, the event's contract, HTTP replies, the Google token source and signature check). Its own deploy workflow tests a new version with no messages (including a self-check of the real write path) before giving it every message. `npm run dev:server` now starts the worker too, and `docker compose up --build` runs the real images. Checked: 684 web tests pass (630 before this phase), and 3 more against Google's Firestore emulator, which CI does not have; both images were built and run together in Compose, where two events left in the outbox with the worker stopped were delivered and counted once each after it came back; `terraform plan`, read-only against the live project, shows 16 to add, 2 to change, 0 to destroy. Decision: `docs/decisions/0002-events-worker.md`
  - [x] Apply A (`-var events_worker_push=false`), merge and first deploy, Apply B, then the five checks (done 2026-11-12, all five pass: `docs/ARCHITECTURE_PHASE_1.md`, section 6). Still not seen live: an event sent late by the outbox's timer, and the 10-minute "message waiting" alert firing
  - [ ] After a week of traffic: choose the worker's timeout and concurrency from its own numbers, and write the outbox's measured cost (the `outbox` step in each co-pilot trace) into the decision record
- [x] Phase 2, `plans` (built, applied in three steps, deployed and checked on 2026-11-12; what the checks showed is in `docs/ARCHITECTURE_PHASE_2.md`, section 9. Left: the check with a real Google sign-in. The unused plans wiring left the web server in the contract pull request, `arch/contract-web`): a third Cloud Run service (`web/plans/`) that answers `/api/plans` with the existing handler and the sign-in check, built with no bucket, with its own image, identity, deploy workflow, objectives and alert, and a status address at `/api/plans/status`. The code it shares with the site moved to `web/shared/` (the read-only data tools, rate limits and the Redis store, the sign-in check, ids, the request tracer); the web server still answers the path with the same handler, so the load balancer can send it to either. Saving a plan takes an idempotency key: the plan and the key's record are one atomic Firestore write, a retry gets the first answer, a different plan under the same key is refused with 422, two at once save one plan, and a key is forgotten after 24 hours; the page sends a key per attempt and reuses it on retry. A written contract (`web/plans/API.md`) with a test that checks both programs against it. Terraform staged in three switches: `plans_service` (expand), `plans_route` (move), `web_plans_access` (contract). 776 web tests pass (684 before); the store ran against Google's Firestore emulator (12 saves at once with one key made one plan), the real image by itself and in Compose beside the other two; `terraform plan` read-only showed 13 to add for the expand step and no change to the URL map or the site's grants. Why and what it cost: `docs/decisions/0003-plans-service.md`
  - [x] Apply A (`plans_service = true`), merge and first deploy, check the real image is live, Apply B (`plans_route = "plans"`), then checks (a) to (g) (done 2026-11-12: `docs/ARCHITECTURE_PHASE_2.md`, section 9). Left for a person: check (b), with a real Google sign-in
  - [x] A second pull request, once the route has carried visitors: Apply C (`web_plans_access = false`, applied 2026-11-12, pull request 127 set the defaults), and removing the plans wiring from the web server (done with Phase 3's contract step on `arch/contract-web`, 2026-11-12; `docs/ARCHITECTURE_PHASE_2.md`, section 7)
  - [ ] After a week of traffic: confirm the service's timeout (30 s), concurrency (80) and memory from its own metrics, and time a start from nothing
- [x] Phase 5, Firestore keys and indexes for "my plans" (built, applied, deployed and checked on 2026-11-12; what the checks showed is in `docs/ARCHITECTURE_PHASE_5.md`, section 9. Left: paging through the public address while signed in): plan ids confirmed random and now pinned by a test (sequential ids would put every new plan on one key range); one composite index, `plans(owner asc, created desc, __name__ desc)`, declared in `infra/data.tf`; `GET /api/plans?limit=<n>&after=<next>` returns one page, newest first, with an opaque `next` marker (the last plan's time and id, never the owner) when more follow, `400 bad-limit` and `400 bad-cursor` for bad parameters; default page 50 (what the list returned before), at most 100. Additive: a request without the parameters gets the old reply. Until the index is ready, Firestore's `FAILED_PRECONDITION` (captured on the live database) makes the store list the old way for a minute, with a warning. The share dialog loads 20 at a time with "Show more". 814 web tests pass (776 before), and 7 against Google's Firestore emulator, which does not enforce composite indexes; `terraform plan` read-only shows 1 to add (the index) and nothing else. The DynamoDB design is written on paper in `docs/SYSTEM_DESIGN.md`. Why: `docs/decisions/0005-plans-index-and-paging.md`
  - [x] Apply the index, check it is `READY` and that Query Explain names it, merge, then checks (c) to (f) (done 2026-11-12: `docs/ARCHITECTURE_PHASE_5.md`, section 9). Left for a person: check (d), paging while signed in
  - [ ] Build the same plans table in `aws-platform-terraform` (outside this repo)
- [x] Phase 3, `copilot` (built, deployed, Apply A and Apply B applied and checked on 2026-11-12: `docs/ARCHITECTURE_PHASE_3.md`, section 10; the contract step merged as pull request 135 and applied)
  - [x] The contract step's code (2026-11-12, branch `arch/contract-web`, shared with Phase 2's): the web server no longer contains or can run the co-pilot or the plans API and answers 404 for their paths on its own address (on one machine it still passes them on); a build test fails if its bundle ever holds a file from `web/copilot/` or `web/plans/`; its server bundle went from 179,410 to 53,374 bytes (the image barely changes: 579.6 MB to 579.4 MB, because the image is mostly Node, the site data and `node_modules`); `deploy.yml` calls no model and ends with a smoke test through the public address where both services must answer; Terraform defaults are the applied values plus `web_copilot_access = false`, with `web_keeps_copilot` replacing the cross-checks. 853 web tests pass. `docs/ARCHITECTURE_PHASE_3.md`, section 8
  - [x] Merge it, wait for the web deploy, then Apply C (done 2026-11-12: pull request 135 and its apply; the web server lost its model and question-topic grants, and its server bundle went from 179,410 to 53,374 bytes; `docs/ARCHITECTURE_RESULTS.md`, section 5)
  - [x] Update `CLAUDE.md` §2 (Hosting) and §9 with the text proposed in that pull request, once Rodrigo agrees Done (pull requests 135 and 140)
- [x] Phase 4, Redis with a replica, expiry with jitter, one recompute per key, hit rates, and a Redis Cluster window (built on 2026-11-12, merged as pull request 136 and deployed with nothing switched on): two connections, the primary for every write, script, limit, lock and room and the read endpoint (`REDIS_READ_HOST`) for cached values only, falling back to the primary and then memory; a frozen or dropped connection costs one call 300 ms, then memory answers for 2 s, and reconnects wait at most 2 s; every status says `redis`, `fallback`, `reconnecting` or `memory`, after one small read; every cache write expires at its base time plus or minus 10%; one recompute per key for the co-pilot's first questions (a `SET NX PX` lock with a compare-and-delete release; waiters poll with backoff and work it out themselves after 10 s); hits and misses per kind of key counted in Redis, read at `GET /api/chat/status/cache` or `node web/scripts/redis-stats.mjs <site>`; `web/scripts/failover-watch.mjs`; the co-pilot's kept answers on a Redis Cluster behind `CACHE_CLUSTER_HOST`, with a drill (`MOVED`, hash tags, a reshard) as a Cloud Run job. Terraform: `redis_tier`, `redis_memory_gb`, `redis_read_replicas` (defaults: today's Basic, 1 GB) and `redis_cluster = false`; a plan with the defaults changes nothing of this phase; switching the replica on replaces the instance (1 add, 4 change, 1 destroy); the cluster is 6 to add, no grant. Laptop, Redis 7.2 in Compose: 24 identical questions at once over three addresses made one question's worth of model calls (1 led, 23 waited, all 200, slowest 4.6 s against the leader's 4.1 s); with the primary stopped for 20 s every service said `reconnecting` within 2 s and `redis` again within about 1 s of its return, rooms answered 503 meanwhile and nothing else failed; a three-shard cluster showed 9 of 12 keys refused with `MOVED` by a plain client, and adding a fourth shard moved 3 of 12 keys with no value lost. 895 web tests pass (853 on `main` at `62a0668`). Costs: the replica window $0.27 an hour against $0.049 today; the cluster $0.0636 an hour. Why: `docs/decisions/0006-redis-replica-and-cluster.md`
  - [x] The baseline hit rates (read 2026-11-12 22:42 UTC, hours after the deploy rather than a day: 12 reads of kept answers, 4 hits; 6.4 MB of 1 GB; 13 clients), the replica window switched on through the pipeline (pull request 139: the new instance in 3 min 53 s, the old one deleted in 2 min 41 s, no visible downtime), and the failover drill (2026-11-12 23:00 UTC: `gcloud` 74 s, every service `reconnecting` for at most 12.0 s, 6 of 151 room calls failed, nothing else). Written in `docs/ARCHITECTURE_RESULTS.md`, section 3
  - [x] The rest, 2026-11-13, all through the pipeline (pull requests 163 to 166): hit rates during the window (the day's kept answers 27.8% of 18, audio 73.3% of 30, the replica 1 s behind, 6.5 MB of 5 GB), back to Basic (3 min 41 s, no downtime), the window's 15 h 19 min at about $4.14; then the Redis Cluster window: 2 shards made in 5 min 16 s, the drill (6 of 12 keys refused with `MOVED` by a plain client, 12 of 12 by the cluster client, hash tags and `CROSSSLOT`), a reshard to 3 shards in 3 min 1 s that moved 6 of 12 keys with no value lost, and off. Not seen: redirects during the reshard (the watch timed out) and a visitor's question answered from the cluster. `docs/ARCHITECTURE_PHASE_4.md`, section 9
- [x] Phase 6, closing the side doors (applied 2026-11-13 through the pipeline, pull requests 143 to 148, and checked, the fault drill included in 149 and 150: `docs/ARCHITECTURE_PHASE_6.md`, section 8; `CLAUDE.md` sections 2 and 9 updated. Left: the CDN hit rate after a day of traffic)
- [x] Phase 7, the write-up (2026-11-12, branch `arch/phase-7-write-up`, docs only): `docs/SYSTEM_DESIGN.md` has the whole-system diagram, a row per topic the plan added (each with what was measured), a capacity estimate at 10 thousand and 1 million visits a day, and the "Not built" list updated; `docs/INTERVIEW_GUIDE.md` has each split's why, cost and when one service was better, the day's incidents, a section per item of the plan's section 11 (answer, numbers, trade-off, what not to claim) and likely questions, with stale sections fixed; `docs/ARCHITECTURE_RESULTS.md` puts every baseline number beside the later ones and records the replica window, the failover drill and the Phase 5.5 checks; `docs/LESSON_FOR_THE_NEXT_APP.md` is the note for the hackathon app, to be carried over by hand. The estimate found one thing to fix: typed questions (`ask:all`) have no daily ceiling, and at a million visits a day would be the largest cost
- [x] Phase 8, a second region (switched on, drilled and switched off on 2026-11-13 through the pipeline, pull requests 152 to 160; the failover worked in 10 to 12 s but leaked a third of requests; the drill caused a 20-minute web outage through a pinned rollback: `docs/ARCHITECTURE_PHASE_8.md`, section 11)
  - [x] Step 7: remove the empty us-central1 subnet (from about 05:00 UTC on 2026-11-13) Done 2026-11-13 07:21 UTC, pull request 162
- [x] The co-pilot on Claude (decision 0009; merged as pull request 147 on 2026-11-13 and live: its deploy's five set questions passed on Claude from Cloud Run, signed in by federation): Claude Opus 5.5 at fast speed and low effort on the Anthropic API, signed in by workload identity federation (no stored key), server-side fallbacks, refusals as their own outcome, daily ceilings of 120 questions and 150 typed questions for everyone (at most $14.77 a day at the dearest measured costs). Timed on a laptop: 23 of 23 questions passed, 2.5 s a question at the median, 1.77 s per model call at p90. Left: the captain's review and merge (merging applies Terraform and deploys), the `CLAUDE.md` §2 and §9 text in the pull request, and the question log's `outcome` description and summary view for `refused`
- [x] Phase 5.5, Terraform through GitHub (switched on 2026-11-12: the last Mac apply, the two Actions secrets, pull request 134 merged; five of six "done when" checks pass, the sixth is Phase 6: `docs/ARCHITECTURE_PHASE_5_5.md`, section 12; `CLAUDE.md` section 9 updated)
  - [ ] When the repository goes public: the ruleset for `main` (section 8; written, not run)
  - [x] Follow-ups, 2026-11-13: the question log's views count the co-pilot's refusals (pull request 168); the unused Anthropic key secret removed with the pipeline's permissions for it, after confirming it never held a version (169); the Phase 6 CDN hit rate on a cold cache (73.5% of tile requests, 93.7% of repeats; a miss from the bucket about 150 ms slower than a hit) in `docs/ARCHITECTURE_PHASE_6.md`; the teammates' access reviewed, nothing changed, suggestions for after 2026-11-15 in `docs/ARCHITECTURE_PHASE_5_5.md`, section 13
  - [x] Hackathon settings, 2026-11-13 (Rodrigo: the demo is the hackathon reference): two warm copies of web, plans and the co-pilot, up to ten, CPU always on, 1 GiB (pull request 171); the co-pilot's ceilings as settings, raised for the event; Redis Standard 5 GB with a read replica, kept on (172). `docs/DEPLOY.md`, "Hackathon settings"

## Sightline, the one-screen redesign (design frozen 2026-11-13)

The build brief is `space-apps-2026/SIGHTLINE_BUILD.md`, outside this repository; its prototype is the spec for
layout and behaviour, and every number comes from `web/src/lib/` and the pipeline's data. The new screen is
built at `/sightline/` (`web/src/sightline/`), beside the site, until a user test and Rodrigo's yes make it `/`.
Look at it with `cd web && node scripts/sightline-shots.mjs --out=shots`.

- [x] 1. The new address and the Watch state: the Moon from over the south pole with time playing, the play control, Scout's line, the fade, two minimise buttons, Hide all
- [x] 2. The Plan frame: the question and answer column (At, On, For; the sentence, six numbers, the verdict; Ask Scout), the rail, key P, dots that open Plan, a custom point by a click or typed coordinates, the scenario in the address in the app's own link format
- [x] 3. The river: a row per scenario on one time axis, three zooms (three days, a month, a year), one playhead, the landing's marker with the mission's length, the date steps, an optional day on Earth, fold
- [x] 4. The skyline strip: all 360° of the site's horizon, centred on the compass point nearest Earth, with the Sun and Earth, the Sun's track and Earth's loop for the month, a smooth Moon's horizon dashed, the stretch said in words, fold
- [x] 5. The mission drawer: two example presets and Custom, the basic limits, Advanced (Earth's clearance over the ridge, the panel, and what the numbers assume about height and landing accuracy), the mission in the address, the reasons in the verdict
- [x] 6. Scenarios A to D (tabs, a river row each, all in one link) and the Compare drawer (engineering rows, best value marked, fits or why not, no blended score), with "better date nearby" from the app's date-slip search. "Better spot nearby" and the science row (distance to permanent shadow) are deferred: see the brief's "Found while building"
- [ ] 7. The user test, then the default at `/` (needs Rodrigo)
  - Prepared on 2026-11-14, as a pull request that waits for his yes: Sightline at `/` (and still at `/sightline/`), the site as it was at `/classic/`, and every old address at `/` forwarded (`web/src/lib/oldAddress.ts`). Merging that pull request is the switch.

- [x] Scout's tour of the screen (2026-11-14, Rodrigo's request for "a clear tutorial of the website"): eight steps that drive the real screen, each ringing the control it is about with one or two sentences in Scout's bubble; Back, Next, Close, the arrow keys and Escape; closing puts the screen back as it was. Ways in: Scout's closed line on a first visit, the first item of How it works, and "More" on a phone. "Listen" plays each line from a file rendered once in Scout's voice (`web/public/tour/voice/`, `web/scripts/tour-voice.mjs`). One file holds the steps (`web/src/sightline/tour.json`); How it works ("How to use Sightline"), the README ("Using the site") and the tutorial video's recorder read the same words. What a step rings stays usable, so a visitor can try it and go on; once taken, How it works offers the tour "again". How it works has a place for the video (`/media/sightline-tutorial.mp4`, with its poster and captions), shown once the file answers.
- [x] Another site for the same date (2026-11-14, from the audit against the challenge's "alternative sites within the same region"): when a landing does not fit, the verdict's second line names the nearest listed site of the same group where that date fits the mission, by the verdict's own rules; a click adds it as another scenario, as the next-landing line does. No line when the date fits at no site of the group, or for a custom point. Scout's context carries the same fact for the scenario on show.
  - [ ] Not done: the video itself (the resources session records it from the tour); the tour held on a real phone.
  - [x] The rail's "Watch" and "Hide" are one Home button (2026-11-14, Pat's request): back to the opening screen, with the tour offered again. Not done: the tour's last line still says "Hide leaves only the Moon" (true of the H key and of "Hide all" in Watch, but nothing in Plan is ringed for it), since new words need a new voice file and a new video.

## The Atlas's three looks (started 2026-11-13)

Three directions from a design canvas, built on the one Atlas page and picked with `&look=a|b|c`.
Colors, fonts and contrast for each: [`ATLAS_LOOKS.md`](ATLAS_LOOKS.md).

- [x] A · Observatory: fonts, icons, time bar, layer dropdown with the key, status chips, five-step tour (#214)
- [x] B · Mission Control: docked side panels from 1100 px, Chakra Petch + JetBrains Mono, cyan controls (#214)
- [x] C · Night Glass: one bottom dock from 1100 px, Sora + DM Mono, frosted panels (#214)
- [ ] Not done: the tour and status chips were checked in headless Chrome at 1280×800 and 390×844, not on a real phone; the month arrows of the old river are gone (the month menu stays); no switch on the page between looks yet (a link sets it with `&look=`)

## The port into this repository (2026-11-14)

This repository was created on 2026-11-14 at 14:25 UTC. The code came over in steps, files only, each a
pull request with CI green. Built on the team's own pre-event practice code; reuse approved by the Bethesda
Local Lead.

- [x] Step 1: `REFERENCES.md`, `AI_USAGE.md`, `FRICTION_LOG.md`, a new `README.md` (pull request 1)
- [ ] Step 1, the rules: `CLAUDE.md` and `AGENTS.md` (pull request 2, waiting for Rodrigo)
- [x] Step 2: the pipeline and its tests; CI's pipeline job (pull request 3)
- [x] Step 3: the web app's core, its data and scripts; CI's web job (pull request 4)
- [x] Step 4: the four services; CI complete (pull request 5)
- [x] Step 5: Terraform (`infra/`) and the deploy workflows (pull request 9). The Terraform state was copied to
      this repository's own prefix first, and the plan said "No changes"
- [x] The first deploys from this repository, started by hand one service at a time (events worker, plans,
      co-pilot, web), each tested before visitors reached it; then the deploys' automatic start after a green
      CI run on `main`
- [x] Step 6: the Sightline screen and front page, Scout, the planner and the other pages (pull request 6)
- [x] Catch-up: a change made on 2026-11-14 in the working copy, Scout's taller chat card and the model's name
      in his tag (pull request 7)
- [x] Step 7: these documents

## A science measure: distance to permanent shadow (2026-11-14)

- [x] `web/public/data/shadow.json`: for each of the 13 sites, the distance to the nearest permanently shadowed pixel and to the nearest shadowed region of at least 10 km², from NASA's LOLA maps (`pipeline/scripts/make_shadow_distance.py`; `docs/VALIDATION.md` §16). Seven sites have numbers; the six outside NASA's maps say so
- [x] Show it in the Planner: two rows under Science in its Compare tab (`compareGroups` in `web/src/sightline/plannerTable.ts`)
- [ ] Show it in the main screen's Compare panel

## The Planner as two tabs, Find and Compare (2026-11-14)

- [x] Find: the header (back, tabs, scenario tray, Brief, Share, Export, Scout), the tab in the link (`&planner=find`), and every site by month with the days a landing fits (`web/src/sightline/plannerFit.ts`, `PlannerFind.tsx`; checks in `sightline-shots.mjs`, scene `planner-find`)
- [x] Compare: a column per scenario with its site and date changed in place, rows in groups (verdict first), the science rows from `shadow.json`, and "Add scenario" as the last column (`PlannerCompare.tsx`, `plannerTable.ts`, `useShadow.ts`; scene `planner-compare`)
- [x] The header links to the detailed planner page (`/planner/`), opened on the scenario on show (`FullPlanner.tsx`)

## Landing accuracy (2026-11-14)

- [x] The odds of landing where the mission fits: `web/src/lib/landingOdds.ts` (the miss as a circular bell curve; the accuracy typed is the radius holding 99% of landings) and `web/src/lib/missionGrid.ts` (one pass over the light grid's months for a landing: Sun and Earth at landing and the longest gaps, at every cell). The cell verdict is tested to agree with `landingProblems` hour by hour
- [x] The "Accuracy" panel in Sightline's rail: the ground around the target in green and red (Sun and Earth on the grid's 120 m cells, slope on the 30 m slope images), the odds for the accuracy on the slider, the reasons for the misses, a chart of miss distance, and the loosest accuracy that keeps 90%
- [x] Second pass: a better place to aim within reach, with a button that moves the scenario there (`bestAim`); the odds under the verdict and as a row in Compare, once Landing accuracy has been used; the accuracy in the link (`&acc`, `&accs`, `&accd`); a miss longer along the approach path, with its direction on the map; each reason in its own color on the panel's map and on the Moon, with a key on the Moon
- [x] Third pass, "Mission success probability" as a layer: a switch in Layers that shades the whole Moon, transparent, from red through amber to green. Round the south pole the color is the odds that a lander aimed there comes down where the mission fits, from the light grid and the slope, softened so no cells show (`oddsField`). Everywhere else it is the same Sun and Earth test on a smooth Moon with no terrain and no slope (`moonWash.ts`), and the page says so. It is drawn as its own shell over the Moon (`GlobeViewer.setShade`), because the Moon's shader has no texture unit to spare, so a Moon Trek layer can be on with it. In Surface the land takes the tint: underfoot the odds here, along the skyline the odds out that way
- [x] The same verdicts shaded on the Moon (Orbit and Site), through the place a Moon Trek layer has; on from the first time the panel is opened, with a switch in the panel. A Moon Trek layer waits under it
- [ ] Not done: the panel reads the grid at 2 m with any part of Earth counting, so a mission with other heights or an Earth clearance is told so and not judged with them; ground beyond the fine grid (about 61 km from the pole) has no map; the approach path's direction is given on the map, not as a compass bearing; a finer light grid round the ridge sites and grids at other heights or Earth clearances need pipeline runs; not looked at on a phone
- [ ] Ask Misha: the panel adds a button to the rail and takes the overlay's place on the Moon while its shading is on

## The landing brief: what the sky does from the landing on (2026-11-14, Sebastian)

- [x] Brief section "From the landing on" (`web/src/planner/LandingSky.tsx`), on the Planner page and in the
      front page's brief sheet: sunset and Earthset (or the next rise) and whether inside the mission; power
      and radio over the mission; the mission hour by hour; the Sun's height; the skyline with the Sun's and
      Earth's paths. A custom point's track and skyline come from the app's own model (`loadScenario`)
- [x] "Why" under a tight or empty month's verdict (`web/src/planner/why.ts`, `why.test.ts`)
- [x] Planner page: instruction line, the key above the grid, striped tight months, the click brings the brief up
- [ ] Not checked: a real phone, print, and the skyline's look with Scout's panel open
- [x] The same additions for the front page, as a separate **New Planner** (its own rail button, beside Find and
      Compare, which it does not change): a site, coordinates and time bar at the top, one landing shared with
      the Moon both ways, and your picks with suggestions near the date as cards beside the brief
      (`web/src/sightline/NewPlanner.tsx`, `newPlanner.css`)
- [ ] Offered to Rodrigo, not in this change: the same additions for the front page's Planner (a site, coordinates
      and time bar at the top; suggestions near the date as cards beside the brief). Kept on branch
      `feat/planner-intuitive` until he decides how they fit Find and Compare

## The Planner: the Sun's height, power and the ground close by (2026-11-14, Sebastian)

- [x] New Planner, folded under the cards: the Sun's height over each mission, one row per scenario on one scale, lined up on its landing,
      solid while in view and faint while the terrain hides it, hover to read every row at one hour
      (`web/src/sightline/PlannerSunChart.tsx`); each mission's hourly track loaded once (`useMissionTracks.ts`)
- [x] New Planner, same fold: power and battery, roughly (`PlannerPower.tsx`): the average panel power over each mission and the
      battery for its longest dark spell, from `lib/power.ts` with example panel, efficiency and load to replace
- [x] New Planner, under the grid, for a ridge site: how much the same month changes within 100 m (the site's spread)
      and, on request, the map of the ground around it (`PlannerNearby.tsx`, the existing `NearbyMap`); a spot
      chosen on the map is added as the next scenario at the month's first landing that fits
- [ ] Not checked: a real phone, and the old map's styles inside the Planner on a narrow window
