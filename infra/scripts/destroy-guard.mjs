// The destroy guard: what stands in for a reviewer now that nobody clicks "approve".
//
// It reads a saved plan as JSON (`terraform show -json tfplan`) and stops the apply when the plan
// would delete or replace anything on the protected list (infra/protected-resources.txt), unless
// the same commit names that resource's address in infra/expected-removals.txt.
//
//   node infra/scripts/destroy-guard.mjs infra/tfplan.json            # on main, before the apply
//   node infra/scripts/destroy-guard.mjs infra/tfplan.json --strict   # on a pull request
//
// --strict also fails on a line in expected-removals.txt that the plan does not use. That is what
// makes a line good for one removal only: the pull request after the removal has to delete it. On
// main it is only a warning, because an apply that is run again after it removed the resource
// must still be able to finish.
//
// Exit status: 0 the apply may go ahead, 1 it must not, 2 the guard could not read its input.
//
// It prints addresses and actions only, never a value from the plan: the plan's JSON holds every
// setting in clear, including the ones Terraform hides in its text output.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROTECTED_FILE = join(HERE, '..', 'protected-resources.txt');
export const EXPECTED_FILE = join(HERE, '..', 'expected-removals.txt');

/** The lines of a list file that are not blank or comments, with any trailing comment removed. */
export function parseList(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/**
 * Does a protected pattern cover this resource? A pattern is "<type>.<name>", where <name> may be
 * "*" for every resource of that type. It is compared with the resource's own type and name, so a
 * resource inside a module, or one of several made with count or for_each, is covered too.
 */
export function isProtected(change, patterns) {
  return patterns.some((pattern) => {
    const dot = pattern.indexOf('.');
    const type = dot === -1 ? pattern : pattern.slice(0, dot);
    const name = dot === -1 ? '*' : pattern.slice(dot + 1);
    return change.type === type && (name === '*' || name === change.name);
  });
}

/** What a plan does to a resource, in the guard's words, or null when it removes nothing. */
export function removalKind(actions) {
  if (!Array.isArray(actions)) return null;
  if (actions.includes('delete') && actions.includes('create')) return 'replace';
  if (actions.includes('delete')) return 'delete';
  // "forget": Terraform stops managing the resource and leaves it in the project. Nothing is
  // destroyed, but nothing guards it afterwards either, so it needs the same permission.
  if (actions.includes('forget')) return 'forget';
  return null;
}

/**
 * The guard's verdict on a plan.
 *
 * @param {object} plan      the plan as JSON
 * @param {string[]} patterns  the protected list
 * @param {string[]} expected  resource addresses this commit expects to remove
 * @returns {{ blocked: {address: string, kind: string}[], allowed: {address: string, kind: string}[],
 *             stale: string[], removals: number }}
 */
export function checkPlan(plan, patterns, expected) {
  if (!plan || typeof plan !== 'object' || typeof plan.format_version !== 'string') {
    throw new Error('This is not a Terraform plan in JSON (no format_version).');
  }
  if (plan.errored === true) {
    throw new Error('The plan did not finish (errored: true). Nothing may be applied from it.');
  }
  const changes = Array.isArray(plan.resource_changes) ? plan.resource_changes : [];
  const blocked = [];
  const allowed = [];
  const used = new Set();
  let removals = 0;
  for (const change of changes) {
    if (change.mode && change.mode !== 'managed') continue;
    const kind = removalKind(change.change?.actions);
    if (!kind) continue;
    removals += 1;
    if (!isProtected(change, patterns)) continue;
    // A leftover copy from a replacement that made the new one first (a "deposed" object) is the
    // same resource as far as the guard is concerned.
    const entry = { address: change.address, kind };
    if (expected.includes(change.address)) {
      used.add(change.address);
      allowed.push(entry);
    } else {
      blocked.push(entry);
    }
  }
  const stale = expected.filter((address) => !used.has(address));
  return { blocked, allowed, stale, removals };
}

const KIND_WORDS = { delete: 'deletes', replace: 'replaces (deletes, then makes again)', forget: 'stops managing' };

/** The verdict as lines for a log or a comment. No values, only addresses. */
export function describe(result, { strict = false } = {}) {
  const lines = [];
  for (const { address, kind } of result.blocked) {
    lines.push(`STOPPED: the plan ${KIND_WORDS[kind]} ${address}, which is on the protected list.`);
  }
  for (const { address, kind } of result.allowed) {
    lines.push(`Allowed: the plan ${KIND_WORDS[kind]} ${address}, and infra/expected-removals.txt names it.`);
  }
  for (const address of result.stale) {
    lines.push(
      `${strict ? 'STOPPED' : 'Warning'}: infra/expected-removals.txt names ${address}, but this plan does not remove it. Delete that line.`,
    );
  }
  if (result.blocked.length > 0) {
    lines.push(
      'If a removal is intended, add the address on a line of its own to infra/expected-removals.txt in the same pull request, with a comment saying why.',
    );
  }
  if (lines.length === 0) {
    lines.push(
      result.removals === 0
        ? 'The plan deletes nothing.'
        : `The plan deletes or replaces ${result.removals} resource(s), none of them on the protected list.`,
    );
  }
  return lines;
}

/** May the apply go ahead? */
export function passes(result, { strict = false } = {}) {
  return result.blocked.length === 0 && (!strict || result.stale.length === 0);
}

function main(argv) {
  const args = argv.slice(2);
  const planPath = args.find((arg) => !arg.startsWith('--'));
  const strict = args.includes('--strict');
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  if (!planPath) {
    console.error('usage: destroy-guard.mjs <plan.json> [--strict] [--protected <file>] [--expected <file>] [--json <file>]');
    return 2;
  }
  let result;
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    const patterns = parseList(readFileSync(option('--protected') ?? PROTECTED_FILE, 'utf8'));
    if (patterns.length === 0) throw new Error('The protected list is empty. The guard refuses to run with nothing to guard.');
    const expected = parseList(readFileSync(option('--expected') ?? EXPECTED_FILE, 'utf8'));
    result = checkPlan(plan, patterns, expected);
  } catch (error) {
    console.error(`The destroy guard could not run: ${error.message}`);
    return 2;
  }
  const ok = passes(result, { strict });
  for (const line of describe(result, { strict })) console.log(line);
  const jsonPath = option('--json');
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ ...result, strict, ok }, null, 2));
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv));
}
