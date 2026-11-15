import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type LongTourFile, minutesWords, tourMeans, tourTakes } from '../lib/tour'
import file from './tour5.json'

const tour = file as LongTourFile
const sites = (JSON.parse(readFileSync(new URL('../../public/data/sites.json', import.meta.url), 'utf8')) as { id: string }[]).map((site) => site.id)
const CHAPTERS = ['The problem', 'One landing, answered', 'The plan changes', 'Trust it, and use it']
/** The story's one plan: the landing that fails, the later date at the same site, and two other sites on the first date. */
const A = { site: 'connecting-ridge', landing: '2027-05-06T13:00:00Z' }
const B = { site: 'connecting-ridge', landing: '2027-06-22T07:00:00Z' }
const at = (id: string) => tour.steps.findIndex((step) => step.id === id)

describe('the tour', () => {
  it('has fourteen steps, each with its own id, a short title, something to ring, two sentences to read and a longer line to say', () => {
    expect(tour.steps).toHaveLength(14)
    expect(new Set(tour.steps.map((step) => step.id)).size).toBe(14)
    for (const step of tour.steps) {
      expect(step.title.length, step.id).toBeGreaterThan(3)
      // One line of the card's title type.
      expect(step.title.length, step.id).toBeLessThanOrEqual(24)
      expect(step.targets.length, step.id).toBeGreaterThan(0)
      // The card explains its step by itself, to someone who reads and never listens: about 30 words, in two sentences or three.
      const read = (step.line ?? '').split(/\s+/).length
      expect(read, step.id).toBeGreaterThanOrEqual(20)
      expect(read, step.id).toBeLessThanOrEqual(36)
      expect(step.line?.length ?? 999, step.id).toBeLessThanOrEqual(185)
      const sentences = (step.line ?? '').split(/(?<=[.?])\s+/).length
      expect(sentences, step.id).toBeGreaterThanOrEqual(2)
      expect(sentences, step.id).toBeLessThanOrEqual(3)
      // About 15 to 30 seconds aloud.
      const words = step.say.split(/\s+/).length
      expect(words, step.id).toBeGreaterThanOrEqual(45)
      expect(words, step.id).toBeLessThanOrEqual(75)
    }
  })

  it('is told in four chapters, in order, each a run of steps', () => {
    const chapters = tour.steps.map((step) => step.chapter)
    expect([...new Set(chapters)]).toEqual(CHAPTERS)
    // A chapter, once left, does not come back.
    expect(chapters.filter((chapter, i) => chapter !== chapters[i - 1])).toEqual(CHAPTERS)
    for (const chapter of CHAPTERS) expect(chapters.filter((one) => one === chapter).length, chapter).toBeGreaterThanOrEqual(2)
  })

  it('follows one plan from start to end: every Plan step names it, on the Short stay, at listed sites and whole UTC hours', () => {
    for (const step of tour.steps) {
      if (step.state.view !== 'plan') continue
      expect(step.state.mission, step.id).toBe('short')
      const plan = step.state.scenarios ?? []
      // Named at every step, so a reader who jumps by a dot lands in the story's plan, and a scenario added on the way is not left over.
      expect(plan.length, step.id).toBeGreaterThanOrEqual(1)
      expect(plan.length, step.id).toBeLessThanOrEqual(4)
      expect(plan[0], step.id).toEqual(A)
      for (const scenario of plan) {
        expect(sites, step.id).toContain(scenario.site)
        expect(scenario.landing, step.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
      }
      expect(step.state.active ?? 0, step.id).toBeLessThan(plan.length)
    }
    // The first landing alone until the date slips; then the later date beside it, on show; then two other sites on the first date.
    for (const step of tour.steps.slice(at('plan'), at('slipped') + 1)) expect(step.state.scenarios, step.id).toEqual([A])
    expect(tour.steps[at('scenarios')].state.scenarios).toEqual([A, B])
    for (const step of tour.steps.slice(at('compare'))) {
      expect(step.state.scenarios?.slice(0, 2), step.id).toEqual([A, B])
      expect(step.state.scenarios?.slice(2).every((one) => one.landing === A.landing && one.site !== A.site), step.id).toBe(true)
      expect(step.state.scenarios, step.id).toHaveLength(4)
      expect(step.state.active, step.id).toBe(1)
    }
    expect(tour.steps[at('scenarios')].state.active).toBe(1)
  })

  it('has two steps that press a control themselves, and says what each rings afterwards and at which words the press is made', () => {
    const pressing = tour.steps.filter((step) => step.press)
    expect(pressing.map((step) => step.id)).toEqual(['slipped', 'scenarios'])
    for (const step of pressing) {
      expect(step.after?.length, step.id).toBeGreaterThan(0)
      expect(step.pressOn, step.id).toBeTruthy()
      expect(step.say, step.id).toContain(step.pressOn as string)
    }
    expect(pressing[0].targets).toEqual([pressing[0].press])
    // The "+" is pressed inside the letters the step rings.
    expect(pressing[1].press).toContain(pressing[1].targets[0])
  })

  it('has a voice file for every step, rendered from exactly its words, and plays through in five to five and three quarter minutes', () => {
    const voiceDir = new URL('../../public/tour/voice5/', import.meta.url)
    const index = JSON.parse(readFileSync(new URL('index.json', voiceDir), 'utf8')) as { disclosure: string; lines: Record<string, { say: string; bytes: number; seconds: number }> }
    expect(index.disclosure).toBe(tour.voice.disclosure)
    expect(Object.keys(index.lines).sort()).toEqual(tour.steps.map((step) => step.id).sort())
    let total = 0
    for (const step of tour.steps) {
      // A step whose words changed after its line was rendered would speak the old words.
      expect(index.lines[step.id]?.say, step.id).toBe(step.say)
      expect(existsSync(new URL(`${step.id}.mp3`, voiceDir)), step.id).toBe(true)
      expect(index.lines[step.id].seconds, step.id).toBeGreaterThanOrEqual(14)
      expect(index.lines[step.id].seconds, step.id).toBeLessThanOrEqual(30)
      total += index.lines[step.id].seconds
    }
    // Played through, with about a second a step for stepping: long enough to tell the story, short enough to finish.
    expect(tour.voice.seconds).toBeGreaterThanOrEqual(300)
    expect(tour.voice.seconds).toBeLessThanOrEqual(345)
    expect(tour.voice.seconds - total).toBeGreaterThanOrEqual(8)
    expect(tour.voice.seconds - total).toBeLessThanOrEqual(24)
  })

  it('says what it takes in words, from its own steps and voice', () => {
    expect(minutesWords(30)).toBe('half a minute')
    expect(minutesWords(62)).toBe('a minute')
    expect(minutesWords(95)).toBe('a minute and a half')
    expect(minutesWords(287)).toBe('five minutes')
    expect(minutesWords(331)).toBe('five and a half minutes')
    expect(tourTakes(tour)).toMatch(/^14 steps: about (a minute and a half|two minutes|two and a half minutes) to read, about (five|five and a half) minutes to hear$/)
    // A hover text: two sentences, and not only the control's own label.
    expect(tourMeans(tour)).toMatch(/^Scout follows one landing plan across the real screen, in 14 steps\. About .+ to read, about .+ to hear\.$/)
  })

  it('asks ahead only for files this build has, each once, and for every site and month its plan lands in', () => {
    const files = tour.prepare?.files ?? []
    expect(files.length).toBeGreaterThan(20)
    expect(new Set(files).size).toBe(files.length)
    // Terrain tiles and the custom points' terrain live in a bucket, not in the repository.
    const here = files.filter((file) => !file.startsWith('/tiles/') && !/\/custom\/(terrain|polar|meta)/.test(file))
    for (const file of here) expect(existsSync(new URL(`../../public${file}`, import.meta.url)), file).toBe(true)
    for (const step of tour.steps) for (const scenario of step.state.scenarios ?? []) expect(files, step.id).toContain(`/data/${scenario.site}/${scenario.landing.slice(0, 7)}/track.json`)
  })

  it('uses no local time, none of the words kept out of the app, and does not name the challenge it answers', () => {
    const words = tour.steps.map((step) => `${step.title} ${step.line} ${step.say}`).join(' ')
    expect(words).not.toMatch(/\b(EST|EDT|PST|a\.m\.|p\.m\.|playhead|scrub|ridge line|objectives?|challenge|kilometres?|metres?|colou?red)\b/i)
  })
})
