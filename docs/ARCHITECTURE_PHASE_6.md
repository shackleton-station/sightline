# Architecture, Phase 6: closing the side doors

For whoever merges this phase and for Rodrigo. Why each choice was made, and what it gives up, is in
[`decisions/0008-closing-the-side-doors.md`](decisions/0008-closing-the-side-doors.md). This file is what was
built, the five pull requests in order with what each plan comment should show, every grant, the "done when"
checks as commands with what a pass looks like, the ways back, and what has only been tested.

**State on 2026-11-13:** all five steps merged and applied through the Terraform pipeline on the night of
2026-11-12 to 13, each checked on the live site before the next; the "done when" checks pass
([section 8](#8-results-2026-11-13)). The bucket's CDN hit rate against the baseline is left for a day of
traffic.

**When:** all of it on Friday 2026-11-13. From kickoff on Saturday 2026-11-14 nothing on
`shackletonstation.dev`'s routing changes without asking the captain. If the five pull requests cannot all be
merged and checked on Friday, stop after any one of them: each leaves the site working, and each has a
one-line way back (section 4).

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
SITE=https://shackletonstation.dev
```

---

## 1. What was built

A **side door** here is a way into a service that does not pass the load balancer and its edge firewall (Cloud
Armor). Until this phase each Cloud Run service had one: its own `run.app` address, open to the internet. The
deploys depended on it, because each tested its new version on the tag's own `run.app` address.

| Piece | Where |
| --- | --- |
| A second serverless endpoint group per service (web, plans, co-pilot), pointing at the revision tagged `canary`, and a backend for each with the same edge firewall policy and no CDN | `infra/canary.tf` |
| The URL map's path matcher `site` as route rules: the plans and co-pilot paths as before, the fault drill on the co-pilot's rule as before, and a rule per service that sends a request carrying `x-clps-canary: <service>` to that service's canary | `infra/domain.tf` |
| Two backend buckets with Cloud CDN, one for tiles (kept a day) and one for video (kept an hour), reading the private assets bucket; the load balancer's grant to read it, limited to the names the web server serves; two route rules that send those names to them | `infra/assets.tf`, `infra/domain.tf` |
| A subnet of the web server's own with Private Google Access, and the web server sending all of its traffic through it | `infra/network.tf`, `infra/main.tf` |
| Ingress "internal and Cloud Load Balancing" for web, plans and co-pilot, behind one variable | `infra/main.tf`, `infra/plans.tf`, `infra/copilot.tf` |
| Five switches, each defaulting to how things were before this phase: `canary_route` (on), `assets_bucket_access`, `web_egress_through_vpc`, `assets_route`, `service_ingress` | `infra/variables.tf`, `infra/settings.auto.tfvars` |
| The applier may manage networks (for the subnet) | `infra/pipeline.tf` |
| The deploys test each new version through the load balancer with the header, wait until the load balancer reaches it, and watch both versions the same way | `.github/workflows/deploy.yml`, `deploy-plans.yml`, `deploy-copilot.yml` |
| `--canary <service>` on every check script, a script that waits for the canary, and their tests | `web/scripts/canary-header.mjs` (and `.test.mjs`), `wait-for-canary.mjs`, `canary.mjs`, `smoke.mjs`, `plans-check.mjs`, `copilot-check.mjs`, `chat-eval.mjs` |

The events worker keeps its public ingress, with no `allUsers` grant: only a Google-signed token from an
identity allowed to call it gets in. Decision 0008 says why.

### The canary header

```
x-clps-canary: web       any path of the web server's        -> clps-web-canary-backend     -> clps-web, tag canary
x-clps-canary: plans     /api/plans, /api/plans/*            -> clps-plans-canary-backend   -> clps-plans, tag canary
x-clps-canary: copilot   /api/chat, /api/chat/*, /api/ask    -> clps-copilot-canary-backend -> clps-copilot, tag canary
```

It is plain and documented on purpose: the repository holds no secrets, and the header is written in public
workflow files. Anyone who sends it reaches a version that has not been rolled out yet, through the same edge
firewall and the same limits as every other request. That is harmless: the next version serves the same
public site. Between deploys the tag stays on the version the last deploy made, which is normally the live
one. (A version Terraform makes when a setting changes does not get the tag, so for a while the tag can be on
the version before it, with the same image and the older settings.)

A header only moves its own service's paths. With `x-clps-canary: web`, `/api/plans` still reaches the live
plans service, and tiles still come from wherever visitors get them. The plans and co-pilot canaries work
whichever way `plans_route` and `copilot_route` are set, so a deploy can test a service visitors do not
reach.

### The URL map

One path matcher cannot mix path rules and route rules (the URL map reference: "Within a given pathMatcher,
only one of pathRules or routeRules must be set"), and only route rules can match a header. So the two path
rules became route rules, with the same paths. A request takes the rule with the lowest priority number that
fits it:

| Priority | Matches | Goes to | Exists while |
| --- | --- | --- | --- |
| 10 | `/api/plans`, `/api/plans/*` with `x-clps-canary: plans` | `clps-plans-canary-backend` | `canary_route` and the plans backend |
| 20 | `/api/plans`, `/api/plans/*` | `clps-plans-backend` | `plans_route = "plans"` |
| 30 | `/api/chat`, `/api/chat/*`, `/api/ask` with `x-clps-canary: copilot` | `clps-copilot-canary-backend` | `canary_route` and the co-pilot backend |
| 40 | `/api/chat`, `/api/chat/*`, `/api/ask` | `clps-copilot-backend`, or `clps-web-backend` during a drill with `copilot_route = "web"`; with the fault policy while a drill is on | `copilot_route = "copilot"` or a drill |
| 50 | `/tiles/global/*`, `/tiles/polar/*`, `/tiles/light/*`, `/tiles/manifest.json` | backend bucket `clps-web-tiles` | `assets_route = "bucket"` and `assets_bucket_access` |
| 60 | the five media files | backend bucket `clps-web-media` | the same |
| 90 | any path with `x-clps-canary: web` | `clps-web-canary-backend` | `canary_route` |
| none | anything else | `clps-web-backend` | always |

`/api/plans/*` and the others are written as a full path plus a prefix (`/api/plans` and `/api/plans/`), the
same two forms the path rules had. Route rules, like path rules, match the path with the query string
removed. The fault drill sits on rule 40 only, so it never touches a deploy's tests of the co-pilot's canary.

**Every combination was planned** on 2026-11-12, read-only, targeting the URL map alone: `plans_route`
(`plans`, `web`) times `copilot_route` (`copilot`, `web`) times a drill (off, `copilot_fault_abort_percent =
50`) times `canary_route` (on, off) times `assets_route` (`web`, `bucket`), 32 plans. All 32 planned. Each
showed exactly the rules the table says, and no path rules. With everything off (`web`, `web`, no drill, no
canary, `web`) there is no matcher `site` at all, as before the split. With a drill on, rule 40 has the fault
policy and its backend inside `route_action` (`clps-copilot-backend` or `clps-web-backend`), never beside a
`service`. A plan cannot show whether Google accepts a rule; that is found out by the apply.

---

## 2. The pull requests, in order

Expand, move, contract, as in every phase. Each pull request is its own branch, based on the one before:
open them in order, and merge each only after the one before has applied and its checks passed.

Every count below was planned **from today's live state**, so a later step's plan was made with the earlier
steps' settings too. What the pull request's own comment will show, once the step before is applied, is the
difference, which is what is written here. Nothing in any plan deletes or replaces anything; the destroy
guard passed each one in strict mode.

### Step 1. Expand: the canary backends and route, and the backend buckets

Branch `arch/phase-6-side-doors-1`. All the Terraform, with every later switch off, and these docs.

**The plan comment should say `9 to add, 1 to change, 0 to destroy`:**

- 3 serverless endpoint groups, `google_compute_region_network_endpoint_group.canary["web"]`, `["plans"]`,
  `["copilot"]`: each names its service and the tag `canary`.
- 3 backends, `google_compute_backend_service.canary[...]`: CDN off, logging on, the policy `clps-web-edge`.
- 2 backend buckets, `google_compute_backend_bucket.tiles[0]` and `.media[0]`: the bucket
  `clps-compute-6z1nc-web-assets`, CDN on, `FORCE_CACHE_ALL`, a day and an hour, compression off. No rule
  points at them yet.
- 1 grant, `google_project_iam_member.applier["network"]`: under "Access this plan changes". Grant 1 in
  section 3.
- `google_compute_url_map.site[0]` updated in place: the two `path_rule` blocks removed, five `route_rules`
  added (priorities 10, 20, 30, 40, 90). Rules 20 and 40 have the same paths and backends as the path rules
  they replace.

Nothing a visitor reaches changes. A request without the header matches what it matched before. The URL map
change takes a few minutes to reach every part of Google's edge, and during those minutes some edges have the
old map and some the new, both of which send every visitor's request to the same place.

`infra/expected-removals.txt` stays empty: nothing protected is removed in any step. (The branch first took
out Phase 4's leftover line itself; `main` did the same in pull request 141, and the merge kept `main`'s
version.) The pull request that takes Redis back to Basic adds its line, and the guard test's expectation,
as Phase 4's did.

**After the merge:** the run "Terraform" on `main` is green. Then:

```sh
for s in web plans copilot; do
  path=$([ $s = web ] && echo /api/status || ([ $s = plans ] && echo /api/plans/status || echo /api/chat/status))
  echo "$s: live $(curl -s $SITE$path | jq -r .revision), canary $(curl -s -H "x-clps-canary: $s" $SITE$path | jq -r .revision)"
done
gcloud run services describe clps-web --project $P --region $R --format json | jq -r '.status.traffic[] | select(.tag == "canary") | .revisionName'
```

**Pass:** each line names a revision for both, and each canary is the revision the tag is on (the last
command, and the same for `clps-plans` and `clps-copilot`). Before the apply reaches every edge the canary
answer is the live one: wait a few minutes.

### Step 2. Move the deploys: test through the load balancer with the header

Branch `arch/phase-6-side-doors-2`. The three deploy workflows and the check scripts. **No `infra/` change,
so no plan comment** (the Terraform check is skipped, which GitHub counts as passed).

Each deploy now:

1. makes the new version with no visitors and gives it the tag `canary`, as before;
2. **waits** until a status request with its header answers from that revision
   (`web/scripts/wait-for-canary.mjs`, up to 3 minutes), so the tests never run against the version the tag
   was on before;
3. tests it **through the load balancer with the header** (`smoke.mjs --canary web`,
   `plans-check.mjs --canary plans`, `copilot-check.mjs --canary copilot` and `chat-eval.mjs --canary copilot
   --quick`);
4. sends it a tenth and **watches both versions through the load balancer**: as a visitor and with the
   header (`canary.mjs "$SITE" "$SITE" --canary <service>`);
5. sends it everyone and tests it once more through the load balancer.

Everything else stays: waiting for Terraform first, the `commit` label, the check that the new revision is
the run's own, the site-data check, the co-pilot's waits for its rate limit's minute, the automatic way back.
"A tenth" stays, for the reason it always had: the split is real, and the pipeline makes its own requests
because the site has too few visitors in a minute. When a service's visitor route is on `"web"` there is no
live version to ask as a visitor, so the watch is skipped and the run says so; the tenth step itself still
runs.

The web server's smoke test with `--canary web` now also reaches the live plans and co-pilot services (the
header moves only the web server's paths), so it runs their read-only checks too. Their deploys of the same
commit may not have run yet, so it passes `--data-may-differ`, as the web deploy's last test already did.

**After the merge:** the merge changes the three workflow files, so all three deploys run: the web server
always deploys, and each workflow file is in its own service's `BUILT_FROM`. These three runs are the first
tests of the new path.

**Pass:** each run "Deploy", "Deploy plans" and "Deploy co-pilot" is green, its step "Wait for the load
balancer to reach the new version" printed `ok ... answers from <the new revision>`, and its test step
printed `note every request to https://shackletonstation.dev carries x-clps-canary: <service>`.

### Step 3. Expand again: the load balancer's grant, and the web server's subnet

Branch `arch/phase-6-side-doors-3`. Two lines in `infra/settings.auto.tfvars`:
`assets_bucket_access = true` and `web_egress_through_vpc = true`.

They come after step 1 because each needs something step 1 made: Google makes its account for load balancers
(`service-919194174067@https-lb.iam.gserviceaccount.com`) when the project's first backend bucket is made
(the backend bucket setup guide: "This service account is only available ... after you have created at least
one backend bucket"), and the applier needs step 1's network role to make a subnet.

**The plan comment should say `2 to add, 1 to change, 0 to destroy`:**

- `google_storage_bucket_iam_member.load_balancer_reads_assets[0]`: grant 2 in section 3, under "Access this
  plan changes". Its condition lists the three tile prefixes, `tiles/manifest.json` and the five media files.
- `google_compute_subnetwork.web_egress[0]`: `clps-web-egress`, `10.20.0.0/24` in the default network,
  `us-east4`, `private_ip_google_access = true`.
- `google_cloud_run_v2_service.web` updated in place: `vpc_access.egress` from `PRIVATE_RANGES_ONLY` to
  `ALL_TRAFFIC`, and its subnetwork from `default` to `clps-web-egress`. Nothing else. This starts one new
  version of the web server with the live image, outside the stepped rollout, as any change of a setting does.

Nothing a visitor reaches changes, except that the web server now reaches Google's APIs (Cloud Storage,
Firestore, Text-to-Speech, Cloud Trace, Google's sign-in keys) and Redis from its own subnet.

**After the merge:**

```sh
curl -s $SITE/api/status | jq '{revision, limitsAndCache, redis: .redis.state}'
curl -s $SITE/api/status/services | jq '.services | map_values({state, checkedAs, why})'
curl -s $SITE/api/stats | jq '{day, questions: .counts.questions}'
curl -s -o /dev/null -w '%{http_code}\n' -X POST $SITE/api/speak -H 'content-type: application/json' -H "origin: $SITE" -d '{"text":"Phase six check."}'
```

**Pass:** the revision is the new one; `limitsAndCache` and `redis` are `"redis"` (Redis still reached from
the new subnet); both services are `"up"` with `checkedAs: "web"`; the counts are numbers for today (Firestore
through Private Google Access); the voice answers `200` (Text-to-Speech, one short text of the day's 200). A
tile still loads in the 3D view (Cloud Storage). If Redis shows `"memory"` or anything fails, take the
`web_egress_through_vpc` line out (section 4).

Wait at least five minutes after this apply before merging step 4, so the new grant is honoured everywhere.

### Step 4. Move tiles and video to the bucket

Branch `arch/phase-6-side-doors-4`. One line: `assets_route = "bucket"`.

**The plan comment should say `0 to add, 1 to change, 0 to destroy`:** `google_compute_url_map.site[0]`
updated in place, with two route rules added: priority 50 to `clps-web-tiles` (`/tiles/global/`,
`/tiles/polar/`, `/tiles/light/` as prefixes, `/tiles/manifest.json` in full) and priority 60 to
`clps-web-media` (the five media files in full). Nothing else.

This is the one step a visitor's request goes somewhere new: terrain tiles, the light grid and the videos come
from the bucket through Cloud CDN, and no longer from the web server. The CDN's cache for the backend buckets
starts empty, so for the first day more requests miss it than before.

**After the merge:** wait for this to print `the bucket` several times in a row, then run check (d) in
section 6.

```sh
curl -s -o /dev/null -D - $SITE/tiles/global/16_0.bin.gz | grep -iE '^(x-goog-generation|cache-control|age):'
```

### Step 5. Contract: close the run.app addresses

Branch `arch/phase-6-side-doors-5`. One line: `service_ingress = "load-balancer"`, and the laptop parts of
`docs/DEPLOY.md`.

**The plan comment should say `0 to add, 3 to change, 0 to destroy`:** `google_cloud_run_v2_service.web`,
`.plans[0]` and `.copilot[0]`, each with `ingress` from `INGRESS_TRAFFIC_ALL` to
`INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER`, and nothing else. Ingress belongs to the service, not to a revision,
so no new version starts. The events worker is not in the plan.

**After the merge:** checks (a), (b), (c), (e) and (f) in section 6.

---

## 3. Every grant

Two grants are added. None is removed. `allUsers` keeps `roles/run.invoker` on web, plans and co-pilot: the
external load balancer sends visitors' requests with no identity of their own, so Cloud Run must still let
anyone call the service. What changes in step 5 is from where.

| # | Step | Who | Role | On what | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | `terraform-applier@clps-compute-6z1nc.iam.gserviceaccount.com` | `roles/compute.networkAdmin` | The project | To make and manage the web server's subnet. The service's own administrator role, as for every other kind of resource the applier manages (`infra/pipeline.tf`). It also covers networks, routes, peerings and addresses (not firewall rules); the applier could already give itself any role (decision 0007), so this adds no reach it did not have |
| 2 | 3 | `service-919194174067@https-lb.iam.gserviceaccount.com` (Google's account for this project's load balancers) | `roles/storage.objectViewer`, condition `only-tiles-and-video` | The bucket `clps-compute-6z1nc-web-assets` | The backend buckets read the private bucket as this account. The condition limits it to objects under `tiles/global/`, `tiles/polar/`, `tiles/light/`, and to `tiles/manifest.json` and the five media files. It cannot list the bucket |

Things that are not grants, said plainly:

- **The canary header is not a grant.** It picks a version; it lets nobody in who was not already let in.
- **The web server's status calls need no grant.** It already asked with a Google identity token each service
  checks in code. What changes is the network path: its own subnet, with Private Google Access.
- **The planner needs nothing new.** `roles/compute.viewer` reads backend buckets and subnets, and its custom
  role already reads the bucket's access list.
- **The deployer needs nothing new.** It already may update the services and their tags; the tests run as
  plain HTTPS requests through the load balancer.
- **The bucket stays private.** `public_access_prevention = "enforced"` stays on.

To see the two after their applies:

```sh
gcloud projects get-iam-policy $P --flatten 'bindings[].members' --filter 'bindings.members:terraform-applier@' --format 'value(bindings.role)' | grep networkAdmin
gcloud storage buckets get-iam-policy gs://clps-compute-6z1nc-web-assets --format json | jq '.bindings[] | select(.members[] | contains("https-lb"))'
```

---

## 4. The ways back

Each is one line in `infra/settings.auto.tfvars`, merged as a pull request (or, in a hurry, applied from the
Mac with `-var`: `docs/DEPLOY.md`, "Applying from the Mac"). Undo in the reverse order of the steps.

| To undo | Do | What happens |
| --- | --- | --- |
| Step 5, the closed addresses | Delete `service_ingress = "load-balancer"` | The three run.app addresses are open again, from anywhere. No new version |
| Step 4, tiles and video from the bucket | Delete `assets_route = "bucket"` | Rules 50 and 60 go; the web server answers `/tiles/*` and `/media/*` again, with the code it still has. A few minutes to reach every edge |
| Step 3, the web server's subnet | Delete `web_egress_through_vpc = true` | Back to `PRIVATE_RANGES_ONLY` on the default subnet: one new version of the web server, then the subnet is deleted. **Undo step 5 first** (or in the same pull request): with the addresses closed, the status calls need this path |
| Step 3, the load balancer's grant | Delete `assets_bucket_access = true` | The grant goes, and rules 50 and 60 with it even if `assets_route` still says `"bucket"` (the rules need both), so tiles go back to the web server in the same apply |
| Step 2, the deploys | Revert the pull request | The deploys test on the tag's run.app address again. Only works while step 5 is undone |
| Step 1, the canary route | `canary_route = false` | The three canary rules, endpoint groups and backends go. Undo step 2 first: the deploys need the route |
| A deploy's new version | As always: `gcloud run services update-traffic <service> --to-revisions <revision>=100` (`docs/DEPLOY.md`) | Seconds. The deploys do this themselves when a step fails |

---

## 5. Who calls a run.app address, and what each does now

| Caller | Before | After step 5 |
| --- | --- | --- |
| The deploys' tests of a new version (GitHub's runners, on the internet) | The tag's run.app address | The load balancer with `x-clps-canary` (step 2). Internet requests to run.app would be refused |
| The deploys' fallback read of the live commit, when the live version has no `commit` label | The service's run.app status address | The site's status address (`$SITE/api/plans/status`, `$SITE/api/chat/status`), believed only when it names the live revision, as before |
| The web server asking plans and the co-pilot for their status (`/api/status/services`) | Their run.app addresses, over the internet (`PRIVATE_RANGES_ONLY` sends only private addresses through the network) | The same addresses, through the network from its own subnet with Private Google Access (step 3), which Cloud Run counts as internal |
| People running the checks from a laptop | Either address | The site's address, with `--canary <service>` for the next version (`docs/DEPLOY.md`, "Checking a running site"). A run.app address answers with an error |
| Pub/Sub pushing events to the worker | The worker's run.app address, with a token | Unchanged. The worker keeps public ingress, IAM only |
| The worker's deploy and `worker-check.mjs` | The worker's run.app address, with the deployer's token | Unchanged |
| The uptime check | The domain | Unchanged |
| Terraform, `gcloud run` | Cloud Run's admin API, not the service | Unchanged |

**Why the web server's calls needed a change.** Cloud Run's ingress page lists who counts as internal: VPC
networks in the same project, and some Google services in the same project (Pub/Sub, Cloud Scheduler,
Eventarc, Workflows and others). For a call from another Cloud Run service its private networking page says
"the traffic must use the VPC network to be considered internal", and offers three ways: send all traffic
through the network with Private Google Access on the subnet; put Private Service Connect or an internal load
balancer in front; or Private Google Access plus DNS that resolves `run.app` to `private.googleapis.com`. With
`PRIVATE_RANGES_ONLY` a run.app address (a public Google address) goes straight out, so it would be refused.
The first way was chosen; decision 0008 says why, and why on a new subnet.

---

## 6. The "done when" checks

Run after step 5, unless a check says otherwise.

### (a) The run.app addresses refuse a request from the internet

```sh
for s in clps-web clps-plans clps-copilot; do
  for url in $(gcloud run services describe $s --project $P --region $R --format json | jq -r '.metadata.annotations["run.googleapis.com/urls"] | fromjson[]'); do
    echo "$s $url $(curl -s -o /dev/null -w '%{http_code}' $url/)"
  done
done
curl -s -o /dev/null -w 'canary tag address: %{http_code}\n' "$(gcloud run services describe clps-web --project $P --region $R --format json | jq -r '.status.traffic[] | select(.tag == "canary") | .url')/"
```

**Pass:** no `200` for any of the six addresses or the tag's address. Google's page does not say which status
an address closed by ingress answers; expect `404` or `403` and Google's own error page. Before step 5 the
same commands print `200`, which is the "before".

### (b) The site works

```sh
node web/scripts/smoke.mjs $SITE --plans-service --copilot-service
curl -s $SITE/api/status/services | jq '.services | map_values({state, checkedAs})'
```

**Pass:** `All checks passed`; both services `"up"` with `checkedAs: "web"` (the status calls reach the closed
addresses through the network). In a browser: the landing page, the Atlas with a tapped spot, one co-pilot
question, a shared plan, the 3D view, and the demo video seeking.

### (c) A deploy tests its new version through the load balancer with the header

The first proof is step 2's three deploy runs. After step 5, run one by hand (Actions, "Deploy", "Run
workflow"), or read the next one a merge starts:

```sh
gh run list --repo shackleton-station/<repo> --workflow deploy.yml --limit 1
gh run view <id> --repo shackleton-station/<repo> --log | grep -E 'carries x-clps-canary|answers from|All checks passed|Both versions stayed healthy'
```

**Pass:** the run is green; "Wait for the load balancer to reach the new version" printed `ok`; the test step
printed `note every request to https://shackletonstation.dev carries x-clps-canary: web` and `All checks
passed`; the watch printed `Both versions stayed healthy` with both lines through `https://shackletonstation.dev`.

### (d) Tiles and video come from the bucket through the CDN, with the right headers

After step 4.

```sh
curl -s -D - -o /tmp/tile.bin $SITE/tiles/global/16_0.bin.gz | grep -iE '^(HTTP|content-type|content-encoding|cache-control|age|x-goog-generation|x-goog-stored-content-encoding):'
head -c 2 /tmp/tile.bin | xxd -p                                                    # 1f8b: the gzip file itself
curl -s -D - -o /dev/null -r 1000-1999 $SITE/media/demo.mp4 | grep -iE '^(HTTP|content-range|content-length|accept-ranges|cache-control|x-goog-generation):'
curl -s -o /dev/null -w '%{http_code}\n' $SITE/tiles/global/16_0.bin.gz.bak         # a name the pipeline never writes
curl -s -o /dev/null -w '%{http_code}\n' $SITE/media/other.mp4                      # a media name the site does not serve
node web/scripts/smoke.mjs $SITE | grep -E 'tile came from|video came from|refused'
```

**Pass:**

- The tile: `200`, `content-type: application/octet-stream`, **no `content-encoding`**, an
  `x-goog-generation` header (Cloud Storage sent it), `x-goog-stored-content-encoding: identity` if Cloud
  Storage sends that header through the load balancer, and a
  `cache-control` with `max-age=86400`. Asked twice, the second answer has an `age` header (from the CDN).
  The first two bytes are `1f8b`.
- The video: `206`, `content-range: bytes 1000-1999/18746666`, `content-length: 1000`, and a
  `cache-control` with `max-age=3600`.
- The never-written tile name: `403` (Cloud Storage will not say whether a name exists to a reader that
  cannot list). The other media name: `404` from the web server, because no rule sends it to the bucket.
- The smoke test says both came from `the bucket, through the load balancer`.

The exact `cache-control` text Cloud CDN sends in `FORCE_CACHE_ALL` mode is not quoted on Google's pages
(they say it passes the default or client time as `max-age`). Write down what it is.

**Compared with the baseline** (`docs/ARCHITECTURE_BASELINE.md`, 1.2 and 1.3: in 16 h 25 min, 90.7% of 4,905
tile requests and 70.9% of 175 video requests came from the CDN; tiles that missed had a median of 530 ms and
a p95 of 1,696 ms at the load balancer). Not measured yet: the new backends start with an empty cache. A day
after step 4, run step 7 of the baseline's section 1.8 again with the load balancer's log, and add the
backend the log names (`jsonPayload.backendTargetName`) to the table. What to expect, not a result: misses no
longer wait on a Cloud Run copy, its start or its concurrency, only on Cloud Storage.

### (e) The fault drills still work

The drill is a routing change. Do it on Friday or not at all. From the Mac, for minutes
(`docs/DEPLOY.md`, "Applying from the Mac"):

```sh
cd infra
terraform plan -out=drill.tfplan -var copilot_fault_abort_percent=100   # 0 to add, 1 to change: rule 40 gains route_action with the abort
terraform apply drill.tfplan
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' $SITE/api/chat/status; sleep 5; done; echo
curl -s -o /dev/null -w 'with the canary header: %{http_code}\n' -H 'x-clps-canary: copilot' $SITE/api/chat/status
curl -s -o /dev/null -w 'plans: %{http_code}\n' $SITE/api/plans/status
terraform plan -out=drill.tfplan && terraform apply drill.tfplan && rm drill.tfplan    # back to no drill
```

**Pass:** the loop goes from `200` to `503` within a few minutes and stays there; with the canary header it is
`200` (the drill is on rule 40 only); plans answers `200`. After the second apply the loop goes back to `200`.
The breaker drill (`copilot_model_faults`) is a setting on the service, not the URL map, and this phase does
not touch it.

### (f) The status calls still work

Part of (b): `/api/status/services` shows both services `"up"`, checked as `web`. Also the How it works page
in a browser: both services shown as answering.

---

## 7. What has only been tested, not run for real

- **That Google accepts the URL map.** All 32 combinations plan. A plan does not ask Google; the apply does.
  Two things it checks that a plan cannot: route rules with header matches on this load balancer, and a
  backend bucket as a route rule's `service` (Google's traffic-management overview lists backend buckets as a
  destination of the global external Application Load Balancer; the URL map reference's text for
  `routeRules[].service` names only a backend service). If the apply refuses a rule, nothing changes on the
  URL map (the update is one call) and the run is red.
- **That a serverless endpoint group follows the tag.** The API reference calls `tag` "the named revision";
  it does not say how soon a moved tag is followed. The deploys do not rely on it: they wait until a status
  request with the header names the new revision.
- **What Cloud Run answers on a closed address.** Not documented; check (a) records it.
- **The web server on its own subnet.** That Redis's peering carries a new subnet's range (Memorystore's
  peering exchanges every subnet's routes; not tried here), that every Google API it calls answers through
  Private Google Access, and that a run.app call that way counts as internal: taken from Google's pages, not
  run. Step 3's checks are the test, before step 5 depends on it.
- **The load balancer's account.** Its name and that it appears after the first backend bucket are from the
  backend bucket setup guide. Not seen in this project yet.
- **The cache headers from the CDN.** `FORCE_CACHE_ALL` with a day and an hour. Whether the browser gets
  exactly `public, max-age=86400` is not quoted by Google; check (d) records it.
- **The deploy workflows.** The scripts ran read-only against the live site from the Mac on 2026-11-12 with
  the header (`smoke.mjs --canary web`: all checks passed; `canary.mjs --canary plans` for 4 s; both outcomes
  of `wait-for-canary.mjs`), before any canary route existed, so the header reached the live versions. The
  workflows themselves parse as YAML, every shell block passes `bash -n`, and every step output they read
  exists. `actionlint` was not run (not installed). Their first real runs are step 2's.
- **The automatic way back.** Unchanged (`--to-revisions $LIVE=100` on any failure), and not exercised.
- **Edge cases left as they were.** A version Terraform makes does not get the tag, so between a setting
  change and the next deploy the canary header reaches the older revision. Harmless; written down in
  section 1.

---

## 8. Results, 2026-11-13

Run by Claude Code between 23:45 and 00:50 UTC. Every step went through the pipeline: a pull request with
its plan comment read before the merge, applied by GitHub on merge. Times are UTC.

| Step | Pull request | Applied | Plan | What was checked after it |
| --- | --- | --- | --- | --- |
| 1, canary routes and bucket backends | 143 | 23:54 | 9 added, 1 changed (one grant: `roles/compute.networkAdmin` to the applier) | A probe every 5 s through the apply saw no change for visitors. With `x-clps-canary: plans` and `copilot`, the load balancer reached each service's `canary` revision |
| 2, deploys test through the load balancer | 144 | (no infra) | none | The merge's own three deploys each waited for the load balancer to reach the new version, tested it through it with the header, sent it a tenth, watched both for a minute and sent it everyone |
| 3, bucket access and web egress subnet | 145 | 00:13 | 2 added, 1 changed (one grant: the load balancer's account on the tile and media objects only) | Web on revision `clps-web-00091-k5n`, egress all traffic on `clps-web-egress`. Through it: Redis (`redis`), both services up and checked as `web`, today's counts (Firestore), the voice 200, a tile 200, a video range 206, smoke test passed |
| 4, tiles and video from the bucket | 146 | 00:23 | 0 added, 1 changed (URL map rules 50 and 60) | The load balancer's log shows `clps-web-tiles` and `clps-web-media` answering. Tiles: raw gzip (`1f8b`), no `Content-Encoding`, `public, max-age=86400`, the second request from the CDN (`age: 2`, then `4`). Video: 206 with `max-age=3600`. A missing name: 404. The 3D view loaded 81 tiles, all 200 |
| 5, run.app addresses closed | 148 | 00:31 | 0 added, 3 changed (ingress only) | Below |

**The "done when" checks.**

| Check | Result | What was seen |
| --- | --- | --- |
| (a) The run.app addresses refuse a request from the internet | **Pass** | Before step 5 each answered 200; after it, web, plans and co-pilot answered 404. The events worker, unchanged, answers 403 without a token |
| (b) The site works | **Pass** | The smoke test with `--plans-service --copilot-service` and `plans-check.mjs --cloud`: all checks passed |
| (c) A deploy tests its new version through the load balancer with the header | **Pass** | The web deploy of step 5's merge, with the addresses closed: reached the new version through the load balancer, tested it, a tenth, watched, everyone, tested the public address |
| (d) Tiles and video from the bucket through the CDN, right headers | **Pass** | Step 4 above |
| (e) The fault drills still work | **Pass** | Pull request 149 set `copilot_fault_abort_percent = 50` on the co-pilot's route rule (priority 40). Applied 00:35:51, first 503 at 00:38:04. Of 40 rounds 2 s apart: the co-pilot 14 answered 503 and 26 answered 405; plans, a page and the tile manifest answered 200 every time. Pull request 150 switched it off (applied 00:43:12); 20 clean answers in a row by 00:46:11 |
| (f) The web server's status calls | **Pass** | After step 5: both services `up`, `checkedAs: web`, through the egress subnet |

**What was learned.**
- A changed URL map reached this laptop in about 2 to 3 minutes each time, as in Phases 2 and 3.
- The canary header works for all three services, and the deploys no longer need any `run.app` address.
- The rate-based ban of the edge firewall does not cover the backend buckets (edge policies have no rate
  limits). Cache hits were already outside it.

**Not measured yet:** the automatic rollback through the load balancer (no deploy has failed since step 2).

### The CDN hit rate, 2026-11-13 (14 h 40 min after step 4)

From the load balancer's log, 00:30 to 15:09 UTC, the backend each request names (`clps-web-tiles`,
`clps-web-media`). The deploys' smoke check asks for `tiles/global/16_0.bin.gz.bak` every run to prove names
outside the allow-list are refused (47 requests, all `404`); they are left out.

| | Requests | From the CDN | Baseline (16 h 25 min, served through the web server) |
| --- | --- | --- | --- |
| Tiles, all | 408 | 300 (**73.5%**) | 90.7% of 4,905 |
| Tiles, a tile asked for again | 318 | 298 (**93.7%**) | not split this way |
| Tiles, the first request for each of 91 tiles | 90 | 2 | |
| Video, posters and captions | 79 | 58 (73.4%) | 70.9% of 175 |

**Read it as:** the new backends started with an empty cache, and this day's traffic was a few visitors, so
almost every first look at a tile was a miss by construction. Once a tile had been asked for, 93.7% of later
requests came from the CDN. The baseline's 90.7% had weeks of a warm cache behind it.

**Miss times.** The log's median for a tile that missed was 3,801 ms (p95 4,565 ms, median size 170 KB),
against 530 ms in the baseline. That is not the bucket being slow: the load balancer's latency for a backend
bucket runs to the last byte reaching the browser, and the page asks for about 81 tiles at once, so the figure
is mostly the visitor's own download queue. Measured directly from this Mac, five tiles never asked for
before (250 to 470 KB): first byte in 161 to 242 ms and the whole tile in 222 to 313 ms from the bucket; asked
again, first byte in 61 to 63 ms (`age` set, from the CDN). So a miss from the bucket costs about 150 ms more
than a hit, and is faster than the baseline's misses through the web server.

Not seen: a day with real traffic, and the `age` header beyond a few seconds.
