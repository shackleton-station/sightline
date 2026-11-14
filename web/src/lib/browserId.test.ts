import { afterEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_HEADER, browserHeader, browserId, forgetBrowserIdForTests } from './browserId'

afterEach(() => {
  forgetBrowserIdForTests()
  vi.unstubAllGlobals()
})

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: () => null, get length() { return map.size } } as Storage
}

describe('browserId', () => {
  it('makes a random id the server accepts, and keeps it', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    const id = browserId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    forgetBrowserIdForTests()
    expect(browserId()).toBe(id)
    expect(browserHeader()).toEqual({ [BROWSER_HEADER]: id })
  })

  it('still works when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    const id = browserId()
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    expect(browserId()).toBe(id)
  })

  it('replaces a stored value that is not an id', () => {
    const storage = memoryStorage()
    storage.setItem('sightline-browser-id', 'not an id')
    vi.stubGlobal('localStorage', storage)
    expect(browserId()).toMatch(/^[0-9a-f]{32}$/)
  })
})
