import { describe, expect, it } from 'vitest'
import type { LrocCheck, LrocPhotoHeight, LrocPhotos, SiteSpread, Summary } from '../data/contract'
import { lrocNotes, photoNotes, spreadSentence, terrainErrorSentence } from './spread'

const row = {
  month: '2027-05',
  pct_sun: [50.2, 61.4] as [number, number],
  pct_earth: [55, 55] as [number, number],
  pct_both: [30, 45] as [number, number],
  max_sun_gap_h: [95, 140] as [number, number],
  max_earth_gap_h: [288, 288] as [number, number],
}
const stats = (low: number, high: number) => ({ mean: (low + high) / 2, sd: 1, low, high })
const spread = {
  radius_m: 100,
  obs_height_m: 2,
  months: [row],
  terrain_error: {
    n_clones: 100,
    by_height: [
      { obs_height_m: 1, sun_any_pct: stats(70, 88), earth_any_pct: stats(58, 58) },
      { obs_height_m: 2, sun_any_pct: stats(89, 91), earth_any_pct: stats(58, 58) },
    ],
  },
} as unknown as SiteSpread
const summary = { pct_sun: 60, pct_earth: 55, pct_both: 39, max_sun_gap_h: 118 } as Summary

describe('spreadSentence', () => {
  it('gives each range for the month', () => {
    expect(spreadSentence(spread, '2027-05', { ...summary, pct_sun: 55 })).toBe(
      'Within 100 m of this point, the same month reads: Sun up 50–61%, Earth up 55%, both up 30–45%, longest without Sun 95–140 h.',
    )
  })

  it('always includes the number shown beside it', () => {
    expect(spreadSentence(spread, '2027-05', { ...summary, pct_sun: 62 })).toContain('Sun up 50–62%')
  })

  it('says nothing for a month it has no range for', () => {
    expect(spreadSentence(spread, '2028-01', summary)).toBeNull()
  })
})

describe('how a site compares with the ground around it', () => {
  it('says when the number is near the best of a wide range', () => {
    const near = { ...spread, months: [{ ...row, pct_sun: [20, 60] as [number, number] }] }
    expect(spreadSentence(near, '2027-05', { ...summary, pct_sun: 59 })).toContain('close to the best nearby')
  })

  it('stays quiet when the number is mid-range or the range is narrow', () => {
    const wide = { ...spread, months: [{ ...row, pct_sun: [20, 60] as [number, number] }] }
    expect(spreadSentence(wide, '2027-05', { ...summary, pct_sun: 40 })).not.toContain('best nearby')
    const narrow = { ...spread, months: [{ ...row, pct_sun: [58, 60] as [number, number] }] }
    expect(spreadSentence(narrow, '2027-05', { ...summary, pct_sun: 60 })).not.toContain('best nearby')
  })
})

describe('terrainErrorSentence', () => {
  it('shows how much more terrain error matters close to the ground', () => {
    expect(terrainErrorSentence(spread)).toBe(
      "Across 100 versions of NASA's 5 m terrain, varied by its own error estimate, long-run Sun here reads 89–91% at 2 m up and 70–88% at 1 m. Close to the ground, small terrain errors matter far more.",
    )
  })
})

describe('lrocNotes', () => {
  const agree = (rmse: number, r: number) => ({ n: 150, bias: 0, rmse, r })
  const check = {
    period: { start: '2010-02-15T00:00:00Z', end: '2011-02-05T00:00:00Z', step_h: 2 },
    samples: {
      all_ground: { ours_ground: agree(2.6, 0.97), ours_2m: agree(2.9, 0.97), nasa_map: agree(4, 0.96) },
      well_lit: { ours_ground: agree(17, 0.1), ours_2m: agree(9.7, 0.31), nasa_map: agree(17, 0.29) },
    },
    sites: { ridge: { photo_pct: 39.3, ours_ground_pct: 42, ours_2m_pct: 80, nasa_map_pct: 68 } },
  } as unknown as LrocCheck

  it('leads with the general result and is open about well-lit ground', () => {
    const [general] = lrocNotes(check, 'elsewhere')
    expect(general).toContain('2.9 points typically')
    expect(general).toContain('much weaker: 9.7 points')
    expect(general).toContain('2010–11')
  })

  it('adds the photo pixel at a ridge site, and says what it can and cannot show', () => {
    const notes = lrocNotes(check, 'ridge')
    expect(notes).toHaveLength(2)
    expect(notes[1]).toContain('sunlight 39.3%')
    expect(notes[1]).toContain('42% at ground level')
    expect(notes[1]).toContain('A photo sees the ground')
  })
})

describe('photoNotes', () => {
  const score = (over: Partial<LrocPhotoHeight['clear']> = {}) => ({
    n_frames: 149,
    photo_lit_pct: 65,
    model_lit_pct: 66,
    balanced_agreement_pct: 96.6,
    wrong_sun_agreement_pct: 74.2,
    interval_pct: [92.8, 99.5] as [number, number],
    ...over,
  })
  const height = (clear = score()): LrocPhotoHeight => ({
    fitted: score({ n_frames: 223 }),
    clear,
    by_threshold: [0.001, 0.003, 0.005].map((threshold, i) => ({
      ...score({ n_frames: 223, balanced_agreement_pct: 78 + 4 * i }),
      threshold,
    })),
  })
  const photos = (ridge = height()) =>
    ({
      frames_sampled: 235,
      first: '2010-02-15T18:56:15Z',
      last: '2011-10-14T12:37:15Z',
      control_pixels: 8,
      groups: {
        ridge: { ground: ridge, up_2m: height() },
        well_lit: { ground: height(score({ balanced_agreement_pct: 91.6, wrong_sun_agreement_pct: 31.6 })), up_2m: height() },
      },
    }) as unknown as LrocPhotos

  it('gives the general result anywhere near the pole, with its control', () => {
    const notes = photoNotes(photos(), 'elsewhere')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('8 well-lit spots, across 235 photos from 2010–11')
    expect(notes[0]).toContain('calls 92% of clear photos right')
    expect(notes[0]).toContain('scores 32%')
  })

  it('reports the photos it could not call, and the range across cutoffs, at a site', () => {
    const [, site] = photoNotes(photos(), 'ridge')
    expect(site).toContain('calls 97% right across the 149 clear photos (Sun out of step: 74%)')
    expect(site).toContain('The other 74 are too dim to call')
    expect(site).toContain('gives 78–86%')
    expect(site).toContain('not the Sun 2 m up')
    expect(site).not.toContain("don't rely")
  })

  it('says so when the model and the photos differ on how often the ground is lit', () => {
    const [, site] = photoNotes(photos(height(score({ photo_lit_pct: 69.7, model_lit_pct: 46.6 }))), 'ridge')
    expect(site).toContain("lit 70% of the time, and the model has it lit 47%, so don't rely on its percentage here")
  })

  it('leaves out a site whose photos cannot give a score', () => {
    const notes = photoNotes(photos(height(score({ balanced_agreement_pct: null }))), 'ridge')
    expect(notes).toHaveLength(1)
  })
})
