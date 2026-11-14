# Ravi's notes: testing status and next steps

Last updated 2026-11-14, end of day 1 of the event. This branch (`test/ravi-test-report`) holds testing only; fixes
go on their own branches from `main`.

## My role

Site comparison and the explainer in `web/`, under Misha (`CLAUDE.md` §3). On top of that: testing and verification,
and asking the team the questions that come out of it.

## What has been checked

| Area | Result | Where |
| --- | --- | --- |
| CI on `main` (pipeline and web) | All green | [`TEST_REPORT.md`](TEST_REPORT.md) §1 |
| **Landing calculations**, checked independently | Correct: Sun and Earth within **0.006°** of my own JPL Horizons queries; "up" vs the terrain horizon, **0 disagreements in 5.45 M** hourly checks; the "fits / next landing" logic, **0 mismatches in 5.9 M** landing hours (the checker catches a planted bug); physics sanity (29.53-day synodic month, farside never sees Earth) | [`TEST_REPORT.md`](TEST_REPORT.md) §0 |
| Live pages | All load, no console errors in headless Chrome | [`TEST_REPORT.md`](TEST_REPORT.md) §2 |
| **Scout** correctness | **25 / 25** golden questions right (live, real model) | [`SCOUT_TEST_REPORT.md`](SCOUT_TEST_REPORT.md) §1 |
| Scout prompt injection | **14 / 14** held; the server's guard had gaps (fixed in the PR below) | [`SCOUT_TEST_REPORT.md`](SCOUT_TEST_REPORT.md) §2 |
| Scout latency | median 2.5 s, slowest 5% 5.2 s; first streamed step after about 1 s | [`SCOUT_TEST_REPORT.md`](SCOUT_TEST_REPORT.md) §3 |
| Scout load | one copy handled 400 people asking at once; the real limit is the rate limits | [`SCOUT_TEST_REPORT.md`](SCOUT_TEST_REPORT.md) §4 |
| Scout soak (30 min) | 21,648 questions, 0 errors, no slowdown, memory steady at about 150 MB, **no leak** | [`SCOUT_TEST_REPORT.md`](SCOUT_TEST_REPORT.md) §4 |

## My PR

`fix/scout-visitor-and-guard` (pushed; PR opened by me on GitHub). Three commits:
1. People on one Wi-Fi each get their own Scout allowance (browser id, with a cap per network address; the daily cost ceiling is unchanged).
2. The answer guard also refuses numbers written in words, non-ASCII digits and Roman numerals, and bare web addresses.
3. Golden questions for Scout, checked in CI (`web/copilot/golden/`), with a manual live runner (`web/scripts/scout-eval.mjs`).

## Open questions for the team

| For | Question |
| --- | --- |
| **Misha** | The front page's Compare drawer treats a **0.5-point** difference in sunlit % as a tie (`COMPARE_ROWS`, `src/lib/sightlineMission.ts`). The classic comparison says "Too close" within the error measured against NASA (`src/lib/compare.ts`). Should the drawer use the same rule? (My area; I can make the PR.) |
| **Misha** | Scout's lookups default to 14 days / 72 h without Sun / 72 h without Earth (`shared/tools/defaults.ts`); the front page defaults to 24 h without the Sun and no Earth limit. Does the page always send the visitor's limits to Scout? |
| **Misha** | Should Scout say when months tie? "Sunniest month of 2027 at Shackleton Rim" has four at 100% (September to December), and Scout names just one. |
| **Rodrigo** | The live Scout budget is 1,000 questions a day (about $100 a day at most); `limits.ts` was designed for $15 a day. Intended for the event? |
| **Rodrigo** | "Sun up" counts any sliver of the disk, including during the mission, where the longest dark is counted. A panel gets almost nothing from a sliver. Should Plan say so? |
| **Pat / Sebastian** | The redirect to `lunarsightline.com` went live before its certificate was active (seen at 17:32 UTC, fixed by 18:45 UTC). Follow the runbook's "wait for ACTIVE" next time? |
| **Everyone** | Which of the checks only a person can do (`docs/PROGRESS.md`: real phones, Scout's voice, follow-the-presenter, Google sign-in) should I take? |

## Next steps (in order)

1. **Comparison tie rule.** Ask Misha (first question above), then make it my first PR in my own area.
2. **Explainer user test.** Run the stopwatch test in [`USER_TEST.md`](USER_TEST.md) with two people who have never seen the app. It's the only evidence for "easier than NASA's tools", and it has never been run.
3. **Real-phone checks.** At 390 px the Planner and Scout pages looked cut off in headless Chrome, and the home globe came out black. Confirm on a real phone ([`TEST_REPORT.md`](TEST_REPORT.md) F1, F2).
4. Record the team's answers to the questions above, here.
5. Later: pre-warm Scout's cache with the demo questions before the pitch (deferred).

## Not done yet (free, local)

- Several Scout copies sharing one Redis (`docker-compose.yml`): do the limits hold across copies? A possible small overcount in `countIfAllowed` (`copilot/busy.ts`).
- Circuit-breaker drill (`MODEL_FAULTS=529@100`).

## How to run things

```sh
# Node 22 and uv are installed in ~/.local/bin
cd pipeline && uv sync --locked && uv run pytest
cd web && npm ci && npm test && npx tsc -b

# Re-verify the landing calculations (from the repo root)
python3 -I docs/test-report/verify/verify_data.py web/public/data

# Scout golden set: in CI on the fix branch; live by hand (costs about $2.50, never as a load test)
cd web && node scripts/scout-eval.mjs https://lunarsightline.com
```

Rules I keep: never load-test the live site (Scout's 1,000 questions a day are shared by everyone and cost about
$0.10 each); this branch is always pushed; fixes go on separate branches from `main`.
