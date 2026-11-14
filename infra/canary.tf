# Phase 6: each service's next version, reached through the load balancer (docs/ARCHITECTURE_PHASE_6.md).
#
#   request with "x-clps-canary: web"     -> clps-web-canary-backend     -> the web server's revision tagged canary
#   request with "x-clps-canary: plans"   -> clps-plans-canary-backend   -> (only on /api/plans, /api/plans/*)
#   request with "x-clps-canary: copilot" -> clps-copilot-canary-backend -> (only on /api/chat, /api/chat/*, /api/ask)
#   any other request                     -> as before
#
# Every deploy gives the version it has just made the tag `canary` and tests it before any visitor
# reaches it. Until Phase 6 it tested it on the tag's own run.app address, which skips the load
# balancer and the edge firewall. That address closes once service_ingress is "load-balancer", so the
# deploys test through the load balancer instead, with this header (the route rules are in domain.tf).
#
# The header is plain and documented on purpose: the repository keeps no secrets, and a secret
# header in a public workflow would not stay one. Anyone who sends it reaches a version that has
# passed nothing yet, through the same edge firewall and with the same limits as every other
# request. That is harmless here: the next version serves the same public site, and between deploys
# the tag sits on the version that is live (or on the last one a deploy made, if Terraform has made a
# newer one since).
#
# A serverless endpoint group can name a Cloud Run service and a tag ("the named revision", in the
# API reference of regionNetworkEndpointGroups). The tag is looked up by Cloud Run when a request
# arrives, so moving it to a new revision needs no change here.

locals {
  with_canary = local.with_domain && var.canary_route
  canary_tag  = "canary"
  # The header the route rules match, and the value for each service.
  canary_header = "x-clps-canary"

  canary_services = merge(
    local.with_canary ? { web = google_cloud_run_v2_service.web.name } : {},
    local.with_canary && local.with_plans_backend == 1 ? { plans = google_cloud_run_v2_service.plans[0].name } : {},
    local.with_canary && local.with_copilot_backend == 1 ? { copilot = google_cloud_run_v2_service.copilot[0].name } : {},
  )
}

resource "google_compute_region_network_endpoint_group" "canary" {
  for_each              = local.canary_services
  name                  = "${each.value}-canary-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = each.value
    tag     = local.canary_tag
  }
}

resource "google_compute_backend_service" "canary" {
  for_each              = local.canary_services
  name                  = "${each.value}-canary-backend"
  description           = "The revision of ${each.value} tagged ${local.canary_tag}, for requests carrying ${local.canary_header}: ${each.key}."
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.canary[each.key].id
  }

  # Never cached. A version under test must answer every request itself, and nothing it sends may
  # be kept for visitors of the live version.
  enable_cdn = false

  log_config {
    enable      = true
    sample_rate = 1
  }

  # The same edge firewall policy as every other backend (edge.tf). Cloud Armor counts a rate limit
  # for each backend separately, so a deploy's checks on the canary do not use up the live
  # service's 120 API calls a minute for the runner's address, nor the other way round.
  security_policy = google_compute_security_policy.edge[0].id
}
