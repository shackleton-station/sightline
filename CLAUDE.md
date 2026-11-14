# CLAUDE.md — Shackleton Station: Sightline (NASA Space Apps 2026)

You are Claude Code working for a member of team **Shackleton Station** (captain: **Rodrigo Pimenta**) on
**Sightline**, the team's entry for the NASA Space Apps Challenge (Nov 14–15, 2026). Read this file fully,
then read `docs/HANDOFF.md` for context, team and the stack audit. If the two ever disagree, **this file
wins**; tell your human about the conflict.

**Starting or resuming a session:** if `docs/PROGRESS.md` exists, read it first and continue from the first
unchecked item. Keep it current after every meaningful step so any fresh session (yours or a teammate's)
can pick up without re-deriving context.

**New teammate or fresh clone?** Follow [`docs/SETUP.md`](docs/SETUP.md) first: accounts, tools, running the app,
terrain tiles, the typed-question box, checks and how we work. Walk your human through it step by step and
stop at anything that needs their login or keys.

**Working for a teammate (not Rodrigo)?** Skip Phases 0–1 (bootstrap is Rodrigo's). Work only on issues
assigned to your human, inside their folder (§3), on a branch, via PR.

**Don't edit this file's rules** (§1–§3, §11) without your human's explicit OK. Progress goes in
`docs/PROGRESS.md`, not here.

**How this file is laid out.** Sections 1 to 3 and 11 to 13 are the rules. Sections 4 to 10 are the brief
the app was first built from, phase by phase. Those phases are done. They are kept because they are still the specification of the pipeline and of the deploys: read them for how a part is
meant to work, not as a list of things to do. What is being worked on now is in `docs/PROGRESS.md`.

After every meaningful step: run the checks for what you touched, update `docs/PROGRESS.md`, commit, and
give Rodrigo a 3–6 line summary. **Do not start the next step if the current one's checks fail.**

---

## 1. Ground rules (non-negotiable)

**Stop and ask Rodrigo (or your human, if you work for a teammate) before:**
- sending GitHub org invites, or anything that emails/notifies other people;
- creating accounts, entering passwords, or anything needing 2FA (he runs `gh auth login`, Cesium ion,
  Cloudflare logins himself);
- anything that costs money or changes a plan/billing (never upgrade GitHub). The one paid cloud is Rodrigo's
  Google Cloud project `clps-compute-6z1nc`, which runs on credits: use it, but ask before creating anything
  there beyond what `infra/` declares;
- deleting repos/branches/files you did not create in this session;
- making any repo public;
- downloading any single file over 5 GB (tell him the size first).

**Hackathon integrity:**
- This repo is the team's **Space Apps 2026 submission**, created on Nov 14, 2026, and it is **public**:
  everything committed here is published.
- Space Apps allows AI tools **with disclosure**: append one line per meaningful task to `AI_USAGE.md`
  (date, tool = "Claude Code", what you did).
- Cite every dataset, kernel, library and image in `REFERENCES.md` as you use it (name, URL, license/terms).
- No NASA logos/insignia in anything you generate. Any AI-generated image needs a visible "AI-generated" mark.

**Security & data hygiene:**
- Never commit secrets: `.env*`, `.netrc`, tokens. Cesium token lives only in `web/.env.local`.
- Never commit data or kernels: everything large goes in `cache/` (git-ignored). Commit only small derived
  JSON outputs (< 2 MB each) under `web/public/data/`.
- Public data only. No employer code, data, accounts or credentials.

**Science honesty:**
- Never invent coordinates, dataset names, kernel names or numbers. If you can't verify something, say so,
  log it in `docs/OPEN_QUESTIONS.md`, and pick the safest option.
- Every number shown in the UI must come from our pipeline, and the pipeline must be validated (Phase 3.6).

**Precision budget (avoid rabbit holes):** the horizon is sampled every 0.5° and the Sun is 0.53° wide, so
~0.05° accuracy on Sun/Earth direction is plenty. Frame/kernel subtleties that matter at the arcsecond or
tens-of-meters level (e.g. DE421 vs DE440 mean-Earth frames) are **out of scope** — pick one consistent
combination (Phase 3.2), document it, move on.

---

## 2. Stack (final — see HANDOFF.md §6 for the audit)

| Area | Choice |
| --- | --- |
| Python | 3.12 via **uv**; `spiceypy`, `numpy`, `rasterio`, `pyproj`, `pandas`, `httpx` (downloads), `pytest`, `ruff` |
| Ephemeris | **NAIF SPICE** generic kernels |
| Terrain | **LOLA** south-polar DEM (polar stereographic) |
| Output | Static JSON in `web/public/data/<site_id>/` |
| Web | React + TypeScript + Vite; **SVG + D3** for panorama & timeline; **Three.js** (lazy-loaded, only in `web/src/three/`) for the whole-Moon globe and the 3D terrain, lit only by the pipeline's Sun direction and our own LOLA-derived maps. CesiumJS was measured and dropped (`docs/VALIDATION.md` §8, `docs/LESSONS.md`) |
| Tests | pytest (pipeline), vitest + `tsc -b` (web) |
| CI | GitHub Actions |
| Hosting | Google Cloud, declared in Terraform (`infra/`). Four Cloud Run services, each with its own image, identity and deploy workflow: `web` (`web/server/`, Node + Hono) serves the built app and site data (tiles and video come straight from a Cloud Storage bucket through the CDN), Scout's voice, follow-the-presenter, `/api/stats` and `/api/status`, and has no code for plans or the co-pilot; `plans` (`web/plans/`) answers `/api/plans` and is the only identity that can read or write the Firestore database `plans`; `copilot` (`web/copilot/`) answers `/api/chat` and `/api/ask` through Claude on the Anthropic API (`claude-opus-5-5`, fast speed, low effort, server-side fallbacks; settings in `infra/settings.auto.tfvars`), signed in by Anthropic workload identity federation as its own Google service account, so no key is stored (decision 0009), with a circuit breaker, retries and `Retry-After`, and is the only identity that can call the model or publish question events; `events-worker` (`web/events-worker/`, private) counts co-pilot questions from Pub/Sub into the Firestore database `stats`. Code they share is in `web/shared/`. A load balancer with CDN and an edge firewall (Cloud Armor) in front on `shackletonstation.dev` sends each path to its service and is the only way in from the internet for web, plans and co-pilot (on one machine `web` passes the plans and co-pilot paths on instead); `web` asks the others for their status with a Google identity token each checks itself; keyless deploys from GitHub Actions. Redis (Memorystore) holds rate limits, cached answers, the event outbox, the co-pilot's circuit breaker and presenters' rooms; the services fall back or switch the feature off without it. Also live: each co-pilot question goes through Pub/Sub into a BigQuery table, each API request is traced in Cloud Trace, Scout's voice is Cloud Text-to-Speech, and sign-in with Google is optional (`docs/SYSTEM_DESIGN.md`). Redis's tier, size and read replicas, and an optional Redis Cluster for the co-pilot's cache, are Terraform variables whose defaults are the Basic 1 GB instance (`docs/ARCHITECTURE_PHASE_4.md`); since 2026-11-13 the live instance is Standard, 5 GB, with a read replica, and the three visitor-facing services run the hackathon settings (two warm copies each, CPU always on: `docs/DEPLOY.md`, "Hackathon settings"). Split under the architecture plan (approved by Rodrigo on 2026-11-12; `docs/decisions/`) |
| **Not used** | MapLibre/Mapbox (no polar/lunar support), CesiumJS, FastAPI, AWS, API keys or other stored secrets. The pipeline's results stay static JSON: the database holds only what visitors save. Allowed in addition, under the architecture plan: a second Firestore database, `stats`, holding counters written by `events-worker`; and in the `plans` database a second collection, `idempotency`, holding one record per keyed save for a day |

---

## 3. Target repo layout

```
sightline/
├── CLAUDE.md                 # this file (rules for agents)
├── AGENTS.md                 # one line: "Follow CLAUDE.md"
├── README.md                 # what this is, how to run
├── AI_USAGE.md  REFERENCES.md  FRICTION_LOG.md
├── docs/
│   ├── HANDOFF.md            # context + spec (copy of the handoff file)
│   ├── PROGRESS.md           # phase checklist, updated every phase
│   ├── OPEN_QUESTIONS.md     # anything unverified
│   └── pitch/                # Jessica's story + storyboard (she owns it)
├── pipeline/
│   ├── pyproject.toml        # uv project
│   ├── src/clps/
│   │   ├── config.py         # site list, time range, paths
│   │   ├── kernels.py        # download + furnsh SPICE kernels into cache/kernels
│   │   ├── dem.py            # download/open LOLA DEM window, sample heights
│   │   ├── horizon.py        # horizon mask per site
│   │   ├── ephemeris.py      # Sun/Earth topocentric az/el per hour
│   │   ├── visibility.py     # up/blocked, windows, summary stats
│   │   ├── validate.py       # compare vs PGDA maps + JPL Horizons spot checks
│   │   └── export.py         # write JSON contract
│   ├── scripts/run_all.py    # one command: build everything for all sites
│   └── tests/
├── web/
│   ├── package.json  vite.config.ts  .env.example
│   └── src/
│       ├── data/             # typed loaders for the JSON contract
│       ├── components/HorizonPanorama.tsx  Timeline.tsx  SummaryCard.tsx  TimeSlider.tsx
│       ├── components/MoonView3D.tsx       # Cesium, lazy-loaded
│       └── App.tsx
├── cache/                    # git-ignored: DEM, kernels, PGDA maps
└── .github/workflows/ci.yml
```

**Folder ownership (each teammate's agent stays in its lane):**
`pipeline/` Rodrigo · `web/` Misha (Ravi: site comparison + explainer) ·
`.github/` + deploy Pat (Sebastian: server and cloud setup, `web/server/` and `infra/`, with Pat) ·
`docs/pitch/` Jessica (the rest of `docs/` is shared). When working for Rodrigo you
may touch everything, but keep changes in focused PRs per area.

**Git workflow:** branch per issue (`feat/horizon-mask`), small PRs, conventional commit messages, link
the issue (`Closes #3`). No direct pushes to `main`: it is protected, and every change is a pull request
with CI green. No approval is required: each teammate may merge their own pull request once its checks
pass (Rodrigo's decision of 2026-11-14), and asks the owner of the folder it touches when the change is
not small. **Working for Rodrigo:** open the PR, wait for CI to be green, show Rodrigo the summary, and
merge (`gh pr merge --squash`) only after he says OK — or once he has told you "merge green PRs without
asking" for the session.

---

## 4. Phase 0 — Preflight (no changes yet)

Check and report versions/status; install only what's missing **after telling Rodrigo**:
- `git --version`, `gh --version`, `gh auth status` (must be logged in as Rodrigo; if not, ask him to run
  `gh auth login` — do not do it for him).
- `uv --version` (install: `brew install uv`), then `uv python install 3.12`; `node --version` (≥ 20), `npm --version`.
- `gh auth status` must show scopes `project` and `admin:org` (needed for the board and invites). If missing,
  ask Rodrigo to run `gh auth refresh -s project,admin:org` (it opens a browser — his step, not yours).
- `gh api orgs/shackleton-station` succeeds. If the org name differs, ask Rodrigo.
- Disk space free ≥ 20 GB (DEM files can be large).

✅ Done when all checks pass and you've told Rodrigo what (if anything) you installed.

---

## 5. Phase 1 — GitHub setup

1. From the folder containing this file: `gh repo create shackleton-station/<repo> --private --clone
   --add-readme --license mit` (clones into `./<repo>`). Do all further work inside `<repo>/`.
2. Add the files in §3 (top level + `docs/`), `.gitignore` covering Python, Node, `cache/`, `*.tif *.img
   *.lbl *.jp2 *.bsp *.bpc *.tls *.tf`, `.env*` (but **not** `.env.example`), `.netrc`.
3. Copy this `CLAUDE.md` and `HANDOFF.md` (→ `docs/HANDOFF.md`) into the repo.
4. Try branch protection on `main` (require PR + 1 approval). Free orgs usually can't protect private
   repos — if the API refuses, **don't upgrade**; note "PR-only convention" in README and PROGRESS.
5. Labels (use `gh label create <name> --force` — `question` already exists by default): `pipeline`, `web`,
   `3d`, `infra`, `pitch`, `friction`, `blocked`, `question`.
6. Project board: `gh project create --owner shackleton-station --title "CLPS Demo #1"` (note the project
   number it returns; add issues with `gh project item-add <number> --owner shackleton-station --url <issue-url>`).
7. Create issues (no assignees yet), each with a **Definition of Done**, and add them to the board:
   - Pipeline: kernels loader · DEM download/window · horizon mask · ephemeris · visibility & windows ·
     validation · JSON export · `run_all.py`
   - Web: app shell + data loaders · horizon panorama · time slider · timeline · summary card ·
     Cesium 3D view (lazy) · mobile layout
   - Infra: CI workflow · Cloudflare Pages deploy
   - Pitch: user + problem paragraph · 30-second storyboard
8. **STOP.** Ask Rodrigo for teammates' GitHub usernames and explicit OK before inviting:
   `gh api orgs/shackleton-station/invitations -F invitee_id=$(gh api users/<u> --jq .id) -f role=direct_member`
   New org members usually get only **Read** (the org's base permission), so also grant write on the repo:
   `gh api -X PUT repos/shackleton-station/<repo>/collaborators/<u> -f permission=push`.
   If Rodrigo doesn't have the usernames yet, **don't block**: mark "invites pending" in PROGRESS.md and continue.
9. **Tell Rodrigo to restart Claude Code inside `<repo>/`** for all later phases, and to rename the parent
   folder's copies (e.g. `CLAUDE.bootstrap.md`) so two CLAUDE.md files can't drift apart.

✅ Done when the repo, labels, board and issues exist and `main` has the bootstrap commit.

---

## 6. Phase 2 — Skeletons + CI (thin, everything runs)

- `pipeline/`: `uv init --package --name clps` (so the package is `src/clps/`), add deps, `ruff` + `pytest` config, one trivial passing test.
- `web/`: `npm create vite@latest web -- --template react-ts` (if it prompts to install/start the dev server,
  decline; if it waits for input, rerun with `< /dev/null`); add `d3`, `cesium`,
  `vite-plugin-static-copy` (copy Cesium `Workers`, `ThirdParty`, `Assets`, `Widgets` and set
  `CESIUM_BASE_URL`, following Cesium's official Vite example repo `CesiumGS/cesium-vite-example`), `vitest`,
  `web/.env.example` with `VITE_CESIUM_ION_TOKEN=`.
- CI (`.github/workflows/ci.yml`): pipeline job (`astral-sh/setup-uv`, `uv sync`, `ruff check`, `pytest`) + web job
  (`actions/setup-node` with Node 22, `npm ci`, `npx tsc -b` — the Vite template's root tsconfig has no files, so plain `tsc --noEmit` checks
  nothing — `npx vitest run`, `npm run build`). Add one trivial vitest test in Phase 2 so `vitest run`
  doesn't fail on "no test files". Do not download big data or call external APIs in
  CI; tests use synthetic fixtures (and recorded Horizons responses for the validation code). CI builds
  without a Cesium token — the 3D view must fall back to its placeholder, never fail the build.
- `README.md`: one-screen "how to run" (setup, `run_all.py`, `npm run dev`, tests, deploy).

✅ Done when CI is green on a PR and `npm run dev` shows a placeholder page.

---

## 7. Phase 3 — Pipeline (one site, one month)

Work test-first where possible. Keep every function pure and small; IO only in `dem.py`, `kernels.py`, `export.py`.

### 3.1 Site
- Pick **one** site near the lunar south pole from a **published** NASA source (e.g. a highly illuminated
  rim/ridge near Shackleton, or a point in a NASA-announced Artemis III candidate region). Record name,
  lat, lon, and the source URL in `config.py` and `REFERENCES.md`. Do not invent coordinates.
- Time range: one calendar month (e.g. 2027-01-01 to 2027-02-01 UTC), hourly. All times UTC in data and UI
  (label the UI "UTC").
- **Observer height is a parameter** (`obs_height_m`, default 2 m). At the pole, a few meters change
  illumination a lot (solar panels on a mast see more Sun) — Demo #2 can compare 2 m vs 10 m.

### 3.2 SPICE kernels (`kernels.py`)
- Download from NAIF generic kernels (https://naif.jpl.nasa.gov/pub/naif/generic_kernels/) into
  `cache/kernels/`, skipping files already present:
  - leapseconds: `lsk/naif0012.tls`
  - planetary ephemeris: a DE file from `spk/planets/` (`de440.bsp` preferred; `de421.bsp` is smaller)
  - lunar orientation: `pck/moon_pa_de421_1900-2050.bpc` **plus its matching frames kernel**
    `fk/satellites/moon_080317.tf`, and `pck/pck00011.tpc` for radii.
  - Confirm each file exists at that path before downloading; write the exact filenames to REFERENCES.md.
- **Decision (consistent with LOLA; use this):** `naif0012.tls` + `de440.bsp` (or `de421.bsp`) +
  `moon_pa_de421_1900-2050.bpc` + `moon_080317.tf` + `pck00011.tpc`, computing in frame **`MOON_ME`**
  (mean Earth/polar axis, which LOLA products use). Only if those exact files are gone, fall back to the
  DE440-based lunar PCK + its matching FK in the same directories, and note it. Don't spend time on frame nuances (see precision budget).

### 3.3 Terrain (`dem.py`)
- Find the LOLA south-polar gridded DEM (PDS Geosciences LOLA polar GDR, or NASA PGDA polar products)
  covering at least **~150 km** around the site, preferably ~20 m/px near the site (a coarser 60–120 m
  product is fine for the far field). Verify exact product names/URLs on the source pages; log them.
- These files can be **GBs**: tell Rodrigo the size before downloading; store in `cache/dem/`; read
  windows with rasterio. Check the label for **units, scale factor and reference radius** (LOLA heights
  are typically relative to a 1737.4 km sphere) and the polar-stereographic projection parameters.
- Provide `height_at(lat, lon)` (bilinear) and `xy_to_latlon` / `latlon_to_xy` via pyproj **using the CRS read
  from the DEM file itself** (don't hand-roll projection parameters). For lat/lon use that CRS's own geodetic
  CRS (`crs.geodetic_crs`, a Moon sphere) — **never EPSG:4326 or any Earth CRS**. Nodata → NaN, never 0.

### 3.4 Horizon mask (`horizon.py`)
- For azimuth 0–359.5° in 0.5° steps (720 values, from local north, clockwise), march along the surface from
  the site out to 150 km (fine steps near: ~20 m to 5 km; coarser far: ~100–200 m), or to the DEM edge if
  closer (log it). **Sensitivity check:** compare masks at 50 / 100 / 150 km max range and record the max
  difference — distant massifs can matter near the pole.
- Work in **3D Moon-fixed Cartesian**: site vector `S = (R + h_site + obs_height_m) * unit(lat, lon)`;
  for each sample point `P`, elevation angle = `atan2(dot(P−S, up), |(P−S) − dot(P−S, up)·up|)` where
  `up = unit(S)`. This handles lunar curvature automatically. Keep the max per azimuth.
- Local north/east at the site: `up = unit(S)`, `east = unit(ẑ × up)`, `north = up × east`
  (at |lat| < 90°; reject sites exactly at the pole).
- Output `[{az, el}]`. Tests: a perfectly smooth sphere DEM → horizon ≈ −√(2h/R) everywhere (≈ −0.087° for
  h = 2 m); a synthetic ridge at a known bearing and distance → peak at that azimuth with the analytically
  expected angle; azimuth convention test (a point due "north" = toward the equator from a south-pole site → az 0°).

### 3.5 Ephemeris + visibility (`ephemeris.py`, `visibility.py`)
- For each hour: vector from the site to the Sun and to Earth in `MOON_ME` with light-time + stellar
  aberration. Preferred: `spkcpo` (constant-position observer on the surface) or `azlcpo` (returns az/el
  directly) if available in the installed spiceypy; acceptable shortcut: `spkpos(target, et, 'MOON_ME',
  'LT+S', 'MOON')` minus the site vector. Rotate into local ENU → azimuth/elevation. Also keep the Sun unit
  vector in `MOON_ME` (the 3D view uses it for lighting).
- Visibility, with `d = el_center − horizon(az)` and `r` = angular radius (compute from distance + body
  radius; ≈0.27° Sun, ≈0.95° Earth):
  - `visible_fraction` = 1 if d ≥ r; 0 if d ≤ −r; else circular-segment area
    `(r²·acos(−d/r) + d·√(r²−d²)) / (π·r²)` (small-angle, flat-horizon approximation — fine here).
  - `sun_up` = visible_fraction > 0 (any part visible); also export `sun_frac`.
  - `earth_up` = any part of Earth's disk visible (believed to match PGDA's definition — verify in Phase 3.6).
- Windows: merge consecutive "up" hours into intervals. Summary: % hours Sun up, % Earth up, % both,
  longest Sun-down gap (h), longest Earth-down gap (h), list of windows.
- Tests: synthetic tracks → correct windows and gaps; az/el of a known geometry.

### 3.6 Validation (`validate.py`) — required, this is our "Validity" score
1. **Spot-check ephemeris vs JPL Horizons API** (https://ssd.jpl.nasa.gov/api/horizons.api) for 3–5
   timestamps: `COMMAND='10'` (Sun) / `'399'` (Earth), `EPHEM_TYPE='OBSERVER'`, observer on the Moon with
   `CENTER='coord@301'`, `COORD_TYPE='GEODETIC'`,
   `SITE_COORD='<east_lon_deg>,<lat_deg>,<alt_km>'`, `QUANTITIES='4'` (apparent az/el), `ANG_FORMAT='DEG'`. Agreement
   within ~0.1° expected; investigate anything worse. (If the Horizons lunar-site setup is unclear, log it.)
2. **Compare long-run averages vs NASA PGDA** illumination and Earth-visibility maps
   (https://pgda.gsfc.nasa.gov/products/69) at the site pixel (sample the map with rasterio in its own CRS).
   PGDA averages cover ~18.6 years, so also run our model over a longer span (e.g. 1–2 years, 2–6 h steps)
   for this comparison. Read PGDA's README for **how** they define the averages (fraction of solar disk vs
   any part visible; height above surface) and compute the matching quantity (mean `sun_frac` vs % hours).
   Report both numbers and the difference; explain plausible causes (DEM resolution, horizon range,
   observer height, averaging period).
3. Write `web/public/data/<site>/validation.json` and a short `docs/VALIDATION.md`.

### 3.7 Export (`export.py`) + `scripts/run_all.py`
JSON contract (all times ISO-8601 UTC, angles in degrees):
- `web/public/data/sites.json` → `[{id, name, lat, lon, source_url}]`
- `<site>/horizon.json` → `[{az, el}]`
- `<site>/track.json` → `[{t, sun_az, sun_el, sun_frac, sun_up, earth_az, earth_el, earth_up, sun_vec_me: [x,y,z]}]`
  (hourly; ~744 rows for a month — keep it small, round angles to 0.01°)
- `<site>/summary.json` → `{range, pct_sun, pct_earth, pct_both, max_sun_gap_h, max_earth_gap_h, sun_windows, earth_windows}`
- `<site>/validation.json`
Also export a JSON Schema or TypeScript types file so `web/` can import them.

✅ Phase 3 done when `uv run python scripts/run_all.py` regenerates everything from `cache/`, tests pass,
and VALIDATION.md has real numbers.

---

## 8. Phase 4 — Web app

Priority order — finish each before starting the next:
1. **HorizonPanorama** (hero): SVG, x = azimuth 0–360 (N, E, S, W labels), y = elevation (auto-scaled,
   typically −2° to +10° at the pole); filled terrain silhouette; full-range Sun and Earth tracks as thin
   lines; current Sun/Earth markers; color shows up (above terrain) vs blocked. Responsive; readable on a phone.
2. **TimeSlider**: scrubs the month; play/pause; updates markers.
3. **Timeline**: two horizontal bands (Sun up/down, Earth up/down) across the range; overlap highlighted;
   click a time to jump the slider.
4. **SummaryCard**: numbers from `summary.json` + a one-line plain-English verdict
   (format example only: "Sun NN% · Earth NN% · longest night NN h"); a "validated vs NASA PGDA" note from `validation.json`.
5. **MoonView3D** (Misha's area; lazy-load with `React.lazy`): CesiumJS with the Moon ellipsoid
   (`Ellipsoid.default = Ellipsoid.MOON` or as in Cesium's current docs), Earth globe, sky atmosphere and
   default Sun/Moon disabled, Cesium Moon Terrain via `Cesium3DTileset.fromIonAssetId(...)` (Cesium's Moon
   Terrain page shows asset id 2684829 — verify). Fly to the site; set `scene.light` to a
   `DirectionalLight` with direction = −`sun_vec_me` at the slider time; enable shadows on the viewer and
   tileset (tune `shadowMap.maximumDistance`; near-horizontal polar Sun makes long shadows — note
   performance); show an Earth-direction indicator. Attribution: "NASA and the USGS Astrogeology Science
   Center" + Cesium's required credits. If no token in `.env.local`, show a friendly
   placeholder instead of crashing. **Never display Cesium terrain heights as data** (known vertical
   offsets vs LOLA have been reported). Verify the frame: shadows must point away from the Sun azimuth
   shown in the panorama — log the check.
6. Mobile: single column, panorama first; 3D view behind a "View in 3D" button on small screens.

Accessibility basics: labels on controls, sufficient contrast, keyboard-operable slider.
Tests: vitest for data transforms (window merging for display, scales); `npx tsc -b` clean.

✅ Phase 4 done when `npm run build` passes and the app works at 390 px and 1280 px widths.

---

## 9. Phase 5 — Deploy

- **Merging to `main` deploys.** After CI passes, `.github/workflows/deploy.yml` builds the web server's
  image, rolls it out to the Cloud Run service `clps-web` in steps, and runs `web/scripts/smoke.mjs` against
  it, last through the public address, where the plans and co-pilot services must answer. It calls no model.
  GitHub signs in to Google Cloud through Workload Identity Federation: there is no key to handle. Details:
  `docs/DEPLOY.md`. The plans service, the co-pilot service and the events worker deploy by themselves, each
  only when its own files changed (`.github/workflows/deploy-plans.yml`, `deploy-copilot.yml`,
  `deploy-events-worker.yml`). The co-pilot's deploy asks five set questions (`web/scripts/chat-eval.mjs
  --quick`) of each new version before visitors reach it; it is the only deploy that calls the model.
- **Infrastructure is Terraform** in `infra/` (Cloud Run, bucket, service accounts, load balancer, DNS,
  certificate, uptime check, budget), and **it goes through GitHub**. A pull request that touches `infra/`
  gets its plan as a comment. Merging to `main` applies it from GitHub Actions
  (`.github/workflows/terraform.yml`), with no approval click and no required reviewer: Rodrigo's decision
  of 2026-11-12 (`docs/decisions/0007-terraform-through-github.md`). So **read the plan comment before you
  merge**, above all its "Access this plan changes" part: nobody else will. A destroy guard stops an apply
  that would delete something protected (`infra/protected-resources.txt`), and a nightly check opens an
  issue when the project and `main` differ. `terraform plan` on a laptop is always fine. Settings live in
  `infra/settings.auto.tfvars`; the two personal ones (`billing_account`, `alert_email`) are never
  committed, printed or quoted.
- **Applying from the Mac is the emergency path**, for when the pipeline is broken or a drill needs a
  setting for minutes (`docs/DEPLOY.md`, "Applying from the Mac"). Claude Code runs it, the same way as
  before: save the plan to a file, read every line, apply exactly that file. Commit the same change the
  same day, or the next pipeline run undoes it. If the app's safety check refuses an apply, leave the exact
  command for Rodrigo; don't work around the refusal.
- **Terrain tiles are not in the image.** They live in `gs://clps-compute-6z1nc-web-assets/tiles/`, and since
  Phase 6 the load balancer reads them straight from the bucket through Cloud CDN (`infra/assets.tf`); the web
  server keeps its `/tiles/*` code only for the way back. After a pipeline run changes them,
  `cd web && npm run upload-tiles` copies them (needs access to the Google Cloud project). Never upload them
  with a `Content-Encoding`.
- **The services' `run.app` addresses are closed** (Phase 6): web, plans and co-pilot take internet requests
  only through the load balancer. To reach a version that is not live, use `https://shackletonstation.dev`
  with the header `x-clps-canary: web|plans|copilot` (`--canary <service>` on the check scripts). The header
  is documented, not a secret. The events worker keeps its identity-only door.
- **No stored keys.** The co-pilot and the typed-question box call Claude on the Anthropic API as the
  co-pilot's own service account (`clps-copilot`), by Anthropic workload identity federation: Google's metadata
  server gives it an identity token, which Anthropic exchanges for a short-lived access token under a
  federation rule in the Claude Console. Locally, use the same federation through gcloud impersonation
  (`ANTHROPIC_IDENTITY_FROM_GCLOUD`), your own `ANTHROPIC_API_KEY` from your shell, or `FAKE_MODEL=on`. The web
  server's account cannot call the model. Never put a key in the repository, a tracked `.env`, a Terraform
  variable, a log or a chat. If a third-party secret is ever needed, it goes in Google Secret Manager through
  Terraform, with Rodrigo's OK.
- Don't run `wrangler` commands: nothing here is hosted on Cloudflare.
- Cesium token (if the Cesium view is ever used again): Vite inlines `VITE_*` values into the public bundle,
  so the token **will be visible** in the deployed site. Rodrigo restricts it in Cesium ion to the deployed
  domain + localhost, read-only scope.
- Record the URL in README and PROGRESS. Time the whole deploy and log it in FRICTION_LOG.

✅ Done when the URL loads on Rodrigo's phone.

---

## 10. Phase 6 — Friction report

Keep `FRICTION_LOG.md` updated **during** every phase, not just at the end
(`| Date | Who | Area | What slowed us | Time lost | Decision for Nov 14 |`), then answer in
`docs/LESSONS.md`:
- DEM product, size, download time, horizon compute time per site.
- Which kernels; how the frame was verified; Horizons/PGDA agreement.
- Precompute vs on-demand for N sites × 1 year?
- Cesium: setup time, bundle size, phone performance, token hassles. Keep or drop for Nov 14?
- Agent/Git friction (conflicts, agents straying out of folders).
- **What we'd cut with only 36 hours.**
- A 10-line "Saturday 9 AM plan" for the real event.

---

## 11. Coding conventions

- Python: type hints, small pure functions, `ruff` clean, docstrings on public functions with units
  (degrees, meters, UTC). No notebooks in the pipeline package (notebooks allowed in `pipeline/notebooks/`,
  git-ignored outputs).
- TypeScript: strict mode, no `any`, components < ~200 lines, data types imported from the generated contract.
- Units in names when ambiguous (`elev_deg`, `dist_km`, `h_m`).
- Prefer boring and readable over clever; teammates and judges will read it.

## 12. When unsure

Write the question to `docs/OPEN_QUESTIONS.md`, choose the conservative option, keep going, and tell
Rodrigo in your phase summary. Never fake data to make the UI look done — use an obvious "pending" state.

## 13. Permissions tip for Rodrigo

Claude Code will ask before running commands. To reduce prompts, allow routine ones for this project
(`git`, `gh`, `uv`, `npm`, `npx vite`, `pytest`) — but keep prompts on for `gh api ... invitations`,
`terraform apply`, `gcloud` commands that grant access, `rm -rf`, and anything touching billing.
