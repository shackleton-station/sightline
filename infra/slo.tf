# What "working" means, as numbers we hold ourselves to, and a way to see where a slow request
# spent its time.
#
#   Availability  99.5% of requests succeed, over any 28 days. That allows about 3 h 20 min of
#                 total failure a month: honest for one region and a demo, and a real budget.
#   Speed         90% of requests answer within 2 seconds. Pages and terrain take milliseconds;
#                 the co-pilot takes seconds, which is what the other 10% is for.
#
# The alert watches how fast the allowance is being used up ("burn rate"), not single failures:
# ten times too fast for an hour means the month's allowance would be gone in under three days.

locals {
  with_slo = var.objectives ? 1 : 0
}

# Tells Cloud Monitoring that the Cloud Run service is a "service" it can hold objectives for.
resource "google_monitoring_service" "web" {
  count        = local.with_slo
  service_id   = var.service_name
  display_name = "Web app (${var.service_name})"

  basic_service {
    service_type = "CLOUD_RUN"
    service_labels = {
      service_name = google_cloud_run_v2_service.web.name
      location     = var.region
    }
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_monitoring_slo" "availability" {
  count        = local.with_slo
  service      = google_monitoring_service.web[0].service_id
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

resource "google_monitoring_slo" "speed" {
  count        = local.with_slo
  service      = google_monitoring_service.web[0].service_id
  slo_id       = "speed"
  display_name = "90% of requests answer within 2 s (28 days)"

  goal                = 0.9
  rolling_period_days = 28

  basic_sli {
    latency {
      threshold = "2s"
    }
  }
}

resource "google_monitoring_alert_policy" "burning_budget" {
  count        = local.with_slo
  display_name = "${var.service_name} is failing too often"
  combiner     = "OR"

  conditions {
    display_name = "Using the month's failure allowance 10 times too fast"
    condition_threshold {
      filter          = "select_slo_burn_rate(\"${google_monitoring_slo.availability[0].name}\", \"3600s\")"
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "0s"
    }
  }

  documentation {
    mime_type = "text/markdown"
    content   = "More than 5% of requests failed over the last hour. Check the latest deploy first (Cloud Run revisions), then Vertex AI, Redis and Firestore. To go back: `gcloud run services update-traffic ${var.service_name} --region ${var.region} --to-revisions <last good>=100`."
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}

# ---------- Tracing ----------

# The server may write traces of its own requests (web/server/trace.ts) to Cloud Trace.
resource "google_project_iam_member" "web_traces" {
  count   = var.tracing ? 1 : 0
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = google_service_account.web.member
}
