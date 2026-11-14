/**
 * The JPL Horizons query for one hour at one point on the Moon, as an address a visitor can open:
 * the same question the pipeline asks (`pipeline/src/clps/horizons.py`), so the reply's azimuth and
 * elevation can be read against the numbers on screen.
 */

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api'

/** Horizons' numbers for the two bodies. */
const BODY_ID = { sun: '10', earth: '399' } as const

export type HorizonsBody = keyof typeof BODY_ID

/** "2027-05-13T12:00:00Z" as Horizons writes a time: "2027-05-13 12:00". */
function horizonsTime(iso: string, minute = '00'): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}:${minute}`
}

/**
 * The address of the query. `lon` is east-positive in degrees, either sign; `altKm` is the height of
 * the point above Horizons' 1737.4 km sphere; `hourIso` is a whole hour, UTC. The reply is one row:
 * the hour, then the apparent azimuth and elevation in degrees.
 */
export function horizonsQueryUrl(body: HorizonsBody, lat: number, lon: number, altKm: number, hourIso: string): string {
  const east = ((lon % 360) + 360) % 360
  const params: [string, string][] = [
    ['format', 'text'],
    ['COMMAND', `'${BODY_ID[body]}'`],
    ['EPHEM_TYPE', "'OBSERVER'"],
    ['CENTER', "'coord@301'"],
    ['COORD_TYPE', "'GEODETIC'"],
    ['SITE_COORD', `'${east},${lat},${altKm}'`],
    ['START_TIME', `'${horizonsTime(hourIso)}'`],
    // One minute later with an hour's step: one row, the hour itself.
    ['STOP_TIME', `'${horizonsTime(hourIso, '01')}'`],
    ['STEP_SIZE', "'1h'"],
    ['QUANTITIES', "'4'"],
    ['ANG_FORMAT', "'DEG'"],
  ]
  return `${API}?${params.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')}`
}

/** "0.01°" for a largest gap of 0.007°: rounded up to the hundredth, so the claim is never too small. */
export function withinWords(maxDeg: number): string {
  return `${(Math.ceil(maxDeg * 100 - 1e-9) / 100).toFixed(2)}°`
}
