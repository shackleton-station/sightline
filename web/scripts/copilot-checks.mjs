// The checks on the co-pilot API that both the site's smoke test (smoke.mjs) and the co-pilot
// service's own deploy check (copilot-check.mjs) run. They go through whatever address they are
// given: the site's public address or the co-pilot service's own.
//
// Only the co-pilot service answers /api/chat and /api/ask. It has a status address
// (GET /api/chat/status), so asking for it says whether an address reaches the service. The web
// server has no co-pilot: on its own address every one of these paths is 404.

const VIEW = '#a=connecting-ridge@2027-05&t=0&limits=14_72_72_1_1&mode=learn'
const json = async (response) => response.json().catch(() => ({}))

/**
 * Who answers the co-pilot at `base`: `{ by: 'copilot', status }` with the service's status,
 * `{ by: 'web' }` when only the web server is there (its 404: it has no co-pilot), or
 * `{ by: 'nobody', code }` when nothing sensible answers.
 */
export async function whoAnswersCopilot(base) {
  const response = await fetch(`${base}/api/chat/status`, { signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!response) return { by: 'nobody', code: 0 }
  const body = await json(response)
  if (response.status === 200 && body.service === 'copilot') return { by: 'copilot', status: body }
  if (response.status === 404 && body.error === 'not-found') return { by: 'web' }
  return { by: 'nobody', code: response.status }
}

/**
 * The checks that call no model and cost nothing: another site is refused and another method is
 * 405, on both endpoints. With `malformed`, also a malformed question is 400. None of these counts
 * against a limit: a request is read and checked before it is counted, so the 400 comes even when the
 * day's limit is full.
 * `check(name, ok, detail)` records each result.
 */
export async function checkCopilotReadOnly(base, check, { malformed = false } = {}) {
  const post = (path, body, origin = base) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  for (const path of ['/api/chat', '/api/ask']) {
    const outsider = await post(path, path === '/api/chat' ? { messages: [{ role: 'user', text: 'hi' }], view: VIEW } : { question: 'hi' }, 'https://evil.example')
    check(`${path} refuses other sites`, outsider.status === 403, `${outsider.status}`)
    if (malformed) {
      const bad = await post(path, path === '/api/chat' ? { messages: [] } : { question: '' })
      const badBody = await json(bad)
      check(`${path} refuses a malformed question before calling the model`, bad.status === 400 && badBody.error === 'bad-question', `${bad.status} ${JSON.stringify(badBody)}`)
    }
    const method = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) })
    check(`${path} answers 405 to GET`, method.status === 405, `${method.status}`)
  }
}

/**
 * One question, streamed: each lookup must arrive as its own event before the answer, and the answer
 * must be whole. Costs one model call unless the answer was kept. Through the load balancer, this is
 * the check that streaming still works there (the plan's "done when").
 */
// Not one of chat-eval's questions, which a deploy asks a minute before: its answer would be a kept one.
export async function checkCopilotStream(base, check, question = 'How long is the longest night at Shackleton Rim in June 2027?') {
  const started = Date.now()
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, accept: 'text/event-stream' },
    body: JSON.stringify({ messages: [{ role: 'user', text: question }], view: VIEW }),
    signal: AbortSignal.timeout(40_000),
  })
  if (!response.ok || !response.body) {
    check('a streamed question is answered', false, `HTTP ${response.status} ${response.headers.get('retry-after') ? `retry-after ${response.headers.get('retry-after')}` : ''}`)
    return
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  const arrivals = []
  let text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    text += value
    for (const name of [...value.matchAll(/^event: (\w+)$/gm)].map(([, name]) => name)) arrivals.push({ name, ms: Date.now() - started })
  }
  const kept = response.headers.get('x-cache') === 'hit'
  const reply = arrivals.find((event) => event.name === 'reply')
  check('a streamed question ends with a whole answer', Boolean(reply) && /"reply":\{"text":"/.test(text), `${arrivals.map((event) => `${event.name} at ${event.ms} ms`).join(', ')}${kept ? ' (a kept answer)' : ''}`)
  if (!kept) {
    const steps = arrivals.filter((event) => event.name === 'step')
    // Nothing between the service and here held the stream back: the first lookup arrived before the answer did.
    check('each lookup arrives as it happens, before the answer', steps.length > 0 && steps[0].ms < (reply?.ms ?? 0), steps.length > 0 ? `first lookup at ${steps[0].ms} ms, answer at ${reply?.ms} ms` : 'no lookup events')
  }
  check('the stream is not compressed or rewritten on the way', !response.headers.get('content-encoding') && (response.headers.get('cache-control') ?? '').includes('no-transform'), `${response.headers.get('content-encoding')} ${response.headers.get('cache-control')}`)
}
