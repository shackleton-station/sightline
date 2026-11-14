import { afterEach, describe, expect, it, vi } from 'vitest'
import { briefly } from './events'

describe('briefly', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for a send that finishes in time, even one that fails', async () => {
    let done = false
    await briefly(Promise.resolve().then(() => void (done = true)))
    expect(done).toBe(true)
    await expect(briefly(Promise.reject(new Error('refused')).catch(() => {}))).resolves.toBeUndefined()
    await expect(briefly(undefined)).resolves.toBeUndefined()
  })

  it('gives up on a slow send rather than holding the visitor', async () => {
    vi.useFakeTimers()
    let waited = false
    const waiting = briefly(new Promise<void>(() => {}), 250).then(() => void (waited = true))
    await vi.advanceTimersByTimeAsync(249)
    expect(waited).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(waited).toBe(true)
  })
})
