# Handoff: Shackleton Station — NASA Space Apps 2026 practice demo

> Context + spec for the AI coding agent (Claude Code). Operating rules and the step-by-step plan are in
> CLAUDE.md, which takes precedence.
> Read this whole file before acting. Ask Rodrigo before anything irreversible,
> anything that sends invites/messages, or anything that costs money.

---

## 1. Context

- **Event:** NASA Space Apps Challenge, **Nov 14–15, 2026** (weekend hackathon, ~36 build hours).
  Challenge list: https://www.spaceappschallenge.org/2026/challenges/
- **Team name:** Shackleton Station (5 people; see roles below).
- **Chosen challenge:** **Lunar Landing Site Navigator** (formerly listed as CLPS Lunar Mission Browser) — build an intuitive tool that lets
  mission planners, educators and the public compare lunar south-pole landing sites and dates by
  visualizing Sun and Earth positions relative to the local horizon, to assess **power generation
  potential** and **direct-to-Earth (DTE) communication windows**.
- **Backup challenge:** Harmonization of MODIS and VIIRS Hot Spots (fire "burning calendar").
- **Key dates:**
  - Oct 28: full challenge statements + official datasets released → re-check this plan against them.
  - Nov 2: Space Apps Connect opens.
  - Nov 13: Project Submission and Judging & Awards guides released (spaceappschallenge.org/resources/project-submission-guide and /judging-awards-guide), and the challenge's Resources tab → re-check rules and datasets.
  - Nov 14 9:00 AM – Nov 15 11:59 PM (local event time): the real build + submission.

## 2. What we are doing NOW (and what we are not)

We are building **throwaway practice demos** to find friction before the event:

- **Demo #1 (now → ~Oct 27):** one landing site, one month, end to end. Goal = surface friction, not polish.
- **Demo #2 (Oct 29 → Nov 12):** redo against the official datasets/requirements; add multi-site compare.
- **Hackathon (Nov 14–15):** build the real app **from scratch in a NEW repo**.

**Rules that keep us honest (do not violate):**
1. Practice repos are **private** and **separate** from the final submission repo.
2. Do **not** copy practice code into the final repo. Knowledge and design carry over; code does not.
   If anything pre-built is reused, it must be listed in the submission's References as "pre-event prototype".
3. Space Apps allows AI tools but requires disclosure. Keep an `AI_USAGE.md` log (tool + what it did).
   AI-generated images/video need a visible "AI-generated" watermark. No NASA logos/insignia in generated media.
4. Cite every dataset, library and image in `REFERENCES.md`.
5. **No employer code, data, credentials or accounts**. Public data only. Personal accounts only. Prefer personal (non-managed) computers.
6. Never commit secrets (`.netrc`, `.env`, tokens) or large data files (`cache/` is git-ignored).

## 3. Current state

- [x] GitHub org created: **`shackleton-station`** (Free plan). *(If the actual org name differs, ask Rodrigo.)*
- [ ] Discord server "Shackleton Station" with `#general #data #frontend #pitch #links` + voice "Mission Control"
      — done manually by Rodrigo (bots can't create servers). Not your task.
- [ ] Repo, issues, board, invites — **your task (CLAUDE.md Phase 1).**

## 4. Team & roles

| Person | Role in demo #1 | Notes |
| --- | --- | --- |
| Rodrigo | Captain; horizon masks + data pipeline | Satellite data background |
| Pat | CI, deploy, repo hygiene, merge gate | Senior SWE |
| Misha | Frontend: horizon panorama + 3D Cesium view | Built map visualizations of traffic |
| Ravi | Site comparison + explainer, under Misha (from 2026-11-12) | Software engineer |
| Sebastian | Server and cloud setup, with Pat (joined 2026-11-12) | Software engineer |
| Jessica | Ideas, story, user, demo storyboard, presenter | Non-coding; owns the pitch |

GitHub usernames: **unknown — ask Rodrigo before sending any invites.**

## 5. Task A — GitHub setup

Step-by-step instructions live in **CLAUDE.md, Phase 1** (single source of truth). Summary: private repo
`shackleton-station/<repo>`, labels, a project board, Demo #1 issues with definitions of done, then STOP
and ask Rodrigo for usernames + OK before any invites.

## 6. Tech stack — FINAL DECISION (audited Oct 14; all free)

**Bottom line:** two-view frontend. The **horizon panorama (SVG + D3)** is the hero and the science.
The **3D lunar globe is CesiumJS + Cesium Moon Terrain**, not MapLibre. Python + SPICE pipeline writes
static JSON. No backend server, no AWS.

### Decisions

| Layer | Decision | Why |
| --- | --- | --- |
| Agent | **Claude Code** (no Kiro) | `CLAUDE.md` is the rules file; `AGENTS.md` = one-line pointer for teammates on other tools |
| Python env | **`uv`**, Python 3.12 | Fast, lockfile, one command setup |
| Ephemeris | **`spiceypy`** (NAIF SPICE) | NASA-standard; lunar body-fixed frames via official kernels; credible to NASA judges |
| Terrain math | **`rasterio` + `numpy`** on LOLA polar DEM | Horizon masks computed by us from the source DEM |
| Data output | **Static JSON** per site in `web/public/data/` | No server to deploy or break |
| Web | **React + TypeScript + Vite** | Team default |
| Hero view | **Horizon panorama: SVG + D3 scales** | The challenge literally asks for Sun/Earth "relative to the horizon"; exact, fast, phone-friendly |
| Timeline | **SVG + D3** | Same toolkit |
| 3D context view | **CesiumJS + Cesium Moon Terrain** (Cesium ion) | Real 3D Moon with fine polar detail (Cesium lists ~5 m terrain and ~1 m imagery at 87.5–90°S); set scene lighting from *our* Sun vector → shadows sweep across the site |
| 3D fallback | **OpenLayers + proj4** lunar south polar stereographic (R = 1737400 m) reading PGDA Cloud-Optimized GeoTIFFs | Use only if the Cesium ion account/terms or performance blocks us |
| Hosting | **Cloudflare Pages** | Free, works with private repos; GitHub Pages needs a paid plan for private repos |
| CI | **GitHub Actions** | Lint + typecheck + tests + build on PRs |

### Audit: why not MapLibre (Misha's suggestion)

Misha is right that a **globe + 3D terrain** view is the strongest visual and that we should use free/open
tooling. The problem is MapLibre specifically, for the Moon's south pole:
- MapLibre GL JS renders Web Mercator tiles only (globe view drapes the same tiles), so coverage stops
  around ±85° latitude. Our sites are at ~84–90°S; Shackleton is ~89.9°S.
- MapLibre has **no custom coordinate system / non-Mercator tile support**; it is an open roadmap item and a
  maintainer said in Aug 2025 it won't land soon (github.com/maplibre/maplibre/discussions/163).
- Development Seed's 2024 globe comparison found MapLibre globe data "does not render correctly close to
  the poles" (developmentseed.org/blog/2024-12-19-casei-globe/).
- It assumes Earth's radius; lunar data would need hacks.
**Quick check for Misha (10 min):** load a MapLibre globe, `jumpTo({center:[0,-89], zoom:4})`, overlay any
raster — see what renders. MapLibre stays the right pick for the Earth-based backup (MODIS/VIIRS fire).

### Cesium caveats (read before building the 3D view)
- Needs a **Cesium ion account + access token** (Rodrigo creates it; check the free/community plan terms).
  Token goes in `web/.env.local` as `VITE_CESIUM_ION_TOKEN`, never committed. Restrict it to read scope and
  the deploy domain + localhost.
- Cesium's Moon example: set the default ellipsoid to the Moon and disable the Earth globe; global 3D Tiles
  don't support 2D/Columbus view (cesium.com/platform/cesium-ion/content/cesium-moon-terrain).
- A Cesium forum report says Moon terrain heights can appear offset (~2.5 km) vs LOLA DEM at the same lon/lat.
  **Never compute science from Cesium terrain.** All numbers come from our LOLA-based pipeline; Cesium is the
  visual only. Place site markers clamped to the tileset, not at LOLA height.
- Cesium is heavy (multi-MB). Lazy-load the 3D view so the panorama works instantly on phones.

## 7. Task B — Demo #1 (one site, one month)

**User story:** "As a mission planner, I pick a south-pole site and a date range and see when the Sun is up
(power) and when Earth is up (DTE comms), on a 360° horizon view of the real terrain."

**What gets built:** a Python + SPICE pipeline (site → horizon mask from LOLA terrain → hourly Sun/Earth
az/el → up/blocked windows → validation vs NASA PGDA maps and JPL Horizons → static JSON), and a React app
(horizon panorama + time slider + timeline + summary card, then a lazy-loaded Cesium 3D view). Full spec,
formulas, JSON contract and test plan: **CLAUDE.md, Phases 2–5**.

**Pitch (Jessica):** one-paragraph user + problem; 30-second storyboard (official demo limit: ≤30 s video
or ≤7 slides).

**Definition of done for Demo #1:** a deployed URL shows the panorama + timeline + summary for one site and
one month on a phone; validation numbers recorded in `docs/VALIDATION.md`; friction log filled in.

## 8. Lessons to capture

Demo #1 exists to surface friction. The questions to answer and the friction-log format are in
**CLAUDE.md, Phase 6**.

## 9. Things only Rodrigo (a human) can do

- `gh auth login`, plus `gh auth refresh -s project,admin:org` (needed for the project board and invites).
- Collect teammates' GitHub usernames; approve invites.
- Create/manage the Discord server and post invite links.
- Create a **Cesium ion** account + token (for the 3D view) and put it in `web/.env.local` himself.
- Create a free **Cloudflare** account and run `npx wrangler login` when Claude asks (deploy step).
- Everyone: register on spaceappschallenge.org, **all join the same Local Event**.
- **Earthdata Login is NOT needed for the CLPS demo** (PGDA, PDS LOLA and NAIF kernels are public downloads).
  Only needed if we switch to the Earth-based backup challenge; then put credentials in `~/.netrc`.

## 10. Out of scope (don't build)

- Relay-satellite coverage (nice "future work" slide only).
- MapLibre/Mapbox for the lunar view, and three.js (Cesium covers 3D) — see Section 6.
- A backend server for Demo #1 (static JSON is enough).
- Accounts/auth, databases, paid cloud services.
- Anything for the final submission repo — that starts fresh on Nov 14.
