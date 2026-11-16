import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import tourFile from '../sightline/tour.json'
import longTourFile from '../sightline/tour5.json'
import guidesFile from '../sightline/guides.json'
import { roverMissionDays } from './csaRover'
import { type GuidesFile, type LongTourFile, overDisc, placeBubble, type TourFile, voiceFile } from './tour'

const tour = tourFile as TourFile
const BUBBLE = { width: 340, height: 170 }

describe("Scout's tour: the steps", () => {
  it('are eight, each with one or two short sentences, something to ring and a state', () => {
    expect(tour.steps).toHaveLength(8)
    expect(new Set(tour.steps.map((step) => step.id)).size).toBe(8)
    for (const step of tour.steps) {
      const sentences = step.say.split(/(?<=[.!?])\s+/)
      expect(sentences.length, step.id).toBeLessThanOrEqual(2)
      expect(step.say.length, step.id).toBeLessThanOrEqual(140)
      expect(step.title.length, step.id).toBeLessThanOrEqual(24)
      expect(step.targets.length, step.id).toBeGreaterThan(0)
      expect(['watch', 'plan'], step.id).toContain(step.state.view)
    }
  })

  it('use the words the screen uses: "skyline", and none of the words kept off it', () => {
    const words = tour.steps.map((step) => `${step.title} ${step.say}`).join(' ')
    expect(words).toMatch(/skyline/)
    expect(words).not.toMatch(/\bridge\b|playhead|scrub|lunar night|lunar day|practice demo/i)
  })

  it('name a voice file each, and the video the page looks for', () => {
    expect(tour.steps.map((step) => voiceFile(tour, step))).toEqual(['watch', 'markers', 'plan', 'verdict', 'skyline', 'time', 'compare', 'scout'].map((id) => `/tour/voice/${id}.mp3`))
    expect(tour.video).toMatchObject({ file: '/media/sightline-walkthrough.mp4', poster: '/media/sightline-walkthrough-poster.jpg', captions: '/media/sightline-walkthrough.vtt', chapters: '/media/sightline-walkthrough-chapters.vtt', steps: '/media/sightline-walkthrough.json' })
    expect(tour.demo).toMatchObject({ file: '/media/sightline-demo-30s.mp4', poster: '/media/sightline-demo-30s-poster.jpg', captions: '/media/sightline-demo-30s.vtt' })
    expect(tour.voice.disclosure).toBe('AI-generated voice')
  })

  it('each have a voice file rendered from exactly their words (scripts/tour-voice.mjs)', () => {
    const voiceDir = new URL('../../public/tour/voice/', import.meta.url)
    const index = JSON.parse(readFileSync(new URL('index.json', voiceDir), 'utf8')) as { disclosure: string; lines: Record<string, { say: string; bytes: number }> }
    expect(index.disclosure).toBe(tour.voice.disclosure)
    for (const step of tour.steps) {
      // A step whose words changed after its line was rendered would speak the old words.
      expect(index.lines[step.id]?.say, step.id).toBe(step.say)
      expect(existsSync(new URL(`${step.id}.mp3`, voiceDir)), step.id).toBe(true)
      expect(index.lines[step.id].bytes, step.id).toBeGreaterThan(5000)
    }
  })

  it('are no longer the steps the screen runs: the README, under "Using the site", writes out the tour that is, with the line on each card', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
    const section = readme.slice(readme.indexOf('## Using the site'))
    expect(readme).toContain('## Using the site')
    const onScreen = (longTourFile as LongTourFile).steps
    expect(onScreen).toHaveLength(15)
    for (const step of onScreen) expect(section, step.id).toContain(`**${/[?]$/.test(step.title) ? step.title : `${step.title}.`}** ${step.line}`)
    // Under its four chapters, in order.
    const chapters = [...new Set(onScreen.map((step) => step.chapter))]
    expect(chapters).toHaveLength(4)
    expect(chapters.map((chapter) => section.indexOf(`*${chapter}*`)).every((place, i, all) => place > 0 && (i === 0 || place > all[i - 1]))).toBe(true)
  })
})

describe('the feature guides', () => {
  const guides = (guidesFile as GuidesFile).guides

  it('are the eight short tours the Guide lists, each of two to four steps in the main tour\'s format', () => {
    expect(guides.map((guide) => guide.name)).toEqual(['Read the answer', 'Compare scenarios', 'The Planner', 'Views and layers', 'A custom point', 'Share a plan', "Check it in NASA's tools", "A real mission: Canada's rover"])
    for (const guide of guides) {
      expect(guide.steps.length, guide.id).toBeGreaterThanOrEqual(2)
      expect(guide.steps.length, guide.id).toBeLessThanOrEqual(4)
      expect(guide.about.length, guide.id).toBeLessThanOrEqual(60)
      // A guide may be offered in the panel it is about ("Show me how"); where it is, the panel is one a step can open.
      if (guide.panel !== undefined) expect(['compare', 'layers', 'custom', 'share'], guide.id).toContain(guide.panel)
      for (const step of guide.steps) {
        expect(step.say.split(/(?<=[.!?])\s+/).length, step.id).toBeLessThanOrEqual(2)
        expect(step.say.length, step.id).toBeLessThanOrEqual(140)
        expect(step.title.length, step.id).toBeLessThanOrEqual(24)
        expect(step.targets.length, step.id).toBeGreaterThan(0)
        expect(step.state.view, step.id).toBe('plan')
      }
    }
  })

  it('give every step its own name, apart from the main tour\'s, and keep the words kept off the screen out', () => {
    const ids = [...tour.steps, ...guides.flatMap((guide) => guide.steps)].map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    const words = guides.flatMap((guide) => [guide.name, guide.about, ...guide.steps.map((step) => `${step.title} ${step.say}`)]).join(' ')
    expect(words).not.toMatch(/\bridge\b|playhead|scrub|lunar night|lunar day|practice demo/i)
  })

  it('open only what a step can open, and ask for the two nearby sites only where a step is about several scenarios', () => {
    const steps = guides.flatMap((guide) => guide.steps)
    for (const step of steps) if (step.state.open) expect(['compare', 'layers', 'custom', 'share', 'planner-find', 'planner-compare'], step.id).toContain(step.state.open)
    expect(steps.filter((step) => step.state.pair).map((step) => step.id)).toEqual(['compare-table', 'compare-rows', 'planner-compare', 'planner-back'])
    // Two steps are about controls a phone does not have (the zoom buttons, the rail's Planner button): they are marked, and their guides still have two steps without them.
    expect(steps.filter((step) => step.wide).map((step) => step.id)).toEqual(['views-zoom', 'rover-next'])
    for (const guide of guides) expect(guide.steps.filter((step) => !step.wide).length, guide.id).toBeGreaterThanOrEqual(2)
  })

  it('set the Long stay example only in the rover guide, whose first step says that example\'s own numbers and that they are not the rover\'s', () => {
    const rover = guides.find((guide) => guide.id === 'rover')!
    expect(guides.flatMap((guide) => guide.steps).filter((step) => step.state.mission === 'long').map((step) => step.id)).toEqual(rover.steps.map((step) => step.id))
    const days = roverMissionDays()
    expect(rover.steps[0].say).toContain(`${days.stay} days, at most ${days.dark} days without the Sun`)
    expect(rover.steps[0].say).toContain("an example and not the rover's own figures")
  })
})

describe("Scout's tour: where the card sits", () => {
  const laptop = { width: 1366, height: 768 }
  const phone = { width: 390, height: 844 }
  const home = { left: 12, top: 768 - 170 - 12, side: 'left' }
  const across = { left: 1366 - 340 - 12, top: 768 - 170 - 12, side: 'right' }

  it('has one home on a laptop, the lower left corner', () => {
    expect(placeBubble(BUBBLE, laptop, [{ left: 421, top: 708, width: 524, height: 48 }], null, false)).toEqual(home)
    // With nothing ringed at all, too.
    expect(placeBubble(BUBBLE, laptop, [], null, false)).toEqual(home)
  })

  it('moves to the lower right only when its home holds what the step is about', () => {
    expect(placeBubble(BUBBLE, laptop, [{ left: 16, top: 600, width: 300, height: 120 }], null, false)).toEqual(across)
  })

  it('never goes to the top: with something in both lower corners it takes the one that hides less, its home on a tie', () => {
    const left = { left: 0, top: 560, width: 360, height: 200 }
    const right = { left: 1100, top: 700, width: 266, height: 60 }
    expect(placeBubble(BUBBLE, laptop, [left, right], null, false)).toEqual(across)
    expect(placeBubble(BUBBLE, laptop, [left, { ...left, left: 1366 - 360 }], null, false)).toEqual(home)
    // A page that fills the window: still a lower corner.
    expect(placeBubble(BUBBLE, laptop, [{ left: 0, top: 0, width: 1366, height: 768 }], null, false).top).toBe(home.top)
  })

  it('may lie over the Moon, except on a step about the Moon, which passes its disc', () => {
    // A Moon so large it reaches the lower left corner: the card stays home unless the disc is passed.
    const disc = { x: 300, y: 500, r: 320 }
    expect(placeBubble(BUBBLE, laptop, [], null, false)).toEqual(home)
    const clear = placeBubble(BUBBLE, laptop, [], disc, false)
    expect(clear).toEqual(across)
    expect(overDisc({ ...clear, ...BUBBLE }, disc)).toBe(false)
  })

  it('on a phone sits at the foot of the screen, or just above the play control when that is what it rings', () => {
    const disc = { x: 195, y: 390, r: 175 }
    const wide = { width: 366, height: 170 }
    expect(placeBubble(wide, phone, [{ left: 16, top: 83, width: 230, height: 20 }], disc, true)).toMatchObject({ left: 12, top: 844 - 170 - 12 })
    const above = placeBubble(wide, phone, [{ left: 85, top: 783, width: 220, height: 45 }], disc, true)
    expect(above).toMatchObject({ left: 12, top: 783 - 170 - 8 })
    expect(overDisc({ ...above, ...wide }, disc)).toBe(false)
  })

  it('on a phone, with two things ringed one under the other near the foot, sits above them both', () => {
    const wide = { width: 366, height: 182 }
    const flags = [
      { left: 273, top: 720, width: 26, height: 23 },
      { left: 273, top: 756, width: 26, height: 23 },
    ]
    expect(placeBubble(wide, phone, flags, null, true)).toMatchObject({ left: 12, top: 720 - 182 - 8 })
  })
})
