/**
 * Text on its way to a voice. The browser uses this to word an answer for the ear, and the server
 * to accept only ordinary sentence text, so nothing here touches the page or the network.
 */

/** The longest text the server turns into speech: as long as the longest answer the co-pilot can give. */
export const SPEAK_MAX_CHARS = 900

/** Anything that isn't a letter, a digit, a space or the punctuation of a sentence. */
const NOT_SENTENCE_TEXT = /[^\p{L}\p{N}\s.,;:!?'’"“”()%°+\-–—−]/gu

/**
 * Ordinary sentence text only. Tags go, with whatever is inside their brackets, and so does every
 * other character a sentence has no use for, so no markup of any kind can reach a speech service.
 */
export function plainSentences(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#\w]+;/g, ' ')
    .replace(NOT_SENTENCE_TEXT, ' ')
    .replace(/\s+/g, ' ')
    // A removed tag can leave a space in front of a full stop or a comma.
    .replace(/ ([.,;:!?])/g, '$1')
    .trim()
}

const COMPASS: Record<string, string> = { N: 'north', S: 'south', E: 'east', W: 'west' }
const count = (n: string, unit: string) => `${n} ${unit}${n === '1' ? '' : 's'}`

/**
 * An answer as it should be said. The data writes units short ("4 d 22 h", "89.5°S", "656 W/m²"); a
 * voice needs them in full. The numbers themselves are never touched. An answer too long to say in
 * one go stops at its last whole sentence that fits: the full text is always on screen.
 */
export function forSpeech(text: string): string {
  const worded = plainSentences(
    text
      .replace(/\b(\d+) d\b/g, (_, n: string) => count(n, 'day'))
      .replace(/\b(\d+) h\b/g, (_, n: string) => count(n, 'hour'))
      .replace(/(\d) W\/m²/g, '$1 watts per square meter')
      .replace(/°\s?([NSEW])\b/g, (_, side: string) => ` degrees ${COMPASS[side]}`)
      .replace(/°/g, ' degrees'),
  )
  if (worded.length <= SPEAK_MAX_CHARS) return worded
  const cut = worded.slice(0, SPEAK_MAX_CHARS)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > 0 ? cut.slice(0, end + 1) : cut
}
