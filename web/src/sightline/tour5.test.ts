import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LongTourFile } from '../lib/tour'
import file from './tour5.json'

const tour = file as LongTourFile
const sites = (JSON.parse(readFileSync(new URL('../../public/data/sites.json', import.meta.url), 'utf8')) as { id: string }[]).map((site) => site.id)

describe('the tour', () => {
  it('has twelve steps, each with its own id, a title, something to ring, a short line to read and a longer one to say', () => {
    expect(tour.steps).toHaveLength(12)
    expect(new Set(tour.steps.map((step) => step.id)).size).toBe(12)
    for (const step of tour.steps) {
      expect(step.title.length, step.id).toBeGreaterThan(3)
      expect(step.targets.length, step.id).toBeGreaterThan(0)
      // The card explains its step by itself, to a judge alone or a room: two or three short sentences, and short enough to stay a card.
      expect(step.line?.length ?? 0, step.id).toBeGreaterThanOrEqual(90)
      expect(step.line?.length ?? 999, step.id).toBeLessThanOrEqual(140)
      expect((step.line ?? '').split(/[.:?] /).length, step.id).toBeGreaterThanOrEqual(2)
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

  it('has a voice file for every step, rendered from exactly its words, between 18 and 27 seconds each, and 4 min 40 s to 4 min 50 s played through', () => {
    const voiceDir = new URL('../../public/tour/voice5/', import.meta.url)
    const index = JSON.parse(readFileSync(new URL('index.json', voiceDir), 'utf8')) as { disclosure: string; lines: Record<string, { say: string; bytes: number; seconds: number }> }
    expect(index.disclosure).toBe(tour.voice.disclosure)
    let total = 0
    for (const step of tour.steps) {
      // A step whose words changed after its line was rendered would speak the old words.
      expect(index.lines[step.id]?.say, step.id).toBe(step.say)
      expect(existsSync(new URL(`${step.id}.mp3`, voiceDir)), step.id).toBe(true)
      expect(index.lines[step.id].seconds, step.id).toBeGreaterThanOrEqual(18)
      expect(index.lines[step.id].seconds, step.id).toBeLessThanOrEqual(27)
      total += index.lines[step.id].seconds
    }
    // Played through, with about a second a step for stepping: it fills a five-minute slot without running over it.
    expect(tour.voice.seconds).toBeGreaterThanOrEqual(280)
    expect(tour.voice.seconds).toBeLessThanOrEqual(290)
    expect(tour.voice.seconds - total).toBeGreaterThanOrEqual(8)
    expect(tour.voice.seconds - total).toBeLessThanOrEqual(20)
  })

  it('makes its one press, when it plays through, at words its line really says', () => {
    const step = tour.steps.find((one) => one.press)!
    expect(step.pressOn).toBeTruthy()
    expect(step.say).toContain(step.pressOn as string)
  })

  it('asks ahead only for files this build has, each once', () => {
    const files = tour.prepare?.files ?? []
    expect(files.length).toBeGreaterThan(20)
    expect(new Set(files).size).toBe(files.length)
    // Terrain tiles and the custom points' terrain live in a bucket, not in the repository.
    const here = files.filter((file) => !file.startsWith('/tiles/') && !/\/custom\/(terrain|polar|meta)/.test(file))
    for (const file of here) expect(existsSync(new URL(`../../public${file}`, import.meta.url)), file).toBe(true)
  })

  it('uses no local time and none of the words kept out of the app', () => {
    const words = tour.steps.map((step) => `${step.title} ${step.line} ${step.say}`).join(' ')
    expect(words).not.toMatch(/\b(EST|EDT|PST|a\.m\.|p\.m\.|playhead|scrub|ridge line)\b/i)
  })
})
