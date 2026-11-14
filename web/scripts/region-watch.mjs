// Which region answers, second by second, through the site's public address (Phase 8, the failover
// drill: docs/ARCHITECTURE_PHASE_8.md).
//
//   node scripts/region-watch.mjs https://shackletonstation.dev                 until Ctrl-C, then a summary
//   node scripts/region-watch.mjs https://shackletonstation.dev --seconds 600   ten minutes
//   node scripts/region-watch.mjs https://shackletonstation.dev --seconds 30 --fail-on-error   (a deploy's check)
//
// Every second (--every) it asks the three status addresses at once, as a visitor would, with no header:
//
//   web       GET /api/status
//   plans     GET /api/plans/status
//   co-pilot  GET /api/chat/status
//
// Each answer names the region of the copy that gave it (`region`, shared/region.ts), and so does the
// drill's 503. The load balancer sends a request to the nearest region whose copies it has not set aside,
// so from one place the watch normally sees one region, and during the drill sees the switch.
//
// One line per round, and a line whenever a service's region changes or it fails. At the end, per
// service: how many answers came from each region, how many failed, when the region switched, and how
// long after the first failure another region answered (scripts/region-timeline.mjs).
//
// Nothing here writes anything, calls the model or counts against a visitor's limit: the status
// addresses have no limits of their own. At the edge firewall it is 60 requests a minute to each of the
// three backends' API paths (the limit is 120 per backend), at the default --every 1.
import { describeStory, failed, regionOf, serviceStory, STATUS_PATHS } from './region-timeline.mjs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : fallback
}
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/region-watch.mjs <site URL> [--seconds <how long, default until Ctrl-C>] [--every <seconds between rounds, default 1>] [--fail-on-error] [--quiet]')
  process.exit(2)
}
const everyMs = Number(flag('--every', '1')) * 1000
const forMs = flag('--seconds') ? Number(flag('--seconds')) * 1000 : Number.POSITIVE_INFINITY
const failOnError = process.argv.includes('--fail-on-error')
const quiet = process.argv.includes('--quiet')
const TIMEOUT_MS = 10_000

const started = Date.now()
const samples = { web: [], plans: [], copilot: [] }
const last = {}

/** One status request: when, its status, the region it named, how long it took. */
async function ask(service) {
  const t = (Date.now() - started) / 1000
  const began = Date.now()
  try {
    const response = await fetch(`${base}${STATUS_PATHS[service]}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'cache-control': 'no-cache' } })
    let body = null
    try {
      body = JSON.parse(await response.text())
    } catch {
      // Not JSON: a page from the load balancer itself, for instance. The region stays unknown.
    }
    return { t, code: response.status, region: regionOf(body), drill: body?.drill === 'unavailable', ms: Date.now() - began, revision: body?.revision ?? null }
  } catch (error) {
    return { t, code: 0, region: 'unknown', drill: false, ms: Date.now() - began, revision: null, why: error instanceof Error ? error.message : String(error) }
  }
}

const show = (s) => `${s.code || 'none'} ${s.region}${s.drill ? ' (drill)' : ''} ${String(s.ms).padStart(4)} ms`

async function round() {
  const answers = await Promise.all(Object.keys(STATUS_PATHS).map(async (service) => [service, await ask(service)]))
  const notes = []
  for (const [service, sample] of answers) {
    samples[service].push(sample)
    const before = last[service]
    if (failed(sample)) notes.push(`${service} FAILED (${sample.code || sample.why})`)
    else if (before && before.region !== sample.region) notes.push(`${service} now answers from ${sample.region} (was ${before.region})`)
    if (!failed(sample)) last[service] = sample
  }
  const t = answers[0][1].t.toFixed(1).padStart(7)
  if (!quiet || notes.length) console.log(`${t} s  ${answers.map(([service, s]) => `${service} ${show(s)}`).join(' | ')}${notes.length ? `   <- ${notes.join('; ')}` : ''}`)
}

function summary() {
  console.log(`\nWatched ${base} for ${((Date.now() - started) / 1000).toFixed(0)} s, a round every ${everyMs / 1000} s.`)
  let anyFailed = false
  for (const [service, list] of Object.entries(samples)) {
    const story = serviceStory(list)
    if (story.failures.total) anyFailed = true
    console.log(describeStory(service, story))
  }
  if (failOnError && anyFailed) {
    console.log('A status address failed while it was watched.')
    process.exitCode = 1
  }
}

let stopping = false
process.on('SIGINT', () => {
  stopping = true
})

while (!stopping && Date.now() - started < forMs) {
  const roundStarted = Date.now()
  await round()
  const wait = everyMs - (Date.now() - roundStarted)
  if (wait > 0 && !stopping) await new Promise((resolve) => setTimeout(resolve, wait))
}
summary()
