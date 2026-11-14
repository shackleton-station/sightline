# Test report: 2026-11-14 (Ravi)

What I ran on `main` at `aaeee7e`, what I found, and what I need the team to answer. No app code was changed.

## 30-second version (to say out loud)

> All the automated checks pass. Pipeline: 179 tests pass, lint and format are clean. Web: the type check is
> clean, 1,223 tests pass, and all five builds succeed. All seven live pages return 200 and show no console
> errors in headless Chrome. Two things need a person on a real phone. First, at phone width the Planner and
> Scout pages look cut off on the right. Second, the home page's globe came out completely black in headless
> Chrome. That is probably just headless Chrome without a GPU, but nobody has confirmed it on a phone.
> I also found one small edge case in the pipeline: on flat terrain the relief shading divides by zero.
> I have four questions for owners, and I'll take the phone checklist.

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
5. **Everyone:** Which of the "Checks only a person can do" (PROGRESS / OPEN_QUESTIONS #14, #15, #19) should I take?

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
