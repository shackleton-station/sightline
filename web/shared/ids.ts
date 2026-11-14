import { randomInt } from 'node:crypto'

/** Ids are short enough to say aloud, and leave out letters and digits that look alike. */
export const ID_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789'

/** A random id of `length` letters, for a shared plan or a presenter's room. */
export function newId(length: number): string {
  return Array.from({ length }, () => ID_LETTERS[randomInt(ID_LETTERS.length)]).join('')
}
