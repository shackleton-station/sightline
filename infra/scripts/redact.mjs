// Keeps the two personal settings out of anything a workflow prints or posts.
//
// billing_account and alert_email are not credentials, but they are personal. Terraform hides a
// sensitive variable where it is used as a value, yet the billing account id is also part of the
// budget's own id ("billingAccounts/<id>/budgets/..."), which Terraform prints on every refresh and
// whenever the budget changes. So every text that leaves a job goes through here first.
//
//   terraform plan ... 2>&1 | node infra/scripts/redact.mjs
//
// The values are read from the environment (TF_VAR_billing_account, TF_VAR_alert_email), where the
// workflow puts them from the repository's Actions secrets. They are never arguments, so they
// never show in a process list or a log line.

import { pathToFileURL } from 'node:url';

export const HIDDEN = '(hidden)';

/** The personal values present in an environment, longest first, empty ones left out. */
export function secretsFrom(env) {
  return [env.TF_VAR_billing_account, env.TF_VAR_alert_email]
    .filter((value) => typeof value === 'string' && value.trim().length >= 4)
    .map((value) => value.trim())
    .sort((a, b) => b.length - a.length);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `text` with every occurrence of every secret, in any letter case, replaced by "(hidden)". */
export function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), 'gi'), HIDDEN);
    // The same value as it appears inside a URL.
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) out = out.replace(new RegExp(escapeRegExp(encoded), 'gi'), HIDDEN);
  }
  return out;
}

/** How many times any secret still occurs in `text`. Used to prove a text is clean before it is posted. */
export function countSecrets(text, secrets) {
  let count = 0;
  const lower = text.toLowerCase();
  for (const secret of secrets) {
    const needle = secret.toLowerCase();
    let at = lower.indexOf(needle);
    while (at !== -1) {
      count += 1;
      at = lower.indexOf(needle, at + needle.length);
    }
  }
  return count;
}

async function main() {
  const secrets = secretsFrom(process.env);
  process.stdin.setEncoding('utf8');
  // Line by line, so a long apply shows its progress as it goes.
  let pending = '';
  for await (const chunk of process.stdin) {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) process.stdout.write(`${redact(line, secrets)}\n`);
  }
  if (pending) process.stdout.write(redact(pending, secrets));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
