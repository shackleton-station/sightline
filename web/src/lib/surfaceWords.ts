import { degWords } from './sightline'

/**
 * The two lines under the Sun's or Earth's name in Surface, in the plan's own words. First where it
 * stands against the skyline in its direction, which is what decides whether it is in view; then
 * where it stands against eye level. A body can be below eye level and in view: on high ground the
 * skyline sits below level.
 *
 * `aboveSkylineDeg` and `elDeg` are for the body's centre. When the centre is under the skyline
 * while part of the disc still shows, the first line speaks of the disc's top edge, so a body the
 * caption calls "in view" is never labelled "below the skyline".
 */
export function skyTagWords(aboveSkylineDeg: number, elDeg: number, radiusDeg: number, up: boolean): { skyline: string; level: string } {
  const side = (deg: number, of: string) => {
    const tenths = Math.round(deg * 10) / 10
    return `${degWords(Math.abs(tenths))} ${tenths < 0 ? 'below' : 'above'} ${of}`
  }
  const centreUnder = Math.round(aboveSkylineDeg * 10) < 0
  const skyline = up && centreUnder ? `top edge ${side(Math.max(0, aboveSkylineDeg + radiusDeg), 'the skyline')}` : side(aboveSkylineDeg, 'the skyline')
  return { skyline, level: side(elDeg, 'eye level') }
}
