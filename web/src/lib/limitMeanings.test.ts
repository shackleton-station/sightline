import { describe, expect, it } from 'vitest'
import { BASE_HEIGHT_M } from './heights'
import { advancedMeanings, ANGLES_TO_CENTER, earthWidthDeg, IN_VIEW, LIMIT_NAMES, limitMeanings, MARGINAL_MEANS, meaningLine, meaningOf, SUN_SHARE_KEPT } from './limitMeanings'
import { EARTH_CLEARANCES_DEG } from './mission'
import { MARGINAL_SUN_SHARE } from './sightlineMission'
import { EDGE_ONLY_UNDER } from './sightlineSky'

/** How many sentences a text holds, counted as the page's check of hover texts counts them. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"])/).length

const all = [...limitMeanings({ overM: 5, siteName: 'Haworth' }), ...advancedMeanings()]
const everyWord = [...all.map(meaningLine), ...limitMeanings(null).map(meaningLine), IN_VIEW, SUN_SHARE_KEPT, MARGINAL_MEANS, ANGLES_TO_CENTER].join(' ')

describe('what each limit means', () => {
  it('has a line for each of the six basic limits and the three Advanced controls, under the controls’ own names', () => {
    expect(limitMeanings(null).map((meaning) => meaning.name)).toEqual(['Mission length', 'Longest dark spell', 'The Sun is in view at landing', 'Earth is in view at landing', 'Radio silence', 'Steepest ground'])
    expect(advancedMeanings().map((meaning) => meaning.name)).toEqual(['Earth must clear the skyline by', 'Solar panel height', 'Antenna height'])
    for (const meaning of all) expect(meaning.name).toBe(LIMIT_NAMES[meaning.id])
  })

  it('keeps each hover text to two sentences, and never just the label', () => {
    for (const meaning of all) {
      expect(sentences(meaning.means), meaning.name).toBeLessThanOrEqual(2)
      expect(meaningOf(meaning.id)).toBe(meaning.means)
      expect(meaning.means).not.toBe(meaning.name)
    }
  })

  it('says what the slope is measured across from the site’s own data, and gives no figure without a site', () => {
    const line = (from: Parameters<typeof limitMeanings>[0]) => meaningLine(limitMeanings(from)[5])
    expect(line({ overM: 40, siteName: 'Haworth' })).toBe("The steepest slope the lander can set down on. The slope is measured across 40 m of NASA's terrain map at Haworth, so rocks do not show.")
    expect(line(null)).toBe("The steepest slope the lander can set down on. The slope is read from NASA's terrain map, so rocks do not show.")
  })

  it('gives Earth’s width from its radius and the Moon’s mean distance, and the clearances the data has flags for', () => {
    expect(earthWidthDeg()).toBeCloseTo(1.9, 1)
    const line = meaningLine(advancedMeanings()[0])
    expect(line).toContain('about 1.9° wide')
    expect(line).toContain(`${EARTH_CLEARANCES_DEG[0]}° or ${EARTH_CLEARANCES_DEG[1]}°`)
    expect(line).not.toMatch(/dB|percent|%/)
  })

  it('defines in view in one sentence, at the height the data is worked out for', () => {
    expect(sentences(IN_VIEW)).toBe(1)
    expect(IN_VIEW).toContain(`${BASE_HEIGHT_M} m above the ground`)
    expect(IN_VIEW).toContain('any part of its disc')
  })

  it('says "less than half" of a disc is marginal because that is the rule the verdict uses', () => {
    expect(MARGINAL_SUN_SHARE).toBe(0.5)
    expect(EDGE_ONLY_UNDER).toBe(0.5)
    expect(MARGINAL_MEANS).toContain('less than half of that disc')
  })

  it('keeps to the page’s words', () => {
    expect(everyWord).not.toMatch(/lunar night|lunar day|playhead|scrub|\bridge\b|centre|practice demo/i)
  })
})
