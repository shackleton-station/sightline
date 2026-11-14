import { describe, expect, it } from 'vitest'
import { monthSpans } from '../lib/grid'
import { isoAt, type Landing, landingAt, monthAnswer, pickBest, slipCheck, viableFor } from './monthAnswer'
import { A, B, C, HOURS, MISSION, START } from './testSites'

const [JAN, FEB] = monthSpans(START, HOURS)
const landing = (hour: number) => landingAt(A.site, A.flags, MISSION, viableFor(A.flags, MISSION), hour)

describe('one site in one month', () => {
  it('turns an hour count into a UTC time', () => {
    expect(isoAt(START, 0)).toBe('2027-01-01T00:00:00Z')
    expect(isoAt(START, 480)).toBe('2027-01-21T00:00:00Z')
  })

  it('finds the landing windows, cut to the month', () => {
    const jan = monthAnswer(A.site, A.flags, MISSION, JAN)
    expect(jan.windows).toEqual([
      { from: 0, to: 205, opensBefore: false, staysOpenAfter: false },
      { from: 480, to: 744, opensBefore: false, staysOpenAfter: true },
    ])
    expect(jan.days).toBe(20)
    expect(jan.dayHours.slice(7, 10)).toEqual([24, 13, 0])
    expect(jan.dayHours).toHaveLength(31)

    const feb = monthAnswer(A.site, A.flags, MISSION, FEB)
    expect(feb.windows).toEqual([{ from: 744, to: 1369, opensBefore: true, staysOpenAfter: false }])
    expect(feb.days).toBe(27)
    expect(feb.dayHours).toHaveLength(28)
  })

  it('measures a landing and its room to slip', () => {
    expect(landing(0)).toMatchObject({ t: '2027-01-01T00:00:00Z', problems: [], sunGapH: 0, earthGapH: 0, sunPct: 100, roomH: 204 })
    // Landing at hour 204 leaves the last 12 hours of the mission in the dark: the limit exactly.
    expect(landing(204)).toMatchObject({ problems: [], sunGapH: 12, roomH: 0 })
    expect(landing(205).problems).toHaveLength(1)
    expect(landing(205).roomH).toBe(0)
  })

  it('picks the least dark landing, then the one with the most room to slip', () => {
    // Every landing up to hour 194, and every one from 480, sees 2 h of night or less: hourly data
    // can't separate them. Hour 480 has the most room, the whole second window.
    const jan = monthAnswer(A.site, A.flags, MISSION, JAN)
    expect(jan.best).toMatchObject({ hour: 480, sunGapH: 0, roomH: 888 })
  })

  it('prefers less dark to more room', () => {
    const make = (hour: number, sunGapH: number, earthGapH: number, roomH: number, problems: string[] = []): Landing => ({
      hour,
      t: isoAt(START, hour),
      problems,
      sunPct: 50,
      sunGapH,
      earthGapH,
      roomH,
    })
    expect(pickBest([make(1, 10, 0, 500), make(2, 4, 0, 3), make(3, 6, 0, 9)]).hour).toBe(3)
    // Within 2 h on Sun, Earth decides.
    expect(pickBest([make(1, 4, 30, 500), make(2, 5, 3, 3)]).hour).toBe(2)
    // A landing that misses fewer limits is closer, whatever its numbers.
    expect(pickBest([make(1, 0, 0, 0, ['x', 'y']), make(2, 50, 50, 0, ['x'])]).hour).toBe(2)
    // A mission that runs past the data has no numbers to compare.
    expect(pickBest([{ ...make(1, 0, 0, 0, ['x']), sunGapH: null, earthGapH: null, sunPct: null }]).hour).toBe(1)
  })

  it('gives the closest miss when nothing works', () => {
    const none = monthAnswer(B.site, B.flags, MISSION, JAN)
    expect(none.days).toBe(0)
    expect(none.windows).toEqual([])
    expect(none.best.problems.length).toBeGreaterThan(0)
    expect(none.best.roomH).toBe(0)
    // Site c in February: the Sun set in January, so every landing misses, and the first hour is as close as any.
    expect(monthAnswer(C.site, C.flags, MISSION, FEB).best.hour).toBe(FEB.from)
  })
})

describe('the slip check', () => {
  it('holds when the window outlasts the slip', () => {
    const check = slipCheck(A.flags, MISSION, landing(0), 7)
    expect(check).toMatchObject({ landingWorks: true, holds: true, lastGood: '2027-01-09T12:00:00Z' })
    expect(check.byDay).toEqual([true, true, true, true, true, true, true])
    // After the window closes at hour 205, the next landing is hour 480.
    expect(check.next).toMatchObject({ t: '2027-01-21T00:00:00Z', month: '2027-01', index: 480, waitH: 480 })
  })

  it('breaks when the window closes first, and says when the next one opens', () => {
    const check = slipCheck(A.flags, MISSION, landing(200), 7)
    expect(check).toMatchObject({ landingWorks: true, holds: false, lastGood: '2027-01-09T12:00:00Z' })
    expect(check.byDay).toEqual(new Array(7).fill(false))
    expect(check.next?.waitH).toBe(280)
    // Twelve days late is hour 488, inside the second window.
    expect(slipCheck(A.flags, MISSION, landing(200), 14).byDay.slice(10, 13)).toEqual([false, true, true])
  })

  it('looks from the hour itself when the landing already misses', () => {
    const check = slipCheck(A.flags, MISSION, landing(300), 7)
    expect(check).toMatchObject({ landingWorks: false, holds: false, lastGood: null })
    expect(check.next).toMatchObject({ t: '2027-01-21T00:00:00Z', waitH: 180 })
  })

  it('marks slips past the end of the data, and finds nothing after the last window', () => {
    const check = slipCheck(A.flags, MISSION, landing(1368), 3)
    expect(check.byDay).toEqual([false, null, null])
    expect(check.next).toBeNull()
  })
})
