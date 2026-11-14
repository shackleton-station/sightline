/**
 * Hours from sample ``index`` until ``flags`` next changes value, or null if it doesn't change
 * before the data ends.
 */
export function hoursUntilChange(flags: boolean[], index: number, stepH: number): number | null {
  for (let i = index + 1; i < flags.length; i += 1) {
    if (flags[i] !== flags[index]) return (i - index) * stepH
  }
  return null
}

/** "22 h" under two days, otherwise "5 d 3 h". */
export function formatDuration(hours: number): string {
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d ${hours % 24} h`
}

/** "Sunset in 22 h", or a plain statement when the change falls outside the data. */
export function changeLabel(event: string, hours: number | null, lastYear: number): string {
  if (hours === null) return `No ${event.toLowerCase()} through ${lastYear}`
  return `${event} in ${formatDuration(hours)}`
}
