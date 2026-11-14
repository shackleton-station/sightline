# Architecture, Phase 5.5: Terraform through GitHub

For whoever switches this on and for Rodrigo. What was decided and why, and **what it does not protect
against**, is in [`decisions/0007-terraform-through-github.md`](decisions/0007-terraform-through-github.md).
This file is what was built, the order to switch it on with what each step should show, every grant, the six
"done when" checks as steps to copy, and what has only been tested.

**State on 2026-11-12, evening:** switched on and checked. The last Mac apply created the two identities,
the two Actions secrets are set, pull request 134 is merged, and GitHub has applied changes on its own since.
Five of the six "done when" checks pass ([section 12](#12-results-of-the-checks-2026-11-12)); the sixth is
Phase 6 going through the pipeline.

Names used in the commands:

```sh
P=clps-compute-6z1nc
R=us-east4
REPO=shackleton-station/<repo>
```

---

## 1. What was built

| File | What it is |
| --- | --- |
| `infra/pipeline.tf` | Two identity pools with one provider each, the planner and the applier service accounts, two custom roles, and every grant in section 3 |
| `infra/settings.auto.tfvars` | The settings of the live project that are not personal, tracked. Terraform loads it by itself on a laptop and in the pipeline |
| `infra/variables.tf` | `billing_account` and `alert_email` are now `sensitive`, and each refuses an empty or malformed value |
| `infra/*.tf` (small edits) | `prevent_destroy` on the two Firestore databases, the DNS zone, and the deployer's identity pool and provider. The four Cloud Run services ignore the `commit` label the deploys set |
| `infra/protected-resources.txt` | What the destroy guard protects |
| `infra/expected-removals.txt` | Where a pull request names a protected resource it means to remove. Empty |
| `infra/scripts/destroy-guard.mjs` | The guard: reads a saved plan as JSON and stops the apply |
| `infra/scripts/plan-comment.mjs` | Builds the pull request's comment, the drift issue's text and the apply's summary |
| `infra/scripts/redact.mjs` | Takes the two personal values out of everything that is printed or posted |
| `infra/scripts/wait-for-runs.mjs` | Keeps applies and deploys out of each other's way |
| `infra/scripts/*.test.mjs` | 75 tests for the four scripts (`node --test infra/scripts/*.test.mjs`) |
| `.github/workflows/terraform.yml` | Pull request: plan and comment. `main`: plan to a file, guard, apply |
| `.github/workflows/terraform-drift.yml` | Every night: plan `main`, open, update or close one issue |
| `.github/workflows/deploy*.yml` (four) | Wait for Terraform first. Deploy with no `--tag`, label the new version with its commit, read the live commit from that label |

## 2. The order to switch it on

Expand first, as in every phase: the identities are made by one last apply from the Mac, before any workflow
uses them.

### Step 1. Open the pull request

The `terraform plan` check runs and **fails at "Check the two personal settings are there"**: the secrets do
not exist yet. The pull request still gets its one comment, which says the plan did not finish. That is the
expected state until step 4.

### Step 2. The last apply from the Mac

From this branch, with `main` merged in. `infra/terraform.tfvars` on the Mac can stay as it is: the tracked
file names the same values, and wins where both name one.

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform init
terraform plan -out=phase55.tfplan
# read every line, then:
terraform apply phase55.tfplan
rm phase55.tfplan
```

**The plan should say `33 to add, 6 to change, 0 to destroy`** (read on 2026-11-12 after merging `main` at
`ad168ae`, both ways of running it: with the Mac's file, and with the tracked file plus the two values from
the environment. Both listed the same 39 resource changes):

- **33 to add:** 2 identity pools, 2 providers, 2 service accounts, 2 custom roles, 2 grants that let GitHub
  act as each service account, 4 project roles for the planner, 18 for the applier, and the planner's read
  access to the state bucket. Section 3 lists each.
- **2 to change, with no value changing:** `google_billing_budget.monthly` and
  `google_monitoring_notification_channel.email`. Terraform says "this attribute value will be marked as
  sensitive ... The value is unchanged". That is the two variables becoming `sensitive`.
- **4 to change:** each Cloud Run service with `revision = "<name>" -> null` and nothing else, because the
  old workflows deployed since the last apply. That is the noise section 5 explains, for the last time. It
  starts one new version of each service with the same image and settings, outside the stepped rollout.
  Fewer than 4 if a service has not been deployed since the last apply.
- Four new outputs.

If the plan shows anything else, stop: a setting applied from the Mac since this was written is missing from
`infra/settings.auto.tfvars`. Add it there before going on, or the pipeline's first apply would undo it.

Before applying, look at whether any service is pinned to a named version (a deploy that rolled back leaves
it so; on 2026-11-12 the co-pilot was, for a while, after a drill). A version this apply starts on a pinned
service gets no visitors ("A service pinned to an older version" in `docs/DEPLOY.md`). Here that is harmless,
because the new versions carry the same image and settings, but know it is there:

```sh
for s in clps-web clps-plans clps-copilot clps-events-worker; do
  echo "$s: $(gcloud run services describe $s --project $P --region $R --format 'value(spec.traffic)')"
done      # "latestRevision: True, percent: 100" is not pinned
```

### Step 3. The two Actions secrets

They are not credentials (decision 0007). The values go from the Mac's file into GitHub without appearing on
screen or in the shell's history:

```sh
cd infra
sed -n 's/^[[:space:]]*billing_account[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' terraform.tfvars | tr -d '\n' | gh secret set TF_BILLING_ACCOUNT --repo $REPO
sed -n 's/^[[:space:]]*alert_email[[:space:]]*=[[:space:]]*"\(.*\)".*/\1/p' terraform.tfvars | tr -d '\n' | gh secret set TF_ALERT_EMAIL --repo $REPO
gh secret list --repo $REPO      # names and dates only
```

**Pass:** both names are listed.

### Step 4. Run the pull request's check again

Actions, the failed Terraform run, "Re-run all jobs". This is the first time anything signs in as the planner.

**Pass:** the check is green, and the comment on the pull request is replaced in place by one that starts
"Terraform plan for ..." and says **No changes** (step 2 already applied it). If it fails with a 403, the
error names the permission the planner is missing: see section 10, "The planner's list".

### Step 5. Check nothing is left to apply, then merge

```sh
cd infra && terraform plan      # on the Mac, from the branch
```

**Pass:** "No changes", or only revision names being cleared. Then merge. The merge touches `infra/`, so the
Terraform workflow runs on `main`: this is the first time anything signs in as the applier.

**Pass:** the run "Terraform" on `main` is green. Its "Plan to a file" step says "No changes" (or clears
revision names and applies that). The four deploy workflows show "Wait for Terraform" as their first step,
and go on after it. After those deploys, `terraform plan` is empty and stays empty across deploys.

After the merge, cut `infra/terraform.tfvars` on the Mac down to the two personal lines
(`infra/terraform.tfvars.example`), so nobody edits a setting there that the tracked file overrides.

## 3. Every grant

All of it is in `infra/pipeline.tf`. Nothing else changes for any existing identity: **the deployer is
exactly as it was.**

**The planner**, `terraform-planner@clps-compute-6z1nc.iam.gserviceaccount.com`:

| # | Role | On | Why |
| --- | --- | --- | --- |
| 1 | `roles/iam.workloadIdentityUser` | the planner itself, for everyone the pool `github-terraform-plan` lets in | This repository's pull requests and `main` may act as it |
| 2 | `projects/clps-compute-6z1nc/roles/terraformPlanner` (custom, 36 permissions) | the project | Exactly what a plan reads. The table below |
| 3 | `roles/compute.viewer` | the project | The load balancer, the edge firewall policy, the network. Two of the permissions these need are marked by Google as not fully supported in custom roles |
| 4 | `roles/monitoring.notificationChannelViewer` | the project | The notification channel, for the same reason |
| 5 | `roles/iam.workloadIdentityPoolViewer` | the project | The identity pools and providers |
| 6 | `roles/storage.objectViewer` | the bucket `clps-compute-6z1nc-tfstate` | Read the Terraform state. Not write, so it cannot take the state lock |

**The applier**, `terraform-applier@clps-compute-6z1nc.iam.gserviceaccount.com`:

| # | Role | On | What it is for |
| --- | --- | --- | --- |
| 7 | `roles/iam.workloadIdentityUser` | the applier itself, for everyone the pool `github-terraform-apply` lets in | Only `terraform.yml` on `main` may act as it |
| 8 | `roles/resourcemanager.projectIamAdmin` | the project | Who has which role on the project. **With this it can give itself any role** |
| 9 | `roles/iam.serviceAccountAdmin` | the project | The service accounts, and who may act as each |
| 10 | `roles/iam.serviceAccountUser` | the project | Hand a Cloud Run service or a push subscription its identity. It can act as any service account in the project |
| 11 | `roles/iam.roleAdmin` | the project | The two custom roles |
| 12 | `roles/iam.workloadIdentityPoolAdmin` | the project | The three identity pools and their providers |
| 13 | `roles/serviceusage.serviceUsageAdmin` | the project | Enabling APIs |
| 14 | `roles/run.admin` | the project | The four services, and who may call them |
| 15 | `roles/artifactregistry.admin` | the project | The image repository |
| 16 | `roles/storage.admin` | the project | The assets bucket and its access. The state bucket: read, write and lock |
| 17 | `roles/compute.loadBalancerAdmin` | the project | The address, backends, URL maps, proxies, certificate, forwarding rules |
| 18 | `roles/compute.securityAdmin` | the project | The edge firewall policy |
| 19 | `roles/dns.admin` | the project | The zone and its records |
| 20 | `roles/redis.admin` | the project | The Redis instance |
| 21 | `roles/datastore.owner` | the project | The two Firestore databases and their rules. The role also reads and writes documents |
| 22 | `roles/pubsub.admin` | the project | Topics and subscriptions |
| 23 | `roles/bigquery.dataOwner` | the project | The dataset, table and views. The role also reads rows |
| 24 | `roles/monitoring.editor` | the project | Alerts, the notification channel, the uptime check, objectives |
| 25 | `projects/clps-compute-6z1nc/roles/terraformApplierExtras` (custom, 7 permissions) | the project | The project's own budget, and the Firestore time-to-live rules under the older of Google's two names for that permission |

**What the applier adds up to: an owner of the project.** Grant 8 lets it give itself anything else. The
list is the narrowest set of ready-made roles that covers what `infra/` manages: for every kind of resource
here, the create, change, delete and access permissions were checked against what each role contains
(`gcloud iam roles describe`). It has not applied anything yet.

**Who gets through each door** (the providers' conditions, checked by Google on GitHub's signed token):

- `github-terraform-plan`: the repository is `shackleton-station/<repo>` and its number is `<its number>`,
  and the event is `pull_request` or the branch is `refs/heads/main`.
- `github-terraform-apply`: the same repository by name and number, the branch is `refs/heads/main`, the job
  is defined in `shackleton-station/<repo>/.github/workflows/terraform.yml@refs/heads/main`, and the event
  is `push` or `workflow_dispatch`.

**What the planner's custom role holds, and what needed each.** A read-only plan of `main` on 2026-11-12
made 123 calls to 15 Google APIs, every one a read. This is one permission per kind of call:

| Permission | The resource that needed it |
| --- | --- |
| `resourcemanager.projects.get` | the project itself (`data.google_project`), and its billing link |
| `resourcemanager.projects.getIamPolicy` | every `google_project_iam_member` |
| `serviceusage.services.get`, `.list` | `google_project_service` |
| `serviceusage.services.use` | the provider's `user_project_override` (calls are counted against this project) |
| `artifactregistry.repositories.get`, `.getIamPolicy` | the image repository and who may push |
| `storage.buckets.get`, `.getIamPolicy` | the assets bucket and its access; the access list of the state bucket |
| `iam.serviceAccounts.get`, `.getIamPolicy` | the service accounts and who may act as each |
| `iam.roles.get` | the two custom roles |
| `run.services.get`, `.getIamPolicy` | the four Cloud Run services and who may call them |
| `monitoring.alertPolicies.get`, `.uptimeCheckConfigs.get`, `.services.get`, `.slos.get` | alerts, the uptime check, objectives |
| `billing.resourcebudgets.read` | `google_billing_budget` |
| `redis.instances.get` | the Redis instance |
| `datastore.databases.get`, `.getMetadata`, `datastore.indexes.get`, `.list`, `datastore.schemas.get`, `.list` | the two Firestore databases and their time-to-live rules |
| `dns.managedZones.get`, `dns.resourceRecordSets.get`, `.list` | the zone and its records |
| `pubsub.topics.get`, `.getIamPolicy`, `pubsub.subscriptions.get`, `.getIamPolicy` | the question log's topics and subscriptions |
| `bigquery.datasets.get`, `.getIamPolicy`, `bigquery.tables.get` | the dataset, the table and the three views |

What is **not** in it: reading Firestore documents, BigQuery rows, Pub/Sub messages, or bucket objects other
than the state. `roles/compute.viewer` is wider than a plan needs: it reads the settings of every Compute
Engine resource, the pipeline VM and the project's list of public SSH keys included.

**The state lock.** The planner cannot write to the state bucket, and the lock is a file in it. So plans on
pull requests and at night run with `-lock=false`. They are advice. The apply makes its own plan with the
lock held, and applies that file.

## 4. The two personal values

`billing_account` and `alert_email` reach Terraform as `TF_VAR_billing_account` and `TF_VAR_alert_email`,
from the two Actions secrets. Every place they could come out again, and what closes it:

| Where | What happens | What closes it |
| --- | --- | --- |
| The value in a plan (`labels.email_address`, `billing_account`) | Terraform prints `(sensitive value)` | `sensitive = true` on both variables |
| The budget's own id, `billingAccounts/<id>/budgets/...` | Printed on every refresh, and in the plan whenever the budget changes. Marking the variable sensitive does not hide it | `redact.mjs` on every line the jobs print; GitHub's own masking of secrets in logs |
| The comment, the issue, the job summary | Built from Terraform's text | `plan-comment.mjs` redacts last, then counts, and refuses to write if either value is left |
| The plan as JSON | Holds every value in clear, sensitive or not | Never printed, never uploaded, deleted at the end of the job. The guard and the summary read addresses, actions, roles and members from it, nothing else |
| The saved plan file | The same | Never uploaded. The only artifact is the finished comment |
| Outputs | None uses either value | Checked: `infra/outputs.tf` and the four new outputs |
| An error from Google that quotes a request | Could quote either | The same filter, and GitHub's masking |
| An empty secret | Terraform would plan to replace the budget and change every alert | The variables' `validation` refuses it, and the workflows check first |

**How it was proved.** A real plan of this branch (last on 2026-11-12, after merging `main` at `ad168ae`) was
made the way the workflow makes it (no `terraform.tfvars` in the folder, the tracked settings file, the two
values from the environment), and each output was searched for the two values, printing only how many times
each was found:

| Text | billing account | alert address |
| --- | --- | --- |
| What `terraform plan` printed, unfiltered | 2 | 0 |
| `terraform show` of the plan, unfiltered | 1 | 0 |
| The plan as JSON | 13 | 65 |
| What the job prints (after `redact.mjs`) | 0 | 0 |
| The comment | 0 | 0 |
| The guard's verdict file | 0 | 0 |

The two in the unfiltered plan are the refresh line and the budget's id, as the table above says.

The planner can read the state, and the state holds both values. Anyone who can push a branch to this
repository can therefore read them by changing the workflow in a pull request. That is the team. A pull
request from a fork cannot.

## 5. Revision names and the live commit

The cause and the fix are in decision 0007. What to know when operating:

- The deploys no longer pass `--tag` to `gcloud run deploy`. They make the new version, check it is theirs,
  then give it the `canary` tag with `gcloud run services update-traffic --update-tags`.
- Each deploy labels the version it makes with `commit=<short sha>`. To see which commit each version runs:

  ```sh
  gcloud run revisions list --service clps-web --project $P --region $R --format 'table(metadata.name, metadata.labels.commit, status.conditions[0].status)'
  ```

- **The first deploy of each service after the merge finds no label on the live version.** The plans and
  co-pilot deploys then ask the service's status address (`/api/plans/status`, `/api/chat/status`) and take
  its `version`, but only when its `revision` is the live one. Tried read-only against the live co-pilot on
  2026-11-12: it found the commit. The events worker deploys once more as if for the first time (its status
  address needs an identity token); it has no "a tenth" step. The site's deploy always deploys and reads no
  commit.
- Why not the image's name, as before: every revision in the project records its image by digest
  (`...@sha256:...`), the ones `gcloud run deploy` made included. Decision 0007 has the evidence.
- Do not deploy by hand with `--tag` or `--revision-suffix`: the name comes back, and the next apply starts a
  new version to clear it. The plan comment says so when it sees it. `docs/DEPLOY.md`, "Deploying by hand".
- The label and the image are the two things about a service Terraform leaves alone. A version Terraform
  makes (a changed setting) keeps both.

## 6. Deploys and applies

`infra/scripts/wait-for-runs.mjs`. One rule: a run waits for every run of the other kind that started
before it.

| Case | What happens |
| --- | --- |
| A merge changes `infra/` and the app | Terraform starts at the push. The deploys start when CI ends, see the Terraform run, and wait for it |
| Terraform fails | Deploys that started after it stop, and say which run failed. Fix or re-run Terraform, then start the deploy by hand |
| Terraform is skipped (nothing under `infra/` changed) | There is no Terraform run, so nothing to wait for |
| An apply starts while a deploy is rolling out | The apply waits for that deploy to end, up to 45 minutes, then fails without applying |
| A Terraform run is cancelled because a newer one replaced it in the queue | The deploy waits for the newer one |
| A deploy started by hand after a failed Terraform run | It goes ahead, with a warning |

Three more things the apply does:

- **It applies `main` as it is when the run starts**, not the commit that started the run. So a run that
  waited, or is run again a day later, never puts older settings back.
- One apply at a time (`concurrency: terraform-apply`), with the state lock, waiting up to five minutes for it.
- **After it applies, it checks where visitors are.** A deploy that failed pins every visitor to the version
  that worked. From then on a version Terraform makes gets no visitors. The apply prints a warning naming the
  service and the command (`docs/DEPLOY.md`, "A service pinned to an older version"). It does not move
  traffic itself: the latest version may be the one the deploy just rejected.

## 7. The destroy guard

**The protected list** (`infra/protected-resources.txt`): the Firestore databases, the DNS zone, the DNS
records, every bucket, the identity pools and providers, Redis, the BigQuery dataset, the question log's
table (its rows live there; the three views can be made again), and the pipeline's own two service accounts.

A plan that deletes, replaces or stops managing one of them is not applied, unless the same commit has that
resource's address on a line of `infra/expected-removals.txt`. The address must match exactly.

It runs twice:

- **On the pull request**, strictly: the check fails, and the comment says what would be stopped. A line in
  `expected-removals.txt` that the plan does not use also fails the check, which is what makes a line good
  for one removal: the next pull request has to delete it.
- **On `main`**, between the plan and the apply. A leftover line is only a warning there, so that an apply
  run again after it removed the resource can still finish.

**How Phase 4's Redis replacement gets through.** Phase 4 replaces the Redis instance on purpose, twice
(Basic to Standard, and back). Redis is on the protected list and has **no** `prevent_destroy`, for exactly
this. Each of those two pull requests adds one line:

```
google_redis_instance.store[0]   # Phase 4, step 1: Basic to Standard replaces the instance
```

The comment then shows it under "Protected resources this plan removes on purpose", and the apply goes
through. The pull request after each one deletes the line (its check fails until it does).

**`prevent_destroy`** is on what cannot be made again: the two Firestore databases (what visitors saved),
the DNS zone (a new one gets other name servers and signing keys), and the three identity pools with their
providers (a deleted pool keeps its name for 30 days). For those, Terraform refuses to make the plan at all,
so removing one takes two deliberate steps in one pull request: take the `lifecycle` block out, and name the
address in `expected-removals.txt`. This changes two things that used to work in one step: `plans = false`
and `question_log = false` no longer remove their database, and `terraform destroy` stops at these.

**What the guard is not.** It lives in the repository, so a pull request can change it, its list, or the
workflow that calls it. The comment says so in bold when a pull request touches the guard or its two lists.
It stops accidents, not intent.

## 8. Protecting `main` (commands written, not run)

For when the repository goes public: changes arrive by pull request with green checks, and nobody has to
approve. A ruleset does this. On a free organisation it only works on a public repository.

```sh
cat > /tmp/main-ruleset.json <<'EOF'
{
  "name": "main: pull requests with green checks",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "pipeline (ruff + pytest)" },
          { "context": "web (tsc + vitest + build)" },
          { "context": "terraform plan" } ] } }
  ]
}
EOF
gh api --method POST repos/$REPO/rulesets --input /tmp/main-ruleset.json
gh api repos/$REPO/rulesets --jq '.[] | {id, name, enforcement}'      # to check
```

- `"required_approving_review_count": 0` is "no reviewer count".
- `terraform plan` can be required on every pull request: the job is skipped when a pull request touches
  nothing under `infra/`, and GitHub counts a skipped job as passed.
- `"strict_required_status_checks_policy": true` makes a pull request catch up with `main` before it
  merges, so the plan in its comment is the plan of what `main` will be. Set it to `false` for fewer
  re-runs, at the price that the plan shown can be older than the one applied.
- The names must match the checks exactly. To read them from a commit that ran them:
  `gh api repos/$REPO/commits/<sha>/check-runs --jq '.check_runs[].name'`.
- Nobody is on the bypass list, administrators included. To push past it in an emergency, switch the ruleset
  to `"enforcement": "disabled"` and back.

Two settings to check at the same time (Settings, Actions, General), both already the default:

- "Fork pull request workflows": **off** for "Send write tokens" and "Send secrets". With either on, a
  fork's pull request could become the planner.
- Once public: "Require approval for all external contributors", so a stranger's pull request runs nothing
  until someone says so.

Until the repository is public this is a team rule: no direct pushes to `main`.

## 9. The "done when" checks

### (a) A pull request that changes `infra/` shows its plan as a comment

Step 4 of section 2 is the first proof. For a plan that is not empty, open a pull request that changes one
harmless number in `infra/settings.auto.tfvars` or an alert's text.

**Pass:** one comment by `github-actions`, starting "Terraform plan for", with the counts, "What changes",
and the full plan under a fold. Push again: the same comment changes; no second one appears. Neither
personal value is in it:

```sh
gh pr view <number> --repo $REPO --json comments --jq '.comments[] | select(.author.login == "github-actions") | .body' > /tmp/comment.md
cd infra
for name in billing_account alert_email; do
  value="$(sed -n "s/^[[:space:]]*$name[[:space:]]*=[[:space:]]*\"\(.*\)\".*/\1/p" terraform.tfvars)"
  echo "$name: $(grep -ciF -- "$value" /tmp/comment.md) line(s)"      # pass: 0 and 0
done
```

### (b) Merging applies it with no laptop involved

Merge the pull request from (a).

**Pass:** the run "Terraform" on `main` is green; "Apply exactly that file" ends with
"Apply complete! Resources: ..."; and a plan from anywhere afterwards is empty.

```sh
gh run list --repo $REPO --workflow terraform.yml --branch main --limit 3
gh run view <id> --repo $REPO --log | grep -E 'Applying main at|Plan:|Apply complete|No changes'
```

### (c) A test pull request that would delete a protected resource is stopped

Open a pull request that adds one line to `infra/settings.auto.tfvars`: `shared_store = false` (it would
delete Redis). **Do not merge it.**

**Pass:** the `terraform plan` check is red. The comment has "The destroy guard would stop this" with
`google_redis_instance.store[0]`: delete. Close the pull request.

Checked read-only on 2026-11-12 with the same plan made by hand (`terraform plan -var shared_store=false`):
the guard printed "STOPPED: the plan deletes google_redis_instance.store[0]" and ended with status 1; with
the address named in a list file it ended with status 0. The guard on `main` is the same script reading the
same kind of file, and is not exercised by this check, because that would mean merging the pull request. A
second pull request with `plans = false` shows the other layer: Terraform refuses the plan ("Instance cannot
be destroyed"), and the comment shows that error.

### (d) A deliberate change made in the console is reported by the next drift check

A harmless change Terraform will notice, to a topic that normally holds nothing:

```sh
gcloud pubsub topics update clps-web-events-refused --project $P --message-retention-duration=6d    # Terraform says 7 days
gh workflow run terraform-drift.yml --repo $REPO --ref main
gh run watch --repo $REPO "$(gh run list --repo $REPO --workflow terraform-drift.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh issue list --repo $REPO --search 'in:title "Terraform drift"'
```

**Pass:** one open issue, "Terraform drift: the live project does not match main", by `github-actions`. Its
text says 0 to add, 1 to change, 0 to destroy and names `google_pubsub_topic.events_refused[0]`.

### (e) An emergency apply from the Mac still works and is documented

Use it to put (d) right, following `docs/DEPLOY.md`, "Applying from the Mac":

```sh
cd infra
export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
terraform plan -out=fix.tfplan      # 0 to add, 1 to change: the retention back to 7 days
terraform apply fix.tfplan && rm fix.tfplan
gh workflow run terraform-drift.yml --repo $REPO --ref main
```

**Pass:** the apply succeeds from the Mac; the next drift run is green and **closes the issue from (d)**
with a comment that the plan is empty again.

### (f) Phase 6's changes went through the pipeline

Not yet. **Pass, when Phase 6 is done:** each of its Terraform changes has a pull request with a plan
comment and a green "Terraform" run on `main`, and its notes name no apply from the Mac.

## 10. What has only been tested, not run for real

Nothing here has run on GitHub or as either new identity. In the order it will be found out:

- **The two sign-ins.** The providers' conditions are written from GitHub's documentation of its token. They
  have never checked a real token. If one refuses, the sign-in step fails with Google's reason. Wrong for the
  planner shows in step 4; wrong for the applier shows at the merge, and the Mac path still works.
  One assumption to know about: GitHub's reference defines the claim `job_workflow_ref` for jobs that use a
  reusable workflow, and does not say what it holds for a job written directly in a workflow file. The
  applier's condition assumes it names `terraform.yml` and `refs/heads/main` for such a job too. If the
  applier's sign-in is refused at the merge with "The given credential is rejected by the attribute
  condition", change `assertion.job_workflow_ref` to `assertion.workflow_ref` in the applier's provider
  (`infra/pipeline.tf`, two places: the mapping and the condition) and apply that from the Mac. The claim
  `workflow_ref` names the workflow file the run started from, which is the same file here.
- **The planner's list.** It was made from the calls a real plan made as an owner, one permission per call.
  Whether Google asks for exactly that permission for each call is taken from its documentation, not run. A
  miss fails the plan with a 403 naming the permission; add it to `terraformPlanner` and apply.
- **The budget, without billing-account access.** The planner and the applier get the budget's permissions
  on the project (`billing.resourcebudgets.read`, `.write`), not on the billing account. Google documents
  these for a budget that covers one project, which this one does. Its API reference for the call names only
  the billing-account permission. **If step 4 fails with a 403 on `google_billing_budget.monthly`, this is
  why.** The way out is Rodrigo's to choose, because it is a grant on his billing account:
  `roles/billing.viewer` there for the planner and `roles/billing.costsManager` for the applier (the first
  lets pull-request code see the account's costs), or taking the budget out of this folder and keeping it by
  hand.
- **The applier's roles.** Checked permission by permission against what each role contains. Never used. A
  permission one service checks on behalf of another could be missing. A miss fails one apply half way with
  a 403; the applier can add a role to itself in a follow-up pull request, or the Mac can.
- **The deploy workflows' new steps.** Deploying with no `--tag`, tagging afterwards, the `commit` label,
  reading it back: written from gcloud's own source and help text, never run. The fallback to the status
  address was run once by hand, read-only, against the live co-pilot (it found the commit). The first deploy after the
  merge is the test, for all four services at once. If the tag step fails, the deploy rolls back as it does
  today.
- **That a deploy with no `--tag` leaves a plan empty.** Seen from the other side only: an apply clears the
  name and the next plan is clean. gcloud also adds a label of its own to the service's template on such a
  deploy; a revision made that way on 2026-11-12 shows it in the older API and not in the one Terraform
  reads. If a plan after the first new deploy still shows a change on a service, that label is where to look.
- **That a version Terraform makes keeps the `commit` label.** It follows from how `ignore_changes` works.
  Not seen.
- **The comment and the issue on GitHub.** The text is tested (75 tests, and built once from the real plan).
  Posting, finding the earlier comment, updating it, opening and closing the issue have not run.
- **The wait rule against real runs.** The rule is tested with made-up runs. Reading real runs from
  GitHub's API, and what a queued run looks like there, have not run.
- **`actionlint` was not run**: it is not installed on this Mac. In its place: every workflow parses as
  YAML, every step has exactly one of `uses` and `run`, every `needs`, step id and job output that is
  referred to exists, every permission is a real scope, every shell block passes `bash -n`, and the inputs
  of each action were read from its own `action.yml` at the pinned tag.
- **Pull requests from forks.** The repository does not allow forks today, so that path cannot be tried
  until it is public.

## 11. Text for `CLAUDE.md` section 9

`CLAUDE.md` was not edited. The second bullet of section 9 ("Infrastructure is Terraform ...") becomes untrue
at the merge. The replacement, for Rodrigo's OK:

> - **Infrastructure is Terraform** in `infra/` (Cloud Run, bucket, service accounts, load balancer, DNS,
>   certificate, uptime check, budget), and **it goes through GitHub**. A pull request that touches `infra/`
>   gets its plan as a comment. Merging to `main` applies it from GitHub Actions
>   (`.github/workflows/terraform.yml`), with no approval click and no required reviewer: Rodrigo's decision
>   of 2026-11-12 (`docs/decisions/0007-terraform-through-github.md`). So **read the plan comment before you
>   merge**, above all its "Access this plan changes" part: nobody else will. A destroy guard stops an apply
>   that would delete something protected (`infra/protected-resources.txt`), and a nightly check opens an
>   issue when the project and `main` differ. `terraform plan` on a laptop is always fine. Settings live in
>   `infra/settings.auto.tfvars`; the two personal ones (`billing_account`, `alert_email`) are never
>   committed, printed or quoted.
> - **Applying from the Mac is the emergency path**, for when the pipeline is broken or a drill needs a
>   setting for minutes (`docs/DEPLOY.md`, "Applying from the Mac"). Claude Code runs it, the same way as
>   before: save the plan to a file, read every line, apply exactly that file. Commit the same change the
>   same day, or the next pipeline run undoes it. If the app's safety check refuses an apply, leave the exact
>   command for Rodrigo; don't work around the refusal.

---

## 12. Results of the checks, 2026-11-12

Run by Claude Code between 22:00 and 22:50 UTC. Times are UTC.

**Switching it on.**

| Step | Result |
| --- | --- |
| The last Mac apply, from the branch | 33 added, 6 changed, 0 destroyed: the two pools and providers, the planner and the applier, two custom roles and their grants (section 3). The 6 changed: the budget and the notification channel marked sensitive with no value changing, and the last four revision names |
| The two Actions secrets | Set by Claude Code at Rodrigo's request, piped from the git-ignored file and never printed. The app's safety check had refused the same command when tried without his asking |
| The pull request's check | Green on the first run with the secrets: format, validate, tests, plan and guard. One comment, updated in place. Neither personal value appears in any comment (counted with `grep -c`, not printed) |
| The merge | `Terraform` ran on `main` as the applier: 0 added, 4 changed, 0 destroyed (the revision names). All four deploys waited for it in their "Wait for Terraform" step, then ran |

**A lesson from switching it on.** Until this merge, a plan from any branch without `infra/pipeline.tf`
would have destroyed the 33 resources the Mac apply had just made: it happened to the contract step's plan
from `main` (`0 to add, 9 to change, 35 to destroy`), which was read and not applied. That apply was made
from this branch merged with `main` instead. While a branch holds Terraform that `main` does not, every apply
comes from a branch that holds both.

| Check | Result | What was seen |
| --- | --- | --- |
| (a) A pull request that changes `infra/` shows its plan as a comment | **Pass** | Pull request 134's own comment, then pull request 139's (the Redis replica window): the summary, the protected resources removed on purpose, each change, the full plan folded below |
| (b) Merging applies it with no laptop | **Pass** | Pull request 134's merge (0 added, 4 changed) and pull request 139's (1 added, 3 changed, 1 destroyed: the Redis instance replaced, `docs/ARCHITECTURE_PHASE_4.md`) |
| (c) A pull request that would delete a protected resource is stopped | **Pass** | Draft pull request 137 set `shared_store = false`. Its plan check failed at the guard, and the comment's first section said `google_redis_instance.store[0]: delete, and it is on the protected list`. Closed without merging |
| (d) A change made outside the pipeline is reported | **Pass** | `clps-web-events-refused`'s retention set from 7 days to 6 with `gcloud`; the drift workflow, run by hand, opened issue 138 naming `google_pubsub_subscription.refused[0]` and only it |
| (e) An emergency apply from the Mac still works | **Pass** | A saved plan from `main` (0 added, 1 changed) put the retention back. The next drift run found the plan empty and closed issue 138 by itself |
| (f) Phase 6's changes go through the pipeline | **Not yet** | Phase 6 is being built |

**Revision names and the live commit.** Right after the merge's deploys, which no longer pass `--tag`, a plan
of `main` said **"No changes"** for the first time that day: the `revision = "<name>" -> null` line every plan
had shown on all four Cloud Run services is gone. Each service's template carries the label `commit` and no
revision name. The plans and co-pilot deploys of that merge read the live commit and took their "a tenth of
the visitors" step, where the deploys of the afternoon had all fallen back to the first-deploy path.

**Found by the first real change through it.** Pull request 139's plan showed the Redis replacement as
"create replacement and then destroy". The uptime check is `create_before_destroy`, and Terraform passes that
order down to everything it depends on: the web service, and through it Redis. With one name for both
instances Google would have refused the new one. The instance's name now carries its tier. The destroy guard's
own test also failed on that pull request, as designed: it requires the expected-removals list to be empty
unless the same commit changes the test's expectation. Both were fixed in the pull request before it merged.

**What section 10 said had only been tested, now.** Both sign-ins against real GitHub tokens: seen (plan from
a pull request, apply on `main`, `job_workflow_ref` as written). The planner's custom role: enough for every
plan run so far. The applier's roles: enough for a Redis replacement and changes to three Cloud Run services.
Posting and updating the comment and the issue: seen. The wait rule: seen in both directions. Pull requests
from forks: not seen.

## 13. After it works: what each teammate can do in the project (read 2026-11-13; nothing changed)

The plan's Version 4 asks for this review and says Rodrigo decides; nothing is removed without asking him.
Read with `gcloud projects get-iam-policy clps-compute-6z1nc`. Besides Rodrigo (`roles/owner`), three
teammates' Google accounts hold what `space-apps-2026/grant-gcp-access.sh` gives for the hackathon VM:

| Role | What it allows | Who |
| --- | --- | --- |
| `roles/viewer` | Read every setting in the project, and Firestore documents (`datastore.entities.get`): saved plans with their owners' ids, and the day's counts. Not BigQuery rows (`bigquery.tables.getData` is not in it) and not secrets | three |
| `roles/compute.viewer` | Read the VM's settings | three (already inside `roles/viewer`) |
| `roles/compute.osAdminLogin` | Sign in to `pipeline-vm` with their own account, with `sudo` | three |
| `vmOperator` (custom) | Start and stop VMs: `compute.instances.get`, `list`, `start`, `stop` | three |
| `roles/aiplatform.user` | Call Vertex AI models as themselves (for running the old Gemini co-pilot locally) | one |

Nobody but Rodrigo can change anything Terraform manages, deploy, or read a secret. Suggestions, for after
2026-11-15 (the VM is the hackathon's, so nothing changes before):

- **Drop `roles/compute.viewer`**: it adds nothing to `roles/viewer`.
- **Drop `roles/aiplatform.user`** unless the hackathon app calls Vertex AI: the co-pilot here is on Claude
  (decision 0009) and needs no Google model access to run locally.
- **Think about `roles/viewer`.** It lets a teammate read every saved plan in Firestore, with the signed-in
  owner's id. If that matters, give `roles/browser` plus the VM roles instead.
- **Leave the VM roles** while the VM is used; remove them with the VM.

