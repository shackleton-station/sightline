# Two safety nets: an email if the site stops answering, and emails as spending grows.

resource "google_monitoring_notification_channel" "email" {
  display_name = "Site alerts"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }

  depends_on = [time_sleep.apis_ready]
}

# Asks for /version.json every 5 minutes from several regions.
resource "google_monitoring_uptime_check_config" "site" {
  display_name = "${var.service_name} is up"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path         = "/version.json"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      # What visitors use: the domain when there is one, else the Cloud Run address.
      host = local.with_domain ? var.domain : trimprefix(google_cloud_run_v2_service.web.uri, "https://")
    }
  }

  # Changing the host replaces the check. The alert below points at it, and Google refuses to
  # delete a check an alert still uses, so make the new one first.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_monitoring_alert_policy" "site_down" {
  display_name = "${var.service_name} is down"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing from more than one region"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.site.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }

      trigger {
        count = 1
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.name]
}

# Emails the billing account's admins at 50%, 90% and 100% of the monthly amount.
# Credits aren't counted, so this tracks real usage, not what's left to pay.
resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "${var.project_id} monthly usage"

  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    credit_types_treatment = "EXCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  depends_on = [time_sleep.apis_ready]
}

data "google_project" "this" {
  project_id = var.project_id
}
