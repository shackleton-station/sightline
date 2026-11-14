// Run with: node --test infra/scripts/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { actionWord, buildBody, changedPaths, countsLine, DRIFT_MARKER, MAX_BODY, parseChecks, PR_MARKER, summarize } from './plan-comment.mjs';
import { countSecrets, HIDDEN, redact, secretsFrom } from './redact.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// Made-up values of the right shape. The real ones never appear in this repository.
const BILLING = '01ABCD-234567-89EF01';
const EMAIL = 'Captain.Example@example.org';
const SECRETS = secretsFrom({ TF_VAR_billing_account: BILLING, TF_VAR_alert_email: EMAIL });

function change(address, actions, extra = {}) {
  const [type, name] = address.replace(/\[.*\]$/, '').split('.');
  return { address, mode: 'managed', type, name, change: { actions, before: null, after: {}, after_unknown: { id: true } }, ...extra };
}
const plan = (...changes) => ({ format_version: '1.2', resource_changes: changes });

// ---- redact ----

test('redact: both values are replaced wherever they stand, in any letter case', () => {
  const text = `id = "billingAccounts/${BILLING}/budgets/b6fe"\nto ${EMAIL.toLowerCase()} and ${EMAIL.toUpperCase()}\n`;
  const clean = redact(text, SECRETS);
  assert.equal(countSecrets(clean, SECRETS), 0);
  assert.equal(clean, `id = "billingAccounts/${HIDDEN}/budgets/b6fe"\nto ${HIDDEN} and ${HIDDEN}\n`);
});

test('redact: a value written as part of a URL is replaced too', () => {
  const clean = redact(`?email=${encodeURIComponent(EMAIL)}`, SECRETS);
  assert.equal(clean, `?email=${HIDDEN}`);
});

test('redact: characters that mean something in a pattern are taken literally', () => {
  const secrets = secretsFrom({ TF_VAR_alert_email: 'a.b+c@example.org' });
  assert.equal(redact('axb+c@example.org a.b+c@example.org', secrets), `axb+c@example.org ${HIDDEN}`);
});

test('redact: with nothing to hide, the text is unchanged, and an empty value hides nothing', () => {
  assert.deepEqual(secretsFrom({}), []);
  assert.deepEqual(secretsFrom({ TF_VAR_billing_account: '', TF_VAR_alert_email: '  ' }), []);
  assert.equal(redact('plan text', []), 'plan text');
});

test('redact: the command filters what is piped through it', () => {
  const done = spawnSync(process.execPath, [join(HERE, 'redact.mjs')], {
    input: `google_billing_budget.monthly: Refreshing state... [id=billingAccounts/${BILLING}/budgets/x]\nno secret here\nlast line ${EMAIL}`,
    env: { ...process.env, TF_VAR_billing_account: BILLING, TF_VAR_alert_email: EMAIL },
    encoding: 'utf8',
  });
  assert.equal(done.status, 0);
  assert.equal(done.stdout, `google_billing_budget.monthly: Refreshing state... [id=billingAccounts/${HIDDEN}/budgets/x]\nno secret here\nlast line ${HIDDEN}`);
});

// ---- the summary ----

test('actionWord: one word per kind of change', () => {
  assert.equal(actionWord(['create']), 'create');
  assert.equal(actionWord(['update']), 'update');
  assert.equal(actionWord(['delete']), 'delete');
  assert.equal(actionWord(['delete', 'create']), 'replace');
  assert.equal(actionWord(['create', 'delete']), 'replace');
  assert.equal(actionWord(['no-op']), null);
  assert.equal(actionWord(['read']), null);
});

test('summarize: counts by kind and lists the addresses; no-ops and data sources are left out', () => {
  const summary = summarize(
    plan(
      change('google_service_account.terraform_planner', ['create']),
      change('google_cloud_run_v2_service.web', ['update'], { change: { actions: ['update'], before: { a: 1 }, after: { a: 2 } } }),
      change('google_redis_instance.store[0]', ['delete', 'create']),
      change('google_monitoring_alert_policy.site_down', ['delete']),
      change('google_storage_bucket.assets', ['no-op']),
      { ...change('data.google_project.this', ['read']), mode: 'data' },
    ),
  );
  assert.deepEqual(summary.counts, { create: 1, update: 1, replace: 1, delete: 1, forget: 0 });
  assert.deepEqual(
    summary.resources.map((r) => `${r.action} ${r.address}`),
    ['create google_service_account.terraform_planner', 'update google_cloud_run_v2_service.web', 'replace google_redis_instance.store[0]', 'delete google_monitoring_alert_policy.site_down'],
  );
  assert.equal(countsLine(summary.counts), '1 to add, 1 to change, 1 to destroy, 1 to replace (destroyed, then made again)');
});

test('summarize: access grants are lifted out with their role and member', () => {
  const grant = change('google_project_iam_member.applier["cloud_run"]', ['create']);
  grant.change.after = { role: 'roles/run.admin', member: 'serviceAccount:terraform-applier@p.iam.gserviceaccount.com', project: 'p' };
  const removed = change('google_storage_bucket_iam_member.web_reads_assets', ['delete']);
  removed.change.before = { role: 'roles/storage.objectViewer', member: 'serviceAccount:web@p.iam.gserviceaccount.com' };
  removed.change.after = null;
  const summary = summarize(plan(grant, removed));
  assert.deepEqual(summary.grants, [
    { address: 'google_project_iam_member.applier["cloud_run"]', action: 'create', role: 'roles/run.admin', members: ['serviceAccount:terraform-applier@p.iam.gserviceaccount.com'] },
    { address: 'google_storage_bucket_iam_member.web_reads_assets', action: 'delete', role: 'roles/storage.objectViewer', members: ['serviceAccount:web@p.iam.gserviceaccount.com'] },
  ]);
});

test('summarize: a member Terraform hides, or does not know yet, is not printed', () => {
  const hidden = change('google_project_iam_member.x', ['create']);
  hidden.change.after = { role: 'roles/viewer', member: `user:${EMAIL}` };
  hidden.change.after_sensitive = { member: true };
  const unknown = change('google_project_iam_member.y', ['create']);
  unknown.change.after = { role: 'roles/viewer' };
  const summary = summarize(plan(hidden, unknown));
  assert.deepEqual(summary.grants[0].members, ['(sensitive)']);
  assert.deepEqual(summary.grants[1].members, ['(known after apply)']);
});

test('summarize: an update that only clears a revision name is called out', () => {
  const service = change('google_cloud_run_v2_service.web', ['update']);
  service.change.before = { name: 'clps-web', template: [{ revision: 'clps-web-00148-haj', timeout: '60s' }] };
  service.change.after = { name: 'clps-web', template: [{ revision: null, timeout: '60s' }] };
  service.change.after_unknown = {};
  const [note] = summarize(plan(service)).notes;
  assert.match(note, /only change is clearing the revision's name/);

  // With a real change beside it, there is no such note.
  service.change.after.template[0].timeout = '30s';
  assert.deepEqual(summarize(plan(service)).notes, []);
});

test('summarize: an update in which no value differs is called out', () => {
  const channel = change('google_monitoring_notification_channel.email', ['update']);
  channel.change.before = { labels: { email_address: EMAIL } };
  channel.change.after = { labels: { email_address: EMAIL } };
  channel.change.after_unknown = {};
  const [note] = summarize(plan(channel)).notes;
  assert.match(note, /no value changes/);
  assert.equal(note.includes(EMAIL), false);
});

test('changedPaths: where two values differ', () => {
  assert.deepEqual(changedPaths({ a: 1, b: [{ c: 'x' }] }, { a: 1, b: [{ c: 'y' }] }), ['b.0.c']);
  assert.deepEqual(changedPaths({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(changedPaths({ a: 1 }, { a: 1, b: 2 }), ['b']);
  assert.deepEqual(changedPaths(null, { a: 1 }), ['.']);
});

test('parseChecks: name=outcome pairs', () => {
  assert.deepEqual(parseChecks('format=success, validate=failure,plan=skipped'), { format: 'success', validate: 'failure', plan: 'skipped' });
  assert.deepEqual(parseChecks(undefined), {});
});

// ---- the comment ----

const PLAN_TEXT = `Terraform will perform the following actions:

  # google_billing_budget.monthly will be updated in-place
  ~ resource "google_billing_budget" "monthly" {
      ~ billing_account = (sensitive value)
        id              = "billingAccounts/${BILLING}/budgets/b6fedbe2"
    }

Plan: 1 to add, 1 to change, 0 to destroy.
`;

function prBody(overrides = {}) {
  const grant = change('google_project_iam_member.applier["cloud_run"]', ['create']);
  grant.change.after = { role: 'roles/run.admin', member: 'serviceAccount:terraform-applier@p.iam.gserviceaccount.com' };
  const budget = change('google_billing_budget.monthly', ['update']);
  budget.change.before = { billing_account: BILLING, id: `billingAccounts/${BILLING}/budgets/b6fedbe2` };
  budget.change.after = { billing_account: BILLING, id: `billingAccounts/${BILLING}/budgets/b6fedbe2` };
  budget.change.after_unknown = {};
  return buildBody({
    mode: 'pr',
    plan: plan(grant, budget),
    planText: PLAN_TEXT,
    guard: { blocked: [], allowed: [], stale: [], strict: true, ok: true },
    checks: { format: 'success', validate: 'success', tests: 'success', plan: 'success', guard: 'success' },
    sha: '0123456789abcdef',
    runUrl: 'https://github.com/o/r/actions/runs/1',
    secrets: SECRETS,
    ...overrides,
  });
}

test('comment: starts with the marker, says the counts, lists grants, and folds the plan', () => {
  const body = prBody();
  assert.equal(body.startsWith(`${PR_MARKER}\n`), true);
  assert.match(body, /## Terraform plan for `0123456`/);
  assert.match(body, /\*\*1 to add, 1 to change, 0 to destroy\.\*\*/);
  assert.match(body, /Checks: format passed, validate passed, tests passed, plan passed, guard passed\./);
  assert.match(body, /### Access this plan changes/);
  assert.match(body, /grants `roles\/run\.admin` to `serviceAccount:terraform-applier@p\.iam\.gserviceaccount\.com`/);
  assert.match(body, /<details><summary>The full plan<\/summary>\n\n```text\nTerraform will perform/);
  assert.match(body, /<\/details>/);
  assert.match(body, /applies it with no approval/);
});

test('comment: neither personal value is in it, though both were in what it was built from', () => {
  const body = prBody({ planText: `${PLAN_TEXT}\nalert goes to ${EMAIL}\n` });
  assert.equal(countSecrets(body, SECRETS), 0);
  assert.equal(body.includes(BILLING), false);
  assert.equal(body.toLowerCase().includes(EMAIL.toLowerCase()), false);
  assert.match(body, /billingAccounts\/\(hidden\)\/budgets\/b6fedbe2/);
});

test('comment: a failed step is named, with a link to the run', () => {
  const body = prBody({ checks: { format: 'failure', validate: 'success', plan: 'success' } });
  assert.match(body, /format \*\*FAILED\*\*/);
  assert.match(body, /The step that failed: format\. \[The run's log\]\(https:\/\/github\.com\/o\/r\/actions\/runs\/1\)/);
});

test('comment: when the plan did not finish, it says so and shows what Terraform printed', () => {
  const body = prBody({ plan: null, planText: 'Error: Invalid value for variable', checks: { plan: 'failure' } });
  assert.match(body, /\*\*The plan did not finish\.\*\*/);
  assert.match(body, /<summary>What Terraform printed<\/summary>/);
  assert.match(body, /Error: Invalid value for variable/);
});

test('comment: no changes', () => {
  const body = prBody({ plan: plan(change('google_storage_bucket.assets', ['no-op'])), planText: 'No changes.' });
  assert.match(body, /\*\*No changes\.\*\*/);
  assert.equal(body.includes('### What changes'), false);
});

test('comment: what the destroy guard would stop is at the top, with what to do', () => {
  const body = prBody({
    guard: { blocked: [{ address: 'google_redis_instance.store[0]', kind: 'replace' }], allowed: [], stale: ['google_dns_managed_zone.site[0]'], strict: true, ok: false },
    checks: { plan: 'success', guard: 'failure' },
  });
  assert.match(body, /### The destroy guard would stop this/);
  assert.match(body, /- `google_redis_instance\.store\[0\]`: replace, and it is on the protected list\./);
  assert.match(body, /name each address in `infra\/expected-removals\.txt`/);
  assert.match(body, /### Lines to delete from `infra\/expected-removals\.txt` \(this check fails until they are\)/);
  assert.ok(body.indexOf('The destroy guard would stop this') < body.indexOf('### What changes'));
});

test('comment: a removal the pull request names is shown as on purpose', () => {
  const body = prBody({ guard: { blocked: [], allowed: [{ address: 'google_redis_instance.store[0]', kind: 'replace' }], stale: [], strict: true, ok: true } });
  assert.match(body, /### Protected resources this plan removes on purpose/);
});

test('comment: says so when the pull request changes the guard itself', () => {
  assert.match(prBody({ guardFilesChanged: true }), /\*\*This pull request changes the destroy guard itself\*\*/);
  assert.equal(prBody().includes('changes the destroy guard itself'), false);
});

test('comment: a very long plan is cut to fit, and says where the rest is', () => {
  const long = Array.from({ length: 5000 }, (_, i) => `      + line ${i} of a long plan with some padding to make it long`).join('\n');
  const body = prBody({ planText: long });
  assert.ok(body.length <= MAX_BODY, `${body.length} characters`);
  assert.match(body, /Cut after \d+ of 5000 lines to fit in a comment\. The whole plan is in \[the run's log\]/);
  assert.match(body, /<\/details>/);
  assert.match(body, /applies it with no approval/);
});

test('comment: backticks in the plan cannot close the code block early', () => {
  const body = prBody({ planText: 'content = "To go back: ```gcloud run``` and more"' });
  assert.match(body, /````text\ncontent = "To go back: ```gcloud run``` and more"\n````/);
});

test('comment: many resources are listed up to a limit', () => {
  const many = Array.from({ length: 80 }, (_, i) => change(`google_pubsub_topic.t${i}`, ['create']));
  const body = prBody({ plan: plan(...many) });
  assert.match(body, /- and 20 more, in the plan below\./);
});

// ---- the drift issue ----

test('drift issue: its own marker, what happened, and what to do', () => {
  const body = buildBody({
    mode: 'drift',
    plan: plan(change('google_cloud_run_v2_service.web', ['update'], { change: { actions: ['update'], before: { a: 1 }, after: { a: 2 } } })),
    planText: `  # google_cloud_run_v2_service.web will be updated in-place\nid=billingAccounts/${BILLING}/budgets/x`,
    sha: 'fedcba9876543210',
    runUrl: 'https://github.com/o/r/actions/runs/2',
    secrets: SECRETS,
  });
  assert.equal(body.startsWith(`${DRIFT_MARKER}\n`), true);
  assert.match(body, /## The live project does not match `main`/);
  assert.match(body, /\*\*0 to add, 1 to change, 0 to destroy\.\*\*/);
  assert.match(body, /### What to do/);
  assert.equal(countSecrets(body, SECRETS), 0);
});

test('drift issue: a plan that failed is not called drift', () => {
  const body = buildBody({ mode: 'drift', plan: null, planText: 'Error: 403 on google_billing_budget.monthly', sha: 'fedcba9876543210', secrets: SECRETS });
  assert.equal(body.startsWith(`${DRIFT_MARKER}\n`), true);
  assert.match(body, /## The nightly check could not plan `main`/);
  assert.match(body, /This is not a report of drift/);
  assert.equal(body.includes('does not match'), false);
  assert.match(body, /Error: 403/);
});

test('apply summary: says what it is, and does not claim the plan was read-only', () => {
  const body = buildBody({
    mode: 'apply',
    plan: plan(change('google_service_account.terraform_planner', ['create'])),
    planText: PLAN_TEXT,
    guard: { blocked: [{ address: 'google_redis_instance.store[0]', kind: 'replace' }], allowed: [], stale: [], strict: false, ok: false },
    sha: '0123456789abcdef',
    secrets: SECRETS,
  });
  assert.match(body, /## Terraform apply of `main` at `0123456`/);
  assert.match(body, /The pipeline will not apply this by itself\./);
  assert.match(body, /as `terraform-applier`/);
  assert.equal(body.includes('terraform-planner`. Merging'), false);
  assert.equal(countSecrets(body, SECRETS), 0);
});

// ---- the command ----

test('command: writes the comment to a file, with the values taken from the environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'comment-'));
  writeFileSync(join(dir, 'tfplan.json'), JSON.stringify(plan(change('google_service_account.terraform_planner', ['create']))));
  writeFileSync(join(dir, 'plan.txt'), PLAN_TEXT);
  const out = join(dir, 'comment.md');
  const done = spawnSync(
    process.execPath,
    [join(HERE, 'plan-comment.mjs'), '--mode', 'pr', '--plan-json', join(dir, 'tfplan.json'), '--plan-text', join(dir, 'plan.txt'), '--checks', 'plan=success', '--sha', 'abcdef0123', '--out', out],
    { env: { ...process.env, TF_VAR_billing_account: BILLING, TF_VAR_alert_email: EMAIL }, encoding: 'utf8' },
  );
  assert.equal(done.status, 0, done.stderr);
  const body = readFileSync(out, 'utf8');
  assert.match(body, /\*\*1 to add, 0 to change, 0 to destroy\.\*\*/);
  assert.equal(body.includes(BILLING), false);
});

test('command: files that are missing give a comment that says the plan did not finish', () => {
  const done = spawnSync(process.execPath, [join(HERE, 'plan-comment.mjs'), '--mode', 'pr', '--plan-json', '/nonexistent.json', '--checks', 'plan=failure'], { encoding: 'utf8' });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /The plan did not finish/);
});
