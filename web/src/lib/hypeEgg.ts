/**
 * The easter egg: the team's hype video is linked from nowhere. Typing its name on the Sightline
 * screen, outside a text box, or sending it to Scout as a message of its own, makes a "Hype" button
 * appear in the rail and opens its panel, for that visit only: a reload starts without it. On any
 * other page of the site the same word opens Sightline with that panel open. The old page at /hype/
 * still answers for links that were shared, but nothing sends anyone there.
 */
export const HYPE_PATH = '/hype/'
/** The address that opens Sightline with the Hype panel open: where the word leads from the other pages. */
export const HYPE_HASH = '#hype'
export const HYPE_IN_SIGHTLINE = `/${HYPE_HASH}`
export const HYPE_WORD = 'hype'

/** Whether a message to Scout is the word and nothing else, in any case, with or without spaces round it: the one way to it on a phone. */
export function isHypeWord(message: string): boolean {
  return message.trim().toLowerCase() === HYPE_WORD
}

/**
 * The last few letters typed, after one more key. Anything that isn't a single letter (an arrow,
 * Enter, a digit) starts over, so the word has to be typed in one go.
 */
export function typedSoFar(before: string, key: string): string {
  if (key.length !== 1 || !/[a-z]/i.test(key)) return ''
  return (before + key.toLowerCase()).slice(-HYPE_WORD.length)
}

/** What a key press needs to say for the word to count: its key, any modifier held, and whether it went to a text box. */
export interface TypedKey {
  key: string
  modified: boolean
  writing: boolean
}

/**
 * Follows what is typed, one key at a time: `press` answers true on the key that completes the
 * word. Keys typed into a text box, or with Ctrl, Alt or Cmd held, are not the visitor typing at
 * the page, so they neither count nor carry the word along.
 */
export function hypeListener(): { press: (typed: TypedKey) => boolean } {
  let letters = ''
  return {
    press({ key, modified, writing }) {
      if (writing || modified) {
        letters = ''
        return false
      }
      letters = typedSoFar(letters, key)
      return letters === HYPE_WORD
    },
  }
}
