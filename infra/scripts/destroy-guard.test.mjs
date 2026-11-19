// Run with: node --test infra/scripts/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkPlan, describe, isProtected, parseList, passes, PROTECTED_FILE, EXPECTED_FILE, removalKind } from './destroy-guard.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, 'destroy-guard.mjs');
const PATTERNS = parseList(readFileSync(PROTECTED_FILE, 'utf8'));

/** A resource change as `terraform show -json` writes it. */
function change(address, actions, extra = {}) {
  const bare = address.replace(/^(module\.[^.]+\.)+/, '').replace(/\[.*\]$/, '');
  const [type, name] = bare.split('.');
  return { address, mode: 'managed', type, name, change: { actions, before: {}, after: {} }, ...extra };
}
const plan = (...changes) => ({ format_version: '1.2', resource_changes: changes });

test('the protected list covers what the plan for Phase 5.5 names', () => {
  for (const address of [
    'google_firestore_database.plans[0]',
    'google_firestore_database.stats[0]',
    'google_dns_managed_zone.site[0]',
    'google_dns_record_set.apex[0]',
    'google_dns_record_set.www[0]',
    'google_storage_bucket.assets',
    'google_iam_workload_identity_pool.github',
    'google_iam_workload_identity_pool.terraform_apply',
    'google_iam_workload_identity_pool_provider.github',
    'google_iam_workload_identity_pool_provider.terraform_plan',
    'google_redis_instance.store[0]',
    'google_bigquery_dataset.events[0]',
    'google_bigquery_table.questions[0]',
    'google_service_account.terraform_applier',
    'google_service_account.terraform_planner',
  ]) {
    assert.equal(isProtected(change(address, ['delete']), PATTERNS), true, address);
  }
});

test('what can be made again is not protected', () => {
  for (const address of [
    'google_cloud_run_v2_service.web',
    'google_bigquery_table.questions_daily[0]', // a view
    'google_service_account.web',
    'google_compute_url_map.site[0]',
    'google_project_iam_member.web_vertex[0]',
    'google_monitoring_alert_policy.site_down',
  ]) {
    assert.equal(isProtected(change(address, ['delete']), PATTERNS), false, address);
  }
});

test('a pattern with a name covers only that name, and a type alone covers every name', () => {
  assert.equal(isProtected({ type: 'google_bigquery_table', name: 'questions' }, ['google_bigquery_table.questions']), true);
  assert.equal(isProtected({ type: 'google_bigquery_table', name: 'questions_daily' }, ['google_bigquery_table.questions']), false);
  assert.equal(isProtected({ type: 'google_redis_instance', name: 'anything' }, ['google_redis_instance']), true);
  // A type that merely starts the same is another type.
  assert.equal(isProtected({ type: 'google_iam_workload_identity_pool_provider', name: 'x' }, ['google_iam_workload_identity_pool.*']), false);
});

test('delete, replace in either order, and forget are removals; create, update and no-op are not', () => {
  assert.equal(removalKind(['delete']), 'delete');
  assert.equal(removalKind(['delete', 'create']), 'replace');
  assert.equal(removalKind(['create', 'delete']), 'replace');
  assert.equal(removalKind(['forget']), 'forget');
  assert.equal(removalKind(['create']), null);
  assert.equal(removalKind(['update']), null);
  assert.equal(removalKind(['no-op']), null);
  assert.equal(removalKind(['read']), null);
  assert.equal(removalKind(undefined), null);
});

test('a plan that deletes nothing passes', () => {
  const result = checkPlan(plan(change('google_service_account.terraform_planner', ['create']), change('google_cloud_run_v2_service.web', ['update'])), PATTERNS, []);
  assert.deepEqual(result.blocked, []);
  assert.equal(passes(result), true);
  assert.match(describe(result).join('\n'), /deletes nothing/);
});

test('a plan with no changes at all passes', () => {
  assert.equal(passes(checkPlan({ format_version: '1.2' }, PATTERNS, [])), true);
});

test('deleting a protected resource is stopped', () => {
  const result = checkPlan(plan(change('google_firestore_database.plans[0]', ['delete'])), PATTERNS, []);
  assert.deepEqual(result.blocked, [{ address: 'google_firestore_database.plans[0]', kind: 'delete' }]);
  assert.equal(passes(result), false);
  assert.match(describe(result).join('\n'), /STOPPED: the plan deletes google_firestore_database\.plans\[0\]/);
});

test('replacing a protected resource is stopped, whichever comes first', () => {
  for (const actions of [['delete', 'create'], ['create', 'delete']]) {
    const result = checkPlan(plan(change('google_redis_instance.store[0]', actions)), PATTERNS, []);
    assert.deepEqual(result.blocked, [{ address: 'google_redis_instance.store[0]', kind: 'replace' }]);
    assert.equal(passes(result), false);
  }
});

test('to stop managing a protected resource is stopped too', () => {
  const result = checkPlan(plan(change('google_dns_managed_zone.site[0]', ['forget'])), PATTERNS, []);
  assert.equal(passes(result), false);
});

test('deleting something that is not protected passes, and is counted', () => {
  const result = checkPlan(plan(change('google_monitoring_alert_policy.site_down', ['delete'])), PATTERNS, []);
  assert.equal(passes(result), true);
  assert.equal(result.removals, 1);
  assert.match(describe(result).join('\n'), /1 resource\(s\), none of them on the protected list/);
});

test('a protected resource inside a module is still protected', () => {
  const result = checkPlan(plan(change('module.site.google_dns_managed_zone.zone', ['delete'])), PATTERNS, []);
  assert.equal(result.blocked.length, 1);
});

test('the leftover copy of a replaced resource counts as that resource', () => {
  const result = checkPlan(plan(change('google_redis_instance.store[0]', ['delete'], { deposed: '5e9b7d0c' })), PATTERNS, []);
  assert.equal(result.blocked.length, 1);
});

test('data sources are never the guard\'s business', () => {
  const read = { ...change('data.google_project.this', ['delete']), mode: 'data', type: 'google_storage_bucket', name: 'x' };
  assert.equal(passes(checkPlan(plan(read), PATTERNS, [])), true);
});

test('Phase 4: the Redis replacement goes through when the commit names it', () => {
  const result = checkPlan(plan(change('google_redis_instance.store[0]', ['delete', 'create'])), PATTERNS, ['google_redis_instance.store[0]']);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.allowed, [{ address: 'google_redis_instance.store[0]', kind: 'replace' }]);
  assert.deepEqual(result.stale, []);
  assert.equal(passes(result, { strict: true }), true);
});

test('naming one resource does not let another through', () => {
  const result = checkPlan(
    plan(change('google_redis_instance.store[0]', ['delete', 'create']), change('google_firestore_database.stats[0]', ['delete'])),
    PATTERNS,
    ['google_redis_instance.store[0]'],
  );
  assert.deepEqual(result.blocked, [{ address: 'google_firestore_database.stats[0]', kind: 'delete' }]);
  assert.equal(passes(result), false);
});

test('the address must match exactly: a type, a pattern or another index is not enough', () => {
  for (const line of ['google_redis_instance', 'google_redis_instance.*', 'google_redis_instance.store', 'google_redis_instance.store[1]']) {
    const result = checkPlan(plan(change('google_redis_instance.store[0]', ['delete', 'create'])), PATTERNS, [line]);
    assert.equal(passes(result), false, line);
  }
});

test('a line the plan does not use is a warning on main and a failure on a pull request', () => {
  const result = checkPlan(plan(change('google_cloud_run_v2_service.web', ['update'])), PATTERNS, ['google_redis_instance.store[0]']);
  assert.deepEqual(result.stale, ['google_redis_instance.store[0]']);
  assert.equal(passes(result), true);
  assert.equal(passes(result, { strict: true }), false);
  assert.match(describe(result).join('\n'), /^Warning: /m);
  assert.match(describe(result, { strict: true }).join('\n'), /^STOPPED: /m);
});

test('a plan that did not finish, or is not a plan, is refused', () => {
  assert.throws(() => checkPlan({ format_version: '1.2', errored: true }, PATTERNS, []), /did not finish/);
  assert.throws(() => checkPlan({}, PATTERNS, []), /not a Terraform plan/);
  assert.throws(() => checkPlan(null, PATTERNS, []), /not a Terraform plan/);
});

test('list files: comments, blank lines and trailing comments are ignored', () => {
  assert.deepEqual(parseList('# a comment\n\n  google_redis_instance.store[0]   # why\ngoogle_dns_managed_zone.*\n'), [
    'google_redis_instance.store[0]',
    'google_dns_managed_zone.*',
  ]);
});

test('the tracked list of expected removals is empty unless a pull request is using it', () => {
  // Not a rule for ever: a pull request that removes a protected resource adds a line and changes
  // this test's expectation in the same commit, which is one more deliberate step.
  assert.deepEqual(parseList(readFileSync(EXPECTED_FILE, 'utf8')), []);
});

test('the guard prints addresses, never values from the plan', () => {
  const secret = 'someone@example.com';
  const leaky = change('google_redis_instance.store[0]', ['delete']);
  leaky.change.before = { display_name: secret };
  const result = checkPlan(plan(leaky), PATTERNS, []);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(describe(result).join('\n').includes(secret), false);
});

// ---- The command itself, as the workflow runs it ----

function run(planObject, { expected = '', strict = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const planPath = join(dir, 'tfplan.json');
  const expectedPath = join(dir, 'expected.txt');
  const jsonPath = join(dir, 'guard.json');
  writeFileSync(planPath, typeof planObject === 'string' ? planObject : JSON.stringify(planObject));
  writeFileSync(expectedPath, expected);
  const args = [GUARD, planPath, '--expected', expectedPath, '--json', jsonPath, ...(strict ? ['--strict'] : [])];
  const done = spawnSync(process.execPath, args, { encoding: 'utf8' });
  let verdict = null;
  try {
    verdict = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch {
    // no verdict written
  }
  return { status: done.status, out: done.stdout + done.stderr, verdict };
}

test('command: exit 0 and a verdict file when nothing protected is removed', () => {
  const done = run(plan(change('google_service_account.web', ['delete'])));
  assert.equal(done.status, 0);
  assert.equal(done.verdict.ok, true);
});

test('command: exit 1 when a protected resource would be deleted', () => {
  const done = run(plan(change('google_storage_bucket.assets', ['delete'])));
  assert.equal(done.status, 1);
  assert.match(done.out, /STOPPED: the plan deletes google_storage_bucket\.assets/);
  assert.equal(done.verdict.ok, false);
});

test('command: exit 0 when the removal is named, with the reason as a trailing comment', () => {
  const done = run(plan(change('google_redis_instance.store[0]', ['delete', 'create'])), {
    expected: '# Phase 4\ngoogle_redis_instance.store[0]   # Basic to Standard replaces the instance\n',
    strict: true,
  });
  assert.equal(done.status, 0);
  assert.match(done.out, /Allowed: the plan replaces/);
});

test('command: exit 2 when the plan cannot be read, so a broken guard never reads as a pass', () => {
  assert.equal(run('not json').status, 2);
  assert.equal(run({ format_version: '1.2', errored: true }).status, 2);
  assert.equal(spawnSync(process.execPath, [GUARD, '/nonexistent/tfplan.json'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [GUARD], { encoding: 'utf8' }).status, 2);
});

test('command: an empty protected list is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const planPath = join(dir, 'tfplan.json');
  const emptyList = join(dir, 'protected.txt');
  writeFileSync(planPath, JSON.stringify(plan()));
  writeFileSync(emptyList, '# nothing\n');
  const done = spawnSync(process.execPath, [GUARD, planPath, '--protected', emptyList], { encoding: 'utf8' });
  assert.equal(done.status, 2);
  assert.match(done.stderr, /protected list is empty/);
});

test('command: runs with the tracked lists and no options', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  const planPath = join(dir, 'tfplan.json');
  writeFileSync(planPath, JSON.stringify(plan(change('google_firestore_database.plans[0]', ['delete']))));
  const done = spawnSync(process.execPath, [GUARD, planPath], { encoding: 'utf8' });
  assert.equal(done.status, 1);
  assert.match(done.stdout, /STOPPED/);
});
