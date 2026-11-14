# The events worker: the second of the site's four services (docs/decisions/0002-events-worker.md).
#
#   co-pilot -> Pub/Sub topic -+-> BigQuery subscription -> the question log (events.tf, unchanged)
#                              +-> push subscription -> events worker (Cloud Run, private) -> Firestore "stats"
#
#   web server -> Firestore "stats", read-only -> today's counts on the How it works page
#
# The worker receives each co-pilot question event and adds to the day's counts. No visitor ever
# calls it. It runs as its own identity, which can do two things: write the `stats` database and
# write traces. Nothing here takes a permission away from anything that has one today.
#
# Two switches:
#   events_worker       false removes the worker, its subscription, its identities and its alerts.
#                       The `stats` database and its counts stay.
#   events_worker_push  false leaves the worker in place with nothing delivered to it. The first apply
#                       uses it: the service starts on a placeholder image that would answer "done"
#                       to every message, so the subscription is only created once the real image is
#                       deployed (docs/ARCHITECTURE_PHASE_1.md).

locals {
  with_worker      = var.question_log && var.events_worker ? 1 : 0
  with_worker_push = var.question_log && var.events_worker && var.events_worker_push ? 1 : 0
  # The address of one Firestore database, as an access condition names it.
  stats_database_resource = "projects/${var.project_id}/databases/stats"
}

# ---------- The counters database ----------

# A second named database, so that it has exactly one writer and its own access rules. It exists
# whenever the question log does, whether or not the worker is switched on, so switching the worker
# off never deletes a count.
resource "google_firestore_database" "stats" {
  count       = local.with_events
  name        = "stats"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # A demo's data: `terraform destroy` may remove it. The counts can be rebuilt from the question log.
  delete_protection_state = "DELETE_PROTECTION_DISABLED"
  deletion_policy         = "DELETE"

  # Not by accident: the counts cannot be made again (infra/README.md, "What cannot be deleted by
  # accident").
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

# Time-to-live rules: Firestore deletes a document once the time in its `expires` field has passed
# (typically within a day of it).
#
# `seen` holds one small document per counted event. It is what makes a second delivery of the same
# event a no-op. The worker sets `expires` 7 days ahead, longer than any way an event can come back
# (web/shared/stats.ts).
resource "google_firestore_field" "seen_expiry" {
  count      = local.with_events
  database   = google_firestore_database.stats[0].name
  collection = "seen"
  field      = "expires"

  ttl_config {}
}

# `shards` holds the pieces of each day's counter (days/<day>/shards/<n>). Kept as long as the
# question log they summarize.
resource "google_firestore_field" "shard_expiry" {
  count      = local.with_events
  database   = google_firestore_database.stats[0].name
  collection = "shards"
  field      = "expires"

  ttl_config {}
}

# The web server may read this one database, and cannot write it: the How it works page shows the counts.
resource "google_project_iam_member" "web_reads_stats" {
  count   = local.with_events
  project = var.project_id
  role    = "roles/datastore.viewer"
  member  = google_service_account.web.member

  condition {
    title       = "only-the-stats-database"
    description = "The web app reads the day's question counts, nothing else, and cannot change them."
    expression  = "resource.name == \"${local.stats_database_resource}\""
  }

  depends_on = [google_firestore_database.stats]
}

# ---------- The worker's identity, and what it may do ----------

resource "google_service_account" "worker" {
  count        = local.with_worker
  account_id   = var.worker_name
  display_name = "Events worker (Cloud Run)"
  description  = "Counts co-pilot question events. Writes the stats database and traces; nothing else."

  depends_on = [time_sleep.apis_ready]
}

# The one writer of the counters. The condition limits the role to the `stats` database, so the
# worker cannot read or write shared mission plans.
resource "google_project_iam_member" "worker_writes_stats" {
  count   = local.with_worker
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.worker[0].member

  condition {
    title       = "only-the-stats-database"
    description = "The events worker keeps the day's question counts, nothing else."
    expression  = "resource.name == \"${local.stats_database_resource}\""
  }

  depends_on = [google_firestore_database.stats]
}

resource "google_project_iam_member" "worker_traces" {
  count   = var.tracing ? local.with_worker : 0
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = google_service_account.worker[0].member
}

# Deploying a service means choosing the identity it runs as, so the deployer must be allowed to hand
# the worker its own identity. (It may already call the worker: its project-wide roles/run.developer
# includes run.routes.invoke. The worker's own code is what stops it delivering messages.)
resource "google_service_account_iam_member" "deployer_uses_worker_identity" {
  count              = local.with_worker
  service_account_id = google_service_account.worker[0].name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ---------- The service ----------

resource "google_cloud_run_v2_service" "worker" {
  count    = local.with_worker
  name     = var.worker_name
  location = var.region
  # Reachable from the internet, but only with a Google-signed token from an identity that may call
  # it: there is no "allUsers" grant below, so Cloud Run refuses everyone else before our code runs.
  #
  # Phase 6 looked at closing the network side too, and left it open on purpose
  # (docs/decisions/0008-closing-the-side-doors.md). "Internal" ingress would still let Pub/Sub's push
  # in: Cloud Run counts Pub/Sub in the same project as internal. But the deploy tests each new
  # version from the runners, on the internet, before it gets any message, and the worker has no load
  # balancer to be tested through: putting it on one would give it the public address it is meant not
  # to have. Here the identity check is the door, and there is no edge firewall it goes round.
  ingress = "INGRESS_TRAFFIC_ALL"

  deletion_protection = false

  template {
    service_account = google_service_account.worker[0].email
    # One message is one small write. Pub/Sub waits 30 s for an answer (below); longer than that and
    # it has already decided to send the message again.
    timeout = "30s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.worker_max_instances
    }

    # A starting value, not a measured one: each message is one short call to Firestore, so a copy
    # can hold many at once. Change it from the worker's own numbers once it has traffic.
    max_instance_request_concurrency = 20

    containers {
      # A placeholder for the first apply. Every deploy after that sets the real image
      # (.github/workflows/deploy-events-worker.yml), which is why changes to it are ignored below.
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "STATS_DATABASE"
        value = google_firestore_database.stats[0].name
      }
      # The only identity whose messages the worker accepts, checked by its own code.
      env {
        name  = "PUSH_IDENTITY"
        value = google_service_account.worker_push[0].email
      }
      # May run the worker's self-check, which a deploy uses to test a new version.
      env {
        name  = "CHECK_IDENTITIES"
        value = google_service_account.deployer.email
      }
      dynamic "env" {
        for_each = var.tracing ? [1] : []
        content {
          name  = "TRACING"
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
      # The deploy moves messages to a new version only after testing it.
      traffic,
    ]
  }

  depends_on = [time_sleep.apis_ready]
}

# ---------- Who may deliver messages ----------

# The identity Pub/Sub delivers as. It exists only to be named in the token on each push.
resource "google_service_account" "worker_push" {
  count        = local.with_worker
  account_id   = "${var.worker_name}-push"
  display_name = "Events worker push (Pub/Sub)"
  description  = "The identity Pub/Sub presents when it pushes an event to the events worker. Has one grant: calling that service."

  depends_on = [time_sleep.apis_ready]
}

# It may call the worker, and nothing else anywhere.
resource "google_cloud_run_v2_service_iam_member" "push_calls_worker" {
  count    = local.with_worker
  name     = google_cloud_run_v2_service.worker[0].name
  location = google_cloud_run_v2_service.worker[0].location
  role     = "roles/run.invoker"
  member   = google_service_account.worker_push[0].member
}

# Pub/Sub's own account must be able to make tokens as the push identity. Google's documentation
# says projects made after 2021-04-08 already allow this through Pub/Sub's service-agent role, so on
# this project the grant is very likely redundant. It is declared anyway, on this one account and
# not the project, so the dependency is written down and does not rest on a default.
resource "google_service_account_iam_member" "pubsub_signs_as_push" {
  count              = local.with_worker
  service_account_id = google_service_account.worker_push[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = local.pubsub_agent
}

# ---------- The second subscription on the existing topic ----------

# Every message published to the topic goes to both subscriptions: BigQuery's (events.tf) and this one.
resource "google_pubsub_subscription" "to_worker" {
  count = local.with_worker_push
  name  = "${var.service_name}-events-to-worker"
  topic = google_pubsub_topic.events[0].id

  # How long Pub/Sub waits for the worker's answer before it counts the try as failed.
  ack_deadline_seconds = 30
  # If the worker is away, hold messages for three days. The worker's record of what it has counted
  # lasts seven, so a message held this long is still counted once (web/shared/stats.ts).
  message_retention_duration = "259200s"
  expiration_policy {
    ttl = "" # never delete the subscription for being idle
  }

  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker[0].uri}/push"

    # Each push carries a token signed by Google that says "I am the push identity, calling this
    # service". Cloud Run checks the signature, the audience and the permission; the worker's own
    # code checks that the identity is this one. The audience is the service's address with no path:
    # that is what Cloud Run's documentation asks for.
    oidc_token {
      service_account_email = google_service_account.worker_push[0].email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }

  # A failed delivery is tried again after a wait that grows, from one minute to ten. The minimum is
  # a minute, not Pub/Sub's default of ten seconds, so that five tries span at least four minutes:
  # long enough for a bad deploy to be rolled back before its messages are set aside.
  retry_policy {
    minimum_backoff = "60s"
    maximum_backoff = "600s"
  }

  # After five failed tries a message goes to the existing dead-letter topic, where a person can look
  # at it, instead of being retried for three days.
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.events_refused[0].id
    max_delivery_attempts = 5
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.push_calls_worker,
    google_service_account_iam_member.pubsub_signs_as_push,
    # Publishing to the dead-letter topic: already granted for the BigQuery subscription.
    google_pubsub_topic_iam_member.pubsub_sets_aside,
  ]
}

# Pub/Sub must also be allowed to take a message off this subscription once it has set it aside.
resource "google_pubsub_subscription_iam_member" "pubsub_acknowledges_worker" {
  count        = local.with_worker_push
  subscription = google_pubsub_subscription.to_worker[0].name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}

# ---------- Alerts: the worker's two objectives ----------

# No visitor waits on the worker, so "fast" and "up" mean something different here: messages should
# not sit undelivered, and none should end up set aside.

resource "google_monitoring_alert_policy" "worker_behind" {
  count        = local.with_worker_push
  display_name = "${var.worker_name}: a message has waited more than 10 minutes"
  combiner     = "OR"

  conditions {
    display_name = "Oldest undelivered message older than 10 minutes"
    condition_threshold {
      # The age, in seconds, of the oldest message the worker has not yet acknowledged.
      filter          = "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" AND resource.type=\"pubsub_subscription\" AND resource.label.subscription_id=\"${google_pubsub_subscription.to_worker[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 600
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "The events worker is not keeping up, or is refusing messages. Visitors are not affected: only the counts on the How it works page are late. Look at the worker's log first (`gcloud run services logs read ${var.worker_name} --region ${var.region}`), then its latest deploy. Messages wait for three days and are counted once when they are delivered. To go back a version: `docs/DEPLOY.md`, \"The events worker\"."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}

resource "google_monitoring_alert_policy" "events_set_aside" {
  count        = local.with_worker_push
  display_name = "${var.service_name}: a message is in the dead-letter topic"
  combiner     = "OR"

  conditions {
    display_name = "Anything waiting in the dead-letter subscription"
    condition_threshold {
      # Messages either subscription gave up on (five failed tries) are published to the dead-letter
      # topic and wait in its subscription for a week. Any at all is worth a look.
      filter          = "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.type=\"pubsub_subscription\" AND resource.label.subscription_id=\"${google_pubsub_subscription.refused[0].name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "A message could not be delivered after five tries and was set aside: by the events worker (it could not be counted) or by BigQuery (the table refused the row). Read it without removing it: `gcloud pubsub subscriptions pull ${var.service_name}-events-refused --limit 5`. The attribute `CloudPubSubDeadLetterSourceSubscription` says which subscription gave up. This alert stays open until the message is acknowledged or a week passes: `docs/DEPLOY.md`, \"The events worker\"."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}
