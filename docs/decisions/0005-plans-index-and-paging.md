# Decision 0005: the "my plans" index, cursor paging, and keeping the service up while the index builds

**Status:** built, applied, deployed and checked on 2026-11-12; what the checks showed is in
[`../ARCHITECTURE_PHASE_5.md`](../ARCHITECTURE_PHASE_5.md), section 9. It changes the plans service of
decision [0003](0003-plans-service.md). The DynamoDB design written beside it is in
[`../SYSTEM_DESIGN.md`](../SYSTEM_DESIGN.md), "Plans in DynamoDB, on paper".

## The problem

"My plans" is the list a signed-in visitor sees in the share dialog. Before this phase the plans code asked
Firestore for up to 200 of the visitor's plans with one equality filter on `owner`, and sorted them in memory.
Firestore answers that query from the index it keeps on every field by itself, in document-id order
(Query Explain on the live database: `(owner ASC, __name__ ASC)`). Plan ids are random, so those 200 are a
random 200. Someone with more than 200 plans could miss their newest. Nobody has that many today; the point
of the phase is the pattern, and that the edge case is closed.

## What was decided

### 1. Plan ids stay random

`web/shared/ids.ts` makes each id from 8 letters picked with `crypto.randomInt`. Firestore splits a
collection across machines by ranges of document id. Ids that follow one another (a counter, or a time
written first) would put every new plan at the end of the range, on one machine: a "hotspot". Google's
best-practices page says it plainly: do not use monotonically increasing document ids, because "such
sequential IDs can lead to hotspots that impact latency". Random ids land all over the range.
`web/shared/ids.test.ts` now pins this: 2,000 ids never repeat, one id is larger than the one before it
about half the time (a counter would be every time), and every possible first letter appears.

### 2. One composite index: `owner` ascending, `created` descending, then the document id descending

Filtering on one field and ordering by another needs a composite index, which Firestore does not create by
itself. It is declared in `infra/data.tf` as `google_firestore_index.plans_by_owner`. It is the Firestore
version of a DynamoDB partition key plus sort key: `owner` picks one person's plans, `created` orders them.

The document id is the last field because Firestore ends every composite index on it, in the direction of
the field before it (the provider's documentation, quoted in the phase notes). It is declared, not left
implied, so that Terraform and Firestore agree on what exists, and because the code relies on it: it is the
tie-break between two plans saved in the same millisecond.

### 3. Pages with a cursor of values, not an offset

`GET /api/plans?limit=<n>&after=<next>`. The reply carries `next` only when more plans follow.

- **The query.** Owner equals, `created` descending, document id descending, start after the marker's
  `(created, id)`, limit `n + 1`. The extra plan is only there to know whether another page follows, so
  the last page has no `next` and nobody is offered a "Show more" that shows nothing.
- **Why values and not an offset.** An offset ("skip 20") moves when a plan is saved or deleted between two
  pages: a plan is shown twice or never. Firestore also reads, and bills, every skipped document. Starting
  after a pair of values is stable: a plan saved meanwhile is newer than everything listed and does not
  shift the rest, and a deleted plan, even the one the marker names, is simply not there. The marker is
  values, not a document reference, so it does not need the document to exist.
- **What is in the marker.** base64url of `[created, id]` of the last plan on the page: two values the
  visitor was just sent. It never holds the owner. Which plans are listed comes from the sign-in, never from
  the marker, so an edited or borrowed marker can only move where the visitor's own list starts. That is why
  it is not signed: a signature would need a secret, and this repo stores none. The pages treat it as opaque
  (`API.md` says so), which keeps the form free to change.
- **A malformed marker** (not base64url, not a two-item list, a time that is not one, an id that could not
  be ours, longer than 200 characters) is `400 bad-cursor`, before the database is asked.

### 4. Page size: 50 when not asked, at most 100; the share dialog asks for 20

- **50 by default**, because that is what the list returned before pages existed. A page loaded before this
  deploy sends no parameters and gets exactly the same first page.
- **100 at most.** Each plan listed is one billed document read, and a visitor may list 60 times a minute,
  so 100 caps one visitor at 6,000 reads a minute. A page of 100 lines is about 12 KB. A number outside 1 to
  100, or not a whole number, is `400 bad-limit` rather than quietly cut down, so a mistake in a caller shows.
- **20 in the dialog.** Its list shows about six lines before it scrolls, and most people have a handful
  of plans. "Show more" adds the next 20.

### 5. The service keeps working while the index is missing: try it, and fall back

Firestore refuses a query that needs a composite index that does not exist, and an index takes minutes to
build. So between a code deploy and the index being ready, in either order, something must give.

**Chosen:** the store sends the indexed query. If Firestore answers `FAILED_PRECONDITION` (HTTP 400; seen on
the live database on 2026-11-12, as the one item of a list, because `runQuery` streams), it logs one warning,
runs the old query (owner equals, at most 200), sorts and cuts the same page in memory, and does not try the
index again for 60 seconds. Any other error still fails the request.

**Not chosen: a setting that switches the indexed query on.**

| | Fall back on "index required" | A setting |
| --- | --- | --- |
| Code first, index later | Works: lists the old way, one warning a minute, until the index is ready | Works while the setting is off |
| Index first, code later | Works: the old code never asks for the new order | Works |
| Someone switches it on too early | Not possible | Every list fails with `502` until the index is ready |
| Steps for whoever applies | One apply and one merge, in any order | Apply, wait, merge, then change the setting and deploy again |
| What it costs | One extra call to Firestore per minute while the index is missing, none after | A setting to remember, and later remove |
| What it hides | Nothing: the warning names the cause, and a check in the phase notes looks for it | |

The fall back is the old behaviour, so it is never worse than before this phase. It is reachable only from
`pageByOwner`; the old `listByOwner` method is gone from the store's interface, because nothing else used it.

The order recommended anyway is the index first (`ARCHITECTURE_PHASE_5.md`, section 2). Then the fall back is
never used, and the log check confirms it.

## The limit to know

Google documents that indexing a field that increases between documents, like a timestamp, caps the
collection at **500 writes a second**. The plans collection has had two such fields indexed all along
(`created` and `expires`, through Firestore's automatic single-field indexes). The new composite index starts
with `owner`, so it is not one more. The site saw 9 saves in 16 h 25 min in the baseline, and its own limit is
300 saves a day for everyone together: millions of times below. The numbers, the quote and what would lift
the cap are in the phase notes, section 7.

## What it costs

- **Writes.** None more. Firestore bills per document written, not per index entry.
- **Storage.** One more index entry per plan. Not measured; at a few hundred plans, nothing worth counting.
- **Reads.** A page of `n` reads at most `n + 1` documents, where the old list read all of a person's plans,
  up to 200, every time. For the dialog's 20 that is at most 21 reads instead of up to 200.
- **One check that reads one document**: Query Explain is billed as one read.

## Consistency, compared with DynamoDB

Firestore's queries are strongly consistent (its overview page), so a plan saved a moment ago is on the first
page of the list that the dialog reads straight after the save. In the DynamoDB design the same list comes
from a global secondary index, which is eventually consistent, and the page would have to cope with the new
plan arriving a fraction of a second late. That is the main behavioural difference between the two designs.

## What would make us change it

- **A list that must be filtered or sorted another way** (by title, by site): another composite index per
  order, each declared and built. At that point a search service is worth weighing.
- **Very large per-person lists.** Paging handles any number; the dialog's "Show more" would want a search.
- **The fall back ever firing in production after the first deploy.** That would mean the index was deleted
  or broken; the log check catches it, and the right fix is the index, not the fall back.
