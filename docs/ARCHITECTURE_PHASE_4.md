# Architecture, Phase 4: Redis with a replica, one recompute per key, and a Redis Cluster window

For whoever applies this phase and for Rodrigo. What was built and why is in
[`decisions/0006-redis-replica-and-cluster.md`](decisions/0006-redis-replica-and-cluster.md). This file is
the order to do things in, what each `terraform plan` showed or should show, what visitors see at each step,
the grants (none), the "done when" checks as commands with what a pass looks like, the two drills, what each
window costs, and what has only been tested.

**State on 2026-11-13:** done. Both windows ran on the live project through the Terraform pipeline
(pull requests 139 and 163 to 166) and are closed: the live instance is Basic, 1 GB, one node again, and no
Redis Cluster exists. What each step showed is in section 9. Numbers marked "laptop" were measured with the
real images in Docker Compose on Redis 7.2, not on Memorystore; section 9's are from the live site.

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
I=clps-web-store                     # the Redis instance on Basic; clps-web-store-standard-ha during the replica window
C=clps-web-cache                     # the Redis Cluster, during its window only
SITE=https://shackletonstation.dev
```

---

## 1. What was built

| Piece | Where |
| --- | --- |
| Two connections: the primary for every write, script, limit, lock, counter, room and publish/subscribe; the read endpoint for cached values only, when `REDIS_READ_HOST` is set | `web/shared/redisClient.ts`, `web/shared/redisStore.ts` (`getFromReplica`) |
| A read-endpoint failure falls back to the primary, then to this copy's memory | `cache.get` in `web/shared/redisStore.ts` |
| A request during a failover does not hang: a quiet connection makes the store rest on memory for 2 s, three slow calls in a row ask for a new connection, reconnects wait at most 2 s | `web/shared/redisStore.ts` (`REST_MS`, `SlowRedis`), `reconnectDelayMs` in `web/shared/redisClient.ts` |
| Expiry with jitter: every cache write lasts its base time plus or minus 10%, chosen per write | `web/shared/jitter.ts`, used by `cache.set` in both stores |
| One recompute per key ("single flight") for the co-pilot's first questions, one lock for every copy | `web/shared/singleFlight.ts`, `settle` in `web/copilot/chat/handler.ts` |
| Hits and misses per kind of key, and what each single flight did, counted in Redis per UTC day | `web/shared/cacheStats.ts`, `GET /api/chat/status/cache`, `web/scripts/redis-stats.mjs` |
| A truthful store state on every status (`redis`, `fallback`, `reconnecting`, `memory`) | `redis` field on `/api/status`, `/api/plans/status`, `/api/chat/status` |
| The failover watch | `web/scripts/failover-watch.mjs` |
| The co-pilot's kept answers on a Redis Cluster, behind `CACHE_CLUSTER_HOST`, falling back to the ordinary instance | `web/copilot/clusterCache.ts` |
| The cluster drill: `MOVED` with a plain client, the cluster client, hash tags, a reshard followed key by key | `web/copilot/clusterDrill.ts`, built into the co-pilot image as `cluster-drill.cjs` |
| Compose: a primary and a replica; a second file with a three-shard cluster and a spare node | `docker-compose.yml`, `docker-compose.cluster.yml` |
| Terraform: the instance's tier, size, read replicas and range as variables (defaults: today); `REDIS_READ_HOST` on the web server and the co-pilot; the cluster, its network policy and the drill job behind `redis_cluster = false` | `infra/data.tf`, `infra/variables.tf`, `infra/main.tf`, `infra/copilot.tf`, `infra/redis-cluster.tf`, `infra/outputs.tf` |
| The contract | `web/copilot/API.md` (the cache status, the `redis` and `answers` fields, the waiting step), `web/plans/API.md` (the `redis` field). Additive only |

Not built, on purpose: single flight for spoken audio (decision 0006 says why), soft expiry with
`expires_at` (decision 0006), and a log-based metric for hit rates (the counters do the job at this traffic).

### First: the code goes live with nothing switched on

Merging the branch deploys the three services as usual. With the default variables Terraform changes
nothing, so the instance stays Basic and no service gets `REDIS_READ_HOST` or `CACHE_CLUSTER_HOST`. What
changes for a visitor: nothing they can see. Each cache write now has a jittered expiry, the counters start
counting, and a room of people asking the same new first question makes one model call instead of one each.
Do this first and leave it at least a day: that day is the "before" for the hit rates (check (a)).

---

## 2. The replica window (plan steps 1, 2, 6 and 7)

The order: read the baseline, switch on, measure, fail over once, read the numbers, switch back. Each switch
**replaces** the instance.

### What the documentation says, checked 2026-11-12

- "It is not possible to upgrade from Basic Tier to Standard Tier or the other way around" (Google's page on
  tiers). So the tier change is a new instance with a new address and nothing in it.
- Read replicas need the Standard tier, nodes of 5 GB or more, and a reserved range of `/28` or larger; "Smaller
  ranges like `/29` are not supported for this feature". Today's instance has a `/29` (the plan shows
  `effective_reserved_ip_range`). The new instance is given a fresh range: `redis_reserved_range` is empty, so
  Memorystore picks a free `/28`. The connection mode does not change: `DIRECT_PEERING` supports read
  replicas, which answers Version 3's question.
- "Once read replicas are enabled on an instance read replicas can no longer be disabled for that instance."
  Going back is a second replacement either way, because the tier changes too.
- On a failover "all client connections to the primary endpoint are disconnected", and some to the read
  endpoint. "The failover usually completes in under 30 seconds" (read replicas page). The manual failover
  page says "a short connection reset of a couple of minutes or less" and that "The IP address and connection
  string remain the same".
- **How long creating an instance takes is not stated** on any page read. The first Basic instance here took
  about five minutes (`infra/README.md`); a Standard instance with a replica is a different shape, so time it:
  the apply prints how long each resource took.

### Step 0: read the baseline

Check (a) below, at least a day after the code went live. Write the numbers down: the counters live in the
instance and are gone when it is replaced.

### Step 1: switch on

```sh
cd infra
# add to terraform.tfvars:
#   redis_tier          = "STANDARD_HA"
#   redis_memory_gb     = 5
#   redis_read_replicas = true
terraform plan -out replica.tfplan
```

What the read-only plan showed on 2026-11-12 (with `-var` flags instead of the file), first on the branch
cut from `ad168ae`: **`Plan: 1 to add, 4 to change, 1 to destroy.`** The parts that are this phase's:

- `google_redis_instance.store[0] must be replaced`, because of `tier = "BASIC" -> "STANDARD_HA" # forces
  replacement`. Also `memory_size_gb 1 -> 5`, `read_replicas_mode "READ_REPLICAS_DISABLED" ->
  "READ_REPLICAS_ENABLED"`, `replica_count 0 -> 1`, and `host`, `port`, `read_endpoint`,
  `effective_reserved_ip_range` all `(known after apply)`.
- `google_cloud_run_v2_service.web` and `.copilot[0]`: `REDIS_HOST` and `REDIS_PORT` become `(known after
  apply)`, and `REDIS_READ_HOST` and `REDIS_READ_PORT` are added.
- `google_cloud_run_v2_service.plans[0]`: `REDIS_HOST` and `REDIS_PORT` become `(known after apply)`. No read
  endpoint: plans reads no cache.
- `google_cloud_run_v2_service.worker[0]`: only `revision -> null`. That line was on all four services in
  every plan that day, the default one included: it is left by the deploys, which name each revision, and it
  is not this phase's.
- Outputs: `redis_host` changes, `redis_read_endpoint` and `redis_shape = "STANDARD_HA, 5 GB, 1 read
  replica(s)"` appear.

**Read every plan against `main`'s.** Later the same day, after merging `main` at `62a0668`, the same plan
said `1 to add, 9 to change, 36 to destroy`. The extra lines were not this phase's: the plan with the
defaults said `0 to add, 9 to change, 35 to destroy` on this branch and exactly the same on `main` itself
(Phase 5.5's 33 resources were applied from its own branch and are not in `main`'s Terraform yet, plus
settings `main` changes on the budget, the alert policies and the services). The only difference between
this branch's default plan and `main`'s was the new output `redis_shape`. So before applying, run the plan
on `main` too, and apply only when the difference is the lines above.

Read the saved plan for the same lines, then `terraform apply replica.tfplan`.

**The address the services get:** a new private address for the primary endpoint, and a second one, the
read endpoint, for the web server and the co-pilot. Both are known only after the apply:
`terraform output redis_host redis_read_endpoint`.

**What breaks for visitors, and for how long.** (Corrected on 2026-11-12, when the first plan through the
pipeline showed it.) Terraform makes the new instance first and deletes the old one last, because the uptime
check makes its replacement first and that order passes down to Redis. So the instance's name carries its
tier (`clps-web-store`, `clps-web-store-standard-ha`), and the two exist side by side for a while. The text
below was written for the other order: creates the new one, then rolls each service to a revision with
the new address. From the destroy until each new revision serves, every copy finds Redis gone:

- Pages, plans and the co-pilot keep answering. Limits are counted in each copy's memory (up to three times
  looser with three copies), every first question misses and calls the model, and the breaker is per copy.
- **Follow the presenter is down.** Present answers 503 and the page says "Presenting is not available right
  now. Try again in a moment." A presenter already presenting sees "Presenting · reconnecting…"; followers
  keep the page they are on and see "Connecting to the presenter…". When Redis is back their room is not:
  the new instance is empty, so the presenter's page says "Your presentation has ended. Press Present to start
  another."
- Lost with the old instance: kept answers and audio, the hit counters, the breaker's state, and any question
  event still waiting in the outbox (normally none for more than a moment).

How long that is depends on how long Memorystore takes to create a Standard instance, which no page states.
Do it at a quiet hour and not during a presentation.

### Step 2: measure

Check (b) during the window, after a day of traffic if the window is two days. Also
`node web/scripts/redis-stats.mjs $SITE --monitoring`, which adds how far the replica is behind.

### Step 3: the failover drill

Check (c). One manual failover, with the watch running.

### Step 4: switch back

```sh
# remove the three lines from terraform.tfvars (or set them back to BASIC, 1, false)
terraform plan -out basic.tfplan
```

This plan cannot be run read-only today, because it plans against the Standard instance that the window
creates. What it should show: `google_redis_instance.store[0] must be replaced` (`tier "STANDARD_HA" ->
"BASIC" # forces replacement`, `memory_size_gb 5 -> 1`), `REDIS_READ_HOST` and `REDIS_READ_PORT` removed from
the web server and the co-pilot, a new `REDIS_HOST` on all three, so `1 to add, 3 or 4 to change, 1 to
destroy`. If it shows anything else, stop. Visitors see the same as in step 1, for as long again. Then check
(e).

### The way back at any point

`terraform apply` with the defaults (step 4). Nothing is lost that is not lost anyway: everything in Redis
can be rebuilt or is a count.

---

## 3. The Redis Cluster window (Version 3)

After the replica window, on the Basic instance. The order: on, drill, reshard, drill again, off.

### What the documentation says, checked 2026-11-12

- A cluster is reached through Private Service Connect. "For each combination of a network, region, and
  service class, you can create only *one* policy", with the service class `gcp-memorystore-redis`. Each
  cluster gets a pair of endpoints in the network: a discovery endpoint and one more.
- Creating one needs the Memorystore for Redis, Network Connectivity and Service Consumer Management APIs.
  Replicas per shard: "Accepted values are `0`-`5`".
- `redis-shared-core-nano`: 1.4 GB, "only for development or testing purposes", and it "doesn't have an SLA".
- **The smallest shard count is not stated** on the pages read. Two is used. If the API refuses it, use 3
  (`redis_cluster_shards = 3`) and reshard to 4.
- How long a create or a reshard takes is not stated.

### Step 1: on

```sh
# add to terraform.tfvars:  redis_cluster = true
terraform plan -out cluster.tfplan
```

What the read-only plan showed on 2026-11-12: **`Plan: 6 to add, 4 to change, 0 to destroy.`**

| Resource | What |
| --- | --- |
| `google_project_service.cluster_apis["networkconnectivity.googleapis.com"]` | Already on in the project; declaring it is harmless. `disable_on_destroy = false` |
| `google_project_service.cluster_apis["serviceconsumermanagement.googleapis.com"]` | Switched on. Stays on after the window |
| `time_sleep.cluster_apis_ready[0]` | 60 s, because an API says it is on before it accepts calls |
| `google_network_connectivity_service_connection_policy.redis_cluster[0]` | `clps-web-redis-cluster`, service class `gcp-memorystore-redis`, the default network, the default subnet of us-east4 |
| `google_redis_cluster.cache[0]` | `clps-web-cache`: `shard_count = 2`, `node_type = "REDIS_SHARED_CORE_NANO"`, `replica_count = 0`, `AUTH_MODE_DISABLED`, `TRANSIT_ENCRYPTION_MODE_DISABLED`, deletion protection off, Private Service Connect on the default network |
| `google_cloud_run_v2_job.cluster_drill[0]` | `clps-cluster-drill`: the co-pilot's live image, `node cluster-drill.cjs before`, as `clps-copilot@…`, Direct VPC egress (private ranges only) on the default network, 600 s, no retries |

The four in-place changes: the co-pilot gets `CACHE_CLUSTER_HOST` and `CACHE_CLUSTER_PORT` (the discovery
endpoint, known after apply); the other three show only the `revision -> null` line from section 2. With
`-var redis_cluster_shards=3` the plan is the same with `shard_count = 3`. After merging `main` at `62a0668`
the plan said `6 to add, 9 to change, 35 to destroy`: the same six to add, and otherwise `main`'s own plan
(section 2).

**Grants: none.** The job runs as the co-pilot's identity, which needs nothing to reach Redis (Redis asks for
no identity here). The person applying needs to be able to create a service connection policy and switch on
an API; the project's owner can.

**The image must be from after Phase 4.** The job takes the co-pilot service's image as Terraform last saw it
(`copilot:ad168ae` in the plan on 2026-11-12, an image from before this phase, which has no
`cluster-drill.cjs`). Deploy Phase 4 first. Each plan reads the image the co-pilot is running then, so the
job gets it.

**What visitors see:** nothing. Only the co-pilot's kept answers move. The first question after the switch
misses once per question (the cluster starts empty) and the answer is kept on the cluster. If the cluster is
not ready yet the co-pilot says `"answers": "cluster-connecting"` and uses the ordinary instance.

Check after the apply:

```sh
curl -s $SITE/api/chat/status | jq '{answers, redis}'      # "answers": "cluster" on every copy asked
gcloud redis clusters describe $C --region $R --project $P --format 'value(state,shardCount,nodeType)'
```

### Step 2: the drill, before

```sh
gcloud run jobs execute clps-cluster-drill --region $R --project $P --args before --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="clps-cluster-drill"' \
  --project $P --freshness 15m --order asc --limit 200 --format 'value(textPayload)'
```

It prints the slot map, twelve keys written by a plain client (most refused with `MOVED <slot> <address>`),
the same keys through the cluster client, hash tags and a `CROSSSLOT` refusal, and the repository's own
scripts running on the cluster. It writes only `clps:drill:*` keys, which expire in an hour.

### Step 3: the reshard

Start the watch, then change the shard count:

```sh
gcloud run jobs execute clps-cluster-drill --region $R --project $P --args watch,540     # no --wait
# in terraform.tfvars:  redis_cluster_shards = 3
terraform plan -out reshard.tfplan        # expected: google_redis_cluster.cache[0] updated in place, shard_count 2 -> 3
terraform apply reshard.tfplan
```

The expected plan is from the provider's documentation and Google's page on scaling a cluster; it cannot be
planned read-only before the cluster exists. If it says "must be replaced", stop: that is a new cluster, not a
reshard. The watch asks each key's old shard for it twice a second and prints `ASK` while a slot is moving and
`MOVED` once it has moved. If the reshard takes longer than the watch's 540 s, run the watch again.

### Step 4: the drill, after

```sh
gcloud run jobs execute clps-cluster-drill --region $R --project $P --args after --wait
```

Then read the logs as in step 2. It prints which of the twelve keys moved shard, and that each still has its
value.

### Step 5: off

```sh
# remove redis_cluster and redis_cluster_shards from terraform.tfvars
terraform plan -out nocluster.tfplan
```

What it should show: the cluster, the policy, the job and the sleep destroyed; the two APIs leave the state
but stay on (`disable_on_destroy = false`); the co-pilot loses `CACHE_CLUSTER_HOST`. So `0 to add, 1 to 4 to
change, 6 to destroy`. Visitors see one miss per question on the next ask, as at step 1. Check:

```sh
gcloud redis clusters list --region $R --project $P                                   # empty
gcloud network-connectivity service-connection-policies list --region $R --project $P # empty
curl -s $SITE/api/chat/status | jq .answers                                           # "redis"
```

### Hash tags, and scripts with more than one key

A script runs on one shard, so every key it names must be in one slot, or Redis refuses it with `CROSSSLOT`.
A hash tag puts keys in one slot on purpose: when a key contains `{...}`, only the part inside the braces is
hashed. The repository's scripts each name one key (the sliding-window limit, the breaker's compare-and-set,
the lock's release), so each would run on a cluster as it is. The design that would need a tag is one that
was not built: releasing the lock and keeping the answer in one script would name `clps:lock:<key>` and
`clps:cache:<key>`, which land in different slots unless both are written as, say, `clps:lock:{copilot:<hash>}`
and `clps:cache:{copilot:<hash>}`. Decision 0006 has the slots from the drill.

---

## 4. Every grant

None, in either window. Said plainly:

- **Redis asks for no identity.** Every service reaches it over the private network, as before. The read
  endpoint and the cluster's discovery endpoint are more private addresses, not permissions.
- **The drill job** runs as `clps-copilot@…`, which holds what Phase 3 gave it and nothing new.
- **Two APIs** are switched on by the cluster window (one was already on), and one network policy is created.
  Neither is a grant to an identity.

---

## 5. What it costs

From Google's public prices for us-east4 as given in the brief on 2026-11-12. Google's pricing pages could not
be read by this check (they returned "not found" to an automated reader), so the rates were not re-checked.

| | Nodes | Per hour | A two-day window |
| --- | --- | --- | --- |
| Today: Basic, 1 GB | 1 | 1 GB × $0.049 = **$0.049** | $2.35 |
| Replica window: Standard, 5 GB, 1 read replica | 2, each billed | 5 GB × $0.027 × 2 = **$0.27** | $12.96, which is $10.61 more than staying on Basic |
| Cluster window: 2 shards of `redis-shared-core-nano`, no replicas | 2 | 2 × $0.0318 = **$0.0636** | not meant to last that long |
| During the reshard: 3 shards | 3 | **$0.0954** | |

A cluster window of two hours, one of them at three shards, is about $0.16, on top of the Basic instance. The
drill job is billed only while it runs (a few minutes of one CPU and 512 MiB). The cluster's two Private
Service Connect endpoints are not counted: the cluster's pages state no charge for them, and it was not
confirmed either way. The real cost of each window is read afterwards (check (d)).

---

## 6. The "done when" checks

Each has the command and what a pass looks like. (a) to (e) are the plan's; (f) and (g) are the cluster
window's.

### (a) Hit rates before the window

```sh
node web/scripts/redis-stats.mjs $SITE
node web/scripts/redis-stats.mjs $SITE --monitoring --minutes 60
```

Pass: rows for `copilot` and, if anyone used the voice, `speak`, with reads, hits, misses and a hit rate for
today and yesterday, and Redis memory in use. Write the table down, with the time. The plan's 80/20 test: a
small set of first questions should serve most reads. If the hit rate is low, change what is kept, not the
size of the instance.

What can be said already: on 2026-11-12 at 22:01 UTC Cloud Monitoring showed 6.4 MB in use of 1 GB (0.62%) and
11 connected clients. The instance's own `cache_hit_ratio` read 0.0% then (and 81.8% at 21:12): it counts
every key lookup together (limits, the breaker, locks), so it is not a number about the cache. The live site
has no `/api/chat/status/cache` until Phase 4 is deployed, so there is no per-kind baseline yet.

### (b) Hit rates during the window

The same two commands, before step 4. Pass: the same table, read before the instance is replaced. With a
5 GB node, memory will be a smaller share; the number of bytes is what to compare.

### (c) The failover timing, and what visitors saw

```sh
node web/scripts/failover-watch.mjs $SITE --seconds 300 | tee failover-$(date -u +%Y%m%d-%H%M).txt
# in a second terminal, once the watch has printed its first lines:
gcloud redis instances failover $I --region $R --project $P --data-protection-mode limited-data-loss
```

The watch sends, every 2 s, a status request to each service, a presenter's move to a room that does not
exist (a 404 is Redis answering) and a plan read; every 15 s one set question whose answer is kept. It prints
a line when an answer changes and a summary at the end.

Pass: the summary's last line says every service reported `redis` again, and from when; the only `failed`
lines are `web rooms` (503 while Redis is away); plans reads stay `ok`; the question stays `200`. Write down:
the time `gcloud` returned, the first and last moment anything was not `redis`, and how many requests failed.
Expect under 30 s from the read replicas page, or "a couple of minutes or less" from the manual failover page.
The address does not change, so no deploy is needed.

On a laptop (section 7) the same watch through a stopped primary showed every service `reconnecting` within
2 s and `redis` again within about 1 s of Redis returning.

### (d) The cost of each window

```sh
gcloud redis instances describe $I --region $R --project $P --format 'value(createTime,tier,memorySizeGb,replicaCount)'
```

The window's hours are from the Standard instance's `createTime` (read during the window) to the time the
switch-back apply finished. Pass: hours × $0.27 written down, and the same for the cluster from `gcloud redis
clusters describe $C ... --format 'value(createTime)'` to its delete. When billing data can be read
(Phase 0 could not), compare with the bill.

### (e) The instance back on Basic

```sh
gcloud redis instances describe $I --region $R --project $P --format 'value(tier,memorySizeGb,readReplicasMode)'
terraform -chdir=infra output redis_shape
curl -s $SITE/api/chat/status | jq .redis
```

Pass: `BASIC  1  READ_REPLICAS_DISABLED`; `"BASIC, 1 GB, no read replicas"`; `"state": "redis"` and
`"readEndpoint": "none"`. And `terraform plan` with the defaults shows nothing that `main`'s own plan does not.

### (f) The cluster drill showed redirects and a reshard

Pass: the "before" log has `MOVED` lines for most of the twelve keys and "12 of 12 written" for the cluster
client; the "after" log says how many keys moved shard and "12 of 12 still hold their value"; the watch
printed `MOVED` (and `ASK` if it caught a slot mid-move) for the keys that moved.

### (g) The co-pilot's answers survived the window

```sh
node web/scripts/redis-stats.mjs $SITE        # "fell back to the ordinary instance" stays 0 or small
```

Pass: no visitor saw an error; any cluster failure shows as a count of fallbacks, not as a failed question.

---

## 7. What ran on a laptop, 2026-11-12

All with the real images in Compose, Redis 7.2 (`redis:7.2-alpine`) as a primary and one replica, the
scripted model (`FAKE_MODEL=on`), on host ports 18080 to 18084 because another project held 8080 to 8083.

**One recompute per key.** Two copies of the co-pilot image and the web server's forward to the first, one
Redis, the scripted model slowed to 2 s a call (a question is two calls). 24 identical first questions at
once, each from its own address, 6 streamed, spread over the three addresses:

| | |
| --- | --- |
| Scripted model calls | 2, on one copy: one question's worth. The other copy made none |
| What the requests did (`flight:copilot:*`) | 1 led, 23 waited |
| Answers | 24 of 24 `200`, one text |
| Time | fastest 4,079 ms (the leader), median 4,303 ms, slowest 4,582 ms |
| Streamed | the leader: its lookup `step`, then the `reply`; the five streamed waiters: one `step` ("The same question was asked a moment ago: waiting for its answer"), then the `reply` |

A request that is alone pays three small Redis calls: twelve different first questions in a row, with the
model answering at once, took 50 ms (the first) and then 5 to 9 ms each, whole request.

**A primary restart standing in for a failover.** Memorystore keeps the address and promotes the replica;
Compose cannot. Three versions, each with `failover-watch.mjs` running:

| What was done to the primary | What the services said | What a visitor saw | Back on Redis |
| --- | --- | --- | --- |
| `docker compose restart redis` (under a second) | `redis` throughout: no 2-second probe landed in the gap | Nothing failed. The next question was a miss: the primary came back empty and the replica copied the empty primary | at once |
| `docker compose stop redis`, 20 s, `start` | all three `reconnecting` at the first probe (within 2 s) | Rooms 503 for the 20 s. Plans reads and statuses `ok`. A kept question was answered from the replica, `x-cache: hit`, 22 ms. After: one miss, as above | all three `redis` at the first probe after `start` returned (within 1.2 s) |
| `docker compose pause redis` (a frozen primary that keeps its connections open), 12 s | `fallback` from the first status after the freeze (319 ms, the 300 ms patience), then `reconnecting` after three slow calls | Rooms 503, the first in 621 ms, the rest at once. Statuses and plans reads `ok`, the slowest 323 ms | all three `redis` within 2.6 s of `unpause` |

One thing found and fixed by running it: before, a status said `fallback` only after a request had made a
call to Redis. With the primary frozen for 15 s, the web server and plans said `fallback` (they had requests)
and the co-pilot, which had none, said `redis` the whole time. Each status now asks Redis one small read
(bounded by the 300 ms patience) before answering, so every service said `fallback` at once on the second run.

**The Redis Cluster drill**, on three shards of `redis:7.2-alpine` in cluster mode with a fourth node outside
the cluster (`docker-compose.cluster.yml`), the co-pilot's answers on the cluster:

```
1. A plain client, connected to one node, writes twelve keys.
   clps:drill:key:00     1756  owner 172.19.0.7:6379   OK
   clps:drill:key:01     5885  owner 172.19.0.6:6379   MOVED 5885 172.19.0.6:6379
   ...
   9 of 12 were refused.
2. The cluster client: 12 of 12 written and read back, with no error shown to the caller.
3. clps:cache:copilot:abc slot 15776; clps:lock:copilot:abc slot 11428;
   clps:cache:{copilot:abc} and clps:lock:{copilot:abc} both slot 743.
   Two keys in different slots: CROSSSLOT Keys in request don't hash to the same slot
   This repository's scripts name one key each: the rate limit answered 1, the lock release 1.
After adding the fourth node and rebalancing (4,096 slots each):
   3 of 12 keys moved to another shard (key:01, key:05, key:09, all to the new node).
   12 of 12 still hold their value: the keys travelled with their slots.
```

During the reshard the co-pilot's kept answers stayed hits and none fell back. The first rebalance, started
3 s after adding the node, stopped on slot 5753 with `CLUSTERDOWN The cluster is down`: the new node did not
know the cluster yet, and the slot was left half moved (migrating on one node, importing on the other).
`redis-cli --cluster fix` finished it and the rebalance then ran; the Compose file now says to wait. With one
of four shards stopped, four questions all answered `200` in under 20 ms, and three cluster calls were counted
as having fallen back to the ordinary instance.

---

## 8. What has only been tested, not run for real

Written before the windows. Section 9 says which of these then ran for real; the ones still open are listed at
its end.

- **Memorystore with a read replica.** The read endpoint, its lag, and which connections a failover drops were
  stood in for by a Compose replica and a stopped or frozen primary. Memorystore promotes the replica and keeps
  the address; Compose brings back an empty primary. Check (c) is the first real failover.
- **How long the replacement takes**, both ways. No page states it.
- **The plans for switching back** (section 2, step 4) and **for the reshard and switching off** (section 3).
  Each needs the state the previous apply creates, so none could be planned read-only.
- **The smallest shard count.** Two is not confirmed by Google's pages; three is the fallback.
- **The drill as a Cloud Run job.** The program ran in Compose from the co-pilot image, the same way the job
  runs it. The job, its network path to the cluster's endpoints, and reading its output from Cloud Logging
  have not run.
- **The cluster client against Memorystore.** It ran against a local cluster whose nodes announce their own
  addresses. Memorystore hands out addresses through Private Service Connect; the library's `createCluster`
  reads the map from the discovery endpoint the same way, but this has not been seen.
- **The counters at real traffic.** One small write per cache read, on the primary. Measured only on a laptop.
- **Prices.** As given in the brief; Google's pricing pages could not be read to re-check them, and the
  Private Service Connect endpoints' cost is not known.

---

## 9. Results, 2026-11-12 and 2026-11-13

Every step went through the Terraform pipeline: a pull request, its plan comment read line by line, a merge,
the apply by GitHub Actions with no laptop. Each plan matched what sections 2 and 3 said it should, except the
order of the first replacement (below). A probe on the Mac read every service's status, opened a saved plan
and loaded a page about every 6 s through each replacement.

### The replica window

| Step | Pull request | What happened | How long |
| --- | --- | --- | --- |
| On | 139, merged 2026-11-12 22:47 UTC | Standard, 5 GB, one read replica created **before** the Basic instance was deleted; the three services moved to it; then the Basic one was deleted | create 3 min 53 s (22:48:07 to 22:52:00), delete 2 min 41 s |
| Hit rates | none | Read at 2026-11-13 05:18 UTC: check (b) below | |
| Failover | none | `gcloud redis instances failover --data-protection-mode limited-data-loss`, us-east4-a to us-east4-c: check (c) below | the command took 74 s |
| Back to Basic | 163, merged 2026-11-13 13:59 UTC | Basic, 1 GB created first, the services moved, then the Standard instance deleted. Plan: 1 to add, 3 to change, 1 to destroy | create 3 min 41 s (to 14:03:42), delete 3 min 18 s (to 14:07:24) |

**The order was the other way round from what section 2 expected, and better.** The uptime check is
`create_before_destroy`, and Terraform passes that order down to what it depends on: the web service, and
through it the Redis instance. Two instances cannot share a name, so the first try would have failed; the
instance's name now carries its tier (`clps-web-store`, `clps-web-store-standard-ha`). With both instances
up at once, the services moved from one to the other in a single deploy and **there was no time with no
Redis**. What visitors saw, both ways:

- Every service said `redis` throughout. The co-pilot reported its read endpoint `ready` at 22:52:07, the web
  server at 22:52:19; on the way back both said `none` by 14:04:04.
- Every plan open and page load answered `200`.
- What was lost, as section 2 said: the kept answers and audio, the counters and any open room, which lived in
  the old instance. The probe's own "start a room" calls, one every 6 s that were never ended, were refused
  with `429` from 22:48:25 by the room limits and accepted again from 22:52:19, when the services reached the
  new, empty instance. No visitor started a room in that time.

### Check (a), the hit rates before, 2026-11-12 22:42 UTC

12 reads of the co-pilot's kept answers, 4 hits (**33.3%**), three hours after the Phase 4 deploy; single
flight led all 8 misses. Redis memory 6.4 MB of 1 GB (0.62%), 13 clients. Memorystore's own "hit ratio" read
47.8%, which counts every key lookup (limits, the breaker, locks) and is not a number about the cache.

### Check (b), the hit rates during, 2026-11-13 05:18 UTC

| Day (UTC) | Kind | Reads | Hits | Misses | Hit rate |
| --- | --- | --- | --- | --- | --- |
| 2026-11-12, from 22:52 | copilot | 19 | 18 | 1 | **94.7%** |
| 2026-11-13, to 05:18 | copilot | 18 | 5 | 13 | **27.8%** |
| 2026-11-13, to 05:18 | speak | 30 | 22 | 8 | **73.3%** |

Memory 6.5 MB of 5 GB (0.13%) on each node; 10 clients on the primary and 9 on the replica; **the replica
1 s behind the primary**. The first day was the failover watch asking one set question every 15 s, so its
94.7% says the cache works, not what visitors ask. The second is closer to real use and small: 18 questions,
13 of them asked once. The plan's 80/20 test cannot be judged on this traffic. The answer is still "change what
is kept, not the size": the 5 GB node was 0.13% full, and the instance's size bought read replicas, not room.
Spoken audio does better than answers (73.3%) because the same answer is often played more than once.

### Check (c), the failover, 2026-11-12 23:00 UTC

`failover-watch.mjs`, 300 s, 774 requests, the `gcloud` command started 30 s in:

| What | Result |
| --- | --- |
| Each service's state | `reconnecting` from 48.1 s to 58.1 s into the watch: **at most 12.0 s**; every service `redis` again from 60.1 s |
| Follow the presenter (room calls) | **6 of 151 failed** with `503`: the only failures |
| Co-pilot questions | 19 of 19 answered from the cache, 177 to 265 ms |
| Plan reads, status calls | 151 of 151 each |

Google's pages said "usually completes in under 30 seconds" (read replicas) and "a couple of minutes or less"
(manual failover). From the services the break was at most 12 s; the command took 74 s to return. The
address did not change and no deploy was needed. The laptop (section 7) had predicted `reconnecting` within
2 s and back within about 1 s; the real reconnect took longer because Memorystore's promotion, not the
client, set the pace.

### Check (d), the cost of each window

| Window | Hours | Rate (section 5) | At list price |
| --- | --- | --- | --- |
| Replica: the Standard instance, 22:48:07 to 14:07:24 | 15 h 19 min | $0.27 an hour | **$4.14**, about $3.39 more than Basic for the same hours |
| Cluster, 2 shards: 14:20:02 to 14:33:17 | 13 min | $0.0636 an hour | $0.014 |
| Cluster, 3 shards: 14:33:17 to 14:50:58 | 18 min | $0.0954 an hour | $0.028 |
| The drill job | 3 runs of under a minute | billed per second | under $0.01 |

About **$4.19** for both windows at list price. Not read from the bill: billing data still cannot be read
from this project (Phase 0). Rodrigo's Billing page for 2026-11-12 and 13 is the check.

### Check (e), back on Basic, 2026-11-13 14:07 UTC

`gcloud redis instances list` shows `clps-web-store  BASIC  1  READY`. Every service's status says `redis`
with read endpoint `none`. The pipeline's next plan showed nothing of this phase's to change.

### The Redis Cluster window

| Step | Pull request | What happened | How long |
| --- | --- | --- | --- |
| On | 164, merged 14:17 UTC | The two APIs, a 60 s wait, the service connection policy, the cluster (2 shards of `REDIS_SHARED_CORE_NANO`, no replicas), the co-pilot's answers moved to it, the drill job. Plan: 6 to add, 1 to change (7 and 2 with the grant below) | the cluster 5 min 16 s (14:20:02 to 14:25:17) |
| Drill, before | none | check (f) below | under a minute |
| Reshard, 2 to 3 shards | 165, merged 14:32 UTC | `shard_count` changed in place: 0 to add, 1 to change | 3 min 1 s (14:33:17 to 14:36:19) |
| Drill, after | none | check (f) below | under a minute |
| Off | 166, merged 14:42 UTC | The cluster, policy, job and wait destroyed; the two APIs left the state and stay on; the co-pilot's answers back on the instance. Plan: 0 to add, 1 to change, 6 to destroy | the cluster deleted in 7 min 27 s (to 14:50:58). After: `gcloud redis clusters list` and `gcloud run jobs list` empty, the co-pilot says `answers: redis` |

**Two shards was allowed.** Section 8 had it as not confirmed; Memorystore made a 2-shard cluster.

**One grant the window needed and section 4 missed**, found before the merge. The pipeline's applier had no
permission to create a service connection policy (`networkconnectivity.serviceConnectionPolicies.create`):
section 4 said "no grant" because it was written for a laptop with the owner role. A second commit in pull
request 164 gave the applier `roles/networkconnectivity.admin` on the project, added three read permissions to
the planner's custom role (`redis.clusters.get`, `networkconnectivity.serviceConnectionPolicies.get`,
`run.jobs.get`), and made the wait depend on the grant so the policy is not created before the grant has
spread. Both stay, in case the
window is run again; neither touches the site.

### Check (f), the drill on Memorystore

The job ran from the co-pilot's live image as `clps-copilot@…`, through the cluster's discovery address
`10.150.0.3:6379`, and read its output from Cloud Logging. Its network path through Private Service Connect
worked on the first run.

Before, 2 shards (`10.150.0.4:11003` slots 0 to 8191, `10.150.0.4:11002` slots 8192 to 16383):

- A plain client connected to one node: **6 of 12 keys refused** with `MOVED <slot> <address>`, exactly the
  six whose slots are on the other shard.
- The cluster client: **12 of 12 written and read back**, with no error shown to the caller.
- Hash tags: `clps:cache:copilot:abc` slot 15776, `clps:lock:copilot:abc` slot 11428, and both with
  `{copilot:abc}` slot 743. A two-key script across slots: `CROSSSLOT`. The same script with a shared tag ran.

After the reshard to 3 shards: the new shard `10.150.0.4:11005` took slots 5462 to 8191 and 13653 to 16383,
half from each old shard (5461 or 5462 slots each).

```
6 of 12 keys moved to another shard. Each key's slot is the same as before: a slot never changes, its owner does.
12 of 12 still hold their value: the keys travelled with their slots.
```

Keys 01, 03, 05, 07, 09 and 10 moved, all to the new shard. On the laptop with 4 shards, 3 of 12 moved; on
Memorystore with 3, half did, which is what a third of the slots moving in from two shards predicts for twelve
keys spread evenly.

**What was not seen: `MOVED` and `ASK` during the reshard.** The "watch" step, meant to run through the
reshard and print each redirect, stopped twice with `Connection timeout` before it printed a line, both times
started during the change. It was not run again. A likely reason, not checked: the watch connects through the
discovery address while Memorystore is rewriting the slot map, and the client's 10 s connect limit is shorter
than that. The reshard was seen only as before and after.

### Check (g), the co-pilot's answers through the window

**Not exercised.** The co-pilot's status said `answers: cluster` from 14:25:29 to the switch-off, but no
question reached it in that time: Cloud Run's log shows only status calls and the deploy's smoke calls (refused
`403` and `405` by design). So there is no live evidence either way that a visitor's answer would have
survived the reshard; the laptop run (section 7) is the only one. The counters on the new Basic instance show
no cache reads for 2026-11-13.

### Still not run for real

- **`MOVED` and `ASK` caught mid-reshard**, and **a visitor's question answered from the cluster**: above.
- **The prices.** Section 5's rates are still the brief's, not re-checked, and nothing was read from the bill.
- **The hit rates at real traffic.** 18 visitor questions in a day is too few for the 80/20 test.
- **Losing the primary with no replica.** The Basic instance has none: a zone failure loses every kept answer,
  limit and room, which section 2 accepted.
