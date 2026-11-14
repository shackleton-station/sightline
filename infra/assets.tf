# Phase 6: terrain tiles and the demo video straight from the bucket, through Cloud CDN, with no
# server in the path (docs/ARCHITECTURE_PHASE_6.md, docs/decisions/0008-closing-the-side-doors.md).
#
#   visitor -> load balancer -> Cloud CDN -+-> /tiles/global/*, /tiles/polar/*, /tiles/light/*, /tiles/manifest.json -> backend bucket clps-web-tiles -+
#                                          +-> /media/<the files the web server serves>                            -> backend bucket clps-web-media -+-> gs://<project>-web-assets
#
# Until assets_route is "bucket" the web server answers these paths as before (web/server/storage.ts).
# What the server did, and what does it here instead:
#
#   Allow-list         The server served a name only if it matched its pattern (TILE_KEY, MEDIA_TYPES).
#                      Here two things do it. The route rules (domain.tf) send only the server's
#                      prefixes and the media names to the bucket; everything else under /tiles and
#                      /media still goes to the web server, which refuses it. And the load balancer's
#                      grant below is limited by a condition to the same names, so even a wrong route
#                      cannot read anything else in the bucket. The difference: inside tiles/global/,
#                      tiles/polar/ and tiles/light/ any name is served, not only the pattern's. On
#                      2026-11-12 every one of the bucket's 6,423 objects matched the pattern.
#   Raw gzip bytes     The tiles are stored as gzip files with no Content-Encoding in their metadata
#                      (checked on 2026-11-12), so Cloud Storage sends the bytes as they are and Cloud
#                      CDN does not compress or decompress anything (compression_mode below). The page
#                      unpacks them itself, as before.
#   Byte ranges        Cloud Storage answers Range requests with 206, and Cloud CDN caches objects that
#                      support ranges in pieces.
#   Cache-Control      The server sent a day for tiles and an hour for video. A private bucket sends
#                      "private, max-age=0", so the CDN is told to keep everything it gets
#                      (FORCE_CACHE_ALL) for a day and an hour, and passes the same to the browser.
#   Edge firewall      Not here. A backend bucket can only take an "edge" security policy, which has no
#                      rate limits. The backend policy never applied to answers from the CDN's cache
#                      anyway (90.7% of tile requests in the baseline); what goes is the 3,000-a-minute
#                      ban for cache misses, which now cost Cloud Storage reads and no server time.
#
# Two backend buckets on one bucket, because the cache times differ. A backend bucket has no copies,
# no cold start and nothing to deploy.

locals {
  with_asset_buckets = local.on_domain
  # The names the web server serves (web/server/storage.ts), as object names in the bucket.
  tile_prefixes = ["tiles/global/", "tiles/polar/", "tiles/light/"]
  tile_files    = ["tiles/manifest.json"]
  media_files = [
    "media/demo.mp4", "media/demo.vtt", "media/demo-poster.jpg", "media/hype.mp4", "media/hype-poster.jpg",
    # The tutorial video with its poster, captions and list of steps, and the 30-second demo with its poster.
    "media/sightline-tutorial.mp4", "media/sightline-tutorial-poster.jpg", "media/sightline-tutorial.vtt", "media/sightline-tutorial.json",
    "media/sightline-demo-30s.mp4", "media/sightline-demo-30s-poster.jpg",
  ]

  # Google's own account for load balancers in this project. Google makes it when the project's
  # first backend bucket is made (docs: "Set up a backend bucket", private bucket access).
  load_balancer_agent = "serviceAccount:service-${data.google_project.this.number}@https-lb.iam.gserviceaccount.com"
  assets_object       = "projects/_/buckets/${google_storage_bucket.assets.name}/objects/"

  # The load balancer reads the bucket only for paths the route rules send it, and only once it may.
  assets_to_bucket = local.with_domain && var.assets_route == "bucket" && var.assets_bucket_access
}

resource "google_compute_backend_bucket" "tiles" {
  count       = local.with_asset_buckets
  name        = "${var.service_name}-tiles"
  description = "Terrain tiles and the light grid, from the assets bucket, through Cloud CDN. Kept a day."
  bucket_name = google_storage_bucket.assets.name

  enable_cdn = true
  cdn_policy {
    cache_mode  = "FORCE_CACHE_ALL"
    default_ttl = 86400
    client_ttl  = 86400
  }

  # Never re-encode: the tiles are gzip files the page unpacks itself.
  compression_mode = "DISABLED"
}

resource "google_compute_backend_bucket" "media" {
  count       = local.with_asset_buckets
  name        = "${var.service_name}-media"
  description = "The demo videos, their poster images and captions, from the assets bucket, through Cloud CDN. Kept an hour."
  bucket_name = google_storage_bucket.assets.name

  enable_cdn = true
  cdn_policy {
    cache_mode  = "FORCE_CACHE_ALL"
    default_ttl = 3600
    client_ttl  = 3600
  }

  compression_mode = "DISABLED"
}

# The bucket stays private (public_access_prevention is enforced in main.tf). The load balancer may
# read exactly the names the web server serves, and nothing else: the condition is the allow-list.
# It cannot list the bucket, so a name that does not exist is answered 403 by Cloud Storage, where
# the web server answered 404.
resource "google_storage_bucket_iam_member" "load_balancer_reads_assets" {
  count  = local.with_asset_buckets == 1 && var.assets_bucket_access ? 1 : 0
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = local.load_balancer_agent

  condition {
    title       = "only-tiles-and-video"
    description = "The load balancer reads the terrain tiles, the light grid and the media files the site serves, nothing else."
    expression = join(" || ", concat(
      [for prefix in local.tile_prefixes : "resource.name.startsWith(\"${local.assets_object}${prefix}\")"],
      [for name in concat(local.tile_files, local.media_files) : "resource.name == \"${local.assets_object}${name}\""],
    ))
  }

  depends_on = [google_compute_backend_bucket.tiles, google_compute_backend_bucket.media]

  # A change to the list of names changes the condition, and a grant with a new condition is a new
  # grant. Make the new one before taking the old one away, so the load balancer can read the bucket
  # throughout.
  lifecycle {
    create_before_destroy = true
  }
}
