// Load test for a LOCAL co-pilot service. Usage:
//   node load.mjs <baseUrl> <clients> <questionsPerClient> <ipMode: distinct|same> [stream]
// Each client asks its questions one after another; clients run in parallel.
// Questions vary (site/month) so the answer cache does not hide the model's cost.
const [base, clientsArg, perArg, ipMode, stream] = process.argv.slice(2)
const clients = Number(clientsArg), per = Number(perArg)
const sites = ['Connecting Ridge', 'Shackleton Rim', 'Apollo 11', 'de Gerlache Rim', 'Peak near Shackleton', 'Chang\'e 4']
const months = ['January', 'March', 'May', 'July', 'September', 'November']
const lat = [], statuses = {}
let n = 0
async function one(clientId, k) {
  const q = `When is the Sun up at ${sites[(clientId + k) % sites.length]} in ${months[(clientId * 7 + k) % months.length]} (q${clientId}-${k})?`
  const ip = ipMode === 'same' ? '203.0.113.7' : `198.51.${Math.floor(clientId / 250)}.${clientId % 250}`
  const t0 = performance.now()
  let status
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': ip, ...(stream ? { accept: 'text/event-stream' } : {}) },
      body: JSON.stringify({ messages: [{ role: 'user', text: q }], view: `site=${clientId}-${k}` }),
    })
    const body = await r.text()
    status = r.status === 200 && stream && body.includes('event: error') ? '200-stream-error' : String(r.status)
    if (r.status !== 200 && !statuses[`${status} body`]) statuses[`${status} body`] = body.slice(0, 120)
  } catch (e) {
    status = 'neterr:' + (e.cause?.code ?? e.message)
  }
  const ms = performance.now() - t0
  statuses[status] = (statuses[status] ?? 0) + 1
  if (status === '200') lat.push(ms)
  n++
}
const t0 = performance.now()
await Promise.all(Array.from({ length: clients }, async (_, c) => { for (let k = 0; k < per; k++) await one(c, k) }))
const wall = (performance.now() - t0) / 1000
lat.sort((a, b) => a - b)
const p = (q) => (lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))]) : null)
console.log(JSON.stringify({ clients, per, ipMode, stream: !!stream, requests: n, wallS: +wall.toFixed(1), okPerMin: +((lat.length / wall) * 60).toFixed(0), p50: p(0.5), p95: p(0.95), p99: p(0.99), max: p(1), statuses }))
