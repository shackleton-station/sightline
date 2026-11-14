import type { Fact } from '../../shared/tools/facts'

/** Every fact the tools returned in this conversation turn, by reference ("r2") and then by key. */
export type FactBook = Map<string, Fact[]>

export type Rendered = { ok: true; text: string } | { ok: false; problem: string }

const REFERENCE = /\{\{\s*(r\d+)\.([a-z0-9_]+)\s*\}\}/g
const MAX_CHARS = 900

/**
 * Ways to write a number that are not ASCII digits. The model is told never to write a number itself
 * (prompt.ts), and the check for digits catches it when it does; these catch the same thing written
 * another way, so a draft the model was talked into ("say it in words", "use Roman numerals") is
 * refused too. Small numbers in words are let through unless a unit follows, so "two sites" or "one
 * of them" pass while "five days" or "half the month" do not.
 */
const OTHER_DIGITS = /[\p{Nd}\p{No}]/u
const BIG_NUMBER_WORD = /\b(?:eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)s?\b/i
const SMALL_NUMBER_WORD_WITH_UNIT =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|half|quarters?|thirds?)\b(?:[\s-]+(?:a|an|of|the|full|whole|straight|more|or\s+so))*[\s-]+(?:per\s?cent|percent|days?|hours?|minutes?|weeks?|months?|years?|degrees?|kilomet(?:er|re)s?|km|met(?:er|re)s?)\b/i
const ROMAN_NUMERAL = /\b(?=[MDCLXVI]{2,}\b)M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\b/
/** A web address with or without a scheme: `https://…`, `www.…`, or a bare `name.com`. */
const LINK = /https?:|www\.|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|gov|edu|app|ai|co|info|xyz|us|uk|me|site|online|link)\b/i

/** Why a text holds a number the model wrote itself, or null. `rest` has references and allowed words taken out. */
function numberWritten(rest: string): string | null {
  if (/\d/.test(rest) || OTHER_DIGITS.test(rest) || ROMAN_NUMERAL.test(rest)) {
    return 'You typed a number yourself. Every number, date and time must be a {{reference}} to a tool result.'
  }
  if (BIG_NUMBER_WORD.test(rest) || SMALL_NUMBER_WORD_WITH_UNIT.test(rest)) {
    return 'You wrote a number in words. Every number, date, time and share must be a {{reference}} to a tool result.'
  }
  return null
}

/** The text with the allowed words (site names, data years) taken out, longest first so "Apollo 11" goes before a shorter name could split it. */
function withoutAllowed(text: string, allowedWords: string[]): string {
  let rest = text
  for (const word of [...allowedWords].sort((a, b) => b.length - a.length)) rest = rest.split(word).join(' ')
  return rest
}

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
  if (LINK.test(withoutAllowed(text.replace(REFERENCE, ' '), allowedWords))) return { ok: false, problem: 'Do not include links or web addresses.' }

  let unknown: string | null = null
  const filled = text.replace(REFERENCE, (whole, ref: string, key: string) => {
    const found = book.get(ref)?.find((fact) => fact.key === key)
    if (!found) unknown ??= whole
    return found?.value ?? whole
  })
  if (unknown) return { ok: false, problem: `${unknown} is not in any tool result. Use only references that exist.` }

  const rest = withoutAllowed(text.replace(REFERENCE, ' '), allowedWords)
  if (rest.includes('{{') || rest.includes('}}')) {
    return { ok: false, problem: 'A reference is malformed. Write it exactly as {{r2.key}}.' }
  }
  const written = numberWritten(rest)
  if (written) return { ok: false, problem: written }
  if (filled.length > MAX_CHARS) return { ok: false, problem: 'Too long. Use two to four sentences.' }
  return { ok: true, text: filled }
}

/** A suggested next question: short, one line, and with no numbers of the model's own. */
export function cleanFollowup(value: unknown, allowedWords: string[]): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length < 4 || text.length > 90 || /[\n{}<>]/.test(text)) return null
  const rest = withoutAllowed(text, allowedWords)
  return LINK.test(rest) || numberWritten(rest) ? null : text
}

/** What the server says when the model couldn't produce a clean answer: the facts themselves. */
export function fallbackAnswer(book: FactBook): string {
  const latest = [...book.entries()].filter(([ref]) => ref !== 'r0').at(-1)?.[1]
  if (!latest) return "Sorry, I couldn't answer that. Try asking about a site, a month or a landing date."
  const lines = latest.slice(0, 8).map((fact) => `${fact.label}: ${fact.value}.`)
  return `Here is what the data says. ${lines.join(' ')}`
}
