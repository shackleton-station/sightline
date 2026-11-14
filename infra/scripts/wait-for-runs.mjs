// Keeps Terraform applies and deploys out of each other's way.
//
// An apply that changes a Cloud Run service while a deploy is moving visitors to a new version
// makes a newer version than the one the deploy is testing, and the deploy's last step ("send it
// everyone") then sends everyone to that one. And a deploy that starts before the Terraform run of
// the same commit has finished can ship code that needs something Terraform has not made yet.
//
// One rule covers both: **a run waits for every run of the other kind that started before it.**
// Waits only ever point at earlier runs, so two runs can never wait for each other.
//
//   node infra/scripts/wait-for-runs.mjs deploy   # first step of each deploy workflow
//   node infra/scripts/wait-for-runs.mjs apply    # in the Terraform workflow, before the plan
//   node infra/scripts/wait-for-runs.mjs drift    # the nightly check: wait for any apply to finish
//
// A deploy also looks at how the last Terraform run before it ended. If that run failed, the deploy
// stops: the code may need what Terraform did not make. A deploy started by hand goes ahead anyway,
// with a warning, because a person decided.
//
// Exit status: 0 go ahead, 1 stop, 3 gave up waiting (the caller decides what that means).
// It needs GITHUB_TOKEN with `actions: read`, GITHUB_REPOSITORY and GITHUB_RUN_ID.

import { pathToFileURL } from 'node:url';

export const TERRAFORM_WORKFLOW = 'terraform.yml';
export const DEPLOY_WORKFLOWS = ['deploy.yml', 'deploy-plans.yml', 'deploy-copilot.yml', 'deploy-events-worker.yml'];

const started = (run) => Date.parse(run.run_started_at ?? run.created_at);
const finished = (run) => run.status === 'completed';
const label = (run) => `${run.name ?? 'run'} #${run.run_number ?? run.id} (${run.html_url ?? run.id})`;

/** Conclusions after which infrastructure is as `main` says, as far as that run could tell. */
const GOOD = new Set(['success', 'skipped', 'neutral']);

/**
 * What a run should do now.
 *
 * @param {'deploy'|'apply'|'drift'} kind  what the asking run is about to do
 * @param {object} me      the asking run: { id, run_started_at, event }
 * @param {object[]} others  runs of the other kind on main, in any order: for a deploy or the drift
 *                           check, the Terraform workflow's runs; for an apply, the deploys' runs
 * @returns {{ action: 'go'|'wait'|'stop', reason: string, warning?: string }}
 */
export function decide(kind, me, others) {
  const mine = started(me);
  const runs = others.filter((run) => run.id !== me.id).sort((a, b) => started(a) - started(b));

  if (kind === 'drift') {
    const busy = runs.filter((run) => !finished(run));
    return busy.length > 0
      ? { action: 'wait', reason: `An apply is running or queued: ${label(busy[0])}.` }
      : { action: 'go', reason: 'No apply is running.' };
  }

  // An apply and a deploy that started in the same second: the apply goes first.
  const earlier = runs.filter((run) => (kind === 'deploy' ? started(run) <= mine : started(run) < mine));
  const busy = earlier.filter((run) => !finished(run));
  if (busy.length > 0) {
    return { action: 'wait', reason: `Started before this run and not finished: ${busy.map(label).join(', ')}.` };
  }
  if (kind === 'apply') {
    return { action: 'go', reason: 'No deploy that started before this run is still going.' };
  }

  // A deploy: how did the last Terraform run before it end?
  let last = earlier[earlier.length - 1];
  if (!last) return { action: 'go', reason: 'No Terraform run started before this deploy.' };
  // A run cancelled because a newer one took its place in the queue: the newer one decides.
  while (last.conclusion === 'cancelled') {
    const next = runs.find((run) => started(run) > started(last));
    if (!next) break;
    if (!finished(next)) {
      return { action: 'wait', reason: `${label(last)} was cancelled and ${label(next)} took its place; waiting for that one.` };
    }
    last = next;
  }
  if (GOOD.has(last.conclusion)) {
    return { action: 'go', reason: `The last Terraform run before this deploy ended well: ${label(last)}.` };
  }
  const problem = `The last Terraform run before this deploy ended "${last.conclusion}": ${label(last)}.`;
  if (me.event === 'workflow_dispatch') {
    return { action: 'go', reason: 'Started by hand.', warning: `${problem} Deploying anyway, because this run was started by hand.` };
  }
  return {
    action: 'stop',
    reason: `${problem} This version may need something Terraform did not make. Fix or re-run that Terraform run, then start this deploy by hand (Actions, this workflow, Run workflow).`,
  };
}

async function api(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'sightline-wait-for-runs',
    },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
  return response.json();
}

/** The latest runs of a workflow file on main. A workflow that does not exist yet has none. */
async function runsOf(repository, workflow) {
  try {
    const page = await api(`/repos/${repository}/actions/workflows/${workflow}/runs?branch=main&per_page=30`);
    // Runs for a pull request never apply or deploy.
    return (page.workflow_runs ?? []).filter((run) => run.event !== 'pull_request');
  } catch (error) {
    if (/ 404 /.test(error.message)) return [];
    throw error;
  }
}

async function main(argv) {
  const kind = argv[2];
  if (!['deploy', 'apply', 'drift'].includes(kind)) {
    console.error('usage: wait-for-runs.mjs deploy|apply|drift [--minutes <n>]');
    return 1;
  }
  const at = argv.indexOf('--minutes');
  const minutes = at === -1 ? 30 : Number(argv[at + 1]);
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!process.env.GITHUB_TOKEN || !repository || !runId) {
    console.error('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID must be set.');
    return 1;
  }
  const me = await api(`/repos/${repository}/actions/runs/${runId}`);
  const workflows = kind === 'apply' ? DEPLOY_WORKFLOWS : [TERRAFORM_WORKFLOW];
  const deadline = Date.now() + minutes * 60_000;
  let said = '';
  for (;;) {
    const others = (await Promise.all(workflows.map((workflow) => runsOf(repository, workflow)))).flat();
    const verdict = decide(kind, me, others);
    if (verdict.action === 'go') {
      if (verdict.warning) console.log(`::warning::${verdict.warning}`);
      console.log(verdict.reason);
      return 0;
    }
    if (verdict.action === 'stop') {
      console.log(`::error::${verdict.reason}`);
      return 1;
    }
    if (verdict.reason !== said) {
      console.log(`Waiting. ${verdict.reason}`);
      said = verdict.reason;
    }
    if (Date.now() > deadline) {
      console.log(`::error::Gave up after ${minutes} minutes. ${verdict.reason} Run this workflow again once it has finished.`);
      return 3;
    }
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => process.exit(code),
    (error) => {
      console.log(`::error::Could not ask GitHub about other runs: ${error.message}`);
      process.exit(1);
    },
  );
}
