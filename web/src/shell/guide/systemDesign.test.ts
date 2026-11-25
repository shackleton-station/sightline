import { describe, expect, it } from 'vitest'
import { SYSTEM_ARROWS, systemAreas } from './systemDesign'

const areas = systemAreas({ siteCount: 13, span: '2026 to 2049', model: 'Claude Opus 5.5' })
const ids = areas.flatMap((area) => area.boxes.map((box) => box.id))

describe('the system design the Guide draws', () => {
  it('gives every box its own id', () => {
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('draws every arrow between two boxes that exist, once', () => {
    const missing = SYSTEM_ARROWS.flatMap((arrow) => [arrow.from, arrow.to]).filter((id) => !ids.includes(id))
    expect(missing).toEqual([])
    const pairs = SYSTEM_ARROWS.map((arrow) => `${arrow.from}>${arrow.to}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('names the site’s own address, and the figures that change with the build', () => {
    const words = areas.flatMap((area) => area.boxes.map((box) => box.says)).join(' ')
    expect(words).toContain('lunarsightline.com')
    expect(words).not.toContain('shackletonstation.dev')
    expect(words).toContain('13 sites, 2026 to 2049')
    expect(words).toContain('Claude Opus 5.5. Signed in by workload identity federation')
  })

  it('writes every box in plain sentences, with no semicolon and no budget line', () => {
    const words = areas.flatMap((area) => area.boxes.map((box) => box.says)).join(' ')
    expect(words).not.toContain(';')
    expect(words).not.toMatch(/budget/i)
  })

  it('keeps Redis in the design as built, and says it is switched off now', () => {
    const redis = areas.flatMap((area) => area.boxes).find((box) => box.id === 'redis')
    expect(redis?.name).toBe('Redis · Memorystore')
    expect(redis?.says).toContain('Shared by web, plans and co-pilot')
    expect(redis?.says).toContain('Switched off since November 2026 to cut cost')
    expect(redis?.says).toContain('One setting turns it back on')
  })

  it('says only "Claude" when Scout’s service reports no model', () => {
    const anthropic = systemAreas({ siteCount: 13, span: '2026 to 2049', model: null }).flatMap((area) => area.boxes).find((box) => box.id === 'anthropic')
    expect(anthropic?.says.startsWith('Claude. Signed in')).toBe(true)
  })
})
