import type { MissionHeights } from '../lib/heights'
import type { BandAccuracy, HorizonPoint, SiteInfo, Summary, TrackPoint, Validation, YearSummary } from './contract'

// The shapes one site-and-month view works from. They live apart from the loaders so code that
// runs outside the browser (the server's co-pilot) can use them without the loaders' browser code.

export interface CustomQuality {
  accuracy: BandAccuracy
  /** Measured on well-lit polar ground; set for points near the south pole. */
  ridges: BandAccuracy | null
  resolutionM: number
  modelError: { sun_rmse: number; sun_any_rmse: number; earth_rmse: number }
}

/** A site and month, with everything needed to show them. */
export interface ScenarioData {
  site: SiteInfo
  month: string
  horizon: HorizonPoint[]
  /** Null for custom coordinates, which use ``custom`` instead. */
  validation: Validation | null
  custom: CustomQuality | null
  /** Ground slope at the site, from LOLA; null if unknown. */
  slope: { deg: number; baseline_m: number; err_deg?: number } | null
  year: YearSummary
  track: TrackPoint[]
  summary: Summary
  /**
   * Set only when the Sun and Earth are read from heights other than the app's own 2 m (Sightline's
   * choice): the heights, and the skyline under Earth, seen from the antenna's height. `horizon` is
   * then the skyline under the Sun, seen from the panel's, and `track` holds each body's rows from
   * its own height. `summary` and `year` stay the 2 m ones.
   */
  heights?: MissionHeights
  earthHorizon?: HorizonPoint[]
}
