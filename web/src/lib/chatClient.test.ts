import { afterEach, describe, expect, it, vi } from 'vitest'
import { askCopilot, type ChatMessage, DEFAULT_WAIT_SECONDS, failureText, readEvents, readReply, retryAfterSeconds, starterQuestions, stillWaitingText, toRequest } from './chatClient'
import { secondsLeft } from './cooldown'

describe('the co-pilot thread', () => {
  it('sends the last ten turns as plain text, without failure notices', () => {
    const thread: ChatMessage[] = [
      ...Array.from({ length: 12 }, (_, i): ChatMessage => ({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i}`, sources: ['x'] })),
      { role: 'assistant', text: 'busy', failed: true },
      { role: 'user', text: 'again?' },
    ]
    const request = toRequest(thread, '#a=apollo-11@2027-05')
    expect(request.view).toBe('#a=apollo-11@2027-05')
    expect(request.messages).toHaveLength(10)
    expect(request.messages.at(-1)).toEqual({ role: 'user', text: 'again?' })
    expect(request.messages.some((message) => message.text === 'busy')).toBe(false)
    expect(Object.keys(request.messages[0])).toEqual(['role', 'text'])
    // On the Atlas, a tapped spot goes along as "lat,lon"; with none, the request has no such field.
    expect('spot' in request).toBe(false)
    expect(toRequest(thread, '#a=apollo-11@2027-05', { lat: -89.31, lon: -132.5 }).spot).toBe('-89.31000,-132.50000')
  })

  it('reads a reply and keeps only buttons that are links to a view', () => {
    const reply = readReply({
      reply: {
        text: 'The Sun is up 59.5% of May 2027.',
        actions: [{ label: 'Open', hash: '#a=connecting-ridge@2027-05&t=0' }, { label: 'Bad', hash: 'https://evil.example' }, null],
        sources: ['Connecting Ridge, May 2027: month summary', 7],
        followups: ['And June?'],
      },
    })
    expect(reply).toEqual({
      role: 'assistant',
      text: 'The Sun is up 59.5% of May 2027.',
      actions: [{ label: 'Open', hash: '#a=connecting-ridge@2027-05&t=0' }],
      sources: ['Connecting Ridge, May 2027: month summary'],
      followups: ['And June?'],
    })
    expect(readReply({ reply: { text: '  ' } })).toBeNull()
    expect(readReply({ error: 'busy' })).toBeNull()
    expect(readReply(null)).toBeNull()
  })

  it('explains a failure in plain words, and offers questions about the place on screen', () => {
    expect(failureText(429)).toContain('busy')
    expect(failureText(502)).toContain('try sending it again')
    expect(starterQuestions('Shackleton Rim', 'August 2027', false)[0]).toBe('How sunny is Shackleton Rim in August 2027?')
    expect(starterQuestions('Shackleton Rim', 'August 2027', true)[0]).toBe('When can I land at Shackleton Rim in August 2027?')
  })

  it('reads whole events from a stream and keeps the unfinished rest for the next chunk', () => {
    const first = readEvents('event: step\ndata: {"title":"Month summary"}\n\nevent: rep')
    expect(first.events).toEqual([{ name: 'step', data: { title: 'Month summary' } }])
    expect(first.rest).toBe('event: rep')
    const second = readEvents(`${first.rest}ly\ndata: {"reply":{"text":"Done."}}\n\n`)
    expect(second.events).toEqual([{ name: 'reply', data: { reply: { text: 'Done.' } } }])
    expect(second.rest).toBe('')
    // A block that isn't a whole event, or whose data isn't JSON, is skipped.
    expect(readEvents(': keep-alive\n\nevent: step\ndata: {oops\n\n').events).toEqual([])
  })
})

describe('obeying Retry-After', () => {
  const NOW = Date.parse('2026-11-12T12:00:00Z')

  it('reads the wait from the header, as seconds or a date, or from the body of a stream event', () => {
    expect(retryAfterSeconds('18', null, NOW)).toBe(18)
    expect(retryAfterSeconds('Thu, 12 Nov 2026 12:00:30 GMT', null, NOW)).toBe(30)
    expect(retryAfterSeconds(null, { error: 'busy', retryAfterSeconds: 30 }, NOW)).toBe(30)
    expect(retryAfterSeconds('0', null, NOW)).toBe(1)
    expect(retryAfterSeconds(null, { error: 'busy' }, NOW)).toBeNull()
    expect(retryAfterSeconds('soon', 'fault filter abort', NOW)).toBeNull()
  })

  it('tells the visitor when to ask again, and says "later" for a long wait', () => {
    expect(failureText(429, 40)).toBe('Scout is busy. Ask again in 40 s.')
    expect(failureText(503, 120)).toBe('Scout is busy. Ask again in 2 min.')
    expect(failureText(429, 5000)).toBe('Scout is busy. Ask again later.')
    // A busy answer with no wait (the load balancer's own refusal) gets the default.
    expect(failureText(503)).toBe(`Scout is busy. Ask again in ${DEFAULT_WAIT_SECONDS} s.`)
    // "Not switched on" is a 503 too, and waiting will not help.
    expect(failureText(503, null, 'not-configured')).toBe("Scout isn't switched on here.")
    expect(stillWaitingText(12)).toContain('in 12 s')
  })

  describe('asking the co-pilot', () => {
    const reply = (response: Response) => {
      vi.stubGlobal('fetch', vi.fn(async () => response))
      return askCopilot([{ role: 'user', text: 'hi' }], '#a=x@2027-05', () => {})
    }
    afterEach(() => vi.unstubAllGlobals())

    it('passes on the wait from a 503 or 429 answer', async () => {
      expect(await reply(Response.json({ error: 'busy', retryAfterSeconds: 18 }, { status: 503, headers: { 'retry-after': '18' } }))).toMatchObject({ failed: true, retryAfterSeconds: 18 })
      expect(await reply(Response.json({ error: 'busy', retryAfterSeconds: 40 }, { status: 429, headers: { 'retry-after': '40' } }))).toMatchObject({ failed: true, retryAfterSeconds: 40 })
    })

    it('waits the default after the load balancer refuses with no header, and not at all when the co-pilot is off', async () => {
      expect(await reply(new Response('fault filter abort', { status: 503 }))).toMatchObject({ failed: true, retryAfterSeconds: DEFAULT_WAIT_SECONDS })
      const off = await reply(Response.json({ error: 'not-configured' }, { status: 503 }))
      expect(off.retryAfterSeconds).toBeUndefined()
      expect(off.text).toBe("Scout isn't switched on here.")
      expect((await reply(Response.json({ error: 'upstream' }, { status: 502 }))).retryAfterSeconds).toBeUndefined()
    })

    it('reads the wait from a busy event in a stream that had already begun', async () => {
      const stream = new Response('event: error\ndata: {"error":"busy","retryAfterSeconds":30}\n\n', { headers: { 'content-type': 'text/event-stream' } })
      expect(await reply(stream)).toMatchObject({ failed: true, retryAfterSeconds: 30, text: 'Scout is busy. Ask again in 30 s.' })
    })
  })
})

describe('the countdown', () => {
  it('counts whole seconds down to zero', () => {
    expect(secondsLeft(10_000, 0)).toBe(10)
    expect(secondsLeft(10_000, 9_001)).toBe(1)
    expect(secondsLeft(10_000, 10_000)).toBe(0)
    expect(secondsLeft(10_000, 20_000)).toBe(0)
  })
})
