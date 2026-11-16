# The settings of the live project that are not personal. Terraform loads this file by itself, on a
# laptop and in GitHub Actions alike (.github/workflows/terraform.yml), so both plan the same thing.
#
# Changing a line here, in a pull request, is how a setting is changed: the pull request shows the
# plan, and merging applies it. Anything not listed keeps its default from variables.tf.
#
# Not in this file, on purpose: billing_account and alert_email. They are personal, not credentials.
# On the captain's Mac they are in terraform.tfvars (git-ignored). In GitHub Actions they are the
# repository secrets TF_BILLING_ACCOUNT and TF_ALERT_EMAIL.
#
# This file wins over terraform.tfvars for any setting named in both (Terraform reads *.auto.tfvars
# last). A -var on the command line wins over both.

# The site's own address, without www. Empty would serve on run.app only.
domain = "lunarsightline.com"

# The site moved to lunarsightline.com on 2026-11-14 (infra/README.md, "Moving to another domain"). The old
# address keeps its zone, records and certificate, and forwards every link, path and query kept, to the new
# one with a 301. To go back: swap the two names and set other_domains_redirect = true again, or false to
# serve the site on both.
other_domains = ["shackletonstation.dev"]
# 2026-11-14 17:35 UTC: set to false while Google was still issuing the new name's certificate, since
# forwarding to it then landed every visitor on a certificate error. Back to true once that certificate
# was live: Google Trust Services, for lunarsightline.com and www.lunarsightline.com, valid to
# 2027-02-12, accepted by browsers on both names (checked over TLS).
other_domains_redirect = true

# The GitHub repositories whose workflows may sign in to this project with no key: the deploys, the
# Terraform plan and the Terraform apply (github.tf, pipeline.tf). Each by name and by GitHub's own
# number for it (gh api repos/<owner>/<name> --jq .id): neither is a secret. A second repository is
# added here, in a pull request, once it exists. Every repository listed shares one Terraform state,
# so only one of them may have the Terraform workflows switched on at a time.
github_repositories = [
  # The team's working copy, which the live site was deployed from until the hand-over to this
  # repository. It may still deploy until the hand-over is complete, so that going back stays one
  # command away. This entry is removed when the hand-over is done.
  { name = "shackleton-station/clps-demo", id = "1419879185" },
  { name = "shackleton-station/sightline", id = "1457831519" },
]

# Hackathon settings (Rodrigo, 2026-11-13). Two warm
# copies of each visitor-facing service, so no visitor waits for a cold start and losing one copy loses
# nothing; up to ten each for a spike; one vCPU and 1 GiB each, with CPU kept on between requests.
# At list price about $10.40 a day for the six warm copies (instance-based billing), against about $1 a
# day for three throttled ones. 0, 3, "512Mi" and false are the cheap defaults.
min_instances         = 2
plans_min_instances   = 2
copilot_min_instances = 2
max_instances         = 10
plans_max_instances   = 10
copilot_max_instances = 10
service_cpu           = "1"
service_memory        = "1Gi"
service_cpu_always_on = true

# The co-pilot's question ceilings for the event: a whole room shares one address at the venue, so the
# per-visitor numbers are a room's. Together at most about $113.00 a day of Anthropic credits
# (1,000 chats x $0.1037 + 600 typed questions x $0.0155, the dearest measured: web/copilot/limits.ts).
# chat_all_day was 400 until 2026-11-14: a night of deploys and checks used the day up (every call to
# /api/chat counts, refused and malformed ones too) and Scout refused every visitor. To undo: 400.
copilot_limits = {
  # Lowered on 2026-11-16, the day after the event, so that no one visitor or script can run up the
  # model bill: 40 questions a day for a visitor (one network address gets four visitors' allowance,
  # so 160), 300 a day for everyone together. During the event these were 15, 250, 60, 1000 and
  # 20, 150, 60, 600. To undo: put those back.
  chat_each     = 6
  chat_each_day = 40
  chat_all      = 20
  chat_all_day  = 300
  ask_each      = 10
  ask_each_day  = 40
  ask_all       = 20
  ask_all_day   = 200
}

# Sign-in with Google. The id is public: every visitor's browser receives it.
sign_in_client_id = "919194174067-obmq0ssa83kntt4fbt1jh2sc0g929b88.apps.googleusercontent.com"

# The plans service (docs/ARCHITECTURE_PHASE_2.md), as applied.
plans_service = true
plans_route   = "plans" # "web" sends it back to the site, after a web revision with the plans code is live (docs/DEPLOY.md)

# The co-pilot service (docs/ARCHITECTURE_PHASE_3.md), as applied.
copilot_service = true
copilot_route   = "copilot" # "web" sends it back to the site, after a web revision with the co-pilot code is live (docs/DEPLOY.md)

# The co-pilot's model: Claude on the Anthropic API (docs/decisions/0009-copilot-on-claude.md). The
# defaults, written out so a switch is one line: claude-fable-5-2 with claude_effort = "high", or
# claude-sonnet-5-5 with claude_speed = "" (it has no fast mode).
claude_model  = "claude-opus-5-5"
claude_speed  = "fast"
claude_effort = "low" # "medium" was tried on 2026-11-15: about a second slower and wordier, not better (same four questions before and after)

# How the co-pilot signs in, with no stored key: Anthropic workload identity federation. Identifiers
# from the Claude Console's Workload identity page, not secrets. Without them the co-pilot answers
# "not-configured" and its deploy check fails (docs/DEPLOY.md). The rule, `clps-copilot-cloud-run`, matches
# the co-pilot's Google service account (its email and numeric id) for the audience
# https://api.anthropic.com, scope workspace:developer, tokens of 10 minutes; the Anthropic service account
# is `clps-copilot`; the workspace is the organization's Default one, the only one the rule covers.
anthropic_federation_rule_id = "fdrl_01YW9b3nP5G7ep7WbtMU3GSD"
anthropic_organization_id    = "52566e9e-7d17-4681-8123-d965dd021e99"
anthropic_service_account_id = "svac_01Pr2qyUT5KzXbsKz7jCairq"
anthropic_workspace_id       = "wrkspc_01BbSdzfq5D85Zpf38WzvyoV"

# Phase 6, closing the side doors (docs/ARCHITECTURE_PHASE_6.md, section 2). Each line is one step; deleting
# it is that step's way back (section 4). Undo them from the bottom up.
assets_bucket_access   = true            # step 3: the load balancer may read the tiles and video, nothing else in the bucket
web_egress_through_vpc = true            # step 3: the web server's traffic through its own subnet, with Private Google Access
assets_route           = "bucket"        # step 4: tiles and video straight from the bucket through Cloud CDN
service_ingress        = "load-balancer" # step 5: the run.app addresses of web, plans and co-pilot refuse the internet

# Moon Trek's map tiles through the site's CDN (trek.tf): /trek/* is fetched from trek.nasa.gov once and kept at
# the edge for 30 days. Deleting the line is the way back; the page then asks trek.nasa.gov itself.
trek_route = true

# Drills, off by default. Switch on in a pull request, or for minutes from the Mac with -var
# (docs/ARCHITECTURE_PHASE_3.md, section 7; docs/DEPLOY.md, "Applying from the Mac").
# copilot_fault_abort_percent = 50
# copilot_fault_abort_status  = 503
# copilot_fault_delay_percent = 50
# copilot_fault_delay_seconds = 8
# copilot_model_faults        = "503@100"

# Redis on the Standard tier with a read replica, kept on (Rodrigo, 2026-11-13: hackathon settings). A zone
# failure or maintenance costs about 12 s of reconnecting instead of losing every limit, kept answer and
# room (the Phase 4 failover drill, docs/ARCHITECTURE_PHASE_4.md, section 9), and kept answers are read
# from the replica. 5 GB is the smallest size that allows read replicas. About $0.27 an hour at list
# price, $5.30 a day more than Basic 1 GB.
redis_tier          = "STANDARD_HA"
redis_memory_gb     = 5
redis_read_replicas = true

# Phase 8, a second region (docs/ARCHITECTURE_PHASE_8.md, section 4), for Friday 2026-11-13 only. Each step
# takes the "# " off its lines. Switching off puts it back on the last three lines (section 8); the first
# line goes at least two hours later, with the subnet.
# second_region        = "us-central1" # step 2: names the region, and makes the web server's twin subnet there
# second_region_copies = true          # step 2: copies of web, plans and co-pilot there; no visitor reaches them yet
# second_region_serve  = true          # step 3: the load balancer sends each visitor to the nearest region
# region_drill         = "us-east4"    # step 4, the drill: that region's copies answer 503 until this line goes

# Phase 4, the Redis Cluster window (docs/ARCHITECTURE_PHASE_4.md, section 3): on 2026-11-13 from 14:25 to
# about 15:00 UTC, 2 shards then 3, for the co-pilot's kept answers and the drill. Off: the defaults.
# redis_cluster        = true
# redis_cluster_shards = 3 # the reshard: 2 to 3 shards, the same twelve drill keys followed

