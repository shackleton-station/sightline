# The site's own address. Everything here is skipped while `domain` is empty, so the
# site still works on its run.app address alone.
#
#   visitor -> global IP -> load balancer (HTTPS, Google-managed certificate, CDN) -> Cloud Run
#
# The domain itself is bought once, by hand, with Cloud Domains (see infra/README.md):
# a purchase is not something to hide inside `terraform apply`.

locals {
  with_domain = var.domain != ""
  on_domain   = local.with_domain ? 1 : 0
  dns_label   = replace(var.domain, ".", "-")

  # A fault-injection drill on the co-pilot's paths (copilot.tf), switched on by either share.
  copilot_faults = local.with_domain && (var.copilot_fault_delay_percent > 0 || var.copilot_fault_abort_percent > 0)
  # Where the co-pilot's paths go when they have a rule of their own.
  copilot_paths_backend = local.route_to_copilot ? google_compute_backend_service.copilot[0].id : (local.with_domain ? google_compute_backend_service.web[0].id : null)
  # The path matcher `site` exists while any of its rules does.
  site_matcher = local.route_to_plans || local.route_to_copilot || local.copilot_faults || local.with_canary || local.assets_to_bucket || local.with_trek

  # The paths each rule matches. A route rule matches the path with the query string removed, the
  # same as the path rules these replaced did: `full` is one exact path, `prefix` everything under it.
  plans_paths   = [{ full = "/api/plans", prefix = null }, { full = null, prefix = "/api/plans/" }]
  copilot_paths = [{ full = "/api/chat", prefix = null }, { full = null, prefix = "/api/chat/" }, { full = "/api/ask", prefix = null }]
  # The names web/server/storage.ts serves, as paths (assets.tf).
  tile_paths  = concat([for p in local.tile_prefixes : { full = null, prefix = "/${p}" }], [for f in local.tile_files : { full = "/${f}", prefix = null }])
  media_paths = [for f in local.media_files : { full = "/${f}", prefix = null }]
  # Every path, for the web server's canary.
  every_path = [{ full = null, prefix = "/" }]
}

# ---------- DNS ----------

resource "google_dns_managed_zone" "site" {
  count       = local.on_domain
  name        = local.dns_label
  dns_name    = "${var.domain}."
  description = "Public DNS for the site."

  # Signs the zone's answers so they can't be forged on the way to a visitor.
  dnssec_config {
    state = "on"
  }

  # A zone made again gets other name servers and new signing keys, and the domain stops resolving
  # until the registration is pointed at them by hand (infra/README.md, "What cannot be deleted by
  # accident").
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_dns_record_set" "apex" {
  count        = local.on_domain
  managed_zone = google_dns_managed_zone.site[0].name
  name         = "${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.site[0].address]
}

resource "google_dns_record_set" "www" {
  count        = local.on_domain
  managed_zone = google_dns_managed_zone.site[0].name
  name         = "www.${var.domain}."
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.site[0].address]
}

# ---------- Load balancer ----------

# One address, announced from Google's edge worldwide.
resource "google_compute_global_address" "site" {
  count = local.on_domain
  name  = "${var.service_name}-ip"

  depends_on = [time_sleep.apis_ready]
}

# Tells the load balancer that its backend is the Cloud Run service.
resource "google_compute_region_network_endpoint_group" "web" {
  count                 = local.on_domain
  name                  = "${var.service_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }
}

resource "google_compute_backend_service" "web" {
  count                 = local.on_domain
  name                  = "${var.service_name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"

  backend {
    group = google_compute_region_network_endpoint_group.web[0].id
  }
  # Phase 8: the copy in the second region, and the outlier detection that sets a failing region aside
  # (second-region.tf). The same three blocks are on the plans and co-pilot backends.
  dynamic "backend" {
    for_each = local.second_region_backend["web"]
    content {
      group = backend.value
    }
  }
  dynamic "outlier_detection" {
    for_each = local.second_region_outlier_detection
    content {
      consecutive_gateway_failure           = outlier_detection.value.consecutive_gateway_failure
      enforcing_consecutive_gateway_failure = outlier_detection.value.enforcing_consecutive_gateway_failure
      consecutive_errors                    = outlier_detection.value.consecutive_errors
      enforcing_consecutive_errors          = outlier_detection.value.enforcing_consecutive_errors
      max_ejection_percent                  = outlier_detection.value.max_ejection_percent
      interval {
        seconds = outlier_detection.value.interval_seconds
      }
      base_ejection_time {
        seconds = outlier_detection.value.base_ejection_seconds
      }
    }
  }

  # The CDN keeps what the server's own Cache-Control headers allow: hashed assets for a
  # year and terrain tiles for a day. The page, version.json and /api/* are never kept.
  enable_cdn = true
  cdn_policy {
    cache_mode = "USE_ORIGIN_HEADERS"

    # One cached copy per address, whatever tracking text a shared link carries after "?".
    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = false
    }
  }

  log_config {
    enable      = true
    sample_rate = 1
  }

  # The edge firewall (edge.tf) checks each request before it gets here.
  security_policy = google_compute_security_policy.edge[0].id
}

resource "google_compute_url_map" "site" {
  count           = local.on_domain
  name            = "${var.service_name}-https"
  default_service = google_compute_backend_service.web[0].id

  # www.<domain> forwards to the bare domain, so every link has one form.
  host_rule {
    hosts        = ["www.${var.domain}"]
    path_matcher = "www"
  }
  path_matcher {
    name = "www"
    default_url_redirect {
      host_redirect          = var.domain
      https_redirect         = true
      strip_query            = false
      redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    }
  }

  # The path matcher `site`: every rule for the domain that sends a request anywhere other than the
  # web server. It holds route rules, which can match a header as well as a path; one path matcher
  # cannot mix route rules and path rules (the URL map's API reference: "Within a given pathMatcher,
  # only one of pathRules or routeRules must be set"), so the plans and co-pilot rules, which were
  # path rules until Phase 6, are route rules too. A request matches the rule with the lowest
  # priority number that fits it, so the order below is the order they are tried in:
  #
  #   10  /api/plans, /api/plans/*  with x-clps-canary: plans    -> plans' canary         (canary_route)
  #   20  /api/plans, /api/plans/*                               -> plans                 (plans_route = "plans")
  #   30  the co-pilot's paths      with x-clps-canary: copilot  -> the co-pilot's canary (canary_route)
  #   40  the co-pilot's paths                                   -> the co-pilot, or the web server during a drill (copilot_route, copilot_fault_*)
  #   50  the tiles the web server serves                        -> backend bucket clps-web-tiles (assets_route = "bucket")
  #   60  the five media files                                   -> backend bucket clps-web-media (assets_route = "bucket")
  #   70  /trek/*                                                -> https://trek.nasa.gov/tiles/Moon/* through Cloud CDN (trek_route, trek.tf)
  #   90  any path                  with x-clps-canary: web      -> the web server's canary (canary_route)
  #   --  anything else                                          -> the web server
  #
  # So a canary header only ever changes where its own service's paths go: "web" sends the pages to
  # the web server's next version and leaves the plans, co-pilot and asset paths where they are, and
  # the plans and co-pilot canaries work whichever way their visitor routes are set, so a deploy can
  # test a service that visitors do not reach. The fault drill is on rule 40 only, so it never touches
  # a deploy's tests of the canary. With every switch off the matcher is not there at all, and the URL
  # map is what it was before the split. Every request for a host with no rule goes to the web server.
  dynamic "host_rule" {
    for_each = local.site_matcher ? [1] : []
    content {
      hosts        = [var.domain]
      path_matcher = "site"
    }
  }
  dynamic "path_matcher" {
    for_each = local.site_matcher ? [1] : []
    content {
      name            = "site"
      default_service = google_compute_backend_service.web[0].id

      dynamic "route_rules" {
        for_each = contains(keys(local.canary_services), "plans") ? [1] : []
        content {
          priority = 10
          service  = google_compute_backend_service.canary["plans"].id
          dynamic "match_rules" {
            for_each = local.plans_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
              header_matches {
                header_name = local.canary_header
                exact_match = "plans"
              }
            }
          }
        }
      }

      dynamic "route_rules" {
        for_each = local.route_to_plans ? [1] : []
        content {
          priority = 20
          service  = google_compute_backend_service.plans[0].id
          dynamic "match_rules" {
            for_each = local.plans_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
            }
          }
        }
      }

      dynamic "route_rules" {
        for_each = contains(keys(local.canary_services), "copilot") ? [1] : []
        content {
          priority = 30
          service  = google_compute_backend_service.canary["copilot"].id
          dynamic "match_rules" {
            for_each = local.copilot_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
              header_matches {
                header_name = local.canary_header
                exact_match = "copilot"
              }
            }
          }
        }
      }

      # The co-pilot's paths: to the co-pilot service once copilot_route is "copilot", else to the
      # web server. The rule exists while it routes to the co-pilot, or while a fault is injected.
      #
      # A rule names its backend either as `service` or inside `route_action` as a weighted backend;
      # never both (the URL map's API reference: "Only one of urlRedirect, service or
      # routeAction.weightedBackendService can be set"). A fault-injection policy lives in
      # `route_action`, so during a drill the backend moves there, with weight 100, beside the policy.
      dynamic "route_rules" {
        for_each = local.route_to_copilot || local.copilot_faults ? [1] : []
        content {
          priority = 40
          service  = local.copilot_faults ? null : local.copilot_paths_backend
          dynamic "match_rules" {
            for_each = local.copilot_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
            }
          }

          dynamic "route_action" {
            for_each = local.copilot_faults ? [1] : []
            content {
              weighted_backend_services {
                backend_service = local.copilot_paths_backend
                weight          = 100
              }
              fault_injection_policy {
                dynamic "delay" {
                  for_each = var.copilot_fault_delay_percent > 0 ? [1] : []
                  content {
                    fixed_delay {
                      seconds = tostring(var.copilot_fault_delay_seconds)
                    }
                    percentage = var.copilot_fault_delay_percent
                  }
                }
                dynamic "abort" {
                  for_each = var.copilot_fault_abort_percent > 0 ? [1] : []
                  content {
                    http_status = var.copilot_fault_abort_status
                    percentage  = var.copilot_fault_abort_percent
                  }
                }
              }
            }
          }
        }
      }

      # Tiles and video from the bucket (assets.tf). Only the names the web server serves: any other
      # path under /tiles or /media still reaches the web server, which answers 404.
      dynamic "route_rules" {
        for_each = local.assets_to_bucket ? [1] : []
        content {
          priority = 50
          service  = google_compute_backend_bucket.tiles[0].id
          dynamic "match_rules" {
            for_each = local.tile_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
            }
          }
        }
      }
      dynamic "route_rules" {
        for_each = local.assets_to_bucket ? [1] : []
        content {
          priority = 60
          service  = google_compute_backend_bucket.media[0].id
          dynamic "match_rules" {
            for_each = local.media_paths
            content {
              full_path_match = match_rules.value.full
              prefix_match    = match_rules.value.prefix
            }
          }
        }
      }

      # Moon Trek's map tiles (trek.tf): /trek/SP/<product>/... is asked of NASA as /tiles/Moon/SP/<product>/...
      # and kept at the edge. Nothing else on that server can be reached this way.
      dynamic "route_rules" {
        for_each = local.with_trek ? [1] : []
        content {
          priority = 70
          service  = google_compute_backend_service.trek[0].id
          match_rules {
            prefix_match = "/trek/"
          }
          route_action {
            url_rewrite {
              path_prefix_rewrite = "/tiles/Moon/"
              host_rewrite        = "trek.nasa.gov"
            }
          }
        }
      }
      dynamic "route_rules" {
        for_each = contains(keys(local.canary_services), "web") ? [1] : []
        content {
          priority = 90
          service  = google_compute_backend_service.canary["web"].id
          dynamic "match_rules" {
            for_each = local.every_path
            content {
              prefix_match = match_rules.value.prefix
              header_matches {
                header_name = local.canary_header
                exact_match = "web"
              }
            }
          }
        }
      }
    }
  }
}

# Google issues and renews this certificate once the DNS records above resolve.
resource "google_compute_managed_ssl_certificate" "site" {
  count = local.on_domain
  name  = "${local.dns_label}-cert"

  managed {
    domains = [var.domain, "www.${var.domain}"]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_compute_target_https_proxy" "site" {
  count            = local.on_domain
  name             = "${var.service_name}-https"
  url_map          = google_compute_url_map.site[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.site[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.on_domain
  name                  = "${var.service_name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.site[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.site[0].id
}

# Plain HTTP only ever answers "use HTTPS".
resource "google_compute_url_map" "to_https" {
  count = local.on_domain
  name  = "${var.service_name}-to-https"

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_compute_target_http_proxy" "to_https" {
  count   = local.on_domain
  name    = "${var.service_name}-to-https"
  url_map = google_compute_url_map.to_https[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.on_domain
  name                  = "${var.service_name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.site[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.to_https[0].id
}
