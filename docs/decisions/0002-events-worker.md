# Decision 0002: the events worker, its outbox and its sharded counters

**Status:** built on the branch `arch/phase-1-events-worker` on 2026-11-12. Not yet applied or deployed: the
steps are in [`../ARCHITECTURE_PHASE_1.md`](../ARCHITECTURE_PHASE_1.md). It follows
[decision 0001](0001-four-services.md). Numbers called "measured" below were read from the live site's own
traces or run on one laptop, and each says which.

## What was built

The first of the four services. `events-worker` is a private Cloud Run service. It receives each co-pilot
question event from the queue (Pub/Sub) and adds to the day's counts in a Firestore database of its own,
`stats`. The How it works page shows the counts. The web server reads them with a read-only role.

```
co-pilot ──► outbox (Redis) ──► Pub/Sub topic ─┬─► BigQuery        the question log, as before
   (web/server)   relay publishes               └─► events-worker ──► Firestore "stats"
                  and marks sent                    (private)          seen/<event id>
                                                                       days/<day>/shards/<0..7>
web server ──► Firestore "stats", read-only ──► How it works page
```

Three patterns are in it, each because the one before forces it:

1. **At-least-once delivery.** Pub/Sub delivers each message at least once, never exactly once.
2. **An idempotent consumer.** So the worker must count an event once however often it arrives.
3. **A transactional outbox.** The queue's guarantee starts at the topic. Before this, the event reached the
   topic by one try with no retry, so it could be lost before the guarantee began.

## Why it is separate

No visitor ever waits on it. Its work arrives by message, not by request, and it can arrive twice. It needs
permissions nothing else has (write the `stats` database) and needs none of what the site has (the model, the
bucket, plans, Redis). It has its own failure mode: when it is down, nothing a visitor sees breaks, and its
messages wait. Keeping it inside the web server would give the web server's identity write access to the
counters and would tie a background job's deploys to the site's.

## The idempotent consumer

One Firestore commit holds two writes, applied together or not at all:

1. create `seen/<event key>`, on the condition that it does not exist;
2. add to one shard of the day's counter.

If the key is already there, Firestore refuses the whole commit and the counter is not touched. The worker
answers "done" to the queue either way.

**The key is the event's own id, not the queue's message id.** The plan said "a record of the message's id".
That is not enough once there is an outbox: when the relay publishes the same event a second time, Pub/Sub
gives it a new message id, and a consumer keyed on message ids would count it twice. So the co-pilot gives
each event an id when it is made, the id travels inside the event, and the worker keys on it. An event from
a publisher too old to send an id falls back to the message id, which still covers Pub/Sub's own redeliveries.

**How long the record is kept: 7 days.** It has to outlast every way the same event can come back. The
outbox gives up on an event after 3 days. The subscription holds an undelivered message for 3 days. So the
latest a copy can arrive is 6 days after the first. Firestore deletes the record by a time-to-live rule,
"typically within 24 hours" after it expires, which only makes the window longer.

**Checked against the real thing?** Against Google's Firestore emulator, yes: the same store code, 60 events
at once and then all 60 again, none lost and none counted twice, and a second commit for the same key
answered `409 ALREADY_EXISTS`. Against the real database, not yet. Firestore's documentation does not say
which error a failed "must not exist" returns, and two different errors share HTTP 409 (a duplicate, and
"lost to another write, try again"), so the code reads the error's name and not the HTTP code, and handles
the other candidate too. Every deploy then runs the worker's self-check on the real database before any
message reaches the new version.

## Sharded counters: 8 shards, picked by a hash of the event's id

A counter in one document is a hot key: every event writes the same document. Firestore's documentation says
"you can't update a single document at an unlimited rate". The fix is to split the counter across several
documents and add them up on read.

- **How many: 8.** The busiest moment the site allows is 30 questions a minute for everyone together (the
  `chat:all` rate limit), and they can land in the same second. 8 shards put about 4 of them on each document.
  This is a judgement, not a measurement: the documentation no longer gives a number for one document
  (the plan's "about one write a second" survives only as a comment in a code sample), and the site's real traffic, 158 questions in
  the day of the baseline, would fit in one document. The shards are built to practise the pattern.
- **What it costs:** every read of a day's count reads up to 8 documents where one would do. The web server
  keeps what it read for 30 seconds, so a copy of it reads the database at most twice a minute.
- **How a message picks one:** the first four bytes of a SHA-256 of the event's key, modulo 8. A random pick
  spreads just as evenly. The hash is used because a retried event then writes exactly the same two
  documents, which makes a retry the same request again.
- **Changing the number needs no migration.** A reader adds up whatever shards exist for the day. It never
  needs to know how many there should be. Raise it if the worker's log shows `ABORTED`; lower it if reads ever
  cost something that matters.

## The outbox

### The problem

Before, the co-pilot published each event once (`pubsubEvents`, 5 s limit, a failure logged and dropped) and
the response waited at most 250 ms for it. Three ways to lose an event: Pub/Sub refuses or times out; the
publish is slow and Cloud Run takes the CPU away when the response ends; the copy is stopped or crashes
first. In each the event existed only in the process's memory.

Measured on the live site (180 co-pilot requests in Cloud Trace, 2026-11-12 05:03 to 17:11 UTC): the publish
took 27 to 190 ms, median 51 ms, 95th percentile 77 ms. None of the 180 reached the 250 ms limit. So loss was
rare on that day. It was still possible, and nothing would have shown it.

### What the textbook pattern is, and what is different here

The transactional outbox solves the dual-write problem: a service must change its database and publish an
event, and cannot do both atomically. So it writes the event into an outbox table in the same database
transaction as the change, and a separate relay reads the table, publishes each row, and marks it sent. The
relay may publish a row twice, so consumers must be idempotent.

The co-pilot has no database change. Answering a question writes nothing lasting: the only fact worth keeping
is the event itself. So there is no transaction to join. What is left of the pattern is its second half, and
that is the half that removes the loss: **write the event somewhere that outlives the request and the copy,
before answering; publish from there; remove it only once the queue has it.**

### Where it lives: Redis

Chosen from what a co-pilot request already does. It already makes five Redis calls on the private network
(four rate limits and the answer cache). Measured in the same 180 traces: the cache read took 1 ms (median;
95th percentile 2 ms), and the four rate-limit calls together took 2 ms (95th percentile 4 ms).

| | Redis (built) | Firestore (not built) |
| --- | --- | --- |
| Added before the answer | One `HSET`. Not measured on its own yet. The same kind of call on the same connection reads at 1 ms | One document write. The only writes from this server in the traces are two plan saves: 166 ms and 191 ms |
| Added after the answer | One `HDEL`, inside the 250 ms wait that already exists | One delete. On top of a 51 ms publish it would often not fit in the 250 ms wait, the event would stay "unsent", and the relay would publish it again |
| Money per question | None. Redis is billed by size and hour, not by call | One write and one delete: $0.099 and $0.011 per 100,000 in us-east4 |
| New things to create and grant | None | A database, and write access to it for the co-pilot's identity |
| Survives the request ending, the CPU being taken away, the copy stopping or crashing, Pub/Sub refusing | Yes | Yes |
| Survives its own restart | **No.** This Redis is the Basic tier: one node, no replica, nothing on disk | Yes |

Redis was chosen. It removes every loss that comes from Cloud Run and from Pub/Sub, for about a millisecond
and no money. What it does not remove is written plainly below.

### The order of steps for one question

1. The answer is worked out.
2. **Keep:** the event is written to the outbox (`HSET clps:outbox:events <id> <event>`). The answer waits
   for this, so no answer goes out whose event exists only in this process. If Redis does not answer within
   300 ms the event is held in memory and the answer goes out anyway: analytics never costs a visitor an answer.
3. The answer is sent.
4. **Send:** the event is published to Pub/Sub. The response stays open up to 250 ms for it, as before.
5. **Mark sent:** if Pub/Sub took it, the entry is removed (`HDEL`). If not, it stays.

### The relay, and when it runs

Cloud Run gives a server CPU only while it handles a request or shuts down. So "a background relay" cannot
be trusted to run. The relay therefore runs at the three moments a copy does have CPU:

- straight after the write, in the same request (steps 4 and 5);
- on a timer every 20 seconds, which only ticks while the copy is handling some request. It picks up entries
  older than 15 seconds left by any copy, one copy at a time (a short lock in Redis), and waits longer after
  each failure, up to 5 minutes;
- when the copy is told to stop (Cloud Run allows 10 seconds, with CPU).

So an event whose first publish failed is **late, not lost**. It goes out with the next request any copy
handles, or when a copy stops. The textbook relay is a process with a clock. A clock here would be a Cloud
Scheduler job calling a private endpoint every minute, plus an identity and a grant for it, plus either
giving the worker access to Redis or adding a token-checked endpoint to the public server. That was not
built. All it would add is a bound on how late an already-failed event can be on a site nobody is using.

### What the outbox costs per question

- **Time before the answer:** one Redis write. Expected at about a millisecond from the calls measured
  above. To be measured after the deploy: it has its own step, `outbox`, in every co-pilot trace.
- **Time after the answer:** one Redis delete, inside the existing wait.
- **Money:** none for the outbox.
- **The counters, per question:** two Firestore document writes ($0.099 per 100,000) and later one
  time-to-live delete ($0.011 per 100,000): $0.0000021. At the baseline's 158 questions a day that is
  $0.0003 a day; at the site's ceiling of 1,500 a day, $0.003. Named databases get no free allowance
  according to the pricing page. One Cloud Run request per message, inside Cloud Run's monthly free tier
  at this volume.

### What it does not fix

- **Redis itself restarting while an event waits.** Basic tier keeps nothing. In the usual case an event
  waits about 50 ms (the publish). If Pub/Sub is down for an hour and Redis restarts in that hour, that
  hour's events are lost.
- **Redis unreachable at the moment of the write.** The event is held in the copy's memory and published as
  before the outbox existed.
- **Duplicates in the BigQuery log.** The table is not an idempotent consumer. A relay that sends twice
  writes two rows. The table now has an `id` column so the copies can be seen and dropped in a query.
- **A copy that crashes between working out the answer and step 2.** No event and no answer: the visitor
  sees an error, so nothing was answered without being counted.

## What it cost

Measured or counted on 2026-11-12:

- **Code:** a second program in the repository (`web/events-worker/`), a shared folder (`web/shared/`), and
  a second deploy workflow. Five files moved (below).
- **Image:** 347 MB unpacked for the worker against 580 MB for the site, both built on one laptop (arm64).
  The worker's own code is one bundled file of 857 kB; the rest is the Node base image.
- **Infrastructure:** 16 new resources, 7 of them grants and 2 of them alerts, and 2 small changes to
  existing ones (all listed in `ARCHITECTURE_PHASE_1.md`).
- **Money:** fractions of a cent a day (above). The worker scales to zero.
- **Visitors:** one Redis call more before an answer. To be confirmed against the baseline after the deploy.
- **A shared-code release.** `web/shared/` is copied into both images. A change there redeploys both.
- **Not yet known:** the worker's cold start, memory use, and how many messages one copy handles at once.
  Its timeout (30 s) and concurrency (20) are starting values, not measured ones.

## What moved

| From | To | Why |
| --- | --- | --- |
| `web/server/trace.ts`, `trace.test.ts` | `web/shared/` | Both services trace. It gained reading and writing a trace in a message attribute |
| `web/server/events.ts`, `events.test.ts` | `web/shared/` | The event's shape is the contract between publisher and consumer |
| `web/server/http.ts` | `web/shared/` | Both services answer JSON |
| The token source and the Cloud Trace sink, out of `web/server/google.ts` | `web/shared/google.ts` | Both services call Google as themselves |
| Google's signature check, out of `web/server/identity.ts` | `web/shared/googleJwt.ts` | Sign-in and the worker's caller check verify the same kind of token |

Everything else in `web/server/` stayed where it was.

## What would make us merge it back into the co-pilot

- **Nobody reads the counters.** A worker with no reader is a service kept for show (decision 0001).
- **It is deployed every time the site is.** Then the boundary is in the wrong place.
- **The counts can simply be queried.** BigQuery already holds every question. If a count that is a minute
  old and costs a query is good enough, the saved view `questions_daily` is the whole feature, with no
  worker, no second database and no outbox.

And what would make us change the outbox: move it to Firestore if the question log ever feeds something
where a lost event costs money; add the clock-driven relay if the server ever logs "Outbox: sent N events
that had been left waiting" for events that were hours old.
