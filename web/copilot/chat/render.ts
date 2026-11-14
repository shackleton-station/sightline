import type { Fact } from '../../shared/tools/facts'

/** Every fact the tools returned in this conversation turn, by reference ("r2") and then by key. */
export type FactBook = Map<string, Fact[]>

export type Rendered = { ok: true; text: string } | { ok: false; problem: string }

const REFERENCE = /\{\{\s*(r\d+)\.([a-z0-9_]+)\s*\}\}/g
const MAX_CHARS = 900

/**
 * Turns the model's draft into the answer the visitor reads.
 *
 * The model may not type numbers. Each one is a reference such as `{{r2.pct_sun}}`, and this puts
 * the value the tool computed in its place. A draft is refused if a reference points at nothing, or
 * if any digit is left once the references, site names and data years are taken out: that digit
 * would be a number the model made up.
 */
export function renderAnswer(draft: string, book: FactBook, allowedWords: string[]): Rendered {
  const text = draft.trim()
  if (text.length === 0) return { ok: false, problem: 'The answer was empty.' }
  if (/https?:|www\./i.test(text)) return { ok: false, problem: 'Do not include links.' }

  let unknown: string | null = null
  const filled = text.replace(REFERENCE, (whole, ref: string, key: string) => {
    const found = book.get(ref)?.find((fact) => fact.key === key)
    if (!found) unknown ??= whole
    return found?.value ?? whole
  })
  if (unknown) return { ok: false, problem: `${unknown} is not in any tool result. Use only references that exist.` }

  let rest = text.replace(REFERENCE, ' ')
  // Longest first, so "Apollo 11" goes before a shorter name could split it.
  for (const word of [...allowedWords].sort((a, b) => b.length - a.length)) rest = rest.split(word).join(' ')
  if (rest.includes('{{') || rest.includes('}}')) {
    return { ok: false, problem: 'A reference is malformed. Write it exactly as {{r2.key}}.' }
  }
  if (/\d/.test(rest)) {
    return { ok: false, problem: 'You typed a number yourself. Every number, date and time must be a {{reference}} to a tool result.' }
  }
  if (filled.length > MAX_CHARS) return { ok: false, problem: 'Too long. Use two to four sentences.' }
  return { ok: true, text: filled }
}

/** A suggested next question: short, one line, and with no numbers of the model's own. */
export function cleanFollowup(value: unknown, allowedWords: string[]): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length < 4 || text.length > 90 || /[\n{}<>]|https?:/i.test(text)) return null
  let rest = text
  for (const word of [...allowedWords].sort((a, b) => b.length - a.length)) rest = rest.split(word).join(' ')
  return /\d/.test(rest) ? null : text
}

/** What the server says when the model couldn't produce a clean answer: the facts themselves. */
export function fallbackAnswer(book: FactBook): string {
  const latest = [...book.entries()].filter(([ref]) => ref !== 'r0').at(-1)?.[1]
  if (!latest) return "Sorry, I couldn't answer that. Try asking about a site, a month or a landing date."
  const lines = latest.slice(0, 8).map((fact) => `${fact.label}: ${fact.value}.`)
  return `Here is what the data says. ${lines.join(' ')}`
}
