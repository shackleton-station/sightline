import { isNoGapLimit, type Requirements } from '../../src/lib/mission'
import { formatDuration } from '../../src/lib/nextChange'
import type { Tie } from './ties'

/**
 * One thing a tool found, already worded for a person: "59.5%", "4 d 22 h", "3 May 2027, 12:00 UTC".
 * The model never types these values. It writes `{{r2.pct_sun}}` and the server puts the value in.
 */
export interface Fact {
  key: string
  /** What the value is, in a few words. Used when the server has to write the answer itself. */
  label: string
  value: string
}

/**
 * What a tool hands back: facts to cite, or a reason it couldn't answer. `ties` is set when the best
 * it found is shared by several months or sites, for the buttons under the answer (tools/ties.ts).
 */
export type ToolResult = { ok: true; title: string; facts: Fact[]; ties?: Tie[] } | { ok: false; error: string }

export const fact = (key: string, label: string, value: string): Fact => ({ key, label, value })

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2027-05-03T12:00:00Z" as "3 May 2027, 12:00 UTC". */
export function whenLabel(iso: string): string {
  const at = new Date(iso)
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:00`
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${time} UTC`
}

/** The ISO time of hour `hour` after `startIso`. */
export function isoAt(startIso: string, hour: number): string {
  return new Date(Date.parse(startIso) + hour * 3_600_000).toISOString().replace('.000Z', 'Z')
}

export function latitudeLabel(lat: number): string {
  return `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}`
}

export function longitudeLabel(lon: number): string {
  const east = ((lon + 540) % 360) - 180
  return `${Math.abs(east).toFixed(3)}°${east < 0 ? 'W' : 'E'}`
}

export function daysLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** "2027-05" as "May 2027", with the month spelled out. */
export function monthWords(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

/** A limit in hours, in whole days when it is one: 72 h reads as "3 days". */
export function gapLabel(hours: number): string {
  if (isNoGapLimit(hours)) return 'no limit'
  return hours >= 48 && hours % 24 === 0 ? daysLabel(hours / 24) : formatDuration(hours)
}

/** The parts of the mission limits, each worded on its own. */
export function limitWords(req: Requirements): Record<keyof Requirements, string> {
  return {
    missionDays: `${req.missionDays}-day mission`,
    // "No limit" travels in a link as a very large number of hours: it is said as no limit, never as that number.
    maxSunGapH: isNoGapLimit(req.maxSunGapH) ? 'no limit on time without the Sun' : `at most ${gapLabel(req.maxSunGapH)} without the Sun`,
    maxEarthGapH: isNoGapLimit(req.maxEarthGapH) ? 'no limit on time without Earth' : `at most ${gapLabel(req.maxEarthGapH)} without Earth`,
    sunAtLanding: req.sunAtLanding ? 'the Sun up at landing' : 'no need for the Sun at landing',
    earthAtLanding: req.earthAtLanding ? 'Earth in view at landing' : 'no need for Earth at landing',
    minEarthClearanceDeg:
      req.minEarthClearanceDeg > 0 ? `Earth at least ${req.minEarthClearanceDeg}° above the terrain` : 'any part of Earth counting as in view',
  }
}

/** The mission limits in one line, so every landing answer can say what it was checked against. */
export function limitsLabel(req: Requirements): string {
  return Object.values(limitWords(req)).join(', ')
}
