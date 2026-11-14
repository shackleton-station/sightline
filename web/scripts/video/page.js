// Runs inside the page, before any of the site's own code, while the tutorial video is recorded
// (record.mjs adds it with Page.addScriptToEvaluateOnNewDocument). It does two things.
//
// 1. It gives the page a clock the recorder can hold. Until the recorder calls hold(), the clock
//    follows real time and the page behaves as it does for a visitor. After that, time moves only
//    when the recorder asks for the next frame, one thirtieth of a second at a time, so every frame
//    of the video is drawn in full however busy the machine is: no dropped or repeated frames.
//    The clock covers performance.now, Date, timers, requestAnimationFrame and CSS animations and
//    transitions. What comes from the network still arrives in real time.
//
// 2. It draws what the video adds on top of the site: the pointer, a ripple where it presses, a
//    ring round what is being talked about, and the cards that open and close the video. None of it
//    can be clicked or read by the page.
(() => {
  if (window.__video) return
  const real = {
    now: performance.now.bind(performance),
    Date,
    setInterval: window.setInterval.bind(window),
    setTimeout: window.setTimeout.bind(window),
    frame: window.requestAnimationFrame.bind(window),
  }
  // Date.now() at the moment performance.now() read zero.
  const dateAtZero = real.Date.now() - real.now()
  let now = real.now()
  let held = false
  let nextId = 1
  const timers = new Map()
  let frames = new Map()
  const later = (error) => real.setTimeout(() => { throw error })

  performance.now = () => now
  function VideoDate(...args) {
    if (!new.target) return new real.Date(dateAtZero + now).toString()
    return Reflect.construct(real.Date, args.length === 0 ? [dateAtZero + now] : args, new.target)
  }
  VideoDate.prototype = real.Date.prototype
  VideoDate.now = () => Math.floor(dateAtZero + now)
  VideoDate.parse = real.Date.parse
  VideoDate.UTC = real.Date.UTC
  window.Date = VideoDate

  // A timer given a string of code instead of a function is not run: the site has none.
  const timer = (run, delay, args, every) => {
    const id = nextId++
    const wait = Math.max(Number(delay) || 0, 1)
    timers.set(id, { due: now + wait, every: every ? wait : null, run: typeof run === 'function' ? () => run(...args) : () => {} })
    return id
  }
  window.setTimeout = (run, delay, ...args) => timer(run, delay, args, false)
  window.setInterval = (run, delay, ...args) => timer(run, delay, args, true)
  window.clearTimeout = window.clearInterval = (id) => void timers.delete(id)
  window.requestAnimationFrame = (run) => {
    const id = nextId++
    frames.set(id, run)
    return id
  }
  window.cancelAnimationFrame = (id) => void frames.delete(id)

  /** Moves the clock to `target`, running each timer that falls due on the way, in order. */
  function advanceTo(target) {
    for (let guard = 0; guard < 20_000; guard += 1) {
      let first = null
      for (const [id, entry] of timers) if (entry.due <= target && (first === null || entry.due < timers.get(first).due)) first = id
      if (first === null) break
      const entry = timers.get(first)
      now = Math.max(now, entry.due)
      if (entry.every === null) timers.delete(first)
      else entry.due = now + entry.every
      try {
        entry.run()
      } catch (error) {
        later(error)
      }
    }
    now = Math.max(now, target)
  }
  function runFrames() {
    const batch = frames
    frames = new Map()
    for (const run of batch.values()) {
      try {
        run(now)
      } catch (error) {
        later(error)
      }
    }
  }

  // CSS animations and transitions: held ones are paused and moved on by hand, a frame at a time.
  const ours = new WeakSet()
  const moving = (animation) => typeof animation.currentTime === 'number' || animation.currentTime === null
  /** Takes over whatever has started since the last look; a new one is put back to its start. */
  function takeAnimations(fromStart) {
    for (const animation of document.getAnimations()) {
      if (ours.has(animation) || !moving(animation)) continue
      ours.add(animation)
      if (animation.playState === 'finished') continue
      try {
        animation.pause()
        if (fromStart) animation.currentTime = 0
      } catch {
        // An animation that cannot be paused keeps its own time.
      }
    }
  }
  function moveAnimations(ms) {
    for (const animation of document.getAnimations()) {
      if (!ours.has(animation) || animation.playState !== 'paused') continue
      const end = animation.effect?.getComputedTiming().endTime ?? Infinity
      const at = (animation.currentTime ?? 0) + ms * (animation.playbackRate || 1)
      try {
        if (Number.isFinite(end) && at >= end) animation.finish()
        else animation.currentTime = at
      } catch {
        // Left where it is.
      }
    }
  }

  // Until held, the clock follows real time.
  real.setInterval(() => {
    if (!held) advanceTo(real.now())
  }, 4)
  const follow = () => {
    if (!held) {
      advanceTo(real.now())
      runFrames()
    }
    real.frame(follow)
  }
  real.frame(follow)

  // What the video draws over the site.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:strict'
  host.setAttribute('aria-hidden', 'true')
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `<style>
    .ring { position: absolute; box-sizing: border-box; border: 2px solid #fff; border-radius: 12px; box-shadow: 0 0 0 5px rgba(255,255,255,.16), 0 0 22px rgba(255,255,255,.28); }
    .tap { position: absolute; box-sizing: border-box; border: 3px solid #fff; border-radius: 50%; transform: translate(-50%, -50%); }
    .pointer { position: absolute; left: 0; top: 0; width: 34px; height: 34px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.65)); }
    .card { position: absolute; inset: 0; background: #05060a; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; text-align: center; color: #fff; }
    .card[hidden] { display: none; }
    .card h1 { margin: 0; font: 700 132px/1 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif; letter-spacing: -.01em; }
    .card p { margin: 0; font: 400 38px/1.25 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: rgba(255,255,255,.82); }
    .card p.small { font-size: 28px; color: rgba(255,255,255,.62); margin-top: 14px; }
  </style><div class="rings"></div><div class="tap" hidden></div>
  <svg class="pointer" viewBox="0 0 24 24" hidden><path d="M3 2 L3 19.5 L7.6 15.4 L10.6 22 L13.4 20.8 L10.5 14.3 L16.6 14.3 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>
  <div class="card" hidden></div>`
  const parts = { rings: root.querySelector('.rings'), tap: root.querySelector('.tap'), card: root.querySelector('.card'), pointer: root.querySelector('.pointer') }
  const mount = () => document.documentElement.appendChild(host)
  if (document.documentElement) mount()
  else document.addEventListener('readystatechange', mount, { once: true })

  const seen = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  /** True when the element can be seen now: on the page, and not faded out by itself or by what holds it. */
  const showing = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const labelOf = (el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
  /**
   * The element a direction names. A string is a CSS selector, or "label:Words" for a control whose
   * name is exactly those words, or "label~:Words" for one whose name contains them. An object is
   * { css, has, nth }: the nth element matching css whose text contains `has`. A list is tried in order.
   */
  function find(spec) {
    for (const one of Array.isArray(spec) ? spec : [spec]) {
      let found = null
      if (typeof one === 'object') {
        const all = [...document.querySelectorAll(one.css)].filter((el) => seen(el) && (one.has === undefined || labelOf(el).includes(one.has)))
        found = all[one.nth ?? 0] ?? null
      } else if (one.startsWith('label:') || one.startsWith('label~:')) {
        const part = one.startsWith('label~:')
        const words = one.slice(part ? 7 : 6)
        found = [...document.querySelectorAll('button, a, input, select, summary, [role="button"]')].filter(seen).find((el) => (part ? labelOf(el).includes(words) : labelOf(el) === words)) ?? null
      } else {
        found = [...document.querySelectorAll(one)].find(seen) ?? null
      }
      if (found) return found
    }
    return null
  }
  function box(spec) {
    const el = find(spec)
    if (!el) return null
    const b = el.getBoundingClientRect()
    const range = el instanceof HTMLInputElement && el.type === 'range' ? { min: Number(el.min), max: Number(el.max), value: Number(el.value) } : null
    return { x: b.left, y: b.top, w: b.width, h: b.height, name: labelOf(el).slice(0, 80), range }
  }

  const safe = (words) => String(words).replace(/[&<>]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[letter])
  let cardShown = ''
  /** Draws the pointer, the ripple, the rings and a card, if one is up, for the frame about to be taken. */
  function draw({ pointer, tap, rings = [], card = null }) {
    parts.card.hidden = !card
    if (card) {
      const words = `<h1>${safe(card.title)}</h1>${card.lines.map((line, index) => `<p class="${index > 0 ? 'small' : ''}">${safe(line)}</p>`).join('')}`
      if (words !== cardShown) parts.card.innerHTML = cardShown = words
      parts.card.style.opacity = card.alpha
    }
    parts.pointer.hidden = !pointer
    if (pointer) parts.pointer.style.transform = `translate(${pointer[0] - 4.2}px, ${pointer[1] - 2.8}px)`
    parts.tap.hidden = !tap
    if (tap) {
      const size = 18 + 46 * tap.age
      parts.tap.style.cssText = `left:${tap.x}px;top:${tap.y}px;width:${size}px;height:${size}px;opacity:${(1 - tap.age) * 0.85}`
    }
    const drawn = []
    for (const ring of rings) {
      const el = find(ring.spec)
      // No ring round something the page has faded out (Watch hides its controls when the pointer rests).
      if (!el || !showing(el)) continue
      const b = el.getBoundingClientRect()
      const pad = ring.pad ?? 6
      drawn.push(`<div class="ring" style="left:${b.left - pad}px;top:${b.top - pad}px;width:${b.width + 2 * pad}px;height:${b.height + 2 * pad}px;opacity:${ring.alpha};${ring.round ? 'border-radius:999px' : ''}"></div>`)
    }
    parts.rings.innerHTML = drawn.join('')
  }

  window.__video = {
    box,
    /** From here on time moves only when frame() is called. */
    hold() {
      held = true
      takeAnimations(false)
      return true
    },
    /** Draws the video's own marks, moves the clock on by `ms`, and resolves once the frame is on screen. */
    frame(state) {
      draw(state)
      return new Promise((done) => {
        real.frame(() => {
          moveAnimations(state.ms)
          advanceTo(now + state.ms)
          runFrames()
          real.frame(() => {
            takeAnimations(true)
            done(true)
          })
        })
      })
    },
  }
})()
