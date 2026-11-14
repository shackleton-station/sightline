# What the server keeps between requests, and what visitors save.
#
#   Redis (Memorystore)  rate-limit counts and cached co-pilot answers, shared by every copy of
#                        the server. Private address only: reachable from our network, not the internet.
#   Firestore            mission plans that visitors save to share by link. The plans service
#                        (plans.tf) is taking this database over from the web server.
#
# The server works without either (limits fall back to each copy's memory; sharing switches off),
# so both can be turned off with `shared_store = false` and `plans = false`.

locals {
  with_redis = var.shared_store ? 1 : 0
  with_plans = var.plans ? 1 : 0
  # Whether the instance has a read endpoint for the services to read cached values from.
  redis_read_endpoint = var.shared_store && var.redis_read_replicas
}

# ---------- The private network Cloud Run uses to reach Redis ----------

# The project's default network, which the pipeline VM is on too.
data "google_compute_network" "default" {
  name = "default"

  depends_on = [time_sleep.apis_ready]
}

data "google_compute_subnetwork" "default" {
  name   = "default"
  region = var.region

  depends_on = [time_sleep.apis_ready]
}

# ---------- Redis ----------

# The tier, the size and the read replicas are variables, so a measured window with a replica is a
# change of settings and not of code (docs/ARCHITECTURE_PHASE_4.md). The defaults are the instance
# as it has always been: Basic, 1 GB, one node. Losing it loses only counts and a cache.
#
# Changing the tier REPLACES the instance: Memorystore cannot turn a Basic instance into a Standard
# one or back ("It is not possible to upgrade from Basic Tier to Standard Tier or the other way
# around", Google's page on tiers), and the provider marks `tier` as forcing a new resource. The
# new instance is empty and has a new address, which the services below are given in the same
# apply. Between the old one going and the new one being ready there is no Redis at all.
resource "google_redis_instance" "store" {
  count = local.with_redis
  # The name carries the tier, so that changing the tier makes a second instance beside the first
  # instead of reusing its name. Terraform has to make the new instance before it deletes the old one:
  # the uptime check (monitoring.tf) makes its replacement first, and that order passes down to
  # everything it depends on, the web service and so Redis among them. With one name for both, Google
  # refuses the new instance ("already exists"). With two, the services switch to the new address and
  # the old instance goes after: a quick switch instead of minutes without Redis. Basic keeps the
  # name the first instance had, so the defaults plan no change.
  name           = var.redis_tier == "BASIC" ? "${var.service_name}-store" : "${var.service_name}-store-${replace(lower(var.redis_tier), "_", "-")}"
  display_name   = "Rate limits and cached answers"
  region         = var.region
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_gb
  redis_version  = "REDIS_7_2"

  # Read replicas: a second address, the read endpoint, that answers reads from the replicas. Left
  # unset when off, so the instance keeps what it has (READ_REPLICAS_DISABLED) and a plan shows
  # nothing. Once on, they cannot be switched off on that instance: going back is another replace.
  read_replicas_mode = var.redis_read_replicas ? "READ_REPLICAS_ENABLED" : null
  replica_count      = var.redis_read_replicas ? var.redis_replica_count : null

  # The private range the instance's nodes take their addresses from. Unset, the service picks a
  # free one: a /29 without read replicas, a /28 with them, which is the size they need.
  reserved_ip_range = var.redis_reserved_range != "" ? var.redis_reserved_range : null

  authorized_network = data.google_compute_network.default.id
  connect_mode       = "DIRECT_PEERING"

  # Every key we write expires. If memory ever fills, drop the least recently used of them.
  redis_configs = {
    maxmemory-policy = "volatile-lru"
  }

  depends_on = [time_sleep.apis_ready]
}

# ---------- Firestore ----------

# A database of its own, so the project's default one stays free.
resource "google_firestore_database" "plans" {
  count       = local.with_plans
  name        = "plans"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  # A demo's data: `terraform destroy` may remove it.
  delete_protection_state = "DELETE_PROTECTION_DISABLED"
  deletion_policy         = "DELETE"

  # But not by accident: saved plans cannot be made again. Terraform refuses any plan that would
  # delete or replace this database until this block is removed (infra/README.md, "What cannot be
  # deleted by accident").
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

# Each plan carries an `expires` time; Firestore deletes it once that has passed.
resource "google_firestore_field" "plan_expiry" {
  count      = local.with_plans
  database   = google_firestore_database.plans[0].name
  collection = "plans"
  field      = "expires"

  ttl_config {}
}

# "My plans, newest first": one person's plans, by `owner`, ordered by `created` from the newest.
# Firestore keeps an index on every single field by itself, but a query that filters on one field
# and orders by another needs a composite index, declared here, and refuses to run without it.
# This one plays the part of DynamoDB's partition key plus sort key (docs/SYSTEM_DESIGN.md).
#
# The last field, the document id (`__name__`), is written out on purpose. Firestore adds it to every
# composite index, in the direction of the field before it, so declaring it changes nothing in the
# index; it shows the order the code pages by (web/plans/firestorePlans.ts): newest first, and between
# two plans saved in the same millisecond, the larger id first.
#
# Building it takes minutes; the apply waits until it is ready (up to the provider's 20-minute create
# timeout). Until then the plans code lists the old way (web/plans/firestorePlans.ts, pageByOwner).
# It exists whenever the database does: the web server runs the same handler as the plans service.
resource "google_firestore_index" "plans_by_owner" {
  count       = local.with_plans
  database    = google_firestore_database.plans[0].name
  collection  = "plans"
  query_scope = "COLLECTION"
  api_scope   = "ANY_API"

  fields {
    field_path = "owner"
    order      = "ASCENDING"
  }

  fields {
    field_path = "created"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "DESCENDING"
  }
}

# The web server may read and write this one database, and no other. This is the grant the plans
# service takes over (plans.tf): web_plans_access = false removes it, once the load balancer has
# been sending /api/plans to the plans service long enough to trust.
resource "google_project_iam_member" "web_plans" {
  count   = local.web_keeps_plans ? 1 : 0
  project = var.project_id
  role    = "roles/datastore.user"
  member  = google_service_account.web.member

  condition {
    title       = "only-the-plans-database"
    description = "The web app reads and writes shared mission plans, nothing else."
    expression  = "resource.name == \"projects/${var.project_id}/databases/${google_firestore_database.plans[0].name}\""
  }
}
