import { describe, expect, it } from 'vitest'
import { CSA_ROVER, ROVER_PRESET, roverMissionDays } from './csaRover'

describe('the Canadian utility rover idea', () => {
  it('selects the app’s Long stay', () => {
    expect(ROVER_PRESET.label).toBe('Long stay')
  })

  it('says what the Long stay asks for, in days, from the preset itself', () => {
    const { missionDays, maxSunGapH } = ROVER_PRESET.mission.requirements
    // The Long stay sets no limit on time without Earth, so there are no days to give for it.
    expect(roverMissionDays()).toEqual({ stay: missionDays, dark: maxSunGapH / 24, silent: null })
  })

  it('points at the Canadian Space Agency’s own page', () => {
    expect(new URL(CSA_ROVER.url).hostname).toBe('www.asc-csa.gc.ca')
  })
})
