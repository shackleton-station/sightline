# The co-pilot API: what the pages and the service agree on

The pages (`web/src/lib/chatClient.ts` for the co-pilot, `web/src/components/AskBox.tsx` for the
typed-question box) and the co-pilot service (`web/copilot/`) are deployed apart, so a visitor's page
can be older or newer than the service it calls. This file is the written agreement between them.
`contract.test.ts` reads the blocks below and checks the service against each one, and the web
server too while it can still answer these paths, so this file cannot drift from the code without a
test failing.

## The rules for changing it

1. **Changes are additive only.** A new optional request field, a new reply field or a new reply is
   fine. A field or a reply listed here is never renamed, removed or given another type or meaning.
2. **Readers ignore what they do not know.** The service ignores request fields and headers it does
   not know. The pages ignore reply fields and stream events they do not know.
3. **A new field is written here first**, in the same pull request as the code. The test fails if
   the service sends a field this file does not list.
4. If something here really must go, it goes in two releases, never one: first the pages stop
   using it; later, it is removed here and in the service.

## How to read a block

Each block is one operation. `request` lists what may be sent. `replies` lists every answer, by HTTP
status, with the shape of its JSON body and any header it must carry. A value is a type: `string`,
`string|null`, `boolean`, `number`, `seconds` (a header holding a whole number of seconds, at least
1), a list `[…]` of a shape, or `=word` for exactly that word. A name ending in `?`
may be left out. A streamed answer lists its `events` instead of a body: each event's name and the
shape of its JSON `data`.

Every JSON reply carries `cache-control: no-store`. The edge firewall and the load balancer can
answer before the service is reached, with a body of their own that is not JSON: the firewall's 429,
and during a fault-injection drill (docs/ARCHITECTURE_PHASE_3.md) a 503 with no `Retry-After`. The
page treats a 429 or 503 without the header as "busy, wait 15 s".

## "Busy" and `Retry-After`

Every answer that means "not now, later" is a 429 or a 503 with `{"error":"busy"}`, a `Retry-After`
header giving the wait in whole seconds, and the same number in the body as `retryAfterSeconds`:

| When | Status | The wait |
| --- | --- | --- |
| A rate limit refused the request | 429 | Until the oldest counted request leaves its window: at most 60 s for the per-minute limits, longer for the daily ones |
| The model said it is out of capacity, after the service's own retries | 429 | What the model said, or 10 s |
| The circuit breaker is open: the model failed several times in a row, and is not being called | 503 | Until the breaker lets a trial question through: at most 30 s |

A streamed answer whose headers have already gone says "busy" as an `error` event carrying
`retryAfterSeconds`. The page waits that long before it lets the visitor ask again, and says so.

`503 {"error":"not-configured"}` means no model is set up. Waiting will not change that, so it has
no `Retry-After`.

The limits are the same as before the service was split out, counted in the same Redis keys:
6 questions a minute and 20 a day per visitor, 30 a minute and 120 a day for everyone together;
10 typed questions a minute and 30 a day per visitor, 30 a minute and 150 a day for everyone. The daily
numbers were lowered with the move to Claude (they were 60 and 1,500 for questions, and typed questions
had none), so that the model cannot cost more than about $15 a day (docs/decisions/0009-copilot-on-claude.md).

## Ask the co-pilot

```json contract
{
  "operation": "chat",
  "method": "POST",
  "path": "/api/chat",
  "request": {
    "headers": { "origin": "the site's own origin; required", "content-type": "application/json", "accept?": "text/event-stream for a streamed answer (next block)" },
    "body": { "messages": [{ "role": "=user or =assistant", "text": "string" }], "view?": "string", "spot?": "string" }
  },
  "replies": {
    "200": { "body": { "reply": { "text": "string", "actions": [{ "label": "string", "hash": "string" }], "sources": ["string"], "followups": ["string"] } }, "headers": { "x-cache": "=miss" } },
    "200 kept": { "body": { "reply": { "text": "string", "actions": [{ "label": "string", "hash": "string" }], "sources": ["string"], "followups": ["string"] } }, "headers": { "x-cache": "=hit" } },
    "400": { "body": { "error": "=bad-question" } },
    "403": { "body": { "error": "=origin" } },
    "405": { "body": { "error": "=method" } },
    "429 limit": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "429 model": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "502": { "body": { "error": "=upstream" } },
    "503 busy": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "503 not-configured": { "body": { "error": "=not-configured" } }
  }
}
```

`messages` is the conversation so far, ending with the visitor's question: at most 400 characters a
question, and only the last 12 turns are read. `view` is the part of the page's address after `#`.
`spot` is ground tapped on the Atlas map, as `"lat,lon"` in degrees. Every number in `text` was
filled in by the service from a tool's result; `actions` are links to views of the app, rebuilt by
the service from checked parts. When the model declines a question (`stop_reason: "refusal"`), `text`
says plainly that it could not be answered, with no actions or follow-ups; such a reply is never kept. A first question about the same view is answered from a kept answer
for up to a day (`x-cache: hit`), as long as the co-pilot's code and the site data are unchanged.

## Ask the co-pilot, with the lookups streamed as they happen

```json contract
{
  "operation": "chat-stream",
  "method": "POST",
  "path": "/api/chat",
  "request": { "headers": { "origin": "the site's own origin; required", "content-type": "application/json", "accept": "text/event-stream" }, "body": "as for chat" },
  "replies": {
    "200": {
      "headers": { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform" },
      "events": {
        "step": { "title": "string" },
        "reply": { "reply": { "text": "string", "actions": [{ "label": "string", "hash": "string" }], "sources": ["string"], "followups": ["string"] } },
        "error": { "error": "string", "retryAfterSeconds?": "number" }
      }
    }
  }
}
```

Zero or more `step` events, then exactly one `reply` or `error`, then the stream ends. A `step`
is a lookup, with one exception: when another request is already working out the same first
question, this one waits for that answer and is sent one `step` saying so (`x-cache` is then `miss`,
because the headers went before the answer was kept). Each event is
`event: <name>` and `data: <JSON>` on two lines, then a blank line. `error` is `upstream`, or `busy`
with `retryAfterSeconds`. Anything refused before the answer starts (a limit, the origin, a bad
question, an open breaker) is an ordinary JSON reply from the block above, with its status and headers.

## Turn a typed question into settings

```json contract
{
  "operation": "ask",
  "method": "POST",
  "path": "/api/ask",
  "request": { "headers": { "origin": "the site's own origin; required", "content-type": "application/json" }, "body": { "question": "string" } },
  "replies": {
    "200": { "body": { "result": { "sites": ["string"], "month": "string|null", "requirements": { "missionDays?": "number", "maxSunGapH?": "number", "maxEarthGapH?": "number", "sunAtLanding?": "boolean", "earthAtLanding?": "boolean", "minEarthClearanceDeg?": "number" } } } },
    "400": { "body": { "error": "=bad-question" } },
    "403": { "body": { "error": "=origin" } },
    "405": { "body": { "error": "=method" } },
    "422": { "body": { "error": "=not-understood" } },
    "422 declined": { "body": { "error": "=declined" } },
    "429 limit": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "429 model": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "502": { "body": { "error": "=upstream" } },
    "503 busy": { "body": { "error": "=busy", "retryAfterSeconds": "number" }, "headers": { "retry-after": "seconds" } },
    "503 not-configured": { "body": { "error": "=not-configured" } }
  }
}
```

`question` is at most 400 characters. The model only picks settings; anything outside what the
page's own inputs accept is dropped, and the page computes every number. `declined` (added with the
move to Claude, docs/decisions/0009-copilot-on-claude.md) means the model's safety classifiers
declined the question (`stop_reason: "refusal"`), after the server-side fallback had its go; asking
the same again would be declined again. A page from before it shows its general error.

## The service's status

Only the co-pilot service answers this. The web server has no co-pilot and answers `404` for every
path here, this one included. So asking for it says whether an address reaches the co-pilot service
(the site's public address, the service's own) or only the web server (the web server's own).

```json contract
{
  "operation": "status",
  "method": "GET",
  "path": "/api/chat/status",
  "request": {},
  "replies": {
    "200": {
      "body": {
        "service": "=copilot",
        "version": "string",
        "revision": "string",
        "region": "string|null",
        "dataVersion": "string",
        "codeVersion": "string",
        "model": "string",
        "modelSettings": "object|null",
        "limits": "string",
        "redis": { "state": "string", "readEndpoint": "string", "connections": "number", "fallbacks": "number" },
        "answers": "string",
        "breakerStore": "string",
        "questionLog": "boolean",
        "tracing": "boolean"
      }
    }
  }
}
```

`version` is the commit the image was built from. `region` is the Google Cloud region of the copy that answered (`us-east4`, or the second region's name while Phase 8's second region is on), or `null` on a laptop. `dataVersion` is a hash of the site data in the
image; a deploy fails if it differs from the web server's. `codeVersion` is a hash of the files the
co-pilot's handlers are built from; kept answers are keyed by it and by `dataVersion`. `model` is
`claude`, `none`, `scripted` (the stand-in for a laptop) or says that faults are being injected for a
drill; it was `gemini` until the move to Claude (docs/decisions/0009-copilot-on-claude.md), and no
page reads it. `modelSettings` is `{ "model": string, "speed": "fast"|"standard"|null, "effort":
string, "fallbacks": "default", "auth": "federation"|"api-key" }`: which Claude answers, its speed
(`null` when no speed field is sent), its effort, the server-side fallback setting, and how the
service signs in to the Anthropic API (`federation` in the cloud; `api-key` only on a laptop); `null`
with the stand-in or with no model. No token or key is ever in the status. `limits` is `redis`, `memory`, or `redis-unreachable`. `breakerStore` is where the circuit
breaker's state is kept: `redis` (shared by every copy) or `memory`.

`redis` says where the copy that answered is serving from right now. `state` is `redis` (connected,
and the last call was answered), `fallback` (the last call failed or was not answered in time, and
this copy's memory answered), `reconnecting` (the connection is down and being re-made; memory
answers) or `memory` (no Redis is set up). `readEndpoint` is the connection kept answers are read
from when the instance has read replicas: `ready`, `reconnecting`, or `none`. `connections` counts
connections made to the primary since the copy started, so more than 1 means it has reconnected.
`fallbacks` counts calls that memory answered. `answers` is where kept answers live: `redis`,
`memory`, `cluster` during the Redis Cluster window, or `cluster-connecting`. Each copy reports
its own view.

## Hit rates and memory

```json contract
{
  "operation": "cache-status",
  "method": "GET",
  "path": "/api/chat/status/cache",
  "request": {},
  "replies": {
    "200": {
      "body": {
        "redis": { "state": "string", "readEndpoint": "string", "connections": "number", "fallbacks": "number" },
        "days": [{ "day": "string", "cache": "object", "flights": "object", "clusterFellBack": "object" }],
        "memory": "object|null",
        "readAt": "string"
      }
    }
  }
}
```

Read-only. `days` is today and yesterday (UTC), today first. `cache` has one entry per kind of
cached key, `copilot` (kept answers) and `speak` (spoken audio, counted by the web server into the
same Redis): `{ "hits": n, "misses": n, "hitRate": 0 to 1, or null }`. `flights` says, per kind,
how many requests did what when an answer was missing: `led`, `found`, `waited`, `took-over`,
`gave-up`, `no-lock` (`shared/singleFlight.ts`). `clusterFellBack` counts reads and writes meant
for the Redis Cluster that went to the ordinary instance. `memory` is `{ "usedBytes": n,
"maxBytes": n }`, the primary's `used_memory` and `maxmemory`, or `null` when it cannot be asked. The answer is reused for 5 s. With no
Redis, `days` is empty and `memory` is `null`.

## The status for the web server

```json contract
{
  "operation": "status-for-web",
  "method": "GET",
  "path": "/api/chat/status/web",
  "request": { "headers": { "authorization": "Bearer <Google identity token: audience clps-copilot, email the web server's service account>; required" } },
  "replies": {
    "200": {
      "body": {
        "service": "=copilot",
        "version": "string",
        "revision": "string",
        "region": "string|null",
        "dataVersion": "string",
        "codeVersion": "string",
        "model": "string",
        "modelSettings": "object|null",
        "limits": "string",
        "redis": { "state": "string", "readEndpoint": "string", "connections": "number", "fallbacks": "number" },
        "answers": "string",
        "breakerStore": "string",
        "questionLog": "boolean",
        "tracing": "boolean",
        "breaker": { "state": "string", "retryAfterSeconds": "number", "opensAfter": "number", "withinSeconds": "number", "openSeconds": "number" },
        "retries": "number"
      }
    },
    "401": { "body": { "error": "=caller", "why": "string" } },
    "403": { "body": { "error": "=caller", "why": "=not-web" } },
    "503": { "body": { "error": "=not-configured" } }
  }
}
```

The web server's `/api/status/services` calls this, for the How it works page. The token is checked
by the service itself: Google's signature, the audience, and that the caller is the web server
(`shared/statusCaller.ts`). `breaker.state` is `closed`, `open` or `half-open`.

## Check with Horizons

`POST /api/chat/horizons` with `{ "lat": number, "lon": number, "altKm": number (optional, 0), "hour":
"2027-05-06T13:00:00Z" }`: NASA JPL Horizons' apparent azimuth and elevation of the Sun and Earth at
that point on the Moon and that whole hour (UTC, inside the app's data: `range.json`). No model is
called. It is here, under `/api/chat/`, because this service is the one with a way out to the
internet and that is the only prefix the load balancer sends it.

- `200`: `{ lat, lon, altKm, hour, sun: { azDeg, elDeg }, earth: { azDeg, elDeg }, ephemeris, cached }`.
- `400` `{ "error": "bad-request" }`, `403` `{ "error": "origin" }`, `405` `{ "error": "method" }`.
- `429` `{ "error": "busy", "retryAfterSeconds": number }` with `Retry-After`: a visitor gets 6 a
  minute; lookups that reach JPL are capped at 20 a minute and 2,000 a day for everyone together.
- `502` `{ "error": "upstream" }`: Horizons was slow (8 s), down, or sent something that is not a
  table. The page shows "Horizons did not answer."

An answer is kept for 30 days and served from the cache after that. Requests to JPL leave each copy
of the service one at a time, as JPL's fair-use policy asks. This section has no contract block: the
route's replies are checked in `horizons.test.ts`.

Scout reaches the same lookup through its tool `horizons_check` (`web/shared/tools/horizonsTool.ts`): one
listed site at one hour, at the height the pipeline's own comparison used for that site, with
Horizons' four angles set beside the app's. It shares the cache and the two limits on requests to JPL.

