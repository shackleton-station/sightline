# The edge firewall (Cloud Armor), in front of the load balancer. It turns abusive traffic away at
# Google's edge, before it reaches the server or costs anything there.
#
# This is the outer layer of three: here by address, then the server's own limits per visitor
# (shared through Redis), then the daily ceiling on what the co-pilot may cost.
# It only exists with a domain, because it attaches to the load balancer.

resource "google_compute_security_policy" "edge" {
  count       = local.on_domain
  name        = "${var.service_name}-edge"
  description = "Rate limits by address, and a web-attack rule in watch-only mode."

  # The API: a person asks a few questions a minute. 120 calls a minute from one address is a script.
  rule {
    priority    = 1000
    action      = "throttle"
    description = "At most 120 API calls a minute from one address; the rest get 429."
    match {
      expr {
        expression = "request.path.startsWith('/api/')"
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 120
        interval_sec = 60
      }
    }
  }

  # Everything: opening the 3D view asks for about 80 terrain tiles at once, so the ceiling is high.
  # An address that goes past it is turned away for five minutes.
  rule {
    priority    = 2000
    action      = "rate_based_ban"
    description = "An address sending more than 3,000 requests a minute is refused for 5 minutes."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 3000
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
  }

  # Google's ready-made rule for cross-site scripting attempts. Watch-only (`preview`): it logs what
  # it would have blocked and blocks nothing, so a false alarm can't lock a visitor out.
  rule {
    priority    = 3000
    action      = "deny(403)"
    preview     = true
    description = "Cross-site scripting patterns: logged, not blocked."
    match {
      expr {
        expression = "evaluatePreconfiguredWaf('xss-v33-stable', {'sensitivity': 1})"
      }
    }
  }

  rule {
    priority    = 2147483647
    action      = "allow"
    description = "Everything else is welcome."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [time_sleep.apis_ready]
}
