import type { ServiceHealth, ServicesState } from '../data/serviceStatus'

const NAMES: Record<string, { label: string; does: string; without: string }> = {
  plans: { label: 'Plans', does: 'saves and opens shared plans', without: 'Sharing a plan waits for it. Every page, the co-pilot and the terrain still work.' },
  copilot: { label: 'Co-pilot', does: 'answers questions with the language model', without: 'The co-pilot says it is busy and when to ask again. Every page, plans and the terrain still work.' },
}

/** One line about a service, in plain words. */
function describe(name: string, health: ServiceHealth): { state: string; note: string } {
  const known = NAMES[name]
  if (health.state === 'not-asked') return { state: 'Not asked', note: `This copy of the site has no address for it (${health.why}).` }
  if (health.state === 'down') {
    return { state: 'Not answering', note: `${health.why}. A service with no copy running takes a few seconds to start, so open this page again in a moment. ${known?.without ?? ''}`.trim() }
  }
  const breaker = health.breaker
  const model =
    breaker === null ? '' : breaker.state === 'closed' ? ' The model answers normally.' : breaker.state === 'open' ? ` The model failed several times in a row, so it is given a rest: questions are told to wait ${breaker.retryAfterSeconds} s.` : ' The model is being tried again with one question.'
  return { state: 'Up', note: `Answered in ${health.ms} ms${health.checkedAs === 'web' ? ', to a request signed as the web server' : ''}.${model}` }
}

/**
 * How the other services are right now. The web server asks each, with its own identity and a
 * one-second limit, and this shows what came back, including when one does not answer.
 */
export function ServiceStatus({ services }: { services: ServicesState }) {
  if (services.state === 'loading') return <p className="how-caption">Asking the services how they are…</p>
  if (services.state === 'unavailable') return <p className="how-caption">The services can’t be asked from here right now.</p>
  if (services.services.length === 0) return <p className="how-caption">This copy of the site runs everything itself, so there is no other service to ask.</p>
  return (
    <dl className="how-counts" aria-label="How the services are right now">
      {services.services.map(({ name, health }) => {
        const { state, note } = describe(name, health)
        return (
          <div key={name}>
            <dt>
              {NAMES[name]?.label ?? name}
              {NAMES[name] ? <small> {NAMES[name].does}</small> : null}
            </dt>
            <dd>
              <strong>{state}</strong>
              <small>{note}</small>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
