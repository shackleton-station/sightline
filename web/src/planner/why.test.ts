import { describe, expect, it } from 'vitest'
import { type Requirements, viableHours } from '../lib/mission'
import { monthWhy, whySentence } from './why'

const REQ: Requirements = { missionDays: 2, maxSunGapH: 10, maxEarthGapH: 1000, sunAtLanding: true, earthAtLanding: true, minEarthClearanceDeg: 0 }

/** `days` UTC days of hourly flags, all up except the hours given. */
function flags(days: number, down: [number, number][] = []): boolean[] {
  const out = new Array<boolean>(days * 24).fill(true)
  for (const [from, to] of down) out.fill(false, from, to)
  return out
}

describe('why a month has no landing', () => {
  it('names the limit each failing day breaks, and adds up to the failing days', () => {
    // Ten days. The Sun is down for 20 h on day 5 (hours 100 to 120): any landing whose two-day
    // mission reaches that dark spell breaks the 10 h limit; landings inside it break "Sun at landing" first.
    const sun = flags(12, [[100, 120]])
    const earth = flags(12)
    const span = { from: 0, to: 240 }
    const viable = viableHours(sun, earth, REQ)
    const why = monthWhy(sun, earth, span, viable, REQ)
    const total = why.reasons.reduce((sum, reason) => sum + reason.days, 0)
    expect(total).toBe(why.failedDays)
    expect(why.failedDays).toBeGreaterThan(0)
    expect(why.reasons[0].kind).toBe('sunGap')
    expect(whySentence(why, REQ)).toMatch(/a dark spell runs past your 10 h limit/)
  })

  it('says nothing when every day works', () => {
    const sun = flags(12)
    const earth = flags(12)
    const viable = viableHours(sun, earth, REQ)
    const why = monthWhy(sun, earth, { from: 0, to: 240 }, viable, REQ)
    expect(why.failedDays).toBe(0)
    expect(whySentence(why, REQ)).toBeNull()
  })
})
