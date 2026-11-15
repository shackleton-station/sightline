import { describe, expect, it } from 'vitest'
import type { SiteFlags } from '../lib/flags'
import { landingVerdict, marginalAtLanding, type VerdictState } from '../lib/landingVerdict'
import { NO_GAP_LIMIT_H } from '../lib/mission'
import { DEFAULT_MISSION, type ScenarioMeasure } from '../lib/sightlineMission'
import { landingWords, missionFacts, missionWords, stampWords } from '../planner/words'
import { compareGroups, plannerCsv } from './plannerTable'
import type { LandingShares } from './useScenarioFacts'

const START = '2027-01-01T00:00:00Z'
const HOURS = 60 * 24
const flags = { start: START, sun: new Array(HOURS).fill(true), earth: new Array(HOURS).fill(true), earthAbove: {} } as unknown as SiteFlags
const mission = DEFAULT_MISSION
const discs = (sun: number, earth: number): LandingShares => ({ sun, earth, earthUp: true, sunElDeg: 1, earthElDeg: 1, sunAboveDeg: 1, earthAboveDeg: 1 })
const measure = (problems: string[]): ScenarioMeasure => ({ sunPct: 60, earthPct: 100, sunGapH: 20, earthGapH: 0, slopeDeg: 2, problems })

/** One landing of each kind: a plain fit, a fit on the edge of Earth alone, and a miss. */
const CASES: { name: string; state: VerdictState; problems: string[]; at: LandingShares }[] = [
  { name: 'a plain fit', state: 'fits', problems: [], at: discs(1, 1) },
  { name: 'a marginal fit', state: 'marginal', problems: [], at: discs(1, 0.004) },
  { name: 'a miss', state: 'miss', problems: ['The Sun is gone for 95 h during the mission; your limit is 24 h.'], at: discs(1, 1) },
]

describe('one verdict on a landing, wherever it is said', () => {
  const scenarios = CASES.map((_, i) => ({ site: 'a', landing: i * 24 }))
  const measures = CASES.map((one) => measure(one.problems))
  const landings = CASES.map((one) => one.at)
  const groups = compareGroups({ scenarios, siteIds: ['a', 'a', 'a'], measures, flags: [flags, flags, flags], mission, landings, shadow: null })
  const fits = groups[0].rows[0]
  const csv = plannerCsv(START, scenarios, ['A', 'A', 'A'], groups.flatMap((group) => group.rows), measures, 'the mission', landings.map((at) => marginalAtLanding(mission.requirements, at)))
  const csvCells = csv.split('\n').find((line) => line.startsWith('Fits the mission'))!

  CASES.forEach((one, i) => {
    it(`${one.name}: the plan column, the Planner's Compare tab, the exported table and the brief agree`, () => {
      // The plan column and the Compare panel: the verdict's own function.
      const column = landingVerdict(one.problems, marginalAtLanding(mission.requirements, one.at))
      expect(column.state).toBe(one.state)
      // The Planner's Compare tab.
      expect(fits.verdicts?.[i]).toBe(one.state)
      expect(fits.cells[i]?.startsWith(column.mark)).toBe(true)
      // The exported table.
      expect(csvCells).toMatch({ fits: /,yes(,|$)/, marginal: /yes, marginal: only the edge of Earth is in view at landing/, miss: /no: The Sun is gone for 95 h/ }[one.state])
      // The written brief: its stamp and the heading over its landing.
      expect(stampWords(9, column.state, column.mark)).toBe({ fits: '✓ Fits', marginal: '◇ Fits, marginal', miss: '✗ Does not fit' }[one.state])
      expect(landingWords(true, 9, 'May 2027', column.state).heading).toBe(one.state === 'fits' ? 'Best landing this month' : 'This landing')
    })
  })

  it('writes a marginal fit in the Compare tab with its mark and its reason, and never as a plain "Yes"', () => {
    expect(fits.cells).toEqual(['✓ Yes', '◇ Yes, marginal: only the edge of Earth is in view at landing', '✗ No: Sun down for 95 h; your limit is 24 h'])
    expect(fits.fits).toEqual([true, true, false])
  })

  it('keeps "No landing" as the stamp of a month with none', () => {
    expect(stampWords(0, 'miss', '✗')).toBe('No landing')
  })
})

describe('a limit that is not set', () => {
  const requirements = { ...mission.requirements, maxEarthGapH: NO_GAP_LIMIT_H }

  it('is written "no limit" in the brief, never as hours', () => {
    expect(missionWords(requirements)).toBe('A 14-day mission that can go up to 24 h without the Sun, with no limit on time without Earth, landing with the Sun up and Earth in view. Earth counts as in view when any part of it shows.')
    const facts = missionFacts({ hour: 0, t: START, problems: [], sunPct: 60, sunGapH: 20, earthGapH: 150, roomH: 0 }, requirements)
    expect(facts[1]).toBe('Earth is never out of view for longer than 6 d 6 h (you set no limit).')
    expect(`${missionWords(requirements)} ${facts.join(' ')}`).not.toMatch(/9999/)
  })
})
