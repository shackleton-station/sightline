import { describe, expect, it } from 'vitest'
import { chipWords, discView, earthLine, landingSentence, earthShare, groundLine, marginalReasons, nextWords, shortReason, shortWhen, showingWords, skylineFigure, stateSentence, sunLine } from './sightlineSky'

describe("Earth's share", () => {
  it('is half the disc with its centre on the skyline, all of it a radius above, none a radius below', () => {
    expect(earthShare(0, 0.95)).toBeCloseTo(0.5, 6)
    expect(earthShare(0.95, 0.95)).toBe(1)
    expect(earthShare(-0.95, 0.95)).toBe(0)
    expect(earthShare(2, 0.95)).toBe(1)
  })

  it("is under half when the centre is below the skyline and the upper edge still clears it", () => {
    // Earth's centre 0.9° below the skyline with a radius of 0.95°: a thin edge shows.
    const share = earthShare(-0.9, 0.95)
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(0.02)
    expect(discView(share)).toBe('part')
    // A hair's breadth that the pipeline's flag counts as in view is still "part", never "hidden"; and the other way round.
    expect(discView(0.002, true)).toBe('part')
    expect(discView(0.002)).toBe('hidden')
    expect(discView(0.3, false)).toBe('hidden')
  })
})

describe('the state sentence', () => {
  it('treats Earth as the Sun is treated: a disc the skyline cuts is partly in view', () => {
    expect(stateSentence(1, 1, true)).toBe('Sunlit, Earth in view')
    expect(stateSentence(0.26, 1, true)).toBe('Partly sunlit, Earth in view')
    expect(stateSentence(1, 0.01, true)).toBe('Sunlit, Earth partly in view')
    expect(stateSentence(1, 0.002, true)).toBe('Sunlit, Earth partly in view')
    expect(stateSentence(0, 0, false)).toBe('No sunlight, Earth out of view')
  })

  it("falls back on the hourly flag while Earth's size is not known", () => {
    expect(stateSentence(1, null, true)).toBe('Sunlit, Earth in view')
    expect(stateSentence(1, null, false)).toBe('Sunlit, Earth out of view')
  })
})

describe("the time bar's chip", () => {
  it('says when only part of Earth shows', () => {
    expect(chipWords(true, true, 1)).toBe('Sun and Earth')
    expect(chipWords(true, true, 0.3)).toBe('Sun, part of Earth')
    expect(chipWords(false, true, 0.3)).toBe('Part of Earth')
    expect(chipWords(true, true, 0.002)).toBe('Sun, part of Earth')
    expect(chipWords(false, true, null)).toBe('Earth only')
    expect(chipWords(true, false, 0)).toBe('Sun only')
    expect(chipWords(false, false, 0)).toBe('Neither')
  })
})

describe('a row', () => {
  it('leads with the distance from the skyline and says which side', () => {
    expect(skylineFigure(1.44)).toEqual({ figure: '1.4°', side: 'above the skyline' })
    expect(skylineFigure(-0.2)).toEqual({ figure: '0.2°', side: 'below the skyline' })
    expect(skylineFigure(-0.04)).toEqual({ figure: '0.0°', side: 'above the skyline' })
  })

  it('says what comes next without a year', () => {
    expect(nextWords('Sun', true, 103)).toBe('sets in 4 d 7 h')
    expect(nextWords('Earth', false, 5)).toBe('rises in 5 h')
    expect(nextWords('Earth', true, null)).toBe('stays in view')
    expect(nextWords('Earth', false, null)).toBe('stays hidden')
    expect(nextWords('Sun', true, null)).toBe('stays up')
    expect(nextWords('Sun', false, null)).toBe('stays down')
  })

  it('writes the small lines', () => {
    // One short line each: the elevation is in the row's hover text, and a cut disc's share is a line of its own.
    expect(sunLine(true, 103, 359.4)).toBe('sets in 4 d 7 h · 359 W/m²')
    expect(sunLine(false, null, 0)).toBe('stays down · 0 W/m²')
    expect(earthLine(true, 147)).toBe('sets in 6 d 3 h')
    expect(earthLine(true, null)).toBe('stays in view')
    expect(showingWords(0.26, true)).toBe('26% of the disc showing')
    expect(showingWords(1, true)).toBeNull()
    expect(landingSentence(0.26, 1, true)).toBe('At landing: partly sunlit, Earth in view')
    expect(landingSentence(0, null, false)).toBe('At landing: no sunlight, Earth out of view')
    expect(showingWords(0.004, false)).toBeNull()
    expect(showingWords(1, true)).toBeNull()
    expect(showingWords(0.01, true)).toBe('1% of the disc showing')
  })

  it('judges the ground against the limit', () => {
    expect(groundLine(5.1, 10)).toEqual({ text: 'within your 10° limit', fails: false })
    expect(groundLine(12.3, 10)).toEqual({ text: 'steeper than your 10° limit', fails: true })
  })
})

describe('a marginal landing', () => {
  it('is one with a sliver of the Sun, or only the edge of Earth, at landing', () => {
    expect(marginalReasons(0.05, 1, true)).toEqual(["5% of the Sun's disc is in view at landing"])
    expect(marginalReasons(1, 0.02, true)).toEqual(['only the edge of Earth is in view at landing'])
    expect(marginalReasons(1, 0, true)).toEqual(['only the edge of Earth is in view at landing'])
    expect(marginalReasons(0.05, 0.02, true)).toHaveLength(2)
    expect(marginalReasons(1, 1, true)).toEqual([])
    // The Sun down, Earth out of view, or shares not yet known: nothing to call marginal.
    expect(marginalReasons(0, 0, false)).toEqual([])
    expect(marginalReasons(null, null, true)).toEqual([])
  })
})

describe('a reason on one line', () => {
  it("keeps the app's numbers and says skyline", () => {
    expect(shortReason('The Sun is gone for 95 h during the mission; your limit is 24 h.')).toBe('Sun down for 95 h; your limit is 24 h')
    expect(shortReason('Earth is gone for 327 h during the mission; your limit is 48 h.')).toBe('Earth out of view for 327 h; your limit is 48 h')
    expect(shortReason('Earth is less than 2° above the terrain for 40 h during the mission; your limit is 24 h.')).toBe('Earth under 2° above the skyline for 40 h; your limit is 24 h')
    expect(shortReason('The Sun is down at landing.')).toBe('Sun down at landing')
    expect(shortReason('Earth is out of view at landing.')).toBe('Earth out of view at landing')
    expect(shortReason('Earth is less than 2° above the terrain at landing.')).toBe('Earth under 2° above the skyline at landing')
    expect(shortReason('The ground slopes 12.3°; your limit is 10°.')).toBe('Ground slopes 12.3°; your limit is 10°')
    expect(shortReason('The mission runs past the end of the data.')).toBe('Mission runs past the end of the data')
    expect(shortReason('Something new.')).toBe('Something new')
  })

  it('writes the next landing without its year when it is the same year', () => {
    expect(shortWhen('1 June 2027 · 18:00 UTC', '2027')).toBe('1 June · 18:00')
    expect(shortWhen('3 January 2028 · 04:00 UTC', '2027')).toBe('3 January 2028 · 04:00')
  })
})
