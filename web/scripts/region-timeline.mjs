// What region-watch.mjs saw, worked out from its samples (docs/ARCHITECTURE_PHASE_8.md, the drill).
// Pure functions, no network, so they can be tested (region-timeline.test.mjs).

/** The three status addresses the watch asks, one per service, all through the site's address. */
export const STATUS_PATHS = { web: '/api/status', plans: '/api/plans/status', copilot: '/api/chat/status' }

/**
 * The region an answer came from. Every status address names it (`region`), and so does the drill's
 * 503 (shared/region.ts). Anything else (a 503 from the load balancer itself, a timeout, an older
 * version with no `region` field) is `unknown`.
 */
export function regionOf(body) {
  return body && typeof body === 'object' && typeof body.region === 'string' && body.region ? body.region : 'unknown'
}

/** Whether a sample is what a visitor would call a failure: no answer, or a 5xx. */
export const failed = (sample) => sample.code === 0 || sample.code >= 500

/**
 * One service's story from its samples, in the order they were taken. Each sample is
 * `{ t, code, region, drill }`: seconds since the watch started, the HTTP status (0 for no answer),
 * the region the answer named, and whether it was the drill's own 503.
 *
 * - `regions`: how many good answers came from each region
 * - `failures`: how many failed, and by status
 * - `switches`: each time the region of the good answers changed, with when
 * - `firstFailure`, `lastFailure`: when the first and last failures were seen (null if none)
 * - `failover`: seconds from the first failure to the first good answer from another region than the
 *   one that failed, or null when that did not happen
 */
export function serviceStory(samples) {
  const regions = {}
  const failures = { total: 0, byStatus: {} }
  const switches = []
  let current = null
  let firstFailure = null
  let lastFailure = null
  let failedRegion = null
  let failover = null
  for (const sample of samples) {
    if (failed(sample)) {
      failures.total += 1
      const key = sample.code === 0 ? 'no answer' : String(sample.code)
      failures.byStatus[key] = (failures.byStatus[key] ?? 0) + 1
      if (firstFailure === null) {
        firstFailure = sample.t
        // The drill's 503 names its region; anything else is blamed on the region that last answered.
        failedRegion = sample.region !== 'unknown' ? sample.region : current
      }
      lastFailure = sample.t
      continue
    }
    regions[sample.region] = (regions[sample.region] ?? 0) + 1
    if (current !== null && sample.region !== current) switches.push({ t: sample.t, from: current, to: sample.region })
    current = sample.region
    if (firstFailure !== null && failover === null && sample.region !== failedRegion) failover = round(sample.t - firstFailure)
  }
  return { regions, failures, switches, firstFailure, lastFailure, failover }
}

/** One line per service for the end of the watch. */
export function describeStory(service, story) {
  const regions = Object.entries(story.regions)
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
  const failures = story.failures.total
    ? `${story.failures.total} failed (${Object.entries(story.failures.byStatus)
        .map(([status, count]) => `${status} x${count}`)
        .join(', ')}), first at ${story.firstFailure.toFixed(1)} s, last at ${story.lastFailure.toFixed(1)} s`
    : 'none failed'
  const switches = story.switches.length ? story.switches.map((s) => `${s.from} -> ${s.to} at ${s.t.toFixed(1)} s`).join('; ') : 'no switch'
  const failover = story.failover === null ? '' : `; answered from another region ${story.failover} s after the first failure`
  return `${service.padEnd(8)} answered by: ${regions || 'nobody'}. ${failures}. ${switches}${failover}`
}

const round = (seconds) => Math.round(seconds * 10) / 10
