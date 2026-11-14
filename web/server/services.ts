import { tokenParts } from '../shared/googleJwt'

/**
 * How the other services are, for `GET /api/status/services` and the How it works page.
 *
 * This is the one place a service calls another, and it is synchronous on purpose: the plan's
 * example of service-to-service authentication (docs/ARCHITECTURE_PHASE_3.md, section 6). The web
 * server asks the plans and co-pilot services for their status on a path meant only for it, with a
 * short-lived token from Google saying "I am `clps-web`", made for that one service. Each service
 * checks the token itself (shared/statusCaller.ts). No secret is stored anywhere.
 *
 * Each is given 1 s, the token included. A service that does not answer in time is reported
 * `down`, with why; the page then says the rest of the site is unaffected. A service at zero copies
 * takes longer than that to start (baseline 1.4: a median of 2.65 s for the web image), so after a
 * quiet spell the first look may say `down` while the service is only starting. The page says so.
 *
 * Not `/api/status` itself: every page asks that one for its sign-in setting, and the deploys ask it
 * every 3 s. Making it wait on two other services, and wake them, would slow every page and keep
 * both services from ever scaling to zero. So the services are asked only when this is asked, and
 * an answer is reused for 10 s.
 */
export type ServiceState =
  | { state: 'up'; checkedAs: 'web' | 'anyone'; ms: number; status: Record<string, unknown> }
  | { state: 'down'; ms: number; why: string }
  | { state: 'not-asked'; why: string }

export interface ServiceTarget {
  name: string
  /** The service's own address (its run.app URL); null when this server was not told it. */
  url: string | null
  /** The public status path, used when there is no identity to ask with (one machine, Compose). */
  statusPath: string
  /** The path meant for the web server, which needs the token. */
  webPath: string
  /** The audience the token is made for: the service's name. */
  audience: string
}

/** Gives an identity token from Google, made for `audience`. */
export type IdTokens = (audience: string) => Promise<string>

export interface ServiceStatuses {
  check(): Promise<{ checkedAt: string; services: Record<string, ServiceState> }>
}

const TIMEOUT_MS = 1000
const REUSE_MS = 10_000

export function serviceStatuses(targets: ServiceTarget[], idTokens: IdTokens | null, now: () => number = Date.now, fetcher: typeof fetch = fetch): ServiceStatuses {
  let last: { at: number; answer: Promise<{ checkedAt: string; services: Record<string, ServiceState> }> } | null = null

  async function ask(target: ServiceTarget): Promise<ServiceState> {
    if (!target.url) return { state: 'not-asked', why: 'this server was not told its address' }
    const started = now()
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    try {
      const token = idTokens ? await Promise.race([idTokens(target.audience), new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('timed out'))))]) : null
      const path = token ? target.webPath : target.statusPath
      const response = await fetcher(`${target.url.replace(/\/$/, '')}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal })
      const ms = now() - started
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
      if (!response.ok || !body) return { state: 'down', ms, why: `answered HTTP ${response.status}${body && typeof body.error === 'string' ? ` (${body.error})` : ''}` }
      return { state: 'up', checkedAs: token ? 'web' : 'anyone', ms, status: body }
    } catch (error) {
      const ms = now() - started
      const timedOut = signal.aborted || (error instanceof Error && /timed? ?out|abort/i.test(error.message))
      return { state: 'down', ms, why: timedOut ? `no answer within ${TIMEOUT_MS / 1000} s` : `could not be reached: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return {
    check() {
      if (last && now() - last.at < REUSE_MS) return last.answer
      const answer = Promise.all(targets.map(async (target) => [target.name, await ask(target)] as const)).then((pairs) => ({ checkedAt: new Date(now()).toISOString(), services: Object.fromEntries(pairs) }))
      last = { at: now(), answer }
      return answer
    },
  }
}

/**
 * Identity tokens from Cloud Run's metadata server, as the service's own identity. Each is kept
 * until five minutes before it expires (Google makes them last about an hour). Only on Cloud Run:
 * on a laptop there is no metadata server, and `index.ts` passes no token source.
 */
export function metadataIdTokens(fetcher: typeof fetch = fetch, now: () => number = Date.now): IdTokens {
  const kept = new Map<string, { token: string; until: number }>()
  return async (audience) => {
    const found = kept.get(audience)
    if (found && found.until > now()) return found.token
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`
    const response = await fetcher(url, { headers: { 'metadata-flavor': 'Google' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`metadata server: HTTP ${response.status}`)
    const token = (await response.text()).trim()
    const expires = tokenParts(token)?.claims.exp
    kept.set(audience, { token, until: (typeof expires === 'number' ? expires * 1000 : now() + 3_600_000) - 5 * 60_000 })
    return token
  }
}
