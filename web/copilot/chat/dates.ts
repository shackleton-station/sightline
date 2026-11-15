/**
 * Which date a question is about. A visitor who says "now", "today", "tonight", "this month" or
 * "this year" means the real date, whatever the time bar shows: on the opening screen time plays by
 * itself, so the bar runs on past the real date within seconds. A visitor who says "at this time",
 * "on this date", "this landing" or "the scenario" means what the screen shows. This is decided
 * here, in code, and the model is handed the date to use: it is not left to read it right.
 */

export type DateBasis = 'present' | 'screen'

/** Words about the present. */
const PRESENT = /\b(right now|now|today|tonight|this (morning|afternoon|evening|week|month|year)|currently|at the moment|at present|these days)\b/i
/** Words about what the screen shows: its time bar, its date, its landing, its mission. ("How long is the dark spell during my mission now?" is about the plan, not about today.) */
const SCREEN = /\b(time bar|at this time|at that time|at this hour|on this date|on that date|(this|my|the) (landing|mission|plan)|this scenario|my scenarios?|the scenarios?)\b/i

/** Whether a question uses words about the present. */
export function asksAboutPresent(question: string): boolean {
  return PRESENT.test(question) && !SCREEN.test(question)
}

/**
 * The date a question is about. Words about the screen win; then words about the present. With
 * neither, a question asked on the opening screen (no site chosen, time playing by itself) is about
 * the present, and one asked in Plan is about the plan on screen.
 */
export function dateBasis(question: string, watching: boolean): DateBasis {
  if (SCREEN.test(question)) return 'screen'
  if (PRESENT.test(question)) return 'present'
  return watching ? 'present' : 'screen'
}

const HOUR_MS = 3_600_000
/** A page's own clock may be wrong: one more than this far from the server's is not believed. */
const BELIEVED_WITHIN_MS = 26 * HOUR_MS

/**
 * The real hour at the moment the question was sent, as an ISO time (UTC, on the hour): the one the
 * page sent with it (`now=2026-11-15T02` in its link), if it is near the server's own clock, else
 * the server's. The hour nearest the moment, as the opening screen itself takes "now".
 */
export function realHourIso(viewHash: unknown, serverNowMs: number): string {
  const onTheHour = (ms: number) => new Date(Math.round(ms / HOUR_MS) * HOUR_MS).toISOString().replace('.000Z', 'Z')
  const sent = typeof viewHash === 'string' ? /^(\d{4}-\d{2}-\d{2}T\d{2})$/.exec(new URLSearchParams(viewHash.replace(/^#/, '')).get('now') ?? '')?.[1] : undefined
  const sentMs = sent ? Date.parse(`${sent}:00:00Z`) : Number.NaN
  return onTheHour(Number.isNaN(sentMs) || Math.abs(sentMs - serverNowMs) > BELIEVED_WITHIN_MS ? serverNowMs : sentMs)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-12-10T00:00:00Z" as "10 December 2026": a date with no hour, for a sentence about the time bar. */
export function dayLabel(iso: string): string {
  const at = new Date(iso)
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`
}
