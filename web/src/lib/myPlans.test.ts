import { describe, expect, it } from 'vitest'
import { MAX_MY_PLANS, readMyPlans, withMyPlan } from './myPlans'

const plan = (id: string, title = 'A plan') => ({ id, title, saved: '2026-11-15T10:00:00.000Z' })

describe('the plans saved from this browser', () => {
  it('puts the newest first, never lists a plan twice, and forgets the oldest past the limit', () => {
    expect(withMyPlan([plan('aaaa2222')], plan('bbbb2222')).map((one) => one.id)).toEqual(['bbbb2222', 'aaaa2222'])
    expect(withMyPlan([plan('aaaa2222'), plan('bbbb2222')], plan('bbbb2222', 'Renamed')).map((one) => one.title)).toEqual(['Renamed', 'A plan'])
    const many = Array.from({ length: MAX_MY_PLANS }, (_, i) => plan(`plan${i}`))
    const next = withMyPlan(many, plan('newest'))
    expect([next.length, next[0].id, next.at(-1)?.id]).toEqual([MAX_MY_PLANS, 'newest', `plan${MAX_MY_PLANS - 2}`])
  })

  it('reads back only what it could have written', () => {
    expect(readMyPlans(JSON.stringify([plan('aaaa2222'), { id: 1 }, 'x']))).toEqual([plan('aaaa2222')])
    expect(readMyPlans('not json')).toEqual([])
    expect(readMyPlans(null)).toEqual([])
  })
})
