# Architecture results: the Phase 0 numbers, before and after

The baseline ([`ARCHITECTURE_BASELINE.md`](ARCHITECTURE_BASELINE.md)) measured the live site on 2026-11-12
between 16:37 and 16:55 UTC, while it was one Cloud Run service. Phases 1 to 5.5 split it into four services,
moved Redis to a primary with a read replica, added an index, and moved Terraform into GitHub. This file puts
every baseline number beside the value each later phase measured, and says what changed.

**The rule for this table:** only numbers the repository's docs record, or that were measured on 2026-11-12 and
are written here for the first time (marked "first written here"). Where no phase measured a number again, the
cell says **not measured**. A number from a laptop and a number from the server's own clock are never put in
the same column as if they were one measure.

**Where "after" numbers come from:**

| Phase | Results section |
| --- | --- |
| 1, events worker | [`ARCHITECTURE_PHASE_1.md`](ARCHITECTURE_PHASE_1.md), section 6 |
| 2, plans service | [`ARCHITECTURE_PHASE_2.md`](ARCHITECTURE_PHASE_2.md), section 9 |
| 3, co-pilot service, and the contract step | [`ARCHITECTURE_PHASE_3.md`](ARCHITECTURE_PHASE_3.md), sections 8 and 10 |
| 4, Redis replica and cluster windows | [`ARCHITECTURE_PHASE_4.md`](ARCHITECTURE_PHASE_4.md), section 9; the replica window was first written here (section 3 below) |
| 5, "my plans" index | [`ARCHITECTURE_PHASE_5.md`](ARCHITECTURE_PHASE_5.md), section 9 |
| 5.5, Terraform through GitHub | [`ARCHITECTURE_PHASE_5_5.md`](ARCHITECTURE_PHASE_5_5.md), section 12; summarised in section 4 below |

---

## 1. The baseline numbers, before and after

### 1.1 Response times through the public address, from the same laptop

| What | Phase 0 | After | What changed |
| --- | --- | --- | --- |
| A page and the data files (`load.mjs`, one worker, 20 s) | Median 38 and 42 ms, p95 42 and 47 ms (two runs) | **Phase 1:** median 39 ms, p95 44 ms (543 requests, none failed). **Phases 2 to 5.5:** not measured | Nothing visible. The web server still serves every page. The run after Phase 1 sits inside the spread of the two baseline runs |
| A terrain tile the CDN already had | Median 27 ms, p95 30 ms (n = 30) | Not measured | Nothing in Phases 1 to 5.5 touched tiles. Phase 6 moves them to a backend bucket |
| Terrain tiles the CDN did not have, fetched by the server | Median 135 ms, p95 188 ms (n = 40) | Not measured | As above |
| Opening a saved plan (`3a4tqevu`, n = 30) | Median 178 ms, p95 251 ms, answered by the web server | **Phase 1:** 188 / 247 ms. **Phase 2, before any apply:** 188 / 238 ms. **Phase 2, after the route moved, answered by the plans service:** 175 / 255 ms and 157 / 211 ms (two runs). **Phase 5:** 178 / 245 ms. **Phase 4 failover drill:** 151 of 151 plan reads succeeded (no times kept) | The request now goes to its own service. Every run sits inside the run-to-run spread of about 10 to 20 ms. Not slower, not proven faster |
| Saving a plan | 442 ms, n = 1, from the laptop, with the connection set-up | **Phase 2, the server's own clock (Cloud Trace), 4 saves:** whole request 93 to 147 ms; `save to Firestore` 53 to 88 ms; a replayed save adds 37 to 53 ms for the key lookup | **Not comparable.** One laptop sample against server-side spans. The trace step is the number to keep |
| A co-pilot question answered from the cache (n = 10, two batches of 6) | Median 201 ms, p95 320 ms | **Phase 1:** median 200 and 208 ms, p95 238 and 245 ms (two runs). **Phase 3, through the co-pilot service:** median 217 ms, n = 3 (the other requests met the laptop's daily limit, `429`). **Phase 4 failover drill:** 19 of 19 answered from the cache at about 200 ms (first written here) | Moved to the co-pilot service. Phase 1 added the outbox write before the answer: 2 ms median, 6 ms at most in traces. Phase 3's sample is too small for a p95 |
| An uncached co-pilot question through the public address | Two samples only: 2.6 s and 19.1 s. No median claimed | Single samples, no distribution: **Phase 1:** 4.6 s (the first question after the worker went live). **Phase 3, streamed:** first lookup at 1,794 ms, answer at 4,490 ms | Still no median through the public address. Running the full `chat-eval.mjs` is what it would take |
| An uncached question, the server's own clock (question log) | Median 4,700 ms, p95 10,670 ms (n = 150) | Not measured | |
| `POST /api/chat` at the load balancer | Median 4,214 ms, p95 9,362 ms (n = 62, cached and uncached) | Not measured | |
| A typed question (`/api/ask`) at the load balancer | Median 3,995 ms, p95 4,763 ms (n = 43) | **Phase 3 breaker drill, single samples:** the trial after the breaker closed, 5.1 s; the next, 4.5 s | Single samples only |

### 1.2 The load balancer's log and the CDN

| What | Phase 0 (16 h 25 min of log) | After | What changed |
| --- | --- | --- | --- |
| Requests, median and p95 per kind of path (table 1.2 of the baseline) | 24,995 requests, median 16 ms, p95 243 ms over all | Not measured | The log was never re-read for a whole day after a phase |
| Share of requests answered by the CDN | 21.5% (5,381 of 24,995) | Not measured | |
| Share of bytes from the CDN | 47.4% (975.7 MB of 2,060.4 MB) | Not measured | |
| CDN share for the paths it may keep (tiles, assets, media) | 82.7% | Not measured | |

### 1.3 Cold start

| What | Phase 0 | After | What changed |
| --- | --- | --- | --- |
| A real cold start a visitor waits for | Not measurable: one copy kept warm | **Not measured in any phase.** The plans and co-pilot services are kept warm for the event (`plans_min_instances = 1`, `copilot_min_instances = 1`, `infra/settings.auto.tfvars`), so neither start from nothing could be seen. The worker's start was not timed either | The split adds a possible cold start per service on a visitor's path (web, then plans or the co-pilot). Its size on Cloud Run is unknown |
| Cloud Run's own startup metric for the web image | 2,089 and 2,461 ms | Not measured | |
| Laptop only: from `docker run` to the first status answer | Not measured | Co-pilot image: 194 ms (decision 0004). Says little about Cloud Run | |

### 1.4 Cost per day

| What | Phase 0 | After | What changed |
| --- | --- | --- | --- |
| Real cost per day | Not readable: no billing export, no billing API | **Not readable in any phase** | Still needs Rodrigo's Billing page or a billing export |
| List-price estimate | About $2.45 fixed and up to $5.00 by use: at most about $7.45 that day | Not re-estimated per phase. Known changes at list price: the replica window, $0.27 an hour against $0.049 (about $5.30 a day more while it is on); each copy kept warm, about $0.32 a day; the services scale to zero otherwise. The capacity estimate in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) prices 10 thousand and 1 million visitors a day | |
| Cost of the replica window | Not applicable | **15 h 19 min, about $4.14 at list price** (2026-11-12 22:48 to 2026-11-13 14:07 UTC); the cluster window about $0.04 more. Not read from the bill | |

### 1.5 The container, the identities, the edge limit

| What | Phase 0 | After | What changed |
| --- | --- | --- | --- |
| Images | One: `clps-web`, 124.3 MB compressed in the registry | Four. Laptop builds, unpacked, arm64 (a different measure from the registry's): web 579.6 MB before the contract step and 579.4 MB after; worker 347 MB; plans 491 MB (113 MB compressed); co-pilot 491 MB | The site data (102 MB on disk) is in every image that reads it, so plans and the co-pilot each carry it |
| The web server's own bundle (`dist-server/index.js`) | Not measured | 179,410 bytes before the contract step, 53,374 after (72 source files, then 31) | The co-pilot and plans code left the web server (pull request 135) |
| Settings per service | Web: 1 CPU, 512 MiB, 80 at once, 60 s, 0 to 3 copies | Web unchanged. Plans: 80 at once, 30 s, 0 to 3. Co-pilot: 10 at once, 40 s, 0 to 3. Worker: 20 at once, 30 s, 0 to 2. All starting values, none yet confirmed from a week of traffic | The co-pilot's 10 at once and 40 s fit seconds-long, paid requests |
| Identities and grants | One identity, `clps-web`, with five grants: the model, the bucket, the `plans` database, publish to the topic, traces | Web: 3 (read the bucket, traces, read-only on `stats`). Plans: 2 (the `plans` database, traces). Co-pilot: 4 (the model, publish, the light grid only, traces). Worker: 2 (the `stats` database, traces). The push identity: 1 (may call the worker) | The web server, which serves every public page, can no longer call the model, touch plans or publish events (Applies C of Phases 2 and 3) |
| The edge firewall's API allowance | 120 calls a minute from one address, one backend | Counted per backend, seen twice: 140 requests to `/api/plans/status` gave 120 answers and then `429`s; 140 to `/api/chat` gave 125 and 15 `429`s; the web server's status answered 200 straight after each | One address now gets 120 a minute on each of three backends. Nobody decided that; it follows from attaching one policy three times |

### 1.6 Redis and the cache

| What | Phase 0 | After | What changed |
| --- | --- | --- | --- |
| Instance | Basic, 1 GB, one node, no replica | **Phase 4 window:** Standard, 5 GB, one read replica, on since 2026-11-12 (pull request 139). To go back to Basic before 2026-11-14 | Read replicas need the Standard tier and 5 GB nodes. The size is what replicas need, not what the data needs |
| Memory in use | Not measured | 6.4 MB of 1 GB at 21:12 and 22:01 UTC (decision 0006, Phase 4 doc) and at 22:42 UTC (first written here) | Read on the old instance; it is gone with it |
| Connected clients | Not measured | 11 at 22:01 UTC; 13 at 22:42 UTC (first written here) | |
| Share of co-pilot questions answered from the cache | The question log: 8 of 158 rows cached (5.1%). The load balancer: 8 of 62 under 0.5 s (13%) | **Phase 4's per-kind counter**, read at 22:42 UTC, three hours after the Phase 4 deploy: 12 reads of kept answers, 4 hits (33.3%) (first written here) | **Not comparable.** Different windows and different counters, and 12 reads is a tiny sample. Since Phase 3 the cache key is the co-pilot's code and the data, not the deploy, so a deploy that changes neither keeps the answers |
| Hit rate during the window, and after | Not applicable | During, 2026-11-13 05:18 UTC: the day's kept answers 5 of 18 (27.8%), audio 22 of 30 (73.3%); the set question the failover watch repeated, 18 of 19. The replica 1 s behind. After: the new Basic instance starts empty | Too few questions to judge the 80/20 test |

---

## 2. Numbers the baseline did not have, from the phases

| What | Value | Source |
| --- | --- | --- |
| How long a route change takes to reach this laptop | 3 min 45 s, 1 min 24 s and 3 min 12 s for the plans route; 2 min 52 s for the co-pilot route; fault injection on in 3 min 15 s, off within 2 min 32 s. For a while both old and new answered | Phases 2 and 3 |
| Plan requests that failed during a route change | 0 of 24, then 0 of 100 | Phase 2 |
| The outbox write before an answer | Median 2 ms, at most 6 ms (14 traced requests) | Phase 1 |
| The worker's count of one event | Median 73 ms, at most 179 ms, nearly all the Firestore write; no visitor waits on it | Phase 1 |
| Pub/Sub's waits between tries (policy: at least 60 s) | 66 to 192 s; five tries took 7 minutes, and the message reached the dead-letter subscription after 10 | Phase 1 |
| The dead-letter alert | Email about 8 minutes after the first copy reached the dead-letter subscription | Phase 1 |
| A duplicate event | Counted once: `question counted`, then `question already counted` | Phase 1 |
| Idempotent saves | A replay returned the same id with `replayed=true`; four saves at once with one key made one plan | Phase 2 |
| The circuit breaker | 5 failed calls opened it; the sixth question was refused in 0.18 s with `Retry-After: 30`; half-open after the fault was removed; the trial closed it | Phase 3 |
| Fault injection at the load balancer, half held 8 s and half aborted | 20 of 40 held, 19 of 40 aborted; meanwhile 75 of 75 page loads (slowest 0.11 s) and 75 of 75 plan opens (slowest 1.5 s) | Phase 3 |
| The composite index's build | 5 min 52 s; 205 plans paged 100, 100, 5, newest first | Phase 5 |
| Creating the Standard instance with a replica, through the pipeline | 3 min 53 s; deleting the old Basic one, 2 min 41 s | Phase 4, first written here |
| The manual failover | `gcloud` took 74 s; every service `reconnecting` for at most 12.0 s; 6 of 151 room calls failed | Phase 4, first written here (section 3) |
| One recompute per key, laptop | 24 identical first questions made one question's worth of model calls (1 led, 23 waited) | Phase 4, laptop |

---

## 3. Phase 4, the replica window, as measured (first written here)

**Switching on, 2026-11-12, through the pipeline (pull request 139).** GitHub Actions created the Standard,
5 GB instance with one read replica in **3 min 53 s**, switched the three services that use Redis to it, then
deleted the old Basic instance (**2 min 41 s**). Terraform made the new instance first because the uptime
check is `create_before_destroy`, and Terraform passes that order down to what it depends on: the web
service, and through it Redis. Two instances with one name cannot exist, so the instance's name now carries its
tier (`clps-web-store`, `clps-web-store-standard-ha`), and the two existed side by side. The phase document
had expected the other order, with minutes of no Redis; that did not happen.

A probe every 5 s through the switch saw every service on Redis and every plan open succeed throughout. **No
visible downtime.**

**The hit rates before the window**, read at 22:42 UTC (they lived in the old instance and went with it):
the co-pilot's kept answers, 12 reads and 4 hits (33.3%), three hours after the Phase 4 deploy. Redis memory
6.4 MB of 1 GB. 13 clients connected.

**The failover drill, 2026-11-12, 23:00 UTC.** `gcloud redis instances failover` with limited data loss moved
the primary from us-east4-a to us-east4-c. The command took **74 s**. `web/scripts/failover-watch.mjs` ran for
300 s and made 774 requests:

| What | Result |
| --- | --- |
| Each service's Redis state | `reconnecting` for **at most 12.0 s**, from 48.1 s to 58.1 s into the watch, 16 s after the command started. Every service back on `redis` from 60.1 s |
| Follow the presenter (room calls) | **6 of 151 failed** with `503`: the only failures |
| Co-pilot questions | 19 of 19 answered from the cache, at about 200 ms |
| Plan reads | 151 of 151 |
| Status calls | 151 of 151 for each service |

Against what Google's pages said: "usually completes in under 30 seconds" (read replicas page) and "a short
connection reset of a couple of minutes or less" (manual failover page). Seen from the services, the
disruption was at most 12 s; the command itself took 74 s to return.

What these numbers leave out: one probe location, one failover, one quiet evening. The read endpoint's lag
was not read then; it was 1 s on 2026-11-13. The hit rates during the window, the switch back and the Redis
Cluster window are in [`ARCHITECTURE_PHASE_4.md`](ARCHITECTURE_PHASE_4.md), section 9.

---

## 4. Phase 5.5, the checks, as measured

The full account, with the pull request and issue numbers, is in
[`ARCHITECTURE_PHASE_5_5.md`](ARCHITECTURE_PHASE_5_5.md), section 12.

| Check | Result |
| --- | --- |
| (a) A pull request that changes `infra/` shows its plan as a comment | Pass. The first comment worked with neither personal value in it |
| (b) Merging applies it with no laptop | Pass. 0 added, 4 changed. The deploys waited for Terraform, then took their "a tenth of the visitors" step instead of the first-deploy path |
| A plan right after | "No changes". The revision-name change every plan had shown all day is gone, because deploys no longer pass `--tag` |
| (c) A pull request that would delete a protected resource is stopped | Pass. A test pull request setting `shared_store = false` was stopped by the destroy guard, naming `google_redis_instance.store[0]` |
| (d) A change made outside Terraform is reported | Pass. A retention change made by hand opened a drift issue |
| (e) An emergency apply from the Mac works | Pass. A Mac apply put the retention back, and the next drift run closed the issue |
| (f) Phase 6 goes through the pipeline | Not yet: Phase 6 is being built |

---

## 5. The contract step, as measured

Pull request 135 and its apply removed the co-pilot and plans code from the web server and took away its model
and question-topic grants. Its server bundle went from **179,410 to 53,374 bytes**. Its image barely moved
(**about 580 MB**): the image is the Node base, the built site with its data, and `node_modules`, not the
server's code (Phase 3, section 8).

---

## 6. Gaps: what was never measured after the split

- **Cold starts of the plans and co-pilot services on Cloud Run.** Kept warm all weekend.
- **The real cost per day.** No billing data has been read in any phase.
- **The load balancer's per-path times** after the split. The CDN hit rate after Phase 6, on a cold cache and
  little traffic, is in `ARCHITECTURE_PHASE_6.md`: 73.5% of tile requests, 93.7% of repeat ones.
- **A median and p95 for uncached questions** through the public address.
- **Tile times** after the split (unchanged code, but not re-run).
- **The replica and cluster windows' cost from the bill** (list price only: Phase 4, section 9), and hit rates
  at real traffic.
- **Anything signed in.** Phase 2 check (b) and Phase 5 check (d) need a person with a Google account.
- **The 10-minute "message waiting" alert** has not been seen to fire, and **the breaker's alert email** did
  not arrive in the Phase 3 drill, for a reason not yet found.
- **Two copies of the web server passing a presenter's room through the real Redis**, and real phones.
- **The objectives.** No service has 28 days of data yet.
- **The timeout and concurrency of each new service** are starting values until a week of traffic.
