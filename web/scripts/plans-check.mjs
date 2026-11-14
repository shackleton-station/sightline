// Checks a deployed plans service on an address of its own:
//
//   node scripts/plans-check.mjs https://shackletonstation.dev --canary plans --version abc1234 --data-version 0123456789abcdef --cloud --save
//   node scripts/plans-check.mjs https://shackletonstation.dev --version abc1234          (the live version, through the load balancer)
//   node scripts/plans-check.mjs http://localhost:8082                                     (on a laptop)
//
// --canary plans sends every request with the header x-clps-canary: plans, which the load balancer
// sends to the version tagged canary: the one a deploy is testing (scripts/canary-header.mjs). Since
// Phase 6 the service's own run.app address refuses requests from the internet.
//
// This is what "test the new version before it takes visitors" means for the plans service:
//   1. Its status address answers, as the plans service, with the commit and the data version this
//      deploy built (--version, --data-version).
//   2. With --cloud: it keeps plans in Firestore, counts rate limits in Redis, checks sign-in and
//      sends traces. A copy that started without one of these would still answer, and be wrong.
//      With --site <the site's URL>, sign-in must be on exactly when the site offers it.
//   3. The API answers as the written contract says, without changing anything: an impossible plan
//      is 404 (one real read of the database), the list needs sign-in, another site is refused.
//   4. With --save: one real plan is saved with an idempotency key, sent again, and opened. This is
//      the real write path with the service's real permissions. It leaves one plan with no owner,
//      which the database removes 180 days later (see plans-checks.mjs).
// Exits non-zero if anything is wrong, so a deploy can stop on it.
import { sendToCanary } from './canary-header.mjs'
import { checkPlansReadOnly, checkPlansSave, whoAnswersPlans } from './plans-checks.mjs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const has = (name) => process.argv.includes(name)
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/plans-check.mjs <site or plans service URL> [--canary plans] [--version <commit>] [--data-version <hash>] [--cloud] [--site <site URL>] [--save]')
  process.exit(2)
}
// Only /api/plans paths go to the canary with this header; the site's own /api/status (--site) is
// answered by the live web server, as it is for a visitor.
sendToCanary(process.argv, base)

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

// 1. What is running. A copy that has just started may not have its Redis connection yet, so with
//    --cloud the status is asked for again, a few times, before "unreachable" is believed.
let who = await whoAnswersPlans(base)
for (let attempt = 0; has('--cloud') && who.by === 'plans' && who.status.limits === 'redis-unreachable' && attempt < 3; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  who = await whoAnswersPlans(base)
}
check('the plans service answers its status here', who.by === 'plans', who.by === 'plans' ? `version ${who.status.version}, revision ${who.status.revision}` : who.by === 'web' ? 'only the web server is at this address, and it has no plans API' : `HTTP ${who.code}`)
if (who.by === 'plans') {
  const { status } = who
  const version = flag('--version')
  if (version) check('runs the commit this deploy built', status.version === version, `${status.version}, expected ${version}`)
  const dataVersion = flag('--data-version')
  if (dataVersion) check('carries the site data of this commit', status.dataVersion === dataVersion, `${status.dataVersion}, expected ${dataVersion}`)

  // 2. Everything a copy in the cloud must have switched on.
  if (has('--cloud')) {
    check('keeps plans in Firestore', status.store === 'firestore', `${status.store}`)
    check('counts rate limits in Redis, shared by every copy', status.limits === 'redis', `${status.limits}`)
    // Sign-in is optional for the site as a whole. What must never happen is the two disagreeing: the
    // page would offer sign-in and the service would refuse every token, or the other way round.
    const site = flag('--site')
    if (site) {
      const siteStatus = await fetch(`${site.replace(/\/$/, '')}/api/status`, { signal: AbortSignal.timeout(15_000) })
        .then((response) => response.json())
        .catch(() => ({}))
      const siteSignsIn = typeof siteStatus.signIn === 'string'
      check(`sign-in with Google is ${siteSignsIn ? 'on' : 'off'}, as it is for the site`, status.signIn === siteSignsIn, `plans ${status.signIn}, the site ${siteSignsIn}`)
    } else {
      check('checks sign-in with Google', status.signIn === true, `${status.signIn}`)
    }
    check('sends traces', status.tracing === true, `${status.tracing}`)
  }

  // 3 and 4. The API itself.
  await checkPlansReadOnly(base, check)
  if (has('--save')) await checkPlansSave(base, check, flag('--version') ?? 'by hand')
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
process.exit(failed ? 1 : 0)
