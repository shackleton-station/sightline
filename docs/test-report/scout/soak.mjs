// Soak test for a LOCAL co-pilot: steady load for a while, sampling the server's memory and latency.
// Usage: node soak.mjs <baseUrl> <serverPid> <minutes> <clients>
import { readFileSync } from 'node:fs'
const [base, pid, minutesArg, clientsArg] = process.argv.slice(2)
const endAt = Date.now() + Number(minutesArg) * 60_000
const clients = Number(clientsArg)
const sites = ['Connecting Ridge', 'Shackleton Rim', 'Apollo 11', 'de Gerlache Rim', 'Peak near Shackleton']
const months = ['January', 'March', 'May', 'July', 'September', 'November']
let seq = 0
let win = { lat: [], status: {} }
const rssMb = () => {
  try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024) } catch { return null }
}
async function one(c) {
  seq++
  const common = Math.random() < 0.7
  const q = common
    ? `When is the Sun up at ${sites[seq % sites.length]} in ${months[seq % months.length]}?`
    : `When is the Sun up at ${sites[seq % sites.length]} in ${months[seq % months.length]}? (unique ${seq})`
  const view = common ? `site=${seq % sites.length}` : `site=u${seq}`
  const t0 = performance.now()
  let s
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${c}` },
      body: JSON.stringify({ messages: [{ role: 'user', text: q }], view }),
    })
    await r.text()
    s = String(r.status)
  } catch (e) { s = 'neterr' }
  win.status[s] = (win.status[s] ?? 0) + 1
  if (s === '200') win.lat.push(performance.now() - t0)
}
const t0 = Date.now()
const sampler = setInterval(() => {
  const l = win.lat.sort((a, b) => a - b)
  const p = (q) => (l.length ? Math.round(l[Math.min(l.length - 1, Math.floor(q * l.length))]) : null)
  console.log(JSON.stringify({ min: +((Date.now() - t0) / 60000).toFixed(1), rssMb: rssMb(), done: l.length, p50: p(0.5), p95: p(0.95), max: p(1), status: win.status }))
  win = { lat: [], status: {} }
}, 30_000)
console.log(JSON.stringify({ start: new Date().toISOString(), rssMb: rssMb(), clients, minutes: Number(minutesArg) }))
await Promise.all(Array.from({ length: clients }, async (_, c) => { while (Date.now() < endAt) await one(c) }))
clearInterval(sampler)
await new Promise((r) => setTimeout(r, 3000))
console.log(JSON.stringify({ end: new Date().toISOString(), rssMbAfterIdle3s: rssMb() }))
