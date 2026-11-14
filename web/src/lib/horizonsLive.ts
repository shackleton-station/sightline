/**
 * "Check with Horizons": asks the site's own server (the co-pilot service, `web/copilot/horizons.ts`)
 * for NASA JPL Horizons' answer at one point and hour. The page never calls JPL itself: JPL asks
 * that its API not be called from web pages.
 */

export interface HorizonsLive {
  sun: { azDeg: number; elDeg: number }
  earth: { azDeg: number; elDeg: number }
  ephemeris: string | null
}

/** NASA's azimuth and elevation of the Sun and Earth at a point (degrees, east positive) and a whole hour (UTC), or null if they can't be had right now. */
export async function checkWithHorizons(lat: number, lon: number, hour: string, altKm = 0): Promise<HorizonsLive | null> {
  try {
    const response = await fetch('/api/chat/horizons', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lat, lon, altKm, hour }) })
    if (!response.ok) return null
    const answer = (await response.json()) as Partial<HorizonsLive>
    return typeof answer.sun?.elDeg === 'number' && typeof answer.earth?.elDeg === 'number' ? (answer as HorizonsLive) : null
  } catch {
    return null
  }
}

/** "−1.31°": an elevation as the page prints it beside NASA's. */
export function degreesWords(deg: number): string {
  return `${deg.toFixed(2).replace('-', '−')}°`
}
