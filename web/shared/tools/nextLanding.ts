import { horizonAt } from '../../src/lib/customModel'
import type { SiteFlags } from '../../src/lib/flags'
import { BASE_HEIGHT_M } from '../../src/lib/heights'
import { hourOf, type Requirements } from '../../src/lib/mission'
import { steadierHour } from '../../src/lib/sightlineMission'
import { nextViable } from '../../src/lib/slip'
import type { SiteData } from './data'
import { isoAt } from './facts'

/**
 * The next landing that fits, as the visitor's screen offers it. The screen takes the first hour at
 * or after a time that meets the Sun and Earth limits (`nextViable`) and then moves on, inside the
 * same sunlit stretch, to the first hour with at least half the Sun's disc in view
 * (`steadierLanding`) and, where the mission needs Earth at landing, with Earth's center above the
 * skyline, so it never offers a landing on a sliver of Sun or on the edge of Earth. Every "next
 * landing" the co-pilot states goes through here, so it is the hour the column shows. An hour that
 * already meets the limits is returned as it is, with no wait: the screen offers nothing then.
 *
 * `flags` are the hours the limits are judged on (at the visitor's heights where those are read) and
 * `panelM` is the height the Sun's disc is seen from. If that month's shares cannot be read, the
 * first hour that meets the limits stands, as it does on the screen. Earth's center is read against
 * the skyline at the app's own antenna height; at another (`antennaM`), whose skyline is not held
 * here, that part is left out.
 */
export async function nextLandingOnScreen(
  data: SiteData,
  siteId: string,
  flags: SiteFlags,
  iso: string,
  requirements: Requirements,
  panelM: number = BASE_HEIGHT_M,
  antennaM: number = BASE_HEIGHT_M,
): Promise<{ t: string; waitH: number } | null> {
  const next = nextViable(flags, iso, requirements)
  if (!next) return null
  if (next.waitH === 0) return { t: next.t, waitH: 0 }
  const hour = hourOf(flags.start, next.t)
  const [shares, sky] = await Promise.all([
    data.sunSharesAt(siteId, next.month, panelM).catch(() => null),
    antennaM === BASE_HEIGHT_M ? data.scenario(siteId, next.month).catch(() => null) : null,
  ])
  // Half of Earth's disc shows when its center is above the skyline in its own direction, as the screen reads it.
  const earthCenterAbove = sky ? sky.track.map((point) => point.earth_el - horizonAt(sky.earthHorizon ?? sky.horizon, point.earth_az) >= 0) : undefined
  const steadier = shares ? steadierHour(flags, hour, requirements, shares, hour - next.index, earthCenterAbove) : hour
  return { t: isoAt(flags.start, steadier), waitH: next.waitH + (steadier - hour) }
}
