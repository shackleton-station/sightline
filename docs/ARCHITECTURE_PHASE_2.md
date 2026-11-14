# Architecture, Phase 2: applying and checking the plans service

For whoever applies this phase and for Rodrigo. What was built and why is in
[`decisions/0003-plans-service.md`](decisions/0003-plans-service.md). This file is the order to do things in,
what each `terraform plan` should show, every grant, how the first image gets deployed, the checks that say
the phase is done (each with what a pass looks like), and what has only been tested.

**State on 2026-11-12, evening:** applied, deployed and checked. All three applies (A expand, B move,
C contract) were run by Claude Code, each from a saved plan read line by line first. The load balancer
sends `/api/plans` to the plans service, and the web server's identity can no longer touch the `plans`
database. The checks in section 5 were run against the live site; what each showed is in
[section 9](#9-results-of-the-checks-2026-11-12). The unused plans wiring is now gone from the web server's
code too, in the contract pull request shared with Phase 3 (section 7): the web server has no plans API at
all. One thing is left: check (b) with a real Google sign-in, which needs a person.

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
S=clps-plans                         # the Cloud Run service, and its service account
SITE=https://shackletonstation.dev
```

---

## 1. What was built

| Piece | Where |
| --- | --- |
| The plans service: its own program, entry point and image | `web/plans/` (`app.ts`, `index.ts`, `handler.ts`, `store.ts`, `firestorePlans.ts`, `idempotency.ts`, `Dockerfile`) |
| Code the web server and the plans service both use | `web/shared/` (the data tools in `tools/`, rate limits and the Redis store, the sign-in check, ids, the request tracer) |
| Idempotency keys on `POST /api/plans` | `web/plans/idempotency.ts`, the atomic write in `firestorePlans.ts`, the page's side in `web/src/lib/plans.ts` and `web/src/components/SharePlan.tsx` |
| The written contract and its test | `web/plans/API.md`, `web/plans/contract.test.ts`, and the pages' half in `web/src/lib/plans.test.ts` |
| The deploy | `.github/workflows/deploy-plans.yml`, `web/scripts/plans-check.mjs`, `web/scripts/plans-checks.mjs` |
| The smoke test, reaching plans | `web/scripts/smoke.mjs` (`--plans-service`, `--save-plan`) |
| Terraform | `infra/plans.tf`, and the staged pieces in `domain.tf`, `data.tf`, `main.tf`, `variables.tf` |
| Running it locally | `npm run dev:server` (three programs), `docker-compose.yml` (three images, Redis and Firestore's emulator) |

The web server still answers `/api/plans` with the same handler. That is what makes step B reversible.

---

## 2. The order: expand, move, contract

Three applies, each small. Moving a route and a permission in one apply is fragile, so nothing is taken
away until the new path has carried visitors.

| Step | What | Why in this order |
| --- | --- | --- |
| 1 | **Apply A** (expand): `plans_service = true` | Creates the identity, its grants, the service, its backend, its objectives and alert. The load balancer does not send it anything. Terraform starts the service on Google's placeholder image |
| 2 | **Merge the pull request** | CI runs, then three workflows. `Deploy` puts the site's new code live. `Deploy plans` finds the placeholder live, builds the first image, tests it on its own address (one real plan saved, sent again, opened) and moves it to live. `Deploy events worker` redeploys the worker, because `web/shared/` changed |
| 3 | **Check the plans service** runs the real image (command below) | The path rule must not exist while the placeholder is live: it would answer every plan request with a web page |
| 4 | **Apply B** (move): `plans_route = "plans"` | One change to the load balancer's URL map. From here visitors' plan requests reach the plans service |
| 5 | **The checks** in section 5, (a) to (g) | |
| 6 | **Apply C** (contract): `web_plans_access = false`, in a second pull request, later | Removes the web server's grant on the `plans` database. Only once B has run long enough to trust. That pull request also removes the plans wiring from the web server (section 7) |

Set each variable **in `infra/terraform.tfvars`**, not with `-var`, and keep it there. Its example file has
the three lines ready. A later plan without the line would undo the step, because the defaults are the
state before this phase.

If the pull request is merged before Apply A, nothing breaks: the plans workflow ends with a warning that
the service does not exist. Run it by hand after Apply A (Actions, "Deploy plans", "Run workflow"). The
site's new code is safe by itself: it answers `/api/plans` as before, and accepts idempotency keys.

### Apply A

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
# add to terraform.tfvars:  plans_service = true
terraform plan -out=phase2a.tfplan
# read every line, then:
terraform apply phase2a.tfplan
```

The plan must say **13 to add, 0 to change, 0 to destroy**. That is what it said on 2026-11-12 against the
live state. The 13:

| # | Resource | What it is |
| --- | --- | --- |
| 1 | `google_service_account.plans[0]` | The identity `clps-plans@…` |
| 2 | `google_project_iam_member.plans_database[0]` | Grant 1 in section 3 |
| 3 | `google_project_iam_member.plans_traces[0]` | Grant 2 |
| 4 | `google_service_account_iam_member.deployer_uses_plans_identity[0]` | Grant 3 |
| 5 | `google_cloud_run_v2_service.plans[0]` | The service: 1 CPU, 512 MiB, 0 to 3 copies, 80 requests at once, 30 s, the private network path to Redis, seven settings |
| 6 | `google_cloud_run_v2_service_iam_member.plans_public[0]` | Grant 4 |
| 7 | `google_compute_region_network_endpoint_group.plans[0]` | Tells the load balancer where the service is |
| 8 | `google_compute_backend_service.plans[0]` | The backend: CDN off, logging on, the edge firewall policy `clps-web-edge` attached. No path points at it yet |
| 9 | `google_monitoring_service.plans[0]` | Lets Cloud Monitoring hold objectives for the service |
| 10 | `google_monitoring_slo.plans_availability[0]` | 99.5% of requests succeed, over 28 days |
| 11 | `google_monitoring_slo.plans_speed[0]` | 95% of requests answer within 1 s, over 28 days |
| 12 | `google_monitoring_alert_policy.plans_burning_budget[0]` | An email when the failure allowance is being used 10 times too fast |
| 13 | `google_firestore_field.idempotency_expiry[0]` | The time-to-live rule on `idempotency.expires` in the `plans` database |

What to look for: **no line about `google_compute_url_map`**, and none about `google_project_iam_member.web_plans`
or `google_cloud_run_v2_service.web`. If any of the three appears, stop.

Number 13 does not depend on `plans_service`. A plan with all three variables at their defaults shows it
alone: **1 to add, 0 to change, 0 to destroy**. It belongs to the database, because the web server writes
the same key records for as long as it answers `/api/plans`.

### After the merge: is the real image live?

```sh
gcloud run services describe $S --project $P --region $R --format json \
  | jq '{url: .status.url, traffic: .status.traffic, image: .spec.template.spec.containers[0].image}'
URL=$(gcloud run services describe $S --project $P --region $R --format 'value(status.url)')
node web/scripts/plans-check.mjs $URL --cloud
```

**Pass:** the image is `us-east4-docker.pkg.dev/clps-compute-6z1nc/web/plans:<commit>`, not
`us-docker.pkg.dev/cloudrun/container/hello`, and it has 100% of the traffic. The workflow run is green.
The check ends with `All checks passed`: the service reports Firestore, Redis, sign-in and tracing all on.
Do not go on to Apply B until this passes.

### Apply B

```sh
# add to terraform.tfvars:  plans_route = "plans"
terraform plan -out=phase2b.tfplan
terraform apply phase2b.tfplan
```

The plan must say **0 to add, 1 to change, 0 to destroy**: `google_compute_url_map.site[0]` updated in
place. In it:

- one new host rule for `shackletonstation.dev`, using a new path matcher `site`;
- the path matcher `site`: its default is the web server's backend, and one path rule sends `/api/plans`
  and `/api/plans/*` to `clps-plans-backend`;
- the existing `www` host rule shown as removed and added again. Host rules are a set, and this is how
  Terraform prints a set with a new member. Check that the `www` rule added is the same as the one removed.

A path rule cannot match a path and everything under it with one pattern, so both forms are listed.

A change to the URL map takes a few minutes to reach every part of Google's edge. Until it has, some
requests still go to the web server. Both answer the same API from the same database and count limits in
the same Redis keys, so a visitor cannot tell. Wait for this to say 200 several times in a row:

```sh
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/status
```

### Apply C (the second pull request)

```sh
# add to terraform.tfvars:  web_plans_access = false
terraform plan -out=phase2c.tfplan
terraform apply phase2c.tfplan
```

The plan must say **0 to add, 1 to change, 1 to destroy**:

- `google_project_iam_member.web_plans[0]` destroyed: the web server's `roles/datastore.user` on the `plans`
  database;
- `google_cloud_run_v2_service.web` updated in place: one setting removed, `PLANS_DATABASE`. This starts a
  new revision of the site with the image that is already live. Without the setting the web server answers
  503 for `/api/plans` on its own address and reports `plans: false`, so its deploy's smoke test skips the
  plans checks there.

`web_plans_access = false` only takes effect while the load balancer really sends `/api/plans` to the plans
service. Whenever it does not (`plans_route = "web"`, no domain, no plans service), Terraform keeps the web
server's grant and setting, so there is always something that can answer (`web_keeps_plans` in
`infra/plans.tf`). This replaced a cross-check that refused the combination; the applied values are now the
variables' defaults, and a refusal would have broken a checkout with no domain.

That pull request should also set the defaults in `infra/variables.tf` to the applied values
(`plans_service = true`, `plans_route = "plans"`), so a checkout without the captain's `terraform.tfvars`
plans no change.

### The ways back

| To undo | Do | What happens |
| --- | --- | --- |
| A bad version of the service | Cloud Run: send requests back to an earlier revision (`DEPLOY.md`, "The plans service") | Seconds. The deploy does this by itself when a step fails |
| The route (after B, before C) | `plans_route = "web"`, apply | The path rule goes. The web server answers `/api/plans` again, from the same database. A few minutes to reach every edge |
| The route (after C, before the contract pull request) | `plans_route = "web"`, one apply | The grant and the setting come back with the route, in the same apply. A new grant can take a few minutes to be honoured, so expect some 502s on plan requests in that window |
| The route (after the contract pull request) | Two steps, in this order. First send the web server back to a revision that still has the plans code (one from before the contract pull request: `gcloud run services update-traffic clps-web --to-revisions <revision>=100`, see `DEPLOY.md`). Then `plans_route = "web"`, one apply | The web server's code has no plans API any more, so the route alone would send `/api/plans` to a server that answers 404. The grant and `PLANS_DATABASE` come back with the route by themselves (`web_keeps_plans`). The next deploy of `main` puts the web server back on code with no plans API, so hold deploys until the route is on `"plans"` again |
| Everything | The two steps of the row above; then `plans_service = false`, apply. Without a web revision that still has the plans code, nothing answers `/api/plans` after this | The service, its identity, grants, backend, objectives and alert go. Plans, the database and the key records stay |

---

## 3. Every grant

Apply A creates four. Apply B creates none. Apply C removes one. No other existing grant changes.

| # | Apply | Who | Role | On what | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | A | `clps-plans@…` (the service's identity, new) | `roles/datastore.user` | The project, with the condition "only the database `plans`" (`resource.name == "projects/clps-compute-6z1nc/databases/plans"`) | It reads and writes plans and idempotency keys. It cannot touch `stats` |
| 2 | A | `clps-plans@…` | `roles/cloudtrace.agent` | The project | It writes a trace per request |
| 3 | A | `clps-web-deployer@…` (GitHub Actions, existing) | `roles/iam.serviceAccountUser` | The service account `clps-plans` only | A deploy has to hand the service its identity |
| 4 | A | `allUsers` | `roles/run.invoker` | The Cloud Run service `clps-plans` | It is public, as the web server is: the load balancer calls it for any visitor, and the deploy tests it on its own address |
| 5 | C, removed | `clps-web@…` (the site's identity) | `roles/datastore.user` | The project, with the condition "only the database `plans`" | The site no longer answers `/api/plans` |

Things that are not grants, said plainly:

- **Redis has no permissions.** The plans service reaches it the way the web server does: Cloud Run sends
  traffic for private addresses through the project's default network (Direct VPC egress,
  `PRIVATE_RANGES_ONLY`), and the instance accepts anything on that network. The service can read and
  write every key, the web server's included. Its code touches only `clps:limit:plans:…`.
- **Nothing for the bucket, the model, Pub/Sub or Text-to-Speech.** The service is built with no bucket and
  calls none of them. Text-to-Speech has no role to withhold (baseline 2.3), so the identity could call it.
- **The deployer already may deploy and call any Cloud Run service** in the project
  (`roles/run.developer`, project-wide). No grant was added for that.

After Apply A, to see the identity's grants (it must list exactly two roles):

```sh
gcloud projects get-iam-policy $P --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:$S@$P.iam.gserviceaccount.com" \
  --format 'table(bindings.role, bindings.condition.title)'
```

---

## 4. Deploying the plans service

Normally nobody does anything: a merge to `main` that touches `web/plans/`, `web/shared/`, `web/src/lib/`,
`web/src/data/`, the site data (`web/public/data/`) or `web/package*.json` deploys it, after CI. A merge that
touches none of them does not. The steps and the rollback are in [`DEPLOY.md`](DEPLOY.md), "The plans
service".

By hand (it needs Docker and access to the project):

```sh
cd web
COMMIT=$(git rev-parse --short HEAD)
IMAGE=us-east4-docker.pkg.dev/$P/web/plans:$COMMIT
gcloud auth configure-docker us-east4-docker.pkg.dev
docker build --platform linux/amd64 -f plans/Dockerfile --build-arg VERSION=$COMMIT -t $IMAGE .
docker push $IMAGE
gcloud run deploy $S --project $P --region $R --image $IMAGE --no-traffic --tag canary
CANARY=$(gcloud run services describe $S --project $P --region $R --format json | jq -r '.status.traffic[] | select(.tag == "canary") | .url')
node scripts/plans-check.mjs $CANARY --version $COMMIT --data-version $(node scripts/data-version.mjs public/data | jq -r .dataVersion) --cloud --save
gcloud run services update-traffic $S --project $P --region $R --to-latest
```

---

## 5. The "done when" checks

Run them after Apply B, in this order, from the repository root. Each says what it changes on the live
project. The plans API allows one address 5 saves or deletes a minute: leave a minute between (a), (b)
and (d).

### (a) Sharing and opening a plan work end to end through the public address, without sign-in

Changes: one plan saved with no owner (title "Deploy check (by hand)"). Nobody can delete it. The database
removes it 180 days later.

```sh
node web/scripts/plans-check.mjs $SITE --cloud --save
```

**Pass:** it ends with `All checks passed` and no line starts with `FAIL`. Among the lines: `the plans
service answers its status here` (so the load balancer did send the path to the service), `a plan is
saved`, `the saved plan opens, with a brief worked out from the site data`, and `the list of one's own plans
needs sign-in` (401).

### (b) Sharing, listing and deleting work with sign-in

Changes: one plan saved and deleted again.

In a browser: open the site, press **Share this plan**, sign in with Google in the dialog, save. **Pass:**
the plan appears under your plans in the same dialog. Open its link in a private window: it opens. Delete
it from your plans: it goes from the list, and the link in the private window then says the plan no longer
exists.

The same from a terminal. The token is your own Google sign-in for this site and lasts an hour. In the
browser's console on the signed-in page run `copy(sessionStorage.getItem('clps.account'))`, then:

```sh
read -s TOKEN        # paste, then Enter. Nothing is shown, and it is not kept in the shell's history
BODY='{"title":"Phase 2 signed-in check","note":"","view":"#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan"}'
ID=$(curl -s -X POST -H 'content-type: application/json' -H "origin: $SITE" -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: \"$(uuidgen | tr 'A-Z' 'a-z')\"" -d "$BODY" $SITE/api/plans | jq -r .id); echo "saved $ID"
curl -s -H "authorization: Bearer $TOKEN" $SITE/api/plans | jq -c --arg id "$ID" '.plans[] | select(.id == $id)'
curl -s -H "authorization: Bearer $TOKEN" $SITE/api/plans/$ID | jq .mine
curl -s $SITE/api/plans/$ID | jq '.mine, (.plan | has("owner"))'
curl -s -X DELETE -H "origin: $SITE" $SITE/api/plans/$ID | jq -c .
curl -s -X DELETE -H "origin: $SITE" -H "authorization: Bearer $TOKEN" $SITE/api/plans/$ID | jq -c .
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/$ID
unset TOKEN
```

**Pass**, line by line: `saved` and an 8-letter id; one line with that id and the title; `true`; `false`
and `false` (someone else is not told it is theirs, and never who owns it); `{"error":"sign-in"}`;
`{"deleted":"<the id>"}`; `404`.

### (c) The web server's identity has no access to the `plans` database (after Apply C)

Changes: nothing.

```sh
gcloud projects get-iam-policy $P --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:clps-web@$P.iam.gserviceaccount.com" \
  --format 'table(bindings.role, bindings.condition.title)'
WEB=$(gcloud run services describe clps-web --project $P --region $R --format 'value(status.url)')
curl -s -w ' %{http_code}\n' $WEB/api/plans/zzzzzzzz
curl -s $WEB/api/status | jq .plans
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/3a4tqevu
```

**Pass:** the table has no `roles/datastore.user` row (it had one, titled `only-the-plans-database`; the
`roles/datastore.viewer` row for `stats` stays). The web server's own address answers
`{"error":"not-configured"} 503` and `false`. The public address still opens the baseline's plan: `200`.

Before Apply C the same commands show the grant present, and `{"error":"not-found"} 404` and `true`.
Once the plans wiring has been removed from the web server (section 7), its own address answers
`{"error":"not-found"} 404` again, this time without asking any database.

### (d) A retried save returns the first result and does not save twice, through the public address

Changes: two plans saved with no owner (titles "Phase 2 replay check" and "Phase 2 race check").

```sh
BODY='{"title":"Phase 2 replay check","note":"","view":"#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan"}'
KEY="\"$(uuidgen | tr 'A-Z' 'a-z')\""
save() { curl -s -w ' %{http_code} replayed=%header{idempotent-replayed}\n' -X POST -H 'content-type: application/json' \
  -H "origin: $SITE" -H "idempotency-key: $KEY" -d "$1" $SITE/api/plans; }
save "$BODY"; save "$BODY"; save "${BODY/replay check/a different plan}"
sleep 65
KEY="\"$(uuidgen | tr 'A-Z' 'a-z')\""
for i in 1 2 3 4; do save "${BODY/replay/race}" & done; wait
```

**Pass:** the first line is `{"id":"<id>"} 201 replayed=`. The second is the same id with `201
replayed=true`. The third is `{"error":"key-reused"} 422 replayed=`. Then four lines with one id between
them, all `201`, exactly one of them with `replayed=` empty. Open `$SITE/#plan=<id>` for each id: both
plans are there, once.

### (e) Sending the path back to the web server works

Changes: the URL map, twice.

```sh
# in terraform.tfvars:  plans_route = "web"
terraform -chdir=infra plan -out=back.tfplan && terraform -chdir=infra apply back.tfplan
# wait until this says 404 several times in a row:
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/status
node web/scripts/smoke.mjs $SITE
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/3a4tqevu
# then put it back:  plans_route = "plans", plan, apply, and wait for 200 on the status address
```

**Pass:** the plan says 0 to add, 1 to change, 0 to destroy, and removes only the `shackletonstation.dev`
host rule and the `site` path matcher. The smoke test prints `note /api/plans is answered by the web server
here`, its five plans lines say `ok`, and it ends `All checks passed`. The baseline's plan opens: `200`.
After putting it back, check (a)'s command passes again without `--save`.

Run this before Apply C, when going back costs nothing. After C the same one line still goes back, and
brings the web server's grant back with it (section 2). After the contract pull request (section 7) this
check cannot pass as written: the web server has no plans API, so it needs a revision from before that pull
request first ("The ways back").

### (f) Response times match Phase 0

Changes: nothing but about 30 reads of one plan.

Step 3 of [`ARCHITECTURE_BASELINE.md`](ARCHITECTURE_BASELINE.md), section 1.8, from the same laptop and
connection as the baseline:

```sh
stats() { tail -n +2 | sort -n | awk '{v[NR]=$1} END {n=NR; m=int(n*0.5)+1; if(m>n)m=n; p=int(n*0.95)+1; if(p>n)p=n; printf "n=%d median=%.0f ms p95=%.0f ms\n", n, v[m]*1000, v[p]*1000}'; }
curl -s -o /dev/null -w '%{time_total}\n' "$SITE/api/plans/3a4tqevu#[1-31]" | stats
```

| Opening the saved plan `3a4tqevu`, 31 times, the first left out | Median | 95th percentile |
| --- | --- | --- |
| The baseline, 2026-11-12 16:43 UTC, answered by the web server | 178 ms | 251 ms |
| The same day at 19:04 UTC, before anything in this phase was applied, answered by the web server | 188 ms | 238 ms |

**Pass:** after Apply B, with the plans service answering, a median and a 95th percentile inside or near
those two runs, which differ by 10 ms and 13 ms from each other. The command leaves the first request out,
so a copy starting from nothing is not in the number.

A start from nothing is a separate number, and new: before this phase a plan was opened by the web
server's copy, which is kept warm today, and the plans service scales to zero. To see it, leave the plans
API alone for 15 minutes and time one request: `curl -s -o /dev/null -w '%{time_total}\n'
$SITE/api/plans/3a4tqevu`. Not measured. If it matters for an event, `plans_min_instances = 1`.

Saving was measured once in the baseline (442 ms, with the connection set-up), which is too little to
compare against. The service's own step `save to Firestore` in Cloud Trace is the number to keep.

### (g) The checklist every service must pass before it takes traffic

| Item (plan, section 7) | State | How to see it |
| --- | --- | --- |
| Its own identity, with only the permissions its code uses | Done: exactly two roles, read back after the apply | Section 3, and the command at its end |
| Its own image, Dockerfile and deploy workflow, with the stepped rollout and automatic rollback | Done. The workflow ran on two merges and passed, the first time on the placeholder (the first-deploy path) | `web/plans/Dockerfile`, `.github/workflows/deploy-plans.yml`. Until Apply B the "tenth" is a tenth of the workflow's own requests, and the run says so |
| A status address reporting its version and data version | Done | `curl -s $SITE/api/plans/status` after Apply B |
| Graceful shutdown on SIGTERM | Built. `docker stop` on the real image: exit 0 in 0.2 s | `web/plans/index.ts` |
| A request timeout and a concurrency setting chosen from measurement | **Partly.** 30 s and 80 rest on the baseline's numbers and a laptop run (decision 0003). The service's own traffic has not been measured | After a week: request times and instance count in Cloud Run's metrics for `clps-plans` |
| Joins the request's trace; logs carry the service's name | Partly seen live: the service's steps are in Cloud Trace under each request, and its logs carry `"service":"plans"`. Whether they sit under the load balancer's own span was not looked at | After a request through the public address: Cloud Trace, filter `span:"/api/plans"`: the service's steps sit under the load balancer's span. Logs: `gcloud logging read 'resource.labels.service_name="clps-plans" AND jsonPayload.service="plans"' --project $P --freshness 1h --limit 5` |
| Its own objective and alert | Done: both objectives and the alert exist. They have held no data yet | The console's SLO page for `clps-plans`; the alert "clps-plans is failing too often" |
| Unit tests moved with the code; a contract test; the smoke test extended | Done | `web/plans/*.test.ts`, `web/plans/API.md`, `node web/scripts/smoke.mjs $SITE --plans-service` |
| The edge firewall policy attached to its backend, and the limits re-tested | Done, and re-tested: section 9 | `gcloud compute backend-services describe clps-plans-backend --global --project $P --format 'value(securityPolicy, enableCDN, logConfig.enable)'` must show the policy `clps-web-edge`, `False`, `True`. The re-test is below |
| One command runs everything locally; a Compose file runs the real images | Done, both run on 2026-11-12 | `npm run dev:server` in `web/`; `docker compose up --build` at the top |
| A rollback in `DEPLOY.md` and a decision record | Done | `DEPLOY.md`, "The plans service"; `decisions/0003-plans-service.md` |

**Re-testing the edge limit.** Cloud Armor's documentation says a rate limit is counted separately for
each backend a policy is attached to. To see it on the plans backend (this blocks your own address from the
plans API for the rest of that minute, and nobody else):

```sh
for i in $(seq 1 140); do curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/plans/status; done | sort | uniq -c
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/status
```

**Pass:** about 120 lines of `200` and the rest `429` (the documentation calls the count approximate), and
then `200` for the web server's status straight after: its backend counts by itself.

**Pass for (g) as a whole:** every row is "Done", "Declared" and then confirmed after the applies. One row
stays partly open by its nature until the service has had traffic.

---

## 6. What changed for a visitor in this pull request, before any apply

The merge deploys the site's new code. Three things differ, all in how saving a plan fails or retries:

- The page sends an `Idempotency-Key` with each save, and retries a save by itself once when it got no
  answer or a 502 or 504.
- A save with a key writes one more small document, in the same write as the plan.
- Each call to Firestore now gives up after 5 s and the visitor is told to try again. Before, it waited as
  long as the 60 s request allowed.

Requests and replies are otherwise the same, and a page loaded before the deploy keeps working.

---

## 7. What the contract pull request removed from the web server

Done, on the branch `arch/contract-web`, together with Phase 3's contract step (`ARCHITECTURE_PHASE_3.md`,
section 8). The web server no longer contains or can run the plans API. On its own address it answers
`404 {"error":"not-found"}` for `/api/plans` and `/api/plans/*`, like any path it does not have. On one
machine (`npm run dev:server`, Compose) it still passes those paths on to the plans service (`PLANS_URL`):
that is how local development keeps one address.

| File | What went |
| --- | --- |
| `web/server/app.ts` | The import of `handlePlans` and `planLimits` from `../plans/handler`, the plan limits, the data reader, and the handler half of the two `/api/plans` routes. The routes exist only when `PLANS_URL` is set |
| `web/server/index.ts` | The import of `firestorePlans`, the `plans:` line, `googleIdentity`, and `PLANS_DATABASE` in the list of settings. `GOOGLE_CLIENT_ID` is now only handed to the page |
| `web/server/deps.ts` | `plans`, `dataDir` and `identity`, and the imports of `PlanStore` and `Identity`. `signInClientId` (a string) replaces `identity` |
| `/api/status` in `web/server/app.ts` | `plans` stays in the reply, because `smoke.mjs` reads it, and is always `false`: this server runs no plans API. A new field, `elsewhere`, says where the plans service's own status is (`/api/plans/status`). `signIn` is unchanged: the page reads it |
| `web/plans/testing.ts`, `web/plans/plans.test.ts` | The web server's line in `PROGRAMS` and the block about its own status. The plans tests run against the service alone. `web/server/app.test.ts` checks the 404s and the forwarding |
| `web/server/build.test.ts` (new) | Bundles the server the way its image does and fails if any file from `web/copilot/`, `web/plans/` or `web/events-worker/` is in it, or anything outside `server/`, `shared/` and `src/lib/` |
| `web/scripts/smoke.mjs` | Reads `plans: false` as "this server runs none". It finds the plans service by its status address and runs the plans checks only where the service answers; on the web server's own address it says so and skips them |
| `infra/` | `web_plans_access` and the rule `web_keeps_plans` stay, so going back stays one line for the identity. Only comments and descriptions changed. The `idempotency_expiry` comment no longer says the web server writes key records |

What did not change: the grant and `PLANS_DATABASE` were removed by Apply C, so this pull request's
`terraform plan` shows nothing for plans except the help text of the plans alert.

**Going back is now two steps, not one.** The web server's code can no longer answer `/api/plans`, so
`plans_route = "web"` alone would send the path to a server that answers 404. First send the web server back
to a revision that still has the plans code, then set the route (see "The ways back" above).

---

## 8. What has only been tested, not run for real

Said plainly, so nobody finds out during an apply.

- **The real Firestore database.** The store ran against Google's emulator and inside the real image: the
  atomic write of a plan with its key, 12 saves at once with one key, an expired key's record replaced. On
  the real database none of it has run. The emulator answered a failed "must not exist" with
  `ALREADY_EXISTS` and a failed "last updated at" with `FAILED_PRECONDITION`; the code accepts both, and
  `ABORTED`, as "nothing was written". The first deploy's test (one save, sent twice) is the first real run.
- **The new identity's grants.** The condition on the `plans` database and the time-to-live rule on
  `idempotency.expires` are only declared.
- **Redis from the plans service.** The same network path as the web server, never used by a second
  service. If it does not work the service still answers, counts limits in each copy's memory, and reports
  `"limits":"redis-unreachable"` in its status. The deploy's check requires `redis`, so a first deploy that
  cannot reach Redis fails before it takes requests.
- **Real Google sign-in tokens on the service.** The check is the same code as the web server's, with the
  same client id, and its tests use stand-in keys. Check (b) is its first real token.
- **The deploy workflow** has never run, including the first-deploy path (placeholder live) and the wait
  for the site's data version.
- **The path rule on the load balancer** has never been applied. How long it takes to reach every edge
  here, and that the service's trace joins the load balancer's on the second backend, are both unseen.
  The visitor's address is read from `X-Forwarded-For` the way the web server reads it; that the load
  balancer sends the same header to the second backend is assumed, not seen.
- **The edge firewall's count per backend** was read in Google's documentation, not tested (check (g)).
- **A start from nothing** of the plans image has not been timed.
- **The objectives and the alert** have never held data or fired.
- **The page's automatic retry** ran in unit tests. In a browser, against a local server, only the retry
  by a second press was seen. Nothing of the page has run against the live site.
- **`plans_min_instances`, the 30 s timeout and 80 at once** are starting values (decision 0003).

---

## 9. Results of the checks, 2026-11-12

Run by Claude Code against the live site between 19:10 and 20:15 UTC, from Rodrigo's laptop, with the
commands in section 5. Times are UTC.

**The applies.**

| Apply | Result | What it was |
| --- | --- | --- |
| A, expand | 13 added, 0 changed, 0 destroyed | The identity, its two grants, the deployer's grant, the service on Google's placeholder image, public access to it, its backend with no path pointing at it, two objectives, the alert, the time-to-live rule for key records. No change to the URL map or to the web server's grants |
| B, move | 0 added, 4 changed, 0 destroyed | The URL map: a host rule for the domain and a path matcher with `/api/plans` and `/api/plans/*`. The other three "changed" were the revision name Terraform clears on each Cloud Run service |
| Back to `web`, then forward again (check (e)) | 0 added, 1 changed, 0 destroyed, twice | The URL map only |
| C, contract | 0 added, 4 changed, 1 destroyed | Destroyed: the web server's `roles/datastore.user` on the `plans` database. Changed: the web server lost its `PLANS_DATABASE` setting; the alert's help text; two revision names |

Access created, four grants, as section 3 lists them and no others. Access removed: one. Read back after C,
the web server's identity holds `roles/aiplatform.user`, `roles/cloudtrace.agent` and
`roles/datastore.viewer` on the `stats` database only. The plans service's identity holds
`roles/datastore.user` on the `plans` database only and `roles/cloudtrace.agent`.

**The first deploy.** The merge of pull request 125 ran the workflow against the placeholder. It built
`plans:2b98e19`, tested it with no visitors (a real plan saved with a key, sent again, opened), waited for
the site's data version, and sent it everyone. Its status then read `"store":"firestore"`,
`"limits":"redis"`, `"signIn":true`, `"tracing":true`. So three things section 8 called untested ran for
real there: the two-condition commit on the real database, Redis from a second service, and the workflow.

| Check | Result | What was seen |
| --- | --- | --- |
| (a) Share and open through the public address, no sign-in | **Pass** | `plans-check.mjs` against the site: every line `ok`. A plan saved (201), the same save sent again answered with the same id and `replayed=true`, a different plan under the key refused (422), the plan opened with its brief, the list refused without sign-in (401). The smoke test noted "answered by the plans service here: version 2b98e19" and found the same data version on both services |
| (b) Share, list and delete with sign-in | **Not run** | It needs a person signed in with Google. What was seen without one: a made-up token is refused (401), and the service reports sign-in switched on |
| (c) The web server's identity has no access to the database | **Pass** | After C the table has no `roles/datastore.user` row. The web server's own address answers `{"error":"not-configured"} 503` and reports `plans: false`. The public address opens the baseline's plan: 200 |
| (d) A retried save does not save twice | **Pass** | First line `201`, second the same id with `replayed=true`, third `{"error":"key-reused"} 422`. Four saves at once with one key: one id between them, all `201`, exactly one without `replayed=true` |
| (e) Sending the path back to the web server works | **Pass** | Below. The smoke test passed while the web server was answering, with its note saying so |
| (f) Response times match Phase 0 | **Pass** | Below |
| (g) The checklist | **Pass**, one row open by its nature, one partly seen | The table in section 5, updated |

**How long a route change takes to reach visitors.** Probed every 10 s from one laptop, so this is one
place's view of it.

| Change | Apply finished | First answer from the new target | Last answer from the old one | Plan opens that failed meanwhile |
| --- | --- | --- | --- | --- |
| B: to the plans service | 19:35:39 | 19:39:24, 3 min 45 s later | Two stray requests at 19:44:08 and 19:44:11, eight and a half minutes later, during the edge-limit test | Not counted |
| Back to the web server | 19:45:32 | 19:46:56, 1 min 24 s later. Then the plans service once more, and the web server only from 19:47:37 | About 19:47:27 | 0 of 24 |
| Forward again | 19:50:46 | 19:53:58, 3 min 12 s later | 19:53:49. Probed until 20:06:28: none after that, and the load balancer's log for the last six minutes showed only the plans backend | 0 of 100 |

Two things follow. A route change is not instant and not even: some of Google's edges take minutes longer
than others, so for a while both services answer. That is why the move was done with both able to answer
(expand, move, contract), and why C waited 16 minutes after the last move. And no plan request failed
during the two changes where failures were counted.

**(f) in numbers.** Same laptop and connection as the baseline. Opening the saved plan `3a4tqevu` 31 times,
the first left out:

| | Median | 95th percentile |
| --- | --- | --- |
| Baseline, answered by the web server | 178 ms | 251 ms |
| The same day at 19:04, before any apply, answered by the web server | 188 ms | 238 ms |
| After B, answered by the plans service, two runs | 175 ms and 157 ms | 255 ms and 211 ms |

Inside the service, from Cloud Trace, four saves: the whole request 93 to 147 ms, `save to Firestore` 53 to
88 ms, and on a replayed save `look up the idempotency key` 37 to 53 ms more.

**The edge limit, re-tested (g).** 140 requests in a row to `/api/plans/status`: 120 answered 200, 18
answered 429, and the 2 strays above answered 404 from the web server. The web server's status straight
after: 200. So the limit is counted for each backend by itself, as Google's documentation says.

**One thing that went differently.** Apply C ran at 20:07 while a deploy of the site (pull request 126, a
docs change) was in its "a tenth of the visitors" step. C changes the web service's settings, which makes a
new version. The deploy's last step sends everyone to the newest version, so it sent them to the one C had
just made: the deploy's new image, without the `PLANS_DATABASE` setting. That version had not been through
the deploy's tests as itself, though its image had. The deploy's final test of the live site passed.
Nothing broke. The lesson: look for a running deploy (`gh run list --workflow Deploy --limit 1`) before an
apply that changes a Cloud Run service.

**What section 8 said had only been tested, now.**

| Item | Now |
| --- | --- |
| The real Firestore database, the new identity's grants | Run for real: saves, replays, a race of four, opens. The time-to-live rule exists; no key record is a day old yet |
| Redis from the plans service | Runs: `"limits":"redis"` |
| Real Google sign-in tokens on the service | **Still not seen.** Check (b) |
| The deploy workflow | Ran twice and passed, the first time on the first-deploy path |
| The path rule, and how long it takes | Applied three times; times above. The visitor's address reaches the service: the edge limit and the service's own per-visitor limit both counted this laptop |
| The edge firewall's count per backend | Seen |
| A start from nothing | **Not measured**, and not possible this weekend: `plans_min_instances = 1` keeps one copy warm for the event, beside `min_instances = 1` |
| The objectives and the alert | Exist. No data yet |
| The page's automatic retry | **Still not seen** in a browser against the live site |
| The timeout and concurrency | Starting values, as before |

**Left on the live project by these checks.** Five plans with no owner, which the database removes after
180 days: "Deploy check (2b98e19)" and "Deploy check (e4fc126)" from the two deploys, "Deploy check (by
hand)", "Phase 2 replay check" and "Phase 2 race check". In `infra/terraform.tfvars` (not in the
repository): `plans_min_instances = 1`, to be set back to 0 with `min_instances` after 2026-11-15.
