import { useEffect, useState } from 'react'

/** How one of the other services answered the web server, as `GET /api/status/services` reports it. */
export type ServiceHealth =
  | { state: 'up'; checkedAs: 'web' | 'anyone'; ms: number; version: string | null; breaker: { state: string; retryAfterSeconds: number } | null; /** The model a service says it is running (the co-pilot's `modelSettings.model`); null if it names none. */ model: string | null }
  | { state: 'down'; ms: number | null; why: string }
  | { state: 'not-asked'; why: string }

export type ServicesState = { state: 'loading' } | { state: 'unavailable' } | { state: 'ready'; services: { name: string; health: ServiceHealth }[] }

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/** One service's entry, or null if it isn't shaped as expected. Fields the page doesn't know are ignored. */
function readHealth(value: unknown): ServiceHealth | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const ms = typeof entry.ms === 'number' && Number.isFinite(entry.ms) ? Math.round(entry.ms) : null
  if (entry.state === 'up') {
    const status = (typeof entry.status === 'object' && entry.status !== null ? entry.status : {}) as Record<string, unknown>
    const breaker = typeof status.breaker === 'object' && status.breaker !== null ? (status.breaker as Record<string, unknown>) : null
    const settings = typeof status.modelSettings === 'object' && status.modelSettings !== null ? (status.modelSettings as Record<string, unknown>) : null
    return {
      state: 'up',
      checkedAs: entry.checkedAs === 'web' ? 'web' : 'anyone',
      ms: ms ?? 0,
      version: typeof status.version === 'string' ? status.version : null,
      breaker: breaker && typeof breaker.state === 'string' ? { state: breaker.state, retryAfterSeconds: typeof breaker.retryAfterSeconds === 'number' ? breaker.retryAfterSeconds : 0 } : null,
      model: typeof settings?.model === 'string' ? settings.model : null,
    }
  }
  if (entry.state === 'down') return { state: 'down', ms, why: text(entry.why, 'no answer') }
  if (entry.state === 'not-asked') return { state: 'not-asked', why: text(entry.why) }
  return null
}

/** The services from the server's reply, in a fixed order, or null if it isn't shaped as expected. */
export function readServices(body: unknown): { name: string; health: ServiceHealth }[] | null {
  const services = (body as { services?: unknown } | null)?.services
  if (typeof services !== 'object' || services === null) return null
  return Object.entries(services as Record<string, unknown>)
    .flatMap(([name, value]) => {
      const health = readHealth(value)
      return health ? [{ name, health }] : []
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * A Claude model's id as a name to read: "claude-opus-5-5" is "Claude Opus 5.5". Null for anything
 * not shaped that way, so the page says "Claude" with no version rather than guess one.
 */
export function modelName(id: string | null): string | null {
  const match = id ? /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id) : null
  if (!match) return null
  const [, family, major, minor] = match
  return `Claude ${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/** The model the co-pilot service says it is running right now, as a name to read; null while unknown or if it says none. */
export function copilotModel(state: ServicesState): string | null {
  if (state.state !== 'ready') return null
  const health = state.services.find((service) => service.name === 'copilot')?.health
  return health?.state === 'up' ? modelName(health.model) : null
}

/** How the services are, asked once when the page opens. A server older than this page answers 404: `unavailable`. */
export function useServiceStatus(): ServicesState {
  const [state, setState] = useState<ServicesState>({ state: 'loading' })
  useEffect(() => {
    let current = true
    fetch(`${import.meta.env.BASE_URL}api/status/services`)
      .then(async (response) => (response.ok ? readServices(await response.json()) : null))
      .catch(() => null)
      .then((services) => {
        if (current) setState(services ? { state: 'ready', services } : { state: 'unavailable' })
      })
    return () => {
      current = false
    }
  }, [])
  return state
}
