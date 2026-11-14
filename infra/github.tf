# Lets GitHub Actions deploy without any stored key (Workload Identity Federation).
# GitHub proves which repository and branch a workflow runs from; Google Cloud trusts
# only the main branch of the listed repositories (var.github_repositories), and only to
# act as the deployer below.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Identities of GitHub Actions workflows."

  # A deleted pool keeps its name for 30 days, so it cannot simply be made again (pipeline.tf).
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [time_sleep.apis_ready]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Tokens from any other repository or branch are refused outright.
  # Which repositories: var.github_repositories, by name (local.github_repository_named, pipeline.tf).
  attribute_condition = "${local.github_repository_named} && assertion.ref == \"refs/heads/main\""

  lifecycle {
    prevent_destroy = true
  }
}

# What a deploy may do: push an image, update the Cloud Run service, and nothing else.
resource "google_service_account" "deployer" {
  account_id   = "${var.service_name}-deployer"
  display_name = "Web app deployer (GitHub Actions)"
  description  = "Used by GitHub Actions on main to push images and deploy the Cloud Run service."

  depends_on = [time_sleep.apis_ready]
}

# One grant per listed repository, under the repository's name, so that taking a repository off the
# list removes its grant and leaves the others alone.
resource "google_service_account_iam_member" "github_acts_as_deployer" {
  for_each = toset([for repo in var.github_repositories : repo.name])

  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${each.value}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_pushes_images" {
  repository = google_artifact_registry_repository.web.name
  location   = google_artifact_registry_repository.web.location
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

resource "google_project_iam_member" "deployer_updates_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = google_service_account.deployer.member
}

# Deploying a service means choosing the identity it runs as, so the deployer must be
# allowed to hand the web app its own identity (and only that one).
resource "google_service_account_iam_member" "deployer_uses_web_identity" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}
