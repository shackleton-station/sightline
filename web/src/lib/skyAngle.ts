/** Rounds an angle to 0.1° and drops a "-0.0". */
function tenths(deg: number): string {
  const rounded = Math.round(deg * 10) / 10
  return (rounded === 0 ? 0 : rounded).toFixed(1).replace('-', '−')
}

/**
 * The angle shown over the Sun or Earth in the 3D view: elevation above the flat horizon and compass
 * azimuth (from north, clockwise), in degrees, from the pipeline's track.
 */
export function formatSkyAngle(elDeg: number, azDeg: number): string {
  const az = ((Math.round(azDeg) % 360) + 360) % 360
  return `${tenths(elDeg)}° elevation · ${az}° az`
}
