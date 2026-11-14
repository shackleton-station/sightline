import { describe, expect, it } from 'vitest'
import { copilotModel, modelName, readServices } from './serviceStatus'

describe('how the services are, as the page reads it', () => {
  it('reads up, down and not asked, with the breaker when the co-pilot reports one', () => {
    const services = readServices({
      checkedAt: '2026-11-12T12:00:00.000Z',
      services: {
        plans: { state: 'up', checkedAs: 'web', ms: 41.6, status: { service: 'plans', version: 'abc1234' } },
        copilot: { state: 'down', ms: 1001, why: 'no answer within 1 s' },
        later: { state: 'not-asked', why: 'this server was not told its address' },
      },
    })
    expect(services).toEqual([
      { name: 'copilot', health: { state: 'down', ms: 1001, why: 'no answer within 1 s' } },
      { name: 'later', health: { state: 'not-asked', why: 'this server was not told its address' } },
      { name: 'plans', health: { state: 'up', checkedAs: 'web', ms: 42, version: 'abc1234', breaker: null, model: null } },
    ])
    const open = readServices({ services: { copilot: { state: 'up', checkedAs: 'web', ms: 30, status: { breaker: { state: 'open', retryAfterSeconds: 12 } } } } })
    expect(open?.[0].health).toMatchObject({ breaker: { state: 'open', retryAfterSeconds: 12 } })
  })

  it('skips what it does not know, and gives up on a reply that is not shaped like one', () => {
    expect(readServices({ services: { odd: { state: 'sleeping' }, plans: { state: 'down', why: 'x' } } })).toEqual([{ name: 'plans', health: { state: 'down', ms: null, why: 'x' } }])
    expect(readServices({ services: {} })).toEqual([])
    expect(readServices({ error: 'not-found' })).toBeNull()
    expect(readServices(null)).toBeNull()
  })
})

describe('the model the co-pilot says it runs', () => {
  it('is read from the co-pilot\'s status and written as a name', () => {
    const services = readServices({ services: { copilot: { state: 'up', checkedAs: 'web', ms: 30, status: { modelSettings: { model: 'claude-opus-5-5', speed: 'fast', effort: 'low' } } } } })
    expect(copilotModel(services ? { state: 'ready', services } : { state: 'unavailable' })).toBe('Claude Opus 5.5')
  })

  it('is unknown while the status loads, when the co-pilot is down, or when it names no model', () => {
    expect(copilotModel({ state: 'loading' })).toBeNull()
    expect(copilotModel({ state: 'unavailable' })).toBeNull()
    expect(copilotModel({ state: 'ready', services: [{ name: 'copilot', health: { state: 'down', ms: null, why: 'x' } }] })).toBeNull()
    expect(copilotModel({ state: 'ready', services: readServices({ services: { copilot: { state: 'up', ms: 3, status: { modelSettings: null } } } }) ?? [] })).toBeNull()
  })

  it('names a Claude model from its id, and nothing else', () => {
    expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5')
    expect(modelName('claude-fable-5-2')).toBe('Claude Fable 5.2')
    expect(modelName('claude-haiku-5')).toBe('Claude Haiku 5')
    expect(modelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5')
    expect(modelName('some-other-model')).toBeNull()
    expect(modelName(null)).toBeNull()
  })
})
