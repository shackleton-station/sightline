// Watches a new version of a service while it takes a share of the visitors:
//   node scripts/canary.mjs <site URL> <site URL> --canary <web|plans|copilot> [--seconds 60]
// Every few seconds it asks for a page, the site data and the API's status twice: once as a visitor
// (no header: the live split, a tenth of which is the new version) and once with the canary header
// (the new version alone, through the load balancer: scripts/canary-header.mjs). Any server error or
// dropped connection fails the run, and the deploy goes back.
//
// Two different addresses with no --canary also work (two copies on a laptop, or a version's own
// run.app address while those were still open, before Phase 6).
//
// Another service names its own paths (the plans and co-pilot deploys do):
//   --paths /api/plans/status,/api/plans/zzzzzzzz   what to ask for, comma-separated
//   --status-path /api/plans/status                 which of them reports the revision that answered
//
// Why make our own traffic: a demo site sees too few visitors in a minute for their errors to
// mean anything. A busy site would read its real error rate from monitoring here instead.
import { watchTargets } from './canary-header.mjs'

const option = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const targets = watchTargets(process.argv)
const seconds = Number(option('--seconds') ?? 60)
if (!targets || !(seconds > 0)) {
  console.error('Usage: node scripts/canary.mjs <site URL> <new version URL, or the site URL again> [--canary web|plans|copilot] [--seconds 60] [--paths a,b] [--status-path a]')
  process.exit(2)
}
const [live, next] = targets

const STATUS_PATH = option('--status-path') ?? '/api/status'
const PATHS = option('--paths')?.split(',') ?? ['/', '/data/sites.json', STATUS_PATH]
const EVERY_MS = 3000
const tally = new Map(targets.map((target) => [target, { ok: 0, bad: [] }]))
const revisions = new Map()
let newRevision = null

async function ask(target, path) {
  const counts = tally.get(target)
  try {
    const response = await fetch(target.base + path, { headers: target.headers, signal: AbortSignal.timeout(10_000) })
    const text = await response.text()
    if (response.status >= 500) return counts.bad.push(`${path}: HTTP ${response.status}`)
    counts.ok++
    if (path !== STATUS_PATH) return
    // An answer that is not JSON has no revision to report; it still counted as answered above.
    let revision = 'unknown'
    try {
      revision = JSON.parse(text).revision ?? 'unknown'
    } catch {}
    if (target === next) newRevision = revision
    else revisions.set(revision, (revisions.get(revision) ?? 0) + 1)
  } catch (error) {
    counts.bad.push(`${path}: ${error instanceof Error ? error.message : error}`)
  }
}

const failures = () => [...tally.values()].reduce((sum, { bad }) => sum + bad.length, 0)
const until = Date.now() + seconds * 1000
while (Date.now() < until) {
  await Promise.all(targets.flatMap((target) => PATHS.map((path) => ask(target, path))))
  // No point watching on once something has failed.
  if (failures() > 0) break
  await new Promise((resolve) => setTimeout(resolve, EVERY_MS))
}

for (const [target, { ok, bad }] of tally) {
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${target.name}, ${target.base}: ${ok} answered, ${bad.length} failed`)
  for (const line of bad.slice(0, 5)) console.log(`       ${line}`)
}
const fromNew = revisions.get(newRevision) ?? 0
const total = [...revisions.values()].reduce((sum, count) => sum + count, 0)
console.log(`The new version (${newRevision ?? 'unknown'}) answered ${fromNew} of ${total} status checks sent as a visitor (${live.base}).`)

const failed = failures()
console.log(failed ? 'The new version is not safe to roll out.' : 'Both versions stayed healthy.')
process.exit(failed ? 1 : 0)
