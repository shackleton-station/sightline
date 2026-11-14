# Architecture, Phase 5: the "my plans" index, paging, and the DynamoDB design

For whoever applies this phase and for Rodrigo. Why it is built this way is in
[`decisions/0005-plans-index-and-paging.md`](decisions/0005-plans-index-and-paging.md). The DynamoDB design
on paper is in [`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md), "Plans in DynamoDB, on paper". This file is the order
to do things in, what the plan should show, how to see the index, and the checks that say the phase is done.

**State on 2026-11-12, evening:** applied, deployed and checked. The index exists and is `READY`, the plans
service runs the paging code, and the checks that need no sign-in pass on the live project
([section 9](#9-results-of-the-checks-2026-11-12)). Left for a person: check (d), paging through the public
address while signed in with Google, and the "Show more" button in the Share dialog.

Names used in the commands:

```sh
P=clps-compute-6z1nc
SITE=https://shackletonstation.dev
```

---

## 1. What was built

| Piece | Where |
| --- | --- |
| The composite index `plans(owner ascending, created descending, __name__ descending)` | `infra/data.tf`, `google_firestore_index.plans_by_owner` |
| "My plans" in pages: `GET /api/plans?limit=<n>&after=<next>`, with `next` in the reply when more follow | `web/plans/handler.ts` (`listPlans`), `web/plans/cursor.ts` (the marker) |
| The paged query, and the fall back to the old query while the index is missing | `web/plans/firestorePlans.ts` (`pageByOwner`, `indexedPage`, `oldWay`) |
| The same paging in memory, and the order both stores share | `web/plans/store.ts` (`newestFirst`, `pageOf`, `memoryPlans`) |
| The share dialog: 20 at a time, and "Show more" | `web/src/lib/plans.ts` (`listPlans`, `withPage`), `web/src/components/AccountBox.tsx` |
| The written contract: one optional request part (`query`), one optional reply field (`next`), two new replies (`400 bad-limit`, `400 bad-cursor`) | `web/plans/API.md`, `web/plans/contract.test.ts`, `web/src/lib/plans.test.ts` |
| A check of the index and of paging past 200 on a real database | `web/plans/indexCheck.ts` |
| Tests | `web/plans/paging.test.ts`, `web/plans/firestorePlans.test.ts`, `web/plans/firestorePlans.emulator.test.ts`, `web/shared/ids.test.ts` |

What a visitor sees: in the share dialog, signed in, the list of their plans now shows the newest 20 and
a **Show more** button when there are more. Before, it showed up to 50, and someone with more than 200
plans could miss their newest.

**The API change is additive.** A page loaded before this deploy sends no parameters and gets the newest
50 in the old shape; if it has more than 50 plans, the reply also carries `next`, which it ignores. A new
page talking to an old service sends `?limit=20`, which the old service ignores: it gets up to 50 and no
`next`, and shows them all with no button.

---

## 2. The order: the index first, then the code

Firestore refuses a query that needs a composite index the database does not have, and building an index
takes minutes even on an empty database. The code is built to work in either order (section 4), but the
clean order is:

| Step | What | What to see |
| --- | --- | --- |
| 1 | **Apply** the index | The plan in section 3. The apply itself waits until the index is built |
| 2 | **Check it is ready** | Section 5, check (a): state `READY` |
| 3 | **Check a query would use it** | Check (b), Query Explain, read-only |
| 4 | **Merge the pull request** | CI, then `Deploy` (the page) and `Deploy plans` (the service; `web/plans/` changed) |
| 5 | **The other checks** | Checks (c) to (f) |

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
terraform plan -out=phase5.tfplan
# read every line, then:
terraform apply phase5.tfplan
```

No variable to set: the index exists whenever the `plans` database does (`plans = true`).

---

## 3. What the plan should show

**1 to add, 0 to change, 0 to destroy.** That is what it said on 2026-11-12, read-only, against the live
state with `origin/main` at `abb7a37` merged in:

```
  # google_firestore_index.plans_by_owner[0] will be created
  + resource "google_firestore_index" "plans_by_owner" {
      + api_scope       = "ANY_API"
      + collection      = "plans"
      + database        = "plans"
      + deletion_policy = "DELETE"
      + density         = (known after apply)
      + id              = (known after apply)
      + multikey        = false
      + name            = (known after apply)
      + project         = "clps-compute-6z1nc"
      + query_scope     = "COLLECTION"
      + skip_wait       = false
      + unique          = (known after apply)

      + fields {
          + field_path = "owner"
          + order      = "ASCENDING"
        }
      + fields {
          + field_path = "created"
          + order      = "DESCENDING"
        }
      + fields {
          + field_path = "__name__"
          + order      = "DESCENDING"
        }

      + search_index_options (known after apply)
    }

Plan: 1 to add, 0 to change, 0 to destroy.
```

What to look for: nothing else. No grant changes, and no change to a Cloud Run service. `skip_wait = false`
means the apply waits for the build to finish, up to the provider's create timeout of 20 minutes. An index
on a collection this small should take a few minutes; Google says the minimum is "a few minutes, even for an
empty database". Not measured here.

**Why `__name__` is written out.** Firestore ends every composite index on the document id. The provider's
documentation says that if `__name__` is not the last field, "it will be added automatically with the same
direction as that of the last field defined". Declaring it with that same direction changes nothing in the
index, avoids any difference between what Terraform holds and what Firestore reports, and shows the order the
code pages by.

**The way back:** remove the resource from `infra/data.tf`, plan (1 to destroy) and apply. The service then
lists the old way by itself, from the first request that finds the index gone (section 4).
Nothing a visitor saved is touched: an index holds no data of its own.

---

## 4. How the service behaves before the index exists

Chosen: **try the index, and fall back to the old query on Firestore's "index required" answer**, with a
warning in the log. Not chosen: a setting that switches the indexed query on. Reasons in the decision record;
in short, the fall back works in either order with no second deploy and no setting to forget, and a setting
would still break the service if it were switched on before the index was ready.

What happens, step by step:

1. `pageByOwner` sends the paged query (owner equals, `created` descending, `__name__` descending, start
   after the marker, one more than the page).
2. Without the index, Firestore answers **HTTP 400** with a list holding one error whose status is
   **`FAILED_PRECONDITION`** and whose message is "The query requires an index. You can create it here: …".
   This exact answer was seen on the live database on 2026-11-12 (section 6).
3. The service then logs one warning, asks the old query (owner equals, at most 200, no order), sorts the
   plans itself in the same order, and cuts the same page from them. For the next 60 seconds it goes
   straight to the old query, so a missing index costs one extra call a minute, not one per request.
4. After 60 seconds it tries the index again. Once the index is ready, the warning stops.

While the fall back is in use, paging is correct for anyone with up to 200 plans, which is everyone today.
Past 200 it behaves as before this phase: some plans may be missed. Any other error (a permission refused,
a timeout) is not hidden: the visitor gets `502`, as before.

To see whether the service ever fell back:

```sh
gcloud logging read 'resource.labels.service_name="clps-plans" AND jsonPayload.message:"is not ready"' \
  --project $P --freshness 1d --limit 5 --format 'value(timestamp, jsonPayload.message)'
```

**Pass after step 2 of section 2:** nothing printed. If the code was merged first, lines appear until the
index is ready, about one a minute while people list their plans, and then stop.

---

## 5. The "done when" checks

The plan's test: "listing uses the index and pages correctly past 200". Run from the repository root, in
order. Each says what it changes on the live project.

### (a) The index exists and is ready

Changes: nothing.

```sh
gcloud firestore indexes composite list --database=plans --project $P --format json \
  | jq -c '.[] | {state, queryScope, fields: [.fields[] | "\(.fieldPath) \(.order)"]}'
```

**Pass:** exactly one line,
`{"state":"READY","queryScope":"COLLECTION","fields":["owner ASCENDING","created DESCENDING","__name__ DESCENDING"]}`.
While it is being built the state is `CREATING`. On 2026-11-12, before the apply, the list was empty (`[]`).

### (b) A "my plans" query is planned on the index

Changes: nothing. Query Explain plans the query without running it; Google bills it as one document read.

```sh
cd web
GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)" npx tsx plans/indexCheck.ts --project $P --database plans
```

**Pass:** `ok   Query Explain: the paged query uses (owner ASC, created DESC, __name__ DESC)` and
`All checks passed`. Before the apply it says `FAIL … refused: FAILED_PRECONDITION (no matching index found.)`,
which is what it said on 2026-11-12. The script sends the same query the service sends, for a made-up owner.

The same by hand, if the script is not wanted:

```sh
curl -s -X POST -H "authorization: Bearer $(gcloud auth print-access-token)" -H 'content-type: application/json' \
  -d '{"structuredQuery":{"from":[{"collectionId":"plans"}],"where":{"fieldFilter":{"field":{"fieldPath":"owner"},"op":"EQUAL","value":{"stringValue":"nobody"}}},"orderBy":[{"field":{"fieldPath":"created"},"direction":"DESCENDING"},{"field":{"fieldPath":"__name__"},"direction":"DESCENDING"}],"limit":51},"explainOptions":{"analyze":false}}' \
  "https://firestore.googleapis.com/v1/projects/$P/databases/plans/documents:runQuery" | jq -c '.[].explainMetrics.planSummary.indexesUsed'
```

**Pass:** `[{"query_scope":"Collection","properties":"(owner ASC, created DESC, __name__ DESC)"}]`. For
comparison, today's query (the same without `orderBy`) was planned on `(owner ASC, __name__ ASC)` on
2026-11-12: Firestore's own single-field index, in document-id order, which is why the old code had to sort.

### (c) Paging past 200 on the real database

Changes: 205 plans written for a made-up owner (`phase5-check-<random>`, which no Google sign-in can
produce, so nobody can list or delete them through the site), then deleted by the same script. Each carries
`expires` one day ahead, so if the clean-up were cut short the database would remove them within about a day.
About 205 writes, 205 deletes and 300 reads: well under a cent at the list prices in `REFERENCES.md`.

```sh
cd web
GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)" npx tsx plans/indexCheck.ts --project $P --database plans --write
```

**Pass:**

```
ok   Query Explain: the paged query uses (owner ASC, created DESC, __name__ DESC)
ok   saved 205 plans for the made-up owner phase5-check-…
ok   pages of 100, 100, 5; expected 100, 100, 5
ok   all 205 plans came back once, newest first
ok   listed by the index, never the old way
deleted the 205 plans again
All checks passed
```

It pages with the service's own store code (`firestorePlans`), so this is the real query on the real index.
"Never the old way" means the store did not fall back, which it would only do if Firestore refused the query.
On the emulator on 2026-11-12 the last four lines passed; the first fails there, because the emulator has no
Query Explain.

### (d) Paging through the public address, signed in

Changes: nothing, if you already have plans saved while signed in. Needs at least two of them.

Get your token as in Phase 2's check (b): in the browser's console on the signed-in page run
`copy(sessionStorage.getItem('clps.account'))`, then:

```sh
read -s TOKEN
curl -s -H "authorization: Bearer $TOKEN" "$SITE/api/plans?limit=1" | tee /tmp/p1.json | jq -c '{n: (.plans | length), first: .plans[0].title, next: (.next != null)}'
curl -s -H "authorization: Bearer $TOKEN" "$SITE/api/plans?limit=1&after=$(jq -r .next /tmp/p1.json)" | jq -c '{n: (.plans | length), first: .plans[0].title}'
curl -s -H "authorization: Bearer $TOKEN" "$SITE/api/plans" | jq -c '{n: (.plans | length), next: (.next != null)}'
curl -s -w ' %{http_code}\n' -H "authorization: Bearer $TOKEN" "$SITE/api/plans?after=not-a-marker"
curl -s -w ' %{http_code}\n' -H "authorization: Bearer $TOKEN" "$SITE/api/plans?limit=500"
unset TOKEN; rm /tmp/p1.json
```

**Pass**, line by line: `n` 1 with your newest plan's title and `next` true; `n` 1 with your second-newest
plan's title; all your plans up to 50, `next` true only if you have more than 50; `{"error":"bad-cursor"} 400`;
`{"error":"bad-limit"} 400`.

In the browser: open **Share this plan**, signed in. **Pass:** your newest plans, newest first. With more
than 20, a **Show more** button under the list adds the next 20 and goes away at the end.

### (e) The service did not fall back

The log query in section 4. **Pass:** nothing printed since the deploy.

### (f) Opening a plan is as fast as before

Nothing here touches opening a plan, but the deploy replaces the plans service. Phase 2's check (f), the
same command:

```sh
stats() { tail -n +2 | sort -n | awk '{v[NR]=$1} END {n=NR; m=int(n*0.5)+1; if(m>n)m=n; p=int(n*0.95)+1; if(p>n)p=n; printf "n=%d median=%.0f ms p95=%.0f ms\n", n, v[m]*1000, v[p]*1000}'; }
curl -s -o /dev/null -w '%{time_total}\n' "$SITE/api/plans/3a4tqevu#[1-31]" | stats
```

**Pass:** inside or near the baseline (178 ms median, 251 ms at the 95th percentile, `ARCHITECTURE_BASELINE.md`
1.8) and Phase 2's results.

Listing was never timed in the baseline (it needs a sign-in), so there is no "before" number for it. The
service's own `list from Firestore` step in Cloud Trace is the number to keep from now on.

---

## 6. What was seen on the live project before anything was applied (2026-11-12, read-only)

- `gcloud firestore indexes composite list --database=plans` answered `[]`: no composite index.
- The new paged query, sent with Query Explain (`analyze: false`, so nothing was read), for a made-up
  owner: HTTP 400, `[{"error": {"code": 400, "message": "no matching index found.", "status": "FAILED_PRECONDITION"}}]`.
- The same query without Explain, for the same made-up owner, so no plan could match: HTTP 400,
  `FAILED_PRECONDITION`, "The query requires an index. You can create it here: <a console link>". This is the
  answer the fall back reads. Note that it is a **list**: `runQuery` streams its results, and its error comes
  as the one item of that list. The existing code for a commit reads an object; the new code reads both.
- Today's query (no order) with Query Explain: planned on `(owner ASC, __name__ ASC)`.

---

## 7. The write limit, and how far away it is

Google's best-practices page says that if a field that increases or decreases between documents, like a
timestamp, is indexed, "the maximum write rate to the collection is 500 writes per second". The quote and its
address are in `REFERENCES.md`.

How far this app is from it, from the numbers in `ARCHITECTURE_BASELINE.md` 1.2: the load balancer saw
**9 saves** of a plan in **16 h 25 min**, about one every 1 h 50 min, or 0.00015 a second. That is about
**3 million times** below 500 a second. The app's own ceiling is lower still: at most **300 saves a day for
everyone together** (the `plans:save-day` limit in `web/plans/handler.ts`). Even all 300 in the same second
would be under 500. Deletes count as writes too, and are limited to 5 a minute per visitor.

Which index is the sequential one, said carefully. `created` and `expires` are both timestamps that grow with
each new plan, and Firestore indexes every field by itself, so the collection already had two such indexes
before this phase. The new composite index starts with `owner`, so its entries are spread across owners and
only grow within one person's plans. My reading is that the new index does not move the limit; the two
automatic single-field indexes set it. Google's page does not discuss composite indexes in this sentence, so
this is reasoning, not a quote. If the limit ever mattered, the fix Google gives is to exempt the field from
indexing, which here would mean exempting `created` and `expires` from their single-field indexes (nothing
queries on either alone; the TTL page says a TTL field "can be indexed or unindexed"). Not done: it is a
second resource, and nowhere near needed.

---

## 8. What has only been tested, not run for real

- **The index on the real database.** Declared and planned. Its build time, and that Query Explain then
  names it, are unseen until the apply (checks (a) and (b)).
- **Paging on the real database.** Ran on the emulator: 233 plans of one owner (three of them saved in the
  same millisecond) in pages of 100, past a deleted marker and a plan saved in between, every plan once,
  newest first. **The emulator does not enforce composite indexes**: it answers the query whether or not an
  index exists, and it ignores Query Explain (seen 2026-11-12: it answered the explain request with the
  query's results and no plan). So the emulator proves the query's shape and the paging logic, not the index.
  Check (c) is the first real run.
- **The fall back on the real database.** The real "index required" answer was captured (section 6) and the
  fall back is unit-tested against that exact answer with a stand-in for Firestore. It has not run in the
  service against the real database, because the order in section 2 applies the index first.
- **The page.** The list and "Show more" are unit-tested at the level of `web/src/lib/plans.ts`. The dialog
  itself was not opened in a browser: the list only appears after a real Google sign-in, which an agent
  does not do. Check (d) in a browser is its first real run.
- **Real Google tokens** on the paged list: as in Phase 2, the sign-in check is unit-tested with stand-in
  tokens. Check (d) uses a real one.


---

## 9. Results of the checks, 2026-11-12

Run by Claude Code against the live project between 21:26 and 21:45 UTC. Times are UTC.

**The apply**, from a saved plan read line by line: 1 added, 4 changed, 0 destroyed. The one added is
`google_firestore_index.plans_by_owner`. The four changed are the revision name Terraform clears on each
Cloud Run service. No access was granted or removed. The apply started at 21:26:29; the index took 5 min
52 s to build. It was applied before the code was merged, so the service never needed its fallback.

| Check | Result | What was seen |
| --- | --- | --- |
| (a) The index exists and is ready | **Pass** | One index, `READY`: `owner ASCENDING`, `created DESCENDING`, `__name__ DESCENDING` |
| (b) A "my plans" query is planned on the index | **Pass** | Query Explain: `(owner ASC, created DESC, __name__ DESC)` |
| (c) Paging past 200 on the real database | **Pass** | 205 plans saved for the made-up owner `phase5-check-qsh3tuwj`; pages of 100, 100 and 5; all 205 came back once, newest first; listed by the index, never the old way; the 205 deleted again |
| (d) Paging through the public address, signed in | **Not run** | Needs a person signed in with Google. Without a sign-in the list answers `401` before it looks at `limit` or `after`, as designed |
| (e) The service did not fall back | **Pass** | No "index" line in the plans service's log since the deploy of `ff6ecfa` |
| (f) Opening a plan is as fast as before | **Pass** | Median 178 ms, 95th percentile 245 ms, n = 30 (baseline 178 and 251) |

Checks (b) and (c) ran as a person with access to the database, with the service's own store code, not
through the service. That the deployed service uses the index is shown only by (e): it has not logged a
fallback. Nobody signed in has listed plans through it yet, so (e) says little until (d) is run.
