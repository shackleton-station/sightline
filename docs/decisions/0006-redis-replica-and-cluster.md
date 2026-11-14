# Decision 0006: Redis with a read replica, expiry with jitter, one recompute per key, and a Redis Cluster drill

**Status:** built on the branch `arch/phase-4-redis` on 2026-11-12. Nothing is applied: the instance is
still Basic, 1 GB, one node. The steps, the plans and the checks are in
[`../ARCHITECTURE_PHASE_4.md`](../ARCHITECTURE_PHASE_4.md). It follows decisions
[0001](0001-four-services.md) to [0005](0005-plans-index-and-paging.md). Numbers called "measured" below were
run on one laptop (the real images in Compose, Redis 7.2) or read from Cloud Monitoring, and each says
which. Nothing here was measured on Memorystore with a replica: that is what the window is for.

## What was built

| Piece | In one line |
| --- | --- |
| Two connections | The primary for every write, script, limit, lock and counter. The read endpoint, when there is one, for cached values only |
| Expiry with jitter | Every cached value expires after its base time plus or minus 10%, chosen for that write |
| One recompute per key | When a kept co-pilot answer is missing, one request works it out and the others wait for it |
| Hit rates | Hits and misses per kind of key, counted in Redis by every copy, read with one `curl` |
| A truthful status | Each service says whether it is on Redis, on its memory fallback, or reconnecting |
| The Redis Cluster window | The co-pilot's kept answers on a small cluster, a drill that shows redirects, and a reshard |

## Primary and replica

### What a read replica is, here

Memorystore's Standard tier keeps a second node, the replica, that copies every write from the primary.
With read replicas switched on the instance has two addresses: the **primary endpoint**, which takes
reads and writes, and the **read endpoint**, which spreads read connections over the replicas and never
reaches the primary. The copy is asynchronous: Google's page says "the replica can lag by a few
seconds". So a read from the replica can be a moment out of date.

### Which calls go where, and why

`web/shared/redisClient.ts` opens a second connection when `REDIS_READ_HOST` is set. One command uses
it: reading a cached value (`getFromReplica` in `web/shared/redisStore.ts`). Everything else stays on
the primary.

| What | Connection | Why |
| --- | --- | --- |
| Reading a kept co-pilot answer or a kept audio clip | Read endpoint | A read that can be a moment old without harm (below) |
| Writing a cached value | Primary | Replicas are read-only |
| Rate limits (the sliding-window script) | Primary | It writes, and its count must be current |
| The circuit breaker's state | Primary | A copy that reads "closed" a moment after another wrote "open" calls a failing model |
| The single-flight lock, and a waiter's looks for the answer | Primary | A waiter must see the answer the moment it is kept |
| The event outbox, the hit counters | Primary | Writes |
| Presenters' rooms, publish and subscribe | Primary | A follower joining a room a second old would be sent to where the presenter was |

**Why limits never read from a replica.** A limit is "count the calls in the last minute, and refuse if
there are 6". If the count is read from a replica that is two seconds behind, the calls of the last two
seconds are missing from it, and a client sending fast gets extra calls through. The limit is the cap on
what the model can cost, so it is the one thing here that must not read stale data. It is also one
atomic script that reads and writes, and a replica refuses writes.

**Why a stale cache read is harmless here.** Two cases. The replica does not have an entry yet: the
read is a miss, and the answer is worked out again, which costs a model call and nothing else. Or the
replica still has an entry the primary has dropped: the entry is keyed by the co-pilot's code version
and the data version (decision 0004), so it is the right answer to that question for that code and data
or it would have a different key. A replica can be missing an answer. It cannot hold a wrong one.

**When the read endpoint fails**, the read is tried on the primary in the same call, and the read
endpoint is left alone for 2 s. If the primary fails too, this copy's memory answers, which is a miss
unless this copy kept the value itself. With no read endpoint set, there is one connection and reads go
to the primary exactly as before.

**Which services get the read endpoint.** The web server (spoken audio) and the co-pilot (answers). Not
`plans`: it keeps only rate limits in Redis and reads no cache, so a second connection there would
never carry a command.

### What the replica did on a laptop

Compose now runs a primary and one replica. With the primary stopped for 20 s, a kept question was
still answered from the cache, by the replica, in 16 to 23 ms (the timeline is in the phase document,
section 7). That is the read endpoint paying for itself in the one case it can: reads carry on while
the primary is away.

## Reconnection: what happens to a request during a failover

After a failover every connection to the primary endpoint is dropped, and some to the read endpoint
(Google's page on read replicas, which also says a failover "usually completes in under 30 seconds").
The client library (`redis` 6.3.1) was already set so that a request never waits on a reconnect:
commands sent while the connection is down fail at once, and the store answers from memory. Three
things changed:

- **A hang is now bounded once, not per call.** A dropped connection fails fast. A connection that
  goes quiet without closing does not: each command would wait its 300 ms of patience. Now, after one
  command gets no answer in time, the store rests for 2 s: it answers from memory without asking Redis,
  then tries again. Measured with the primary frozen (`docker compose pause`): the first request after
  the freeze took 619 ms, and after that the slowest status answer was 323 ms and most were under 20 ms.
- **A quiet connection is replaced.** After three commands in a row with no answer, the store drops
  the connection and makes a new one. A connection in that state never recovers by itself, and nothing
  in the library notices it for many minutes.
- **Reconnects wait at most 2 s**, where the ceiling was 10 s, and half of each wait is random so copies
  that lost the connection together do not all return together. Measured: with the primary stopped for
  20 s, all three services said `redis` again within 2 s of it coming back.
- **A status asks before it answers.** Each service's status makes one small read on Redis, bounded by
  the 300 ms patience, unless the connection is already known to be down. Without it a copy that had no
  request said whatever its last request had found: with the primary frozen for 15 s, the co-pilot (no
  requests) said `redis` throughout while the web server and plans said `fallback`. With it, all three
  said `fallback` at the first status after the freeze. The cost is one `GET` per status request.

What a visitor sees while Redis is away, from the same runs: pages, plans and the co-pilot answer
normally (limits are counted per copy, and a kept answer may be worked out again). Follow the presenter
answers `503`, because a room kept in one copy's memory would reach only the followers connected to
that copy.

## Expiry with jitter

Entries written together expire together. A deploy that changes the co-pilot's code starts an empty
cache; a room of people asks the same few questions within a minute; a day later all of those answers
expire within the same minute, and the next visitors each pay for a model call.

Every cache write now picks its own expiry: the base time plus or minus up to 10%
(`web/shared/jitter.ts`, used by the store's `cache.set`, so no caller can forget it). A day becomes
21.6 to 26.4 hours. Measured: twelve answers written within one second on Redis 7.2 had expiries from
79,408 s to 91,713 s, 22.1 to 25.5 hours. Tests pass the random numbers in, so an expiry is exact in a
test.

Rate-limit windows and the circuit breaker are left alone: 6 a minute has to mean a minute.

### One line per kind of key: which way its expiry leans

Short means fresher data and more misses. Long means more hits and staler data.

| Key | Expiry | Leans | Why |
| --- | --- | --- | --- |
| `clps:cache:copilot:<hash>`, a kept answer | A day, plus or minus 10% | Long | The key names the code and the data, so it cannot go stale. A day is only a ceiling on memory |
| `clps:cache:speak:<hash>`, a spoken clip | A day, plus or minus 10% | Long | The same sentence in the same voice is always the same sound |
| `clps:limit:<name>:<who>`, a limit's counter | Exactly its window: a minute, ten minutes, an hour or a day | Neither | The expiry is the meaning. No jitter |
| `clps:copilot:breaker`, the breaker's state | A day after its last change | Long | Its real times (30 s open, 15 s for a trial) are inside the value. The expiry only tidies up |
| `clps:lock:<key>`, the single-flight lock | 15 s | Short | It has to outlive one answer, and free itself soon if its holder stops |
| `clps:room:<id>`, a presenter's room | 10 minutes idle, 3 hours at most | Short | A room nobody is moving is over |
| `clps:outbox:events`, events waiting to be published | None: an entry is removed when the queue has it | Long | Losing one loses a row of the question log |
| `clps:stats:<day>`, the hit counters | 8 days | Long | Long enough to compare a week. Not a cache: nothing recomputes it |

## About `expires_at` and soft expiry, and why it is not used here

**The pattern.** Keep each entry with two times: a *soft* expiry inside the value (`expires_at`) and a
longer hard expiry on the key. A read after the soft time still returns the old value at once, and
starts a refresh in the background, so no visitor waits for a recompute and a slow source never shows.
It is the usual answer to "the data changes, a recompute is slow, and slightly old is fine".

**Why it does not fit the co-pilot's cache.** Two reasons, and either would be enough.

- **There is nothing to refresh.** A kept answer is keyed by the version of the code and the data. While
  those are the same, the answer worked out again would be the same answer. When either changes, the
  key changes, and the old entry is never read again. Soft expiry trades freshness for speed, and here
  there is no freshness to trade.
- **"Refresh in the background" is unreliable on Cloud Run.** A copy is given CPU only while it is
  handling a request (`cpu_idle = true` in `infra/`, and `docs/LESSONS.md`: "Cloud Run stops giving a
  server CPU when the response ends"). A refresh started after the response has gone can stall until
  the next visitor arrives, or never finish. Doing it properly would mean paying for always-on CPU, or
  a queue and a worker, for a cache whose entries do not go stale.

What is used instead: a hard expiry with jitter, and one recompute per key, below. The first spreads
the misses out in time. The second makes each miss cost one model call however many people are waiting.

## One recompute per key ("single flight")

### The problem

A kept answer is missing: it expired, or a deploy started an empty cache. A room of people taps the
same suggested question within a second. Each request misses, and each pays for the same model call.
The co-pilot lets 30 questions a minute through for everyone together, so that is up to 30 calls for
one answer.

### How it works

`web/shared/singleFlight.ts`, used by `web/copilot/chat/handler.ts` for first questions (the only ones
that are kept).

```
request 1  miss, takes the lock, looks again, works it out, keeps it, releases
request 2  miss, lock is held: waits 0.1 s, 0.15 s, 0.23 s, ... 0.5 s, then finds the kept answer
```

- **The lock** is `SET clps:lock:<key> <token> NX PX 15000` on the primary: written only if nobody
  holds it, and gone by itself after 15 s. The token is unique to the holder.
- **The release** deletes the key only if it still holds that token. Compare and delete have to be one
  step, so they are a small script (`DELETE_IF_SCRIPT`). A holder that overran its 15 s cannot delete a
  lock someone else has taken since.
- **The holder looks again** before working, on the primary. The answer may have been kept between its
  miss and its lock, or the replica it read may have been behind.
- **A waiter** looks for the answer on the primary after growing pauses (100 ms, then half as long
  again each time, up to 500 ms, each spread by 20% so a room of waiters does not look at the same
  instant). Each look that finds nothing also asks for the lock: if the holder stopped, or finished with
  nothing worth keeping, this waiter takes over.
- **A waiter gives up** after 10 s, or sooner if less than 12 s would be left of its own 25 s, and then
  works the answer out itself inside what is left. Waiting never turns into failing.
- **It is one lock for everyone**: every copy of the co-pilot service uses the same key in the same
  Redis. (The web server used to be able to answer `/api/chat` too and shared the lock; since the
  contract step it has no co-pilot code.)
- **Without Redis** there are no locks, and with Redis away the lock cannot be asked for. Either way
  the request works its answer out at once, as it did before this phase.
- **It is not a guarantee, and does not need to be.** Replication is asynchronous, so a failover can lose
  a lock the replica had not copied yet (Redis's own page on distributed locks describes this race).
  Then two requests both work the answer out: one more model call, the same answer kept twice. Nothing
  here needs exactly one, so the single-instance form is enough and Redlock is not used.

**With streaming.** The leader's stream is as before: a `step` per lookup, then the `reply`. A waiter's
stream is sent one `step` saying "The same question was asked a moment ago: waiting for its answer",
then nothing until the `reply`, which is the kept answer. It makes no lookups, so it has no other steps.
The page shows a step's title as it is, so no page changed. A waiter's `x-cache` header says `miss`,
because the headers go out before the answer is known; a waiter that is not streaming says `hit`.

### The numbers, and what they rest on

- **Lock: 15 s.** Uncached answers took a median of 4.7 s and a 95th percentile of 10.7 s on the
  baseline day ([`ARCHITECTURE_BASELINE.md`](../ARCHITECTURE_BASELINE.md) 1.1). 15 s is longer than
  nearly all of them, and short enough that a holder that stopped is replaced soon.
- **Wait: at most 10 s, keeping 12 s back.** A question has 25 s in all. A waiter that gives up at 10 s
  still has 15 s, more than the 95th percentile.
- **Looks: 100 ms growing to 500 ms.** About 22 looks in 10 s, each one or two small commands. The
  ceiling was 1 s at first. Measured with it: the slowest of 24 waiters got its answer 1.1 s after the
  leader. With 500 ms: 0.57 s.

### What it costs

For a request that is alone: three small calls to Redis (take the lock, look again, release) around a
model call that takes seconds. Measured on a laptop with the stand-in model answering at once: twelve
different first questions, one after another, took 3 to 9 ms each from end to end, the whole request
with every Redis call in it.

For a waiter: up to half a second more than the leader, and no model call.

In the worst cases: a holder that stops costs its waiters up to 10 s before they work the answer out
themselves, each with a model call, which is what they all did before. An answer that takes longer than
10 s (about one in twenty) lets its waiters give up and call the model too.

### What it did on Redis 7.2

Two copies of the co-pilot's image and the web server's forward to one of them, one Redis, the stand-in model slowed
to 2 s a call (a question is two calls, so 4 s). 24 identical first questions at once, 6 of them
streamed, spread over the three addresses:

| | |
| --- | --- |
| Stand-in model calls | 2: one question's worth, on one copy. The other copy made none |
| What the requests did | 1 led, 23 waited |
| Answers | 24 of 24 `200`, the same text |
| Time | The leader 4,078 ms; the median 4,388 ms; the slowest 4,644 ms |
| The streamed waiters | One `step` (waiting), then the `reply` |

### Spoken audio does not get the same

Decided against, for now. A text-to-speech call takes about a second and is cheap, so the window in
which two requests for the same sentence overlap is short, and a waiter looking every 100 to 500 ms
would save little time and little money. The voice has its own ceiling (200 texts a day for everyone)
and the page falls back to the browser's own voice when it is reached. And it lives in `web/server/`,
which this phase was asked to touch as little as possible.

What would change that: the hit counters showing `speak` misses arriving in bunches (a room playing
the briefing at once would do it, and would use up the day's 200 quickly). The helper is generic, so
adding it to `handleSpeak` is about ten lines.

## Hit rates and memory

**How.** Each cache read adds one to a counter in Redis: a hash per UTC day, `clps:stats:<day>`, with a
field per kind and outcome (`cache:copilot:hit`, `cache:speak:miss`). The add is sent with the read and
not waited for. Single flight adds what each request did (`flight:copilot:led`, `waited` and so on).
`GET /api/chat/status/cache` on the co-pilot service returns two days of them with the primary's memory
in use (`INFO memory`), and `web/scripts/redis-stats.mjs` prints it.

**Why this way.** It has to survive many copies and Cloud Run's CPU rule. A counter in each copy's
memory fails the first. Anything sent "after the response" fails the second. A counter in Redis,
incremented during the request, is shared by every copy and needs nothing afterwards. It costs one
small write per cache read, on the primary. At this traffic that is nothing; at a traffic where it
mattered, the write would go to a log line and a log-based metric instead.

**The alternatives.** Memorystore's own metric `stats/cache_hit_ratio` counts every key lookup
together, the breaker's reads and the locks included, so it cannot say "answers" from "audio". On
2026-11-12 at 21:12 UTC it read 81.8% for the live instance, which is not a number about the cache. A
log line per read turned into a log-based metric would survive the instance being replaced, which the
counters do not; it is a minute behind and read with a query. Both are printed by
`redis-stats.mjs --monitoring` as a cross-check, with the memory figure from Cloud Monitoring.

**What the counters miss.** Reads made while Redis is away. And everything counted before the instance
is replaced: the replica window replaces it twice, so the numbers are read and written down before
each replacement (the phase document says when).

**Memory today**, from Cloud Monitoring on 2026-11-12 at 21:12 UTC: 6.4 MB in use of 1 GB, 0.62%. A
5 GB node will be 0.1% full. The size is what read replicas need, not what the data needs.

## The Redis Cluster window

### What a cluster is

Several primaries, called shards, each holding part of the keys. Every key belongs to one of 16,384
*hash slots*: CRC16 of the key, modulo 16384. Each shard owns a range of slots. A client that knows the
slot map sends each command to the shard that owns the key's slot. When its map is out of date, the
shard answers with a redirect instead of a value:

- `MOVED <slot> <address>`: that slot lives there now, for good. Read the map again and go there.
- `ASK <slot> <address>`: that slot is being moved and this key has already gone. Send this one command
  there, after an `ASKING`, and keep the map.

Adding or removing a shard (a *reshard*) moves slots, and their keys, between shards while the cluster
stays up. A key's slot never changes. Its owner does.

### What uses it, and why only that

One thing: the co-pilot's kept answers (`web/copilot/clusterCache.ts`, switched on by
`CACHE_CLUSTER_HOST`). It is the only state here that can be lost entirely at the cost of some model
calls, and each answer is one key with one command. Rate limits, the breaker, the outbox, the
single-flight lock, the counters and rooms stay on the ordinary instance.

When a cluster read or write fails, or takes more than 300 ms, it goes to the ordinary instance's cache
instead, which falls back to memory in turn. A value the cluster does not have is a miss; the ordinary
instance is asked only after a failure.

### The client

The repository's Redis library, `redis` 6.3.1, has a cluster client (`createCluster`), so no dependency
was added. It reads the slot map through the discovery address, keeps a connection per shard, and
follows `MOVED` and `ASK` by itself. Measured on a three-shard cluster on a laptop: twelve kept answers
were spread 4, 4 and 4 over the shards; after a fourth shard was added and the slots rebalanced, all
twelve were still hits, and no read fell back.

One thing was found and fixed by running it: a service that starts before the cluster's nodes have
been joined is handed a map in which most slots have no owner, and the library then fails every command
for those slots with an error of its own. The client here now counts as connected only when all 16,384
slots have an owner, and reads the map again after any failed command.

### Hash tags, and scripts with more than one key

A script runs on one shard, so every key it names must be in one slot. A request that names keys in
different slots is refused: `CROSSSLOT Keys in request don't hash to the same slot`. To put keys in one
slot on purpose, give them a *hash tag*: when a key contains `{...}`, only the part inside the braces
is hashed. From the drill: `clps:cache:copilot:abc` is slot 15776 and `clps:lock:copilot:abc` is slot
11428, but `clps:cache:{copilot:abc}` and `clps:lock:{copilot:abc}` are both slot 743.

This repository's scripts each name exactly one key: the sliding-window limit
(`SLIDING_WINDOW_SCRIPT`), the breaker's compare-and-set (`COMPARE_AND_SET_SCRIPT`) and the lock's
release (`DELETE_IF_SCRIPT`). So each would run on a cluster as it is, and the drill runs two of them
there to show it. The case that would need a tag is a design that did not get built: a single script
that releases the lock and writes the answer in one step would name two keys, and they would need a
shared tag, as above. Keeping the lock on the ordinary instance and the answer on the cluster avoids
the question.

### The size, and what it costs

Two shards of the smallest node type (`redis-shared-core-nano`: half a shared CPU, 1.4 GB, no SLA; for
development and testing), no replicas, no persistence, no password and no TLS, as the ordinary instance
has none. $0.0318 a node an hour in us-east4, so **$0.0636 an hour** for two shards and $0.0954 for
three during the reshard. Google's documentation pages do not state a smallest shard count; its blog
post of 2024-10-08 says one, two and four are allowed where three was the minimum before. If the API
refuses two, three is the fallback.

## What the windows showed (2026-11-12 and 13)

The details are in [`ARCHITECTURE_PHASE_4.md`](../ARCHITECTURE_PHASE_4.md), section 9. In short:

- **Replacing the instance cost no downtime.** Terraform made the new instance before deleting the old one
  (the uptime check's `create_before_destroy` passes down), so the services moved in one deploy. The
  instance's name carries its tier so the two can exist side by side. Creating took 3 min 53 s (Standard)
  and 3 min 41 s (Basic).
- **A manual failover broke Redis for at most 12 s** as the services saw it; only follow-the-presenter
  failed (6 of 151 calls, `503`). Kept answers kept coming from the read endpoint. The `gcloud` command
  took 74 s.
- **The replica was 1 s behind the primary.** Reading kept answers from it is fine at that lag; anything
  read-after-write still belongs on the primary, as built.
- **Hit rates at this traffic decide nothing.** 33.3% before (12 reads), 27.8% for the day's kept answers and
  73.3% for audio during (18 and 30 reads). The 5 GB node was 0.13% full.
- **The cluster drill on Memorystore** matched the laptop: a plain client was refused with `MOVED` for the 6
  of 12 keys on the other shard; the cluster client wrote 12 of 12; a reshard from 2 to 3 shards took 3 min
  1 s in place, moved 6 of 12 keys to the new shard, and lost no value. Redirects during the reshard were not
  caught: the watch timed out connecting while the slot map changed.
- **The window cost about $4.19 at list price**, almost all of it the 15 h 19 min of the replica window.
- **Missed by the design:** the cluster needed a grant for the pipeline's applier (a service connection
  policy), which a design written for a laptop with the owner role did not see.

## What it cost to build

- **Code:** seven new source files in `web/shared/` and `web/copilot/`, two scripts, a second Compose
  file. 895 web tests pass after merging `main` at `62a0668`, which has 853 without this branch.
- **A write per cache read**, for the counters.
- **Three more Redis calls** for an uncached first question.
- **Money:** nothing until a window is switched on. The replica window is $0.27 an hour against $0.049
  now; the cluster window $0.0636 an hour on top.

## What would change these decisions

- **Keep the replica** if the read endpoint carries a real share of reads and a failover is something
  the site has to ride out. Neither is true at this traffic: the window is for the measurements.
- **Drop the counters for a log-based metric** if the write per read ever shows in Redis's CPU.
- **Add single flight to the voice** if `speak` misses bunch (above).
- **Move the lock to the cluster** only with hash tags, and only if answers ever stay there.
