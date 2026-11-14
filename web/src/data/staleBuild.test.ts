import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPart, newerBuild } from './staleBuild'

function serve(response: Response | Error) {
  vi.stubGlobal('fetch', vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))))
}

describe('newerBuild', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('names the live build when it differs', async () => {
    serve(Response.json({ build: 'new' }))
    expect(await newerBuild('old')).toBe('new')
  })

  it('is null when the running build is live', async () => {
    serve(Response.json({ build: 'same' }))
    expect(await newerBuild('same')).toBeNull()
  })

  it.each([
    ['no version file', new Response('', { status: 404 })],
    ['a malformed file', Response.json({ build: 3 })],
    ['no network', new Error('offline')],
  ])('is null with %s', async (_, response) => {
    serve(response)
    expect(await newerBuild('old')).toBeNull()
  })
})

describe('loadPart', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** A browser to reload: its session storage, and how many times it was told to reload. */
  function browser() {
    const kept = new Map<string, string>()
    const reload = vi.fn()
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) })
    vi.stubGlobal('window', { location: { reload } })
    return reload
  }
  const gone = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'))

  it('hands back what loaded, without asking which build is live', async () => {
    const reload = browser()
    serve(new Error('should not be asked'))
    expect(await loadPart(async () => 'the part')).toBe('the part')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page, once, when the part is gone because a newer build is live', async () => {
    const reload = browser()
    serve(Response.json({ build: 'a build that is not this one' }))
    await expect(loadPart(gone)).rejects.toThrow(/dynamically imported/)
    expect(reload).toHaveBeenCalledTimes(1)
    // Still failing after the reload (a stubborn cache, say): no second reload, so no loop.
    serve(Response.json({ build: 'a build that is not this one' }))
    await expect(loadPart(gone)).rejects.toThrow(/dynamically imported/)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('passes the failure on when this build is still the live one, or that cannot be told', async () => {
    const reload = browser()
    serve(new Error('offline'))
    await expect(loadPart(gone)).rejects.toThrow(/dynamically imported/)
    serve(new Response('', { status: 404 }))
    await expect(loadPart(gone)).rejects.toThrow(/dynamically imported/)
    expect(reload).not.toHaveBeenCalled()
  })
})

