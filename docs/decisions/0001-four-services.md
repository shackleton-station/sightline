# Decision 0001: split the server into four services

**Status:** accepted. The architecture plan records Rodrigo's approval on 2026-11-12. Nothing is built yet.
The numbers before the split are in [`../ARCHITECTURE_BASELINE.md`](../ARCHITECTURE_BASELINE.md).

## Where we start

The site is one program in one container (`web/server/`) on Cloud Run, Google's service that runs a
container and starts or stops copies of it with the traffic. It serves the pages, streams terrain tiles and
video from a bucket, saves shared mission plans, runs the AI co-pilot, speaks its answers, and carries
"follow the presenter". It runs as one identity (the account a service acts as in the cloud), and that one
identity holds every permission any of those needs. That is the right design for a demo this size, and it
works: a page answers in about 40 ms.

So the split is not a fix. It is practice at designing and running several services, done on a practice app
where a mistake costs nothing. That sets the rule for the whole decision: a part becomes a service only when
there is a reason we could defend to someone who asked "why not leave it in?".

## What we decided

Four services, each its own container image, its own identity with only the permissions its code uses, its
own limit on copies, and its own deploy. They sit side by side behind the one load balancer, which sends each
path to its service. The browser still sees one address.

**`web`** is the front door: pages, tiles, video, voice, rooms and `/api/status`. Its requests are fast and
cheap, and it is what a visitor meets first, so it should never wait on anything slow.

**`plans`** answers `/api/plans`. It is separate because it is the only part that owns a database: after the
split, only its identity can read or write the `plans` database, and `web` cannot. It is also plain request
and reply, so it goes first and proves the routing and the deploy steps on something simple.

**`copilot`** answers `/api/chat` and `/api/ask`. It is separate because its requests are a different kind of
work: seconds, not milliseconds (a median of 4.7 s for an uncached question against about 40 ms for a page),
and each one costs money. It needs its own timeout, its own ceiling on copies, and the only permission to
call the model. When the model is down or slow, pages and plans keep working.

**`events-worker`** receives each co-pilot question from the queue (Pub/Sub) and keeps running counts in a
second database, `stats`. No visitor ever waits on it and it has no public address. It is separate because
it is the asynchronous half: work that arrives by message, can arrive twice, and must cope.

No service calls another to answer a visitor. The one exception is `web`'s status page, which asks `plans` and
`copilot` how they are, with a short timeout.

## What stays in `web`, and why

**Voice** (`/api/speak`) has its own paid API and its own daily ceiling, which is a fair case for a service.
It would teach little that `copilot` does not already show, so it stays.

**Tiles and video** are better served by no service at all: the load balancer can read the bucket directly.
That is planned for later, as a removal from `web` and not as a fifth service.

**The sign-in check and the rate limits** are shared code, not services. A network call on every request to
check a token or count a visit would add delay and a new way to fail, for nothing.

**Follow the presenter** (`/api/rooms`) is the honest fifth candidate. It is unlike everything else in `web`:
each follower holds a connection open for 55 seconds, so it needs copies in proportion to open connections
and not to requests, and it keeps state in each copy's memory. It stays for now because four was the number
agreed, and because it was merged the same day as this decision and has never run with real phones or with
two copies on the real Redis (`../OPEN_QUESTIONS.md`, 15): moving it now would change two unknowns at once.
The cost of leaving it is that `web` keeps its Redis connection, and that long streams count against `web`'s
speed objective.

## What it costs

- **More cold starts.** A cold start is the wait while a new copy starts. Today one copy starting (2 to 3 s)
  makes everything ready. After the split a first visit can wait on `web`, and a first question on `copilot`
  as well.
- **More to deploy and watch.** Four images, four deploy workflows, four sets of objectives and alerts, in
  place of one. Each image that reads the site data carries its own copy (102 MB before compression).
- **The services are not fully independent.** They share a folder of code, the site data and one Redis. A
  change to the shared code or the data redeploys every service that uses it, and Redis has no permissions,
  so a key prefix per service is a convention and nothing more.
- **Pages and APIs can be a version apart**, because they no longer deploy together. API changes have to be
  additive from now on, and each API needs a written contract and a test against it.
- **Money: close to nothing.** Services that scale to zero cost nothing idle and the load balancer's price
  does not change. Keeping a second service warm would cost about $0.32 a day at list price.

## What would make us merge two back

- **`plans` into `web`:** if opening a shared plan is slower than before the split (a median of 178 ms and a
  95th percentile of 251 ms, measured 2026-11-12) once `plans` is warm, or if its cold start is what people
  meet when they open a shared link and keeping it warm is the only cure. Owning a database is a good reason
  for a service; it is not worth a slower link.
- **`copilot` into `web`:** only if the model stopped being slow and paid for, which would remove both
  reasons at once. We do not expect it.
- **`events-worker` into `copilot`:** if nobody reads the counters. A worker with no reader is a service
  kept for show.
- **Any two:** if they turn out to be deployed together every time, because every change touches the shared
  code or the data. Then the boundary is in the wrong place, and one service is the truthful design.

Each later decision record says what its own split cost in measured numbers, against the baseline.
