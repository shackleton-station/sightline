import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './chatClient'
import { answerToSay } from './scoutVoice'

const asked: ChatMessage = { role: 'user', text: 'Why does this landing not fit?' }
const answer: ChatMessage = { role: 'assistant', text: 'It does not fit because the Sun is gone for 95 h.' }
const busy: ChatMessage = { role: 'assistant', text: 'Scout is busy. Try again in a moment.', failed: true }

describe("which answer Scout's panel says aloud", () => {
  it('says the answer that arrives while the panel is open', () => {
    expect(answerToSay([asked, answer], 0, false)).toBe(answer)
  })

  it('says nothing when the panel opens on a conversation that was already there', () => {
    expect(answerToSay([asked, answer], 2, false)).toBeNull()
    expect(answerToSay([], 0, false)).toBeNull()
  })

  it('says nothing while an answer is awaited, so a new question stops the one before', () => {
    expect(answerToSay([asked, answer, asked], 0, true)).toBeNull()
  })

  it("never says the visitor's own words, nor a failure notice", () => {
    expect(answerToSay([asked], 0, false)).toBeNull()
    expect(answerToSay([asked, busy], 0, false)).toBeNull()
  })

  it('says the next answer too, once it has come', () => {
    const next: ChatMessage = { role: 'assistant', text: 'The next landing that fits is 22 June.' }
    expect(answerToSay([asked, answer, asked, next], 2, false)).toBe(next)
  })
})
