import { describe, expect, it } from 'vitest'
import { monthSpans } from '../lib/grid'
import { landingAt, monthAnswer, slipCheck, viableFor } from './monthAnswer'
import { A, B, C, HOURS, MISSION, START } from './testSites'
import { cellWords, dayUtc, landingWords, looseningWords, missionFacts, missionWords, placeWords, plural, shortWhen, slipWords, verdictWords, whenUtc, windowWords } from './words'

const [JAN, FEB] = monthSpans(START, HOURS)
const viable = viableFor(A.flags, MISSION)
const landing = (hour: number) => landingAt(A.site, A.flags, MISSION, viable, hour)

describe('dates and places', () => {
  it('writes times in UTC, and says so', () => {
    expect(dayUtc('2027-05-03T06:00:00Z')).toBe('3 May 2027')
    expect(whenUtc('2027-05-13T06:00:00Z')).toBe('13 May 2027, 06:00 UTC')
    expect(shortWhen('2027-05-13T06:00:00Z')).toBe('13 May, 06:00')
  })

  it('writes a place the way the site picker does', () => {
    expect(placeWords(-89.45267, -137.14865)).toBe('89.453°S, 137.149°W')
    expect(placeWords(0.67416, 23.47314)).toBe('0.674°N, 23.473°E')
  })

  it('counts in plain words', () => {
    expect([plural(1, 'day'), plural(2, 'day'), plural(0, 'window')]).toEqual(['1 day', '2 days', '0 windows'])
  })
})

describe('a grid cell in words', () => {
  it('says the site, the month and the count', () => {
    expect(cellWords('Connecting Ridge', '2027-05', 5)).toBe('Connecting Ridge, May 2027: a landing meets your limits on 5 days.')
    expect(cellWords('Connecting Ridge', '2027-05', 1)).toBe('Connecting Ridge, May 2027: a landing meets your limits on 1 day. Tight.')
    expect(cellWords('Connecting Ridge', '2027-05', 0)).toBe('Connecting Ridge, May 2027: no landing meets your limits.')
  })
})

describe('the mission in words', () => {
  it('states every limit', () => {
    expect(missionWords(MISSION)).toBe(
      'A 2-day mission that can go up to 12 h without the Sun and 12 h without Earth, landing with the Sun up. Earth counts as in view when any part of it shows.',
    )
    expect(missionWords({ ...MISSION, sunAtLanding: false, minEarthClearanceDeg: 5 })).toContain('landing at any hour. Earth counts as in view when its center is 5° above the terrain.')
    expect(missionWords({ ...MISSION, earthAtLanding: true })).toContain('landing with the Sun up and Earth in view.')
    expect(missionWords({ ...MISSION, sunAtLanding: false, earthAtLanding: true })).toContain('landing with Earth in view.')
  })
})

describe('the verdict', () => {
  it('says how many landing days there are', () => {
    const verdict = verdictWords('A', '2027-01', MISSION, monthAnswer(A.site, A.flags, MISSION, JAN))
    expect(verdict).toEqual({ status: 'works', headline: '20 landing days', sentence: 'A 2-day mission can land at A in Jan 2027 on 20 days, in 2 windows.' })
  })

  it('says when a month is tight, and when nothing works', () => {
    expect(verdictWords('C', '2027-01', MISSION, monthAnswer(C.site, C.flags, MISSION, JAN))).toEqual({
      status: 'tight',
      headline: 'Tight: 2 landing days',
      sentence: 'A 2-day mission can land at C in Jan 2027, but only on 2 days, in 1 window.',
    })
    expect(verdictWords('B', '2027-02', MISSION, monthAnswer(B.site, B.flags, MISSION, FEB))).toEqual({
      status: 'none',
      headline: 'No landing works',
      sentence: 'No landing at B in Feb 2027 survives a 2-day mission within your limits.',
    })
  })

  it('writes a window with its length and whether it runs past the month', () => {
    const jan = monthAnswer(A.site, A.flags, MISSION, JAN)
    expect(windowWords(START, jan.windows[0])).toBe('1 Jan, 00:00 to 9 Jan, 12:00 (8 d 13 h)')
    expect(windowWords(START, jan.windows[1])).toBe('21 Jan, 00:00 to 31 Jan, 23:00 (11 d 0 h; stays open into the next month)')
    expect(windowWords(START, { from: 5, to: 6, opensBefore: false, staysOpenAfter: false })).toBe('1 Jan, 05:00 (1 h)')
    expect(windowWords(START, { from: 744, to: 750, opensBefore: true, staysOpenAfter: false })).toContain('open since the month before')
  })

  it('describes the mission after a landing', () => {
    expect(missionFacts(landing(0), MISSION)).toEqual(['The Sun never sets during the mission.', 'Earth never leaves view.'])
    expect(missionFacts(landing(204), MISSION)[0]).toBe('The Sun is up for 75% of the mission, and is never gone for longer than 12 h (your limit: 12 h).')
    expect(missionFacts({ ...landing(0), sunGapH: null }, MISSION)).toEqual([])
  })
})

describe('the slip check in words', () => {
  const words = (hour: number, days: number) => slipWords(slipCheck(A.flags, MISSION, landing(hour), days), landing(hour))

  it('says yes when the window outlasts the slip', () => {
    expect(words(0, 7)).toEqual({
      answer: 'yes',
      headline: 'Yes: any landing up to 7 days late still works',
      sentences: ["This window's last landing hour is 9 Jan 2027, 12:00 UTC, 8 d 12 h after this one."],
    })
  })

  it('says how much slip is safe, and when the next landing is', () => {
    expect(words(200, 7)).toEqual({
      answer: 'partly',
      headline: 'Only for a slip of up to 4 h',
      sentences: [
        "This window's last landing hour is 9 Jan 2027, 12:00 UTC, 4 h after this one.",
        'The next landing that works here is 21 Jan 2027, 00:00 UTC, 11 d 16 h after this one.',
      ],
    })
    expect(words(200, 14).sentences[1]).toBe('A landing works again from 21 Jan 2027, 00:00 UTC, 11 d 16 h after this one.')
  })

  it('says no when the last hour of a window has nothing after it in time', () => {
    expect(words(204, 7)).toMatchObject({ answer: 'no', headline: 'No: nothing else works within 7 days' })
    expect(words(204, 14)).toMatchObject({ answer: 'partly', headline: 'No room right now, but a landing works again within 14 days' })
    expect(words(204, 1).headline).toBe('No: nothing else works within 1 day')
  })

  it('says so when the landing already misses, or nothing is left in the data', () => {
    expect(words(300, 7)).toMatchObject({ answer: 'misses', headline: 'This landing already misses your limits' })
    expect(words(1368, 7).sentences).toContain('Nothing later in our data works at this site.')
  })
})

describe('what a limit costs, in words', () => {
  it('counts the squares that would open', () => {
    expect(looseningWords({ what: 'sun', withLanding: 374 })).toBe('With no limit on time without the Sun: 374 site-and-month squares would have a landing.')
    expect(looseningWords({ what: 'earth', withLanding: 1 })).toBe('With no limit on time without Earth: 1 site-and-month square would have a landing.')
    expect(looseningWords({ what: 'landing', withLanding: 0 })).toBe('With no need for the Sun or Earth at landing: still nothing.')
  })
})

describe('what the brief calls its landing', () => {
  it('in a month with landings, names the best one and offers to use it', () => {
    expect(landingWords(true, 9, 'May 2027')).toEqual({ heading: 'Best landing this month', note: null, back: 'Use the best landing' })
    expect(landingWords(false, 9, 'May 2027')).toEqual({ heading: 'This landing', note: null, back: 'Use the best landing' })
  })

  it('in a month with none, never calls the nearest miss a landing: the three statements on the brief agree', () => {
    const said = landingWords(true, 0, 'May 2027')
    // The verdict says no landing works; this says the hour shown is a miss; the slip check gives the next landing that works.
    expect(said.heading).toBe('Closest to your limits in May 2027: still a miss')
    expect(said.note).toBe('No hour in May 2027 meets your limits. This is the hour that misses the fewest of them.')
    expect(said.back).toBe('Back to the hour closest to your limits')
    expect(`${said.heading} ${said.note} ${said.back}`).not.toMatch(/closest landing|best landing/i)
    expect(landingWords(false, 0, 'May 2027').back).not.toMatch(/landing/i)
  })
})
