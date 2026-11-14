# Infrastructure (Terraform)

Everything the web app needs on Google Cloud, in project `clps-compute-6z1nc`:

| File | What it creates |
| --- | --- |
| `main.tf` | The Cloud Run service `clps-web`, its identity, the image repository, and the private bucket for terrain tiles and the demo video |
| `github.tf` | Keyless sign-in for GitHub Actions (Workload Identity Federation) and the deployer identity. Which repositories are let in, here and in `pipeline.tf`, is the list `github_repositories` in `settings.auto.tfvars`: each by name and by GitHub's number for it |
| `pipeline.tf` | Terraform through GitHub: two more keyless identities, each behind an identity pool of its own. The **planner** (this repository's pull requests and `main`) reads settings, access lists and the Terraform state, and can change nothing. The **applier** (only `.github/workflows/terraform.yml`, only on `main`) can change everything here. Every grant: `docs/ARCHITECTURE_PHASE_5_5.md`, section 3 |
| `monitoring.tf` | An uptime check with an email alert, and a monthly budget alert |
| `data.tf` | Redis (Memorystore) for rate limits and cached answers shared by every copy of the server, the private network link Cloud Run uses to reach it, the Firestore database for shared mission plans (with automatic deletion after six months), and the server's access to that one database |
| `edge.tf` | Only with a domain: the edge firewall (Cloud Armor) in front of the load balancer. Limits by address, and a cross-site-scripting rule that logs without blocking. About $9 a month |
| `events.tf` | The question log: a Pub/Sub topic the co-pilot service publishes each question to, a BigQuery table (one partition a day, rows dropped after 90 days), the subscription that writes one into the other, a dead-letter topic for rows the table refuses, the access grants that needs, and three saved summaries (`questions_daily`, `lookups_by_kind`, `questions_to_review`) |
| `slo.tf` | Two service-level objectives on the Cloud Run service (99.5% of requests succeed; 90% answer within 2 s; both over 28 days), an email alert when the failure allowance is being used 10 times too fast, and the server's permission to write traces |
| `worker.tf` | The events worker: a second, private Cloud Run service that receives each co-pilot question event and keeps the day's counts. Its own identity (it can write one Firestore database and traces, nothing else), the Firestore database `stats` with two time-to-live rules, read-only access to it for the site, a push subscription on the question log's topic that delivers with a token signed by Google (retries from one minute to ten, then the existing dead-letter topic after five tries), the identity Pub/Sub delivers as, and two email alerts: a message waiting more than 10 minutes, and anything in the dead-letter topic. The steps to apply it and every grant it creates: `docs/ARCHITECTURE_PHASE_1.md` |
| `plans.tf` | The plans service: a third Cloud Run service, which answers `/api/plans`. Its own identity (it can read and write the Firestore database `plans` and write traces, nothing else), the service itself with the same private network path to Redis as the site, a second backend on the load balancer (no CDN, the same edge firewall policy), two objectives (99.5% of requests succeed; 95% answer within 1 s) with an alert, and the time-to-live rule that deletes idempotency keys a day after they were used. Three switches stage it (`plans_service`, `plans_route`, `web_plans_access`). The steps to apply it and every grant it creates: `docs/ARCHITECTURE_PHASE_2.md` |
| `copilot.tf` | The co-pilot service: a fourth Cloud Run service, which answers `/api/chat` and `/api/ask`. Its own identity (it signs in to the Anthropic API by workload identity federation, with no Google role for it; it can publish to the question topic, read the light grid's months in the bucket and write traces, nothing else), the service with its own timeout and concurrency, a third backend on the load balancer (no CDN, the same edge firewall policy), two objectives (99% of requests succeed; 90% answer within 10 s) with an alert, an alert for the circuit breaker opening, and two drills that are off by default. Three switches stage it (`copilot_service`, `copilot_route`, `web_copilot_access`). The steps to apply it and every grant it creates: `docs/ARCHITECTURE_PHASE_3.md` |
| `redis-cluster.tf` | Off by default (`redis_cluster = false`). A Memorystore for Redis Cluster for a short drill: the service connection policy Private Service Connect needs, two APIs, the cluster (two shards of the smallest node, no replicas), the co-pilot's `CACHE_CLUSTER_HOST`, and a Cloud Run job that runs the drill from the co-pilot's image. No grant. Steps and costs: `docs/ARCHITECTURE_PHASE_4.md`, section 3 |
| `domain.tf` | Only when `domain` is set: the Cloud DNS zone (DNSSEC on), a global load balancer with CDN in front of Cloud Run, a Google-managed HTTPS certificate, and the HTTP-to-HTTPS and `www` redirects. The URL map's route rules send each path to its service, a request carrying the canary header to that service's next version, and the tiles and video to the bucket (the table is in `docs/ARCHITECTURE_PHASE_6.md`, section 1) |
| `canary.tf` | Phase 6, only with a domain: a second endpoint group and backend per service (web, plans, co-pilot), pointing at the revision tagged `canary`, with the same edge firewall policy and no CDN. A request with `x-clps-canary: web`, `plans` or `copilot` reaches it; the deploys test each new version that way. The header is plain and documented, not a secret |
| `assets.tf` | Phase 6, only with a domain: two backend buckets with Cloud CDN on the assets bucket (tiles kept a day, video an hour), and the load balancer's own account allowed to read the names the site serves and nothing else (`assets_bucket_access`). `assets_route = "bucket"` sends `/tiles/*` and `/media/*` there instead of to the web server |
| `trek.tf` | Only with a domain, behind `trek_route`: Moon Trek's map tiles through the site's CDN. An internet endpoint group for `trek.nasa.gov`, a backend with Cloud CDN (answers kept 30 days), and the route rule that sends `/trek/*` to `https://trek.nasa.gov/tiles/Moon/*`. No fixed cost |
| `network.tf` | Phase 6: a subnet of the web server's own with Private Google Access (`web_egress_through_vpc`), so that all its traffic goes through the network and its calls to the other services' `run.app` addresses count as internal once those close |
| `second-region.tf` | Phase 8, only with a domain, off by default: copies of web, plans and co-pilot in `second_region` (us-central1) with the same images, identities and settings, read from their twins (`second_region_copies`); the web copy's twin subnet; an endpoint group per copy that becomes a second backend of its service's backend service, with outlier detection (`second_region_serve`); and the failover drill (`region_drill`). `docs/ARCHITECTURE_PHASE_8.md` |

Beside the `.tf` files:

| File | What it is |
| --- | --- |
| `settings.auto.tfvars` | The settings of the live project that are not personal, tracked. Terraform loads it by itself. Change a setting here, in a pull request |
| `terraform.tfvars.example` | The two personal settings (`billing_account`, `alert_email`), to copy to `terraform.tfvars`, which is git-ignored |
| `protected-resources.txt` | What the destroy guard protects |
| `expected-removals.txt` | Where a pull request names a protected resource it means to remove |
| `scripts/` | The destroy guard, the plan comment, the filter for the two personal settings, and the rule that keeps applies and deploys apart, with their tests (`node --test infra/scripts/*.test.mjs`) |

The design has **no stored secrets**. Each service calls Google's APIs as its own service account: the
plans service calls Firestore, the web server Cloud Storage and Text-to-Speech. The co-pilot calls Claude on
the Anthropic API and signs in by Anthropic's workload identity federation, showing Google's identity token
for its own account: no key is stored (docs/decisions/0009-copilot-on-claude.md). The
web server's account cannot call the model or touch the plans database. GitHub deploys, plans and applies by
proving which repository, branch and workflow it runs from.
The two Actions secrets the Terraform workflows read (`TF_BILLING_ACCOUNT`, `TF_ALERT_EMAIL`) are two
personal settings, not credentials: neither can be used to sign in to anything.

## Who runs what

- **Anyone** can read the plan: `terraform plan` changes nothing. A pull request that touches this folder
  gets its plan as a comment.
- **GitHub Actions applies.** Merging to `main` plans, runs the destroy guard and applies, with no approval
  click (`.github/workflows/terraform.yml`; Rodrigo's decision of 2026-11-12,
  `docs/decisions/0007-terraform-through-github.md`). So the plan comment is the review: read it before
  merging, above all "Access this plan changes".
- **The Mac is the emergency path**: when the pipeline is broken, when a fix cannot wait, or for a drill.
  Claude Code runs it, always the same way: save the plan to a file (`terraform plan -out=<file>`), read
  every line, apply exactly that file. The same change is committed the same day, or the next pipeline run
  undoes it. `docs/DEPLOY.md`, "Applying from the Mac".

## One-time setup (already done on 2026-11-11)

```sh
brew install hashicorp/tap/terraform
# The bucket that holds Terraform's state, and the APIs Terraform itself needs to start:
gcloud storage buckets create gs://clps-compute-6z1nc-tfstate --project clps-compute-6z1nc \
  --location us-east4 --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://clps-compute-6z1nc-tfstate --versioning
gcloud services enable cloudresourcemanager.googleapis.com serviceusage.googleapis.com \
  billingbudgets.googleapis.com --project clps-compute-6z1nc
cp terraform.tfvars.example terraform.tfvars   # then fill in the two personal settings; it is git-ignored
```

## Plan on a laptop

Terraform signs in as you, with a token from `gcloud` that lasts an hour:

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
terraform plan
```

Applying is the pipeline's job (`docs/DEPLOY.md`, "Infrastructure changes"). The same page has the steps for
an apply from the Mac when the pipeline cannot do it.

Do not run `terraform fmt -diff` on the whole folder: it prints `terraform.tfvars`. Format the files you
changed, by name.

The first apply starts the service on Google's "hello" placeholder image. Real images come from
`.github/workflows/deploy.yml` (or a manual deploy, see `docs/DEPLOY.md`), so Terraform ignores later
changes to the image.

## Settings worth knowing

The values the live project runs with are in `settings.auto.tfvars`. Anything not listed there has the
default below.

| Variable | Default | When to change it |
| --- | --- | --- |
| `min_instances` | `0` | Set `1` for the hackathon weekend so the first visitor doesn't wait for a cold start |
| `max_instances` | `3` | The ceiling on copies of the server, which also caps what a traffic spike can cost |
| `claude_model` | `claude-opus-5-5` | To switch the co-pilot's model, for example to `claude-fable-5-2` or `claude-sonnet-5-5` (no code change) |
| `claude_speed` | `fast` | `""` for a model without fast mode (`claude-sonnet-5-5`), or `standard` to halve the price per token |
| `claude_effort` | `low` | `high` with `claude-fable-5-2`; any of `low`, `medium`, `high`, `xhigh`, `max` |
| `anthropic_federation_rule_id`, `anthropic_organization_id`, `anthropic_service_account_id`, `anthropic_workspace_id` | `""` | Set once, from the Claude Console's Workload identity page: how the co-pilot signs in with no stored key. Identifiers, not secrets. Without the first two the co-pilot answers "not-configured" |
| `gemini_model` | `gemini-3.5-flash` | Only for going back to a web image from before the contract step; the co-pilot service no longer reads it |
| `monthly_budget_usd` | `100` | Emails go out at 50%, 90% and 100% of this, before credits |
| `shared_store` | `true` | `false` removes Redis (about $35 a month); each copy of the server then counts limits in its own memory |
| `redis_tier` | `"BASIC"` | `"STANDARD_HA"` for the replica window. Changing it **replaces** the instance: minutes with no Redis, a new address, an empty cache, presenters' rooms gone (`docs/ARCHITECTURE_PHASE_4.md`, section 2) |
| `redis_memory_gb` | `1` | `5` for the replica window: read replicas need 5 GB nodes |
| `redis_read_replicas` | `false` | `true` (with the two above) gives the instance a read replica and a read endpoint, which the web server and the co-pilot read cached values from. Cannot be switched off on that instance: going back is another replacement |
| `redis_replica_count` | `1` | 1 to 5 read replicas, each another node on the bill |
| `redis_reserved_range` | empty | A `/28` or larger for an instance with read replicas; empty lets Memorystore pick one |
| `redis_cluster` | `false` | `true` for the Redis Cluster drill window (`redis-cluster.tf`), $0.0636 an hour at the default size |
| `redis_cluster_shards` | `2` | Changing it during the window is the reshard |
| `plans` | `true` | `false` removes the Firestore database; "Share this plan" then says it is unavailable |
| `domain` | empty | The site's own address, without `www`. Empty means run.app only. The load balancer is what sends `/api/plans`, `/api/chat` and `/api/ask` to their services, and the web server has no code for them, so without a domain the pages have no plans and no co-pilot |
| `voice` | `true` | `false` stops the server calling Cloud Text-to-Speech; Scout then speaks with the browser's own voice |
| `voice_name` | `en-US-Chirp3-HD-Leda` | To give Scout another voice from Google's list |
| `events_worker` | `true` | `false` removes the events worker, its subscription, identities and alerts in one apply. The `stats` database and its counts stay. Needs `question_log` |
| `events_worker_push` | `true` | `false` keeps the worker but delivers nothing to it. Used for the first apply, before the worker's real image is deployed |
| `worker_max_instances` | `2` | The ceiling on copies of the events worker |
| `plans_service` | `true` | `true` creates the plans service, its identity and grants, its backend on the load balancer, its objectives and alert. Nothing a visitor reaches changes. `false` removes them again. Needs `plans` |
| `plans_route` | `"plans"` | `"plans"` adds the load balancer's path rule that sends `/api/plans` and `/api/plans/*` to the plans service. `"web"` removes it and gives the web server's identity its access back. The web server's code has no plans API, so going back also needs a web image from before the contract step (`docs/ARCHITECTURE_PHASE_2.md`, "The ways back") |
| `web_plans_access` | `false` | `false` removes the web server's grant on the `plans` database and its `PLANS_DATABASE` setting. It only takes effect while the load balancer sends `/api/plans` to the plans service; with `plans_route = "web"`, no domain or no plans service, the web server's identity keeps both |
| `copilot_service` | `true` | `true` creates the co-pilot service, its identity and grants, its backend on the load balancer, its objectives and alerts. `false` removes them again, and nothing then answers the co-pilot |
| `copilot_route` | `"copilot"` | `"copilot"` adds the load balancer's path rule that sends `/api/chat`, `/api/chat/*` and `/api/ask` to the co-pilot service. `"web"` removes it and gives the web server's identity its access to the model and the question topic back. The web server's code has no co-pilot, so going back also needs a web image from before the contract step (`docs/ARCHITECTURE_PHASE_3.md`, "The ways back") |
| `web_copilot_access` | `false` | `false` removes the web server's `roles/aiplatform.user`, its `roles/pubsub.publisher` on the question topic, and its `GEMINI_MODEL`, `VERTEX_LOCATION` and `EVENTS_TOPIC` settings. It only takes effect while the load balancer sends the co-pilot's paths to the co-pilot service; with `copilot_route = "web"`, no domain or no co-pilot service, the web server's identity keeps them |
| `copilot_min_instances` | `0` | Set `1` beside `min_instances` for an event, so the first question does not wait for a copy to start |
| `plans_min_instances` | `0` | Set `1` beside `min_instances` for an event, so the first plan opened does not wait for a copy to start |
| `plans_max_instances` | `3` | The ceiling on copies of the plans service |
| `follow` | `true` | `false` switches "Follow the presenter" off (`FOLLOW=off` on the server); the Present button then says presenting is unavailable. The default sets nothing, so it needs no apply |
| `canary_route` | `true` | Phase 6. `false` removes the canary endpoint groups, backends and route rules. The deploys test through them, so only after their workflows go back to the run.app addresses |
| `assets_bucket_access` | `false` | Phase 6. `true` lets the load balancer read the tiles and video (one grant with a condition). Google makes the account only once a backend bucket exists, so it comes in the pull request after them |
| `assets_route` | `"web"` | Phase 6. `"bucket"` sends tiles and video to the backend buckets, through Cloud CDN, with no server in the path. Needs `assets_bucket_access`; without it the rules are not made |
| `web_egress_through_vpc` | `false` | Phase 6. `true` sends all of the web server's traffic through the network from its own subnet with Private Google Access. Needed once `service_ingress` is `"load-balancer"`, for the status calls |
| `web_egress_range` | `"10.20.0.0/24"` | The web server's subnet. Outside the default network's own `10.128.0.0/9` and Redis's range |
| `service_ingress` | `"all"` | Phase 6. `"load-balancer"` closes the `run.app` addresses of web, plans and co-pilot to the internet (Cloud Run's "internal and Cloud Load Balancing"). Only with a domain. The events worker is not covered (decision 0008) |

## Redis and Firestore

```
Cloud Run --private network--> Redis (10.x address, no public one)   rate limits, cached co-pilot answers
Cloud Run --Google API-------> Firestore, database "plans"            shared mission plans, idempotency keys
```

- **Redis** has no password and no public address: only machines on the project's network can reach it, and
  Cloud Run joins that network for private addresses only (Direct VPC egress). Every key expires. If Redis is
  down, each copy of the server falls back to its own memory and logs it once a minute.
- **Firestore** is a named database, `plans`, so the project's default database stays free for the hackathon
  app. The plans service's role (`roles/datastore.user`, `plans.tf`) carries a condition that limits it to
  this database. Each plan has an `expires` time and Firestore deletes it after that. The web server's
  identity has no access to it at all (`web_plans_access = false`, the default). A second collection, `idempotency`, holds one small record per save that
  carried an idempotency key, deleted a day later by a rule of its own.
- The co-pilot's kept answers and spoken audio are read from the read endpoint when the instance has read
  replicas (`redis_read_replicas`); limits, locks, rooms and every write stay on the primary.
- Applying `data.tf` for the first time: Redis takes about five minutes to create.

## The site's own domain

`shackletonstation.dev` is the team's address.

```
visitor -> 34.128.184.151 (global IP) -> load balancer: HTTPS + CDN -> Cloud Run (us-east4)
```

1. Set `domain` in `settings.auto.tfvars` and apply. That creates the DNS zone, the load balancer and the
   certificate request (16 resources, about 2 minutes).
2. Buy the domain once, by hand, with Cloud Domains (about $12 a year for `.dev`). The purchase is kept out
   of Terraform on purpose. Contact details go in a file outside the repo:

   ```sh
   gcloud domains registrations register shackletonstation.dev --project clps-compute-6z1nc \
     --cloud-dns-zone shackletonstation-dev --contact-privacy redacted-contact-data \
     --contact-data-from-file ~/Dev/side_projects/space-apps-2026/domain-contact.yaml \
     --yearly-price "12.00 USD" --notices hsts-preloaded
   ```

3. Wait for the certificate. Google issues it once the DNS records resolve, usually within an hour:

   ```sh
   gcloud compute ssl-certificates describe shackletonstation-dev-cert --global \
     --project clps-compute-6z1nc --format 'value(managed.status, managed.domainStatus)'
   ```

With a domain set, the Cloud Run service also gets `TRUSTED_PROXIES` (the load balancer's address), so the
server's rate limits count the visitor behind the load balancer and not the load balancer itself.

What the CDN keeps is decided by the server's own `Cache-Control` headers: hashed assets for a year, terrain
tiles for a day, and never the page, `version.json` or `/api/*`. Once tiles and video come from the bucket
(`assets_route = "bucket"`), their backend buckets keep them a day and an hour whatever the bucket says.

The load balancer costs about $18 a month while it exists, whether or not anyone visits. `.dev` addresses
only work over HTTPS (browsers enforce it), so the site is unreachable on the domain until the certificate
is active.

To point the domain at another Cloud Run service, change the `cloud_run` service in `domain.tf`'s endpoint
group and apply.

### Moving to another domain

`other_domains` lists the other domains the site owns. Each gets its own zone, apex and `www` records, and
certificate on the same load balancer; the zones, records and certificates are keyed by the domain itself,
so swapping which one is `domain` changes none of them. `other_domains_redirect` decides what they answer:
off, the site itself; on, a 301 to the same path and query on `https://<domain>`. Their `www` always
forwards to `domain`.

The move to `lunarsightline.com` (bought 2026-11-14) takes two pull requests, because a redirect to a domain
whose certificate is still provisioning lands every visitor on a certificate error:

1. Add the new domain to `other_domains` and apply. The new domain serves the site; nothing changes for
   `shackletonstation.dev`. Wait until its certificate is `ACTIVE`:

   ```sh
   gcloud compute ssl-certificates describe lunarsightline-com-cert --global \
     --project clps-compute-6z1nc --format 'value(managed.status, managed.domainStatus)'
   ```

   Also add `https://lunarsightline.com` to the sign-in client's authorized JavaScript origins (below).
2. Swap them: `domain = "lunarsightline.com"`, `other_domains = ["shackletonstation.dev"]`,
   `other_domains_redirect = true`. In the same pull request, every hard-coded `https://shackletonstation.dev`
   (the deploy workflows' `SITE`, `web/scripts/*`, the pages' canonical and share tags) becomes the new
   domain: the deploys' checks do not follow redirects.

Keep the old domain registered and in `other_domains` for as long as links to it matter. Taking it out
deletes its zone, which `prevent_destroy` and the destroy guard both refuse until asked
(`expected-removals.txt`).

## Where this came from, and reusing it

This folder, and everything it manages in Google Cloud, was built for the team's pre-event practice code. On
2026-11-14 it moved to this repository with nothing in Google Cloud made again: this repository was added to
`github_repositories` in `settings.auto.tfvars` (its name, and its number from
`gh api repos/<owner>/<name> --jq .id`), the Terraform state was copied to a prefix of this repository's own
(`sightline/web`, `versions.tf`), and the earlier repository's Terraform workflows were switched off in the
same step. Every repository on that list can sign in to the one project, so only one of them may have the
Terraform workflows switched on at a time.

**A second set of services.** Copy this folder into the new repo, change `service_name`,
`github_repositories`, the other values in `settings.auto.tfvars` and the state `prefix` in `versions.tf`,
and apply. That gives the new app its own Cloud Run service, bucket and keyless deploys in a few minutes.

## What cannot be deleted by accident

Two layers, because nobody approves an apply (`docs/ARCHITECTURE_PHASE_5_5.md`, section 7).

- **The destroy guard** stops an apply whose plan deletes or replaces anything in
  `protected-resources.txt`: the Firestore databases, the DNS zone and records, the buckets, the identity
  pools and providers, Redis, the question log's dataset and table, and the pipeline's own two service
  accounts. To remove one on purpose, put its address on a line of `expected-removals.txt` in the same pull
  request, and delete the line in the next one.
- **`prevent_destroy`** is on what cannot be made again: the Firestore databases `plans` and `stats`, the
  DNS zone, and the three identity pools with their providers. Terraform refuses to plan their removal. To
  remove one on purpose, take its `lifecycle` block out as well.

This changes two switches: `plans = false` and `question_log = false` no longer remove their database by
themselves. Redis has no `prevent_destroy`, because changing its tier replaces it and that is sometimes
wanted; the guard still asks for its address.

## Tearing down

`terraform destroy` removes everything here except what `prevent_destroy` protects, where it stops: take
those `lifecycle` blocks out first. Empty the assets bucket first too, or the destroy stops there.

## Switching on sign-in with Google (optional, about three minutes)

Sign-in lets whoever saved a plan list and delete their own. It is off until the site is given an OAuth
client id, which Google only lets a person create in the console:

1. Console → **Google Auth Platform** → **Branding**: app name "Shackleton Station", a support email, audience
   **External**. No scopes beyond the defaults (the site only needs to know it is the same person).
2. **Clients** → **Create client** → **Web application**. Authorized JavaScript origins:
   `https://shackletonstation.dev` and, for local work, `http://localhost:5179`. No redirect URIs.
3. Put the id in `settings.auto.tfvars` as `sign_in_client_id = "….apps.googleusercontent.com"`, in a pull
   request. The id is not a secret: every visitor's browser sees it.

The server checks Google's signature on every request (`web/shared/identity.ts`) and keeps only a one-way
fingerprint of the account, never a name or an email.
