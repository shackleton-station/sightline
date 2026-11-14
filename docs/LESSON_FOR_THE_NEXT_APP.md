# A lesson for the next app: the seams that make a later split cheap

This is a lesson, not code. The hackathon app starts from scratch, and nothing here is copied into it. Rodrigo
carries the lesson over by hand. It comes from splitting this practice app into four services on 2026-11-12,
where the baseline found 16 places the code would not split cleanly (`ARCHITECTURE_BASELINE.md`, section 2.5).
Build one service on the weekend. These five habits cost almost nothing on day one and decide whether a split
later takes a day or a week.

**Handlers take everything as arguments.** One file reads the settings and makes the real clients (the model,
the database, Redis, the bucket) and hands them to each handler. A handler is a function of the request and
what it was given, so a test passes fakes and a later service passes only what it needs. Here this held for
almost everything, which is why the split was possible at all. The exceptions were what hurt: a cache key that
read the deploy's name from the environment when the module loaded, a handler that bundled a data file at build
time instead of reading it through its arguments, and one shared list of dependencies that named every
feature's types, so no service could be built with less.

**One folder per future service, and no reaching across.** Put each likely service's code in its own folder
from the start, with shared helpers in one shared folder. The costliest knot here was the plans code importing
four modules from the co-pilot's folder, which pulled in the whole tool set. A rule as simple as "a feature
folder imports only from itself and the shared folder", checked by a test, would have prevented it.

**No shared state in memory.** Anything two requests must agree on lives outside the process: rate limits, a
circuit breaker, a lock, a room. A copy may keep a cache it can rebuild, nothing more. Two things to know:
Cloud Run gives a server no CPU after the response, so "do it afterwards" is not a plan; and anything held in
one copy's memory reaches only the visitors connected to that copy, which is why presenters' rooms were the
one feature with no fallback when Redis failed over.

**A contract per API.** Write down each API's requests and replies in a short file, make changes additive
only, and let the page ignore fields it does not know. Once the page and the API deploy apart, they will be a
version apart, and the contract is what keeps that harmless. Keep one status address per service whose shape
is itself a contract: here the page and every deploy read it.

**A data version.** If several parts read the same generated data, give that data a version that is a hash of
its content, report it from every status address, and key anything cached from the data by it. Then a deploy
can refuse to mix data, a cache entry can never outlive its data, and a deploy that changes nothing a part
uses does not empty its cache.
