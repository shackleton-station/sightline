import { describe, expect, it } from 'vitest'
import { ADDRESS_SHARE, DEFAULT_LIMITS, LIMITS, limitsFrom } from './limits'

const withAddress = (limits: { each: number; eachDay: number; all: number; allDay: number }) => ({
  ...limits,
  address: limits.each * ADDRESS_SHARE,
  addressDay: limits.eachDay * ADDRESS_SHARE,
})

describe('limitsFrom', () => {
  it('keeps the defaults with no settings, with each address allowed four visitors', () => {
    expect(limitsFrom({})).toEqual({ chat: withAddress(LIMITS.chat), ask: withAddress(LIMITS.ask) })
    expect(DEFAULT_LIMITS).toEqual(limitsFrom({}))
  })

  it('takes a whole-number setting in place of a default', () => {
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_ALL_DAY: '400', COPILOT_LIMIT_ASK_EACH_DAY: '150' })
    expect(limits.chat).toEqual(withAddress({ ...LIMITS.chat, allDay: 400 }))
    expect(limits.ask).toEqual(withAddress({ ...LIMITS.ask, eachDay: 150 }))
  })

  it('ignores a setting that is not a whole number of at least 1', () => {
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_EACH: '0', COPILOT_LIMIT_CHAT_ALL: '2.5', COPILOT_LIMIT_ASK_ALL: 'lots', COPILOT_LIMIT_ASK_EACH: '', COPILOT_LIMIT_CHAT_ADDRESS: '-3' })
    expect(limits).toEqual(DEFAULT_LIMITS)
  })

  it("raises an address's limits with the visitor's, as the live site's event settings do", () => {
    // infra/settings.auto.tfvars: chat_each 15, chat_each_day 100.
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_EACH: '15', COPILOT_LIMIT_CHAT_EACH_DAY: '100' })
    expect(limits.chat.address).toBe(60)
    expect(limits.chat.addressDay).toBe(400)
  })

  it('takes an address limit set on its own', () => {
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_ADDRESS: '200', COPILOT_LIMIT_ASK_ADDRESS_DAY: '999' })
    expect(limits.chat.address).toBe(200)
    expect(limits.ask.addressDay).toBe(999)
  })

  it('never lets an address get less than one visitor', () => {
    for (const kind of ['chat', 'ask'] as const) {
      expect(DEFAULT_LIMITS[kind].address).toBeGreaterThanOrEqual(DEFAULT_LIMITS[kind].each)
      expect(DEFAULT_LIMITS[kind].addressDay).toBeGreaterThanOrEqual(DEFAULT_LIMITS[kind].eachDay)
    }
  })
})
