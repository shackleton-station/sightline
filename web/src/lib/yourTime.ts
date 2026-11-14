/**
 * The visitor's own time for a moment the screen shows in UTC. Every time on the screen stays in
 * UTC, and links are unchanged; this is only what the hover text adds. The zone is the browser's
 * own (or the one given, for tests), read where it is used: nothing about it is stored or sent.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The pieces of a moment in a time zone: its calendar date there, the clock time, and the zone's short name. */
function inZone(ms: number, timeZone: string | undefined) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' }).formatToParts(new Date(ms))
  const part = (type: string) => parts.find((one) => one.type === type)?.value ?? ''
  return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')), clock: `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`, zone: part('timeZoneName') }
}

/**
 * A moment in the visitor's time, as the hover text says it: "6:00 am your time (EDT)". When the
 * date there is not the UTC date, it leads with the date: "5 May, 10:00 pm your time (EDT)".
 */
export function yourTime(ms: number, timeZone?: string): string {
  const there = inZone(ms, timeZone)
  const utc = new Date(ms)
  const sameDay = there.year === utc.getUTCFullYear() && there.month === utc.getUTCMonth() + 1 && there.day === utc.getUTCDate()
  return `${sameDay ? '' : `${there.day} ${MONTHS[there.month - 1]}, `}${there.clock} your time (${there.zone})`
}

/** A time as the screen writes it in UTC, then the same moment in the visitor's time: "10:00 UTC · 6:00 am your time (EDT)". */
export function withYourTime(utcWords: string, ms: number, timeZone?: string): string {
  return `${utcWords} · ${yourTime(ms, timeZone)}`
}

/** A stretch of time in the visitor's time, for a band of the time bar: "6 May, 9:00 am to 8 May, 10:00 pm your time (EDT)". Each end carries its date there. */
export function yourStretch(fromMs: number, toMs: number, timeZone?: string): string {
  const end = (ms: number) => {
    const there = inZone(ms, timeZone)
    return { words: `${there.day} ${MONTHS[there.month - 1]}, ${there.clock}`, zone: there.zone }
  }
  const from = end(fromMs)
  const to = end(toMs)
  // A stretch that crosses a change of clocks names both zones.
  return from.zone === to.zone ? `${from.words} to ${to.words} your time (${to.zone})` : `${from.words} (${from.zone}) to ${to.words} (${to.zone}) your time`
}
