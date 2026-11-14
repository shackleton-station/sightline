// Puts sample question events through an events worker that asks nobody who they are (one machine:
// `npm run dev:server` or `docker compose up`), shaped exactly as Pub/Sub would push them.
//
//   node scripts/push-sample.mjs http://localhost:8081
//
// It sends: five different questions, one of them twice with a new message id (as the outbox relay
// would), one of them twice with the same message id (as Pub/Sub would), and one that cannot be
// counted. Then it reads the counts back. A pass is 5 questions counted and the bad one refused.
// It never works against the deployed worker: there, only Pub/Sub's own identity may push.
import { randomUUID } from 'node:crypto'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
if (!base) {
  console.error('Usage: node scripts/push-sample.mjs <events worker URL>')
  process.exit(2)
}

const at = new Date().toISOString()
const day = at.slice(0, 10)
const event = (overrides = {}) => ({ kind: 'copilot_question', id: randomUUID(), at, question: 'a sample question', site: 'connecting-ridge', month: '2027-05', lookups: [], cached: false, ms: 1200, outcome: 'answered', ...overrides })
let messageId = Date.now()
const push = async (data, id = String(++messageId)) => {
  const body = JSON.stringify({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), attributes: { kind: 'copilot_question' }, messageId: id, publishTime: at }, subscription: 'local' })
  return (await fetch(`${base}/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status
}

let failed = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed++
}

const before = await (await fetch(`${base}/counts?day=${day}`)).json().catch(() => null)
if (!before?.counts) {
  console.error(`${base}/counts did not answer with counts. Is the worker running with LOCAL_READS=on?`)
  process.exit(1)
}

const events = [event(), event({ cached: true }), event({ outcome: 'fallback' }), event({ outcome: 'busy' }), event({ outcome: 'error' })]
for (const one of events) check(`a question (${one.cached ? 'cached' : one.outcome}) is accepted`, (await push(one)) === 204)
check('the same event again, as a new message (the relay sent it twice), is accepted', (await push(events[0])) === 204)
const same = String(++messageId)
const sixth = event()
check('a message is accepted', (await push(sixth, same)) === 204)
check('the same message again (the queue delivered it twice) is accepted', (await push(sixth, same)) === 204)
check('an event that cannot be counted is refused, so the queue would retry it and then set it aside', (await push({ kind: 'copilot_question', at: 'not a time' })) === 400)

const after = await (await fetch(`${base}/counts?day=${day}`)).json()
const added = Object.fromEntries(Object.keys(after.counts).map((name) => [name, after.counts[name] - before.counts[name]]))
check('six questions were counted, each once', added.questions === 6, JSON.stringify(added))
check('and each kind of ending once', added.cached === 1 && added.fallback === 1 && added.busy === 1 && added.failed === 1)
console.log(`Today (${day}, UTC): ${JSON.stringify(after.counts)} over ${after.shards} shard${after.shards === 1 ? '' : 's'}`)
process.exit(failed ? 1 : 0)
