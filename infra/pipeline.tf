# Terraform through GitHub (docs/decisions/0007-terraform-through-github.md).
#
# Two more keyless identities beside the deployer (github.tf), each behind a door of its own:
#
#   door (identity pool)     who may come through                                   becomes
#   github                   any workflow on main of this repository                the deployer (unchanged)
#   github-terraform-plan    this repository's pull requests, and main              the planner: reads, never writes
#   github-terraform-apply   only .github/workflows/terraform.yml, only on main     the applier: changes everything here
#
# An identity pool is a list of outside identities Google Cloud is willing to recognise. Permission
# to act as a service account is given to a whole pool here, so who gets through a pool's one
# provider is the whole rule. That is why the planner and the applier each get a pool of their own
# and do not share the deployer's: a token that enters the deployer's pool can act as the deployer,
# and nothing that enters these two can.
#
# Nothing here is a stored key. GitHub signs a short-lived token saying which repository, branch,
# event and workflow file a job runs from, and the provider's condition checks those claims.

variable "terraform_workflow" {
  description = "The one workflow file that may apply, as a path in the repository."
  type        = string
  default     = ".github/workflows/terraform.yml"
}

locals {
  # The repositories let in (var.github_repositories), as conditions on GitHub's token. With one
  # repository each of the three is the plain test it always was. With more, it is the same test
  # once per repository, joined by "or" inside one pair of brackets.

  # The token is from a listed repository, by name. The deployer's provider checks this (github.tf).
  github_repository_named_tests = [for repo in var.github_repositories : "assertion.repository == \"${repo.name}\""]
  github_repository_named       = length(var.github_repositories) == 1 ? local.github_repository_named_tests[0] : "(${join(" || ", local.github_repository_named_tests)})"

  # The token is from a listed repository, by name and by number. Checked by both providers here.
  github_this_repository_tests = [for repo in var.github_repositories : "assertion.repository == \"${repo.name}\" && assertion.repository_id == \"${repo.id}\""]
  github_this_repository       = length(var.github_repositories) == 1 ? local.github_this_repository_tests[0] : "(${join(" || ", [for test in local.github_this_repository_tests : "(${test})"])})"

  # The claim GitHub fills in with the workflow file a job is defined in and the branch that file
  # was read from. A pull request cannot produce this value: its ref is refs/pull/<n>/merge. One
  # test per listed repository: the Terraform workflow file of that repository, as it is on main.
  terraform_workflow_on_main_tests = [for repo in var.github_repositories : "assertion.job_workflow_ref == \"${repo.name}/${var.terraform_workflow}@refs/heads/main\""]
  terraform_workflow_on_main       = length(var.github_repositories) == 1 ? local.terraform_workflow_on_main_tests[0] : "(${join(" || ", local.terraform_workflow_on_main_tests)})"

  # The state bucket is made once by hand (README.md), so it is named here, not referenced.
  state_bucket = "${var.project_id}-tfstate"
}

# ---------- The planner: reads the project and the state ----------

resource "google_iam_workload_identity_pool" "terraform_plan" {
  workload_identity_pool_id = "github-terraform-plan"
  display_name              = "GitHub: Terraform plan"
  description               = "Pull requests and main of the repository, for terraform plan only."

  # A deleted pool keeps its name for 30 days, so it cannot simply be made again.
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_iam_workload_identity_pool_provider" "terraform_plan" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.terraform_plan.workload_identity_pool_id
  workload_identity_pool_provider_id = "pull-requests-and-main"
  display_name                       = "Pull requests and main"
  description                        = "This repository's pull requests, and its main branch (the nightly drift check)."

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  # Kept so that Google Cloud's audit log says which branch and workflow a call came from.
  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.repository"   = "assertion.repository"
    "attribute.ref"          = "assertion.ref"
    "attribute.event_name"   = "assertion.event_name"
    "attribute.workflow_ref" = "assertion.job_workflow_ref"
  }

  # A pull request from a fork never gets this far: GitHub does not give its jobs a token to
  # present (the workflow says so too, and stops first). What does get through can only read.
  attribute_condition = "${local.github_this_repository} && (assertion.event_name == \"pull_request\" || assertion.ref == \"refs/heads/main\")"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "terraform_planner" {
  account_id   = "terraform-planner"
  display_name = "Terraform planner (GitHub Actions)"
  description  = "Runs terraform plan for pull requests and the nightly drift check. Reads settings, permissions and the Terraform state; changes nothing."

  depends_on = [time_sleep.apis_ready]
}

# Everyone the pool lets in, and nobody else. The pool is written out in full (the project's number
# and the pool's own id) so that a plan prints exactly who is being trusted.
resource "google_service_account_iam_member" "github_plans_as_planner" {
  service_account_id = google_service_account.terraform_planner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.terraform_plan.workload_identity_pool_id}/*"
}

# Exactly what `terraform plan` reads when it compares this folder with the project. The list was
# made from the calls a real plan made on 2026-11-12 (docs/ARCHITECTURE_PHASE_5_5.md, section 3),
# one permission per kind of call. Reading a resource's settings is `get`; reading who has access
# to it is `getIamPolicy`. None of these reads what is stored: no documents, rows, objects or keys.
#
# A new kind of resource in this folder needs its read permission added here in the same pull
# request, or the plans after it fail with a 403 that names the permission.
resource "google_project_iam_custom_role" "terraform_planner" {
  role_id     = "terraformPlanner"
  title       = "Terraform planner"
  description = "Read-only: the settings and access lists that terraform plan compares against. No stored data."

  permissions = [
    # The project itself, and its list of who has which role (google_project_iam_member).
    "resourcemanager.projects.get",
    "resourcemanager.projects.getIamPolicy",
    # Which APIs are enabled (google_project_service), and calling APIs on this project's quota
    # (the provider sets user_project_override, versions.tf).
    "serviceusage.services.get",
    "serviceusage.services.list",
    "serviceusage.services.use",
    # The image repository and who may push to it.
    "artifactregistry.repositories.get",
    "artifactregistry.repositories.getIamPolicy",
    # Buckets and who may read them. Objects are not included: the state bucket has its own grant below.
    "storage.buckets.get",
    "storage.buckets.getIamPolicy",
    # The Redis Cluster window (Phase 4): the cluster, its service connection policy and the drill job, settings only.
    "redis.clusters.get",
    "networkconnectivity.serviceConnectionPolicies.get",
    "run.jobs.get",
    # Service accounts, who may act as each, and this custom role.
    "iam.serviceAccounts.get",
    "iam.serviceAccounts.getIamPolicy",
    "iam.roles.get",
    # The Cloud Run services and who may call them.
    "run.services.get",
    "run.services.getIamPolicy",
    # Alerts, the uptime check, and the objectives. The notification channel is a role of its own below.
    "monitoring.alertPolicies.get",
    "monitoring.uptimeCheckConfigs.get",
    "monitoring.services.get",
    "monitoring.slos.get",
    # The budget, read with a permission on the project and none on the billing account.
    "billing.resourcebudgets.read",
    # Redis: the instance's settings. Its contents are reachable only over the private network.
    "redis.instances.get",
    # The Firestore databases and their time-to-live rules. Google names the rules' permission
    # both ways, so both are listed. No `entities` permission: documents cannot be read.
    "datastore.databases.get",
    "datastore.databases.getMetadata",
    "datastore.indexes.get",
    "datastore.indexes.list",
    "datastore.schemas.get",
    "datastore.schemas.list",
    # The DNS zone and its records.
    "dns.managedZones.get",
    "dns.resourceRecordSets.get",
    "dns.resourceRecordSets.list",
    # The question log's topics and subscriptions and who may use them. No `consume`: messages cannot be read.
    "pubsub.topics.get",
    "pubsub.topics.getIamPolicy",
    "pubsub.subscriptions.get",
    "pubsub.subscriptions.getIamPolicy",
    # The question log's dataset, table and views: definitions only. No `getData`: rows cannot be read.
    "bigquery.datasets.get",
    "bigquery.datasets.getIamPolicy",
    "bigquery.tables.get",
  ]

  depends_on = [time_sleep.apis_ready]
}

locals {
  planner_roles = {
    # Everything in the list above.
    custom = "projects/${var.project_id}/roles/terraformPlanner"
    # The load balancer, the edge firewall policy, the network and subnetwork (domain.tf, edge.tf,
    # data.tf). Google marks two of the permissions these need (reading a URL map, reading a
    # security policy) as not fully supported in custom roles, so this is the ready-made read-only
    # role. It also lets the planner read the settings of every other Compute Engine resource in
    # the project, the pipeline VM included.
    compute = "roles/compute.viewer"
    # The notification channel (monitoring.tf). The same reason: its read permission is not fully
    # supported in custom roles. Four permissions, all about channels.
    channel = "roles/monitoring.notificationChannelViewer"
    # The identity pools and providers (github.tf and this file). Their permissions have two
    # spellings and only the ready-made role is sure to carry the right one.
    pools = "roles/iam.workloadIdentityPoolViewer"
  }
}

resource "google_project_iam_member" "planner" {
  for_each = local.planner_roles
  project  = var.project_id
  role     = each.value
  member   = google_service_account.terraform_planner.member

  # The custom role is named, not referenced, so that a plan prints every role in full.
  depends_on = [google_project_iam_custom_role.terraform_planner]
}

# The Terraform state: read, on that one bucket. Not write, so the planner cannot take the state
# lock (the lock is a file in the bucket). Plans therefore run with -lock=false: they are advice,
# and the apply makes its own plan with the lock held.
#
# The state holds every setting Terraform manages, including the two personal ones (the alert
# address and the billing account id). That is why only this repository's own branches reach the
# planner.
resource "google_storage_bucket_iam_member" "planner_reads_state" {
  bucket = local.state_bucket
  role   = "roles/storage.objectViewer"
  member = google_service_account.terraform_planner.member
}

# ---------- The applier: changes everything Terraform manages here ----------

resource "google_iam_workload_identity_pool" "terraform_apply" {
  workload_identity_pool_id = "github-terraform-apply"
  display_name              = "GitHub: Terraform apply"
  description               = "Only the Terraform workflow file, only on main, for terraform apply."

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_iam_workload_identity_pool_provider" "terraform_apply" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.terraform_apply.workload_identity_pool_id
  workload_identity_pool_provider_id = "terraform-workflow-on-main"
  display_name                       = "Terraform workflow on main"
  description                        = "Jobs defined in the Terraform workflow file as it is on main, started by a push to main or by hand."

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"         = "assertion.sub"
    "attribute.repository"   = "assertion.repository"
    "attribute.ref"          = "assertion.ref"
    "attribute.event_name"   = "assertion.event_name"
    "attribute.workflow_ref" = "assertion.job_workflow_ref"
  }

  # All of: a listed repository; the main branch; a job defined in the Terraform workflow file of a
  # listed repository as that file is on main; started by a push or by hand. Another workflow file
  # on main is refused, and so is this file run from any other branch or for a pull request.
  attribute_condition = join(" && ", [
    local.github_this_repository,
    "assertion.ref == \"refs/heads/main\"",
    local.terraform_workflow_on_main,
    "(assertion.event_name == \"push\" || assertion.event_name == \"workflow_dispatch\")",
  ])

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "terraform_applier" {
  account_id   = "terraform-applier"
  display_name = "Terraform applier (GitHub Actions)"
  description  = "Runs terraform apply from the Terraform workflow on main. Can change everything infra/ manages, including who has access: treat it as an owner of the project."

  depends_on = [time_sleep.apis_ready]
}

resource "google_service_account_iam_member" "github_applies_as_applier" {
  service_account_id = google_service_account.terraform_applier.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.terraform_apply.workload_identity_pool_id}/*"
}

# The two things no ready-made role short of Editor carries: changing the project's own budget,
# and (under the older of Google's two names for it) the databases' time-to-live rules.
resource "google_project_iam_custom_role" "terraform_applier_extras" {
  role_id     = "terraformApplierExtras"
  title       = "Terraform applier: budget and Firestore rules"
  description = "Read and change this project's budget, and the Firestore time-to-live rules."

  permissions = [
    "billing.resourcebudgets.read",
    "billing.resourcebudgets.write",
    "datastore.indexes.get",
    "datastore.indexes.list",
    "datastore.indexes.create",
    "datastore.indexes.update",
    "datastore.indexes.delete",
  ]

  depends_on = [time_sleep.apis_ready]
}

locals {
  # One role per kind of thing this folder manages, each the service's own administrator role.
  # What they add up to is written in docs/decisions/0007-terraform-through-github.md: with the
  # first one alone the applier can give itself any other role, so it is an owner in all but name.
  applier_roles = {
    project_access   = "roles/resourcemanager.projectIamAdmin" # google_project_iam_member: who has which role on the project
    service_accounts = "roles/iam.serviceAccountAdmin"         # the service accounts, and who may act as each
    act_as           = "roles/iam.serviceAccountUser"          # hand a Cloud Run service or a push subscription its identity
    custom_roles     = "roles/iam.roleAdmin"                   # the two custom roles in this file
    identity_pools   = "roles/iam.workloadIdentityPoolAdmin"   # the three identity pools and their providers
    apis             = "roles/serviceusage.serviceUsageAdmin"  # google_project_service, and calling APIs on this project's quota
    cloud_run        = "roles/run.admin"                       # the four services, and who may call them
    images           = "roles/artifactregistry.admin"          # the image repository, and who may push
    storage          = "roles/storage.admin"                   # the assets bucket and its access; the state bucket: read, write and lock
    load_balancer    = "roles/compute.loadBalancerAdmin"       # address, backends, URL maps, proxies, certificate, forwarding rules, endpoint groups
    network          = "roles/compute.networkAdmin"            # Phase 6: the web server's own subnet, with Private Google Access (network.tf)
    edge_firewall    = "roles/compute.securityAdmin"           # the Cloud Armor policy, and attaching it to a backend
    dns              = "roles/dns.admin"                       # the zone and its records
    redis            = "roles/redis.admin"                     # the Redis instance
    firestore        = "roles/datastore.owner"                 # the two databases and their rules (the role also reads and writes documents)
    pubsub           = "roles/pubsub.admin"                    # topics, subscriptions, and who may use them
    bigquery         = "roles/bigquery.dataOwner"              # the dataset, table and views, and who may write (the role also reads rows)
    monitoring       = "roles/monitoring.editor"               # alerts, the notification channel, the uptime check, objectives
    network_connect  = "roles/networkconnectivity.admin"       # the service connection policy a Redis Cluster needs (Phase 4's cluster window)
    extras           = "projects/${var.project_id}/roles/terraformApplierExtras"
  }
}

resource "google_project_iam_member" "applier" {
  for_each = local.applier_roles
  project  = var.project_id
  role     = each.value
  member   = google_service_account.terraform_applier.member

  depends_on = [google_project_iam_custom_role.terraform_applier_extras]
}

# ---------- What the workflows name ----------

output "terraform_plan_provider" {
  description = "Value for `workload_identity_provider` in the plan and drift jobs."
  value       = google_iam_workload_identity_pool_provider.terraform_plan.name
}

output "terraform_planner_service_account" {
  description = "Value for `service_account` in the plan and drift jobs."
  value       = google_service_account.terraform_planner.email
}

output "terraform_apply_provider" {
  description = "Value for `workload_identity_provider` in the apply job."
  value       = google_iam_workload_identity_pool_provider.terraform_apply.name
}

output "terraform_applier_service_account" {
  description = "Value for `service_account` in the apply job."
  value       = google_service_account.terraform_applier.email
}
