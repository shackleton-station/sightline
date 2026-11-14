import type { MiddlewareHandler } from 'hono'
import { reply } from './http'

/**
 * Phase 8: which region a copy runs in, and the failover drill (docs/ARCHITECTURE_PHASE_8.md).
 *
 * Terraform sets REGION on every copy of web, plans and co-pilot (infra/main.tf, plans.tf, copilot.tf,
 * second-region.tf). Cloud Run itself does not put the region in the environment. On a laptop it is
 * unset, and the status addresses say `region: null`.
 */
export function region(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.REGION || null
}

/** How long a visitor is asked to wait before trying again during the drill, in seconds. */
export const DRILL_RETRY_AFTER_S = 5

/**
 * The failover drill. With DRILL_UNAVAILABLE=on (infra/variables.tf, `region_drill`), this copy answers
 * every request with 503, its status address included, without doing any work. 503 is one of the three
 * answers the load balancer's outlier detection counts as a gateway failure, so after a few in a row it
 * stops sending this region's copies requests for a while and sends them to the other region.
 *
 * It sits in front of everything else, so a request during the drill touches no store, limit or model.
 * Without the setting it is a no-op and adds nothing to a request.
 */
export function unavailableDrill(env: NodeJS.ProcessEnv = process.env): MiddlewareHandler {
  const on = env.DRILL_UNAVAILABLE === 'on'
  const where = region(env)
  if (on) console.warn(`DRILL_UNAVAILABLE=on: every request to this copy${where ? ` in ${where}` : ''} is answered 503`)
  return async (_c, next) => {
    if (!on) return next()
    return reply({ error: 'This copy of the site is switched off for a failover drill. Please try again in a few seconds.', drill: 'unavailable', region: where }, 503, { 'retry-after': String(DRILL_RETRY_AFTER_S) })
  }
}
