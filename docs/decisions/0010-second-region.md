# Decision 0010: a second region, for one day

**Status:** switched on, drilled and switched off on 2026-11-13 (01:25 to 03:47 UTC). Not kept. The failover
worked within 10 to 12 s but leaked a third of requests to the failed region for the whole drill, and the drill
caused a 20-minute outage of the web server through a pinned rollback: [`../ARCHITECTURE_PHASE_8.md`](../ARCHITECTURE_PHASE_8.md),
section 11. If a second region is ever kept: Cloud Run service health with readiness probes, or a 180 s base
ejection time, and deploys that stop during a drill.

## The decision

Copies of `web`, `plans` and `copilot` run in **us-central1** as well as us-east4, with the same images, the
same identities and the same settings. Each copy is a **second backend of its service's existing backend
service** on the global load balancer, so the load balancer sends each visitor to the nearest region.
**Outlier detection** on those three backend services is what makes "healthy" mean something: a region whose
copy answers 502, 503 or 504 three times in a row, as one proxy of the load balancer sees it, is set aside by
that proxy for 30 seconds. The events worker, Redis, both Firestore databases, the Pub/Sub topic, the assets
bucket and the image registry stay in us-east4.

## Why us-central1

| Region | For | Against |
| --- | --- | --- |
| **us-central1** (Council Bluffs, Iowa; chosen) | 1,578 km from us-east4 (Ashburn, Virginia): another part of the country, another grid and other weather. It is the nearer region for visitors west of about the Mississippi, so the load balancer's choice is visible, not theoretical. It has everything the copies use (Cloud Run, serverless endpoint groups, Direct VPC egress) | Every call a copy makes to Redis or Firestore crosses that distance: at least 15.5 ms more per round trip by the speed of light in fiber (section 3 of the phase doc). An East Coast visitor sent there during a failover pays that and the longer trip to Iowa |
| us-east1 (South Carolina) | Nearer to us-east4, so the copies' calls to Redis and Firestore cost less, and an East Coast visitor who fails over waits less | Both are East Coast regions: one hurricane season, one stretch of coast. From most of the country it is not the nearer region, so few visitors would ever reach it, and the load balancer's choice would barely show |
| A region abroad | Shows "nearest" for visitors from another continent | Every copy's call to Redis and Firestore would cross an ocean. The site's visitors are in the United States |

## Why a second backend, not a new backend service

The URL map, the edge firewall policy, the CDN settings and the canary routes all point at the three existing
backend services. A second backend on each changes none of them: the plans and co-pilot route rules, the
fault drill on rule 40 and the canary rules keep working as they are (decision 0008). Google's page on
serverless endpoint groups describes exactly this shape: one backend service "can have several serverless
NEGs attached to it, but only one serverless NEG" per region, and the load balancer "sends traffic to the NEG
in the closest region to minimize request latency". The page asks that all of them "represent functionally
equivalent deployments in different regions", which is why each copy reads its settings from its twin
instead of having its own.

The canary backends stay in us-east4 only. A deploy tests its new version there, as before.

## What "healthy" means here

Serverless backends have no health checks: "Health checks are not supported for serverless backends", and
without something else "a load balancer configured with a serverless NEG can't detect whether the underlying
resource is working as expected". Two things can tell it.

| Way | How it judges a region | Why it was or was not chosen |
| --- | --- | --- |
| **Outlier detection** (chosen) | From the answers themselves: consecutive 502, 503 and 504 (or connection failures) set the endpoint group aside for a while. Each proxy of the load balancer judges on its own | One block on each backend service, no code, no new cost, and it reacts to what visitors actually get. The drill makes a region answer 503, which is what it counts. The price: it learns from failures, so some visitors get the first ones ("you'll likely see some requests being sent to the unhealthy resource") |
| Cloud Run service health | From readiness probes: a region is healthy while "60% or more of its instances pass their readiness probes" | It needs a readiness probe on every service (code and Terraform for three services), at least one warm copy per region per service, and endpoint groups with no tags. It would set a broken region aside before visitors see errors. Google's page did not say whether it is generally available when it was read. Too much new surface for a one-day window the day before the hackathon. It is the better answer for a service kept in two regions, and the first thing to add if this stays |

The settings: only gateway failures count (502, 503, 504, connection errors), 3 in a row, the API's own
default; analysis every second; 30 seconds aside, then longer each time; at most 50% of a backend service's
endpoint groups aside at once, which with two means one, so the load balancer never sets both regions aside.
Not every 5xx counts, on purpose: a 500 is a bug in code that both regions run, and moving visitors would not
help. Google's page reports that a longer base ejection time (180 s) kept errors under 5% at over 100 requests a
second. 30 s was kept for the drill, so that the region comes back within a minute or two of being fixed; for
a region kept for longer, 180 s is the better start.

## Data stays in one region, and what that means

Redis, both Firestore databases (`plans` and `stats`), the Pub/Sub topic and the events worker, the assets
bucket and the image registry stay in us-east4. A copy in us-central1 reaches them across the country.

- **Every Redis and Firestore round trip from a copy is at least 15.5 ms longer** (1,578 km each way at about
  204,000 km/s in fiber). The real number has not been measured; step 3's checks measure it from the outside.
- **A loss of us-east4 is not survived.** The second region keeps the pages, the site data and the co-pilot's
  model calls answering, and loses saved plans, the day's counts, presenters' rooms and the shared limits and
  cache (section 9 of the phase doc). That is the honest scope: this phase moves where requests are served,
  not where data lives.
- **What would make data survive:** Firestore in a multi-region location (`nam5`): a database's location is
  fixed when it is made, so a new database and a copy of the plans; Redis per region, with limits and cached
  answers kept apart, or Memorystore's cross-region replication, which Google documents for Memorystore for
  Redis Cluster, not for this kind of instance; the bucket in a dual-region or multi-region location; the registry
  in a multi-region location or one per region; a second events worker. Each is a project of its own.

## The deploys

Each deploy keeps its us-east4 rollout as it is (canary through the load balancer, a tenth, everyone) and
then, if a copy exists, rolls the same image to it in one step, before the tests as a visitor that may land
in either region. If anything fails, both regions go back to their versions from before. The second region
does not get its own canary and tenth because the image has just passed those in us-east4, the window is a
day, and there is no way to send a test request to one region through the load balancer without new backend
services and rules. What it does not test: the copy's network path to Redis and Firestore, before visitors use
it. Outlier detection is the safety net for that: a copy that answers 503 because it cannot reach Redis is set
aside.

## What this does not protect against

- **The first failures of a broken region.** Each proxy of the load balancer has to see three gateway
  failures before it sets the region aside, and again after each ejection ends.
- **A region that is wrong but answers 200.** Outlier detection judges status codes, not content.
- **A loss of us-east4**, for every feature that needs Redis, Firestore or the bucket (above).
- **A bad image.** Both regions run the same one; a second region is not a second version.

## What would make us keep it, or undo it sooner

- Keep: visitors outside the East Coast, or a demo that must survive a regional problem in serving. Then add
  Cloud Run service health, raise the base ejection time, and price warm copies for the month.
- Undo sooner: the copies' cross-region calls make plans or the co-pilot slower than their objectives allow,
  or the drill shows outlier detection not acting. The way back is two lines (section 8 of the phase doc), and the subnet two hours later.
