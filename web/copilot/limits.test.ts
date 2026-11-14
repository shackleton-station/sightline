import { describe, expect, it } from 'vitest'
import { LIMITS, limitsFrom } from './limits'

describe('limitsFrom', () => {
  it('keeps the defaults with no settings', () => {
    expect(limitsFrom({})).toEqual(LIMITS)
  })

  it('takes a whole-number setting in place of a default', () => {
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_ALL_DAY: '400', COPILOT_LIMIT_ASK_EACH_DAY: '150' })
    expect(limits.chat).toEqual({ ...LIMITS.chat, allDay: 400 })
    expect(limits.ask).toEqual({ ...LIMITS.ask, eachDay: 150 })
  })

  it('ignores a setting that is not a whole number of at least 1', () => {
    const limits = limitsFrom({ COPILOT_LIMIT_CHAT_EACH: '0', COPILOT_LIMIT_CHAT_ALL: '2.5', COPILOT_LIMIT_ASK_ALL: 'lots', COPILOT_LIMIT_ASK_EACH: '' })
    expect(limits).toEqual(LIMITS)
  })
})
