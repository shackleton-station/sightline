# Architecture, Phase 8: a second region, and a failover drill

For whoever merges this phase and for Rodrigo. Why each choice was made, and what it gives up, is in
[`decisions/0010-second-region.md`](decisions/0010-second-region.md). This file is the price first, then what
was built, the pull requests in order with what each plan comment should show, every grant, the deploys, the
drill as commands with what a pass looks like, the way back, what a loss of us-east4 would still break, and
what has only been tested.

**State on 2026-11-13, 04:20 UTC:** switched on, drilled and switched off again through the Terraform
pipeline between 01:25 and 03:47 UTC. Only the empty us-central1 subnet is left, for step 7 (Google asks for
1 to 2 hours after Cloud Run stops using a subnet). What each step showed, the drill's numbers, an outage the
drill caused and the lessons are in [section 11](#11-results-2026-11-13).

**When:** all of it on Friday 2026-11-13, and switched off again the same day unless Rodrigo says to keep it.
From kickoff on Saturday 2026-11-14 nothing on `shackletonstation.dev`'s routing changes without asking the
captain. Step 1 can stay (it only adds a field to three status answers). If the day runs short, stop after
any step and go straight to step 6, which switches off whatever is on.

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
R2=us-central1
SITE=https://shackletonstation.dev
```

---

## 1. The price, first

Only prices the repository records are used (`docs/ARCHITECTURE_BASELINE.md` 1.5, `REFERENCES.md`). They were
read for **us-east4**. Google's price for **us-central1 is not recorded** here; the lines below use
us-east4's as the stand-in and say so. Where no price is recorded at all the line says **price not
recorded** and gives the formula.

### What the Terraform makes, and what each costs

| What step 2 and 3 make | Price | Per hour while on |
| --- | --- | --- |
| 3 Cloud Run copies (web, plans, co-pilot), 1 CPU and 512 MiB each, CPU only while answering (`cpu_idle`), **1 warm copy each** (the same `min_instances` as their twins, from `settings.auto.tfvars`) | $0.0000025 per CPU-second and per GiB-second while idle (us-east4) | 3 × (1 + 0.5) × $0.0000025 × 3,600 = **$0.0405** (us-central1's price not recorded; this is us-east4's) |
| The same 3 copies at `second_region_min_instances = 0` | | **$0** while idle; each region's first request after a quiet spell waits for a copy to start (the slowest start measured for the web image: 6.44 s, baseline 1.4) |
| 3 serverless endpoint groups | **price not recorded** | |
| The web server's twin subnet, `10.20.1.0/24` | **price not recorded** | |
| Outlier detection on 3 backend services | **price not recorded** | |
| Forwarding rules, the edge firewall policy, its rules | $0.025 an hour for the first five rules; $5 a month a policy and $1 a rule (baseline 1.5) | **$0**: none is added. The copies sit behind the same two forwarding rules and the same policy |

**Idle: about $0.04 an hour, about $0.97 for a 24-hour window**, at us-east4's price, plus the lines with no
recorded price. At `second_region_min_instances = 0` the priced idle cost is $0.

### Per request

A request the load balancer sends to us-central1 is one fewer for us-east4: the Cloud Run price per request
($0.40 per million, `REFERENCES.md`) and per busy second ($0.000024 per CPU-second, $0.0000025 per GiB-second,
`SYSTEM_DESIGN.md` A10: an upper bound of 0.106 s a request, $0.0000027) **move, they are not added**, as long
as us-central1's price equals us-east4's (not recorded). The edge firewall and CDN per-request prices
($0.75 per million each) do not depend on the region.

What is added per request served in us-central1:

| What | Formula | Price |
| --- | --- | --- |
| Bytes between us-central1 and us-east4: every Redis command and answer, every Firestore read and write, the co-pilot's reads of the light grid from the bucket | bytes per request × price per GiB between the two regions | **price not recorded**. Bytes per request not measured; Redis commands and plan documents are small (a plan is at most a few KB) |
| Cloud Logging: the copies log as their twins do, so the count moves; each copy adds its start-up lines | log volume × price per GiB | **price not recorded** |

### Per deploy

| What | Formula | Price |
| --- | --- | --- |
| The image copied from the registry in us-east4 to Cloud Run in us-central1, once per deploy of each service | image size × price per GiB between regions | **price not recorded**. The web image was 124.3 MB compressed on 2026-11-12 (baseline 1.6); the plans and co-pilot images' sizes are not recorded |

### What the drill costs

The drill makes 3 new versions of the services in the region it switches off, and 3 more to switch back, each
with the image it already runs: no build, no new image. Their warm copies replace the old ones'. The drill's
503s do no work. During the drill, us-east4's visitors are served from us-central1: the cross-region bytes
above, for those minutes.

---

## 2. What was built

| Piece | Where |
| --- | --- |
| A copy of web, plans and co-pilot in `second_region`, whose image, identity, timeout, limits and every environment setting are read from the twin in us-east4 (`for_each` over the three), with four settings of its own: `REGION`, the drill's `DRILL_UNAVAILABLE`, and the web copy's two status addresses, which name the plans and co-pilot copies in its own region | `infra/second-region.tf` |
| The web server's twin subnet in us-central1, `clps-web-egress-us-central1`, `10.20.1.0/24`, with Private Google Access, for its Direct VPC egress; plans and the co-pilot use the default network's own `default` subnet in us-central1, as their twins do in us-east4 | `infra/second-region.tf` |
| `allUsers` may call each copy, as for each twin; ingress copied from the twin ("internal and Cloud Load Balancing") | `infra/second-region.tf` |
| A serverless endpoint group per copy, which becomes a **second backend** of the service's existing backend service, and **outlier detection** on those three backend services | `infra/second-region.tf`, `infra/domain.tf`, `infra/plans.tf`, `infra/copilot.tf` |
| `REGION` on the three services in us-east4, and the drill's setting on them | `infra/main.tf`, `infra/plans.tf`, `infra/copilot.tf` |
| Six settings, all off or empty by default: `second_region`, `second_region_copies`, `second_region_serve`, `second_region_min_instances`, `second_region_egress_range`, and the drill's `region_drill` | `infra/variables.tf`, `infra/settings.auto.tfvars` (commented) |
| `region` in the status answers of web, plans and co-pilot (additive; `API.md` and the contract tests updated), and the drill: with `DRILL_UNAVAILABLE=on` every request to that copy is answered `503` with `Retry-After: 5`, before any store, limit or model is touched | `web/shared/region.ts` (and `.test.ts`), `web/server/app.ts`, `web/plans/app.ts`, `web/copilot/app.ts` |
| A watch that asks the three status addresses every second through the public address and prints which region answered, every switch, and how long after the first failure another region answered | `web/scripts/region-watch.mjs`, `web/scripts/region-timeline.mjs` (and `.test.mjs`) |
| The deploys roll the same image to the copy after everyone in us-east4 is on it, and put both regions back on any failure | `web/scripts/second-region.sh`, `.github/workflows/deploy.yml`, `deploy-plans.yml`, `deploy-copilot.yml` |

The events worker, Redis, both Firestore databases, the Pub/Sub topic, the BigQuery log, the assets bucket
and the image registry stay in us-east4 (section 3, section 9).

### How the load balancer chooses a region

Google's page on serverless network endpoint groups (`REFERENCES.md`): a global external Application Load
Balancer's backend service "can have several serverless NEGs attached to it, but only one serverless NEG" per
region, and "the load balancer sends traffic to the NEG in the closest region to minimize request latency".
All of them must "represent functionally equivalent deployments in different regions". The Premium network
tier "is required only if you want to set up serverless NEGs in multiple regions": the load balancer's
forwarding rules have no `network_tier` set, and Premium is the default. A serverless endpoint group has no
balancing mode or capacity ("You can't specify a balancing mode").

"Closest" is measured from the Google front end that took the visitor's request, not from a map. From the Mac
on 2026-11-13 the two regions were within a few milliseconds of each other (section 3), so which one the Mac
reaches cannot be told in advance. **Run the watch first: the region that answers is the one to drill.**

### What "healthy" means here

Serverless backends have no health checks ("Health checks are not supported for serverless backends"), and
without something else "even if your resource is returning errors, the load balancer continues to direct
traffic to it". What is used here is **outlier detection** on each of the three backend services: the load
balancer judges each endpoint group by its answers.

| Setting | Value | Where it comes from |
| --- | --- | --- |
| What counts as a failure | 502, 503, 504, or no answer ("gateway failures") | `consecutiveGatewayFailure`, the API reference |
| How many in a row | 3 | The API's default, written out |
| Chance of acting on it | 100% | The API's default for gateway failures |
| Any other 5xx | Not counted (`enforcingConsecutiveErrors` 0, the API's default) | A 500 is a bug in code both regions run |
| Analysis every | 1 s | Google's example for serverless NEGs |
| Set aside for | 30 s the first time, longer each time after | Google's example; the page recommends higher values (180 s kept errors under 5% above 100 requests a second) |
| At most set aside | 50% of the backend service's endpoint groups: with two, one | Google's example and the API's default. The load balancer never sets both regions aside |

Each proxy of the load balancer decides on its own ("executed independently by each proxy instance"), so every
proxy that carries a visitor's requests has to see its own three failures, and "you'll likely see some
requests being sent to the unhealthy resource and thus returning 5XX errors". Success-rate detection is not
supported for serverless NEGs, and outlier detection is not available on the classic Application Load
Balancer (this one is the global external one, `EXTERNAL_MANAGED`).

Cloud Run's own **service health** (a region is healthy while "60% or more of its instances pass their
readiness probes") would set a region aside before visitors see errors. It was not used: decision 0010 says why.

---

## 3. Data in one region: what each path pays

A copy in us-central1 reaches Redis, Firestore, Pub/Sub and the bucket in us-east4. Google lists us-east4 in
Ashburn, Virginia and us-central1 in Council Bluffs, Iowa: 1,578 km apart on the great circle. Light in fiber
covers about 204,000 km a second (the speed of light over a refractive index of about 1.47), so **every round
trip from a copy to us-east4 takes at least 15.5 ms**, and real paths are longer than the great circle. **Not
measured here**: nothing ran in us-central1. Step 3's checks measure it (section 4).

What was measured, from the Mac on 2026-11-13, to Google's public latency-test services in each region (gcping,
`REFERENCES.md`), time from the request to the first byte of the answer on a fresh connection:

| Run | us-east4 | us-central1 |
| --- | --- | --- |
| 15 requests each, 00:57 UTC | median 35.8 ms (min 31.9) | median 43.7 ms (min 34.3) |
| 30 requests each, 01:02 UTC | median 37.0 ms (min 32.1, 90th percentile 52.0) | median 38.1 ms (min 31.9, 90th percentile 46.7) |

That is the Mac to each region through Google's network, not one region to the other. It says that from this
Mac the two are close, and that the load balancer could send the Mac to either.

| Path | Calls across regions per request | What the copy in us-central1 pays |
| --- | --- | --- |
| Pages, site data, hashed assets (web) | None: they are in the image | Nothing |
| Tiles and video | None from the copy: they come from the backend bucket through the CDN, not from a service (Phase 6) | Nothing new. A CDN miss reads the bucket in us-east4 whichever region the visitor is near, as today |
| `/api/status` (web) | One Redis check | At least 15.5 ms |
| `/api/stats` (web) | Firestore reads of the day's shards | At least 15.5 ms per sequential round trip |
| `/api/speak` (web) | Redis for its limits and the kept audio; Text-to-Speech is a global API | At least 15.5 ms per Redis call |
| Follow the presenter (web) | Redis for every room event, and publish/subscribe between copies | At least 15.5 ms per event. One Redis for both regions is what keeps a presenter in one region and a follower in the other in the same room |
| Plans: open, save, list | Redis for the limits; Firestore for the plan (a save is one to three calls) | At least 15.5 ms per call, each in turn. Against an objective of 95% within 1 s |
| Co-pilot | Redis for the limits, the breaker, kept answers, the single-flight lock and the outbox; Pub/Sub publish; the light grid from the bucket; Vertex AI is called at `global` | At least 15.5 ms per Redis call, against a question that takes seconds (median 4.2 s at the load balancer, baseline 1.2) |

The number of Redis and Firestore calls per request is not counted here: the cost is that number times at
least 15.5 ms. For plans, a few calls cost tens of milliseconds against a one-second objective. For the
co-pilot it is lost in the model's seconds. For pages it is nothing. The visitor's own trip is shorter for a
visitor near Iowa, which is the point of the region.

---

## 4. The pull requests, in order

Expand, move, contract, as in every phase. Each pull request is its own branch, based on the one before:
open them in order, and merge each only after the one before has applied and its checks passed. **Do not
merge anything that deploys while a step is half done, or during the drill** (section 7).

Every count below was planned **from today's live state**, so a later step's plan was made with the earlier
steps' settings too. What the pull request's own comment will show, once the step before is applied, is the
difference, which is what is written here. The destroy guard passed each plan in strict mode ("The plan
deletes nothing").

### Step 1. The code, the Terraform, `REGION` on the three services

Branch `arch/phase-8-second-region-1`. All the code and Terraform, with every switch off, the commented lines
in `settings.auto.tfvars`, and these docs.

**The plan comment should say `0 to add, 3 to change, 0 to destroy`:** `google_cloud_run_v2_service.web`,
`.plans[0]` and `.copilot[0]`, each with one environment setting added, `REGION = "us-east4"`, and nothing
else. Each starts one new version with the live image, outside the stepped rollout, as any change of a setting
does. No access changes.

The merge also starts the three deploys (their workflow files changed, and web always deploys). They wait for
the apply, roll out as before, and find no copy in us-central1: the step "Roll the same version out in the
second region" prints `No copy of <service> in us-central1: the second region is off`.

**After the merge:**

```sh
for p in /api/status /api/plans/status /api/chat/status; do echo "$p $(curl -s $SITE$p | jq -c '{region, revision}')"; done
node web/scripts/region-watch.mjs $SITE --seconds 10
```

**Pass:** each says `"region":"us-east4"` with the new revision; the watch says `answered by: us-east4 10`
for all three.

### Step 2. Expand: the copies, with no visitors

Branch `arch/phase-8-second-region-2`. Two lines in `settings.auto.tfvars`: `second_region = "us-central1"`
and `second_region_copies = true`.

**The plan comment should say `10 to add, 0 to change, 0 to destroy`:**

- `google_compute_subnetwork.second_region_web_egress[0]`: `clps-web-egress-us-central1`, `10.20.1.0/24` in the
  default network, us-central1, `private_ip_google_access = true`.
- `google_cloud_run_v2_service.second_region["web"]`, `["plans"]`, `["copilot"]`: named as their twins
  (`clps-web`, `clps-plans`, `clps-copilot`) in us-central1; ingress `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`;
  the twin's image (on 2026-11-13: `clps-web:bf9f414`, `plans:5c2c337`, `copilot:5c2c337`) and `commit` label;
  the twin's identity, timeout (60, 30, 40 s), concurrency (80, 80, 10), copies (1 to 3), CPU and memory; every
  environment setting of the twin, Redis's addresses included, with `REGION = "us-central1"`. Web: all traffic
  through `clps-web-egress-us-central1`, and `PLANS_STATUS_URL` and `COPILOT_STATUS_URL` set to
  `https://clps-plans-919194174067.us-central1.run.app` and `https://clps-copilot-919194174067.us-central1.run.app`.
  Plans and co-pilot: private ranges only, through `default`.
- `google_cloud_run_v2_service_iam_member.second_region_public["web"]`, `["plans"]`, `["copilot"]`:
  `roles/run.invoker` for `allUsers`, under "Access this plan changes". Grants 1 to 3 in section 5.
- `google_compute_region_network_endpoint_group.second_region["web"]`, `["plans"]`, `["copilot"]`:
  `clps-web-us-central1-neg` and so on, serverless, naming each copy. No backend uses them yet.

Nothing a visitor reaches changes. The copies start one warm copy each, which connects to Redis.

**Do not merge it while a deploy is running.** The copies take the image the twin's settings name at that
moment, which during a deploy is the version under test.

**After the merge:**

```sh
for s in clps-web clps-plans clps-copilot; do
  gcloud run services describe $s --project $P --region $R2 --format 'value(metadata.name,status.latestReadyRevisionName,spec.template.spec.containers[0].image)'
done
gcloud logging read "resource.type=\"cloud_run_revision\" AND resource.labels.location=\"$R2\" AND (textPayload:\"Redis\" OR jsonPayload.message:\"Redis\")" \
  --project $P --freshness 15m --limit 20 --format 'value(timestamp,resource.labels.service_name,jsonPayload.message,textPayload)'
```

**Pass:** each copy has a ready revision with its twin's image; each service logged `Redis connected` from
us-central1 (the web server and the co-pilot also `Redis read endpoint connected`). That is the first proof
that Redis's peering carries the new region's ranges and that Memorystore accepts a client in another region:
Google's pages do not say so plainly (section 10). If a copy logs `Redis connection:` errors instead, stop
here: it would serve with limits in its own memory and rooms switched off. Take the two lines out again.

### Step 3. Move: the load balancer sends each visitor to the nearest region

Branch `arch/phase-8-second-region-3`. One line: `second_region_serve = true`.

**The plan comment should say `0 to add, 3 to change, 0 to destroy`:** `google_compute_backend_service.web[0]`,
`.plans[0]` and `.copilot[0]`, each with:

- a second `backend` block, `group` the us-central1 endpoint group;
- an `outlier_detection` block: `consecutive_gateway_failure = 3`, `enforcing_consecutive_gateway_failure = 100`,
  `consecutive_errors = 5`, `enforcing_consecutive_errors = 0`, `interval` 1 s, `base_ejection_time` 30 s,
  `max_ejection_percent = 50`.

Planned from today's state, the plan also shows the us-east4 backend as removed and added again, because the
new group is not known before step 2 is applied. Once it is, the comment should show only the added block. In
either case the backend service is updated in one call with both backends: us-east4's is never taken off.

Visitors nearer us-central1 go there from now on. The canary rules, the plans and co-pilot route rules and the
fault drill are unchanged: the canary backends have one endpoint group, in us-east4.

**After the merge:**

```sh
gcloud compute backend-services describe clps-web-backend --global --project $P --format json | jq '{backends: [.backends[].group | split("/") | .[-3] + "/" + .[-1]], outlierDetection}'
node web/scripts/region-watch.mjs $SITE --seconds 120
```

**Pass:** two backends (us-east4 and us-central1) and the outlier detection settings, for each of the three
backend services (`clps-plans-backend`, `clps-copilot-backend` too). The watch answers 200 throughout, from
one region, with no failure; write down which region and the median times. The added latency of the copies'
calls to us-east4 (section 3) is measured from Cloud Run's own numbers once us-central1 has had traffic:

```sh
# Cloud Monitoring, Metrics explorer: run.googleapis.com/request_latencies, service clps-plans, grouped by
# resource.labels.location, 50th and 95th percentile. Write down both regions, with the number of requests.
```

### Step 4. The drill: switch one region off

Branch `arch/phase-8-second-region-4`. One line: `region_drill = "us-east4"`, or whichever region the watch in
step 3 showed the Mac reaching. Section 7 has the drill in full; start the watch before the merge.

**The plan comment should say `0 to add, 3 to change, 0 to destroy`:** the three services in that region, each
with one environment setting added, `DRILL_UNAVAILABLE = "on"`. For `us-east4` that is
`google_cloud_run_v2_service.web`, `.plans[0]`, `.copilot[0]`; for `us-central1`,
`google_cloud_run_v2_service.second_region["web"]` and the others. Planned both ways: each touched only its
own region.

The variable refuses a drill unless the second region serves visitors too
(`region_drill must be empty, or region or second_region while second_region_copies and second_region_serve
are true`), so a drill can never switch the only region off. Planned with `region_drill = "us-east4"` alone:
refused.

### Step 5. The drill ends: switch it back on

Branch `arch/phase-8-second-region-5`. The `region_drill` line commented out again.

**The plan comment should say `0 to add, 3 to change, 0 to destroy`:** the same three services, each with
`DRILL_UNAVAILABLE` removed. Section 7 says what to watch.

### Step 6. Contract: switch everything off

Branch `arch/phase-8-second-region-6`. `second_region_copies` and `second_region_serve` commented out again
(and `region_drill`, if step 5 was skipped). Section 8.

### Step 7. The subnet, at least two hours after step 6

Branch `arch/phase-8-second-region-7`. `second_region` commented out again. Section 8.

---

## 5. Every grant

Three are added in step 2 and removed in step 6. None other.

| # | Step | Who | Role | On what | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 | `allUsers` | `roles/run.invoker` | The service `clps-web` in us-central1 | As for its twin: the load balancer sends visitors' requests with no identity of their own, so Cloud Run must let anyone call the service. Ingress ("internal and Cloud Load Balancing", copied from the twin) still refuses a request from the internet on the copy's own `run.app` address |
| 2 | 2 | `allUsers` | `roles/run.invoker` | `clps-plans` in us-central1 | The same |
| 3 | 2 | `allUsers` | `roles/run.invoker` | `clps-copilot` in us-central1 | The same |

Things that are not grants, said plainly:

- **The copies run as the twins' identities** (`clps-web@`, `clps-plans@`, `clps-copilot@`). Every grant those
  identities have is project-wide or on a resource (a database, the topic, the bucket), not on a region, so
  the copies can do exactly what the twins can, and nothing more.
- **The deployer needs nothing new.** `roles/run.developer` is on the project, so it covers us-central1, and it
  may already hand each service its identity.
- **The applier needs nothing new.** `roles/run.admin`, `roles/compute.loadBalancerAdmin` and
  `roles/compute.networkAdmin` (Phase 6) cover every resource here.
- **The planner needs nothing new.** It reads Cloud Run services with its custom role and the network,
  endpoint groups and backend services with `roles/compute.viewer`.
- **Cloud Run's own service agent** pulls the images from the registry in us-east4 and uses the subnet in
  us-central1 with the roles it already has in the same project.

---

## 6. The deploys

Each deploy keeps its us-east4 rollout exactly as it was: the new version with no visitors and the `canary`
tag, tests through the load balancer with `x-clps-canary`, a tenth, a watch of both versions, everyone. Then a
new step, **"Roll the same version out in the second region"** (`web/scripts/second-region.sh follow`):

1. If there is no copy of the service in us-central1, say so and stop. With the second region off, nothing
   else changes.
2. Note the copy's live version (`LIVE2`).
3. `gcloud run deploy <service> --region us-central1 --image <the image just rolled out> --update-labels commit=<commit>`.
   It returns once the new version has started and passed Cloud Run's start-up check; a version that does not
   start never gets a request.
4. Check that the newest version is this run's, by its `commit` label.
5. `update-traffic --to-latest`, in case an earlier way back had pinned the split.

It runs **after everyone in us-east4 is on the new version and before the tests as a visitor**, because those
tests may be answered by either region and check the commit. If any step fails, the way back puts the copy on
`LIVE2` and us-east4 on `LIVE` (`second-region.sh back`, then the existing command).

**Why one step, and not a canary and a tenth in us-central1 too.** The image has just passed both in us-east4.
What differs in us-central1 is only the network path to Redis and Firestore. There is no way to send a test
request to one region through the load balancer without new backend services and rules for it, and the
copies refuse the internet on their own addresses. For a window of a day, outlier detection is the safety net:
a copy that answers 503 because it cannot reach something is set aside. What is not tested before visitors
reach a new version in us-central1: its calls to Redis and Firestore. Kept for longer, the second region
would get its own canary rule and a region header.

The events worker's deploy is unchanged: it has no copy.

---

## 7. The drill

### What it does

`region_drill = "<region>"` sets `DRILL_UNAVAILABLE=on` on that region's three services. Each starts a new
version with the same image, and from then on answers every request with `503`, `Retry-After: 5` and
`{"drill":"unavailable","region":"<region>"}` (`web/shared/region.ts`), its status address included. 503 is a
gateway failure, which outlier detection counts.

Other ways were weighed:

| Way | Why not |
| --- | --- |
| The load balancer's fault injection (`copilot_fault_*`) | It acts before the load balancer picks a backend, on every region at once, and its 503 is not a backend's answer, so outlier detection would not see it. Not documented either way; Envoy's design suggests it would not |
| Remove the region's endpoint group from the backend service | Google's manual failover (`gcloud compute backend-services remove-backend`). Instant and certain, but it tests nothing about detection |
| Close the region's ingress | Cloud Run then answers 404 (Phase 6's check (a)), which is not a gateway failure, so outlier detection would not act and visitors would get 404s |
| Scale it to zero | Cloud Run cannot be capped at zero copies; with no copy it starts one |

### Before

```sh
# The watch, in its own terminal, for the whole drill. It prints a line a second and a summary on Ctrl-C.
node web/scripts/region-watch.mjs $SITE | tee /tmp/region-drill.log
```

Note which region answers (call it NEAR) and the median times. Drill NEAR. Write down the time.

Expect alert emails: the uptime check and the availability objectives of the services in NEAR count the
drill's 503s.

### Switch NEAR off

Merge step 4 (`region_drill = "<NEAR>"`). The Terraform run takes a minute or two (the apply that switched the
Phase 6 drill off took 1 min 21 s), then each service starts its drill version.

**What should happen, and how long it should take:**

| When | What the watch shows |
| --- | --- |
| The drill version takes over in NEAR (a minute or two after the merge) | `503 <NEAR> (drill)` for the services whose drill version is live |
| Each proxy's third 503 in a row, plus at most one analysis (1 s) | That proxy sets NEAR aside: answers from the other region. For one request a second through one proxy, about 3 to 4 s after the first 503 |
| 30 s later, per proxy | NEAR back in the pool for that proxy: three more 503s, then aside for longer |
| Until the drill ends | Mostly the other region, with bursts of 503s as each proxy tries NEAR again, fewer as ejections lengthen |

A visitor's requests can pass more than one proxy, and each has to see its own three failures, so the first
failover from the Mac can take several rounds. The summary line `answered from another region N s after the
first failure` is the number to write down.

**Pass:**

- Within 2 minutes of the first `(drill)` 503, every service answers 200 from the other region in most rounds.
- `curl -s $SITE/api/status/services | jq '{services: (.services | map_values({state, checkedAs}))}'` answers from
  the other region's web copy: both services `"up"`, `checkedAs: "web"`. With NEAR = us-east4 this is the first
  proof that the us-central1 copies reach each other inside the network.
- `curl -s $SITE/api/plans/status | jq '{region, limits, redis: .redis.state}'` says the other region, and
  `redis` (Redis across regions).
- A plan opens, and one co-pilot question is answered, in a browser. Their times are what a visitor near NEAR
  pays during a failover: write them down beside step 3's.
- The pages answer, between the 503 bursts.

**Fail, and end the drill at once:** after 2 minutes the 503s are as frequent as at the start. Outlier
detection is not acting.

**What visitors near NEAR see:** a few failures at the start and in short bursts after. A page request
answered by the drill gets the JSON error, not the page; the page's own API calls show their error states
(the co-pilot says it is busy and when to ask again, from `Retry-After`). Then the site works, a little slower
(section 3).

### Switch NEAR back on

Merge step 5. Each service starts a version without the drill (a minute or two). Each proxy brings NEAR back
when its current ejection ends: up to that ejection's length after NEAR stops failing, longer the longer the
drill ran.

**Pass:** the watch shows NEAR answering 200 again for all three services, and no failures after the drill
versions are gone. The summary shows the switch back (`<other> -> <NEAR> at ...`). Ctrl-C the watch and keep
its summary.

### Faster, if it goes wrong

The versions from before the drill are still there. For each service in NEAR:

```sh
gcloud run revisions list --service clps-web --project $P --region <NEAR> --limit 3
gcloud run services update-traffic clps-web --project $P --region <NEAR> --to-revisions <the version before the drill>=100
```

Seconds. Then merge step 5, and once its versions are ready, `--to-latest` for each service: the pinned split
would otherwise keep visitors on the old version (`docs/DEPLOY.md`, "A service pinned to an older version").
From the Mac, the emergency path also works (`docs/DEPLOY.md`, "Applying from the Mac"):
`terraform plan -out=drill.tfplan -var region_drill=` with the other Phase 8 lines as they are, read it, apply it.

### Write down

The time of the merge, of the first `(drill)` 503, of the first answer from the other region, of the merge of
step 5, and of NEAR answering again; how many failures each service had; the times from the browser. Add them
to this section as "The drill, 2026-11-13".

---

## 8. Switching off

### Step 6: everything that runs, in one pull request

Comment out `second_region_copies` and `second_region_serve` (and `region_drill` if it is still on).

**The plan comment should say `0 to add, 3 to change, 9 to destroy`:**

- `google_compute_backend_service.web[0]`, `.plans[0]`, `.copilot[0]`: the us-central1 backend and the
  outlier detection removed. Updated before anything is destroyed, because the endpoint groups they use are
  destroyed after them.
- Destroyed: the three endpoint groups, the three `allUsers` grants (under "Access this plan changes"), the
  three copies.

**The destroy guard:** `The plan deletes or replaces 9 resource(s), none of them on the protected list.` Run
on a plan of these changes, 2026-11-13. `infra/expected-removals.txt` stays empty: nothing here is protected.

The plan was not run from today's state, because today nothing exists to remove. What it removes is exactly
what steps 2 and 3 added, minus the subnet.

**After the merge:**

```sh
gcloud run services list --project $P --region $R2
gcloud compute backend-services describe clps-web-backend --global --project $P --format 'value(backends[].group)'
node web/scripts/region-watch.mjs $SITE --seconds 30
```

**Pass:** no service in us-central1; one backend per backend service; the watch answers 200 from us-east4.

### Step 7: the subnet, at least two hours later

Comment out `second_region`. **The plan comment should say `0 to add, 0 to change, 1 to destroy`:**
`google_compute_subnetwork.second_region_web_egress[0]`. The guard: `The plan deletes or replaces 1
resource(s), none of them on the protected list.`

Why not in step 6: Cloud Run keeps the addresses it took in a subnet for a while after a service is deleted,
and Google's page on Direct VPC egress says to "wait 1-2 hours for Cloud Run to release the IP addresses before
you delete the subnet". In the same apply the deletion would fail, the run would be red, and the deploys,
which wait for Terraform and stop when its last run failed, would stop too. The subnet costs nothing priced
here, and nothing uses it.

With all four lines commented out, a plan shows what it shows on `main` before this phase, except `REGION` on
the three services in us-east4, which step 1 added and which stays.

---

## 9. If us-east4 itself fails

The second region keeps serving what needs only its own copies and global services. It does not survive a
loss of us-east4 for anything that needs the data kept there. Said plainly:

| Feature | Needs | In a loss of us-east4 |
| --- | --- | --- |
| The pages, the site data, the Atlas, the timeline, the 3D view's code | The image | **Works**, from us-central1 |
| Terrain tiles and video | The bucket in us-east4, through the CDN | **Works for what the CDN has kept** (tiles a day, video an hour; 90.7% of tile requests were cache hits in the baseline). A miss fails |
| Co-pilot answers | Vertex AI (`global`), Redis | **Answers**, with limits, the breaker and kept answers in each copy's own memory, as the code does without Redis. The tool that reads the light grid from the bucket fails. Question events: Pub/Sub is a global service, but the worker that counts them is in us-east4 |
| Typed questions | Vertex AI, Redis | **Answer**, limits in memory |
| Scout's voice | Text-to-Speech (global), Redis | **Works**, with limits in memory and no kept audio |
| Shared plans: save, open, list | Firestore `plans` in us-east4 | **Fail** |
| Today's counts on How it works | Firestore `stats` in us-east4 | **Fail** |
| Follow the presenter | Redis | **Fails**: rooms have no memory fallback (they answer 503 without Redis) |
| Sign-in | Google's keys (global) | **Works**; "my plans" fails with plans |
| Deploys | The registry in us-east4, and the deploys roll us-east4 first | **Fail** |
| Terraform | Its state bucket's location is not recorded here | Not known |

And a subtlety: when Redis cannot be reached, rooms answer 503, which is a gateway failure. If Redis alone
failed, both regions' web copies would answer rooms with 503, and outlier detection could set one region's web
copy aside for it (never both: at most 50%). That would move visitors for nothing. Rooms are a small share of
requests, and each ejection lasts 30 s.

---

## 10. What has only been tested, not run for real

- **Every plan.** All read-only from today's state: step 1 (`0 / 3 / 0`), step 2 (`10 / 3 / 0` from today, that
  is `10 / 0 / 0` after step 1), step 3, the drill in each region, the state after step 6 with the subnet
  kept, and a drill without the second region (refused by the variable's check). The destroy guard passed
  each in strict mode. A plan does not ask Google; the apply does.
- **That Memorystore accepts a client in another region.** Its pages say a client must use the instance's
  authorized network, which the copies do, and do not say the region must match; the troubleshooting page
  mentions a client "in a different region or VPC network" timing out, under a heading about networks. The
  network is one (VPC networks are global, and the peering carries every subnet's routes, which Phase 6's
  subnet showed in us-east4). Step 2's check is the test. If it fails, the copies run with limits in memory,
  rooms off and no shared cache.
- **That the web copy's status calls to the copies count as internal.** Taken from Cloud Run's private
  networking page, as for its twin (Phase 6). The drill's `/api/status/services` check is the test.
- **The copies' settings, read from the twins.** The plan shows every setting; that each copy works with
  them is step 2's check. A setting read from Secret Manager is copied as a reference (written for the
  co-pilot's Anthropic key, pull request 147, not merged): not planned with one.
- **Outlier detection's behaviour.** From Google's pages and the API reference. How quickly each proxy acts,
  how many proxies a visitor's requests pass, and how long ejections grow are what the drill measures.
- **That the load balancer's fault injection is not counted by outlier detection.** Not documented. Do not
  run both drills at once.
- **The deploy steps.** `second-region.sh` was run read-only with the second region off (`follow` and `back`
  both say there is nothing to do and exit 0) and passes `bash -n`; the workflows parse as YAML, and the new
  step sits after "Send it everyone" in each. The `follow` path with a copy has never run: its first run is
  the first deploy after step 2.
- **The watch.** Run against the live site for 6 s on 2026-11-13 (every answer `unknown`, before step 1 adds
  `region`); its summary logic has tests.
- **The cross-region latency.** Estimated from distance, not measured (section 3).
- **What the visitor saw.** Predicted in section 7, not seen.

---

## 11. Results, 2026-11-13

Run by Claude Code from 01:15 to 04:20 UTC. Times are UTC.

| Step | Pull request | Plan | What was seen |
| --- | --- | --- | --- |
| 1, each service says its region | 152 | 0 added, 3 changed | Every status answer says `us-east4`. The deploys' new step "roll out in the second region" passed, doing nothing |
| 2, copies in us-central1 | 154 | 10 added (grants: `allUsers` `run.invoker` on the three copies) | Each copy ready on its twin's image. Plans and the co-pilot logged `Redis connected` to us-east4's Memorystore on the first try; the web copy's first try timed out after 3 s and it connected 3 s later. So direct peering does accept a client in another region. The co-pilot copy signed in to Claude by federation |
| 3, both regions behind the load balancer | 155 | 0 added, 3 changed (second backends, outlier detection) | No visible change: 114 probes over 9 minutes, all from us-east4 (the nearer region from the Mac), every page and plan 200 |
| 4, the drill (us-east4's copies answer 503) | 156 | 0 added, 3 changed | Below |
| 5, the drill off | 157 | 0 added, 3 changed | Below: the web server stayed on its drilled revision |
| 6, the second region off | 158 | **Failed:** 3 changed, 9 destroyed planned | Below |
| 6a, the load balancer lets go of the copies | Mac, then 159 | 3 added, 3 changed, 0 destroyed | Backends us-east4 only again; the pull request's own plan said "No changes" |
| 6b, the copies removed | 160 | 0 added, 0 changed, 9 destroyed | No service left in us-central1; smoke test passed |

**The drill.** `web/scripts/region-watch.mjs` asked the three status addresses once a second for 900 s, from
before the merge:

| Service | First 503 | First answer from us-central1 | Answers from us-east4 / us-central1 | Failed |
| --- | --- | --- | --- | --- |
| web | 71.0 s | 81.0 s (10 s later) | 71 / 503 | 326 (503) |
| plans | 58.0 s | 70.0 s (12 s later) | 58 / 514 | 328 (503) |
| co-pilot | 59.0 s | 69.0 s (10 s later) | 59 / 526 | 315 (503) |

So the failover itself worked within 10 to 12 s of the first failure. But it did not hold: for the rest of
the 14 minutes about a third of requests still reached us-east4 and got its 503. Outlier detection here is
decided by each of the load balancer's proxies on its own, and sets a region aside for only 30 s at first, so
proxy after proxy keeps trying us-east4 again. Google's own example uses a 180 s base ejection time; the 30 s
chosen here (for a quick recovery after the drill) made the leak worse. For a region that is down for real,
the honest summary is: visitors are moved within seconds, and a share of them keep seeing errors until the
region is removed from the backend or comes back.

**An outage the drill caused, about 20 minutes long.** Each merge also runs the web deploy:
1. On the drill's merge, the web deploy noted the drilled revision as live, could not reach its new version
   through the drilled region, failed, and sent every request back to the drilled revision: traffic pinned to it.
2. On the drill-off merge, Terraform made a clean revision, but traffic was pinned, so it got none: the web
   server in us-east4 kept answering 503 after the drill was "off". That deploy failed the same way and pinned
   the drilled revision again. (The probe after step 5 that reported 60 clean rounds was the luck of routing.)
3. The smoke test caught it at 02:10: `/` and the site data answered the drill's 503. Restored at 02:11 by
   sending all traffic to the clean revision (`gcloud run services update-traffic`), then a fresh web deploy
   from `main` put traffic back on "latest" (`clps-web-00106-plp`).

From about 01:49 to 02:11 a visitor routed to us-east4 for pages got 503 some or all of the time. Plans and the
co-pilot were not affected after step 5: their deploys did not run on those merges.

**The removal failed once.** With both switches off in one apply, Terraform deleted the copies' invoker
grants, then tried to delete the endpoint groups before taking them off the backend services, and Google
refused ("already being used"). For about 3 minutes a visitor routed to us-central1 would have got 403. Fixed
with the Mac emergency path (6a), then committed (159), then the copies removed (160). Lesson: when a
backend's list of groups comes from a `for_each` that goes empty, Terraform loses the ordering between the
backend's update and the group's delete; take the routing off in one apply and the resources in the next.

**Lessons, kept.**
- A deploy that rolls back pins traffic, and a pinned service ignores later settings. Any drill that makes a
  service fail must stop that service's deploys, or the drill-off must also send traffic to "latest". Neither
  was built; `docs/DEPLOY.md` says to check for pinned traffic after any failed deploy.
- Check the revision that has the traffic, not the service's template: the template said "no drill" while the
  live revision was the drilled one.
- A clean probe run is not proof; the smoke test of the pages is what found the outage.

**Cost:** the copies ran from 01:27 to 03:47 with one warm copy each: 3 x 2 h 20 min at the recorded rate is
about $0.09. Cross-region traffic: not measured.
