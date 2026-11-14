# Decision 0007: Terraform through GitHub, with no approval click

**Status:** built on the branch `arch/phase-5.5-terraform-pipeline` on 2026-11-12. Not applied: the two
identities do not exist yet, so no workflow here has run against the cloud. The order to switch it on, every
grant, and the checks are in [`../ARCHITECTURE_PHASE_5_5.md`](../ARCHITECTURE_PHASE_5_5.md).

## The decision

Rodrigo, 2026-11-12: Terraform moves to the standard team setup. Every pull request that touches `infra/`
shows its plan. Merging to `main` applies it from GitHub Actions. **There is no approval click and there are
no required reviewers**, also once the repository is public. He wants it smooth and autonomous. Applying from
his Mac stays as the way to fix things when the pipeline is broken.

Before this, Claude Code ran every `terraform apply` from the Mac, from a saved plan it had read line by line
([0001](0001-four-services.md)). That put a reader between every plan and its apply. This decision removes
the reader. The rest of this record is what was put in the reader's place, and what was not.

## What this does not protect against

**A merged change that grants access or opens something up is applied without a person reading it. The
guards cover deletions and drift, not judgment.** That is the price of "autonomous".

Concretely, each of these merges and applies with every check green:

- a new line that gives a service account a role it should not have, or makes a private service public;
- a firewall rule loosened, a rate limit raised, a budget alert moved;
- a change to the destroy guard, its protected list or the workflow itself. They live in the repository,
  so whoever can merge can change them. The guard stops accidents. It does not stop intent;
- a setting that is wrong but deletes nothing: a route sent to the wrong service, a timeout of one second.

What makes this acceptable here: it is a practice project with no customers, every change still arrives as a
pull request whose plan is posted (so the record of who changed what is complete), and the people who can
merge are the team. On a system that holds other people's data the same pipeline would get one more thing: a
required review, or an approval on the apply job. It is one setting, and it was left off on purpose.

## What stands in for the reviewer

| Guard | What it does | Where |
| --- | --- | --- |
| The plan comment | Every pull request that touches `infra/` gets one comment: the counts, **every access change lifted to the top**, what the destroy guard would do, and the full plan folded below | `.github/workflows/terraform.yml`, `infra/scripts/plan-comment.mjs` |
| The destroy guard | On `main`, between the plan and the apply: stops the apply if the saved plan deletes or replaces anything on a protected list, unless the same commit names that resource's address in a tracked file | `infra/scripts/destroy-guard.mjs`, `infra/protected-resources.txt`, `infra/expected-removals.txt` |
| `prevent_destroy` | Terraform itself refuses a plan that would delete what cannot be made again: the two Firestore databases, the DNS zone, the three identity pools and their providers | the `lifecycle` blocks in `infra/*.tf` |
| The nightly drift check | Plans `main` against the live project every night. A plan that is not empty opens an issue; a later empty one closes it | `.github/workflows/terraform-drift.yml` |
| Two identities, not one | The identity that plans can only read. The identity that applies can only be used by one workflow file as it is on `main` | `infra/pipeline.tf` |
| Order with the deploys | An apply never runs under a rollout, and a deploy never starts before the Terraform run that came before it has finished | `infra/scripts/wait-for-runs.mjs` |

## Plan and apply are two identities

"Keyless" means there is no stored key or password: GitHub signs a short-lived token that says which
repository, branch, event and workflow file a job runs from, and Google Cloud checks those claims before it
hands back a token of its own (Workload Identity Federation). The deployer already worked this way
(`infra/github.tf`). Two more identities now stand beside it, each behind its own door, called an identity
pool:

| Identity | Who can become it | What it can do |
| --- | --- | --- |
| **Deployer** (unchanged) | Any workflow on `main` | Push an image and update the Cloud Run services |
| **Planner** | This repository's pull requests, and `main` | Read the settings and access lists Terraform compares against, and the Terraform state. It cannot change anything and cannot read stored data: no Firestore documents, no rows of the question log, no bucket objects except the state |
| **Applier** | Only `.github/workflows/terraform.yml`, only as that file is on `main`, only for a push or a run started by hand | Change everything `infra/` manages, including who has access |

**Why the planner is narrow.** A plan runs the pull request's own code: a pull request can change the
workflow, and Terraform runs whatever the configuration asks for. So anyone who can push a branch here can
run code as the planner. It must therefore be harmless: it reads configuration and nothing else. The price
is a list to maintain: a new kind of resource needs its read permission added in the same pull request.

**What the applier adds up to.** It holds the administrator role of each service this folder manages (17
ready-made roles and one small custom one; the list is in the phase document). One of them lets it change the
project's access list, so it can give itself any other role. **Treat it as an owner of the project.** The
narrower list is still worth having: it documents what the pipeline is for, and an honest mistake in a
workflow cannot reach what the roles do not cover without first granting itself more. It is not a security
boundary against someone who can merge to `main`.

A tighter version exists and was not chosen: Google Cloud can limit *which roles* an identity may grant. The
applier could then not make itself an owner, and widening that list would need the Mac. It was left out
because Rodrigo asked for an applier that can change everything, including access, with no stop.

**Why a pull request cannot become the applier.** The claim Google checks (`job_workflow_ref`) names the
workflow file *and the branch the file was read from*. For a pull request that branch is
`refs/pull/<number>/merge`, never `refs/heads/main`. So a pull request that rewrites `terraform.yml` to call
the applier is refused by Google, not by anything in the repository.

**`pull_request`, not `pull_request_target`.** `pull_request_target` runs with `main`'s access while the
code under test comes from the pull request. That is how a stranger's pull request ends up running with a
repository's identity. With `pull_request`, a pull request from a fork gets a read-only token, no secrets
and no identity token, so it cannot reach the cloud at all. The plan job says so and fails, so that an
unplanned change never looks green.

## The two personal settings are not credentials

`infra/terraform.tfvars` used to exist only on Rodrigo's Mac. Everything in it that is not personal is now
tracked in `infra/settings.auto.tfvars`, so a laptop and the pipeline plan the same thing.

Two values stay out of the repository: the billing account's id (for the budget) and the address alerts go
to. They are personal, not secret: neither lets anyone sign in to anything. In GitHub they are the
repository's Actions secrets `TF_BILLING_ACCOUNT` and `TF_ALERT_EMAIL`, because that is the store GitHub
masks in logs. **The claim "no stored keys" stays true**: the sign-in to Google Cloud is still keyless, and
nothing in the repository or its settings can be used to authenticate.

Marking the two variables `sensitive` is not enough by itself. Terraform hides a sensitive value where it is
used as a value, but the billing account's id is also part of the budget's own id, which Terraform prints on
every refresh and whenever the budget changes. So everything the workflows print or post goes through
`infra/scripts/redact.mjs`, and the comment builder refuses to write a text that still holds either value.

## Deploys and applies do not race

Found on 2026-11-12: an apply that changes a Cloud Run service while a deploy is at its "a tenth of
visitors" step makes a newer version than the one the deploy is testing, and the deploy's last step then
sends everyone to that one.

The rule: **a run waits for every run of the other kind that started before it.** Waits only ever point at
earlier runs, so two runs can never wait for each other.

- A deploy's first step waits for every Terraform run that started before it. When a merge changes both
  `infra/` and the app, Terraform's run starts at the push and the deploys start when CI ends, minutes
  later, so Terraform finishes first.
- **Terraform failed:** the deploy stops with an error that says so. The new version may need something
  Terraform did not make. Fix or re-run Terraform, then start the deploy by hand. A deploy started by hand
  goes ahead with a warning: a person decided.
- **Terraform was skipped** (the merge touched nothing under `infra/`): there is no Terraform run for that
  merge, so there is nothing to wait for.
- An apply waits for every deploy that started before it, then plans. It gives up after 45 minutes and
  fails without applying.

## Revision names: the cause, and the fix

Every `terraform plan` used to show each Cloud Run service "updated in place" with its revision's name
cleared, and applying that started a new revision of each service outside the deploys' stepped rollout. That
would have made every nightly drift check report four changes.

**The cause.** `gcloud run deploy --tag canary` makes gcloud choose the new revision's name itself and write
it into the service's settings (gcloud's own source: a name is generated when `--tag` or `--revision-suffix`
is given). Terraform's configuration has no name there, so every plan wanted to clear it. Ignoring the field
in Terraform (pull request 89) broke every later update, because the old name was then sent again with new
settings; it was reverted (pull request 99).

**The fix** is in the deploy workflows, not in Terraform: deploy with no `--tag`, then give the tag to the
revision that was just made. Without `--tag`, gcloud leaves the name empty and Cloud Run names the revision.
Read-only plans on 2026-11-12 showed both halves: right after an apply had cleared the names the plan had no
such change, and right after the old workflows deployed again it had all four back.

**A second finding fixed with it.** The deploy workflows worked out "the commit that is live" from the live
revision's image name (`LIVE_COMMIT=${LIVE_IMAGE##*:}`). It was first seen after an apply cleared the
revision names (run "Deploy co-pilot" for commit `af946d5`): the revision the apply made records its image
as `...@sha256:...`, so the part after the last colon is not a commit, the run treats the merge as a first
deploy, rebuilds and redeploys a docs-only merge, and skips "a tenth of the visitors" and "watch both
versions". It is wider than Terraform: on 2026-11-12 every revision of the four services showed a digest,
those made by `gcloud run deploy` from the deployer included (`clps-copilot-00017-mok`, for one), and the
last eight runs of "Deploy plans" all took the first-deploy path. Only the service's template keeps the tag,
and that is the newest revision, not the live one.

**Chosen: both halves.** Terraform no longer makes those revisions, because the deploys no longer leave a
name for it to clear (above). And the workflows no longer read the commit from the image:

- each deploy puts a `commit=<short sha>` label on the revision it makes, and reads the live revision's
  label. Terraform ignores template labels, so a revision Terraform makes (a changed setting) carries the
  label along with the image;
- when the live revision has no label (one made before this change, or by hand), the plans and co-pilot
  deploys ask the service's own status address, which reports `version` (the commit baked into the image)
  and `revision`. The answer is believed only when `revision` is the live revision's name. So the first
  deploy after the merge still gets its "a tenth" step;
- the events worker's status address needs an identity token that step does not have yet. With no label it
  deploys as before, once. It has no "a tenth" step to lose.

## What was not built

- No approval step, no required reviewers. That is the decision.
- No policy check on the plan (a rule such as "nothing may become public"). The comment lifts access changes
  to the top so they are easy to read, but nothing refuses them.
- No automatic repair of drift. The check reports. A person decides whether the code or the project is right.
- The domain's registration, the state bucket and the pipeline VM stay outside Terraform, as before.
