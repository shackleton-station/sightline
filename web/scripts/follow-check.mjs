// Checks "Follow the presenter" in real browser windows, and measures how far behind a follower is.
//
// Run it from web/, against a running copy of the site (it starts no server of its own):
//
//   npm run build && npm run dev:server           in one terminal (or any server on :8080)
//   node scripts/follow-check.mjs                  prints each check and the delays
//   node scripts/follow-check.mjs --out=some/folder   also saves the screenshots and the raw delays
//   node scripts/follow-check.mjs --base=https://…    another copy of the site
//
// It opens three windows in one headless Chrome: a presenter (1440 × 900), a follower the same size, and
// a follower the size of a phone (375 × 812). Each is a browser of its own (its own storage and its own
// connections to the site), as three people's devices are. It then:
//   1. changes the address of each page from outside and checks the page moves without loading again;
//   2. starts presenting, reads the link, and decodes the QR code from a screenshot of the panel;
//   3. on every design, changes the hour, the site, the month and the limits as a presenter would, and
//      checks both followers show the same thing at the same address, timing each change;
//   4. drags time for four seconds and counts what the presenter's page sent;
//   5. waits for the server to end a follower's stream on time (55 s) and checks the browser connects
//      again by itself and still follows (skip this minute with --quick);
//   6. checks a follower who touches the page keeps following, and how stopping and ending look.
// The delay is from the presenter's change to the follower's page showing it, both read from the pages'
// own clocks (one machine, so one clock). Needs Google Chrome (set CHROME to its path if needed).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const BASE = (args.get('base') ?? 'http://localhost:8080').replace(/\/$/, '')
const outDir = args.has('out') ? resolve(args.get('out')) : null
if (outDir) mkdirSync(outDir, { recursive: true })
/** A follower should show a change within this long; a change of tab, which loads a page, within the second. */
const MOVE_MS = 3000
const TAB_MS = 10_000
/** Changes are spaced so that each is published at once, not held back by the one-a-second limit. */
const BETWEEN_MS = 1300

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** A connection to Chrome's DevTools protocol: send(method, params, sessionId) resolves with the result. */
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((open, fail) => {
    socket.onopen = open
    socket.onerror = () => fail(new Error('Could not connect to Chrome.'))
  })
  const waiting = new Map()
  const listeners = []
  let nextId = 1
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) return listeners.forEach((listen) => listen(message))
    const { done, fail } = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.error) fail(new Error(message.error.message))
    else done(message.result)
  }
  return {
    send(method, params = {}, sessionId = undefined) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params, sessionId }))
      return new Promise((done, fail) => waiting.set(id, { done, fail }))
    },
    onEvent: (listen) => listeners.push(listen),
    close: () => socket.close(),
  }
}

/**
 * Runs in every page before its own code. `__shows()` is what the page has on screen, as text: the
 * site, the hour, the month and the limits, read from wherever each design puts them. `__seen` is
 * every change of it with the time, so the moment a follower's page moved can be read afterwards.
 */
const WATCH = `
  window.__shows = () => {
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''
    const site = [...document.querySelectorAll('select')].map((select) => select.selectedOptions[0]?.textContent ?? '').join(',')
    const limits = '.pl-mission input[type=number], .pl-mission input[type=checkbox], .mission-inputs input'
    const numbers = [...document.querySelectorAll(limits)].map((input) => (input.type === 'checkbox' ? Number(input.checked) : input.value)).join('_')
    return [site, text('.river-time') || text('.slider output'), text('#pl-brief-title'), text('.pl-when'), numbers, text('#briefing-title'), text('.briefing-mission'), text('main h1'), text('.atlas-layers button[aria-pressed=true]'), text('.sf-compass-facing')].join(' | ')
  }
  // When a key was last pressed in this page: the moment of a change made with the keyboard.
  window.addEventListener('keydown', () => { window.__keyAt = Date.now() }, true)
  // When this page was last told its address had changed: for a follower, the moment the presenter's change arrived.
  window.addEventListener('hashchange', () => { window.__toldAt = Date.now() }, true)
  window.__seen = []
  setInterval(() => {
    const now = window.__shows()
    if (now !== window.__seen.at(-1)?.shows) window.__seen.push({ shows: now, at: Date.now() })
  }, 10)
`

async function openWindow(cdp, { width, height, phone }) {
  // A context of its own: over HTTP/1.1 (a local server) a browser keeps six connections to a site, and
  // three windows sharing them, each holding one open for its stream, would queue behind one another.
  const { browserContextId } = await cdp.send('Target.createBrowserContext')
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => cdp.send(method, params, sessionId)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: phone ? 2 : 1, mobile: Boolean(phone) })
  // Each window behaves as the one in front, as a presenter's laptop and a follower's phone both are.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH })
  const run = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }
  /** Asks until the answer passes, or gives up. A page that is between two documents has no answer yet. */
  const until = async (expression, passes, timeoutMs) => {
    const deadline = Date.now() + timeoutMs
    let last
    for (;;) {
      last = await run(expression).catch(() => undefined)
      if (last !== undefined && passes(last)) return last
      if (Date.now() > deadline) return undefined
      await sleep(40)
    }
  }
  return {
    sessionId,
    send,
    run,
    until,
    go: (path) => send('Page.navigate', { url: `${BASE}${path}` }),
    address: () => run("location.pathname + location.search + (location.hash === '#' ? '' : location.hash)"),
    key: async (key, code) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
    },
    shot: async (name, clip) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) })
      if (outDir) writeFileSync(join(outDir, name), Buffer.from(data, 'base64'))
      return data
    },
  }
}

/** What the page shows once it has stopped changing (and, if `not` is given, has changed from that). */
async function settled(page, not = null, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  let since = Date.now()
  for (;;) {
    const now = await page.run('window.__shows?.() ?? null').catch(() => null)
    if (now !== last) {
      last = now
      since = Date.now()
    }
    const ready = last !== null && last !== not && / \| .*[A-Za-z0-9]/.test(last)
    if (ready && Date.now() - since >= 500) return last
    if (Date.now() > deadline) return last
    await sleep(50)
  }
}

const VIEWS = {
  first: '#a=connecting-ridge@2027-05&t=120&limits=14_72_72_1_1&view=3d&mode=learn',
  second: '#a=shackleton-rim@2027-06&t=300&limits=10_48_48_1_1&view=3d&mode=learn',
}
const DESIGNS = [
  { id: 'classic', tab: 'Classic', path: '/classic/' },
  { id: 'mission', tab: 'Mission control', path: '/classic/?ui=next' },
  { id: 'scout', tab: 'Scout', path: '/scout/' },
  { id: 'planner', tab: 'Planner', path: '/planner/' },
  { id: 'atlas', tab: 'Atlas', path: '/atlas/' },
  { id: 'briefing', tab: 'Briefing', path: '/briefing/' },
  { id: 'surface', tab: 'Surface', path: '/surface/' },
]

// ---- What a presenter does, as code run in the presenter's page. Each returns the time it was done. ----

/** Presses a key on the time control (the range input every design with a river or slider has). */
const focusTime = "document.querySelector('input[type=range][aria-label*=ime], .river input[type=range], .slider input[type=range]')?.focus()"
/** Picks another site in the page's own list, as a person would. */
const pickSite = (name) => `(() => {
  const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === ${JSON.stringify(name)}))
  const option = [...select.options].find((o) => o.textContent === ${JSON.stringify(name)})
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
  return Date.now()
})()`
/** Types a number into one of the Planner's limits. */
const setLimit = (index, value) => `(() => {
  const input = document.querySelectorAll('.pl-mission input[type=number]')[${index}]
  input.focus()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  const at = Date.now()
  // Leaving the field settles it, as it does for a person.
  input.blur()
  return at
})()`
const click = (selector, text = null) => `(() => {
  const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) => ${text === null ? 'true' : `el.textContent.trim().includes(${JSON.stringify(text)})`})
  if (!found) throw new Error('nothing to click: ' + ${JSON.stringify(`${selector} ${text ?? ''}`)})
  found.click()
  return Date.now()
})()`
/** Changes the part of the address after "#", as pasting a link into the open tab does. */
const setHash = (change) => `(() => {
  const params = new URLSearchParams(location.hash.slice(1))
  ;(${change})(params)
  location.hash = '#' + params.toString().replaceAll('%2C', ',').replaceAll('%40', '@')
  return Date.now()
})()`

const profile = mkdtempSync(join(tmpdir(), 'follow-check-'))
const browser = spawn(
  chrome,
  [
    '--headless=new',
    ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
    '--remote-debugging-port=0',
    '--window-size=1440,900',
    '--no-first-run',
    '--no-default-browser-check',
    // Three windows share one headless browser; none of them is treated as a hidden tab.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const delays = []
let cdp
try {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let tries = 0; !existsSync(portFile); tries += 1) {
    if (tries > 100) throw new Error('Chrome did not start.')
    await sleep(100)
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
  cdp = await connect(`ws://127.0.0.1:${port}${path}`)
  const status = await (await fetch(`${BASE}/api/status`)).json()
  console.log(`Site: ${BASE}, rooms kept in ${status.follow?.rooms ?? 'nothing (following is off)'}`)

  const presenter = await openWindow(cdp, { width: 1440, height: 900 })
  const follower = await openWindow(cdp, { width: 1440, height: 900 })
  const phone = await openWindow(cdp, { width: 375, height: 812, phone: true })
  /** Every request the presenter's page makes to the rooms API, with the time. */
  const published = []
  cdp.onEvent((message) => {
    if (message.method !== 'Network.requestWillBeSent' || message.sessionId !== presenter.sessionId) return
    const { url, method } = message.params.request
    // The browser's own clock for the request, the same clock the pages' times are read from.
    if (method === 'POST' && /\/api\/rooms\/[a-z0-9]+$/.test(url)) published.push(Math.round(message.params.wallTime * 1000))
  })
  /** Every stream the first follower's page opens. */
  const streams = []
  cdp.onEvent((message) => {
    if (message.method === 'Network.requestWillBeSent' && message.sessionId === follower.sessionId && message.params.request.url.endsWith('/events')) streams.push(Date.now())
  })

  // ---- 1. Each page moves when its address is changed from outside, without loading again ----
  console.log('\nEach page moves with its address')
  for (const design of DESIGNS) {
    await presenter.go(`${design.path}${VIEWS.first}`)
    const before = await settled(presenter)
    await presenter.run('window.__sameDocument = true')
    await presenter.run(`location.hash = ${JSON.stringify(VIEWS.second)}`)
    const after = await settled(presenter, before)
    const same = await presenter.run('window.__sameDocument === true')
    check(`${design.tab}: a new address after "#" moves the page, with no page load`, same && after !== before && /Shackleton Rim|June 2027|Jun 2027/.test(after ?? ''), `${before} → ${after}`)
  }
  // The main app's other pages: the front page (no hash), How it works, and back to a site.
  await presenter.go(`/classic/${VIEWS.first}`)
  await settled(presenter)
  await presenter.run('window.__sameDocument = true')
  await presenter.run("history.replaceState(null, '', '/'); dispatchEvent(new HashChangeEvent('hashchange', { oldURL: location.href, newURL: location.href }))")
  const front = await presenter.until('window.__shows()', (shows) => shows.includes('Where on the Moon can we land'), 5000)
  check('Classic: the bare address shows the front page', Boolean(front) && (await presenter.run('window.__sameDocument === true')))
  await presenter.run("location.hash = '#how'")
  check('Classic: #how shows How it works', Boolean(await presenter.until('window.__shows()', (shows) => shows.includes('From NASA'), 5000)))
  await presenter.run(`location.hash = ${JSON.stringify(VIEWS.second)}`)
  check('Classic: a view link leaves How it works for the site', Boolean(await presenter.until('window.__shows()', (shows) => shows.includes('Shackleton Rim'), 5000)) && (await presenter.run('window.__sameDocument === true')))

  // ---- 2. Presenting: the panel, the link and the QR code ----
  console.log('\nPresenting')
  await presenter.go(`/scout/${VIEWS.first}`)
  await settled(presenter)
  await presenter.run(click('.follow-present'))
  const link = await presenter.until("document.querySelector('.follow-link')?.textContent ?? ''", (text) => text.includes('?follow='), 5000)
  check('Present opens a panel with the link', Boolean(link), link)
  await presenter.until("document.querySelector('.follow-qr path')?.getAttribute('d')?.length ?? 0", (length) => length > 100, 5000)
  await sleep(300)
  await presenter.shot('presenter-panel.png')
  const box = await presenter.run("(() => { const r = document.querySelector('.follow-qr').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()")
  const qrPng = await presenter.shot('presenter-qr.png', box)
  // The code is read back from the pixels of the screenshot, by the browser's own barcode reader where it has one.
  const decoded = await presenter
    .run(`(async () => {
      if (!('BarcodeDetector' in window)) return null
      const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,${qrPng}')).blob())
      return (await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap)).map((found) => found.rawValue)
    })()`)
    .catch(() => null)
  if (decoded === null) console.log('  note: this Chrome has no BarcodeDetector; decode presenter-qr.png another way')
  else check('the QR code in the screenshot decodes to the link', decoded.length === 1 && decoded[0] === link, JSON.stringify(decoded))
  check('the QR code is large', box.width >= 300, `${Math.round(box.width)} px wide in a 900 px tall window`)
  await presenter.run(click('.follow-panel button', 'Hide the code'))

  // ---- Followers open the link ----
  await follower.go(link.replace(/^https?:\/\/[^/]+/, ''))
  await phone.go(link.replace(/^https?:\/\/[^/]+/, ''))
  const startAddress = await presenter.address()
  for (const [name, page] of [['a follower', follower], ['a phone', phone]]) {
    const arrived = await page.until("location.pathname + location.search + location.hash", (address) => address === startAddress, TAB_MS)
    check(`${name} who opens the link goes to the presenter's page`, Boolean(arrived), arrived ?? (await page.address()))
    check(`${name} sees "Following the presenter"`, Boolean(await page.until("document.querySelector('.follow-bar')?.textContent ?? ''", (text) => text.includes('Following the presenter') && text.includes('Stop following'), 5000)))
  }
  const counted = await presenter.until("document.querySelector('.follow-bar')?.textContent ?? ''", (text) => text.includes('2 following'), 5000)
  check('the presenter sees 2 following', Boolean(counted), counted ?? (await presenter.run("document.querySelector('.follow-bar')?.textContent")))

  /**
   * One change by the presenter. Waits for the presenter's own page to show it, then for both
   * followers to show the same at the same address, and records how long the first follower took.
   */
  async function change(label, act, { limitMs = MOVE_MS, kind = 'change' } = {}) {
    const before = await presenter.run('window.__shows?.() ?? null').catch(() => null)
    const doneAt = typeof act === 'function' ? await act() : await presenter.run(act)
    const expected = await settled(presenter, kind === 'tab' ? null : before)
    const address = await presenter.address()
    const moved = await follower.until('JSON.stringify(window.__seen ?? [])', (seen) => JSON.parse(seen).at(-1)?.shows === expected, limitMs)
    const followerAddress = await follower.until("location.pathname + location.search + (location.hash === '#' ? '' : location.hash)", (now) => now === address, 2000)
    const onPhone = await phone.until("location.pathname + location.search + (location.hash === '#' ? '' : location.hash)", (now) => now === address, limitMs)
    // A phone lays some designs out differently, so it is held to the hour and the headings, not the whole text.
    const parts = (shows) => (shows ?? '').split(' | ').filter((part, index) => [1, 2, 3, 5].includes(index)).join(' | ')
    const phoneShows = await phone.until('window.__shows()', (shows) => parts(shows) === parts(expected), limitMs)
    const delay = moved ? JSON.parse(moved).findLast((entry) => entry.shows === expected).at - doneAt : null
    // For a change of tab: how long after the click the follower's new page began to load.
    const loadMs = kind === 'tab' ? Math.round((await follower.run('performance.timeOrigin')) - doneAt) : null
    // How much of the delay passed before the presenter's page sent the change (it looks at its address
    // five times a second, and sends at most once a second).
    // And how far behind the presenter's own screen the follower's was: a new site or page takes both a while to draw.
    const ownAt = JSON.parse(await presenter.run('JSON.stringify(window.__seen ?? [])')).findLast((entry) => entry.shows === expected)?.at
    const behindMs = delay === null || ownAt === undefined ? null : doneAt + delay - ownAt
    // When the follower's page was told (its "hashchange"), which leaves the time its own page took to draw the change.
    const toldAt = kind === 'tab' ? null : await follower.run('window.__toldAt ?? null').catch(() => null)
    const toldMs = delay === null || toldAt === null || toldAt < doneAt || toldAt - doneAt > delay ? null : toldAt - doneAt
    const sentAt = published.find((at) => at >= doneAt)
    const sentMs = kind === 'tab' || delay === null || sentAt === undefined || sentAt - doneAt > delay ? null : sentAt - doneAt
    delays.push({ label, kind, ms: delay, ...(behindMs === null ? {} : { behindMs }), ...(sentMs === null ? {} : { sentMs }), ...(toldMs === null ? {} : { toldMs }), ...(loadMs === null ? {} : { loadMs }) })
    const short = (shows) => shows.replace(/( \| )+/g, ' · ').replace(/^ · | · $/g, '').slice(0, 110)
    check(
      label,
      delay !== null && delay >= 0 && followerAddress === address && onPhone === address && Boolean(phoneShows) && expected !== before,
      delay === null || !phoneShows
        ? `the presenter shows "${expected}", the follower "${await follower.run('window.__shows?.()').catch(() => '?')}", the phone "${await phone.run('window.__shows?.()').catch(() => '?')}"`
        : `${delay} ms${behindMs === null ? '' : `, ${behindMs} ms behind the presenter's screen`}${sentMs === null ? '' : `, sent after ${sentMs}`}${toldMs === null ? '' : `, the follower told after ${toldMs}`}${loadMs === null ? '' : `, the follower's page began loading after ${loadMs} ms`}; ${short(expected)}`,
    )
    await sleep(BETWEEN_MS)
    return expected
  }
  const arrow = (key, code) => async () => {
    await presenter.run(focusTime)
    await presenter.key(key, code)
    return presenter.run('window.__keyAt')
  }

  // ---- 3. Every design: the tab, then the hour, the site, the month and the limits ----
  await sleep(BETWEEN_MS)
  for (const design of DESIGNS) {
    console.log(`\n${design.tab}`)
    await change(`the presenter opens the ${design.tab} tab`, click('a.site-tab', design.tab), { limitMs: TAB_MS, kind: 'tab' })
    check(`${design.tab}: the presenter is still presenting after changing tab`, (await presenter.run("document.querySelector('.follow-bar')?.textContent ?? ''")).includes('Presenting'))
    if (design.id === 'planner') {
      await change('Planner: mission length to 10 days', setLimit(0, 10))
      await change('Planner: longest time without Sun to 48 h', setLimit(1, 48))
      await change('Planner: another site and month (a square of the table)', setHash("(p) => p.set('a', 'shackleton-rim@2027-08')"))
      await change('Planner: another landing hour', setHash("(p) => p.set('t', '200')"))
      await change('Planner: back to the example mission', click('.pl-mission button', 'example mission'))
      await change('Planner: another site', setHash("(p) => p.set('a', 'connecting-ridge@2027-05')"))
    } else if (design.id === 'briefing') {
      await change('Briefing: another month', setHash("(p) => p.set('a', 'connecting-ridge@2027-07')"))
      await change('Briefing: another mission', setHash("(p) => p.set('limits', '10_48_48_1_1')"))
      await change('Briefing: back to the first month and mission', setHash("(p) => { p.set('a', 'connecting-ridge@2027-05'); p.set('limits', '14_72_72_1_1') }"))
    } else {
      await change(`${design.tab}: one hour later (a key on the time control)`, arrow('ArrowRight', 39))
      await change(`${design.tab}: another hour later`, arrow('ArrowRight', 39))
      await change(`${design.tab}: one hour earlier`, arrow('ArrowLeft', 37))
      await change(`${design.tab}: another site, from the list`, pickSite('Shackleton Rim'))
      await change(`${design.tab}: next month`, design.id === 'classic' ? click('.time-bar button, .timebar button, button', 'Jun 2027') : click('.river-month', 'Jun'))
      // Scout and the Atlas show no limits (their address always carries the example ones). The other two show them in Plan mode.
      if (design.id === 'classic' || design.id === 'mission') {
        // Mission control keeps its limits on the "When to land" side of its panel, and which side is open is not
        // in the address. So that side is opened by hand in both windows, as a follower would to look at them.
        if (design.id === 'mission') for (const page of [presenter, follower]) await page.run(click('.mc-tabs button', 'When to land'))
        await change(`${design.tab}: Plan mode, with other limits`, setHash("(p) => { p.set('mode', 'plan'); p.set('limits', '10_48_48_1_1') }"))
      }
      if (design.id === 'atlas') await change('Atlas: another coloring of the ground (Sun + Earth)', click('.atlas-layers button', 'Sun + Earth'))
      // The Surface keeps the way the visitor faces in its address, so a presenter's turn turns the followers.
      if (design.id === 'surface') await change('Surface: turn to face 120°', setHash("(p) => p.set('look', '120_2_40')"))
      await change(`${design.tab}: back to the first site, month and limits`, setHash("(p) => { p.set('a', 'connecting-ridge@2027-05'); p.set('t', '120'); p.set('limits', '14_72_72_1_1'); p.set('mode', 'learn'); p.delete('layer') }"))
    }
  }

  // ---- The main app's other pages ----
  console.log('\nThe front page, How it works, and back')
  await change('the presenter opens the Classic tab', click('a.site-tab', 'Classic'), { limitMs: TAB_MS, kind: 'tab' })
  await change('the presenter presses "Whole Moon" on the page: the front page', click('.app-header button', 'Whole Moon'))
  await change('the presenter opens How it works from the front page', click('button, a', 'How it works'))
  await change('the presenter pastes a link to a site', `(() => { location.hash = ${JSON.stringify(VIEWS.second)}; return Date.now() })()`)
  await change('the presenter opens the Demo video tab', click('a.site-tab', 'Demo video'))
  await change('the presenter types "hype": the easter egg', `(() => { for (const key of 'hype') window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return Date.now() })()`, { limitMs: TAB_MS, kind: 'tab' })
  await change('the presenter opens the Whole Moon tab', click('a.site-tab', 'Whole Moon'), { limitMs: TAB_MS, kind: 'tab' })

  // ---- 4. Dragging time: many changes a second ----
  console.log('\nDragging time')
  await change('the presenter opens the Scout tab', click('a.site-tab', 'Scout'), { limitMs: TAB_MS, kind: 'tab' })
  await sleep(1500)
  published.length = 0
  await presenter.run(focusTime)
  const dragStarted = Date.now()
  for (let step = 0; step < 40; step += 1) {
    await presenter.key('ArrowRight', 39)
    await sleep(100)
  }
  const dragMs = Date.now() - dragStarted
  const finalShows = await settled(presenter)
  const caughtUp = await follower.until('window.__shows()', (shows) => shows === finalShows, MOVE_MS)
  await sleep(1500)
  const gaps = published.slice(1).map((at, index) => at - published[index])
  check(
    `40 changes in ${(dragMs / 1000).toFixed(1)} s are published at most about once a second, and the follower ends where the presenter did`,
    Boolean(caughtUp) && published.length <= Math.ceil(dragMs / 1000) + 2 && gaps.every((gap) => gap >= 900),
    `${published.length} publishes, ${gaps.join(', ')} ms apart; both show ${finalShows.replace(/( \| )+/g, ' · ')}`,
  )

  // ---- 5. The stream ends on time and the browser connects again ----
  if (!args.has('quick')) {
    console.log('\nA stream that reaches its time limit')
    const opened = streams.length
    const openedAt = streams.at(-1)
    const deadline = Date.now() + 70_000
    while (streams.length === opened && Date.now() < deadline) await sleep(250)
    check('the server ends the stream before a minute is up, and the browser opens another by itself', streams.length > opened, streams.length > opened ? `${((streams.at(-1) - openedAt) / 1000).toFixed(1)} s after the first opened` : 'no second stream in 70 s')
    check('the follower still says "Following the presenter"', (await follower.run("document.querySelector('.follow-bar')?.textContent ?? ''")).includes('Following the presenter'))
    await change('a change after the reconnect reaches the follower', arrow('ArrowRight', 39))
  }

  // ---- 6. Touching the page, stopping, ending ----
  console.log('\nA follower who touches the page; stopping; ending')
  await phone.shot('follower-phone.png')
  const together = await follower.run('window.__shows()')
  await follower.run(focusTime)
  for (let step = 0; step < 3; step += 1) await follower.key('ArrowLeft', 37)
  const wandered = await settled(follower, together)
  check('a follower can move time on their own page', wandered !== together, wandered)
  await sleep(2500)
  check('and stays there until the presenter moves', (await follower.run('window.__shows()')) === wandered)
  await change('the presenter moves: the follower who wandered is moved again', arrow('ArrowRight', 39))

  await phone.run(click('.follow-bar button', 'Stop following'))
  check('Stop following takes the banner away', (await phone.until("document.querySelector('.follow-bar') === null", (gone) => gone, 3000)) === true)
  const one = await presenter.until("document.querySelector('.follow-bar')?.textContent ?? ''", (text) => text.includes('1 following'), 5000)
  check('the presenter sees 1 following', Boolean(one), one ?? (await presenter.run("document.querySelector('.follow-bar')?.textContent")))
  const phoneAt = await phone.address()
  await presenter.key('ArrowRight', 39)
  await sleep(2000)
  check('the phone that stopped following stays where it is', (await phone.address()) === phoneAt)

  const followerAt = await follower.address()
  await presenter.run(click('.follow-bar button', 'Stop'))
  const ended = await follower.until("document.querySelector('.follow-bar')?.textContent ?? ''", (text) => text.includes('has ended'), 5000)
  check('when the presenter stops, the follower is told and keeps the page they are on', Boolean(ended) && (await follower.address()) === followerAt, ended ?? '')
  check('the presenter is no longer presenting', (await presenter.until("document.querySelector('.follow-bar') === null", (gone) => gone, 3000)) === true)
  await follower.send('Page.reload')
  await settled(follower)
  check('after a reload the follower is an ordinary visitor', (await follower.run("document.querySelector('.follow-bar') === null")) === true)
} finally {
  cdp?.close()
  browser.kill()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}

// ---- The delays ----
const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const report = (name, kinds) => {
  const values = delays.filter((entry) => kinds.includes(entry.kind) && entry.ms !== null).map((entry) => entry.ms)
  if (values.length > 0) console.log(`${name}: ${values.length} changes, median ${middle(values)} ms, worst ${Math.max(...values)} ms, best ${Math.min(...values)} ms`)
}
console.log('\nFrom the presenter\'s change to the follower\'s page showing it')
report('Site, month, hour or limits (the address after "#")', ['change', 'limits'])
const behind = delays.filter((entry) => entry.kind !== 'tab' && entry.behindMs !== undefined).map((entry) => entry.behindMs)
if (behind.length > 0) console.log(`  behind the presenter's own screen showing it: median ${middle(behind)} ms, worst ${Math.max(...behind)} ms`)
const told = delays.filter((entry) => entry.toldMs !== undefined)
if (told.length > 0) {
  console.log(`  the follower's page was told after: median ${middle(told.map((entry) => entry.toldMs))} ms, worst ${Math.max(...told.map((entry) => entry.toldMs))} ms`)
  console.log(`  and then took, to draw it: median ${middle(told.map((entry) => entry.ms - entry.toldMs))} ms, worst ${Math.max(...told.map((entry) => entry.ms - entry.toldMs))} ms (${told.length} of the changes)`)
}
const waits = delays.filter((entry) => entry.sentMs !== undefined)
if (waits.length > 0) {
  console.log(`  of which, before the presenter's page sent it: median ${middle(waits.map((entry) => entry.sentMs))} ms, worst ${Math.max(...waits.map((entry) => entry.sentMs))} ms`)
  console.log(`  and from then to the follower's page showing it: median ${middle(waits.map((entry) => entry.ms - entry.sentMs))} ms, worst ${Math.max(...waits.map((entry) => entry.ms - entry.sentMs))} ms (${waits.length} of the changes)`)
}
report('Another tab (a page load on both sides)', ['tab'])
if (outDir) writeFileSync(join(outDir, 'follow-check.json'), JSON.stringify(delays, null, 2))
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
