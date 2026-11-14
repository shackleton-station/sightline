# Phase 8: a second region (docs/ARCHITECTURE_PHASE_8.md, docs/decisions/0010-second-region.md).
#
#                                        +-> us-east4     web, plans, co-pilot (as before) --+
#   visitor -> load balancer (global) ---+                                                   +-> Redis, Firestore,
#              one backend service per   +-> us-central1  copies of web, plans, co-pilot ----+   Pub/Sub, the bucket:
#              service, two backends                       (this file)                           all in us-east4
#
# Each of web, plans and co-pilot gets a copy in `second_region`, and a serverless endpoint group there
# that becomes a second backend of the service's existing backend service. With two backends, the global
# external Application Load Balancer "sends traffic to the NEG in the closest region to minimize request
# latency" (Google's page on serverless NEGs). Serverless backends have no health checks ("Health checks
# are not supported for serverless backends"), so outlier detection is what lets the load balancer set a
# failing region aside: a copy that answers 502, 503 or 504 (or does not answer) three times in a row, as
# one proxy of the load balancer sees it, gets no requests from that proxy for 30 s. (Envoy, which this
# load balancer is built on, makes each further ejection longer; Google's pages do not say by how much.)
#
# Three switches, one pull request each, and two to switch off (docs/ARCHITECTURE_PHASE_8.md, section 4):
#
#   second_region          "us-central1" names the region and makes the web server's twin subnet. Free,
#                          and nothing runs in it yet.
#   second_region_copies   true makes the copies, their public grants and the endpoint groups. No visitor
#                          reaches them yet. (Same pull request as second_region.)
#   second_region_serve    true adds the endpoint groups to the three backend services, with outlier
#                          detection (domain.tf, plans.tf, copilot.tf). Visitors nearer us-central1 go there.
#
# Switching off is deleting the last two lines: every copy, endpoint group and grant goes in one apply. The
# subnet goes in a later pull request that deletes second_region, at least two hours after: Cloud Run keeps
# the addresses it took in a subnet for a while after a service is deleted, and Google's page on Direct VPC
# egress says to "wait 1-2 hours for Cloud Run to release the IP addresses before you delete the subnet".
#
# And the drill, region_drill: that region's three copies answer every request with 503 (web/shared/region.ts).
#
# The copies are the same as their twins in `region` by construction: the image, the identity, the
# timeout, the limits and every environment setting are read from the twin, so a setting changed there
# reaches the copy in the same apply. Four settings are the copy's own: REGION, DRILL_UNAVAILABLE, and the
# web server's PLANS_STATUS_URL and COPILOT_STATUS_URL, which name the plans and co-pilot copies in the
# same region, so its How it works page reports on its own region.
#
# What stays in `region`, on purpose: Redis, both Firestore databases, the Pub/Sub topic, the events
# worker and the assets bucket. A copy here reaches them across regions (section 3 of the phase doc says
# what that costs each path, and what a loss of us-east4 would still break).

locals {
  with_second_region   = local.with_domain && var.second_region != ""
  second_region_copies = local.with_second_region && var.second_region_copies
  second_region_serves = local.second_region_copies && var.second_region_serve

  # Each service that gets a copy, with its twin in `region`. Plans and the co-pilot only while they have a
  # backend on the load balancer (plans.tf, copilot.tf), which is what a copy is for.
  second_region_twins = local.second_region_copies ? merge(
    { web = google_cloud_run_v2_service.web },
    local.with_plans_backend == 1 ? { plans = google_cloud_run_v2_service.plans[0] } : {},
    local.with_copilot_backend == 1 ? { copilot = google_cloud_run_v2_service.copilot[0] } : {},
  ) : {}

  # Each copy's own address. Cloud Run gives every service the address https://<name>-<project number>.<region>.run.app
  # as well as the older random one (both are in the service's run.googleapis.com/urls), so it can be
  # written down before the service exists, which a copy's settings naming another copy needs.
  second_region_urls = { for key, twin in local.second_region_twins : key => "https://${twin.name}-${data.google_project.this.number}.${var.second_region}.run.app" }

  # The settings a copy does not take from its twin.
  second_region_own_env = ["REGION", "DRILL_UNAVAILABLE", "PLANS_STATUS_URL", "COPILOT_STATUS_URL"]
  status_url_for        = { PLANS_STATUS_URL = "plans", COPILOT_STATUS_URL = "copilot" }

  # The drill switches a region's copies off only while the other region serves visitors too.
  drill_in_region        = local.second_region_serves && var.region_drill == var.region
  drill_in_second_region = local.second_region_serves && var.region_drill == var.second_region

  # What domain.tf, plans.tf and copilot.tf add to their backend services while the second region serves.
  second_region_backend = { for key in ["web", "plans", "copilot"] : key => [for name, group in google_compute_region_network_endpoint_group.second_region : group.id if name == key && local.second_region_serves] }

  # Outlier detection, the only way the load balancer learns that a serverless backend is failing.
  # Only "gateway failures" count: 502, 503 and 504, and a request the copy did not answer. Not every 5xx
  # (enforcing_consecutive_errors stays 0, the API's default), because a 500 is a bug in the code,
  # which both regions run, and moving visitors would not help. 503 is also what the drill answers.
  #
  # consecutive_gateway_failure 3 and the 100% chance of acting on it are the API's own defaults, written
  # out. interval 1 s, base ejection 30 s and at most 50% of the backends set aside are the values in
  # Google's example for serverless NEGs; with two backends, 50% means one region at most, so the load
  # balancer never sets both aside. Each proxy of the load balancer decides on its own ("executed
  # independently by each proxy instance"), so each sees its own three failures first.
  second_region_outlier_detection = local.second_region_serves ? [{
    consecutive_gateway_failure           = 3
    enforcing_consecutive_gateway_failure = 100
    consecutive_errors                    = 5
    enforcing_consecutive_errors          = 0
    interval_seconds                      = 1
    base_ejection_seconds                 = 30
    max_ejection_percent                  = 50
  }] : []
}

# The default network makes a `default` subnet in every region by itself (it is an auto-mode network).
# Plans and the co-pilot send only traffic for private addresses (Redis) through it, as their twins do.
data "google_compute_subnetwork" "second_region_default" {
  count  = local.with_second_region ? 1 : 0
  name   = "default"
  region = var.second_region

  depends_on = [time_sleep.apis_ready]
}

# The twin of the web server's own subnet (network.tf): Direct VPC egress needs a subnet in the copy's own
# region, and the web server sends all of its traffic through the network with Private Google Access, so
# its status calls to the plans and co-pilot copies count as internal.
resource "google_compute_subnetwork" "second_region_web_egress" {
  count         = local.with_second_region && var.web_egress_through_vpc ? 1 : 0
  name          = "${var.service_name}-egress-${var.second_region}"
  description   = "The web server's outbound traffic in ${var.second_region} (Direct VPC egress, all traffic), with Private Google Access. Phase 8."
  region        = var.second_region
  network       = data.google_compute_network.default.id
  ip_cidr_range = var.second_region_egress_range

  private_ip_google_access = true

  depends_on = [time_sleep.apis_ready]
}

resource "google_cloud_run_v2_service" "second_region" {
  for_each = local.second_region_twins
  name     = each.value.name
  location = var.second_region
  ingress  = each.value.ingress

  deletion_protection = false

  template {
    service_account                  = each.value.template[0].service_account
    timeout                          = each.value.template[0].timeout
    max_instance_request_concurrency = each.value.template[0].max_instance_request_concurrency
    # The twin's labels, so the copy starts with the label that says which commit its image is from.
    labels = each.value.template[0].labels

    scaling {
      min_instance_count = coalesce(var.second_region_min_instances, each.value.template[0].scaling[0].min_instance_count)
      max_instance_count = each.value.template[0].scaling[0].max_instance_count
    }

    # The twin's way into the network, from this region's subnet: the web server's own (all traffic), or
    # the default one (private addresses only, for Redis).
    dynamic "vpc_access" {
      for_each = each.value.template[0].vpc_access
      content {
        egress = vpc_access.value.egress
        network_interfaces {
          network    = data.google_compute_network.default.name
          subnetwork = vpc_access.value.egress == "ALL_TRAFFIC" ? google_compute_subnetwork.second_region_web_egress[0].name : data.google_compute_subnetwork.second_region_default[0].name
        }
      }
    }

    containers {
      # The image the twin runs when this is created, so the copy never serves Google's placeholder.
      # After that the deploys set it (.github/workflows/deploy*.yml, web/scripts/second-region.sh).
      image = each.value.template[0].containers[0].image

      ports {
        container_port = each.value.template[0].containers[0].ports[0].container_port
      }

      resources {
        limits            = each.value.template[0].containers[0].resources[0].limits
        cpu_idle          = each.value.template[0].containers[0].resources[0].cpu_idle
        startup_cpu_boost = each.value.template[0].containers[0].resources[0].startup_cpu_boost
      }

      # Every setting of the twin, except the four that are the copy's own (below). A setting read from
      # Secret Manager is copied as a reference to the same secret, which the same identity may read.
      dynamic "env" {
        for_each = [for e in each.value.template[0].containers[0].env : e if !contains(local.second_region_own_env, e.name)]
        content {
          name  = env.value.name
          value = length(env.value.value_source) > 0 ? null : env.value.value
          dynamic "value_source" {
            for_each = env.value.value_source
            content {
              dynamic "secret_key_ref" {
                for_each = value_source.value.secret_key_ref
                content {
                  secret  = secret_key_ref.value.secret
                  version = secret_key_ref.value.version
                }
              }
            }
          }
        }
      }
      # The web server asks the plans and co-pilot copies in its own region for their status.
      dynamic "env" {
        for_each = [for e in each.value.template[0].containers[0].env : e if contains(keys(local.status_url_for), e.name)]
        content {
          name  = env.value.name
          value = lookup(local.second_region_urls, local.status_url_for[env.value.name], env.value.value)
        }
      }
      env {
        name  = "REGION"
        value = var.second_region
      }
      dynamic "env" {
        for_each = local.drill_in_second_region ? [1] : []
        content {
          name  = "DRILL_UNAVAILABLE"
          value = "on"
        }
      }
    }
  }

  # As the twins: the deploys own the image, the commit label and the traffic split.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      template[0].labels,
      client,
      client_version,
      traffic,
    ]
  }

  depends_on = [time_sleep.apis_ready]
}

# Public, as the twins are: the load balancer calls the copies for any visitor. Ingress (copied from the
# twin) still refuses a request from the internet on the copy's own run.app address.
resource "google_cloud_run_v2_service_iam_member" "second_region_public" {
  for_each = google_cloud_run_v2_service.second_region
  name     = each.value.name
  location = each.value.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Tells the load balancer that a backend is the copy in the second region. No tag: the copy's live split.
resource "google_compute_region_network_endpoint_group" "second_region" {
  for_each              = google_cloud_run_v2_service.second_region
  name                  = "${each.value.name}-${var.second_region}-neg"
  region                = var.second_region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value.name
  }
}
