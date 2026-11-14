variable "project_id" {
  description = "Google Cloud project that holds everything here."
  type        = string
  default     = "clps-compute-6z1nc"
}

variable "region" {
  description = "Region for Cloud Run, the bucket and the image repository. us-east4 is next to the pipeline VM."
  type        = string
  default     = "us-east4"
}

variable "service_name" {
  description = "Name of the Cloud Run service and prefix for its service accounts."
  type        = string
  default     = "clps-web"
}

variable "github_repositories" {
  description = "The GitHub repositories allowed to deploy, plan and apply: each by name (owner/name) and by GitHub's own number for it (gh api repos/<owner>/<name> --jq .id). The identity providers check the number beside the name, so a repository that later took over a name would not be let in. The value is in settings.auto.tfvars. Every repository listed here shares one Terraform state, so only one of them may have the Terraform workflows switched on at a time."
  type = list(object({
    name = string
    id   = string
  }))

  validation {
    condition     = length(var.github_repositories) > 0
    error_message = "github_repositories must list at least one repository, or nothing could deploy, plan or apply."
  }

  validation {
    condition     = alltrue([for repo in var.github_repositories : can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo.name)) && can(regex("^[0-9]+$", repo.id))])
    error_message = "Each entry of github_repositories needs name as owner/name and id as GitHub's number for it, in digits."
  }

  validation {
    condition     = length(distinct([for repo in var.github_repositories : repo.name])) == length(var.github_repositories)
    error_message = "github_repositories names a repository twice."
  }
}

variable "gemini_model" {
  description = "Only for the way back to a web image from before the contract step (main.tf, web_keeps_copilot): the Gemini model that image called through Vertex AI. The co-pilot service calls Claude (claude_model)."
  type        = string
  default     = "gemini-3.5-flash"
}

variable "claude_model" {
  description = "The Claude model the co-pilot service calls on the Anthropic API (docs/decisions/0009-copilot-on-claude.md). claude-fable-5-2 and claude-sonnet-5-5 work with no code change; see claude_speed for Sonnet."
  type        = string
  default     = "claude-opus-5-5"

  validation {
    condition     = can(regex("^claude-[a-z0-9-]+$", var.claude_model))
    error_message = "claude_model must be a Claude model id, such as claude-opus-5-5."
  }
}

variable "claude_speed" {
  description = "The co-pilot's speed setting: \"fast\" (twice the price, quicker output), \"standard\", or \"\" to send no speed field, which models without fast mode need (claude-sonnet-5-5)."
  type        = string
  default     = "fast"

  validation {
    condition     = contains(["fast", "standard", ""], var.claude_speed)
    error_message = "claude_speed must be \"fast\", \"standard\" or \"\"."
  }
}

variable "claude_effort" {
  description = "How much the co-pilot's model thinks: low, medium, high, xhigh or max. Thinking is always on with these models; effort is the control."
  type        = string
  default     = "low"

  validation {
    condition     = contains(["low", "medium", "high", "xhigh", "max"], var.claude_effort)
    error_message = "claude_effort must be low, medium, high, xhigh or max."
  }
}

# Anthropic workload identity federation: how the co-pilot signs in with no stored key. All four are
# identifiers from the Claude Console's Workload identity page, not secrets. Empty: the setting is not
# passed, and without the rule and the organization the co-pilot answers "not-configured".
variable "anthropic_federation_rule_id" {
  description = "The federation rule (fdrl_...) that lets the co-pilot's Google service account sign in to the Anthropic API."
  type        = string
  default     = ""
}

variable "anthropic_organization_id" {
  description = "The Anthropic organization (a UUID) the federation rule belongs to."
  type        = string
  default     = ""
}

variable "anthropic_service_account_id" {
  description = "The Anthropic service account (svac_...) the federation rule signs the co-pilot in as."
  type        = string
  default     = ""
}

variable "anthropic_workspace_id" {
  description = "The Anthropic workspace (wrkspc_...) to scope the token to. Empty: the rule's own workspace."
  type        = string
  default     = ""
}

variable "max_instances" {
  description = "Most copies of the server Cloud Run may start. Also caps what a traffic spike can cost."
  type        = number
  default     = 3
}

variable "min_instances" {
  description = "Copies kept warm. 0 costs nothing when idle; set 1 for the hackathon weekend to skip cold starts."
  type        = number
  default     = 0
}

variable "billing_account" {
  description = "Billing account ID for the budget alert (XXXXXX-XXXXXX-XXXXXX). Personal, not a credential. On the Mac it is set in terraform.tfvars; in the pipeline it comes from the Actions secret TF_BILLING_ACCOUNT. Never commit it."
  type        = string
  sensitive   = true

  # An empty value would plan a replacement of the budget, so a missing Actions secret must stop here.
  validation {
    condition     = can(regex("^[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}-[0-9A-Fa-f]{6}$", var.billing_account))
    error_message = "billing_account is missing or is not of the form XXXXXX-XXXXXX-XXXXXX."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly spend, before credits, at which budget emails go out (at 50%, 90% and 100%)."
  type        = number
  default     = 100
}

variable "alert_email" {
  description = "Where to send the 'site is down' alert. Personal, not a credential. On the Mac it is set in terraform.tfvars; in the pipeline it comes from the Actions secret TF_ALERT_EMAIL. Never commit it."
  type        = string
  sensitive   = true

  # An empty value would plan a change of every alert's address, so a missing Actions secret must stop here.
  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email is missing or is not an email address."
  }
}

variable "domain" {
  description = "The site's own address, without www (for example shackletonstation.dev). Empty means run.app only: no DNS zone, load balancer or certificate."
  type        = string
  default     = ""
}

variable "shared_store" {
  description = "Run Redis (Memorystore, about $35 a month) so every copy of the server shares rate limits and cached answers. Off: each copy counts in its own memory."
  type        = bool
  default     = true
}

variable "redis_tier" {
  description = "Memorystore's tier for the Redis instance: \"BASIC\" (one node, about $0.049 an hour at 1 GB) or \"STANDARD_HA\" (a primary and a replica in another zone, with automatic failover). Changing it REPLACES the instance: minutes with no Redis, a new address, an empty cache, presenters' rooms gone. Read docs/ARCHITECTURE_PHASE_4.md before changing it."
  type        = string
  default     = "BASIC"

  validation {
    condition     = contains(["BASIC", "STANDARD_HA"], var.redis_tier)
    error_message = "redis_tier must be \"BASIC\" or \"STANDARD_HA\"."
  }
}

variable "redis_memory_gb" {
  description = "The size of each Redis node, in GB. Read replicas need 5 or more. On the Standard tier with read replicas every node is billed: 5 GB with one replica is 5 x $0.027 x 2 = $0.27 an hour in us-east4."
  type        = number
  default     = 1

  validation {
    condition     = var.redis_memory_gb >= 1 && var.redis_memory_gb == floor(var.redis_memory_gb)
    error_message = "redis_memory_gb must be a whole number of GB, 1 or more."
  }
}

variable "redis_read_replicas" {
  description = "Give the Redis instance read replicas and a read endpoint, which the web server and the co-pilot then read cached values from (REDIS_READ_HOST). Needs redis_tier = \"STANDARD_HA\" and redis_memory_gb of 5 or more. It cannot be switched off on an instance that has it: setting it back to false replaces the instance."
  type        = bool
  default     = false

  validation {
    condition     = !var.redis_read_replicas || (var.redis_tier == "STANDARD_HA" && var.redis_memory_gb >= 5)
    error_message = "Read replicas need the Standard tier and nodes of 5 GB or more: set redis_tier = \"STANDARD_HA\" and redis_memory_gb = 5 with redis_read_replicas = true."
  }
}

variable "redis_replica_count" {
  description = "How many read replicas, 1 to 5, when redis_read_replicas is true. Each is another node on the bill."
  type        = number
  default     = 1

  validation {
    condition     = contains([1, 2, 3, 4, 5], var.redis_replica_count)
    error_message = "redis_replica_count must be a whole number from 1 to 5."
  }
}

variable "redis_reserved_range" {
  description = "The private range the Redis instance takes its addresses from, as a CIDR block, for example \"10.27.210.0/28\". Empty lets Memorystore pick a free one (a /29, or a /28 with read replicas). It must not overlap a subnet of the network. Changing it replaces the instance."
  type        = string
  default     = ""

  validation {
    condition     = var.redis_reserved_range == "" || can(cidrhost(var.redis_reserved_range, 0))
    error_message = "redis_reserved_range must be empty or a CIDR block such as \"10.27.210.0/28\"."
  }
  validation {
    condition     = var.redis_reserved_range == "" || !var.redis_read_replicas || try(tonumber(split("/", var.redis_reserved_range)[1]) <= 28, false)
    error_message = "With read replicas the reserved range must be a /28 or larger (a smaller number after the slash)."
  }
}

variable "redis_cluster" {
  description = "Run a Memorystore for Redis Cluster for a short drill, and keep the co-pilot's cached answers on it (CACHE_CLUSTER_HOST): a service connection policy for Private Service Connect, the cluster, two APIs, a setting on the co-pilot service and a job that runs the drill. Everything else stays on the ordinary instance. false removes all of it. Read docs/ARCHITECTURE_PHASE_4.md, section 3, first: at the default size it costs $0.0636 an hour."
  type        = bool
  default     = false

  validation {
    condition     = !var.redis_cluster || var.shared_store
    error_message = "redis_cluster needs shared_store = true: the co-pilot keeps its limits, breaker and locks on the ordinary instance, and falls back to it when the cluster fails."
  }
}

variable "redis_cluster_shards" {
  description = "How many shards the Redis Cluster has. Each is one node of the smallest type (redis-shared-core-nano, $0.0318 an hour in us-east4), with no replica. Changing the number is the reshard: Memorystore moves hash slots, and their keys, between shards while the cluster stays up."
  type        = number
  default     = 2

  validation {
    condition     = var.redis_cluster_shards >= 1 && var.redis_cluster_shards <= 10 && var.redis_cluster_shards == floor(var.redis_cluster_shards)
    error_message = "redis_cluster_shards must be a whole number from 1 to 10 for this drill."
  }
}

variable "plans" {
  description = "Create the Firestore database for shared mission plans. Off: the Share a plan feature says it is unavailable."
  type        = bool
  default     = true
}

variable "plans_service" {
  description = "Run the plans service: its own Cloud Run service and identity for /api/plans, with a backend on the load balancer, objectives and an alert. true creates all of that and changes nothing a visitor reaches: the load balancer keeps sending every path to the web server until plans_route says otherwise. false removes it again. Needs plans."
  type        = bool
  default     = true
}

variable "plans_route" {
  description = "Which service the load balancer sends /api/plans and /api/plans/* to: \"plans\" (a path rule to the plans service) or \"web\" (no path rule: the path reaches the web server, as before the split). \"web\" gives the web server its access to the database back in the same apply, but its code no longer has a plans API: going back also needs a web image from before the contract step (docs/ARCHITECTURE_PHASE_2.md, \"The ways back\"). \"plans\" only takes effect where there is something to route to: a domain (the load balancer) and the plans service."
  type        = string
  default     = "plans"

  validation {
    condition     = contains(["web", "plans"], var.plans_route)
    error_message = "plans_route must be \"web\" or \"plans\"."
  }
}

variable "web_plans_access" {
  description = "Let the web server's identity read and write the plans database, and give the web service the PLANS_DATABASE setting. true is how it was before the split. false is the last step of moving plans to their own service: the web server's identity then cannot touch the database. false only takes effect while the load balancer really sends /api/plans to the plans service: whenever it does not (plans_route = \"web\", no domain, no plans service), the identity keeps its access, so a web image from before the contract step can answer again."
  type        = bool
  default     = false
}

variable "plans_name" {
  description = "Name of the plans service's Cloud Run service and of its service account."
  type        = string
  default     = "clps-plans"
}

variable "plans_max_instances" {
  description = "Most copies of the plans service Cloud Run may start."
  type        = number
  default     = 3
}

variable "plans_min_instances" {
  description = "Copies of the plans service kept warm. 0 costs nothing when idle, and the first plan opened after a quiet spell waits for a copy to start; set 1 beside min_instances for an event."
  type        = number
  default     = 0
}

variable "copilot_service" {
  description = "Run the co-pilot service: its own Cloud Run service and identity for /api/chat and /api/ask, with a backend on the load balancer, objectives and alerts. It also gives the web server the two services' addresses for /api/status/services, and the plans service the caller check for its status. false removes all of it again; nothing then answers the co-pilot's paths, because the web server has no co-pilot."
  type        = bool
  default     = true
}

variable "copilot_route" {
  description = "Which service the load balancer sends /api/chat, /api/chat/* and /api/ask to: \"copilot\" (a path rule to the co-pilot service) or \"web\" (no path rule: the paths reach the web server, as before the split). \"web\" gives the web server its access to the model and the question topic back in the same apply, but its code no longer has a co-pilot: going back also needs a web image from before the contract step (docs/ARCHITECTURE_PHASE_3.md, \"The ways back\"). \"copilot\" only takes effect where there is something to route to: a domain (the load balancer) and the co-pilot service."
  type        = string
  default     = "copilot"

  validation {
    condition     = contains(["web", "copilot"], var.copilot_route)
    error_message = "copilot_route must be \"web\" or \"copilot\"."
  }
}

variable "web_copilot_access" {
  description = "Let the web server's identity call the model and publish question events, and give the web service the GEMINI_MODEL, VERTEX_LOCATION and EVENTS_TOPIC settings. true is how it was before the split. false is the last step of moving the co-pilot to its own service: the web server's identity then can do neither. false only takes effect while the load balancer really sends the co-pilot's paths to the co-pilot service: whenever it does not (copilot_route = \"web\", no domain, no co-pilot service), the identity keeps its access, so a web image from before the contract step can answer again."
  type        = bool
  default     = false
}

variable "copilot_name" {
  description = "Name of the co-pilot service's Cloud Run service and of its service account. Also the audience of the web server's token when it asks the service for its status."
  type        = string
  default     = "clps-copilot"
}

variable "copilot_max_instances" {
  description = "Most copies of the co-pilot service Cloud Run may start. With copilot_concurrency it caps how many questions are worked on at once."
  type        = number
  default     = 3
}

variable "copilot_min_instances" {
  description = "Copies of the co-pilot service kept warm. 0 costs nothing when idle, and the first question after a quiet spell waits for a copy to start; set 1 beside min_instances for an event."
  type        = number
  default     = 0
}

variable "copilot_concurrency" {
  description = "Requests at once per copy of the co-pilot service. 10 on each of 3 copies is 30 in flight: the co-pilot's whole allowance for a minute (30 questions for everyone together)."
  type        = number
  default     = 10
}

variable "copilot_fault_delay_seconds" {
  description = "Fault-injection drill: how long the load balancer holds the share of co-pilot requests named by copilot_fault_delay_percent before passing them on, in whole seconds."
  type        = number
  default     = 0

  validation {
    condition     = var.copilot_fault_delay_seconds >= 0 && var.copilot_fault_delay_seconds <= 60 && floor(var.copilot_fault_delay_seconds) == var.copilot_fault_delay_seconds
    error_message = "copilot_fault_delay_seconds must be a whole number of seconds from 0 to 60."
  }
}

variable "copilot_fault_delay_percent" {
  description = "Fault-injection drill: the share of requests to /api/chat, /api/chat/* and /api/ask the load balancer delays, 0 to 100. 0: off."
  type        = number
  default     = 0

  validation {
    condition     = var.copilot_fault_delay_percent >= 0 && var.copilot_fault_delay_percent <= 100
    error_message = "copilot_fault_delay_percent must be from 0 to 100."
  }
  validation {
    condition     = var.copilot_fault_delay_percent == 0 || var.copilot_fault_delay_seconds > 0
    error_message = "A delay drill needs copilot_fault_delay_seconds above 0."
  }
}

variable "copilot_fault_abort_status" {
  description = "Fault-injection drill: the status the load balancer answers with, itself, for the share named by copilot_fault_abort_percent."
  type        = number
  default     = 503

  validation {
    condition     = var.copilot_fault_abort_status >= 200 && var.copilot_fault_abort_status <= 599
    error_message = "copilot_fault_abort_status must be an HTTP status from 200 to 599."
  }
}

variable "copilot_fault_abort_percent" {
  description = "Fault-injection drill: the share of requests to /api/chat, /api/chat/* and /api/ask the load balancer answers itself with copilot_fault_abort_status, never reaching a service, 0 to 100. 0: off."
  type        = number
  default     = 0

  validation {
    condition     = var.copilot_fault_abort_percent >= 0 && var.copilot_fault_abort_percent <= 100
    error_message = "copilot_fault_abort_percent must be from 0 to 100."
  }
  validation {
    condition     = (var.copilot_fault_abort_percent == 0 && var.copilot_fault_delay_percent == 0) || var.domain != ""
    error_message = "Fault injection is set on the load balancer, which needs a domain."
  }
}

variable "copilot_model_faults" {
  description = "Circuit-breaker drill: the co-pilot service answers a share of its own model calls with an error, without calling the model, as \"<status>@<percent>\" (for example \"503@100\"). Empty: off. Changing it starts a new revision of the service with the image that is live."
  type        = string
  default     = ""

  validation {
    condition     = var.copilot_model_faults == "" || can(regex("^[45][0-9][0-9]@[0-9]{1,3}(\\.[0-9]+)?$", var.copilot_model_faults))
    error_message = "copilot_model_faults must be empty or \"<status>@<percent>\", for example \"503@100\"."
  }
  validation {
    condition     = var.copilot_model_faults == "" || var.copilot_service
    error_message = "copilot_model_faults needs the co-pilot service (copilot_service = true)."
  }
}

variable "question_log" {
  description = "Keep a log of the questions put to the co-pilot (Pub/Sub into BigQuery), with nothing about who asked. Off: nothing is recorded."
  type        = bool
  default     = true
}

variable "events_worker" {
  description = "Run the events worker: a private Cloud Run service that receives each co-pilot question event from the queue and keeps the day's counts in the Firestore database `stats`. false removes the worker, its subscription, its identities and its alerts in one apply; the database and its counts stay. Needs question_log."
  type        = bool
  default     = true
}

variable "events_worker_push" {
  description = "Deliver events to the events worker. false keeps the worker deployed with no subscription, so nothing reaches it. Used for the first apply, before the worker's real image is deployed: the placeholder image would answer every message as done."
  type        = bool
  default     = true
}

variable "worker_name" {
  description = "Name of the events worker's Cloud Run service and of its service account. Its push identity is this name plus -push."
  type        = string
  default     = "clps-events-worker"
}

variable "worker_max_instances" {
  description = "Most copies of the events worker Cloud Run may start."
  type        = number
  default     = 2
}

variable "question_log_days" {
  description = "How long a logged question is kept before BigQuery drops it."
  type        = number
  default     = 90
}

variable "tracing" {
  description = "Send a timed trace of each API request to Cloud Trace."
  type        = bool
  default     = true
}

variable "voice" {
  description = "Let Scout say its answers with Cloud Text-to-Speech (at most 200 short texts a day, about $5.40 at the list price). Off: the page uses the browser's own voice."
  type        = bool
  default     = true
}

variable "voice_name" {
  description = "The Cloud Text-to-Speech voice Scout speaks with. Listed at https://cloud.google.com/text-to-speech/docs/chirp3-hd."
  type        = string
  default     = "en-US-Chirp3-HD-Leda"
}

variable "follow" {
  description = "Follow the presenter: a visitor can present, and whoever opens their link sees the site follow along. It needs nothing of its own (rooms live in Redis when shared_store is on, otherwise in each copy's memory). false switches it off: /api/rooms then answers 503."
  type        = bool
  default     = true
}

variable "objectives" {
  description = "Create the service-level objectives and the alert for failing too often."
  type        = bool
  default     = true
}

variable "sign_in_client_id" {
  description = "OAuth client id for sign-in with Google (ends in .apps.googleusercontent.com). Made by hand in the console; not a secret. Empty: no sign-in, and saved plans have no owner."
  type        = string
  default     = ""
}

# ---------- Phase 6: closing the side doors (docs/ARCHITECTURE_PHASE_6.md) ----------
#
# Each defaults to how things were before Phase 6. A pull request switches one on with a line in
# settings.auto.tfvars, and taking that line out again is its way back.

variable "canary_route" {
  description = "A way to reach each service's next version through the load balancer and its edge firewall: a request carrying the header x-clps-canary with the value web, plans or copilot goes to that service's revision tagged `canary` (canary.tf). The header is not a secret and is documented: anyone who sends it reaches the next version through the same firewall, which is harmless. The deploys test each new version this way. Needs a domain."
  type        = bool
  default     = true
}

variable "assets_route" {
  description = "Who answers /tiles/* and /media/*: \"web\" (the web server reads the bucket and sends them, as before Phase 6) or \"bucket\" (the load balancer reads the bucket itself, through Cloud CDN, with no server in the path; assets.tf). Needs a domain."
  type        = string
  default     = "web"

  validation {
    condition     = contains(["web", "bucket"], var.assets_route)
    error_message = "assets_route must be \"web\" or \"bucket\"."
  }
}

variable "assets_bucket_access" {
  description = "Let the load balancer read the tiles and video in the assets bucket (assets.tf): one grant to Google's own account for load balancers in this project, limited to the names the web server serves. Google makes that account when the project's first backend bucket is made, so this is switched on in the pull request after the backend buckets exist. assets_route = \"bucket\" needs it."
  type        = bool
  default     = false
}

variable "web_egress_through_vpc" {
  description = "Send all of the web server's outbound traffic through the project's network, from a subnet of its own with Private Google Access (network.tf). Its calls to the plans and co-pilot services' run.app addresses then count as internal, which they must once those addresses accept only the load balancer and internal traffic (service_ingress). false: only traffic for private addresses (Redis) goes through the network, as before Phase 6."
  type        = bool
  default     = false
}

variable "web_egress_range" {
  description = "The private address range of the web server's own subnet (web_egress_through_vpc). Direct VPC egress needs a /26 or larger. Outside 10.128.0.0/9, which the default network keeps for the subnets it makes by itself, and clear of Redis's range."
  type        = string
  default     = "10.20.0.0/24"
}

variable "service_ingress" {
  description = "Who may reach the web, plans and co-pilot services: \"all\" (also their own run.app addresses, from anywhere, skipping the load balancer and its edge firewall) or \"load-balancer\" (Cloud Run's \"internal and Cloud Load Balancing\": the load balancer, and callers inside the project's network). The events worker is not covered: it stays reachable only with a Google-signed token from an identity allowed to call it (docs/decisions/0008-closing-the-side-doors.md). \"load-balancer\" only takes effect with a domain, because without one the run.app address is the only way in."
  type        = string
  default     = "all"

  validation {
    condition     = contains(["all", "load-balancer"], var.service_ingress)
    error_message = "service_ingress must be \"all\" or \"load-balancer\"."
  }
}

# ---------- Phase 8: a second region (docs/ARCHITECTURE_PHASE_8.md) ----------
#
# Off by default. Lines in settings.auto.tfvars switch it on (expand, then move). Deleting
# second_region_copies and second_region_serve switches everything that runs off in one pull request; the
# subnet goes two hours later with second_region (second-region.tf).

variable "second_region" {
  description = "The second region (second-region.tf). Empty: none. \"us-central1\" is the one planned (docs/decisions/0010-second-region.md). By itself it makes only the web server's twin subnet there, which costs nothing; second_region_copies makes the copies. Redis, Firestore, the events worker and the assets bucket stay in `region`. Needs a domain."
  type        = string
  default     = ""

  validation {
    condition     = var.second_region != var.region
    error_message = "second_region must be another region than region."
  }
}

variable "second_region_copies" {
  description = "Copies of web, plans and co-pilot in second_region, with the same images, identities and settings as in `region`, their public grants and an endpoint group each (second-region.tf). No visitor reaches them until second_region_serve. false removes them all in one apply. Needs second_region."
  type        = bool
  default     = false
}

variable "second_region_serve" {
  description = "Add the second region's copies to the load balancer: each becomes a second backend of its service's backend service, so the load balancer sends each visitor to the nearest region it has not set aside, and outlier detection is switched on for those three backend services (second-region.tf). false: the copies exist and run, but no visitor reaches them. Needs second_region_copies."
  type        = bool
  default     = false
}

variable "second_region_min_instances" {
  description = "Copies kept warm in the second region, for each of the three services. null: the same as each service's own setting in `region`. A warm copy is billed while idle (docs/ARCHITECTURE_PHASE_8.md, section 1)."
  type        = number
  default     = null
}

variable "second_region_egress_range" {
  description = "The private address range of the web server's subnet in the second region, the twin of web_egress_range. A /26 or larger, outside 10.128.0.0/9, and clear of web_egress_range and Redis's range."
  type        = string
  default     = "10.20.1.0/24"
}

variable "region_drill" {
  description = "The failover drill: the region whose copies of web, plans and co-pilot answer every request with 503 (DRILL_UNAVAILABLE=on, web/shared/region.ts), so that outlier detection sets that region aside and the load balancer sends its visitors to the other one. Empty: no drill. Only `region` or `second_region`, and only while the second region serves visitors, so a drill can never switch off the only region. Changing it starts a new version of each of the three services in that region, with the image it already runs."
  type        = string
  default     = ""

  validation {
    condition     = var.region_drill == "" || (var.second_region != "" && var.second_region_copies && var.second_region_serve && contains([var.region, var.second_region], var.region_drill))
    error_message = "region_drill must be empty, or region or second_region while second_region_copies and second_region_serve are true."
  }
}

# ---------- Size of the three visitor-facing services (web, plans, co-pilot) ----------
# The events worker keeps its own small size: it is private, fed by Pub/Sub, and may start cold.

variable "service_cpu" {
  description = "vCPUs per copy of web, plans and the co-pilot. They are Node.js (one main thread), so more copies beat bigger ones; startup_cpu_boost already doubles it while a copy starts."
  type        = string
  default     = "1"
}

variable "service_memory" {
  description = "Memory per copy of web, plans and the co-pilot, as Cloud Run writes it (512Mi, 1Gi, 2Gi)."
  type        = string
  default     = "512Mi"
}

variable "service_cpu_always_on" {
  description = "true: CPU stays allocated between requests (instance-based billing), so follow-the-presenter's streams, the outbox's relay and timers never run throttled, and a warm copy answers at full speed. false: CPU only during requests (request-based billing), the cheap default."
  type        = bool
  default     = false
}

# ---------- The co-pilot's question ceilings ----------
# What the model may cost in a day is the two allDay numbers times the dearest question measured
# (web/copilot/limits.ts). Defaults are the code's own; raise them for an event.

variable "copilot_limits" {
  description = "Overrides of the co-pilot's question limits (web/copilot/limits.ts), as COPILOT_LIMIT_<KIND>_<WHICH> settings. Keys: chat_each, chat_each_day, chat_all, chat_all_day, ask_each, ask_each_day, ask_all, ask_all_day. Empty: the code's defaults (at most about $14.77 a day)."
  type        = map(number)
  default     = {}

  validation {
    condition     = alltrue([for k, v in var.copilot_limits : contains(["chat_each", "chat_each_day", "chat_all", "chat_all_day", "ask_each", "ask_each_day", "ask_all", "ask_all_day"], k) && v >= 1 && v == floor(v)])
    error_message = "copilot_limits keys must be chat_each, chat_each_day, chat_all, chat_all_day, ask_each, ask_each_day, ask_all or ask_all_day, each a whole number of at least 1."
  }
}
