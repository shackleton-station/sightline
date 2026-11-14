// Watches the site through a Redis failover and prints what happened, second by second.
//
//   node scripts/failover-watch.mjs https://shackletonstation.dev              start this first...
//   gcloud redis instances failover clps-web-store --region us-east4           ...then this, in another terminal
//   (Ctrl-C, or --seconds 300, ends the watch and prints the summary)
//
//   node scripts/failover-watch.mjs http://localhost:8080 --seconds 120        on a laptop: `docker compose restart redis`
//
// It sends a steady, small stream of requests through the public address, each of which makes its
// service use Redis, and writes down for each one what a visitor would have seen:
//
//   every 2 s   web       GET  /api/status            its store state (redis, fallback, reconnecting)
//   every 2 s   web       POST /api/rooms/<no room>   a presenter's "I moved". Rooms have no fallback:
//                                                     404 with Redis, 503 "unavailable" without
//   every 2 s   plans     GET  /api/plans/status      its store state
//   every 2 s   plans     GET  /api/plans/<no plan>   a rate-limited read: 404 either way; the limit
//                                                     is counted in Redis, or in memory without it
//   every 2 s   co-pilot  GET  /api/chat/status       its store state, and where answers are kept
//   every 15 s  co-pilot  POST /api/chat              one set question, asked once before the watch
//                                                     starts so its answer is kept:
//                                                     x-cache hit with Redis. Without it the copy's
//                                                     memory answers: a miss once per copy (one model
//                                                     call each), then hits from that copy
//
// Nothing here writes anything a visitor could see. The limits it counts against are its own
// address's: 4 questions a minute, and one more at the start (the limit is 6), 30 plan reads (60),
// 30 room moves (90), and at the edge firewall 60 requests a minute to the web server's API paths,
// 60 to plans' and 34 to the co-pilot's (120 each). The question asked at the start costs one model
// call if its answer was not kept already; during the failover, at most one more per copy of the
// co-pilot.
//
// The status of a service is one copy's view: with several copies, two requests may reach two
// copies that noticed at different moments. That is real, and the timeline shows it.
const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : fallback
}
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/failover-watch.mjs <site URL> [--seconds <how long, default until Ctrl-C>] [--every <seconds between rounds, default 2>] [--no-question]')
  process.exit(2)
}
const everyMs = Number(flag('--every', '2')) * 1000
const forMs = flag('--seconds') ? Number(flag('--seconds')) * 1000 : Number.POSITIVE_INFINITY
const askQuestions = !process.argv.includes('--no-question')
const QUESTION_EVERY_MS = 15_000
const TIMEOUT_MS = 20_000
// The first of the set questions (chat-eval.mjs), so its answer is usually kept already.
const QUESTION = { messages: [{ role: 'user', text: 'How much sunlight does Connecting Ridge get in May 2027?' }], view: '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn' }
// Ids of the right shape that are not a room's or a plan's: ids are random, six and eight letters
// from 31, so the chance that one of these exists is under one in a hundred million.
const NO_ROOM = 'zzzzz2'
const NO_PLAN = 'zzzzzzz2'

const clock = () => `${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s`
const stamp = () => new Date().toISOString().slice(11, 23)

/** One request: its status, how long it took, a header or two, and its JSON body if it had one. */
async function call(path, init = {}) {
  const began = Date.now()
  try {
    const response = await fetch(`${base}${path}`, { ...init, headers: { origin: base, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await response.json().catch(() => null)
    return { status: response.status, ms: Date.now() - began, cache: response.headers.get('x-cache'), body }
  } catch (error) {
    return { status: 0, ms: Date.now() - began, cache: null, body: null, error: error instanceof Error ? error.name : String(error) }
  }
}

/** What each probe's answer means for a visitor: `ok` (as on a normal day), `degraded` (answered, from memory), `failed`. */
const PROBES = [
  {
    name: 'web status',
    run: () => call('/api/status'),
    read: (got) => ({ state: got.body?.redis?.state ?? '?', seen: got.status === 200 ? 'ok' : 'failed', note: got.body?.redis ? `rooms on ${got.body.follow?.rooms ?? 'off'}` : 'no redis field: a version from before Phase 4' }),
  },
  {
    name: 'web rooms',
    run: () => call(`/api/rooms/${NO_ROOM}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-presenter-key': 'failover-watch' }, body: JSON.stringify({ at: { path: '/', hash: '' } }) }),
    // 404: Redis was asked and has no such room. 503: Redis could not be asked, and a presenter's page says "reconnecting".
    read: (got) => ({ state: got.status === 404 ? 'redis' : got.status === 503 ? 'down' : '?', seen: got.status === 404 ? 'ok' : 'failed', note: got.status === 503 ? 'Follow the presenter is unavailable' : got.status === 429 ? 'this address is over its limit' : '' }),
  },
  {
    name: 'plans status',
    run: () => call('/api/plans/status'),
    read: (got) => ({ state: got.body?.redis?.state ?? '?', seen: got.status === 200 ? 'ok' : 'failed', note: '' }),
  },
  {
    name: 'plans read',
    run: () => call(`/api/plans/${NO_PLAN}`),
    read: (got) => ({ state: '', seen: got.status === 404 ? 'ok' : 'failed', note: got.status === 429 ? 'this address is over its limit' : '' }),
  },
  {
    name: 'copilot status',
    run: () => call('/api/chat/status'),
    read: (got) => ({ state: got.body?.redis?.state ?? '?', seen: got.status === 200 ? 'ok' : 'failed', note: got.body?.redis ? `answers on ${got.body.answers}, read endpoint ${got.body.redis.readEndpoint}, breaker on ${got.body.breakerStore}` : '' }),
  },
]
const QUESTION_PROBE = {
  name: 'copilot question',
  run: () => call('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(QUESTION) }),
  // A hit is a normal day. A miss that still answers is what a visitor gets while the cache cannot be read: slower, and a model call.
  read: (got) => ({ state: '', seen: got.status !== 200 ? 'failed' : got.cache === 'hit' ? 'ok' : 'degraded', note: got.status === 200 ? `x-cache ${got.cache}` : `${got.body?.error ?? got.error ?? ''}${got.body?.retryAfterSeconds ? `, retry after ${got.body.retryAfterSeconds} s` : ''}` }),
}

const rows = []
/** Per probe: the last thing printed, so a line appears only when something changes. */
const last = new Map()
function record(probe, got) {
  const read = probe.read(got)
  const row = { at: Date.now() - started, probe: probe.name, status: got.status, ms: got.ms, ...read }
  rows.push(row)
  const said = `${row.status} ${row.state} ${row.seen} ${row.note}`
  if (last.get(probe.name) !== said || probe === QUESTION_PROBE) {
    last.set(probe.name, said)
    const status = got.status === 0 ? `no answer (${got.error})` : `HTTP ${got.status}`
    console.log(`${stamp()} ${clock()}  ${probe.name.padEnd(17)} ${status.padEnd(26)} ${String(got.ms).padStart(5)} ms  ${row.state.padEnd(13)} ${row.seen.padEnd(9)} ${row.note}`)
  }
}

if (askQuestions) {
  // Asked once before the watch starts, so the watch's own questions find the answer kept.
  const primed = await QUESTION_PROBE.run()
  console.log(`Before the watch: the set question answered HTTP ${primed.status} in ${primed.ms} ms, x-cache ${primed.cache ?? 'none'}${primed.cache === 'miss' ? ' (now kept)' : ''}.`)
}
const started = Date.now()
console.log(`Watching ${base}. A line is printed when a probe's answer changes, and for every question. Ctrl-C for the summary.`)
console.log(`${'UTC'.padEnd(12)} ${'elapsed'.padStart(8)}  ${'probe'.padEnd(17)} ${'answer'.padEnd(26)} ${'time'.padStart(8)}  ${'store state'.padEnd(13)} ${'visitor'.padEnd(9)} note`)

let stopping = false
let lastQuestion = Number.NEGATIVE_INFINITY
const inFlight = new Set()
const send = (probe) => {
  const work = probe.run().then((got) => record(probe, got))
  inFlight.add(work)
  void work.finally(() => inFlight.delete(work))
}
const round = () => {
  if (stopping) return
  for (const probe of PROBES) send(probe)
  if (askQuestions && Date.now() - lastQuestion >= QUESTION_EVERY_MS) {
    lastQuestion = Date.now()
    send(QUESTION_PROBE)
  }
  if (Date.now() - started >= forMs) void finish()
}

async function finish() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await Promise.all(inFlight)
  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`
  console.log(`\nSummary, ${seconds(Date.now() - started)} watched, ${rows.length} requests`)
  for (const name of [...PROBES, QUESTION_PROBE].map((probe) => probe.name)) {
    const mine = rows.filter((row) => row.probe === name)
    if (mine.length === 0) continue
    const count = (seen) => mine.filter((row) => row.seen === seen).length
    const notOk = mine.filter((row) => row.seen !== 'ok' || (row.state && row.state !== 'redis'))
    const window = notOk.length > 0 ? `not normal from ${seconds(notOk[0].at)} to ${seconds(notOk.at(-1).at)} (${seconds(notOk.at(-1).at - notOk[0].at + everyMs)} at most)` : 'normal throughout'
    const slowest = Math.max(...mine.map((row) => row.ms))
    console.log(`  ${name.padEnd(17)} ${String(mine.length).padStart(4)} sent: ${count('ok')} ok, ${count('degraded')} answered from memory, ${count('failed')} failed; slowest ${slowest} ms; ${window}`)
  }
  const states = rows.filter((row) => row.state && row.state !== '?' && row.probe.endsWith('status'))
  const off = states.filter((row) => row.state !== 'redis')
  if (off.length > 0) {
    const back = states.filter((row) => row.at > off.at(-1).at)
    console.log(`  Every service reported "redis" again from ${back.length > 0 ? seconds(back[0].at) : 'after the watch ended'}; the first report of anything else was at ${seconds(off[0].at)}.`)
  } else {
    console.log('  No service reported anything but "redis".')
  }
  process.exit(0)
}

process.on('SIGINT', () => void finish())
const timer = setInterval(round, everyMs)
round()
