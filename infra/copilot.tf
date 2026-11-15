# The co-pilot service: the fourth of the site's four services (docs/decisions/0004-copilot-service.md).
#
#   visitor -> load balancer -+-> /api/chat, /api/chat/*, /api/ask -> co-pilot (Cloud Run) -> Anthropic API (Claude)
#                             |                                          |-> Redis (limits, answers, outbox, breaker)
#                             |                                          |-> Pub/Sub (question events)
#                             |                                          '-> Cloud Storage (the light grid's months)
#                             +-> /api/plans, /api/plans/*         -> plans service
#                             +-> everything else                  -> web server
#
# It answers the co-pilot and the typed-question box. Requests take seconds and each one costs
# money, so it has its own identity, permission to call the model, copy limit, timeout and
# concurrency. When the model is down, pages and plans keep working.
#
# Staged with three switches, applied one at a time (docs/ARCHITECTURE_PHASE_3.md), as plans was:
#
#   copilot_service     true creates everything in this file except the route: the identity, its
#                       grants, the service, its backend on the load balancer, its objectives and
#                       alerts. It also tells the web server the two services' addresses, for its
#                       /api/status/services page, and tells plans who may ask for its status there.
#   copilot_route       "copilot" adds the path rule that sends /api/chat, /api/chat/* and /api/ask
#                       here (domain.tf). "web" removes it.
#   web_copilot_access  false takes the web server's permission to call the model and to publish to
#                       the question topic away, and the three settings that went with them
#                       (main.tf, events.tf). It only takes effect while the route really is on
#                       "copilot"; with "web" the web server's identity keeps both.
#
# All three are applied, and the applied values are the defaults. The web server's code has no
# co-pilot any more, so "web" alone does not bring the co-pilot back: it gives the identity its
# access back, and a web image from before the contract step has to be deployed to use it
# (docs/ARCHITECTURE_PHASE_3.md, "The ways back").
#
# And two drills, both off by default (docs/ARCHITECTURE_PHASE_3.md, "The fault-injection drill"):
#
#   copilot_fault_*        a fault-injection policy on the co-pilot's path rule at the load balancer:
#                          a fixed delay, or an abort with a status, for a share of requests. It sits
#                          between the visitor and the service, so it shows what the page does and
#                          that the rest of the site is unaffected.
#   copilot_model_faults   the service fails a share of its own model calls (MODEL_FAULTS), without
#                          calling the model. That is where the circuit breaker is, which a fault at
#                          the load balancer never reaches.

locals {
  with_copilot_service = var.copilot_service ? 1 : 0
  # The backend only exists with a domain, because it attaches to the load balancer.
  with_copilot_backend = local.with_domain && var.copilot_service ? 1 : 0
  route_to_copilot     = local.with_copilot_backend == 1 && var.copilot_route == "copilot"
  # The web server's identity keeps its access to the model and the question topic whenever the
  # load balancer is not sending the co-pilot's paths to the co-pilot service, whatever
  # web_copilot_access says. The same rule as web_keeps_plans (plans.tf): a checkout with no domain
  # validates, and going back needs no second variable.
  web_keeps_copilot = var.web_copilot_access || !local.route_to_copilot
}

# ---------- The service's identity, and what it may do ----------

resource "google_service_account" "copilot" {
  count        = local.with_copilot_service
  account_id   = var.copilot_name
  display_name = "Co-pilot service (Cloud Run)"
  description  = "Answers the co-pilot and typed questions. Calls Claude (Anthropic, by workload identity federation), publishes question events, reads the light grid, writes traces; nothing else."

  depends_on = [time_sleep.apis_ready]
}

# The model is Claude on the Anthropic API (docs/decisions/0009-copilot-on-claude.md). The service
# needs no Google role for it: it signs in by Anthropic's workload identity federation, showing an
# identity token for this service account that Google's metadata server gives any workload for its
# own account. Anthropic's federation rule names this account by its numeric id and email; the
# Anthropic side is set up in the Claude Console, not here. So the old grant to call Vertex AI
# (`roles/aiplatform.user`, project-wide) is gone.

# Publish question events to the one topic, and no other.
resource "google_pubsub_topic_iam_member" "copilot_publishes" {
  count  = var.question_log ? local.with_copilot_service : 0
  topic  = google_pubsub_topic.events[0].name
  role   = "roles/pubsub.publisher"
  member = google_service_account.copilot[0].member
}

# Read the light grid's months, for the tool that looks up tapped ground (shared/tools/light.ts), and
# the fine terrain tiles, from which a custom point is worked out with the page's own code
# (shared/tools/customPoints.ts). The condition narrows the role to objects under tiles/light/,
# tiles/polar/ and tiles/global/, the three prefixes the load balancer already serves to anyone
# (assets.tf): the service cannot read the video or anything else. The bucket has uniform
# bucket-level access, which conditions need.
resource "google_storage_bucket_iam_member" "copilot_reads_light" {
  count  = local.with_copilot_service
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.copilot[0].member

  condition {
    title       = "only-the-light-grid-and-terrain-tiles"
    description = "The co-pilot reads the light grid's months and the terrain tiles, nothing else in the bucket."
    expression  = join(" || ", [for prefix in ["tiles/light/", "tiles/polar/", "tiles/global/"] : "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.assets.name}/objects/${prefix}\")"])
  }
}

resource "google_project_iam_member" "copilot_traces" {
  count   = var.tracing ? local.with_copilot_service : 0
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = google_service_account.copilot[0].member
}

# Deploying a service means choosing the identity it runs as, so the deployer must be allowed to
# hand this service its own identity (and only that one).
resource "google_service_account_iam_member" "deployer_uses_copilot_identity" {
  count              = local.with_copilot_service
  service_account_id = google_service_account.copilot[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ---------- The service ----------

resource "google_cloud_run_v2_service" "copilot" {
  count    = local.with_copilot_service
  name     = var.copilot_name
  location = var.region
  # As the web server: reachable on the load balancer's address, and on its own run.app address
  # until Phase 6 closes it (service_ingress, main.tf). The deploy tests each new version through the
  # load balancer with the canary header (canary.tf).
  ingress = local.service_ingress

  deletion_protection = false

  template {
    service_account = google_service_account.copilot[0].email
    # A question has 25 s for its model calls, retries included (copilot/chat/chat.ts), and a typed
    # question 20 s (copilot/ask.ts). After the answer, the response waits at most 250 ms for the
    # question event's publish. The slowest start of a copy seen for the web image was 6.44 s
    # (docs/ARCHITECTURE_BASELINE.md 1.4). 25 + 0.25 + 6.44 is under 32 s; 40 s leaves room, and is
    # below the web server's 60 s, which also covers long streams this service never has.
    timeout = "40s"

    scaling {
      min_instance_count = var.copilot_min_instances
      max_instance_count = var.copilot_max_instances
    }

    # Lower than the web server's 80 on purpose. A request here takes seconds and costs money; the
    # most the co-pilot accepts is 30 questions a minute for everyone together (copilot/limits.ts).
    # 10 at once on each of at most 3 copies is 30 in flight: the whole minute's allowance arriving
    # at once still finds room, and a burst beyond it starts another copy rather than queueing
    # behind slow model calls. Memory per request is small (the requests wait on the model); the
    # data reader's cache is per copy. To be confirmed from the service's own metrics.
    max_instance_request_concurrency = var.copilot_concurrency

    # Redis has a private address only. The same path as the web server uses: traffic for private
    # addresses goes out through the project's network, everything else the usual way.
    dynamic "vpc_access" {
      for_each = var.shared_store ? [1] : []
      content {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = data.google_compute_network.default.name
          subnetwork = data.google_compute_subnetwork.default.name
        }
      }
    }

    containers {
      # A placeholder for the first apply. Every deploy after that sets the real image
      # (.github/workflows/deploy-copilot.yml), which is why changes to it are ignored below.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.service_cpu
          memory = var.service_memory
        }
        # CPU between requests only when service_cpu_always_on (variables.tf); a faster start either way.
        cpu_idle          = !var.service_cpu_always_on
        startup_cpu_boost = true
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      # Which Claude, at what speed and effort (copilot/claude.ts). An empty claude_speed sends no speed
      # field; it is passed as "none" so that the setting cannot be lost on the way as an empty value.
      env {
        name  = "CLAUDE_MODEL"
        value = var.claude_model
      }
      env {
        name  = "CLAUDE_SPEED"
        value = var.claude_speed == "" ? "none" : var.claude_speed
      }
      env {
        name  = "CLAUDE_EFFORT"
        value = var.claude_effort
      }
      # Question ceilings above the code's defaults, for an event (variables.tf, copilot_limits).
      dynamic "env" {
        for_each = var.copilot_limits
        content {
          name  = "COPILOT_LIMIT_${upper(env.key)}"
          value = tostring(env.value)
        }
      }
      # How it signs in to the Anthropic API: workload identity federation, with Google's identity
      # token for this service's own account. Identifiers, not secrets. Each is set only when it has a
      # value; without the rule and the organization the co-pilot answers "not-configured".
      dynamic "env" {
        for_each = { for name, value in {
          ANTHROPIC_FEDERATION_RULE_ID = var.anthropic_federation_rule_id
          ANTHROPIC_ORGANIZATION_ID    = var.anthropic_organization_id
          ANTHROPIC_SERVICE_ACCOUNT_ID = var.anthropic_service_account_id
          ANTHROPIC_WORKSPACE_ID       = var.anthropic_workspace_id
        } : name => value if value != "" }
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "ASSET_BUCKET"
        value = google_storage_bucket.assets.name
      }
      dynamic "env" {
        for_each = var.shared_store ? [1] : []
        content {
          name  = "REDIS_HOST"
          value = google_redis_instance.store[0].host
        }
      }
      dynamic "env" {
        for_each = var.shared_store ? [1] : []
        content {
          name  = "REDIS_PORT"
          value = tostring(google_redis_instance.store[0].port)
        }
      }
      # Only on an instance with read replicas: the address kept answers are read from. Limits, the
      # breaker, the outbox, locks and every write stay on REDIS_HOST.
      dynamic "env" {
        for_each = local.redis_read_endpoint ? [1] : []
        content {
          name  = "REDIS_READ_HOST"
          value = google_redis_instance.store[0].read_endpoint
        }
      }
      dynamic "env" {
        for_each = local.redis_read_endpoint ? [1] : []
        content {
          name  = "REDIS_READ_PORT"
          value = tostring(google_redis_instance.store[0].read_endpoint_port)
        }
      }
      # Only during the Redis Cluster window (redis-cluster.tf): kept answers, and nothing else, live
      # on the cluster, reached through its discovery address.
      dynamic "env" {
        for_each = local.with_cluster == 1 ? [1] : []
        content {
          name  = "CACHE_CLUSTER_HOST"
          value = google_redis_cluster.cache[0].discovery_endpoints[0].address
        }
      }
      dynamic "env" {
        for_each = local.with_cluster == 1 ? [1] : []
        content {
          name  = "CACHE_CLUSTER_PORT"
          value = tostring(google_redis_cluster.cache[0].discovery_endpoints[0].port)
        }
      }
      dynamic "env" {
        for_each = var.question_log ? [1] : []
        content {
          name  = "EVENTS_TOPIC"
          value = google_pubsub_topic.events[0].name
        }
      }
      dynamic "env" {
        for_each = var.tracing ? [1] : []
        content {
          name  = "TRACING"
          value = "on"
        }
      }
      # Requests through the load balancer carry its address as the last hop. Naming it here lets
      # the service look one hop further back for the visitor (rate limits).
      dynamic "env" {
        for_each = local.with_domain ? [1] : []
        content {
          name  = "TRUSTED_PROXIES"
          value = google_compute_global_address.site[0].address
        }
      }
      # The one caller of /api/chat/status/web, and the audience its token must name.
      env {
        name  = "STATUS_CALLER"
        value = google_service_account.web.email
      }
      env {
        name  = "STATUS_AUDIENCE"
        value = var.copilot_name
      }
      # The breaker drill: a share of model calls failed on purpose. Empty: off.
      dynamic "env" {
        for_each = var.copilot_model_faults != "" ? [1] : []
        content {
          name  = "MODEL_FAULTS"
          value = var.copilot_model_faults
        }
      }
      # Phase 8: the region, for the status address, and the failover drill (second-region.tf).
      env {
        name  = "REGION"
        value = var.region
      }
      dynamic "env" {
        for_each = local.drill_in_region ? [1] : []
        content {
          name  = "DRILL_UNAVAILABLE"
          value = "on"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      # The commit the image was built from, set by the deploy (main.tf has the full note).
      template[0].labels,
      client,
      client_version,
      # Deploys move requests between versions step by step (.github/workflows/deploy-copilot.yml).
      traffic,
    ]
  }

  depends_on = [time_sleep.apis_ready]
}

# Public, as the web server is: the load balancer calls it for any visitor.
resource "google_cloud_run_v2_service_iam_member" "copilot_public" {
  count    = local.with_copilot_service
  name     = google_cloud_run_v2_service.copilot[0].name
  location = google_cloud_run_v2_service.copilot[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------- Its backend on the load balancer ----------

resource "google_compute_region_network_endpoint_group" "copilot" {
  count                 = local.with_copilot_backend
  name                  = "${var.copilot_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.copilot[0].name
  }
}

# A backend with no path pointing at it does nothing: it exists so that the path rule in domain.tf
# can be added and removed without creating or destroying anything else.
resource "google_compute_backend_service" "copilot" {
  count                 = local.with_copilot_backend
  name                  = "${var.copilot_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.copilot[0].id
  }
  # Phase 8: the copy in the second region, and outlier detection (second-region.tf).
  dynamic "backend" {
    for_each = local.second_region_backend["copilot"]
    content {
      group = backend.value
    }
  }
  dynamic "outlier_detection" {
    for_each = local.second_region_outlier_detection
    content {
      consecutive_gateway_failure           = outlier_detection.value.consecutive_gateway_failure
      enforcing_consecutive_gateway_failure = outlier_detection.value.enforcing_consecutive_gateway_failure
      consecutive_errors                    = outlier_detection.value.consecutive_errors
      enforcing_consecutive_errors          = outlier_detection.value.enforcing_consecutive_errors
      max_ejection_percent                  = outlier_detection.value.max_ejection_percent
      interval {
        seconds = outlier_detection.value.interval_seconds
      }
      base_ejection_time {
        seconds = outlier_detection.value.base_ejection_seconds
      }
    }
  }

  # Never cached: every answer is for one visitor at one moment, and says `no-store`. The kept
  # answers are the service's own, in Redis, keyed by the co-pilot's code and the site data.
  enable_cdn = false

  log_config {
    enable      = true
    sample_rate = 1
  }

  # The same edge firewall policy as the other backends (edge.tf). Cloud Armor counts a rate limit
  # separately for each backend a policy is attached to, so one address may make 120 calls a minute
  # here and 120 to the rest of the API. The service's own limits (6 questions and 10 typed
  # questions a minute per visitor) are far below either.
  security_policy = google_compute_security_policy.edge[0].id
}

# ---------- Objectives and alerts of its own ----------

# The same idea as the web server's (slo.tf), with numbers of its own:
#
#   Availability  99% of requests succeed, over any 28 days. Lower than the web server's 99.5%: every
#                 question depends on a model the project does not run, and when the model fails
#                 the breaker answers 503 at once, on purpose, and that counts against this. In the
#                 baseline day 158 questions had 0 failures and 1 answer written from the facts
#                 (docs/ARCHITECTURE_BASELINE.md 1.1).
#   Speed         90% of requests answer within 10 s. At the load balancer, POST /api/chat answered
#                 with a median of 4,214 ms and a 95th percentile of 9,362 ms, cached and uncached
#                 together (baseline 1.2), so 90% within 10 s is met with room by the baseline. A
#                 streamed answer counts its whole length.

resource "google_monitoring_service" "copilot" {
  count        = local.with_copilot_service == 1 ? local.with_slo : 0
  service_id   = var.copilot_name
  display_name = "Co-pilot service (${var.copilot_name})"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = google_cloud_run_v2_service.copilot[0].name
      location     = var.region
    }
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_monitoring_slo" "copilot_availability" {
  count        = local.with_copilot_service == 1 ? local.with_slo : 0
  service      = google_monitoring_service.copilot[0].service_id
  slo_id       = "availability"
  display_name = "99% of requests succeed (28 days)"

  goal                = 0.99
  rolling_period_days = 28

  basic_sli {
    availability {
      enabled = true
    }
  }
}

resource "google_monitoring_slo" "copilot_speed" {
  count        = local.with_copilot_service == 1 ? local.with_slo : 0
  service      = google_monitoring_service.copilot[0].service_id
  slo_id       = "speed"
  display_name = "90% of requests answer within 10 s (28 days)"

  goal                = 0.9
  rolling_period_days = 28

  basic_sli {
    latency {
      threshold = "10s"
    }
  }
}

resource "google_monitoring_alert_policy" "copilot_burning_budget" {
  count        = local.with_copilot_service == 1 ? local.with_slo : 0
  display_name = "${var.copilot_name} is failing too often"
  combiner     = "OR"

  conditions {
    display_name = "Using the month's failure allowance 10 times too fast"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.copilot_availability[0].name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "More than 10% of requests to the co-pilot service failed over the last hour. The co-pilot and the typed-question box are affected; pages and plans are not. If the circuit breaker opened (its own alert), the model is failing: check Vertex AI's status and quota. Otherwise check the latest deploy first (`gcloud run revisions list --service ${var.copilot_name} --region ${var.region}`), then Redis. To go back a version: `gcloud run services update-traffic ${var.copilot_name} --region ${var.region} --to-revisions <last good>=100`. The web server has no co-pilot to fall back on: sending the paths back to it also needs a web image from before the contract step. Both are in `docs/DEPLOY.md`, \"The co-pilot service\"."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}

# The breaker opening is worth knowing at once: it means the model failed 5 times in a minute, and
# visitors are being told to wait. The service writes one log line each time (copilot/breaker.ts).
resource "google_monitoring_alert_policy" "copilot_breaker_opened" {
  count        = local.with_copilot_service == 1 ? local.with_slo : 0
  display_name = "${var.copilot_name}: the circuit breaker opened"
  combiner     = "OR"

  conditions {
    display_name = "A \"Circuit breaker opened\" line in the co-pilot's log"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.copilot_name}\" AND jsonPayload.message:\"Circuit breaker opened\""
    }
  }

  # At most one email in 30 minutes, however often it opens and closes.
  alert_strategy {
    notification_rate_limit {
      period = "1800s"
    }
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "The co-pilot stopped calling the model for 30 s because model calls kept failing. Visitors are told the co-pilot is busy and when to ask again; pages and plans are unaffected. It tries again by itself with one question every 30 s. If it keeps opening: Vertex AI's status page and the project's quota for ${var.gemini_model}. During a fault-injection drill this is expected (`copilot_model_faults` in terraform.tfvars)."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}
