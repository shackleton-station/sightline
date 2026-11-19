# Deploying

The site runs on **Google Cloud Run** as four services. The **web server** (`web/Dockerfile`) is the built
pages plus the small server in `web/server/`: it serves the pages, the site data, Scout's voice, presenters'
rooms and its own status. Terrain tiles and the demo video come straight from a private Cloud Storage bucket
through the load balancer's CDN (`infra/assets.tf`); the web server still has the code to send them, for the
way back. The infrastructure is declared in [`infra/`](../infra/README.md), and changes to it
go through GitHub too: see "Infrastructure changes" below.

The **plans service** (`web/plans/Dockerfile`) answers `/api/plans`, and the **co-pilot service**
(`web/copilot/Dockerfile`) answers `/api/chat` and `/api/ask`: the load balancer sends them those paths. The
web server has no code for them and answers 404 for them on its own address. Those three take requests from
the internet only through the load balancer and its edge firewall: their own `run.app` addresses refuse it
("Checking a running site", below). A private service, the
**events worker** (`web/events-worker/Dockerfile`), counts co-pilot questions. Each deploys by itself: see
the sections below.

## Normal deploys

Merging to `main` deploys: after CI passes, `.github/workflows/deploy.yml` builds the image, pushes it and
rolls it out in steps. Nobody needs Google Cloud access for this. If a Terraform run started before the
deploy, the deploy waits for it first ("Infrastructure changes" below).

1. The new version starts with **no visitors** and gets the tag `canary`. The workflow waits until the load
   balancer sends a request with the header `x-clps-canary: web` to it (`web/scripts/wait-for-canary.mjs`),
   then runs the smoke test **through the load balancer with that header**: cache rules, a tile, video
   ranges, its own API's origin check, today's counts and its status. The header moves only the web server's
   paths, so the plans and co-pilot paths reach the live services, and their read-only checks run too (a
   difference in site data is only reported: their deploys of the same commit may not have run yet).
2. It gets **a tenth of the visitors**. For a minute `web/scripts/canary.mjs` asks for a page, the site data
   and the web server's status twice through the load balancer: as a visitor, and with the header. Any
   server error fails the step.
3. It gets **everyone**. The smoke test runs once more through the address visitors use
   (`https://lunarsightline.com`), with no header and with `--plans-service --copilot-service`: there the
   plans service and the co-pilot service must answer their status, refuse another site and refuse a GET.
   So a web server whose pages cannot reach the services fails the deploy. A difference in site data is only
   reported there (`--data-may-differ`): the services' own deploys of the same commit wait for this one and
   check it themselves.

Nothing in this deploy calls the model or saves a plan. The co-pilot's set questions are asked by the
co-pilot's own deploy.

If any step fails, the workflow sends every visitor back to the version that was live before, and the run
goes red. The new version stays deployed with no visitors and keeps the tag, so it can be looked at through
the load balancer with the header ("Reaching a version that is not live yet" below).

To go back by hand, to any earlier version:

```sh
gcloud run revisions list --service clps-web --project clps-compute-6z1nc --region us-east4 --limit 5
gcloud run services update-traffic clps-web --project clps-compute-6z1nc --region us-east4 --to-revisions <revision>=100
```

The next successful deploy puts visitors on the newest version again.

### Reaching a version that is not live yet

Every deploy gives the version it makes the tag `canary`. Since Phase 6 the load balancer sends a request
carrying the header `x-clps-canary` to that version, through the same edge firewall as every visitor
(`infra/canary.tf`; `docs/ARCHITECTURE_PHASE_6.md`, section 1):

| Header | Paths it moves | To |
| --- | --- | --- |
| `x-clps-canary: web` | every path of the web server's | `clps-web`'s revision tagged `canary` |
| `x-clps-canary: plans` | `/api/plans`, `/api/plans/*` | `clps-plans`'s revision tagged `canary` |
| `x-clps-canary: copilot` | `/api/chat`, `/api/chat/*`, `/api/ask` | `clps-copilot`'s revision tagged `canary` |

The header is **not a secret**. It is written in the workflows and here on purpose. Anyone who sends it
reaches the next version, with the same limits as everyone, which is harmless. Between deploys the tag stays
on the version the last deploy made, normally the live one.

```sh
curl -s -H 'x-clps-canary: web' https://lunarsightline.com/api/status | jq -r .revision
curl -s -H 'x-clps-canary: plans' https://lunarsightline.com/api/plans/status | jq -r .revision
curl -s -H 'x-clps-canary: copilot' https://lunarsightline.com/api/chat/status | jq -r .revision
node web/scripts/smoke.mjs https://lunarsightline.com --canary web --data-may-differ
node web/scripts/plans-check.mjs https://lunarsightline.com --canary plans --cloud
node web/scripts/copilot-check.mjs https://lunarsightline.com --canary copilot --cloud
```

In a browser, a header-changing extension does the same for the pages. To put the tag on another version:
`gcloud run services update-traffic <service> --project clps-compute-6z1nc --region us-east4 --update-tags canary=<revision>`.

## The events worker

It has its own workflow, `.github/workflows/deploy-events-worker.yml`, which runs after CI on `main` beside
the site's and never waits on it. It builds and deploys only if something the worker is built from changed
since the commit that is live: `web/events-worker/`, `web/shared/`, the site data (`web/public/data/`),
`web/package.json` or its lock file. A manual run from the Actions tab always deploys.

The worker has no visitors, so its steps are:

1. The new version starts with **no messages**, on an address of its own, and `web/scripts/worker-check.mjs`
   tests it there as the deployer. It must refuse a caller with no identity; report this commit and the hash
   of this commit's site data; refuse a message delivered by anyone but Pub/Sub; and pass its self-check,
   which counts one made-up event twice in the real database and requires "added once, refused once".
2. It gets **every message**, and the address that takes messages is checked for the new version.

There is no step with a tenth of the messages: at about one question every nine minutes there would be
nothing to watch, and the pipeline cannot send test messages of its own without putting them in the question
log. If a step fails, the workflow sends every message back to the version that was live before.

**Going back by hand**, to any earlier version:

```sh
gcloud run revisions list --service clps-events-worker --project clps-compute-6z1nc --region us-east4 --limit 5
gcloud run services update-traffic clps-events-worker --project clps-compute-6z1nc --region us-east4 --to-revisions <revision>=100
```

Nothing is lost by going back, or by a bad version being live for a while. A message the worker refuses or
fails is sent again by Pub/Sub, with a growing wait, to whichever version is live by then, and an event is
counted once however often it arrives. After five failed tries a message moves to the dead-letter
subscription and an alert email goes out. To look at what is there without removing it, and to put the
messages back on the topic once the worker is fixed:

```sh
gcloud pubsub subscriptions pull clps-web-events-refused --project clps-compute-6z1nc --limit 10 --format json
# Publishing a message again sends it to both subscriptions, so the question log gets a second row for it
# (same id). The worker counts it once. Only republish messages whose CloudPubSubDeadLetterSourceSubscription
# is clps-web-events-to-worker.
gcloud pubsub topics publish clps-web-events --project clps-compute-6z1nc --message '<the message's data, decoded>' --attribute kind=copilot_question
gcloud pubsub subscriptions pull clps-web-events-refused --project clps-compute-6z1nc --limit 10 --auto-ack   # removes them for good
```

**Stopping the worker without undeploying it:** `gcloud run services update clps-events-worker --project
clps-compute-6z1nc --region us-east4 --update-env-vars PAUSED=on` makes it refuse every message, and
`--remove-env-vars PAUSED` starts it again. Messages wait in the queue for as long as five tries take (at
least four minutes), then in the dead-letter subscription. **Switching it off in Terraform:**
`events_worker_push = false` removes the subscription and leaves the worker idle; `events_worker = false`
removes the worker and everything of its own. The counts already kept stay either way
(`docs/ARCHITECTURE_PHASE_1.md`).

**If the counts look wrong**, the question log is the source to check against. Yesterday's count by both:

```sh
curl -s https://lunarsightline.com/api/stats
bq --project_id clps-compute-6z1nc --location us-east4 query --use_legacy_sql=false \
  'SELECT DATE(`at`) AS day, COUNT(DISTINCT IFNULL(id, CAST(FARM_FINGERPRINT(TO_JSON_STRING(t)) AS STRING))) AS questions
   FROM `clps-compute-6z1nc.site_events.copilot_questions` AS t WHERE DATE(`at`) = CURRENT_DATE() GROUP BY day'
```

## The plans service

It answers `/api/plans` and has its own workflow, `.github/workflows/deploy-plans.yml`, which runs after CI
on `main` beside the other two and never waits on them. It builds and deploys only if something the service
is built from changed since the commit that is live: `web/plans/`, `web/shared/`, `web/src/lib/`,
`web/src/data/`, the site data (`web/public/data/`), `web/package.json` or its lock file. A manual run from
the Actions tab always deploys.

1. The new version starts with **no visitors** and gets the tag `canary`. Once the load balancer sends
   `x-clps-canary: plans` to it, `web/scripts/plans-check.mjs --canary plans` tests it through the load
   balancer. It must report this commit and the hash of this commit's site data, with Firestore,
   Redis, sign-in and tracing switched on. It must answer 404 for a plan that does not exist (one real read
   of the database), 401 for a list without sign-in, and 403 for a save from another site. Then one real
   plan is saved with an idempotency key, sent again (the first answer must come back) and opened.
2. It must carry **the same site data as the web server** that is live. The site's own deploy of the same
   commit may still be running, so the step waits up to 15 minutes for the two to agree, and then fails.
3. It gets **a tenth of the requests**, and for a minute `web/scripts/canary.mjs` asks for its status and
   for one read of the database twice through the load balancer: as a visitor, and with the header. Any
   server error fails the step.
4. It gets **everyone**, and the check runs once more through the load balancer: as a visitor when visitors
   are routed to it, otherwise with the header.

If any step fails, the workflow sends every request back to the version that was live before.

**What "a tenth" means.** Visitors reach this service only while the load balancer's route rule points at
it (`plans_route = "plans"` in `infra/`). Until then no visitor reaches it, there is no live version to ask as
a visitor, and step 3's watch is skipped; the header still reaches the new version. Each run says which case
it is in. On the very first deploy the live version is Google's placeholder image, so step 3 is skipped.

**What a deploy leaves behind.** The plan saved in step 1 is real. It has no owner, so nobody can delete
it. Its title is "Deploy check (<commit>)", and the database removes it 180 days later.

**Going back a version** by hand, to any earlier one:

```sh
gcloud run revisions list --service clps-plans --project clps-compute-6z1nc --region us-east4 --limit 5
gcloud run services update-traffic clps-plans --project clps-compute-6z1nc --region us-east4 --to-revisions <revision>=100
```

Nothing saved is lost by going back: plans and idempotency keys are in the database, not in the service.

**Sending `/api/plans` back to the web server.** The web server's code has no plans API any more, so this
is two steps, in this order. First send the web server back to a revision from before the contract pull
request, which still has the plans code ("To go back by hand" above, with that revision's name). Then set
`plans_route = "web"` in `infra/settings.auto.tfvars` and merge that (or, in a hurry, apply it from the Mac: "Applying from the Mac" below): one change to the load balancer's URL map,
a few minutes to reach every edge. The web server's grant on the database and its `PLANS_DATABASE` setting
come back by themselves in the same apply. Hold deploys of `main` until the route is back on `"plans"`: the
next one puts the web server back on code with no plans API. All of it:
[`ARCHITECTURE_PHASE_2.md`](ARCHITECTURE_PHASE_2.md), "The ways back".

**Which one is answering?** Only the plans service has a status address:

```sh
curl -s https://lunarsightline.com/api/plans/status     # the service's status; {"error":"not-found"} means the path reaches only the web server
node web/scripts/smoke.mjs https://lunarsightline.com --plans-service   # fails unless it is the plans service
```

**If plans fail and the rest of the site works**, in this order: the latest deploy of `clps-plans`; its
status (`"limits":"redis-unreachable"` means it cannot reach Redis and is counting limits in each copy's
memory, which does not fail requests); its log (`gcloud run services logs read clps-plans --region us-east4`,
every line carries `"service":"plans"`); Firestore.

## The co-pilot service

It answers `/api/chat` and `/api/ask` and has its own workflow, `.github/workflows/deploy-copilot.yml`,
which runs after CI on `main` beside the others and never waits on them. It builds and deploys only if
something the service is built from changed since the commit that is live: `web/copilot/`, `web/shared/`,
`web/src/lib/`, `web/src/data/`, the site data (`web/public/data/`), the two hashing scripts
(`web/scripts/data-version.mjs`, `web/scripts/copilot-version.mjs`), `web/package.json` or its lock file.
A manual run from the Actions tab always deploys.

1. The new version starts with **no visitors** and gets the tag `canary`. Once the load balancer sends
   `x-clps-canary: copilot` to it, `web/scripts/copilot-check.mjs --canary copilot` tests it through the
   load balancer. It must report this commit, the hash of this commit's
   site data and the hash of this commit's co-pilot code, with Claude answering (no stand-in, no faults
   injected; its model, speed, effort and fallbacks named, signed in by workload identity federation),
   limits and the circuit breaker on Redis, the question log and tracing on. It must refuse
   another site (403), a malformed question (400) and a GET (405) on both endpoints, before any model call.
2. It must carry **the same site data as the web server** that is live, as for plans (up to 15 minutes).
3. **The two set questions** (`chat-eval.mjs --canary copilot --quick`) are asked of the new version
   through the load balancer: one must look something up in the data, the other must not repeat a planted
   claim. Step 1 counts against no limit (a malformed question is read and refused before it is counted);
   the step still waits out a minute, as a margin. The co-pilot counts by the visitor's address, which is the runner's
   whichever way the request comes, so these waits are the same as before Phase 6. This is the only deploy
   that asks them: the web server has no co-pilot.
4. It gets **a tenth of the requests**, and for a minute `canary.mjs` asks for its status and sends a GET to
   each endpoint (405, no model call) twice through the load balancer: as a visitor, and with the header.
   Any server error fails the step.
5. It gets **everyone**, and the check runs once more through the load balancer (as a visitor when visitors
   are routed to it, otherwise with the header) and then, when they are, with one streamed question.

If any step fails, the workflow sends every request back to the version that was live before. "A tenth"
means what it means for plans: until `copilot_route = "copilot"` is applied, no visitor reaches the
service, the watch is skipped, and the run says so.

**What a deploy costs.** Three questions out of the number the chat allows everyone together in a day
(`chat_all_day`): the two set questions and the streamed one, or four if one is asked again. It was nine or
ten until 2026-11-14 (five set questions, and three malformed ones that were counted), which with the
night's deploys and checks used the day's whole allowance. After a change to the co-pilot's instructions,
tools or model, ask the whole set by hand: `node web/scripts/chat-eval.mjs https://lunarsightline.com`.
Only a question the chat goes on to answer counts against its limits: a malformed one is refused (400)
before it is counted, even when the day's limit is full, and one that any limit refuses (429) is counted
against none, so a full limit clears when its oldest answered questions are a day old and not later. The
Sightline check script (`sightline-shots.mjs`) sends nothing to the chat unless it is run with `--ask`.
Each is a few model calls, unless their answers are already kept: kept answers are keyed by the co-pilot's code and the site data, so a deploy that changes neither
(a change to the workflow file, say) finds them kept, and `chat-eval.mjs` says so for each one.

**The switch from Gemini to Claude, once** (`docs/decisions/0009-copilot-on-claude.md`). The merge
applies Terraform first: the co-pilot's identity loses its Vertex AI role, and Cloud Run makes a new
revision of the old (Gemini) image with the new settings. From then until the new image is live, a few
minutes, that revision's model calls are refused, and the co-pilot falls back to "the facts" or answers
`502`; kept answers are still given. Going back a version to a Gemini image does not work after that
apply either, because the role is gone. So: fill in the federation identifiers first, merge when a few
minutes of a degraded co-pilot do not matter, and to go back to Gemini, revert the pull request (which
gives the role back) rather than moving traffic.

**Going back a version** by hand, to any earlier one:

```sh
gcloud run revisions list --service clps-copilot --project clps-compute-6z1nc --region us-east4 --limit 5
gcloud run services update-traffic clps-copilot --project clps-compute-6z1nc --region us-east4 --to-revisions <revision>=100
```

Nothing is lost by going back. The rate limits, kept answers, the outbox and the breaker are in Redis.
An older version keys kept answers by its own code version, so it simply starts with the answers it made.

**Sending the co-pilot back to the web server.** The web server's code has no co-pilot any more, so this is
two steps, in this order. First send the web server back to a revision from before the contract pull
request, which still has the co-pilot code ("To go back by hand" above). Then set `copilot_route = "web"` in `infra/settings.auto.tfvars` and merge that (or, in a hurry, apply it from the Mac: "Applying from the Mac" below): one change to the URL map, a few minutes to reach every edge. The
web server's permission to call the model and publish questions, and its three settings, come back by
themselves in the same apply (`web_copilot_access` needs no change). That old code uses the same limits in
the same Redis keys and the same breaker. Hold deploys of `main` until the route is back on `"copilot"`.
All of it: [`ARCHITECTURE_PHASE_3.md`](ARCHITECTURE_PHASE_3.md), "The ways back".

**Which one is answering?** Only the co-pilot service has a status address:

```sh
curl -s https://lunarsightline.com/api/chat/status       # the service's status; {"error":"not-found"} means the path reaches only the web server
node web/scripts/smoke.mjs https://lunarsightline.com --copilot-service   # fails unless it is the co-pilot service
```

**If the co-pilot fails and the rest of the site works**, in this order: is the circuit breaker open (an
alert email "the circuit breaker opened", and every question answered `503` with `Retry-After` at once)?
Then the model is failing: Anthropic's status page (status.anthropic.com), the organization's rate limits and
credits in the Claude Console, and the service's log lines `"message":"model call"` (each try's status,
time and tokens). A `401` there means the sign-in failed: the Console's Workload identity page lists each
refused exchange with its reason. Otherwise: the latest deploy of
`clps-copilot`; its status (`"limits":"redis-unreachable"` means limits, kept answers and the breaker
are in each copy's memory); its log (`gcloud run services logs read clps-copilot --region us-east4`,
every line carries `"service":"copilot"`). If a drill was left on, `"model"` in the status says so; set
`copilot_model_faults = ""` and the fault-injection shares to 0 and apply.

## Redis

**Since 2026-11-18 there is no instance** (`shared_store = false`; "Settings after the event" below). Every
status then reports `"limits":"memory"` and a `redis` state of `memory`, and that is correct, not a fault.
The rest of this section describes the site with `shared_store = true`.

One Memorystore instance, `clps-web-store`, holds the rate limits, kept answers and audio, the outbox, the
circuit breaker, the single-flight locks, the hit counters and presenters' rooms. No deploy changes it: it is
Terraform's (`infra/data.tf`). The deploy workflows did not change for Phase 4.

**Is each service on Redis?** Every status has a `redis` field for the copy that answered: `state` is `redis`,
`fallback` (Redis did not answer in time and memory answered), `reconnecting` or `memory`, and
`readEndpoint` says whether there is a read endpoint. Each status asks Redis one small read first.

```sh
for path in /api/status /api/plans/status /api/chat/status; do curl -s https://lunarsightline.com$path | jq -c .redis; done
```

**Hit rates and memory**, read-only: `node web/scripts/redis-stats.mjs https://lunarsightline.com`, and
`--monitoring` for Memorystore's own metrics (needs `gcloud` signed in). The counters live in the instance
and are gone when it is replaced.

**The windows.** The instance's tier, size and read replicas are Terraform variables (`redis_tier`,
`redis_memory_gb`, `redis_read_replicas`), and the Redis Cluster is `redis_cluster`. The defaults are the
instance as it is. Changing the tier replaces the instance, and a Redis Cluster costs money while it exists:
read [`ARCHITECTURE_PHASE_4.md`](ARCHITECTURE_PHASE_4.md) first, and set them back when the window ends.

## The second region (Phase 8)

Off unless `second_region_copies` is on in `infra/settings.auto.tfvars` (planned for Friday 2026-11-13 only:
[`ARCHITECTURE_PHASE_8.md`](ARCHITECTURE_PHASE_8.md)). While it is on, `clps-web`, `clps-plans` and
`clps-copilot` also run in **us-central1**, with the same images, identities and settings, and the load
balancer sends each visitor to the nearer region. Redis, Firestore, the events worker and the bucket stay in
us-east4.

**The deploys.** Nothing changes in us-east4: no visitors, the canary tag and its tests, a tenth, everyone.
Then the step "Roll the same version out in the second region" (`web/scripts/second-region.sh follow`) deploys
the same image to the copy in us-central1 in one step, checks its `commit` label and sends it everyone, before
the tests as a visitor, which either region may answer. With the second region off the step says so and does
nothing. If any step fails, the way back puts the copy on its version from before (`second-region.sh back`)
and us-east4 on its own. The canary header reaches us-east4 only.

**Which region answered.** Every status answer has a `region` field. The watch asks all three every second:

```sh
for p in /api/status /api/plans/status /api/chat/status; do curl -s https://lunarsightline.com$p | jq -c '{region, revision}'; done
node web/scripts/region-watch.mjs https://lunarsightline.com --seconds 60
```

**Going back by hand, in us-central1.** The same commands as in us-east4, with `--region us-central1`:

```sh
gcloud run revisions list --service clps-web --project clps-compute-6z1nc --region us-central1 --limit 5
gcloud run services update-traffic clps-web --project clps-compute-6z1nc --region us-central1 --to-revisions <revision>=100
```

**A failing region.** The load balancer sets a region aside by itself after its copy answers 502, 503 or 504
three times in a row (outlier detection), for 30 s and then longer. To take a region out by hand at once, take
its endpoint group off the backend service (`gcloud compute backend-services remove-backend <service>-backend
--global --network-endpoint-group <service>-us-central1-neg --network-endpoint-group-region us-central1`) and
commit `second_region_serve` set back the same day, or the next apply puts it back. The failover drill is
`region_drill` (`ARCHITECTURE_PHASE_8.md`, section 7).

**Switching it off.** Comment out `second_region_copies` and `second_region_serve` in one pull request;
`second_region` (the subnet) at least two hours later, when Cloud Run has let go of its addresses
(`ARCHITECTURE_PHASE_8.md`, section 8).

## Deploying by hand (Rodrigo)

```sh
cd web
REPO=us-east4-docker.pkg.dev/clps-compute-6z1nc/web
TAG=$(git rev-parse --short HEAD)
gcloud auth configure-docker us-east4-docker.pkg.dev        # once per machine
docker build --platform linux/amd64 -t $REPO/clps-web:$TAG .
docker push $REPO/clps-web:$TAG
gcloud run deploy clps-web --project clps-compute-6z1nc --region us-east4 --image $REPO/clps-web:$TAG --update-labels commit=$TAG
gcloud run services update-traffic clps-web --project clps-compute-6z1nc --region us-east4 --to-latest   # if a rollback left visitors on an older version
node scripts/smoke.mjs https://lunarsightline.com --plans-service --copilot-service   # through the load balancer: its own run.app address refuses the internet since Phase 6
```

Two things to keep when deploying by hand:

- **The `commit` label.** The deploy workflows read it from the live version to know which commit is live.
  Without it the old label stays, and the next deploy compares against the wrong commit.
- **No `--tag` and no `--revision-suffix` on `gcloud run deploy`.** Either makes gcloud name the new version
  and leave that name in the service's settings. Every `terraform plan` after that wants to clear the name,
  and applying that starts one more version. To give a version a tag, do it afterwards:
  `gcloud run services update-traffic clps-web ... --update-tags canary=<revision>`.

## Infrastructure changes

Changes to `infra/` go through GitHub ([`decisions/0007-terraform-through-github.md`](decisions/0007-terraform-through-github.md),
[`ARCHITECTURE_PHASE_5_5.md`](ARCHITECTURE_PHASE_5_5.md)). Nobody needs Google Cloud access for this.

1. **Open a pull request.** If it touches `infra/`, the check `terraform plan` plans it, as an identity that
   can only read, and posts **one comment**: how many resources are added, changed and destroyed, every
   change to who has access, what the destroy guard would do, and the full plan under a fold. Each push
   updates the same comment.
2. **Read the comment, then merge.** Nobody has to approve, and nothing else stands between the merge and
   the apply. The part headed "Access this plan changes" is the part no guard checks.
3. **`main` applies it.** `.github/workflows/terraform.yml` waits for any deploy that is rolling out, makes
   a new plan with the state lock held, runs the destroy guard on that plan, and applies exactly that file.
   Then the deploys go: each deploy workflow's first step waits for Terraform.

**A setting** (a route, a copy count, a drill) is changed the same way: one line in
`infra/settings.auto.tfvars`, in a pull request. Earlier phase documents say "add it to `terraform.tfvars`
and apply". From Phase 5.5 on, read that as "change `infra/settings.auto.tfvars` in a pull request".

**When the apply is stopped.** The run "Terraform" on `main` is red and says why:

| It says | What happened | What to do |
| --- | --- | --- |
| `STOPPED: the plan deletes ...` | The destroy guard. Nothing was changed | If the removal is wanted, name the address in `infra/expected-removals.txt` in a new pull request. If not, revert the merge |
| `Instance cannot be destroyed` | `prevent_destroy` on a database, the DNS zone or an identity pool. Nothing was changed | The same, and the `lifecycle` block comes out in the same pull request |
| `Gave up after 45 minutes` | A deploy was still running | Actions, Terraform, "Run workflow" on `main`, once the deploy has ended |
| An error from Google half way through an apply | Some resources changed and some did not | Fix the cause, then "Run workflow" on `main`: Terraform carries on from what exists. If the pipeline itself is what broke, apply from the Mac |

While Terraform's last run on `main` is red, the deploys that started after it stop at "Wait for Terraform".
Starting a deploy by hand (Actions, the deploy's workflow, "Run workflow") goes ahead with a warning.

**Every night** `.github/workflows/terraform-drift.yml` plans `main` against the live project. If the plan
is not empty it opens the issue "Terraform drift: the live project does not match main", with the plan, and
updates it each night until a night's plan is empty, which closes it.

### A service pinned to an older version

When a deploy fails it sends every visitor back to the version that worked, by name. Until a later deploy
succeeds, the service stays pinned to that version. A setting Terraform changes on a pinned service (a
route's flag, a copy count, a drill) goes into a **newer version that gets no visitors**. Terraform cannot
see this: it leaves traffic to the deploys. The apply prints a warning naming the service. To check and to
fix:

```sh
gcloud run services describe clps-copilot --project clps-compute-6z1nc --region us-east4 --format 'value(spec.traffic)'
# "latestRevision: True, percent: 100" is not pinned. A revision's name with percent 100 is.
gcloud run services update-traffic clps-copilot --project clps-compute-6z1nc --region us-east4 --to-latest
```

Before `--to-latest`, know why it was pinned: the latest version carries the image the failed deploy
rejected. If that image is the problem, fix it and let the next deploy move visitors.

## Applying from the Mac

The pipeline is the normal way. The Mac is for three cases:

- **the pipeline is broken**: the applier cannot sign in, a role it needs is missing, GitHub Actions is down;
- **something is on fire** and the fix cannot wait for CI: sending a route back to the web server, for one;
- **a drill** that needs a setting for a few minutes (fault injection, `docs/ARCHITECTURE_PHASE_3.md`,
  section 7).

Claude Code runs it, as before Phase 5.5: save the plan, read every line, apply exactly that file.

```sh
gh run list --repo shackleton-station/sightline --workflow terraform.yml --limit 3    # nothing "in_progress" or "queued"
cd infra
git switch main && git pull           # or the branch that holds the fix
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
terraform plan -out=fix.tfplan        # for a drill: add  -var copilot_fault_abort_percent=50  and the like
# read every line, then:
terraform apply fix.tfplan
rm fix.tfplan
```

The settings come from `infra/settings.auto.tfvars`, which is tracked, plus the two personal lines in
`infra/terraform.tfvars`, which is not (`infra/terraform.tfvars.example`). The tracked file wins over
`terraform.tfvars` for a setting named in both; a `-var` on the command line wins over both.

**Commit the same change the same day, or the pipeline undoes it.** The pipeline applies what `main` says.
Anything the Mac applied that is not on `main` is drift: the nightly check opens an issue about it, and the
next merge that touches `infra/` puts the project back to `main`, without asking. So:

- a fix: open the pull request for it before or right after the apply, and merge it the same day. Its plan
  comment should say "No changes", which is the proof that `main` and the project agree again;
- a drill: apply again with the setting off before you walk away. A drill left on is reported that night.

**A pinned service takes no settings.** If a deploy rolled back, the service is pinned to a named version
(`--to-revisions LIVE=100`). A setting the Mac applies to it then goes into a newer version that gets no
visitors, until a deploy succeeds or someone sends traffic to the latest version. Seen on 2026-11-12 during a
drill. Check before applying to a service, and after a drill: "A service pinned to an older version" above.
The pipeline's apply prints a warning for this; the Mac does not.

If the app's safety check refuses the apply, leave the exact command for Rodrigo and carry on with what does
not need it.

## What a visitor sees during a rollout

For about a minute a deploy sends a tenth of visitors to the new version. Each version holds only its own
script files (their names carry a hash), and the load balancer sends each request to either version, so a
page from one version can ask the other for its script and be told 404. Seen on 2026-11-14: a page with no
text and no Moon for 30 seconds while a web deploy was at its tenth.

Every page now carries a few lines ahead of its own script (`web/vite.config.ts`, `HEALS_ITSELF`): when one of
its files under `/assets/` fails to load, it reloads, at most three times, a little later each time. A
reload lands on the version most visitors are on nine times in ten, and that version's files are in the
CDN. After three tries it says the site is being updated.

This narrows the gap; it does not close it. Closing it means every version can serve every version's files:
the built `assets/` copied to the bucket by each deploy and served from there (a deploy step, a grant for
the deployer to write `assets/`, and a rule or a fallback in the web server), or Cloud Run's session
affinity, which keeps a visitor on one version (one line in `infra/`, but to be tried first: the CDN does
not keep an answer that sets a cookie, and Google's page does not say which answers carry it). Neither is
done. The traffic steps are unchanged.

## A green deploy that still serves the commit before it

Known behaviour, seen on 2026-11-14: when two pull requests merge within a minute or two of each other,
the Deploy run for the first can end green while the site still serves the commit before it. The run for
the second merge then brings both. Nothing is lost and nothing needs re-running, but a check made right
after the first run turns green can look at the old page.

So after a merge, check what the site serves, not the run's colour:

- **The services** say which commit they were built from: `https://lunarsightline.com/api/plans/status` and
  `/api/chat/status` each return a `version` (the first seven characters of the commit).
- **The page** is whatever the front door's script holds. Look in it for something only your change has, a
  class name or a phrase:

```bash
curl -s https://lunarsightline.com/sightline/ | grep -o '/assets/main-[A-Za-z0-9_.-]*\.js' | sort -u
```

```bash
curl -s https://lunarsightline.com/assets/main-<the name printed above>.js | LC_ALL=C grep -c 'sl-place-names'
```

  A count of 0 means that build is not the live one yet. Wait for the newest Deploy run on `main` to end
  (`gh run list --branch main --workflow Deploy --limit 3`), then look again.
- **The check script** against the live site (`node scripts/sightline-shots.mjs --base=https://lunarsightline.com
  --only=<scene>`) is the last word: it opens the page the way a visitor's browser does.

## After the pipeline changes the terrain tiles

```sh
cd web && npm run upload-tiles
```

This copies `public/tiles/` to `gs://clps-compute-6z1nc-web-assets/tiles/`, skipping files that haven't
changed. The globe's 8K color map (`pipeline/scripts/make_color_8k.py`) goes the same way, as
`tiles/global/color/moon_color_8k.ktx2`: under `tiles/global/` because the load balancer serves only
`tiles/global/`, `tiles/polar/`, `tiles/light/` and the manifest from the bucket (`infra/assets.tf`). The 1 m photo
tiles round the ridge sites (`pipeline/scripts/make_photo_tiles.py`, 15,404 files, 176 MB) are at
`tiles/polar/photo/13/<row>/<col>.jpg`, for the same reason. Tiles are stored exactly as the pipeline wrote them (gzip files, no `Content-Encoding`), because the
page unpacks them itself. **Never upload them with `-Z`, `--gzip-local` or `--gzip-in-flight`, or set
`Content-Encoding: gzip` on them:** since Phase 6 the load balancer reads the bucket directly, and Cloud
Storage or the browser would then unpack the bytes before the page does, which breaks the 3D view.

The CDN keeps a tile for a day, as it did when the web server sent them. To have visitors see new tiles at
once: `gcloud compute url-maps invalidate-cdn-cache clps-web-https --project clps-compute-6z1nc --path "/tiles/*"`.
A file put under `tiles/global/`, `tiles/polar/` or `tiles/light/` is served to anyone by its name, whatever the
name; anything else in the bucket is not (`infra/assets.tf`).

## After the pipeline changes the light grid (the Atlas tab)

```sh
cd pipeline && uv run python scripts/make_light_grid.py && uv run python scripts/check_light_grid.py
cd ../web && npm run upload-light
```

The first command writes `web/public/tiles/light/` (one month file of about 3 MB a month for the fine grid, 288
for 2026 to 2049, and one of about 4.5 MB a month for the wide grid in `wide/`, and two slope maps; not in Git) and `web/public/data/light/` (two
small JSON files, committed). Add `--wide` to the check to validate the wide grid. The second copies the folder to
`gs://clps-compute-6z1nc-web-assets/tiles/light/`. When a run only adds months to those already live (a longer
range), run that copy with `--no-clobber` so the live files are left as they are:
`gcloud storage rsync --recursive --no-clobber public/tiles/light gs://clps-compute-6z1nc-web-assets/tiles/light`. The server serves only the names the pipeline writes
(`web/server/storage.ts`). Without these files the Atlas still opens, with the plain slope-shaded Moon and a
line saying the computed light isn't available.

## After the pipeline builds the 20 m patches

The patches are the light grid's calculation at the terrain's own 20 m, over about 3 km round each
south-pole ridge site (`pipeline/src/clps/lightgrid.py`, `patch_around`). They are built only when asked
for, and need what the light grid needs: the polar DEM and the kernels in `cache/`, and the site tracks
from `run_all.py` for the check.

```sh
cd pipeline && uv sync
uv run python scripts/make_light_grid.py --patches     # horizons, then every month, for each patch
uv run python scripts/check_light_grid.py --patches    # each patch's pixel at its site against the site's track
cd ../web && gcloud storage rsync --recursive --no-clobber public/tiles/light/patch gs://clps-compute-6z1nc-web-assets/tiles/light/patch
```

The first command writes `web/public/tiles/light/patch/<site>/<month>.bin.gz` (not in Git) and adds a
`patches` entry for each site to `web/public/data/light/meta.json` (committed: open a pull request with
it and with `validation.json`, which the check adds its own `patches` to). A stopped run resumes its
horizons; `--patches --months` redoes only the months. The "Landings that fit" layer and the Surface
view's tint read a patch once `meta.json` lists it, so upload the files before the pull request with
`meta.json` merges: a patch that is listed and cannot be read is left out, and the grid's own cells
stand there.

## After the pipeline changes the sets for other heights

```sh
cd pipeline && uv run python scripts/make_heights.py && uv run python scripts/check_heights.py
cd ../web && gcloud storage rsync --recursive --no-clobber public/tiles/light/heights gs://clps-compute-6z1nc-web-assets/tiles/light/heights
```

The first command writes `web/public/tiles/light/heights/` (not in Git): for each height in `config.OTHER_HEIGHTS`, the
same hourly files the 13 sites have at 2 m, gzipped, about 95 MB a height. `npm run upload-light` copies them too, with
the light grids; the command above copies only them and leaves files already in the bucket as they are. No page reads
them yet. They are under `tiles/light/` because the load balancer already serves that part of the bucket and the
co-pilot can already read it, so using them needs no change in `infra/`. To replace a set that is already in the bucket,
drop `--no-clobber` for that run.

## The demo video

```sh
gcloud storage cp demo.mp4 demo.vtt demo-poster.jpg gs://clps-compute-6z1nc-web-assets/media/
```

Only the names on the list are served: `demo.mp4`, `demo.vtt`, `demo-poster.jpg`, `hype.mp4`, `hype-poster.jpg`, the
tutorial video's `sightline-tutorial.mp4`, `sightline-tutorial-poster.jpg`, `sightline-tutorial.vtt` and
`sightline-tutorial.json`, the walkthrough's `sightline-walkthrough.mp4`, `-poster.jpg`, `.vtt`, `-chapters.vtt` and `.json`,
and the 30-second demo's `sightline-demo-30s.mp4`, `sightline-demo-30s-poster.jpg` and `sightline-demo-30s.vtt`
(`web/scripts/video/README.md` says how those are recorded). A file with a new name needs it added in three places:
`media_files` in `infra/assets.tf` (the route rule and the load balancer's grant), and `MEDIA_TYPES` in
`web/server/storage.ts` (the way back). The grant's condition may hold 12 "or"s at most (Google refuses a longer one at
apply, not at plan), so the videos recorded from the site are granted by their shared prefix, `media/sightline-`; a
new file with that prefix needs only its route. Replacing a file on the list keeps its name; the CDN keeps the old copy for up to an hour, or invalidate `/media/*` as for tiles above.

## Checking a running site

```sh
node web/scripts/smoke.mjs https://<site>          # cache rules, a tile, video ranges, the API's origin check, and the plans and co-pilot refusals where those services answer
node web/scripts/smoke.mjs https://<site> --ask    # also asks the model one real question (the public address, not the web server's own)
node web/scripts/smoke.mjs https://<site> --save-plan   # also saves one real plan, sends the save again, and opens it
node web/scripts/plans-check.mjs https://<site>    # only the plans API, and which service answers it
node web/scripts/chat-eval.mjs https://<site>       # 13 set questions for the co-pilot (about 3 minutes)
```

**From a laptop, since Phase 6's last step:** use the site's address. The `run.app` addresses of web, plans
and the co-pilot (their own, and each tag's) refuse requests from the internet, a laptop included; Cloud Run
answers with an error page of its own. To check the version a deploy is testing, or one a failed deploy left
tagged, add `--canary web`, `--canary plans` or `--canary copilot` to any of the commands above
("Reaching a version that is not live yet"). The events worker is the exception: its address still takes a
request with a token from an identity allowed to call it, so `web/scripts/worker-check.mjs` works as before
(`docs/decisions/0008-closing-the-side-doors.md`).

To reach a closed service's own address on purpose, the request has to start inside the project's network,
for example from a VM on the default network. There is none for this, and none is needed for any check here.
The way back to open addresses is one line (`service_ingress` in `infra/settings.auto.tfvars`;
`docs/ARCHITECTURE_PHASE_6.md`, section 4).

## Settings after the event

Since 2026-11-18 the site runs as small as it can without changing code (Rodrigo: few visitors, it was not
selected for global judging so no judging is left to stay warm for, and the credits are wanted for other
projects). All in `infra/settings.auto.tfvars`. The day before, 2026-11-17, it had already come down from
the event's settings; that step is the middle column.

| Setting | Now (2026-11-18) | 2026-11-17 | During the event | What changes for a visitor now |
| --- | --- | --- | --- | --- |
| `shared_store` | false | true | true | No Redis. Each service counts rate limits and keeps answers, voice clips, the outbox, the circuit breaker and presenters' rooms in its own memory. A copy that stops forgets them, and a daily ceiling counts from the copy's start |
| `min_instances` (web) | 1 | 1 | 2 | Still no cold start for the first screen |
| `max_instances` (web) | 1 | 3 | 10 | One copy only, because rooms live in its memory. A copy takes 80 requests at once and 60 followers' streams; past that requests wait. A deploy of the web server ends the rooms that are open |
| `plans_min_instances`, `copilot_min_instances` | 0 | 1 | 2 | Both sleep when idle. The first plan saved or opened, and the first question, after a quiet spell wait for a copy to start |
| `plans_max_instances` | 3 | 3 | 10 | Nothing. More than one copy is safe without Redis: plans and idempotency keys are in Firestore, and only the per-visitor rate limits are counted per copy (up to three times looser) |
| `copilot_max_instances` | 1 | 3 | 10 | One copy, 10 questions at once. Its ceilings are what limits spending on the model and its breaker is what stops calls to a failing model; in three memories each would be three times looser and the copies would disagree |
| `service_cpu_always_on` | false | false | true | CPU only while a request is open. A follower's stream is an open request, so following still works |
| `service_memory`, `service_cpu` | 1Gi, 1 | 1Gi, 1 | 1Gi, 1 | Unchanged |
| `redis_tier`, `redis_memory_gb`, `redis_read_replicas` | not read (BASIC, 1, false) | BASIC, 1, false | STANDARD_HA, 5, true | What `shared_store = true` would make |
| `copilot_limits` | unchanged | unchanged | unchanged | Scout's ceilings are still the loose ones set on 2026-11-16 |

**What it costs now, at list price (estimates; no billing data read):** about $43 a month. One warm copy
of the web server about $13; the load balancer about $18; the edge firewall about $9; storage, DNS, logs
and the rest about $3; plans and the co-pilot only while they answer. Before this change about $105: three
warm copies about $39 and Redis Basic 1 GB about $36, with the same $30 for the rest.

**What is given up, 2026-11-18:**

- A cold start on the first plan and the first question after a quiet spell (the measured times are in
  `docs/PROGRESS.md`, "The site runs smaller still").
- Limits and kept answers do not outlive a copy. The co-pilot's daily ceilings (`chat_all_day`,
  `ask_all_day`) count from when its copy started, and Cloud Run stops an idle copy within about 15 minutes, so on a quiet
  day they reset often. The hard stop on spending is, as before, the monthly limit in the model provider's
  console.
- A question event still waiting in the outbox is lost if the co-pilot's copy is killed before it sends it
  (it sends what is waiting when it is told to stop).
- Rooms end with a deploy of the web server, and during a deploy's tenth-of-visitors minute a follower can
  land on the version that does not hold the room.
- The deploy checks of the plans and co-pilot services expect what the settings say: `memory` while
  `shared_store = false`, `redis` otherwise (`web/scripts/shared-store.mjs`).

**To go back** to 2026-11-17: `shared_store = true` first (Terraform makes a new, empty Basic 1 GB instance
in about five minutes and gives every service its address in the same apply), and only then the second
column's copies, in the same pull request or a later one. No line in `infra/expected-removals.txt` is
needed to add an instance.

**How the switch went, 2026-11-18:** one pull request through the pipeline. A plan saved on the Mac first
and read line by line: the Redis instance destroyed, the three services changed in place (their two Redis
settings gone, the copy counts, and for plans and the co-pilot the path into the project's network that
only Redis needed; the web server keeps its own subnet), nothing else, no access changes. The pull request
names the instance in `infra/expected-removals.txt`, which the destroy guard requires.

**How the switch went, 2026-11-17:** applied from the Mac first (a saved plan, read line by line: three
services changed in place, one Redis instance replaced, no access changes), then put on `main` by the pull
request that added this section, whose plan was "No changes". The new Basic instance was made before the
Standard one was deleted. Checked on the live site afterwards: `web/scripts/smoke.mjs` with a saved plan
and two co-pilot answers (39 checks passed), every status on the new Redis, pages and status in 115 to
190 ms, the first load in headless Chrome with all 75 requests answered, and `web/scripts/follow-check.mjs`
with 54 checks passed and 4 failed, all on the Atlas page's time controls (the script looks older than that
page; it was not run before the change, so that is not proven).

**What it cost on 2026-11-17, at list price (not re-checked, no billing data read):** three warm copies
with CPU only during requests, about $1.30 a day; Redis Basic 1 GB, about $1.18 a day. About $2.50 a day
for these two, against about $17 during the event. The load balancer, the edge firewall, the CDN, storage
and DNS are as they were.

**To go back** to the event's settings: the values in the table's fourth column, in a pull request, with
`shared_store = true`. Redis on the Standard tier is a new instance.

## Hackathon settings

From 2026-11-13 to 2026-11-17 the demo ran as the hackathon project should (Rodrigo: this demo is the
reference the new project is built from). What follows is the record of those settings; what runs now is
in "Settings after the event" above. All in `infra/settings.auto.tfvars`, applied through the pipeline (pull requests 171
and 172). The variables' defaults are the cheap ones, so taking a line out goes back to them.

| Setting | Value | Default | Why |
| --- | --- | --- | --- |
| `min_instances`, `plans_min_instances`, `copilot_min_instances` | 2 | 0 | No visitor waits for a cold start, and losing one copy loses nothing. Cloud Run spreads copies across zones |
| `max_instances`, `plans_max_instances`, `copilot_max_instances` | 10 | 3 | Headroom for a room of judges and phones; also the ceiling on what a spike can cost |
| `service_cpu_always_on` | true | false | CPU stays allocated between requests, so follow-the-presenter's streams, the outbox relay and timers never run throttled |
| `service_memory` | 1Gi | 512Mi | Headroom for open streams and caches |
| `service_cpu` | 1 | 1 | Node.js runs one main thread: add copies, not vCPUs. Startup CPU boost is always on |
| `redis_tier`, `redis_memory_gb`, `redis_read_replicas` | STANDARD_HA, 5, true | BASIC, 1, false | A failover costs about 12 s of reconnecting instead of losing every limit, kept answer and room; kept answers are read from the replica |
| `copilot_limits` | 15 and 100 chats a minute and a day per address, 20 and 150 typed questions; for everyone 60 a minute, 400 chats and 600 typed questions a day | the code's (`web/copilot/limits.ts`) | A whole venue shares one address. At most about $50.78 a day of Anthropic credits |

**How the switch went, 2026-11-13:** pull request 171 at 15:53 UTC, every service on its new revision with
`min=2 max=10`, CPU throttling off and 1 GiB by 15:59. Pull request 172 at 16:00: the Standard instance was
ready in 4 min 2 s, the services moved to it, the Basic one was deleted in 2 min 43 s; a probe every 5 s
(134 probes) saw every service on Redis and every page answer 200 throughout, and the co-pilot's read
endpoint `ready` from 16:05.

**What it costs, at list price (not re-checked):** six warm copies of 1 vCPU and 1 GiB with CPU always on, about
$10.40 a day; Redis Standard 5 GB with a replica, about $6.48 a day ($5.30 more than Basic). About $17 a day
for these two on Google's credits, plus the model on Anthropic's.

**Not used for the hackathon, on purpose:** the second region and the Redis Cluster (`ARCHITECTURE_PHASE_8.md`,
`ARCHITECTURE_PHASE_4.md`). Both work and were drilled, and both add ways to fail: the second region's drill
caused a 20-minute outage. For a 36-hour build, fewer moving parts and more headroom run smoother.

**Going back to cheap** was done on 2026-11-17: "Settings after the event" above.

## Follow the presenter, in the pitch

1. On the laptop that drives the projector, open the site and press **Present**, the screen icon at the end of
   the tab bar (it shows the word on a window wider than 1,500 px). A panel
   shows a large QR code and the link in words (`https://lunarsightline.com/?follow=<room>`), with how many
   people are following. Leave it up while the room scans. "Hide the code" puts it away; "Show code", in the
   line under the tabs, brings it back.
2. Drive the site as usual. Every phone goes where the laptop goes: the tab, the site, the month, the hour, the
   limits, the Atlas's coloring, and the way the Surface faces. Dragging time moves the phones about once a second.
3. "Stop presenting" ends it for everyone, and each phone keeps the page it is on. A room also ends 10 minutes
   after the laptop's page is closed or asleep, and 3 hours after it started; press Present again for a new one
   (a new code).

What does not follow, because it is not in a page's address: the co-pilot's conversation, which way a 3D view is
turned (except on the Surface), a spot tapped on the Atlas, Scout's close-up of the ground, the side of Mission
control's panel, and how far the Briefing, the tour or a video has played (each phone's own starts from the
beginning, in silence until its owner taps). Someone following can still tap and scroll their own page; the presenter's next change moves
them again.

Before the pitch:

- **Keep a copy warm**: `min_instances = 1` (above), so the first scan doesn't wait for a cold start.
- **Mind the room's Wi-Fi.** The edge firewall allows 120 API calls a minute from one address, and a room on one
  Wi-Fi is one address. Each phone uses about one a minute and one or two more per change of tab; the laptop up to
  60 a minute while time is playing. About 20 phones on the room's Wi-Fi are comfortable and 30 is the edge;
  beyond that some phones fall a little behind after a change of tab and catch up by themselves. For a bigger
  room, put the laptop on a phone's hotspot and ask people to scan on mobile data. A firewall rule giving
  `/api/rooms/<id>/events` its own, higher limit would remove the ceiling. It is not declared: loosening the
  firewall is Rodrigo's decision.
- **Try it once on the live site with two phones.** Two copies of the server passing changes through Redis is
  covered by tests with a stand-in for Redis and has never run for real, and no real phone has followed yet.
  `node web/scripts/follow-check.mjs --base=https://lunarsightline.com` runs the same three-window check
  against the live site (about five minutes; it starts one room and ends it). It has only been run against a
  local server, where all three windows have one address: on the live site the firewall counts them together.
- **To switch it off**: `follow = false` in `infra/settings.auto.tfvars`, in a pull request. `/api/rooms` then answers 503
  and Present says presenting is unavailable. `/api/status` shows `follow` with where rooms are kept (`redis`
  or `memory`) and how many streams that copy holds.

## How the co-pilot signs in to Claude

The co-pilot calls Claude on the Anthropic API (`docs/decisions/0009-copilot-on-claude.md`) and signs in by
Anthropic's **workload identity federation**: no key is stored anywhere. When it first needs to, the
service asks Google's metadata server for an identity token for its own service account
(`clps-copilot@clps-compute-6z1nc.iam.gserviceaccount.com`), addressed to `https://api.anthropic.com`, and
trades it at Anthropic's token endpoint for an access token. A federation rule in the Claude Console
allows exactly that account (its numeric id and its email). The SDK keeps the access token and trades a
fresh Google token shortly before it runs out (the rule's token lifetime, 600 s unless the rule says
otherwise; a Google token lasts about an hour). Nothing is written to disk or logged.

**The settings** are four identifiers from the Console's Workload identity page, not secrets, in
`infra/settings.auto.tfvars`: `anthropic_federation_rule_id` (`fdrl_...`), `anthropic_organization_id` (a
UUID), `anthropic_service_account_id` (`svac_...`) and, if the rule needs one, `anthropic_workspace_id`.
Terraform passes them to the service as `ANTHROPIC_*` settings. **They must be filled in before the pull
request that switches the co-pilot to Claude is merged**: without them the service starts with no model,
answers `503 not-configured`, and the deploy's checks fail and roll back.

**When sign-in fails** (the log's `model call` lines show `"status":401`, and every question answers
`502 upstream`): the Console's Workload identity page, "Authentication history", gives the reason for each
refused exchange. The usual causes: the rule's `sub` or `email` does not match the account, or the
audience differs. The service asks for the token with `format=full`, which puts the `email` claim in.

**Revoking access** is in the Console: disable the federation rule (or the Anthropic service account). The
service's access token then stops working within its lifetime, 600 s at most by default.

**On a laptop**, either sign in the same way, with gcloud making the identity token by impersonating the
co-pilot's account (your Google account needs Token Creator on it):

```sh
ANTHROPIC_FEDERATION_RULE_ID=fdrl_... ANTHROPIC_ORGANIZATION_ID=... ANTHROPIC_SERVICE_ACCOUNT_ID=svac_... \
ANTHROPIC_IDENTITY_FROM_GCLOUD=clps-copilot@clps-compute-6z1nc.iam.gserviceaccount.com npm run dev:server
```

or export your own `ANTHROPIC_API_KEY` in your shell (never in a file in the repository). The federation
settings win when both are set. The service refuses `ANTHROPIC_IDENTITY_FROM_GCLOUD` on Cloud Run.

**The Secret Manager secret `anthropic-api-key`** (pull request 141) was made for a key before the captain
chose federation. It never held a version and nothing read it, so it was removed on 2026-11-13 with the
applier's `roles/secretmanager.admin` and the planner's two read permissions for it. The Secret Manager API
stays on. If a key is ever needed again, it goes back the same way, through Terraform, with Rodrigo's OK.

## After any failed deploy: is the service pinned?

A deploy that fails sends every request back to the version that was live when it started, by name. From then
on the service is pinned: a new version made later (by Terraform, or by hand) gets no requests. This caused a
20-minute outage of the web server on 2026-11-13 (`ARCHITECTURE_PHASE_8.md`, section 11). After a failed deploy,
check which revision has the traffic, and whether that revision is the one you want (read the revision, not the
service's template):

```sh
gcloud run services describe clps-web --project clps-compute-6z1nc --region us-east4 --format json \
  | jq '[.status.traffic[] | select((.percent // 0) > 0) | {revision: .revisionName, latest: (.latestRevision // false)}]'
```

`latest: false` means pinned. To unpin, run the service's deploy again from `main` (Actions, the service's Deploy
workflow, Run workflow), which ends by sending traffic to the latest tested version. In a hurry, send traffic to
a known-good revision by name with `gcloud run services update-traffic ... --to-revisions <name>=100`.

