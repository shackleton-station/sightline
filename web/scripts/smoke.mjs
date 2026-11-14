// Checks a running copy of the site end to end: `node scripts/smoke.mjs https://…`.
// Exits non-zero when anything is wrong, so a deploy can stop on it.
//
// What "the site" is depends on the address. The web server serves the pages, the site data, tiles,
// video, voice, rooms and its own status. The plans API and the co-pilot are their own services,
// which the load balancer sends their paths to (and on one machine, the web server passes them on).
// So at the site's public address, or a Compose or `npm run dev:server` address, everything is
// there. At the web server's own address (its run.app URL, which only callers inside Google's
// network reach since Phase 6) only the web server is, and it answers 404 for /api/plans, /api/chat
// and /api/ask. The run says which it found.
//   --canary web        send every request with the header x-clps-canary: web, so the load
//                       balancer sends the web server's paths to its version tagged canary (the
//                       version a deploy is testing). The plans and co-pilot paths, and tiles and
//                       video once they come from the bucket, are answered as for any visitor
//                       (scripts/canary-header.mjs)
//   --plans-service     fail unless the plans service answers /api/plans at this address
//   --copilot-service   fail unless the co-pilot service answers /api/chat and /api/ask at this address
//   --save-plan         also save one real plan, send the same save again, and open it
//   --stream            also ask one streamed question (one model call, unless the answer was kept)
//   --ask               also ask one typed question (one model call)
//   --data-may-differ   report, and do not fail on, a service carrying other site data than the web
//                       server. Only the web server's own deploy passes it: its new data goes live
//                       first, and the services' deploys of the same commit wait for that
// Without --stream and --ask, no model is called.
import { sendToCanary } from './canary-header.mjs'
import { checkCopilotReadOnly, checkCopilotStream, whoAnswersCopilot } from './copilot-checks.mjs'
import { checkPlansReadOnly, checkPlansSave, whoAnswersPlans } from './plans-checks.mjs'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/smoke.mjs <site URL> [--canary web] [--ask] [--save-plan] [--plans-service] [--copilot-service] [--stream] [--data-may-differ]')
  process.exit(2)
}
sendToCanary(process.argv, base)

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}
const get = (path, init) => fetch(base + path, init)
/** Cloud Storage marks what it sends with x-goog-* headers; the web server sends none. */
const servedBy = (response) => (response.headers.get('x-goog-generation') || response.headers.get('x-goog-storage-class') ? 'the bucket, through the load balancer' : 'the web server')
/** A service and the web server should carry the same site data. With --data-may-differ, a difference is only said. */
function checkSameData(name, theirs, ours) {
  const same = theirs === ours
  if (!same && process.argv.includes('--data-may-differ')) console.log(`note ${name} carries site data ${theirs} and the web server ${ours}: its own deploy has not finished, or has not run`)
  else check(`${name} and the web server carry the same site data`, same, `${name} ${theirs}, web ${ours}`)
}

// The page and version.json must never be kept; hashed assets may be kept for a year.
for (const path of ['/', '/version.json']) {
  const r = await get(path)
  check(`${path} is served and never cached`, r.ok && r.headers.get('cache-control') === 'no-store', `${r.status} ${r.headers.get('cache-control')}`)
}
const html = await (await get('/')).text()
// The script's name depends on the build (it was index-…, and is main-… now that there are two pages).
const asset = /assets\/[^"]+\.js/.exec(html)?.[0]
const assetResponse = asset ? await get(`/${asset}`) : null
check('the app script is cached for a year', assetResponse?.headers.get('cache-control')?.includes('immutable') === true, asset ?? 'no script found in the page')

const sites = await get('/data/sites.json')
check('site data loads and is re-checked each time', sites.ok && sites.headers.get('cache-control') === 'no-cache', `${sites.status}`)

// A terrain tile must arrive as the gzip file itself: the page unpacks it.
const tile = await get('/tiles/global/16_0.bin.gz')
const tileBytes = new Uint8Array(await tile.arrayBuffer())
check('a terrain tile arrives as raw gzip bytes', tile.ok && tileBytes[0] === 0x1f && tileBytes[1] === 0x8b && !tile.headers.get('content-encoding'), `${tile.status}, ${tileBytes.length} bytes, encoding ${tile.headers.get('content-encoding')}`)
// Who sent it, and for how long a browser may keep it. Said, not checked: the web server and the
// bucket (through Cloud CDN, Phase 6) should both say a day, and a difference is for a person to look at.
console.log(`note the tile came from ${servedBy(tile)}, cache-control "${tile.headers.get('cache-control')}"${tile.headers.get('age') ? `, ${tile.headers.get('age')} s in the CDN` : ''}`)
// The web server answers 404. From the bucket the answer is 403: the load balancer may read the
// tiles but not list the bucket, and Cloud Storage then will not say whether a name exists.
const neverWritten = await get('/tiles/global/16_0.bin.gz.bak')
check('names the pipeline never writes are refused', [403, 404].includes(neverWritten.status), `${neverWritten.status}`)
await neverWritten.body?.cancel()

// The Atlas and Briefing pages, and one month of the light grid they draw (kept in the bucket, like the tiles).
const atlas = await get('/atlas/')
check('the Atlas page is served and never cached', atlas.ok && atlas.headers.get('cache-control') === 'no-store', `${atlas.status} ${atlas.headers.get('cache-control')}`)
const briefing = await get('/briefing/')
check('the Briefing page is served and never cached', briefing.ok && briefing.headers.get('cache-control') === 'no-store', `${briefing.status} ${briefing.headers.get('cache-control')}`)
// The Surface page, and a year of the Sun's and Earth's positions, which give it the size of their disks.
const surface = await get('/surface/')
check('the Surface page is served and never cached', surface.ok && surface.headers.get('cache-control') === 'no-store', `${surface.status} ${surface.headers.get('cache-control')}`)
// The site as it was before Sightline took the front page.
const classic = await get('/classic/')
check('the old front page is served at /classic/ and never cached', classic.ok && classic.headers.get('cache-control') === 'no-store', `${classic.status} ${classic.headers.get('cache-control')}`)
await classic.body?.cancel()
// Sightline is the front page, and still answers at the address it had while it was built.
const sightline = await get('/sightline/')
check('the Sightline page is served and never cached', sightline.ok && sightline.headers.get('cache-control') === 'no-store', `${sightline.status} ${sightline.headers.get('cache-control')}`)
await sightline.body?.cancel()
const positions = await get('/data/custom/ephemeris-2027.bin')
const positionBytes = (await positions.arrayBuffer()).byteLength
check('a year of Sun and Earth positions is served whole', positions.ok && positionBytes === 8760 * 6 * 4, `${positions.status}, ${positionBytes} bytes`)
const light = await get('/tiles/light/2027-05.bin.gz')
const lightBytes = new Uint8Array(await light.arrayBuffer())
check('a month of the light grid arrives as raw gzip bytes', light.ok && lightBytes[0] === 0x1f && lightBytes[1] === 0x8b && !light.headers.get('content-encoding'), `${light.status}, ${lightBytes.length} bytes`)

const wideLight = await get('/tiles/light/wide/2027-05.bin.gz')
check('a month of the wide light grid is served', wideLight.ok, `${wideLight.status}`)
await wideLight.body?.cancel()

// Video players (Safari above all) need byte ranges to seek.
const part = await get('/media/demo.mp4', { headers: { range: 'bytes=1000-1999' } })
const partBytes = (await part.arrayBuffer()).byteLength
check('the demo video answers a byte range', part.status === 206 && partBytes === 1000 && /^bytes 1000-1999\//.test(part.headers.get('content-range') ?? ''), `${part.status}, ${partBytes} bytes`)
console.log(`note the video came from ${servedBy(part)}, cache-control "${part.headers.get('cache-control')}"`)

// The API only answers this site's own pages. Asked of the web server's own API (Scout's voice):
// the refusal comes before anything is counted or said, so it costs nothing. The co-pilot's and
// plans' own refusals are checked below, where those services answer.
const outsider = await get('/api/speak', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
  body: JSON.stringify({ text: 'hi' }),
})
check("the web server's API refuses other sites", outsider.status === 403, `${outsider.status}`)
await outsider.body?.cancel()

// Today's counts of co-pilot questions, kept by the events worker and read here read-only. The worker
// has no public address, so this is the one place it can be seen from outside. A copy with no counters
// set up answers 503, which is fine; counts that cannot be read are reported and do not stop a deploy
// of the site, because no page depends on them.
const stats = await get('/api/stats')
const statsBody = await stats.json().catch(() => ({}))
if (stats.status === 200) {
  const numbers = ['questions', 'cached', 'fallback', 'busy', 'failed'].every((name) => Number.isInteger(statsBody.counts?.[name]) && statsBody.counts[name] >= 0)
  check("today's question counts are numbers for a day", numbers && /^\d{4}-\d{2}-\d{2}$/.test(statsBody.day ?? ''), JSON.stringify(statsBody).slice(0, 160))
} else {
  check("today's question counts answer, or say why not", [502, 503].includes(stats.status) && typeof statsBody.error === 'string', `${stats.status}`)
  console.log(`note today's question counts are not available here: ${stats.status} ${statsBody.error ?? ''}`)
}

// The web server's own status. It runs no plans API and no co-pilot, and says where theirs are.
const siteStatus = await (await get('/api/status')).json().catch(() => ({}))
check('the web server reports its status, and runs no plans API or co-pilot itself', siteStatus.plans === false && siteStatus.copilot === false && typeof siteStatus.limitsAndCache === 'string', JSON.stringify(siteStatus).slice(0, 200))

// Shared mission plans: the plans service. Only it has a status address (GET /api/plans/status), so
// asking for it says whether this address reaches the service. Through the public address the load
// balancer sends it the path; on one machine the web server passes it on; at the web server's own
// address nothing answers (404), and the checks are skipped unless --plans-service says they must
// run. They change nothing unless --save-plan is given, which saves one real plan (see
// plans-checks.mjs for what that leaves behind).
const plansBy = await whoAnswersPlans(base)
if (plansBy.by === 'plans') {
  console.log(`note /api/plans reaches the plans service here: version ${plansBy.status.version}, revision ${plansBy.status.revision}`)
  // The service writes a plan's brief from the same pipeline output the pages draw. If the two
  // hashes differ, one of them was built from other data than the other.
  if (typeof siteStatus.dataVersion === 'string') checkSameData('the plans service', plansBy.status.dataVersion, siteStatus.dataVersion)
  await checkPlansReadOnly(base, check)
  if (process.argv.includes('--save-plan')) await checkPlansSave(base, check, 'smoke test')
} else if (plansBy.by === 'web') {
  console.log('note only the web server is at this address: /api/plans is 404 here, and the plans checks were skipped. The plans service answers it at the public address')
}
if (process.argv.includes('--plans-service')) check('the plans service answers /api/plans at this address', plansBy.by === 'plans', plansBy.by === 'nobody' ? `HTTP ${plansBy.code}` : plansBy.by === 'web' ? 'only the web server is here' : plansBy.by)
else if (plansBy.by === 'nobody') check('/api/plans/status is the plans service, or the web server saying it has none', false, `HTTP ${plansBy.code}`)

// The co-pilot: the co-pilot service, found the same way (GET /api/chat/status). These checks call
// no model: another site is refused and a GET is 405, on both endpoints.
const copilotBy = await whoAnswersCopilot(base)
if (copilotBy.by === 'copilot') {
  console.log(`note /api/chat and /api/ask reach the co-pilot service here: version ${copilotBy.status.version}, revision ${copilotBy.status.revision}`)
  if (typeof siteStatus.dataVersion === 'string') checkSameData('the co-pilot service', copilotBy.status.dataVersion, siteStatus.dataVersion)
  await checkCopilotReadOnly(base, check)
  if (process.argv.includes('--stream')) await checkCopilotStream(base, check)
} else if (copilotBy.by === 'web') {
  console.log('note only the web server is at this address: /api/chat and /api/ask are 404 here, and the co-pilot checks were skipped. The co-pilot service answers them at the public address')
}
if (process.argv.includes('--copilot-service')) check('the co-pilot service answers /api/chat at this address', copilotBy.by === 'copilot', copilotBy.by === 'nobody' ? `HTTP ${copilotBy.code}` : copilotBy.by === 'web' ? 'only the web server is here' : copilotBy.by)
else if (copilotBy.by === 'nobody') check('/api/chat/status is the co-pilot service, or the web server saying it has none', false, `HTTP ${copilotBy.code}`)

if (process.argv.includes('--ask')) {
  // A language model is sometimes briefly busy. That is not a broken site, so the question is
  // put up to three times before it counts against the deploy.
  let answer
  let body = {}
  for (let attempt = 1; attempt <= 3; attempt++) {
    answer = await get('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ question: 'Apollo 11 in July 2028, a 10 day mission' }),
    })
    body = await answer.json().catch(() => ({}))
    if (answer.ok || (answer.status !== 429 && answer.status < 500) || attempt === 3) break
    console.log(`      the model was busy (HTTP ${answer.status}); asking again in ${attempt * 6} s`)
    await new Promise((resolve) => setTimeout(resolve, attempt * 6000))
  }
  check('a real question is understood', answer.ok && body.result?.sites?.[0] === 'apollo-11' && body.result?.month === '2028-07', JSON.stringify(body))
}

console.log(failed ? `${failed} check(s) failed` : 'All checks passed')
process.exit(failed ? 1 : 0)
