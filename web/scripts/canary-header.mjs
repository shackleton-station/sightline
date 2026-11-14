// Reaching a service's next version through the load balancer (docs/ARCHITECTURE_PHASE_6.md).
//
// Every deploy tags the version it has just made `canary`. A request to the site's own address that
// carries the header below goes to that version instead of the live one, through the load balancer
// and its edge firewall (infra/canary.tf, the route rules in infra/domain.tf):
//
//   x-clps-canary: web       any path that is the web server's
//   x-clps-canary: plans     /api/plans and /api/plans/*
//   x-clps-canary: copilot   /api/chat, /api/chat/* and /api/ask
//
// The header is not a secret. It is written here, in the workflows and in the docs on purpose:
// anyone who sends it reaches a version that has not been rolled out yet, through the same firewall
// and limits as everyone else, which is harmless.
//
// The checks take it as `--canary <service>`:
//   node scripts/smoke.mjs https://lunarsightline.com --canary web
//   node scripts/plans-check.mjs https://lunarsightline.com --canary plans --cloud
//   node scripts/copilot-check.mjs https://lunarsightline.com --canary copilot --cloud
//   node scripts/chat-eval.mjs https://lunarsightline.com --canary copilot --quick
//   curl -H 'x-clps-canary: web' https://lunarsightline.com/api/status

export const CANARY_HEADER = 'x-clps-canary'
export const CANARY_SERVICES = ['web', 'plans', 'copilot']

/** The value after `--canary` in a command line, or null when there is none. Throws on an unknown service. */
export function canaryFrom(argv) {
  const at = argv.indexOf('--canary')
  if (at < 0) return null
  const service = argv[at + 1]
  if (!CANARY_SERVICES.includes(service)) throw new Error(`--canary takes one of ${CANARY_SERVICES.join(', ')}; got ${service ?? 'nothing'}`)
  return service
}

/** The headers that send a request to `service`'s canary, or none for the live version. */
export function canaryHeaders(service) {
  return service ? { [CANARY_HEADER]: service } : {}
}

/**
 * A fetch that adds the canary header to every request for `base`'s origin, and leaves requests
 * anywhere else alone. Headers the caller sets are kept.
 */
export function withCanary(fetchFn, base, service) {
  if (!service) return fetchFn
  const origin = new URL(base).origin
  return (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    if (url.origin !== origin) return fetchFn(input, init)
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(CANARY_HEADER, service)
    return fetchFn(input, { ...init, headers })
  }
}

/**
 * For a check script: when its command line has `--canary <service>`, every request it makes to
 * `base` from here on carries the header. Returns the service, or null.
 */
export function sendToCanary(argv, base) {
  const service = canaryFrom(argv)
  if (service) {
    globalThis.fetch = withCanary(globalThis.fetch, base, service)
    console.log(`note every request to ${new URL(base).origin} carries ${CANARY_HEADER}: ${service}, so this checks the version tagged canary`)
  }
  return service
}

/**
 * Asks `url` (a status address) until the answer names `revision`, or `seconds` pass. A deploy moves
 * the tag and then waits here, so its tests never run against the version the tag was on before.
 * Resolves to { ok, tries, last } where `last` is the last revision seen (or why none was).
 */
export async function waitForRevision({ url, headers = {}, revision, seconds = 180, everyMs = 5000, fetchFn = fetch, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const until = now() + seconds * 1000
  let tries = 0
  let last = 'no answer yet'
  while (true) {
    tries++
    try {
      const response = await fetchFn(url, { headers, signal: AbortSignal.timeout(10_000) })
      const body = await response.json().catch(() => null)
      last = body && typeof body.revision === 'string' ? body.revision : `HTTP ${response.status}, no revision in the answer`
      if (last === revision) return { ok: true, tries, last }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (now() + everyMs > until) return { ok: false, tries, last }
    await sleep(everyMs)
  }
}

/**
 * The two things canary.mjs watches, from its command line:
 *   <live URL> <new URL> [--canary <service>]
 * The live version is asked with no header. The new one is asked at its own URL, with the header when
 * --canary is given. Through the load balancer both URLs are the site's.
 */
export function watchTargets(argv) {
  const [live, next] = argv.slice(2, 4).map((url) => (url ?? '').replace(/\/$/, ''))
  if (!live || !next || live.startsWith('--') || next.startsWith('--')) return null
  const service = canaryFrom(argv)
  return [
    { name: 'live', base: live, headers: {} },
    { name: service ? `new (${CANARY_HEADER}: ${service})` : 'new', base: next, headers: canaryHeaders(service) },
  ]
}
