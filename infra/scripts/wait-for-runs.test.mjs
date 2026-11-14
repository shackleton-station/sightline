// Run with: node --test infra/scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide } from './wait-for-runs.mjs';

let nextId = 1;
/** A workflow run that started `minute` minutes into the hour. */
function run(minute, status = 'completed', conclusion = 'success', extra = {}) {
  const id = nextId++;
  return {
    id,
    name: extra.name ?? 'Terraform',
    run_number: id,
    run_started_at: new Date(Date.UTC(2026, 10, 12, 20, minute, extra.second ?? 0)).toISOString(),
    status,
    conclusion: status === 'completed' ? conclusion : null,
    event: 'push',
    ...extra,
  };
}

// ---- a deploy asks about Terraform runs ----

test('deploy: with no Terraform run before it, it goes', () => {
  assert.equal(decide('deploy', run(10), []).action, 'go');
  // A Terraform run that started later is not this deploy's business.
  assert.equal(decide('deploy', run(10), [run(12, 'in_progress')]).action, 'go');
});

test('deploy: waits for a Terraform run that started before it and is still going', () => {
  assert.equal(decide('deploy', run(10), [run(5, 'in_progress')]).action, 'wait');
  assert.equal(decide('deploy', run(10), [run(5, 'queued')]).action, 'wait');
  assert.equal(decide('deploy', run(10), [run(5, 'pending')]).action, 'wait');
});

test('deploy: the same commit changed infrastructure and the app, and Terraform finished: it goes', () => {
  const verdict = decide('deploy', run(10), [run(2), run(5)]);
  assert.equal(verdict.action, 'go');
  assert.match(verdict.reason, /ended well/);
});

test('deploy: Terraform failed, so the deploy stops and says what to do', () => {
  for (const conclusion of ['failure', 'timed_out', 'startup_failure', 'action_required']) {
    const verdict = decide('deploy', run(10), [run(5, 'completed', conclusion)]);
    assert.equal(verdict.action, 'stop', conclusion);
    assert.match(verdict.reason, /start this deploy by hand/);
  }
});

test('deploy: only the last Terraform run before it counts', () => {
  // An older failure that a later run fixed.
  assert.equal(decide('deploy', run(10), [run(2, 'completed', 'failure'), run(5)]).action, 'go');
  // An older success, then a failure.
  assert.equal(decide('deploy', run(10), [run(2), run(5, 'completed', 'failure')]).action, 'stop');
});

test('deploy: Terraform was skipped (nothing in infra/ changed in that run): it goes', () => {
  assert.equal(decide('deploy', run(10), [run(5, 'completed', 'skipped')]).action, 'go');
});

test('deploy: started by hand, it goes even after a failed Terraform run, with a warning', () => {
  const verdict = decide('deploy', run(10, 'in_progress', null, { event: 'workflow_dispatch' }), [run(5, 'completed', 'failure')]);
  assert.equal(verdict.action, 'go');
  assert.match(verdict.warning, /Deploying anyway/);
});

test('deploy: started by hand, it still waits for a Terraform run that is going', () => {
  assert.equal(decide('deploy', run(10, 'in_progress', null, { event: 'workflow_dispatch' }), [run(5, 'in_progress')]).action, 'wait');
});

test('deploy: a Terraform run cancelled for a newer one hands the decision to the newer one', () => {
  const cancelled = run(5, 'completed', 'cancelled');
  assert.equal(decide('deploy', run(10), [cancelled, run(12, 'queued')]).action, 'wait');
  assert.equal(decide('deploy', run(10), [cancelled, run(12)]).action, 'go');
  assert.equal(decide('deploy', run(10), [cancelled, run(12, 'completed', 'failure')]).action, 'stop');
  // Two in a row.
  assert.equal(decide('deploy', run(10), [cancelled, run(12, 'completed', 'cancelled'), run(14)]).action, 'go');
});

test('deploy: a Terraform run cancelled with nothing after it stops the deploy', () => {
  assert.equal(decide('deploy', run(10), [run(5, 'completed', 'cancelled')]).action, 'stop');
});

// ---- an apply asks about deploys ----

test('apply: waits for a deploy that started before it and is mid-rollout', () => {
  const deploy = run(5, 'in_progress', null, { name: 'Deploy co-pilot' });
  const verdict = decide('apply', run(10), [deploy]);
  assert.equal(verdict.action, 'wait');
  assert.match(verdict.reason, /Deploy co-pilot/);
});

test('apply: a deploy that started after it is left to wait for the apply', () => {
  assert.equal(decide('apply', run(10), [run(12, 'in_progress', null, { name: 'Deploy' })]).action, 'go');
});

test('apply: how an earlier deploy ended does not matter, only that it ended', () => {
  assert.equal(decide('apply', run(10), [run(5, 'completed', 'failure', { name: 'Deploy' }), run(6, 'completed', 'skipped', { name: 'Deploy plans' })]).action, 'go');
});

// ---- the two can never wait for each other ----

test('an apply and a deploy never both wait for the other, whichever started first', () => {
  for (const [applyMinute, deployMinute] of [
    [5, 10],
    [10, 5],
  ]) {
    const apply = run(applyMinute, 'in_progress');
    const deploy = run(deployMinute, 'in_progress', null, { name: 'Deploy' });
    const applyWaits = decide('apply', apply, [deploy]).action === 'wait';
    const deployWaits = decide('deploy', deploy, [apply]).action === 'wait';
    assert.equal(applyWaits && deployWaits, false);
    assert.equal(applyWaits || deployWaits, true, 'one of them must wait');
  }
});

test('started in the same second, the apply goes first and the deploy waits', () => {
  const apply = run(10, 'in_progress');
  const deploy = run(10, 'in_progress', null, { name: 'Deploy' });
  assert.equal(decide('apply', apply, [deploy]).action, 'go');
  assert.equal(decide('deploy', deploy, [apply]).action, 'wait');
});

test('a chain of waits always ends at the earliest run', () => {
  // Terraform 1 is applying. A deploy started next and waits for it. Terraform 2 started last.
  const terraform1 = run(1, 'in_progress');
  const deploy = run(3, 'in_progress', null, { name: 'Deploy' });
  const terraform2 = run(6, 'queued');
  assert.equal(decide('deploy', deploy, [terraform1, terraform2]).action, 'wait'); // for terraform 1 only
  assert.match(decide('deploy', deploy, [terraform1, terraform2]).reason, /#\d+/);
  assert.equal(decide('apply', terraform2, [deploy]).action, 'wait'); // for the deploy
  assert.equal(decide('apply', terraform1, [deploy]).action, 'go'); // nothing earlier
});

test('a run never waits for itself', () => {
  const me = run(10, 'in_progress');
  assert.equal(decide('deploy', me, [me]).action, 'go');
  assert.equal(decide('apply', me, [me]).action, 'go');
  assert.equal(decide('drift', me, [me]).action, 'go');
});

// ---- the nightly check asks about applies ----

test('drift: waits for any apply that is going, whenever it started', () => {
  assert.equal(decide('drift', run(10), [run(12, 'in_progress')]).action, 'wait');
  assert.equal(decide('drift', run(10), [run(5, 'queued')]).action, 'wait');
});

test('drift: goes when no apply is going, however the last one ended', () => {
  assert.equal(decide('drift', run(10), [run(5, 'completed', 'failure')]).action, 'go');
  assert.equal(decide('drift', run(10), []).action, 'go');
});
