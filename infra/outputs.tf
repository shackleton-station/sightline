output "site_url" {
  description = "The Cloud Run address. It keeps working after the site gets its own domain."
  value       = google_cloud_run_v2_service.web.uri
}

output "public_url" {
  description = "The address to share: the domain when one is set, else the Cloud Run address."
  value       = local.with_domain ? "https://${var.domain}" : google_cloud_run_v2_service.web.uri
}

output "load_balancer_ip" {
  description = "The address the domain's DNS records point at."
  value       = local.with_domain ? google_compute_global_address.site[0].address : null
}

output "dns_zone" {
  description = "Cloud DNS zone to name when buying the domain (--cloud-dns-zone)."
  value       = local.with_domain ? google_dns_managed_zone.site[0].name : null
}

output "image_repository" {
  description = "Where to push the web app's images."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.web.repository_id}"
}

output "assets_bucket" {
  description = "Bucket for terrain tiles (tiles/) and the demo video (media/)."
  value       = google_storage_bucket.assets.name
}

output "github_workload_identity_provider" {
  description = "Value for `workload_identity_provider` in the GitHub deploy workflow."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_deployer_service_account" {
  description = "Value for `service_account` in the GitHub deploy workflow."
  value       = google_service_account.deployer.email
}

output "redis_host" {
  description = "Private address of Redis; reachable only from inside the project's network."
  value       = var.shared_store ? google_redis_instance.store[0].host : null
}

output "redis_shape" {
  description = "The Redis instance's tier, node size and whether it has read replicas."
  value       = var.shared_store ? "${google_redis_instance.store[0].tier}, ${google_redis_instance.store[0].memory_size_gb} GB, ${var.redis_read_replicas ? "${var.redis_replica_count} read replica(s)" : "no read replicas"}" : null
}

output "redis_read_endpoint" {
  description = "Private address cached values are read from, on an instance with read replicas."
  value       = local.redis_read_endpoint ? google_redis_instance.store[0].read_endpoint : null
}

output "redis_cluster_discovery" {
  description = "The Redis Cluster's discovery address, during its drill window."
  value       = local.with_cluster == 1 ? "${google_redis_cluster.cache[0].discovery_endpoints[0].address}:${google_redis_cluster.cache[0].discovery_endpoints[0].port}" : null
}

output "plans_database" {
  description = "Firestore database that holds shared mission plans."
  value       = var.plans ? google_firestore_database.plans[0].name : null
}

output "plans_service_url" {
  description = "The plans service's own address. Visitors reach it through the load balancer, while plans_route is \"plans\"."
  value       = var.plans && var.plans_service ? google_cloud_run_v2_service.plans[0].uri : null
}

output "plans_route" {
  description = "Which service the load balancer sends /api/plans to."
  value       = local.route_to_plans ? "plans" : "web"
}

output "copilot_service_url" {
  description = "The co-pilot service's own address. Visitors reach it through the load balancer, while copilot_route is \"copilot\"."
  value       = var.copilot_service ? google_cloud_run_v2_service.copilot[0].uri : null
}

output "copilot_route" {
  description = "Which service the load balancer sends /api/chat, /api/chat/* and /api/ask to, and whether a fault is injected there."
  value       = "${local.route_to_copilot ? "copilot" : "web"}${local.copilot_faults ? " (with fault injection)" : ""}"
}

output "stats_database" {
  description = "Firestore database that holds the day's question counts."
  value       = var.question_log ? google_firestore_database.stats[0].name : null
}

output "events_worker_url" {
  description = "The events worker's address. It answers only identities with permission to call it."
  value       = var.question_log && var.events_worker ? google_cloud_run_v2_service.worker[0].uri : null
}

output "events_worker_push_identity" {
  description = "The service account Pub/Sub delivers events as."
  value       = var.question_log && var.events_worker ? google_service_account.worker_push[0].email : null
}

output "question_log_table" {
  description = "BigQuery table of the questions put to the co-pilot."
  value       = var.question_log ? "${var.project_id}.${google_bigquery_dataset.events[0].dataset_id}.${google_bigquery_table.questions[0].table_id}" : null
}
