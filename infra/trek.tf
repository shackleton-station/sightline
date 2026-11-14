# Moon Trek's map tiles through the site's own CDN.
#
#   visitor -> load balancer -> Cloud CDN -> /trek/* -> https://trek.nasa.gov/tiles/Moon/*
#
# The Layers panel draws NASA's own maps of the polar ground from Moon Trek's tile server. Fetched
# straight from trek.nasa.gov, every visitor's browser asks NASA for every tile. Through this route a
# tile is asked of NASA once and then kept at Google's edge for a month, so the next visitor (and the
# next room full of them) gets it from the CDN, on the connection the page already has open.
#
#   What it reaches   Only trek.nasa.gov, and only paths under /tiles/Moon/: the rule rewrites the
#                     prefix /trek/ to /tiles/Moon/, so no other address on that server, and no other
#                     server, can be asked for through the site.
#   What is kept      Any answer, for 30 days at the edge and a day in the browser (the tiles are
#                     finished mosaics; they do not change). A 404 (ground a product does not cover)
#                     is kept for half an hour, the longest Cloud CDN allows for an error.
#   Who may ask       Anyone who can reach the site: the same edge firewall as every other backend.
#   Cost              No fixed charge: an internet endpoint group and a backend service cost nothing
#                     by themselves. Traffic is billed at Cloud CDN's rates (cache fill once per tile,
#                     cache egress per visitor).
#   The way back      Take `trek_route = true` out of settings.auto.tfvars. The page falls back to
#                     trek.nasa.gov by itself when /trek/ does not answer (web/src/data/trekPicture.ts).

variable "trek_route" {
  description = "Fetch Moon Trek's map tiles through the load balancer and Cloud CDN: /trek/* goes to https://trek.nasa.gov/tiles/Moon/* and answers are kept at the edge for 30 days (trek.tf). Needs a domain."
  type        = bool
  default     = false
}

locals {
  with_trek = local.with_domain && var.trek_route
}

# An address on the internet as a backend: Google's edge connects to it over HTTPS.
resource "google_compute_global_network_endpoint_group" "trek" {
  count                 = local.with_trek ? 1 : 0
  name                  = "${var.service_name}-trek"
  network_endpoint_type = "INTERNET_FQDN_PORT"
  default_port          = 443
}

resource "google_compute_global_network_endpoint" "trek" {
  count                         = local.with_trek ? 1 : 0
  global_network_endpoint_group = google_compute_global_network_endpoint_group.trek[0].name
  fqdn                          = "trek.nasa.gov"
  port                          = 443
}

resource "google_compute_backend_service" "trek" {
  count                 = local.with_trek ? 1 : 0
  name                  = "${var.service_name}-trek"
  description           = "Moon Trek's map tiles (trek.nasa.gov/tiles/Moon/), through Cloud CDN. Kept 30 days."
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  timeout_sec           = 30

  backend {
    group = google_compute_global_network_endpoint_group.trek[0].id
  }

  # NASA's server is asked by its own name, whatever name the visitor used for the site.
  custom_request_headers = ["Host: trek.nasa.gov"]

  enable_cdn = true
  cdn_policy {
    cache_mode  = "FORCE_CACHE_ALL"
    default_ttl = 2592000
    client_ttl  = 86400

    negative_caching = true
    negative_caching_policy {
      code = 404
      ttl  = 1800
    }

    # One cached copy per tile, whatever is after "?".
    cache_key_policy {
      include_host         = false
      include_protocol     = false
      include_query_string = false
    }
  }

  log_config {
    enable      = true
    sample_rate = 1
  }

  # The edge firewall (edge.tf) checks each request before it gets here.
  security_policy = google_compute_security_policy.edge[0].id

  depends_on = [google_compute_global_network_endpoint.trek]
}
