import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type LongTourFile, minutesWords, type TourState, type TourStep, tourMeans, tourReads, tourTakes } from '../lib/tour'
import file from './tour5.json'

const tour = file as LongTourFile
const sites = (JSON.parse(readFileSync(new URL('../../public/data/sites.json', import.meta.url), 'utf8')) as { id: string }[]).map((site) => site.id)
const CHAPTERS = ['The problem', 'One landing, answered', 'The plan changes', 'Trust it, and use it']
/** The story's one plan: the landing that fails, the later date at the same site, and two other sites on the first date. */
const A = { site: 'connecting-ridge', landing: '2027-05-06T13:00:00Z' }
const B = { site: 'connecting-ridge', landing: '2027-06-22T07:00:00Z' }
const at = (id: string) => tour.steps.findIndex((step) => step.id === id)
/** The screens a step shows: as it arrives, and, for a step that presses the control it rings, where that press leads. */
const screens = (step: TourStep): TourState[] => (step.then ? [step.state, { ...step.state, ...step.then }] : [step.state])

describe('the tour', () => {
  it('has seventeen steps, each with its own id, a short title, something to ring, two sentences to read and a longer line to say', () => {
    expect(tour.steps).toHaveLength(17)
    expect(new Set(tour.steps.map((step) => step.id)).size).toBe(17)
    for (const step of tour.steps) {
      expect(step.title.length, step.id).toBeGreaterThan(3)
      // One line of the card's title type.
      expect(step.title.length, step.id).toBeLessThanOrEqual(24)
      expect(step.targets.length, step.id).toBeGreaterThan(0)
      // The card explains its step by itself, to someone who reads and never listens: about 30 words, in two sentences or three.
      const read = (step.line ?? '').split(/\s+/).length
      expect(read, step.id).toBeGreaterThanOrEqual(20)
      expect(read, step.id).toBeLessThanOrEqual(38)
      expect(step.line?.length ?? 999, step.id).toBeLessThanOrEqual(200)
      // Read alone, the whole tour is about two minutes: 450 words or so.
      const sentences = (step.line ?? '').split(/(?<=[.?])\s+/).length
      expect(sentences, step.id).toBeGreaterThanOrEqual(2)
      expect(sentences, step.id).toBeLessThanOrEqual(3)
      // About 15 to 30 seconds aloud.
      const words = step.say.split(/\s+/).length
      expect(words, step.id).toBeGreaterThanOrEqual(45)
      expect(words, step.id).toBeLessThanOrEqual(85)
    }
    expect(tour.steps.reduce((sum, step) => sum + (step.line ?? '').split(/\s+/).length, 0)).toBeLessThanOrEqual(520)
  })

  it('is told in four chapters, in order, each a run of steps', () => {
    const chapters = tour.steps.map((step) => step.chapter)
    expect([...new Set(chapters)]).toEqual(CHAPTERS)
    // A chapter, once left, does not come back.
    expect(chapters.filter((chapter, i) => chapter !== chapters[i - 1])).toEqual(CHAPTERS)
    for (const chapter of CHAPTERS) expect(chapters.filter((one) => one === chapter).length, chapter).toBeGreaterThanOrEqual(2)
  })

  it('follows one plan from start to end: every Plan screen names it, on the Short stay, at listed sites and whole UTC hours', () => {
    for (const step of tour.steps) {
      for (const screen of screens(step)) {
        if (screen.view !== 'plan') continue
        expect(screen.mission, step.id).toBe('short')
        const plan = screen.scenarios ?? []
        // Named at every step, so a reader who jumps by a dot lands in the story's plan, and a scenario added on the way is not left over.
        expect(plan.length, step.id).toBeGreaterThanOrEqual(1)
        expect(plan.length, step.id).toBeLessThanOrEqual(4)
        expect(plan[0], step.id).toEqual(A)
        for (const scenario of plan) {
          expect(sites, step.id).toContain(scenario.site)
          expect(scenario.landing, step.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/)
        }
        expect(screen.active ?? 0, step.id).toBeLessThan(plan.length)
      }
    }
    // The front page until "Plan a landing" is pressed; the first landing alone until the date slips; then the later date beside it, on show; then two other sites on the first date.
    expect(tour.steps.slice(0, at('plan') + 1).map((step) => step.state.view)).toEqual(['watch', 'watch'])
    expect(tour.steps[at('plan')].then?.scenarios).toEqual([A])
    for (const step of tour.steps.slice(at('mission'), at('slipped') + 1)) expect(step.state.scenarios, step.id).toEqual([A])
    expect(tour.steps[at('scenarios')].state.scenarios).toEqual([A, B])
    for (const step of tour.steps.slice(at('compare'))) {
      expect(step.state.scenarios?.slice(0, 2), step.id).toEqual([A, B])
      expect(step.state.scenarios?.slice(2).every((one) => one.landing === A.landing && one.site !== A.site), step.id).toBe(true)
      expect(step.state.scenarios, step.id).toHaveLength(4)
      expect(step.state.active, step.id).toBe(1)
    }
    expect(tour.steps[at('scenarios')].state.active).toBe(1)
  })

  it('goes step by step: no step arrives with a panel, a page or another view already open; the step rings the control that opens it, and its first Next presses it', () => {
    for (const step of tour.steps) {
      // As a step arrives the screen is the front page or the plain plan: whatever it opens, it opens on its press.
      // One step arrives inside the page the step before it opened: the Planner's second tab is pressed from its first.
      expect(step.state.open, step.id).toBe(step.id === 'depth' ? tour.steps[at('planner')].then?.open : undefined)
      expect(step.state.stage, step.id).toBeUndefined()
    }
    const opening = tour.steps.filter((step) => step.then)
    expect(opening.map((step) => step.id)).toEqual(['plan', 'mission', 'skyline', 'compare', 'planner', 'depth', 'accuracy', 'ground', 'trust', 'scout', 'share', 'handon'])
    for (const step of opening) {
      expect(step.press, step.id).toBeUndefined()
      expect(step.after?.length, step.id).toBeGreaterThan(0)
      // Played through, the press is made as the voice reaches the words for it.
      expect(step.pressOn, step.id).toBeTruthy()
      expect(step.say, step.id).toContain(step.pressOn as string)
      // The card names the control it rings, so it needs no voice.
      expect(step.line, step.id).toMatch(/\b[Pp]ress\b|Brief/)
    }
    // Between them the presses open every part of the screen the story visits.
    expect(opening.map((step) => step.then?.open ?? step.then?.stage ?? step.then?.view)).toEqual(['plan', 'mission', 'surface', 'compare', 'planner-find', 'planner-compare', 'accuracy', 'layers', 'proof', 'scout', 'share', 'brief'])
    // Both of the Planner's tabs, in order, and the rail's order: Compare, then the Planner, then what a miss does.
    expect(at('planner')).toBe(at('compare') + 1)
    expect(at('depth')).toBe(at('planner') + 1)
    expect(at('accuracy')).toBe(at('depth') + 1)
    // Where a step opened a page or another view of the Moon, the way back is ringed as the reader moves on.
    expect(tour.steps.filter((step) => step.leave).map((step) => step.id)).toEqual(['skyline', 'depth', 'ground', 'trust'])
    for (const step of tour.steps.filter((one) => one.leave)) expect(step.then, step.id).toBeDefined()
  })

  it('has two steps that press a control whose press works something out, and says what each rings afterwards and at which words the press is made', () => {
    const pressing = tour.steps.filter((step) => step.press)
    expect(pressing.map((step) => step.id)).toEqual(['slipped', 'scenarios'])
    for (const step of pressing) {
      expect(step.then, step.id).toBeUndefined()
      expect(step.after?.length, step.id).toBeGreaterThan(0)
      expect(step.pressOn, step.id).toBeTruthy()
      expect(step.say, step.id).toContain(step.pressOn as string)
    }
    expect(pressing[0].targets).toEqual([pressing[0].press])
    // The "+" is pressed inside the letters the step rings.
    expect(pressing[1].press).toContain(pressing[1].targets[0])
  })

  it('shows a link being made: Share is rung and pressed, the card says what the link carries, and nothing is copied for the reader', () => {
    const share = tour.steps[at('share')]
    expect(share.targets).toEqual([".sl-icon[aria-label='Share']"])
    expect(share.then?.open).toBe('share')
    // What the link carries: every scenario, its landing hour, and the mission's limits.
    expect(share.line).toMatch(/link holds every scenario, landing hour and limit/)
    expect(share.line).toMatch(/opens as this same plan/)
    expect(share.say).toMatch(/every scenario, with its site and landing hour, and the mission's limits, so whoever opens it sees the same plan/)
    // The step opens the list; it never presses "Copy link", so the reader's clipboard is theirs. The card says which button copies.
    expect(share.press).toBeUndefined()
    expect(share.after).toEqual(['.sl-share-sheet .sl-share-copy'])
    expect(share.line).toMatch(/Copy link copies it/)
    expect(share.say).toMatch(/Library/)
  })

  it('ends on the written brief, and by saying where the rest is: every feature has its own short guide, listed in the Guide', () => {
    const last = tour.steps[tour.steps.length - 1]
    expect(last.id).toBe('handon')
    expect(at('share')).toBe(at('handon') - 1)
    expect(last.then?.open).toBe('brief')
    expect(last.line).toMatch(/Brief/)
    expect(last.line).toMatch(/short guide, listed in the Guide/)
    expect(last.say).toMatch(/Show me how/)
  })

  it('says the mission\'s limits as the page defines them: in view is any part of the disc, and the Advanced clearance is to Earth\'s center', () => {
    const mission = tour.steps[at('mission')]
    expect(mission.say).toContain('In view means any part of the disc above the skyline')
    expect(`${mission.line} ${mission.say}`).toMatch(/Earth's center/)
    // The step before the verdict: "fits" is always "fits these limits".
    expect(at('verdict')).toBe(at('mission') + 1)
    expect(tour.steps[at('verdict')].line).toMatch(/those limits/)
    const words = tour.steps.map((step) => `${step.line} ${step.say}`).join(' ')
    expect(words).not.toMatch(/midpoint|centre/i)
  })

  it('has a voice file for every step, rendered from exactly its words, and plays through in under seven minutes', () => {
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
    expect(tour.voice.seconds).toBeGreaterThanOrEqual(350)
    expect(tour.voice.seconds).toBeLessThanOrEqual(425)
    expect(tour.voice.seconds - total).toBeGreaterThanOrEqual(10)
    expect(tour.voice.seconds - total).toBeLessThanOrEqual(30)
  })

  it('says what it takes in words, from its own steps and voice', () => {
    expect(minutesWords(30)).toBe('half a minute')
    expect(minutesWords(62)).toBe('a minute')
    expect(minutesWords(95)).toBe('a minute and a half')
    expect(minutesWords(287)).toBe('five minutes')
    expect(minutesWords(331)).toBe('five and a half minutes')
    // The reading time comes first: most visitors read and few listen.
    expect(tourReads(tour)).toBe('about two minutes')
    expect(tourTakes(tour)).toMatch(/^17 steps: about two minutes to read, about (six and a half|seven) minutes to hear$/)
    // A hover text: two sentences, and not only the control's own label.
    expect(tourMeans(tour)).toMatch(/^Scout follows one landing plan across the real screen, in 17 steps\. About two minutes to read, about .+ to hear\.$/)
  })

  it('asks ahead only for files this build has, each once, and for every site and month its plan lands in', () => {
    const files = tour.prepare?.files ?? []
    expect(files.length).toBeGreaterThan(20)
    expect(new Set(files).size).toBe(files.length)
    // Terrain tiles and the custom points' terrain live in a bucket, not in the repository.
    const here = files.filter((file) => !file.startsWith('/tiles/') && !/\/custom\/(terrain|polar|meta)/.test(file))
    for (const file of here) expect(existsSync(new URL(`../../public${file}`, import.meta.url)), file).toBe(true)
    for (const step of tour.steps) for (const screen of screens(step)) for (const scenario of screen.scenarios ?? []) expect(files, step.id).toContain(`/data/${scenario.site}/${scenario.landing.slice(0, 7)}/track.json`)
  })

  it('uses no local time, none of the words kept out of the app, and does not name the challenge it answers', () => {
    const words = tour.steps.map((step) => `${step.title} ${step.line} ${step.say}`).join(' ')
    expect(words).not.toMatch(/\b(EST|EDT|PST|a\.m\.|p\.m\.|playhead|scrub|ridge line|objectives?|challenge|kilometres?|metres?|coloured|centre)\b/i)
  })
})
