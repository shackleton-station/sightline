# Decision 0008: closing the side doors

**Status:** applied and checked on the night of 2026-11-12 to 13: all five steps through the Terraform
pipeline. What each showed is in [`../ARCHITECTURE_PHASE_6.md`](../ARCHITECTURE_PHASE_6.md), section 8.

## The decision

Every visitor's request passes the load balancer and its edge firewall (Cloud Armor). The web, plans and
co-pilot services stop answering the internet on their own `run.app` addresses (Cloud Run's ingress
"internal and Cloud Load Balancing"). The deploys test each new version through the load balancer, with a
plain header that sends a request to the version tagged `canary`. Terrain tiles and video come straight from
the bucket through Cloud CDN, with no server in the path. The events worker keeps its public ingress, behind
its identity check.

## Why

The edge firewall is the outer of three layers of limits (by address at the edge, then per visitor in Redis,
then the co-pilot's daily cost ceiling). A `run.app` address skipped the first. Anyone who found it could send
3,000 requests a minute without the ban, and the edge's rate limit on the API did not apply. The services'
own limits still held, but a layer that can be walked round is not a layer. With the addresses closed, the
only way in for a visitor is the way that is measured, logged and limited.

## The canary header is not a secret

The plan's first version said "a header the deploy knows". The repository keeps no secrets (decision 0001's
"no stored keys"), and the workflows that send the header are public files. So the header is plain and
documented: `x-clps-canary: web`, `plans` or `copilot`.

What someone gains by sending it: they reach the next version of the site before it is rolled out, through
the same edge firewall, with the same limits, the same sign-in check and the same costs as everyone else.
That version serves the same public site. So it is harmless. A system with a private next version (a feature
not yet announced, a migration half done) would need more: a signed header, an allow-list of addresses on the
canary backend, or Identity-Aware Proxy. None of them is worth it here.

Each service has its own value, not one for all. With one value, a web deploy's test of `/api/plans` would
reach whatever revision the plans tag happens to be on, which can be older than the live one. With a value
per service, a header moves only its own service's paths.

## How the URL map changed shape

Only route rules can match a header, and one path matcher holds either path rules or route rules, never both.
So the plans and co-pilot path rules became route rules with the same paths, beside the canary rules. The
fault drill moved with the co-pilot's rule and stays on it alone, so a drill never breaks a deploy's tests.
All 32 combinations of the five routing switches were planned. Priorities are the order: canary before live
for each service, the web server's canary last, so it never catches another service's paths.

## The web server's status calls: through the network, from a subnet of its own

The web server asks plans and the co-pilot for their status on their `run.app` addresses, with an identity
token (Phase 3). Once those addresses are closed, a call counts as internal only if it travels through a VPC
network (Cloud Run, "Receive requests from other Cloud Run resources"). The web server sent only private
addresses through the network (`PRIVATE_RANGES_ONLY`, for Redis), so its calls went out to the internet and
would have been refused.

Google offers three ways. What was weighed:

| Way | For | Against |
| --- | --- | --- |
| **All traffic through the network, with Private Google Access on the subnet** (chosen) | One setting on one service. Only the web server's traffic moves. No DNS to keep | Everything the web server calls goes through the network. With no Cloud NAT, an address outside Google would not answer. It calls nothing outside Google (checked in `web/server/` and `web/shared/`); a future call to one needs Cloud NAT or this switched off |
| Private Google Access, and a private DNS zone that resolves `run.app` to `private.googleapis.com` | The web server keeps `PRIVATE_RANGES_ONLY` | A DNS zone on the default network changes `run.app` for everything on it: the pipeline VM, and the other services. Two more resources to explain |
| Private Service Connect or an internal load balancer in front of plans and the co-pilot | The textbook "private front door" | An endpoint or a second load balancer per service, for a status page. Out of all proportion |
| Ask through the public load balancer instead (`https://shackletonstation.dev/api/plans/status/web`) | No network change at all | The status check then passes the edge firewall and the co-pilot's fault drill, so the How it works page would report a drill as the service being down. It is service-to-service traffic leaving Google's network to come back in, which is what the plan said not to do |

Private Google Access is a setting of a subnet. The default subnet does not have it, and it is not in Terraform:
the pipeline VM, plans, the co-pilot and Redis's peering use it. Changing it by hand would be drift Terraform
cannot see. So the web server gets a subnet of its own, made and owned by Terraform, with the setting on. That
needs the applier to manage networks (`roles/compute.networkAdmin`), which is consistent with how its other
roles were chosen (decision 0007) and adds no reach it did not have.

## The events worker stays as it is

Pub/Sub push would still reach the worker with "internal" ingress: Cloud Run counts Pub/Sub in the same
project as internal (its ingress page lists Pub/Sub among the Google services that count). So the push alone
is not the reason.

The reason is the deploy. It tests each new version of the worker from GitHub's runners, on the internet, with
the deployer's token, before the version gets a single message: that it refuses a caller with no identity,
reports the right commit and data, refuses a message from anyone but Pub/Sub, and counts a made-up event
exactly once in the real database. With "internal" ingress none of that can run. The ways round it are worse
than the door they close: a load balancer backend for the worker would give it the public address it is
meant not to have; publishing a test message on the real topic would put a fake question in the question log
and the day's counts; running the check from inside Google needs a job or a VM to maintain.

And there is no edge firewall to skip. The worker is not behind the load balancer at all. Its door is Cloud
Run's identity check: no `allUsers` grant, so Cloud Run refuses every request without a Google-signed token
from an identity allowed to call it, before the worker's code runs, and the code then accepts only the push
identity's messages. That is the documented alternative to internal ingress for Pub/Sub ("supports both
`internal` and authentication").

**What would change this:** a deploy test that does not need the internet (a Cloud Run job in the project that
runs `worker-check.mjs`), at which point "internal" costs nothing.

## Tiles and video from the bucket

The plan listed this as the better answer for tiles and video than a service: "point the load balancer
straight at the bucket". Version 3 of the plan asked to keep the allow-list or say what replaced it.

| What `web/server/storage.ts` did | What does it now |
| --- | --- |
| Served a name only if it matched a pattern (`TILE_KEY`) or a list of five (`MEDIA_TYPES`); anything else 404 | Two layers. The route rules send only the three tile prefixes, `tiles/manifest.json` and the five media names to the bucket; any other path under `/tiles` or `/media` still reaches the web server, which refuses it. And the load balancer's grant on the bucket has a condition with the same names, so a wrong route still cannot read anything else |
| Sent tiles as raw gzip bytes with no `Content-Encoding`: the page unpacks them | The objects carry no `Content-Encoding` (checked on 2026-11-12), so Cloud Storage sends the bytes as they are, with no decompressive transcoding. Cloud CDN does not compress or decompress unless told to, and the backend buckets say `compression_mode = "DISABLED"` |
| Answered `Range` with `206` for the video | Cloud Storage does, and Cloud CDN caches objects that support ranges in pieces (up to 100 GiB) |
| `Cache-Control: public, max-age=86400` for tiles, `3600` for video | `FORCE_CACHE_ALL` with a default and client time of a day for tiles and an hour for video. Needed, because a private object comes from Cloud Storage as `private, max-age=0`, which any other mode would obey and never cache. Two backend buckets on one bucket, because the times differ |
| Ran behind the edge firewall's 3,000-a-minute ban | Nothing. A backend bucket can only take an edge security policy, which has no rate limits. The backend policy never applied to answers from the CDN's cache anyway (Cloud Armor: "backend security policies are enforced only for cache miss requests"), which were 90.7% of tile requests in the baseline. What goes is the ban on cache misses, and those now cost a Cloud Storage read and no server time |

**What a visitor can reach that they could not before.** Inside `tiles/global/`, `tiles/polar/` and
`tiles/light/`, any object, not only names matching the pattern. On 2026-11-12 all 6,423 objects in the
bucket matched it, so today the set is the same. What changes is the rule: a file uploaded under those prefixes
is public without a code change. **What they cannot reach:** anything else in the bucket, and the bucket's
listing. A missing tile name now answers `403` from Cloud Storage instead of `404` from the server.

**What it costs.** No new fixed charge: a backend bucket has no copies and no idle cost. Each cache miss is one
Cloud Storage read, which the web server made before too. The web server no longer spends copies on tiles and
video: a page opening the 3D view asked it for about 80 tiles at once.

**What it does not do.** The web server's tile and media code stays, so going back is one line. The copilot's
read of the light grid is its own (a conditional grant on `tiles/light/`), and is unchanged.

## What this does not protect against

- **The canary header reaches an untested version.** By design, and harmless here (above).
- **Inside Google's network the addresses are still open.** "Internal" includes any VPC network in the
  project and Google services in the project. Anyone who can run something in the project can reach the
  services directly; they could also change the services.
- **The worker's door is identity only.** A stolen token of an identity allowed to call it gets in from
  anywhere. Same as before this phase.
- **A merged change to the switches applies without a reader.** Decision 0007's price: reopening the addresses
  is one line in a pull request whose plan comment shows it.

## What would make us undo it

- A need to call something outside Google from the web server, without wanting Cloud NAT: switch its egress
  back (only after reopening the addresses, or moving the status calls).
- Tiles or video needing per-visitor logic (a signed link, a paywall, a per-user rate): back to the server for
  those paths, or signed URLs on the backend bucket.
