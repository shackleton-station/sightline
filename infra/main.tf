# Everything the web app needs on Google Cloud. The pipeline VM and its access roles
# are managed separately (see the hackathon runbook), so they are not in here.

locals {
  # Phase 6: who may reach the web, plans and co-pilot services (service_ingress). Without a domain the
  # run.app address is the only way in, so it stays open whatever the variable says.
  service_ingress = local.with_domain && var.service_ingress == "load-balancer" ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"

  apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "aiplatform.googleapis.com",
    "storage.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
    "compute.googleapis.com",
    "dns.googleapis.com",
    "domains.googleapis.com",
    "redis.googleapis.com",
    "firestore.googleapis.com",
    "pubsub.googleapis.com",
    "bigquery.googleapis.com",
    "cloudtrace.googleapis.com",
    "texttospeech.googleapis.com",
    "secretmanager.googleapis.com", # on since pull request 141; no secret is stored today (the co-pilot signs in by federation)
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis)
  service  = each.value

  # Turning an API off can break things outside this folder (the VM, Vertex AI).
  disable_on_destroy = false
}

# Google reports an API as enabled a little before it accepts calls. Everything below
# waits for this, so a first apply on a new project works in one go.
resource "time_sleep" "apis_ready" {
  create_duration = "90s"
  depends_on      = [google_project_service.apis]
}

# ---------- Where the container images go ----------

resource "google_artifact_registry_repository" "web" {
  repository_id = "web"
  location      = var.region
  format        = "DOCKER"
  description   = "Images of the web app, one per deployed commit."

  # Keep the 10 newest images; older ones are only cost. The count is per image name, so the events
  # worker's images (pushed here as `events-worker`) and the plans service's (`plans`) each get
  # their own 10 from the same two rules.
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-the-rest"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days
    }
  }

  depends_on = [time_sleep.apis_ready]
}

# ---------- Terrain tiles and the demo video ----------

resource "google_storage_bucket" "assets" {
  name     = "${var.project_id}-web-assets"
  location = var.region

  # Private: only the web app's own identity reads it, and the app decides what to serve.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  depends_on = [time_sleep.apis_ready]
}

# ---------- The web app ----------

# The identity the web server runs as. It reads the assets bucket (tiles and video), reads the day's
# counts, writes traces and calls Text-to-Speech. It cannot call the model, publish to the question
# topic or touch the plans database: those belong to the co-pilot and plans services' identities.
resource "google_service_account" "web" {
  account_id   = var.service_name
  display_name = "Web app (Cloud Run)"
  description  = "Runs the web server: pages, tiles and video from the web-assets bucket, voice, rooms."

  depends_on = [time_sleep.apis_ready]
}

# The web server's permission to call the model, from before the co-pilot had its own service
# (copilot.tf). Gone while the load balancer sends the co-pilot's paths to the co-pilot service
# (web_copilot_access = false, the default). It comes back only when it does not: the web server's
# code has no co-pilot, so it is of use only to a web image from before the contract step.
resource "google_project_iam_member" "web_vertex" {
  count   = local.web_keeps_copilot ? 1 : 0
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = google_service_account.web.member
}

resource "google_storage_bucket_iam_member" "web_reads_assets" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.web.member
}

resource "google_cloud_run_v2_service" "web" {
  name     = var.service_name
  location = var.region
  # The run.app address is open until Phase 6 closes it (service_ingress, the locals above). From
  # then on only the load balancer, and callers inside the project's network, reach the server.
  ingress = local.service_ingress

  # A demo, not a system of record: allow `terraform destroy` to remove it.
  deletion_protection = false

  template {
    service_account = google_service_account.web.email
    timeout         = "60s"

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = 80

    # Redis has a private address only, so the server sends traffic for private addresses through
    # our network. Everything else (Cloud Storage, Text-to-Speech) goes out the usual way.
    #
    # Phase 6 (web_egress_through_vpc): all of its traffic goes through the network instead, from a
    # subnet of its own with Private Google Access (network.tf), so that its status calls to the
    # plans and co-pilot services' run.app addresses count as internal once those addresses close.
    dynamic "vpc_access" {
      for_each = var.shared_store || var.web_egress_through_vpc ? [1] : []
      content {
        egress = var.web_egress_through_vpc ? "ALL_TRAFFIC" : "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = data.google_compute_network.default.name
          subnetwork = var.web_egress_through_vpc ? google_compute_subnetwork.web_egress[0].name : data.google_compute_subnetwork.default.name
        }
      }
    }

    containers {
      # A placeholder for the first apply. Every deploy after that sets the real image
      # (see .github/workflows/deploy.yml), which is why changes to it are ignored below.
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

      # The settings below are the ones web/server/index.ts reads. Four more are set only while the
      # web server's identity keeps the access they go with (web_keeps_copilot, web_keeps_plans):
      # VERTEX_LOCATION, GEMINI_MODEL, EVENTS_TOPIC and PLANS_DATABASE. Today's web server reads none
      # of them. They are for a web image from before the contract step, which is what going back
      # deploys (docs/ARCHITECTURE_PHASE_3.md, "The ways back").
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      dynamic "env" {
        for_each = local.web_keeps_copilot ? [1] : []
        content {
          name  = "VERTEX_LOCATION"
          value = "global"
        }
      }
      dynamic "env" {
        for_each = local.web_keeps_copilot ? [1] : []
        content {
          name  = "GEMINI_MODEL"
          value = var.gemini_model
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
      # Only on an instance with read replicas: the address cached values (spoken audio) are read
      # from. Everything else, rooms and publish/subscribe included, stays on REDIS_HOST.
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
      # Gone together with the web server's grant on the database (web_plans_access, data.tf).
      dynamic "env" {
        for_each = local.web_keeps_plans ? [1] : []
        content {
          name  = "PLANS_DATABASE"
          value = google_firestore_database.plans[0].name
        }
      }

      dynamic "env" {
        for_each = var.sign_in_client_id != "" ? [1] : []
        content {
          name  = "GOOGLE_CLIENT_ID"
          value = var.sign_in_client_id
        }
      }
      # Gone together with the web server's permission to publish (web_copilot_access, events.tf).
      dynamic "env" {
        for_each = var.question_log && local.web_keeps_copilot ? [1] : []
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

      # Scout's voice. Cloud Text-to-Speech has no IAM role or permission of its own (none in its
      # documentation, none in this project's list of permissions): a service account may call it once
      # the API is enabled in its project (the API list above), so there is no grant to declare.
      dynamic "env" {
        for_each = var.voice ? [1] : []
        content {
          name  = "VOICE"
          value = "on"
        }
      }
      dynamic "env" {
        for_each = var.voice ? [1] : []
        content {
          name  = "VOICE_NAME"
          value = var.voice_name
        }
      }

      # Follow the presenter is on unless switched off, so the default declares nothing and needs no apply.
      dynamic "env" {
        for_each = var.follow ? [] : [1]
        content {
          name  = "FOLLOW"
          value = "off"
        }
      }

      # Requests through the load balancer carry its address as the last hop. Naming it here
      # lets the server look one hop further back for the visitor (rate limits).
      dynamic "env" {
        for_each = local.with_domain ? [1] : []
        content {
          name  = "TRUSTED_PROXIES"
          value = google_compute_global_address.site[0].address
        }
      }

      # Today's question counts, kept by the events worker (worker.tf). The web server only reads them.
      # Last in the list, so adding it shows in a plan as one new line and nothing else moving.
      dynamic "env" {
        for_each = var.question_log ? [1] : []
        content {
          name  = "STATS_DATABASE"
          value = google_firestore_database.stats[0].name
        }
      }

      # Phase 3. The two services' own addresses, which /api/status/services asks how they are, with
      # this server's identity token (web/server/services.ts). They come with the co-pilot service.
      dynamic "env" {
        for_each = var.copilot_service && var.plans && var.plans_service ? [1] : []
        content {
          name  = "PLANS_STATUS_URL"
          value = google_cloud_run_v2_service.plans[0].uri
        }
      }
      dynamic "env" {
        for_each = var.copilot_service ? [1] : []
        content {
          name  = "COPILOT_STATUS_URL"
          value = google_cloud_run_v2_service.copilot[0].uri
        }
      }

      # Phase 8. Which region this copy runs in, for its status address (web/shared/region.ts), and the
      # failover drill (region_drill, second-region.tf). The copy in the second region sets its own.
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

  # What the deploy workflows set and Terraform leaves alone: the image, the label that says which
  # commit the image was built from, gcloud's own name and version, and the traffic split.
  #
  # The revision's name is not in this list and must never be: with it ignored, every change here
  # fails, because the old name is sent again with new settings. The deploys no longer name
  # revisions (they did while they passed --tag to `gcloud run deploy`), so a plan has nothing to
  # clear. docs/ARCHITECTURE_PHASE_5_5.md, section 5.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      client,
      client_version,
      # Deploys move visitors between versions step by step (.github/workflows/deploy.yml).
      traffic,
    ]
  }

  depends_on = [time_sleep.apis_ready]
}

# The site is public: anyone may open it.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.web.name
  location = google_cloud_run_v2_service.web.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
