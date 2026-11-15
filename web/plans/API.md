# The plans API: what the pages and the service agree on

The pages (`web/src/lib/plans.ts`) and the plans service (`web/plans/`) are deployed apart, so a
visitor's page can be older or newer than the service it calls. This file is the written agreement
between them. `contract.test.ts` reads the blocks below and checks the service against each one, so
this file cannot drift from the code without a test failing.

## The rules for changing it

1. **Changes are additive only.** A new optional request field, a new reply field or a new reply is
   fine. A field or a reply listed here is never renamed, removed or given another type or meaning.
2. **Readers ignore what they do not know.** The service ignores request fields and headers it does
   not know. The pages ignore reply fields they do not know.
3. **A new field is written here first**, in the same pull request as the code. The test fails if
   the service sends a field this file does not list.
4. If something here really must go, it goes in two releases, never one: first the pages stop
   using it; later, it is removed here and in the service. A tab left open keeps its old code until
   it is reloaded, so "later" means a wait, not the next commit.

## How to read a block

Each block is one operation. `request` lists what may be sent: headers, a JSON body, and `query`, the
parameters after `?` in the address. `replies` lists every answer, by HTTP
status, with the shape of its JSON body. A value is a type: `string`, `boolean`, `time` (an ISO 8601
time in UTC), `id` (8 letters from `abcdefghjkmnpqrstuvwxyz23456789`), a list `[…]` of a shape, or
`=word` for exactly that word. A name ending in `?` may be left out.

Every reply is JSON and carries `cache-control: no-store`. Every operation can also answer
`429 {"error":"busy"}` (a rate limit), `502 {"error":"upstream"}` (the database did not answer) and
`503 {"error":"not-configured"}` (no database is set up). The edge firewall can answer 429 with a
body of its own before the service is reached.

The same limits apply as before the service was split out: 5 saves or deletes a minute per visitor,
300 saves a day for everyone together, 60 opens or lists a minute per visitor.

## Save a plan

```json contract
{
  "operation": "save",
  "method": "POST",
  "path": "/api/plans",
  "request": {
    "headers": {
      "origin": "the site's own origin; required",
      "content-type": "application/json",
      "authorization?": "Bearer <Google sign-in token>; the plan then has an owner",
      "idempotency-key?": "16 to 64 letters, digits, - or _, optionally in double quotes; see below"
    },
    "body": { "title": "string", "note?": "string", "view": "string" }
  },
  "replies": {
    "201": { "body": { "id": "id" } },
    "201 replayed": { "body": { "id": "id" }, "headers": { "idempotent-replayed": "=true" } },
    "400 bad-plan": { "body": { "error": "=bad-plan" } },
    "400 bad-key": { "body": { "error": "=bad-key" } },
    "401": { "body": { "error": "=sign-in" } },
    "403": { "body": { "error": "=origin" } },
    "422": { "body": { "error": "=key-reused" } }
  }
}
```

`title` is at most 80 characters and `note` at most 400, after runs of spaces are joined. `view` is
the part of a page's address after `#`, at most 1,500 characters. The service stores a view only after
reading it and writing it out again: the app's own link (`a`, `b`, `t`, `limits`, `view`, `mode`, `list`) and the
values the Sightline screen adds to it, each checked (`slope`, `hp`, `ha`, `sc`, `acc`, `accs`, `accd`, `sky`,
`planner`, `panel`, `sl`; `web/src/lib/planView.ts` holds the list). Anything else in a view is dropped. `sl=1` marks a
plan saved from the Sightline screen, so the page that opens a short link can tell it from a plan an older page
saved. Plans stored before a value was added are returned as they were stored: nothing is rewritten on read. The whole body is at most 4,000
characters. A plan is kept for 180 days.

**The idempotency key.** The page makes up a random key for each attempt to save and sends the same
key again when it retries. For 24 hours the service remembers which plan a key made:

- The same key with the same plan (the same title, note, view and owner) gets `201` with the first
  answer's `id` again and the header `idempotent-replayed: true`. Nothing is saved a second time.
- The same key with a different plan gets `422`.
- A request that saved nothing (any reply but `201`) does not use the key up.
- A request with no key is always a new plan, as it was before keys existed.

## Open a plan

```json contract
{
  "operation": "open",
  "method": "GET",
  "path": "/api/plans/<id>",
  "request": { "headers": { "authorization?": "Bearer <Google sign-in token>" } },
  "replies": {
    "200": {
      "body": {
        "plan": { "id": "id", "title": "string", "note": "string", "view": "string", "brief": [{ "label": "string", "value": "string" }], "created": "time", "expires": "time" },
        "mine": "boolean"
      }
    },
    "404": { "body": { "error": "=not-found" } }
  }
}
```

`mine` is true only for the signed-in visitor who saved the plan. Who that is, is never sent.

## List my plans

```json contract
{
  "operation": "list",
  "method": "GET",
  "path": "/api/plans",
  "request": {
    "headers": { "authorization": "Bearer <Google sign-in token>; required" },
    "query": { "limit?": "how many plans on the page, a whole number from 1 to 100; 50 if left out", "after?": "the next value of the page before; left out for the first page" }
  },
  "replies": {
    "200": { "body": { "plans": [{ "id": "id", "title": "string", "created": "time", "expires": "time" }], "next?": "string" } },
    "400 bad-limit": { "body": { "error": "=bad-limit" } },
    "400 bad-cursor": { "body": { "error": "=bad-cursor" } },
    "401": { "body": { "error": "=sign-in" } }
  }
}
```

Newest first, one page at a time. Two plans saved in the same millisecond come in a fixed order.

- `next` is there only when more plans follow. To get them, send it back unchanged as `after`, with
  the same `limit` or another. Its content is not part of this agreement: a page must not read it or
  make one up. The service answers `400 bad-cursor` to anything it did not write.
- A plan saved or deleted between two pages moves nothing: the next page starts just after the last
  plan of the one before, even if that plan has since been deleted. A plan saved meanwhile is newer
  than every plan already listed, so it appears on the first page the next time the list is read.
- `limit` outside 1 to 100, or not a whole number, is `400 bad-limit`.
- A request with neither parameter gets the newest 50, as before pages existed. A page that does
  not know about `next` ignores it and shows those 50.
- `401` comes before either `400`: the parameters are only read for a signed-in visitor.

Added on 2026-11-12 (Phase 5): `query`, `next`, and the two `400` replies.

## Delete a plan

```json contract
{
  "operation": "delete",
  "method": "DELETE",
  "path": "/api/plans/<id>",
  "request": { "headers": { "origin": "the site's own origin; required", "authorization": "Bearer <Google sign-in token>; required" } },
  "replies": {
    "200": { "body": { "deleted": "id" } },
    "401": { "body": { "error": "=sign-in" } },
    "403 origin": { "body": { "error": "=origin" } },
    "403 not-yours": { "body": { "error": "=not-yours" } },
    "404": { "body": { "error": "=not-found" } }
  }
}
```

## Any other method

```json contract
{
  "operation": "other-method",
  "method": "PUT",
  "path": "/api/plans/<id>",
  "request": {},
  "replies": { "405": { "body": { "error": "=method" } } }
}
```

## The service's status

Only the plans service answers this. The web server has no plans API and answers `404` for every
path here, this one included. So asking for it says whether an address reaches the plans service
(the site's public address, the service's own) or only the web server (the web server's own).

```json contract
{
  "operation": "status",
  "method": "GET",
  "path": "/api/plans/status",
  "request": {},
  "replies": {
    "200": {
      "body": {
        "service": "=plans",
        "version": "string",
        "revision": "string",
        "region": "string|null",
        "dataVersion": "string",
        "store": "string",
        "limits": "string",
        "redis": { "state": "string", "readEndpoint": "string", "connections": "number", "fallbacks": "number" },
        "signIn": "boolean",
        "tracing": "boolean",
        "idempotencyKeyHours": "number"
      }
    }
  }
}
```

`version` is the commit the image was built from. `region` is the Google Cloud region of the copy that answered (`us-east4`, or the second region's name while Phase 8's second region is on), or `null` on a laptop. `dataVersion` is a hash of the site data in the
image; a deploy fails if it differs from the web server's. `store` is `firestore` or `memory`,
`limits` is `redis`, `memory`, or `redis-unreachable` while Redis is set up but cannot be reached
(the limits are then counted in each copy's memory). `redis` says the same in more detail, for the
copy that answered: `state` is `redis`, `fallback` (the last call to Redis failed and memory
answered), `reconnecting` or `memory`; `readEndpoint` is always `none` here, because this service
reads no cache; `connections` counts connections made since the copy started; `fallbacks` counts
calls that memory answered.

## The status for the web server

Added in Phase 3 (docs/ARCHITECTURE_PHASE_3.md). The web server's `/api/status/services` calls this
with an identity token from Google, for the How it works page. The service checks the token itself:
Google's signature, that it was made for `clps-plans`, and that the caller is the web server
(`shared/statusCaller.ts`). The reply is the public status and `checkedAs`.

```json contract
{
  "operation": "status-for-web",
  "method": "GET",
  "path": "/api/plans/status/web",
  "request": { "headers": { "authorization": "Bearer <Google identity token: audience clps-plans, email the web server's service account>; required" } },
  "replies": {
    "200": {
      "body": {
        "service": "=plans",
        "version": "string",
        "revision": "string",
        "region": "string|null",
        "dataVersion": "string",
        "store": "string",
        "limits": "string",
        "redis": { "state": "string", "readEndpoint": "string", "connections": "number", "fallbacks": "number" },
        "signIn": "boolean",
        "tracing": "boolean",
        "idempotencyKeyHours": "number",
        "checkedAs": "=web"
      }
    },
    "401": { "body": { "error": "=caller", "why": "string" } },
    "403": { "body": { "error": "=caller", "why": "=not-web" } },
    "503": { "body": { "error": "=not-configured" } }
  }
}
```
