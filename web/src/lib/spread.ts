import type { LrocAgreement, LrocCheck, LrocPhotoHeight, LrocPhotos, SiteSpread, SpreadRow, Summary } from '../data/contract'

/** A range this wide (points) is more than the model's measured error could explain. */
const WIDE_RANGE_POINTS = 10

/** "61–72%", or just "72%" when there's no real range. The shown value always falls inside. */
function rangeText([low, high]: [number, number], shown: number, unit: string): string {
  const from = Math.min(low, shown)
  const to = Math.max(high, shown)
  const left = Math.round(from)
  const right = Math.round(to)
  return left === right ? `${right}${unit}` : `${left}–${right}${unit}`
}

/** True when a value sits in the top quarter of a real range around it. */
function nearTheBest([low, high]: [number, number], shown: number): boolean {
  return high - low >= WIDE_RANGE_POINTS && shown >= high - (high - low) / 4
}

/** How this month's numbers change around the point, for anyone reading them as exact. */
export function spreadSentence(spread: SiteSpread, month: string, summary: Summary): string | null {
  const row: SpreadRow | undefined = spread.months.find((entry) => entry.month === month)
  if (!row) return null
  return (
    `Within ${spread.radius_m} m of this point, the same month reads: Sun up ` +
    `${rangeText(row.pct_sun, summary.pct_sun, '%')}, Earth up ${rangeText(row.pct_earth, summary.pct_earth, '%')}, ` +
    `both up ${rangeText(row.pct_both, summary.pct_both, '%')}, longest without Sun ` +
    `${rangeText(row.max_sun_gap_h, summary.max_sun_gap_h, ' h')}.` +
    (nearTheBest(row.pct_sun, summary.pct_sun) ? " So this site's Sun is close to the best nearby, not typical of it." : '')
  )
}

/** What NASA's estimate of terrain error does to the long-run Sun here, and how height matters. */
export function terrainErrorSentence(spread: SiteSpread): string | null {
  const { by_height: rows, n_clones: clones } = spread.terrain_error
  const at = (height: number) => rows.find((row) => row.obs_height_m === height)?.sun_any_pct
  const here = at(spread.obs_height_m)
  const lower = at(1)
  if (!here || clones === 0) return null
  const start = `Across ${clones} versions of NASA's 5 m terrain, varied by its own error estimate, long-run Sun here reads ${here.low}–${here.high}% at ${spread.obs_height_m} m up`
  return lower
    ? `${start} and ${lower.low}–${lower.high}% at 1 m. Close to the ground, small terrain errors matter far more.`
    : `${start}.`
}

function agreementWords(row: LrocAgreement): string {
  return `${row.rmse} points typically`
}

/** How the model compares with real photos of sunlight: the general result, then this site's. */
export function lrocNotes(check: LrocCheck, siteId: string): string[] {
  const { all_ground: all, well_lit: lit } = check.samples
  const years = `${check.period.start.slice(0, 4)}–${check.period.end.slice(2, 4)}`
  const notes = [
    `Against LROC's map of how often real photos show sunlight (${years}, 100 m pixels), our model differs by ` +
      `${agreementWords(all.ours_2m)} across south polar ground (correlation ${all.ours_2m.r}). On ground the photos ` +
      `show well lit, the agreement is much weaker: ${agreementWords(lit.ours_2m)}, correlation ${lit.ours_2m.r}. ` +
      `NASA's own map struggles there too (${agreementWords(lit.nasa_map)}, correlation ${lit.nasa_map.r}).`,
  ]
  const site = check.sites[siteId]
  if (site) {
    notes.push(
      `For the 100 m photo pixel holding this site, photos show sunlight ${site.photo_pct}% of that year. Our model ` +
        `across that patch says ${site.ours_ground_pct}% at ground level and ${site.ours_2m_pct}% for a point 2 m up. ` +
        `A photo sees the ground, and a panel on a mast sees more Sun than that.`,
    )
  }
  return notes
}

/** A gap this wide (points) between how often the model and clear photos show light is worth saying. */
const WIDE_LIT_GAP_POINTS = 10

/** Lowest and highest score when every photo counts, wherever the line between lit and dark falls. */
function scoreRange(height: LrocPhotoHeight): [number, number] | null {
  const scores = height.by_threshold
    .map((row) => row.balanced_agreement_pct)
    .filter((score): score is number => score !== null)
  return scores.length ? [Math.round(Math.min(...scores)), Math.round(Math.max(...scores))] : null
}

/** A site's result at ground level, in words; null if its photos were all lit or all dark. */
function sitePhotoNote(height: LrocPhotoHeight): string | null {
  const { clear, by_threshold: rows } = height
  const range = scoreRange(height)
  const total = rows[0]?.n_frames
  if (clear.balanced_agreement_pct === null || clear.wrong_sun_agreement_pct === null || !range || !total) return null
  const gap = clear.model_lit_pct - clear.photo_lit_pct
  return (
    `At this site's 100 m photo pixel, the model calls ${Math.round(clear.balanced_agreement_pct)}% right across the ` +
    `${clear.n_frames} clear photos (Sun out of step: ${Math.round(clear.wrong_sun_agreement_pct)}%). The other ` +
    `${total - clear.n_frames} are too dim to call; scoring every photo, at ${rows.length} different brightness cutoffs, gives ` +
    `${range[0]}–${range[1]}%. ` +
    (Math.abs(gap) >= WIDE_LIT_GAP_POINTS
      ? `In the clear photos the ground is lit ${Math.round(clear.photo_lit_pct)}% of the time, and the model has it ` +
        `lit ${Math.round(clear.model_lit_pct)}%, so don't rely on its percentage here. `
      : '') +
    `Photos see the ground, so this tests when light reaches this patch, not the Sun 2 m up.`
  )
}

/** The sharper test: was the ground lit at the moment of each dated photo? */
export function photoNotes(photos: LrocPhotos, siteId: string): string[] {
  const notes: string[] = []
  const lit = photos.groups.well_lit?.ground.clear
  if (lit?.balanced_agreement_pct != null && lit.wrong_sun_agreement_pct != null) {
    notes.push(
      `LROC's dated photos give a sharper test: did the model have the ground lit at the moment each was taken? On ` +
        `${photos.control_pixels} well-lit spots, across ${photos.frames_sampled} photos from ` +
        `${photos.first.slice(0, 4)}–${photos.last.slice(2, 4)}, it calls ${Math.round(lit.balanced_agreement_pct)}% of ` +
        `clear photos right at ground level, counting lit and dark equally. With the Sun half a month out of step, ` +
        `the same test scores ${Math.round(lit.wrong_sun_agreement_pct)}%.`,
    )
  }
  const site = photos.groups[siteId]
  const note = site ? sitePhotoNote(site.ground) : null
  if (note) notes.push(note)
  return notes
}
