/**
 * The easter egg: the Hype page (the landing party, at /hype/) is linked from nowhere. It opens when
 * someone types its name on any page of the site, outside a text box.
 */
export const HYPE_PATH = '/hype/'
export const HYPE_WORD = 'hype'

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
