# Decision 0003: the plans service, and idempotency keys on "save plan"

**Status:** built, applied, deployed and checked on 2026-11-12. The load balancer sends `/api/plans` to the
service and the web server has no access to the database; what the checks showed is in
[`../ARCHITECTURE_PHASE_2.md`](../ARCHITECTURE_PHASE_2.md), section 9. The contract pull request
(`arch/contract-web`, with Phase 3's) removed the plans code from the web server: it no longer answers
`/api/plans` at all, and the tables below that say the web server still imports the handler describe how it
was until then (`../ARCHITECTURE_PHASE_2.md`, section 7). It follows decisions
[0001](0001-four-services.md) and [0002](0002-events-worker.md). Numbers called "measured" below were run
on one laptop or read from the live site, and each says which.

## What was built

The third of the four services, and the first one that visitors call. `plans` is a Cloud Run service that
answers `/api/plans`: save, open, list and delete shared mission plans, with the sign-in check. The load
balancer sends that one path to it and everything else to the web server.

```
visitor ──► load balancer ─┬─► /api/plans, /api/plans/*  ──► plans (Cloud Run) ──► Firestore "plans"
                           │                                    │                    plans/<id>
                           │                                    └─► Redis            idempotency/<key>
                           │                                        (rate limits)
                           └─► every other path          ──► web (Cloud Run)
```

No service calls another to answer a visitor. The load balancer is the only thing that knows there are two.

Until the route has moved for good, the web server can still answer `/api/plans` with the same handler.
That is on purpose: it is what makes "send the path back" a one-line change.

## Why it is separate

- **One service, one database.** `plans` is the only code that needs the `plans` database. As its own
  service it gets its own identity, and that identity has two grants: this one database, and writing traces.
  The web server, which serves every public page, tile and stream, then needs no access to visitors' saved
  plans at all, and loses it in the last step.
- **It proves the pattern on the easy case.** A request comes in, one or two database calls happen, an
  answer goes out. The things that are new here (a path rule on the load balancer, a second backend, a
  stepped deploy for a service visitors reach, pages and API deploying apart) are the same things the
  co-pilot needs in Phase 3, where a mistake costs more.
- **Failures stay apart.** A bad deploy of the web server no longer touches saved plans, and a bad deploy
  of `plans` no longer touches the pages or the co-pilot.

One reason it is **not** separate for: load. The load balancer's log for the baseline held 41 opens and
9 saves of a plan in 16 h 25 min ([`ARCHITECTURE_BASELINE.md`](../ARCHITECTURE_BASELINE.md) 1.2). Nothing
here needs to scale by itself. The split is for the boundary and the practice.

## Idempotency keys on "save plan"

### The problem

A save can reach the server twice without the visitor meaning it. The answer is lost on a bad connection
and the page tries again. Or a button is pressed twice. The server cannot tell a retry from a second plan,
so it saves two. *Idempotent* means "doing it twice has the same effect as doing it once". A save is not
idempotent by nature, because every save makes a new plan with a new id. A key makes it so.

### How it works

The page makes up a random key for each attempt to save and sends it in the `Idempotency-Key` header. It
sends the same key again when it retries. The server remembers which plan each key made:

| The request | What happens | The answer |
| --- | --- | --- |
| A key the server has not seen | The plan is saved, and the key is recorded with it | `201 {"id": …}` |
| The same key, the same plan | Nothing is saved | `201` with the first `id` again, and the header `idempotent-replayed: true` |
| The same key, a different plan | Nothing is saved | `422 {"error":"key-reused"}` |
| No key | A new plan every time, as before keys existed | `201 {"id": …}` |
| Something that is not a key | Nothing is saved | `400 {"error":"bad-key"}` |

"The same plan" is decided by a fingerprint: a hash of the title, the note, the view and the owner, taken
after the server has cleaned them. So a retry that differs only in spacing still matches, and the same plan
for a different signed-in person does not.

A request that saved nothing (refused for its content, its sign-in, its origin or a rate limit) does not use
the key up. Only a `201` is remembered.

### Where the keys live: in the `plans` database, written with the plan

The save and the record of the key have to happen together. If they can come apart, the key is worse than
no key:

- the plan is saved and the key is not recorded: the retry saves a second plan, which is the bug;
- the key is recorded and the plan is not saved: the retry is told "done" and given the id of a plan that
  does not exist.

| | Firestore, in the same write as the plan (built) | Redis (not built) |
| --- | --- | --- |
| Plan and key together or not at all | **Yes.** One commit holds two writes, each with a condition: the plan's id is free, and the key has no record. If either fails, Firestore refuses both | **No.** Two systems, two writes. One of the two gaps above is always open, whichever is written first. Closing it needs an "in progress" state, a timeout for it, and a clean-up for crashes |
| Two requests with one key at the same moment | One commit wins. The other is refused, reads the winner's record and gives its answer | `SET NX` picks a winner, but the loser has to wait or be told "try again": the winner's plan may not be saved yet |
| Survives a restart | Yes | No. This Redis is the Basic tier: one node, nothing on disk. A restart would forget every key, and retries after it would save twice |
| Added to a first save | Nothing in round trips: one commit where there was one create. One more document written | One call on the private network, about a millisecond by the Phase 1 traces |
| Added to a retry | The refused commit, then one read of the key's record | One call |
| Expiry | A time-to-live rule in Terraform, on the `expires` field | `EX` on the key |
| New things to grant | None. The same database, the same role | None |

Firestore was chosen because it is the only one of the two that makes "save the plan and remember the key"
atomic, and that property is the whole feature. The price is one more document per save.

### The status codes

They follow the IETF draft "The Idempotency-Key HTTP Header Field"
(`draft-ietf-httpapi-idempotency-key-header`, version 08 of 22 October 2026):

- **422** for a key reused with a different request. The request is well formed, so not 400. It is not a
  conflict with something in progress, so not 409. The server understood it and will not act on it.
- **409** is what the draft gives for "the first request is still being processed". This server never
  answers it, because there is no such state: the plan and the key are one atomic write, so at any moment a
  key either has a record or does not.
- **400** for a header value that is not a key (16 to 64 letters, digits, `-` or `_`). The draft writes the
  value as a quoted string, and the page sends it that way. A bare value is accepted too.

The key is optional, where the draft lets a server require it. A page loaded before this deploy sends no
key and must keep working (the contract's additive rule).

### Two requests at once

Both work out a brief, each picks a plan id of its own, and both commit. Firestore applies one and refuses
the other, because the second commit's condition "this key has no record" is now false. The refused request
reads the key's record, finds the same fingerprint, and answers with the first plan's id. Both visitors, or
both tabs, hold the same link.

Measured against Google's Firestore emulator on a laptop, through the whole service: 12 identical saves sent
at once made one plan, and 11 of the 12 answers carried `idempotent-replayed: true`. Against the real
database: not yet. The first deploy's own test does it (one save, sent twice) before any visitor reaches
the service.

### Expiry

A key is remembered for **24 hours**. The page only reuses a key inside one visit, seconds or minutes after
the first try, so a day is generous: it covers a tab left open overnight. It is also the age after which
Stripe's API, a widely used implementation, lets a key be removed.

Firestore deletes the record by a time-to-live rule, "typically within 24 hours" after it expires according
to its documentation, and expired documents "continue to appear" in reads until then. So the code never
trusts the rule: it compares `expires` with the clock itself. A key whose record has expired but is still
there may be used again. The new save replaces exactly that old record (the write's condition names the
record's last update time), so two requests reusing an expired key at once still save one plan.

### What the page does

`web/src/lib/plans.ts`. One key per attempt. Pressing Save again after a failure, with nothing changed, is
the same attempt and sends the same key. Changing the title, the note or the view, or signing in or out,
makes a new attempt with a new key. A save that got no answer, or a 502 or 504, is tried once more by
itself after 0.8 s, with the same key. Without a key nothing is retried.

Seen in a browser against a local server: the first press was refused by the rate limit (429), the second
press a minute later sent the same key and saved.

### What it costs per save

- **Time:** no extra round trip for a first save. Not measured on the real database. After the deploy,
  the step `save to Firestore` in each trace of `POST /api/plans` is the number to compare with the two saves
  in the Phase 1 traces (166 ms and 191 ms).
- **Money:** one more document written, and one time-to-live delete a day later. At the list prices in
  `REFERENCES.md` ($0.099 and $0.011 per 100,000 in us-east4) that is $0.0000011 a save. At the service's own
  ceiling of 300 saves a day it is $0.0003 a day.
- **A retry** costs the refused commit and one document read ($0.033 per 100,000).

### What it does not do

- **A retry still counts against the rate limit** (5 saves a minute per visitor). A page that retried into a
  429 retries again later with the same key, which is safe.
- **Keys are not tied to a visitor.** There is one namespace for everyone. The page's keys are random
  (a UUID, 122 random bits), so two visitors do not meet by accident. Someone who learned another visitor's
  key within the day could learn that plan's id, which is the shareable link anyway, and nothing else.
- **Deleting a plan does not forget its key.** A replay within the day answers with the id of a plan that
  is gone, and opening it says so.
- **Only saving has keys.** Opening and listing change nothing. Deleting the same plan twice already ends
  the same way (the second answer is 404).

## The status address

`GET /api/plans/status` reports the service's name, the commit it was built from, Cloud Run's revision, the
hash of the site data in the image, and which parts are switched on (Firestore, Redis and whether it is
reachable right now, sign-in, tracing).

It sits under `/api/plans/` because that is the only path the load balancer sends to this service, so it is
the only place a status can be seen through the public address. It cannot collide with a plan: a plan's id
is always 8 letters, and `status` has 6. The web server has no such address and answers 404 there, which
is how to tell from outside which of the two is serving `/api/plans`.

**Not built:** the plan (section 6) also has the web server's `/api/status` ask each service for its status
with a short-lived identity token. Nothing in this phase needs it, and the page reads nothing about plans
from `/api/status`. It is left for the phase that needs a service to call another.

## The settings, and what each rests on

| Setting | Value | Why |
| --- | --- | --- |
| Request timeout | 30 s | Half the web server's 60 s: nothing here streams or calls a model. Each Firestore call is given up after 5 s, and the most any request makes is three. With the slowest start of a copy seen for the web image (6.44 s, baseline 1.4) that is 21.4 s at worst. The slowest kind of request before the split was a save, 425 ms at the 95th percentile |
| Requests at once per copy | 80 | The web server's number, which is what served these requests until now. Measured on a laptop (below): 80 at once, no failures |
| Memory | 512 MiB | The same as the other two services. Measured on a laptop: 28 MiB before any plan was saved, and between 119 and 231 MiB after the load below. The reader keeps up to 36 months of hourly tracks and every site's decoded hours in memory, as it does in the web server |
| Copies | 0 to 3 | Scales to zero, so it costs nothing idle. The first request after a quiet spell waits for a copy to start. `plans_min_instances = 1` keeps one warm |
| Objectives | 99.5% succeed; 95% within 1 s (28 days) | Before the split, 95 in 100 opens answered within 252 ms and saves within 425 ms at the load balancer (baseline 1.2). One second is about twice the slower. The other 5% is for a copy starting |

**The laptop measurement** (2026-11-12; the real image, arm64, limited to one CPU and 512 MB; Firestore's
emulator on the same machine; rate limits in memory; requests from the same machine, 80 at a time):

| | n | Failed | Median | 95th percentile |
| --- | --- | --- | --- | --- |
| Saves, each for a different site and month, each with a key (first run) | 240 | 0 | 325 ms | 460 ms |
| The same, after the save was changed to commit first and look the key up only on a refusal | 240 | 0 | 278 ms | 327 ms |
| Opens of those plans | 2,000 | 0 | 76 ms and 74 ms in the two runs | 94 ms and 92 ms |

This says the service holds 80 requests at once on one CPU inside its memory. It says nothing about the
real times: the emulator answers from memory on the same machine. The timeout, the concurrency and the
memory are starting values to confirm from the service's own metrics once it has traffic.

## What moved

Code that both the web server and the plans service need went to `web/shared/`, which every image copies.

| From | To | Why |
| --- | --- | --- |
| `web/server/plans/handler.ts`, `store.ts`, `plans.test.ts` | `web/plans/` | The service's own code. The web server imports the handler from there until the route has moved for good |
| The Firestore plan store, out of `web/server/google.ts` | `web/plans/firestorePlans.ts` | Only plans uses it. It gained the atomic write with the key, and a 5 s limit on each call |
| `web/server/chat/data.ts`, `light.ts`, `args.ts`, `facts.ts`, `tools.ts`, `siteTools.ts`, `landingTools.ts`, `spotTools.ts`, `light.test.ts` | `web/shared/tools/` | The read-only data tools. A plan's brief is written with the same tools the co-pilot uses (baseline 2.5, item 1) |
| `DEFAULT_LIMITS`, out of `web/server/chat/actions.ts` | `web/shared/tools/defaults.ts` | Both decode a view against the same starting limits |
| `web/server/identity.ts`, `identity.test.ts` | `web/shared/` | The sign-in check |
| `web/server/store.ts`, `rateLimit.ts`, `redisStore.ts`, `store.test.ts` | `web/shared/` | Rate limits and the cache, in memory and on Redis |
| The Redis connection, out of `web/server/redisClient.ts` | `web/shared/redisClient.ts` | The plans service needs the connection and the rate-limit commands, not rooms or the outbox, which stay in `web/server/redisClient.ts` (baseline 2.5, item 7) |
| `web/server/ids.ts` | `web/shared/` | Plan ids and room ids |
| The request tracer `traced`, out of `web/server/app.ts` | `web/shared/traced.ts` | Every service that answers visitors wraps its requests the same way (baseline 2.5, item 11) |
| The `Bucket` type, out of `web/server/deps.ts` | `web/shared/bucket.ts` | The data reader names it. The plans service passes no bucket (baseline 2.5, item 3) |

The service is built with no bucket, so it needs no access to Cloud Storage. Its bundle has no file from
`web/server/` in it, and a test keeps it so.

## What it cost

Measured or counted on 2026-11-12:

- **Code:** a third program in the repository (`web/plans/`: six source files, a written contract and a
  Dockerfile), a third deploy workflow, and 19 files moved. The plans tests now run against both programs, 776 tests in all
  where there were 684.
- **Image:** 491 MB unpacked, against 580 MB for the site and 347 MB for the worker, all built on one laptop
  (arm64). 113 MB compressed. The site data is 102 MB of it on disk; the service's own code is one bundled
  file of 2.4 MB.
- **Infrastructure:** 13 new resources in the first apply, 4 of them grants, then one change to the load
  balancer's URL map (all listed in `ARCHITECTURE_PHASE_2.md`).
- **Memory paid twice.** The data reader keeps what it has read in memory. There are now two of them.
- **A cold start of its own.** Before, a plan was opened by the web server's copy, which is kept warm today.
  The plans service scales to zero unless told otherwise. How long its image takes to start has not been
  measured.
- **The edge firewall's allowance doubles for plans.** Cloud Armor counts a rate limit separately for each
  backend a policy is attached to. One address now gets 120 calls a minute to `/api/plans` and 120 to the
  rest of `/api/`. The service's own limits are far below both.
- **A shared-code release.** A change in `web/shared/` redeploys all three services. A change in
  `web/src/lib/` redeploys the site and plans, because the data tools reuse the page's calculations.
- **A shared-data release.** The plans image carries the site data. A data change deploys both, and the
  plans deploy waits for the site's and fails if the two end up with different data.
- **Pages and API can differ by a version.** Hence the written contract (`web/plans/API.md`) and its test.
- **One test plan per deploy.** Each deploy of the service saves one real plan on the new version before
  it takes requests. It has no owner, so nobody can delete it. The database removes it 180 days later.
- **Money:** nothing while idle. Per save, the fractions of a cent above. No new forwarding rule is created,
  and the baseline's load balancer charge was per forwarding rule; whether a second backend adds anything
  has not been checked against a bill.

## What would make us merge it back into `web`

- **It deploys every time the site does.** Then the boundary is in the wrong place. The run history of
  "Deploy plans" against "Deploy" shows it.
- **Cold starts cost more than the boundary is worth.** If opening a plan gets slower than the baseline for
  visitors and the fix is a copy kept warm all month for a feature with a few dozen requests a day.
- **The data keeps the two deploys in each other's way.** If "the plans deploy waited for the site's and
  failed" becomes a regular event, the brief belongs where the data is.
- **Nobody is guarding the database with it.** The point is that only one identity can touch plans. If a
  later feature needs the web server to read plans directly again, the split has lost its reason.

And what would change the idempotency design: require the key (answer 400 without one) once no page from
before this deploy can still be open; tie keys to the signed-in owner if plans ever hold something private.
