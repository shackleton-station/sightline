# Architecture, Phase 1: applying and checking the events worker

For whoever applies this phase and for Rodrigo. What was built and why is in
[`decisions/0002-events-worker.md`](decisions/0002-events-worker.md). This file is the order to do things in,
every grant the apply creates, how the first image gets deployed, and the five checks that say the phase is
done, each with what a pass looks like.

**State on 2026-11-12, evening:** applied, deployed and checked. Both applies were run by Claude Code from a
saved plan that was read line by line first (Rodrigo's decision that day). The worker runs the image
`events-worker:d2a433e`. All five checks were run against the live site; the results are in
[section 6](#6-results-of-the-checks-2026-11-12). One checklist row stays open by its nature: the worker's
timeout and concurrency are starting values until it has had a week of traffic.

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
W=clps-events-worker                 # the Cloud Run service
SUB=clps-web-events-to-worker        # the push subscription
DLQ=clps-web-events-refused          # the dead-letter subscription (it already exists)
SITE=https://shackletonstation.dev
```

---

## 1. The order (expand first)

Two applies, with the first deploy between them. Nothing in either removes a grant or a resource.

| Step | What | Why in this order |
| --- | --- | --- |
| 1 | **Apply A**, with `-var events_worker_push=false` | Creates the identities, their grants, the `stats` database and the worker's service. Terraform starts the service on Google's placeholder image, and that image would answer "done" to any message, so nothing is subscribed to it yet |
| 2 | **Merge the pull request** | CI runs, then two workflows: `Deploy` puts the site's new code live in its usual steps, and `Deploy events worker` finds the placeholder live, builds the worker's first image, tests it on its own address, and moves it to live |
| 3 | **Check the worker** is running the real image (command below) | The subscription must not exist while the placeholder is live |
| 4 | **Apply B**, with no `-var` | Creates the push subscription, Pub/Sub's permission to acknowledge on it, and the two alerts. From this moment events are counted |
| 5 | **The five checks** (section 4) | |

If the pull request is merged before Apply A, nothing breaks: the worker's workflow ends with a warning that
the service does not exist. Run it by hand after Apply A (Actions, "Deploy events worker", "Run workflow").

Either order of the site's deploy and Apply B is safe. A site still on the old code publishes events with no
id of their own, and the worker then counts them by Pub/Sub's message id.

### Apply A

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
terraform plan -var events_worker_push=false -out=phase1a.tfplan
# read every line, then:
terraform apply phase1a.tfplan
```

The plan must say **12 to add, 2 to change, 0 to destroy**. That is what it said on 2026-11-12 against the
live state. The two changes, and what to look for:

- `google_bigquery_table.questions[0]` **updated in-place**: one new column, `id`, NULLABLE, last in the
  schema. If the plan says the table "must be replaced", stop: a replacement deletes the question log.
- `google_cloud_run_v2_service.web` **updated in-place**: one new setting, `STATS_DATABASE = "stats"`, and
  the revision name cleared (expected, see the comment in `infra/main.tf`). This starts a new revision of the
  site with the image that is already live.

### After the merge: is the real image live?

```sh
gcloud run services describe $W --project $P --region $R --format json \
  | jq '{url: .status.url, traffic: .status.traffic, image: .spec.template.spec.containers[0].image}'
```

**Pass:** the image is `us-east4-docker.pkg.dev/clps-compute-6z1nc/web/events-worker:<commit>`, not
`us-docker.pkg.dev/cloudrun/container/hello`, and it has 100% of the traffic. The workflow run is green and
its step "Test the new version on its own address" shows seven lines starting `ok` and none starting `FAIL`.

### Apply B

```sh
terraform plan -out=phase1b.tfplan
terraform apply phase1b.tfplan
```

The plan must say **4 to add, 0 to change, 0 to destroy**: the subscription, one grant on it, two alert
policies. (Run in one go from nothing, the whole phase is 16 to add and 2 to change.)

### To switch it off again

- `events_worker_push = false` and apply: the subscription and the alerts go; the worker stays, idle. Events
  published while there is no subscription are never delivered to the worker. They are still in BigQuery.
- `events_worker = false` and apply: the worker, its identities, their grants, the subscription and the
  alerts all go, in one apply. The `stats` database, its counts and the site's read-only grant stay. The How
  it works page then shows the last counts of each day and nothing new.

---

## 2. Every grant the apply creates

Seven grants. No existing grant is changed or removed.

| # | Apply | Who | Role | On what | Why |
| --- | --- | --- | --- | --- | --- |
| 1 | A | `clps-events-worker@…` (the worker's identity, new) | `roles/datastore.user` | The project, with the condition "only the database `stats`" | The worker writes the counts. It is the only writer |
| 2 | A | `clps-events-worker@…` | `roles/cloudtrace.agent` | The project | The worker writes a trace per message |
| 3 | A | `clps-web@…` (the site's identity, existing) | `roles/datastore.viewer` | The project, with the condition "only the database `stats`" | The site reads the counts for the How it works page. It cannot write them |
| 4 | A | `clps-events-worker-push@…` (the push identity, new) | `roles/run.invoker` | The Cloud Run service `clps-events-worker` | Pub/Sub delivers as this identity. It can do nothing else anywhere |
| 5 | A | `service-919194174067@gcp-sa-pubsub.iam.gserviceaccount.com` (Pub/Sub's own account) | `roles/iam.serviceAccountTokenCreator` | The service account `clps-events-worker-push` only | So Pub/Sub can sign each push as the push identity. Google's documentation says projects created after 2021-04-08 already allow this through Pub/Sub's service-agent role, so this is very likely redundant here. Declared so the dependency is written down |
| 6 | A | `clps-web-deployer@…` (GitHub Actions, existing) | `roles/iam.serviceAccountUser` | The service account `clps-events-worker` only | A deploy has to hand the service its identity |
| 7 | B | Pub/Sub's own account | `roles/pubsub.subscriber` | The subscription `clps-web-events-to-worker` | To take a message off the subscription once it has been moved to the dead-letter topic |

Two that already exist and are relied on:

- Pub/Sub's own account may publish to the dead-letter topic `clps-web-events-refused` (`infra/events.tf`).
- The deployer's project-wide `roles/run.developer` includes the permission to call any Cloud Run service in
  the project (`run.routes.invoke`; checked with `gcloud iam roles describe roles/run.developer`). So the
  deployer can already call the worker, and no grant was added for the deploy's tests. It also means "only the
  push identity may call it" is not true at the level of permissions. The worker's own code makes it true for
  messages: `/push` accepts only the push identity, and the deploy checks on every run that it refuses the
  deployer.

One thing a person needs: whoever runs Apply B must be allowed to act as the push identity
(`iam.serviceAccounts.actAs`), because creating a push subscription with an identity requires it. A project
owner has it.

What the apply creates besides grants: two service accounts, the Firestore database `stats`, two
time-to-live rules on it (`seen.expires`, `shards.expires`), the Cloud Run service, the push subscription,
and two alert policies that email the existing channel.

---

## 3. Deploying the worker

Normally nobody does anything: a merge to `main` that touches the worker's files, the shared folder
(`web/shared/`), the site data or `web/package*.json` deploys it, after CI. A merge that touches none of
them does not. The steps and the rollback are in [`DEPLOY.md`](DEPLOY.md), "The events worker".

By hand, the first time or any time (it needs Docker and access to the project):

```sh
cd web
COMMIT=$(git rev-parse --short HEAD)
IMAGE=us-east4-docker.pkg.dev/$P/web/events-worker:$COMMIT
gcloud auth configure-docker us-east4-docker.pkg.dev
docker build --platform linux/amd64 -f events-worker/Dockerfile --build-arg VERSION=$COMMIT -t $IMAGE .
docker push $IMAGE
gcloud run deploy $W --project $P --region $R --image $IMAGE --no-traffic --tag canary
# test it on its own address, as yourself:
URL=$(gcloud run services describe $W --project $P --region $R --format 'value(status.url)')
curl -s -H "authorization: Bearer $(gcloud auth print-identity-token)" "${URL/https:\/\//https://canary---}/status"
gcloud run services update-traffic $W --project $P --region $R --to-latest
```

The self-check (`POST /selfcheck`) only answers the deployer's identity, so by hand it answers 403. The
status call above is the test a person can run.

---

## 4. The five "done when" checks

Run them after Apply B, in this order. Each says what it changes on the live project.

A way to ask the co-pilot a question that costs nothing, used below. It is the baseline's cached first
question, so the model is not called. At most 6 a minute.

```sh
ask() { curl -s -o /dev/null -w '%{http_code} x-cache=%header{x-cache}\n' -X POST \
  -H 'content-type: application/json' -H "origin: $SITE" \
  -d '{"messages":[{"role":"user","text":"How much sunlight does Connecting Ridge get in May 2027?"}],"view":"#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn"}' \
  "$SITE/api/chat"; }
counts() { curl -s "$SITE/api/stats" | jq -c '{day, counts}'; }   # up to 30 s old
```

### (a) With the worker stopped, messages wait in the queue and drain when it returns

Changes: the worker gets a setting, `PAUSED=on`, for a few minutes. Two cached questions are logged.

```sh
counts                                                        # note "questions"
gcloud run services update $W --project $P --region $R --update-env-vars PAUSED=on
gcloud run services update-traffic $W --project $P --region $R --to-latest
ask; ask                                                      # two questions while it is stopped
sleep 90; counts                                              # still the first number
gcloud run services logs read $W --project $P --region $R --limit 10   # "paused: message refused"
gcloud run services update $W --project $P --region $R --remove-env-vars PAUSED
sleep 240; counts
gcloud pubsub subscriptions pull $DLQ --project $P --limit 5   # reading does not remove anything
```

**Pass:** the two `ask` lines say `200`. While paused the count does not move, and the worker's log shows
`paused: message refused`. After the pause is lifted the count is exactly **2 higher**, and the last command
lists nothing.

**The time limit, and why.** A paused worker refuses each delivery, and after five refusals Pub/Sub moves a
message to the dead-letter topic. The retry policy waits at least a minute between tries, so five tries take
at least four minutes. Lift the pause within three minutes of the first `ask`. This is the honest shape of
"messages wait": they wait as long as five tries take, and after that they wait in the dead-letter
subscription for a week, where they can be read and published again. The exact waits between tries are not
documented by Google, only that they grow from the minimum (60 s here) to the maximum (600 s).

To hold messages with no time limit (to test the 10-minute alert, say), stop the delivery and not the
worker. The subscription becomes one that waits to be asked, and no try is counted. Not run:

```sh
URL=$(gcloud run services describe $W --project $P --region $R --format 'value(status.url)')
gcloud pubsub subscriptions modify-push-config $SUB --project $P --push-endpoint=""
# ... ask, wait as long as wanted, then put it back exactly:
gcloud pubsub subscriptions modify-push-config $SUB --project $P --push-endpoint="$URL/push" \
  --push-auth-service-account=clps-events-worker-push@$P.iam.gserviceaccount.com --push-auth-token-audience="$URL"
cd infra && terraform plan      # must show no change to the subscription
```

### (b) The same message sent twice counts once

Changes: two rows in the question log with the same id and the question "phase 1 duplicate check", and one
question in today's counts.

```sh
counts
ID=$(uuidgen | tr 'A-Z' 'a-z')
MSG='{"kind":"copilot_question","id":"'$ID'","at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","question":"phase 1 duplicate check","site":"connecting-ridge","month":"2027-05","lookups":[],"cached":true,"ms":0,"outcome":"answered"}'
gcloud pubsub topics publish clps-web-events --project $P --message "$MSG" --attribute kind=copilot_question
gcloud pubsub topics publish clps-web-events --project $P --message "$MSG" --attribute kind=copilot_question
sleep 45; counts
gcloud run services logs read $W --project $P --region $R --limit 5
bq --project_id $P --location $R query --use_legacy_sql=false \
  "SELECT COUNT(*) AS rows_in_the_log FROM \`$P.site_events.copilot_questions\` WHERE id = '$ID'"
```

**Pass:** `questions` and `cached` are each exactly **1 higher**, not 2. The worker's log has one line
`question counted` and one `question already counted`, with two different message ids. BigQuery says 2 rows:
the log is not an idempotent consumer, which is what the `id` column is for.

This publishes the same event as two messages, which is what the outbox relay does when it sends twice.
Pub/Sub delivering one message twice cannot be forced by hand; the worker's tests cover it, and check (a)
exercises real redeliveries.

Every deploy also runs this check without any real message: the worker's self-check counts one made-up event
twice on a scratch day in the real database and fails the deploy unless it was added once and refused once.

### (c) A malformed message lands in the dead-letter topic after 5 tries, and the alert fires

Changes: one or two messages in the dead-letter subscription until they are removed, and one or two alert
emails. No row in the question log: the table refuses this message too.

```sh
gcloud pubsub topics publish clps-web-events --project $P \
  --message '{"kind":"copilot_question","at":"not a time","question":"phase 1 malformed check"}' --attribute kind=copilot_question
# wait: five tries take at least 4 minutes, and can take about 15
gcloud run services logs read $W --project $P --region $R --limit 20 | grep 'cannot be counted'
gcloud pubsub subscriptions pull $DLQ --project $P --limit 10 --format json \
  | jq '.[].message.attributes | {CloudPubSubDeadLetterSourceSubscription, CloudPubSubDeadLetterSourceDeliveryCount}'
```

**Pass:** the worker's log shows `event cannot be counted` with `"why":"no time"` and `attempt` rising from
1 to 5. The pull then lists a message whose source subscription is `clps-web-events-to-worker` with a
delivery count of 5. An email arrives from Google Cloud Alerting about the policy "clps-web: a message is in the dead-letter
topic" (its subject line is the condition's name, "Anything waiting in the dead-letter subscription"), some
minutes after the message does (section 6 has the times seen). Today's counts did not move.

Two things to expect. The BigQuery subscription refuses the same message (its `at` is not a time) and sets
it aside too, sooner, so there are two messages in the dead-letter subscription, one from each subscription.
And the email "a message has waited more than 10 minutes" may also arrive if the five tries took longer
than that. Both are the alerts working.

Then clear it. This removes the test messages for good, and the alert closes by itself:

```sh
gcloud pubsub subscriptions pull $DLQ --project $P --limit 10 --auto-ack
```

### (d) The site's response times match Phase 0

Changes: nothing but the baseline's own requests (about 600 to the site, 12 cached questions logged).

Run steps 1, 3 and 5 of [`ARCHITECTURE_BASELINE.md`](ARCHITECTURE_BASELINE.md), section 1.8, from the same
laptop and connection as the baseline. Step 5, the cached co-pilot question, is the one this phase touched:
it now writes to the outbox before it answers.

| What | Baseline, 2026-11-12 | Pass |
| --- | --- | --- |
| A page and the data files (step 1) | median 38 and 42 ms in two runs | A median inside or near that spread. The two baseline runs differ by 4 ms from each other |
| Opening a saved plan (step 3) | median 178 ms, 95th percentile 251 ms | The same, within the spread a second run shows |
| A cached co-pilot question (step 5) | median 201 ms, 95th percentile 320 ms, n = 10 | The same, within the spread a second run shows. Ten requests is a small sample: run it twice |

And the outbox's own cost, from the server's traces (read-only). The new step is called `outbox`:

```sh
curl -s -G "https://cloudtrace.googleapis.com/v1/projects/$P/traces" \
  -H "authorization: Bearer $(gcloud auth print-access-token)" \
  --data-urlencode view=COMPLETE --data-urlencode pageSize=300 --data-urlencode 'filter=span:outbox' \
  --data-urlencode "startTime=$(date -u -v-6H +%Y-%m-%dT%H:%M:%SZ)" \
  | jq -r '[.traces[]?.spans[] | select(.name == "outbox" or .name == "question log" or .name == "answer cache") | .name]
      | group_by(.) | map("\(.[0]): \(length)") | .[]'
```

That lists how many of each step the last six hours hold (before this phase: `answer cache` and
`question log` only). For their times, open one trace in the console's Trace explorer
(filter `span:outbox`): **pass** is the `outbox` step taking about as long as `answer cache` beside it, which
was 1 ms (median) before this phase, and the worker's step `events-worker: count a question` showing in the
same trace as the visitor's request.

### (e) The checklist every service must pass before it takes traffic

| Item (plan, section 7) | State | How to see it |
| --- | --- | --- |
| Its own identity, with only the permissions its code uses | Done: exactly two roles, read back after the apply | Section 2. `gcloud projects get-iam-policy $P --flatten 'bindings[].members' --filter 'bindings.members:clps-events-worker@' --format 'table(bindings.role, bindings.condition.title)'` must list exactly two roles |
| Its own image, Dockerfile and deploy workflow, with the stepped rollout and automatic rollback | Done. The workflow ran on the merge of pull request 123 and passed | `web/events-worker/Dockerfile`, `.github/workflows/deploy-events-worker.yml`. There is no "a tenth" step, and the workflow says why |
| A status address reporting its version and data version | Done | `GET /status` |
| Graceful shutdown on SIGTERM | Built. `docker stop` on the real image: exit 0 in 0.1 s | `web/events-worker/index.ts` |
| A request timeout and a concurrency setting chosen from measurement | **Open.** 30 s and 20 are starting values. There is no traffic to measure yet | After a week: the worker's request times and instance count in Cloud Run's metrics |
| Joins the request's trace through Pub/Sub message attributes; logs carry the service's name | Done: seen live, section 6 | Check (d). Every log line has `"service":"events-worker"` |
| Its own objective and alert: oldest waiting message, anything in the dead-letter topic | Done: both alert policies exist; section 6 says what was seen of them | Checks (a) and (c) |
| Unit tests; a contract test; the smoke test extended | Done | `web/events-worker/*.test.ts`, `web/shared/*.test.ts`, `web/server/outbox.test.ts`. The worker has no public address, so the smoke test reaches it the only way a visitor can: `GET /api/stats` on the site |
| The edge firewall policy attached to its backend | Does not apply | It has no backend on the load balancer and no public access. Cloud Run refuses callers without permission |
| One command runs everything locally; a Compose file runs the real images | Done, both run on 2026-11-12 | `npm run dev:server` in `web/`; `docker compose up --build` at the top |
| A rollback in `DEPLOY.md` and a decision record | Done | `DEPLOY.md`, `decisions/0002-events-worker.md` |

**Pass:** every row is "Done", "Declared" and then confirmed after the apply, or "Does not apply". One row
stays open by its nature until the worker has had traffic.

---

## 5. What has only been tested, not run for real

Said plainly, so nobody finds out during the apply.

- **Pub/Sub pushing to the worker with a signed token** has never happened. Google's documentation does not
  say whether Cloud Run hands a service account's token to the container with its signature intact or
  removed, so the worker handles both. The first sign is the deploy's own test: it must be refused as the
  wrong caller (403), which shows the worker can read who is calling from a real token. If Pub/Sub's pushes
  were refused, check (a)'s "drain" would fail and the messages would be in the dead-letter subscription.
- **The real Firestore database.** The store ran against Google's emulator and inside the real image. The
  access conditions on the `stats` database and the time-to-live rules are only declared.
- **The deploy workflow** has never run, including the step that gets an identity token from GitHub's
  sign-in.
- **The outbox on the real Redis.** It ran against Redis 7.2 in Compose (kept, published, removed, and
  drained after the worker came back) and against a stand-in in the unit tests. The timer that picks up
  events left behind has not run under Cloud Run's rule of giving CPU only during requests.
- **The alerts** have never fired.
- **The How it works page** was looked at in a browser against a local server with sample counts, at desktop
  and phone widths. Not on the live site.

---

## 6. Results of the checks, 2026-11-12

Run by Claude Code against the live site between 18:20 and 18:45 UTC, from Rodrigo's laptop, with the
commands in section 4. Times are UTC.

**The applies.** Apply A: 12 added, 2 changed, 0 destroyed. Apply B: 4 added, 2 changed, 0 destroyed (the
push subscription, grant 7, and the two alerts). The two "changed" in each were only the revision name
Terraform clears on the Cloud Run services. The seven grants in section 2 are the only access created. Read
back afterwards: the worker's identity holds exactly `roles/cloudtrace.agent` and `roles/datastore.user` with
the condition "only the `stats` database"; the push identity holds no project role and is the only member
allowed to call the worker; the site's identity gained only `roles/datastore.viewer` on `stats`.

**The first real message.** One new question to the co-pilot at 18:21, answered by the model in 4.6 s. The
count on `/api/stats` went from 0 to 1 within 33 s (the address may be 30 s old). That was the first push
from Pub/Sub with a signed token, the first write to the real `stats` database and the first read of it by
the site.

| Check | Result | What was seen |
| --- | --- | --- |
| (a) Worker stopped: messages wait, then drain | **Pass** | Paused at 18:24:57. Two questions asked, both answered `200` (the first by the model, the second from the cache). The worker logged `paused: message refused` for each at 18:25:01 and again at 18:26:07 and 18:26:13. After 90 s the count was still 1. Pause lifted at 18:26:42. Both were counted on their third try, at 18:27:45 and 18:27:54. Questions 1 to 3, cached 0 to 1. Nothing in the dead-letter subscription |
| (b) The same event twice counts once | **Pass** | Two messages with one event id. Questions 3 to 4 and cached 1 to 2. The worker logged `question counted` for one message id and `question already counted` for the other, both at 18:31:44. The question log has 2 rows with that id, as expected |
| (c) A malformed message ends in the dead-letter topic, and the alert fires | **Pass** | Published at 18:31:54. The worker logged `event cannot be counted`, `"why":"no time"`, five times: 18:31:54, 18:33:14, 18:34:57, 18:36:43, 18:39:00. The message reached the dead-letter subscription at 18:42:12 with a delivery count of 5 and the source `clps-web-events-to-worker`. The BigQuery subscription had set its copy aside at 18:33:24. The alert email arrived at 18:41:46, about 8 minutes after the first of the two landed; the metric it watches first showed 1 at 18:38. The counts did not move. Both test messages were then removed |
| (d) Response times match Phase 0 | **Pass** | Table below |
| (e) The checklist | **Pass**, one row open by its nature | The table in section 4, updated |

**The waits between tries, as seen.** The retry policy says 60 s at least. In (a): 66 and 72 s between the
first and second try, about 100 s to the third. In (c): 80, 103, 106 and 137 s, then 192 s more before the
message was moved. So "five tries" took 7 minutes here, and 10 minutes until the message was in the
dead-letter subscription. A pause of under 3 minutes is safe; one of 7 is not.

**(d) in numbers.** Same laptop and connection as the baseline, same commands.

| What | Phase 0 baseline | After Phase 1 |
| --- | --- | --- |
| A page and the data files (step 1; 543 requests in 20 s, none refused or failed) | median 38 and 42 ms in two runs | median 39 ms, 95% under 44 ms |
| Opening a saved plan (step 3, n = 30) | median 178 ms, 95th percentile 251 ms | median 188 ms, 95th percentile 247 ms |
| A cached co-pilot question (step 5, n = 10, run twice; all 24 requests `200` and from the cache) | median 201 ms, 95th percentile 320 ms | median 200 and 208 ms, 95th percentile 238 and 245 ms |

The cached question is the request this phase touched (it now writes to the outbox before it answers). Its
median moved by less than the difference between the two runs.

**The outbox's own cost, from the server's traces.** The 14 traced co-pilot requests of the evening: the
`outbox` step took a median of 2 ms and at most 6 ms, next to `answer cache` at 1 ms and `rate limits` at
2 ms. The worker's step, `events-worker: count a question`, took a median of 73 ms and at most 179 ms, nearly
all of it the write to Firestore; no visitor waits on it. It appears inside the visitor's own trace in all 9
requests asked after the push subscription existed (created 18:20:52). The other 5 are the deploy's set
questions, asked at 18:17 and 18:18, before it did.

**What section 5 said had only been tested, now.**

| Item | Now |
| --- | --- |
| Pub/Sub pushing with a signed token | Runs. Every count above came through it |
| The real Firestore database, its access conditions | Runs. The time-to-live rules exist; nothing is old enough to have been removed by them yet |
| The deploy workflow | Ran once, on the merge, and passed |
| The outbox on the real Redis | Runs for the ordinary path: 14 traced writes. **Still not seen live:** an event that fails to publish and is sent later by the timer. Check (a) stops the worker, not the publish, so it does not exercise it |
| The alerts | The dead-letter alert fired and its email arrived. The "waited more than 10 minutes" alert was not seen to fire: the malformed message waited 10 min 18 s on the worker's subscription, which is at the edge of what a metric sampled each minute catches. To see it fire, hold delivery as section 4 (a) describes |
| The How it works page on the live site | Opened in a browser at `/#how` after the checks: it showed 28 questions, 26 from the cache (93%), and zero in the other three, the same as `/api/stats`. Not looked at on a phone |

**Left on the live project by these checks.** In today's counts: 28 questions, 26 of them from the cache, every
one asked by these checks (1 to see the first count, 2 in (a), 1 in (b), 24 in (d)). In the question log:
the same questions, with 2 rows for "phase 1 duplicate check". The worker has two more revisions than it started with (one paused, one
not), on the same image.
