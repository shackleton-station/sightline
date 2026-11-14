# Architecture, Phase 3: applying and checking the co-pilot service

For whoever applies this phase and for Rodrigo. What was built and why is in
[`decisions/0004-copilot-service.md`](decisions/0004-copilot-service.md). This file is the order to do things
in, what each `terraform plan` should show, every grant, how the first image gets deployed, the checks that
say the phase is done (each with what a pass looks like), the two drills, and what has only been tested.

**State on 2026-11-12, evening:** steps A (expand) and B (move) are applied, the service is deployed, and
the checks and both drills were run against the live site. The load balancer sends `/api/chat`, `/api/chat/*`
and `/api/ask` to the co-pilot service. What each check showed is in
[section 10](#10-results-of-the-checks-and-drills-2026-11-12). The contract step's code is done on the
branch `arch/contract-web` (section 8): the web server no longer contains the co-pilot, and the Terraform
defaults are the applied values plus `web_copilot_access = false`. Its apply (Apply C) runs after that pull
request is merged and its web deploy has finished. Also left: the cached-question timing in full, and two
things that need another day or a person (section 10 says which).

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
S=clps-copilot                       # the Cloud Run service, and its service account
SITE=https://shackletonstation.dev
```

---

## 1. What was built

| Piece | Where |
| --- | --- |
| The co-pilot service: its own program, entry point and image | `web/copilot/` (`app.ts`, `index.ts`, `Dockerfile`, and the moved `chat/`, `ask.ts`, `outbox.ts`) |
| The circuit breaker, with its state in Redis | `web/copilot/breaker.ts`, `web/copilot/redisClient.ts` |
| Retries with growing delays and full jitter, and the breaker around each model call | `web/copilot/modelCall.ts` |
| `Retry-After` on every busy answer | `web/copilot/busy.ts`, the handlers, and the sliding-window script in `web/shared/redisStore.ts` |
| The page waiting it out | `web/src/lib/chatClient.ts`, `web/src/lib/cooldown.ts`, `ScoutApp.tsx`, `AtlasApp.tsx`, `AskBox.tsx` |
| Kept answers keyed by the co-pilot's code and the data | `answerKey` in `web/copilot/chat/handler.ts`, `web/scripts/copilot-version.mjs` |
| The web server asking plans and the co-pilot how they are, with an identity token | `web/server/services.ts`, `web/shared/statusCaller.ts`, `/api/plans/status/web`, `/api/chat/status/web`, the How it works page (`ServiceStatus.tsx`) |
| Two stand-ins for the model: a scripted one for a laptop, and a share of calls failed on purpose for the breaker drill | `web/copilot/standIns.ts` |
| The written contract and its test | `web/copilot/API.md`, `web/copilot/contract.test.ts`, the pages' half in `web/src/lib/chatClient.test.ts` |
| The deploy, with the five set questions | `.github/workflows/deploy-copilot.yml`, `web/scripts/copilot-check.mjs`, `web/scripts/copilot-checks.mjs` |
| The smoke test and `chat-eval.mjs`, reaching it | `smoke.mjs --copilot-service --stream`; `chat-eval.mjs <any address that answers /api/chat>` |
| Terraform | `infra/copilot.tf`, and the staged pieces in `domain.tf`, `main.tf`, `events.tf`, `plans.tf`, `variables.tf` |
| Running it locally | `npm run dev:server` (four programs), `docker-compose.yml` (four images, Redis and Firestore's emulator, the scripted model) |

The web server still answers `/api/chat` and `/api/ask` with the same handlers. That is what makes step B
reversible. While both can answer, they share the rate limits, the breaker, the outbox and the kept answers
in Redis.

---

## 2. The order: expand, move, contract

| Step | What | Why in this order |
| --- | --- | --- |
| 1 | **Apply A** (expand): `copilot_service = true` | Creates the identity, its grants, the service, its backend, its objectives and alerts. Tells the web server the two services' addresses and plans who may ask its status. The URL map is not touched. Terraform starts the service on Google's placeholder image |
| 2 | **Merge the pull request** | CI, then the workflows. `Deploy` puts the site's new code live (it still runs the five set questions on its own canary). `Deploy co-pilot` finds the placeholder live, builds the first image, tests it on its own address, asks it the five set questions, and moves it to live. `Deploy plans` and `Deploy events worker` redeploy, because `web/shared/` changed |
| 3 | **Check the co-pilot service** runs the real image, and run the set questions on its own address (commands below) | The path rule must not exist while the placeholder is live: it would answer every question with a web page |
| 4 | **Apply B** (move): `copilot_route = "copilot"` | One change to the URL map. From here visitors' questions reach the co-pilot service |
| 5 | **The checks** in section 6, (a) to (h), and the drills in section 7 | |
| 6 | **Apply C** (contract): `web_copilot_access = false`, the new default, after the contract pull request is merged and its web deploy has finished | Removes the web server's model and topic grants and three settings. That pull request also removes the co-pilot wiring from the web server and the set questions from `deploy.yml` (section 8). Applying before the new web image is live would leave the old image with a model client and no permission, which only matters on the web server's own address |

Set each variable **in `infra/terraform.tfvars`**, not with `-var`, and keep it there. The example file
has the lines ready. A later plan without the line would undo the step.

If the pull request is merged before Apply A, nothing breaks: the co-pilot workflow ends with a warning that
the service does not exist. Run it by hand after Apply A (Actions, "Deploy co-pilot", "Run workflow").

### Apply A

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
# add to terraform.tfvars:  copilot_service = true   (and web_plans_access = false, see the top)
terraform plan -out=phase3a.tfplan
# read every line, then:
terraform apply phase3a.tfplan
```

With `web_plans_access = false` in the file, the plan must say **15 to add, 2 to change, 0 to destroy**.
Without it, it said 16 to add, 3 to change on 2026-11-12, the extra being the three lines named at the top.
It also prints `google_project_iam_member.web_vertex has moved to google_project_iam_member.web_vertex[0]`:
that is a new name in Terraform for the same grant, and changes nothing in the project.

| # | Resource | What it is |
| --- | --- | --- |
| 1 | `google_service_account.copilot[0]` | The identity `clps-copilot@…` |
| 2 | `google_project_iam_member.copilot_vertex[0]` | Grant 1 in section 3 |
| 3 | `google_pubsub_topic_iam_member.copilot_publishes[0]` | Grant 2 |
| 4 | `google_storage_bucket_iam_member.copilot_reads_light[0]` | Grant 3 |
| 5 | `google_project_iam_member.copilot_traces[0]` | Grant 4 |
| 6 | `google_service_account_iam_member.deployer_uses_copilot_identity[0]` | Grant 5 |
| 7 | `google_cloud_run_v2_service.copilot[0]` | The service: 1 CPU, 512 MiB, 0 to 3 copies, 10 requests at once, 40 s, the private network path to Redis, eleven settings |
| 8 | `google_cloud_run_v2_service_iam_member.copilot_public[0]` | Grant 6 |
| 9 | `google_compute_region_network_endpoint_group.copilot[0]` | Tells the load balancer where the service is |
| 10 | `google_compute_backend_service.copilot[0]` | The backend: CDN off, logging on, the edge firewall policy `clps-web-edge` attached. No path points at it yet |
| 11 | `google_monitoring_service.copilot[0]` | Lets Cloud Monitoring hold objectives for the service |
| 12 | `google_monitoring_slo.copilot_availability[0]` | 99% of requests succeed, over 28 days |
| 13 | `google_monitoring_slo.copilot_speed[0]` | 90% of requests answer within 10 s, over 28 days |
| 14 | `google_monitoring_alert_policy.copilot_burning_budget[0]` | An email when the failure allowance is being used 10 times too fast |
| 15 | `google_monitoring_alert_policy.copilot_breaker_opened[0]` | An email when the service logs "Circuit breaker opened", at most one per 30 minutes |

And the two changes, both in place:

- `google_cloud_run_v2_service.web`: two settings added, `PLANS_STATUS_URL` (the plans service's run.app
  address) and `COPILOT_STATUS_URL` (known after apply). A new revision of the site with the image that is
  live.
- `google_cloud_run_v2_service.plans[0]`: two settings added, `STATUS_CALLER`
  (`clps-web@clps-compute-6z1nc.iam.gserviceaccount.com`) and `STATUS_AUDIENCE` (`clps-plans`). A new
  revision of plans with its live image.

What to look for: **no line about `google_compute_url_map`**, and none creating or destroying a
`google_project_iam_member` or `google_pubsub_topic_iam_member` for `clps-web`. If either appears, stop.

### After the merge: is the real image live?

```sh
gcloud run services describe $S --project $P --region $R --format json \
  | jq '{url: .status.url, traffic: .status.traffic, image: .spec.template.spec.containers[0].image}'
URL=$(gcloud run services describe $S --project $P --region $R --format 'value(status.url)')
node web/scripts/copilot-check.mjs $URL --cloud --stream
node web/scripts/chat-eval.mjs $URL --quick
```

**Pass:** the image is `us-east4-docker.pkg.dev/clps-compute-6z1nc/web/copilot:<commit>`, not
`us-docker.pkg.dev/cloudrun/container/hello`, with 100% of the traffic. The workflow run is green. The
check ends with `All checks passed`: Gemini answers, limits and breaker on Redis, question log and tracing
on, and a streamed question's first lookup arrives before its answer. The set questions end with
`All 5 questions passed`. The check and the questions together count 7 against your own limit of 6 a
minute: leave a minute between the two commands. Do not go on to Apply B until both pass.

### Apply B

```sh
# add to terraform.tfvars:  copilot_route = "copilot"
terraform plan -out=phase3b.tfplan
terraform apply phase3b.tfplan
```

The plan must say **0 to add, 1 to change, 0 to destroy**: `google_compute_url_map.site[0]` updated in
place. With `plans_route = "plans"` (live), the path matcher `site` gains a second path rule:

```
+ path_rule {
    + paths   = ["/api/ask", "/api/chat", "/api/chat/*"]
    + service = (the backend clps-copilot-backend)
  }
```

and nothing else in the URL map changes. With `plans_route = "web"` instead, the plan said the same count;
the one path rule there changes its paths from the plans service's to the co-pilot's and its backend to
`clps-copilot-backend`, because the rules are a list and the co-pilot's becomes its first. Every
combination was planned on 2026-11-12:

| `plans_route` | `copilot_route` | Fault injected | The URL map |
| --- | --- | --- | --- |
| `plans` | `web` | no | Unchanged from today (the plans rule only) |
| `plans` | `copilot` | no | The plans rule, and the co-pilot's rule to `clps-copilot-backend` |
| `web` | `copilot` | no | The matcher `site` with the co-pilot's rule alone |
| `web` | `web` | no | No matcher `site` at all, as before Phase 2 |
| `plans` | `web` | yes | The plans rule, and the co-pilot's rule to `clps-web-backend` with the fault policy |
| `plans` | `copilot` | yes | The plans rule, and the co-pilot's rule to `clps-copilot-backend` with the fault policy |

A path matches one rule at most, so the two rules never meet. A change to the URL map takes a few minutes to
reach every part of Google's edge. Both programs answer the same API from the same Redis keys, so a visitor
cannot tell. Wait for this to say `copilot` several times in a row:

```sh
curl -s $SITE/api/chat/status | jq -r '.service // "web"'
```

### Apply C (the contract pull request)

The contract pull request makes the applied values the defaults (`copilot_service = true`,
`copilot_route = "copilot"`) and sets `web_copilot_access = false` as the default too. So after it is merged
there is nothing to add to `terraform.tfvars`:

```sh
terraform plan -out=phase3c.tfplan
terraform apply phase3c.tfplan
```

Run it after the web deploy of that merge has finished (the web server's new image reads none of the three
settings below). Planned read-only against the live state on 2026-11-12 from the branch, with the captain's
`terraform.tfvars`, it says **0 to add, 7 to change, 2 to destroy**:

- `google_project_iam_member.web_vertex[0]` destroyed: `clps-web`'s `roles/aiplatform.user` on the project;
- `google_pubsub_topic_iam_member.web_publishes[0]` destroyed: `clps-web`'s `roles/pubsub.publisher` on the
  topic `clps-web-events`;
- `google_cloud_run_v2_service.web` updated in place: `EVENTS_TOPIC`, `GEMINI_MODEL` and `VERTEX_LOCATION`
  removed, and the revision name cleared. A new revision of the web server with its live image. No
  `COPILOT=off` is added: the web server's code has no co-pilot to switch off;
- `google_service_account.web` updated in place: its description, which no longer says it calls Vertex AI;
- `google_monitoring_alert_policy.copilot_burning_budget[0]` and `plans_burning_budget[0]` updated in place:
  the help text, which no longer offers the route alone as a way back;
- `google_cloud_run_v2_service.copilot[0]`, `plans[0]` and `worker[0]` updated in place: the revision name
  Terraform clears on each Cloud Run service, as in every apply of this plan (the same three lines and the
  web server's appear in a plan from `main`, which is 0 to add, 4 to change, 0 to destroy).

No change to the URL map, the co-pilot's own grants, the bucket grant or any other grant.

`web_copilot_access = false` only takes effect while the load balancer really sends the co-pilot's paths to
the co-pilot service. Whenever it does not (`copilot_route = "web"`, no domain, no co-pilot service),
Terraform keeps the web server's grants and settings (`web_keeps_copilot` in `infra/copilot.tf`, the same rule
as `web_keeps_plans` for plans). This replaced the cross-check that refused `web_copilot_access = false`
while the route was on `"web"`, and the check that refused `copilot_route = "copilot"` without a domain:
with the new defaults those would have refused a checkout with no domain.

### The ways back

| To undo | Do | What happens |
| --- | --- | --- |
| A bad version of the service | Cloud Run: send requests back to an earlier revision (`DEPLOY.md`, "The co-pilot service") | Seconds. The deploy does this by itself when a step fails |
| The route (after B, before C) | `copilot_route = "web"`, apply | The path rule goes. The web server answers the co-pilot again, with the same limits, breaker and kept answers. A few minutes to reach every edge |
| The route (after the contract pull request and Apply C) | Two steps, in this order. First send the web server back to a revision that still has the co-pilot code (one from before the contract pull request: `gcloud run services update-traffic clps-web --to-revisions <revision>=100`, see `DEPLOY.md`). Then `copilot_route = "web"`, one apply | The web server's code has no co-pilot any more, so the route alone would send the questions to a server that answers 404. The grants and the three settings come back with the route by themselves (`web_keeps_copilot`); `web_copilot_access` needs no change. A new grant can take a few minutes to be honoured, so expect some `upstream` answers in that window. The next deploy of `main` puts the web server back on code with no co-pilot, so hold deploys until the route is on `"copilot"` again |
| Everything | The two steps of the row above; then `copilot_service = false`, apply. Without a web revision that still has the co-pilot code, nothing answers the co-pilot after this | The service, its identity, grants, backend, objectives and alerts go, and the four settings on the web server and plans. Redis keys expire by themselves |

---

## 3. Every grant

What the web server's identity holds today, read on 2026-11-12 (`gcloud projects get-iam-policy`, and the
topic's and bucket's own policies): `roles/aiplatform.user`, `roles/cloudtrace.agent`,
`roles/datastore.user` (condition `only-the-plans-database`), `roles/datastore.viewer` (condition
`only-the-stats-database`) on the project; `roles/pubsub.publisher` on the topic `clps-web-events`;
`roles/storage.objectViewer` on the bucket `clps-compute-6z1nc-web-assets`. Apply A changes none of them.

Apply A creates six. Apply B creates none. Apply C removes two.

| # | Apply | Who | Role | On what | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | A | `clps-copilot@…` (new) | `roles/aiplatform.user` | The project | It calls Gemini (`generateContent`). The narrowest predefined role that can; it cannot be narrowed to one model |
| 2 | A | `clps-copilot@…` | `roles/pubsub.publisher` | The topic `clps-web-events` only | It publishes question events through the outbox |
| 3 | A | `clps-copilot@…` | `roles/storage.objectViewer` | The bucket `clps-compute-6z1nc-web-assets`, condition `only-the-light-grid` (`resource.name.startsWith("projects/_/buckets/clps-compute-6z1nc-web-assets/objects/tiles/light/")`) | The tool that looks up tapped ground reads the light grid's months. It cannot read the terrain tiles or the video |
| 4 | A | `clps-copilot@…` | `roles/cloudtrace.agent` | The project | It writes a trace per request |
| 5 | A | `clps-web-deployer@…` (existing) | `roles/iam.serviceAccountUser` | The service account `clps-copilot` only | A deploy has to hand the service its identity |
| 6 | A | `allUsers` | `roles/run.invoker` | The Cloud Run service `clps-copilot` | It is public, as the web server and plans are: the load balancer calls it for any visitor, and the deploy tests it on its own address |
| 7 | C, removed | `clps-web@…` | `roles/aiplatform.user` | The project | The web server no longer calls the model |
| 8 | C, removed | `clps-web@…` | `roles/pubsub.publisher` | The topic `clps-web-events` | The web server no longer publishes question events |

Grant 3 is one the brief did not list. The baseline found it (section 2.2, "the assets bucket"): the
co-pilot reads the light grid from the bucket, so without it the tapped-spot question fails. The condition
keeps it to `tiles/light/`.

Things that are not grants, said plainly:

- **Redis has no permissions.** The co-pilot reaches it the way the web server and plans do: Direct VPC
  egress, `PRIVATE_RANGES_ONLY`, on the project's default network. Its code touches `clps:limit:chat:…`,
  `clps:limit:ask:…`, `clps:cache:copilot:…`, `clps:outbox:…` and `clps:copilot:breaker`.
- **The status check is not a grant.** The web server's identity token is checked in code by each service.
  Nothing is granted for it, and no secret is stored.
- **Nothing for Firestore, Text-to-Speech or the other services.** Text-to-Speech has no role to withhold
  (baseline 2.3).
- **The deployer already may deploy and call any Cloud Run service** in the project
  (`roles/run.developer`). No grant was added for that.

After Apply A, to see the identity's grants (it must list exactly two project roles, and one row each on
the topic and the bucket):

```sh
gcloud projects get-iam-policy $P --flatten 'bindings[].members' \
  --filter "bindings.members:serviceAccount:$S@$P.iam.gserviceaccount.com" \
  --format 'table(bindings.role, bindings.condition.title)'
gcloud pubsub topics get-iam-policy clps-web-events --project $P --format json | jq '.bindings[] | select(.members[] | contains("clps-copilot"))'
gcloud storage buckets get-iam-policy gs://clps-compute-6z1nc-web-assets --format json | jq '.bindings[] | select(.members[] | contains("clps-copilot"))'
```

---

## 4. Deploying the co-pilot service

Normally nobody does anything: a merge to `main` that touches what the service is built from deploys it,
after CI (`DEPLOY.md`, "The co-pilot service"). By hand (Docker and access to the project):

```sh
cd web
COMMIT=$(git rev-parse --short HEAD)
IMAGE=us-east4-docker.pkg.dev/$P/web/copilot:$COMMIT
gcloud auth configure-docker us-east4-docker.pkg.dev
docker build --platform linux/amd64 -f copilot/Dockerfile --build-arg VERSION=$COMMIT -t $IMAGE .
docker push $IMAGE
gcloud run deploy $S --project $P --region $R --image $IMAGE --no-traffic --tag canary
CANARY=$(gcloud run services describe $S --project $P --region $R --format json | jq -r '.status.traffic[] | select(.tag == "canary") | .url')
node scripts/copilot-check.mjs $CANARY --version $COMMIT --data-version $(node scripts/data-version.mjs public/data | jq -r .dataVersion) --code-version $(node scripts/copilot-version.mjs | jq -r .codeVersion) --cloud
sleep 61
node scripts/chat-eval.mjs $CANARY --quick
gcloud run services update-traffic $S --project $P --region $R --to-latest
```

---

## 5. What changed for a visitor in this pull request, before any apply

The merge deploys the site's new code, which still answers the co-pilot itself. Five things differ:

- **Busy answers say how long to wait**, and the page waits that long before it sends another question:
  the Atlas's and the typed-question box's buttons count down ("Wait 12 s"), and Scout says how long is
  left. A rate limit's wait is now exact (the oldest counted question leaving the minute), where the page
  used to say "a minute".
- **A failed model call is tried up to three times**, with random waits of up to 0.5 s and then 1 s, where
  it used to be tried twice with a fixed 1.2 s. `/api/ask` now retries too.
- **After five failed model calls in a minute, questions are refused at once for 30 s** (`503` with
  `Retry-After`), with one trial question then. Kept answers are still given.
- **Kept answers survive a deploy of the site** that changes neither the co-pilot's code nor the data. The
  first deploy of this code starts an empty cache under the new keys; old entries expire within a day.
- **The How it works page** has a new part, "The services, right now".

Requests and replies are otherwise the same, and a page loaded before the deploy keeps working. The one
difference it can see: during an open breaker it gets a `503`, which an old page words as "isn't switched
on here" until it is reloaded.

---

## 6. The "done when" checks

Run them after Apply B, in this order, from the repository root. Each says what it changes on the live
project. The co-pilot allows one address 6 questions a minute: leave a minute between the checks that ask
questions.

### (a) The set questions pass through the public address

Changes: up to six questions asked (a few model calls each, unless kept). Six rows in the question log.

```sh
curl -s $SITE/api/chat/status | jq '{service, version, codeVersion, dataVersion}'
node web/scripts/chat-eval.mjs $SITE --quick
```

**Pass:** the first command shows `"service": "copilot"`. The second ends with `All 5 questions passed`
and no `FAIL` line. Lines with `note: a kept answer` were answered from the cache and passed these checks
when first worked out; that is expected on a version whose answers the deploy already asked for.

### (b) Streaming still works through the load balancer

Changes: one question (one model call, unless kept).

```sh
node web/scripts/copilot-check.mjs $SITE --stream
curl -sN -X POST -H 'content-type: application/json' -H "origin: $SITE" -H 'accept: text/event-stream' \
  -d '{"messages":[{"role":"user","text":"Which site gets the most Sun in October 2027?"}],"view":"#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn"}' \
  $SITE/api/chat | while IFS= read -r line; do printf '%s %s\n' "$(date +%T.%N | cut -c1-12)" "$line"; done
```

**Pass:** the check prints `each lookup arrives as it happens, before the answer` with the first lookup's
time well before the answer's, and `the stream is not compressed or rewritten on the way`. In the second
command's output each `event: step` line has an earlier time than the `event: reply` line, seconds apart:
the load balancer passed the stream on as it was written, not all at the end.

### (c) With the co-pilot broken or at zero copies, pages and plans still work and the page says it is busy

Changes: the URL map, twice (a fault switched on for a few minutes, then off).

"Broken" is made with the fault-injection switch at its strongest, so nothing reaches the service: every
co-pilot request is answered `503` by the load balancer itself.

```sh
# in terraform.tfvars:  copilot_fault_abort_percent = 100
terraform -chdir=infra plan -out=broken.tfplan && terraform -chdir=infra apply broken.tfplan
# wait until this says 503 several times in a row:
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -H "origin: $SITE" -d '{"question":"x"}' $SITE/api/ask
node web/scripts/smoke.mjs $SITE --plans-service
node web/scripts/plans-check.mjs $SITE --cloud
curl -s $SITE/api/status/services | jq '.services | map_values(.state)'
```

Then in a browser: open `$SITE/atlas/`, ask Scout anything.

**Pass:** the plan says 0 to add, 1 to change, 0 to destroy, and adds only the co-pilot's path rule with
`route_action`, `weighted_backend_services` (weight 100) and `fault_injection_policy.abort` (503, 100). In
the smoke test every line says `ok` except the co-pilot's four (they expect 403 and 405 and get 503, because
the load balancer answers before the service), so it ends `4 check(s) failed`: that is the point. Plans:
`All checks passed`. The services' status
says `"up"` for both: the web server calls the services directly, not through the load balancer. In the
browser Scout says "Scout is busy. Ask again in 15 s." (the load balancer sends no
`Retry-After`, so the page waits its default), the Ask button reads "Wait 15 s" and counts down, and
pages, the globe and plans work as usual.

Switch it off: `copilot_fault_abort_percent = 0` (or remove the line), plan, apply. The plan must remove
only the co-pilot's `route_action` and put back `service = clps-copilot-backend`.

"At zero copies" is the cold start, measured in (d).

### (d) Times against the Phase 0 baseline, and the extra cold start

Changes: about 13 questions, all but the first two answered from the cache.

Step 5 of [`ARCHITECTURE_BASELINE.md`](ARCHITECTURE_BASELINE.md), section 1.8, from the same laptop:

```sh
stats() { tail -n +2 | sort -n | awk '{v[NR]=$1} END {n=NR; m=int(n*0.5)+1; if(m>n)m=n; p=int(n*0.95)+1; if(p>n)p=n; printf "n=%d median=%.0f ms p95=%.0f ms\n", n, v[m]*1000, v[p]*1000}'; }
Q='{"messages":[{"role":"user","text":"How much sunlight does Connecting Ridge get in May 2027?"}],"view":"#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn"}'
ask() { curl -s -o /dev/null -w '%{time_total} x-cache=%header{x-cache}\n' -X POST -H 'content-type: application/json' -H "origin: $SITE" -d "$Q" $SITE/api/chat; }
(for i in 1 2 3 4 5 6; do ask; done; sleep 65; for i in 1 2 3 4 5 6; do ask; done) | tee times.txt
grep -v '^0\.0' times.txt | cut -d' ' -f1 | stats
```

| A co-pilot question answered from the cache, 2 batches of 6 | n | Median | 95th percentile |
| --- | --- | --- | --- |
| The baseline, 2026-11-12 16:47 UTC, answered by the web server | 10 | 201 ms | 320 ms |

**Pass:** every line ends `x-cache=hit` after the first, and the median and 95th percentile are near the
baseline's. The co-pilot service does less per cached answer than the web server did (one Redis read for
the breaker is the only new call).

**The cold start, which is new.** Before this phase a question was handled by the web server's copy,
which is kept warm (`min_instances = 1`). The co-pilot service scales to zero. To see it: leave the co-pilot
alone for 15 minutes (no question, no How it works page), then:

```sh
gcloud run services describe $S --project $P --region $R --format 'value(status.conditions)' >/dev/null  # does not wake it
curl -s -o /dev/null -w 'status %{time_total} s\n' $SITE/api/chat/status
```

**Write down** the time: it is the extra wait the first visitor after a quiet spell gets, before the
question's own time. Not measured yet. On a laptop the image answered its status 194 ms after `docker run`
(decision 0004), which says little about Cloud Run. If it matters for an event: `copilot_min_instances = 1`.

### (e) The breaker opens, the page obeys `Retry-After`, and it closes by itself

Section 7, "The breaker drill".

### (f) `/api/status/services` asks both services as the web server

Changes: nothing.

```sh
curl -s $SITE/api/status/services | jq '.services | map_values({state, checkedAs, why})'
URL=$(gcloud run services describe $S --project $P --region $R --format 'value(status.url)')
curl -s -w ' %{http_code}\n' $URL/api/chat/status/web
curl -s -w ' %{http_code}\n' -H "authorization: Bearer $(gcloud auth print-identity-token)" $URL/api/chat/status/web
```

**Pass:** both services `"state": "up"`, `"checkedAs": "web"`. Without a token the service answers
`{"error":"caller","why":"missing"} 401`. With your own identity token: `401` (its audience is not
`clps-copilot`) or `403` (`not-web`). If both services show `down` with `could not be reached: metadata
server: HTTP …`, the metadata server refused a token for the audience `clps-copilot`: Google's pages do not
say it accepts a name that is not a URL (`REFERENCES.md`). The fix is to set `COPILOT_AUDIENCE` and
`STATUS_AUDIENCE` (and the plans pair) to a URL-shaped name, for example
`https://clps-copilot.status.shackletonstation.dev`, in `infra/` and apply.

### (g) The How it works page shows a service that does not answer

Changes: nothing. Open `$SITE`, then How it works, part 4, "The services, right now", right after a quiet
spell of 15 minutes.

**Pass:** while a service starts from zero copies it may show "Not answering: no answer within 1 s. A
service with no copy running takes a few seconds to start…", and on a reload ten seconds later "Up,
answered in N ms, to a request signed as the web server. The model answers normally." That first sight is
the page's handling of a service that does not answer, seen for real.

### (h) The checklist every service must pass before it takes traffic

| Item (plan, section 7) | State | How to see it |
| --- | --- | --- |
| Its own identity, with only the permissions its code uses | Declared | Section 3, and the commands at its end |
| Its own image, Dockerfile and deploy workflow, with the stepped rollout and automatic rollback | Built. The image built and ran on a laptop; the workflow has not run | `web/copilot/Dockerfile`, `.github/workflows/deploy-copilot.yml` |
| A status address reporting its version and data version | Built, run in the real image on a laptop | `curl -s $SITE/api/chat/status` after Apply B. It also reports the code version |
| Graceful shutdown on SIGTERM | Built. `docker stop` half a second into a 3 s streamed answer: the answer arrived whole, exit 0 after 2.6 s | `web/copilot/index.ts` |
| A request timeout and a concurrency setting chosen from measurement | **Partly.** 40 s and 10 rest on the baseline's numbers, the co-pilot's own limits and a laptop run (decision 0004). Its own traffic has not been measured | After a week: request times and instance count in Cloud Run's metrics for `clps-copilot` |
| Joins the request's trace; logs carry the service's name | Built and unit-tested. Not seen live | Cloud Trace, filter `span:"/api/chat"`: the service's steps (`rate limits`, `answer cache`, `circuit breaker`, `model call 1`, …) under the load balancer's span. Logs: `gcloud logging read 'resource.labels.service_name="clps-copilot" AND jsonPayload.service="copilot"' --project $P --freshness 1h --limit 5` |
| Its own objective and alert | Declared, with a second alert for the breaker | The console's SLO page for `clps-copilot`; the alerts "clps-copilot is failing too often" and "clps-copilot: the circuit breaker opened" |
| Unit tests moved with the code; a contract test; the smoke test extended | Done | `web/copilot/*.test.ts`, `web/copilot/API.md`, `node web/scripts/smoke.mjs $SITE --copilot-service --stream` |
| The edge firewall policy attached to its backend, and the limits re-tested | Declared. The re-test is below, not run | `gcloud compute backend-services describe clps-copilot-backend --global --project $P --format 'value(securityPolicy, enableCDN, logConfig.enable)'` must show `clps-web-edge`, `False`, `True` |
| One command runs everything locally; a Compose file runs the real images | Done, both run on 2026-11-12 (Compose with the scripted model) | `npm run dev:server` in `web/` (`FAKE_MODEL=on` for no account); `docker compose up --build` at the top |
| A rollback in `DEPLOY.md` and a decision record | Done | `DEPLOY.md`, "The co-pilot service"; `decisions/0004-copilot-service.md` |

**Re-testing the edge limit** (blocks your own address from the co-pilot's paths for the rest of that minute,
and nobody else; the requests are GETs, which the service answers 405 without a model call):

```sh
for i in $(seq 1 140); do curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/chat; done | sort | uniq -c
curl -s -o /dev/null -w '%{http_code}\n' $SITE/api/status
```

**Pass:** about 120 lines of `405` and the rest `429`, then `200` for the web server's status straight
after: its backend counts by itself.

---

## 7. The two drills

### Fault injection at the load balancer

**What Google's documentation says** (read 2026-11-12, `REFERENCES.md`):

- The feature comparison lists fault injection for the external Application Load Balancer as "Yes (Only
  global and regional modes)": https://docs.cloud.google.com/load-balancing/docs/features. This site's load
  balancer is the global one (`EXTERNAL_MANAGED`). The footnote there that excludes serverless backends is
  on other rows (circuit breaking, traffic mirroring), not this one.
- The serverless NEG page lists the traffic-management features Cloud Run backends do not support as
  locality policy and session affinity, not fault injection:
  https://docs.cloud.google.com/load-balancing/docs/negs/serverless-neg-concepts.
- No page says in so many words "fault injection works with a Cloud Run backend on the global load
  balancer". The first apply of the drill is where that is seen.
- **The form of the URL map.** The fault policy is a route action (`routeAction.faultInjectionPolicy`),
  allowed on a path rule as well as a route rule. But a path rule may name its backend only one way: "Only
  one of urlRedirect, service or routeAction.weightedBackendService can be set"
  (https://docs.cloud.google.com/compute/docs/reference/rest/v1/urlMaps). And one path matcher holds either
  path rules or route rules, never both, so moving to route rules would mean rewriting the plans rule too.
  So during a drill the co-pilot's path rule drops `service` and names its backend inside `route_action`,
  as a weighted backend with weight 100, beside the fault policy. The Terraform provider (google 8.11.0, the
  version this repository's lock file names) has `path_rule.route_action.fault_injection_policy` with
  `delay.fixed_delay`, `delay.percentage`, `abort.http_status` and `abort.percentage`; checked with
  `terraform providers schema`. Ranges from the API reference: a percentage from 0 to 100, a status from
  200 to 599.

**What it proves, and what it cannot.** It sits between the visitor and the service. So it shows what the
page does with slow and failing answers, and that pages and plans are untouched (the bulkhead). It never
reaches the service's own call to the model, which is where the circuit breaker is: an aborted request
never arrives, and a delayed one arrives late but then succeeds. The breaker has its own drill below.

**The drill:**

```sh
# 1. In terraform.tfvars: half the co-pilot's requests held 8 s, and half answered 503 by the load balancer.
#    copilot_fault_delay_percent = 50
#    copilot_fault_delay_seconds = 8
#    copilot_fault_abort_percent = 50
terraform -chdir=infra plan -out=faults.tfplan && terraform -chdir=infra apply faults.tfplan
# 2. Watch, from a second terminal, one GET a second (405 from the service, 503 from the abort, slow from the delay):
while true; do curl -s -o /dev/null -w "$(date +%T) %{http_code} %{time_total}s\n" $SITE/api/chat; sleep 1; done
# 3. In a browser: ask Scout three or four questions on the Atlas; open a few pages and a shared plan.
# 4. Switch off: remove the three lines (or set the shares to 0), plan, apply. Watch step 2 go back to all 405.
```

**What to watch, and a pass.** The plan in step 1 says 0 to add, 1 to change, 0 to destroy (the co-pilot's
path rule with its `route_action`). In step 2, once the change has spread, about half the lines are `503`
in milliseconds, and about half of the rest take 8 s or more. In the browser: a question that meets the
abort gets "Scout is busy. Ask again in 15 s.", with the button counting down; one
that meets the delay shows the thinking state for 8 s more, then answers. Pages, tiles and plans never slow
down or fail. Then in the load balancer's log the aborts are visible as answered by the load balancer, not
the backend:

```sh
gcloud logging read 'resource.type="http_load_balancer" AND httpRequest.requestUrl:"/api/chat" AND jsonPayload.statusDetails="fault_filter_abort"' \
  --project $P --freshness 15m --limit 5 --format 'value(timestamp, httpRequest.status, jsonPayload.statusDetails)'
```

(`fault_filter_abort` is the status detail Envoy-based load balancers write for an injected abort; if this
finds nothing, read one line without the last filter and note what it says.) The pass for the switch-off: the
plan removes only the `route_action` and puts `service` back, and step 2 returns to `405`.

### The breaker drill

```sh
# 1. In terraform.tfvars:  copilot_model_faults = "503@100"
#    The service answers every model call 503 itself, without calling the model. A new revision with the live image.
terraform -chdir=infra plan -out=breaker.tfplan && terraform -chdir=infra apply breaker.tfplan
curl -s $SITE/api/chat/status | jq -r .model      # must say "gemini, with 100% of calls failed on purpose (503)"
# 2. Five different questions, from one address, a few seconds apart (each fails after its retries: 502).
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "$i %{http_code} retry-after=%header{retry-after} %{time_total}s\n" -X POST -H 'content-type: application/json' -H "origin: $SITE" \
    -d "{\"messages\":[{\"role\":\"user\",\"text\":\"Breaker drill question $i\"}],\"view\":\"#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn\"}" $SITE/api/chat
done
# 3. A sixth, after a minute (your own limit): refused at once by the open breaker.
sleep 61; curl -s -w ' %{http_code} retry-after=%header{retry-after} %{time_total}s\n' -X POST -H 'content-type: application/json' -H "origin: $SITE" \
  -d '{"messages":[{"role":"user","text":"Breaker drill question 6"}],"view":"#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn"}' $SITE/api/chat
curl -s $SITE/api/status/services | jq '.services.copilot.status.breaker'
# 4. Switch off:  copilot_model_faults = ""  (or remove the line), plan, apply. The next question after the
#    breaker's 30 s is the trial; it works, and the breaker closes.
```

**Pass:** step 2 prints five `502` lines, each in about a second (three tries and their waits). Within a
minute, the alert email "clps-copilot: the circuit breaker opened". Step 3 prints
`{"error":"busy","retryAfterSeconds":N} 503 retry-after=N` in milliseconds, N at most 30, if it lands while
the breaker is open (it reopens every 30 s while the faults stay on, since each trial fails); the services'
status shows `"state": "open"` or `"half-open"`. In a browser during the drill: "You can ask again in N s"
and a countdown. After step 4 and 30 s, a question answers normally and the status shows `"closed"`. The
question log and How it works count these questions as `busy` and `failed`.

Laptop version, run on 2026-11-12 with two copies on one Redis (decision 0004): the five failures from one
copy opened the breaker for the other, which then refused in 5.5 ms with `Retry-After: 30`, and closed after
one trial 31 s later.

---

## 8. What the contract step changed

Done, on the branch `arch/contract-web`, together with Phase 2's contract step (`ARCHITECTURE_PHASE_2.md`,
section 7). The web server no longer contains or can run the co-pilot. On its own address it answers
`404 {"error":"not-found"}` for `/api/chat`, `/api/chat/*` and `/api/ask`, like any path it does not have.
On one machine (`npm run dev:server`, Compose) it still passes them on to the co-pilot service
(`COPILOT_URL`).

| File | What went or changed |
| --- | --- |
| `.github/workflows/deploy.yml` | "Check the co-pilot still answers from the data" (`chat-eval.mjs --quick`) and `--ask` are gone: nothing in the web deploy calls the model. The smoke test runs on the canary's address, then on the live web server's own address, then through the public address with `--plans-service --copilot-service --data-may-differ`, where both services must answer their status, refuse another site and refuse a GET. No model call |
| `web/server/app.ts` | The imports from `../copilot/` and `../plans/`, the chat, ask and plan limits, the data reader, the outbox relay, the model guard, the co-pilot deps, and the handler half of every co-pilot and plans route. The forwarding routes exist only when `COPILOT_URL` or `PLANS_URL` is set |
| `web/server/index.ts` | The model client, the question topic, the outbox and its timer, the breaker, the plans store, the sign-in checker, the code version file, and the shutdown sweep of the outbox. Settings it no longer reads: `GEMINI_MODEL`, `VERTEX_LOCATION`, `COPILOT`, `EVENTS_TOPIC`, `EVENTS_PUSH_URL`, `PLANS_DATABASE`, `COPILOT_VERSION_FILE`, `COPILOT_CODE_VERSION` |
| `web/server/deps.ts` | `model`, `events`, `relay`, `breaker`, `retry`, `copilotCodeVersion`, `plans`, `dataDir`, `identity` and their imports. `signInClientId` replaces `identity` |
| `web/server/redisClient.ts` | `copilotCommands` and the `outbox` and `breaker` it returned. The web server keeps the shared connection, the rate-limit and cache commands, and the rooms' commands |
| `/api/status` in `web/server/app.ts` | `copilot`, `questionLog` and `plans` stay in the reply, because readers expect them, and are always `false`; `copilotCodeVersion` is always `null`. A new field, `elsewhere`, names the two services' own status addresses. `signIn` is unchanged |
| `web/Dockerfile` | No `copilot-version.json` in the image |
| `web/copilot/testing.ts`, `app.test.ts`, `outbox.test.ts`, `web/events-worker/contract.test.ts` | The web server's line in `PROGRAMS` and the shared-kept-answers test are gone; the outbox and event-contract tests build the co-pilot service instead of the web server |
| `web/server/app.test.ts`, `web/server/build.test.ts` (new) | Every co-pilot and plans path is 404 for every method, whatever else is configured; with `COPILOT_URL` and `PLANS_URL` they are passed on with the method, body and headers, and a service that cannot be reached is `502 upstream`. The build test bundles the server as its image does and fails if a file from `copilot/`, `plans/` or `events-worker/` is in it |
| `web/scripts/smoke.mjs` and the check helpers | Find each service by its status address. On the web server's own address they say only the web server is there and skip those checks; `--plans-service` and `--copilot-service` make a missing service fail. `--data-may-differ` reports, and does not fail on, a service carrying other site data, for the web deploy only |
| `infra/` | Defaults `copilot_service = true`, `copilot_route = "copilot"`, `web_copilot_access = false`. The two cross-checks are replaced by `web_keeps_copilot`. `EVENTS_TOPIC`, `GEMINI_MODEL` and `VERTEX_LOCATION` on the web service exist only while the identity keeps its access; `COPILOT=off` is gone. The `moved` block for `web_vertex` is gone (it was applied in Phase 3). The bucket grant stays: the web server still serves tiles and video. `web_copilot_access` itself stays, so a checkout with no domain validates and going back is one line for the identity |

**What changed in the image.** Measured with `docker build` and `docker image inspect` on 2026-11-12, both
built the same way on one laptop (arm64):

| | Before (`main` at `ff6ecfa`) | After |
| --- | --- | --- |
| Web image | 579,593,264 bytes | 579,431,503 bytes (161,761 smaller) |
| Server bundle (`dist-server/index.js`) | 179,410 bytes (49,747 gzipped), 72 source files | 53,374 bytes (15,358 gzipped), 31 source files |
| Source files in the bundle by folder | `server/` 14, `shared/` 24, `src/lib/` 16, `copilot/` 13, `plans/` 5 | `server/` 14, `shared/` 14, `src/lib/` 3 |

The image barely changes because the server code was never most of it. It is the Node base image, the
built site in `dist/` (about 112 MB, almost all the site data under `dist/data/`, which pages load) and
`node_modules` (about 77 MB). Every data folder in `dist/data/` is loaded by some page, so none was
dropped. About 33 MB of `node_modules` is page libraries the server never loads (`three`, `react-dom`,
`d3`, `qrcode-generator`), installed because they are in `dependencies`; moving them to
`devDependencies`, or bundling the server's own libraries the way the co-pilot's image does, would remove
them. Not done here, because it changes `package.json` and its lock file, which two other branches touch.

**Going back is now two steps, not one.** The web server's code can no longer answer the co-pilot's paths,
so `copilot_route = "web"` alone would send the questions to a server that answers 404. First send the web
server back to a revision that still has the co-pilot code, then set the route (see "The ways back" above).

---

## 9. What has only been tested, not run for real

- **The path rule and the fault policy on the load balancer** have never been applied. That fault injection
  works with a Cloud Run backend on this load balancer is read from Google's tables, not seen (section 7).
  How long a change takes to reach every edge here was seen for Phase 2's rule, not this one.
- **Streaming through the load balancer to a second backend.** Through the web server's backend it works
  today (the baseline's questions streamed). On `clps-copilot-backend`, with CDN off, it is expected to
  work the same; check (b) is the first sight.
- **The breaker on Memorystore.** The compare-and-set and the sliding-window scripts ran on Redis 7.2 in
  Compose (decision 0004), the same major version as Memorystore's `REDIS_7_2`. Not on Memorystore itself.
- **Service-to-service tokens.** The check ran in tests with stand-in keys. Whether the metadata server
  issues a token for the audience `clps-copilot`, and whether Cloud Run passes the `Authorization` header to
  a public service untouched, are not stated in Google's pages; check (f) is the first sight.
- **The new identity's grants**, the bucket condition on `tiles/light/` included, are only declared. The
  first tapped-spot question on the live service (`chat-eval.mjs $SITE` in full, question 11) is the first
  real read.
- **The deploy workflow** has never run, including the first-deploy path and the minute it waits before
  the set questions.
- **A start from nothing** of the image on Cloud Run has not been timed (check (d)).
- **The objectives and the two alerts** have never held data or fired.
- **The page's countdown** ran in unit tests (the client's handling of every busy answer) and its pieces in
  a laptop server's answers; it has not been seen in a browser against the live site.
- **Real model calls through the new retry code.** Every test used a scripted model; no paid model call was
  made for this phase. The first deploy's five set questions are the first.
- **`copilot_concurrency = 10`, the 40 s timeout and the objectives' numbers** are starting values
  (decision 0004).

---

## 10. Results of the checks and drills, 2026-11-12

Run by Claude Code against the live site between 20:30 and 21:25 UTC, from Rodrigo's laptop, with the
commands in sections 6 and 7. Times are UTC. Every apply was made from a saved plan read line by line first.

**The applies.**

| Apply | Result | What it was |
| --- | --- | --- |
| A, expand | 15 added, 3 changed, 0 destroyed | The identity and the six grants in section 3, the service on Google's placeholder image, its backend with no path pointing at it, two objectives, two alerts. Changed: two settings added to the web server and two to the plans service (who may ask for a status), and one revision name. No change to the URL map or to the web server's grants |
| B, move | 0 added, 5 changed, 0 destroyed | The URL map: one more path rule in the matcher `site`. The other four were revision names |
| Fault drill on, changed, off | 0 added, 5, 1 and 1 changed | The co-pilot's path rule only (and four revision names the first time) |
| Breaker drill on, off | 0 added, 1 changed, twice | One setting on the co-pilot service, `MODEL_FAULTS` |

Access created: the six grants of section 3 and no others. Access removed: none yet.

**The first deploy.** The merge of pull request 128 ran the new workflow against the placeholder. It built
`copilot:b934dd4`, tested it with no visitors, asked the five set questions of it through the real model and
the new retry code, and sent it everyone. Its status read `"model":"gemini"`, `"limits":"redis"`,
`"breakerStore":"redis"`, `"questionLog":true`, `"tracing":true`.

| Check | Result | What was seen |
| --- | --- | --- |
| (a) The set questions through the public address | **Pass** | `"service":"copilot"` on the status address. `All 5 questions passed`; several were kept answers, as expected after the deploy had asked them |
| (b) Streaming through the load balancer | **Pass** | The first lookup reached the client at 1,794 ms and the answer at 4,490 ms. The stream was not compressed or rewritten (`no-store, no-transform`) |
| (c) The co-pilot broken: pages and plans still work, the page says busy | **Pass** | Below |
| (d) Times against the baseline; the cold start | **Partly** | Three cached answers through the new service: median 217 ms (baseline 201 ms, n = 10). The rest of the two batches were refused with `429`: this laptop's address had asked its 60 questions for the day by then, and the answer said so exactly, `Retry-After: 71327`. To be run again from another day. The cold start cannot be seen this weekend: `copilot_min_instances = 1` keeps a copy warm for the event |
| (e) The breaker opens, tells callers when to return, and closes by itself | **Pass** | Below |
| (f) `/api/status/services` asks both services as the web server | **Pass** | Both `"state":"up"`, `"checkedAs":"web"`. So the metadata server does issue a token for an audience that is a name and not an address. Without a token the service answered `{"error":"caller","why":"missing"} 401`; with a person's own token, `401`, `"why":"invalid"` |
| (g) How it works shows the services | **Seen up only** | "Co-pilot: Up. Answered in 33 ms, to a request signed as the web server. The model answers normally." and the same for plans in 37 ms. A service that does not answer was not seen: both are kept warm |
| (h) The checklist | **Pass**, one row partly open by its nature | The edge limit re-tested: 140 requests to `/api/chat` gave 125 answers of 405 and 15 of 429, and straight after the web server's status and the plans service's status both answered 200. Counted per backend |

**How long each change took to reach this laptop.**

| Change | Apply finished | First answer in the new state | Last answer in the old one |
| --- | --- | --- | --- |
| B: the route to the co-pilot service | 20:41:03 | 20:43:55, 2 min 52 s later | 20:46:17, 5 min 14 s later |
| Fault on (every request aborted) | 20:59:24 | 21:02:39, 3 min 15 s later | 21:03:09 |
| Fault changed to half and half | 21:06:52 | 21:09:13 (the first held request), 2 min 21 s later | not looked for |
| Fault off | 21:12:54 | not looked for | 21:15:26, 2 min 32 s later |

**(c), the co-pilot answered `503` by the load balancer for every request.** Fault injection is accepted and
works with a Cloud Run backend on this load balancer, which Google's pages did not say in so many words.

- The smoke test: every line `ok` except the five that expect the co-pilot's own refusals and got `503`.
  (Section 6 says four; "the API refuses other sites" is the fifth.)
- Plans: `All checks passed`.
- A page in 0.08 s, the site list in 0.08 s, the tile list in 0.06 s, the status in 0.09 s, a saved plan
  in 0.25 s, the counts in 0.18 s.
- The services' status said `up` for both, because the web server asks the services directly.
- In a browser, on the Atlas, a question to Scout: "The co-pilot is busy right now. You can ask again in
  15 s.", with the Ask button reading "Wait 13 s" and counting down. The map kept working.

**The half-and-half drill** (half the requests held 8 s, half aborted). Of the last 40 requests to
`/api/chat`, one every 4 s: 12 answered at once (405), 9 were held about 8.2 s and then answered, 8 were
aborted at once, and 11 were held 8.07 s and then aborted. So 20 of 40 were held and 19 of 40 aborted, and
the two are decided independently. During those five minutes 75 of 75 page loads answered 200, the slowest
in 0.11 s, and 75 of 75 opens of a saved plan answered 200, the slowest in 1.5 s. In the load balancer's log
an injected abort is a `503` with the co-pilot's backend named and an empty `statusDetails`; the value
`fault_filter_abort` that section 7 expected does not appear.

**(e), the breaker drill.** It used the typed-question address, `/api/ask`, because this laptop had no
co-pilot questions left for the day; both go through the same breaker.

| Time | What happened |
| --- | --- |
| 21:18:44 | The service's status: "gemini, with 100% of calls failed on purpose (503)" |
| 21:18:44 to 21:18:47 | Five typed questions, each answered `502` after its three tries, in 0.53 to 1.0 s |
| 21:18:48 | The service's log: "Circuit breaker opened (redis): 5 model calls failed within 60 s; questions are told to wait 30 s" |
| 21:18:48 | The sixth question: `{"error":"busy","retryAfterSeconds":30}`, `503`, `Retry-After: 30`, in 0.18 s. The web server's view of the service: breaker `open`. A page answered in 0.08 s and a saved plan in 0.25 s |
| 21:19:36 | The fault switched off. Breaker `half-open` |
| 21:20:08 | The trial question, through the real model: `200` in 5.1 s. Breaker `closed` |
| 21:20:26 | The next question: `200` in 4.5 s |

A co-pilot question sent while the breaker was open got this laptop's own `429` (its day's limit), not the
breaker's `503`: a visitor's limit is checked before the breaker.

**What went wrong, and what was done.**

1. **A deploy rolled a good version back.** The deploy of a docs change (`af946d5`), the first with visitors
   routed to this service, passed every test on the new version's own address and failed the last one
   through the public address with `429`. The five set questions had used the runner's 6 questions a
   minute, and the two closing tests count three more. Fixed in pull request 130: the workflow waits out
   the minute before the closing tests too.
2. **That deploy should not have built anything.** A Terraform apply makes a new revision of each Cloud Run
   service, and records its image by digest, not by tag. The workflows read the live commit from the tag,
   find something that is not a commit, and treat the next merge as a first deploy: every service is
   rebuilt, and the "a tenth of the visitors" step is skipped. Not fixed here; it belongs to the Terraform
   pipeline work (Phase 5.5), which has to make applies stop creating revisions.
3. **A rollback pins the service to a named revision.** After it, a changed setting makes a revision that
   gets no requests. The breaker drill needed `gcloud run services update-traffic clps-copilot --to-latest`
   before its setting took effect.
4. **The breaker's alert email had not arrived 15 minutes after the breaker opened.** The log line matches
   the alert's filter when read by hand. Not explained yet.
5. **Typed questions are not in the day's counts.** `/api/ask` publishes no question event, so the drill's
   five failures and one refusal do not show on How it works. Section 7 said they would; that is true only
   for co-pilot questions.

**What section 9 said had only been tested, now.**

| Item | Now |
| --- | --- |
| The path rule and the fault policy | Applied and seen, times above |
| Streaming through the second backend | Seen |
| The breaker on Memorystore | Seen: opened, refused, half-open, closed |
| Service-to-service tokens | Seen |
| The new identity's grants | The model, the topic and traces are in use. **The bucket condition on `tiles/light/` is still unseen**: no tapped-spot question was asked of the live service (the full `chat-eval.mjs` needs more questions than this laptop had left) |
| The deploy workflow | Ran three times: passed on the first-deploy path, failed once on its own bug (item 1), fixed |
| A start from nothing | **Not measured** (kept warm for the event) |
| The objectives and the two alerts | Exist. The breaker's alert did not email (item 4) |
| The page's countdown | Seen in a browser against the live site, for a `503` with no `Retry-After` (the page's default of 15 s). **Not seen** for the breaker's own `Retry-After: 30` |
| Real model calls through the new retry code | The deploys' set questions and the two questions after the drill |
| Concurrency, timeout, the objectives' numbers | Starting values, as before |

**Left on the live project.** In `infra/terraform.tfvars` (not in the repository): `copilot_service = true`,
`copilot_route = "copilot"` and `copilot_min_instances = 1`, the last to be set back to 0 after 2026-11-15.
No fault setting is left on: the last plan of the evening shows none. The laptop's address cannot ask the
co-pilot again until about 16:40 UTC on 2026-11-13, when the first of its 60 questions is a day old.
