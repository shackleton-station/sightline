import { moonPath, pathStats } from '../../src/lib/earthSun'
import { EARTH_STAYS_PUT, EARTH_TILT, LIBRATION, MOON_TILT, SEASONS, SUN_AND_EARTH_SKIM, SUN_CIRCLES, SUN_ROUND, TILT_AND_TURN } from '../../src/lib/moonExplained'
import { formatDuration } from '../../src/lib/nextChange'
import { degWords } from '../../src/lib/sightline'
import { type Args, monthArg, siteArg, type ToolContext } from './args'
import { fact, type Fact, monthWords, type ToolResult } from './facts'

/** A height from a level horizon said with its side, never with a minus sign: "0.8° below a level horizon". */
const fromLevel = (deg: number) => {
  const tenths = Math.round(deg * 10) / 10
  return `${degWords(Math.abs(tenths))} ${tenths < 0 ? 'below' : 'above'} a level horizon`
}

/** "once", "twice", "5 times". */
const times = (count: number) => (count === 1 ? 'once' : count === 2 ? 'twice' : `${count} times`)

/**
 * Why the Moon's south pole is the way it is: the Guide's own explanations, as facts, with one
 * site's month beside them so an answer can end on the place the visitor is looking at.
 *
 * The explanations are the sentences the Guide shows (`src/lib/moonExplained.ts`), each a whole
 * sentence to use as it stands; the figures inside them are also facts of their own. The site's
 * figures are read from its hourly track for the month, as the Guide's "A day here" card reads them.
 */
export async function explainThePole(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const site = await siteArg(ctx, args.site)
  const flags = await ctx.data.flags(site.id)
  const month = monthArg(args.month, flags)
  const { track } = await ctx.data.scenario(site.id, month)
  const sun = pathStats(moonPath(track))
  const earth = track.map((point) => point.earth_el)

  const whole = '(a whole sentence or two from the Guide: use it as it stands, as sentences of its own)'
  const facts: Fact[] = [
    fact('why_sun_and_earth_are_low', `Why the Sun and Earth are low at the south pole ${whole}`, SUN_AND_EARTH_SKIM),
    fact('how_the_sun_moves', `How the Sun moves there, and how long a day on the Moon is ${whole}`, SUN_CIRCLES),
    fact('moon_and_earth_days', `A day on the Moon beside a day on Earth ${whole}`, TILT_AND_TURN),
    fact('why_earth_rises_and_sets', `Why Earth rises and sets at the pole ${whole}`, `The Moon has a ${LIBRATION}. ${EARTH_STAYS_PUT}`),
    fact('why_dates_matter', `Why the month matters: the Moon's seasons ${whole}`, `The Moon has seasons too. ${SEASONS}`),
    fact('moon_tilt', "The tilt of the Moon's axis", MOON_TILT),
    fact('earth_tilt', "The tilt of Earth's axis", EARTH_TILT),
    fact('moon_day', 'How long the Sun takes to go once round the horizon: a day on the Moon', SUN_ROUND),
    fact('site', 'The site these figures are for', site.name),
    fact('month', 'The month these figures are for', monthWords(month)),
    fact('sun_highest_here', "The highest the Sun's center gets there in that month, said with its side of a level horizon", fromLevel(sun.highestDeg)),
    fact(
      'sun_rises_here',
      'How often the Sun rises there in that month, as it sits after "the Sun"',
      sun.rises === 0 ? (sun.longestUpH === 0 ? 'never rises' : 'does not rise, because it is already up') : `rises ${times(sun.rises)}`,
    ),
    fact('longest_sunlight_here', 'The longest stretch of sunlight there in that month', sun.longestUpH === 0 ? 'none' : formatDuration(sun.longestUpH)),
    fact('longest_dark_here', 'The longest stretch without the Sun there in that month', sun.longestDownH === 0 ? 'none: it never goes dark' : formatDuration(sun.longestDownH)),
    fact('earth_lowest_here', "The lowest Earth's center gets there in that month, said with its side of a level horizon", fromLevel(Math.min(...earth))),
    fact('earth_highest_here', "The highest Earth's center gets there in that month, said with its side of a level horizon", fromLevel(Math.max(...earth))),
  ]
  return { ok: true, title: `Why the pole is hard, with ${site.name} in ${monthWords(month)}`, facts }
}
