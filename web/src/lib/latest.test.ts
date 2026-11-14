import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latestOnly } from './latest'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sending only the latest', () => {
  it('sends the first change at once, then the newest once a second, and once more when the changes stop', async () => {
    const sent: { value: number; at: number }[] = []
    const started = Date.now()
    const publish = latestOnly<number>(
      (value) => {
        sent.push({ value, at: Date.now() - started })
        return Promise.resolve(true)
      },
      1000,
      5000,
    )
    // A presenter drags the time control for 2.5 seconds: a change every 50 ms.
    for (let step = 1; step <= 50; step += 1) {
      publish(step)
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toEqual([
      { value: 1, at: 0 },
      { value: 20, at: 1000 },
      { value: 40, at: 2000 },
      { value: 50, at: 3000 },
    ])
  })

  it('never has two sends in flight, and skips what a slow send made stale', async () => {
    const sent: number[] = []
    const slow: { finish: (ok: boolean) => void } = { finish: () => {} }
    const publish = latestOnly<number>(
      (value) => {
        sent.push(value)
        return new Promise((done) => {
          slow.finish = done
        })
      },
      1000,
      5000,
    )
    publish(1)
    await vi.advanceTimersByTimeAsync(0)
    publish(2)
    publish(3)
    await vi.advanceTimersByTimeAsync(3000)
    expect(sent).toEqual([1])
    slow.finish(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual([1, 3])
  })

  it('tries a failed send again later, unless something newer has replaced it', async () => {
    const sent: number[] = []
    const results = [false, false, true, false, true]
    const publish = latestOnly<number>(
      (value) => {
        sent.push(value)
        return results.shift() === false ? Promise.reject(new Error('offline')) : Promise.resolve(true)
      },
      1000,
      5000,
    )
    publish(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(sent).toEqual([1])
    await vi.advanceTimersByTimeAsync(1)
    expect(sent).toEqual([1, 1])
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toEqual([1, 1, 1])
    // Delivered: nothing more is sent until something changes.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toEqual([1, 1, 1])

    publish(2)
    await vi.advanceTimersByTimeAsync(0)
    publish(3)
    await vi.advanceTimersByTimeAsync(5000)
    expect(sent).toEqual([1, 1, 1, 2, 3])
  })
})
