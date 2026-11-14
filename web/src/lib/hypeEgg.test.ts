import { describe, expect, it } from 'vitest'
import { hypeListener, isHypeWord, typedSoFar } from './hypeEgg'
import { tabLinks } from './siteTabs'

const type = (listener: ReturnType<typeof hypeListener>, keys: string, how: { modified?: boolean; writing?: boolean } = {}) =>
  [...keys].map((key) => listener.press({ key, modified: how.modified ?? false, writing: how.writing ?? false }))

describe('the Hype easter egg', () => {
  it('opens on the last letter of its name, typed in one go, in either case', () => {
    expect(type(hypeListener(), 'hype')).toEqual([false, false, false, true])
    expect(type(hypeListener(), 'HyPe').at(-1)).toBe(true)
    // Letters before it do not matter; a word that only contains some of it does not count.
    expect(type(hypeListener(), 'what a hype').at(-1)).toBe(true)
    expect(type(hypeListener(), 'hyp').includes(true)).toBe(false)
    expect(type(hypeListener(), 'hyper').slice(0, 4).at(-1)).toBe(true)
  })

  it('starts over at anything that is not a letter', () => {
    const listener = hypeListener()
    type(listener, 'hy')
    expect(listener.press({ key: 'ArrowLeft', modified: false, writing: false })).toBe(false)
    expect(type(listener, 'pe').includes(true)).toBe(false)
    expect(typedSoFar('hyp', '1')).toBe('')
    expect(typedSoFar('hyp', 'Enter')).toBe('')
    expect(typedSoFar('hyp', 'E')).toBe('hype')
  })

  it('does not count what is typed into a text box, or with Ctrl, Alt or Cmd held', () => {
    expect(type(hypeListener(), 'hype', { writing: true }).includes(true)).toBe(false)
    expect(type(hypeListener(), 'hype', { modified: true }).includes(true)).toBe(false)
    // Letters typed into a box do not carry over to the page either.
    const listener = hypeListener()
    type(listener, 'hyp', { writing: true })
    expect(listener.press({ key: 'e', modified: false, writing: false })).toBe(false)
  })

  it('is linked from no tab', () => {
    const links = tabLinks('#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&mode=plan')
    expect(links.some((tab) => tab.href.includes('hype') || /hype/i.test(tab.label))).toBe(false)
  })
})

describe('the word sent to Scout', () => {
  it('counts when it is the whole message, in any case, with or without spaces round it', () => {
    for (const message of ['hype', 'Hype', 'HYPE', '  hype ', '\thYpE\n']) expect(isHypeWord(message), message).toBe(true)
  })

  it('does not count inside a longer message, or as another word', () => {
    for (const message of ['', 'hyper', 'the hype', 'hype!', 'What is all the hype about?', 'hy pe']) expect(isHypeWord(message), message).toBe(false)
  })
})

