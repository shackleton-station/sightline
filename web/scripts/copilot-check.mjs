// Checks a deployed co-pilot service on an address of its own:
//
//   node scripts/copilot-check.mjs https://lunarsightline.com --canary copilot --version abc1234 --data-version 0123456789abcdef --code-version fedcba9876543210 --cloud --stream
//   node scripts/copilot-check.mjs https://lunarsightline.com --version abc1234 --stream     (the live version, through the load balancer)
//   node scripts/copilot-check.mjs http://localhost:8083 --stream                              (on a laptop)
//
// --canary copilot sends every request with the header x-clps-canary: copilot, which the load
// balancer sends to the version tagged canary: the one a deploy is testing (scripts/canary-header.mjs).
// Since Phase 6 the service's own run.app address refuses requests from the internet.
//
// This is what "test the new version before it takes visitors" means for the co-pilot service. The
// two set questions (chat-eval.mjs --quick) are the other half, and run after this in the deploy.
//   1. Its status address answers, as the co-pilot service, with the commit, the data version and
//      the code version this deploy built (--version, --data-version, --code-version).
//   2. With --cloud: Claude answers (not a stand-in, no faults injected), with its model, speed,
//      effort and fallbacks named and signed in by workload identity federation (no stored key);
//      rate limits and the circuit breaker are where the project's settings say (Redis, shared by
//      every copy, or the copy's own memory when infra/settings.auto.tfvars has shared_store = false;
//      --store redis|memory says it outright: scripts/shared-store.mjs), questions are logged and
//      traces sent.
//   3. The API's refusals, which call no model: another site, a malformed question, another method.
//      None of them counts against a limit: a malformed question is read and refused before it is
//      counted. --stream does count, as one question.
//   4. With --stream: one question with the lookups streamed as they happen. One model call, unless
//      the answer was kept.
// Exits non-zero if anything is wrong, so a deploy can stop on it.
import { sendToCanary } from './canary-header.mjs'
import { checkCopilotReadOnly, checkCopilotStream, whoAnswersCopilot } from './copilot-checks.mjs'
import { expectedStore } from './shared-store.mjs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const has = (name) => process.argv.includes(name)
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/copilot-check.mjs <site or co-pilot service URL> [--canary copilot] [--version <commit>] [--data-version <hash>] [--code-version <hash>] [--cloud] [--store redis|memory] [--stream]')
  process.exit(2)
}
sendToCanary(process.argv, base)

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

// 1. What is running. A copy that has just started may not have its Redis connection yet, so with
//    --cloud the status is asked for again, a few times, before "unreachable" is believed.
let who = await whoAnswersCopilot(base)
for (let attempt = 0; has('--cloud') && who.by === 'copilot' && who.status.limits === 'redis-unreachable' && attempt < 3; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  who = await whoAnswersCopilot(base)
}
check('the co-pilot service answers its status here', who.by === 'copilot', who.by === 'copilot' ? `version ${who.status.version}, revision ${who.status.revision}` : who.by === 'web' ? 'only the web server is at this address, and it has no co-pilot' : `HTTP ${who.code}`)
if (who.by === 'copilot') {
  const { status } = who
  const expect = (name, field, value) => value && check(name, status[field] === value, `${status[field]}, expected ${value}`)
  expect('runs the commit this deploy built', 'version', flag('--version'))
  expect('carries the site data of this commit', 'dataVersion', flag('--data-version'))
  expect('keys kept answers by the co-pilot code of this commit', 'codeVersion', flag('--code-version'))

  // 2. Everything a copy in the cloud must have switched on.
  if (has('--cloud')) {
    check('answers with Claude, with no faults injected', status.model === 'claude', `${status.model}`)
    const settings = status.modelSettings ?? {}
    check('names the Claude model, its speed and effort, with fallbacks on', typeof settings.model === 'string' && settings.model.startsWith('claude-') && typeof settings.effort === 'string' && settings.fallbacks === 'default' && 'speed' in settings, JSON.stringify(status.modelSettings ?? null))
    check('signs in by workload identity federation, with no stored key', settings.auth === 'federation', `${settings.auth ?? 'none'}`)
    const store = expectedStore(process.argv)
    const inMemory = "in its own memory, as the project's settings say (no Redis)"
    check(store === 'redis' ? 'counts rate limits and keeps answers in Redis, shared by every copy' : `counts rate limits and keeps answers ${inMemory}`, status.limits === store, `${status.limits}`)
    check(store === 'redis' ? 'keeps the circuit breaker in Redis, so every copy agrees' : `keeps the circuit breaker ${inMemory}`, status.breakerStore === store, `${status.breakerStore}`)
    check('logs each question', status.questionLog === true, `${status.questionLog}`)
    check('sends traces', status.tracing === true, `${status.tracing}`)
  }

  // 3 and 4. The API itself.
  await checkCopilotReadOnly(base, check, { malformed: true })
  if (has('--stream')) await checkCopilotStream(base, check)
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
process.exit(failed ? 1 : 0)
