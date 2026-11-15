import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyWhenKnown } from './copyText'

afterEach(() => vi.unstubAllGlobals())

describe('copyWhenKnown', () => {
  it('copies the text once it is known, where the browser only takes plain text', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyWhenKnown(Promise.resolve('https://example.org/#plan=abcd2345'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://example.org/#plan=abcd2345')
  })

  it('asks at once, with the text as a promise, where the browser can wait for it', async () => {
    const written: Promise<Blob>[] = []
    class Item {
      constructor(parts: Record<string, Promise<Blob>>) {
        written.push(parts['text/plain'])
      }
    }
    const write = vi.fn(async () => {
      await written[0]
    })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write, writeText } })
    expect(await copyWhenKnown(Promise.resolve('the link'))).toBe(true)
    expect(await (await written[0]).text()).toBe('the link')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to plain text when the waiting call is refused', async () => {
    class Item {}
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('ClipboardItem', Item)
    vi.stubGlobal('navigator', { clipboard: { write: () => Promise.reject(new Error('refused')), writeText } })
    expect(await copyWhenKnown(Promise.resolve('the link'))).toBe(true)
    expect(writeText).toHaveBeenCalledWith('the link')
  })

  it('says it did not copy when the browser refuses, or has no clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('refused')) } })
    expect(await copyWhenKnown(Promise.resolve('the link'))).toBe(false)
    vi.stubGlobal('navigator', {})
    expect(await copyWhenKnown(Promise.resolve('the link'))).toBe(false)
  })

  it('copies nothing when the text never comes', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyWhenKnown(Promise.reject(new Error('not saved')))).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', {})
    expect(await copyWhenKnown(Promise.reject(new Error('not saved')))).toBe(false)
  })
})
