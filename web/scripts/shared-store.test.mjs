import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expectedStore, SETTINGS_FILE, storeIn } from './shared-store.mjs'

describe('storeIn', () => {
  it('is memory only when the settings switch the shared store off', () => {
    expect(storeIn('domain = "example.com"\nshared_store = false\n')).toBe('memory')
    expect(storeIn('shared_store   =   false # Redis off')).toBe('memory')
  })

  it('is redis when the line is true, absent or commented out', () => {
    expect(storeIn('shared_store = true\n')).toBe('redis')
    expect(storeIn('domain = "example.com"\n')).toBe('redis')
    expect(storeIn('# shared_store = false\n')).toBe('redis')
  })
})

describe('expectedStore', () => {
  it('takes --store over the settings', () => {
    expect(expectedStore(['node', 'x', 'https://example.com', '--store', 'redis'], () => 'shared_store = false')).toBe('redis')
    expect(expectedStore(['node', 'x', 'https://example.com', '--store', 'memory'], () => '')).toBe('memory')
    expect(() => expectedStore(['node', 'x', 'https://example.com', '--store', 'disk'], () => '')).toThrow(/redis or memory/)
  })

  it('reads the settings otherwise, and expects redis when they cannot be read', () => {
    expect(expectedStore(['node', 'x'], () => 'shared_store = false')).toBe('memory')
    expect(
      expectedStore(['node', 'x'], () => {
        throw new Error('no such file')
      }),
    ).toBe('redis')
  })

  it("reads this repository's own settings file", () => {
    expect(['redis', 'memory']).toContain(storeIn(readFileSync(SETTINGS_FILE, 'utf8')))
  })
})
