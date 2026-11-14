# The plans service: the third of the site's four services (docs/decisions/0003-plans-service.md).
#
#   visitor -> load balancer -+-> /api/plans, /api/plans/*  -> plans service (Cloud Run) -> Firestore "plans"
#                             +-> everything else           -> web server (Cloud Run)
#
# It saves, opens, lists and deletes shared mission plans, and it is meant to be the only thing
# that reads or writes the `plans` database. It runs as its own identity, which can do two things
# in the project: read and write that one database, and write traces. It reaches Redis for its rate
# limits over the same private network path as the web server (Redis has no permissions to grant).
#
# Moving a route and a permission in one apply is fragile, so this is staged with three switches,
# applied one at a time (docs/ARCHITECTURE_PHASE_2.md):
#
#   plans_service     true creates everything in this file except the route: the identity, its
#                     grants, the service, its backend on the load balancer, its objectives and
#                     alert. Nothing a visitor reaches changes: the load balancer still sends every
#                     path to the web server. false removes all of it again.
#   plans_route       "plans" adds the path rule that sends /api/plans and /api/plans/* to this
#                     service (domain.tf). "web" removes the rule.
#   web_plans_access  false takes the web server's grant on the `plans` database away, and the
#                     setting that names the database (data.tf, main.tf). It only takes effect
#                     while the route really is on "plans"; with "web" the web server keeps both.
#
# All three are applied, and the applied values are the defaults (docs/ARCHITECTURE_PHASE_2.md).
# The web server's code has no plans API any more, so "web" alone does not bring plans back: it
# gives the identity its access back, and a web image from before the contract step has to be
# deployed to use it (docs/ARCHITECTURE_PHASE_2.md, "The ways back").

locals {
  with_plans_service = var.plans && var.plans_service ? 1 : 0
  # The backend only exists with a domain, because it attaches to the load balancer.
  with_plans_backend = local.with_domain && var.plans && var.plans_service ? 1 : 0
  route_to_plans     = local.with_plans_backend == 1 && var.plans_route == "plans"
  # The web server's identity keeps its access to the database whenever the load balancer is not
  # sending /api/plans to the plans service, whatever web_plans_access says.
  web_keeps_plans = var.plans && (var.web_plans_access || !local.route_to_plans)
}

# ---------- Idempotency keys ----------

# A save that carries an Idempotency-Key leaves one small document in the `idempotency` collection,
# written in the same atomic step as the plan: which plan the key made (web/plans/idempotency.ts).
# The service sets `expires` a day ahead, and this rule has Firestore delete the document after
# that (typically within a day of it). The code never trusts a record past its `expires`, so a
# late deletion only costs storage.
#
# It exists whenever the database does, not only with the service.
resource "google_firestore_field" "idempotency_expiry" {
  count      = local.with_plans
  database   = google_firestore_database.plans[0].name
  collection = "idempotency"
  field      = "expires"

  ttl_config {}
}

# ---------- The service's identity, and what it may do ----------

resource "google_service_account" "plans" {
  count        = local.with_plans_service
  account_id   = var.plans_name
  display_name = "Plans service (Cloud Run)"
  description  = "Saves and opens shared mission plans. Reads and writes the plans database and writes traces; nothing else."

  depends_on = [time_sleep.apis_ready]
}

# Read and write on the one database it owns. The condition limits the role to the `plans`
# database, so this identity cannot read or write the question counts in `stats`.
resource "google_project_iam_member" "plans_database" {
  count   = local.with_plans_service
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.plans[0].member

  condition {
    title       = "only-the-plans-database"
    description = "The plans service reads and writes shared mission plans, nothing else."
    expression  = "resource.name == \"projects/${var.project_id}/databases/${google_firestore_database.plans[0].name}\""
  }
}

resource "google_project_iam_member" "plans_traces" {
  count   = var.tracing ? local.with_plans_service : 0
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = google_service_account.plans[0].member
}

# Deploying a service means choosing the identity it runs as, so the deployer must be allowed to
# hand this service its own identity (and only that one).
resource "google_service_account_iam_member" "deployer_uses_plans_identity" {
  count              = local.with_plans_service
  service_account_id = google_service_account.plans[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ---------- The service ----------

resource "google_cloud_run_v2_service" "plans" {
  count    = local.with_plans_service
  name     = var.plans_name
  location = var.region
  # As the web server: reachable on the load balancer's address, and on its own run.app address
  # until Phase 6 closes it (service_ingress, main.tf). The deploy tests each new version through the
  # load balancer with the canary header (canary.tf).
  ingress = local.service_ingress

  deletion_protection = false

  template {
    service_account = google_service_account.plans[0].email
    # Half the web server's 60 s: nothing here streams or calls a model. A save makes one call to
    # Firestore, a retried save two, and a save under an expired idempotency key three, the most of
    # any request here. Each call is given up after 5 s (web/plans/firestorePlans.ts).
    # With the slowest start of a copy seen for the web image on 2026-11-12 (6.44 s,
    # docs/ARCHITECTURE_BASELINE.md 1.4), that is 21.4 s at the very worst. The slowest kind of
    # request before the split was a save: 425 ms at the 95th percentile, at the load balancer.
    timeout = "30s"

    scaling {
      min_instance_count = var.plans_min_instances
      max_instance_count = var.plans_max_instances
    }

    # The web server's number, which is what served these requests before the split. Every request
    # here waits on Firestore or Redis and does little work of its own. On a laptop, one CPU and
    # 512 MB held 80 requests at once with no failure and 119 MB of memory in use
    # (docs/decisions/0003-plans-service.md). To be confirmed from this service's own metrics.
    max_instance_request_concurrency = 80

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
      # (.github/workflows/deploy-plans.yml), which is why changes to it are ignored below.
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
      env {
        name  = "PLANS_DATABASE"
        value = google_firestore_database.plans[0].name
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
      # The same client id as the web server passes to the page, so a visitor's sign-in token
      # checks out here exactly as it did there.
      dynamic "env" {
        for_each = var.sign_in_client_id != "" ? [1] : []
        content {
          name  = "GOOGLE_CLIENT_ID"
          value = var.sign_in_client_id
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
      # Phase 3: the one caller of /api/plans/status/web (the web server), and the audience its token
      # must name. They come with the co-pilot service, whose apply starts the web server asking.
      dynamic "env" {
        for_each = var.copilot_service ? [1] : []
        content {
          name  = "STATUS_CALLER"
          value = google_service_account.web.email
        }
      }
      dynamic "env" {
        for_each = var.copilot_service ? [1] : []
        content {
          name  = "STATUS_AUDIENCE"
          value = var.plans_name
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
      # Deploys move requests between versions step by step (.github/workflows/deploy-plans.yml).
      traffic,
    ]
  }

  depends_on = [time_sleep.apis_ready]
}

# Public, as the web server is: the load balancer calls it for any visitor.
resource "google_cloud_run_v2_service_iam_member" "plans_public" {
  count    = local.with_plans_service
  name     = google_cloud_run_v2_service.plans[0].name
  location = google_cloud_run_v2_service.plans[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---------- Its backend on the load balancer ----------

# Tells the load balancer that this backend is the plans service.
resource "google_compute_region_network_endpoint_group" "plans" {
  count                 = local.with_plans_backend
  name                  = "${var.plans_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.plans[0].name
  }
}

# A backend with no path pointing at it does nothing: it exists so that the path rule in domain.tf
# can be added and removed without creating or destroying anything else.
resource "google_compute_backend_service" "plans" {
  count                 = local.with_plans_backend
  name                  = "${var.plans_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.plans[0].id
  }
  # Phase 8: the copy in the second region, and outlier detection (second-region.tf).
  dynamic "backend" {
    for_each = local.second_region_backend["plans"]
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

  # Never cached: every answer here is about one visitor or one moment, and says `no-store`.
  enable_cdn = false

  log_config {
    enable      = true
    sample_rate = 1
  }

  # The same edge firewall policy as the web server's backend (edge.tf). Cloud Armor counts a rate
  # limit separately for each backend a policy is attached to, so "120 API calls a minute from one
  # address" becomes 120 to the plans API and 120 to the rest of the API. The service's own limits
  # (5 saves and 60 opens a minute per visitor) are far below either.
  security_policy = google_compute_security_policy.edge[0].id
}

# ---------- Objectives and an alert of its own ----------

# The same idea as the web server's (slo.tf), with numbers of its own:
#
#   Availability  99.5% of requests succeed, over any 28 days.
#   Speed         95% of requests answer within 1 second. Before the split, 95 in 100 of these
#                 requests answered within 252 ms (opening a plan) and 425 ms (saving one), measured
#                 at the load balancer (docs/ARCHITECTURE_BASELINE.md 1.2). One second is about
#                 twice the slower of the two; the other 5% is for a copy starting from nothing.

resource "google_monitoring_service" "plans" {
  count        = local.with_plans_service == 1 ? local.with_slo : 0
  service_id   = var.plans_name
  display_name = "Plans service (${var.plans_name})"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = google_cloud_run_v2_service.plans[0].name
      location     = var.region
    }
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_monitoring_slo" "plans_availability" {
  count        = local.with_plans_service == 1 ? local.with_slo : 0
  service      = google_monitoring_service.plans[0].service_id
  slo_id       = "availability"
  display_name = "99.5% of requests succeed (28 days)"

  goal                = 0.995
  rolling_period_days = 28

  basic_sli {
    availability {
      enabled = true
    }
  }
}

resource "google_monitoring_slo" "plans_speed" {
  count        = local.with_plans_service == 1 ? local.with_slo : 0
  service      = google_monitoring_service.plans[0].service_id
  slo_id       = "speed"
  display_name = "95% of requests answer within 1 s (28 days)"

  goal                = 0.95
  rolling_period_days = 28

  basic_sli {
    latency {
      threshold = "1s"
    }
  }
}

resource "google_monitoring_alert_policy" "plans_burning_budget" {
  count        = local.with_plans_service == 1 ? local.with_slo : 0
  display_name = "${var.plans_name} is failing too often"
  combiner     = "OR"

  conditions {
    display_name = "Using the month's failure allowance 10 times too fast"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.plans_availability[0].name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "More than 5% of requests to the plans service failed over the last hour. Sharing, opening and deleting plans is affected; the rest of the site is not. Check the latest deploy first (`gcloud run revisions list --service ${var.plans_name} --region ${var.region}`), then Firestore and Redis. To go back a version: `gcloud run services update-traffic ${var.plans_name} --region ${var.region} --to-revisions <last good>=100`. The web server has no plans API to fall back on: sending the path back to it also needs a web image from before the contract step. Both are in `docs/DEPLOY.md`, \"The plans service\"."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}
