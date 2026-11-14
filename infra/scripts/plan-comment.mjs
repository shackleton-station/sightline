// Builds the one comment a pull request gets about its Terraform plan, and the body of the issue
// the nightly drift check opens. A short summary first, the whole plan folded below it.
//
//   node infra/scripts/plan-comment.mjs --mode pr --plan-json infra/tfplan.json \
//        --plan-text infra/plan.txt --guard infra/guard.json --checks format=success,plan=success \
//        --sha <commit> --run-url <url> --out infra/plan-comment.md
//
// Everything it writes goes through redact.mjs last, and the script fails if either personal value
// is still in the text after that: a comment is public once the repository is.
//
// The summary is built from the plan's JSON, where only addresses, actions, roles and members are
// read. The folded plan is Terraform's own text (`terraform show`), which already hides sensitive
// values; the redaction covers what that leaves (the billing account id inside the budget's id).

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { removalKind } from './destroy-guard.mjs';
import { countSecrets, redact, secretsFrom } from './redact.mjs';

/** GitHub refuses a comment or an issue body longer than 65,536 characters. */
export const MAX_BODY = 60000;
/** Found again on the next push, so the comment is updated in place instead of added. */
export const PR_MARKER = '<!-- terraform-plan-comment -->';
export const DRIFT_MARKER = '<!-- terraform-drift-issue -->';

const MAX_LISTED = 60;

/** One word for what a plan does to a resource, or null when it does nothing. */
export function actionWord(actions) {
  if (!Array.isArray(actions)) return null;
  const removal = removalKind(actions);
  if (removal) return removal;
  if (actions.includes('create')) return 'create';
  if (actions.includes('update')) return 'update';
  return null;
}

/** The dotted paths at which two JSON values differ, for telling what an update changes. */
export function changedPaths(before, after, prefix = '') {
  if (before === after) return [];
  const isObject = (value) => value !== null && typeof value === 'object';
  if (!isObject(before) || !isObject(after) || Array.isArray(before) !== Array.isArray(after)) {
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix || '.'];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const paths = [];
  for (const key of keys) {
    paths.push(...changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  return paths;
}

/**
 * What a plan does, as counts and lists. Reads addresses, actions, and for access grants the role
 * and the member. Nothing else from the plan's values.
 */
export function summarize(plan) {
  const changes = (Array.isArray(plan?.resource_changes) ? plan.resource_changes : []).filter(
    (change) => !change.mode || change.mode === 'managed',
  );
  const counts = { create: 0, update: 0, replace: 0, delete: 0, forget: 0 };
  const resources = [];
  const grants = [];
  const notes = [];
  for (const change of changes) {
    const word = actionWord(change.change?.actions);
    if (!word) continue;
    counts[word] += 1;
    resources.push({ address: change.address, action: word });

    // Who gets (or loses) which role. This is the part of a plan nobody is asked to approve, so
    // it is lifted out of the plan and put where it is hard to miss.
    if (/_iam_(member|binding|policy)$/.test(change.type)) {
      const side = word === 'delete' ? change.change.before : change.change.after;
      const hidden = word === 'delete' ? change.change.before_sensitive : change.change.after_sensitive;
      const shown = (key) => (hidden && hidden[key] === true ? '(sensitive)' : side?.[key]);
      const role = shown('role') ?? '(known after apply)';
      const members = shown('members') ?? shown('member') ?? '(known after apply)';
      grants.push({
        address: change.address,
        action: word,
        role: String(role),
        members: Array.isArray(members) ? members.map(String) : [String(members)],
      });
    }

    if (word === 'update') {
      const paths = changedPaths(change.change.before, change.change.after);
      const computed = Object.keys(change.change.after_unknown ?? {}).length > 0;
      // An update that only clears a Cloud Run revision's name: a deploy named the revision
      // (`gcloud run deploy --tag` or `--revision-suffix`). Applying it starts a new revision of
      // the service with the image that is live.
      if (change.type === 'google_cloud_run_v2_service' && paths.length > 0 && paths.every((path) => path === 'template.0.revision')) {
        notes.push(
          `\`${change.address}\`: the only change is clearing the revision's name. Something deployed this service with \`--tag\` or \`--revision-suffix\`; the deploy workflows do not. Applying it starts a new revision with the same image and settings.`,
        );
      }
      // An update in which no value differs: Terraform only starts, or stops, hiding a value.
      if (paths.length === 0 && !computed) {
        notes.push(`\`${change.address}\`: no value changes. Terraform only changes whether it hides one of them in its output.`);
      }
    }
  }
  return { counts, resources, grants, notes };
}

/** "3 to add, 1 to change, 0 to destroy", with replacements named when there are any. */
export function countsLine(counts) {
  const parts = [`${counts.create} to add`, `${counts.update} to change`, `${counts.delete} to destroy`];
  if (counts.replace > 0) parts.push(`${counts.replace} to replace (destroyed, then made again)`);
  if (counts.forget > 0) parts.push(`${counts.forget} to stop managing`);
  return parts.join(', ');
}

const ACTION_LABEL = { create: 'add', update: 'change', replace: 'REPLACE', delete: 'DESTROY', forget: 'stop managing' };

/** A fence longer than any run of backticks in the text, so the text cannot close it early. */
function fenceFor(text) {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/** "name=outcome,name=outcome" as a map. */
export function parseChecks(text) {
  const checks = {};
  for (const pair of (text ?? '').split(',')) {
    const [name, outcome] = pair.split('=');
    if (name && outcome) checks[name.trim()] = outcome.trim();
  }
  return checks;
}

/**
 * The comment or issue body.
 *
 * @param {object} input
 * @param {'pr'|'drift'|'apply'} input.mode  a pull request's comment, the drift issue, or an apply's summary
 * @param {object|null} input.plan       the plan as JSON, or null when the plan did not finish
 * @param {string} input.planText        `terraform show` of the plan, or the plan's error output
 * @param {object|null} input.guard      the destroy guard's verdict (its --json file)
 * @param {object} input.checks          outcome per step, "success" or anything else
 * @param {string} input.sha
 * @param {string} input.runUrl
 * @param {boolean} input.guardFilesChanged  the pull request touches the guard or its lists
 * @param {string[]} input.secrets
 */
export function buildBody(input) {
  const { mode, plan, planText = '', guard = null, checks = {}, sha = '', runUrl = '', guardFilesChanged = false } = input;
  const secrets = input.secrets ?? [];
  const short = sha.slice(0, 7);
  const lines = [mode === 'drift' ? DRIFT_MARKER : PR_MARKER];
  const failed = Object.entries(checks).filter(([, outcome]) => outcome !== 'success' && outcome !== 'skipped');
  const summary = plan ? summarize(plan) : null;
  const total = summary ? Object.values(summary.counts).reduce((sum, n) => sum + n, 0) : 0;

  if (mode === 'drift' && !summary) {
    lines.push('## The nightly check could not plan `main`', '');
    lines.push(
      `The nightly check tried to plan \`main\` (${short ? `\`${short}\`` : 'its latest commit'}) against the live project and Terraform stopped with an error.`,
      'This is not a report of drift: until the plan works again, nobody knows whether the project matches `main`.',
      '',
    );
  } else if (mode === 'drift') {
    lines.push('## The live project does not match `main`', '');
    lines.push(
      `The nightly check planned \`main\` (${short ? `\`${short}\`` : 'its latest commit'}) against the live project and the plan was not empty.`,
      'Either something was changed outside the pipeline (in the console, with `gcloud`, or by an apply from a laptop that was never committed), or a merge was not applied.',
      '',
    );
  } else if (mode === 'apply') {
    lines.push(`## Terraform apply of \`main\` at \`${short}\``, '');
  } else {
    lines.push(`## Terraform plan for \`${short}\``, '');
  }

  if (!summary) {
    lines.push('**The plan did not finish.** Nothing below is a plan: it is what Terraform said before it stopped.', '');
  } else if (total === 0) {
    lines.push('**No changes.** The live project already matches this code.', '');
  } else {
    lines.push(`**${countsLine(summary.counts)}.**`, '');
  }

  if (mode === 'pr') {
    const names = Object.keys(checks);
    if (names.length > 0) {
      lines.push(`Checks: ${names.map((name) => `${name} ${checks[name] === 'success' ? 'passed' : checks[name] === 'skipped' ? 'skipped' : '**FAILED**'}`).join(', ')}.`, '');
    }
  }

  if (guard) {
    const strict = guard.strict === true;
    if (guard.blocked?.length > 0) {
      lines.push('### The destroy guard would stop this', '');
      for (const { address, kind } of guard.blocked) lines.push(`- \`${address}\`: ${kind}, and it is on the protected list.`);
      lines.push(
        '',
        mode === 'pr'
          ? 'Merging this would not apply it: the apply stops before changing anything. If the removal is intended, name each address in `infra/expected-removals.txt` in this pull request.'
          : 'The pipeline will not apply this by itself.',
        '',
      );
    }
    if (guard.allowed?.length > 0) {
      lines.push('### Protected resources this plan removes on purpose', '');
      for (const { address, kind } of guard.allowed) lines.push(`- \`${address}\`: ${kind}, named in \`infra/expected-removals.txt\`.`);
      lines.push('');
    }
    if (guard.stale?.length > 0) {
      lines.push(`### Lines to delete from \`infra/expected-removals.txt\`${strict ? ' (this check fails until they are)' : ''}`, '');
      for (const address of guard.stale) lines.push(`- \`${address}\`: this plan does not remove it.`);
      lines.push('');
    }
  }

  if (guardFilesChanged) {
    lines.push(
      '> **This pull request changes the destroy guard itself** (`infra/scripts/destroy-guard.mjs`, `infra/protected-resources.txt` or `infra/expected-removals.txt`). The guard that runs on `main` after the merge is the changed one.',
      '',
    );
  }

  if (summary && summary.grants.length > 0) {
    lines.push('### Access this plan changes', '');
    lines.push('Nobody approves an apply, so read these: each is applied as soon as this merges.', '');
    for (const grant of summary.grants.slice(0, MAX_LISTED)) {
      const verb = grant.action === 'delete' ? 'removes' : grant.action === 'create' ? 'grants' : `${ACTION_LABEL[grant.action]}:`;
      lines.push(`- ${verb} \`${grant.role}\` ${grant.action === 'delete' ? 'from' : 'to'} ${grant.members.map((m) => `\`${m}\``).join(', ')} (\`${grant.address}\`)`);
    }
    if (summary.grants.length > MAX_LISTED) lines.push(`- and ${summary.grants.length - MAX_LISTED} more, in the plan below.`);
    lines.push('');
  }

  if (summary && summary.resources.length > 0) {
    lines.push('### What changes', '');
    for (const { address, action } of summary.resources.slice(0, MAX_LISTED)) lines.push(`- ${ACTION_LABEL[action]}: \`${address}\``);
    if (summary.resources.length > MAX_LISTED) lines.push(`- and ${summary.resources.length - MAX_LISTED} more, in the plan below.`);
    lines.push('');
  }

  if (summary) {
    for (const note of summary.notes) lines.push(`> ${note}`, '');
  }

  if (failed.length > 0 && mode === 'pr') {
    lines.push(`The step${failed.length > 1 ? 's' : ''} that failed: ${failed.map(([name]) => name).join(', ')}. ${runUrl ? `[The run's log](${runUrl}) has the details.` : ''}`, '');
  }

  const footer =
    mode === 'apply'
      ? [`This is the plan this run made on \`main\`, as \`terraform-applier\`, with the state lock held. Whether it was applied is this job's own result. ${runUrl ? `[This run](${runUrl}).` : ''}`]
      : mode === 'drift'
      ? [
          '### What to do',
          '',
          '- If the change in the project is wanted, put it in `infra/` in a pull request. Once it merges, this plan is empty.',
          '- If it is not wanted, run the pipeline again (Actions, Terraform, Run workflow on `main`): the apply puts the project back as `main` says.',
          '- If a merge was not applied, the Terraform run for it says why.',
          '',
          `This issue is updated each night while the plan is not empty, and closed by the first night it is. ${runUrl ? `[Tonight's run](${runUrl}).` : ''}`,
        ]
      : [
          `Planned read-only, as \`terraform-planner\`. Merging to \`main\` makes a new plan there, with the state lock held, and applies it with no approval. ${runUrl ? `[This run](${runUrl}).` : ''}`,
        ];

  // The plan itself, folded, and cut if the whole body would be too long for GitHub.
  const head = redact(lines.join('\n'), secrets);
  const tail = redact(footer.join('\n'), secrets);
  let text = redact(planText.replace(/\r/g, '').trimEnd(), secrets);
  const fence = fenceFor(text);
  const wrap = (body, note) =>
    `<details><summary>${summary ? 'The full plan' : 'What Terraform printed'}</summary>\n\n${fence}text\n${body}\n${fence}\n${note}\n</details>\n`;
  const budget = MAX_BODY - head.length - tail.length - wrap('', '').length - 400;
  let note = '';
  if (text.length > budget) {
    const allLines = text.split('\n');
    const kept = [];
    let size = 0;
    for (const line of allLines) {
      if (size + line.length + 1 > Math.max(budget, 0)) break;
      kept.push(line);
      size += line.length + 1;
    }
    text = kept.join('\n');
    note = `\nCut after ${kept.length} of ${allLines.length} lines to fit in a comment.${runUrl ? ` The whole plan is in [the run's log](${runUrl}).` : ''}\n`;
  }
  const body = `${head}\n${text ? wrap(text, note) : ''}\n${tail}\n`;

  const left = countSecrets(body, secrets);
  if (left > 0) throw new Error(`A personal value is still in the text after redaction (${left} time(s)). Refusing to write it.`);
  return body;
}

function main(argv) {
  const args = argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const read = (path) => {
    try {
      return path ? readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };
  const parse = (text) => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  };
  const mode = ['drift', 'apply'].includes(option('--mode')) ? option('--mode') : 'pr';
  const body = buildBody({
    mode,
    plan: parse(read(option('--plan-json'))),
    planText: read(option('--plan-text')) ?? '',
    guard: parse(read(option('--guard'))),
    checks: parseChecks(option('--checks')),
    sha: option('--sha') ?? '',
    runUrl: option('--run-url') ?? '',
    guardFilesChanged: option('--guard-files-changed') === 'true',
    secrets: secretsFrom(process.env),
  });
  const out = option('--out');
  if (out) writeFileSync(out, body);
  else process.stdout.write(body);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv));
  } catch (error) {
    console.error(`plan-comment: ${error.message}`);
    process.exit(1);
  }
}
