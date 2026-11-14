# Phase 6: the web server's own subnet, so its calls to the other services stay inside Google's
# network (docs/ARCHITECTURE_PHASE_6.md, docs/decisions/0008-closing-the-side-doors.md).
#
# The web server asks the plans and co-pilot services for their status on their run.app addresses
# (web/server/services.ts). Once those addresses accept only the load balancer and internal traffic
# (service_ingress = "load-balancer"), a call from another Cloud Run service counts as internal only
# if it travels through a VPC network: Cloud Run's page on private networking, "Receive requests from
# other Cloud Run resources or App Engine". Today the web server sends only traffic for private
# addresses through the network (PRIVATE_RANGES_ONLY, for Redis), so a run.app call goes out to the
# internet and would be refused.
#
# The first of the three ways that page offers is used: send all of the web server's traffic through
# the network, from a subnet with Private Google Access, which lets addresses with no public IP reach
# Google's APIs and run.app. The default subnet does not have it, and is not in Terraform (the
# pipeline VM, the plans and co-pilot services and Redis's peering live on it), so the web server gets
# a subnet of its own here instead of a change to one Terraform does not manage. Nothing else moves.
#
# What changes for the web server: Cloud Storage, Firestore, Text-to-Speech, Cloud Trace and Google's
# sign-in keys are all reached through Private Google Access instead of directly. It calls nothing
# outside Google (web/server, web/shared), which matters, because with all traffic sent through the
# network and no Cloud NAT an address outside Google would not answer. Redis is reached as before:
# the network's peering with Redis carries every subnet's range.

resource "google_compute_subnetwork" "web_egress" {
  count         = var.web_egress_through_vpc ? 1 : 0
  name          = "${var.service_name}-egress"
  description   = "The web server's outbound traffic (Direct VPC egress, all traffic), with Private Google Access."
  region        = var.region
  network       = data.google_compute_network.default.id
  ip_cidr_range = var.web_egress_range

  # Addresses with no public IP may reach Google's APIs, and run.app, from here.
  private_ip_google_access = true

  depends_on = [time_sleep.apis_ready]
}
