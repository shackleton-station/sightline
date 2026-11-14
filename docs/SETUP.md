# Developer setup

How a teammate gets this repo running, from nothing to a pull request. Allow about 20 minutes for the web app
and another hour if you build the data yourself.

> Practice repo. On Nov 14 we start a new repo from scratch (see `CLAUDE.md` §1); this guide is also the
> checklist for setting that one up.

## 1. Accounts and access

| What | Who sets it up | You do |
| --- | --- | --- |
| GitHub: `shackleton-station` org, write access to this repo | Rodrigo (done for Misha, Pat, Ravi and Jessica; Sebastian was invited by email on Nov 12) | Accept the invite; run `gh auth login` |
| Google Cloud project `clps-compute-6z1nc` | Rodrigo, once he has your Google email | Only needed to run the pipeline VM or work on the server (step 5). Nobody needs it to deploy: merging to `main` deploys |
| Claude Code | You | Use your own account. Start it in the repo root so it reads `CLAUDE.md` |

Never share passwords. There are no API keys in this project; everyone uses their own logins.

## 2. Tools

```sh
brew install git gh uv node   # macOS; Node 22 matches CI (20.19+ works)
uv python install 3.12
```

On Windows, use WSL2 (Ubuntu) and install the same tools there.

## 3. Get the code and run the web app

```sh
gh repo clone shackleton-station/sightline
cd sightline/web
npm install
npm run dev                   # http://localhost:5173
```

This is the whole app, 3D view and custom points included. The site data is small JSON committed under
`web/public/data/`. The terrain tiles (1.5 GB, 6,313 files) are not in Git: they live in a Google Cloud Storage bucket,
and when you don't have them locally, the dev server fetches them from the live site for you.

### Try the Atlas's three looks

The Atlas (`/atlas/`) comes in three looks to compare: **A · Observatory**, **B · Mission Control** and
**C · Night Glass** ([`ATLAS_LOOKS.md`](ATLAS_LOOKS.md) has each one's colors and fonts). All three are on
`main`. If your copy is older, update it first; each look brings its own two fonts, so install again:

```sh
git pull
cd web
npm install
npm run dev
```

Then open, in a window at least 1100 px wide (B and C dock their panels from that width; narrower, they keep A's
floating layout in their own colors):

| Look | Address |
| --- | --- |
| A · Observatory | http://localhost:5173/atlas/ |
| B · Mission Control | http://localhost:5173/atlas/#look=b |
| C · Night Glass | http://localhost:5173/atlas/#look=c |

Change `look=` in the address and press Enter to switch without reloading. In each look, try:

1. **The tour.** It opens on your first visit; the **Tour** button beside the month opens it again.
2. **The time bar.** Play, drag, the 1×/4×/12× speed, arrow keys. The top lane is gold while the Sun is up,
   the bottom lane blue while Earth is up; dark means hidden. The chips at the top say the same for the hour shown.
3. **The layer menu.** Sunlight, Sun + Earth, Month's Sun; the key is inside the menu.
4. **Tap the ground** inside the gold square: the chips and the time bar switch to that spot.
5. **Scout.** Ask something; tap Scout's face to fold the bubble away.
6. **A phone.** In Chrome or Edge, F12, then Ctrl+Shift+M, pick a phone and reload.

A link that carries `&look=b` or `&look=c` opens that look for whoever follows it.

## 4. Build the data yourself (optional, needed for pipeline work)

Needs about **30 GB free disk**. The first run downloads about 21 GB of NASA data (LOLA terrain, SPICE kernels,
PGDA maps) into `cache/` and took about 27 minutes on an M4 Max. NASA's archives can be slow or rate-limit you;
the script resumes where it stopped.

```sh
cd sightline/pipeline
uv sync
uv run python scripts/run_all.py             # everything: data, tiles, validation
uv run python scripts/export_features.py     # just the globe's place names (seconds)
```

It writes `web/public/data/` (committed) and `web/public/tiles/` (not committed). `cache/` is git-ignored; never
commit anything from it. Once `web/public/tiles/` exists, the dev server uses your local tiles instead of the live
site's. If your run changed the tiles, whoever deploys uploads them with `npm run upload-tiles` (step 8).

## 5. The typed-question box and the server

Nothing to set up. `npm run dev` forwards `/api`, `/tiles` and `/media` to the live site, so the
typed-question box, the 3D view and the demo video all work on a fresh clone with no keys and no cloud access.

Only if you are changing the server itself (`web/server/`): you need access to the Google Cloud project (ask
Rodrigo), then run two terminals in `web/`:

```sh
npm run dev:server                               # the server on :8080, calling Google Cloud as you (Scout's voice), the events worker on :8081, plans on :8082 and the co-pilot on :8083
BACKEND=http://localhost:8080 npm run dev        # the app on :5173, forwarding to it
```

No key is stored anywhere. In the cloud the co-pilot signs in to Claude on the Anthropic API by workload
identity federation as its own service account. Locally, give it the same federation settings with
`ANTHROPIC_IDENTITY_FROM_GCLOUD` (gcloud impersonates the co-pilot's account), or your own `ANTHROPIC_API_KEY`
from your shell, or `FAKE_MODEL=on` for a scripted stand-in (`docs/DEPLOY.md`, "How the co-pilot signs in to
Claude"). Everything else calls Google Cloud
as you (`gcloud auth login`).

`npm run dev:server` starts three programs: the site's server, the events worker (`web/events-worker/`),
which counts co-pilot questions for the How it works page, and the plans service (`web/plans/`), which saves
and opens shared plans. Locally the server passes `/api/plans` on to the plans service, where the cloud has
a rule on the load balancer. Plans go to the real Firestore database, as you; start with `PLANS_DATABASE=`
(empty) to keep them in memory instead. Locally the worker keeps its counts in memory and
the server sends each event straight to it, where the cloud has a queue and a database between them. To put
sample events through the worker without asking the co-pilot anything: `node scripts/push-sample.mjs
http://localhost:8081`.

To run the three real container images side by side, with a real Redis and Google's Firestore emulator,
from the top of the repository (needs Docker, and no cloud access for the pages or for plans):
`docker compose up --build`, then open `http://localhost:8080`.
`docker-compose.yml` says what is real there and what is stood in for.

## 6. Checks (the same ones CI runs)

```sh
cd web && npx tsc -b && npx vitest run && npm run build
cd pipeline && uv run ruff check . && uv run ruff format --check . && uv run pytest
```

## 7. How we work

- **Your folder** (`CLAUDE.md` §3): `pipeline/` Rodrigo · `web/` Misha (Ravi: comparison and explainer) ·
  `.github/` and deploys Pat (Sebastian: the server and cloud setup, `web/server/` and `infra/`, with Pat) ·
  `docs/pitch/` Jessica. Ask before editing someone else's folder.
- **Branch per change**, small PR, conventional commit message (`feat: …`, `fix: …`, `docs: …`). No pushes to
  `main`. CI must be green; Pat reviews and merges.
- **Disclose AI use:** one line in `AI_USAGE.md` per meaningful task. **Cite** every dataset, library and image in
  `REFERENCES.md`.
- **No invented numbers or coordinates.** If you can't source it, log it in `docs/OPEN_QUESTIONS.md`.
- **Start a session** by reading `docs/PROGRESS.md`; update it when you finish something.

## 8. Deploying

Merging a PR to `main` deploys to <https://shackletonstation.dev>: after CI passes, GitHub Actions builds the
image, updates Cloud Run and runs a smoke test (`.github/workflows/deploy.yml`). Nobody needs cloud access or
keys for that. If the deploy job fails, the site stays on the previous version.

Only after a pipeline run changed the terrain tiles, someone with access to the Google Cloud project copies
them to the bucket (it skips files that haven't changed):

```sh
cd web && npm run upload-tiles
```

Deploying by hand, the demo video and the infrastructure are covered in [`DEPLOY.md`](DEPLOY.md) and
[`../infra/README.md`](../infra/README.md).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| 3D view or custom point shows an error | Check you're online (the dev server fetches tiles from the live site), or build them (step 4) |
| 3D view breaks after the pipeline changed the tiles | Run `npm run upload-tiles`, then reload |
| Typed-question box says it isn't working (local) | Check you're online. With `BACKEND=http://localhost:8080`, check `npm run dev:server` is running; its Google token lasts an hour, so restart it |
| Pipeline stops on a download error | Rerun it; finished files are kept |
| A friend sees "Data could not be loaded" | They have an old tab; a refresh fixes it |
