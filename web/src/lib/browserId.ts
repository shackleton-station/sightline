/**
 * A random id for this browser, sent to the co-pilot with each question so that people who share one
 * network address (a venue's Wi-Fi) each get their own question allowance (web/copilot/limits.ts).
 * It is made up here, holds nothing about the visitor, and is not a cookie: it never leaves this site's
 * own requests to /api/chat and /api/ask. Where storage is blocked, a new one lasts until the page reloads.
 */

/** The header it travels in. Must equal `BROWSER_HEADER` in web/shared/http.ts (checked by a test there). */
export const BROWSER_HEADER = 'x-sightline-browser'

const KEY = 'sightline-browser-id'
const SHAPE = /^[A-Za-z0-9_-]{16,64}$/
let kept: string | null = null

function makeId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** This browser's id, made on first use. */
export function browserId(): string {
  if (kept) return kept
  try {
    const stored = localStorage.getItem(KEY)
    if (stored && SHAPE.test(stored)) return (kept = stored)
  } catch {
    // Storage blocked (private window, settings): fall through to an id for this page's life.
  }
  kept = makeId()
  try {
    localStorage.setItem(KEY, kept)
  } catch {
    // As above.
  }
  return kept
}

/** The header to add to a co-pilot request. */
export function browserHeader(): Record<string, string> {
  return { [BROWSER_HEADER]: browserId() }
}

/** Forgets the id kept in memory. For tests only. */
export function forgetBrowserIdForTests(): void {
  kept = null
}
