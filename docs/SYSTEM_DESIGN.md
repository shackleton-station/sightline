# System design: what this project shows, and where to find it

A map from the usual system-design topics to the real thing in this repo, with the trade-off each one makes.
Every claim here can be checked in the code or on the live site. Nothing is aspirational: what isn't built is
listed at the end.

```
visitor
  │
  ▼
edge firewall (Cloud Armor) ── refuses floods by address
  │
  ▼
load balancer + CDN + HTTPS ── cached files answered at the edge; each path sent to its service
  │
  ├─ /api/plans, /api/plans/* ──────────► plans (Cloud Run) ────► Firestore "plans"   shared mission plans
  │
  ├─ /api/chat, /api/chat/*, /api/ask ──► copilot (Cloud Run) ──► Anthropic API       Claude, through read-only tools
  │                                                ├────────────► Pub/Sub ─┬─► BigQuery   the question log, off the request path
  │                                                │                       └─► events worker (Cloud Run, private) ─► Firestore "stats"
  │                                                └────────────► Cloud Storage       the light grid, for tapped ground
  │
  └─ everything else ───────────────────► web (Cloud Run) ──┬───► Cloud Storage       terrain tiles, video
                                                            ├───► Text-to-Speech      Scout's voice, one short answer at a time
                                                            └───► Firestore "stats"   today's counts, read-only

Redis (Memorystore): rate limits, kept answers, the co-pilot's outbox and circuit breaker, presenters' rooms.
Every service sends its traces to Cloud Trace.
```

The one server was split into four services (`docs/decisions/0001-four-services.md` to `0004`), each with its
own image, identity and deploy. **web** (`web/server/`) is the front door: pages, site data, tiles, video,
Scout's voice, presenters' rooms, today's counts and its own status. It has no code for plans or the
co-pilot, and its identity can neither call the model nor touch the plans database. **plans** (`web/plans/`)
and **copilot** (`web/copilot/`) answer their own paths; the load balancer sends those paths to them, and no
service calls another to answer a visitor. The **events worker** (`web/events-worker/`) counts co-pilot
questions from the queue. Code two services need is in `web/shared/`. On one machine (`npm run dev:server`,
Compose) there is no load balancer, so the web server passes the plans and co-pilot paths on to them.

## What is built

| Topic | Here | Where | The trade-off |
| --- | --- | --- | --- |
| **Stateless service, autoscaling** | Any copy of a service can answer any of its requests; Cloud Run runs 0 to 3 copies of the web server, and each other service has its own ceiling | `web/server/`, `infra/main.tf`, `infra/plans.tf`, `infra/copilot.tf` | Scale to zero costs nothing idle, and the first visitor after a quiet spell waits a second or two |
| **Load balancer, CDN, TLS** | One global address; files cached at the edge by the server's own `Cache-Control`; certificate managed by Google | `infra/domain.tf`, `web/server/static.ts` | The page itself is never cached, so a deploy is live at once; hashed assets are cached for a year |
| **Object storage plus CDN** (Phase 6, built, applying 2026-11-13) | Terrain tiles and video straight from the private bucket through Cloud CDN, with no server in the path: two backend buckets (a day for tiles, an hour for video), read by the load balancer's own account with a grant limited to the names the site serves | `infra/assets.tf`, `docs/decisions/0008-closing-the-side-doors.md` | No copies, cold starts or deploys for the heaviest bytes. The allow-list moves from code to the route rules and the grant's condition: any file under the three tile folders is served, not only names matching the old pattern. A backend bucket takes no rate limits at the edge; the old ban never applied to cache hits anyway |
| **Edge firewall** | Limits by address before traffic reaches the server: 120 API calls a minute, and a 5-minute ban past 3,000 requests a minute. A cross-site-scripting rule runs in watch-only mode | `infra/edge.tf` | Counted per address, so people behind one office address share a limit. The scripting rule only logs, so a false alarm can't lock anyone out. Until Phase 6's last step each service's own `run.app` address is public and skips the load balancer and this firewall; after it those addresses accept only the load balancer and callers inside the project's network (`docs/ARCHITECTURE_PHASE_6.md`). The events worker is not behind the load balancer at all and keeps its identity check as its door |
| **Rate limiting** | A sliding window per visitor, as one atomic Lua script in Redis, shared by every copy of the server | `web/shared/redisStore.ts` | A sliding log is exact but stores one entry per call; fine at these limits (tens per minute), wrong for thousands |
| **Caching** | The first question of a co-pilot conversation is kept for a day, keyed by its words, the view, the co-pilot's code version and the data version. A text said aloud is kept for a day too, keyed by the sentence | `web/copilot/chat/handler.ts`, `web/server/voice/speak.ts` | Only first questions are cached: follow-ups depend on what was said before. A change to the co-pilot's code or to the data starts an empty cache, so an answer never outlives the code or data that made it. Only the co-pilot service keeps answers; the web server keeps only spoken texts |
| **Read replica: a primary and a read endpoint** (on for a measured window since 2026-11-12) | Two connections to Redis. The primary takes every write, every script (rate limits, the breaker, the lock), the outbox, rooms and publish/subscribe. The read endpoint, which spreads reads over the replicas, is asked only for cached values. A failure there falls back to the primary, then to memory. The instance's tier, size and read replicas are Terraform variables; today's values are the defaults | `web/shared/redisClient.ts`, `web/shared/redisStore.ts`, `infra/data.tf` | A replica is a few seconds behind. Harmless for the cache (an entry is keyed by code and data, so a replica can lack an answer but never hold a wrong one), wrong for a limit (a stale count lets extra calls through), so limits never read there. Memorystore cannot change Basic to Standard in place, so switching it on or off replaces the instance and starts an empty cache. Switched on through the pipeline: the new instance was made first (3 min 53 s) and the old one deleted after (2 min 41 s), with no visible downtime; a manual failover left every service `reconnecting` for at most 12 s (`docs/ARCHITECTURE_RESULTS.md`, section 3). Back to Basic after the window |
| **Expiry with jitter** | Every cached value expires after its base time plus or minus 10%, chosen per write. Rate-limit windows and the breaker keep exact times | `web/shared/jitter.ts` | Entries written together (a deploy empties the cache, a room asks the same questions) would otherwise expire together and recompute together. A day becomes 21.6 to 26.4 hours |
| **One recompute per key** (cache stampede, "single flight") | When a kept co-pilot answer is missing, the first request takes a short lock in Redis (`SET NX PX`, a unique token, released by a compare-and-delete script) and works it out; the others look for the answer after growing pauses and work it out themselves if it does not come within 10 s. One lock for every copy of the co-pilot service | `web/shared/singleFlight.ts`, `web/copilot/chat/handler.ts` | Three small Redis calls for a request that is alone; a waiter gets the answer up to half a second after it is kept. A holder that dies costs its waiters up to 10 s. Laptop: 24 identical questions at once over three addresses made 2 model calls (one question's worth) instead of 48. Spoken audio does not use it: a voice call is short and cheap |
| **Hit rates per kind of key** | Each cache read adds one to a per-day counter in Redis (`cache:copilot:hit`, `cache:speak:miss`), sent with the read and not waited for; single flight counts what each request did. `GET /api/chat/status/cache` and `web/scripts/redis-stats.mjs` print them with Redis memory; `--monitoring` adds Memorystore's own metrics | `web/shared/cacheStats.ts`, `web/scripts/redis-stats.mjs` | Survives many copies and Cloud Run's CPU rule (nothing runs after the response). One small write per read. Lost when the instance is replaced. Memorystore's own hit ratio counts every lookup (limits, locks), so it says nothing about the cache |
| **Sharding with hash slots** (Redis Cluster; a drill window only) | Behind `redis_cluster = false`: a Memorystore for Redis Cluster reached through Private Service Connect, holding the co-pilot's kept answers and nothing else, through the library's cluster client; a failure falls back to the ordinary instance. A drill shows `MOVED` with a plain client, hash tags and `CROSSSLOT`, and which keys move when a shard is added | `web/copilot/clusterCache.ts`, `web/copilot/clusterDrill.ts`, `infra/redis-cluster.tf`, `docker-compose.cluster.yml` | Every key has one of 16,384 slots; a reshard moves slots, not keys between slots. A script's keys must share a slot, which is what hash tags are for; this repo's scripts name one key each. Laptop: adding a fourth shard moved 3 of 12 keys and no kept answer was lost. Only the cache goes there, because it is the one thing that can be lost for the price of some model calls |
| **Graceful degradation** | Redis down: each copy counts in memory. A Redis that stops answering without dropping the connection costs one call its 300 ms of patience, then memory answers for 2 s without asking, and three slow calls in a row ask for a new connection; each service's status says `redis`, `fallback`, `reconnecting` or `memory`. No database configured: sharing switches off. Model slow or busy: up to three tries with random waits, then the facts without the prose once a lookup has returned; otherwise "busy" with a `Retry-After` the page counts down; after five failed model calls in a minute a circuit breaker refuses at once for 30 s (see "Circuit breaker" in the Phase 7 table below) | `redisStore.ts`, `chat/chat.ts`, `web/copilot/modelCall.ts`, `web/copilot/breaker.ts` | With Redis down the limit is per copy again, so up to three times looser. Firestore failing while configured is not softened: saving or opening a plan returns an error |
| **Database** | Firestore, one document per shared plan, deleted automatically after six months | `web/plans/`, `infra/data.tf` | A document store suits "save this, read it by id". It would be the wrong choice for joins or reports |
| **Keys, a composite index, cursor paging** | A plan's document id is random, so new plans spread over Firestore's id ranges instead of piling onto one. "My plans, newest first" is answered by one declared composite index, `owner` ascending, `created` descending (the Firestore version of a partition key plus sort key), a page at a time: the reply's `next` marker holds the last plan's time and id, and the next page starts after those values | `web/shared/ids.ts`, `infra/data.tf`, `web/plans/firestorePlans.ts`, `web/plans/cursor.ts` | A cursor of values stays correct when plans are saved or deleted between pages, where an offset would skip or repeat one; it cannot jump to page 7. Each extra order needs its own index, built before the query can run, so the code falls back to the old query while the index is missing. Indexing a timestamp caps the collection at about 500 writes a second (Google); this app is millions of times below. Applied 2026-11-12: the index built in 5 min 52 s, and 205 test plans on the real database came back in pages of 100, 100 and 5, newest first (`docs/ARCHITECTURE_PHASE_5.md`, section 9). The same table in DynamoDB is designed below |
| **Idempotency keys** (safe retries) | Saving a plan takes an `Idempotency-Key`. The plan and the record of its key are one atomic Firestore write, each with a "must not exist" condition, so a retried save returns the first answer and never saves twice, two requests at once save one plan, and the same key with a different plan is refused (422). Keys are forgotten after a day. The page makes a key per attempt and reuses it on retry | `web/plans/idempotency.ts`, `web/plans/firestorePlans.ts`, `web/src/lib/plans.ts` | One more document per save. Redis would be cheaper and cannot make "save and remember" atomic. Seen on the real database through the public address: a replay got the first id with `idempotent-replayed: true`, a different plan under the key got 422, and four saves at once with one key made one plan (`docs/ARCHITECTURE_PHASE_2.md`, section 9) |
| **Routing by path at the edge** (the API gateway role) | The load balancer's URL map sends `/api/plans` and `/api/plans/*` to the plans service, `/api/chat`, `/api/chat/*` and `/api/ask` to the co-pilot service, and everything else to the web server. One origin for the browser, and no service calls another to answer a visitor | `infra/domain.tf`, `infra/plans.tf`, `infra/copilot.tf` | A path rule takes minutes to reach every edge, so a route change is not instant. While a path was being moved, both programs answered it with one handler and one contract; once the move was trusted, the web server's copy was removed, so going back now also means deploying an older web revision (`docs/ARCHITECTURE_PHASE_3.md`, "The ways back") |
| **A contract between the pages and an API** | The pages, the plans service and the co-pilot service deploy apart, so each can be a version ahead of the other. A written description of every request and reply, and a test that checks the service against it, both ways: nothing promised is missing, nothing is sent that is not described. Changes are additive only | `web/plans/API.md`, `web/plans/contract.test.ts`, `web/copilot/API.md`, `web/copilot/contract.test.ts` | Every new field is written down before it ships. A removal takes two releases |
| **Least privilege, no secrets** | Each service has its own identity with a few grants, each to one thing. The web server reads one bucket, reads the counts database and writes traces; only the co-pilot calls the model (Claude, signed in by Anthropic's workload identity federation with its own Google identity, so no key is stored) and publishes to the question topic; only plans uses the plans database. GitHub deploys with no stored key | `infra/main.tf`, `infra/plans.tf`, `infra/copilot.tf`, `infra/github.tf` | More Terraform up front; nothing to rotate or leak afterwards |
| **Authentication and authorization** | Optional sign-in with Google. The server checks Google's signature on the token itself, that it was issued for this site, and its expiry; a plan's owner is a one-way fingerprint of the account. Only the owner can list or delete their plans; anyone with the link can still read one | `web/shared/identity.ts`, `web/plans/handler.ts`, `src/lib/account.ts` | No session of our own: the token is the session and lasts an hour, so there is nothing to store or revoke, and nobody stays signed in longer. Switched off until an OAuth client id is set |
| **Streaming** | The co-pilot streams each lookup as it happens (server-sent events), then the answer | `chat/handler.ts`, `src/lib/chatClient.ts` | The answer's text arrives whole, not word by word: its numbers are filled in only after the draft passes the "no typed digits" check |
| **Real-time fan-out and presence** | "Follow the presenter": one visitor presses Present, and every phone that opens their link (a QR code) goes where they go: the tab, the site, the month, the hour, the limits. The presenter's page publishes its address and nothing else (a path that must be one of the site's own pages, with a bounded query and hash; never a URL); each follower holds one server-sent-event stream. A room is one Redis value that expires; a change is published on one Redis channel that every copy of the server listens to, on a connection of its own, and each copy passes it to the streams it holds. Presence: each copy writes how many followers it has, with the time, every 5 s, and the count shown is the sum of the numbers under 15 s old, so a copy that dies stops being counted and the total cannot creep up. Only a secret key made when the room starts (kept in the presenter's tab; the server keeps its fingerprint) may publish | `web/server/rooms/`, `web/src/lib/follow.ts`, `followClient.ts`, `web/src/components/Follow.tsx` | Only the newest address matters, so the ones in between are delivered at most once, on purpose: the page publishes at most once a second, a stream keeps one waiting address and not a queue, and a publish/subscribe message that is lost is never re-sent. What repairs a loss: every copy reads each of its rooms again every 5 s, and a browser that reconnects is sent the current address first. Server-sent events and not WebSockets, because the traffic is one way, the browser reconnects by itself, and it is plain HTTP through the same load balancer and firewall the co-pilot already streams through; Cloud Run ends any request after 60 s either way, so the server ends each stream at 55 s and the browser opens the next. The costs: each follower is about one API call a minute plus one or two per change of tab, and the edge firewall counts them per address, so a room on one Wi-Fi shares 120 a minute; a stream is a 55-second request, which keeps a copy awake and counts as slow in the 2-second objective. With Redis down, presenting and publishing answer 503 and followers keep the page they are on: unlike the rate limits there is no fall back to memory, because a room held by one copy would reach only the followers who happen to be on that copy. Limits: 60 followers a room, 60 streams a copy, 50 rooms, 10 minutes without a publish or 3 hours in all |
| **Message queue, event log** | Each co-pilot question is published to Pub/Sub. Two subscriptions each get every message. A BigQuery subscription writes it to a table partitioned by day, with no consumer of ours to run. A push subscription delivers it to the events worker. Messages either one gives up on after five tries go to a dead-letter topic, and an alert says so. Three saved views summarize the table: per day, per kind of lookup, and the questions worth reviewing. Nothing about who asked is recorded | `web/shared/events.ts`, `infra/events.tf`, `infra/worker.tf` | Delivery is at-least-once, so the table can hold the same event twice: it is not an idempotent consumer. Each event now carries its own id, in a column, so copies can be dropped in a query. Fine for counting what people ask, wrong for billing. Rows are dropped after 90 days. No ordering is promised, and none is needed: counts do not depend on order |
| **A service that works from a queue** (asynchronous microservice) | `events-worker`: a second Cloud Run service with its own image, identity and deploy. It has one endpoint, which Pub/Sub pushes each event to with a token signed by Google, and it adds to the day's counts. No visitor can reach it: Cloud Run refuses any caller without permission, and the worker's own code then accepts messages from one identity only | `web/events-worker/`, `infra/worker.tf`, `.github/workflows/deploy-events-worker.yml` | When it is down nothing a visitor sees breaks, and its messages wait. The price is a second thing to build, deploy and watch, and a shared folder of code (`web/shared/`) whose changes redeploy both services. Its answer to Pub/Sub is the whole protocol: 2xx means done, anything else means send it again. A message that can never be counted is refused every time, so it reaches the dead-letter topic after five tries instead of being dropped silently. Permission to call a Cloud Run service is not narrow: the deployer's project-wide role can call it too, which is why the code checks who is calling and does not rely on the permission alone |
| **Idempotent consumer** | The worker counts an event once however often it arrives. One Firestore commit creates a record of the event's id only if it does not exist and adds to the counter; if the id is there, the whole commit is refused and the worker answers "done". The records expire after 7 days | `web/shared/firestoreStats.ts`, `web/shared/events.ts` | The id is the event's own, made by the publisher, not the queue's message id: the same event published twice gets two message ids. One extra document write per event buys exactly-once counting on top of at-least-once delivery. It holds only while the record exists, so 7 days must outlast every way an event can come back (3 days in the outbox, then 3 in the subscription). Two different Firestore errors arrive as HTTP 409 (a duplicate, and "lost to another write"), so the code reads the error's name |
| **Transactional outbox** | A co-pilot event is written to an outbox (one Redis hash) before the answer goes out, then published, and removed only once Pub/Sub has it. A relay sends anything left behind: on a timer while the copy has CPU, and when a copy is told to stop. So delivery is at-least-once from the answer onward, not only from the topic onward | `web/copilot/outbox.ts`, `web/copilot/chat/handler.ts` | The textbook outbox shares a database transaction with a business change; the co-pilot has no such change, so this is the half of the pattern that removes the loss. In Redis because the request already calls Redis five times at about 1 ms each (measured), against 166 and 191 ms for the two Firestore writes in the server's traces. The cost of that choice: this Redis keeps nothing on disk, so an event waiting in it is lost if Redis restarts. And the relay has no clock of its own: Cloud Run gives CPU only during requests, so a failed event goes out with the next request and can be late on a quiet site. A relay that may send twice is only safe because the consumer is idempotent |
| **Sharded counters** | Each day's counter is split across 8 documents. An event adds to one, chosen by a hash of its id; a read adds them up | `web/shared/stats.ts` | One document is a hot key: Firestore cannot update a single document at an unlimited rate. More shards allow more writes at once and make every read cost that many document reads (fan-in on read), which is why the web server keeps a read for 30 seconds. 8 is a judgement, not a measurement: it spreads the 30 questions a minute the site allows in one burst to about 4 a document, and real traffic would fit in one. The number can change at any deploy, because readers add up whatever shards exist |
| **One writer per database** | The `stats` database is written only by the worker's identity. The web server holds a read-only role on it and shows the counts on the How it works page | `infra/worker.tf`, `web/server/stats.ts` | The strict version is the worker serving its own read API, which would mean opening it to callers. Read-only access for one other service is the compromise, enforced by permissions and not by convention |
| **Tracing** | Each API request is one trace: rate limits, cache, every model call, every tool, every database call, timed and nested. It joins the trace the load balancer started, and a log line carries the same id. A trace also crosses the queue: the publisher writes it into a message attribute (`traceparent`, the W3C form), and the worker's steps hang under the visitor's request | `web/shared/trace.ts`, `web/server/app.ts`, `web/events-worker/app.ts` | Written by hand (about 130 lines) instead of OpenTelemetry: nothing to install and every line is readable, but no automatic spans for libraries. A queue has no headers, so the trace has to be carried in the message by hand |
| **Service-level objectives** | 99.5% of requests succeed and 90% answer within 2 s, over any 28 days. The alert fires on how fast the failure allowance is being used (10 times too fast for an hour), not on single errors | `infra/slo.tf` | Measured at Cloud Run, so a failure at the load balancer or the firewall isn't counted; the uptime check covers that from outside |
| **Work after the response** | Cloud Run gives a server CPU only while it answers a request, so "send it afterwards" can stall until the next visitor. The response waits up to 250 ms for the question-log and trace sends, after the answer's bytes have gone | `events.ts` (`briefly`) | Up to a quarter second on the end of an API call, in exchange for not paying for always-on CPU |
| **AI with guardrails** | The model can only call read-only tools; the server fills in every number and rebuilds every button. A place the model may look up that isn't a listed site (ground tapped on the Atlas) comes with the request, not from the model | `web/copilot/chat/` | A number spelled out in words isn't caught |
| **Voice, with a fallback** | Scout says its answers aloud. The page sends the answer's text to `POST /api/speak`; the server calls Cloud Text-to-Speech as itself and returns an MP3. It has the co-pilot's guards (this site's pages only, POST only, 6 a minute and 60 a day per visitor), takes at most 900 characters, removes everything that isn't sentence text, and stops at 200 texts a day for everyone together. Asking out loud uses the browser's own speech recognition. Sound is off until the visitor turns it on | `web/server/voice/speak.ts`, `web/src/lib/voice.ts`, `web/src/lib/listen.ts`, `web/src/scout/useVoice.ts` | A natural voice is paid for by the character, so it has a hard ceiling: at most 180,000 characters a day, $5.40 at the list price. Past that, or when the service fails or is switched off, the browser's own voice takes over and sounds different. A spoken text is kept for a day in the shared cache, keyed by the cleaned sentence, so the briefing's captions are paid for once a day however many people play it; a kept text counts only against the visitor's minute, not the day's ceiling. A changed voice setting takes up to a day to be heard on texts already kept. Speech recognition belongs to the browser: some have none (the microphone is then hidden), and some send the sound to their maker. Text-to-Speech has no access role to grant (none is in its documentation or in the project's list of permissions): switching the API on is what lets the server call it, so the endpoint's own limits are the guard on cost. Tried as a developer so far, not yet as the server (OPEN_QUESTIONS #14) |
| **Infrastructure as code** | Everything above is Terraform. Since Phase 5.5 a pull request shows its plan as a comment and a merge to `main` applies it from GitHub Actions, with no approval click | `infra/`, `.github/workflows/terraform.yml` | A destroy guard and a nightly drift check stand in for the reviewer (Phase 7 table below). A merged change that grants access is applied without anyone reading it: that is the price of "autonomous", written down in `docs/decisions/0007-terraform-through-github.md` |
| **Deploying a service with no visitors** | The worker deploys by itself, only when its files, the shared folder or the site data changed since the commit that is live. The new version starts with no messages and is tested on its own address as the deployer: it must refuse a caller with no identity, report this commit and its data version, refuse a message from anyone but Pub/Sub, and count one made-up event twice in the real database (added once, refused once). Then it gets every message. A failed step sends messages back to the previous version | `.github/workflows/deploy-events-worker.yml`, `web/scripts/worker-check.mjs` | There is no "a tenth" step. About one question arrives every nine minutes, so a minute of watching a tenth of the messages would see none, and the pipeline cannot send its own: a test message on the real topic would land in the question log and the counts. Going from none to all is safe here in a way it is not for the site, because a message a bad version fails is sent again and counted once |
| **CI/CD, canary deploys, rollback** | Tests on every PR; a merge deploys each service that changed, in steps: the new version runs with no visitors and is tested (the co-pilot's is also asked two set questions), then takes a tenth of the requests for a minute, then all. From Phase 6 every test goes through the load balancer: the new version is tagged `canary`, and a plain, documented header (`x-clps-canary: web`, `plans` or `copilot`) sends a request to it. The web server's last test goes through the public address, where both other services must answer. A failed step sends everyone back to the previous version automatically | `.github/workflows/deploy.yml`, `web/scripts/canary.mjs`, `web/scripts/canary-header.mjs`, `infra/canary.tf` | The minute of watching uses requests the pipeline sends itself, because a demo has too few visitors for their error rate to mean anything. A busy site would read real error rates from monitoring instead. Files are named for their build and each version holds only its own, so a page from one version can ask another for a file it doesn't have: the page then checks which build is live and reloads once (`web/src/data/staleBuild.ts`) |
| **Monitoring** | An uptime check from several regions with an email alert, and a budget alert | `infra/monitoring.tf` | Tells us it is down, not why |

## Plans in DynamoDB, on paper

**This is a design, not something built here.** The app runs on Google Cloud and keeps plans in Firestore.
This section says how the same plans would be kept in Amazon DynamoDB, so the two can be compared and drawn
from memory. The hands-on table belongs in Rodrigo's `aws-platform-terraform` repository, where a DynamoDB
table is already on the roadmap; nothing in this repository creates one. Facts about DynamoDB below come
from AWS's documentation, listed in `REFERENCES.md`; none of it was run.

### The four needs, side by side

| Need | Firestore (built) | DynamoDB (on paper) |
| --- | --- | --- |
| Open a shared plan by its link | Document id = plan id | Table partition key = plan id |
| My plans, newest first | Composite index on `owner`, `created` | A global secondary index: partition key = `owner`, sort key = `created` |
| Delete after six months | Time-to-live rule on `expires` | Time-to-live attribute `expires` |
| Spreading load | Automatic, by ranges of document id; random ids spread new plans | By a hash of the partition key. One owner with a huge number of plans, or saving very fast, would be a hot partition of the index |

### The table

Table `plans`, on-demand capacity.

| Attribute | Type | Role |
| --- | --- | --- |
| `id` | String | **Partition key** of the table. The same random 8-letter id. No sort key |
| `owner` | String | The sign-in fingerprint. Left out for a plan saved without signing in, so that plan is not in the index at all (a global secondary index only holds items that have its key attributes) |
| `createdId` | String | `<created ISO time>#<id>`, for example `2026-11-12T10:20:30.123Z#k3m9p2qr`. The index's sort key. ISO times in UTC sort correctly as text, and the id on the end makes every key different, so two plans saved in the same millisecond still have a fixed order. AWS's page says items with equal index keys come "in no particular order". A newer option is a multi-attribute sort key of `created` and `id`, which avoids building the string by hand |
| `title`, `note`, `view`, `brief` | String | As today; `brief` as JSON text |
| `created` | String | ISO time, for showing |
| `expires` | **Number** | Unix time in **seconds**. The time-to-live attribute. DynamoDB's TTL ignores an attribute that is not a Number in epoch seconds, where Firestore wants a timestamp |

Global secondary index `by-owner`: partition key `owner`, sort key `createdId`, projection `INCLUDE`
`title`, `created`, `expires`. The list needs exactly `id`, `title`, `created` and `expires`; the table's key
(`id`) is always projected. `KEYS_ONLY` would make each page a second trip (`BatchGetItem`) for the titles;
`ALL` would copy the note, the view and the brief into the index for nothing.

### What each need runs

| Need | Call |
| --- | --- |
| Open by link | `GetItem` with `Key = {id}`. The table supports a strongly consistent read here if wanted |
| My plans, first page | `Query`, `IndexName = by-owner`, `KeyConditionExpression = owner = :me`, `ScanIndexForward = false` (newest first), `Limit = 20`, `FilterExpression = expires > :now` |
| My plans, next page | The same, plus `ExclusiveStartKey` = the `LastEvaluatedKey` of the page before |
| Save | `PutItem` with `ConditionExpression = attribute_not_exists(id)`, so a taken id is refused, as Firestore's "must not exist" does today |
| Delete | `DeleteItem` with `ConditionExpression = attribute_exists(id) AND #owner = :me`, so only the owner can delete, in the same call. With `ReturnValuesOnConditionCheckFailure = ALL_OLD`, a refusal that returns the item is someone else's plan (403) and one that returns nothing is a plan that does not exist (404), the two answers the API gives today |
| Delete after six months | TTL on `expires`; nothing is called |

### Paging

DynamoDB pages by itself: a `Query` returns at most `Limit` items or 1 MB, and a `LastEvaluatedKey` when it
stopped at that edge. For an index, that key holds the index's keys and the table's: `owner`, `createdId` and
`id`. Three differences from the Firestore version:

- **A `LastEvaluatedKey` does not promise more.** AWS: "If `LastEvaluatedKey` is not empty, it does not
  necessarily mean that there is more data in the result set." With exactly 20 plans left, a page of 20
  comes back with a key, and the next page is empty. The Firestore code asks for one extra plan to avoid
  that; here the same trick (`Limit = 21`, return 20, build the marker from the 20th) works.
- **The key holds the owner.** Sent to the browser as it is, it would give away the owner fingerprint, which
  the Firestore marker never contains. The service should send only `createdId` and `id`, and add the owner
  back from the sign-in when it builds `ExclusiveStartKey`. That also means a marker can never point into
  someone else's list.
- **Expired plans count against the page.** TTL deletes "typically within a few days" of expiry, against
  Firestore's "typically within 24 hours", and until then expired items are still returned. The
  `FilterExpression` hides them, but it is applied after `Limit`, so a page can come back short or even empty
  with a `LastEvaluatedKey`. The caller keeps following the key; the page shows what it got.

### Time to live

TTL on `expires`. Deletions cost no write capacity. They reach the index the same way as any delete. Because
they can lag by days, every read that must not show an expired plan checks `expires` itself: `GetItem`
followed by a check in code, and the `FilterExpression` on the list. The Firestore code already distrusts
`expires` the same way for idempotency keys.

### The hot partition

Each partition of a table or index is designed for at most 3,000 read units and 1,000 write units a second
(AWS). The table is keyed by a random id, so its writes spread evenly. The index is keyed by `owner`, so all of
one person's plans share one index partition key. One person saving more than about 1,000 plans a second, or
listing their plans thousands of times a second, would be throttled on that key. Worse, if an index cannot
keep up with writes, **writes to the table are throttled too** (AWS: "the write activity on the table will be
throttled"). At this app's limits (5 saves a minute per visitor, 300 a day in all) it cannot happen. If it
could, the textbook fix is write sharding: an index key of `owner#<0 to N-1>`, a write picks one, and the list
queries all N and merges them newest first, which makes paging a merge of N cursors.

### The index is eventually consistent

A global secondary index is updated after the table write, "within a fraction of a second, under normal
conditions", and only eventually consistent reads are offered on it. So a plan saved a moment ago can be
missing from the list read straight afterwards. The share dialog does exactly that: it reads the list again
after a save. With DynamoDB, the page would put the new plan at the top of the list itself, or the service
would add it from the save's answer. Firestore's queries are strongly consistent, so the built version does
not need this.

### Idempotency keys

Today's design (decision 0003) writes the plan and the key's record in one atomic Firestore commit, each with
a "must not exist" condition. In DynamoDB the same is one `TransactWriteItems` with two `Put`s:

1. The plan, `ConditionExpression = attribute_not_exists(id)`.
2. The key's record in a table `idempotency` (partition key `key`, the hash of the header; attributes `plan`,
   `fingerprint`, and `expires` as epoch seconds with TTL), with
   `ConditionExpression = attribute_not_exists(#key) OR expires < :now`.

Both are written or neither. If either condition fails, the call fails with `TransactionCanceledException`,
and its `CancellationReasons` say which item failed (`ConditionalCheckFailed` on the first, the second, or
both), in the order of the items. So the service knows, without a second read, whether the id was taken (try
another id) or the key is on record (read the record with `GetItem` and replay the first answer or refuse
with 422). The `OR expires < :now` replaces Firestore's "replace exactly this expired record" check: a key
whose record has expired but not yet been deleted may be used again.

A transaction costs twice the write units of the two plain writes. The cheaper alternative, a single
conditional `PutItem` of the key's record before the plan, leaves a window where the key is recorded and
the plan is not, which is the problem decision 0003 exists to avoid.

Not to be confused: `TransactWriteItems` has its own `ClientRequestToken`, which makes the same call safe to
send again for 10 minutes. That covers a retry of one call between the service and DynamoDB. The
`Idempotency-Key` from the page covers a retry by the visitor, across copies of the service, for 24 hours.
Both can be used together.

## The architecture plan, written up (Phase 7)

Phases 0 to 5.5 of the architecture plan split the one server into four services, gave Redis a read replica
for a measured window, added the "my plans" index and moved Terraform into GitHub. This section is the whole
picture after them, one row per topic the work added, and a capacity estimate. Every number in it comes from
the phase documents, the decision records or [`ARCHITECTURE_RESULTS.md`](ARCHITECTURE_RESULTS.md), which puts
the Phase 0 numbers beside the later ones. Phase 6 (closing the services' `run.app` addresses, tiles and video
from a backend bucket) was being built when this was written, and Phase 8 (a second region) was not started:
neither is described as built here.

### The whole system

The short diagram at the top of this file shows the request paths. This one shows everything.

```
 GitHub Actions (keyless: Workload Identity Federation, three identities, no stored key)
   CI on every pull request ── four deploy workflows on main: no visitors, a tenth, everyone, rollback
   terraform.yml: plan on a pull request (planner, read-only) ── apply on main (applier) after the destroy guard
   terraform-drift.yml: plan main every night, open an issue if the project differs
        │ images (Artifact Registry)                   │ infrastructure (state in a bucket, with a lock)
        ▼                                              ▼
 visitor ─► Cloud Armor edge firewall: 120 API calls a minute per address, counted per backend
              │
              ▼
 global load balancer + CDN + TLS: one origin; the URL map sends each path to its service
   ├─ /api/plans, /api/plans/* ────────► plans ──────► Firestore "plans": plans, idempotency keys,
   │                                                     index (owner asc, created desc)
   ├─ /api/chat, /api/chat/*, /api/ask ► copilot ────► Anthropic API (Claude), behind retries and a breaker
   │                                       ├─► Cloud Storage: the light grid only
   │                                       └─► outbox (Redis) ─► Pub/Sub topic ─┬─► BigQuery: question log, 90 days
   │                                                                             ├─► push, signed ─► events-worker
   │                                                                             │     (private) ─► Firestore "stats":
   │                                                                             │     seen ids, 8 counter shards a day
   │                                                                             └─► dead-letter topic after 5 tries
   └─ everything else ─────────────────► web ──► Cloud Storage: tiles, video
                                           ├──► Text-to-Speech; Firestore "stats", read-only
                                           └──► plans, copilot: status only, identity token, 1 s

 Redis (Memorystore; during the window: Standard, a primary in one zone and a read replica in another)
   primary: every write, rate limits, the breaker, single-flight locks, the outbox, hit counters, rooms
   read endpoint: kept answers and kept audio only (web and copilot); plans uses the primary; the worker none

 Data pipeline (Python, offline) ─► static JSON ─► baked into the web, plans and copilot images;
   each reports a hash of it (the data version), and a deploy fails if two services differ
 Every service writes traces to Cloud Trace; a trace crosses the queue in a message attribute
```

### Topics the split added

Each row says what was built, what was measured on the live project (or "laptop" where it was not), and the
trade-off. Rows that also appear in the table above add the numbers here.

| Topic | Here | Measured | Where | The trade-off |
| --- | --- | --- | --- | --- |
| **Four services, not one and not ten** | `web`, `plans`, `copilot`, `events-worker`. Each has its own image, identity, copy limit, deploy, status address, objectives or alerts, and decision record. Voice, tiles, rooms, sign-in and rate limits stayed in `web` | The split did not make a visitor's request slower: opening a plan 178 ms before, 157 to 188 ms after; a kept answer 201 ms before, 200 to 217 ms after | `docs/decisions/0001` to `0004` | Each split has a defended reason (owns a database; seconds-long paid calls; work that arrives by message). The price: four deploys, a cold start per service, shared code and data that redeploy several services, pages and APIs a version apart. Each record says what would merge it back |
| **Routing at the load balancer, not service to service** | The URL map sends each path to its service. No service calls another to answer a visitor | A route change reached this laptop in 1 min 24 s to 3 min 45 s; for a while both old and new answered. 0 of 124 plan requests failed during two changes | `infra/domain.tf`, `infra/plans.tf`, `infra/copilot.tf` | No chain of calls to slow down or fail, one origin for the browser. A route change is not instant, so a move needs both sides able to answer (expand, move, contract) |
| **Expand, move, contract** | Grant the new identity and deploy it with no traffic; move the route; only later remove the old grant and code. Three applies per service, each small | The plans move: 13 added, then 1 URL map change, then 1 grant destroyed. The contract step shrank the web server's bundle from 179,410 to 53,374 bytes | `docs/ARCHITECTURE_PHASE_2.md`, section 2 | Every step can be undone in one line, until the contract step: after it, going back needs an older web revision first |
| **Synchronous and asynchronous calls** | Synchronous: the visitor waits (pages, plans, the co-pilot, the status call). Asynchronous: the co-pilot publishes a question event and returns; Pub/Sub delivers it to BigQuery and the worker later | The worker's count took a median of 73 ms, and no visitor waited on it. With the worker paused, two events waited and were counted on their third try | `web/copilot/outbox.ts`, `web/events-worker/` | A queue decouples failure and speed, and brings at-least-once delivery, retries and a dead-letter topic, so the consumer must be idempotent |
| **At-least-once delivery, and what it forces** | Pub/Sub delivers each message at least once. The worker is an idempotent consumer, the outbox may send twice, a dead-letter topic takes what fails 5 times | The same event sent twice counted once. A malformed message was tried 5 times in 7 minutes and reached the dead-letter subscription about 10 minutes after it was sent; the alert email came about 8 minutes after the first copy reached it | `docs/ARCHITECTURE_PHASE_1.md`, section 6 | Exactly-once effects cost a record per event (7 days). The BigQuery log is not idempotent: a duplicate is a second row with the same `id` |
| **Service-to-service identity, no password** | The web server's `/api/status/services` asks plans and the co-pilot for their status with a short-lived Google identity token (audience the service's name). Each service checks the signature, the audience and that the caller is `clps-web`, in code. Pub/Sub pushes to the worker with a token for a push identity | Both services answered `"checkedAs": "web"`; no token: `401 missing`; a person's token: `401 invalid` | `web/shared/statusCaller.ts`, `web/server/services.ts`, `infra/worker.tf` | Nothing to store or rotate. Checked in code because a public service cannot guard one path by permission; the deployer's project-wide role can call the worker, so the worker checks the caller itself too |
| **A contract per API; pages and APIs a version apart** | `API.md` and a contract test for plans and the co-pilot; changes additive only; the page ignores fields it does not know. Every service reports its data version, and the co-pilot its code version | The paging change (Phase 5) shipped as one optional request part and one optional reply field; an old page gets the old reply | `web/plans/API.md`, `web/copilot/API.md` | Every field is written down before it ships, and removing one takes two releases |
| **A trace across services and the queue** | The load balancer's trace id is joined by each service; the publisher writes the trace into a message attribute (`traceparent`), so the worker's step hangs under the visitor's request | 9 of 9 co-pilot requests asked after the push subscription existed showed the worker's step inside the visitor's trace | `web/shared/trace.ts` | Hand-written (no OpenTelemetry). A queue has no headers, so the trace is carried by hand |
| **Primary and replica; failover** | During the window: Standard tier, one read replica in another zone. Writes, scripts and limits on the primary; kept answers read from the read endpoint, falling back to the primary, then memory | Switched on with no visible downtime. Manual failover: `gcloud` took 74 s; every service `reconnecting` for at most 12.0 s; 6 of 151 room calls failed (`503`); 19 of 19 kept answers at about 200 ms; plan reads and status calls 151 of 151 | `web/shared/redisClient.ts`, `web/shared/redisStore.ts`, `docs/ARCHITECTURE_RESULTS.md` | Replication is asynchronous: a replica can lack an answer but never hold a wrong one (the key names code and data). Limits never read there. Rooms keep no memory fallback, so they are what fails |
| **Expiry with jitter; a cache stampede** | Every cache write lasts its base time plus or minus 10% | Laptop: twelve answers written in one second expired between 22.1 and 25.5 hours | `web/shared/jitter.ts` | Spreads misses in time. Rate-limit windows keep exact times |
| **One recompute per key ("single flight")** | A lock in Redis lets one request work out a missing answer; the others wait for it | Laptop: 24 identical first questions made one question's worth of model calls (1 led, 23 waited). Not yet seen with real visitors | `web/shared/singleFlight.ts` | Three small Redis calls for a request that is alone. A waiter gives up after 10 s and pays for its own call |
| **Hit rates per kind of key** | A counter per day in Redis, per kind and outcome | Before the window: 12 reads of kept answers, 4 hits (33.3%), three hours after the Phase 4 deploy. Redis memory 6.4 MB of 1 GB, 13 clients | `web/shared/cacheStats.ts` | One write per read. Lost with the instance, so read before each replacement |
| **Random ids, and the limit on a sequential index** | Plan ids are 8 random letters; a test pins it | Live traffic is 9 saves in 16 h 25 min; the app's ceiling is 300 saves a day. Google's limit for a collection with a sequentially indexed field is about 500 writes a second | `web/shared/ids.ts`, `docs/decisions/0005-plans-index-and-paging.md` | Random ids spread writes over Firestore's key ranges; a timestamp id would put every new plan on one. `created` and `expires` are still indexed timestamps, so the 500 a second cap applies, millions of times away |
| **Partition key and sort key, and the Firestore equivalent** | Firestore: document id = plan id; one composite index `owner` ascending, `created` descending. DynamoDB, on paper: partition key `id`; a global secondary index with partition key `owner`, sort key `createdId` | Index built in 5 min 52 s; Query Explain names it | `infra/data.tf`, "Plans in DynamoDB, on paper" above | Firestore queries are strongly consistent; a DynamoDB index is eventually consistent |
| **Cursor paging** | `next` holds the last plan's time and id; the next page starts after those values | 205 plans: pages of 100, 100 and 5, each plan once | `web/plans/cursor.ts` | Stable when plans are added or deleted between pages; cannot jump to page 7 |
| **Idempotency keys** | The plan and its key's record are one atomic Firestore write | A replay got the first id; four saves at once with one key made one plan | `web/plans/idempotency.ts` | One more document per save |
| **Transactional outbox** | The co-pilot writes the event to Redis before answering, publishes, and removes it once Pub/Sub has it | The outbox step: median 2 ms, at most 6 ms. An event that fails to publish and is sent later by the timer has not been seen live | `web/copilot/outbox.ts` | The textbook outbox shares a database transaction; there is no business write here, so this is the half that removes the loss. Redis Basic keeps nothing on disk |
| **Sharded counters** | Each day's count split over 8 documents, picked by a hash of the event id, added up on read | Not load-tested: real traffic would fit in one document | `web/shared/stats.ts` | More writes at once, and every read costs 8 document reads |
| **Circuit breaker, retries with jitter, `Retry-After`** | Up to 3 tries with full jitter; after 5 failed model calls in 60 s, across every copy (state in Redis), questions are refused at once for 30 s, then one trial | Drill: five failures opened it; the sixth question was refused in 0.18 s with `Retry-After: 30`; the trial through the real model answered in 5.1 s and closed it. The breaker's alert email did not arrive, not yet explained | `web/copilot/breaker.ts`, `web/copilot/modelCall.ts` | A visitor in the 30 s after five failures is refused even if the model has recovered. A count, not a percentage, because a quiet minute holds one or two questions |
| **Fault injection** | The load balancer can delay or abort a share of the co-pilot's requests, from a Terraform setting | Every request aborted: pages, tiles, plans all answered (a page in 0.08 s); the page said "busy" and counted down. Half held 8 s and half aborted: 75 of 75 page loads and 75 of 75 plan opens answered | `infra/copilot.tf`, `docs/ARCHITECTURE_PHASE_3.md`, section 7 | It proves the bulkhead and the page's handling. It never reaches the service's own model call, so the breaker needed its own drill |
| **The destroy guard** | Between plan and apply, the apply stops if the saved plan deletes or replaces anything on a protected list, unless the same commit names it in `expected-removals.txt`. `prevent_destroy` on what cannot be made again | A test pull request setting `shared_store = false` was stopped, naming `google_redis_instance.store[0]`. The Redis replacement went through because its pull request named it | `infra/scripts/destroy-guard.mjs`, `infra/protected-resources.txt` | It stops accidents, not intent: it lives in the repository, and a pull request can change it |
| **Drift** | Every night, plan `main`; if not empty, open an issue; close it when a later plan is empty | A retention change made by hand opened an issue; a Mac apply put it back and the next run closed it | `.github/workflows/terraform-drift.yml` | It reports, it does not repair. A person decides whether the code or the project is right |
| **Plan and apply as two identities** | A planner that can only read (pull requests and `main`) and an applier that only `terraform.yml` on `main` can become | The first plan comment had neither personal value in it; the merge applied with no laptop (0 added, 4 changed); a plan right after said "No changes" | `infra/pipeline.tf`, `docs/decisions/0007-terraform-through-github.md` | The applier can grant itself any role: treat it as a project owner. A merged access change is applied without anyone reading it |
| **Multi-region serving; what regional data costs you** (Phase 8) | Copies of `web`, `plans` and `copilot` in us-central1, each a second backend of its service's backend service: the load balancer sends a visitor to the nearer region. Serverless backends have no health checks, so outlier detection on the three backend services sets a region aside after 3 gateway failures (502, 503, 504) in a row, per proxy, for 30 s and longer each time, never both regions. Redis, both Firestore databases, Pub/Sub, the worker, the bucket and the registry stay in us-east4 | Built and planned read-only on 2026-11-13; not applied. Idle price about $0.04 an hour for three warm copies, at us-east4's recorded price (us-central1's not recorded). A copy's every call to Redis or Firestore is at least 15.5 ms longer (1,578 km at the speed of light in fiber); not yet measured | `infra/second-region.tf`, `docs/ARCHITECTURE_PHASE_8.md`, `docs/decisions/0010-second-region.md` | Serving survives a region; data does not. A loss of us-east4 leaves pages, the co-pilot and the voice answering (limits in each copy's memory) and loses saved plans, the day's counts, rooms and deploys. Outlier detection learns from failures, so some visitors get the first ones. Keeping data in two regions means a multi-region Firestore (a new database: a location is fixed when a database is made), Redis per region or a replicated one, a multi-region bucket and registry |
| **Containers without managing machines: ECS, EKS, Fargate, Cloud Run, GKE** | Cloud Run here. ECS is Amazon's own container system; EKS is Amazon's Kubernetes; Fargate runs either without machines to manage. Cloud Run is the closest thing to ECS on Fargate; GKE is Google's Kubernetes | Nothing measured: a naming row | `infra/main.tf` | Kubernetes was considered and dropped (plan Version 2); Cloud Run is the equivalent built |

### Capacity estimate: 10 thousand and 1 million visits a day

A back-of-the-envelope estimate. Every input is either a number the docs record or an assumption stated here;
every result shows its arithmetic. Prices are the ones the docs record (`ARCHITECTURE_BASELINE.md` 1.5,
`REFERENCES.md`, `ARCHITECTURE_PHASE_4.md` section 5); where none is recorded the line says
**price not recorded** and gives the formula.

**The assumptions.**

| # | Assumption | Value | Where it comes from |
| --- | --- | --- | --- |
| A1 | A visit is one request for `/` | 2,583 visits in 16 h 25 min | The baseline's load balancer log (1.2) |
| A2 | Requests per visit | 24,995 ÷ 2,583 = **9.7** | Same log. Most of it is the team and the deploy pipeline, not visitors. A visit that opens the 3D view asks for about 80 tiles on its own, so a heavy visit is many times this |
| A3 | Bytes per visit | 2,060.4 MB ÷ 2,583 = **0.80 MB**, of which 47.4% from the CDN | Same log (1.3) |
| A4 | Requests answered by the CDN | 21.5%; so 78.5% reach Cloud Run | Same log (1.3) |
| A5 | Per visit: co-pilot questions, typed questions, voice texts, plan opens, plan saves | 68, 43, 46, 41 and 9 ÷ 2,583 = **0.026, 0.017, 0.018, 0.016, 0.0035** | Same log (1.2). Real visitors may ask far more or less |
| A6 | Share of co-pilot questions answered from the cache | **1 in 3** (4 of 12) | Phase 4's counter. The baseline's question log had 8 of 158 (5%): with that, the co-pilot's model cost below is 1.4 times higher |
| A7 | Model cost per uncached co-pilot question | $4.83 ÷ 158 = **$0.031** | The baseline day's model spend (1,935,888 tokens in and 213,857 out at $1.50 and $9.00 per million) charged to that day's 158 questions. An upper bound: it includes developers' servers and the deploys' questions |
| A8 | A typed question is one model call, not cached | $4.83 ÷ 526 calls = **$0.0092** a call | `web/copilot/ask.ts` makes one call (with retries); the average call of the baseline day |
| A9 | Traffic is even over the day | | No peak-to-average ratio has been measured. Peaks are discussed under "what breaks first" |
| A10 | Cloud Run busy time per request reaching it | 2,072 s ÷ 19,614 requests = **0.106 s**, at $0.000024 per CPU-second and $0.0000025 per GiB-second (1 CPU, 512 MiB): $0.00002525 a second | The baseline (1.5): the sum of request times in the log. It includes the 55 s follower streams and the co-pilot's seconds, and it ignores overlap, so it is an upper bound |

**Requests and work per day.**

| | 10,000 visits a day | 1,000,000 visits a day |
| --- | --- | --- |
| Requests at the load balancer (A2) | 9.7 × 10,000 = **97,000**: 1.1 a second | 9.7 million: **112 a second** |
| Requests reaching Cloud Run (A4) | 76,000: 0.9 a second | 7.6 million: 88 a second |
| Bytes sent (A3) | 0.80 MB × 10,000 = 8.0 GB: 3.8 GB from the CDN cache, 4.2 GB from behind it | 798 GB: 378 GB from the cache, 420 GB from behind it |
| Co-pilot questions asked (A5) | 0.026 × 10,000 = **263** | 26,300 asked; **1,500 answered** (the daily ceiling for everyone) |
| Of those, worked out by the model (A6) | 263 × 2/3 = 175 | 1,500 × 2/3 = 1,000 |
| Typed questions (A5) | 166 | 16,600: 11.6 a minute on average, under the 30 a minute ceiling |
| Voice texts asked (A5) | 178, against a ceiling of 200 a day for texts not already kept | 17,800 asked; 200 spoken by the server; the rest fall back to the browser's own voice |
| Plan opens and saves (A5) | 159 opens, 35 saves | 15,900 opens; 3,500 saves asked, **300 saved** (the daily ceiling) |
| Events through the queue and the worker | 263 | 1,500 |

**Cost per day.**

| Item | Formula | 10,000 visits | 1,000,000 visits |
| --- | --- | --- | --- |
| Redis, Basic, 1 GB | $0.049 × 24 h | $1.18 | $1.18 |
| (Redis, Standard, 5 GB with a replica, if it were kept) | $0.27 × 24 h | ($6.48) | ($6.48) |
| Load balancer, two forwarding rules | $0.025 × 24 h | $0.60 | $0.60 |
| (A second region, if it were kept: three warm copies in us-central1, Phase 8) | 3 × 1.5 × $0.0000025 × 86,400 s = 3 × $0.324, at us-east4's price; us-central1's not recorded. Plus bytes between the regions for every Redis and Firestore call from a copy: **price not recorded** | ($0.97) | ($0.97, and the busy time below is shared between the regions, not added) |
| Edge firewall policy | $9 a month | $0.30 | $0.30 |
| Domain | $12 a year | $0.03 | $0.03 |
| Three copies kept warm while `min_instances = 1` | 3 × $0.32 | $0.96 | in the busy time below |
| Edge firewall and CDN, per request | requests × ($0.75 + $0.75) per million | $0.15 | $14.52 |
| CDN, bytes from its cache | GiB × $0.08 | 3.5 GiB: $0.28 | 352 GiB: $28.17 |
| Bytes from behind the CDN, and the load balancer's per-GiB charge | GB × price | 4.2 GB: **price not recorded** | 420 GB: **price not recorded** |
| Cloud Run, requests | requests reaching it × $0.40 per million | $0.03 | $3.04 |
| Cloud Run, busy time (A10) | requests × 0.106 s × $0.00002525, but never more than copies × 86,400 s × $0.00002525 ($2.18 a copy, $6.54 for three) | at most $0.20 | the formula gives $20.26, above the web server's cap; so **$2.18 to $6.54** for the web server, plus cents for the others |
| Model, co-pilot (A7) | uncached questions × $0.031 | 175 × $0.031 = $5.37 | 1,000 × $0.031 = $30.57 ($45.85 if none came from the cache) |
| Model, typed questions (A8) | typed × $0.0092 | 166 × $0.0092 = $1.53 | 16,600 × $0.0092 = **$152.86** |
| Voice | at most $5.40 a day (180,000 characters); at most 900 characters, $0.027, a text | at most 178 × $0.027 = $4.81 | $5.40 (the ceiling) |
| Firestore | reads $0.033, writes $0.099, deletes $0.011 per 100,000 | under $0.01 | about $0.01 (15,900 reads, 3,600 writes, about 2,000 deletes by time-to-live rules) |
| Pub/Sub, BigQuery storage and queries, Cloud Logging, Cloud Trace | | **price not recorded** | **price not recorded** (the load balancer logs every request: 9.7 million log entries a day) |
| **Total of the priced lines** (Basic Redis) | | **about $15 a day** | **about $243 a day**, 63% of it the typed-question box |

**Storage.**

| What | 10,000 visits a day | 1,000,000 visits a day | Note |
| --- | --- | --- | --- |
| Plans (kept 180 days) | 35 a day × 180 = 6,300 documents | 300 a day (the ceiling) × 180 = **54,000 at most** | Document size not recorded |
| Idempotency keys (kept a day) | about 35 | at most 300 | |
| `stats`: seen records (7 days) and 8 shards a day | 263 × 7 = 1,841 | 1,500 × 7 = 10,500 | |
| Question log rows (90 days) | 263 × 90 = 23,700 | 1,500 × 90 = 135,000 | Typed questions are not logged. Row size and BigQuery's price not recorded |
| Redis | 6.4 MB measured at today's traffic | **Not estimated.** Bytes per key are not recorded, and 6.4 MB includes Redis's own overhead, so it cannot be scaled up in a line. Bounded by design: kept answers at most the questions answered in a day, new audio at most 200 a day, one limit key per visitor per limit, each expiring with its window | |
| Bucket and image registry | 1.98 GB of tiles and video, 159 MB of light grid, 2,010 MB of images | the same | Does not grow with visitors |

**The limits that bind.**

| Limit | Value | At 10,000 visits a day | At 1,000,000 visits a day |
| --- | --- | --- | --- |
| Co-pilot, for everyone (`web/copilot/limits.ts`) | 30 a minute, 120 a day (1,500 until the move to Claude, decision 0009) | 263 asked a day: **the 120 bind**, after about 11 hours of even traffic (120 ÷ 0.18 a minute) | 26,300 asked: the day's 120 are used after about **7 minutes** of even traffic (120 ÷ 18.3 a minute) |
| Co-pilot, per visitor | 6 a minute, 20 a day (60 until decision 0009) | Not binding | Not binding |
| Typed questions, for everyone and per visitor | 30 and 10 a minute; 150 and 30 a day (no daily ceiling until decision 0009) | Not estimated | Not estimated |
| Typed questions | 10 a minute per visitor, 30 a minute for everyone, **no daily ceiling** | 0.1 a minute | 11.6 a minute; peaks over 30 refused. At 30 a minute all day: 43,200 questions, about **$397 a day** |
| Voice | 6 a minute and 60 a day per visitor, 200 texts a day for everyone | 178 asked: **89% of the ceiling** | The 200 are used after about 16 minutes (200 ÷ 12.4 a minute) |
| Plan saves | 5 a minute per visitor, 300 a day for everyone | 35 | The 300 are used after about 2 hours (300 ÷ 2.4 a minute) |
| Edge firewall | 120 API calls a minute per address, per backend; a ban above 3,000 requests a minute | Not binding per visitor. A room on one Wi-Fi shares an address: about 20 phones following a presenter are comfortable and 30 is the edge | The same, and any office or mobile carrier that puts many people behind one address |
| Cloud Run copies | web 3 × 80 at once; plans 3 × 80; co-pilot 3 × 10; worker 2 × 20 | 0.9 a second reach Cloud Run | 88 a second on average. The one load test reached 466 a second with none failed (before the firewall, copies not recorded). A peak above about 4 times the average is past anything measured |
| Follow the presenter | 60 followers a room, 60 streams a copy, 50 rooms | Not binding | 3 copies × 60 = 180 followers at once, in all rooms together |
| Firestore | about 500 writes a second on a collection with a sequentially indexed field (Google) | Under one write a second | The same: at most 30 questions a minute (2 writes each) and 300 saves a day. The app's ceilings cap the writes, not the traffic |
| Redis | 1 GB on Basic (5 GB in the window). Connection limit: not recorded in the docs | 13 clients seen | Connections grow with copies (at most 3 per service), not with visitors. Memory: not estimated (above) |
| The model's quota | **Not recorded in the docs** | | The co-pilot's 30 a minute and the typed box's 30 a minute cap what this app can ask, several calls each for the co-pilot |

**What breaks first.**

- **At 10,000 visits a day, nothing in the request path.** 1.1 requests a second is far below anything
  measured. Since the move to Claude (decision 0009) the first ceiling to bind is the co-pilot's own: 120
  questions a day for everyone, which 263 a day exceed (it was 1,500, which bound only above 0.15 questions
  a visit). Then the voice's 200 texts a day (89%). At a demo the first things to bind are people at once, not volume: the co-pilot's 30 a minute
  when a room taps the same question (single flight makes those one model call), and the edge firewall when
  a room shares one Wi-Fi. And the cold starts, if `min_instances` goes back to 0: never measured.
- **At 1 million visits a day, the designed ceilings first, in order:** the co-pilot after about 7 minutes
  (82 before decision 0009 lowered its daily ceiling), voice after about 16 minutes, plan saves after about 2 hours. These are limits, not failures:
  visitors get "busy" with `Retry-After`, the browser's own voice, or "try later", and nothing falls over.
- **Then money:** the typed-question box has a per-minute ceiling but no daily one, so it becomes the
  largest cost, about $153 a day of about $243, and up to about $397 a day at its ceiling. A daily ceiling
  on `ask:all`, like the co-pilot's, is the first fix. The CDN's bytes are the second-largest line.
- **Then capacity at peaks:** the web server's three copies (88 requests a second on average, against one
  load test of 466 a second), and follow the presenter's 180 streams. Raise `max_instances` from a load
  test, not from this table.
- **Not Firestore, Pub/Sub or the worker:** the ceilings keep their work to hundreds or a few thousand
  writes a day.

What this estimate does not know: real visitors' behaviour (the log is mostly the team), peaks, the price of
bytes from behind the CDN and of Pub/Sub, BigQuery and logging, Redis's bytes per key, the model's quota, and
the cold starts.

## Measured

- **Load:** 466 requests a second from one machine (20 parallel workers, 20 seconds, 9,386 requests, none
  failed). Median 36 ms, 95% under 114 ms, 99% under 137 ms. Run before the edge firewall was switched on, which
  would now refuse that much from one address. Script: `web/scripts/load.mjs`; it never calls the paid endpoints.
- **Answer cache:** the same co-pilot question, live: 4.3 s the first time, 0.06 s the second.
- **Co-pilot:** 12 of 12 set questions pass on the live site (`web/scripts/chat-eval.mjs`), in 2.4 to 13.3 s each. With a thirteenth added (ground tapped on the Atlas), 13 of 13 passed on 2026-11-12, in 0.2 to 10.5 s; three of those came from the answer cache.
- **Which model:** the same 12 questions put to four Gemini models on Vertex AI (2026-11-12, local server, all four
  at once): 3.5 Flash, the one in use, passed 12 with a median of 5.5 s; 3.8 Flash passed 9 (three ran out of time);
  the two Gemini 4 models passed 4 and 1, because a single call takes about a minute (58 s and 65 s for a one-word
  reply, measured on its own). For a chat that makes several lookups per answer, the fast model is the right one.
- **Claude, after the move** (decision 0009, 2026-11-12, local service, federation sign-in, real API): Claude
  Opus 5.5 at fast speed and low effort passed 23 of 23 set questions (the full set once, the quick set twice),
  2.5 s a question at the median and 3.6 s at p90; each model call 1.38 s at the median and 1.77 s at p90,
  about $0.037 a question. Sonnet 5.5 (standard speed) and Fable 5.2 (fast, high effort) each passed the
  quick set: 5.2 s and 2.4 s a question at the median.

### Follow the presenter (2026-11-12)

Three windows of headless Chrome 157 on one laptop (an Apple M4 Max), each a browser of its own, against the
local server with rooms in its own memory: a presenter and a follower at 1440 × 900, and a follower the size of
a phone (375 × 812). `web/scripts/follow-check.mjs` drives them and reads the pages' own clocks. 96 checks passed.

| What the presenter changed | Changes | From the change to the follower's page showing it: median / worst |
| --- | --- | --- |
| The site, month, hour or limits on Classic, Mission control, Scout, the Planner, the Atlas (and its coloring) and the Briefing; the front page, How it works and the demo video | 42 | 12 ms / 208 ms |
| The same on the Surface, and the way it faces | 7 | 438 ms / 1,264 ms |
| The tab (a page load for the presenter and then for the follower) | 11 | 86 ms / 264 ms |

Where the time goes, over all 49 changes within a page: the follower's page was told 3 ms after the change
(median) and had drawn it 7 ms later (33 ms at worst). The Surface is slower because its page rewrites its own
address a quarter of a second after the view settles, to stay inside the number of rewrites browsers allow: after
a change made with its own controls a follower trails it by 0.26 to 0.67 s, and by 1.26 s when the change came
inside the one-second gap between publishes. Dragging time for 4.3 s (40 changes) sent 6 publishes, each a second after the last, and the follower
finished on the presenter's hour. The server ended a follower's stream at 55 s; the browser had the next one open
a second later and the change made after that arrived. The QR code, read back from a screenshot of the panel by
the browser's own barcode reader, held the link.

Three things found by measuring, and fixed, which took the median over all changes from about 150 ms to 13:

- A presenter's page learned of its own address change by looking five times a second. Pages now say when they
  rewrite their address (`web/src/lib/address.ts`), and the publish starts in the same instant.
- On Classic and Mission control a new site asks for 81 terrain tiles. When those requests were made before the
  publish, the publish waited 0.4 to 1.5 s for one of the six connections a browser keeps to a site over
  HTTP/1.1, which is what the local server speaks (measured: 382 to 430 ms waiting for a connection, 0 to 3 ms for
  the server to answer). Starting the publish at once puts it first when the address is changed by a link; a
  site picked from the list whose data the page already holds may still put the tiles first. The live site
  speaks HTTP/2 through the load balancer, where requests share one connection and do not queue this way; that
  was not measured.
- The Atlas wrote "hour 0" into its address for a few milliseconds while a new site loaded. That was published,
  and the right hour then waited a second for its turn.

What these numbers leave out: everything was on one machine, so there is no network in them. On the live site a
change crosses the load balancer twice and Redis once, and the firewall and the first request to a cold copy are
in the way. The laptop was shared with other work while the runs were made; across the runs after the fixes the
median was 13 to 22 ms. Not run at all: two copies of the server on a real Redis (the tests use a stand-in that
keeps the same values, expiries and one channel, with two copies of the app sharing it), real phones, the live
site, and more than two followers in browsers at once.

**The firewall's budget.** The edge firewall allows 120 API calls a minute from one address. A presenter's page
makes at most 60 publishes a minute (only while its address keeps changing, as when time is playing), one stream
a minute, and one keep-alive every four minutes: 62 a minute at worst, half the allowance, and a handful in
ordinary use. A follower makes one call a minute (its stream being renewed) and one or two per change of tab
(the new page's stream and, on four designs, the page's own `/api/status`). The catch is a room on one Wi-Fi,
where everyone shares one address: calls a minute are about the presenter's own, plus each phone's 1, plus 2 for
each phone at each change of tab. With a change of tab a minute and the presenter not playing time, about 20
phones fit comfortably and about 30 is the edge. Past that the firewall refuses some requests: a phone asks again
by itself (after 2 s, then 4, 8, up to 30, each with its own random spread) and catches up, and the presenter's
page tries a refused publish again after 5 s; nothing breaks, but the room lags. Phones on mobile data each have
their own address and no such limit.

### WebGPU or WebGL2 for the globe (2026-11-12)

The whole-Moon globe drawn twice with three.js 0.187, from the same maps, camera and Sun: by WebGL2 as the site
does it (`web/src/three/GlobeViewer.ts`) and by WebGPU (`web/src/three/GlobeViewerGpu.ts`, the shader written
again in Three's node language). The page is `/gpu/`, on no tab; `web/scripts/gpu-compare.mjs` records it.
Headless Chrome 157 on an Apple M4 Max, 1440 × 900 at two device pixels per CSS pixel, each canvas 1378 × 1378
device pixels, each globe alone on the page, 300 frames, the middle of five loads. The right side's own readout
said WebGPU (adapter "apple metal-3") in every load.

| View | Drawn by | Processor time in the render call, ms: median / 95% | Graphics card time, ms: median / 95% | First complete picture |
| --- | --- | --- | --- | --- |
| Whole Moon | WebGL2 | 0.15 / 0.40 | 1.33 / 1.69 | 0.25 s |
| Whole Moon | WebGPU | 0.44 / 1.05 | 1.83 / 2.09 | 0.19 s |
| South pole, zoomed in | WebGL2 | 0.18 / 0.33 | 0.73 / 0.82 | 0.25 s |
| South pole, zoomed in | WebGPU | 0.47 / 0.93 | 1.02 / 1.17 | 0.19 s |

**Verdict: stay on WebGL2.** WebGPU did not make this scene smoother. It took about three times the processor
time per frame and somewhat more graphics card time, and both sides use a few percent of the 16.7 ms between two
screen refreshes, so the eye sees no difference (frames arrived every 16.66 ms on both). WebGPU's one win was the
first complete picture, 0.06 s sooner from a local server. Against that: 228 kB of JavaScript gzipped instead of
148 (`GlobeViewerGpu` 172 + `three.core` 56, against `GlobeViewer` 7 + `three.module` 84 + `three.core` 56); every
shader written again, because GLSL added through `onBeforeCompile` does not run on `WebGPURenderer` (55 lines of
GLSL and 11 of wiring became 62 lines of nodes and a 25-line import; the Atlas's light grid, 139 more lines of GLSL,
is not ported); and browsers without WebGPU get Three's WebGL2 fallback, which was slower than the plain WebGL2
globe: with WebGPU hidden from the page, 3.73 ms of graphics card time against 1.30 on the whole Moon and 2.47
against 0.77 at the pole (three loads). The two pictures match: 0.07 of 255 brightness steps apart on average on
the whole Moon and 0.02 at the pole.

What this does not show: one Mac and one browser, no phone, no Safari or Firefox; a scene with one object, where
WebGPU's strengths (many objects, work done on the graphics card besides drawing) are not used; the first-picture
time has no network in it, and on a real connection the 10 MB of maps and the extra 80 kB decide it; the two
graphics card timers are different instruments (WebGL2's `EXT_disjoint_timer_query_webgl2` around the draw,
WebGPU's `timestamp-query` around each of its two passes), so read those columns as "about the same", except the
fallback row, where both sides use the same timer. Who would get the fallback today (browser makers' own pages,
linked in `REFERENCES.md`): Firefox on Android, on Linux and on Intel Macs; iPhones, iPads and Macs whose Safari is
older than 26; Chrome on Android before 12 or on some graphics chips, and on Linux outside recent Intel and NVIDIA graphics.

## Not built (yet)

Listed so nobody claims them in an interview by accident. Each was considered; the reason it was not built is
beside it. Updated for Phase 7 on 2026-11-12.

**Planned and not finished when this was written**

- **Closing the services' `run.app` addresses, and tiles and video from a backend bucket (Phase 6).** Built
  and planned read-only on 2026-11-12, not applied: five pull requests for 2026-11-13
  (`docs/ARCHITECTURE_PHASE_6.md`, section 2). Until the last one, each public service also answers on its own
  `run.app` address, which skips the load balancer and the edge firewall.
- **A second region (Phase 8).** Built and planned read-only on 2026-11-13, not applied: seven pull requests
  for that Friday, switched off the same day unless Rodrigo keeps it (`docs/ARCHITECTURE_PHASE_8.md`, price in
  section 1). Redis and Firestore stay in one region, so a loss of us-east4 is not survived for plans, counts,
  rooms or deploys (section 9). Cloud Run's service health (readiness probes per region) was not used: outlier
  detection only learns from failures.
- **The Redis Cluster window.** Built behind `redis_cluster = false` and run only on a laptop (three shards
  in Compose: `MOVED`, hash tags, a reshard). Never applied on Memorystore.

**Considered and decided against, with the reason**

- **More services.** Voice has its own paid API but teaches nothing the co-pilot does not. Follow the
  presenter is the honest fifth candidate (it scales by open streams, not requests) and stayed in `web`
  because it had never run with two copies on the real Redis. The sign-in check and rate limits are shared
  code: a network call per request would add delay and a new way to fail (`docs/decisions/0001-four-services.md`).
- **Kubernetes (GKE or EKS).** Dropped from the plan in Version 2. Cloud Run is the equivalent built.
- **Sharding a database.** Firestore splits its own key ranges; one hot document is sharded as practice
  ("Sharded counters"). Nothing here needs a database split.
- **A clock-driven relay for the outbox.** The relay runs only while a copy has CPU. A scheduler job calling
  a private endpoint would bound how late a failed event can be, for an identity, a grant and an endpoint
  more (`docs/decisions/0002-events-worker.md`).
- **Soft expiry (`expires_at`) and refresh in the background.** A kept answer is keyed by code and data, so
  it cannot go stale, and Cloud Run gives no CPU after the response (`docs/decisions/0006-redis-replica-and-cluster.md`).
- **Single flight for the voice.** A voice call is short and cheap; the helper would take about ten lines if
  `speak` misses ever bunch.
- **Redlock or any lock with a guarantee.** Nothing here needs exactly one recompute; a lost lock costs one
  model call.
- **A percentage threshold for the breaker.** At this traffic a minute holds one or two questions, so "50%
  failed" would open it on one failure.
- **A log-based metric for hit rates.** The counters in Redis do the job at this traffic; they are lost with
  the instance.
- **A required review, an approval on the apply, or limits on which roles the applier may grant.** Rodrigo
  chose an autonomous pipeline. There is also no policy check on plans (a rule such as "nothing may become
  public") and no automatic repair of drift (`docs/decisions/0007-terraform-through-github.md`).
- **Requiring the idempotency key.** A page from before the change must keep working; it can be required
  once no such page can still be open.
- **A daily ceiling on typed questions.** Not considered until the capacity estimate above found it: the
  typed-question box has 30 a minute for everyone and no daily ceiling. It is the first thing to add if
  traffic grows.

**Never built here**

- **DynamoDB.** Designed on paper above ("Plans in DynamoDB, on paper"). The real table belongs in
  `aws-platform-terraform`.
- **OpenTelemetry.** Tracing is about 130 hand-written lines.
- **A staging environment.** One environment; a deploy's "no visitors" step is the closest thing.
- **Consistent hashing as such.** Redis Cluster uses fixed hash slots (16,384), which is what the laptop drill
  shows; a reshard moves slots between shards, not keys between slots.
