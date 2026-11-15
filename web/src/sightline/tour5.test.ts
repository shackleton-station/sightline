import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LongTourFile } from '../lib/tour'
import file from './tour5.json'

const tour = file as LongTourFile
const sites = (JSON.parse(readFileSync(new URL('../../public/data/sites.json', import.meta.url), 'utf8')) as { id: string }[]).map((site) => site.id)

describe('the five-minute tour', () => {
  it('has twelve steps, each with its own id, a title, something to ring, a short line to read and a longer one to say', () => {
    expect(tour.steps).toHaveLength(12)
    expect(new Set(tour.steps.map((step) => step.id)).size).toBe(12)
    for (const step of tour.steps) {
      expect(step.title.length, step.id).toBeGreaterThan(3)
      expect(step.targets.length, step.id).toBeGreaterThan(0)
      // A room reads the line at a glance: a sentence or two.
      expect(step.line?.length ?? 0, step.id).toBeGreaterThan(20)
      expect(step.line?.length ?? 999, step.id).toBeLessThanOrEqual(100)
      // About 20 to 25 seconds aloud.
      const words = step.say.split(/\s+/).length
      expect(words, step.id).toBeGreaterThanOrEqual(50)
      expect(words, step.id).toBeLessThanOrEqual(75)
    }
  })

  it('plans only at listed sites, on whole UTC hours, and tells every Plan step on the Short stay', () => {
    for (const step of tour.steps) {
      for (const scenario of step.state.scenarios ?? []) {
        expect(sites, step.id).toContain(scenario.site)
        expect(scenario.landing, step.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      }
      expect((step.state.scenarios ?? []).length, step.id).toBeLessThanOrEqual(4)
      if (step.state.view === 'plan') expect(step.state.mission, step.id).toBe('short')
    }
  })

  it('has one step that presses a control itself, and says what it rings afterwards', () => {
    const pressing = tour.steps.filter((step) => step.press)
    expect(pressing.map((step) => step.id)).toEqual(['slipped'])
    expect(pressing[0].targets).toEqual([pressing[0].press])
    expect(pressing[0].after?.length).toBeGreaterThan(0)
  })

  it('uses no local time and none of the words kept out of the app', () => {
    const words = tour.steps.map((step) => `${step.title} ${step.line} ${step.say}`).join(' ')
    expect(words).not.toMatch(/\b(EST|EDT|PST|a\.m\.|p\.m\.|playhead|scrub|ridge line)\b/i)
  })
})
