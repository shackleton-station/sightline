# A Memorystore for Redis Cluster, for a short drill: hash slots, a key that moves when the cluster
# is resharded, and what a client does when it is redirected (docs/ARCHITECTURE_PHASE_4.md, section 3).
#
# Off by default. `redis_cluster = true` creates everything in this file and gives the co-pilot
# service the cluster's address (copilot.tf); `false` removes it all again. The live site's risk is
# kept near nothing: only the co-pilot's kept answers go to the cluster, and when it fails they go
# to the ordinary instance instead (web/copilot/clusterCache.ts).
#
#   Private Service Connect   A Redis Cluster has no address in our network by itself. Google
#                             creates endpoints for it in a subnet of ours, and may do so only
#                             where a service connection policy for the class
#                             `gcp-memorystore-redis` says it may.
#   The cluster               The smallest that shows more than one shard: two nodes of the
#                             shared-core type, no replicas, no persistence.
#   The drill job             The drill has to run inside the network. A Cloud Run job, from the
#                             co-pilot's own image, with the same path to the network.
#
# What it costs, from Google's price list for us-east4 on 2026-11-12: $0.0318 an hour per node, so
# $0.0636 an hour for two shards and $0.0954 for three. A job is billed only while it runs, and a
# policy is configuration. The cluster's two Private Service Connect endpoints are not counted:
# Google's cluster pages state no charge for them, and it was not confirmed either way.

locals {
  with_cluster = var.redis_cluster && var.shared_store ? 1 : 0
  # The drill job runs the co-pilot's image, so it exists only where that service does.
  with_cluster_drill = var.redis_cluster && var.shared_store && var.copilot_service ? 1 : 0
}

# Creating a cluster fails without these two (Google's page on the cluster's networking). The
# first is already on in this project; declaring it is harmless. Neither is switched off again.
resource "google_project_service" "cluster_apis" {
  for_each = var.redis_cluster ? toset(["networkconnectivity.googleapis.com", "serviceconsumermanagement.googleapis.com"]) : toset([])
  service  = each.value

  disable_on_destroy = false
}

# An API reports itself enabled a little before it accepts calls.
resource "time_sleep" "cluster_apis_ready" {
  count           = local.with_cluster
  create_duration = "60s"
  # Also the applier's network-connectivity role (pipeline.tf), which may be granted in the same apply: a new
  # grant can take a minute to be honoured.
  depends_on = [google_project_service.cluster_apis, google_project_iam_member.applier["network_connect"]]
}

# "Memorystore may create Private Service Connect endpoints for Redis clusters in this subnet of
# this network." One policy per network, region and service class.
resource "google_network_connectivity_service_connection_policy" "redis_cluster" {
  count         = local.with_cluster
  name          = "${var.service_name}-redis-cluster"
  location      = var.region
  service_class = "gcp-memorystore-redis"
  description   = "Lets Memorystore for Redis Cluster place its endpoints in the default subnet, for the cluster drill."
  network       = data.google_compute_network.default.id

  psc_config {
    subnetworks = [data.google_compute_subnetwork.default.id]
  }

  depends_on = [time_sleep.cluster_apis_ready]
}

resource "google_redis_cluster" "cache" {
  count  = local.with_cluster
  name   = "${var.service_name}-cache"
  region = var.region

  # Each shard is one primary holding a share of the 16,384 hash slots. Changing this number is
  # the reshard: an update in place, during which the cluster stays up and slots move.
  shard_count = var.redis_cluster_shards
  # No replicas: a cache that can be lost, for a drill. A shard that fails takes its slots with it.
  replica_count = 0
  # The smallest node: half a shared CPU and 1.4 GB, no SLA. Google's page says it is for
  # development and testing, which this is.
  node_type = "REDIS_SHARED_CORE_NANO"

  # As the ordinary instance: no password and no TLS, reachable only from inside the network.
  authorization_mode      = "AUTH_MODE_DISABLED"
  transit_encryption_mode = "TRANSIT_ENCRYPTION_MODE_DISABLED"

  # A drill's cluster: `redis_cluster = false` must be able to remove it.
  deletion_protection_enabled = false

  psc_configs {
    network = data.google_compute_network.default.id
  }

  depends_on = [google_network_connectivity_service_connection_policy.redis_cluster]
}

# The drill, as a job that is run by hand:
#   gcloud run jobs execute clps-cluster-drill --region us-east4 --args before --wait
# It runs as the co-pilot's identity, because Redis asks for no identity and the job needs none of
# its own. No grant is made for it.
resource "google_cloud_run_v2_job" "cluster_drill" {
  count    = local.with_cluster_drill
  name     = "clps-cluster-drill"
  location = var.region

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.copilot[0].email
      timeout         = "600s"
      # A drill that fails is read, not retried.
      max_retries = 0

      vpc_access {
        egress = "PRIVATE_RANGES_ONLY"
        network_interfaces {
          network    = data.google_compute_network.default.name
          subnetwork = data.google_compute_subnetwork.default.name
        }
      }

      containers {
        # The co-pilot's image as it is live when this is planned: it carries the drill as a
        # second program (web/copilot/Dockerfile). It must be an image built after Phase 4.
        image   = google_cloud_run_v2_service.copilot[0].template[0].containers[0].image
        command = ["node", "cluster-drill.cjs"]
        args    = ["before"]

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }

        env {
          name  = "CACHE_CLUSTER_HOST"
          value = google_redis_cluster.cache[0].discovery_endpoints[0].address
        }
        env {
          name  = "CACHE_CLUSTER_PORT"
          value = tostring(google_redis_cluster.cache[0].discovery_endpoints[0].port)
        }
      }
    }
  }
}
