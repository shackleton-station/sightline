// Waits until the load balancer sends the canary header to the version a deploy has just tagged:
//   node scripts/wait-for-canary.mjs https://lunarsightline.com --canary web --revision clps-web-00085-abc --status-path /api/status [--seconds 180]
// A deploy gives its new version the tag `canary` and then runs this, so that its tests never run
// against the version the tag was on before. It asks the status address, with the header, every 5 s
// until the answer's `revision` is the one given. Exits non-zero if that does not happen in time.
import { canaryFrom, canaryHeaders, waitForRevision } from './canary-header.mjs'

const option = (name) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}
const site = (process.argv[2] ?? '').replace(/\/$/, '')
const service = canaryFrom(process.argv)
const revision = option('--revision')
const statusPath = option('--status-path') ?? '/api/status'
const seconds = Number(option('--seconds') ?? 180)
if (!site || site.startsWith('--') || !service || !revision || !(seconds > 0)) {
  console.error('Usage: node scripts/wait-for-canary.mjs <site URL> --canary <web|plans|copilot> --revision <name> [--status-path /api/status] [--seconds 180]')
  process.exit(2)
}

const started = Date.now()
const result = await waitForRevision({ url: site + statusPath, headers: canaryHeaders(service), revision, seconds })
const took = Math.round((Date.now() - started) / 1000)
if (result.ok) {
  console.log(`ok   ${site}${statusPath} with x-clps-canary: ${service} answers from ${revision} (${result.tries} tries, ${took} s)`)
} else {
  console.log(`FAIL ${site}${statusPath} with x-clps-canary: ${service} still answers from ${result.last} after ${took} s, not ${revision}`)
  process.exit(1)
}
