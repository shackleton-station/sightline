/**
 * How much NASA data Sightline works through, as plain counts: the figures the Guide's "By the
 * numbers" strip, the front page's line and the README show. Each is worked out from the pipeline's
 * own files (range.json, light/meta.json, horizons.json, lroc-photos.json, sites.json), so a figure
 * changes when the data does. The one figure no shipped file holds is a constant with its source.
 */

/**
 * NASA terrain the pipeline reads, in GB: LOLA's 20 m south-polar model (2.70 GB), its whole-Moon
 * model (2.12 GB) and the 5 m models of the ridge sites with their slope and error files (17.05 GB).
 * docs/DETAILS.md gives "about 21 GB" for what `run_all.py` downloads; the files themselves, added
 * up on 2026-11-15, are 21.9 billion bytes (20.4 GiB). LROC's polar photo mosaic (8.3 GB), NASA's
 * long-run maps and the kernels are read too and are not counted here.
 */
export const NASA_TERRAIN_READ_GB = 21

/** The Sun and Earth: each point is asked about both, every hour. */
const BODIES = 2

/** A square grid of points and the months it was computed for, as light/meta.json gives them. */
export interface GridSpan {
  /** Points along one side. */
  size: number
  /** "2026-01" */
  first_month: string
  last_month: string
}

/** The light grid's meta: the grid near the pole, the wider one round it, and the 20 m patches round the ridge sites. */
export interface LightGrids extends GridSpan {
  wide?: GridSpan
  patches?: Record<string, GridSpan>
}

/** What the figures are worked out from; a part is null while its file loads, or where a build has none. */
export interface ScaleSources {
  range: { hours: number; first_year: number; last_year: number } | null
  /** Listed sites, each with its own hourly track. */
  siteCount: number
  light: LightGrids | null
  /** The comparison with JPL Horizons: hours compared at each site, for each of the Sun and Earth. */
  horizons: { sites: Record<string, { hours: number }> } | null
  photos: { frames_sampled: number } | null
}

/** Hours from the start of one month to the end of another, in UTC: "2026-01" to "2049-12" is 210,384. */
export function monthsHours(first: string, last: string): number {
  const [firstYear, firstMonth] = first.split('-').map(Number)
  const [lastYear, lastMonth] = last.split('-').map(Number)
  return (Date.UTC(lastYear, lastMonth, 1) - Date.UTC(firstYear, firstMonth - 1, 1)) / 3_600_000
}

/** Every grid the light layer was computed on: the two squares and each patch. */
function grids(light: LightGrids): GridSpan[] {
  return [light, ...(light.wide ? [light.wide] : []), ...Object.values(light.patches ?? {})]
}

/** Points of the polar ground the model was run at, each with a skyline of its own. */
export function groundPoints(light: LightGrids): number {
  return grids(light).reduce((sum, grid) => sum + grid.size * grid.size, 0)
}

/** Points times the hours each was computed for, over every grid. */
export function groundPointHours(light: LightGrids): number {
  return grids(light).reduce((sum, grid) => sum + grid.size * grid.size * monthsHours(grid.first_month, grid.last_month), 0)
}

/**
 * How many times the model answered "is it in view?": once for the Sun and once for Earth, at every
 * point of the polar ground and every listed site, for every hour computed there.
 */
export function answersComputed(light: LightGrids, siteCount: number, siteHours: number): number {
  return BODIES * (groundPointHours(light) + siteCount * siteHours)
}

/** Angles compared with JPL Horizons: the Sun's and Earth's, at every hour compared at every site. */
export function horizonsChecks(horizons: { sites: Record<string, { hours: number }> }): number {
  return BODIES * Object.values(horizons.sites).reduce((sum, site) => sum + site.hours, 0)
}

/** A whole number with thousands separators: "210,384". */
export function countWords(count: number): string {
  return Math.round(count).toLocaleString('en-US')
}

/** A large count in words: "78.8 billion", "1.04 trillion"; under a billion, the whole number. */
export function largeWords(count: number): string {
  if (count >= 1e12) return `${(count / 1e12).toFixed(2)} trillion`
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)} billion`
  return countWords(count)
}

/** One figure of the strip: the number as it is shown (null while its file loads) and the few words under it. */
export interface ScaleFigure {
  id: 'terrain' | 'hours' | 'points' | 'answers' | 'horizons' | 'photos'
  figure: string | null
  label: string
}

/** The six figures, in the order they are shown. */
export function scaleFigures({ range, siteCount, light, horizons, photos }: ScaleSources): ScaleFigure[] {
  return [
    { id: 'terrain', figure: `${NASA_TERRAIN_READ_GB} GB`, label: 'of NASA terrain read' },
    { id: 'hours', figure: range ? countWords(range.hours) : null, label: range ? `hours covered, ${range.first_year} to ${range.last_year}` : 'hours covered' },
    { id: 'points', figure: light ? countWords(groundPoints(light)) : null, label: 'points of the south pole, each with its own skyline' },
    { id: 'answers', figure: light && range ? largeWords(answersComputed(light, siteCount, range.hours)) : null, label: 'Sun and Earth answers computed' },
    { id: 'horizons', figure: horizons ? countWords(horizonsChecks(horizons)) : null, label: 'checks against JPL Horizons' },
    { id: 'photos', figure: photos ? countWords(photos.frames_sampled) : null, label: 'dated photos from orbit compared' },
  ]
}

/** The largest figure by itself, for the first screen's one quiet line: "1.04 trillion Sun and Earth answers computed from NASA data". */
export function scaleHeadline(light: LightGrids, siteCount: number, siteHours: number): string {
  return `${largeWords(answersComputed(light, siteCount, siteHours))} Sun and Earth answers computed from NASA data`
}

/** The same figures on one line, for where there is room for a sentence only; null until every file is here. */
export function scaleLine(sources: ScaleSources): string | null {
  const figures = scaleFigures(sources)
  if (figures.some((entry) => entry.figure === null)) return null
  return figures.map((entry) => `${entry.figure} ${entry.label}`).join(' · ')
}
