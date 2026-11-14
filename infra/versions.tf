terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
    time = {
      source  = "hashicorp/time"
      version = ">= 0.11"
    }
  }

  # State lives in a versioned bucket, so the team shares one view of what exists.
  # The bucket is made once by hand (see README.md), because Terraform can't store
  # its state in a bucket it hasn't created yet.
  backend "gcs" {
    bucket = "clps-compute-6z1nc-tfstate"
    prefix = "sightline/web"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # Budgets are billed-account resources: these two lines let the provider call
  # the billing API on behalf of this project.
  billing_project       = var.project_id
  user_project_override = true
}
