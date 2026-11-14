# The question log: what people ask the co-pilot, kept so we can see what the site is used for
# and where the co-pilot falls short.
#
#   co-pilot service -> Pub/Sub topic -> BigQuery subscription -> BigQuery table
#
# The co-pilot only publishes a small message and moves on. Pub/Sub holds it and writes it to the
# table itself, so there is no consumer of ours to run, and a slow or broken analytics side never
# reaches a visitor. Nothing about who asked is recorded (see web/shared/events.ts), and rows are
# dropped after `question_log_days`.

locals {
  with_events = var.question_log ? 1 : 0
  # Pub/Sub writes to BigQuery as its own Google-managed account.
  pubsub_agent = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
}

resource "google_pubsub_topic" "events" {
  count = local.with_events
  name  = "${var.service_name}-events"

  # If nothing is reading, keep messages a day rather than forever.
  message_retention_duration = "86400s"

  depends_on = [time_sleep.apis_ready]
}

# Messages the table refuses (a field of the wrong type, say) land here instead of being retried forever.
resource "google_pubsub_topic" "events_refused" {
  count = local.with_events
  name  = "${var.service_name}-events-refused"

  message_retention_duration = "604800s"

  depends_on = [time_sleep.apis_ready]
}

resource "google_bigquery_dataset" "events" {
  count       = local.with_events
  dataset_id  = "site_events"
  description = "What the site records about its own use. No visitor identities."
  location    = var.region

  # A demo's data: `terraform destroy` may remove it.
  delete_contents_on_destroy = true

  depends_on = [time_sleep.apis_ready]
}

resource "google_bigquery_table" "questions" {
  count       = local.with_events
  dataset_id  = google_bigquery_dataset.events[0].dataset_id
  table_id    = "copilot_questions"
  description = "One row per question put to the co-pilot."

  deletion_protection = false

  # One partition per day, so a query over last week reads only last week, and old days expire whole.
  time_partitioning {
    type          = "DAY"
    field         = "at"
    expiration_ms = var.question_log_days * 24 * 60 * 60 * 1000
  }
  clustering = ["outcome", "site"]

  # Must match QuestionEvent in web/shared/events.ts: Pub/Sub maps each JSON field to its column
  # (web/events-worker/contract.test.ts checks the two against each other).
  schema = jsonencode([
    { name = "kind", type = "STRING", mode = "REQUIRED", description = "Always copilot_question, for now" },
    { name = "at", type = "TIMESTAMP", mode = "REQUIRED", description = "When the question arrived (UTC)" },
    { name = "question", type = "STRING", mode = "NULLABLE", description = "The visitor's words, at most 400 characters" },
    { name = "site", type = "STRING", mode = "NULLABLE", description = "Site on screen when they asked" },
    { name = "month", type = "STRING", mode = "NULLABLE", description = "Month on screen when they asked" },
    { name = "lookups", type = "STRING", mode = "REPEATED", description = "What the co-pilot looked up to answer" },
    { name = "cached", type = "BOOLEAN", mode = "NULLABLE", description = "Answered from the answer cache" },
    { name = "ms", type = "INTEGER", mode = "NULLABLE", description = "Time to answer, in milliseconds" },
    { name = "outcome", type = "STRING", mode = "NULLABLE", description = "answered, fallback, busy, refused (Claude declined to answer) or error" },
    # Added with the outbox: delivery is at least once from end to end, so the same event can be written
    # twice. Rows with the same id are the same event. Empty on rows from before the outbox. It is last
    # and NULLABLE because BigQuery only adds a column to a table in place that way.
    { name = "id", type = "STRING", mode = "NULLABLE", description = "The event's own id; two rows with the same id are one event delivered twice" },
  ])
}

# ---------- Who may do what ----------

# The co-pilot service publishes to this one topic (its grant is in copilot.tf). This is the web
# server's, from before the split: gone while the load balancer sends the co-pilot's paths to the
# co-pilot service, and back only when it does not (web_keeps_copilot in copilot.tf).
resource "google_pubsub_topic_iam_member" "web_publishes" {
  count  = local.web_keeps_copilot ? local.with_events : 0
  topic  = google_pubsub_topic.events[0].name
  role   = "roles/pubsub.publisher"
  member = google_service_account.web.member
}

# Pub/Sub may add rows to this one dataset...
resource "google_bigquery_dataset_iam_member" "pubsub_writes" {
  count      = local.with_events
  dataset_id = google_bigquery_dataset.events[0].dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = local.pubsub_agent
}

# ...and set aside what the table refuses.
resource "google_pubsub_topic_iam_member" "pubsub_sets_aside" {
  count  = local.with_events
  topic  = google_pubsub_topic.events_refused[0].name
  role   = "roles/pubsub.publisher"
  member = local.pubsub_agent
}

# Pub/Sub must also be allowed to take a message off the subscription once it has set it aside.
resource "google_pubsub_subscription_iam_member" "pubsub_acknowledges" {
  count        = local.with_events
  subscription = google_pubsub_subscription.to_bigquery[0].name
  role         = "roles/pubsub.subscriber"
  member       = local.pubsub_agent
}

# ---------- The pipe from the topic to the table ----------

resource "google_pubsub_subscription" "to_bigquery" {
  count = local.with_events
  name  = "${var.service_name}-events-to-bigquery"
  topic = google_pubsub_topic.events[0].id

  bigquery_config {
    table            = "${var.project_id}.${google_bigquery_dataset.events[0].dataset_id}.${google_bigquery_table.questions[0].table_id}"
    use_table_schema = true
    # A field the table doesn't know yet is left out, not a reason to refuse the row.
    drop_unknown_fields = true
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.events_refused[0].id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  # Google checks the permission when the subscription is made.
  depends_on = [google_bigquery_dataset_iam_member.pubsub_writes]
}

# A place to look at what was set aside; kept a week.
resource "google_pubsub_subscription" "refused" {
  count = local.with_events
  name  = "${var.service_name}-events-refused"
  topic = google_pubsub_topic.events_refused[0].id

  message_retention_duration = "604800s"
  expiration_policy {
    ttl = "" # never delete the subscription for being idle
  }
}

# ---------- Ready-made summaries of the question log ----------
#
# `at` is a reserved word in BigQuery, so the column is always written in backticks.
# Views are saved queries: they cost nothing until someone runs one, and they read only the days
# asked for. Open them in the BigQuery console, or chart them in Looker Studio.

locals {
  questions_table = "`${var.project_id}.${google_bigquery_dataset.events[0].dataset_id}.${google_bigquery_table.questions[0].table_id}`"
}

# One row a day: how many questions, how they ended, and how long answers took.
resource "google_bigquery_table" "questions_daily" {
  count       = local.with_events
  dataset_id  = google_bigquery_dataset.events[0].dataset_id
  table_id    = "questions_daily"
  description = "Per day: questions asked, how they ended, the share answered from the cache, and answer times."

  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        DATE(`at`) AS day,
        COUNT(*) AS questions,
        COUNTIF(outcome = 'answered') AS answered,
        COUNTIF(outcome = 'fallback') AS written_from_the_facts,
        COUNTIF(outcome = 'busy') AS model_busy,
        COUNTIF(outcome = 'error') AS failed,
        COUNTIF(outcome = 'refused') AS declined_by_the_model,
        ROUND(SAFE_DIVIDE(COUNTIF(cached), COUNT(*)), 3) AS share_from_cache,
        -- Answer times leave out cached answers, which take milliseconds and would flatter the figure.
        APPROX_QUANTILES(IF(cached, NULL, ms), 100 IGNORE NULLS)[SAFE_OFFSET(50)] AS median_ms,
        APPROX_QUANTILES(IF(cached, NULL, ms), 100 IGNORE NULLS)[SAFE_OFFSET(95)] AS p95_ms
      FROM ${local.questions_table}
      GROUP BY day
      ORDER BY day DESC
    SQL
  }
}

# What the co-pilot looks up most, which says what people actually want to know.
resource "google_bigquery_table" "lookups_by_kind" {
  count       = local.with_events
  dataset_id  = google_bigquery_dataset.events[0].dataset_id
  table_id    = "lookups_by_kind"
  description = "Per day and kind of lookup (month summary, ranking, landing windows...): how often the co-pilot used it."

  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT
        DATE(`at`) AS day,
        -- A lookup reads "Connecting Ridge, May 2027: month summary"; the kind is what follows the colon.
        -- One that ends in a time ("..., 12:00 UTC") has no kind after it: that is a look at one hour.
        IFNULL(REGEXP_EXTRACT(looked_up, r': ([^:]+)$'), 'conditions at one hour') AS kind,
        COUNT(*) AS times
      FROM ${local.questions_table}, UNNEST(lookups) AS looked_up
      WHERE NOT cached
      GROUP BY day, kind
      ORDER BY day DESC, times DESC
    SQL
  }
}

# Questions the co-pilot could not answer well: the list to read when improving it.
resource "google_bigquery_table" "questions_to_review" {
  count       = local.with_events
  dataset_id  = google_bigquery_dataset.events[0].dataset_id
  table_id    = "questions_to_review"
  description = "Questions that ended in a fallback, an error or a refusal, or were answered without looking anything up, newest first."

  deletion_protection = false

  view {
    use_legacy_sql = false
    query          = <<-SQL
      SELECT `at`, question, site, month, outcome, ms
      FROM ${local.questions_table}
      WHERE outcome IN ('fallback', 'error', 'refused') OR (outcome = 'answered' AND ARRAY_LENGTH(lookups) = 0)
      ORDER BY `at` DESC
    SQL
  }
}
