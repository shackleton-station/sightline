# Decision 0004: the co-pilot service, its circuit breaker, retries and Retry-After

**Status:** built, deployed, and steps A (expand) and B (move) applied and checked on 2026-11-12: the load
balancer sends `/api/chat`, `/api/chat/*` and `/api/ask` to the service. The contract step's code is on the
branch `arch/contract-web`: the web server no longer contains the co-pilot, and the Terraform default
`web_copilot_access = false` takes its model and topic access away when applied after that merge. The
tables below describe the code before that pull request, when the web server still imported the handlers.
The steps and results are in
[`../ARCHITECTURE_PHASE_3.md`](../ARCHITECTURE_PHASE_3.md), sections 2, 8 and 10. It follows decisions
[0001](0001-four-services.md), [0002](0002-events-worker.md) and [0003](0003-plans-service.md). Numbers
called "measured" below were run on one laptop or read from the baseline, and each says which.

## What was built

The fourth of the four services, and the one visitors use most. `copilot` is a Cloud Run service that
answers `/api/chat` (the co-pilot) and `/api/ask` (the typed-question box). The load balancer sends those
two paths, and `/api/chat/*` for its status, to it. Everything else stays where it was.

```
visitor ──► load balancer ─┬─► /api/chat, /api/chat/*, /api/ask ──► copilot ──► Vertex AI (Gemini)
                           │                                          ├──► Redis: limits, kept answers, outbox, breaker
                           │                                          ├──► Pub/Sub: question events
                           │                                          └──► Cloud Storage: the light grid's months
                           ├─► /api/plans, /api/plans/*  ──► plans
                           └─► every other path          ──► web ──(status only, signed)──► plans, copilot
```

Until the route has moved for good, the web server can still answer both paths with the same handlers,
the same limits in the same Redis keys, the same breaker and the same kept answers. That is what makes
"send the paths back" a one-line change.

## Why it is separate

- **Requests take seconds and each one costs money.** The baseline's uncached questions had a median of
  4,700 ms and a 95th percentile of 10,670 ms on the server's own clock
  ([`ARCHITECTURE_BASELINE.md`](../ARCHITECTURE_BASELINE.md) 1.1). Pages answer in tens of milliseconds.
  In one service, both share a copy's 80 slots, its timeout and its scaling. Apart, the co-pilot gets a
  copy limit, a timeout and a concurrency of its own, and the pages never wait behind a model call.
- **Only it may call the model.** After the last step, the web server, which serves every public page,
  can no longer call Vertex AI or publish question events.
- **When the model is down, pages and plans keep working.** The failure stays inside one service (a
  "bulkhead"), and the breaker below keeps that service quick to say so.

## The circuit breaker

### The problem

When the model is down or out of capacity, every question still waits for it: up to 25 s, and several
tries, before the visitor hears "busy". Each wait holds a slot in a copy, and each try adds load to a
model that is already failing. A failure upstream becomes slow failures here, and can spread to whatever
shares the copies: a *cascading failure*.

### How it works

`web/copilot/breaker.ts`. The breaker counts failed model calls. Past a threshold it *opens*: for a while
no model call is made, and every question is told at once that the co-pilot is busy, with how long to
wait. When the while is over it is *half-open*: exactly one question goes through as a trial. If the trial
works the breaker *closes*; if not, it opens again.

| From | Event | To |
| --- | --- | --- |
| closed | 5 failed model calls within 60 s, across every copy | open, for 30 s |
| open | 30 s pass | half-open: the next question is the trial |
| half-open | the trial gets an answer from the model | closed, failures forgotten |
| half-open | the trial fails | open, for another 30 s |
| half-open | the trial's copy never reports, for 15 s | the next question becomes the trial |

A *failed model call* is one that still failed after its retries: no answer in time, a dropped
connection, or 408, 429 or 5xx. A question stops at its first failed call, so one question adds at most
one failure. A 400 means our request was wrong; the model answered, so it counts as the model working.

**What the visitor gets while it is open.** The breaker is looked at before anything else costly: a kept
answer is still given (it needs no model). Otherwise the answer is `503 {"error":"busy",
"retryAfterSeconds":N}` with `Retry-After: N`, in about 5 ms on a laptop (below), before any stream
starts, so even a streamed question gets a real status and header. If the breaker opens while a question
is half answered, and facts were already looked up, the visitor gets the answer the server writes from
those facts, as before this phase; with no facts yet, a `busy` event in the stream, carrying
`retryAfterSeconds`.

### Where the state lives: Redis, one key, compare-and-set

Every copy of the service, and the web server while it can answer `/api/chat`, must agree: one copy that
has seen the model fail should stop the others calling it. So the state is one Redis key,
`clps:copilot:breaker`, holding the whole state as JSON (the state, the recent failure times, when it
reopens, when the trial expires). Each change reads it, works out the next state in code, and writes it
back only if the key still holds what was read: a *compare-and-set*, one short Lua script. A writer that
loses a race reads again and retries, up to four times. A closed breaker is read with one `GET` per model
call and written only on a failure.

The logic is written once, in TypeScript, over a small store with two operations (read, compare-and-set).
The same code runs on Redis and in memory, and the tests run two "copies" on one fake Redis.

Without Redis, or while it cannot be reached, each copy keeps its own breaker in memory: it still protects
that copy, only the copies no longer agree. Redis being slow never fails a question.

The key expires a day after its last change. A Redis restart (this Redis keeps nothing on disk) closes the
breaker, which is the safe default.

### The numbers, and what they rest on

- **5 failures within 60 s.** The baseline day held 158 questions, about 526 model calls, and one model
  failure in all ([`ARCHITECTURE_BASELINE.md`](../ARCHITECTURE_BASELINE.md) 1.1 and 1.5). Five failed
  questions in one minute is far outside that. The co-pilot's own ceiling is 30 questions a minute for
  everyone together, so at most five visitors wait out a full failure before the rest are told at once.
  A percentage over a window was not chosen: at this traffic a minute often has one or two questions,
  and "50% failed" would open the breaker on a single failure.
- **30 s open.** Long enough that a model out of capacity is not asked again at once; short enough that a
  visitor told to wait is not kept out long after it recovers. The page counts it down.
- **One trial, given 15 s.** A model call's own limit is 10 s (`ROUND_TIMEOUT_MS` in `chat.ts`).

### What it costs

One Redis `GET` per model call while closed (about a millisecond: the Phase 1 traces measured Redis calls
on this network at that). One more key in Redis. A new way to be told "busy": a visitor who arrives in
the 30 s after five failures is refused even if the model has just recovered.

## Retries with growing delays and jitter

Before this phase the co-pilot retried a failed model call once, after a fixed 1.2 s, and `/api/ask` never
retried. Both now call the model through `web/copilot/modelCall.ts`:

- **What is retried:** 408, 429, 500, 502, 503, 504, a timeout or a dropped connection. Google's retry
  guidance for this API names 408, 429 and 5xx, and says never to retry 400 or 401 (`REFERENCES.md`).
  The brief named 429, 503 and timeouts; 408, 500, 502 and 504 were added because the same guidance lists
  them, and a 400 is never retried.
- **How many:** at most 3 tries in all. A question already makes up to 5 model calls; more tries would
  mostly spend the visitor's time.
- **How long between:** a random wait between 0 and min(4 s, 0.5 s × 2^(n−1)) before try n+1: up to
  0.5 s, then up to 1 s. This is *full jitter*: the whole wait is random, so copies that failed at the same
  moment do not all come back at the same moment. If the model sent `Retry-After`, the wait is at least
  that.
- **Never past the deadline:** a try only starts if, after its wait, at least 2 s remain of the request's
  own deadline (25 s for a question, 20 s for a typed question). A `Retry-After` longer than that is not
  waited for; it is passed on to the visitor instead.
- **The breaker's trial is never retried.** It is the one question that tests the model.

The tests use a fake clock and a fixed sequence of "random" numbers, so the waits are checked exactly.

## Retry-After, and the page that obeys it

Every answer that means "not now" carries `Retry-After` in whole seconds, and the same number in the body
as `retryAfterSeconds` (a stream's `busy` event has no headers of its own):

| When | Status | The wait |
| --- | --- | --- |
| A rate limit refused | 429 | Until the oldest counted request leaves its window. The sliding-window script now returns the wait on a refusal, as a negative number, so older code that compared the answer with 1 reads it unchanged |
| The model out of capacity, after retries | 429 | What the model said, or 10 s |
| The breaker is open | 503 | Until its trial: at most 30 s |

`503 not-configured` carries none: waiting will not help.

**Why 503 for the breaker and 429 for the other two.** 429 means "you asked too often", which is true of
a rate limit and of the model's own quota. An open breaker is the service saying it is unavailable for a
while, which is what 503 with `Retry-After` means (RFC 9110). It also counts against the service's
objective, which is honest: visitors are not getting answers. The cost: a page loaded before this deploy
shows "The co-pilot isn't switched on here" for a 503 during those 30 s, where the new page says "busy".
Streamed questions, which is what the pages send, get a `busy` event that old pages already read as busy.

**The page** (`src/lib/chatClient.ts`, `src/lib/cooldown.ts`): after a busy answer it says "You can ask
again in N s", and until then it sends nothing. The Atlas's and the typed-question box's buttons say
"Wait N s" and count down. Asking anyway on Scout says how long is left, without calling the server. A 429
or 503 with no header (the edge firewall's, or the load balancer's own during a drill) waits 15 s.

## The answer cache, keyed by code and data

Today's key named the deploy (`K_REVISION`): every deploy of the site emptied the co-pilot's cache, even
one that changed nothing it uses, and two services could never share it. The key now names
`code=<hash of the co-pilot's code>;data=<data version>` (`answerKey` in `chat/handler.ts`), stored as
`clps:cache:copilot:<hash>`:

- **The code version** is a hash of every file esbuild bundles for the two handlers: the handlers, the
  prompt, the tools, the breaker and retries, and the page's own calculations they reuse
  (`scripts/copilot-version.mjs`). Libraries in `node_modules` are left out. Both images work it out at
  build time; the deploy checks the service reports the one it expects. Measured: the image built on a
  laptop and the laptop itself gave the same value for the same files (`475c484b46af465d`, for the code
  as it was at that point of the work).
- **The data version** is the hash every service already reports.

So an answer never outlives the code or the data that worked it out, and the web server and the service
share answers exactly when they run the same co-pilot code on the same data, even built from different
commits.

**One consequence for the deploy's set questions.** A deploy that changes neither the code nor the data
(a change to the workflow file, say) finds the five answers already kept. `chat-eval.mjs` now says which
answers were kept. The checks still apply to them: they passed the same checks when first worked out, by
the same code from the same data.

## The status addresses, and service-to-service identity

`GET /api/chat/status` reports the service's name, the commit, Cloud Run's revision, the data version, the
code version, which model answers, where the limits and the breaker are kept, and whether the question log
and tracing are on. It sits under `/api/chat/` because the load balancer sends this service only
`/api/chat`, `/api/chat/*` and `/api/ask`, so that is the only place it can be seen through the public
address. It cannot collide with anything: the chat is `POST /api/chat` with nothing after it. The web
server answers it 404, which is how to tell from outside who is serving the co-pilot.

**Section 6 of the plan**, built here: the web server asks `plans` and `copilot` how they are, with a
short-lived token from Google saying "I am `clps-web`".

- **A path meant for it, checked in code.** `GET /api/chat/status/web` and `GET /api/plans/status/web`
  need the token. Each service checks it itself (`shared/statusCaller.ts`): Google's signature and
  expiry, the audience is this service's own name, and the verified email is the web server's identity.
  The plan says to check in code because a public service cannot guard one path by permission; that is
  what this does. The plan's other option, a public status the web server just calls, would have needed
  no token and taught nothing about service identity.
- **The audience is the service's name** (`clps-copilot`, `clps-plans`), not its run.app address. Cloud
  Run checks a token whose audience is its own address before our code runs, and may strip its signature;
  a name it does not know leaves the check to us. Whether the metadata server issues a token for such an
  audience is not stated in Google's pages (`REFERENCES.md`); it is the first thing to see after Apply A.
- **Not `/api/status`.** The plan names `/api/status`. Every page asks that one for its sign-in setting
  and every deploy asks it every 3 s; making it wait up to 1 s on two services, and wake them, would slow
  every page and keep both services from ever scaling to zero. So the asking is at
  `GET /api/status/services`, called only by the How it works page, each service given 1 s, the answer
  reused for 10 s. `/api/status` keeps its shape.
- **What the page shows when one does not answer:** "Not answering", why (for example "no answer within
  1 s"), that a service with no copy running takes a few seconds to start, and what still works without
  it. For the co-pilot it also shows the breaker's state when the service reports it.

No secret is stored anywhere: the web server's token comes from the metadata server on Cloud Run and lasts
about an hour. Locally there is no metadata server, so the web server asks the public status instead and
says so (`checkedAs: "anyone"`).

## The settings, and what each rests on

| Setting | Value | Why |
| --- | --- | --- |
| Request timeout | 40 s | 25 s for a question's model calls (20 s for a typed question), at most 250 ms waiting for the event's publish, and the slowest start of a copy seen for the web image, 6.44 s (baseline 1.4): under 32 s. Below the web server's 60 s, which also covers long streams this service never has |
| Requests at once per copy | 10 | Requests here take seconds and cost money. The co-pilot accepts at most 30 questions a minute for everyone; 10 on each of 3 copies is 30 in flight, so the whole minute's allowance arriving at once still finds room, and more starts a copy rather than queueing behind slow calls. Measured on a laptop (below): 30 streamed questions at once on one copy, all answered |
| Memory | 512 MiB | The same as the other services. Measured on a laptop: 125.6 MiB before any question, 131.2 MiB after 30 at once (with the stand-in model; the light grid's months, about 3.4 MB each, were not read) |
| Copies | 0 to 3 | As the plan says: start at today's limits. `copilot_min_instances = 1` keeps one warm for an event |
| Objectives | 99% succeed; 90% within 10 s (28 days) | Below the web server's 99.5%: every question depends on a model the project does not run, and the breaker's 503s count against it on purpose. At the load balancer, `POST /api/chat` had a 95th percentile of 9,362 ms, cached and uncached together (baseline 1.2), so 90% within 10 s has room |
| Graceful shutdown | Stop taking connections, finish what is in hand, exit by 9 s | Cloud Run gives 10 s after SIGTERM, and normally stops only idle copies. Measured on a laptop: SIGTERM half a second into a 3 s streamed answer; the answer arrived whole and the process exited 0, 2.6 s after the signal |

**The laptop measurements** (2026-11-12, 20:14 UTC; the real image, arm64, one CPU and 512 MB; the
scripted stand-in for the model holding each call 2 s; no Redis): from `docker run` to the first status
answer, 194 ms. 30 streamed questions at once: 30 answered, median 4,090 ms, 95th percentile 4,093 ms, the
slowest 4,099 ms, against 4,000 ms of stand-in holding. This says one copy holds 30 waiting questions on
one CPU inside its memory. It says nothing about real model times, or about a start on Cloud Run.

**The breaker on a real Redis** (same day; two copies of the image and Redis 7.2 in Compose, one copy
with every model call failed on purpose): five questions to the failing copy, each `502` in 0.38 s to
0.95 s (three tries, jittered waits). Then a new question to the *healthy* copy: `503`, `Retry-After: 30`,
in 5.5 ms, without calling its model. The same through the web server's forward: 10.2 ms. After 31 s, one
question to the healthy copy was the trial: `200`, and the key in Redis read `closed`. The seventh
question in a minute from one visitor: `429`, `Retry-After: 60`.

## What moved

| From | To | Why |
| --- | --- | --- |
| `web/server/chat/` (handler, chat loop, prompt, render, actions, tests) | `web/copilot/chat/` | The service's own code. The web server imports the handler from there until the route has moved |
| `web/server/ask.ts` | `web/copilot/ask.ts` | The same. It now reads the site list through the data reader, not a copy bundled at build time (baseline 2.5, item 4), and calls the model through the retries and the breaker |
| `web/server/outbox.ts`, `outbox.test.ts` | `web/copilot/outbox.ts` | Question events are the co-pilot's. The web server keeps a relay on the same Redis hash while it answers `/api/chat` |
| `vertexModel`, `pubsubEvents`, `directPush`, out of `web/server/google.ts` | `web/copilot/google.ts` | The model and the queue are the co-pilot's clients |
| `gcsBucket`, out of `web/server/google.ts` | `web/shared/google.ts` | Both read the bucket: the web server for tiles and video, the co-pilot for the light grid |
| The `Model` type, out of `web/server/deps.ts` | `web/copilot/model.ts` | |
| The co-pilot's limits, out of `web/server/app.ts` | `web/copilot/limits.ts` | One definition, so both programs count in the same keys |
| The outbox's Redis commands, out of `web/server/redisClient.ts` | `web/copilot/redisClient.ts` | With the breaker's. The web server adds them to its own connection |
| The typed-question tests, out of `web/server/app.test.ts` | `web/copilot/ask.test.ts` | They run against both programs now, as the chat endpoint's do |

The service's bundle has no file from `web/server/` in it, and a test keeps it so.

## What it cost

Measured or counted on 2026-11-12:

- **Code:** a fourth program (`web/copilot/`: twelve source files besides the moved ones, a written
  contract, a Dockerfile), a fourth deploy workflow, nine files moved. 903 tests where there were 776.
- **Image:** 491 MB unpacked on a laptop (arm64), the same as plans': the site data is most of it. The
  service's own code is one bundled file of 2.5 MB.
- **Infrastructure:** 15 new resources in the first apply, 6 of them grants (listed in
  `ARCHITECTURE_PHASE_3.md`), two settings added to the web server and two to plans, then one change to
  the URL map.
- **A cold start of its own.** The web server's copy is kept warm today; the co-pilot scales to zero
  unless told otherwise. Its start on Cloud Run has not been measured.
- **Memory paid three times.** The data reader keeps what it has read; the web server, plans and the
  co-pilot each have one.
- **The edge firewall's allowance grows again.** Cloud Armor counts a rate limit per backend, so one
  address now gets 120 calls a minute to each of three backends' API paths. The co-pilot's own limits (6
  questions a minute per visitor) are far below.
- **A shared-code release.** A change in `web/shared/` or `web/src/lib/` now redeploys four, three or two
  services.
- **Model calls per deploy.** The five set questions run in this service's deploy too, until the site's
  deploy drops them.
- **Money:** nothing while idle. No new forwarding rule. A breaker key and a few more cache keys in the
  existing Redis.

## What would make us merge it back into `web`

- **It deploys every time the site does.** Then the boundary is in the wrong place; with the page's
  calculations shared, watch the run history of "Deploy co-pilot" against "Deploy".
- **Cold starts cost more than the boundary is worth.** If the first question after a quiet spell is
  slower than the baseline for visitors, and the fix is a copy kept warm all month.
- **The bulkhead is never used.** If in months of traffic the model never fails and the site never needs
  its own scaling for the co-pilot, the separation has cost more than it saved. The breaker's alert is
  the record of whether it did.
- **A fifth service would be better spent elsewhere.** Follow the presenter scales by open streams, not
  requests; if it ever needs its own copies, that is the stronger case for a split.

And what would change the breaker: a percentage threshold with a minimum count, once traffic is high
enough that a minute holds dozens of questions.
