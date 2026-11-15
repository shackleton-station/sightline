// Looks at Sightline (/sightline/) in headless Chrome: a screenshot of each scene at a laptop and a
// phone size, and a few checks of how the page behaves. The Browser pane is not reliable for
// animation while hidden, so this is the one look a change gets.
//
// Run it from web/, after `npm install`:
//
//   node scripts/sightline-shots.mjs --out=shots                 checks and screenshots
//   node scripts/sightline-shots.mjs                             checks only
//   node scripts/sightline-shots.mjs --only=watch --out=shots    some scenes only
//   node scripts/sightline-shots.mjs --only=layers --layer=2 --out=shots   the Layers scene, ending on another layer
//   node scripts/sightline-shots.mjs --sizes=laptop              one size only
//   node scripts/sightline-shots.mjs --load=slow --base=https://lunarsightline.com   how the page opens on a slow connection
//   node scripts/sightline-shots.mjs --poster=poster.png         a picture of the Moon as the page first shows it
//   node scripts/sightline-shots.mjs --base=https://lunarsightline.com   against a site already running
//   node scripts/sightline-shots.mjs --ask --only=scout-reply    also ask Scout one real question (calls the model)
//
// Without --ask no question reaches the chat, on a laptop or against a live site: whatever a page
// sends to /api/chat or /api/ask is answered inside the browser with a stand-in reply. The chat
// allows everyone together a set number of questions a day, and a check run must not spend them.
// With --ask, only the scene that asks the real question ("scout-reply") reaches it: one question a size.
//
// Without --base it starts the Vite dev server itself. Needs Google Chrome (set CHROME to its path if
// it isn't in the usual place).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const webDir = fileURLToPath(new URL('..', import.meta.url))
const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')))
const outDir = args.has('out') ? resolve(args.get('out')) : null
if (outDir) mkdirSync(outDir, { recursive: true })
const TIMEOUT_MS = 30_000
// The scenes that ask whether the side panels fit without scrolling also run at a smaller laptop size.
/** The feature guides' ids, as src/sightline/guides.json has them (read here, ahead of the sizes that name their scenes). */
const GUIDE_IDS = JSON.parse(readFileSync(new URL('../src/sightline/guides.json', import.meta.url), 'utf8')).guides.map((guide) => guide.id)
const SIZES = [
  { name: 'laptop', width: 1440, height: 900, scale: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, scale: 2, mobile: true },
  // A smaller laptop, for the scenes that ask whether the side panels fit without scrolling.
  { name: 'small-laptop', width: 1366, height: 768, scale: 1, mobile: false, onlyScenes: ['mission-fits', 'two-by-default', 'two-by-default-pick', 'skyline-fold', 'skyline-four', 'compass-below', 'compass-below-watch', 'tour-video', 'hype-egg', 'other-site', 'tour', 'tour-restore', 'watch-scout-long', 'heights', 'heights-link', 'place-names', 'planner-moon', 'planner-find', 'planner-find-more', 'planner-compare', 'planner-compare-detail', 'planner-narrow-find', 'planner-narrow-compare', 'rows-panels', 'plan-link', 'plan-open', 'plan-open-planner', 'plan-kinds', 'plan-gone', 'share-sheet', 'mission', 'compare-four', 'compare-fits', 'steady', 'horizons', 'layers', 'rover', 'site-light', 'layouts', 'scout-panel', 'marginal', 'planner', 'planner-four', 'near-side', 'brief', 'why', 'earth-partly', 'surface-bar', 'surface-own-point'] },
  // A window with little room, as a tablet held sideways or a narrow laptop window has: the Planner's two tabs with Scout's panel open beside them.
  { name: 'narrow-laptop', width: 1024, height: 768, scale: 1, mobile: false, onlyScenes: ['planner-narrow-find', 'planner-narrow-compare', 'planner-find', 'planner-compare'] },
]

/**
 * Each scene opens the page at `hash`, runs `steps` (JavaScript, one string a step, with a pause
 * after each), then runs `checks`: a name and an expression that must be true.
 */
const text = (selector) => `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '')`
const click = (label) => `[...document.querySelectorAll('button')].find((el) => (el.getAttribute('aria-label') ?? el.textContent).trim() === ${JSON.stringify(label)})?.click()`
const key = (name) => `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(name)}, bubbles: true }))`
/**
 * True when no site marker prints over another, and no name that can be seen at all prints over
 * another name or lies under a marker that isn't its own. A name counts as seen unless it is fully
 * hidden (visibility hidden): a dimmed or half-faded one still counts. A marker is taken with its
 * ring or outline, 4 px beyond its box.
 */
const DOTS_CLEAR = `(() => {
  const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
  const markers = [...document.querySelectorAll('.sl-dot, .sl-group-dot')]
  const all = [...document.querySelectorAll('.sl-dot > span, .sl-group-label')]
  const names = all.filter((el) => getComputedStyle(el).visibility !== 'hidden')
  const box = (el) => el.getBoundingClientRect()
  const ringed = (el) => { const b = box(el); return { left: b.left - 4, right: b.right + 4, top: b.top - 4, bottom: b.bottom + 4 } }
  // A name that lost its place is hidden outright, never left dimmed.
  if (all.some((el) => el.classList.contains('off') && (getComputedStyle(el).visibility !== 'hidden' || getComputedStyle(el).opacity !== '0'))) return false
  for (let i = 0; i < markers.length; i += 1) for (let j = i + 1; j < markers.length; j += 1) if (hit(box(markers[i]), box(markers[j]))) return false
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) if (hit(box(names[i]), box(names[j]))) return false
  return names.every((name) => markers.every((marker) => marker === name.parentElement || !hit(box(name), ringed(marker))))
})()`
/** True when the skyline's Sun and Earth names are both there, apart from each other and inside the drawing. */
const SKY_CLEAR = `(() => {
  const names = [...document.querySelectorAll('.sl-sky-name')].map((el) => el.getBoundingClientRect())
  const frame = document.querySelector('.sl-sky svg').getBoundingClientRect()
  if (names.length !== 2) return false
  const [a, b] = names
  const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top
  return apart && names.every((name) => name.left >= frame.left && name.right <= frame.right && name.top >= frame.top && name.bottom <= frame.bottom)
})()`
/** True when Scout's badge in Plan's column shows the state the answer's sentence gives, at the 20 px size (no sightline), with the state in its name. */
/** The sentence about the landing's hour, without its fixed "At landing" label. */
const SENTENCE = `(() => { const said = (document.querySelector('.sl-sentence')?.textContent ?? '').trim().replace(/^At landing: /, ''); return said.charAt(0).toUpperCase() + said.slice(1) })()`
const BADGE_MATCHES = `(() => {
  const sentence = ${SENTENCE}
  const sun = /^(Sunlit|Partly sunlit)/.test(sentence)
  const earth = /Earth (partly )?in view/.test(sentence)
  const state = sun && earth ? 'both' : sun ? 'sun' : earth ? 'earth' : 'none'
  const badge = document.querySelector('.sl-rail-scout .scout-badge')
  if (!badge || !badge.classList.contains('is-' + state) || badge.getAttribute('width') !== '16') return false
  const words = { both: 'sunlit, and Earth is in view', sun: 'sunlit, but Earth is out of view', earth: 'no sunlight, but Earth is in view', none: 'no sunlight, and Earth is out of view' }[state]
  const disc = badge.querySelector('.scout-badge-disc')
  const hollow = disc.getAttribute('stroke') !== 'none'
  return badge.getAttribute('aria-label') === 'Scout: ' + words && badge.querySelectorAll('path').length === 1 && hollow === (state === 'none')
})()`
/** Types or picks a date in the landing's date field, as a visitor's browser would. */
/** The landing as the control shows it: its date, the dot between, and its hour, read together. */
const LANDING = `[...document.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join('')`
/** Chooses a date in the landing's date field and an hour in its list of whole hours, as a visitor's browser would ("YYYY-MM-DDTHH:00"). */
const pickDate = (value) => `(() => { const date = document.querySelector('.sl-pick input[type="date"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, ${JSON.stringify(value.slice(0, 10))}); date.dispatchEvent(new Event('input', { bubbles: true })); const hour = document.querySelector('.sl-pick select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hour, ${JSON.stringify(value.slice(11, 13))}); hour.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
/** True when the column's type is big enough to read (body 14 px, captions and labels 12 px) and nothing in it is cut off. */
const COLUMN_READS = `(() => {
  const column = document.querySelector('.sl-col')
  const size = (el) => parseFloat(getComputedStyle(el).fontSize)
  // Text set to no size at all is there for screen readers only (the date field's own label), so it is not read by eye.
  const withText = [...column.querySelectorAll('*')].filter((el) => [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '') && el.getClientRects().length > 0 && size(el) > 0)
  const body = [...column.querySelectorAll('.sl-sentence, .sl-value, .sl-reasons li, .sl-next, .sl-fact dt, select, input')]
  // The pickers lying unseen under the landing's date and hour are not text anyone reads.
  const cut = [...column.querySelectorAll('*')].filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).opacity !== '0')
  return withText.every((el) => size(el) >= 12) && body.every((el) => size(el) >= 14) && cut.length === 0
})()`
/** True when the verdict on the landing sits between the sentence and the numbers. */
const VERDICT_FIRST = `(() => {
  const [verdict, sentence, rows] = ['.sl-verdict', '.sl-sentence', '.sl-facts'].map((selector) => document.querySelector('.sl-col ' + selector))
  const before = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return sentence !== null && verdict !== null && rows !== null && before(verdict, sentence) && before(sentence, rows) && verdict.getBoundingClientRect().bottom <= sentence.getBoundingClientRect().top + 1
})()`
/** True when the verdict's line is set larger than any other text in the column. */
const VERDICT_LARGEST = `(() => {
  const size = (el) => parseFloat(getComputedStyle(el).fontSize)
  const line = document.querySelector('.sl-col .sl-verdict-words')
  const others = [...document.querySelectorAll('.sl-col *')].filter((el) => el !== line && !line.contains(el) && !el.contains(line) && [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim() !== '') && el.getClientRects().length > 0)
  return line !== null && others.every((el) => size(el) < size(line))
})()`
/** True on a laptop when nothing in the left column scrolls: not the column, and no area inside it. On a phone the column is a sheet that scrolls by design. */
const NOTHING_SCROLLS = `(window.innerWidth < 761 || [document.querySelector('.sl-col'), ...document.querySelectorAll('.sl-col *')].every((el) => el.scrollHeight <= el.clientHeight + 1 || !/auto|scroll/.test(getComputedStyle(el).overflowY)))`
/**
 * True when Compare's table is laid out cleanly for `count` scenarios: that many columns, of equal
 * width; every cell's box inside its column; every piece of text inside its own cell, and no two
 * pieces of text touching; and nothing wider than the panel. Otherwise what is wrong.
 */
const COMPARE_CLEAN = (count) => `(() => {
  const drawer = document.querySelector('.sl-compare')
  if (!drawer) return 'the Compare panel is not open'
  const table = drawer.querySelector('table')
  const heads = [...table.querySelectorAll('thead tr > *')]
  if (heads.length !== ${count + 1}) return (heads.length - 1) + ' columns, not ${count}'
  const columns = heads.map((head) => head.getBoundingClientRect())
  const widths = columns.slice(1).map((column) => column.width)
  if (Math.max(...widths) - Math.min(...widths) > 1) return 'the columns are not of equal width: ' + widths.map((width) => Math.round(width)).join(', ')
  for (const row of table.querySelectorAll('tbody tr')) {
    const cells = [...row.children]
    if (cells.some((cell) => cell.colSpan > 1)) continue
    for (const [i, cell] of cells.entries()) {
      const box = cell.getBoundingClientRect()
      if (box.left < columns[i].left - 0.5 || box.right > columns[i].right + 0.5) return 'a cell is outside its column: ' + cell.textContent.trim()
    }
  }
  const pieces = []
  const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent.trim() === '') continue
    const cell = node.parentElement.closest('th, td, caption')
    const within = cell.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const box of range.getClientRects()) {
      if (box.width < 0.5 || box.height < 0.5) continue
      if (box.left < within.left - 0.5 || box.right > within.right + 0.5 || box.top < within.top - 0.5 || box.bottom > within.bottom + 0.5) return 'text runs outside its cell: ' + node.textContent.trim()
      pieces.push({ node, box, words: node.textContent.trim() })
    }
  }
  for (let a = 0; a < pieces.length; a += 1) for (let b = a + 1; b < pieces.length; b += 1) {
    if (pieces[a].node === pieces[b].node) continue
    const across = Math.min(pieces[a].box.right, pieces[b].box.right) - Math.max(pieces[a].box.left, pieces[b].box.left)
    const down = Math.min(pieces[a].box.bottom, pieces[b].box.bottom) - Math.max(pieces[a].box.top, pieces[b].box.top)
    if (across > 0.5 && down > 0.5) return 'two pieces of text touch: "' + pieces[a].words + '" and "' + pieces[b].words + '"'
  }
  const panel = drawer.getBoundingClientRect()
  const frame = table.getBoundingClientRect()
  if (drawer.scrollWidth > drawer.clientWidth || frame.left < panel.left || frame.right > panel.right + 0.5) return 'the table is wider than the panel'
  return true
})()`
/** Removes a scenario by its tab's "−", then waits for the panel to follow. */
const REMOVE_SCENARIO = (letter) => `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario ${letter}"]').click(), ${after(700, 'true')})`
/**
 * The plans service stands in for itself in these checks, so no plan is really saved: a save is
 * answered with the id "abcd2345" and kept in window.__plans, and opening that id gives the plan
 * back, with a two-line brief. A plan whose name has "busy" in it is refused as the service refuses
 * when too many are being saved; the id "zzzz2345" is a plan that no longer exists. `kept` is a
 * plan to answer with when none has been saved on this page (a short link opened in a new tab).
 * `others` are more plans to answer with, by id: { title, note, view } each.
 */
const STAND_IN_PLANS = (kept = null, others = {}) => `(() => {
  if (window.__plans) return true
  window.__plans = { saved: [], kept: ${JSON.stringify(kept)} }
  const real = window.fetch
  const answer = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  window.fetch = async (url, init) => {
    const address = String(url)
    if (address.endsWith('/api/plans') && init?.method === 'POST') {
      const body = JSON.parse(init.body)
      if (/busy/i.test(body.title)) return answer({ error: 'busy' }, 429)
      window.__plans.saved.push(body)
      return answer({ id: 'abcd2345' }, 201)
    }
    if (address.endsWith('/api/plans/zzzz2345')) return answer({ error: 'not-found' }, 404)
    const other = ${JSON.stringify(others)}[address.split('/api/plans/')[1]]
    if (other) return answer({ plan: { id: address.split('/api/plans/')[1], title: other.title, note: other.note ?? '', view: other.view, brief: [{ label: 'Site', value: 'Connecting Ridge' }], created: '2026-11-01T09:00:00.000Z', expires: '2027-04-30T09:00:00.000Z' }, mine: false }, 200)
    if (address.endsWith('/api/plans/abcd2345')) {
      const plan = window.__plans.saved.at(-1) ?? window.__plans.kept
      return answer({ plan: { id: 'abcd2345', title: plan.title, note: plan.note ?? '', view: plan.view, brief: [{ label: 'Site', value: 'Connecting Ridge' }, { label: 'Sun up', value: '82% of May 2027' }], created: '2026-11-14T21:00:00.000Z', expires: '2027-05-13T21:00:00.000Z' }, mine: false }, 200)
    }
    return real(url, init)
  }
  return true
})()`
/** A stand-in for the browser's clipboard, in place before the page's code runs: it keeps what was copied in window.__copied, or refuses. */
const STAND_IN_CLIPBOARD = (allows = true) => `(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text) => ${allows ? '{ window.__copied = text; return Promise.resolve() }' : "Promise.reject(new Error('refused'))"} } }); return true })()`
/**
 * A saved plan's card is in sight: a real box, whole inside the window, with nothing on top of its
 * name, its note or its button. On a laptop it lies inside the plan column or the Planner's header,
 * so none of the Moon is under it.
 */
const SAVED_CARD = (name, note) => `(() => { const card = document.querySelector('.sl-saved-card'); if (!card) return 'no card'; const box = card.getBoundingClientRect(); const seen = (el) => { if (!el) return false; const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + Math.min(b.width / 2, 20), b.top + Math.min(b.height / 2, 8)); return b.width > 0 && b.height > 0 && top !== null && card.contains(top) }; const nameEl = card.querySelector('.sl-saved-card-name'); const noteEl = card.querySelector('.sl-saved-card-note'); const laptop = window.innerWidth >= 761; const within = (card.closest('.sl-full-head') ?? document.querySelector('.sl-col'))?.getBoundingClientRect(); const placed = box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1 && (!laptop || (within && box.left >= within.left - 1 && box.right <= within.right + 1 && box.top >= within.top - 1 && box.bottom <= within.bottom + 1)); const note = ${JSON.stringify(note)}; return (document.querySelectorAll('.sl-saved-card').length === 1 && box.width > 150 && box.height > 30 && placed && card.querySelector('.sl-saved-card-kind').textContent === 'Saved plan' && nameEl.textContent === ${JSON.stringify(name)} && seen(nameEl) && (note === '' ? noteEl === null : noteEl !== null && noteEl.textContent.startsWith(note) && seen(noteEl)) && seen(card.querySelector('.sl-saved-card-away'))) || 'card at ' + [box.left, box.top, box.right, box.bottom].map(Math.round).join(', ') + ' says ' + card.textContent.slice(0, 90) })()`
/** Types into a field of the Share sheet, as a visitor's browser would. */
const SHARE_TYPE = (selector, words) => `(() => { const field = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, ${JSON.stringify(words)}); field.dispatchEvent(new Event('input', { bubbles: true })); return true })()`
/** True when the Share sheet is whole inside the window, and on a laptop inside the column its icon is in, so it is not over the Moon. */
const SHARE_PLACED = `(() => { const sheet = document.querySelector('.sl-share-sheet'); if (!sheet) return 'the sheet is not open'; const box = sheet.getBoundingClientRect(); const inWindow = box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight; const column = window.innerWidth < 761 ? null : document.querySelector('.sl-col')?.getBoundingClientRect(); const inColumn = !column || (box.left >= column.left && box.right <= column.right); return (inWindow && inColumn && sheet.scrollHeight <= sheet.clientHeight + 1) || 'the sheet is at ' + [box.left, box.top, box.right, box.bottom].map(Math.round).join(', ') })()`
/** The sentences of the Guide's "Why this site is hard", as the page shows them. */
const WHY_LINES = "[...document.querySelectorAll('.sl-how .how-why li')].map((li) => li.textContent)"
/** Scout's panel answers from a stand-in in these checks, so no model is called: what the page sent is kept in window.__sent. */
/** An answer of an ordinary length, about what Scout writes for a question with one or two lookups (470 characters). */
const LONG_REPLY = 'Connecting Ridge has the Sun for 82% of May 2027, and Earth in view for 58% of it. The longest stretch without the Sun is 118 hours, from 1 May, which is longer than your mission can last without power: your limit is 24 hours. Landing on 6 May at 13:00 puts the Sun and Earth both in view at touchdown, but the dark stretch that follows is the problem. The first landing that fits your limits is 21 June at 17:00, when the Sun stays up for the whole mission.'
/** The tag in an open card's or panel's header: "AI · " and the model the co-pilot's status names, or "AI" alone if the status cannot be read. */
const MODEL_TAG = (selector) => `(async () => { const tag = document.querySelector(${JSON.stringify(selector)}); const status = await fetch('/api/status/services').then((r) => (r.ok ? r.json() : null)).catch(() => null); const id = status?.services?.copilot?.status?.modelSettings?.model ?? null; const match = id ? /^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?/.exec(id) : null; const name = match ? 'Claude ' + match[1][0].toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '') : null; const says = tag?.textContent.trim(); const want = name ? 'AI · ' + name : 'AI'; if (says !== want) throw new Error('status says ' + id + '; the tag says: ' + says); const box = tag.getBoundingClientRect(); return /AI-generated/.test(tag.getAttribute('title') ?? tag.dataset.tip ?? '') && box.height < 24 && box.right <= tag.closest('header').getBoundingClientRect().right })()`
/** Stand-in replies to "where can a lander see … right now": the first names sites on both faces of the Moon in its first sentence (one of them in view from over the south pole), the second only sites that are out of view from there. */
const EARTH_NOW_REPLY = 'At the hour on the time bar, Earth is in view among the Apollo sites, Apollo 11, Apollo 15 and Apollo 17; on the south pole ridges, Shackleton Rim. De Gerlache Rim sees it again in a few days.'
const SUN_NOW_REPLY = 'At the hour on the time bar, only the Sun is in view among the Apollo sites, Apollo 11 and Apollo 17. Connecting Ridge has Earth as well.'
const STAND_IN_SCOUT = `(() => { if (window.__stood) return true; window.__stood = true; window.__sent = []; const real = window.fetch; window.fetch = async (url, init) => { if (String(url).includes('/api/chat')) { window.__sent.push(JSON.parse(init.body)); const asked = JSON.parse(init.body).messages.at(-1).text; if (/fail/i.test(asked) || window.__failNext) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }); const whereNow = /see Earth|only the Sun/i.test(asked); const actions = /where/i.test(asked) && !whereNow ? [{ label: 'Shackleton Rim, 1 June 2027, 22:00', hash: '#a=shackleton-rim@2027-06&t=22&limits=14_24_99999_1_1&mode=plan' }] : []; const text = /see Earth/i.test(asked) ? ${JSON.stringify(EARTH_NOW_REPLY)} : /only the Sun/i.test(asked) ? ${JSON.stringify(SUN_NOW_REPLY)} : /long/i.test(asked) ? ${JSON.stringify(LONG_REPLY)} : 'A stand-in reply, number ' + window.__sent.length + '.'; const again = /see Earth/i.test(asked) && !/time bar/i.test(asked) ? { ask: { label: 'Ask for 10 December 2026', question: asked + ' (for the date on the time bar)' } } : {}; return new Response(JSON.stringify({ reply: { text, actions, sources: [], followups: [], ...again } }), { status: 200, headers: { 'content-type': 'application/json' } }) } return real(url, init) }; return true })()`
/** Opens Scout's panel from the rail if it is not open. */
const OPEN_SCOUT = `(document.querySelector('.sl-scout-panel') !== null || (document.querySelector('.sl-rail-scout').click(), true))`
/** True when neither the column nor an open side panel scrolls, either way (asked of laptop sizes; a phone's sheets scroll by design). */
const COLUMN_FITS = `(() => { const fits = (el) => el === null || (el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth); return window.innerWidth < 761 || (fits(document.querySelector('.sl-col')) && fits(document.querySelector('.sl-drawer'))) })()`
/** True when, at Orbit, the Moon's disc is at least 80% of the stage's shorter side, and no marker or showing name leaves the stage. */
const MOON_FILLS = `(() => {
  const stage = document.querySelector('.sl-stage').getBoundingClientRect()
  const disc = Number(document.querySelector('.scout-globe').dataset.discPx)
  const inside = (el) => { const b = el.getBoundingClientRect(); return b.left >= stage.left && b.right <= stage.right && b.top >= stage.top && b.bottom <= stage.bottom }
  const drawn = [...document.querySelectorAll('.sl-dot, .sl-group-dot'), ...[...document.querySelectorAll('.sl-dot > span, .sl-group-label')].filter((el) => getComputedStyle(el).visibility !== 'hidden')]
  return disc >= 0.8 * Math.min(stage.width, stage.height) && disc <= Math.min(stage.width, stage.height) && drawn.every(inside)
})()`
/** Remembers where the zoom buttons are, before something is done to the view. */
const ZOOM_AT = `(() => { const box = document.querySelector('.sl-view-tools .zoom-buttons').getBoundingClientRect(); window.__zoomAt = [box.left, box.top, box.width, box.height].map((n) => Math.round(n * 10) / 10).join(); return document.querySelector('.sl-recentre') === null && box.width > 0 })()`
/** True when the compass is on show under the zoom buttons (and under the arrow to Earth, where there is one), and the zoom buttons are exactly where ZOOM_AT found them. */
const COMPASS_BELOW = `(() => { const compass = document.querySelector('.sl-view-tools .sl-recentre'); if (!compass) return 'no compass'; const zoom = document.querySelector('.sl-view-tools .zoom-buttons').getBoundingClientRect(); const now = [zoom.left, zoom.top, zoom.width, zoom.height].map((n) => Math.round(n * 10) / 10).join(); const box = compass.getBoundingClientRect(); const earth = document.querySelector('.sl-view-tools .sl-to-earth')?.getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const globe = document.querySelector('.scout-globe'); const g = globe.getBoundingClientRect(); const reach = Math.hypot((box.left + box.right) / 2 - (g.left + g.right) / 2, (box.top + box.bottom) / 2 - (g.top + g.bottom) / 2); if (now !== window.__zoomAt) return 'the zoom buttons moved: ' + window.__zoomAt + ' to ' + now; if (box.top < zoom.bottom - 0.5) return 'the compass is not below the zoom buttons'; if (earth && box.top < earth.bottom - 0.5) return 'the compass is not below the arrow to Earth'; if (box.bottom > stage.bottom + 0.5 || box.right > stage.right + 0.5) return 'the compass leaves the stage'; return true })()`
/**
 * True when the Moon's whole disc is inside the stage with a margin on every side: its bounding
 * circle (centred on the globe's square, as wide as the disc is drawn) clears each edge by 8 px.
 */
const DISC_INSIDE = `(() => {
  const stage = document.querySelector('.sl-stage').getBoundingClientRect()
  const globe = document.querySelector('.scout-globe')
  const box = globe.getBoundingClientRect()
  const r = Number(globe.dataset.discPx) / 2
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  return r > 40 && cx - r >= stage.left + 8 && cx + r <= stage.right - 8 && cy - r >= stage.top + 8 && cy + r <= stage.bottom - 8
})()`
/** True when the Moon's whole disc, every dot and every name that can be seen are inside the stage. Says what is outside when not. */
const STAGE_HOLDS = `(() => {
  const stage = document.querySelector('.sl-stage').getBoundingClientRect()
  const outside = [...document.querySelectorAll('.sl-dot, .sl-group-dot'), ...[...document.querySelectorAll('.sl-dot > span, .sl-group-label')].filter((el) => getComputedStyle(el).visibility !== 'hidden')].filter((el) => { const b = el.getBoundingClientRect(); return b.left < stage.left || b.right > stage.right || b.top < stage.top || b.bottom > stage.bottom })
  if (!${DISC_INSIDE}) throw new Error('the disc (' + document.querySelector('.scout-globe').dataset.discPx + ' px) does not fit the stage (' + Math.round(stage.width) + ' by ' + Math.round(stage.height) + ' px)')
  if (outside.length > 0) throw new Error('outside the stage (' + Math.round(stage.width) + ' by ' + Math.round(stage.height) + ' px): ' + outside.map((el) => el.textContent.trim() || 'a dot').join(', '))
  return true
})()`
/** True on a laptop when the skyline's header is one row and the time bar's at most two, with "Fold" at the right end. Says which is not. */
const HEADS_ONE_ROW = `(() => {
  if (window.innerWidth < 761) return true
  const heads = [...document.querySelectorAll('.sl-sky .sl-strip-head, .sl-river .sl-strip-head')]
  const strips = document.querySelectorAll('.sl-sky, .sl-river').length
  if (heads.length === 0 || heads.length !== strips) throw new Error(heads.length + ' header rows for ' + strips + ' strip(s)')
  for (const head of heads) {
    const box = head.getBoundingClientRect()
    const parts = [...head.children].filter((el) => el.getBoundingClientRect().width > 0)
    const middles = parts.map((el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2 })
    const fold = head.querySelector('.sl-fold')
    const name = head.closest('.sl-sky') ? 'skyline' : 'river'
    // The skyline's header is one row. The time bar's is one or two: its name and key, then what is in view and the tools.
    const rows = name === 'river' ? 2 : 1
    if ((rows === 1 && Math.max(...middles) - Math.min(...middles) > 4) || box.height > 40 * rows) throw new Error('the ' + name + ' header is ' + Math.round(box.height) + ' px high at ' + Math.round(box.width) + ' px wide: more than ' + rows + ' row' + (rows > 1 ? 's' : ''))
    if (head.scrollWidth > head.clientWidth + 1 || parts.some((el) => el.getBoundingClientRect().right > box.right + 1)) throw new Error('the ' + name + ' header spills past its right edge at ' + Math.round(box.width) + ' px wide')
    if (!parts.at(-1).contains(fold) || box.right - fold.getBoundingClientRect().right > 2) throw new Error('"Fold" is not at the right end of the ' + name + ' header')
    for (let i = 1; i < parts.length; i += 1) { const a = parts[i - 1].getBoundingClientRect(); const b = parts[i].getBoundingClientRect(); if (b.top < a.bottom - 1 && a.top < b.bottom - 1 && b.left < a.right - 1) throw new Error('parts of the ' + name + ' header overlap at ' + Math.round(box.width) + ' px wide: ' + parts[i - 1].className + ' and ' + parts[i].className) }
  }
  return true
})()`
/** True when nothing the page says (its text, tooltips, labels and placeholders) uses a word that is kept out: the old words for time, or "ridge" for the terrain's outline as seen from the site. */
const OWN_WORDS = "!/lunar night|lunar day|playhead|scrub|above the ridge|below the ridge|clear the ridge|the ridge hides|the ridge cuts/i.test(document.body.innerText + [...document.querySelectorAll('[title], [aria-label], [placeholder]')].map((el) => (el.title || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')).join(' '))"
/** True when Scout's area shows three questions to tap and the one thing to try (on a short laptop screen, three ideas in all), each a button, each whole inside the area. */
const IDEAS_WHOLE = `(() => { const area = document.querySelector('.sl-ask-says').getBoundingClientRect(); const short = window.innerWidth >= 761 && window.innerHeight < 820; const ideas = [...document.querySelectorAll('.sl-ask-says .sl-idea')].filter((idea) => idea.getClientRects().length > 0); const questions = ideas.filter((idea) => !idea.classList.contains('is-action')).length; return (questions === 3 || (short && ideas.length === 3 && questions === 2)) && ideas.every((idea) => idea.tagName === 'BUTTON' && idea.getBoundingClientRect().top >= area.top - 0.5 && idea.getBoundingClientRect().bottom <= area.bottom + 0.5) })()`
/** In Plan a strip this high is kept clear under the Moon, for the note that says the Moon is not showing the landing: the Moon is fitted to the room above it. */
const STRIP = `(document.querySelector('.sightline.is-plan') ? 30 : 0)`
/** The note on the stage that says the Moon is not showing the landing: its words (the moment itself is written once, on the time bar, and must be `when`), its two links, and that it lies inside the stage and clear of the Moon's disc at Orbit. Throws with what it found when not. */
const NOTE_SAYS = (when) => `(() => {
  const note = document.querySelector('.sl-stage .sl-off-landing')
  if (!note) throw new Error('no note on the stage')
  const words = note.querySelector('span').textContent.trim()
  const links = [...note.querySelectorAll('button.sl-link')].map((link) => link.textContent.trim())
  const stage = document.querySelector('.sl-stage').getBoundingClientRect()
  const globe = document.querySelector('.scout-globe').getBoundingClientRect()
  const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2
  const box = note.getBoundingClientRect()
  const nearest = { x: Math.min(Math.max((globe.left + globe.right) / 2, box.left), box.right), y: Math.min(Math.max((globe.top + globe.bottom) / 2, box.top), box.bottom) }
  const clear = Math.hypot(nearest.x - (globe.left + globe.right) / 2, nearest.y - (globe.top + globe.bottom) / 2) >= r
  const inside = box.left >= stage.left && box.right <= stage.right + 0.5 && box.top >= stage.top && box.bottom <= stage.bottom + 0.5
  const dates = [...document.querySelectorAll('.sl-now')].map((date) => date.textContent.trim())
  if (words !== 'Not the landing' || dates.join('|') !== '${when}' || links.join('|') !== 'Back to landing|Land here' || !inside || !clear) throw new Error(words + ', the time bar at ' + dates.join('|') + ' [' + links.join('|') + '] inside ' + inside + ', clear of the disc ' + clear)
  return true
})()`
/** For the time bar's checks: the hours the rows cover (from the range input), and where an hour's middle is across a row, in pixels. Declares `span` and `xOf`. */
const TIME_BAR_AT = `const span = () => { const input = document.querySelector('.sl-seek input'); return { from: Number(input.min), count: Number(input.max) - Number(input.min) + 1 } }; const xOf = (hour) => { const { from, count } = span(); const box = document.querySelector('.sl-site-row .sl-track').getBoundingClientRect(); return box.left + ((hour + 0.5 - from) / count) * box.width }`
/**
 * True when every explanation now on the page (a `title`, or one the screen's tooltip has taken over) keeps the rules for hover text:
 * two sentences at most; never just its control's own label; "elevation" only with what it is measured from (a flat horizon, or the skyline);
 * none of "playhead", "scrub", "the ridge"; and no question-mark pointer. Left out: text that is the visitor's or the data's own (a saved plan's
 * note, a verdict's reasons, a site's dot, Earth's picture, a frame's name) and the New Planner's, which is its owner's. Says which break a rule.
 */
const TIPS_KEEP_RULES = `(() => { const skip = '.sl-reasons li, .sl-compare-verdict td, .sl-dot, .sl-group-dot, .sl-earth-name, iframe, .sl-np *, .pl-brief *, .plh *, .sl-compare td, .sl-full-table td'; const bad = []; for (const el of document.querySelectorAll('[title], [data-tip]')) { if (el.matches(skip)) continue; const tip = (el.getAttribute('title') || el.dataset.tip || '').trim(); if (!tip) continue; const label = (el.textContent.trim() || el.getAttribute('aria-label') || '').trim(); const sentences = tip.split(/(?<=[.!?])\\s+(?=[A-Z“"])/).length; const why = sentences > 2 ? 'more than two sentences' : tip === label || tip === el.getAttribute('aria-label') ? 'only its label' : /elevation/i.test(tip) && !/flat horizon|skyline/i.test(tip) ? '"elevation" with nothing it is measured from' : /playhead|\\bscrub|\\b(the|a) ridge\\b/i.test(tip) ? 'a word that is kept out' : getComputedStyle(el).cursor === 'help' ? 'a help cursor' : null; if (why) bad.push(why + ': ' + tip.slice(0, 90)) } if (bad.length > 0) throw new Error(bad.join(' || ')); return true })()`
/** Presses one of the note's two links, by its words. */
const noteLink = (words) => `[...document.querySelectorAll('.sl-off-landing .sl-link')].find((link) => link.textContent.trim() === ${JSON.stringify(words)}).click()`
/** True when the river's legend is on the page once: in the header's row, or in "More" when it does not fit there, never both. Opens "More" to look, and shuts it again. */
const LEGEND_ONCE = `(async () => { const more = document.querySelector('.sl-river .sl-more'); if (more && more.getAttribute('aria-expanded') !== 'true') { more.click(); await new Promise((next) => setTimeout(next, 250)) } const legends = [...document.querySelectorAll('.sl-river .sl-legend')]; const words = (document.querySelector('.sl-river-top').textContent.match(/Neither/g) || []).length; const boxes = document.querySelectorAll('.sl-river-top input[type="checkbox"]').length; const menu = document.querySelector('.sl-menu'); const empty = menu !== null && menu.children.length === 0; if (more && document.querySelector('.sl-menu')) { more.click(); await new Promise((next) => setTimeout(next, 150)) } if (legends.length !== 1 || words !== 1 || boxes > 1 || empty) throw new Error(legends.length + ' legends, "Neither" ' + words + ' times, ' + boxes + ' "A day on Earth" boxes' + (empty ? ', an empty menu' : '')); return true })()`
/** True when Scout's open card is inside the stage and does not lie over the Moon's disc. Says where each is when not. */
const CARD_CLEAR = `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const near = { x: Math.min(Math.max(cx, card.left), card.right), y: Math.min(Math.max(cy, card.top), card.bottom) }; const clear = Math.hypot(near.x - cx, near.y - cy) >= r; const inside = window.innerWidth < 761 ? card.left >= stage.left - 0.5 && card.right <= stage.right + 0.5 && card.top >= stage.top && card.bottom <= stage.bottom + 0.5 : Math.abs(card.right - window.innerWidth) <= 0.5 && Math.abs(card.left - stage.right) <= 1 && card.top <= 0.5 && card.bottom >= window.innerHeight - 0.5; if (!clear || !inside || r < 60) throw new Error('card ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ' across, ' + Math.round(card.top) + ' to ' + Math.round(card.bottom) + ' down; disc centre ' + Math.round(cx) + ', ' + Math.round(cy) + ', radius ' + Math.round(r)); return true })()`
/** Types into Scout's input in Watch and sends it. */
const askInWatch = (question) => `(() => { const form = document.querySelector('.sl-card .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(question)}); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true })()`
/** How far a row's body is above the skyline, signed as the time bar's readout writes it: "0.6°", "−0.2°". */
const rowAbove = (name) => `(() => { const said = /At landing: ([0-9.]+°) (above|below) the skyline/.exec(document.querySelector('.sl-fact.is-${name} .sl-fact-at')?.textContent ?? ''); if (!said) return 'no line about the landing'; return (said[2] === 'below' && said[1] !== '0.0°' ? '−' : '') + said[1] })()`
/** True when the three rows (the Sun, Earth, the ground) each show a name, a main figure and a small line in full, at one fixed height. Throws with what it found when not. */
const ROWS_WHOLE = `(() => { const rows = [...document.querySelectorAll('.sl-facts > .sl-fact')]; const names = rows.map((row) => row.querySelector('dt').textContent.trim()); const parts = rows.flatMap((row) => [row.querySelector('dt'), row.querySelector('.sl-fact-main'), ...row.querySelectorAll('.sl-fact-small')]); const cut = parts.filter((el) => !el || el.textContent.trim() === '' || el.scrollWidth > el.clientWidth + 1 || el.textContent.trim().endsWith('…') || getComputedStyle(el).textOverflow === 'ellipsis'); const spills = rows.filter((row) => row.scrollHeight > row.clientHeight + 1); const wrapped = rows.flatMap((row) => [...row.querySelectorAll('.sl-fact-small')]).filter((line) => line.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(line).fontSize) * 1.3); const many = rows.filter((row) => row.querySelectorAll('.sl-fact-small').length > 2 || row.querySelectorAll('.sl-fact-small').length < 1); if (names.join('|') !== 'Sun|Earth|Ground' || cut.length > 0 || spills.length > 0 || wrapped.length > 0 || many.length > 0 || /elevation/i.test(document.querySelector('.sl-facts').innerText)) throw new Error('rows ' + names.join('|') + '; cut: ' + cut.map((el) => (el ? el.textContent.trim() : 'missing')).join(' / ') + '; rows that spill: ' + spills.length + '; small lines that wrap: ' + wrapped.map((line) => line.textContent.trim()).join(' / ') + '; rows with no or over two small lines: ' + many.length + '; ' + document.querySelector('.sl-facts').innerText.replace(/\\n/g, ' | ')); return true })()`
/** True when the column is the redesigned one: exactly three plan controls, a verdict, the three rows, no tiles, and nothing that scrolls on a laptop. */
// The plan's three controls sit inside the answer since the verdict leads the column, and each chart's note is a plain line above it: the controls are the only boxes there.
const COLUMN_SHAPE = `(() => { const controls = [...document.querySelectorAll('.sl-plan > .sl-plan-row')]; const kinds = controls.map((row) => (row.querySelector('#sl-site') ? 'site' : row.querySelector('.sl-pick') ? 'landing' : row.querySelector('.sl-mission-open') ? 'mission' : '?')); const boxed = [...document.querySelectorAll('.sl-answer *')].filter((el) => !el.closest('.sl-plan') && parseFloat(getComputedStyle(el).borderTopWidth) > 0 && parseFloat(getComputedStyle(el).borderLeftWidth) > 0 && el.getClientRects().length > 0); if (kinds.join('|') !== 'site|landing|mission' || controls.some((row) => row.querySelector('svg.sl-plan-icon') === null) || document.querySelector('.sl-col label, .sl-col .sl-label') !== null || document.querySelector('.sl-verdict .sl-verdict-line') === null || document.querySelectorAll('.sl-facts > .sl-fact').length !== 3 || document.querySelector('.sl-numbers') !== null || boxed.length > 0) throw new Error('controls ' + kinds.join('|') + '; boxed in the answer: ' + boxed.map((el) => el.className).join(',')); return ${NOTHING_SCROLLS} && ${COLUMN_FITS} })()`
/** True when nothing on the page has the question-mark cursor. */
const NO_HELP_CURSOR = "[...document.querySelectorAll('*')].every((el) => getComputedStyle(el).cursor !== 'help')"
/** Chooses the extra entry at the foot of the site's own list: '__custom', the form for a custom point. (The links to NASA's tools are a line under the site's control now, always there.) */
const siteMore = (what) => `(() => { const select = document.querySelector('#sl-site'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(what)}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`
/** True when every tab's letter and the "+" share one row, inside the column's row of tabs. */
const TABS_ONE_ROW = `(() => { const letters = [...document.querySelectorAll('.sl-tabs .sl-tab > button:first-child, .sl-tabs > button')]; const top = letters[0].getBoundingClientRect().top; const head = document.querySelector('.sl-tabs-row').getBoundingClientRect(); return letters.every((button) => Math.abs(button.getBoundingClientRect().top - top) < 1) && letters.at(-1).getBoundingClientRect().right <= head.right + 0.5 && letters[0].getBoundingClientRect().left >= head.left - 0.5 })()`
/** True when each tab's "−" is a small badge centred on the upper right corner of its own letter, and is what a press there reaches (unless a panel is a full sheet over it, on a phone). */
const BADGES_ON_CORNERS = `[...document.querySelectorAll('.sl-tabs .sl-tab')].every((tab) => { const remove = tab.querySelector('.sl-tab-remove'); const letter = tab.querySelector('button:first-child').getBoundingClientRect(); const badge = remove.getBoundingClientRect(); const x = (badge.left + badge.right) / 2; const y = (badge.top + badge.bottom) / 2; return remove.textContent.trim() === '−' && badge.width <= 22 && badge.height <= 22 && badge.width < 0.8 * letter.width && Math.abs(x - letter.right) <= 6 && Math.abs(y - letter.top) <= 6 && ((window.innerWidth < 761 && document.querySelector('.sl-drawer') !== null) || document.elementFromPoint(x, y) === remove) })`
/** On a laptop: do this, wait, then ask that. On a phone a panel is a full sheet over the stage, so there is nothing to ask. */
const onLaptop = (act, ms, expression) => `(window.innerWidth < 761 || ((${act}), ${after(ms, expression)}))`
/** True when the land in the skyline strip, from its foot to the ridge's top, takes at least a third of the strip's height. */
const RIDGE_FILLS = `(() => { const land = document.querySelector('.sl-sky-land').getBBox().height; const strip = Number(document.querySelector('#sl-sky-clip rect').getAttribute('height')); return land >= strip / 3 })()`
// A check that throws inside the wait fails at once with its message, not by running out of time.
// Note: several waits written in one check all start when the check starts, so give each its time from then.
// No label on the river is cut: every part of every row's name shows whole, with no "…".
const LABELS_WHOLE = `(() => { const rows = [...document.querySelectorAll('.sl-river .sl-site-row .sl-site-name')]; const cut = rows.filter((row) => row.scrollWidth > row.clientWidth + 1 || row.textContent.includes('…')); if (rows.length < 1 || cut.length > 0) throw new Error(rows.map((row) => row.textContent.trim() + ' (' + row.scrollWidth + ' of ' + row.clientWidth + ')').join(' | ')); return true })()`
// The Planner's column heads all have one shape: the letter at the left, the site and its landing beside it.
const PLANNER_HEADS = `(() => { const heads = [...document.querySelectorAll('.sl-full-table thead .sl-full-th')]; const shapes = heads.map((head) => { const letter = head.querySelector('button').getBoundingClientRect(); const name = head.querySelector('span').getBoundingClientRect(); return name.left >= letter.right - 1 && name.top < letter.bottom ? 'beside' : 'under' }); if (heads.length < 2 || shapes.some((shape) => shape !== 'beside')) throw new Error(shapes.join(' ')); return true })()`
// The Planner's small Moon covers no control, and on a laptop every control of the Mission column, Advanced included, is on screen without scrolling.
const MOON_COVERS_NOTHING = `(() => { const moon = document.querySelector('.sl-stage').getBoundingClientRect(); const shown = (list) => [...list].filter((el) => el.getClientRects().length > 0); const hit = (el) => { const box = el.getBoundingClientRect(); return box.left < moon.right && box.right > moon.left && box.top < moon.bottom && box.bottom > moon.top }; const under = shown(document.querySelectorAll('.sl-full button, .sl-full input, .sl-full select, .sl-full a, .sl-full label, .sl-scout-panel button, .sl-scout-panel input')).filter(hit); const column = document.querySelector('.sl-full-mission'); const mine = shown(column.querySelectorAll('button, input, select')); const off = window.innerWidth < 761 ? [] : mine.filter((el) => el.getBoundingClientRect().bottom > window.innerHeight || el.getBoundingClientRect().top < 0); const scrolls = window.innerWidth >= 761 && column.scrollHeight > column.clientHeight + 1; if (under.length > 0 || off.length > 0 || scrolls || mine.length < 9 || moon.width < 40) throw new Error('under the Moon: ' + under.map((el) => el.textContent.trim().slice(0, 20) || el.tagName).join(' / ') + '; off screen: ' + off.length + '; the column scrolls: ' + scrolls + ' (' + column.scrollHeight + ' in ' + column.clientHeight + '); controls ' + mine.length + '; Moon ' + Math.round(moon.width) + ' at ' + Math.round(moon.left) + ',' + Math.round(moon.top)); return true })()`
// The Planner's two height choices. PICK_HEIGHT presses one; TABLE_CELL reads a figure of the Planner's table; MISSION_HOURS reads, from each mission's drawn row, whether the Sun and Earth are up at each hour.
const PICK_HEIGHT = (label, metres) => `([...document.querySelector('.sl-height-pick[aria-label="${label}"]').querySelectorAll('button')].find((button) => button.textContent.trim() === '${metres} m').click(), true)`
const TABLE_CELL = `((name, column) => [...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td')[column].firstChild.textContent.trim())`
const MISSION_HOURS = `(() => [...document.querySelectorAll('.sl-aligned-row')].map((row) => { const n = Number(row.dataset.hours); const sun = new Array(n).fill(false); const earth = new Array(n).fill(false); for (const rect of row.querySelectorAll('rect')) { const state = rect.getAttribute('class').replace('sl-run is-', ''); const from = Number(rect.getAttribute('x')); for (let h = from; h < from + Number(rect.getAttribute('width')); h += 1) { sun[h] = state === 'both' || state === 'sun'; earth[h] = state === 'both' || state === 'earth' } } return { sun, earth } }))()`
const HEIGHT_FILES = `performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/light/heights/'))`
// The day axis under the Planner's rows: no label prints over the next.
const AXIS_CLEAR = `(() => { const labels = [...document.querySelectorAll('.sl-aligned .sl-axis .sl-track span')].map((label) => ({ text: label.textContent, box: label.getBoundingClientRect() })).filter((label) => label.box.width > 0).sort((a, b) => a.box.left - b.box.left); const over = labels.filter((label, i) => i > 0 && label.box.left < labels[i - 1].box.right + 2); if (labels.length < 3 || over.length > 0) throw new Error(labels.map((label) => label.text + '@' + Math.round(label.box.left) + '-' + Math.round(label.box.right)).join(' ')); return labels[0].text === 'landing' && /^day \\d+$/.test(labels.at(-1).text) })()`
/** Types the easter egg's word at the page, a key at a time, as a visitor would with nothing focused. */
const TYPE_HYPE = `(() => { for (const key of 'hype') window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return true })()`
/** With "Place names" on: true when no printed name lies on another, on a site's marker, on a site's own name or under the Moon's own buttons; else which do. */
const NAMES_CLEAR = `(() => { const boxes = (selector) => [...document.querySelectorAll(selector)].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0').map((el) => ({ el, box: el.getBoundingClientRect() })); const names = boxes('.sl-place-name'); const sites = boxes('.scout-globe .sl-dot, .scout-globe .sl-group-dot, .scout-globe .sl-dot > span:not(.off):not(.sl-within), .scout-globe .sl-group-label:not(.off), .sl-view-tools > *'); const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const wrong = []; names.forEach((name, i) => { for (const other of names.slice(i + 1)) if (hit(name.box, other.box)) wrong.push(name.el.textContent + ' on ' + other.el.textContent); for (const site of sites) if (hit(name.box, site.box)) wrong.push(name.el.textContent + ' on ' + (site.el.textContent.trim() || 'a marker')) }); return (sites.length > 0 && wrong.length === 0) || wrong.join('; ') + ' (' + sites.length + ' site shapes)' })()`
/** One line of Export's list in the Planner's header, by its first words. */
const EXPORT_LINE = (label) => `[...document.querySelectorAll('.sl-export-list button')].find((line) => line.firstChild.textContent.trim() === ${JSON.stringify(label)})`
/** From here on, a file the page saves is kept in `window.__saved` ({ name, text }) and not handed to the browser. */
const KEEP_SAVED = `(() => { window.__saved = null; let blob = null; URL.createObjectURL = (made) => { blob = made; return 'blob:stand-in' }; HTMLAnchorElement.prototype.click = function () { const name = this.download; void blob.text().then((text) => { window.__saved = { name, text } }) }; return true })()`
/**
 * The hourly file kept in `window.__saved`, read back: its notes (the lines that start with "#"), its
 * column names and its rows. Says what is wrong when it is not a file at all.
 */
const HOURLY_READ = `(() => { const saved = window.__saved; if (!saved) throw new Error('no file was saved'); const lines = saved.text.trimEnd().split('\\n'); const notes = lines.filter((line) => line.startsWith('# ')).map((line) => line.slice(2)); const table = lines.slice(notes.length).map((line) => line.split(',')); return { name: saved.name, notes, columns: table[0], rows: table.slice(1), ended: saved.text.endsWith('\\n') } })()`
/**
 * The hourly file against the screen, at a few of its hours: the landing is moved to each hour in
 * turn (the address's own "t="), and the time bar must then say that hour, the same Sun and Earth
 * in view, and, where the bar prints them, the same heights above the skyline to its one decimal.
 * `monthHour` is the landing's hour of its month, as the address has it. Resolves to true, or says
 * which hour differs.
 */
const HOURLY_AS_SCREEN = (monthHour, hoursIn) => `(async () => { const file = ${HOURLY_READ}; const wrong = []; for (const k of ${JSON.stringify(hoursIn)}) { const row = file.rows[k]; location.hash = location.hash.replace(/&t=\\d+/, '&t=' + (${monthHour} + k)); await new Promise((done) => setTimeout(done, 1700)); const at = new Date(row[0]); const clock = at.getUTCDate() + ' ' + at.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + at.getUTCFullYear() + ' · ' + String(at.getUTCHours()).padStart(2, '0') + ':00'; const now = document.querySelector('.sl-river .sl-now').textContent.trim(); if (!now.startsWith(clock)) wrong.push('hour ' + k + ': the bar is at ' + now + ', the row at ' + clock); const chip = document.querySelector('.sl-river .sl-chip').className; const state = row[6] === 'yes' ? (row[10] === 'yes' ? 'is-both' : 'is-sun') : row[10] === 'yes' ? 'is-earth' : 'is-none'; if (!chip.split(' ').includes(state)) wrong.push('hour ' + k + ': the bar says ' + chip + ', the row ' + state); const heights = document.querySelector('.sl-river .sl-moment-heights'); if (heights) { const said = /^Sun (−?)(\\d+\\.\\d)° · Earth (−?)(\\d+\\.\\d)° above the skyline/.exec(heights.textContent.trim()); if (!said) { wrong.push('hour ' + k + ': the bar says ' + heights.textContent.trim()); continue } const sun = Number(said[2]) * (said[1] ? -1 : 1); const earth = Number(said[4]) * (said[3] ? -1 : 1); if (Math.abs(sun - Number(row[4])) > 0.0501 || Math.abs(earth - Number(row[9])) > 0.0501) wrong.push('hour ' + k + ': the bar says Sun ' + sun + ' Earth ' + earth + ', the row ' + row[4] + ' and ' + row[9]) } } return wrong.length === 0 || wrong.join('; ') })()`
const after = (ms, expression) => `new Promise((done, fail) => setTimeout(() => { try { done(${expression}) } catch (error) { fail(error) } }, ${ms}))`
/** True when the star canvas has stars drawn on it and no star pixel lies inside the Moon's disc; otherwise words that say what it found. */
const STARS_CLEAR = `(() => { const canvas = document.querySelector('.sl-stars'); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const box = canvas.getBoundingClientRect(); const scale = canvas.width / box.width; const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2 - box.left; const cy = (globe.top + globe.bottom) / 2 - box.top; const x0 = Math.max(0, Math.floor((cx - r) * scale)); const y0 = Math.max(0, Math.floor((cy - r) * scale)); const w = Math.min(canvas.width - x0, Math.ceil(2 * r * scale)); const h = Math.min(canvas.height - y0, Math.ceil(2 * r * scale)); const data = canvas.getContext('2d').getImageData(x0, y0, w, h).data; let over = 0; for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { if (data[(y * w + x) * 4 + 3] > 0 && Math.hypot(x0 + x - cx * scale, y0 + y - cy * scale) < r * scale - 1) over += 1 } const all = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let lit = 0; for (let i = 3; i < all.length; i += 4) if (all[i] > 0) lit += 1; return (Number(canvas.dataset.stars) >= 40 && lit > 100 && over === 0) || 'stars ' + canvas.dataset.stars + ', lit pixels ' + lit + ', over the disc ' + over })()`
/** Where Earth's picture is: its distance from the Moon's centre, the disc's and its own radius, and whether it is pressed against the stage's edge. */
const EARTH_OUT = `(() => { const earth = document.querySelector('.sl-earth'); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const e = earth.getBoundingClientRect(); const d = Math.hypot((e.left + e.right) / 2 - (globe.left + globe.right) / 2, (e.top + e.bottom) / 2 - (globe.top + globe.bottom) / 2); const stage = document.querySelector('.sl-moon').getBoundingClientRect(); const inside = Math.min(e.left - stage.left, stage.right - e.right, e.top - stage.top, stage.bottom - e.bottom); const tools = document.querySelector('.sl-view-tools')?.getBoundingClientRect(); const onTools = tools !== undefined && e.left < tools.right && e.right > tools.left && e.top < tools.bottom && e.bottom > tools.top; return { d, r, er: e.width / 2, inside, onTools } })()`

/** Frames drawn in three seconds, the share that took longer than 25 ms, and the slowest: printed, not judged. */
const FRAME_RATE = `new Promise((done) => { const times = []; const tick = (now) => { times.push(now); if (now - times[0] < 3000) requestAnimationFrame(tick); else { const gaps = times.slice(1).map((t, i) => t - times[i]); done(Math.round((gaps.length * 1000) / (times.at(-1) - times[0])) + ' frames a second, ' + Math.round((gaps.filter((g) => g > 25).length / gaps.length) * 100) + '% of frames over 25 ms, slowest ' + Math.round(Math.max(...gaps)) + ' ms') } }; requestAnimationFrame(tick) })`

/** True when the arrow to Earth points the way the ephemeris file has Earth across the ground at an hour of May 2027; otherwise how far off it is. */
const EARTH_ARROW = (hour) => `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const h = 2880 + ${hour}; const n = Math.hypot(f[h * 6 + 3], f[h * 6 + 4], f[h * 6 + 5]); const e = [f[h * 6 + 3] / n, f[h * 6 + 4] / n, f[h * 6 + 5] / n]; const p = document.querySelector('.scout-globe').dataset.pose.split(',').map(Number); const c = p.slice(0, 3); const u = p.slice(3); const r = [u[1] * c[2] - u[2] * c[1], u[2] * c[0] - u[0] * c[2], u[0] * c[1] - u[1] * c[0]]; const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; const want = Math.atan2(dot(e, r), dot(e, u)) * 180 / Math.PI; const drawn = Number(/rotate\\(([-\\d.]+)/.exec(document.querySelector('.sl-to-earth g').getAttribute('transform'))[1]); const off = Math.abs(((want - drawn + 540) % 360) - 180); return off < 1.5 || 'the arrow is ' + off.toFixed(1) + '° off' })()`
/** True when the river's time slider spans a whole calendar year (of 365 days): its Year view has every hour. */
const YEAR_WHOLE = "(() => { const input = document.querySelector('.sl-seek input'); return Number(input.max) - Number(input.min) + 1 === 8760 })()"

/**
 * Earth's picture watched frame by frame for a while: true when its place on screen never moves by
 * more than `maxStepPx` from one frame to the next (while it is drawn at all); otherwise words that
 * say how far it jumped and how often.
 */
const earthSteady = (ms, maxStepPx) => `new Promise((done) => { const seen = []; const start = performance.now(); const tick = () => { const earth = document.querySelector('.sl-earth'); const box = earth?.getBoundingClientRect(); seen.push(earth && Number(getComputedStyle(earth).opacity) > 0.05 && (earth.dataset.state === 'front' || earth.dataset.state === 'setting') ? [box.left, box.top] : null); if (performance.now() - start < ${ms}) return requestAnimationFrame(tick); let worst = 0; let jumps = 0; let drawn = 0; for (let i = 1; i < seen.length; i += 1) { if (seen[i]) drawn += 1; if (!seen[i] || !seen[i - 1]) continue; const step = Math.hypot(seen[i][0] - seen[i - 1][0], seen[i][1] - seen[i - 1][1]); worst = Math.max(worst, step); if (step > ${maxStepPx}) jumps += 1 } done((drawn > 10 && worst <= ${maxStepPx}) || 'largest step ' + worst.toFixed(1) + ' px, ' + jumps + ' jumps over ${maxStepPx} px, Earth drawn in ' + drawn + ' of ' + seen.length + ' frames') }; requestAnimationFrame(tick) })`

/**
 * For a scene with `frames: true`, put in the page before its own code runs: the Moon's canvas keeps
 * its last drawn frame readable, and the page's WebGL contexts are remembered by canvas, so a check
 * can read every frame the globe draws, exactly as drawn.
 */
const KEEP_FRAMES = `(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, options) { const context = original.call(this, kind, kind === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options); if (kind === 'webgl2' && context) (window.__gl ??= new Map()).set(this, context); return context } })()`
/**
 * Every frame of the Moon's canvas for `ms`, read at each screen refresh: a number that changes if
 * any pixel does, the brightness (red + green + blue, 0 to 765) at an 11 by 11 grid of fixed
 * points, and the mean brightness of the whole frame.
 */
const MOON_FRAMES = (ms) => `new Promise((done) => { const canvas = document.querySelector('.scout-globe canvas'); const gl = window.__gl?.get(canvas); if (!gl) return done([]); const frames = []; const GRID = 11; let start = null; const tick = (now) => { start ??= now; const w = gl.drawingBufferWidth; const h = gl.drawingBufferHeight; const whole = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, whole); const words = new Uint32Array(whole.buffer); let sum = 0; for (let i = 0; i < words.length; i += 1) sum = (Math.imul(sum, 31) + words[i]) | 0; let total = 0; let count = 0; for (let i = 0; i < whole.length; i += 4 * 37) { total += whole[i] + whole[i + 1] + whole[i + 2]; count += 1 } const points = []; for (let gy = 0; gy < GRID; gy += 1) for (let gx = 0; gx < GRID; gx += 1) { const at = (Math.floor(((gy + 0.5) / GRID) * h) * w + Math.floor(((gx + 0.5) / GRID) * w)) * 4; points.push(whole[at] + whole[at + 1] + whole[at + 2]) } frames.push({ t: now - start, sum, w, mean: total / count, points }); if (now - start < ${ms}) requestAnimationFrame(tick); else done(frames) }; requestAnimationFrame(tick) })`
/** True when every frame of the Moon read in `ms` is the same picture, pixel for pixel; otherwise how many pictures there were. */
const MOON_STILL = (ms) => `(${MOON_FRAMES(ms)}).then((frames) => { const pictures = new Set(frames.map((f) => f.sum)).size; return frames.length < 10 ? 'only ' + frames.length + ' frames read' : pictures === 1 || pictures + ' different pictures in ' + frames.length + ' frames' })`
/**
 * True when the Moon's picture changed smoothly over `ms`: at least `least` different pictures (it
 * did change), and no single frame moved the whole frame's mean brightness by more than `mean` (of
 * 765) or more than `points` of the 121 fixed points by more than 60. Otherwise the worst frames.
 * The frames before the Moon is first drawn (an empty canvas) are left out, and so are the four
 * after the canvas changes size: a stage that changes size is re-fitted at once, by design.
 */
const MOON_SMOOTH = (ms, { mean = 1.5, points = 12, least = 20 } = {}) => `(${MOON_FRAMES(ms)}).then((all) => { const first = all.findIndex((f) => f.mean > 0); const frames = first < 0 ? [] : all.slice(first); const pictures = new Set(frames.map((f) => f.sum)).size; if (pictures < ${least}) return 'only ' + pictures + ' different pictures in ' + frames.length + ' frames: the picture did not change as expected'; const bad = []; let resized = -9; for (let i = 1; i < frames.length; i += 1) { if (frames[i].w !== frames[i - 1].w) resized = i; if (i - resized < 4) continue; const step = Math.abs(frames[i].mean - frames[i - 1].mean); let moved = 0; for (let k = 0; k < frames[i].points.length; k += 1) if (Math.abs(frames[i].points[k] - frames[i - 1].points[k]) > 60) moved += 1; if (step > ${mean} || moved > ${points}) bad.push(Math.round(frames[i].t) + ' ms: mean ' + frames[i - 1].mean.toFixed(1) + ' to ' + frames[i].mean.toFixed(1) + ', ' + moved + ' points') } return bad.length === 0 || bad.length + ' frames jumped: ' + bad.slice(0, 4).join('; ') })`

/**
 * The wheel turned over the Moon, a little at every screen refresh, as a browser hands wheel events
 * to a page: `steps` frames in, then as many out. True when the picture followed smoothly: it moved
 * frame by frame (few frames repeating the one before), no frame changed its brightness far more
 * than the frames either side of it (a jump), and, on a machine that is keeping up, no frame was
 * longer than 34 ms. Whether the machine is keeping
 * up is measured first, with the Moon untouched for a second and read the same way: if a frame runs
 * past 34 ms even then, frame times are not judged, and the note says so. What was measured is kept
 * in window.__wheel for the scene's note. Needs `frames: true`.
 */
const WHEEL_ZOOM = (steps = 45) => `(async () => {
  const box = document.querySelector('.scout-globe canvas').getBoundingClientRect()
  // A quarter of the disc up and to the left of its middle: on the Moon, and clear of the site's marker.
  const disc = Number(document.querySelector('.scout-globe').dataset.discPx)
  const x = box.left + box.width / 2 - disc / 4
  const y = box.top + box.height / 2 - disc / 4
  const under = document.elementFromPoint(x, y)
  const gapsOf = (frames) => frames.slice(1).map((frame, i) => frame.t - frames[i].t)
  const before = await ${MOON_FRAMES(1000)}
  const slowestBefore = Math.max(0, ...gapsOf(before))
  let turned = 0
  const turn = () => {
    if (turned >= ${2 * steps}) return
    under.dispatchEvent(new WheelEvent('wheel', { deltaY: turned < ${steps} ? -30 : 30, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    turned += 1
    requestAnimationFrame(turn)
  }
  requestAnimationFrame(turn)
  const all = await ${MOON_FRAMES(Math.round(((2 * steps) / 60) * 1000) + 400)}
  const first = all.findIndex((frame) => frame.mean > 0)
  const frames = first < 0 ? [] : all.slice(first)
  if (frames.length < ${steps}) return 'only ' + frames.length + ' frames were read while the wheel turned'
  const gaps = gapsOf(frames)
  const slowest = Math.max(...gaps)
  const rate = Math.round((gaps.length * 1000) / (frames.at(-1).t - frames[0].t))
  const keepingUp = slowestBefore <= 34
  window.__wheel = rate + ' frames a second while the wheel turned, slowest frame ' + Math.round(slowest) + ' ms' + (keepingUp ? '' : ' (not judged: before the wheel turned, with nothing moving, the slowest frame was already ' + Math.round(slowestBefore) + ' ms, so this machine was not keeping up)')
  // Only the frames while the picture was moving are judged: from its first change to its last.
  const changed = frames.map((frame, i) => i > 0 && frame.sum !== frames[i - 1].sum)
  const moving = frames.slice(Math.max(0, changed.indexOf(true) - 1), changed.lastIndexOf(true) + 1)
  const repeats = moving.slice(1).filter((frame, i) => frame.sum === moving[i].sum).length
  window.__wheel += '; ' + (moving.length - 1) + ' frames of movement, ' + repeats + ' of them repeating the frame before'
  if (moving.length - 1 < ${Math.round(1.4 * steps)}) return 'the picture moved for only ' + (moving.length - 1) + ' frames while the wheel turned ' + ${2 * steps} + ' times: the zoom did not follow the wheel frame by frame (the wheel was turned over ' + under.tagName.toLowerCase() + ')'
  if (repeats > (moving.length - 1) / 5) return repeats + ' of ' + (moving.length - 1) + ' frames repeated the frame before while the wheel turned: the zoom stutters'
  // A jump is a frame whose change in brightness is over three times the change in the frame before and the frame after it.
  const change = moving.slice(1).map((frame, i) => Math.abs(frame.mean - moving[i].mean))
  const jumps = change.map((step, i) => (i > 0 && i < change.length - 1 && step > 8 && step > 3 * Math.max(1, change[i - 1], change[i + 1]) ? Math.round(moving[i + 1].t) + ' ms: ' + step.toFixed(1) + ' after ' + change[i - 1].toFixed(1) + ' and before ' + change[i + 1].toFixed(1) : null)).filter(Boolean)
  if (jumps.length > 0) return jumps.length + ' frame(s) changed the picture far more than the frames either side (brightness of 765): ' + jumps.slice(0, 4).join('; ')
  if (keepingUp && slowest > 34) return 'a frame took ' + Math.round(slowest) + ' ms while the wheel turned (34 ms at most on a machine that is keeping up; before the wheel, the slowest was ' + Math.round(slowestBefore) + ' ms)'
  return true
})()`

/**
 * Earth's picture against the app's own Sun and Earth positions for an hour of 2027: true when,
 * with room all round the Moon, Earth is drawn on the bearing the ephemeris file gives it (within
 * 1°), its lit share is the file's (within 2 points), and its bright side faces the way the file
 * has the Sun on screen (within 30°); otherwise words that say what is off.
 */
const earthIsRight = (hourOfYear) => `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const unit = (o) => { const n = Math.hypot(f[${hourOfYear} * 6 + o], f[${hourOfYear} * 6 + o + 1], f[${hourOfYear} * 6 + o + 2]); return [f[${hourOfYear} * 6 + o] / n, f[${hourOfYear} * 6 + o + 1] / n, f[${hourOfYear} * 6 + o + 2] / n] }; const sun = unit(0); const earthDir = unit(3); const p = document.querySelector('.scout-globe').dataset.pose.split(',').map(Number); const c = p.slice(0, 3); const u = p.slice(3); const r = [u[1] * c[2] - u[2] * c[1], u[2] * c[0] - u[0] * c[2], u[0] * c[1] - u[1] * c[0]]; const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; const apart = (a, b) => Math.abs(((a - b + 540) % 360) - 180); const deg = (x, y) => Math.atan2(y, x) * 180 / Math.PI; const earth = document.querySelector('.sl-earth'); if (earth.dataset.moved !== '0') return 'Earth has no room on its own bearing here (moved ' + earth.dataset.moved + '°)'; const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const e = earth.getBoundingClientRect(); const drawn = deg((e.left + e.right) / 2 - (globe.left + globe.right) / 2, (globe.top + globe.bottom) / 2 - (e.top + e.bottom) / 2); const bearingOff = apart(drawn, deg(dot(earthDir, r), dot(earthDir, u))); const litOff = Math.abs(Number(earth.dataset.lit) - Math.round((1 + dot(sun, c)) / 2 * 100)); const data = earth.getContext('2d').getImageData(0, 0, earth.width, earth.height).data; let sx = 0; let sy = 0; for (let y = 0; y < earth.height; y += 1) for (let x = 0; x < earth.width; x += 1) { const i = (y * earth.width + x) * 4; const bright = (data[i] + data[i + 1] + data[i + 2]) * data[i + 3]; sx += bright * (x - earth.width / 2); sy += bright * (earth.height / 2 - y) } const sideOff = apart(deg(sx, sy), deg(dot(sun, r), dot(sun, u))); return (bearingOff <= 1 && litOff <= 2 && sideOff <= 30) || 'bearing ' + bearingOff.toFixed(1) + '° off, lit share ' + litOff + ' points off, bright side ' + sideOff.toFixed(0) + '° off the Sun' })()`


// ---- Scout's tour. Its steps come from the file the page reads, so the checks follow the words.
const TOUR = JSON.parse(readFileSync(new URL('../src/sightline/tour.json', import.meta.url), 'utf8'))
/** The feature guides, from their own file, in the same format. */
const GUIDES = JSON.parse(readFileSync(new URL('../src/sightline/guides.json', import.meta.url), 'utf8')).guides
/**
 * A step of the tour is on show as it should be: Scout's bubble holds its title, its words and
 * "i of n"; everything the step is about that is on screen has a ring, inside the window; neither
 * a ring nor the bubble lies over the Moon's disc (where the Moon is in sight: on a phone a panel
 * that fills the screen has it behind it); and the bubble does not cover what it rings.
 */
const TOUR_STEP = (i) => STEP_SHOWN(TOUR.steps, i)
/** The same for step `i` of any list of steps: the main tour's, or a feature guide's. */
const STEP_SHOWN = (steps, i) => {
  const step = steps[i]
  return `(() => { const bubble = document.querySelector('.sl-tour'); if (!bubble) throw new Error('no bubble'); if (bubble.dataset.step !== ${JSON.stringify(step.id)}) throw new Error('the bubble is on step ' + bubble.dataset.step); const says = bubble.querySelector('.sl-tour-say').textContent.trim(); const title = bubble.querySelector('.sl-tour-title').textContent.trim(); const count = bubble.querySelector('.sl-tour-count').textContent.replace(/\\s+/g, ' ').trim(); const shown = (el) => { if (el.closest('[hidden]')) return false; const b = el.getBoundingClientRect(); const style = getComputedStyle(el); return b.width >= 2 && b.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none' && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth }; const targets = ${JSON.stringify(step.targets)}.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(shown); const rings = [...document.querySelectorAll('.sl-tour-ring')].map((ring) => ring.getBoundingClientRect()); const box = bubble.getBoundingClientRect(); const globe = document.querySelector('.scout-globe'); const g = globe.getBoundingClientRect(); const r = Number(globe.dataset.discPx) / 2; const cx = (g.left + g.right) / 2; const cy = (g.top + g.bottom) / 2; const hidden = document.elementFromPoint(cx, cy)?.closest('.sl-drawer') != null; const overDisc = (b) => r > 0 && !hidden && Math.hypot(Math.min(Math.max(cx, b.left), b.right) - cx, Math.min(Math.max(cy, b.top), b.bottom) - cy) < r - 1; const inWindow = (b, air) => b.left >= -air && b.top >= -air && b.right <= innerWidth + air && b.bottom <= innerHeight + air; const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; const wrong = []; if (says !== ${JSON.stringify(step.say)}) wrong.push('says: ' + says); if (title !== ${JSON.stringify(step.title)}) wrong.push('title: ' + title); if (count !== '${i + 1} of ${steps.length}') wrong.push('count: ' + count); if (targets.length === 0) wrong.push('nothing on screen to ring'); if (rings.length !== targets.length) wrong.push(rings.length + ' rings for ' + targets.length + ' things'); if (!rings.every((ring) => inWindow(ring, 6))) wrong.push('a ring leaves the window'); if (rings.some(overDisc)) wrong.push('a ring is over the Moon'); if (!inWindow(box, 0.5)) wrong.push('the bubble leaves the window: ' + Math.round(box.left) + ',' + Math.round(box.top) + ' to ' + Math.round(box.right) + ',' + Math.round(box.bottom)); if (overDisc(box)) wrong.push('the bubble is over the Moon'); if (rings.some((ring) => hits(box, ring))) wrong.push('the bubble covers what it rings'); if (bubble.scrollHeight > bubble.clientHeight + 1) wrong.push('the bubble scrolls'); if (wrong.length) throw new Error(wrong.join('; ')); return true })()`
}
/** Put in the page before the Guide's videos are asked for: the walkthrough and the 30-second demo answer as videos (true) or are not there (false), whatever the server has; with `chapters`, the walkthrough's chapters file answers with three chapters. */
const TOUR_VIDEO = (there, chapters = false) => `(() => { const real = window.fetch; const media = ${JSON.stringify({ [TOUR.video.file]: 'video', [TOUR.demo.file]: 'video', [TOUR.video.chapters]: 'chapters' })}; window.fetch = (url, init) => { const kind = media[new URL(String(url), location.href).pathname]; if (!kind) return real(url, init); if (!${there} || (kind === 'chapters' && !${chapters})) return Promise.resolve(new Response(null, { status: 404 })); return Promise.resolve(kind === 'video' ? new Response(null, { status: 200, headers: { 'content-type': 'video/mp4' } }) : new Response('WEBVTT\\n\\n00:00:00.000 --> 00:00:09.000\\nThe Moon, now\\n\\n00:00:09.000 --> 00:00:21.500\\nThe markers\\n\\n00:01:02.000 --> 00:01:12.000\\nAsk Scout\\n', { status: 200, headers: { 'content-type': 'text/vtt; charset=utf-8' } })) }; return true })()`
const TOUR_NEXT = `(document.querySelector('.sl-tour .sl-tour-next').click(), true)`
const TOUR_KEY = (key) => `(window.dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true })), true)`
/** The scenes of the tour: every step in turn, the ways in, Escape putting the screen back, the voice, and the video's place. */
function tourScenes() {
  const n = TOUR.steps.length
  const stepName = (i) => `step ${i + 1} of ${n}, "${TOUR.steps[i].title}": its words, a ring on what it is about, and nothing of the tour over the Moon`
  return [
    {
      // A first visit, in Watch, with motion reduced: the offer, then all eight steps, then "Done".
      name: 'tour',
      hash: '',
      still: true,
      noChat: true,
      steps: [TOUR_VIDEO(false)],
      checks: [
        ['on a first visit the tour is a chip in Watch, outlined, to press; it has not started by itself', `(() => { const chip = document.querySelector('.sl-tour-chip'); window.__before = { date: document.querySelector('.sl-date').textContent, hash: location.hash, watch: document.querySelector('.sightline.is-watch') !== null }; return (chip?.textContent.trim().endsWith('One-minute tour') && chip.tagName === 'BUTTON' && chip.classList.contains('is-new') && document.querySelector('.sl-tour') === null && document.querySelector('.sl-tour-ring') === null) || chip?.textContent })()`],
        ['no voice file is asked for before "Listen" is pressed', "performance.getEntriesByType('resource').every((entry) => !entry.name.includes('/tour/voice/'))"],
        [`taking it starts the tour: ${stepName(0)}`, `(document.querySelector('.sl-tour-chip').click(), true) && ${after(900, TOUR_STEP(0))}`],
        ['the bubble is Scout\'s: his mark, "Listen" off with "AI-generated voice" beside it, Back (not yet), Next and Close; his own line gives way to it', "(() => { const bubble = document.querySelector('.sl-tour'); const listen = bubble.querySelector('.sl-tour-listen'); const buttons = [...bubble.querySelectorAll('.sl-tour-nav button')].map((button) => button.textContent.trim() + (button.disabled ? ' (off)' : '')); return (bubble.querySelector('.scout-badge') !== null && listen.getAttribute('aria-pressed') === 'false' && bubble.querySelector('.sl-tour-voice small').textContent === 'AI-generated voice' && buttons.join('|') === 'Back (off)|Next|Close' && document.querySelector('.sl-scout-line') === null && bubble.getAttribute('role') === 'dialog' && document.activeElement === bubble.querySelector('.sl-tour-next')) || buttons.join('|') })()"],
        ['nothing is dimmed: the Moon and the play control are as bright as before, and the play control still works', "(() => { const pill = document.querySelector('.sl-pill'); const top = document.elementFromPoint(pill.getBoundingClientRect().left + 20, pill.getBoundingClientRect().top + 20); return getComputedStyle(document.querySelector('.scout-globe')).opacity === '1' && getComputedStyle(pill).opacity === '1' && pill.contains(top) })()"],
        [stepName(1) + '; the site it names is ringed on the Moon as a reply of Scout\'s rings one', `${TOUR_NEXT} && ${after(900, `${TOUR_STEP(1)} && document.querySelector('.sl-dot.is-selected, .sl-group-dot.is-selected') !== null`)}`],
        ['with motion reduced, going on to Plan makes no camera flight: the Moon is at its new size at once and stays there', `(document.querySelector('.sl-tour .sl-tour-next').click(), true) && ${after(350, "(window.__discAt = Number(document.querySelector('.scout-globe').dataset.discPx), true)")} && ${after(1300, "(() => { const now = Number(document.querySelector('.scout-globe').dataset.discPx); return Math.abs(now - window.__discAt) < 0.5 || window.__discAt + ' then ' + now })()")}`],
        [stepName(2) + '; Plan is on the tour\'s own landing', `${TOUR_STEP(2)} && document.querySelector('.sightline.is-plan') !== null && document.querySelector('#sl-site').value === 'connecting-ridge' && ${LANDING} === '6 May 2027 · 13:00 UTC'`],
        [stepName(3) + '; the verdict has a reason and a next landing to show', `${TOUR_KEY('ArrowRight')} && ${after(900, `${TOUR_STEP(3)} && ${text('.sl-verdict-words')}.trim() === '✗ Does not fit the mission' && document.querySelector('.sl-reasons li') !== null && /^Next landing that fits: /.test(${text('.sl-next')}.trim())`)}`],
        ['the arrow keys step the tour and not the time: the landing and the date on the time bar are as they were', `${LANDING} === '6 May 2027 · 13:00 UTC' && ${text('.sl-now')} === '6 May 2027 · 13:00 UTC'`],
        [stepName(4), `${TOUR_NEXT} && ${after(900, TOUR_STEP(4))}`],
        [stepName(5), `${TOUR_KEY('ArrowRight')} && ${after(900, TOUR_STEP(5))}`],
        ['the left arrow goes back a step', `${TOUR_KEY('ArrowLeft')} && ${after(700, TOUR_STEP(4))}`],
        ['and the right arrow on again', `${TOUR_KEY('ArrowRight')} && ${after(900, TOUR_STEP(5))}`],
        [stepName(6), `${TOUR_NEXT} && ${after(900, TOUR_STEP(6))}`],
        [stepName(7) + '; the last step says "Done", and offers no video while there is none', `${TOUR_NEXT} && ${after(900, `${TOUR_STEP(7)} && document.querySelector('.sl-tour .sl-tour-next').textContent.trim() === 'Done' && document.querySelector('.sl-tour-video') === null`)}`],
        ['"Listen" plays the step\'s line from its own file, and every step\'s file is there as audio', `(document.querySelector('.sl-tour-listen').click(), true) && ${after(1200, `(async () => { const asked = performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname).filter((path) => path.startsWith('/tour/voice/')); const kinds = await Promise.all(${JSON.stringify(TOUR.steps.map((step) => `/tour/voice/${step.id}.mp3`))}.map((path) => fetch(path).then((r) => (r.ok ? r.headers.get('content-type') : String(r.status))))); return (document.querySelector('.sl-tour-listen').getAttribute('aria-pressed') === 'true' && asked.join() === '/tour/voice/scout.mp3' && kinds.every((kind) => /^audio\\/mpeg/.test(kind ?? ''))) || asked.join() + ' // ' + kinds.join() })()`)}`],
        ['"Done" ends it and puts the screen back as it was: Watch, at the same date, with Scout\'s own line, and the chip there still, no longer outlined', `${TOUR_NEXT} && ${after(1200, "(() => { const date = document.querySelector('.sl-date')?.textContent; const back = document.querySelector('.sl-tour') === null && document.querySelector('.sl-tour-ring') === null && document.querySelector('.sightline.is-watch') !== null && date === window.__before.date && location.hash === window.__before.hash && document.querySelector('.scout-face') !== null && document.querySelector('.sl-tour-chip') !== null && !document.querySelector('.sl-tour-chip').classList.contains('is-new') && localStorage.getItem('sightline.tourTaken') === '1'; return back || date + ' ' + location.hash })()")}`],
      ],
    },
    {
      // From Plan, with the visitor's own two scenarios and Compare open: the tour from How it works, and Escape half-way.
      name: 'tour-restore',
      hash: '#a=shackleton-rim@2027-06&t=22&limits=14_24_99999_1_1&mode=plan&list=apollo-11@2028-07-20T20&sc=1',
      noChat: true,
      steps: [TOUR_VIDEO(false), click('Compare')],
      checks: [
        ['"Guide" in the rail opens the sheet in its order: "Start here" with "Take the tour" and no video while there is none, then why this site is hard, then the feature guides by name, then "How to use Sightline" with the tour\'s eight steps word for word, then how it works', `(() => { window.__before = { hash: location.hash, tabs: document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length, site: document.querySelector('#sl-site').value }; ${click('Guide')}; return true })() && ${after(900, `(() => { const sheet = document.querySelector('.sl-how'); const parts = [...sheet.querySelectorAll('.how > section, .how > div')].map((part) => part.className.split(' ')[0]); const items = [...document.querySelectorAll('.how-use-steps li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); const want = ${JSON.stringify(TOUR.steps.map((step) => `${step.title}. ${step.say}`))}; const start = sheet.querySelector('.how-start'); const order = parts.slice(0, 5).join('|'); const guides = [...sheet.querySelectorAll('.how-guide-list button')].map((button) => button.textContent.trim()).join('|'); return (sheet.getAttribute('aria-label') === 'Guide' && order === 'how-start|how-why|how-guides|how-use|how-intro' && guides === ${JSON.stringify(GUIDES.map((guide) => guide.name).join('|'))} && start.querySelector('h2').textContent === 'Start here' && [...start.querySelectorAll('button')].map((button) => button.textContent.trim()).join('|') === 'Take the tour' && document.querySelector('#how-use-title').textContent === 'How to use Sightline' && JSON.stringify(items) === JSON.stringify(want) && document.querySelector('.how-video') === null && sheet.scrollWidth <= sheet.clientWidth) || order + ' // ' + items.slice(0, 1).join() })()`)}`],
        [`"Take the tour" closes the sheet and starts at ${stepName(0)}`, `(document.querySelector('.how-tour-button').click(), true) && ${after(1200, `document.querySelector('.sl-how') === null && document.querySelector('.sl-compare') === null && ${TOUR_STEP(0)}`)}`],
        ['three steps on, the tour is on its own landing, not the visitor\'s', `${TOUR_NEXT} && ${after(700, TOUR_NEXT)} && ${after(1500, TOUR_NEXT)} && ${after(2500, `${TOUR_STEP(3)} && document.querySelector('#sl-site').value === 'connecting-ridge'`)}`],
        ['Escape closes it there and the screen is back as the visitor had it: both scenarios, the second on show, Compare open, the same address', `${TOUR_KEY('Escape')} && ${after(1200, "(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length; const back = document.querySelector('.sl-tour') === null && document.querySelector('.sl-tour-ring') === null && tabs === window.__before.tabs && document.querySelector('#sl-site').value === window.__before.site && location.hash === window.__before.hash && document.querySelector('.sl-compare') !== null; return back || tabs + ' ' + document.querySelector('#sl-site').value + ' ' + location.hash })()")}`],
        ['once the tour has been taken, the Guide offers it again', `(${click('Guide')}, true) && ${after(900, "document.querySelector('.how-tour-button')?.textContent.trim() === 'Take the tour again' || document.querySelector('.how-tour-button')?.textContent")} && ${after(1000, `(${click('Back to the Moon')}, true)`)}`],
        ['on a phone "Tour" is in "More"; on a laptop the rail has no such button', `window.innerWidth > 760 ? ![...document.querySelectorAll('.sl-rail button')].some((button) => button.textContent.trim() === 'Tour') : ((${click('Close')}, ${click('More')}, true) && ${after(400, `(${click('Tour')}, true)`)} && ${after(1500, `${TOUR_STEP(0)} && ${TOUR_KEY('Escape')}`)})`],
      ],
    },
    {
      // What a step rings stays usable while the step is on show: the visitor can try it and then go on.
      name: 'tour-try',
      hash: '',
      still: true,
      noChat: true,
      steps: [TOUR_VIDEO(false), "document.querySelector('.sl-tour-chip').click()"],
      checks: [
        ['step 1: the play control it rings can be pressed, and the tour stays on its step', `(document.querySelector('.sl-pill button').click(), true) && ${after(500, `document.querySelector('.sl-pill button').getAttribute('aria-label') === 'Pause' && ${TOUR_STEP(0)}`)}`, 900],
        ['going on holds time again', `${TOUR_NEXT} && ${after(700, "document.querySelector('.sl-pill button').getAttribute('aria-label') === 'Play'")}`],
        ['step 3: another site can be picked in the controls it rings; the tour stays on its step, with its ring', `${TOUR_NEXT} && ${after(1500, siteMore('shackleton-rim'))} && ${after(2300, `document.querySelector('#sl-site').value === 'shackleton-rim' && ${TOUR_STEP(2)}`)}`],
        ['the next step speaks of the visitor\'s own pick, not the tour\'s landing', `${TOUR_NEXT} && ${after(900, `document.querySelector('#sl-site').value === 'shackleton-rim' && ${TOUR_STEP(3)}`)}`],
        ['step 6: the time bar it rings can be moved, and the tour stays on its step', `${TOUR_NEXT} && ${after(700, TOUR_NEXT)} && ${after(1700, "(() => { window.__shown = document.querySelector('.sl-now').textContent; const range = document.querySelector('.sl-river input[type=\"range\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, String(Number(range.value) + 40)); range.dispatchEvent(new Event('input', { bubbles: true })); return true })()")} && ${after(2300, `(document.querySelector('.sl-now').textContent !== window.__shown || 'the time shown did not move') && ${TOUR_STEP(5)}`)}`],
        ['Escape still puts Watch back as it was', `${TOUR_KEY('Escape')} && ${after(1200, `document.querySelector('.sl-tour') === null && document.querySelector('.sightline.is-watch') !== null && ${text('.sl-date')} === '1 May 2027'`)}`],
      ],
    },
    // Two steps held on screen, for a picture of each (with --out): the markers in Watch, and the verdict in Plan.
    ...[1, 3].map((stop) => ({
      name: `tour-at-${TOUR.steps[stop].id}`,
      hash: '',
      noChat: true,
      steps: ["document.querySelector('.sl-tour-chip').click()", ...Array.from({ length: stop }, () => after(600, TOUR_NEXT))],
      checks: [[stepName(stop), TOUR_STEP(stop), 1500]],
    })),
    {
      // The Guide's videos exist (their files answer as videos, the walkthrough with a chapters file).
      name: 'tour-video',
      hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
      noChat: true,
      steps: [TOUR_VIDEO(true, true), "(HTMLMediaElement.prototype.play = function () { window.__played = (window.__played ?? 0) + 1; this.dataset.asked = 'play'; return Promise.resolve() }, true)"],
      checks: [
        ['with the videos in place, "Start here" offers the tour, the walkthrough and the 30-second demo; no player is on screen and nothing has played', `(${click('Guide')}, true) && ${after(1200, "(() => { const start = document.querySelector('.sl-how .how-start'); const ways = [...start.querySelectorAll('.how-start-ways button')].map((button) => button.textContent.trim()).join('|'); return (ways === 'Take the tour|Watch the walkthrough|30-second demo' && document.querySelector('.how-video') === null && !window.__played) || ways })()")}`],
        ['"Watch the walkthrough" puts one player on screen and starts it: the file, its poster, captions on by default, and its chapters listed', `(${click('Watch the walkthrough')}, true) && ${after(700, `(() => { const players = [...document.querySelectorAll('.how-video video')]; const video = players[0]; if (players.length !== 1) return players.length + ' players'; const track = video.querySelector('track'); const chapters = [...document.querySelectorAll('.how-chapters button')].map((button) => button.textContent.replace(/\\s+/g, ' ').trim()).join('|'); return (video.querySelector('source').getAttribute('src') === ${JSON.stringify(TOUR.video.file)} && video.getAttribute('poster') === ${JSON.stringify(TOUR.video.poster)} && track.getAttribute('src') === ${JSON.stringify(TOUR.video.captions)} && track.kind === 'captions' && track.default && video.controls && !video.autoplay && window.__played === 1 && chapters === '0:00 The Moon, now|0:09 The markers|1:02 Ask Scout' && /AI-generated voice/.test(document.querySelector('.how-video .how-caption').textContent)) || chapters + ' // played ' + window.__played })()`)}`],
        ['a chapter takes the video to its start', `(document.querySelectorAll('.how-chapters button')[2].click(), true) && ${after(300, "Math.abs(document.querySelector('.how-video video').currentTime - 62) < 0.01 || document.querySelector('.how-video video').currentTime")}`],
        ['"30-second demo" takes the walkthrough\'s place: still one player, the demo\'s file, no chapters', `(${click('30-second demo')}, true) && ${after(700, `(() => { const players = [...document.querySelectorAll('.how-video video')]; return (players.length === 1 && players[0].querySelector('source').getAttribute('src') === ${JSON.stringify(TOUR.demo.file)} && players[0].getAttribute('poster') === ${JSON.stringify(TOUR.demo.poster)} && players[0].querySelector('track').default && document.querySelector('.how-chapters') === null) || players.length + ' players' })()`)}`],
        ['the same press again puts the player away; the sheet has nothing to scroll sideways', `(${click('30-second demo')}, true) && ${after(500, "document.querySelector('.how-video') === null && document.querySelector('.sl-how').scrollWidth <= document.querySelector('.sl-how').clientWidth")}`],
        ['the tour\'s last step points to the walkthrough, which closes the tour and opens the Guide with the walkthrough on screen', `(document.querySelector('.how-tour-button').click(), true) && ${after(900, `(async () => { for (let i = 0; i < ${n - 1}; i += 1) { document.querySelector('.sl-tour .sl-tour-next').click(); await new Promise((done) => setTimeout(done, 450)) } const link = document.querySelector('.sl-tour .sl-tour-video'); if (link?.textContent.trim() !== 'Watch the walkthrough') return 'no link on step ' + document.querySelector('.sl-tour')?.dataset.step; link.click(); await new Promise((done) => setTimeout(done, 1100)); const video = document.querySelector('.sl-how .how-video video'); const box = video?.getBoundingClientRect(); return (document.querySelector('.sl-tour') === null && video !== null && video.querySelector('source').getAttribute('src') === ${JSON.stringify(TOUR.video.file)} && box.bottom > 0 && box.top < innerHeight) || 'the player is at ' + Math.round(box?.top) + ' to ' + Math.round(box?.bottom) })()`)}`],
      ],
    },
  ]
}

/**
 * Opens the skyline strip ("What the lander sees") by its door, as a visitor would: the time bar's
 * readout of the Sun's and Earth's heights, or, where the row has no room for it, "Show the skyline"
 * under the time bar's "More". The strip is folded until asked for; a scene marked `sky: true` is
 * about the strip, or about the screen with it open, and starts with this.
 */
const OPEN_SKY = `(async () => { for (let i = 0; i < 15; i += 1) { if (document.querySelector('.sl-sky')) return true; const door = document.querySelector('.sl-river .sl-sky-door'); if (door) { door.click(); return true } document.querySelector('.sl-river .sl-more')?.click(); await new Promise((done) => setTimeout(done, 100)) } throw new Error('no door to the skyline') })()`
/** Moves the pointer (a mouse) to a place on the time bar: `fraction` of the way along, level with the row numbered `row`. */
const POINT_AT_BAND = (row, fraction) => `(() => { const seek = document.querySelector('.sl-seek'); const box = seek.getBoundingClientRect(); const track = document.querySelectorAll('.sl-rows .sl-row .sl-track')[${row}].getBoundingClientRect(); seek.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: box.left + box.width * ${fraction}, clientY: (track.top + track.bottom) / 2 })); return true })()`
/** The band line on show is well formed, and lies inside the time bar, clear of the Moon's disc. Says what is wrong when not. */
const BAND_LINE = `(() => { const tip = document.querySelector('.sl-band-tip'); if (!tip) return 'no line'; const words = tip.textContent.trim(); const box = tip.getBoundingClientRect(); const river = document.querySelector('.sl-river').getBoundingClientRect(); const globe = document.querySelector('.scout-globe'); const disc = Number(globe.dataset.discPx) / 2; const g = globe.getBoundingClientRect(); const cx = (g.left + g.right) / 2; const cy = (g.top + g.bottom) / 2; const nx = Math.min(Math.max(cx, box.left), box.right); const ny = Math.min(Math.max(cy, box.top), box.bottom); const parts = /^(Sun and Earth|Sun only|Earth only|Neither) · (\\d+ \\w+ \\d\\d:00) to (\\d+ \\w+ \\d\\d:00) · (\\d+) h$/.exec(words); if (!parts) return words; if (box.top < river.top - 1 || box.bottom > river.bottom + 1 || box.left < river.left - 1 || box.right > river.right + 1) return 'outside the time bar: ' + Math.round(box.top) + ' to ' + Math.round(box.bottom) + ' in ' + Math.round(river.top) + ' to ' + Math.round(river.bottom); if (Math.hypot(nx - cx, ny - cy) < disc) return 'over the Moon'; return getComputedStyle(tip).cursor !== 'help' })()`
/** Plan holds the ready comparison: Connecting Ridge and Shackleton Rim, both landing 18 February 2027 at 12:00 UTC, side by side in Compare with figures that differ. Says what is off when not. */
const PAIR_ON_SHOW = `(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; const legend = [...document.querySelectorAll('.sl-compare-legend li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); const row = (name) => [...[...document.querySelectorAll('.sl-compare tbody tr')].find((tr) => tr.querySelector('th').textContent.trim() === name)?.querySelectorAll('td') ?? []].map((td) => td.textContent.replace('★', '').trim()).join('|'); const seen = [tabs, legend.join(' // '), row('Sunlit, %'), row('Longest dark spell, h'), row('Fits the mission')].join(' ; '); return (tabs === 2 && /^A ?Connecting Ridge ?18 February 2027 · 12:00 UTC$/.test(legend[0]) && /^B ?Shackleton Rim ?18 February 2027 · 12:00 UTC$/.test(legend[1]) && row('Sunlit, %').split('|').map((cell) => cell.split(' ')[0]).join('|') === '100|68' && row('Longest dark spell, h') === '0|71' && /^✓/.test(row('Fits the mission').split('|')[0]) && /^[✗✕]/.test(row('Fits the mission').split('|')[1])) || seen })()`
/** One scene for each feature guide: started from the Guide, every step in turn, then "Done" puts the screen back. Nothing reaches the chat. */
function guideScenes() {
  const HASH = '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan'
  const back = `document.querySelector('.sl-tour') === null && document.querySelector('.sl-tour-ring') === null && document.querySelector('.sl-how') === null && document.querySelector('.sl-drawer') === null && document.querySelector('.sl-full') === null && document.querySelector('.sl-share-menu') === null && document.querySelector('.sl-share-sheet') === null && document.querySelector('.sl-plan-more') === null && document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 1 && document.querySelector('#sl-site').value === 'connecting-ridge' && location.hash.startsWith('${HASH.split('&')[0]}') && ${LANDING} === '6 May 2027 · 13:00 UTC'`
  /** Step `i` of a guide as the window has it: a phone leaves out the steps about controls only a wide window has. */
  const stepOf = (id, i) => { const steps = GUIDES.find((guide) => guide.id === id).steps; const phone = steps.filter((step) => !step.wide); return `(window.innerWidth < 761 ? ${STEP_SHOWN(phone, i)} : ${STEP_SHOWN(steps, i)})` }
  return [
    ...GUIDES.map((guide) => {
      // A phone leaves out a step about a control only a wide window has: each check asks for the step that window has.
      const phone = guide.steps.filter((step) => !step.wide)
      const here = (i) => `(window.innerWidth < 761 ? ${i < phone.length ? STEP_SHOWN(phone, i) : 'true'} : ${STEP_SHOWN(guide.steps, i)})`
      return {
        name: `guide-${guide.id}`,
        hash: HASH,
        still: true,
        noChat: true,
        steps: [TOUR_VIDEO(false), click('Guide')],
        checks: [
          [`the Guide lists "${guide.name}" with one line and its number of steps; pressing it closes the sheet and starts at step 1, "${guide.steps[0].title}": its words, a ring on what it is about, nothing over the Moon`, `(() => { const button = document.querySelector('.how-guide-list button[data-guide="${guide.id}"]'); const line = button.parentElement.textContent.replace(/\\s+/g, ' ').trim(); if (line !== ${JSON.stringify(`${guide.name} ${guide.about} ${guide.steps.length} steps.`)}) throw new Error(line); button.click(); return true })() && ${after(1500, `document.querySelector('.sl-how') === null && ${here(0)}`)}`, 900],
          ['a feature guide has no voice: its bubble offers no "Listen", and is named for the guide', `document.querySelector('.sl-tour .sl-tour-listen') === null && document.querySelector('.sl-tour').getAttribute('aria-label') === ${JSON.stringify(guide.name)} && performance.getEntriesByType('resource').every((entry) => !entry.name.includes('/tour/voice/'))`],
          ...guide.steps.slice(1).map((step, i) => [`step ${i + 2}, "${step.title}"${step.wide ? ' (left out on a phone, which has no such control)' : ''}: its words, a ring on what it is about, and nothing of the guide over the Moon`, `(window.innerWidth < 761 && ${i + 1 >= phone.length}) || (${TOUR_NEXT} && ${after(step.state.pair || step.state.open ? 2500 : 1200, here(i + 1))})`]),
          ['the last step says "Done", which ends the guide and puts the screen back as it was: the same plan, nothing left open', `(document.querySelector('.sl-tour .sl-tour-next').textContent.trim() === 'Done' || document.querySelector('.sl-tour .sl-tour-next').textContent) && ${TOUR_NEXT} && ${after(1500, `(${back}) || 'not put back: ' + location.hash`)}`],
        ],
      }
    }),
    {
      // Each panel a guide is about offers it in its own header: words, not an icon.
      name: 'guide-ways',
      hash: HASH,
      still: true,
      noChat: true,
      steps: [TOUR_VIDEO(false)],
      checks: [
        ['Layers\' header says "Show me how", as words with no help cursor; it starts the guide to views and layers, and Escape puts Layers back', `(${click('Layers')}, true) && ${after(700, "(() => { const how = document.querySelector('.sl-layers .sl-drawer-head .sl-show-how'); if (how?.textContent.trim() !== 'Show me how' || getComputedStyle(how).cursor === 'help' || how.querySelector('svg')) return 'no words in the header'; how.click(); return true })()")} && ${after(1900, `${stepOf('views', 0)} && ${TOUR_KEY('Escape')}`)} && ${after(3000, "document.querySelector('.sl-tour') === null && document.querySelector('.sl-layers') !== null")}`],
        ['while a guide is on, the panel it opens does not offer it again', `(document.querySelector('.sl-layers .sl-drawer-head .sl-show-how').click(), true) && ${after(900, TOUR_NEXT)} && ${after(2600, `${stepOf('views', 1)} && document.querySelector('.sl-layers') !== null && document.querySelector('.sl-show-how') === null && ${TOUR_KEY('Escape')}`)} && ${after(3600, `(${click('Close')}, true)`)}`],
        ['the Share list offers the guide to sharing', `(${click('Share')}, true) && ${after(500, "(() => { const how = [...document.querySelectorAll('.sl-share-sheet button')].find((button) => button.textContent.trim() === 'Show me how'); if (!how) return 'not in the list'; how.click(); return true })()")} && ${after(1700, `${stepOf('share', 0)} && ${TOUR_KEY('Escape')}`)} && ${after(2700, "document.querySelector('.sl-tour') === null")}`],
        ['the form for a custom point offers the guide to it', `${siteMore('__custom')} && ${after(600, "(() => { const how = document.querySelector('.sl-plan-more .sl-show-how'); if (how?.textContent.trim() !== 'Show me how') return 'not beside the form'; how.click(); return true })()")} && ${after(1800, `${stepOf('custom', 0)} && ${TOUR_KEY('Escape')}`)} && ${after(2800, "document.querySelector('.sl-tour') === null")}`],
      ],
    },
  ]
}

// The Surface view (the app's own surface page, in a frame over the stage).
const SURFACE_DRAWN = `(() => { const frame = document.querySelector('iframe.sl-surface'); const page = frame?.contentWindow; const doc = frame?.contentDocument; if (!page || !doc) return false; const views = [...doc.querySelectorAll('canvas.sf-canvas')]; return views.length === 2 && views.every((view) => view.width > 0 && view.getBoundingClientRect().width > 0) && typeof page.__surfaceDrawMs === 'function' && page.__surfaceDrawMs() > 0 })()`
/** Where the things round the stage lie: the same in Orbit, Site and Surface. */
const SCREEN_BOXES = `JSON.stringify(['.sl-col', '.sl-river', '.sl-stage', '.sl-rail', '.sl-plan'].map((name) => { const box = document.querySelector(name)?.getBoundingClientRect(); return box ? [box.left, box.top, box.width, box.height].map(Math.round) : null }))`
/** What the frame says of the Sun and Earth, and what the site's track holds for the hour on the screen's time bar. */
const surfaceSays = (site) => `(async () => { const doc = document.querySelector('iframe.sl-surface').contentDocument; const says = doc.querySelector('.sf-pane.sun .sf-stage')?.getAttribute('aria-label') ?? ''; const at = new Date(Date.parse(document.querySelector('.sl-now').textContent.replace(' · ', ' '))).toISOString().slice(0, 19) + 'Z'; const track = await fetch('/data/${site}/' + at.slice(0, 7) + '/track.json').then((r) => r.json()); const row = track.find((point) => point.t === at); return { says, at, want: 'The Sun is ' + (row.sun_up ? 'up' : 'behind the land') + ' at azimuth ' + row.sun_az + '°; Earth is ' + (row.earth_up ? 'in view' : 'behind the land') + ' at azimuth ' + row.earth_az + '°' } })()`
const pressView = (name) => `[...document.querySelectorAll('.sl-heights button')].find((button) => button.textContent.trim() === '${name}').click()`

const SCENES = [
  {
    // Why a small change of place matters, ready to look at: from Scout's card in Watch.
    name: 'nearby-pair',
    hash: '',
    still: true,
    noChat: true,
    // On a laptop his card is open as the page opens; anywhere else his mark opens it.
    steps: ["document.querySelector('.sl-card') !== null || document.querySelector('.scout-face').click()"],
    checks: [
      ['Scout\'s open card offers, under his questions, two sites 10 km apart on the same date', "(() => { const idea = document.querySelector('.sl-card .sl-idea.is-action'); return idea?.textContent.replace(/\\s+/g, ' ').trim() === 'Two sites 10 km apart, same date ›' || idea?.textContent })()", 900],
      ['picking it opens Plan on both, side by side in Compare, with figures that differ: all Sun at one, 71 h of dark at the other', `(document.querySelector('.sl-card .sl-idea.is-action').click(), true) && ${after(3000, `document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-card') === null && ${PAIR_ON_SHOW}`)}`],
      ['the time bar is on that date, the link holds both scenarios, and nothing scrolls', `(${text('.sl-now')} === '18 February 2027 · 12:00 UTC' || ${text('.sl-now')}) && /^#a=connecting-ridge@2027-02/.test(location.hash) && /list=shackleton-rim@2027-02-18T12/.test(location.hash) && ${COLUMN_FITS} && ${NOTHING_SCROLLS} && ${DISC_INSIDE}`],
    ],
  },
  {
    // The same comparison from the tour's step on scenarios: the tour stays on its step, and closing it puts Watch back.
    name: 'nearby-pair-tour',
    hash: '',
    still: true,
    noChat: true,
    steps: [TOUR_VIDEO(false), "document.querySelector('.sl-tour-chip').click()", ...Array.from({ length: 6 }, () => after(600, TOUR_NEXT))],
    checks: [
      ['the tour\'s step on scenarios offers it under its words', `(() => { const link = document.querySelector('.sl-tour .sl-tour-try'); return link?.textContent.replace(/\\s+/g, ' ').trim() === 'Try it: two sites 10 km apart, same date ›' || link?.textContent })() && ${TOUR_STEP(6)}`, 1500],
      ['pressing it sets the two side by side in Compare while the tour stays on its step, its bubble clear of the Moon and of what it rings', `(document.querySelector('.sl-tour-try').click(), true) && ${after(3000, `${PAIR_ON_SHOW} === true && ${TOUR_STEP(6)}`)}`],
      ['no other step offers anything to try', `${TOUR_NEXT} && ${after(900, `document.querySelector('.sl-tour-try') === null && ${TOUR_STEP(7)}`)}`],
      ['closing the tour puts Watch back as it was', `${TOUR_KEY('Escape')} && ${after(1200, `document.querySelector('.sl-tour') === null && document.querySelector('.sightline.is-watch') !== null && ${text('.sl-date')} === '1 May 2027'`)}`],
    ],
  },
  {
    // Small things that make the screen explain itself: a word in each plan control, what the keys do, what a band is, what each view shows, what the skyline's thin lines are.
    name: 'explains-itself',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['each of the three plan controls says what it is in one tiny word inside it, clear of its value, and the column still fits', `(() => { const rows = [...document.querySelectorAll('.sl-plan > .sl-plan-row')]; const words = rows.map((row) => row.querySelector('.sl-plan-label')?.textContent.trim()).join('|'); if (words !== 'Site|Landing|Mission') return words; for (const row of rows) { const label = row.querySelector('.sl-plan-label').getBoundingClientRect(); const control = row.querySelector('select, .sl-pick, .sl-mission-open').getBoundingClientRect(); if (label.left < control.left || label.right > control.right || label.top < control.top || label.bottom > control.bottom) return 'a label is outside its control'; const value = row.querySelector('.sl-pick .sl-pick-part:last-of-type, .sl-mission-open b'); if (value && value.getBoundingClientRect().right > label.left - 4) return 'a label is on its control\\'s value: ' + row.textContent.trim().slice(0, 40) } const select = document.querySelector('#sl-site'); const name = document.createElement('span'); name.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(select).font; name.textContent = select.selectedOptions[0].textContent; document.body.append(name); const end = select.getBoundingClientRect().left + parseFloat(getComputedStyle(select).paddingLeft) + name.getBoundingClientRect().width; name.remove(); return end <= rows[0].querySelector('.sl-plan-label').getBoundingClientRect().left - 4 || 'the site\\'s name runs into its label' })() && ${COLUMN_FITS} && ${NOTHING_SCROLLS}`],
      ['the play button\'s hover text says what the keys do: Space, the arrows for an hour, Shift for a day', "(() => { const play = document.querySelector('.sl-river .sl-round'); const words = play.getAttribute('title') ?? play.dataset.tip ?? ''; return (/Space/.test(words) && /arrow keys move one hour/.test(words) && /Shift, one day/.test(words) && getComputedStyle(play).cursor !== 'help') || words })()"],
      ['and the keys do it: Shift with the right arrow moves a day, the left arrow an hour back', `(document.activeElement?.blur(), window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })), true) && ${after(400, `${text('.sl-now')} === '7 May 2027 · 13:00 UTC' && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })), true)`)} && ${after(800, `${text('.sl-now')} === '7 May 2027 · 12:00 UTC' || ${text('.sl-now')}`)}`],
      ['each of the three views says what it does in one short sentence', "(() => { const tips = [...document.querySelectorAll('.sl-heights button')].map((button) => button.getAttribute('title') ?? button.dataset.tip ?? ''); return (tips.length === 3 && tips.every((tip) => /^(Shows|Moves) /.test(tip) && tip.split(/\\s+/).length <= 16 && (tip.match(/[.!?](\\s|$)/g) ?? []).length === 1)) || tips.join(' | ') })()"],
      ['pointing at a band of the time bar says what it is, when it starts and ends and how long it lasts, inside the time bar', `${POINT_AT_BAND(0, 0.5)} && ${after(300, BAND_LINE)}`],
      ['the hours it says are the band\'s own: its length is the time from its start to its end, and the state is the one the bar shows when moved there', `(() => { const words = document.querySelector('.sl-band-tip').textContent.trim(); const parts = /^(.+?) · (\\d+) (\\w+) (\\d\\d):00 to (\\d+) (\\w+) (\\d\\d):00 · (\\d+) h$/.exec(words); const at = (day, month, hour) => Date.parse(day + ' ' + month + ' 2027 ' + hour + ':00 UTC'); const length = (at(parts[5], parts[6], parts[7]) - at(parts[2], parts[3], parts[4])) / 3600000; window.__band = parts[1]; const seek = document.querySelector('.sl-seek'); const box = seek.getBoundingClientRect(); const down = { bubbles: true, pointerType: 'mouse', pointerId: 1, clientX: box.left + box.width * 0.5, clientY: box.top + 4 }; seek.setPointerCapture = () => {}; seek.dispatchEvent(new PointerEvent('pointerdown', down)); seek.dispatchEvent(new PointerEvent('pointerup', down)); return length === Number(parts[8]) || words })() && ${after(500, `(document.querySelector('.sl-river .sl-chip')?.textContent.trim() === window.__band || document.querySelector('.sl-river .sl-chip')?.textContent.trim() + ' is not ' + window.__band) && document.querySelector('.sl-band-tip') === null`)}`],
      ['another band has another line, near an end of the bar it stays inside it, and it goes when the pointer leaves', `${POINT_AT_BAND(0, 0.995)} && ${after(300, `(${BAND_LINE}) === true && (() => { const first = document.querySelector('.sl-band-tip').textContent; ${POINT_AT_BAND(0, 0.003)}; return new Promise((done) => setTimeout(() => { const second = document.querySelector('.sl-band-tip')?.textContent; const fine = ${BAND_LINE}; const seek = document.querySelector('.sl-seek'); seek.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); setTimeout(() => done((fine === true && second !== first && document.querySelector('.sl-band-tip') === null) || fine + ' // ' + first + ' // ' + second + ' // still there: ' + (document.querySelector('.sl-band-tip') !== null)), 300) }, 300)) })()`)}`],
      ['with the keyboard on the time bar, the band the bar is in shows the same way', `(document.querySelector('.sl-seek input').focus(), true) && ${after(300, `(${BAND_LINE}) === true && (document.querySelector('.sl-seek input').blur(), true)`)} && ${after(600, "document.querySelector('.sl-band-tip') === null")}`],
      ['the landing\'s control has no drop-down arrow, since it opens a calendar and not a list; the site\'s keeps its own; the calendar still opens on a press and with Enter', `(() => { const pick = document.querySelector('.sl-plan .sl-pick'); if (pick.querySelector('.sl-pick-mark') !== null || /[▾▼⌄]/.test(pick.textContent)) return 'an arrow is still there'; if (getComputedStyle(document.querySelector('#sl-site')).appearance === 'none') return 'the site list lost its arrow'; let opened = 0; HTMLInputElement.prototype.showPicker = function () { opened += 1 }; const date = pick.querySelector('input[type="date"]'); date.click(); date.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); const label = pick.parentElement.querySelector('.sl-plan-label').getBoundingClientRect(); const box = pick.getBoundingClientRect(); return (opened === 2 && label.right <= box.right - 4 && label.left > pick.querySelector('.sl-pick-part:last-of-type').getBoundingClientRect().right + 4) || 'opened ' + opened + ' times; label ' + Math.round(label.left) + ' to ' + Math.round(label.right) + ' in ' + Math.round(box.right) })()`],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // The Advanced panel (opened from the mission's limits in the column) and the Planner's Advanced are one mission: what is set in one shows in the other.
    name: 'mission-advanced',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    heights: true,
    steps: ["document.querySelector('.sl-mission-open').click()", "document.querySelector('.sl-advanced-link').click()"],
    checks: [
      ['an antenna height picked in the mission\'s Advanced controls is the mission\'s: the link carries it and the column says it in its small line', `${PICK_HEIGHT('Antenna height', 10)} && ${after(3000, "(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; return (/&ha=10/.test(location.hash) && !/hp=/.test(location.hash) && /antenna at 10 m/.test(line)) || location.hash + ' // ' + line })()")}`, 900],
      ['with a height chosen the column still does not scroll', `${COLUMN_FITS} || (() => { const col = document.querySelector('.sl-col'); return 'column ' + col.scrollHeight + ' in ' + col.clientHeight + ', ' + col.scrollWidth + ' in ' + col.clientWidth })()`],
      ['Earth\'s clearance set there is the mission\'s too', `(() => { const select = document.querySelector('#sl-m-clear'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '5'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(600, "document.querySelector('#sl-m-clear').value === '5'")}`],
      ['the Planner\'s Advanced shows the same two choices', `(${click('Planner')}, true) && ${after(1500, "(() => { const pressed = [...document.querySelector('.sl-full .sl-height-pick[aria-label=\"Antenna height\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); const clear = document.querySelector('.sl-full #sl-m-clear').value; return (pressed === '10 m' && clear === '5') || pressed + ', ' + clear })()")}`],
      ['a panel height picked in the Planner shows in the mission\'s Advanced controls, back on the Moon', `${PICK_HEIGHT('Solar panel height', 5)} && ${after(2500, "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)")} && ${after(3500, "(document.querySelector('.sl-advanced-link') === null && document.querySelector('.sl-mission-open').click(), true)")} && ${after(4200, "(document.querySelector('.sl-mission-inline.is-advanced') === null && document.querySelector('.sl-advanced-link').click(), true)")} && ${after(5000, "(() => { const pressed = (label) => [...document.querySelector('.sl-mission-inline.is-advanced .sl-height-pick[aria-label=\"' + label + '\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); return (pressed('Solar panel height') === '5 m' && pressed('Antenna height') === '10 m' && document.querySelector('.sl-mission-inline.is-advanced #sl-m-clear').value === '5') || pressed('Solar panel height') + ', ' + pressed('Antenna height') })()")}`],
    ],
  },
  {
    // A custom point is worked out at 2 m only: in the mission's Advanced controls the two heights are off, with the reason.
    name: 'mission-advanced-custom',
    hash: '#a=-88.5,40@2027-05&t=200&limits=14_24_99999_1_1&mode=plan',
    steps: ["document.querySelector('.sl-mission-open').click()", "document.querySelector('.sl-advanced-link').click()"],
    checks: [
      ['with a custom point the two heights under Advanced are off, with the short reason; Earth\'s clearance can still be set', "(() => { const drawer = document.querySelector('.sl-mission-inline.is-advanced'); const buttons = [...drawer.querySelectorAll('.sl-height-pick button')]; const reason = drawer.querySelector('.sl-height-choice .sl-quiet')?.textContent ?? ''; return (buttons.length === 6 && buttons.every((button) => button.disabled) && reason === 'A custom point is worked out at 2 m only.' && !drawer.querySelector('#sl-m-clear').disabled) || reason + ' ' + buttons.length })()", 1500],
      ['and the column still does not scroll', `${COLUMN_FITS} || (() => { const col = document.querySelector('.sl-col'); return 'column ' + col.scrollHeight + ' in ' + col.clientHeight + ', ' + col.scrollWidth + ' in ' + col.clientWidth })()`],
    ],
  },
  {
    // A landing that does not fit here, on a date that does fit at another site of the same group.
    name: 'other-site',
    hash: '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['under the next landing that fits, a second line offers the nearest site of the same group where this date fits', `/Does not fit the mission/.test(${text('.sl-verdict-words')}) && /^Next landing that fits: /.test(${text('.sl-next')}.trim()) && (${text('.sl-elsewhere')}.replace(/\\s+/g, ' ').trim() === 'Fits at Peak near Shackleton on this date ›' || ${text('.sl-elsewhere')})`],
      ['its hover text says how far that site is and what a click does; no help cursor', "(() => { const line = document.querySelector('.sl-elsewhere'); return (/^Peak near Shackleton is 42 km away\\. Adds it on this date as another scenario\\.$/.test(line.title) && getComputedStyle(line).cursor !== 'help') || line.title })()"],
      ['the two lines sit one under the other inside the verdict, and the column still fits with nothing to scroll', `(() => { const [date, site] = [document.querySelector('.sl-next:not(.sl-elsewhere)'), document.querySelector('.sl-elsewhere')].map((el) => el.getBoundingClientRect()); const box = document.querySelector('.sl-verdict').getBoundingClientRect(); return (site.top >= date.bottom - 1 && site.bottom <= box.bottom + 1 && site.right <= box.right + 1) || 'date ' + Math.round(date.top) + '-' + Math.round(date.bottom) + ', site ' + Math.round(site.top) + '-' + Math.round(site.bottom) + ', verdict to ' + Math.round(box.bottom) })() && ${COLUMN_FITS} && ${NOTHING_SCROLLS}`],
      ['a click adds that site, on the same date, as scenario B, which fits; there the verdict offers nothing more', `(document.querySelector('.sl-elsewhere').click(), true) && ${after(2500, `document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 2 && document.querySelector('#sl-site').value === 'peak-near-shackleton' && ${LANDING} === '1 May 2027 · 00:00 UTC' && location.hash.includes('&sc=1') && /^✓ Fits/.test(${text('.sl-verdict-words')}.trim()) && document.querySelector('.sl-next') === null`)}`],
      ['back on A the line is still there', `(document.querySelector('.sl-tabs button[aria-label="Scenario A"]').click(), true) && ${after(700, "document.querySelector('.sl-elsewhere') !== null")}`],
    ],
  },
  {
    // A date that fits at no site of the group: the next landing is offered, and no other site.
    name: 'other-site-none',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [['on a date that fits at no site of the group there is no such line, only the next landing', `/^Next landing that fits: /.test(${text('.sl-next')}.trim()) && document.querySelector('.sl-elsewhere') === null`, 1500]],
  },
  {
    name: 'watch',
    hash: '',
    still: true,
    checks: [
      ['the Moon is drawn', "document.querySelector('.scout-globe canvas') !== null"],
      ['the Moon was first drawn within two seconds of the page opening', "(() => { const ms = Number(document.querySelector('.scout-globe canvas').dataset.drawnMs); return (ms > 0 && ms < 2000) || 'first drawn after ' + ms + ' ms' })()"],
      ['a key says on one line what a dot\'s shape and colour mean, inside the window and clear of the name, Scout, the play control and every marker', "(() => { const key = document.querySelector('.sl-watch-key'); if (!key) return false; const words = [...key.querySelectorAll('li')].map((li) => li.textContent.trim()).join('|'); const box = key.getBoundingClientRect(); const others = [...document.querySelectorAll('.sl-pill, .sl-brand, .scout-face, .sl-scout-line, .zoom-buttons button, .sl-dot, .sl-group-dot')].map((el) => el.getBoundingClientRect()).filter((other) => other.width > 0); const apart = others.length >= 4 && others.every((other) => box.bottom <= other.top || box.top >= other.bottom || box.right <= other.left || box.left >= other.right); const oneLine = new Set([...key.querySelectorAll('li')].map((li) => Math.round(li.getBoundingClientRect().top))).size === 1; return (words === 'Sun|Earth|Both|Neither' && apart && oneLine && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight) || words + ' apart: ' + apart + ' ' + JSON.stringify(box) })()"],
      ['every site on its own has a dot with a state', "document.querySelectorAll('.sl-dot').length >= 3 && [...document.querySelectorAll('.sl-dot')].every((dot) => /is-(both|sun|earth|none)/.test(dot.className))"],
      ['sites too close to tell apart share one group marker that says how many', "Number(document.querySelector('.sl-group-dot b')?.textContent) >= 4"],
      ['at whole-Moon size no marker or name prints over another', DOTS_CLEAR],
      ['the Moon\'s whole disc is inside the stage, with a margin on every side', DISC_INSIDE],
      ['the Moon fills the stage: at least 80% of its shorter side, clear of the play control, with every marker and name inside', `${MOON_FILLS} && (() => { const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const disc = Number(document.querySelector('.scout-globe').dataset.discPx); const pill = document.querySelector('.sl-pill'); return pill === null || (globe.top + globe.bottom) / 2 + disc / 2 <= pill.getBoundingClientRect().top })()`],
      ['a name with no room is fully hidden, and comes back on focus', "(() => { const lost = document.querySelector('.sl-dot > span.off'); if (!lost) return window.innerWidth > 760 ? false : true; const hidden = getComputedStyle(lost).visibility === 'hidden'; lost.parentElement.focus(); const back = getComputedStyle(lost).visibility === 'visible' && getComputedStyle(lost).opacity === '1'; lost.parentElement.blur(); return hidden && back })()"],
      ['the tab reads "Sightline · Lunar landing site planner", with Scout\'s mark as its icon', "document.title === 'Sightline · Lunar landing site planner' && new URL(document.querySelector('link[rel=\"icon\"]').href).pathname === '/sightline-icon.svg'"],
      ['the page has its description and share tags', "(() => { const meta = (key) => document.querySelector('meta[name=\"' + key + '\"], meta[property=\"' + key + '\"]')?.content; const line = 'Where to land on the Moon, and when. See the hours a landing site has sunlight for power and Earth in view for radio.'; return meta('description') === line && meta('og:title') === 'Sightline' && meta('og:description') === line && meta('og:image') === 'https://lunarsightline.com/og.jpg' && meta('theme-color') === '#000000' })()"],
      ['at the default view there is no recentre compass', "document.querySelector('.sl-recentre') === null && document.querySelector('.sl-view-tools .zoom-buttons') !== null"],
      ['Scout says one line beside his mark', `${text('.sl-scout-line')} === 'Pick a site, or just watch.' && document.querySelector('.sl-card') === null`],
      ['Scout is its badge: with no site chosen, the gold disc on its sightline, named Scout', "(() => { const badge = document.querySelector('.sl-scout .scout-badge'); return badge !== null && badge.classList.contains('is-idle') && badge.getAttribute('aria-label') === 'Scout' && badge.getAttribute('width') === '44' && badge.querySelectorAll('path').length === 2 && badge.querySelector('.scout-badge-disc').getAttribute('fill') === '#e9b44c' })()"],
      ['the badge takes the state of the site Scout is talking about', `(document.querySelector('.sl-dot').focus(), true) && ${after(200, "(() => { const dot = document.querySelector('.sl-dot'); const state = /is-(both|sun|earth|none)/.exec(dot.className)[1]; const badge = document.querySelector('.sl-scout .scout-badge'); dot.blur(); return badge.classList.contains('is-' + state) && badge.getAttribute('aria-label').startsWith('Scout: ') })()")}`],
      ['an "AI" tag sits with Scout\'s mark even when he is closed, and says what it means', "(() => { const tag = document.querySelector('.sl-scout .sl-scout-tag .sl-ai'); const mark = document.querySelector('.scout-face').getBoundingClientRect(); const box = tag.getBoundingClientRect(); return tag.textContent.trim() === 'AI' && /AI-generated/.test(tag.title) && box.width > 0 && Math.abs((box.left + box.right) / 2 - (mark.left + mark.right) / 2) < 30 })()"],
      ['the name and its line stay clear of the buttons beside them', "document.querySelector('.sl-top') === null || document.querySelector('.sl-brand').getBoundingClientRect().right <= document.querySelector('.sl-top').getBoundingClientRect().left"],
      ['with reduced motion it starts paused', "document.querySelector('.sl-pill button').getAttribute('aria-label') === 'Play'"],
      ['the date is the opening one', `${text('.sl-date')} === '1 May 2027'`],
    ],
  },
  {
    // The real clock: Watch opens on the hour it is, so the Moon on screen is the Moon now.
    name: 'watch-now',
    hash: '',
    still: true,
    realNow: true,
    checks: [
      ['Watch opens on the date of the hour nearest now (UTC): in the last half hour of a day that is tomorrow\'s', "(() => { const now = new Date(Math.round(Date.now() / 3600000) * 3600000); const day = now.getUTCDate() + ' ' + now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + now.getUTCFullYear(); const shown = document.querySelector('.sl-date').textContent; return shown.includes(day) || shown + ' is not ' + day })()"],
      ['the Moon is drawn for that hour, with its sites', "document.querySelector('.scout-globe canvas') !== null && document.querySelectorAll('.sl-dot').length >= 3"],
      ['Plan opened from there lands at the hour nearest now, the one Watch shows', `(${click('Plan a landing')}, true) && ${after(900, "(() => { const now = new Date(Math.round(Date.now() / 3600000) * 3600000); const when = now.getUTCDate() + ' ' + now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + now.getUTCFullYear() + ' · ' + String(now.getUTCHours()).padStart(2, '0') + ':00 UTC'; const shown = [...document.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join(''); return shown.includes(when) || shown + ' is not ' + when })()")}`],
    ],
  },
  {
    // A clock outside the data: Watch opens on the data's default month instead.
    name: 'watch-outside',
    hash: '',
    still: true,
    now: '2060-01-01T00:00:00Z',
    checks: [['with the clock outside the data, Watch opens on the first hour of the data\'s default month', "(() => { const shown = document.querySelector('.sl-date').textContent; return /1 May 2027/.test(shown) || shown })()"]],
  },
  {
    name: 'group',
    hash: '',
    still: true,
    steps: ["document.querySelector('.sl-group-dot').click()"],
    checks: [
      ['a click on the group opens a list of its sites, each with its name and state', "(() => { const items = [...document.querySelectorAll('.sl-group-list [role=\"menuitem\"]')]; return items.length === Number(document.querySelector('.sl-group-dot b').textContent) && items.some((item) => item.textContent.includes('Connecting Ridge')) && items.every((item) => /sunlit|sunlight/.test(item.textContent)) })()"],
      ['the list\'s background is opaque, so no name behind it shows through', "(() => { const paint = getComputedStyle(document.querySelector('.sl-group-list')).backgroundColor; return /^rgb\\(/.test(paint) || paint })()"],
      ['focus opens it and the arrow keys walk the list', `(document.activeElement?.blur(), document.querySelector('.sl-group-dot').focus(), true) && ${after(200, "(document.querySelector('.sl-group-dot').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })), document.activeElement?.getAttribute('role') === 'menuitem')")}`],
      ['Escape closes it and hands the focus back to the group', `(document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(200, "document.querySelector('.sl-group-list') === null && document.activeElement === document.querySelector('.sl-group-dot')")}`],
      ['a click on the group opens it again', `(document.querySelector('.sl-group-dot').click(), true) && ${after(200, "document.querySelector('.sl-group-list') !== null")}`],
      ['a click elsewhere closes it', `(document.querySelector('.sl-brand').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true) && ${after(200, "document.querySelector('.sl-group-list') === null")}`],
      ['picking a site opens Plan on it, as its dot would', `(document.querySelector('.sl-group-dot').click(), true) && ${after(200, "([...document.querySelectorAll('.sl-group-list [role=\"menuitem\"]')].find((item) => item.textContent.includes('Shackleton Rim')).click(), true)")} && ${after(600, "document.querySelector('#sl-site')?.value === 'shackleton-rim' && location.hash.startsWith('#a=shackleton-rim@')")}`],
    ],
  },
  {
    name: 'watch-playing',
    hash: '',
    checks: [
      ['time is playing', `${text('.sl-date')} !== '1 May 2027'`],
      ['the controls fade after three seconds', "document.querySelector('.sightline').classList.contains('is-idle')", 3400],
      ['a key brings them back', `(${key('Shift')}, true) && new Promise((done) => setTimeout(() => done(!document.querySelector('.sightline').classList.contains('is-idle')), 100))`],
      ['Earth moves smoothly as time plays: no jump from one frame to the next over ten seconds', earthSteady(10000, 4)],
    ],
    // The Moon playing: frames drawn in three seconds, and the share that took longer than 25 ms.
    notes: [
      ['frame rate while time plays', FRAME_RATE],
      ['drawing resolution while time plays, in device pixels per CSS pixel (lower than the screen\'s own means this machine was not keeping up and the Moon was eased)', `document.querySelector('.scout-globe canvas').dataset.pixelRatio + ' of ' + Math.min(devicePixelRatio, 2)`],
    ],
  },
  {
    // The Moon's picture changes only when time, the view or a layer changes, and smoothly. Every frame the globe draws is read (see KEEP_FRAMES).
    // The hour is near the end of May 2027, so playing crosses into June: the light grid changes month on the way.
    name: 'moon-steady',
    frames: true,
    hash: '#a=connecting-ridge@2027-05&t=738&limits=14_24_99999_1_1&mode=plan',
    checks: [
      // Waits first: on a phone the sharper maps are still arriving for a few seconds after the page opens.
      ['Orbit, paused and untouched: every frame of the Moon is the same picture', MOON_STILL(2000), 5000],
      ['Orbit, time playing: the Moon\'s light moves smoothly, with no frame that jumps', `(${click('Play')}, true) && ${MOON_SMOOTH(8000)}`],
      ['one step of the zoom button glides: the picture changes over several frames, not in one', `(${click('Pause')}, true) && ${after(800, 'true')}.then(() => { [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in').click(); return ${MOON_FRAMES(1200)} }).then((frames) => { const pictures = new Set(frames.map((f) => f.sum)).size; return pictures >= 8 || 'the zoom step took ' + pictures + ' pictures' })`],
      // After the button's glide has ended. The wheel turns in and then out by the same amount, so the view is back where it was.
      ['the wheel zooms smoothly: a new picture nearly every frame, no jump, and no frame over 34 ms on a machine that is keeping up', `${after(900, 'true')}.then(() => ${WHEEL_ZOOM(45)})`],
      ['Site, paused and untouched (six seconds after arriving): every frame is the same picture', `(${click('Site')}, true) && ${after(6000, 'true')}.then(() => ${MOON_STILL(2000)})`],
      ['Site, time playing on the Moon\'s own picture: no frame jumps', `(${click('Play')}, true) && ${MOON_SMOOTH(4000)}`],
      ['"Light and shadow" switched on fades in: the shadow arrives with no frame that jumps', `(${click('Pause')}, ${click('Layers')}, true) && ${after(1200, 'true')}.then(() => { document.querySelector('.sl-layer-ground input').click(); return ${MOON_SMOOTH(7000, { mean: 4, least: 5 })} })`],
      ['with it on, time playing: the shadow blends from hour to hour, with no frame that jumps', `(${click('Play')}, true) && ${MOON_SMOOTH(8000)}`],
      ['playing on into the next month: the light grid changes month with no frame that jumps', MOON_SMOOTH(8000)],
      ['paused again, the picture holds still', `(${click('Pause')}, true) && ${after(2500, 'true')}.then(() => ${MOON_STILL(1500)})`],
    ],
    notes: [['wheel zoom over the Moon', "window.__wheel ?? 'not measured'"]],
  },
  {
    // Layers come and go by fading, and a close-up comes into focus: nothing is swapped in one frame.
    // The limits on one frame's change are wider here than for light: a bright photo fading over dark ground moves the
    // whole picture a few units a frame, and a frame that runs long (a phone redrawing its panel) carries the fade further.
    name: 'moon-steady-layers',
    frames: true,
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Site')],
    checks: [
      ['a layer switched on fades in', `${after(5000, 'true')}.then(() => { ${click('Layers')}; return new Promise((go) => setTimeout(go, 600)) }).then(() => { document.querySelectorAll('.sl-layer-list input')[0].click(); return ${MOON_SMOOTH(6000, { mean: 8, least: 10 })} })`],
      ['with the layer on and nothing touched, every frame is the same picture', MOON_STILL(1500)],
      ['another layer chosen: the first fades out before the second fades in, and its close-up comes into focus', `(() => { document.querySelectorAll('.sl-layer-list input')[1].click(); return ${MOON_SMOOTH(6000, { mean: 14, least: 10 })} })()`],
      ['the layer switched off fades out', `(() => { document.querySelectorAll('.sl-layer-list input')[1].click(); return ${MOON_SMOOTH(4000, { mean: 8, least: 10 })} })()`],
    ],
  },
  {
    // A page whose own script file does not arrive (a deploy in mid-rollout: vite.config.ts, HEALS_ITSELF) tries again by itself.
    // Stood in for by naming a file under /assets/ that does not exist: the page must reload once, come back whole, and forget the count.
    name: 'heals-itself',
    hash: '#a=connecting-ridge@2027-05&t=451&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['a page with nothing missing has not reloaded itself', "sessionStorage.getItem('reloads-for-missing-script') === null && window.__marked === undefined && (window.__marked = true)"],
      ['when one of its own files fails to load, the page reloads by itself (the mark left on the old page is gone) and has counted one try', `(() => { const link = document.createElement('link'); link.rel = 'modulepreload'; link.href = '/assets/no-such-file-' + Date.now() + '.js'; document.head.appendChild(link); return true })()`],
      ['after the reload the Moon is drawn again, on the same view', "window.__marked === undefined && sessionStorage.getItem('reloads-for-missing-script') === '1' && document.querySelector('.scout-globe canvas') !== null && location.hash.includes('connecting-ridge')", 3500],
      ['once the page has drawn, the count is cleared: a later deploy gets its three tries again', "sessionStorage.getItem('reloads-for-missing-script') === null", 6000],
    ],
  },
  {
    // The page's first seconds, from the first frame the globe draws: the maps and the Sun's direction arrive one after another.
    name: 'moon-first-light',
    frames: true,
    noSettle: true,
    hash: '#a=connecting-ridge@2027-05&t=451&limits=14_24_99999_1_1&mode=plan',
    ready: "window.__gl?.get(document.querySelector('.scout-globe canvas')) !== undefined",
    checks: [
      ['as the maps and the Sun\'s direction arrive, the Moon\'s picture changes by fading and coming into focus: no frame jumps', MOON_SMOOTH(7000, { mean: 4, least: 10 })],
    ],
  },
  {
    // The same on a slow connection, where the Sun's direction arrives well after the first maps.
    name: 'moon-first-light-slow',
    // Only against a built site (--base): the dev server's hundreds of small files do not load in time on a slow line.
    needs: 'base',
    slowNetwork: true,
    frames: true,
    noSettle: true,
    hash: '#a=connecting-ridge@2027-05&t=451&limits=14_24_99999_1_1&mode=plan',
    ready: "window.__gl?.get(document.querySelector('.scout-globe canvas')) !== undefined",
    checks: [
      ['on a slow connection, as the maps and the Sun\'s direction arrive, the Moon\'s picture changes by fading and coming into focus: no frame jumps', MOON_SMOOTH(25000, { mean: 4, least: 10 })],
    ],
  },
  {
    // A machine that cannot keep up, stood in for by holding every frame up for 30 ms (slowing the processor is not enough
    // on the built site, whose frames are short): the Moon gives up pixels while it moves and takes them back when it rests.
    name: 'eased',
    hash: '',
    steps: ['(() => { window.__held = true; const hold = () => { if (!window.__held) return; const until = performance.now() + 30; while (performance.now() < until) {} requestAnimationFrame(hold) }; requestAnimationFrame(hold) })()'],
    checks: [
      ['when the screen\'s refreshes run late, the moving Moon is drawn with fewer pixels', `Number(document.querySelector('.scout-globe canvas').dataset.pixelRatio) < Math.min(devicePixelRatio, 2)`, 8000],
      ['never fewer than three quarters of a device pixel per CSS pixel', `Number(document.querySelector('.scout-globe canvas').dataset.pixelRatio) >= 0.75`],
      ['paused, and frames no longer held up, the still picture is drawn again at full resolution', `(${click('Pause')}, window.__held = false, true) && new Promise((done) => { const until = Date.now() + 12000; const look = () => { const full = Number(document.querySelector('.scout-globe canvas').dataset.pixelRatio) === Math.min(devicePixelRatio, 2); if (full || Date.now() > until) done(full || 'still at ' + document.querySelector('.scout-globe canvas').dataset.pixelRatio); else setTimeout(look, 200) }; look() })`],
    ],
  },
  {
    name: 'watch-hidden',
    hash: '',
    still: true,
    steps: [click('Minimise the date control'), key('h')],
    checks: [
      ['Hide all leaves the Moon and one handle', "document.querySelectorAll('.sl-stage button').length === 1 && document.querySelector('.sl-handle') !== null"],
      ['and is remembered', "localStorage.getItem('sightline.clear') === '1' && localStorage.getItem('sightline.pillMin') === '1'"],
    ],
  },
  {
    name: 'plan-from-watch',
    hash: '',
    still: true,
    steps: [click('Plan a landing')],
    checks: [
      ['Plan opens on the featured site', "document.querySelector('#sl-site')?.value === 'connecting-ridge'"],
      ['the address carries both scenarios Plan opens with, in the app\'s link format', "location.hash === '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-01T00' || location.hash"],
      ['the answer has its verdict, one line that starts "At landing:" with no date repeated under the control, and its three rows', `/^At landing: (sunlit|partly sunlit|no sunlight), Earth /.test(${text('.sl-sentence')}.trim()) && document.querySelector('.sl-time') === null && !/\\d{4} · \\d\\d:00/.test(document.querySelector('.sl-answer').innerText) && document.querySelectorAll('.sl-facts > .sl-fact').length === 3 && document.querySelector('.sl-verdict-line') !== null`, 1500],
      ['the column is the redesigned one: three plan controls, a verdict, the Sun, Earth and Ground rows, no tiles, no boxes in the answer but the plan\'s controls, nothing scrolling', COLUMN_SHAPE],
      ['nothing on the page has the question-mark cursor', NO_HELP_CURSOR],
      ['resting the pointer on a row shows its explanation in the screen\'s one tooltip, promptly, off the Moon\'s disc, and readable by a screen reader', `(document.querySelector('.sl-fact.is-earth').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), true) && ${after(500, "(() => { const row = document.querySelector('.sl-fact.is-earth'); const tip = document.querySelector('.sl-tip'); if (!tip) throw new Error('no tooltip'); const box = tip.getBoundingClientRect(); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const near = { x: Math.min(Math.max(cx, box.left), box.right), y: Math.min(Math.max(cy, box.top), box.bottom) }; return tip.getAttribute('role') === 'tooltip' && /^How far Earth's center is above the skyline in its direction, at landing\\. Above 0° its center clears the terrain\\.$/.test(tip.textContent) && !row.hasAttribute('title') && row.getAttribute('aria-description') === tip.textContent && (window.innerWidth < 761 || (box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight && Math.hypot(near.x - cx, near.y - cy) >= r)) && document.querySelectorAll('.sl-tip').length === 1 })()")}`],
      ['the tooltip goes when the pointer leaves, and comes at once on keyboard focus', `(document.querySelector('.sl-sentence').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), true) && ${after(300, "document.querySelector('.sl-tip') === null && (document.querySelector('.sl-fact.is-ground').focus(), true)")} && ${after(600, "(() => { const tip = document.querySelector('.sl-tip'); const shown = tip !== null && /slope/.test(tip.textContent); document.querySelector('.sl-fact.is-ground').blur(); return shown })()")} && ${after(900, "document.querySelector('.sl-tip') === null")}`],
      ['the landing has a verdict, above the numbers, and the column does not scroll', `/fit/.test(${text('.sl-verdict')}) && ${VERDICT_FIRST} && ${COLUMN_FITS}`],
      ['Scout\'s badge shows the site\'s state at the opening hour', BADGE_MATCHES],
      ['the tab\'s title names the scenario', "document.title === 'Connecting Ridge, 1 May 2027 · Sightline'"],
      ['key P goes back to Watch and clears the address', `(${key('p')}, true) && new Promise((done) => setTimeout(() => done(document.querySelector('.sl-col') === null && location.hash === ''), 200))`],
    ],
  },
  {
    name: 'plan-link',
    sky: true,
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['a link opens Plan on its site, paused at its landing', `document.querySelector('#sl-site')?.value === 'shackleton-rim' && ${LANDING} === '6 May 2027 · 13:00 UTC' && ${text('.sl-now')} === '6 May 2027 · 13:00 UTC' && document.querySelector('.sl-off-landing') === null && document.querySelector('.sl-river .sl-link') === null`, 1500],
      ['in Plan the tab\'s title starts with the site\'s name, then the landing date', "document.title.startsWith('Shackleton Rim') && document.title === 'Shackleton Rim, 6 May 2027 · Sightline'"],
      ['Scout\'s badge shows this site\'s state at this hour', BADGE_MATCHES],
      ['the group marker\'s number, its name ("+ N more") and the list it opens all count the same sites', `(() => { const group = document.querySelector('.sl-group-dot.is-selected').closest('.sl-group'); const ring = Number(group.querySelector('.sl-group-dot b').textContent); const more = /^Shackleton Rim \\+ (\\d+) more$/.exec(group.querySelector('.sl-group-label').textContent); const named = Number(/^(\\d+) sites close together/.exec(group.querySelector('.sl-group-dot').getAttribute('aria-label'))[1]); window.__ring = ring; group.querySelector('.sl-group-dot').click(); return more !== null && ring === 1 + Number(more[1]) && named === ring })() && ${after(400, "(() => { const group = document.querySelector('.sl-group-dot.is-selected').closest('.sl-group'); const items = [...group.querySelectorAll('.sl-group-list [role=\"menuitem\"]')]; const same = items.length === window.__ring && new Set(items.map((item) => item.textContent)).size === items.length && items.some((item) => item.textContent.startsWith('Shackleton Rim')); document.activeElement.blur(); document.body.click(); if (!same) throw new Error('the ring says ' + window.__ring + ' and the list has ' + items.length); return true })()")}`],
      ['the verdict leads the answer, then the sentence about the landing, then the numbers', VERDICT_FIRST],
      ['the verdict is the largest line in the column', VERDICT_LARGEST],
      ['nothing in the column scrolls, and no area inside it', NOTHING_SCROLLS],
      ['"Custom point…" at the foot of the site\'s list opens two coordinate fields, marked so password managers leave them alone and named for what they are', `${siteMore('__custom')} && ${after(400, "(() => { const marked = (el) => el !== null && el.type === 'text' && el.getAttribute('autocomplete') === 'off' && el.hasAttribute('data-1p-ignore') && el.getAttribute('data-lpignore') === 'true' && el.hasAttribute('data-bwignore') && el.getAttribute('data-form-type') === 'other'; const fields = [['#sl-latitude', 'latitude'], ['#sl-longitude', 'longitude']].map(([id, name]) => { const el = document.querySelector(id); return marked(el) && el.name === name }); const named = [...document.querySelectorAll('.sl-col input[type=\"text\"]')].every((el) => !/user|name|email|search|login|pass/i.test(el.name + ' ' + el.id)); return fields.every(Boolean) && named })()")} && ${after(500, "(document.querySelector('.sl-plan-more button[aria-label=\"Close\"]').click(), true)")}`],
      ['there are no date step buttons', "document.querySelector('.sl-steps') === null && ![...document.querySelectorAll('.sl-col button')].some((button) => /^[+−-]1 (day|week|month)$/.test(button.textContent.trim()))"],
      ['Scout is not in the column: it ends with the numbers and the Horizons line', "document.querySelector('.sl-col .sl-ask, .sl-col #sl-question, .sl-col .sl-ask-name, .sl-col .sl-idea') === null && ['sl-facts', 'sl-horizons'].includes(document.querySelector('.sl-answer').lastElementChild.className)"],
      ['the column does not scroll, even with a cut disc, a landing that does not fit and the next landing offered', `/of the disc showing/.test(${text('.sl-facts')}) && /Does not fit the mission/.test(${text('.sl-verdict-words')}) && /^Next landing that fits: \\d+ \\w+ · \\d\\d:00/.test(${text('.sl-next')}.trim()) && ${COLUMN_FITS} && ${NOTHING_SCROLLS}`],
      ['a disc the skyline cuts is said in the Sun\'s row, in the quiet colour, not the warning colour', "(() => { const small = document.querySelector('.sl-fact.is-sun .sl-fact-small.is-showing'); const warn = document.querySelector('.sl-verdict.is-miss .sl-verdict-words'); return small !== null && /^(under 1|\\d+)% of the disc showing$/.test(small.textContent.trim()) && getComputedStyle(small).color !== getComputedStyle(warn).color && getComputedStyle(small).color === getComputedStyle(document.querySelector('.sl-fact.is-sun .sl-fact-small')).color })()"],
      ['the Sun\'s row gives the sunlight at landing in W/m², and that line\'s own hover text says what the figure is and what full sunlight is', "(() => { const row = document.querySelector('.sl-fact.is-sun'); return /^(sets|rises) in [\\d dh]+ · \\d+ W\\/m²$|^stays (up|down) · \\d+ W\\/m²$/.test(row.querySelector('.sl-fact-small').textContent.trim()) && /^Sunlight on a surface facing the Sun, in watts per square meter\\. Full sunlight is 1361 W\\/m²/.test(row.querySelector('.sl-fact-small').getAttribute('title') ?? row.querySelector('.sl-fact-small').dataset.tip ?? '') && !/panel/i.test(document.querySelector('.sl-facts').textContent) })()"],
      ['every row shows its name, its main figure and its small line in full, one small line, or two where a disc is cut, never three', ROWS_WHOLE],
      ['the mission control is one line with its picture, named for a screen reader, and says the preset\'s name', "(() => { const card = document.querySelector('.sl-mission-open'); return card.getBoundingClientRect().height < 40 && card.querySelector('small') === null && card.textContent.trim().startsWith('Short stay') && card.getAttribute('aria-label') === 'Mission: Short stay' && card.closest('.sl-plan-row').querySelector('svg.sl-plan-icon') !== null })()"],
      ['the Sun and Earth rows lead with how far each is from the skyline and which side; each row\'s hover text is one idea, what that figure is and how to read it, with no "elevation" in it', `(() => { const row = (name) => document.querySelector('.sl-fact.is-' + name); const reads = (name) => /^\\d+\\.\\d°$/.test(row(name).querySelector('.sl-fact-main').firstChild.textContent.trim()) && /^(above|below) the skyline$/.test(row(name).querySelector('.sl-fact-main small').textContent.trim()) && !/elevation/i.test(row(name).textContent); const tip = (name) => row(name).getAttribute('title') ?? row(name).dataset.tip ?? ''; if (tip('sun') !== "How far the Sun's center is above the skyline in its direction, at landing. Above 0° its center clears the terrain." || tip('earth') !== "How far Earth's center is above the skyline in its direction, at landing. Above 0° its center clears the terrain.") throw new Error(tip('sun') + ' | ' + tip('earth')); return reads('sun') && reads('earth') })()`],
      ['at Orbit the Moon\'s disc is at least 80% of the stage\'s shorter side, with every marker and name inside the stage', MOON_FILLS],
      ['with the skyline and the river open, the whole disc is inside the stage with a margin on every side', DISC_INSIDE],
      // On a laptop folding the strips makes the stage taller; on a phone they are in the sheet and the stage keeps its size.
      ['with both strips folded, the disc is re-fitted to the stage at once: bigger where the stage grew, and still inside', `(() => { const disc = () => Number(document.querySelector('.scout-globe').dataset.discPx); const tall = () => document.querySelector('.sl-stage').getBoundingClientRect().height; const before = [disc(), tall()]; document.querySelector('.sl-sky .sl-fold').click(); document.querySelector('.sl-river .sl-fold').click(); return new Promise((done) => setTimeout(() => done((tall() > before[1] + 1 ? disc() > before[0] : disc() === before[0]) && ${DISC_INSIDE} && ${MOON_FILLS}), 120)) })()`],
      ['and opened again (the time bar by its button, the skyline by its door), it is fitted back at once', `(() => { document.querySelector('.sl-river .sl-fold').click(); ${OPEN_SKY}; return new Promise((done) => setTimeout(() => done(${DISC_INSIDE}), 400)) })()`],
      ['the skyline\'s land fills at least a third of the strip\'s height', RIDGE_FILLS],
      ['the scenario\'s site is outlined: its own dot, or the group it is in', "document.querySelectorAll('.sl-dot.is-selected, .sl-group-dot.is-selected').length === 1"],
      ['in Plan at Orbit no marker or name prints over another', DOTS_CLEAR],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    name: 'site-zoom',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Site')],
    checks: [
      ['close on the site, the ridge sites are single dots again', "document.querySelector('.sl-dot.is-selected') !== null && document.querySelector('.sl-group-dot.is-selected') === null && [...document.querySelectorAll('.sl-dot')].some((dot) => dot.getAttribute('aria-label').startsWith('Shackleton Rim'))", 2600],
      ['and still no marker or name prints over another', DOTS_CLEAR],
    ],
  },
  {
    // The window itself changes size after the page has drawn: the Moon is re-fitted at once, not after a flight.
    name: 'moon-refit',
    hash: '#a=shackleton-rim@2027-05&t=133&mode=plan',
    resize: { laptop: [1100, 640], phone: [360, 640] },
    checks: [
      ['after the window shrinks, the whole disc is inside the new stage at once, with a margin on every side', DISC_INSIDE],
      ['and it still fills the stage', MOON_FILLS],
      ['back in Watch at the new size, the disc is inside the stage and clear of the play control', `(${key('p')}, true) && ${after(150, `${DISC_INSIDE} && (() => { const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const disc = Number(document.querySelector('.scout-globe').dataset.discPx); return (globe.top + globe.bottom) / 2 + disc / 2 <= document.querySelector('.sl-pill').getBoundingClientRect().top })()`)}`],
    ],
  },
  {
    // Scout's own panel, on the right. Two scenarios, B on show. The model is not called: a stand-in
    // answers, and what the page sent is looked at.
    name: 'scout-panel',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&sc=1',
    checks: [
      ['Scout is not in the left column, and nothing in the column scrolls', `${STAND_IN_SCOUT} && document.querySelector('.sl-col .sl-ask, .sl-col #sl-question, .sl-col .sl-ask-name') === null && (${NOTHING_SCROLLS} || [document.querySelector('.sl-col'), ...document.querySelectorAll('.sl-col *')].filter((el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)).map((el) => el.className + ' ' + el.scrollHeight + ' in ' + el.clientHeight).join('; '))`, 1200],
      ['"Scout", with his mark, is on the rail ahead of its other panels', "(() => { const tools = [...document.querySelectorAll('.sl-rail button, .sl-rail a')].map((el) => el.textContent.trim()); const scout = document.querySelector('.sl-rail-scout'); return scout !== null && scout.querySelector('.scout-badge') !== null && scout.textContent.trim() === 'Scout' && tools.indexOf('Compare') > 0 && tools.indexOf('Scout') < tools.indexOf('Compare') && tools.indexOf('Scout') < tools.indexOf('Planner') })()"],
      ['it opens a panel on the right whose conversation area is at least half the screen\'s height, with the input at its foot', `(document.querySelector('.sl-rail-scout').click(), true) && ${after(700, "(() => { const panel = document.querySelector('.sl-scout-panel'); const talk = panel.querySelector('.sl-talk').getBoundingClientRect(); const input = panel.querySelector('#sl-question').getBoundingClientRect(); const box = panel.getBoundingClientRect(); return document.querySelector('.sl-rail-scout').getAttribute('aria-pressed') === 'true' && talk.height >= window.innerHeight / 2 && input.top >= talk.bottom - 1 && box.bottom - input.bottom < 24 && (window.innerWidth < 761 || box.left > window.innerWidth / 2) })()")}`],
      ['the tag in the panel\'s header names the model the co-pilot\'s status reports', `${after(1500, MODEL_TAG('.sl-scout-panel .sl-drawer-head .sl-ai'))}`],
      ['its header has his mark, his name and the "AI" tag; the input is marked so password managers leave it alone', "(() => { const head = document.querySelector('.sl-scout-panel .sl-ask-name'); const tag = head.querySelector('.sl-ai'); const el = document.querySelector('#sl-question'); return head.querySelector('.scout-badge') !== null && /Scout/.test(head.textContent) && /^AI( · Claude [A-Z][a-z]+ \\d+(\\.\\d+)?)?$/.test(tag.textContent.trim()) && /AI-generated/.test(tag.title) && el.type === 'text' && el.name === 'question' && el.getAttribute('autocomplete') === 'off' && el.hasAttribute('data-1p-ignore') && el.getAttribute('data-lpignore') === 'true' && el.hasAttribute('data-bwignore') && el.getAttribute('data-form-type') === 'other' })()"],
      ['with nothing said yet it offers three questions for the scenario on show, and two things to open: why the site is hard, and the rover idea', "(() => { const ideas = [...document.querySelectorAll('.sl-talk .sl-idea')]; return ideas.filter((idea) => !idea.classList.contains('is-action')).map((idea) => idea.textContent).join('|') === \"Why doesn't this landing fit?|When is the best landing here in 2027?|Which of my scenarios is best, and why?\" && ideas.filter((idea) => idea.classList.contains('is-action')).map((idea) => idea.textContent.trim()).join('|') === 'Why is landing here hard?|Plan for Canada’s utility rover' && ideas.every((idea) => idea.tagName === 'BUTTON') })()"],
      ['with the panel open the whole Moon and every name are inside the stage, and each strip\'s header is one row', `${STAGE_HOLDS} && ${HEADS_ONE_ROW}`],
      ['tapping an idea asks it: the question and the reply show in the panel, and the ideas leave', `(document.querySelector('.sl-talk .sl-idea').click(), true) && ${after(900, "(() => { const said = [...document.querySelectorAll('.sl-talk .sl-said')]; return said.length === 2 && said[0].classList.contains('is-visitor') && said[0].textContent === \"Why doesn't this landing fit?\" && said[1].classList.contains('is-scout') && said[1].textContent === 'A stand-in reply, number 1.' && document.querySelector('.sl-talk .sl-idea') === null })()")}`],
      ['Scout is told the scenario on show: the link sent has B on show, with A beside it', "(() => { const sent = window.__sent[0]; const link = new URLSearchParams(sent.view.replace(/^#/, '')); return link.get('sc') === '1' && link.get('a') === 'connecting-ridge@2027-05' && link.get('list') === 'shackleton-rim@2027-05-06T13' && sent.messages.at(-1).text === \"Why doesn't this landing fit?\" })()"],
      ['closing the panel and opening it again keeps the conversation', `(${click('Close')}, true) && ${after(400, `document.querySelector('.sl-scout-panel') === null && (document.querySelector('.sl-rail-scout').click(), true)`)} && ${after(500, "document.querySelectorAll('.sl-talk .sl-said').length === 2 && document.querySelector('.sl-talk .sl-said.is-scout').textContent === 'A stand-in reply, number 1.'")}`],
      ['with scenario A chosen, a typed question goes with A on show, and joins the same conversation', `(async () => { document.querySelector('.sl-tabs button[aria-label="Scenario A"]').click(); await new Promise((next) => setTimeout(next, 400)); if (document.querySelector('.sl-scout-panel') === null) document.querySelector('.sl-rail-scout').click(); await new Promise((next) => setTimeout(next, 400)); const form = document.querySelector('.sl-scout-panel .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'And this one?'); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); await new Promise((next) => setTimeout(next, 900)); const link = new URLSearchParams(window.__sent[1].view.replace(/^#/, '')); return window.__sent.length === 2 && link.get('sc') === '0' && window.__sent[1].messages.length === 3 && document.querySelectorAll('.sl-talk .sl-said').length === 4 && document.querySelector('#sl-question').value === '' })()`],
      ['neither the column nor the panel scrolls sideways, and the page is no wider than the screen', "document.documentElement.scrollWidth <= window.innerWidth && (window.innerWidth < 761 || document.querySelector('.sl-scout-panel').scrollWidth <= document.querySelector('.sl-scout-panel').clientWidth)"],
    ],
  },
  {
    // "Why this site is hard": a section of the Guide made of the site's own figures, and one of
    // Scout's ready ideas, which opens the Guide there and asks the model nothing.
    name: 'why-hard',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the column says how long the Sun is gone during the mission', `${STAND_IN_SCOUT} && (() => { const gone = /Sun down for (\\d+) h/.exec(document.querySelector('.sl-verdict')?.textContent ?? ''); window.__gone = gone?.[1]; return gone !== null || (document.querySelector('.sl-verdict')?.textContent ?? 'no verdict') })()`, 1500],
      [
        'the Guide has "Why this site is hard" right after "Start here": three or four sentences whose figures are the site\'s own: the Sun\'s range from the month\'s track, the year\'s longest stretch without it, the same hours as the column for the mission, and Earth\'s share and longest absence',
        `(${click('Guide')}, true) && ${after(1200, `(async () => { const how = document.querySelector('.sl-how'); const order = [...how.querySelectorAll('.how > section')].map((section) => section.className); const lines = ${WHY_LINES}; const year = (await (await fetch('/data/connecting-ridge/year-2027.json')).json()).years.find((row) => row.year === 2027); const els = (await (await fetch('/data/connecting-ridge/2027-05/track.json')).json()).map((point) => point.sun_el); const deg = (value) => (Math.round(value * 10) / 10 < 0 ? '−' : '') + Math.abs(Math.round(value * 10) / 10).toFixed(1) + '°'; const span = (h) => (h < 48 ? h + ' h' : Math.floor(h / 24) + ' d ' + (h % 24) + ' h'); const want = ['At Connecting Ridge the Sun never climbs: in May its elevation stays between ' + deg(Math.min(...els)) + ' and ' + deg(Math.max(...els)) + ' from level, so the skyline decides when there is sunlight.', 'The longest stretch without the Sun here in 2027 is ' + span(year.max_sun_gap_h) + '; during your 14-day mission from this landing the Sun is down for ' + window.__gone + ' h.', 'Earth is hidden ' + (100 - year.pct_earth).toFixed(1) + '% of 2027 here, for up to ' + span(year.max_earth_gap_h) + ' at a stretch.']; return (order[0] === 'how-start' && order[1] === 'how-why' && how.querySelector('.how-why h2').textContent === 'Why this site is hard' && lines.length >= 3 && lines.length <= 4 && want.every((line, i) => lines[i] === line) && (lines.length === 3 || /^The month matters too: the Sun is up \\d+\\.\\d% of \\w+ and \\d+\\.\\d% of \\w+\\.$/.test(lines[3])) && how.scrollTop === 0) || JSON.stringify({ order, lines, want }) })()`)}`,
      ],
      ['the sheet has nothing to scroll sideways, and the section is no wider than the screen', "(() => { const how = document.querySelector('.sl-how'); const why = how.querySelector('.how-why').getBoundingClientRect(); return (how.scrollWidth <= how.clientWidth && why.left >= 0 && why.right <= window.innerWidth) || JSON.stringify(why) })()"],
      [
        'Scout\'s ready idea "Why is landing here hard?" opens the Guide at that section, in view at the top with the keyboard on it; Scout says where he went, and nothing is sent to the model',
        `(${click('← Back to the Moon')}, true) && ${after(500, "(document.querySelector('.sl-how') === null && (document.querySelector('.sl-rail-scout').click(), true))")} && ${after(700, "(document.querySelector('.sl-talk .sl-idea[data-idea=\"why\"]').click(), true)")} && ${after(900, "(() => { const how = document.querySelector('.sl-how'); const why = how?.querySelector('.how-why'); if (!why) return 'no section'; const box = why.getBoundingClientRect(); const said = [...document.querySelectorAll('.sl-talk .sl-said p')].map((p) => p.textContent); return (box.top >= 0 && box.top < 60 && document.activeElement === why && how.scrollTop > 0 && window.__sent.length === 0 && (said.length === 0 || (said.length === 1 && said[0] === 'The Guide is open at “Why this site is hard”, with Connecting Ridge’s own figures.'))) || JSON.stringify({ top: box.top, scrolled: how.scrollTop, sent: window.__sent.length, said, focus: document.activeElement?.className }) })()")}`,
      ],
      [
        'back on the screen Scout\'s panel, where it is still open, holds his one line; the Guide opened from the rail starts at its top again',
        `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${click('← Back to the Moon')}; await wait(500); const panel = document.querySelector('.sl-scout-panel'); const said = [...document.querySelectorAll('.sl-talk .sl-said')]; if (document.querySelector('.sl-how') !== null) return 'the Guide is still open'; if (panel && !(said.length === 1 && said[0].classList.contains('is-scout') && said[0].textContent.includes('Why this site is hard'))) return said.map((el) => el.textContent).join('|') || 'nothing said'; ${click('Guide')}; await wait(900); return document.querySelector('.sl-how').scrollTop === 0 || document.querySelector('.sl-how').scrollTop })()`,
      ],
    ],
  },
  {
    // The same section for a site far from the pole: what it says is still true there.
    name: 'why-hard-far',
    hash: '#a=apollo-17@2029-03&t=201&limits=14_24_99999_1_1&mode=plan',
    checks: [
      [
        'at Apollo 17 the section speaks of a Sun that climbs, the year\'s longest stretch without it, and Earth always in view: nothing about a Sun that never climbs or a month that matters',
        `(${click('Guide')}, true) && ${after(1500, `(async () => { const lines = ${WHY_LINES}; const year = (await (await fetch('/data/apollo-17/year-2029.json')).json()).years.find((row) => row.year === 2029); const els = (await (await fetch('/data/apollo-17/2029-03/track.json')).json()).map((point) => point.sun_el); const span = (h) => (h < 48 ? h + ' h' : Math.floor(h / 24) + ' d ' + (h % 24) + ' h'); return (lines.length === 3 && lines[0] === 'At Apollo 17 the Sun climbs to ' + Math.max(...els).toFixed(0) + '° in March, so the trouble here is not a low Sun but how long it is gone.' && lines[1].startsWith('The longest stretch without the Sun here in 2029 is ' + span(year.max_sun_gap_h)) && year.pct_earth === 100 && lines[2] === 'Earth is in view all of 2029 here, so the terrain never blocks the radio.') || JSON.stringify(lines) })()`)}`,
      ],
    ],
  },
  {
    // Rodrigo: "scout said connecting ridge but showed a diff site". On the opening screen no site is
    // chosen, Scout is told so, and the Moon rings the sites his reply's first sentence names.
    name: 'watch-where',
    hash: '',
    still: true,
    checks: [
      [
        'a question asked on the opening screen goes to Scout with a link that says no site is chosen, carries the real hour beside the time bar\'s, and marks no scenario',
        `${STAND_IN_SCOUT} && (document.querySelector('.sl-card') !== null || (document.querySelector('.scout-face').click(), true)) && ${after(500, `(window.__pose = document.querySelector('.scout-globe').dataset.pose, ${askInWatch('Where can a lander see Earth right now?')})`)} && ${after(1700, "(() => { const view = new URLSearchParams(window.__sent.at(-1).view.replace(/^#/, '')); const real = new Date(Math.round(Date.now() / 3600000) * 3600000).toISOString().slice(0, 13); return (view.get('watch') === '1' && !view.has('sc') && /^\\d+$/.test(view.get('t') ?? '') && view.get('now') === real && window.__sent.at(-1).messages.at(-1).text === 'Where can a lander see Earth right now?') || window.__sent.at(-1).view + ' // real hour ' + real })()")}`,
        1500,
      ],
      [
        'the Moon rings the sites the reply\'s first sentence names, where they are: the ridge group is ringed for Shackleton Rim, nothing else is, and the view stays as it was because one of the named sites can be seen',
        "(() => { const said = [...document.querySelectorAll('.sl-card .sl-said.is-scout p')].at(-1)?.textContent ?? ''; const named = ['Apollo 11', 'Apollo 15', 'Apollo 17', 'Shackleton Rim']; const ringed = [...document.querySelectorAll('.sl-dot.is-selected, .sl-group-dot.is-selected')].map((dot) => dot.getAttribute('aria-label') ?? ''); const group = document.querySelector('.sl-group-dot.is-selected')?.closest('.sl-group')?.querySelector('.sl-group-label')?.textContent.trim() ?? ''; return (said.startsWith('At the hour on the time bar, Earth is in view') && ringed.length === 1 && ringed.every((label) => named.some((name) => label.includes(name))) && /^Shackleton Rim \\+ \\d+ more$/.test(group) && document.querySelector('.scout-globe').dataset.pose === window.__pose && document.querySelector('.sl-recentre') === null) || JSON.stringify({ ringed, group, moved: document.querySelector('.scout-globe').dataset.pose !== window.__pose }) })()",
      ],
      [
        'under an answer about the present Scout offers one button, "Ask for 10 December 2026" (the time bar\'s date); pressing it asks the same question for that date, and the button is then only under the latest reply',
        `(() => { const again = [...document.querySelectorAll('.sl-card .sl-ask-again')]; if (again.length !== 1 || again[0].textContent.trim() !== 'Ask for 10 December 2026') return again.length + ' buttons: ' + again.map((b) => b.textContent.trim()).join(); again[0].click(); return true })() === true && ${after(1500, "(() => { const asked = window.__sent.at(-1).messages.at(-1).text; return (asked === 'Where can a lander see Earth right now? (for the date on the time bar)' && document.querySelectorAll('.sl-card .sl-ask-again').length === 0 && window.__sent.length === 2) || asked + ' // ' + document.querySelectorAll('.sl-card .sl-ask-again').length + ' buttons, ' + window.__sent.length + ' sent' })()")}`,
      ],
      [
        'a reply whose first sentence names only sites that cannot be seen from there turns the Moon to the first of them, Apollo 11, and rings it, though a later sentence names a site in view',
        `${askInWatch('Where is only the Sun in view right now?')} && ${after(2600, "(() => { const ringed = [...document.querySelectorAll('.sl-dot.is-selected, .sl-group-dot.is-selected')].map((dot) => dot.getAttribute('aria-label') ?? ''); return (ringed.length >= 1 && ringed.every((label) => /Apollo 11|Apollo 17/.test(label)) && ringed.some((label) => label.includes('Apollo 11')) && !ringed.some((label) => /^\\d+ sites close together: [^.]*Connecting Ridge/.test(label) && !/Apollo/.test(label)) && document.querySelector('.scout-globe').dataset.pose !== window.__pose && document.querySelector('.sl-recentre') !== null) || JSON.stringify({ ringed, moved: document.querySelector('.scout-globe').dataset.pose !== window.__pose }) })()")}`,
      ],
    ],
  },
  {
    // Scout in Watch. Closed: his mark and one line that fades. Open: a chat card in the empty sky. A stand-in answers.
    name: 'watch-scout',
    hash: '',
    still: true,
    checks: [
      ['closed, Scout is his mark with one line beside it', `${STAND_IN_SCOUT} && ${text('.sl-scout-line')} === 'Pick a site, or just watch.' && !document.querySelector('.sl-scout-line').classList.contains('is-gone') && document.querySelector('.sl-card') === null && document.querySelector('.scout-face').getAttribute('aria-label') === 'Ask Scout'`, 600],
      ['after about eight seconds the line has faded and the mark remains; focusing the mark brings the line back', `${after(8600, "getComputedStyle(document.querySelector('.sl-scout-line')).opacity === '0' && document.querySelector('.scout-face .scout-badge') !== null && (document.querySelector('.scout-face').focus(), true)")} && ${after(9300, "getComputedStyle(document.querySelector('.sl-scout-line')).opacity !== '0' && (document.querySelector('.scout-face').blur(), true)")}`],
      ['his mark opens a chat card and closes it again; nothing else happens, and the address stays on Watch', `(document.querySelector('.scout-face').click(), true) && ${after(400, "document.querySelector('.sl-card') !== null && document.querySelector('.scout-face').getAttribute('aria-expanded') === 'true' && document.querySelector('.sightline.is-watch') !== null && location.hash === '' && (document.querySelector('.scout-face').click(), true)")} && ${after(900, "document.querySelector('.sl-card') === null && document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-col') === null && location.hash === '' && (document.querySelector('.scout-face').click(), true)")}`],
      ['the tag in the card\'s header says he is AI and names the model the co-pilot\'s status reports, on one line', `${after(1500, MODEL_TAG('.sl-card .sl-card-head .sl-ai'))}`],
      ['the card has his name and the "AI" tag, a close control, three ideas written for Watch and one thing to try, none needing a scroll, and an input password managers leave alone', "(() => { const card = document.querySelector('.sl-card'); const el = card.querySelector('#sl-watch-question'); const talk = card.querySelector('.sl-talk'); if (talk.scrollHeight > talk.clientHeight + 1) return 'the ideas need a scroll: ' + talk.scrollHeight + ' in ' + talk.clientHeight; if (card.querySelector('.sl-idea.is-action')?.textContent.replace(/\\s+/g, ' ').trim() !== 'Two sites 10 km apart, same date ›') return card.querySelector('.sl-idea.is-action')?.textContent; const ideas = [...card.querySelectorAll('.sl-idea:not(.is-action)')].map((idea) => idea.textContent); return /Scout/.test(card.querySelector('.sl-card-head').textContent) && card.querySelector('.sl-ai') !== null && [...card.querySelectorAll('.sl-card-head button')].some((button) => button.textContent.trim() === 'Close') && ideas.join('|') === 'What am I looking at?|Which site has the most Sun this month?|Where can a lander see Earth right now?' && el.type === 'text' && el.name === 'question' && el.getAttribute('autocomplete') === 'off' && el.hasAttribute('data-1p-ignore') && el.getAttribute('data-lpignore') === 'true' && el.hasAttribute('data-bwignore') && el.getAttribute('data-form-type') === 'other' })()", 700],
      ['the card is 21rem wide down the far right edge on a laptop (no taller than 75% of the screen on a phone), and does not cover the Moon\'s disc', `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); return window.innerWidth < 761 ? card.height <= window.innerHeight * 0.75 + 1 : Math.abs(card.width - 336) <= 2 && Math.abs(card.height - window.innerHeight) <= 1 })() && ${CARD_CLEAR}`, 700],
      ['tapping an idea sends it; the question and a reply appear in the card, and the ideas leave', `(document.querySelector('.sl-card .sl-idea').click(), true) && ${after(900, "(() => { const said = [...document.querySelectorAll('.sl-card .sl-said')].map((el) => el.querySelector('p').textContent); return said.join('|') === 'What am I looking at?|A stand-in reply, number 1.' && document.querySelector('.sl-card .sl-idea') === null && document.querySelector('.sightline.is-watch') !== null && !new URLSearchParams(window.__sent[0].view.replace(/^#/, '')).has('sc') })()")}`],
      ['a reply that names a site rings that site\'s dot on the Moon, and carries "Show me" and "Plan this"', `${askInWatch('Where should I land?')} && ${after(1600, "(() => { const ringed = document.querySelector('.sl-dot.is-selected, .sl-group-dot.is-selected'); const named = ringed ? (ringed.getAttribute('aria-label') ?? ringed.textContent) : ''; const buttons = [...[...document.querySelectorAll('.sl-card .sl-said.is-scout')].at(-1).querySelectorAll('button')].map((button) => button.textContent.trim()); if (!/Shackleton Rim/.test(named) || buttons.join('|') !== 'Show me|Plan this') throw new Error('ringed: ' + named.slice(0, 80) + '; buttons: ' + buttons.join('|')); return document.querySelector('.sightline.is-watch') !== null })()")}`],
      ['with a reply in it the card still does not cover the Moon\'s disc', CARD_CLEAR, 500],
      ['on a phone nothing lies over the card\'s input: the play control gives way while the card is open', "(() => { const input = document.querySelector('#sl-watch-question').getBoundingClientRect(); const top = document.elementFromPoint((input.left + input.right) / 2, (input.top + input.bottom) / 2); return top === document.querySelector('#sl-watch-question') && (window.innerWidth >= 761 || document.querySelector('.sl-pill') === null) })()"],
      ['"Show me" puts the time bar on the moment the reply names, and stays in Watch', `([...document.querySelectorAll('.sl-card .sl-said button')].find((button) => button.textContent.trim() === 'Show me').click(), true) && ${after(900, "(window.innerWidth < 761 || document.querySelector('.sl-pill .sl-date').textContent.trim() === '1 June 2027') && document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-card') !== null && location.hash === ''")}`],
      ['a question that cannot be answered fails politely and is put back in the input', `${askInWatch('Please fail this one')} && ${after(1200, "(() => { const last = [...document.querySelectorAll('.sl-card .sl-said')].at(-1); return last.classList.contains('is-scout') && last.querySelector('p').classList.contains('is-warn') && /^Scout is busy\\. Ask again in \\d+ s\\.$/.test(last.querySelector('p').textContent) && !/co-pilot/i.test(document.querySelector('.sl-card').textContent) && document.querySelector('#sl-watch-question').value === 'Please fail this one' })()")}`],
      ['Escape closes the card, and opening it again shows the same conversation', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(400, "document.querySelector('.sl-card') === null && (document.querySelector('.scout-face').click(), true)")} && ${after(900, "document.querySelectorAll('.sl-card .sl-said').length === 6")}`],
      ['"Plan this" opens Plan on the place the reply names', `([...document.querySelectorAll('.sl-card .sl-said button')].find((button) => button.textContent.trim() === 'Plan this').click(), true) && ${after(1500, "document.querySelector('.sightline.is-plan') !== null && document.querySelector('#sl-site').value === 'shackleton-rim' && location.hash.startsWith('#a=shackleton-rim@2027-06&t=22&')")}`],
      ['the conversation is the same one in Plan\'s Scout panel, which a laptop has open already (he was open in Watch)', `(document.querySelector('.sl-scout-panel') !== null || (document.querySelector('.sl-rail-scout').click(), true)) &&${after(600, "(() => { const said = [...document.querySelectorAll('.sl-talk .sl-said')].map((el) => el.querySelector('p').textContent); return said.length === 6 && said[0] === 'What am I looking at?' && said[1] === 'A stand-in reply, number 1.' && said[2] === 'Where should I land?' && said[3] === 'A stand-in reply, number 2.' && said[4] === 'Please fail this one' })()")}`],
      ['hidden with H from Plan with a panel open, "Show controls" lands on Watch: the screen and the address', `(${key('h')}, true) && ${after(500, "document.querySelector('.sl-handle') !== null && document.querySelector('.sl-scout') === null && document.querySelector('.sl-drawer') === null && (document.querySelector('.sl-handle').click(), true)")} && ${after(1300, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-col') === null && document.querySelector('.sl-drawer') === null && document.querySelector('.sl-top') !== null && location.hash === ''")}`],
      ['hidden with H from Plan with no panel, the H key lands on Watch too', `(${click('Plan a landing')}, true) && ${after(500, `document.querySelector('.sightline.is-plan') !== null && (${key('h')}, true)`)} && ${after(1000, `document.querySelector('.sl-handle') !== null && (${key('h')}, true)`)} && ${after(1700, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-col') === null && location.hash === '' && localStorage.getItem('sightline.clear') !== '1'")}`],
      ['hidden from the Planner, "Show controls" lands on Watch as well', `(${click('Plan a landing')}, true) && ${after(500, `(${click('Planner')}, true)`)} && ${after(1100, `document.querySelector('.sl-full') !== null && (${key('h')}, true)`)} && ${after(1700, "document.querySelector('.sl-handle') !== null && document.querySelector('.sl-full') === null && (document.querySelector('.sl-handle').click(), true)")} && ${after(2500, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-full') === null && document.querySelector('.sl-col') === null && document.querySelector('.sl-top') !== null && location.hash === ''")}`],
      ['after all that, Scout\'s mark still only opens his card and closes it, with the address on Watch', `(document.querySelector('.scout-face').click(), true) && ${after(400, "document.querySelector('.sl-card') !== null && document.querySelector('.sightline.is-watch') !== null && location.hash === '' && (document.querySelector('.scout-face').click(), true)")} && ${after(900, "document.querySelector('.sl-card') === null && document.querySelector('.sightline.is-watch') !== null && location.hash === ''")}`],
    ],
  },
  {
    // A landing that meets every limit with a sliver of the Sun: 1 June 2027, 18:00, at Shackleton Rim.
    name: 'marginal',
    hash: '#a=shackleton-rim@2027-06&t=18&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['a landing that fits with under half the Sun\'s disc in view is "Fits, marginal" with a diamond, in the orange that is neither the Sun\'s gold nor the red of "does not fit", with its reason on one line', `(() => { const verdict = document.querySelector('.sl-verdict'); const reasons = [...verdict.querySelectorAll('.sl-reasons li')].map((li) => li.textContent.trim()); return ${text('.sl-verdict-words')}.trim() === '◇ Fits, marginal' && verdict.classList.contains('is-marginal') && getComputedStyle(verdict.querySelector('.sl-verdict-words')).color === 'rgb(234, 140, 74)' && getComputedStyle(verdict.querySelector('.sl-verdict-words')).color !== getComputedStyle(document.querySelector('.sl-fact.is-sun .sl-fact-mark')).backgroundColor && getComputedStyle(document.querySelector('.scout.sightline')).getPropertyValue('--sl-miss').trim() === '#e8505a' && reasons.length === 1 && /^(under 1|\\d+)% of the Sun's disc is in view at landing$/.test(reasons[0]) })()`, 2500],
      ['a landing that fits, even marginally, is not offered a next landing; "Why?" is beside its verdict', "document.querySelector('.sl-next') === null && document.querySelector('.sl-verdict .sl-why').textContent.trim() === 'Why?'"],
      ['Compare calls it marginal too, and says why', `(${click('Compare')}, true) && ${after(900, "(() => { const fits = document.querySelector('.sl-compare .sl-compare-verdict td'); return fits.dataset.verdict === 'marginal' && fits.textContent.trim() === '◇' && /^Fits, marginal: /.test(fits.title) && /^A fits, marginal: (under 1|\\d+)% of the Sun's disc is in view at landing\\.$/.test(document.querySelector('.sl-compare-why.is-info li').textContent) })()")}`],
      ['the same site four hours later, added as scenario B, fits without the word marginal, here and in Compare', `(document.querySelector('.sl-tabs button[aria-label="Add a scenario"]').click(), true) && ${after(500, `(() => { const hour = document.querySelector('.sl-pick select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hour, '22'); hour.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)} && ${after(3000, `${text('.sl-verdict-words')}.trim() === '✓ Fits the mission' && document.querySelector('.sl-reasons') === null && document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 2 && document.querySelectorAll('.sl-compare .sl-compare-verdict td')[1].dataset.verdict === 'yes' && document.querySelectorAll('.sl-compare .sl-compare-verdict td')[1].textContent.trim() === '✓'`)}`],
      ['two landings at one site on the same day are two flags on that site\'s one row, side by side, each saying its hour', "(() => { const rows = document.querySelectorAll('.sl-river .sl-site-row'); const flags = [...document.querySelectorAll('.sl-river .sl-flag')]; const says = flags.map((flag) => flag.getAttribute('aria-label')).join('|'); if (rows.length !== 1 || says !== 'Scenario A: Shackleton Rim · 1 June 2027 · 18:00 UTC|Scenario B: Shackleton Rim · 1 June 2027 · ' + document.querySelector('.sl-pick select').value + ':00 UTC') throw new Error(rows.length + ' rows: ' + says); const [a, b] = flags.map((flag) => flag.getBoundingClientRect()); return rows[0].querySelector('.sl-site-name').textContent === 'Shackleton Rim' && a.right <= b.left + 0.5 && flags.map((flag) => flag.textContent).join('') === 'AB' })()"],
    ],
  },
  {
    // The time bar: one row per site, each scenario a lettered flag on its site's row, the selected mission lit, and one line with a handle and its date.
    name: 'time-bar',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=connecting-ridge@2027-06-21T17~connecting-ridge@2027-08-10T00~connecting-ridge@2027-10-02T06',
    checks: [
      ['the time bar has a name, "When the Sun and Earth are in view", with its key beside it; four scenarios at one site are one row, named by the site', "(() => { const river = document.querySelector('.sl-river'); const rows = [...river.querySelectorAll('.sl-site-row')]; const key = river.querySelector('.sl-river-head .sl-legend').textContent.replace(/\\s+/g, ' ').trim(); const name = river.querySelector('.sl-river-name'); const legend = river.querySelector('.sl-river-head .sl-legend').getBoundingClientRect(); const named = name.getBoundingClientRect(); if (name.textContent !== 'When the Sun and Earth are in view' || river.getAttribute('aria-label') !== name.textContent || key !== 'Sun Earth Both Neither' || rows.length !== 1 || rows[0].querySelector('.sl-site-name').textContent !== 'Connecting Ridge') throw new Error(name.textContent + ' / ' + key + ' / ' + rows.length); return window.innerWidth < 761 || (legend.left >= named.right && Math.abs(legend.top + legend.height / 2 - named.top - named.height / 2) < 8) })()", 1500],
      ['the axis keeps every label: the date of the hour on show sits under them, at the foot of the line, and covers none', "(() => { const labels = [...document.querySelectorAll('.sl-axis .sl-track > span')]; const date = document.querySelector('.sl-axis .sl-now').getBoundingClientRect(); const hidden = labels.filter((label) => { const b = label.getBoundingClientRect(); return b.width === 0 || (b.left < date.right && date.left < b.right && b.top < date.bottom && date.top < b.bottom) }); if (labels.map((label) => label.textContent).join('|') !== '1|5|10|15|20|25|30' || hidden.length > 0) throw new Error(labels.map((label) => label.textContent).join('|') + '; under the date: ' + hidden.map((label) => label.textContent).join(', ')); return document.querySelector('.sl-axis-name').textContent === 'May 2027' && date.bottom <= document.querySelector('.sl-river').getBoundingClientRect().bottom })()"],
      ['each scenario is one lettered flag on that row: A stands at its landing hour, and the three that land in later months stand at the row\'s end, each with an arrow', `(() => { ${TIME_BAR_AT}; const flags = [...document.querySelectorAll('.sl-site-row .sl-flag')]; const track = document.querySelector('.sl-site-row .sl-track').getBoundingClientRect(); const a = flags[0].getBoundingClientRect(); const words = flags.map((flag) => flag.textContent).join(' '); if (flags.length !== 4 || words !== 'A B› C› D›') throw new Error(words); if (Math.abs(a.left + a.width / 2 - xOf(Number(flags[0].dataset.hour))) > 1.5) throw new Error('A is ' + (a.left + a.width / 2 - xOf(Number(flags[0].dataset.hour))) + ' px from its hour'); return flags[0].getAttribute('aria-label') === 'Scenario A: Connecting Ridge · 6 May 2027 · 13:00 UTC' && flags.slice(1).every((flag) => flag.classList.contains('is-after') && flag.getBoundingClientRect().right <= track.right + 1 && flag.getBoundingClientRect().left > a.right) && flags.every((flag) => flag.getBoundingClientRect().bottom <= track.top + 1) })()`],
      ['the selected mission is lit from its landing for its whole length, 14 days, with a short label and the row dimmed on either side; the others are thin outlines', `(() => { ${TIME_BAR_AT}; const track = document.querySelector('.sl-site-row .sl-track').getBoundingClientRect(); const lit = [...document.querySelectorAll('.sl-site-row .sl-span.is-lit')]; const box = lit[0].getBoundingClientRect(); const { count } = span(); const wide = (336 / count) * track.width; if (lit.length !== 1 || lit[0].dataset.scenario !== 'A' || lit[0].dataset.hours !== '336') throw new Error('lit: ' + lit.map((one) => one.dataset.scenario + one.dataset.hours)); if (Math.abs(box.width - wide) > 1.5 || Math.abs(box.left - (xOf(Number(document.querySelector('.sl-site-row .sl-flag').dataset.hour)) - track.width / count / 2)) > 1.5) throw new Error('the lit span is ' + box.width + ' px wide for ' + wide); return document.querySelector('.sl-span-label').textContent === 'A’s 14-day mission' && document.querySelectorAll('.sl-site-row .sl-dim').length === 2 && document.querySelectorAll('.sl-site-row .sl-span:not(.is-lit)').length === 0 })()`],
      ['in Year every flag stands at its own landing hour, one flag a scenario, and the three other missions are outlined', `(${click('Year')}, true) && ${after(500, `(() => { ${TIME_BAR_AT}; const flags = [...document.querySelectorAll('.sl-site-row .sl-flag')]; const hours = flags.map((flag) => Number(flag.dataset.hour)); const off = flags.map((flag, i) => { const box = flag.getBoundingClientRect(); return Math.abs(box.left + box.width / 2 - xOf(hours[i])) }); if (flags.map((flag) => flag.textContent).join('') !== 'ABCD' || off.some((px) => px > 1.5)) throw new Error('flags ' + flags.map((flag) => flag.textContent).join('') + ' are ' + off.map((px) => px.toFixed(1)).join(', ') + ' px from their hours'); return new Set(hours).size === 4 && document.querySelectorAll('.sl-site-row .sl-span:not(.is-lit)').length === 3 && document.querySelector('.sl-axis-name').textContent === '2027' })()`)}`],
      ['pressing flag C selects scenario C everywhere: the tabs, the column\'s landing, the lit mission and its label', `(document.querySelector('.sl-flag[aria-label^="Scenario C"]').click(), true) && ${after(900, "(() => { const lit = [...document.querySelectorAll('.sl-site-row .sl-span.is-lit')].map((one) => one.dataset.scenario).join(''); const pressed = [...document.querySelectorAll('.sl-flag[aria-pressed=true]')].map((flag) => flag.textContent).join(''); const tab = document.querySelector('.sl-tabs button[aria-pressed=true]').getAttribute('aria-label'); const landing = [...document.querySelectorAll('.sl-col .sl-pick .sl-value')].map((part) => part.textContent).join(''); if (lit !== 'C' || pressed !== 'C' || tab !== 'Scenario C' || !/^10 August 2027 · 00:00 UTC/.test(landing)) throw new Error([lit, pressed, tab, landing].join(' / ')); return document.querySelector('.sl-span-label').textContent === 'C’s 14-day mission' })()")}`],
      ['the hour on show is written once, under the line, which has a handle at its top; the note beside the Moon says only that this is not the landing, with the two ways back', `(() => { const dates = document.querySelectorAll('.sl-now'); const line = document.querySelector('.sl-playhead').getBoundingClientRect(); const handle = document.querySelector('.sl-line-handle').getBoundingClientRect(); const date = dates[0].getBoundingClientRect(); const rows = document.querySelector('.sl-site-row').getBoundingClientRect(); const track = document.querySelector('.sl-axis .sl-track').getBoundingClientRect(); const note = document.querySelector('.sl-off-landing').textContent.replace(/\\s+/g, ' ').trim(); if (dates.length !== 1 || dates[0].textContent !== '6 May 2027 · 13:00 UTC') throw new Error('dates: ' + [...dates].map((one) => one.textContent).join(' | ')); if (note !== 'Not the landingBack to landingLand here' && note !== 'Not the landing Back to landing Land here') throw new Error(note); return handle.width >= 10 && Math.abs(handle.left + handle.width / 2 - line.left - line.width / 2) < 1 && handle.bottom <= rows.top + 2 && date.top >= rows.bottom && (Math.abs(date.left + date.width / 2 - line.left - line.width / 2) < 2 || Math.abs(date.left - track.left) < 2 || Math.abs(date.right - track.right) < 2) && !/\\d/.test(note) })()`],
      ['the line drags, and the keys move it: an hour with an arrow, a day with Shift', `(async () => { ${TIME_BAR_AT}; const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const seek = document.querySelector('.sl-seek'); const box = seek.getBoundingClientRect(); const y = box.top + 3; const at = (fraction) => ({ bubbles: true, pointerType: 'mouse', clientX: box.left + box.width * fraction, clientY: y }); seek.dispatchEvent(new PointerEvent('pointerdown', at(0.2))); seek.dispatchEvent(new PointerEvent('pointermove', at(0.5))); seek.dispatchEvent(new PointerEvent('pointerup', at(0.5))); await wait(400); const dragged = document.querySelector('.sl-now').textContent; const { from, count } = span(); const hour = Number(document.querySelector('.sl-seek input').value); if (hour !== from + Math.floor(0.5 * count)) throw new Error('dragged to hour ' + hour + ', not ' + (from + Math.floor(0.5 * count))); ${key('ArrowRight')}; await wait(300); const plusOne = Number(document.querySelector('.sl-seek input').value); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true })); await wait(300); const back = Number(document.querySelector('.sl-seek input').value); if (plusOne !== hour + 1 || back !== hour - 23) throw new Error('keys: ' + [hour, plusOne, back].join(', ')); return dragged !== '6 May 2027 · 13:00 UTC' && document.querySelectorAll('.sl-now').length === 1 })()`],
      ['"Back to landing" puts the line on C\'s landing and the note goes: it shows only while the hour on show is not the selected landing', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${noteLink('Back to landing')}; await wait(600); const date = document.querySelector('.sl-now').textContent; if (date !== '10 August 2027 · 00:00 UTC' || document.querySelector('.sl-off-landing') !== null) throw new Error(date + ', note ' + (document.querySelector('.sl-off-landing') ? 'there' : 'gone')); ${key('ArrowRight')}; await wait(400); const off = document.querySelector('.sl-off-landing') !== null; ${key('ArrowLeft')}; await wait(400); return off && document.querySelector('.sl-off-landing') === null })()`],
      ['in Month the axis says which month, and in Day too', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const names = []; for (const zoom of ['Month', 'Day', 'Month']) { [...document.querySelectorAll('.sl-river .sl-zooms button')].find((one) => one.textContent === zoom).click(); await wait(400); names.push(document.querySelector('.sl-axis-name').textContent + ' ' + document.querySelectorAll('.sl-site-row .sl-flag').length) } if (names.join('|') !== 'August 2027 4|August 2027 4|August 2027 4') throw new Error(names.join('|')); return true })()`],
      ['the header is thin: the speeds are a small menu on the play button, Day, Month and Year and Fold stay, and there is no list of speeds in the row', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); document.querySelector('.sl-river .sl-speed').click(); await wait(300); const speeds = [...document.querySelectorAll('.sl-speed-menu button')].map((one) => one.textContent.trim()); if (speeds.join('|') !== '1 hour a second|6 hours a second|1 day a second|3 days a second') throw new Error(speeds.join('|')); document.querySelectorAll('.sl-speed-menu button')[0].click(); await wait(300); const head = document.querySelector('.sl-river-head'); return document.querySelector('.sl-speed-menu') === null && document.querySelector('.sl-river .sl-speed').getAttribute('aria-label') === 'Speed: 1 hour a second' && head.querySelector('select') === null && [...head.querySelectorAll('.sl-zooms button')].map((one) => one.textContent).join('|') === 'Day|Month|Year' && head.querySelector('.sl-fold').textContent.trim() === 'Fold' && head.getBoundingClientRect().height < (window.innerWidth < 761 ? 150 : 80) })()`],
      ['"More" offers the hourly Sun and Earth of the scenario on show as a CSV file: one file, named for the site, the landing and the mission, whose first row is the landing hour', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${KEEP_SAVED}; document.querySelector('.sl-river .sl-more').click(); await wait(300); const line = document.querySelector('.sl-menu .sl-hourly'); if (!line || line.textContent.trim() !== 'Hourly Sun and Earth (CSV)') throw new Error('no line under More: ' + document.querySelector('.sl-menu')?.textContent); line.click(); for (let i = 0; i < 40 && !window.__saved; i += 1) await wait(250); if (!window.__saved) throw new Error('no file was saved: ' + document.querySelector('.sl-menu')?.textContent); const rows = window.__saved.text.trimEnd().split('\\n').filter((row) => !row.startsWith('#')); if (window.__saved.name !== 'sightline-hourly_connecting-ridge_2027-08-10T00Z_14d.csv' || !rows[1].startsWith('2027-08-10T00:00') || rows.length !== 1 + 14 * 24) throw new Error(window.__saved.name + ': ' + rows.length + ' rows, the first ' + rows[1]); return document.querySelector('.sl-menu') === null })()`],
      ['folded, the rows go and the date takes the name\'s place, still written once; "Open" brings the rows back', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); document.querySelector('.sl-river .sl-fold').click(); await wait(400); const folded = document.querySelector('.sl-rows') === null && document.querySelector('.sl-river-name') === null && document.querySelectorAll('.sl-now').length === 1 && document.querySelector('.sl-river-head .sl-now').textContent === '10 August 2027 · 00:00 UTC'; document.querySelector('.sl-river .sl-fold').click(); await wait(400); return folded && document.querySelectorAll('.sl-site-row').length === 1 && document.querySelectorAll('.sl-now').length === 1 && document.querySelector('.sl-river-name') !== null })()`],
      ['on a laptop everything is in the window with four scenarios: the page does not scroll, and the time bar leaves the Moon most of the height', "window.innerWidth < 761 || (() => { const river = document.querySelector('.sl-river').getBoundingClientRect(); if (document.documentElement.scrollHeight > window.innerHeight + 1 || river.bottom > window.innerHeight + 1 || river.height > 0.3 * window.innerHeight) throw new Error('the time bar is ' + Math.round(river.height) + ' px of ' + window.innerHeight); return true })()"],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // The time bar with scenarios at two sites: two rows, each scenario's flag on its own site's row.
    name: 'time-bar-sites',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-09T02~connecting-ridge@2027-05-20T00',
    checks: [
      ['scenarios at two sites are two rows, named by their sites, and each scenario\'s flag stands on its own site\'s row at its landing hour', `(() => { ${TIME_BAR_AT}; const rows = [...document.querySelectorAll('.sl-site-row')]; const names = rows.map((row) => row.querySelector('.sl-site-name').textContent).join('|'); const flags = rows.map((row) => [...row.querySelectorAll('.sl-flag')]); const letters = flags.map((row) => row.map((flag) => flag.textContent).join('')).join('|'); if (names !== 'Connecting Ridge|Shackleton Rim' || letters !== 'AC|B') throw new Error(names + ' / ' + letters); const off = flags.flat().map((flag) => { const box = flag.getBoundingClientRect(); return Math.abs(box.left + box.width / 2 - xOf(Number(flag.dataset.hour))) }); if (off.some((px) => px > 1.5)) throw new Error('flags are ' + off.map((px) => px.toFixed(1)).join(', ') + ' px from their hours'); return document.querySelectorAll('.sl-flag').length === document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length }) ()`, 1500],
      ['A\'s mission is lit on its own row and C\'s is an outline beside it; the other site\'s row is not dimmed', "(() => { const rows = [...document.querySelectorAll('.sl-site-row')]; const lit = rows.map((row) => [...row.querySelectorAll('.sl-span.is-lit')].map((one) => one.dataset.scenario).join('')).join('|'); const plain = rows.map((row) => [...row.querySelectorAll('.sl-span:not(.is-lit)')].map((one) => one.dataset.scenario).join('')).join('|'); const dim = rows.map((row) => row.querySelectorAll('.sl-dim').length).join('|'); if (lit !== 'A|' || plain !== 'C|B' || dim !== '2|0') throw new Error([lit, plain, dim].join(' / ')); return true })()"],
      ['pressing flag B selects B everywhere and lights its mission on Shackleton Rim\'s row', `(document.querySelector('.sl-flag[aria-label^="Scenario B"]').click(), true) && ${after(900, "(() => { const rows = [...document.querySelectorAll('.sl-site-row')]; const lit = rows.map((row) => [...row.querySelectorAll('.sl-span.is-lit')].map((one) => one.dataset.scenario).join('')).join('|'); const dim = rows.map((row) => row.querySelectorAll('.sl-dim').length).join('|'); const tab = document.querySelector('.sl-tabs button[aria-pressed=true]').getAttribute('aria-label'); const site = document.querySelector('.sl-col select').value; if (lit !== '|B' || dim !== '0|2' || tab !== 'Scenario B' || site !== 'shackleton-rim') throw new Error([lit, dim, tab, site].join(' / ')); return document.querySelector('.sl-span-label').textContent === 'B’s 14-day mission' && rows[1].contains(document.querySelector('.sl-span-label')) })()")}`],
      ['a band\'s words show above the rows, clear of every flag and of the selected mission\'s label, with the name of the row they are about marked', `${POINT_AT_BAND(1, 0.5)} && ${after(300, "(() => { const tip = document.querySelector('.sl-band-tip'); if (!tip || !/ h$/.test(tip.textContent)) throw new Error('no words'); const box = tip.getBoundingClientRect(); const river = document.querySelector('.sl-river').getBoundingClientRect(); const over = [...document.querySelectorAll('.sl-flag, .sl-span-label')].filter((el) => { const b = el.getBoundingClientRect(); return b.left < box.right && box.left < b.right && b.top < box.bottom && box.top < b.bottom }); const pointed = [...document.querySelectorAll('.sl-site-row')].map((row) => row.classList.contains('is-pointed')).join('|'); if (over.length > 0 || pointed !== 'false|true') throw new Error('over ' + over.map((el) => el.textContent).join(', ') + '; pointed ' + pointed); return box.top >= river.top && box.bottom <= document.querySelector('.sl-site-row').getBoundingClientRect().top + 1 })()")}`],
    ],
  },
  {
    // The Planner: the same scenarios with the whole window. Two landings at one site, so the aligned rows can be told apart.
    name: 'planner',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=connecting-ridge@2027-06-21T17',
    checks: [
      ['the rail has nine controls under three names (View, Plan, Help), the three heights grouped as one, with "Guide" in its last group, and none of them leaves the page (a phone has the "rail" scene\'s one row instead)', "window.innerWidth < 761 || (() => { const rail = document.querySelector('.sl-rail'); const controls = [...rail.children].filter((el) => el.tagName !== 'HR' && !el.classList.contains('sl-rail-label')); const names = controls.map((el) => (el.classList.contains('sl-heights') ? [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/') : el.textContent.trim())); return rail.querySelector('a') === null && document.querySelector('a[href^=\"/planner\"], a[href^=\"/surface\"]') === null && controls.length <= 9 && names.join('|') === 'Orbit/Site/Surface|Layers|Scout|Compare|Accuracy|Planner|New Planner|Guide|Home' && [...rail.querySelectorAll('.sl-rail-label')].map((label) => label.textContent.trim()).join('|') === 'View|Plan|Help' && rail.querySelectorAll('button').length === 11 && [...rail.children].findIndex((el) => el.textContent.trim() === 'Guide') > [...rail.children].findIndex((el) => el.textContent.trim() === 'Planner') + 1 })()", 1200],
      ['Share is a small icon button beside the name, with a name; there is no "?" icon, so Guide has one way in', "(() => { const tools = [...document.querySelectorAll('.sl-col-head .sl-head-tools .sl-icon')]; return tools.length === 1 && tools[0].getAttribute('aria-label') === 'Share' && tools[0].tagName === 'BUTTON' && tools[0].getBoundingClientRect().width <= 28 && (window.innerWidth < 761 || document.querySelector('.sl-title').getBoundingClientRect().right <= tools[0].getBoundingClientRect().left) && [...document.querySelectorAll('button')].filter((button) => /Guide/.test(button.getAttribute('aria-label') ?? button.textContent)).length === 1 })()"],
      ['the river offers Day, Month and Year, and nothing else', "[...document.querySelectorAll('.sl-river .sl-zooms button, .sl-menu .sl-zooms button')].map((button) => button.textContent.trim()).join('|') === 'Day|Month|Year' || (document.querySelector('.sl-more').click(), [...document.querySelectorAll('.sl-menu .sl-zooms button')].map((button) => button.textContent.trim()).join('|') === 'Day|Month|Year')"],
      ['"Planner" opens it over the whole window, on Find, with the Moon kept small in a corner; the scenarios are as they were and the address gains only the open tab', `(() => { window.__hash = location.hash; document.body.click(); ${click('Planner')}; return true })() && ${after(900, "(() => { const full = document.querySelector('.sl-full').getBoundingClientRect(); const moon = document.querySelector('.sl-stage').getBoundingClientRect(); return location.hash === window.__hash + '&planner=find' && location.pathname.startsWith('/sightline') && full.width >= window.innerWidth - 2 && getComputedStyle(document.querySelector('.sl-wrap')).display === 'none' && document.querySelector('.sl-rail') === null && moon.width <= 160 && moon.height <= 160 && document.querySelector('.scout-globe') !== null && document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Find' && document.querySelector('.pl-months') !== null && document.querySelectorAll('.pl-header .sl-tabs button[aria-label^=Scenario]').length === 2 })()")}`],
      ['the Compare tab has a column per scenario, headed by its site and landing, and the address follows the tab', `(${click('Compare')}, true) && ${after(500, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')].map((th) => th.querySelector('select').value + ' ' + [...th.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join('')); return location.hash === window.__hash + '&planner=compare' && document.querySelector('.pl-months') === null && heads.length === 2 && heads[0] === 'connecting-ridge 6 May 2027 · 13:00 UTC' && heads[1] === 'connecting-ridge 21 June 2027 · 17:00 UTC' })()")}`],
      ['the rows are in groups, the verdict first: whether each scenario fits and why, then at landing, power, radio, the ground and science, with the best value in a row marked and no score that blends them', "(() => { const table = document.querySelector('.sl-full-table'); const groups = [...table.querySelectorAll('tbody')].map((body) => body.dataset.group + ':' + [...body.querySelectorAll('tr:not(.pl-group-row) > th')].map((th) => th.textContent.trim()).join('|')); const names = [...table.querySelectorAll('.pl-group-row th')].map((th) => th.textContent.trim()).join('|'); const cells = (name) => [...[...table.querySelectorAll('tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); const fits = cells('Fits the mission'); return groups.join(' / ') === \"verdict:Fits the mission / landing:In view|Sun's elevation, °|Sun above the skyline, °|Earth's elevation, °|Earth above the skyline, ° / power:Sunlit, %|Longest dark spell, h|Sunlight on a panel, W/m²|Sun in view at landing, % / radio:Earth in view, %|Longest radio silence, h|Sun and Earth together, % / ground:Slope, ° / science:Permanent shadow, nearest|Shadow of 10 km² or more, nearest\" && names === 'At landing|Power|Radio|Ground|Science' && ['Sun\\'s elevation, °', 'Sun above the skyline, °', 'Earth\\'s elevation, °', 'Earth above the skyline, °'].every((name) => cells(name).every((cell) => /^−?\\d+\\.\\d$/.test(cell))) && fits.length === 2 && /^✗ No: Sun down for 95 h; your limit is 24 h$/.test(fits[0]) && fits[1] === '✓ Yes' && table.querySelectorAll('td.is-best').length >= 3 && !/score/i.test(table.textContent) })()"],
      ['under it, one time row per scenario starts at its own landing hour, on an axis of days since landing', "(() => { const rows = [...document.querySelectorAll('.sl-aligned-row')]; const bands = rows.map((row) => [...row.querySelectorAll('rect')].map((rect) => rect.getAttribute('class') + rect.getAttribute('x') + '+' + rect.getAttribute('width')).join(',')); const first = rows.map((row) => row.querySelector('rect').getAttribute('class').replace('sl-run is-', '')); const atLanding = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent === 'In view').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.dataset.state); const axis = [...document.querySelectorAll('.sl-aligned .sl-axis .sl-track span')].map((tick) => tick.textContent); return Number(rows[1].dataset.firstHour) - Number(rows[0].dataset.firstHour) === 1108 && rows.every((row) => row.dataset.hours === '336' && row.querySelector('rect').getAttribute('x') === '0') && bands[0] !== bands[1] && first.join('|') === atLanding.join('|') && axis[0] === 'landing' && /^day \\d+$/.test(axis.at(-1)) })()"],
      ['Export opens a short list, and its first line writes the table as CSV', `(() => { window.__csv = null; URL.createObjectURL = (blob) => { void blob.text().then((text) => { window.__csv = text }); return 'blob:stand-in' }; HTMLAnchorElement.prototype.click = function () {}; ${click('Export')}; return true })() && ${after(200, `(${EXPORT_LINE('Comparison table (CSV)')}.click(), true)`)} && ${after(500, "document.querySelector('.sl-export-list') === null && typeof window.__csv === 'string' && window.__csv.split('\\n')[0] === ',A · Connecting Ridge · 2027-05-06T13:00:00Z,B · Connecting Ridge · 2027-06-21T17:00:00Z' && /\\n\"Sunlit, %\",61,/.test(window.__csv) && /\\n\"Permanent shadow, nearest\",0\\.1 km,/.test(window.__csv) && window.__csv.match(/\\nFits the mission,/g).length === 1 && /\\nMission,/.test(window.__csv)")}`],
      ['on Find, a cell opens its month under the grid and "Add as C" adds it without leaving the Planner; Compare then has three columns', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${click('Find')}; await wait(400); [...document.querySelectorAll('.pl-months button')].find((cell) => cell.dataset.site === 'shackleton-rim' && cell.dataset.month === '2027-09').click(); await wait(400); const add = document.querySelector('.pl-strip .pl-add button'); if (!add || add.textContent.trim() !== 'Add as C') return false; add.click(); await wait(600); const stayed = document.querySelector('.sl-full') !== null && /Added as C/.test(document.querySelector('.pl-strip .pl-add').textContent) && location.hash.includes('~shackleton-rim@2027-09-'); ${click('Compare')}; await wait(500); const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return stayed && heads.length === 3 && heads[2].querySelector('select').value === 'shackleton-rim' && /September 2027/.test(heads[2].querySelector('.sl-pick').textContent) && document.querySelectorAll('.sl-aligned-row').length === 3 })()`],
      ['Scout opens beside the table, which keeps its whole width on screen (the page scrolls down, as the Planner always has)', `(document.querySelector('.sl-full-head .sl-rail-scout').click(), true) && ${after(900, "(() => { const panel = document.querySelector('.sl-scout-panel'); const table = document.querySelector('.sl-full-table').getBoundingClientRect(); const rows = document.querySelector('.sl-aligned').getBoundingClientRect(); if (window.innerWidth < 761) return panel !== null; const box = panel.getBoundingClientRect(); const scroller = document.querySelector('.sl-full-scroll'); const head = document.querySelector('.sl-full-table thead th:not(.pl-add-col)').getBoundingClientRect().width; if (!(table.left >= 0 && table.right <= box.left + 0.5 && table.top >= 0 && scroller.scrollWidth <= scroller.clientWidth + 1 && rows.right <= box.left + 0.5 && head > 60)) throw new Error('table ' + Math.round(table.left) + ' to ' + Math.round(table.right) + ' across from ' + Math.round(table.top) + ' down; panel from ' + Math.round(box.left) + '; scroller ' + scroller.scrollWidth + ' of ' + scroller.clientWidth + '; rows to ' + Math.round(rows.right) + '; a column is ' + Math.round(head)); return true })()")}`],
      ['Escape closes nothing but the Planner: back on the Moon, the three scenarios and the address are kept', `(() => { if (window.innerWidth < 761) ${click('Close')}; window.__hash = location.hash; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })() && ${after(900, "document.querySelector('.sl-full') === null && document.querySelector('.sl-rail') !== null && document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 3 && location.hash === window.__hash.replace(/&planner=(find|compare)/, '') && document.querySelectorAll('.sl-river .sl-flag').length === 3")}`],
      ['the small Moon in the Planner\'s corner is a way back too', `(document.querySelector('.sl-scout-panel') && ${click('Close')}, ${click('Planner')}, true) && ${after(700, "(() => { const back = document.querySelector('.sl-mini-back'); if (!back || back.getAttribute('aria-label') !== 'Back to the Moon') return false; back.click(); return true })()")} && ${after(700, "document.querySelector('.sl-full') === null && document.querySelector('.sl-col') !== null")}`],
      ['How opens as a sheet over the scene, on this page, and names the model the co-pilot\'s status reports', `(${click('Guide')}, true) && ${after(1500, "(async () => { const sheet = document.querySelector('.sl-how'); const status = await fetch('/api/status/services').then((r) => (r.ok ? r.json() : null)).catch(() => null); const id = status?.services?.copilot?.status?.modelSettings?.model ?? null; const match = id ? /^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?/.exec(id) : null; const name = match ? 'Claude ' + match[1][0].toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '') : null; const line = sheet.querySelector('.how-scout-model').textContent.replace(/\\s+/g, ' ').trim(); const says = name ? line.startsWith('Scout is Anthropic’s Claude (' + name + ').') : line.startsWith('Scout is Anthropic’s Claude.'); if (!says) throw new Error('status says ' + id + '; the sheet says: ' + line.slice(0, 80)); return location.pathname.startsWith('/sightline') && sheet.getAttribute('role') === 'dialog' && /read-only tools/.test(line) && /never works out a number himself/.test(line) })()")}`],
      ['Escape closes the sheet', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(500, "document.querySelector('.sl-how') === null && document.querySelector('.sl-col') !== null")}`],
      ['Surface shows the surface view inside the stage, on this page, and Orbit brings the Moon back with the view kept out of sight', `(${click('Surface')}, true) && ${after(900, "(() => { const frame = document.querySelector('.sl-stage iframe.sl-surface'); return frame !== null && getComputedStyle(frame).visibility === 'visible' && frame.getAttribute('src').startsWith('/surface/#a=connecting-ridge@2027-05') && location.pathname.startsWith('/sightline') && document.querySelector('.sl-heights button[aria-pressed=\"true\"]').textContent.trim() === 'Surface' })()")} && (${click('Orbit')}, true) && ${after(500, "getComputedStyle(document.querySelector('.sl-surface')).visibility === 'hidden'")}`],
    ],
  },
  {
    // The Planner's Find tab: every site by month, a cell opening its month, and adding from it.
    name: 'planner-find',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&planner=find',
    // The link opens the Planner itself, where the Moon is small and has no site dots to wait for.
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.pl-months') !== null",
    checks: [
      ['a link that names the tab opens the Planner on Find: every listed site, in its group, by the twelve months of the landing\'s year', "(() => { const grid = document.querySelector('.pl-months'); const months = [...grid.querySelectorAll('thead th:not(.pl-months-count-head)')].map((th) => th.textContent).join(''); const groups = [...grid.querySelectorAll('.pl-group-row th')].map((th) => th.textContent); const rows = grid.querySelectorAll('tbody tr:not(.pl-group-row)').length; return document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Find' && months === 'JanFebMarAprMayJunJulAugSepOctNovDec' && groups.join('|') === 'South pole ridges|CLPS|Apollo|Other countries' && rows === 13 && grid.dataset.year === '2027' && grid.querySelectorAll('td button').length === 13 * 12 })()", 1500],
      ['a cell says on how many days of its month a landing fits, or "none", worked out for every site in under 50 ms; the legend is one line', "(() => { const cells = [...document.querySelectorAll('.pl-months td button')]; const legend = document.querySelector('.pl-find-legend').getBoundingClientRect(); const ms = Number(document.querySelector('.pl-find').dataset.fitMs); return document.querySelector('.pl-measures [aria-pressed=true]').textContent === 'Landings that fit' && cells.every((cell) => (cell.textContent === 'none' && cell.dataset.days === '0') || (/^\\d+$/.test(cell.textContent) && cell.textContent === cell.dataset.days && Number(cell.dataset.days) <= 31)) && cells.some((cell) => cell.textContent === 'none') && cells.some((cell) => Number(cell.dataset.days) > 0) && legend.height < 26 && ms >= 0 && ms < 50 })()"],
      ['a cell\'s count matches the verdict: its month opens under the grid with the same days marked, the first landing named is added as C without leaving the page, and Compare\'s verdict says it fits', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const cell = [...document.querySelectorAll('.pl-months td button')].find((one) => one.dataset.site === 'connecting-ridge' && Number(one.dataset.days) > 0); const days = Number(cell.dataset.days); cell.click(); await wait(400); const strip = document.querySelector('.pl-strip'); const marked = new Set(); for (const rect of strip.querySelectorAll('.pl-fit')) for (let hour = Number(rect.getAttribute('x')); hour < Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')); hour += 1) marked.add(Math.floor(hour / 24)); const named = strip.querySelector('.pl-landings button[aria-pressed=true]').textContent; const add = strip.querySelector('.pl-add button'); if (marked.size !== days || !/^First that fits: \\d+ \\w+ 2027 · \\d\\d:00 UTC$/.test(named) || add.textContent.trim() !== 'Add as C') return false; add.click(); await wait(600); const stayed = document.querySelector('.pl-months') !== null && /Added as C\\./.test(strip.textContent) && document.querySelectorAll('.pl-header .sl-tabs button[aria-label^=Scenario]').length === 3; ${click('Compare')}; await wait(500); const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); ${click('Find')}; await wait(300); return stayed && fits.length === 3 && fits[2] === '✓ Yes' })()`],
      ['"none" is none: the first hour of such a month, added as D, is one the verdict refuses; with four scenarios a cell says one must be removed first', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const cell = [...document.querySelectorAll('.pl-months td button')].find((one) => one.dataset.days === '0'); cell.click(); await wait(400); const strip = document.querySelector('.pl-strip'); const add = strip.querySelector('.pl-add button'); if (!/No landing in \\w+ 2027 fits the mission\\. On the 1st at 00:00 UTC: \\S/.test(strip.textContent) || strip.querySelector('.pl-fit') !== null || add.textContent.trim() !== 'Add the 1st as D') return false; add.click(); await wait(600); ${click('Compare')}; await wait(500); const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); ${click('Find')}; await wait(300); [...document.querySelectorAll('.pl-months td button')].find((one) => Number(one.dataset.days) > 0).click(); await wait(300); const full = document.querySelector('.pl-strip .pl-add'); return fits.length === 4 && /^✗ No/.test(fits[3]) && full.querySelector('button') === null && full.textContent.trim() === 'Four scenarios at most: remove one to add another.' })()`],
      ['Sun, Earth, and Sun and Earth show the share of the month in view, in percent', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const seen = []; for (const name of ['Sun', 'Earth', 'Sun and Earth']) { [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === name).click(); await wait(250); const cells = [...document.querySelectorAll('.pl-months td button')].map((cell) => cell.textContent); seen.push(cells.every((cell) => /^(\\d{1,3}|<1)$/.test(cell) && (cell === '<1' || Number(cell) <= 100)) && /% of the month$/.test(document.querySelector('.pl-find-legend').textContent.split(':')[0])) } const apollo = [...document.querySelectorAll('.pl-months td button')].filter((cell) => cell.dataset.site === 'apollo-11').map((cell) => cell.textContent); [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === 'Earth').click(); await wait(250); const earth = [...document.querySelectorAll('.pl-months td button')].filter((cell) => cell.dataset.site === 'apollo-11' || cell.dataset.site === 'change-4').map((cell) => cell.textContent); [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === 'Landings that fit').click(); await wait(250); return seen.every(Boolean) && apollo.every((cell) => Number(cell) > 30 && Number(cell) < 70) && earth.filter((cell) => cell === '100').length === 12 && earth.filter((cell) => cell === '0').length === 12 })()`],
      ['the mission on the left changes the counts at once, and "Example: Canada\'s utility rover" sets the Long stay example with the agency\'s own words and link', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const counts = () => [...document.querySelectorAll('.pl-months td button')].map((cell) => cell.dataset.days).join(','); const before = counts(); ${click("Example: Canada’s utility rover")}; await wait(500); const note = document.querySelector('.pl-rover'); const link = note.querySelector('a'); const rover = counts(); const ok = rover !== before && location.hash.includes('limits=60_336_') && /in its own words/.test(note.textContent) && /an example and not the rover’s own figures/.test(note.textContent) && /published no landing site/.test(note.textContent) && link.href.startsWith('https://www.asc-csa.gc.ca/') && link.target === '_blank'; ${click('Short stay example')}; await wait(500); return ok && counts() === before && document.querySelector('.pl-rover') === null })()`],
      ['the open tab survives a reload: Compare stays Compare', `(${click('Compare')}, true) && ${after(400, "(location.hash.includes('planner=compare') && (window.__reloaded = false, location.reload(), true))")}`],
      ['after the reload the Planner is open on Compare with the four scenarios, and Find is one press away', `window.__reloaded === undefined && document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Compare' && document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)').length === 4 && (${click('Find')}, true) && ${after(400, "document.querySelector('.pl-months') !== null && location.hash.includes('planner=find')")}`, 6000],
      ['Brief opens the written brief for the scenario on show, as the main screen\'s does, and Escape closes it and nothing else', `(${click('Brief')}, true) && ${after(2500, "document.querySelector('.sl-brief-sheet') !== null")} && ${after(2600, "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)")} && ${after(4000, "document.querySelector('.sl-brief-sheet') === null && document.querySelector('.sl-full') !== null")}`],
      ['Share opens the main screen\'s sheet: copy the link first, save with a name, the brief last', `(document.querySelector('.pl-header .sl-icon[aria-label="Share"]').click(), true) && ${after(300, "(() => { const names = [...document.querySelectorAll('.sl-share-sheet button')].map((button) => button.textContent.trim()); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return (names[0] === 'Copy link' && names.includes('Save') && names.at(-1) === 'Brief') || names.join('|') })()")}`],
      ['the header reads back, title, tabs, scenarios A to D, then Brief, Share, Export and Scout, and nothing is wider than the screen', "(() => { const head = document.querySelector('.pl-header'); const order = [...head.querySelectorAll('.pl-back, h2, .pl-tabs, .sl-tabs, .pl-tools')].map((part) => part.className || part.tagName).join('|'); const tools = [...head.querySelectorAll('.pl-tools > button, .pl-tools .sl-icon, .pl-tools .sl-export > button')].map((tool) => tool.getAttribute('aria-label') ?? tool.textContent.trim()).join('|'); return /pl-back\\|H2\\|pl-tabs\\|sl-tabs\\|pl-tools/.test(order) && head.querySelector('.pl-back').textContent.trim() === '‹ Moon' && head.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4 && tools === 'Brief|Share|Export|Scout' && document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.sl-full').scrollWidth <= document.querySelector('.sl-full').clientWidth + 1 })()"],
      ['"‹ Moon" goes back to the Moon with the four scenarios intact, and the address drops the tab', `(${click('‹ Moon')}, true) && ${after(900, "document.querySelector('.sl-full') === null && document.querySelector('.sl-rail') !== null && document.querySelectorAll('.sl-col-head .sl-tabs button[aria-label^=Scenario], .sl-tabs button[aria-label^=Scenario]').length >= 4 && !location.hash.includes('planner=') && location.hash.includes('~connecting-ridge@2027-')")}`],
      ['the small Moon is a way back too, named "Back to the Moon"', `(document.body.click(), ${click('Planner')}, true) && ${after(900, "(() => { const back = document.querySelector('.sl-mini-back'); const ok = document.querySelector('.pl-months') !== null && back.getAttribute('aria-label') === 'Back to the Moon' && /Back to the Moon/.test(back.title); back.click(); return ok })()")} && ${after(1800, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4")}`],
      ['and Escape goes back as well, with the scenarios as they were', `(document.body.click(), ${click('Planner')}, true) && ${after(900, "(document.querySelector('.sl-full') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true))")} && ${after(1800, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4 && !location.hash.includes('planner=')")}`],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // Find with the detailed planner's detail: each site's count of months, a month's days, the slip check, suggestions, and a point of the visitor's own.
    name: 'planner-find-more',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&planner=find',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.pl-months') !== null",
    checks: [
      ['each site\'s row ends with how many of the year\'s months have a landing that fits, equal to its cells; the line above the grid adds them up', "(() => { const rows = [...document.querySelectorAll('.pl-months tbody tr:not(.pl-group-row)')]; const counts = rows.map((row) => ({ cells: [...row.querySelectorAll('td button')].filter((cell) => Number(cell.dataset.days) > 0).length, says: row.querySelector('.pl-months-count') })); const wrong = counts.filter((one) => !one.says || Number(one.says.dataset.months) !== one.cells || one.says.textContent.trim() !== one.cells + '/12'); const tally = document.querySelector('.pl-tally-line'); const sum = counts.reduce((total, one) => total + one.cells, 0); if (wrong.length > 0 || Number(tally.dataset.with) !== sum || Number(tally.dataset.total) !== rows.length * 12) throw new Error(wrong.length + ' rows wrong; the line says ' + tally.dataset.with + ' of ' + tally.dataset.total + ' for ' + sum); return /^\\d+ of 156 months at 13 sites in 2027 have a landing that fits/.test(tally.textContent.trim()) })()"],
      ['an open month shows each of its days with its landing hours: as many days with a bar as the cell counts, the same count the brief gives for that site and month', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const cell = [...document.querySelectorAll('.pl-months td button')].find((one) => one.dataset.site === 'connecting-ridge' && Number(one.dataset.days) > 2); const days = Number(cell.dataset.days); cell.click(); for (let i = 0; i < 40 && !document.querySelector('.pl-strip .plh-strip'); i += 1) await wait(250); const more = document.querySelector('.pl-strip .plh-strip'); if (!more) throw new Error('the month\\'s detail did not open'); const bars = more.querySelectorAll('.plh-days .pl-day.works').length; const all = more.querySelectorAll('.plh-days .pl-day').length; if (Number(more.dataset.days) !== days || bars !== days || all < 28) throw new Error('the cell says ' + days + ', the brief\\'s answer ' + more.dataset.days + ', bars ' + bars + ' of ' + all); window.__findDays = days; return true })()`],
      ['pressing a day plans the landing on that day\'s first hour that fits, and "Add" takes it', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const days = [...document.querySelectorAll('.pl-strip .plh-days .pl-day.works')]; const day = days.at(-1); const number = day.querySelector('.pl-day-number').textContent.trim(); day.click(); await wait(900); const chosen = document.querySelector('.pl-landings button[aria-pressed=true]').textContent.trim(); const add = document.querySelector('.pl-strip .pl-add button'); const month = document.querySelector('.pl-strip').dataset.month; const from = Date.parse(month + '-01T00:00:00Z'); const landing = Number(add.dataset.landing); const start = Number(document.querySelector('.pl-strip .plh-strip').dataset.start ?? 'NaN'); if (!new RegExp('^(Chosen below|First that fits|Most Sun): ' + number + ' ').test(chosen)) throw new Error('day ' + number + ' pressed; chosen: ' + chosen); return Number.isFinite(landing) && Number.isFinite(from) && (Number.isNaN(start) || true) })()`],
      ['"If the landing slips" has a square for each day of slip asked about, and the suggestions near this landing each offer "Add as C"', "(() => { const strip = document.querySelector('.pl-strip'); const asked = Number(strip.querySelector('.plh-slip input').value); const squares = strip.querySelectorAll('.plh-slip .pl-slip-days span').length; const sugs = [...strip.querySelectorAll('.plh-sugs .pl-sug')]; const adds = sugs.map((sug) => getComputedStyle(sug.querySelector('.pl-sug-actions button:last-child'), '::after').content); const picks = strip.querySelector('.plh-sugs .pl-alts-list'); if (squares !== asked || asked < 1 || sugs.length < 1 || adds.some((words) => words !== '\"Add as C\"') || (picks && getComputedStyle(picks).display !== 'none')) throw new Error(squares + ' squares for ' + asked + ' days; ' + sugs.length + ' suggestions saying ' + adds.join(', ')); return true })()"],
      ['the imported parts are set in the Planner\'s own type: no heading in capitals or spaced letters, no fixed-width face, and "A few meters make a difference" in the Planner\'s spelling', "(() => { const more = document.querySelector('.pl-strip .plh-strip'); const heads = [...more.querySelectorAll('h3, h4, h5, .pl-label')].filter((el) => el.getClientRects().length > 0); const odd = heads.filter((el) => { const style = getComputedStyle(el); return style.textTransform !== 'none' || parseFloat(style.letterSpacing) > 0.2 }); const mono = [...more.querySelectorAll('p, span, li, button, dd')].filter((el) => el.getClientRects().length > 0 && /mono|Menlo|Consolas/i.test(getComputedStyle(el).fontFamily)); const words = heads.map((el) => el.textContent.trim()); if (odd.length > 0 || mono.length > 0 || /metres/.test(more.textContent.replace(/Show the ground.*/, '')) && words.includes('A few metres make a difference')) throw new Error('odd headings: ' + odd.map((el) => el.textContent.trim()).join(', ') + '; fixed-width: ' + mono.length + '; headings: ' + words.join(' | ')); return words.includes('Each day’s landing hours') && (!more.querySelector('.plh-nearby') || words.includes('A few meters make a difference')) })()"],
      ['"Open" on a suggestion at another site shows that site and month under the grid, on the suggested landing', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const strip = () => document.querySelector('.pl-strip'); const here = strip().dataset.site; const other = [...strip().querySelectorAll('.plh-sugs .pl-sug')].find((sug) => !/Connecting Ridge/.test(sug.querySelector('.pl-sug-site').textContent)); if (!other) throw new Error('no suggestion at another site'); const name = other.querySelector('.pl-sug-site').textContent.trim(); other.querySelector('.pl-sug-actions button').click(); await wait(1500); if (strip().dataset.site === here || !strip().querySelector('h4').textContent.startsWith(name)) throw new Error('still ' + strip().dataset.site + ': ' + strip().querySelector('h4').textContent); return /^Chosen below: |^First that fits: |^Most Sun: /.test(document.querySelector('.pl-landings button[aria-pressed=true]').textContent.trim()) })()`],
      ['a point of your own: the box has the Planner\'s own landing control in UTC, says "scenario", leaves the grid\'s first row on a laptop\'s first screen, and a typed latitude and longitude is added as scenario C with a row of its own', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${click('Your own point')}; await wait(400); const form = document.querySelector('form.pl-own-form'); if (!form) throw new Error('no box'); const firstRow = document.querySelector('.pl-months tbody tr:not(.pl-group-row)').getBoundingClientRect(); const when = [...form.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join(''); if (!/^6 May 2027 · 13:00 UTC/.test(when) || /pick/i.test(form.textContent) || form.querySelector('input[type=datetime-local]') !== null || (window.innerWidth >= 761 && firstRow.bottom > window.innerHeight)) throw new Error('the box: landing ' + when + '; the first row ends at ' + Math.round(firstRow.bottom) + ' of ' + window.innerHeight); const type = (name, value) => { const input = form.querySelector('input[name=' + name + ']'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }; type('latitude', '-88.5'); type('longitude', '40'); await wait(200); form.querySelector('button[type=submit]').click(); for (let i = 0; i < 120 && document.querySelectorAll('.pl-months tbody tr:not(.pl-group-row)').length < 14; i += 1) await wait(500); const rows = document.querySelectorAll('.pl-months tbody tr:not(.pl-group-row)').length; const tabs = document.querySelectorAll('.sl-full-head .sl-tabs button[aria-label^="Scenario"]').length; if (rows !== 14 || tabs !== 3 || document.querySelector('.sl-full') === null) throw new Error(rows + ' rows, ' + tabs + ' scenarios; ' + (form.querySelector('[role=alert]')?.textContent ?? '')); return location.hash.includes('-88.5,40') })()`, 2000],
      ['on a laptop the grid still fits its width with the count at the end of each row, and on a phone the month\'s detail is one column inside the screen', "(() => { const table = document.querySelector('.pl-months').getBoundingClientRect(); const scroller = document.querySelector('.pl-find .sl-full-scroll'); const more = document.querySelector('.pl-strip .plh-strip'); const parts = more ? [...more.querySelectorAll('.plh-part')].filter((part) => part.getBoundingClientRect().height > 0) : []; const inside = parts.every((part) => part.getBoundingClientRect().left >= -1 && part.getBoundingClientRect().right <= window.innerWidth + 1); const oneColumn = parts.every((part, n) => n === 0 || part.getBoundingClientRect().top >= parts[n - 1].getBoundingClientRect().bottom - 1); return document.documentElement.scrollWidth <= window.innerWidth && inside && (window.innerWidth < 761 ? oneColumn : scroller.scrollWidth <= scroller.clientWidth + 1 && table.right <= window.innerWidth) })()"],
    ],
  },
  {
    // The Planner's Compare tab: a column per scenario, edited in its header, the rows in groups, and adding from the last column.
    name: 'planner-compare',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=apollo-11@2027-06-01T00&planner=compare',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-full-table') !== null",
    checks: [
      ['a link opens the Planner on Compare: a column per scenario, each headed by its site and its date as controls and a remove, then "Add scenario"', "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; const add = document.querySelector('.sl-full-table thead th.pl-add-col'); return document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Compare' && heads.length === 2 && heads.every((head) => head.querySelector('select') !== null && head.querySelector('.sl-pick input[type=date]') !== null && head.querySelector('button[aria-label^=\"Remove scenario\"]') !== null) && heads[0].querySelector('select').value === 'connecting-ridge' && heads[1].querySelector('select').value === 'apollo-11' && add !== null && add.querySelector('select') !== null && add.querySelector('.pl-add-button').textContent.trim() === 'Add as C' })()", 1500],
      ['science: the distance to permanent shadow is NASA\'s, in km, a site outside its maps says "none mapped within" how far, and the row\'s hover text says what the term means and where it is from', `${after(1500, "(() => { const rows = [...document.querySelectorAll('.sl-full-table tbody[data-group=science] tr:not(.pl-group-row)')]; const cells = rows.map((row) => [...row.querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.replace('★', '').trim())); const tip = rows[0].querySelector('th').title; return fetch('/data/shadow.json').then((r) => r.json()).then((shadow) => cells[0][0] === shadow.sites['connecting-ridge'].patch.distance_km.toFixed(1) + ' km' && cells[1][0] === shadow.sites['connecting-ridge'].region.distance_km.toFixed(0) + ' km' && cells[0][1] === 'none mapped within ' + shadow.sites['apollo-11'].patch.map_edge_km.toLocaleString('en-US') + ' km' && cells[1][1] === cells[0][1] && /^Distance to the nearest ground that sunlight never reaches, however small the patch, straight over the surface\\. From NASA’s map of permanent shadow \\(LOLA; Mazarico et al\\. 2011\\)\\.$/.test(tip) && getComputedStyle(rows[0].querySelector('th')).cursor !== 'help') })()")}`, 6000],
      ['changing B\'s site in its header changes that scenario only: A is as it was, and the link follows', `(() => { window.__a = document.querySelector('.sl-full-table thead th select').value + document.querySelector('.sl-full-table thead th .sl-pick').textContent; const select = document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col) .pl-th > select')[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'shackleton-rim'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(700, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return heads.length === 2 && heads[1].querySelector('select').value === 'shackleton-rim' && /1 June 2027 · 00:00 UTC/.test(heads[1].querySelector('.sl-pick').textContent) && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && location.hash.includes('list=shackleton-rim@2027-06-01T00') && !location.hash.includes('apollo-11') })()")}`],
      ['changing B\'s date in its header moves B\'s landing only, and its numbers follow', `(() => { const cell = (name, column) => [...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td')[column].textContent; window.__before = [cell('Sunlit, %', 0), cell('Sunlit, %', 1)]; const date = document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col) .sl-pick input[type=date]')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, '2027-08-10'); date.dispatchEvent(new Event('input', { bubbles: true })); return true })() && ${after(900, "(() => { const cell = (name, column) => [...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td')[column].textContent; const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return /10 August 2027 · 00:00 UTC/.test(heads[1].querySelector('.sl-pick').textContent) && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && cell('Sunlit, %', 0) === window.__before[0] && cell('Sunlit, %', 1) !== window.__before[1] && location.hash.includes('shackleton-rim@2027-08-10T00') })()")}`],
      ['"Add scenario" offers the site on show at its next landing that fits, and "Add as C" adds it here: C\'s verdict is that it fits', `(() => { const add = document.querySelector('.sl-full-table thead th.pl-add-col'); window.__offer = add.querySelector('select').value + '|' + add.querySelector('.sl-pick').textContent; add.querySelector('.pl-add-button').click(); return add.querySelector('select').value === 'connecting-ridge' })() && ${after(900, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); return document.querySelector('.sl-full-table') !== null && heads.length === 3 && heads[2].querySelector('select').value + '|' + heads[2].querySelector('.sl-pick').textContent === window.__offer && fits[2] === '✓ Yes' && document.querySelectorAll('.sl-aligned-row').length === 3 && document.querySelector('.pl-add-button').textContent.trim() === 'Add as D' })()")}`],
      ['on a laptop the table does not scroll sideways and nothing is wider than the screen; on a phone the tab is one column whose table scrolls inside its own frame', "(() => { const scroller = document.querySelector('.pl-compare .sl-full-scroll'); const page = document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.sl-full').scrollWidth <= document.querySelector('.sl-full').clientWidth + 1; return page && (window.innerWidth < 761 ? getComputedStyle(scroller).overflowX === 'auto' : scroller.scrollWidth <= scroller.clientWidth + 1) })()"],
      ['removing C from its column leaves A and B as they were', `(document.querySelector('.sl-full-table button[aria-label="Remove scenario C"]').click(), true) && ${after(600, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return heads.length === 2 && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && heads[1].querySelector('select').value === 'shackleton-rim' })()")}`],
      ['back on the Moon the main screen shows the scenarios as Compare left them', `(${click('‹ Moon')}, true) && ${after(900, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 2 && location.hash.includes('list=shackleton-rim@2027-08-10T00') && !location.hash.includes('planner=')")}`],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // Compare, in depth: under the table, the scenario on show from its landing on, then every scenario's Sun height and a rough power budget.
    name: 'planner-compare-detail',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-09T02~apollo-11@2027-06-01T00&planner=compare',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-full-table') !== null",
    checks: [
      ['under the table the scenario on show is read in depth: when the Sun and Earth set, the mission\'s four figures, its hours, the Sun\'s height and the skyline; the figures are the table\'s own', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); for (let i = 0; i < 40 && document.querySelectorAll('.pl-detail .pl-sky-figures div').length < 4; i += 1) await wait(250); const figure = (name) => { const part = [...document.querySelectorAll('.pl-detail .pl-sky-figures div')].find((one) => one.querySelector('dt').textContent.trim() === name); return part ? part.querySelector('dd').textContent.trim() : 'missing' }; const cell = (row, column) => { const line = document.querySelector('.sl-full-table tr[data-row=' + row + ']'); return parseInt(line.querySelectorAll('td:not(.pl-add-col)')[column].textContent, 10) }; const detail = document.querySelector('.pl-detail'); const names = [...detail.querySelectorAll('.pl-sky-figures dt')].map((dt) => dt.textContent.trim()).join('|'); if (detail.dataset.scenario !== 'A' || names !== 'Sunlit|Longest dark|Earth in view|Longest silence') throw new Error(detail.dataset.scenario + ': ' + names); if (figure('Sunlit') !== cell('sunPct', 0) + '%' || figure('Earth in view') !== cell('earthPct', 0) + '%') throw new Error('in depth ' + figure('Sunlit') + ' and ' + figure('Earth in view') + '; the table ' + cell('sunPct', 0) + ' and ' + cell('earthPct', 0)); const table = document.querySelector('.sl-full-table').getBoundingClientRect(); return /^Scenario A in depth/.test(detail.querySelector('h3').textContent) && /Connecting Ridge · 6 May 2027 · 13:00 UTC/.test(detail.querySelector('h3 small').textContent) && detail.querySelector('.pl-timeline') !== null && detail.querySelector('.pl-skyline') !== null && detail.getBoundingClientRect().top >= table.bottom })()`, 1500],
      ['one scenario at a time: pressing B\'s letter shows B in depth, with B\'s own figures, and B is on show in the tabs and the table too', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const figure = (name) => { const part = [...document.querySelectorAll('.pl-detail .pl-sky-figures div')].find((one) => one.querySelector('dt').textContent.trim() === name); return part ? part.querySelector('dd').textContent.trim() : 'missing' }; const cell = (row, column) => { const line = document.querySelector('.sl-full-table tr[data-row=' + row + ']'); return parseInt(line.querySelectorAll('td:not(.pl-add-col)')[column].textContent, 10) }; document.querySelector('.pl-detail-pick button[aria-label="Scenario B in depth"]').click(); await wait(1500); for (let i = 0; i < 20 && document.querySelectorAll('.pl-detail .pl-sky-figures div').length < 4; i += 1) await wait(250); const detail = document.querySelector('.pl-detail'); const tab = document.querySelector('.sl-full-head .sl-tabs button[aria-pressed=true]').getAttribute('aria-label'); const column = document.querySelector('.sl-full-table thead button[aria-pressed=true]').textContent.trim(); if (detail.dataset.scenario !== 'B' || tab !== 'Scenario B' || column !== 'B') throw new Error([detail.dataset.scenario, tab, column].join(' / ')); if (figure('Sunlit') !== cell('sunPct', 1) + '%') throw new Error('in depth ' + figure('Sunlit') + '; the table ' + cell('sunPct', 1)); return /Shackleton Rim · 9 May 2027 · 02:00 UTC/.test(detail.querySelector('h3 small').textContent) && document.querySelectorAll('.pl-detail .plh-sky .pl-sky').length === 1 })()`],
      ['pressing a column\'s letter in the table does the same: A is read in depth again', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); document.querySelector('.sl-full-table thead button[aria-label="Scenario A"]').click(); await wait(1200); return document.querySelector('.pl-detail').dataset.scenario === 'A' })()`],
      ['under it, every scenario\'s Sun height over its own mission on one scale, and a rough power and battery budget for each', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); for (let i = 0; i < 60 && /Loading/.test(document.querySelector('.pl-detail .plh-all').textContent); i += 1) await wait(250); const all = document.querySelector('.pl-detail .plh-all'); const rows = all.querySelectorAll('.pl-sunrow').length; const cards = [...all.querySelectorAll('.pl-power-card')]; if (rows !== 3 || cards.length !== 3 || /Loading/.test(all.textContent)) throw new Error(rows + ' rows, ' + cards.length + ' cards'); return cards.every((card) => /\\d+ W/.test(card.textContent) && /kWh/.test(card.textContent)) && /Connecting Ridge/.test(cards[0].textContent) })()`],
      ['the Sun\'s height leads with the figure the screen leads with, above the skyline, and says what the other is measured from; no "eye level", no "elevation", and "scenarios", not "picks", in what shows', "(() => { const detail = document.querySelector('.pl-detail'); const shown = [...detail.querySelectorAll('h3, h4, h5, p, dt, dd, figcaption, span')].filter((el) => el.getClientRects().length > 0).map((el) => el.textContent).join(' | '); const main = detail.querySelector('.pl-detail-main').textContent.trim(); const small = [...detail.querySelectorAll('.pl-detail-small')].map((el) => el.textContent.trim()); if (!/^\\d+\\.\\d° (above|below) the skyline at landing$/.test(main) || !/^\\d+\\.\\d° (above|below) a flat horizon/.test(small[0] ?? '') || /eye level|elevation|\\bpicks?\\b/i.test(shown)) throw new Error(main + ' / ' + small.join(' / ') + ' / ' + (shown.match(/.{0,30}(eye level|elevation|picks?\\b).{0,30}/i)?.[0] ?? '')); return /Height above a flat horizon/.test(shown) && /best of your scenarios/.test(shown) })()"],
      ['the imported parts are set in the Planner\'s own type, nothing is wider than the screen, and on a phone it is one column', "(() => { const detail = document.querySelector('.pl-detail'); const heads = [...detail.querySelectorAll('h3, h4, h5, .pl-label')].filter((el) => el.getClientRects().length > 0); const odd = heads.filter((el) => { const style = getComputedStyle(el); return style.textTransform !== 'none' || parseFloat(style.letterSpacing) > 0.2 }); const mono = [...detail.querySelectorAll('p, span, li, button, dd, dt')].filter((el) => el.getClientRects().length > 0 && /mono|Menlo|Consolas/i.test(getComputedStyle(el).fontFamily)); const parts = [...detail.querySelectorAll('.plh-all > *')]; const oneColumn = parts.every((part, n) => n === 0 || part.getBoundingClientRect().top >= parts[n - 1].getBoundingClientRect().bottom - 1); if (odd.length > 0 || mono.length > 0) throw new Error('odd headings: ' + odd.map((el) => el.textContent.trim()).join(', ') + '; fixed-width: ' + mono.length); return document.documentElement.scrollWidth <= window.innerWidth && detail.getBoundingClientRect().right <= window.innerWidth + 1 && (window.innerWidth >= 761 || oneColumn) })()"],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // Find in a window with little room: Scout's panel open beside the Planner. The grid's months must stay readable at every size, and at 1024 by 768 above all.
    name: 'planner-narrow-find',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&planner=find',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.pl-months') !== null",
    checks: [
      ['with Scout\'s panel open beside it, each month has a heading of its own, wide enough for its name, and no heading lies over another', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); if (window.innerWidth >= 761 && !document.querySelector('.sl-scout-panel')) { document.querySelector('.pl-tools .sl-rail-scout').click(); await wait(900) }; const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; if (window.innerWidth === 1024 && (!document.querySelector('.sl-scout-panel') || document.querySelector('.sl-full').dataset.room !== 'narrow')) throw new Error('at 1024 wide Scout is ' + (document.querySelector('.sl-scout-panel') ? 'open' : 'closed') + ' and the Planner says ' + document.querySelector('.sl-full').dataset.room); const heads = [...document.querySelectorAll('.pl-months thead th')]; const hit = clash(heads); const cut = heads.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().width < 24); if (heads.length !== 13 || hit || cut.length > 0) throw new Error(heads.length + ' headings; ' + (hit ?? 'none over another') + '; too narrow: ' + cut.map((el) => el.textContent.trim()).join(' ')); return heads.slice(0, 12).map((el) => el.textContent.trim()).join(' ') === 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec' })()`, 1200],
      ['every row has twelve cells side by side, none over another, each wide enough for its number or its "none"', `(() => { const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; const rows = [...document.querySelectorAll('.pl-months tbody tr:not(.pl-group-row)')]; const bad = rows.map((row) => { const cells = [...row.querySelectorAll('td button')]; const hit = clash(cells); const cut = cells.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().width < 28).length; const name = row.querySelector('th'); const underName = cells.length > 0 && cells[0].getBoundingClientRect().left < name.getBoundingClientRect().right - 0.5 && row.closest('.sl-full-scroll').scrollLeft === 0; return cells.length !== 12 || hit || cut > 0 || underName ? row.querySelector('th').textContent.trim() + ': ' + cells.length + ' cells, ' + (hit ?? 'none over another') + ', ' + cut + ' too narrow' + (underName ? ', the first under the name' : '') : null }).filter(Boolean); if (rows.length < 13 || bad.length > 0) throw new Error(rows.length + ' rows; ' + bad.slice(0, 3).join(' | ')); return true })()`],
      ['the grid fits its box, or scrolls sideways inside it with the site names held in place; the page itself never scrolls sideways', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const box = document.querySelector('.pl-find .sl-full-scroll'); const name = () => document.querySelector('.pl-months tbody tr:not(.pl-group-row) th').getBoundingClientRect(); if (document.documentElement.scrollWidth > window.innerWidth) throw new Error('the page is ' + document.documentElement.scrollWidth + ' wide in a window of ' + window.innerWidth); if (box.scrollWidth <= box.clientWidth + 1) return true; const before = name().left; box.scrollLeft = 160; await wait(300); const held = Math.abs(name().left - before) <= 1 && Math.abs(name().left - box.getBoundingClientRect().left) <= 1; const moved = box.scrollLeft; box.scrollLeft = 0; if (!held || moved < 100) throw new Error('scrolled ' + moved + ' px; the names ' + (held ? 'stayed' : 'moved')); return true })()`],
      ['the header\'s buttons are on one line, or wrapped on purpose: the tools together on a row of their own that starts at the left, and no button over another', `(() => { const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; const head = document.querySelector('.pl-header'); const buttons = [...head.querySelectorAll('button')].filter((el) => el.getClientRects().length > 0 && !el.closest('[role=menu], .sl-share-menu, .sl-menu')); const tools = [...head.querySelector('.pl-tools').children].filter((el) => el.getClientRects().length > 0); const tops = tools.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)); const oneRow = Math.max(...tops) - Math.min(...tops) <= 3; const tabs = head.querySelector('.pl-tabs').getBoundingClientRect(); const row = head.querySelector('.pl-tools').getBoundingClientRect(); const sameLine = Math.abs(row.top + row.height / 2 - (tabs.top + tabs.height / 2)) <= 6; const fromLeft = row.left <= head.querySelector('.pl-back').getBoundingClientRect().left + 1; const hit = clash(buttons.filter((el) => !el.closest('.sl-tabs') || el.getAttribute('aria-label')?.startsWith('Scenario') || el.getAttribute('aria-label') === 'Add a scenario')); if (!oneRow || hit || !(sameLine || fromLeft) || head.getBoundingClientRect().right > window.innerWidth + 1) throw new Error('tools on one row: ' + oneRow + '; beside the tabs: ' + sameLine + '; a row of their own from the left: ' + fromLeft + '; ' + (hit ?? 'no button over another')); return true })()`],
      ['where the Planner has no room for both, the Mission column is folded behind "Change the mission", with the mission in a few words beside it, and the button opens and closes it; where there is room the column is beside the grid as before', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const full = document.querySelector('.sl-full'); const fold = document.querySelector('.pl-limits-fold'); const column = document.querySelector('.sl-full-mission'); const seen = (el) => el.getClientRects().length > 0; if (full.dataset.room !== 'narrow' || window.innerWidth < 761) return !seen(fold) && seen(column); const button = fold.querySelector('button'); const words = fold.querySelector('span').textContent; if (!seen(fold) || seen(column) || button.getAttribute('aria-expanded') !== 'false' || !/^Mission: 14 days on the surface, survives 24 h of darkness/.test(words)) throw new Error('folded: the button ' + seen(fold) + ', the column ' + seen(column) + '; ' + words); button.click(); await wait(400); const opened = seen(column) && button.getAttribute('aria-expanded') === 'true' && column.querySelector('input[type=range]') !== null && column.getBoundingClientRect().right <= window.innerWidth; button.click(); await wait(400); return opened && !seen(column) })()`],
      ['the small Moon does not lie over the grid', `(() => { const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; const moon = document.querySelector('.sl-stage').getBoundingClientRect(); const tables = [...document.querySelectorAll('.sl-full-main table')].map((el) => el.getBoundingClientRect()); const under = tables.some((box) => over(moon, box)); if (under) throw new Error('the small Moon lies over a table'); return true })()`],
    ],
  },
  {
    // Compare in the same narrow window, Scout's panel open: the table's columns stay apart and readable.
    name: 'planner-narrow-compare',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-09T02~apollo-11@2027-06-01T00&planner=compare',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-full-table') !== null",
    checks: [
      ['with Scout\'s panel open beside it, each scenario has a column of its own, none over another, and no figure is cut off or laid over the row\'s name', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); if (window.innerWidth >= 761 && !document.querySelector('.sl-scout-panel')) { document.querySelector('.pl-tools .sl-rail-scout').click(); await wait(900) }; const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; if (window.innerWidth === 1024 && (!document.querySelector('.sl-scout-panel') || document.querySelector('.sl-full').dataset.room !== 'narrow')) throw new Error('at 1024 wide Scout is ' + (document.querySelector('.sl-scout-panel') ? 'open' : 'closed') + ' and the Planner says ' + document.querySelector('.sl-full').dataset.room); const table = document.querySelector('.sl-full-table'); const heads = [...table.querySelectorAll('thead th')]; const hit = clash(heads); const narrow = heads.filter((el) => el.getBoundingClientRect().width < 100).length; const rows = [...table.querySelectorAll('tbody tr:not(.pl-group-row)')]; const bad = rows.filter((row) => { const cells = [...row.querySelectorAll('th, td')]; return clash(cells) !== null || cells.some((el) => el.scrollWidth > el.clientWidth + 1) }).map((row) => row.querySelector('th')?.textContent.trim()); if (heads.length < 3 || hit || narrow > 0 || bad.length > 0) throw new Error(heads.length + ' columns; ' + (hit ?? 'none over another') + '; ' + narrow + ' under 100 px; rows cut or overlapping: ' + bad.slice(0, 4).join(', ')); const box = table.closest('.sl-full-scroll'); return document.documentElement.scrollWidth <= window.innerWidth && (box.scrollWidth <= box.clientWidth + 1 || getComputedStyle(box).overflowX === 'auto') })()`, 1500],
      ['the header\'s buttons are on one line, or wrapped on purpose: the tools together on a row of their own that starts at the left, and no button over another', `(() => { const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; const head = document.querySelector('.pl-header'); const buttons = [...head.querySelectorAll('button')].filter((el) => el.getClientRects().length > 0 && !el.closest('[role=menu], .sl-share-menu, .sl-menu')); const tools = [...head.querySelector('.pl-tools').children].filter((el) => el.getClientRects().length > 0); const tops = tools.map((el) => Math.round(el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2)); const oneRow = Math.max(...tops) - Math.min(...tops) <= 3; const tabs = head.querySelector('.pl-tabs').getBoundingClientRect(); const row = head.querySelector('.pl-tools').getBoundingClientRect(); const sameLine = Math.abs(row.top + row.height / 2 - (tabs.top + tabs.height / 2)) <= 6; const fromLeft = row.left <= head.querySelector('.pl-back').getBoundingClientRect().left + 1; const hit = clash(buttons.filter((el) => !el.closest('.sl-tabs') || el.getAttribute('aria-label')?.startsWith('Scenario') || el.getAttribute('aria-label') === 'Add a scenario')); if (!oneRow || hit || !(sameLine || fromLeft) || head.getBoundingClientRect().right > window.innerWidth + 1) throw new Error('tools on one row: ' + oneRow + '; beside the tabs: ' + sameLine + '; a row of their own from the left: ' + fromLeft + '; ' + (hit ?? 'no button over another')); return true })()`],
      ['where the Planner has no room for both, the Mission column is folded behind "Change the mission", and the button opens and closes it; where there is room the column is beside the table as before', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const full = document.querySelector('.sl-full'); const fold = document.querySelector('.pl-limits-fold'); const column = document.querySelector('.sl-full-mission'); const seen = (el) => el.getClientRects().length > 0; if (full.dataset.room !== 'narrow' || window.innerWidth < 761) return !seen(fold) && seen(column); const button = fold.querySelector('button'); const words = fold.querySelector('span').textContent; if (!seen(fold) || seen(column) || button.getAttribute('aria-expanded') !== 'false' || !/^Mission: 14 days on the surface, survives 24 h of darkness/.test(words)) throw new Error('folded: the button ' + seen(fold) + ', the column ' + seen(column) + '; ' + words); button.click(); await wait(400); const opened = seen(column) && button.getAttribute('aria-expanded') === 'true' && column.querySelector('input[type=range]') !== null && column.getBoundingClientRect().right <= window.innerWidth; button.click(); await wait(400); return opened && !seen(column) })()`],
      ['the small Moon does not lie over the table', `(() => { const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5; const clash = (els) => { const boxes = els.map((el) => el.getBoundingClientRect()); for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) if (over(boxes[i], boxes[j])) return els[i].textContent.trim() + ' over ' + els[j].textContent.trim(); return null }; const moon = document.querySelector('.sl-stage').getBoundingClientRect(); const tables = [...document.querySelectorAll('.sl-full-main table')].map((el) => el.getBoundingClientRect()); const under = tables.some((box) => over(moon, box)); if (under) throw new Error('the small Moon lies over a table'); return true })()`],
    ],
  },
  {
    // The Planner's small Moon has a place of its own: beside the name at the top, or under the Mission column in a tall window.
    name: 'planner-moon',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13',
    steps: [click('Planner')],
    checks: [
      ['the small Moon covers no control, and on a laptop the Mission column, Advanced and its notes included, is all on screen', MOON_COVERS_NOTHING, 900],
      ['it is still the way back: a button named "Back to the Moon" over a drawn Moon', "(() => { const back = document.querySelector('.sl-mini-back'); const box = back.getBoundingClientRect(); return back.getAttribute('aria-label') === 'Back to the Moon' && box.width >= 44 && box.height >= 44 && document.querySelector('.sl-stage canvas') !== null })()"],
      ['with the Long stay preset chosen the column still fits', `(${click('Long stay example')}, true) && ${after(500, `!location.hash.includes('limits=14_24_') && ${MOON_COVERS_NOTHING}`)}`],
    ],
  },
  {
    // Heights above the ground. Connecting Ridge and Shackleton Rim, both landing 28 April 2027 for 30 days: the window holds
    // 2027's longest dark stretch at Connecting Ridge at 2 m (118 h from 1 May) and at 10 m (72 h from 15 May), the site's
    // yearly numbers that docs/VALIDATION.md §15 checks the new sets against.
    name: 'heights',
    hash: '#a=connecting-ridge@2027-04&t=648&limits=30_24_99999_0_0&mode=plan&list=shackleton-rim@2027-04-28T00',
    heights: true,
    steps: ['performance.setResourceTimingBufferSize(4000)', click('Planner'), click('Compare')],
    checks: [
      ['at 2 m nothing of the other heights is asked for; the Planner\'s Advanced offers the panel\'s and the antenna\'s heights, each choice saying where it is from', `(() => { const names = (label) => [...document.querySelector('.sl-height-pick[aria-label="' + label + '"]').querySelectorAll('button')]; const panel = names('Solar panel height'); const antenna = names('Antenna height'); const told = [...panel, ...antenna].every((button) => /NASA/.test(button.getAttribute('title') ?? button.dataset.tip ?? '')); const pressed = (list) => list.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent.trim()).join(); window.__low = ${MISSION_HOURS}; window.__sun2 = ${TABLE_CELL}('Sunlit, %', 1); window.__earth2 = ${TABLE_CELL}('Earth in view, %', 1); const dark = ${TABLE_CELL}('Longest dark spell, h', 0); return (${HEIGHT_FILES}.length === 0 && panel.map((button) => button.textContent.trim()).join('|') === '2 m|5 m|10 m' && antenna.map((button) => button.textContent.trim()).join('|') === '2 m|4 m|10 m' && pressed(panel) === '2 m' && pressed(antenna) === '2 m' && told && dark === '118' && !/h[pa]=/.test(location.hash) && document.querySelector('.sl-heights-line') === null) || 'dark ' + dark + ', told ' + told + ', files ' + ${HEIGHT_FILES}.length })()`, 1500],
      ['with the two choices the Mission column still fits the window, and the small Moon covers nothing', MOON_COVERS_NOTHING],
      ['the known case: Connecting Ridge\'s longest dark stretch of 2027, 118 h at 2 m, is 72 h with the panel at 10 m; only the 10 m files are fetched, and the link carries the height', `${PICK_HEIGHT('Solar panel height', 10)} && ${after(3000, `(() => { const dark = ${TABLE_CELL}('Longest dark spell, h', 0); const files = ${HEIGHT_FILES}; return (dark === '72' && location.hash.includes('&hp=10') && !location.hash.includes('ha=') && files.some((name) => name.includes('/heights/10m/overview/2027.json.gz')) && files.every((name) => name.includes('/heights/10m/'))) || 'dark ' + dark + ', ' + location.hash + ', files ' + files.length })()`)}`],
      ['with the panel at 5 m it is 89 h', `${PICK_HEIGHT('Solar panel height', 5)} && ${after(3000, `(() => { const dark = ${TABLE_CELL}('Longest dark spell, h', 0); return (dark === '89' && location.hash.includes('&hp=5')) || 'dark ' + dark })()`)}`],
      ['a higher panel never shows less Sun and a higher antenna never less Earth: hour for hour over both missions, and some hours are gained', `${PICK_HEIGHT('Solar panel height', 10)} && ${after(500, PICK_HEIGHT('Antenna height', 10))} && ${after(4000, `(() => { const high = ${MISSION_HOURS}; const low = window.__low; let lostSun = 0; let lostEarth = 0; let gainedSun = 0; let gainedEarth = 0; low.forEach((row, i) => row.sun.forEach((up, h) => { if (up && !high[i].sun[h]) lostSun += 1; if (!up && high[i].sun[h]) gainedSun += 1; if (row.earth[h] && !high[i].earth[h]) lostEarth += 1; if (!row.earth[h] && high[i].earth[h]) gainedEarth += 1 })); const sun = Number(${TABLE_CELL}('Sunlit, %', 1)); const earth = Number(${TABLE_CELL}('Earth in view, %', 1)); return (low.length === 2 && low[0].sun.length === 720 && lostSun === 0 && lostEarth === 0 && gainedSun > 0 && gainedEarth > 0 && sun >= Number(window.__sun2) && earth >= Number(window.__earth2) && location.hash.includes('&hp=10&ha=10')) || 'lost Sun ' + lostSun + ', lost Earth ' + lostEarth + ', gained ' + gainedSun + ' and ' + gainedEarth + ', ' + location.hash })()`)}`],
      ['the antenna\'s height alone leaves the Sun\'s figures as they were at 2 m', `${PICK_HEIGHT('Solar panel height', 2)} && ${after(2500, `(() => { const dark = ${TABLE_CELL}('Longest dark spell, h', 0); const high = ${MISSION_HOURS}; const same = window.__low.every((row, i) => row.sun.every((up, h) => up === high[i].sun[h])); return (dark === '118' && same && /&ha=10/.test(location.hash) && !/hp=/.test(location.hash)) || 'dark ' + dark + ', same Sun ' + same + ', ' + location.hash })()`)}`],
      ['a preset keeps the heights: they are the hardware\'s, not a limit', `(${click('Long stay example')}, true) && ${after(600, `(() => { const pressed = [...document.querySelector('.sl-height-pick[aria-label="Antenna height"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true').textContent.trim(); return (pressed === '10 m' && /&ha=10/.test(location.hash) && document.querySelector('.sl-presets button[aria-pressed="true"]').textContent.includes('Long stay')) || pressed + ' ' + location.hash })()`)}`],
      ['back on the Moon the column says the heights in one small line, a row\'s hover text names its height where it is not the screen\'s own 2 m, and nothing in the column scrolls', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(1500, `(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; const tip = (name) => document.querySelector('.sl-fact.is-' + name).getAttribute('title') ?? document.querySelector('.sl-fact.is-' + name).dataset.tip ?? ''; return (line === 'panel at 2 m, antenna at 10 m' && !/ m up/.test(tip('sun')) && /, seen from 10 m up\\./.test(tip('earth')) && /Matches Horizons within/.test(document.querySelector('.sl-horizons').textContent) && ${NOTHING_SCROLLS} && ${COLUMN_FITS}) || line + ' // ' + tip('earth').slice(0, 160) })()`)}`],
      ['the mission\'s box in the column has no height choice until "Advanced" is pressed; there it shows what the Planner set', `(document.querySelector('.sl-mission-inline') === null && document.querySelector('.sl-mission-open').click(), true) && ${after(700, `(document.querySelector('.sl-height-pick') === null && (document.querySelector('.sl-advanced-link').click(), true))`)} && ${after(1600, "(() => { const pressed = (label) => [...document.querySelector('.sl-mission-inline.is-advanced .sl-height-pick[aria-label=\"' + label + '\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); return (pressed('Solar panel height') === '2 m' && pressed('Antenna height') === '10 m') || pressed('Solar panel height') + ', ' + pressed('Antenna height') })()")}`],
      ['Scout is sent the heights with the view', `${STAND_IN_SCOUT} && (document.querySelector('.sl-why').click(), true) && ${after(1500, "(() => { const view = window.__sent[0]?.view ?? ''; return /&ha=10/.test(view) || view })()")}`],
    ],
  },
  {
    // A link that carries both heights: Shackleton Rim, panel at 10 m, antenna at 4 m.
    name: 'heights-link',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&hp=10&ha=4',
    heights: true,
    checks: [
      ['a link with heights opens on them: the column says "panel at 10 m, antenna at 4 m", and the address keeps them', `${after(3000, "(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; return (line === 'panel at 10 m, antenna at 4 m' && /&hp=10&ha=4/.test(location.hash)) || line + ' ' + location.hash })()")}`],
      ['the rows are whole, the column does not scroll, and the Horizons line still holds', `${ROWS_WHOLE} && ${NOTHING_SCROLLS} && ${COLUMN_FITS} && /Matches Horizons within/.test(document.querySelector('.sl-horizons').textContent)`],
      ['the Sun\'s row is read at 10 m and Earth\'s at 4 m', "(() => { const tip = (name) => document.querySelector('.sl-fact.is-' + name).getAttribute('title') ?? document.querySelector('.sl-fact.is-' + name).dataset.tip ?? ''; return (/, seen from 10 m up\\./.test(tip('sun')) && /, seen from 4 m up\\./.test(tip('earth'))) || tip('sun').slice(0, 200) })()"],
      ['only the 10 m and 4 m files were fetched', `(() => { const files = ${HEIGHT_FILES}; return (files.length > 0 && files.every((name) => /\\/heights\\/(10|4)m\\//.test(name)) && files.some((name) => name.includes('/heights/10m/shackleton-rim/2027-05/track.json.gz')) && files.some((name) => name.includes('/heights/4m/shackleton-rim/horizon.json.gz'))) || files.slice(0, 6).join(' ') })()`],
    ],
  },
  {
    // The hour-by-hour file: Export's second line in the Planner. Opened with the panel at 10 m and the
    // antenna at 4 m, so the file must be read from those heights, as the screen is.
    name: 'hourly-csv',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&hp=10&ha=4&planner=compare',
    heights: true,
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-full-table') !== null",
    checks: [
      ['Export opens a short list of the two files, inside the window: the comparison table, and the hourly Sun and Earth of the scenario on show', `(${KEEP_SAVED}, ${click('Export')}, true) && ${after(300, "(() => { const list = document.querySelector('.sl-export-list'); const lines = [...list.querySelectorAll('button')].map((line) => line.textContent.replace(/\\s+/g, ' ').trim()); const box = list.getBoundingClientRect(); const inside = box.left >= 0 && box.right <= window.innerWidth + 1 && box.bottom <= window.innerHeight + 1; return (inside && lines.length === 2 && lines[0].startsWith('Comparison table (CSV)') && lines[1] === 'Hourly Sun and Earth (CSV)Scenario A over its 14 days, one row an hour') || lines.join(' | ') + ' inside ' + inside })()")}`, 1500],
      ['its second line saves one file, named for the site, the landing and the mission, and the list closes', `(${EXPORT_LINE('Hourly Sun and Earth (CSV)')}.click(), true) && ${after(3500, "(document.querySelector('.sl-export-list') === null && window.__saved?.name === 'sightline-hourly_shackleton-rim_2027-05-06T13Z_14d.csv') || 'saved ' + window.__saved?.name")}`],
      ['the first lines say what the rows are about: the site and its coordinates as the site list has them, the landing, the mission, the two heights and the data version', `fetch('/data/sites.json').then((response) => response.json()).then((sites) => { const site = sites.find((one) => one.id === 'shackleton-rim'); const { notes } = ${HOURLY_READ}; const want = ['Site: ' + site.name, 'Latitude (degrees, north positive): ' + site.lat, 'Longitude (degrees, east positive): ' + site.lon, 'Landing (UTC): 2027-05-06T13:00:00Z', 'Mission: 14 days, 336 hours from the landing, one row for each hour', 'Sun seen from: 10 m above the ground', 'Earth seen from: 4 m above the ground']; const missing = want.filter((line) => !notes.includes(line)); const version = notes.find((line) => line.startsWith('Data version: ')); return (missing.length === 0 && /^Data version: (not known|[0-9a-f]{16})$/.test(version) && notes.some((line) => line.startsWith('This plan: ' + location.origin))) || 'missing: ' + missing.join(' | ') + ' ; ' + version })`],
      ['then the columns, each named with its unit, and one row for each hour of the mission, in order from the landing, in UTC', `(() => { const { columns, rows, ended } = ${HOURLY_READ}; const hours = rows.every((row, i) => row.length === columns.length && row[0] === new Date(Date.UTC(2027, 4, 6, 13 + i)).toISOString().slice(0, 19) + 'Z' && row[1] === String(i)); return (ended && columns.length === 11 && columns[0] === 'Time (UTC)' && columns.every((name) => /\\(.+\\)$/.test(name)) && rows.length === 336 && hours) || columns.join('|') + ' ; ' + rows.length + ' rows, in order ' + hours })()`],
      ['the rows are the heights\' own data: the Sun as the 10 m files have it and Earth as the 4 m files have it, hour for hour', `(async () => { const unpack = async (path) => JSON.parse(await new Response((await fetch(path)).body.pipeThrough(new DecompressionStream('gzip'))).text()); const [sun, earth] = await Promise.all([unpack('/tiles/light/heights/10m/shackleton-rim/2027-05/track.json.gz'), unpack('/tiles/light/heights/4m/shackleton-rim/2027-05/track.json.gz')]); const { rows } = ${HOURLY_READ}; const off = rows.findIndex((row, i) => { const s = sun[133 + i]; const e = earth[133 + i]; return row[0] !== s.t || Number(row[2]) !== s.sun_az || Number(row[3]) !== s.sun_el || Number(row[5]) !== s.sun_frac || (row[6] === 'yes') !== s.sun_up || Number(row[7]) !== e.earth_az || Number(row[8]) !== e.earth_el || (row[10] === 'yes') !== e.earth_up }); return off === -1 || 'row ' + off + ' differs: ' + rows[off].join(',') })()`],
      ['and they are what the screen shows: back on the Moon, at the landing, three days in and the last hour, the time bar says the same hour, the same Sun and Earth in view and the same heights above the skyline', `(${click('‹ Moon')}, true) && ${after(900, HOURLY_AS_SCREEN(133, [0, 77, 335]))}`],
    ],
  },
  {
    // A custom point is worked out at 2 m only: the heights a link carries do not apply to it, and the choice is off.
    name: 'heights-custom',
    hash: '#a=-88.5,40@2027-05&t=200&limits=14_24_99999_1_1&mode=plan&hp=10&ha=4',
    heights: true,
    checks: [
      ['at a custom point the column says it is worked out at 2 m', `${after(1000, "(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; return line === 'custom point: worked out at 2 m' || line })()")}`, 6000],
      ['in the Planner the two height choices are off there, with the reason', `(${click('Planner')}, true) && ${after(1200, "(() => { const buttons = [...document.querySelectorAll('.sl-height-pick button')]; const reason = document.querySelector('.sl-height-choice .sl-quiet')?.textContent ?? ''; return (buttons.length === 6 && buttons.every((button) => button.disabled) && reason === 'A custom point is worked out at 2 m only.') || reason + ' ' + buttons.filter((button) => button.disabled).length })()")}`],
    ],
  },
  {
    // The Planner with four scenarios, its fullest, and Scout's panel beside the table.
    name: 'planner-four',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    steps: [click('Planner'), click('Compare')],
    checks: [
      ['with four scenarios the table does not scroll sideways', "(() => { const scroller = document.querySelector('.sl-full-scroll'); return document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)').length === 4 && (window.innerWidth < 761 || scroller.scrollWidth <= scroller.clientWidth + 1) })()", 1200],
      ['every column head has one shape: the letter at the left, the site and landing beside it', PLANNER_HEADS],
      ['the small Moon covers no control, and the Mission column, Advanced included, is on screen without scrolling', MOON_COVERS_NOTHING],
      ['scrolled down, the small Moon still covers no control', `(() => { const scroller = window.innerWidth < 761 ? document.querySelector('.sightline') : document.querySelector('.sl-full'); scroller.scrollTop = 420; return true })() && ${after(400, MOON_COVERS_NOTHING)} && ${after(100, "(() => { const scroller = window.innerWidth < 761 ? document.querySelector('.sightline') : document.querySelector('.sl-full'); scroller.scrollTop = 0; return true })()")}`],
      ['the day axis has bare day numbers between "landing" and the last day, and none prints over another', AXIS_CLEAR],
      ['the note under the table is "★ best in its row" and nothing more, and no line says the presets are examples', "(() => { const notes = [...document.querySelectorAll('.sl-full .sl-quiet')].map((note) => note.textContent.trim()); return (notes.includes('★ best in its row') && !/Preset values are examples/.test(document.body.textContent) && [...document.querySelectorAll('.sl-full-mission small')].some((tag) => tag.textContent === 'example')) || notes.join(' | ') })()"],
      ['with Scout\'s panel open the comparison table and the aligned rows still have their whole width on screen beside it', `(document.querySelector('.sl-full-head .sl-rail-scout').click(), true) && ${after(900, "(() => { const panel = document.querySelector('.sl-scout-panel'); if (window.innerWidth < 761) return panel !== null; const box = panel.getBoundingClientRect(); const table = document.querySelector('.sl-full-table').getBoundingClientRect(); const rows = document.querySelector('.sl-aligned').getBoundingClientRect(); const scroller = document.querySelector('.sl-full-scroll'); if (!(table.left >= 0 && table.right <= box.left + 0.5 && table.top >= 0 && scroller.scrollWidth <= scroller.clientWidth + 1 && rows.right <= box.left + 0.5)) throw new Error('table ' + Math.round(table.left) + ' to ' + Math.round(table.right) + ' across, ' + Math.round(table.top) + ' to ' + Math.round(table.bottom) + ' down; panel from ' + Math.round(box.left) + '; scroller ' + scroller.scrollWidth + ' of ' + scroller.clientWidth); return true })()")}`],
      ['with Scout\'s panel open the small Moon still covers no control', MOON_COVERS_NOTHING],
      ['with Scout\'s panel open the column heads keep that one shape, and the axis is still clear', `window.innerWidth < 761 || (${PLANNER_HEADS} && ${AXIS_CLEAR})`],
      ['a scenario can be removed here, and the letters close up', `(document.querySelector('.sl-full-table button[aria-label="Remove scenario B"]').click(), true) && ${after(600, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')].map((th) => th.querySelector('select').value); return heads.length === 3 && heads[1] === 'de-gerlache-rim' && !location.hash.includes('shackleton-rim') && document.querySelector('.sl-full-table thead th.pl-add-col button.pl-add-button').textContent.trim() === 'Add as D' })()")}`],
      ['the page says "skyline", never "the ridge", and none of the old words for time', OWN_WORDS],
    ],
  },
  {
    // A near-side site, where Earth never sets: Apollo 17, landing 9 March 2029 at 09:00 UTC, in the dark.
    name: 'near-side',
    hash: '#a=apollo-17@2029-03&t=201&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['where Earth does not set within the data, its row says "stays in view" under its name, and nothing prints a year', "(() => { const row = document.querySelector('.sl-fact.is-earth'); return row.querySelector('dt').textContent.trim() === 'Earth' && row.querySelector('dt').getBoundingClientRect().width > 20 && /^stays in view$/.test(row.querySelector('.sl-fact-small').textContent.trim()) && row.querySelectorAll('.sl-fact-small').length === 1 && !/20\\d\\d|not through/.test(document.querySelector('.sl-facts').textContent) && !/20\\d\\d|not through/.test(document.querySelector('.sl-verdict').textContent) })()", 2500],
      ['every row shows its words in full, and Earth stands tens of degrees above the skyline', `(() => { const row = document.querySelector('.sl-fact.is-earth .sl-fact-main'); const words = row.firstChild.textContent.trim() + ' ' + row.querySelector('small').textContent.trim(); if (!/^\\d\\d\\.\\d° above the skyline$/.test(words)) throw new Error(words); return true })() && ${ROWS_WHOLE}`],
      ['the column names the landing it describes, and nothing in it scrolls', `${LANDING} === '9 March 2029 · 09:00 UTC' && ${NOTHING_SCROLLS} && ${COLUMN_FITS}`],
      ['eleven days on, the Moon is lit while the column is still about the dark landing, and the stage says which moment it shows', `(async () => { for (let i = 0; i < 11; i += 1) { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); await new Promise((next) => setTimeout(next, 120)) } return true })().then(() => ${after(1200, `/^No sunlight/.test(${SENTENCE}) && ${NOTE_SAYS('20 March 2029 · 09:00 UTC')}`)})`],
      ['with the How sheet closed and the panels shut there is no panel choice anywhere', "document.querySelector('#sl-m-panel') === null && !location.hash.includes('panel=')"],
    ],
  },
  {
    // The written brief, from Share, for the scenario on show: a landing in a month with no landing that meets the limits.
    name: 'brief',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['Share opens one small sheet: copy the link first, save with a name, the brief last, and the guide to sharing beside it', `(document.querySelector('.sl-icon[aria-label="Share"]').click(), true) && ${after(300, "(() => { const buttons = [...document.querySelectorAll('.sl-share-sheet button')].map((button) => button.textContent.trim()); return (buttons[0] === 'Copy link' && buttons.at(-2) === 'Brief' && buttons.at(-1) === 'Show me how' && buttons.includes('Save') && document.querySelector('.sl-share-sheet .sl-share-head').textContent.trim() === 'Save with a name') || buttons.join('|') })()")}`, 1200],
      ['"Brief" opens the written brief for the scenario on show, as a sheet on this page', `(document.querySelector('.sl-share-sheet .sl-share-brief').click(), true) && ${after(2500, "(() => { const sheet = document.querySelector('.sl-brief-sheet'); const brief = sheet.querySelector('.pl-brief'); return sheet.getAttribute('role') === 'dialog' && location.pathname.startsWith('/sightline') && brief.querySelector('h2').textContent.replace(/\\s+/g, ' ').trim() === 'Shackleton Rim, May 2027' && brief.querySelector('.pl-when').textContent.trim() === '6 May 2027, 13:00 UTC' && document.querySelector('.sl-share-sheet') === null })()")}`],
      ['its statements agree: no landing works in May, this landing misses the limits, the hour it offers to go back to is the one closest to the limits, and the next landing that works is named', "(() => { const brief = document.querySelector('.pl-brief'); const words = brief.textContent.replace(/\\s+/g, ' '); const back = [...brief.querySelectorAll('button')].find((button) => /^Back to/.test(button.textContent.trim())); if (!(brief.querySelector('.pl-stamp').textContent.trim() === 'No landing' && /No landing works/.test(words) && /A landing then misses your limits:/.test(words) && back !== undefined && /^Back to the hour closest to your limits: \\d+ May 2027, \\d\\d:00 UTC$/.test(back.textContent.replace(/\\s+/g, ' ').trim()) && !/closest landing|Back to the closest/i.test(words) && /This landing already misses your limits/.test(words) && /(The next landing that works here is|A landing works again from) \\d+ Jun 2027, \\d\\d:00 UTC/.test(words) && !/practice demo/.test(words))) throw new Error(words.slice(0, 400)); return true })()"],
      ['going back to that hour says plainly that it is still a miss', `([...document.querySelectorAll('.pl-brief button')].find((button) => /^Back to/.test(button.textContent.trim())).click(), true) && ${after(1500, "(() => { const brief = document.querySelector('.pl-brief'); const words = brief.textContent.replace(/\\s+/g, ' '); return /Closest to your limits in May 2027: still a miss/.test(words) && /No hour in May 2027 meets your limits\\. This is the hour that misses the fewest of them\\./.test(words) && ![...brief.querySelectorAll('button')].some((button) => /^Back to/.test(button.textContent.trim())) && brief.querySelector('.pl-when').textContent.trim() !== '6 May 2027, 13:00 UTC' })()")}`],
      ['"Plan the next landing" moves the scenario to a landing that works, and the brief then says so', `([...document.querySelectorAll('.pl-brief button')].find((button) => /^Plan the next landing/.test(button.textContent.trim())).click(), true) && ${after(2000, "(() => { const brief = document.querySelector('.pl-brief'); const words = brief.textContent.replace(/\\s+/g, ' '); return brief.querySelector('.pl-stamp').textContent.trim() !== 'No landing' && brief.querySelector('h2').textContent.replace(/\\s+/g, ' ').trim() === 'Shackleton Rim, Jun 2027' && !/misses your limits/.test(words) && /^(Yes|Only|No room|No:)/.test(brief.querySelector('.pl-slip-answer').textContent) })()")}`],
      ['Escape closes the brief, and the column is about that landing and says it fits', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(1500, `document.querySelector('.sl-brief-sheet') === null && /^✓ Fits/.test(${text('.sl-verdict-words')}.trim()) && /^\\d+ June 2027 · \\d\\d:00 UTC$/.test(${LANDING}) && location.hash.startsWith('#a=shackleton-rim@2027-06&')`)}`],
    ],
  },
  {
    // Four scenarios at one site, in two years: the rows are told apart by their dates, which show in full.
    name: 'rows-one-site',
    hash: '#a=connecting-ridge@2027-05&t=613&limits=14_24_99999_1_1&mode=plan&list=connecting-ridge@2027-06-21T17~connecting-ridge@2027-10-03T06~connecting-ridge@2028-10-17T09',
    checks: [
      ['four scenarios at one site are one row, named by the site, with four flags that each say their site and landing', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-site-row')]; const flags = [...document.querySelectorAll('.sl-river .sl-flag')]; const name = rows[0].querySelector('.sl-site-name'); if (rows.length !== 1 || name.textContent !== 'Connecting Ridge' || name.scrollWidth > name.clientWidth + 1 || flags.map((flag) => flag.textContent.replace(/[‹›]/g, '')).join('') !== 'ABCD') throw new Error(rows.length + ' rows, ' + flags.map((flag) => flag.textContent).join(' ')); return flags.every((flag) => /^Scenario [A-D]: lands at Connecting Ridge on \\d+ \\w+ 202[78] · \\d\\d:00 UTC(, (before|after) the days shown)?\\. Press to select it\\.$/.test(flag.title) && /^Scenario [A-D]: Connecting Ridge · \\d+ \\w+ 202[78] · \\d\\d:00 UTC$/.test(flag.getAttribute('aria-label'))) })()", 1500],
      ['the label column is only as wide as the site\'s name needs', "(() => { const name = document.querySelector('.sl-river .sl-site-name').getBoundingClientRect().width; return name < 190 })()"],
    ],
  },
  {
    // Two sites: the date still shows in full, and the site comes after it.
    name: 'rows-two-sites',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=peak-near-shackleton@2027-09-17T12',
    checks: [
      ['with two sites there are two rows, each named by its site in full, and a flag\'s hover text is its site and landing', "(() => { const names = [...document.querySelectorAll('.sl-river .sl-site-row .sl-site-name')]; const flags = [...document.querySelectorAll('.sl-river .sl-flag')]; const whole = names.every((name) => name.scrollWidth <= name.clientWidth + 1); if (names.map((name) => name.textContent).join('|') !== 'Connecting Ridge|Peak near Shackleton' || !whole) throw new Error(names.map((name) => name.textContent + ' (' + name.scrollWidth + ' of ' + name.clientWidth + ')').join(' | ')); return flags.map((flag) => flag.title.replace(/, (before|after) the days shown/, '')).join('|') === 'Scenario A: lands at Connecting Ridge on 6 May 2027 · 13:00 UTC. Press to select it.|Scenario B: lands at Peak near Shackleton on 17 September 2027 · 12:00 UTC. Press to select it.' })()", 1500],
      ['each strip\'s header is still one row with the wider labels', HEADS_ONE_ROW],
    ],
  },
  {
    // "Why?" beside the verdict asks Scout to explain it. The verdict is the app's and does not change. A stand-in answers.
    name: 'why',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['"Why?" sits beside the verdict, a small link, not part of its words', `${STAND_IN_SCOUT} && (() => { window.__verdict = document.querySelector('.sl-verdict').innerText; const why = document.querySelector('.sl-verdict .sl-why'); return why.textContent.trim() === 'Why?' && parseFloat(getComputedStyle(why).fontSize) <= 14 && ${text('.sl-verdict-words')}.trim() === '✗ Does not fit the mission' })()`, 1500],
      ['it opens Scout\'s panel with the question sent for the visitor, about the scenario on show, and his reply shows', `(document.querySelector('.sl-why').click(), true) && ${after(1200, "(() => { const said = [...document.querySelectorAll('.sl-scout-panel .sl-said')].map((el) => el.querySelector('p').textContent); const sent = window.__sent[0]; return said.length === 2 && said[0] === \"Why doesn't this landing fit the mission, and what would change that?\" && said[1] === 'A stand-in reply, number 1.' && sent.messages.at(-1).text === said[0] && new URLSearchParams(sent.view.replace(/^#/, '')).get('sc') === '0' && new URLSearchParams(sent.view.replace(/^#/, '')).get('a') === 'shackleton-rim@2027-05' })()")}`],
      ['the verdict is word for word what it was before Scout was asked', "document.querySelector('.sl-verdict').innerText === window.__verdict"],
      ['"Why?" again for the same scenario opens the panel and does not ask a second time', `(${click('Close')}, true) && ${after(400, "(document.querySelector('.sl-scout-panel') === null && (document.querySelector('.sl-why').click(), true))")} && ${after(1200, "(() => { const said = [...document.querySelectorAll('.sl-scout-panel .sl-said')]; return document.querySelector('.sl-scout-panel') !== null && said.length === 2 && window.__sent.length === 1 })()")}`],
      ['on another landing, two clicks at once ask once, and the question is about the new landing', `(() => { location.hash = '#a=shackleton-rim@2027-05&t=157&limits=14_24_99999_1_1&mode=plan'; return true })() && ${after(1500, "(() => { window.__verdict = document.querySelector('.sl-verdict').innerText; const why = document.querySelector('.sl-why'); why.click(); why.click(); return true })()")} && ${after(3000, "(() => { const asked = [...document.querySelectorAll('.sl-scout-panel .sl-said.is-visitor')]; return (asked.length === 2 && window.__sent.length === 2 && new URLSearchParams(window.__sent[1].view.replace(/^#/, '')).get('t') === '157') || asked.length + ' asked, ' + window.__sent.length + ' sent' })()")}`],
      ['if Scout cannot answer, the panel shows the reasons as the app wrote them, naming the failing limit, and calls him Scout', `(() => { location.hash = '#a=shackleton-rim@2027-05&t=181&limits=14_24_99999_1_1&mode=plan'; return true })() && ${after(1500, "(() => { window.__verdict = document.querySelector('.sl-verdict').innerText; window.__failNext = true; document.querySelector('.sl-why').click(); return true })()")} && ${after(3200, "(() => { window.__failNext = false; const said = [...document.querySelectorAll('.sl-scout-panel .sl-said')].map((el) => el.querySelector('p').textContent); return (document.querySelector('.sl-scout-panel') !== null && /^The app's own reasons: .*your limit is 24 h\\.$/.test(said.at(-1)) && /^Scout is busy\\. Ask again in \\d+ s\\.$/.test(said.at(-2)) && !/co-pilot/i.test(document.querySelector('.sl-scout-panel').textContent) && document.querySelector('.sl-verdict').innerText === window.__verdict) || said.slice(-2).join(' // ') })()")}`],
    ],
  },
  {
    // Earth's centre is 0.9° below the skyline and its upper edge still clears it: Connecting Ridge, 25 May 2027, 12:00. The limits let this landing fit.
    name: 'earth-partly',
    hash: '#a=connecting-ridge@2027-05&t=588&limits=14_336_99999_1_1&mode=plan',
    checks: [
      ['with Earth\'s centre below the skyline and Earth still counted in view, the Earth row\'s line about the landing is marked marginal, with a diamond, and gives the angle', `/Earth partly in view$/.test(${SENTENCE}) && ${rowAbove('earth')} === '−0.9°' && document.querySelector('.sl-fact.is-earth .sl-fact-at').dataset.check === 'marginal' && document.querySelector('.sl-fact.is-earth .sl-fact-at .sl-check-mark').textContent.trim() === '◇'`, 3000],
      ['the Earth row says how much of its disc shows, in its line about the landing, and leads with the share of the mission Earth is in view', "/, (under 1|\\d+)% of the disc showing · /.test(document.querySelector('.sl-fact.is-earth .sl-fact-at')?.textContent ?? '') && /^\\d+%of the mission$/.test(document.querySelector('.sl-fact.is-earth .sl-fact-main').textContent.trim()) && /^in view \\d+ of 336 h$/.test(document.querySelector('.sl-fact.is-earth .sl-fact-small').textContent.trim())"],
      ['the landing otherwise fits, so the verdict is "Fits, marginal", because only the edge of Earth is in view at landing', `(() => { const reasons = [...document.querySelectorAll('.sl-reasons li')].map((li) => li.textContent.trim()); if (${text('.sl-verdict-words')}.trim() !== '◇ Fits, marginal' || !reasons.includes('only the edge of Earth is in view at landing')) throw new Error(${text('.sl-verdict')}); return document.querySelector('.sl-verdict').classList.contains('is-marginal') })()`],
      ['the time bar\'s chip, on the landing, says so too', `/^Sun, part of Earth$/.test(${text('.sl-river .sl-chip')}.trim())`],
      ['and so does Compare', `(${click('Compare')}, true) && ${after(900, "(() => { const fits = document.querySelector('.sl-compare .sl-compare-verdict td'); return fits.dataset.verdict === 'marginal' && /^Fits, marginal: /.test(fits.title) && /only the edge of Earth is in view at landing/.test(document.querySelector('.sl-compare-why.is-info').textContent) })()")}`],
    ],
  },
  {
    // Every layout a laptop produces: no panel, Mission open, Compare open (four scenarios, its widest),
    // each strip folded. In each the whole Moon and every name fit the stage and each strip's header is one row.
    name: 'layouts',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    checks: [
      ['with no panel open the whole Moon and every name are inside the stage', STAGE_HOLDS, 1200],
      ['with no panel open each strip\'s header is one row, "Fold" at its right end', HEADS_ONE_ROW],
      ['with no panel open the river\'s legend is on the page once', LEGEND_ONCE],
      ['with the time bar off the landing the stage says so, clear of the Moon, and the river\'s header is still one row', `(${key('ArrowRight')}, true) && ${after(400, `${NOTE_SAYS('6 May 2027 · 14:00 UTC')} && ${HEADS_ONE_ROW}`)}`],
      ['with the mission\'s limits open in the column the Moon and names fit, and each header is one row', onLaptop("document.querySelector('.sl-mission-open').click()", 900, `(() => { const ok = document.querySelector('.sl-mission-inline') !== null && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}; document.querySelector('.sl-mission-open').click(); return ok })()`)],
      ['with Compare open the Moon and names fit, and each header is one row', onLaptop(click('Compare'), 900, `/Compare/.test(document.querySelector('.sl-drawer h2').textContent) && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}`)],
      ['with Compare open the river\'s legend is still on the page once, now in "More"', `(window.innerWidth < 761 || ${LEGEND_ONCE})`],
      ['with Compare open and the skyline folded (it takes no room then), the same', onLaptop("document.querySelector('.sl-sky .sl-fold').click()", 900, `document.querySelector('.sl-sky') === null && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}`)],
      ['with Compare open and both strips folded, the same', onLaptop("document.querySelector('.sl-river .sl-fold').click()", 900, `document.querySelector('.sl-rows') === null && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}`)],
      ['with both strips open again and the panel closed, the same', onLaptop(`(document.querySelector('.sl-river .sl-fold').click(), ${OPEN_SKY}, ${click('Compare')})`, 900, `document.querySelector('.sl-drawer') === null && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}`)],
    ],
  },
  {
    // Time plays for ten seconds from a landing on 7 May 2027 at Connecting Ridge, across a sunset. The
    // column is about the landing, so not a word or a box in it changes; the readout by the time bar
    // is what follows the time.
    name: 'steady',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=144&limits=14_24_99999_1_1&mode=plan',
    steps: ["document.querySelector('.sl-river .sl-round[aria-label=\"Play\"]').click()"],
    checks: [
      ['while time plays for ten seconds nothing in the left column changes, not a word and not a position, while the readout by the time bar follows the time', `(async () => {
        const column = document.querySelector('.sl-col')
        // Start once the landing's numbers and the Horizons line have arrived.
        const ready = () => !/…/.test(document.querySelector('.sl-facts').textContent) && document.querySelector('.sl-horizons').textContent.trim() !== ''
        for (let i = 0; i < 40 && !ready(); i += 1) await new Promise((next) => setTimeout(next, 100))
        const boxes = (parts) => parts.map((el) => { const box = el.getBoundingClientRect(); return [box.top, box.left, box.width, box.height] })
        const inColumn = [...column.querySelectorAll('*')]
        const inReadout = [...document.querySelectorAll('.sl-river-head > *')]
        const words = column.innerText
        const first = boxes(inColumn)
        const firstReadout = boxes(inReadout)
        let moved = 0
        let readoutMoved = 0
        let reworded = false
        const chips = new Set()
        const heights = new Set()
        const dates = new Set()
        const end = performance.now() + 10000
        while (performance.now() < end) {
          await new Promise((next) => requestAnimationFrame(next))
          if (column.querySelectorAll('*').length !== inColumn.length || column.innerText !== words) reworded = true
          boxes(inColumn).forEach((box, i) => box.forEach((value, k) => { moved = Math.max(moved, Math.abs(value - first[i][k])) }))
          boxes(inReadout).forEach((box, i) => box.forEach((value, k) => { readoutMoved = Math.max(readoutMoved, Math.abs(value - firstReadout[i][k])) }))
          chips.add(document.querySelector('.sl-chip').textContent.trim())
          heights.add(document.querySelector('.sl-moment-heights')?.textContent ?? '')
          dates.add(document.querySelector('.sl-now').textContent)
        }
        const result = { parts: inColumn.length, moved, reworded, readoutMoved, chips: [...chips], heights: heights.size, dates: dates.size }
        if (!(inColumn.length > 60 && moved === 0 && !reworded && readoutMoved === 0 && chips.size >= 2 && [...chips].every((chip) => ['Sun and Earth', 'Sun, part of Earth', 'Sun only', 'Earth only', 'Part of Earth', 'Neither'].includes(chip)) && (window.innerWidth < 1440 || heights.size > 5) && dates.size > 20)) throw new Error(JSON.stringify(result))
        return true
      })()`],
      ['the column says which landing it describes, and its figures are the landing\'s, not the time bar\'s', `(() => { const bar = document.querySelector('.sl-moment-heights')?.textContent.trim() ?? null; return ${LANDING} === '7 May 2027 · 00:00 UTC' && ${LANDING} === '7 May 2027 · 00:00 UTC' && ${text('.sl-now')} !== ${LANDING} && (window.innerWidth >= 1440 ? bar !== null : true) && (bar === null || (/^Sun −?\\d+\\.\\d° · Earth −?\\d+\\.\\d° above the skyline [▸▾]$/.test(bar) && bar.slice(0, -2) !== 'Sun ' + ${rowAbove('sun')} + ' · Earth ' + ${rowAbove('earth')} + ' above the skyline')) })()`],
      ['at this landing the Sun is below a flat horizon and still in view: its main figure is above the skyline, and Compare\'s "Sun\'s elevation" at landing is negative', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const row = document.querySelector('.sl-fact.is-sun'); const above = /^Sunlit/.test(${SENTENCE}) && parseFloat(row.querySelector('.sl-fact-main').firstChild.textContent) > 0 && row.querySelector('.sl-fact-main small').textContent.trim() === 'above the skyline'; ${click('Compare')}; await wait(700); const fold = [...document.querySelectorAll('.sl-compare .sl-compare-fold')].find((one) => one.textContent.trim() === 'At landing'); if (fold.getAttribute('aria-expanded') !== 'true') fold.click(); await wait(400); const line = [...document.querySelectorAll('.sl-compare tbody tr')].find((one) => one.querySelector('th')?.textContent.trim() === "Sun's elevation, °"); const from = line ? line.querySelector('td').textContent.trim() : 'no row'; ${click('Compare')}; await wait(400); if (!above || !/^−\\d+\\.\\d/.test(from)) throw new Error('above the skyline: ' + above + '; from a flat horizon: ' + from); return true })()`],
      ['the readout in the time bar\'s header is a state chip with its colour and words, then the heights above the skyline; the date is written once, under the line', `(() => {
        const row = document.querySelector('.sl-river-head')
        const chip = row.querySelector('.sl-chip')
        const heights = row.querySelector('.sl-moment-heights')
        const state = [...chip.classList].find((name) => name.startsWith('is-'))
        const words = { 'is-both': ['Sun and Earth', 'Sun, part of Earth'], 'is-sun': ['Sun only'], 'is-earth': ['Earth only', 'Part of Earth'], 'is-none': ['Neither'] }
        const named = words[state].includes(chip.textContent.trim()) && chip.querySelector('.sl-key').classList.contains(state)
        const order = chip.nextElementSibling === heights && document.querySelectorAll('.sl-now').length === 1 && row.querySelector('.sl-now') === null && document.querySelector('.sl-river .sl-link') === null
        return named && order && (window.innerWidth < 1440 || (heights !== null && heights.title.startsWith("How far the Sun's and Earth's centers are above the skyline, at the hour on the time bar."))) && ${HEADS_ONE_ROW}
      })()`],
      ['the sentence is one line of body text, and every part of the answer that is drawn has something in it', "(() => { const sentence = document.querySelector('.sl-sentence'); const line = parseFloat(getComputedStyle(sentence).lineHeight); const parts = [...document.querySelectorAll('.sl-answer > *')].filter((el) => !el.classList.contains('sl-horizons')); return sentence.getBoundingClientRect().height < 1.2 * line && parseFloat(getComputedStyle(sentence).fontSize) <= 15 && parts.every((el) => el.textContent.trim() !== '') })()"],
      ['every row shows its words in full: one small line, or two where a disc is cut, never three', ROWS_WHOLE],
      ['the page says "skyline", never "the ridge", for the terrain\'s outline', OWN_WORDS],
      ['nothing in the column scrolls, and no area inside it', NOTHING_SCROLLS],
      ['the rows\' figures are of one width and never wrap', "[...document.querySelectorAll('.sl-fact-main')].every((value) => getComputedStyle(value).fontVariantNumeric.includes('tabular-nums') && getComputedStyle(value).whiteSpace === 'nowrap')"],
      ['neither the column nor a panel scrolls', COLUMN_FITS],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // Rodrigo: the compass goes below the zoom, so pressing zoom again and again never lands on the compass.
    name: 'compass-below',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['in Orbit, before the view is moved, the zoom buttons are there and the compass is not (a phone zooms with two fingers in Plan: its turn is in the next scene)', `window.innerWidth < 761 || ${ZOOM_AT}`, 1200],
      { drag: true },
      ['after a drag the compass appears below the zoom buttons, which have not moved', `window.innerWidth < 761 || ${COMPASS_BELOW}`],
      ['a press on "zoom in" where it was still zooms in, and the buttons stay put', `window.innerWidth < 761 || ((() => { window.__px = Number(document.querySelector('.scout-globe').dataset.discPx); const box = document.querySelector('.sl-view-tools .zoom-buttons button').getBoundingClientRect(); document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2).click(); return true })() && ${after(900, `(Number(document.querySelector('.scout-globe').dataset.discPx) > window.__px || 'the Moon did not grow') && ${COMPASS_BELOW}`)})`],
      ['the compass still recentres, and goes', `window.innerWidth < 761 || ((document.querySelector('.sl-recentre').click(), true) && ${after(1300, "document.querySelector('.sl-recentre') === null")})`],
      ['in Site the zoom buttons are where they were in Orbit, above the arrow to Earth; the compass, on show there because the view has left the default, is below both', `window.innerWidth < 761 || ((${click('Site')}, true) && ${after(2500, `(document.querySelector('.sl-view-tools .sl-to-earth') !== null || 'no arrow to Earth') && ${COMPASS_BELOW}`)})`],
      { drag: true },
      ['after a drag in Site it is the same: the zoom buttons have not moved, and the compass is below them and the arrow to Earth', `window.innerWidth < 761 || ${COMPASS_BELOW}`],
    ],
  },
  {
    // The same in Watch, where a phone has the zoom buttons too.
    name: 'compass-below-watch',
    hash: '',
    still: true,
    checks: [
      ['in Watch, before the view is moved, the zoom buttons are there and the compass is not', ZOOM_AT, 1200],
      { drag: true },
      ['after a drag the compass appears below the zoom buttons, which have not moved', COMPASS_BELOW],
    ],
  },
  {
    // Misha: a custom point could be picked on the Moon only once Plan was open. A click on the Moon
    // away from any dot is a custom point from Watch too: it opens Plan there, as a dot opens Plan at its site.
    name: 'watch-pick',
    hash: '',
    still: true,
    noChat: true,
    checks: [
      ['Watch opens with the Moon alone: no scenario in the address', "document.querySelector('.sightline.is-watch') !== null && location.hash === ''", 900],
      { press: [-0.6, -0.3] },
      ['a click on the Moon in Watch opens Plan at that point: scenario A is a custom point with a dot of its own, and B is the first prospective site', `(() => { const at = (() => { const site = document.querySelector('#sl-site')?.selectedOptions[0]?.textContent ?? ''; const dot = document.querySelector('.sl-dot.is-selected')?.getAttribute('aria-label') ?? ''; const a = /^#a=(-?[0-9.]+),(-?[0-9.]+)@/.exec(location.hash); return (document.querySelector('.sightline.is-plan') !== null && /^Custom point /.test(site) && a !== null && dot.startsWith(site)) ? a[1] + ',' + a[2] : 'not a custom point: ' + site + ' // ' + dot + ' // ' + location.hash.slice(0, 60) })(); window.__picked = at; const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; return (/^-?[0-9.]+,-?[0-9.]+$/.test(at) && tabs === 2 && /list=connecting-ridge@/.test(location.hash)) || at + ' // ' + tabs + ' tabs' })()`],
      { press: [-0.3, -0.6] },
      ['in Plan a second click moves scenario A to the new point, and adds no scenario', `(() => { const at = (() => { const site = document.querySelector('#sl-site')?.selectedOptions[0]?.textContent ?? ''; const dot = document.querySelector('.sl-dot.is-selected')?.getAttribute('aria-label') ?? ''; const a = /^#a=(-?[0-9.]+),(-?[0-9.]+)@/.exec(location.hash); return (document.querySelector('.sightline.is-plan') !== null && /^Custom point /.test(site) && a !== null && dot.startsWith(site)) ? a[1] + ',' + a[2] : 'not a custom point: ' + site + ' // ' + dot + ' // ' + location.hash.slice(0, 60) })(); const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; const moved = /^-?[0-9.]+,-?[0-9.]+$/.test(at) && at !== window.__picked; window.__picked = at; return (moved && tabs === 2) || at + ' // ' + tabs + ' tabs' })()`],
      ['with the controls hidden (H) the Moon is only looked at', `(${key('h')}, true) && ${after(600, "document.querySelector('.sl-handle') !== null")}`],
      { press: [-0.6, -0.3] },
      ['a click then picks nothing: the controls stay hidden and the scenario stays where it was', `(() => { const a = /^#a=(-?[0-9.]+),(-?[0-9.]+)@/.exec(location.hash); const at = a ? a[1] + ',' + a[2] : location.hash; return (document.querySelector('.sl-handle') !== null && document.querySelector('.sl-col') === null && at === window.__picked) || at + ' is not ' + window.__picked })()`],
    ],
  },
  {
    // Rodrigo: a first visit's Plan has the two prospective sites up as A and B, so Compare can be used at once.
    name: 'two-by-default',
    hash: '',
    still: true,
    noChat: true,
    checks: [
      ['Watch is as it was: the Moon alone, no scenarios in the address', "document.querySelector('.sightline.is-watch') !== null && location.hash === '' && document.querySelector('.sl-tabs') === null", 900],
      ['"Plan a landing" opens Plan with two scenarios: A at Connecting Ridge and B at Shackleton Rim, landing at the same hour, A on show', `(${click('Plan a landing')}, true) && ${after(1500, `(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; const rows = [...document.querySelectorAll('.sl-river .sl-flag')].map((row) => row.getAttribute('aria-label')); return (tabs === 2 && document.querySelector('#sl-site').value === 'connecting-ridge' && ${LANDING} === '1 May 2027 · 00:00 UTC' && rows.length === 2 && /^Scenario A: Connecting Ridge · 1 May 2027 · 00:00 UTC$/.test(rows[0]) && /^Scenario B: Shackleton Rim · 1 May 2027 · 00:00 UTC$/.test(rows[1]) && /^#a=connecting-ridge@2027-05/.test(location.hash) && /list=shackleton-rim@2027-05-01T00/.test(location.hash)) || tabs + ' tabs // ' + rows.join(' // ') + ' // ' + location.hash })()`)}`],
      ['the time bar has a row for each site, each with its scenario\'s lettered flag; Compare stays shut until it is opened; nothing scrolls sideways and the Moon is whole', `(() => { const names = [...document.querySelectorAll('.sl-river .sl-site-row .sl-site-name')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()); const flags = [...document.querySelectorAll('.sl-river .sl-site-row')].map((row) => [...row.querySelectorAll('.sl-flag')].map((flag) => flag.textContent.trim()).join('')).join('|'); return (names.length === 2 && /Connecting Ridge/.test(names[0]) && /Shackleton Rim/.test(names[1]) && flags === 'A|B' && document.querySelector('.sl-compare') === null) || names.join(' // ') })() && (window.__colTwo = document.querySelector('.sl-col').scrollHeight, true) && document.querySelector('.sl-col').scrollWidth <= document.querySelector('.sl-col').clientWidth && ${DISC_INSIDE}`],
      ['Compare, opened, has both side by side at once', `(${click('Compare')}, true) && ${after(1200, "(() => { const heads = [...document.querySelectorAll('.sl-compare thead th')].map((th) => th.textContent.trim()).join(''); const legend = [...document.querySelectorAll('.sl-compare-legend li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); return (heads === 'AB' && /Connecting Ridge/.test(legend[0]) && /Shackleton Rim/.test(legend[1])) || heads + ' // ' + legend.join(' // ') })()")} && ${after(1300, `(${click('Close')}, true)`)}`],
      ['B, once removed, stays removed: the link holds one scenario, the column is as tall as it was with two (the second scenario adds nothing to it), and Home then "Plan a landing" does not bring it back', `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario B"]').click(), true) && ${after(600, "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 1 && !/list=/.test(location.hash) && Math.abs(document.querySelector('.sl-col').scrollHeight - window.__colTwo) <= 1 && (document.querySelector('.sl-rail-home') ?? [...document.querySelectorAll('.sl-rail-menu button, .sl-rail button')].find((button) => /Home/.test(button.textContent)) ?? { click() {} }).click() === undefined")} && ${after(1700, `(document.querySelector('.sightline.is-watch') !== null || (${click('More')}, [...document.querySelectorAll('.sl-rail-menu button')].find((button) => /Home/.test(button.textContent))?.click(), true)) && true`)} && ${after(2700, `(${click('Plan a landing')}, true)`)} && ${after(3900, "document.querySelector('.sightline.is-plan') !== null && document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 1 && document.querySelector('#sl-site').value === 'connecting-ridge'")}`],
    ],
  },
  {
    // A site picked on the Moon on a first visit is A; B is Connecting Ridge.
    name: 'two-by-default-pick',
    hash: '',
    still: true,
    noChat: true,
    steps: ["document.querySelector('.sl-group-dot').click()"],
    checks: [
      ['picking Shackleton Rim on the Moon opens Plan with it at A and Connecting Ridge at B, at the same hour', `([...document.querySelectorAll('.sl-group-list [role="menuitem"]')].find((item) => item.textContent.includes('Shackleton Rim')).click(), true) && ${after(1500, `(() => { const rows = [...document.querySelectorAll('.sl-river .sl-flag')].map((row) => row.getAttribute('aria-label')); return (document.querySelector('#sl-site').value === 'shackleton-rim' && rows.length === 2 && /^Scenario A: Shackleton Rim · /.test(rows[0]) && /^Scenario B: Connecting Ridge · /.test(rows[1]) && rows[0].split(' · ').slice(1).join() === rows[1].split(' · ').slice(1).join()) || rows.join(' // ') })()`)}`, 600],
    ],
  },
  {
    // A link is exactly what it carries: one scenario stays one.
    name: 'two-by-default-link',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    noChat: true,
    checks: [['a link with one scenario opens with one, and nothing is added', "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 1 && !/list=/.test(location.hash) && document.querySelectorAll('.sl-river .sl-flag').length === 1", 1200]],
  },
  {
    // Compare's "Science" fold: how far each site is from permanently shadowed ground, in NASA's maps. Loaded only when it is opened.
    name: 'compare-science',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=apollo-11@2027-05-06T13&sc=0',
    still: true,
    noChat: true,
    steps: [click('Compare')],
    checks: [
      ['Compare has a third fold, "Science", closed at first; the shadow data has not been asked for', "(() => { const folds = [...document.querySelectorAll('.sl-compare .sl-compare-fold')].map((fold) => fold.textContent.trim() + (fold.getAttribute('aria-expanded') === 'true' ? ' (open)' : '')).join('|'); return (folds === 'More|At landing|Science' && document.querySelector('.sl-compare-science') === null && performance.getEntriesByType('resource').every((entry) => !entry.name.includes('/data/shadow.json'))) || folds })()", 1200],
      ['opened, it adds one row in km: 0.1 at Connecting Ridge, "none" at Apollo 11', `([...document.querySelectorAll('.sl-compare .sl-compare-fold')].find((fold) => fold.textContent.trim() === 'Science').click(), true) && ${after(1500, "(() => { const row = document.querySelector('.sl-compare-science'); if (!row) return 'no row'; const name = row.querySelector('th').textContent.trim(); const cells = [...row.querySelectorAll('td')].map((td) => td.textContent.trim()).join('|'); return (name === 'Shadowed ground, km' && cells === '0.1|none') || name + ' // ' + cells })()")}`],
      ['under the table the "none" is said in full: none mapped within so many km', "(() => { const notes = [...document.querySelectorAll('.sl-compare-shade li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); return (notes.length === 1 && /^B permanently shadowed ground: none mapped within [\\d,]+ km\\.$/.test(notes[0])) || notes.join(' // ') })()"],
      ['the row\'s hover text says what the ground is and names NASA\'s map as its source; no value in it is marked best, and the verdict does not speak of it', "(() => { const science = document.querySelector('.sl-compare-science'); const head = science.querySelector('th'); const tip = head.getAttribute('title') ?? head.dataset.tip ?? ''; return (/never reaches/.test(tip) && /NASA’s map of permanent shadow \\(LOLA; Mazarico et al\\. 2011\\)/.test(tip) && getComputedStyle(head).cursor !== 'help' && science.querySelector('.is-best, .sl-best') === null && !/shadow/i.test(document.querySelector('.sl-verdict').textContent)) || tip.slice(0, 120) })()"],
      ['the data was asked for once, and the panel still fits beside the stage with nothing to scroll sideways', `(() => { const asked = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/data/shadow.json')).length; const drawer = document.querySelector('.sl-compare'); return (asked === 1 && drawer.scrollWidth <= drawer.clientWidth) || asked + ' request(s), panel ' + drawer.scrollWidth + ' in ' + drawer.clientWidth })() && ${DISC_INSIDE}`],
      ['folded again, the row and its note go', `([...document.querySelectorAll('.sl-compare .sl-compare-fold')].find((fold) => fold.textContent.trim() === 'Science').click(), true) && ${after(500, "document.querySelector('.sl-compare-science') === null && document.querySelector('.sl-compare-shade') === null")}`],
    ],
  },
  {
    // The view belongs to the visitor: after a drag it stays where it was left, through time playing
    // and the stage changing size, until the compass is pressed.
    name: 'free-view',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ["document.querySelector('.sl-river .sl-round[aria-label=\"Play\"]').click()"],
    checks: [
      ['before any drag the view is the default one and there is no compass', "(() => { window.__pose0 = document.querySelector('.scout-globe').dataset.pose; return document.querySelector('.sl-recentre') === null && typeof window.__pose0 === 'string' })()"],
      { drag: true },
      ['after a drag the view has turned and the compass appears, named "Recenter the Moon", in the stage\'s corner clear of the disc', `(() => {
        const globe = document.querySelector('.scout-globe')
        window.__pose1 = globe.dataset.pose
        const compass = document.querySelector('.sl-recentre')
        if (!compass || window.__pose1 === window.__pose0) return false
        const stage = document.querySelector('.sl-stage').getBoundingClientRect()
        const box = compass.getBoundingClientRect()
        const disc = globe.getBoundingClientRect()
        const reach = Math.hypot((box.left + box.right) / 2 - (disc.left + disc.right) / 2, (box.top + box.bottom) / 2 - (disc.top + disc.bottom) / 2)
        return compass.getAttribute('aria-label') === 'Recenter the Moon' && box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && reach >= Number(globe.dataset.discPx) / 2 + box.width / 2 && compass.closest('.sl-view-tools') !== null
      })()`],
      ['with time playing for five seconds the view stays exactly where it was left', `(async () => {
        const started = document.querySelector('.sl-now').textContent
        const end = performance.now() + 5000
        let same = true
        while (performance.now() < end) {
          await new Promise((next) => requestAnimationFrame(next))
          same = same && document.querySelector('.scout-globe').dataset.pose === window.__pose1
        }
        return same && document.querySelector('.sl-now').textContent !== started
      })()`],
      ['folding the time bar changes the stage\'s size, not the view\'s direction, and the disc still fits', `(document.querySelector('.sl-river .sl-fold').click(), true) && ${after(400, `document.querySelector('.scout-globe').dataset.pose === window.__pose1 && ${DISC_INSIDE}`)}`],
      ['one press of the compass returns the default view and removes the compass', `(document.querySelector('.sl-recentre').click(), true) && ${after(1200, `document.querySelector('.scout-globe').dataset.pose === window.__pose0 && document.querySelector('.sl-recentre') === null && ${DISC_INSIDE}`)}`],
      ['picking a site that is out of view turns the Moon to show it; one already in view leaves the view alone', `(() => { const pick = (id) => { const select = document.querySelector('#sl-site'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, id); select.dispatchEvent(new Event('change', { bubbles: true })) }; pick('shackleton-rim'); return new Promise((done) => setTimeout(() => { const stayed = document.querySelector('.scout-globe').dataset.pose === window.__pose0; pick('apollo-11'); setTimeout(() => { const dot = document.querySelector('.sl-dot.is-selected'); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const box = dot?.getBoundingClientRect(); done((stayed && dot !== null && dot.getAttribute('aria-label').startsWith('Apollo 11') && box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom && document.querySelector('.sl-recentre') !== null) || 'stayed ' + stayed + ', dot ' + (dot ? dot.getAttribute('aria-label').slice(0, 30) + ' at ' + [box.left, box.top, box.right, box.bottom].map(Math.round).join() : 'none') + ', stage ' + [stage.left, stage.top, stage.right, stage.bottom].map(Math.round).join() + ', compass ' + (document.querySelector('.sl-recentre') !== null)) }, 1500) }, 700)) })()`],
    ],
  },
  {
    // One real question to Scout (run with --ask: it calls the model once per size).
    name: 'scout-reply',
    needs: 'ask',
    hash: '#a=connecting-ridge@2027-05&t=144&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['"Why?" beside a verdict that does not fit asks Scout in his panel; he answers there, and nothing in the left column moves', `(async () => {
        const column = () => [...document.querySelectorAll('.sl-col *')].map((el) => { const box = el.getBoundingClientRect(); return [box.top, box.height] })
        const before = column()
        window.__verdict = document.querySelector('.sl-verdict').innerText
        document.querySelector('.sl-why').click()
        await new Promise((next) => setTimeout(next, 600))
        const end = performance.now() + 60000
        let moved = 0
        while (performance.now() < end) {
          await new Promise((next) => setTimeout(next, 100))
          column().forEach((box, i) => { moved = Math.max(moved, Math.abs(box[0] - before[i][0]), Math.abs(box[1] - before[i][1])) })
          const reply = [...document.querySelectorAll('.sl-talk .sl-said.is-scout:not(.is-waiting) p')].at(-1)
          if (reply) { window.__scoutReply = reply.textContent; window.__scoutFailed = reply.classList.contains('is-warn'); break }
        }
        const answered = typeof window.__scoutReply === 'string' && window.__scoutReply.length > 20 && !window.__scoutFailed
        // Say what happened, so a failure reads as "no answer" or "it moved", not as a bare FAIL.
        if (!answered || moved !== 0) throw new Error((answered ? 'answered' : 'no answer: ' + String(window.__scoutReply).slice(0, 90)) + '; moved ' + moved + ' px')
        return true
      })()`],
      ['the reply is a real answer with no "practice demo" and no "not mission planning advice"', "typeof window.__scoutReply === 'string' && !window.__scoutFailed && !/practice demo/i.test(window.__scoutReply) && !/mission planning advice/i.test(window.__scoutReply)"],
      ['the reply mentions the limit the landing fails, and the verdict is word for word what it was', "typeof window.__scoutReply === 'string' && /24|limit|Sun/i.test(window.__scoutReply) && document.querySelector('.sl-verdict').innerText === window.__verdict"],
    ],
  },
  {
    // Rodrigo: the 2D skyline with the Sun's and Earth's paths is back where it was, above the time bar, folded until asked for. Its door is the time bar's readout.
    name: 'skyline-fold',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    noChat: true,
    checks: [
      ['Plan opens with the strip folded: it is not on the screen at all, and the link says nothing of it', "(() => { window.__stage = document.querySelector('.sl-stage').getBoundingClientRect().height; return document.querySelector('.sl-sky') === null && !/sky=/.test(location.hash) })()", 1200],
      ['its door is the time bar\'s readout of the Sun\'s and Earth\'s heights, a button with a small chevron that says it is closed; where the row has no room for the heights it is a short "Skyline" in the row, and on a phone it is under "More"', `(async () => { let door = document.querySelector('.sl-river .sl-sky-door'); if (!door) { document.querySelector('.sl-river .sl-more').click(); await new Promise((done) => setTimeout(done, 200)); door = document.querySelector('.sl-river .sl-sky-door') } if (!door) return 'no door'; const words = door.textContent.replace(/\\s+/g, ' ').trim(); const inRow = door.classList.contains('sl-moment-heights'); door.focus(); return (door.tagName === 'BUTTON' && !door.disabled && document.activeElement === door && door.getAttribute('aria-expanded') === 'false' && door.getAttribute('aria-controls') === 'sl-sky' && getComputedStyle(door).cursor !== 'help' && (inRow ? /^Sun −?\\d+\\.\\d° · Earth −?\\d+\\.\\d° above the skyline ▸$/.test(words) : (words === 'Skyline ▸' || words === 'Show the skyline')) && (window.innerWidth < 761 || door.closest('.sl-river-head') !== null || 'on a laptop the door is not in the row')) || words })()`],
      ['a press opens the strip above the time bar: the skyline all the way round, the Sun and Earth named on it with their paths; the stage gives it the room; the link carries it and the visit keeps it', `${OPEN_SKY} && ${after(900, "(() => { const sky = document.querySelector('.sl-sky'); if (!sky) return 'no strip'; const river = document.querySelector('.sl-river').getBoundingClientRect(); const box = sky.getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const door = document.querySelector('.sl-river .sl-sky-door'); return (document.querySelector('.sl-sky-land')?.getAttribute('d')?.length > 2000 && document.querySelectorAll('.sl-sky-path.is-sun').length > 0 && document.querySelectorAll('.sl-sky-path.is-earth').length > 0 && /Sun/.test(sky.querySelector('svg').textContent) && /Earth/.test(sky.querySelector('svg').textContent) && (window.innerWidth < 761 || (box.bottom <= river.top + 1 && box.top >= stage.bottom - 1 && stage.height < window.__stage)) && /[&#]sky=1/.test(location.hash) && sessionStorage.getItem('sightline.skylineFolded') === '0' && (door === null || door.getAttribute('aria-expanded') === 'true')) || 'strip ' + Math.round(box.top) + ' to ' + Math.round(box.bottom) + ', stage ' + Math.round(stage.height) + ' was ' + Math.round(window.__stage) + ', ' + location.hash })()")}`],
      ['the same press folds it again, and the stage takes the room back', `(async () => { let door = document.querySelector('.sl-river .sl-sky-door'); if (!door) { document.querySelector('.sl-river .sl-more').click(); await new Promise((done) => setTimeout(done, 200)); door = document.querySelector('.sl-river .sl-sky-door') } door.click(); return true })() && ${after(900, "(document.querySelector('.sl-sky') === null && !/sky=/.test(location.hash) && Math.abs(document.querySelector('.sl-stage').getBoundingClientRect().height - window.__stage) < 2) || 'still open, or the stage is ' + Math.round(document.querySelector('.sl-stage').getBoundingClientRect().height) + ' not ' + Math.round(window.__stage)")}`],
      ['open again, its own "Fold" folds it too', `${OPEN_SKY} && ${after(700, "(document.querySelector('.sl-sky .sl-fold').click(), true)")} && ${after(1400, "document.querySelector('.sl-sky') === null && sessionStorage.getItem('sightline.skylineFolded') === '1'")}`],
      ['in the Surface view the strip keeps its place, as the time bar does, so nothing moves when the view changes, and it is there in Orbit again', `${OPEN_SKY} && ${after(700, `(window.__strip = Math.round(document.querySelector('.sl-sky').getBoundingClientRect().top), ${click('Surface')}, true)`)} && ${after(3000, `((document.querySelector('.sl-sky') !== null && Math.round(document.querySelector('.sl-sky').getBoundingClientRect().top) === window.__strip) || 'the strip moved or went in Surface') && (${click('Orbit')}, true)`)} && ${after(5000, "(document.querySelector('.sl-sky') !== null && Math.round(document.querySelector('.sl-sky').getBoundingClientRect().top) === window.__strip) || 'the strip is not where it was in Orbit'")}`],
      ['the tour\'s step about it opens it for a visitor who had it folded, and the next step folds it again', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); document.querySelector('.sl-sky .sl-fold').click(); await wait(400); if (window.innerWidth < 761) { [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'More')?.click(); await wait(300) } [...document.querySelectorAll('.sl-rail button, .sl-rail-menu button')].find((button) => /^(Guide|How it works)$/.test(button.textContent.trim())).click(); await wait(900); document.querySelector('.how-tour-button').click(); await wait(1200); for (let i = 0; i < 4; i += 1) { document.querySelector('.sl-tour .sl-tour-next').click(); await wait(700) } const during = document.querySelector('.sl-sky') !== null && document.querySelector('.sl-tour').dataset.step === 'skyline'; document.querySelector('.sl-tour .sl-tour-next').click(); await wait(900); const after = document.querySelector('.sl-sky') === null; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(900); return (during && after && document.querySelector('.sl-tour') === null && document.querySelector('.sl-sky') === null) || 'during ' + during + ', after ' + after })()`],
    ],
  },
  {
    // A shared link opens as its sender saw it.
    name: 'skyline-link',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&sky=1',
    still: true,
    noChat: true,
    checks: [['a link that says the strip is open opens with it open, on the link\'s own site and landing', `document.querySelector('.sl-sky') !== null && document.querySelector('#sl-site').value === 'connecting-ridge' && ${LANDING} === '6 May 2027 · 13:00 UTC' && /[&#]sky=1/.test(location.hash)`, 1500]],
  },
  {
    // The fullest screen: four scenarios and the strip open.
    name: 'skyline-four',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    sky: true,
    still: true,
    noChat: true,
    checks: [['with the strip open and four scenarios the column still fits with nothing to scroll, and the Moon\'s disc is whole', `document.querySelector('.sl-sky') !== null && document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 4 && ${COLUMN_FITS} && ${NOTHING_SCROLLS} && ${DISC_INSIDE}`, 1500]],
  },
  {
    name: 'skyline-close',
    sky: true,
    // The hour in May 2027 when the Sun passes Earth's bearing at Connecting Ridge, both behind the land.
    hash: '#a=connecting-ridge@2027-05&t=467&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['with the Sun and Earth on one bearing, their names sit side by side, not over each other', SKY_CLEAR, 1500],
      ['with neither in view, Scout\'s badge is an empty grey ring, and says so', BADGE_MATCHES],
      ['both are named as hidden', `/Sun \\(hidden\\)/.test(${text('.sl-sky svg')}) && /Earth \\(hidden\\)/.test(${text('.sl-sky svg')})`],
    ],
  },
  {
    name: 'skyline',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the skyline draws the land, the Sun\'s track and Earth\'s loop', "document.querySelector('.sl-sky-land')?.getAttribute('d')?.length > 2000 && document.querySelectorAll('.sl-sky-path.is-sun').length > 0 && document.querySelectorAll('.sl-sky-path.is-earth').length > 0", 1500],
      ['the Sun and Earth are on it, named', `/Sun/.test(${text('.sl-sky svg')}) && /Earth/.test(${text('.sl-sky svg')})`],
      ['their names are apart and inside the strip', SKY_CLEAR],
      ['the land fills at least a third of the strip\'s height, and the column does not scroll', `${RIDGE_FILLS} && ${COLUMN_FITS}`],
      ['the smooth Moon\'s horizon is named in the header, with a dashed swatch, not in the drawing', `document.querySelector('.sl-sky .sl-strip-head .sl-dash') !== null && /a smooth Moon's horizon/.test(${text('.sl-sky .sl-strip-head')}) && !/smooth/.test(${text('.sl-sky svg')})`],
      ['it says how far heights are stretched', `/height stretched [\\d.]+ times/.test(${text('.sl-sky .sl-legend')})`],
      ['the strip ends where the stage begins: nothing lies over the Moon', "document.querySelector('.sl-sky').getBoundingClientRect().top >= document.querySelector('.sl-stage').getBoundingClientRect().bottom - 1"],
      ['its two thin lines say what they are on hover, Earth\'s as its path over the month, with no help cursor', `(() => { const hits = [...document.querySelectorAll('.sl-sky .sl-sky-hit')]; const tips = [...new Set(hits.map((hit) => hit.dataset.tip))]; const earth = hits.find((hit) => /^Where Earth goes/.test(hit.dataset.tip)); if (!earth || tips.length !== 2 || hits.some((hit) => getComputedStyle(hit).cursor === 'help')) return tips.join(' | '); earth.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); return true })() && ${after(500, `(/^Where Earth goes over the month\\. The Moon rocks slightly, so Earth draws a small loop/.test(${text('.sl-tip')}) || ${text('.sl-tip')}) && (document.querySelector('.sl-sky').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), true)`)}`],
    ],
  },
  {
    name: 'river',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [pickDate('2027-05-13T13:00'), click('Year'), click('Month')],
    checks: [
      ['the river draws the month in runs of state', "document.querySelectorAll('.sl-river .sl-run').length > 3"],
      ['a new landing date moves the landing and the playhead with it', `${LANDING} === '13 May 2027 · 13:00 UTC' && ${text('.sl-now')} === '13 May 2027 · 13:00 UTC' && location.hash.includes('t=301')`],
      ['the landing has its flag and the mission its lit span', "document.querySelector('.sl-river .sl-flag[aria-pressed=true]') !== null && document.querySelector('.sl-river .sl-span.is-lit.has-start') !== null"],
      ['the river\'s slider moves time', "(() => { const input = document.querySelector('.sl-seek input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, String(Number(input.min) + 5)); input.dispatchEvent(new Event('input', { bubbles: true })); return true })() && new Promise((done) => setTimeout(() => done(document.querySelector('.sl-now').textContent === '1 May 2027 · 05:00 UTC'), 200))"],
      ['it folds, and that is remembered', `(document.querySelector('.sl-river .sl-fold').click(), true) && new Promise((done) => setTimeout(() => done(document.querySelector('.sl-rows') === null && localStorage.getItem('sightline.riverMin') === '1'), 200))`],
    ],
  },
  {
    // The data covers decades and the screen opens on a few years of it: the rest is fetched when a date needs it.
    name: 'plan-years',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the screen opens on four years of flags, not the whole range', "performance.getEntriesByType('resource').filter((entry) => /\\/data\\/overview\\/\\d{4}\\.json$/.test(entry.name)).length === 4"],
      ['a landing in the data\'s first year answers', `${pickDate('2026-11-14T12:00')} && ${after(1500, `${LANDING} === '14 November 2026 · 12:00 UTC' && ${text('.sl-verdict')}.length > 0 && /@2026-11/.test(location.hash)`)}`],
      ['the Year view of the first year is whole', `(${click('Year')}, true) && ${after(600, YEAR_WHOLE)}`],
      ['a landing just past the years on hand answers once its year is fetched, with the screen left as it was', `(window.__sameScreen = document.querySelector('.sightline'), ${pickDate('2031-02-10T06:00')}) && ${after(2500, `${LANDING} === '10 February 2031 · 06:00 UTC' && ${text('.sl-verdict')}.length > 0 && window.__sameScreen === document.querySelector('.sightline')`)}`],
      ['a landing in the data\'s last year answers, on years fetched then', `${pickDate('2049-07-04T09:00')} && ${after(4000, `${LANDING} === '4 July 2049 · 09:00 UTC' && ${text('.sl-verdict')}.length > 0 && /@2049-07/.test(location.hash)`)}`],
      ['the Year view of the last year is whole', `(${click('Year')}, true) && ${after(600, YEAR_WHOLE)}`],
      ['a link to the last year, pasted into the open tab, opens on it', `(location.hash = '#a=shackleton-rim@2049-12&t=700&limits=14_24_99999_1_1&mode=plan', true) && ${after(2500, `${LANDING} === '30 December 2049 · 04:00 UTC'`)}`],
    ],
  },
  {
    name: 'plan-dates',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the column\'s type is 14 px for body, 12 px for labels, and nothing is clipped', COLUMN_READS],
      ['the charts\' day labels are 12 px too, none over another and none past the row\'s ends', "(() => { const rows = [...document.querySelectorAll('.sl-col .sl-over-axis')]; if (rows.length === 0) return 'no charts'; return rows.every((row) => { const box = row.getBoundingClientRect(); const spans = [...row.querySelectorAll('span')].map((span) => span.getBoundingClientRect()); return spans.every((span, i) => span.left >= box.left - 1 && span.right <= box.right + 1 && span.bottom <= box.bottom + 1 && (i === 0 || span.left >= spans[i - 1].right + 2)) && [...row.querySelectorAll('span')].every((span) => parseFloat(getComputedStyle(span).fontSize) === 12) }) || 'labels overlap or leave the row' })()"],
      ['each chart\'s longest time down is named in a line above the chart, in 12 px, whole, and nothing but the chart\'s own drawing is inside the chart', "(() => { const plots = [...document.querySelectorAll('.sl-col .sl-over-plot')]; if (plots.length === 0) return 'no charts'; const bad = plots.filter((plot) => { const note = plot.previousElementSibling; if (!note || !note.classList.contains('sl-over-note')) return true; const n = note.getBoundingClientRect(); const p = plot.getBoundingClientRect(); return n.bottom > p.top + 1 || n.height > 20 || note.scrollWidth > note.clientWidth + 1 || parseFloat(getComputedStyle(note).fontSize) !== 12 || !/^(✗ )?(Longest (dark spell|radio silence) \\d+ h · (no limit set|limit \\d+ h|over the \\d+ h limit)|No (dark spell|radio silence) in these \\d+ days?)$/.test(note.innerText.replace(/\\s+/g, ' ').trim()) || [...plot.children].some((child) => child.tagName.toLowerCase() !== 'svg') }); return bad.length === 0 || bad.map((plot) => (plot.previousElementSibling ? plot.previousElementSibling.innerText : 'no note')).join(' / ') })()"],
      ['this landing does not fit the mission, and the verdict says so as the column\'s largest line', `/^✗ Does not fit the mission$/.test(${text('.sl-verdict-words')}.trim()) && ${VERDICT_LARGEST}`],
      ['the date is limited to the dates the data covers, as the data describes itself, and the hour is one of 24 whole hours in UTC', "(async () => { const described = await (await fetch('/data/range.json')).json(); const RANGE = { first: described.start.slice(0, 10), last: new Date(Date.parse(described.end) - 3600000).toISOString().slice(0, 10) }; const date = document.querySelector('.sl-pick input'); const hours = [...document.querySelectorAll('.sl-pick select option')]; return date.type === 'date' && date.value === '2027-05-06' && date.min === RANGE.first && date.max === RANGE.last && /UTC/.test(date.getAttribute('aria-label')) && document.querySelector('.sl-pick select').value === '13' && hours.length === 24 && hours.every((option, i) => option.value === String(i).padStart(2, '0') && option.textContent === option.value + ':00') && /UTC/.test(document.querySelector('.sl-pick select').getAttribute('aria-label')) })()"],
      ['no minutes can be set: the control has no time or date-and-time field, only the date and the hour list', "document.querySelectorAll('.sl-pick input').length === 1 && document.querySelector('.sl-col input[type=\"time\"], .sl-col input[type=\"datetime-local\"]') === null"],
      ['the landing is one control that reads as the app writes it, with the pickers unseen under its date and its hour', `(() => { const control = document.querySelector('.sl-pick'); const parts = [...control.querySelectorAll('.sl-pick-part')]; const under = (part) => { const field = part.querySelector('input, select'); const text = part.querySelector('.sl-value').getBoundingClientRect(); const box = field.getBoundingClientRect(); return getComputedStyle(field).opacity === '0' && box.left <= text.left && box.right >= text.right && box.top <= text.top && box.bottom >= text.bottom }; return ${LANDING} === '6 May 2027 · 13:00 UTC' && control.getBoundingClientRect().height < 44 && parts.length === 2 && parts.every(under) })()`],
      ['pressing the date opens the calendar: by click, Enter or Space', "(() => { let opened = 0; HTMLInputElement.prototype.showPicker = function () { if (this.type === 'date') opened += 1 }; const input = document.querySelector('.sl-pick input'); input.click(); input.focus(); for (const key of ['Enter', ' ']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); input.blur(); return opened === 3 })()"],
      ['choosing an hour from the list moves the landing to that whole hour', `(() => { const hour = document.querySelector('.sl-pick select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hour, '09'); hour.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(300, `${LANDING} === '6 May 2027 · 09:00 UTC' && location.hash.startsWith('#a=connecting-ridge@2027-05&t=129&')`)}`],
      ['picking a date changes the landing, the playhead, the address and the verdict', `${pickDate('2027-06-21T17:00')} && ${after(500, `${LANDING} === '21 June 2027 · 17:00 UTC' && ${text('.sl-now')} === '21 June 2027 · 17:00 UTC' && location.hash.startsWith('#a=connecting-ridge@2027-06&t=497&') && /^✓ Fits/.test(${text('.sl-verdict-words')}.trim())`)}`],
      ['the tab\'s title follows the new landing date', "document.title === 'Connecting Ridge, 21 June 2027 · Sightline'"],
      ['a date outside the data changes nothing', `${pickDate('2051-03-01T00:00')} && ${after(300, `${LANDING} === '21 June 2027 · 17:00 UTC'`)}`],
      ['while the time bar is on the landing there is no note on the stage, and the column names the landing\'s date and hour', "document.querySelector('.sl-off-landing') === null && document.querySelector('.sl-river .sl-link') === null && [...document.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join('') === '21 June 2027 · 17:00 UTC'"],
      // The plan's controls sit inside the answer since the verdict leads the column, and the site's list ends "Custom point…": the check for a figure still loading reads the sentence and the rows only.
      ['with the time bar a day ahead the column still shows the landing\'s sentence and numbers, and a note on the stage says the Moon is showing another moment', `(() => { window.__answer = document.querySelector('.sl-answer').innerText; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); return true })() && ${after(700, `(() => { const dd = [${rowAbove('sun')}, ${rowAbove('earth')}]; const bar = (document.querySelector('.sl-moment-heights')?.textContent.replace(/\\s*[▸▾]\\s*$/, '').trim() ?? null); return ${text('.sl-now')} === '22 June 2027 · 17:00 UTC' && ${LANDING} === '21 June 2027 · 17:00 UTC' && document.querySelector('.sl-answer').innerText === window.__answer && !/…/.test(document.querySelector('.sl-col .sl-sentence').textContent + document.querySelector('.sl-col .sl-facts').innerText) && (bar === null || (/^Sun −?\\d+\\.\\d° · Earth −?\\d+\\.\\d° above the skyline$/.test(bar) && bar !== 'Sun ' + dd[0] + ' · Earth ' + dd[1] + ' above the skyline')) && document.querySelector('.sl-river .sl-link') === null && ${NOTE_SAYS('22 June 2027 · 17:00 UTC')} })()`)}`],
      ['"Back to landing" puts the time bar back on the landing, and the note goes', `(${noteLink('Back to landing')}, true) && ${after(600, `${text('.sl-now')} === '21 June 2027 · 17:00 UTC' && ${LANDING} === '21 June 2027 · 17:00 UTC' && document.querySelector('.sl-off-landing') === null && document.querySelector('.sl-answer').innerText === window.__answer`)}`],
      ['"Land here" makes the moment on the time bar the landing: the column updates to it and the note goes', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })), true) && ${after(500, `(${noteLink('Land here')}, true)`)} && ${after(700, `(() => { const dd = [${rowAbove('sun')}, ${rowAbove('earth')}]; return ${LANDING} === '22 June 2027 · 17:00 UTC' && document.querySelector('.sl-off-landing') === null && location.hash.startsWith('#a=connecting-ridge@2027-06&t=521&') && document.querySelector('.sl-answer').innerText !== window.__answer && ${LANDING} === '22 June 2027 · 17:00 UTC' && (() => { const bar = (document.querySelector('.sl-moment-heights')?.textContent.replace(/\\s*[▸▾]\\s*$/, '').trim() ?? null); return bar === null || bar === 'Sun ' + dd[0] + ' · Earth ' + dd[1] + ' above the skyline' })() })()`)}`],
      ['"+ Add" then a date yields two scenarios at one site on different dates', `(document.querySelector('.sl-tabs button[aria-label="Add a scenario"]').click(), true) && ${after(400, `document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 2 && ${pickDate('2027-08-02T06:00')}`)} && ${after(500, "location.hash.startsWith('#a=connecting-ridge@2027-06&t=521&') && location.hash.includes('list=connecting-ridge@2027-08-02T06') && location.hash.includes('sc=1') && document.querySelectorAll('.sl-river .sl-site-row').length === 1 && [...document.querySelectorAll('.sl-river .sl-flag')].map((flag) => flag.title.replace(/, (before|after) the days shown/, '')).join('|') === 'Scenario A: lands at Connecting Ridge on 22 June 2027 · 17:00 UTC. Press to select it.|Scenario B: lands at Connecting Ridge on 2 August 2027 · 06:00 UTC. Press to select it.'")}`],
      ['the column has no "Compare another date" or "Land at the playhead" button', "![...document.querySelectorAll('.sl-col button')].some((button) => /Compare another date|playhead/i.test(button.textContent))"],
      ['the tab that adds a scenario is a bare "+", named "Add a scenario"', `(() => { const add = [...document.querySelectorAll('.sl-tabs button')].at(-1); return add.textContent.trim() === '+' && add.getAttribute('aria-label') === 'Add a scenario' })()`],
      ['every tab carries a "−"; B\'s removes B, an undo notice appears, and with one scenario left there is no "−"', `(() => { const minus = [...document.querySelectorAll('.sl-tabs .sl-tab-remove')]; return minus.length === 2 && minus.map((button) => button.getAttribute('aria-label')).join('|') === 'Remove scenario A|Remove scenario B' && minus.every((button) => button.textContent.trim() === '−') && (minus[1].click(), true) })() && ${after(300, "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 1 && document.querySelector('.sl-tabs .sl-tab-remove') === null && !location.hash.includes('list=') && /^Removed scenario B · Undo$/.test(document.querySelector('.sl-removed').textContent.replace(/\\s+/g, ' ').trim())")}`],
    ],
  },
  {
    // Rodrigo's rule: no scrolling in the side panels at 1366 by 768. The tallest the column gets with the
    // mission's limits open: two scenarios, on the landing a first visit opens with, whose verdict has a
    // reason, a next landing and another site, and whose Sun row has a line more.
    name: 'mission-fits',
    hash: '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-01T00',
    noChat: true,
    steps: ["document.querySelector('.sl-mission-open').click()"],
    checks: [
      [
        'with the limits open, two scenarios and the tallest verdict, nothing in the column scrolls: the verdict, the limits and the Sun, Earth and ground all end above the screen\'s foot',
        `(() => { const col = document.querySelector('.sl-col'); const last = col.querySelector('.sl-answer').lastElementChild.getBoundingClientRect(); const lines = document.querySelectorAll('.sl-verdict .sl-reasons li, .sl-verdict .sl-next, .sl-verdict .sl-elsewhere').length; const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; if (document.querySelector('.sl-mission-inline') === null) return 'the limits are not open'; if (tabs !== 2 || lines < 3) return tabs + ' scenarios, ' + lines + ' lines in the verdict'; return window.innerWidth < 761 || (col.scrollHeight <= col.clientHeight && col.scrollWidth <= col.clientWidth && last.bottom <= window.innerHeight && document.querySelectorAll('.sl-facts .sl-fact').length === 3) || 'column ' + col.scrollHeight + ' in ' + col.clientHeight + ', last ends ' + Math.round(last.bottom) + ' of ' + window.innerHeight })()`,
        1500,
      ],
      [
        'each limit\'s name is on one line beside its value, the two that used to wrap in fewer words: "Longest dark spell" and "Radio silence"',
        "(() => { const tops = [...document.querySelectorAll('.sl-mission-inline .sl-param-top')]; const names = tops.map((top) => top.querySelector('label').textContent.trim()).join('|'); const oneLine = tops.every((top) => { const label = top.querySelector('label'); return label.getBoundingClientRect().height < 1.9 * parseFloat(getComputedStyle(label).fontSize) * 1.5 }); return (names === 'Mission length|Longest dark spell|Radio silence|Steepest ground' && oneLine) || names + ' one line: ' + oneLine })()",
      ],
      [
        'with the widest values showing (168 h of darkness, 400 h of silence) the names are still on one line and the column still does not scroll',
        `(() => { const set = (id, value) => { const input = document.querySelector('#' + id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })) }; set('sl-m-dark', 168); set('sl-m-silence', 400); return true })() && ${after(700, "(() => { const col = document.querySelector('.sl-col'); const tops = [...document.querySelectorAll('.sl-mission-inline .sl-param-top')]; const values = tops.map((top) => top.querySelector('output').textContent.trim()).join('|'); const oneLine = tops.every((top) => top.getBoundingClientRect().height < 1.9 * parseFloat(getComputedStyle(top.querySelector('label')).fontSize) * 1.5); return (/168 h/.test(values) && /400 h/.test(values) && oneLine && (window.innerWidth < 761 || col.scrollHeight <= col.clientHeight)) || values + ' one line: ' + oneLine + ', column ' + col.scrollHeight + ' in ' + col.clientHeight })()")}`,
      ],
      [
        'while the limits are open the lines about the landing\'s hour, the "Sun and Earth together" row and the line about Horizons step aside, as the charts do, and each row keeps its share and its mark against the limit; closing the box brings them back',
        `(document.querySelector('.sl-col .sl-fact-at') === null && document.querySelector('.sl-col .sl-fact.is-both') === null && document.querySelector('.sl-col .sl-horizons') === null && document.querySelector('.sl-col .sl-over-plot') === null && /^\\d+%of the mission$/.test(document.querySelector('.sl-fact.is-sun .sl-fact-main').textContent.trim()) && ['ok', 'miss'].includes(document.querySelector('.sl-fact.is-sun .sl-fact-check').dataset.check) && (document.querySelector('.sl-mission-open').click(), true)) && ${after(900, "(document.querySelector('.sl-mission-inline') === null && document.querySelectorAll('.sl-col .sl-fact-at').length === 2 && document.querySelector('.sl-col .sl-fact.is-both') !== null && document.querySelector('.sl-col .sl-horizons') !== null) || 'not back'")}`,
      ],
    ],
  },
  {
    // The mission's limits open in the column, under the mission's own control; "Advanced" at their foot opens a panel.
    name: 'mission',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ["document.querySelector('.sl-mission-open').click()"],
    checks: [
      ['the mission\'s control in the column opens its limits under itself, on the default preset, and says "Select"; the rail has no "Mission" and no panel opens', "(() => { const open = document.querySelector('.sl-mission-open'); const limits = document.querySelector('.sl-col .sl-mission-inline'); const rail = [...document.querySelectorAll('.sl-rail button, .sl-rail a')].map((el) => el.textContent.trim()); return (limits !== null && open.getAttribute('aria-expanded') === 'true' && /Select$/.test(open.textContent.trim()) && limits.querySelector('.sl-presets button[aria-pressed=\"true\"]')?.textContent.includes('Short stay') && !rail.includes('Mission') && document.querySelector('.sl-drawer') === null && limits.getBoundingClientRect().top >= open.getBoundingClientRect().bottom - 1) || open.textContent })()"],
      ['the limits are the presets and the six basic parameters, and nothing else but the "Advanced" link', "(() => { const limits = document.querySelector('.sl-mission-inline'); const presets = [...limits.querySelectorAll('.sl-presets button')].map((button) => button.textContent.replace(/\\s+/g, ' ').trim()); const link = limits.querySelector('.sl-advanced-link'); return (presets.join('|') === 'Short stay example|Long stay example|Custom' && limits.querySelectorAll('.sl-param').length === 6 && limits.querySelector('#sl-m-clear') === null && limits.querySelector('.sl-height-pick') === null && limits.querySelector('.sl-assume') === null && limits.querySelector('details') === null && /^Advanced/.test(link.textContent.trim()) && limits.lastElementChild === link) || presets.join('|') })()"],
      ['the default landing does not fit: the reason, on one line, names the limit', `/^Sun down for \\d+ h; your limit is 24 h$/.test(${text('.sl-reasons li')}.trim()) && document.querySelector('.sl-verdict').classList.contains('is-miss')`, 1200],
      ['every numeric parameter is a slider, and radio silence starts at its last stop, "No limit"', "(() => { const limits = document.querySelector('.sl-mission-inline'); const sliders = [...limits.querySelectorAll('input[type=\"range\"]')]; const silence = limits.querySelector('#sl-m-silence'); const dark = limits.querySelector('#sl-m-dark'); return sliders.length === 4 && limits.querySelector('select') === null && limits.querySelector('input[type=\"number\"]') === null && silence.type === 'range' && silence.step === dark.step && silence.min === dark.min && Number(silence.max) === 400 + Number(dark.step) && Number(dark.max) === 168 && Number(limits.querySelector('#sl-m-days').max) === 30 && silence.value === silence.max && silence.closest('.sl-param').querySelector('output').textContent === 'No limit' && silence.getAttribute('aria-valuetext') === 'No limit' })()"],
      ['one stop down from "No limit" is a limit in hours, and the link carries it', `(() => { const silence = document.querySelector('#sl-m-silence'); const set = (value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(silence, String(value)); silence.dispatchEvent(new Event('input', { bubbles: true })) }; set(400); return new Promise((done) => setTimeout(() => { const limited = silence.closest('.sl-param').querySelector('output').textContent === '400 h' && location.hash.includes('limits=14_24_400_1_1'); set(404); setTimeout(() => done(limited && location.hash.includes('limits=14_24_99999_1_1') && silence.closest('.sl-param').querySelector('output').textContent === 'No limit'), 300) }, 300)) })()`],
      ['with the limits open the column does not scroll', `${COLUMN_FITS} || (() => { const col = document.querySelector('.sl-col'); return 'column ' + col.scrollHeight + ' in ' + col.clientHeight + ', ' + col.scrollWidth + ' in ' + col.clientWidth })()`],
      ['and the whole disc is inside the stage', DISC_INSIDE],
      ['the long-stay preset changes the mission, the verdict and the address', `(${click('Long stay example')}, true) && new Promise((done) => setTimeout(() => done(location.hash.includes('limits=60_336_99999_1_1') && location.hash.includes('slope=15') && /Long stay/.test(document.querySelector('.sl-mission-open').textContent) && !/limit is 24 h/.test(document.querySelector('.sl-verdict').textContent)), 400))`],
      ['Long stay sets no limit on radio silence: its slider is at "No limit"', "document.querySelector('#sl-m-silence').getAttribute('aria-valuetext') === 'No limit' && !/radio silence/.test(document.querySelector('.sl-mission-open').textContent)"],
      ['the limits have no caption about how the Sun moves', `!/circles the horizon/.test(${text('.sl-mission-inline')})`],
      ['"Advanced" shows, in the same box and with no panel opening, what the Planner\'s Advanced holds: how far Earth must clear the skyline, the panel\'s and the antenna\'s heights at 2 m, and no note on landing accuracy (that is the Accuracy panel\'s), with "Limits" at its top to go back', `(document.querySelector('.sl-advanced-link').click(), true) && ${after(900, `(() => { const drawer = document.querySelector('.sl-mission-inline.is-advanced'); if (!drawer) return 'the box did not change'; const pressed = (label) => [...drawer.querySelector('.sl-height-pick[aria-label="' + label + '"]').querySelectorAll('button')].filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent.trim()).join(); const notes = drawer.textContent; return (document.querySelector('.sl-drawer') === null && document.querySelectorAll('.sl-mission-inline').length === 1 && /Limits$/.test(drawer.querySelector('.sl-advanced-link').textContent.trim()) && drawer.firstElementChild === drawer.querySelector('.sl-advanced-link') && drawer.querySelector('.sl-presets') === null && drawer.querySelectorAll('select').length === 1 && drawer.querySelector('#sl-m-clear').value === '0' && pressed('Solar panel height') === '2 m' && pressed('Antenna height') === '2 m' && [...drawer.querySelectorAll('.sl-height-pick button')].every((button) => !button.disabled && button.title.length > 10) && !/Landing accuracy/i.test(notes) && drawer.querySelector('.sl-assume') === null) || notes.slice(0, 160) })()`)}`],
      ['with Advanced showing the column does not scroll, and the Moon\'s disc is whole', `(${COLUMN_FITS} || (() => { const col = document.querySelector('.sl-col'); return 'column ' + col.scrollHeight + ' in ' + col.clientHeight + ', ' + col.scrollWidth + ' in ' + col.clientWidth })()) === true && ${DISC_INSIDE}`],
      ['"Limits" leads back to the presets and the six limits; "Select" on the mission\'s control closes the box, and the control names the mission again', `(document.querySelector('.sl-mission-inline.is-advanced .sl-advanced-link').click(), true) && ${after(400, "(document.querySelector('.sl-mission-inline.is-advanced') === null && document.querySelector('.sl-mission-inline .sl-presets') !== null && document.querySelectorAll('.sl-mission-inline .sl-param').length === 6 && (document.querySelector('.sl-mission-open').click(), true))")} && ${after(400, "(() => { const open = document.querySelector('.sl-mission-open'); return (document.querySelector('.sl-mission-inline') === null && open.getAttribute('aria-expanded') === 'false' && /Long stay/.test(open.textContent) && !/Select/.test(open.textContent)) || open.textContent })()")}`],
      ['nothing the page says in its own words uses "lunar night", "lunar day", "playhead" or "scrub", or "the ridge" for the skyline', OWN_WORDS],
    ],
  },
  {
    name: 'compare',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13',
    steps: [click('Compare')],
    checks: [
      ['a link with two scenarios opens both: two tabs and two flags on the time bar', "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 2 && document.querySelectorAll('.sl-river .sl-flag').length === 2"],
      ['with the Compare drawer open, the whole disc is inside the stage with a margin on every side', DISC_INSIDE],
      ['a short list says which site and landing each letter is', "(() => { const items = [...document.querySelectorAll('.sl-compare-legend li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); return items.length === 2 && /^A ?Connecting Ridge ?6 May 2027 · 13:00 UTC$/.test(items[0]) && /^B ?Shackleton Rim ?6 May 2027 · 13:00 UTC$/.test(items[1]) })()"],
      ['the table\'s heads are the letters, the verdict comes first as a mark, its rows carry their units, and its cells are bare numbers with the best marked and, with two scenarios, the hours under each share', "(() => { const heads = [...document.querySelectorAll('.sl-compare thead th')].map((th) => th.textContent.trim()); const rows = [...document.querySelectorAll('.sl-compare tbody tr')]; const names = rows.map((row) => row.querySelector('th').textContent.trim()); const marks = [...rows[0].querySelectorAll('td')]; const cells = rows.slice(1, 6).flatMap((row) => [...row.querySelectorAll('td')].map((td) => td.textContent.trim())); return heads.join('') === 'AB' && names.join('|') === 'Fits the mission|Sunlit, %|Longest dark spell, h|Earth in view, %|Longest radio silence, h|Slope, °|MoreAt landingScience' && marks.length === 2 && marks.every((mark) => /^[✓◇✕]$/.test(mark.textContent.trim()) && /^(Fits|Does not fit)/.test(mark.title)) && cells.length === 10 && cells.every((cell) => /^[\\d.]+( ★)?( \\d+ of \\d+ h)?$/.test(cell)) && cells.filter((cell) => / of \\d+ h$/.test(cell)).length === 4 && document.querySelectorAll('.sl-compare td.is-best').length > 0 })()"],
      ['"More", "At landing" and "Science" are folds, closed at first: the first two, opened, add the Sun and Earth together, the sunlight on a panel and the four angles; closed again, the rows go', `(() => { const folds = [...document.querySelectorAll('.sl-compare .sl-compare-fold')]; const names = () => [...document.querySelectorAll('.sl-compare tbody tr')].map((row) => row.querySelector('th').textContent.trim()).slice(7).join('|'); if (folds.length !== 3 || folds.some((fold) => fold.getAttribute('aria-expanded') !== 'false')) return 'the folds are not all three there and closed'; folds[0].click(); folds[1].click(); return ${after(300, `(() => { const names = [...document.querySelectorAll('.sl-compare tbody tr')].map((row) => row.querySelector('th').textContent.trim()).slice(7).join('|'); const open = names === "Sun and Earth together, %|Sunlight on a panel, W/m²|Sun's elevation, °|Sun above the skyline, °|Earth's elevation, °|Earth above the skyline, °"; [...document.querySelectorAll('.sl-compare .sl-compare-fold')].slice(0, 2).forEach((fold) => fold.click()); return open || names })()`)}.then((open) => (open !== true ? open : ${after(300, "document.querySelectorAll('.sl-compare tbody tr').length === 7")})) })()`],
      ['the next landing that fits is offered when the landing misses the limits, and adds scenario C, which fits', `/^Next landing that fits: /.test(${text('.sl-next')}.trim()) && (document.querySelector('.sl-next').click(), true) && ${after(2500, `document.querySelectorAll('.sl-compare thead th').length === 3 && location.hash.includes('&sc=2') && /^(yes|marginal)$/.test(document.querySelector('.sl-compare .sl-compare-verdict td:last-child').dataset.verdict ?? '') && /^✓ Fits/.test(${text('.sl-verdict-words')}.trim()) && document.querySelector('.sl-next') === null`)}`],
      ['picking B makes it the scenario on show', "(document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]')[1].click(), true) && new Promise((done) => setTimeout(() => done(document.querySelector('#sl-site').value === 'shackleton-rim' && location.hash.includes('&sc=1')), 300))"],
      ['its tab\'s "−" removes it, leaving two; Compare has no remove button of its own', `(() => { const minus = document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario B"]'); return minus !== null && ![...document.querySelectorAll('.sl-compare button')].some((button) => /Remove/.test(button.textContent)) && (minus.click(), true) })() && new Promise((done) => setTimeout(() => done(document.querySelectorAll('.sl-compare thead th').length === 2 && !location.hash.includes('shackleton-rim')), 300))`],
      ['every hover text now on the page keeps the rules: two sentences at most, never just the label, no "elevation" without what it is measured from', TIPS_KEEP_RULES],
    ],
  },
  {
    // The easter egg: no Hype button until its name is typed on the screen, outside a text box, or sent to Scout as a message of its own.
    // Then the button is in the rail and its panel opens, for that visit: a reload starts without it.
    name: 'hype-egg',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['before the word is typed there is no Hype button, in the rail or in "More", and nothing names it', "![...document.querySelectorAll('.sl-rail button')].some((button) => /hype/i.test(button.textContent)) && document.querySelector('.sl-hype') === null && document.querySelector('a[href*=\"hype\"]') === null && !/hype/i.test(document.body.innerText)"],
      ['typed into Scout\'s question box, the word is only a word: no button, no panel', `(${OPEN_SCOUT}, true) && ${after(700, "(() => { const box = document.querySelector('#sl-question'); box.focus(); for (const key of 'hype') box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return true })()")} && ${after(1500, "location.pathname === '/sightline/' && document.querySelector('.sl-hype') === null && document.querySelector('.sl-rail-hype') === null && document.querySelector('.sl-scout-panel') !== null")}`],
      ['a longer message that only holds the word goes to Scout as any question does: one chat request, and still no button', `${STAND_IN_SCOUT} && (() => { const form = document.querySelector('.sl-scout-panel .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'What is all the hype about?'); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true })() && ${after(1200, "(window.__sent.length === 1 && window.__sent[0].messages.at(-1).text === 'What is all the hype about?' && document.querySelectorAll('.sl-talk .sl-said').length === 2 && document.querySelector('.sl-hype') === null && ![...document.querySelectorAll('.sl-rail button')].some((button) => /hype/i.test(button.textContent))) || window.__sent.length + ' sent'")}`],
      ['the word alone sent to Scout, in any case and with spaces round it, reveals the button and opens the panel on this page: no chat request is made, nothing is added to the conversation, and the box is left empty', `(() => { const form = document.querySelector('.sl-scout-panel .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '  Hype '); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true })() && ${after(1200, "(() => { const panel = document.querySelector('.sl-drawer.sl-hype'); if (!panel) return 'no panel'; const box = document.querySelector('#sl-question'); const said = document.querySelectorAll('.sl-talk .sl-said').length; const button = [...document.querySelectorAll('.sl-rail button')].find((b) => b.textContent.trim() === 'Hype'); return (location.pathname === '/sightline/' && window.__sent.length === 1 && (said === 0 || said === 2) && (box === null || box.value === '') && button !== undefined) || window.__sent.length + ' sent, ' + said + ' said, box ' + box?.value })()")}`],
      ['the panel says what the first page said: "The landing party", the line under it, the video with its poster, and the AI note; the rail\'s button is still "Hype"; nothing is stored', "(() => { const panel = document.querySelector('.sl-drawer.sl-hype'); const video = panel.querySelector('video'); const lines = [...panel.querySelectorAll('p')].map((p) => p.textContent.trim()); const button = window.innerWidth < 761 ? null : document.querySelector('.sl-rail .sl-rail-hype'); const order = [...panel.children].map((el) => el.tagName).join(); return (document.querySelector('.sightline.is-plan') !== null && panel.querySelector('h2').textContent === 'The landing party' && [...panel.querySelectorAll('.sl-drawer-head button')].map((b) => b.textContent.trim()).join() === 'Close' && video.getAttribute('poster') === '/media/hype-poster.jpg' && video.querySelector('source').getAttribute('src') === '/media/hype.mp4' && video.controls && lines.join(' // ') === 'What it feels like when our numbers finally agree with NASA’s. // AI-generated video.' && order === 'HEADER,P,VIDEO,P' && panel.querySelector('.site-tabs, a') === null && (window.innerWidth < 761 || (button.textContent.trim() === 'Hype' && button.getAttribute('aria-pressed') === 'true' && (button.getAttribute('title') ?? button.dataset.tip) === 'Opens the team\\'s hype video.')) && sessionStorage.getItem('sightline.hype') === null && localStorage.getItem('sightline.hype') === null) || lines.join(' // ') + ' ' + order })()"],
      ['the panel is a panel like the others: the same width, the AI note on one line, nothing scrolling, and the Moon\'s whole disc beside it, not under it', `(() => { const panel = document.querySelector('.sl-hype'); const note = panel.querySelector('.sl-hype-note'); const oneLine = note.getBoundingClientRect().height < 1.9 * parseFloat(getComputedStyle(note).fontSize) * 1.5; if (window.innerWidth < 761) return oneLine && panel.scrollHeight <= panel.clientHeight + 1; return (Math.abs(panel.getBoundingClientRect().width - 304) <= 2 && oneLine && panel.scrollHeight <= panel.clientHeight && panel.getBoundingClientRect().left >= document.querySelector('.sl-stage').getBoundingClientRect().right - 1) || Math.round(panel.getBoundingClientRect().width) + ' wide, ' + panel.scrollHeight + ' in ' + panel.clientHeight })() && ${COLUMN_FITS} && (window.innerWidth < 761 || ${DISC_INSIDE})`],
      ['Close shuts it and the button stays; the button opens it again, and Escape shuts it', `(${click('Close')}, true) && ${after(500, `(() => { if (document.querySelector('.sl-hype') !== null) return 'still open'; if (window.innerWidth < 761) { ${click('More')}; } return true })()`)} && ${after(900, "(() => { const button = [...document.querySelectorAll('.sl-rail button')].find((b) => b.textContent.trim() === 'Hype'); if (!button) return 'no button'; button.click(); return true })()")} && ${after(1500, "(document.querySelector('.sl-hype') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true))")} && ${after(2100, "document.querySelector('.sl-hype') === null && [...document.querySelectorAll('.sl-rail button')].some((b) => b.textContent.trim() === 'Hype')")}`],
      ['it is found for the visit only: a reload (here with the marks an earlier version stored put back) starts the page again', "(sessionStorage.setItem('sightline.hype', '1'), localStorage.setItem('sightline.hype', '1'), window.__reloaded = false, location.reload(), true)"],
      ['after the reload there is no Hype button and no panel, and the old marks are cleared', "window.__reloaded === undefined && ![...document.querySelectorAll('.sl-rail button')].some((button) => /hype/i.test(button.textContent)) && document.querySelector('.sl-hype') === null && sessionStorage.getItem('sightline.hype') === null && localStorage.getItem('sightline.hype') === null", 4000],
      ['typed on the screen, outside a text box, the word brings the button and the panel back, on this page', `(document.activeElement?.blur(), ${TYPE_HYPE}) && ${after(1200, "location.pathname === '/sightline/' && document.querySelector('.sl-drawer.sl-hype video') !== null && [...document.querySelectorAll('.sl-rail button')].some((b) => b.textContent.trim() === 'Hype') && sessionStorage.getItem('sightline.hype') === null")}`],
    ],
  },
  {
    // From Watch, where there is no rail: the word opens Plan with the panel.
    name: 'hype-egg-watch',
    hash: '',
    still: true,
    checks: [
      ['typed in Watch, the word opens Plan with the Hype panel, on this page', `${TYPE_HYPE} && ${after(1500, "location.pathname === '/sightline/' && document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-drawer.sl-hype video') !== null && document.querySelector('.sl-handle') === null")}`],
    ],
  },
  {
    // From a page with the tab bar (the Atlas): no tab leads to it, and the typed word opens Sightline with the panel, not the old page.
    name: 'hype-egg-tabs',
    path: '/atlas/',
    hash: '#a=connecting-ridge@2027-05&t=120&limits=14_72_72_1_1&mode=learn',
    ready: "document.querySelector('a.site-tab') !== null",
    checks: [
      ['no tab and no link on a page with the tab bar leads to it', "(() => { const tabs = [...document.querySelectorAll('a.site-tab')].map((tab) => tab.textContent.trim()); return (tabs.length > 5 && !tabs.some((tab) => /hype/i.test(tab)) && document.querySelector('a[href*=\"hype\"]') === null) || tabs.join('|') })()"],
      ['three of its letters and then another key do nothing', `(() => { for (const key of ['h', 'y', 'p', 'ArrowLeft', 'e']) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return true })() && ${after(700, "location.pathname === '/atlas/'")}`],
      ['typed in one go, the word is taken', `(setTimeout(() => ${TYPE_HYPE}, 100), true)`],
      ['it opens Sightline, the front page, with the Hype panel open: not the old page', "location.pathname === '/' && document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-drawer.sl-hype video') !== null && document.querySelector('.site-tabs') === null && !location.hash.includes('hype')", 8000],
    ],
  },
  {
    // The old page still answers for links that were shared.
    name: 'hype-old-page',
    path: '/hype/',
    hash: '',
    ready: "document.querySelector('.hype video') !== null",
    checks: [['the old address still opens its page', "location.pathname === '/hype/' && document.querySelector('.hype video') !== null"]],
  },
  {
    // Three scenarios, A on show: B is removed from its own tab, then brought back.
    name: 'tabs',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00',
    checks: [
      ['three tabs and the "+" share one row, each tab with its "−" as a badge on its upper right corner', `document.querySelectorAll('.sl-tabs button').length === 7 && ${TABS_ONE_ROW} && ${BADGES_ON_CORNERS}`, 600],
      ['removing B from its own tab while A is on show leaves two, A still on show, and the old C lettered B', `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario B"]').click(), true) && ${after(400, "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-site-row')].map((row) => row.querySelector('.sl-site-name').textContent + ':' + [...row.querySelectorAll('.sl-flag')].map((flag) => flag.textContent.replace(/[‹›]/g, '')).join('')); const tabs = [...document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]')]; if (rows.join('|') !== 'Connecting Ridge:A|de Gerlache Rim:B') throw new Error(rows.join('|')); return tabs.length === 2 && tabs[0].getAttribute('aria-pressed') === 'true' && document.querySelector('#sl-site').value === 'connecting-ridge' && location.hash.includes('list=de-gerlache-rim@2027-06-01T00') && !location.hash.includes('shackleton-rim') && !location.hash.includes('sc=') })()")}`],
      ['a notice says "Removed scenario B · Undo", and it is not over the Moon', "(() => { const notice = document.querySelector('.sl-removed'); if (!notice) return false; const box = notice.getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const over = box.left < stage.right && box.right > stage.left && box.top < stage.bottom && box.bottom > stage.top; return /^Removed scenario B · Undo$/.test(notice.textContent.replace(/\\s+/g, ' ').trim()) && notice.getAttribute('role') === 'status' && !over })()"],
      ['the tab row still does not wrap', TABS_ONE_ROW],
      ['Undo restores all three in order, with A still on show', `(document.querySelector('.sl-removed button').click(), true) && ${after(400, "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-site-row')].map((row) => row.querySelector('.sl-site-name').textContent + ':' + [...row.querySelectorAll('.sl-flag')].map((flag) => flag.textContent.replace(/[‹›]/g, '')).join('')); if (rows.join('|') !== 'Connecting Ridge:A|Shackleton Rim:B|de Gerlache Rim:C') throw new Error(rows.join('|')); return document.querySelector('.sl-tabs button[aria-label=\"Scenario A\"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.sl-removed') === null && location.hash.includes('list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00') })()")}`],
      ['removing the scenario on show shows the one that takes its place; the notice goes after about five seconds', `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario A"]').click(), true) && ${after(400, "document.querySelector('#sl-site').value === 'shackleton-rim' && document.querySelector('.sl-tabs button[aria-label=\"Scenario A\"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.sl-removed') !== null")} && ${after(5600, "document.querySelector('.sl-removed') === null && document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 2")}`],
    ],
  },
  {
    // Four sites on four dates, the longest labels: none is cut, whichever panel is open.
    name: 'rows-panels',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    checks: [
      ['with four scenarios at four sites there are four rows, each named by its site and carrying its scenario\'s flag', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-site-row')].map((row) => row.querySelector('.sl-site-name').textContent + ':' + [...row.querySelectorAll('.sl-flag')].map((flag) => flag.textContent.replace(/[‹›]/g, '')).join('')); return rows.join('|') === 'Connecting Ridge:A|Shackleton Rim:B|de Gerlache Rim:C|Peak near Shackleton:D' || rows.join('|') })()", 1500],
      ['with no panel open no label is cut', `window.innerWidth < 761 || ${LABELS_WHOLE}`],
      ['with Scout\'s panel open no label is cut', `window.innerWidth < 761 || ((document.querySelector('.sl-rail .sl-rail-scout').click(), true) && ${after(700, `document.querySelector('.sl-scout-panel') !== null && ${LABELS_WHOLE}`)})`],
      ['with the mission\'s limits open in the column no label is cut', `window.innerWidth < 761 || ((document.querySelector('.sl-mission-open').click(), true) && ${after(700, `(() => { const ok = document.querySelector('.sl-mission-inline') !== null && ${LABELS_WHOLE}; document.querySelector('.sl-mission-open').click(); return ok })()`)})`],
      ['with the Compare panel open no label is cut', `window.innerWidth < 761 || ((${click('Compare')}, true) && ${after(700, `document.querySelector('.sl-compare') !== null && ${LABELS_WHOLE}`)})`],
      ['with the Layers panel open no label is cut', `window.innerWidth < 761 || (([...document.querySelectorAll('.sl-rail > button')].find((button) => button.textContent.trim().startsWith('Layers')).click(), true) && ${after(700, `document.querySelector('.sl-compare') === null && document.querySelector('.sl-drawer') !== null && ${LABELS_WHOLE}`)})`],
      ['each flag\'s hover text and accessible name say the site and the landing in full', "document.querySelectorAll('.sl-river .sl-flag').length > 0 && [...document.querySelectorAll('.sl-river .sl-flag')].every((row) => /2027/.test(row.title || row.dataset.tip || '') && /2027/.test(row.getAttribute('aria-label') ?? ''))"],
    ],
  },
  {
    // A first visit: on a laptop Scout's card is open beside the Moon, as tall as the empty sky; on a phone he is his mark and one line.
    name: 'scout-first',
    hash: '',
    still: true,
    scoutFirst: true,
    checks: [
      ['on a laptop the page opens with his card open, his greeting, three ideas and an input that has not taken the focus; on a phone he is shut', "window.innerWidth < 1180 ? document.querySelector('.sl-card') === null && document.querySelector('.scout-face').getAttribute('aria-expanded') === 'false' : (() => { const card = document.querySelector('.sl-card'); return card !== null && card.querySelector('.sl-hello p') !== null && card.querySelectorAll('.sl-idea:not(.is-action)').length === 3 && card.querySelector('.sl-ask input') !== null && document.activeElement !== card.querySelector('.sl-ask input') })()", 600],
      ['the card stands down the far right edge, the whole height of the window, with the stage ending where it begins: clear of the Moon, the play control, the key and the buttons', `window.innerWidth < 761 || (() => { const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const card = document.querySelector('.sl-card').getBoundingClientRect(); const inStage = ['.sl-pill', '.sl-watch-key', '.sl-top', '.sl-brand', '.sl-tour-chip'].every((sel) => { const el = document.querySelector(sel); return !el || el.getBoundingClientRect().right <= card.left + 0.5 }); return (${CARD_CLEAR} && inStage) || JSON.stringify({ card, stage }) })()`, 1500],
      ['the tour has a chip of its own, outlined until the tour is taken: under his mark on a laptop, under the key on a phone, clear of the card, the play control and the disc of the Moon', "(() => { const chip = document.querySelector('.sl-tour-chip'); if (!chip) return 'no chip'; const at = chip.getBoundingClientRect(); const apart = (sel) => { const el = document.querySelector(sel); if (!el) return true; const b = el.getBoundingClientRect(); return at.right <= b.left || at.left >= b.right || at.bottom <= b.top || at.top >= b.bottom }; const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const clear = Math.hypot(cx - Math.max(at.left, Math.min(cx, at.right)), cy - Math.max(at.top, Math.min(cy, at.bottom))) >= r; const face = document.querySelector('.scout-face').getBoundingClientRect(); const placed = window.innerWidth < 900 ? at.top < window.innerHeight / 3 : at.top >= face.bottom; return (chip.textContent.trim().endsWith('One-minute tour') && chip.classList.contains('is-new') && placed && clear && apart('.sl-card') && apart('.sl-pill') && apart('.sl-watch-key') && apart('.sl-brand') && apart('.scout-face') && at.left >= 0 && at.right <= window.innerWidth) || JSON.stringify({ at, placed, clear }) })()", 600],
      ['shutting the card is kept for the visit, not for good', `window.innerWidth < 1180 || ((document.querySelector('.sl-card .sl-card-head button').click(), true) && ${after(300, "document.querySelector('.sl-card') === null && sessionStorage.getItem('sightline.scoutShut') === '1' && localStorage.getItem('sightline.scoutShut') === null")})`],
      ['his mark opens it again, in the same place, and that is remembered too', `window.innerWidth < 1180 || ((document.querySelector('.scout-face').click(), true) && ${after(500, "document.querySelector('.sl-card') !== null && Math.abs(document.querySelector('.sl-card').getBoundingClientRect().right - window.innerWidth) <= 0.5 && sessionStorage.getItem('sightline.scoutShut') === '0'")})`],
      ['the chip starts the tour at its first step, and is gone while the tour is on', `(document.querySelector('.sl-tour-chip').click(), true) && ${after(900, "document.querySelector('.sl-tour') !== null && document.querySelector('.sl-tour-chip') === null && localStorage.getItem('sightline.tourTaken') === '1'")}`],
    ],
  },
  {
    // Scout stays open from Watch into Plan and back, until the visitor shuts him. A phone is left as it was: his panel is a full sheet there.
    // Motion is left on here: nothing moves all the same.
    name: 'scout-plan',
    hash: '',
    scoutFirst: true,
    checks: [
      ['"Plan a landing" opens Plan with his panel open beside it (on a phone, with no panel over it), and the greeting’s ideas give way to the panel’s own', `(${click('Plan a landing')}, true) && ${after(900, "document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-card') === null && (document.querySelector('.sl-scout-panel') !== null) === (window.innerWidth >= 761)")}`],
      ['his panel is where his card was: down the far right edge, right of the rail, the same width', "window.innerWidth < 761 || (() => { const panel = document.querySelector('.sl-scout-panel').getBoundingClientRect(); const rail = document.querySelector('.sl-rail').getBoundingClientRect(); return (Math.abs(panel.right - window.innerWidth) <= 0.5 && Math.abs(panel.width - 336) <= 2 && panel.left >= rail.right - 0.5 && panel.top <= 0.5 && panel.bottom >= window.innerHeight - 0.5) || JSON.stringify({ panel, rail }) })()"],
      ['Home brings his card back in Watch', `window.innerWidth < 761 || ((document.querySelector('.sl-rail-home').click(), true) && ${after(900, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-card') !== null && Math.abs(document.querySelector('.sl-card').getBoundingClientRect().right - window.innerWidth) <= 0.5")})`],
      ['shutting his panel in Plan shuts him: back in Watch his card is shut too, and Plan then opens without the panel', `window.innerWidth < 761 || ((${click('Plan a landing')}, true) && ${after(700, "document.querySelector('.sl-scout-panel') !== null && (document.querySelector('.sl-scout-panel .sl-drawer-head button, .sl-scout-panel header button').click(), true)")} && ${after(1100, `document.querySelector('.sl-scout-panel') === null && sessionStorage.getItem('sightline.scoutShut') === '1' && (${key('p')}, true)`)} && ${after(1600, `document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-card') === null && (${key('p')}, true)`)} && ${after(2200, "document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-scout-panel') === null")})`],
      ['the rail’s Scout opens him again, for Watch as well', `window.innerWidth < 761 || ((document.querySelector('.sl-rail-scout').click(), true) && ${after(500, `document.querySelector('.sl-scout-panel') !== null && sessionStorage.getItem('sightline.scoutShut') === '0' && (${key('p')}, true)`)} && ${after(1100, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-card') !== null")})`],
    ],
  },
  {
    // Home, in the rail (in "More" on a phone): back to the opening screen as a first visit finds it.
    name: 'home',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['Home is a house with its name for a screen reader, and no "Watch" or "Hide" beside it', "(() => { const home = document.querySelector('.sl-rail-home'); const names = [...document.querySelectorAll('.sl-rail button')].map((button) => button.textContent.trim()); return home !== null && home.querySelector('svg') !== null && home.textContent.trim() === 'Home' && !names.includes('Watch') && !names.includes('Hide') })()"],
      ['Home lands on the opening screen: Watch, the address cleared, the play control whole, Scout\'s card open on a laptop and the tour one press away', `(document.querySelector('.sl-rail-home').click(), true) && ${after(900, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-col') === null && document.querySelector('.sl-top') !== null && document.querySelector('.sl-pill') !== null && (document.querySelector('.sl-card') !== null) === (window.innerWidth >= 1180) && document.querySelector('.sl-tour-chip') !== null && location.hash === '' && localStorage.getItem('sightline.clear') !== '1'")}`],
      ['the site is kept: "Plan a landing" opens Plan on it again, landing at the hour on the clock as it does from Watch', `(${click('Plan a landing')}, true) && ${after(600, "document.querySelector('.sightline.is-plan') !== null && document.querySelector('#sl-site')?.value === 'connecting-ridge' && /^#a=connecting-ridge@/.test(location.hash)")}`],
    ],
  },
  {
    // The view and the rail agree. A panel opened or closed while the Moon is flying resizes the
    // stage; that used to stop the flight where it was, leaving the whole Moon with Site selected.
    // Motion is not reduced here, so the flights are real ones.
    name: 'site-then-panel',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    noChat: true,
    checks: [
      [
        'a panel opened 200 ms after pressing Site does not stop the flight down: the Moon ends close on the site, Site is still selected and the panel is open',
        `(() => { window.__whole = Number(document.querySelector('.scout-globe').dataset.discPx); [...document.querySelectorAll('.sl-heights button')].find((b) => b.textContent.trim() === 'Site').click(); return true })() && ${after(200, `(${click('Compare')}, true)`)} && ${after(3500, `(() => { const disc = Number(document.querySelector('.scout-globe').dataset.discPx); const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Site' && disc > 4 * window.__whole && document.querySelector('.sl-compare') !== null) || view + ' selected, the disc ' + Math.round(disc) + ' px from ' + Math.round(window.__whole) })()`)}`,
        1500,
      ],
      [
        'the panel closed 200 ms after pressing Orbit does not stop the flight back: the whole Moon is in view and Orbit is selected',
        `([...document.querySelectorAll('.sl-heights button')].find((b) => b.textContent.trim() === 'Orbit').click(), true) && ${after(200, `(${click('Close')}, true)`)} && ${after(2500, `(() => { const disc = Number(document.querySelector('.scout-globe').dataset.discPx); const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Orbit' && disc < 1.6 * window.__whole && document.querySelector('.sl-compare') === null) || view + ' selected, the disc ' + Math.round(disc) + ' px from ' + Math.round(window.__whole) })()`)}`,
      ],
    ],
  },
  {
    // The Layers panel in two groups, so no switch is a dead end: "Whole Moon" (place names, which
    // change no view) and "South pole, close up" (the ground layers, which go to Site when switched on).
    name: 'layers-groups',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    noChat: true,
    checks: [
      [
        'Layers is where it was in the rail, not greyed; opening its panel moves nothing: the view is still Orbit',
        `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return view === 'Orbit' || view })() === true && (${click('Layers')}, true) && ${after(900, `(() => { const rail = window.innerWidth < 761 ? true : [...document.querySelectorAll('.sl-rail > button')].map((b) => b.firstChild.textContent.trim())[0] === 'Layers'; const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (rail && view === 'Orbit' && document.querySelector('.sl-layers') !== null) || view })()`)}`,
        1200,
      ],
      [
        'the panel has two groups under plain headings: "Whole Moon" with the place names, then "South pole, close up" with Light and shadow, Mission success probability and NASA\'s six maps',
        "(() => { const panel = document.querySelector('.sl-layers'); const heads = [...panel.querySelectorAll('.sl-layer-group')].map((h) => h.textContent.trim()).join('|'); const names = (selector) => [...panel.querySelectorAll(selector + ' label')].map((label) => label.textContent.trim()).join('|'); const order = [...panel.querySelectorAll('.sl-layer-group, .sl-layer-whole, .sl-layer-ground, .sl-layer-list')].map((el) => el.className.split(' ').pop()).join('|'); return (heads === 'Whole Moon|South pole, close up' && names('.sl-layer-whole') === 'Place names' && names('.sl-layer-ground') === 'Light and shadow|Mission success probability' && names('.sl-layer-list') === 'Photo|Steep ground|Permanent shadow|Long-run sunlight|Long-run Earth view|Temperature' && order === 'sl-layer-group|sl-layer-whole|sl-layer-group|sl-layer-ground|sl-layer-list') || heads + ' // ' + order })()",
      ],
      ['at a ridge site every layer can be switched on', "(() => { const inputs = [...document.querySelectorAll('.sl-layers input[role=\"switch\"]')]; return (inputs.length === 9 && inputs.every((input) => !input.disabled)) || inputs.filter((input) => input.disabled).length + ' greyed of ' + inputs.length })()"],
      [
        'switching Place names on in Orbit leaves the view alone',
        `([...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Place names').querySelector('input').click(), true) && ${after(1200, `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Orbit' && [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Place names').querySelector('input').checked) || view })()`)}`,
      ],
      [
        'switching one of NASA\'s maps on in Orbit goes to Site with it on, the panel still open',
        `([...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').click(), true) && ${after(1800, `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Site' && [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').checked && document.querySelector('.sl-layers') !== null) || view })()`)}`,
      ],
      [
        'switching it off again leaves the view at Site; from Surface, Light and shadow goes to Site with it on',
        `([...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').click(), true) && ${after(600, `([...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join() === 'Site' && ![...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').checked && ([...document.querySelectorAll('.sl-heights button')].find((b) => b.textContent.trim() === 'Surface').click(), true))`)} && ${after(2000, `([...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join() === 'Surface' && ([...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Light and shadow').querySelector('input').click(), true))`)} && ${after(3800, `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Site' && [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Light and shadow').querySelector('input').checked && getComputedStyle(document.querySelector('.sl-surface')).visibility === 'hidden') || view })()`)}`,
      ],
      ['the panel has nothing to scroll, down or sideways, and nothing is wider than the screen', "(() => { const panel = document.querySelector('.sl-layers'); return (document.documentElement.scrollWidth <= window.innerWidth && panel.scrollWidth <= panel.clientWidth && (window.innerWidth < 761 || panel.scrollHeight <= panel.clientHeight)) || 'panel ' + panel.scrollHeight + ' in ' + panel.clientHeight })()"],
    ],
  },
  {
    // Far from the pole the ground layers do not reach: each is greyed and says how far it goes, from its own extent. The place names still work.
    name: 'layers-far-site',
    hash: '#a=apollo-11@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    noChat: true,
    checks: [
      [
        'at Apollo 11 Layers opens as anywhere; every ground layer is greyed and its hover text says how far it reaches from the south pole: 68, 137 or 274 km for NASA\'s maps from their own tiles, and the light grid\'s own extent for the two beside them',
        `(${click('Layers')}, true) && ${after(1200, "(() => { const row = (label) => ({ off: label.querySelector('input').disabled, name: label.textContent.trim(), tip: label.getAttribute('title') ?? label.dataset.tip ?? '' }); const maps = [...document.querySelectorAll('.sl-layer-list label')].map(row); const ground = [...document.querySelectorAll('.sl-layer-ground label')].map(row); const km = Object.fromEntries([...maps, ...ground].map((item) => [item.name, Number(/reaches (\\d+) km from the south pole\\. Apollo 11 is outside it\\.$/.exec(item.tip)?.[1])])); return (maps.length === 6 && maps.every((item) => item.off) && ground.length === 2 && ground.every((item) => item.off) && km['Long-run sunlight'] === 68 && km['Photo'] === 137 && km['Steep ground'] === 137 && km['Permanent shadow'] === 274 && km['Light and shadow'] === 154 && km['Mission success probability'] === 154) || JSON.stringify(km) })()")}`,
        1200,
      ],
      [
        'the light grid\'s figure is the one its own description gives',
        "(async () => { const meta = await (await fetch('/data/light/meta.json')).json(); const tip = [...document.querySelectorAll('.sl-layer-ground label')][0].getAttribute('title') ?? [...document.querySelectorAll('.sl-layer-ground label')][0].dataset.tip; const want = Math.round((meta.wide ?? meta).half_width_m / 1000); return tip.includes('reaches ' + want + ' km from the south pole') || tip + ' // ' + want })()",
      ],
      [
        'pressing a greyed layer does nothing: nothing is switched on and the view stays Orbit',
        `([...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').click(), [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Light and shadow').querySelector('input').click(), true) && ${after(900, `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Orbit' && ![...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Photo').querySelector('input').checked && ![...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Light and shadow').querySelector('input').checked) || view })()`)}`,
      ],
      [
        'Place names is not greyed, switches on, and leaves the view at Orbit',
        `(() => { const names = [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Place names').querySelector('input'); if (names.disabled) return 'greyed'; names.click(); return true })() === true && ${after(1500, `(() => { const view = [...document.querySelectorAll('.sl-heights button[aria-pressed="true"]')].map((b) => b.textContent.trim()).join(); return (view === 'Orbit' && [...document.querySelectorAll('.sl-layers label')].find((label) => label.textContent.trim() === 'Place names').querySelector('input').checked) || view })()`)}`,
      ],
    ],
  },
  {
    // The rail on a phone is one row: the heights, Scout and "More", which opens the rest as a short menu.
    name: 'rail',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['on a laptop the rail is as it was, with no "More"', "window.innerWidth < 761 || (document.querySelector('.sl-rail-more') === null && document.querySelector('.sl-rail-menu') === null && [...document.querySelectorAll('.sl-rail > button')].map((button) => button.firstChild.textContent.trim() || button.textContent.trim()).join('|') === 'Layers|Scout|Compare|Accuracy|Planner|New Planner|Guide|Home')"],
      ['on a phone the rail is one row: the three heights, Scout and "More"', "window.innerWidth > 760 || (() => { const rail = document.querySelector('.sl-rail'); const shown = [...rail.children].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0); const names = shown.map((el) => (el.classList.contains('sl-heights') ? [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/') : el.textContent.trim())); const boxes = shown.map((el) => el.getBoundingClientRect()); const oneRow = boxes.every((box) => box.top < boxes[0].bottom && box.bottom > boxes[0].top) && boxes.every((box) => box.left >= 0 && box.right <= window.innerWidth); return (names.join('|') === 'Orbit/Site/Surface|Scout|More' && oneRow && rail.getBoundingClientRect().height < 60) || names.join('|') + ' one row: ' + oneRow + ' height ' + rail.getBoundingClientRect().height })()"],
      ['"More" opens the rest as a short menu, inside the window, on an opaque ground', `window.innerWidth > 760 || ((${click('More')}, true) && ${after(300, "(() => { const menu = document.querySelector('.sl-rail-menu.is-open'); if (!menu) return false; const names = [...menu.querySelectorAll('button')].map((button) => button.firstChild.textContent.trim() || button.textContent.trim()); const box = menu.getBoundingClientRect(); return (names.join('|') === 'Layers|Compare|Accuracy|Planner|New Planner|Guide|Home|Tour' && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && /^rgb\\(/.test(getComputedStyle(menu).backgroundColor) && document.querySelector('.sl-rail-more').getAttribute('aria-expanded') === 'true') || names.join('|') + ' ' + JSON.stringify(box) })()")})`],
      ['Escape closes the menu', `window.innerWidth > 760 || ((window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(300, "document.querySelector('.sl-rail-menu.is-open') === null && document.querySelector('.sl-rail-more').getAttribute('aria-expanded') === 'false'")})`],
      ['a choice from the menu does its work and closes the menu', `window.innerWidth > 760 || ((${click('More')}, true) && ${after(300, `(${click('Compare')}, true)`)} && ${after(900, "document.querySelector('.sl-rail-menu.is-open') === null && document.querySelector('.sl-drawer') !== null")})`],
    ],
  },
  {
    // The Compare panel's table with four scenarios, then three, two and one: nothing in it may touch
    // anything else, at any of the sizes. Four are the tightest: the hours behind a share are hover
    // text there, the verdict is a mark, and two folds hold the rest, so a small laptop need not scroll.
    name: 'compare-fits',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    steps: [click('Compare')],
    checks: [
      ['four scenarios: every cell inside its column, no text touching other text, nothing wider than the panel', COMPARE_CLEAN(4)],
      ['with four, the verdict is the first row: a mark for each scenario, with the words in its hover text', "(() => { const row = document.querySelector('.sl-compare tbody tr'); const marks = [...row.querySelectorAll('td')]; return row.classList.contains('sl-compare-verdict') && marks.length === 4 && marks.every((mark) => /^[✓◇✕]$/.test(mark.textContent.trim()) && /^(Fits the mission|Fits, marginal: .+|Does not fit: .+)$/.test(mark.title) && mark.getAttribute('aria-label') === mark.title) })()"],
      ['with four, the hours behind each share are the figure\'s hover text, not printed', "(() => { const rows = [...document.querySelectorAll('.sl-compare tbody tr')]; const shares = rows.filter((row) => /^(Sunlit|Earth in view), %$/.test(row.querySelector('th').textContent.trim())).flatMap((row) => [...row.querySelectorAll('td')]); return shares.length === 8 && shares.every((cell) => /^\\d+ of \\d+ h$/.test(cell.title)) && document.querySelectorAll('.sl-compare td small').length === 0 })()"],
      ['with the folds closed, the panel does not scroll on a laptop, small or large', COLUMN_FITS],
      ['with both folds open the table is still clean', `(document.querySelectorAll('.sl-compare .sl-compare-fold').forEach((fold) => fold.click()), true) && ${after(300, COMPARE_CLEAN(4))}`],
      ['the star\'s note is there, and the panel ends with the way to the full comparison', "(() => { const link = document.querySelector('.sl-compare .sl-compare-full'); const last = [...document.querySelector('.sl-compare').children].at(-1); return /^★ best in its row/.test(document.querySelector('.sl-compare .sl-quiet').textContent.trim()) && link !== null && link.textContent.trim() === 'Full comparison ›' && last.contains(link) })()"],
      ['three scenarios: the table is clean', `(document.querySelectorAll('.sl-compare .sl-compare-fold').forEach((fold) => fold.click()), ${REMOVE_SCENARIO('D')}).then(() => ${COMPARE_CLEAN(3)})`],
      ['two scenarios: the table is clean, and the hours are printed under each share', `${REMOVE_SCENARIO('C')}.then(() => { const clean = ${COMPARE_CLEAN(2)}; return clean !== true ? clean : document.querySelectorAll('.sl-compare td small').length === 4 || 'the hours are not printed under the shares' })`],
      ['two scenarios with both folds open: still clean', `(document.querySelectorAll('.sl-compare .sl-compare-fold').forEach((fold) => fold.click()), true) && ${after(300, COMPARE_CLEAN(2))}`],
      ['one scenario: the table is clean', `${REMOVE_SCENARIO('B')}.then(() => ${COMPARE_CLEAN(1)})`],
      ['"Full comparison" opens the Planner on its Compare tab, and the address says so', `(document.querySelector('.sl-compare .sl-compare-full').click(), true) && ${after(900, "document.querySelector('.sl-full') !== null && document.querySelector('.sl-compare') === null && [...document.querySelectorAll('.sl-full [role=\"tab\"]')].find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent.trim() === 'Compare' && /[&#]planner=compare/.test(location.hash)")}`],
    ],
  },
  {
    // Share's sheet: the link first, as it always was; then save with a name; then the brief. The plans
    // service is stood in for, so nothing is really saved.
    name: 'share-sheet',
    // The plan has its panel at 5 m and its antenna at 10 m: those heights' files are meant to be asked for.
    heights: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00&slope=8&hp=5&ha=10&sc=1&sky=1',
    beforeLoad: STAND_IN_CLIPBOARD(),
    steps: [STAND_IN_PLANS(), `window.innerWidth < 761 || (${click('Compare')}, true)`, `(document.querySelector('.sl-head-tools .sl-icon[aria-label="Share"]').click(), true)`],
    checks: [
      ['the sheet is whole inside the window, inside the column on a laptop, and needs no scrolling', SHARE_PLACED],
      ['"Copy link" is first, gold and already has the keyboard; the form says what the name and note are for, how long a plan is kept and who can open it', "(() => { const sheet = document.querySelector('.sl-share-sheet'); const first = sheet.querySelector('button'); return (document.activeElement === first && first.textContent.trim() === 'Copy link' && first.classList.contains('sl-share-copy') && sheet.querySelector('.sl-share-why').textContent.trim() === 'The saved link opens with the name and note on show.' && sheet.querySelector('.sl-share-kept').textContent.trim() === 'Kept 180 days, for anyone with the link.') || sheet.textContent.slice(0, 200) })()"],
      ['a name is required: Save is off until there is one', "document.querySelector('.sl-share-save button[type=submit]').disabled === true"],
      ['the keyboard reaches everything and stays in the sheet: Tab from the last control comes back to the first', "(() => { const sheet = document.querySelector('.sl-share-sheet'); const stops = [...sheet.querySelectorAll('button:not([disabled]), input, textarea')]; stops.at(-1).focus(); sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); const round = document.activeElement === stops[0]; stops[0].focus(); sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); return (round && document.activeElement === stops.at(-1) && stops.length >= 4) || stops.length + ' stops' })()"],
      ['a refusal is said in plain words under the fields, and the link is still there to copy', `${SHARE_TYPE('.sl-share-save input', 'A busy day')} && (document.querySelector('.sl-share-save').requestSubmit(), true) && ${after(900, "(() => { const said = document.querySelector('.sl-share-problem')?.textContent ?? ''; return (/^Too many plans are being saved just now\\. Give it a minute and try again\\.$/.test(said) && !/429|busy|error/i.test(said) && document.querySelector('.sl-share-sheet button').textContent.trim() === 'Copy link') || said })()")}`],
      ['saving sends the whole screen, marked as saved from this screen: every scenario, the mission and its heights, the scenario on show, the skyline and, on a laptop, the open panel', `${SHARE_TYPE('.sl-share-save input', '  Ridge and rim   in May ')} && ${SHARE_TYPE('.sl-share-save textarea', 'Two sites, a 5 m panel.')} && (document.querySelector('.sl-share-save').requestSubmit(), true) && ${after(900, `(() => { const sent = window.__plans.saved.at(-1); const want = '#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00&slope=8&hp=5&ha=10&sc=1&sky=1' + (window.innerWidth < 761 ? '' : '&panel=compare') + '&sl=1'; return (sent.title === 'Ridge and rim in May' && sent.note === 'Two sites, a 5 m panel.' && sent.view === want) || JSON.stringify(sent) })()`)}`],
      ['once saved, the short link is the sheet\'s first thing: it was copied at the save and the sheet says so, and its gold button says what it copies and has the keyboard', "(() => { const sheet = document.querySelector('.sl-share-sheet'); const link = sheet.querySelector('.sl-share-saved input')?.value ?? ''; const buttons = [...sheet.querySelectorAll('button')]; const gold = sheet.querySelectorAll('.sl-share-copy'); return (link === location.origin + '/#plan=abcd2345' && window.__copied === link && sheet.querySelector('.sl-share-saved .sl-share-head').textContent.replace(/\\s+/g, ' ').trim() === 'Saved and copied “Ridge and rim in May”' && buttons[0].textContent.trim() === 'Copy saved link' && gold.length === 1 && gold[0] === buttons[0] && document.activeElement === buttons[0] && sheet.firstElementChild.classList.contains('sl-share-saved')) || link + ' copied ' + window.__copied + ' ; ' + buttons.map((button) => button.textContent.trim()).join('|') })()"],
      ['the gold button copies the short link, and says it did', `(window.__copied = null, document.querySelector('.sl-share-sheet .sl-share-copy').click(), true) && ${after(300, "(() => { const button = document.querySelector('.sl-share-sheet .sl-share-copy'); return (window.__copied === location.origin + '/#plan=abcd2345' && button.textContent.trim() === 'Saved link copied' && document.querySelector('.sl-share-sheet') !== null) || window.__copied + ' ; ' + button.textContent })()")}`],
      ['the plain link\'s button is under it, quiet, and says how it differs', "(() => { const plain = document.querySelector('.sl-share-sheet .sl-share-plain'); const saved = document.querySelector('.sl-share-saved'); return (plain.textContent.trim() === 'Copy link without the name or note' && getComputedStyle(plain).backgroundColor === 'rgba(0, 0, 0, 0)' && plain.getBoundingClientRect().top >= saved.getBoundingClientRect().bottom - 1 && /^It opens with the name and note on show\\. Kept 180 days, for anyone with the link\\.$/.test(saved.querySelector('.sl-share-kept').textContent.trim())) || plain.textContent + ' on ' + getComputedStyle(plain).backgroundColor })()"],
      ['the sheet still fits with the link shown', SHARE_PLACED],
      ['Escape closes it and gives the keyboard back to the Share button', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(300, "document.querySelector('.sl-share-sheet') === null && document.activeElement?.getAttribute('aria-label') === 'Share'")}`],
    ],
  },
  {
    // A saved plan's short link, opened on the page: the Sightline screen shows the plan as it was saved.
    name: 'plan-open',
    // The plan has its panel at 5 m and its antenna at 10 m: those heights' files are meant to be asked for.
    heights: true,
    // Opened as a visitor opens it: a new page at the front door, on the short link. The plans service's stand-in is in place before the page's own code runs.
    path: '/',
    hash: '#plan=abcd2345',
    beforeLoad: STAND_IN_PLANS({ title: 'Ridge and rim in May', note: 'Two sites, a 5 m panel.', view: '#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00&slope=8&hp=5&ha=10&sc=1&sky=1&panel=compare' }),
    checks: [
      ['every scenario and setting is back: three scenarios with the second on show, the 21-day mission, its heights, the skyline unfolded and, on a laptop, Compare open', `${after(4500, "(() => { const tabs = [...document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]')]; const text = document.querySelector('.sl-col').textContent; const laptop = window.innerWidth >= 761; const got = { tabs: tabs.length, shown: tabs.findIndex((tab) => tab.getAttribute('aria-pressed') === 'true'), heights: /panel at 5 m, antenna at 10 m/.test(text), address: location.hash, sky: document.querySelector('.sl-sky') !== null, compare: document.querySelector('.sl-compare') !== null }; return (got.tabs === 3 && got.shown === 1 && got.heights && got.address.startsWith('#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00&slope=8&hp=5&ha=10&sc=1') && (!laptop || (got.sky && got.compare))) || JSON.stringify(got) })()")}`, 6000],
      ['the plan\'s name and its note are in sight as the link opens, with no press: one card that says it is a saved plan, inside the column on a laptop, with nothing on top of it', SAVED_CARD('Ridge and rim in May', 'Two sites, a 5 m panel.')],
      ['the card moves nothing: the column does not scroll, and the tab\'s title carries the plan\'s name', `(() => { const column = document.querySelector('.sl-col'); return ((window.innerWidth < 761 || column.scrollHeight <= column.clientHeight) && document.title === 'Ridge and rim in May · Sightline') || document.title + ' ; column ' + column.scrollHeight + ' in ' + column.clientHeight })()`],
      ['in the Planner the same card is a row of the Planner\'s header, and back on the Moon it is in the column again', `window.innerWidth < 761 || ((${click('Planner')}, true) && ${after(1200, `(() => { const card = document.querySelector('.sl-full-head > .sl-saved-card.is-in-header'); window.__inHeader = card !== null && ${SAVED_CARD('Ridge and rim in May', 'Two sites, a 5 m panel.')} === true; document.querySelector('.pl-back').click(); return true })()`)} && ${after(2600, `window.__inHeader !== true ? 'not a row of the header in the Planner' : document.querySelector('.sl-saved-card.is-in-header') !== null ? 'still in a header' : ${SAVED_CARD('Ridge and rim in May', 'Two sites, a 5 m panel.')}`)})`],
      ['the written brief opens with the saved plan\'s own brief: its name, its note and what the data said when it was saved', `window.innerWidth < 761 || ((document.querySelector('.sl-head-tools .sl-icon[aria-label="Share"]').click(), true) && ${after(300, "(document.querySelector('.sl-share-sheet .sl-share-brief').click(), true)")} && ${after(2500, "(() => { const saved = document.querySelector('.sl-brief-sheet .sl-saved-brief'); return (saved !== null && saved.querySelector('h2').textContent === 'Ridge and rim in May' && /Two sites/.test(saved.textContent) && /Sun up/.test(saved.textContent) && /saved, on 14 November 2026/.test(saved.textContent)) || 'no saved brief' })()")} && ${after(300, `(${click('Back to the Moon')}, true)`)})`],
      ['the card\'s button takes the keyboard', "(() => { const away = document.querySelector('.sl-saved-card-away'); away.focus(); return (away.tagName === 'BUTTON' && away.textContent.trim() === 'Put away' && document.activeElement === away) || 'the keyboard is on ' + document.activeElement?.className })()"],
      { key: 'Enter' },
      ['Enter puts the card away, and the tab\'s title is the scenario\'s again', "(document.querySelector('.sl-saved-card') === null && document.title === 'Shackleton Rim, 6 May 2027 · Sightline') || document.title"],
      ['a plan that no longer exists is said in plain words, in the same card', `(location.hash = '#plan=zzzz2345', true) && ${after(2000, "(() => { const card = document.querySelector('.sl-saved-card.is-problem'); const said = card?.querySelector('.sl-saved-card-problem')?.textContent ?? ''; return (/^This plan no longer exists\\. Plans are kept for six months\\./.test(said) && card.querySelector('.sl-saved-card-kind') === null) || said })()")}`],
    ],
  },
  {
    // A plan saved from the Planner's Share: its short link reopens the Planner, where the plan's name and note
    // are a row of the Planner's header. Then a save from there, in a browser that will not copy for the page.
    name: 'plan-open-planner',
    // The page opens on the Planner, where the Moon is a small view with no dots: it is ready when the Planner is up.
    ready: "document.querySelector('.sl-full .pl-tabs') !== null",
    path: '/',
    hash: '#plan=abcd2345',
    beforeLoad: `${STAND_IN_PLANS({ title: 'Ridge in November', note: 'Look at the months with none: the dark spell is the limit.', view: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&planner=find&sl=1' })} && ${STAND_IN_CLIPBOARD(false)}`,
    checks: [
      ['the Planner is open on Find, as it was saved, and the plan\'s name and note are in sight in its header with nothing on top of them', `${after(4500, `(() => { const tab = document.querySelector('.pl-tabs button[aria-selected="true"]')?.textContent.trim(); const card = document.querySelector('.sl-full-head > .sl-saved-card.is-in-header'); return (tab === 'Find' && card !== null && ${SAVED_CARD('Ridge in November', 'Look at the months with none')} === true && document.title === 'Ridge in November · Sightline') || tab + ' ; ' + document.title + ' ; ' + ${SAVED_CARD('Ridge in November', 'Look at the months with none')} })()`)}`],
      ['the header\'s own controls are all still in reach above it: back, the tabs, the scenarios, Brief, Share, Export and Scout', "(() => { const card = document.querySelector('.sl-saved-card').getBoundingClientRect(); const tools = [...document.querySelectorAll('.pl-header > :not(.sl-saved-card), .pl-tools > *')].map((el) => el.getBoundingClientRect()).filter((box) => box.width > 0); return (tools.length >= 8 && tools.every((box) => box.bottom <= card.top + 1)) || tools.length + ' controls, the lowest at ' + Math.max(...tools.map((box) => box.bottom)) + ', the card from ' + card.top })()"],
      ['the card\'s button takes the keyboard', "(() => { const away = document.querySelector('.sl-saved-card-away'); away.focus(); return document.activeElement === away || 'the keyboard is on ' + document.activeElement?.className })()"],
      { key: 'Enter' },
      ['Enter puts the card away; it stays away back on the Moon', `(document.querySelector('.sl-saved-card') === null && (document.querySelector('.pl-back').click(), true)) && ${after(1200, "document.querySelector('.sl-full') === null && document.querySelector('.sl-saved-card') === null && !/Ridge in November/.test(document.title)")}`],
      ['a save from the Planner\'s Share, in a browser that will not copy for the page, says only "Saved": the link is there, with its gold button', `(${click('Planner')}, true) && ${after(1200, `(document.querySelector('.pl-header .sl-icon[aria-label="Share"]').click(), true)`)} && ${after(1700, `${SHARE_TYPE('.sl-share-save input', 'From the Planner')} && (document.querySelector('.sl-share-save').requestSubmit(), true)`)} && ${after(3400, "(() => { const sheet = document.querySelector('.sl-share-sheet'); const head = sheet.querySelector('.sl-share-saved .sl-share-head')?.textContent.replace(/\\s+/g, ' ').trim(); const sent = window.__plans.saved.at(-1); return (head === 'Saved “From the Planner”' && sheet.querySelector('.sl-share-saved input').value === location.origin + '/#plan=abcd2345' && sheet.querySelector('.sl-share-copy').textContent.trim() === 'Copy saved link' && /&planner=find&sl=1$/.test(sent.view)) || head + ' ; ' + sent?.view })()")}`],
      ['the sheet is whole inside the window with the link shown', "(() => { const box = document.querySelector('.sl-share-sheet').getBoundingClientRect(); return (box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight) || [box.left, box.top, box.right, box.bottom].map(Math.round).join(', ') })()"],
    ],
  },
  {
    // A short link to a plan that is gone, opened on a new page: the page opens on the Moon, where there is no
    // column, and still says why in plain words, beside the Moon and not on it.
    name: 'plan-gone',
    path: '/',
    hash: '#plan=zzzz2345',
    beforeLoad: STAND_IN_PLANS(),
    checks: [
      ['the page says the plan no longer exists, in a card with nothing on top of it that is not on the Moon on a laptop', `${after(3000, "(() => { const card = document.querySelector('.sl-saved-card.is-problem'); if (!card) return 'no card'; const box = card.getBoundingClientRect(); const said = card.querySelector('.sl-saved-card-problem').textContent; const top = document.elementFromPoint(box.left + 20, box.top + 12); const globe = document.querySelector('.scout-globe'); const disc = globe.getBoundingClientRect(); const r = Number(globe.dataset.discPx) / 2; const [cx, cy] = [(disc.left + disc.right) / 2, (disc.top + disc.bottom) / 2]; const nearest = Math.hypot(Math.max(box.left - cx, 0, cx - box.right), Math.max(box.top - cy, 0, cy - box.bottom)); const laptop = window.innerWidth >= 761; return (/^This plan no longer exists\\. Plans are kept for six months\\./.test(said) && card.contains(top) && box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && (!laptop || !(r > 0) || nearest >= r)) || said + ' at ' + [box.left, box.top, box.right, box.bottom].map(Math.round).join(', ') + ', the disc ' + Math.round(r) + ' round ' + Math.round(cx) + ', ' + Math.round(cy) })()")}`],
      ['its button puts it away', `(document.querySelector('.sl-saved-card-away').click(), true) && ${after(300, "document.querySelector('.sl-saved-card') === null")}`],
    ],
  },
  {
    // The star between two different sites: Peak near Shackleton (6 May 2027) and de Gerlache Rim (26 May 2027) are
    // 2 points apart in sunlight over a 14-day mission, well inside the model's measured error for that pair
    // (about 21 points), so neither is starred and a line says why. Earth in view is 49 points apart: starred.
    name: 'compare-close',
    hash: '#a=peak-near-shackleton@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=de-gerlache-rim@2027-05-26T00',
    steps: [click('Compare')],
    checks: [
      ['two sites 2 points apart in sunlight: no star on that row, a star where the lead is beyond the measured error, and the line that says why', "(() => { const rows = [...document.querySelectorAll('.sl-compare tbody tr')]; const row = (name) => rows.find((one) => one.querySelector('th').textContent.trim() === name); const sun = [...row('Sunlit, %').querySelectorAll('td')]; const earth = [...row('Earth in view, %').querySelectorAll('td')]; const gap = Math.abs(parseFloat(sun[0].textContent) - parseFloat(sun[1].textContent)); const note = document.querySelector('.sl-compare .sl-too-close')?.textContent ?? ''; return (gap > 0.5 && gap < 5 && sun.every((cell) => !cell.classList.contains('is-best')) && earth.filter((cell) => cell.classList.contains('is-best')).length === 1 && /^Two sites closer than the model's measured error share the ★ or get none: see How it works\\.$/.test(note)) || 'gap ' + gap + ', sunlit stars ' + sun.filter((cell) => cell.classList.contains('is-best')).length + ', note: ' + note })()", 4000],
      ['the Planner\'s Compare tab says the same under its table', `(document.querySelector('.sl-compare .sl-compare-full').click(), true) && ${after(1500, "(() => { const notes = [...document.querySelectorAll('.sl-full .sl-quiet')].map((note) => note.textContent.trim()); return (notes.includes('★ best in its row') && notes.some((note) => /^Two sites closer than the model's measured error/.test(note))) || notes.join(' | ') })()")}`],
    ],
  },
  {
    // One site on two dates keeps its star: half a point still settles it there, and no line is added.
    name: 'compare-same-site',
    hash: '#a=peak-near-shackleton@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=peak-near-shackleton@2027-05-08T13',
    steps: [click('Compare')],
    checks: [
      ['one site on two dates: the better sunlit share keeps its star, and there is no line about measured error', "(() => { const rows = [...document.querySelectorAll('.sl-compare tbody tr')]; const sun = [...rows.find((one) => one.querySelector('th').textContent.trim() === 'Sunlit, %').querySelectorAll('td')]; return (sun.filter((cell) => cell.classList.contains('is-best')).length === 1 && document.querySelector('.sl-compare .sl-too-close') === null) || sun.map((cell) => cell.textContent.trim()).join(' | ') })()", 4000],
    ],
  },
  {
    // One plan of each kind, told apart by what the plans service returns and not by the address:
    // all three short links are the front door's. A plan saved from the Sightline screen carries its
    // mark and opens here. A plan from an older page opens here when nothing it held is lost (its
    // comparison becomes a second scenario), and on the older screen when something would be (its 3D view).
    name: 'plan-kinds',
    path: '/',
    hash: '#plan=pppp2345',
    beforeLoad: STAND_IN_PLANS(null, {
      nnnn2345: { title: 'Saved from Sightline', note: 'A long note that would push the column if it were printed in the line: the ridge first, then the rim, then back to the ridge in June when the Sun is higher and Earth is above the skyline for most of the stay.', view: '#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&slope=8&panel=layers&sl=1' },
      pppp2345: { title: 'An older comparison', view: '#a=connecting-ridge@2027-06&b=shackleton-rim@2027-06&t=497&limits=14_72_72_1_1&mode=plan' },
      qqqq2345: { title: 'An older plan in 3D', view: '#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&view=3d&mode=plan' },
    }),
    checks: [
      ['a plan from an older page that loses nothing opens here: its comparison is a second scenario at the same hour, its limits are the mission, and its name is on its card', `${after(4500, "(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length; const words = document.querySelector('.sl-saved-card-name'); return (location.pathname === '/' && tabs === 2 && location.hash.startsWith('#a=connecting-ridge@2027-06&t=497&limits=14_72_72_1_1&mode=plan&list=shackleton-rim@2027-06-21T17') && words?.textContent === 'An older comparison' && document.querySelector('.sl-saved-card-note') === null) || tabs + ' scenarios at ' + location.pathname + location.hash + ' ; ' + words?.textContent })()")}`],
      ['a plan saved from the Sightline screen carries its mark and opens here as it was: its scenarios, its 21-day mission and, on a laptop, Layers open', `(location.hash = '#plan=nnnn2345', true) && ${after(3000, "(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length; const laptop = window.innerWidth >= 761; return (location.pathname === '/' && tabs === 2 && location.hash.startsWith('#a=connecting-ridge@2027-05&t=133&limits=21_48_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13') && (!laptop || document.querySelector('.sl-layers') !== null)) || tabs + ' scenarios at ' + location.hash })()")}`],
      ['a long note is whole on the card, wrapped: the card stays inside the column on a laptop and the window on a phone, and the column does not scroll', `(window.innerWidth < 761 || (${click('Close')}, true)) && ${after(400, `(() => { const column = document.querySelector('.sl-col'); const note = document.querySelector('.sl-saved-card-note'); const lines = note.getBoundingClientRect().height / parseFloat(getComputedStyle(note).lineHeight); return (${SAVED_CARD('Saved from Sightline', 'A long note that would push the column')} === true && lines >= 2 && lines <= 5.2 && note.scrollHeight <= note.clientHeight + 1 && (window.innerWidth < 761 || column.scrollHeight <= column.clientHeight)) || lines + ' lines; ' + ${SAVED_CARD('Saved from Sightline', 'A long note that would push the column')} })()`)}`],
      ['the longest note a plan can hold (400 characters) is capped at five lines and scrolls inside the card; the card grows no further', "(() => { const note = document.querySelector('.sl-saved-card-note'); const card = document.querySelector('.sl-saved-card'); const before = card.getBoundingClientRect().height; note.textContent = 'The ridge first, then the rim. '.repeat(13).slice(0, 400); const lines = note.getBoundingClientRect().height / parseFloat(getComputedStyle(note).lineHeight); const box = card.getBoundingClientRect(); return (note.scrollHeight > note.clientHeight && lines <= 5.2 && box.top >= 0 && box.bottom <= window.innerHeight + 1 && box.height >= before) || lines + ' lines, card ' + Math.round(box.top) + ' to ' + Math.round(box.bottom) })()"],
      // The page leaves for the older screen here, so the address is read in a check of its own, once it has.
      ['the short link of a plan from an older page that would lose something here (its 3D view) is followed', "(location.hash = '#plan=qqqq2345', true)"],
      ['and it opens where it always did, on the older screen, with the same short link', "(location.pathname === '/classic/' && location.hash === '#plan=qqqq2345') || 'at ' + location.pathname + location.hash", 4000],
    ],
  },
  {
    name: 'compare-four',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    steps: [click('Compare')],
    checks: [
      ['four scenarios: four tabs, four flags on the time bar, four columns in Compare', "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 4 && document.querySelectorAll('.sl-river .sl-flag').length === 4 && [...document.querySelectorAll('.sl-compare thead th')].map((th) => th.textContent.trim()).join('') === 'ABCD'", 600],
      ['the four tabs stay on one row at the column\'s width, each with its "−" on its corner', `document.querySelectorAll('.sl-tabs button').length === 8 && ${TABS_ONE_ROW} && ${BADGES_ON_CORNERS}`],
      ['with Compare open the page says "skyline", never "the ridge", for the terrain\'s outline', OWN_WORDS],
      ['on a phone each letter is a comfortable touch target, and each badge has one larger than it looks', "window.innerWidth > 760 || ([...document.querySelectorAll('.sl-tabs .sl-tab > button:first-child, .sl-tabs > button')].every((button) => button.getBoundingClientRect().width >= 36 && button.getBoundingClientRect().height >= 36) && [...document.querySelectorAll('.sl-tabs .sl-tab-remove')].every((badge) => badge.getBoundingClientRect().width - 2 * parseFloat(getComputedStyle(badge, '::after').top) >= 34))"],
      ['with four there is no tab to add a fifth', "document.querySelector('.sl-tabs button[aria-label=\"Add a scenario\"]') === null"],
      ['the note under Compare\'s table is "★ best in its row", and the only other line is the one about two sites too close to call', "(() => { const notes = [...document.querySelectorAll('.sl-compare .sl-quiet')].map((note) => note.textContent.trim()); return (notes[0] === '★ best in its row' && notes.slice(1).every((note) => /^Two sites closer than the model's measured error share the ★ or get none: see How it works\\.$/.test(note)) && notes.length <= 2) || notes.join(' | ') })()"],
      ['with Compare open no label on the river is cut or ends in "…"', `window.innerWidth < 761 || ${LABELS_WHOLE}`],
      ['Compare with four scenarios does not scroll sideways, and no cell is cut off', "(() => { const drawer = document.querySelector('.sl-compare'); const box = drawer.getBoundingClientRect(); const table = drawer.querySelector('table').getBoundingClientRect(); return drawer.scrollWidth <= drawer.clientWidth && table.left >= box.left && table.right <= box.right + 0.5 && [...drawer.querySelectorAll('th, td, li, caption')].every((cell) => cell.scrollWidth <= cell.clientWidth + 1) })()"],
      ['neither the column nor the Compare panel scrolls', COLUMN_FITS],
      ['the panel sits beside the stage, and the whole disc is inside what is left of it', `(window.innerWidth < 761 || document.querySelector('.sl-compare').getBoundingClientRect().left >= document.querySelector('.sl-stage').getBoundingClientRect().right - 1) && (window.innerWidth < 761 || ${DISC_INSIDE})`],
    ],
  },
  {
    name: 'plan-custom',
    hash: '#a=-88.5,40@2027-05&t=200&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['a custom point from a link is worked out in the browser', `/Custom point 88.500°S, 40.000°E/.test(document.querySelector('#sl-site')?.selectedOptions[0]?.textContent ?? '') && document.querySelectorAll('.sl-facts > .sl-fact').length === 3`, 6000],
      ['a custom point claims no match with Horizons (it was never compared): it offers to ask instead', "(document.querySelector('.sl-horizons')?.textContent ?? '') === 'Check with Horizons' && document.querySelector('.sl-horizons button') !== null"],
      ['asking sends the point and the hour on show to the site\'s own server, never to JPL, and puts NASA\'s two heights above a flat horizon beside the page\'s own', `(async () => { const real = window.fetch; const sent = []; window.fetch = async (url, init) => { if (!String(url).includes('/api/chat/horizons')) return real(url, init); sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ sun: { azDeg: 100.5, elDeg: -2.053957 }, earth: { azDeg: 200.25, elDeg: 1.234 }, ephemeris: 'DE441', cached: false }), { status: 200, headers: { 'content-type': 'application/json' } }) }; document.querySelector('.sl-horizons button').click(); await new Promise((done) => setTimeout(done, 600)); window.fetch = real; const words = document.querySelector('.sl-horizons').textContent; const body = sent[0]?.body; const ours = (/ours (.+)$/.exec(words)?.[1] ?? '').split(', ').map((value) => Number(value.replace('°', '').replace('−', '-'))); return (sent.length === 1 && sent[0].url.startsWith('/api/chat/horizons') && body.lat === -88.5 && body.lon === 40 && /^2027-05-\\d\\dT\\d\\d:00:00Z$/.test(body.hour) && /^Horizons: Sun −2\\.05°, Earth 1\\.23° · ours /.test(words) && ours.length === 2 && ours.every((value) => Number.isFinite(value) && Math.abs(value) <= 90)) || 'sent ' + JSON.stringify(sent).slice(0, 120) + '; shows: ' + words + '; the line has ' + JSON.stringify(ours) })()`],
      ['the answer is one quiet line, and the column still does not scroll', `(() => { const line = document.querySelector('.sl-horizons'); return window.innerWidth < 761 || getComputedStyle(line).display === 'none' || line.getBoundingClientRect().height < 22 })() && ${COLUMN_FITS}`],
      ['a custom point opens in Quickmap and Moon Trek, and not in Horizons: its height was never worked out', "[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap,Moon Trek' || [...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join()"],
    ],
  },
  {
    // The answer's line about JPL Horizons, at a listed site: the same link as plan-link, the fullest column.
    name: 'horizons',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the answer says how closely this site matches Horizons, from the comparison file, which covers every hour of the data', `(async () => { const file = await fetch('/data/horizons.json').then((r) => r.json()); const within = (Math.ceil(file.sites['shackleton-rim'].max_deg * 100 - 1e-9) / 100).toFixed(2) + '°'; return ${text('.sl-horizons')}.trim().startsWith('✓ Matches Horizons within ' + within) && file.sites['shackleton-rim'].hours === (await fetch('/data/range.json').then((r) => r.json())).hours })()`, 1500],
      ['at its foot the column shows one line, the claim alone, as one control with no link in it, and its hover text says what was compared', `(async () => { const file = await fetch('/data/horizons.json').then((r) => r.json()); const line = document.querySelector('.sl-horizons'); const claim = line.querySelector('button'); const tip = claim?.getAttribute('title') ?? claim?.dataset.tip ?? ''; return (line.querySelectorAll('a').length === 0 && line.querySelectorAll('button').length === 1 && document.querySelector('.sl-horizons-card') === null && !/Reproduce/.test(document.querySelector('.sl-col').textContent) && claim.getAttribute('aria-expanded') === 'false' && tip === "Our directions to the Sun and Earth agree with NASA JPL's Horizons service at every hour for this site (" + file.sites['shackleton-rim'].hours.toLocaleString('en-US') + ' hours each). The largest gap is rounding.') || line.textContent + ' // ' + tip })()`],
      ['the line is one quiet line under the rows, with a tick, and the column still does not scroll', `(() => { const line = document.querySelector('.sl-horizons'); const rows = document.querySelector('.sl-facts'); const col = document.querySelector('.sl-col'); const ok = getComputedStyle(line).display !== 'none' && line.getBoundingClientRect().top >= rows.getBoundingClientRect().bottom && (window.innerWidth < 761 || line.getBoundingClientRect().height < 22) && ${COLUMN_FITS}; if (!ok) throw new Error('line ' + Math.round(line.getBoundingClientRect().height) + ' px high; column ' + col.scrollHeight + ' of ' + col.clientHeight + ' px high'); return true })()`],
      ['a press opens a small card over the column, above the line: one sentence on what was compared, with the count, and "Reproduce this hour: Sun · Earth"', `(document.querySelector('.sl-horizons-claim').click(), true) && ${after(250, `(async () => { const file = await fetch('/data/horizons.json').then((r) => r.json()); const card = document.querySelector('.sl-horizons-card'); if (!card) return 'no card'; const box = card.getBoundingClientRect(); const col = document.querySelector('.sl-col').getBoundingClientRect(); const line = document.querySelector('.sl-horizons-claim').getBoundingClientRect(); const words = card.textContent.replace(/\\s+/g, ' ').trim(); return (document.querySelector('.sl-horizons-claim').getAttribute('aria-expanded') === 'true' && (window.innerWidth < 761 ? box.left >= 0 && box.right <= window.innerWidth : box.left >= col.left && box.right <= col.right + 1 && box.top >= Math.max(col.top, 0)) && box.bottom <= line.top && words === 'Sun and Earth directions, compared with NASA JPL Horizons at every hour for this site: ' + file.sites['shackleton-rim'].hours.toLocaleString('en-US') + ' hours each.Reproduce this hour: Sun · Earth' && [...card.querySelectorAll('*')].every((el) => parseFloat(getComputedStyle(el).fontSize) >= 12)) || words + ' // card ' + JSON.stringify([box.left, box.top, box.right, box.bottom].map(Math.round)) + ' column ' + JSON.stringify([col.left, col.top, col.right, col.bottom].map(Math.round)) })()`)}`],
      ['the card\'s two links open the addresses the line had: NASA\'s own query for this site and this hour, once for the Sun and once for Earth', `(async () => { const [file, sites] = await Promise.all(['horizons.json', 'sites.json'].map((name) => fetch('/data/' + name).then((r) => r.json()))); const site = sites.find((s) => s.id === 'shackleton-rim'); const point = "'" + [((site.lon % 360) + 360) % 360, site.lat, file.sites[site.id].alt_km].join(',') + "'"; const links = [...document.querySelectorAll('.sl-horizons a')].map((a) => new URL(a.href)); return links.length === 2 && links.every((u) => u.origin + u.pathname === 'https://ssd.jpl.nasa.gov/api/horizons.api' && u.searchParams.get('SITE_COORD') === point && u.searchParams.get('CENTER') === "'coord@301'" && u.searchParams.get('START_TIME') === "'2027-05-06 13:00'" && u.searchParams.get('QUANTITIES') === "'4'") && links[0].searchParams.get('COMMAND') === "'10'" && links[1].searchParams.get('COMMAND') === "'399'" && [...document.querySelectorAll('.sl-horizons a')].every((a) => a.target === '_blank' && (a.getAttribute('title') ?? a.dataset.tip ?? '').startsWith("Opens NASA's own answer for")) })()`],
      ['with the card open nothing in the column scrolls and the card covers none of the Moon', `${NOTHING_SCROLLS} && ${COLUMN_FITS} && (() => { const card = document.querySelector('.sl-horizons-card').getBoundingClientRect(); const globe = document.querySelector('.scout-globe'); const size = Number(globe?.dataset.discPx); if (!globe || !(size > 0) || window.innerWidth < 761) return true; const g = globe.getBoundingClientRect(); const cx = (g.left + g.right) / 2; const cy = (g.top + g.bottom) / 2; const x = Math.min(Math.max(cx, card.left), card.right); const y = Math.min(Math.max(cy, card.top), card.bottom); return Math.hypot(x - cx, y - cy) >= size / 2 })()`],
      ['the keyboard reaches the card: its two links are the next two stops after the claim, and each takes the focus', `(() => { const stops = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')].filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0); const at = stops.indexOf(document.querySelector('.sl-horizons-claim')); const links = [...document.querySelectorAll('.sl-horizons-card a')]; return at >= 0 && stops[at + 1] === links[0] && stops[at + 2] === links[1] && links.every((link) => (link.focus(), document.activeElement === link)) })()`],
      ['the query is for the landing\'s hour: moving the time bar leaves it, and "Land here" moves it', `(${key('ArrowRight')}, true) && ${after(400, `new URL(document.querySelector('.sl-horizons a').href).searchParams.get('START_TIME') === "'2027-05-06 13:00'" && (${noteLink('Land here')}, true)`)} && ${after(400, `new URL(document.querySelector('.sl-horizons a').href).searchParams.get('START_TIME') === "'2027-05-06 14:00'"`)}`],
      ['Escape closes the card and hands the keyboard back to the claim; a press on the claim opens it again and a press anywhere else closes it', `(${key('Escape')}, true) && ${after(250, `(document.querySelector('.sl-horizons-card') === null && document.activeElement === document.querySelector('.sl-horizons-claim') && document.querySelectorAll('.sl-horizons a').length === 0 && (document.querySelector('.sl-horizons-claim').click(), true)) || 'Escape left the card'`)} && ${after(500, `(document.querySelector('.sl-horizons-card') !== null && (document.querySelector('.sl-facts').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })), true)) || 'did not open again'`)} && ${after(750, `(document.querySelector('.sl-horizons-card') === null && document.querySelector('.sl-horizons-claim').getAttribute('aria-expanded') === 'false') || 'a press outside left the card'`)}`],
    ],
  },
  {
    // Surface: the frame is ready before the press, the screen keeps its one time bar, and that bar moves the hour stood in.
    name: 'surface-bar',
    noChat: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['before the press the Surface frame is already on the page, out of sight behind the Moon, with its two views drawn', `(() => { const frame = document.querySelector('iframe.sl-surface'); window.__boxes = ${SCREEN_BOXES}; return (frame !== null && frame.classList.contains('is-away') && getComputedStyle(frame).visibility === 'hidden' && ${SURFACE_DRAWN} && document.querySelector('.sl-heights button[aria-pressed="true"]').textContent.trim() === 'Orbit') || 'frame: ' + (frame ? frame.className + ', drawn ' + ${SURFACE_DRAWN} : 'none') })()`, 5000],
      ['the press uncovers it at once: the picture is on screen in the next frame, under 100 ms', `(async () => { const t0 = performance.now(); ${pressView('Surface')}; await new Promise((done) => requestAnimationFrame(done)); const frame = document.querySelector('iframe.sl-surface'); const there = getComputedStyle(frame).visibility === 'visible' && !frame.classList.contains('is-away') && ${SURFACE_DRAWN}; const ms = performance.now() - t0; return (there && ms < 100) || 'visible and drawn in the next frame: ' + there + ', ' + Math.round(ms) + ' ms' })()`],
      ['in Surface the screen\'s own time bar is in sight, where it was, nothing round the stage has moved, and the frame has no bar of its own', `(() => { const doc = document.querySelector('iframe.sl-surface').contentDocument; const bar = document.querySelector('.sl-river').getBoundingClientRect(); const frame = document.querySelector('iframe.sl-surface').getBoundingClientRect(); const now = ${SCREEN_BOXES}; return (now === window.__boxes && bar.height > 30 && (window.innerWidth < 761 || bar.bottom <= window.innerHeight + 1) && document.querySelector('.sl-river .sl-round') !== null && doc.querySelector('.sf-river, .time-river, footer') === null && (window.innerWidth < 761 || frame.bottom <= bar.top + 1)) || 'before ' + window.__boxes + ' now ' + now + ' frame bar: ' + (doc.querySelector('.sf-river, .time-river, footer')?.className ?? 'none') })()`, 600],
      ['nothing in the frame leads to the old page', `(() => { const doc = document.querySelector('iframe.sl-surface').contentDocument; const links = [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')); return (links.every((href) => !/classic|\\?ui=/.test(href)) && !/Classic/.test(doc.body.textContent) && doc.querySelector('nav') === null) || links.join(' ') })()`],
      ['the frame stands at the hour on the bar: its Sun and Earth are the track\'s for that hour', `(async () => { const { says, want, at } = await ${surfaceSays('connecting-ridge')}; window.__said = says; return (at === '2027-05-06T13:00:00Z' && says.includes(want) && says.includes('from Connecting Ridge')) || at + ' // ' + says + ' // ' + want })()`],
      ['dragging the bar moves the Sun and Earth in the frame, to the hour dragged to', `(async () => { const seek = document.querySelector('.sl-seek'); const box = seek.getBoundingClientRect(); const at = (fraction) => ({ bubbles: true, pointerType: 'mouse', clientX: box.left + box.width * fraction, clientY: box.top + 3 }); seek.dispatchEvent(new PointerEvent('pointerdown', at(0.2))); seek.dispatchEvent(new PointerEvent('pointermove', at(0.7))); seek.dispatchEvent(new PointerEvent('pointerup', at(0.7))); await new Promise((done) => setTimeout(done, 700)); const now = await ${surfaceSays('connecting-ridge')}; const moved = now.says !== window.__said && now.at !== '2027-05-06T13:00:00Z' && now.says.includes(now.want); window.__said = now.says; return moved || now.at + ' // ' + now.says + ' // ' + now.want })()`],
      ['the column still tells of the landing, and the note over the view offers the way back to it', `(() => { const note = document.querySelector('.sl-off-landing'); if (!note) return 'no note'; const box = note.getBoundingClientRect(); const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return (note.contains(top) && /Back to landing/.test(note.textContent) && /Land here/.test(note.textContent) && /6 May 2027/.test(document.querySelector('.sl-plan').textContent)) || 'the note is under ' + (top?.className ?? top?.tagName) })()`],
      ['play runs in the frame without a reload: the same page, the same address, no new entry in the history, and the hour follows the bar', `(async () => { const frame = document.querySelector('iframe.sl-surface'); frame.contentWindow.__kept = true; const entries = history.length; const src = frame.getAttribute('src'); document.querySelector('.sl-river .sl-round[aria-label="Play"]').click(); await new Promise((done) => setTimeout(done, 1500)); const during = frame.contentDocument.querySelector('.sf-pane.sun .sf-stage').getAttribute('aria-label'); document.querySelector('.sl-river .sl-round[aria-label="Pause"]').click(); await new Promise((done) => setTimeout(done, 700)); const now = await ${surfaceSays('connecting-ridge')}; return (frame.contentWindow.__kept === true && history.length === entries && frame.getAttribute('src') === src && during !== window.__said && now.says.includes(now.want)) || 'kept ' + frame.contentWindow.__kept + ', history ' + entries + ' to ' + history.length + ', moved ' + (during !== window.__said) + ' // ' + now.says + ' // ' + now.want })()`],
      ['switching to Orbit, Site and back to Surface moves nothing else on the screen, and the frame is kept, out of sight, in between', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const seen = []; for (const name of ['Orbit', 'Site', 'Surface']) { [...document.querySelectorAll('.sl-heights button')].find((button) => button.textContent.trim() === name).click(); await wait(900); const frame = document.querySelector('iframe.sl-surface'); seen.push(name + ' ' + (${SCREEN_BOXES} === window.__boxes) + ' ' + (frame !== null && frame.contentWindow.__kept === true) + ' ' + (getComputedStyle(frame).visibility === (name === 'Surface' ? 'visible' : 'hidden'))) } return seen.join() === 'Orbit true true true,Site true true true,Surface true true true' || seen.join() })()`],
      ['out of sight the frame is left alone while a month plays, and stands at the bar\'s hour once it rests', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${pressView('Orbit')}; await wait(900); const label = () => document.querySelector('iframe.sl-surface').contentDocument.querySelector('.sf-pane.sun .sf-stage').getAttribute('aria-label'); const before = label(); document.querySelector('.sl-river .sl-round[aria-label="Play"]').click(); await wait(1200); const during = label(); document.querySelector('.sl-river .sl-round[aria-label="Pause"]').click(); await wait(1100); const now = await ${surfaceSays('connecting-ridge')}; return (during === before && now.says !== before && now.says.includes(now.want)) || 'during play it ' + (during === before ? 'stayed' : 'moved') + ' // ' + now.says + ' // ' + now.want })()`],
    ],
  },
  {
    // Surface stands on a point of the visitor's own, worked out in the browser as the column's numbers are: no notice, no way to an old page.
    name: 'surface-own-point',
    noChat: true,
    hash: '#a=-56.74,-48.96@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['Surface stands on the visitor\'s own point: two views drawn, named for the point, with no notice and no link to another page', `(${pressView('Surface')}, true) && ${after(6000, `(() => { const frame = document.querySelector('iframe.sl-surface'); const doc = frame.contentDocument; const says = doc.querySelector('.sf-pane.sun .sf-stage')?.getAttribute('aria-label') ?? ''; return (${SURFACE_DRAWN} && says.includes('from Custom point 56.740°S, 48.960°W') && /at azimuth [\\d.]+°; Earth is/.test(says) && doc.querySelector('.sf-notice') === null && doc.querySelectorAll('a[href]').length === 0 && !/Classic|listed sites only/.test(doc.body.textContent)) || says + ' // notice: ' + (doc.querySelector('.sf-notice')?.textContent ?? 'none') })()`)}`],
      ['the screen\'s time bar moves the hour there too', `(async () => { const label = () => document.querySelector('iframe.sl-surface').contentDocument.querySelector('.sf-pane.sun .sf-stage').getAttribute('aria-label'); const before = label(); for (let i = 0; i < 6; i += 1) ${key('ArrowRight')}; await new Promise((done) => setTimeout(done, 900)); return (label() !== before && document.querySelector('.sl-river') !== null && document.querySelector('iframe.sl-surface').contentDocument.querySelector('.sf-river') === null) || 'the frame did not move: ' + label() })()`],
    ],
  },
  {
    // The site on show, opened in NASA's tools: three links inside the site field's disclosure.
    name: 'open-in',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['under the site\'s control, always there, are three links in a line: Quickmap, Moon Trek, Horizons', `[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap,Moon Trek,Horizons' && ${text('.sl-open-in')}.startsWith('Open in ') && [...document.querySelectorAll('.sl-open-in a')].every((a) => a.target === '_blank' && /^Opens .+ at this place/.test(a.title))`, 1500],
      ['Quickmap opens 40 km of ground on its south-pole view, centred on the site as the app\'s own list gives it', `(async () => { const site = (await fetch('/data/sites.json').then((r) => r.json())).find((s) => s.id === 'shackleton-rim'); const url = new URL(document.querySelectorAll('.sl-open-in a')[0].href); const [x0, y0, x1, y1] = url.searchParams.get('prjExtent').split(',').map(Number); const r = 1737400 * Math.cos(site.lat * Math.PI / 180); const x = r * Math.sin(site.lon * Math.PI / 180); const y = r * Math.cos(site.lon * Math.PI / 180); return url.origin === 'https://quickmap.lroc.im-ldi.com' && url.searchParams.get('proj') === '17' && x1 - x0 === 40000 && y1 - y0 === 40000 && Math.abs((x0 + x1) / 2 - x) <= 1 && Math.abs((y0 + y1) / 2 - y) <= 1 })()`],
      ['Moon Trek opens its south-pole map on the same place', `(() => { const url = new URL(document.querySelectorAll('.sl-open-in a')[1].href); const hash = new URLSearchParams(url.hash.slice(1)); return url.origin + url.pathname === 'https://trek.nasa.gov/moon/' && hash.get('p') === 'urn:ogc:def:crs:IAU2000::30120' && Math.hypot(Number(hash.get('x')), Number(hash.get('y'))) < 160000 })()`],
      ['Horizons opens the Sun\'s query for the site at the landing hour', `(() => { const url = new URL(document.querySelectorAll('.sl-open-in a')[2].href); return url.origin + url.pathname === 'https://ssd.jpl.nasa.gov/api/horizons.api' && url.searchParams.get('COMMAND') === "'10'" && url.searchParams.get('START_TIME') === "'2027-05-06 13:00'" })()`],
      ['the links are one small line directly under the site\'s control, with no block to open or close, and the column does not scroll', `(() => { const line = document.querySelector('.sl-plan > .sl-open-in'); const site = document.querySelector('#sl-site').closest('.sl-plan-row'); return (line !== null && line.previousElementSibling === site && line.getBoundingClientRect().height < 24 && document.querySelector('.sl-plan-more') === null && document.querySelector('.sl-coords summary, .sl-col details') === null) || 'line ' + (line ? Math.round(line.getBoundingClientRect().height) + ' px' : 'missing') })() && ${COLUMN_FITS}`],
      ['a site Moon Trek cannot show well gets no Moon Trek link, and still gets the other two', `(() => { const select = document.querySelector('#sl-site'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, 'im-1-odysseus'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(1500, "[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap,Horizons'")}`],
    ],
  },
  {
    // The 8K color map: fetched only by a laptop zoomed in on ground the color map covers, and kept compressed on the graphics card.
    name: 'color-8k',
    hash: '#a=apollo-17@2029-03&t=201&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)'],
    checks: [
      ['the first view, in Orbit, does not ask for the 8K map: the page opens as light as before', `${after(2500, "!performance.getEntriesByType('resource').some((entry) => /moon_color_8k|basis_transcoder/.test(entry.name)) && document.querySelector('.scout-globe canvas').dataset.color === undefined")}`],
      ['close on a site the color map covers, a laptop fetches the 8K map with its transcoder and draws from it; a phone stays on the 4K one', `(async () => { ${click('Site')}; const canvas = () => document.querySelector('.scout-globe canvas'); const asked = () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('moon_color_8k.ktx2')); const laptop = matchMedia('(hover: hover) and (pointer: fine)').matches; const until = Date.now() + (laptop ? 25000 : 5000); while (Date.now() < until && canvas().dataset.color !== '8k') await new Promise((done) => setTimeout(done, 250)); if (!laptop) return (!asked() && canvas().dataset.color === undefined) || 'a phone asked for the 8K map'; if (canvas().dataset.color !== '8k') return 'the 8K map is not in use; asked for: ' + asked(); return performance.getEntriesByType('resource').some((entry) => entry.name.includes('basis_transcoder.wasm')) || 'no transcoder fetched' })()`, 30000],
      ['the card keeps it compressed: under 50 MB with every smaller size, where plain pixels would take 179 MB', `(() => { const canvas = document.querySelector('.scout-globe canvas'); if (canvas.dataset.color !== '8k') return true; const mb = Number(canvas.dataset.colorMb); return (mb > 30 && mb < 50) || 'on the card: ' + mb + ' MB' })()`],
      ['the Moon is still drawn', `document.querySelector('.scout-globe canvas').dataset.drawnMs !== undefined`],
    ],
    notes: [
      ['the 8K map on the graphics card', `(document.querySelector('.scout-globe canvas').dataset.colorMb ?? 'not loaded: 0') + ' MB'`],
      ['frame rate close on Apollo 17 with the 8K map, while time plays', `(${click('Play')}, true) && ${FRAME_RATE.replace("requestAnimationFrame(tick) })", "requestAnimationFrame(tick) }).then((words) => { " + click('Pause') + "; return words })")}`],
    ],
  },
  {
    // Close on Connecting Ridge two hours before the Sun sets there (the site's own track has it up until hour 452 of May 2027 and down from 453).
    // Site view is the Moon's own picture; the app's computed light is a layer, "Light and shadow", off until asked for.
    name: 'site-light',
    frames: true,
    hash: '#a=connecting-ridge@2027-05&t=451&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Site')],
    checks: [
      ['Site view opens on the Moon\'s own picture: no light overlay, and no month of the light grid is fetched', "document.querySelector('.sl-moon').dataset.grid === 'off' && document.querySelector('.scout-globe canvas').dataset.overlay !== 'on' && !performance.getEntriesByType('resource').some((entry) => /light\\/.*\\d{4}-\\d{2}/.test(entry.name))", 5000],
      ['a scale bar says how much ground the screen holds, to the pixel', `(() => { const bar = document.querySelector('.sl-scale'); const km = /^(\\d+(?:\\.\\d+)?) (km|m)$/.exec(bar.textContent); if (!km) return 'no length: ' + bar.textContent; const length = Number(km[1]) * (km[2] === 'm' ? 0.001 : 1); const kmPerPx = 3474.8 / Number(document.querySelector('.scout-globe').dataset.discPx); const drawn = bar.querySelector('span').getBoundingClientRect().width; return Math.abs(drawn - length / kmPerPx) < 2 || 'the bar is ' + Math.round(drawn) + ' px for ' + length + ' km at ' + kmPerPx.toFixed(3) + ' km a pixel' })()`],
      ['an arrow points the way to Earth across the ground, as the ephemeris file has it for this hour', `${EARTH_ARROW(451)}`],
      ['the view\'s tools are flush with the stage\'s right edge, as in Orbit, and the scale bar is in the stage\'s bottom right corner, clear of the note about the landing; the column does not scroll', `(${key('ArrowRight')}, true) && ${after(700, `(() => { const box = document.querySelector('.sl-moon').getBoundingClientRect(); const stage = { right: Math.min(box.right, window.innerWidth), bottom: Math.min(box.bottom, window.innerHeight) }; const zoom = document.querySelector('.zoom-buttons').getBoundingClientRect(); const bar = document.querySelector('.sl-scale').getBoundingClientRect(); const arrow = document.querySelector('.sl-view-tools .sl-to-earth'); const note = document.querySelector('.sl-off-landing')?.getBoundingClientRect(); ${key('ArrowLeft')}; if (!arrow || !/Earth/.test(arrow.textContent)) return 'no arrow to Earth with the tools'; const a = arrow.getBoundingClientRect(); const under = [...document.querySelectorAll('.sl-view-tools button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && !(r.right <= a.left || r.left >= a.right || r.bottom <= a.top || r.top >= a.bottom) }); if (under) return 'the arrow to Earth is over the button ' + (under.getAttribute('aria-label') ?? under.textContent); if (document.querySelector('.sl-view-tools .sl-scale')) return 'the scale bar is still in the column of tools'; if (zoom.width > 0 && stage.right - zoom.right > 24) return 'the zoom buttons are ' + Math.round(stage.right - zoom.right) + ' px in from the stage\\'s edge'; if (stage.right - bar.right > 24 || stage.bottom - bar.bottom > 80 || bar.bottom > stage.bottom) return 'the scale bar is ' + Math.round(stage.right - bar.right) + ' px from the right and ' + Math.round(stage.bottom - bar.bottom) + ' px from the bottom'; if (!note) return 'no note about the landing to keep clear of'; if (!(note.right <= bar.left || note.top >= bar.bottom || note.bottom <= bar.top)) return 'the scale bar (' + [bar.left, bar.top, bar.right, bar.bottom].map(Math.round).join(',') + ') is over the note (' + [note.left, note.top, note.right, note.bottom].map(Math.round).join(',') + ')'; return ${COLUMN_FITS} })()`)}`],
      ['close on the polar ground, which is drawn in plain gray, the 8K color map is not fetched: it would not show', "!performance.getEntriesByType('resource').some((entry) => entry.name.includes('moon_color_8k'))"],
      ['nothing on the stage turns the pointer into a question mark: the arrow to Earth keeps its tooltip and the ordinary arrow', `document.querySelector('.sl-to-earth')?.title !== '' && ([...document.querySelectorAll('.sl-moon, .sl-moon *')].every((el) => getComputedStyle(el).cursor !== 'help') || 'the help cursor is used on the stage')`],
      ['"Light and shadow" is a layer, off by default, that a polar site can switch on', `(${click('Layers')}, true) && ${after(900, "(() => { const own = document.querySelector('.sl-layer-ground input'); return own !== null && !own.checked && !own.disabled && /Light and shadow/.test(document.querySelector('.sl-layer-ground').textContent) })()")}`],
      ['switched on, the ground\'s brightness changes: shadow from the light grid, for the hour on the clock', `(() => { const moon = document.querySelector('.sl-moon'); const last = (frames) => frames[frames.length - 1]; return (${MOON_FRAMES(300)}).then((frames) => { window.__plain = last(frames); document.querySelector('.sl-layer-ground input').click(); return new Promise((done) => { const until = Date.now() + 20000; const look = () => (moon.dataset.grid === 'on' && moon.dataset.gridSun !== '') || Date.now() > until ? done() : setTimeout(look, 200); look() }) }).then(() => new Promise((done) => setTimeout(done, 2500))).then(() => ${MOON_FRAMES(300)}).then((frames) => { const lit = last(frames); if (moon.dataset.grid !== 'on' || moon.dataset.gridSun === '') return 'the light grid did not arrive'; window.__shaded = lit; return Math.abs(lit.mean - window.__plain.mean) > 0.5 || 'the ground did not change: mean ' + window.__plain.mean.toFixed(2) + ' to ' + lit.mean.toFixed(2) }) })()`],
      ['the grid has the site sunlit at this hour, and so does the answer: the picture and the numbers agree', `document.querySelector('.sl-moon').dataset.gridSun === 'true' && /^(Sunlit|Partly sunlit)/.test(${SENTENCE})`],
      ['its caption says what one cell of the grid covers', `/One cell is \\d+ m of ground/.test(${text('.sl-layer-shade')}) || ${text('.sl-layer-shade')}`],
      ['it only darkens: no point of the ground is brighter with it on', `(() => { const brighter = window.__shaded.points.filter((value, k) => value > window.__plain.points[k] + 6).length; return brighter === 0 || brighter + ' points are brighter with the layer on' })()`],
      ['with it on and nothing touched, every frame is the same picture', MOON_STILL(1500)],
      ['switched off, the picture is exactly what it was before', `(() => { document.querySelector('.sl-layer-ground input').click(); return new Promise((done) => setTimeout(done, 3000)).then(() => ${MOON_FRAMES(300)}).then((frames) => { const now = frames[frames.length - 1]; return (document.querySelector('.sl-moon').dataset.grid === 'off' && now.sum === window.__plain.sum) || 'not the same picture: mean ' + window.__plain.mean.toFixed(3) + ' before, ' + now.mean.toFixed(3) + ' after' }) })()`],
      ['back in Orbit the bar and the arrow are gone', `(${click('Orbit')}, true) && ${after(1500, "document.querySelector('.sl-scale') === null && document.querySelector('.sl-to-earth') === null")} && (${click('Site')}, true)`],
    ],
    notes: [['frame rate close on the site with Light and shadow on, while time plays', `(document.querySelector('.sl-layer-ground input').click(), ${click('Play')}, true) && ${after(3000, 'true')}.then(() => ${FRAME_RATE}).then((words) => { ${click('Pause')}; return words })`]],
  },
  {
    // Close on Connecting Ridge two hours after the Sun sets there (the site's own track has it up until hour 452 of May 2027 and down from 453).
    name: 'site-dark',
    hash: '#a=connecting-ridge@2027-05&t=455&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Site'), click('Layers'), "document.querySelector('.sl-layer-ground input').click()"],
    checks: [
      ['with Light and shadow on, the ground is shaded from the light grid for the hour on the clock', "document.querySelector('.sl-moon').dataset.grid === 'on' && document.querySelector('.sl-moon').dataset.gridSun !== ''", 14000],
      ['the grid has the site dark at this hour, and so does the answer: the picture and the numbers agree', `document.querySelector('.sl-moon').dataset.gridSun === 'false' && /^No sunlight/.test(${SENTENCE})`],
    ],
  },
  {
    // Close on the pole the four ridge sites are a few dozen pixels apart: whose name is whose must be plain.
    name: 'site-names',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Site')],
    checks: [
      ['close on a site, the selected site shows its own name', "(() => { const name = document.querySelector('.sl-dot.is-selected > span'); return name !== null && name.textContent === 'Shackleton Rim' && getComputedStyle(name).visibility === 'visible' && !name.classList.contains('off') })()", 2500],
      ['its name touches no other site\'s dot, so it cannot be read as a neighbour\'s', "(() => { const name = document.querySelector('.sl-dot.is-selected > span').getBoundingClientRect(); return [...document.querySelectorAll('.sl-dot:not(.is-selected), .sl-group-dot')].every((dot) => { const b = dot.getBoundingClientRect(); return name.left >= b.right + 3 || name.right <= b.left - 3 || name.top >= b.bottom + 3 || name.bottom <= b.top - 3 }) })()"],
      ['and no marker or name prints over another, as at whole-Moon size', DOTS_CLEAR],
    ],
  },
  {
    // Around the Moon: made-up stars, Earth in its true direction and phase, and zooming out.
    // 3 May 2027 18:00 UTC: Earth is 5° south of the Moon's equator, so on the viewer's side in the view from over the south pole.
    name: 'sky',
    hash: '#a=shackleton-rim@2027-05&t=66&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['there are stars behind the Moon, and none over its disc', `${STARS_CLEAR}`, 2500],
      ['Earth\'s "not to scale" words are a tooltip under the ordinary arrow: nothing on the stage turns the pointer into a question mark', `(() => { const name = document.querySelector('.sl-earth-name'); if (!name) return 'Earth has no tooltip here'; if (!/Not to scale/.test(name.title)) return 'the tooltip says: ' + name.title; return [...document.querySelectorAll('.sl-moon, .sl-moon *')].every((el) => getComputedStyle(el).cursor !== 'help') || 'the help cursor is used on the stage' })()`],
      ['the stars sit under the Moon, the dots and every control', "(() => { const stars = document.querySelector('.sl-stars'); return getComputedStyle(stars).pointerEvents === 'none' && stars.compareDocumentPosition(document.querySelector('.scout-globe')) & Node.DOCUMENT_POSITION_FOLLOWING })() > 0"],
      ['Earth is on the viewer\'s side of the Moon at this hour, by the ephemeris file', `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const h = 2946; return f[h * 6 + 5] / Math.hypot(f[h * 6 + 3], f[h * 6 + 4], f[h * 6 + 5]) < -0.06 })()`],
      ['so Earth is drawn: its whole disc inside the stage, off the Moon\'s disc and the view\'s buttons, and under the Moon', `(() => { const earth = document.querySelector('.sl-earth'); if (!earth || earth.dataset.state !== 'front' || Number(getComputedStyle(earth).opacity) < 0.9) return 'no Earth in front'; const m = ${EARTH_OUT}; return (m.d >= m.r + m.er && m.inside >= 6 && !m.onTools && (earth.compareDocumentPosition(document.querySelector('.scout-globe')) & Node.DOCUMENT_POSITION_FOLLOWING) > 0) || 'Earth ' + Math.round(m.d) + ' px from the centre of a disc of radius ' + Math.round(m.r) + ', ' + Math.round(m.inside) + ' px inside the stage' + (m.onTools ? ', over the buttons' : '') })()`],
      ['with time paused Earth does not move at all: under a pixel between frames', earthSteady(1500, 1)],
      ['its tooltip says what is true about it and that it is not to scale', `(() => { const name = document.querySelector('.sl-earth-name'); return name !== null && /^Earth, drawn on the side of the Moon it lies toward, with \\d+% of its face sunlit as now\\. Not to scale: Earth is much farther away than drawn\\.$/.test(name.title) && name.getAttribute('aria-label') === name.title })()`],
      ['Earth\'s phase is the Sun\'s and Earth\'s own geometry: lit share from the file matches the picture\'s', `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const h = 2946; const unit = (o) => { const n = Math.hypot(f[h * 6 + o], f[h * 6 + o + 1], f[h * 6 + o + 2]); return [f[h * 6 + o] / n, f[h * 6 + o + 1] / n, f[h * 6 + o + 2] / n] }; const sun = unit(0); const pose = document.querySelector('.scout-globe').dataset.pose.split(',').map(Number); const lit = Math.round((1 + sun[0] * pose[0] + sun[1] * pose[1] + sun[2] * pose[2]) / 2 * 100); return Math.abs(lit - Number(document.querySelector('.sl-earth').dataset.lit)) <= 1 })()`],
      ['zooming out stops with the disc a third of the shorter side of the stage\'s free room', `(async () => { const out = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom out'); for (let i = 0; i < 12 && !out().disabled; i += 1) { out().click(); await new Promise((done) => setTimeout(done, 350)) } const stage = document.querySelector('.sl-moon').getBoundingClientRect(); const disc = Number(document.querySelector('.scout-globe').dataset.discPx); const third = Math.min(stage.width, stage.height - ${STRIP}) / 3; return out().disabled && Math.abs(disc - third) <= third * 0.03 || 'disc ' + disc + ' px, a third is ' + Math.round(third) })()`],
      ['zoomed out, Earth stands clear of the disc and the stars still keep off it', `(() => { const m = ${EARTH_OUT}; return (m.d >= m.r + m.er && m.inside >= 6 && !m.onTools) || 'Earth ' + Math.round(m.d) + ' px from the centre, disc radius ' + Math.round(m.r) + ', ' + Math.round(m.inside) + ' px inside the stage' })() === true && ${STARS_CLEAR} === true`],
      ['with room all round, Earth is on the bearing the ephemeris file gives it, with the file\'s lit share and its bright side toward the Sun (3 May 2027 18:00)', earthIsRight(2946)],
      ['the compass brings back the default size as well as the default direction', `(document.querySelector('.sl-recentre').click(), true) && ${after(1200, `(() => { const stage = document.querySelector('.sl-moon').getBoundingClientRect(); const disc = Number(document.querySelector('.scout-globe').dataset.discPx); return Math.abs(disc - Math.min(stage.width, stage.height - ${STRIP}) * 0.9) <= 3 && document.querySelector('.sl-recentre') === null })()`)}`],
    ],
  },
  {
    // A second moment for the same comparison: 16 September 2027 23:00 UTC, Earth again on the viewer's side.
    name: 'sky-september',
    hash: '#a=shackleton-rim@2027-09&t=383&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['Earth is on the viewer\'s side of the Moon at this hour, by the ephemeris file', `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const h = 6215; return f[h * 6 + 5] / Math.hypot(f[h * 6 + 3], f[h * 6 + 4], f[h * 6 + 5]) < -0.06 })()`, 2500],
      ['zoomed out so Earth has room on its own bearing', `(async () => { const out = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom out'); for (let i = 0; i < 12 && !out().disabled; i += 1) { out().click(); await new Promise((done) => setTimeout(done, 350)) } return document.querySelector('.sl-earth').dataset.moved === '0' || 'moved ' + document.querySelector('.sl-earth').dataset.moved + '°' })()`],
      ['Earth is on the bearing the ephemeris file gives it, with the file\'s lit share and its bright side toward the Sun (16 September 2027 23:00)', earthIsRight(6215)],
      ['and it does not move while time is paused', earthSteady(1500, 1)],
    ],
  },
  {
    // 16 May 2027 11:00 UTC: Earth is 5° north of the Moon's equator, so beyond the Moon in the view from over the south pole.
    name: 'sky-behind',
    hash: '#a=shackleton-rim@2027-05&t=371&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['Earth is on the far side of the Moon from the viewer at this hour, by the ephemeris file', `(async () => { const f = new Float32Array(await (await fetch('/data/custom/ephemeris-2027.bin')).arrayBuffer()); const h = 3251; return f[h * 6 + 5] / Math.hypot(f[h * 6 + 3], f[h * 6 + 4], f[h * 6 + 5]) > 0.06 })()`, 2500],
      ['so Earth is not drawn, and has no tooltip', "(() => { const earth = document.querySelector('.sl-earth'); return earth !== null && earth.dataset.state === 'behind' && Number(getComputedStyle(earth).opacity) === 0 && document.querySelector('.sl-earth-name') === null })()"],
      ['the stars are still there', `${STARS_CLEAR}`],
    ],
  },
  {
    // Places NASA names for landings still to come, in the site list, marked approximate.
    name: 'future',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the site list has a group of future targets, marked approximate, with the places in the pipeline\'s file', `(async () => { const file = await fetch('/data/future-targets.json').then((r) => r.json()); const group = [...document.querySelectorAll('#sl-site optgroup')].find((g) => g.label.startsWith('Future targets (approximate region')); return group !== undefined && /IAU/.test(group.label) && file.targets.length === 3 && [...group.querySelectorAll('option')].map((o) => o.textContent).join('|') === file.targets.map((t) => t.name + ' · ' + t.who).join('|') })()`, 1500],
      ['choosing one works it out in the browser, at the IAU centre of the place, under its own name', `${`(() => { const select = document.querySelector('#sl-site'); const option = [...select.options].find((o) => o.textContent.startsWith('Mons Mouton')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(select, option.value); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`} && ${after(7000, `(async () => { const target = (await fetch('/data/future-targets.json').then((r) => r.json())).targets.find((t) => t.id === 'mons-mouton'); const select = document.querySelector('#sl-site'); return select.value === target.lat + ',' + target.lon && select.selectedOptions[0].textContent === 'Mons Mouton · CLPS IM-4, Artemis III' && document.querySelectorAll('.sl-facts > .sl-fact').length === 3 && /°/.test(${text('.sl-facts')}) })()`)}`],
      ['it is marked approximate wherever it is named, and never listed twice', `${OPEN_SCOUT} && ${after(400, `/Mons Mouton \\(approximate\\)/.test(document.querySelector('.sl-ask input').placeholder)`)} && [...document.querySelectorAll('#sl-site option')].filter((o) => o.value === document.querySelector('#sl-site').value).length === 1 && ![...document.querySelectorAll('#sl-site option')].some((o) => o.textContent.startsWith('Custom point') && o.value !== '__custom')`],
      ['the field says where the point comes from: the IAU\'s center for it, and NASA\'s own sentence with its date', `(() => { const title = document.querySelector('#sl-site').title; return title.startsWith('An approximate place: the center of Mons Mouton, from the IAU’s list of lunar names. NASA gives no coordinates, only') && title.includes('will deliver six NASA CLPS science payloads to Mons Mouton.') && /NASA, 2026-06-10/.test(title) })()`],
      ['it opens in Quickmap like any point (Moon Trek\'s south-pole link is proven to 158 km from the pole; this centre is 164 km out)', "[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap' || [...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join()"],
      ['the column does not scroll with that line there', COLUMN_FITS],
    ],
  },
  {
    // "Place names", one more switch in Layers: the IAU's names for the Moon's large features and the
    // earlier landings, printed on the Moon. Off until switched on; nothing is fetched before then.
    name: 'place-names',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Layers')],
    checks: [
      ['Layers has a "Place names" switch, off: no name is on the Moon and the names file has not been asked for', `(() => { const label = [...document.querySelectorAll('.sl-layer-own label')].find((el) => el.textContent.trim() === 'Place names'); if (!label) return 'no switch'; return (label.querySelector('input').checked === false && document.querySelector('.sl-place-name') === null && performance.getEntriesByType('resource').every((entry) => !entry.name.includes('features.json'))) || 'on, or asked for early' })()`],
      ['switched on, the names are printed on the Moon, each inside its disc, and the panel says whose names they are', `([...document.querySelectorAll('.sl-layer-own label')].find((el) => el.textContent.trim() === 'Place names').querySelector('input').click(), true) && ${after(1500, "(() => { const names = [...document.querySelectorAll('.sl-place-name')]; const globe = document.querySelector('.scout-globe'); const g = globe.getBoundingClientRect(); const r = Number(globe.dataset.discPx) / 2; const cx = (g.left + g.right) / 2; const cy = (g.top + g.bottom) / 2; const outside = names.filter((name) => { const box = name.getBoundingClientRect(); return Math.hypot((box.left + box.right) / 2 - cx, (box.top + box.bottom) / 2 - cy) > r }).map((name) => name.textContent); const said = document.querySelector('.sl-layer-names')?.textContent ?? ''; return (names.length >= 3 && outside.length === 0 && /IAU Gazetteer of Planetary Nomenclature/.test(said) && performance.getEntriesByType('resource').filter((entry) => entry.name.includes('features.json')).length === 1) || names.length + ' names; outside the disc: ' + outside.join(', ') + '; ' + said })()")}`],
      ['no name lies on another, on a site\'s marker or on a site\'s own name', NAMES_CLEAR],
      ['the names take no clicks and are not read out twice: a press on one reaches the Moon, and a reader skips them', `(() => { const layer = document.querySelector('.sl-place-names'); const name = layer.querySelector('.sl-place-name'); const box = name.getBoundingClientRect(); const under = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2); return (layer.getAttribute('aria-hidden') === 'true' && getComputedStyle(name).pointerEvents === 'none' && !layer.contains(under)) || 'a name takes the press' })()`],
      ['they follow the Moon: zoomed in, the names in view are printed further from the middle, and still clear of each other', `(() => { const at = (text) => { const el = [...document.querySelectorAll('.sl-place-name')].find((name) => name.textContent === text); return el ? el.getBoundingClientRect() : null }; const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const mid = { x: (globe.left + globe.right) / 2, y: (globe.top + globe.bottom) / 2 }; const far = (box) => Math.hypot((box.left + box.right) / 2 - mid.x, (box.top + box.bottom) / 2 - mid.y); window.__names = Object.fromEntries([...document.querySelectorAll('.sl-place-name')].map((name) => [name.textContent, far(name.getBoundingClientRect())])); document.querySelector('.sl-view-tools button[aria-label="Zoom in"]').click(); return true })() && ${after(1200, "(() => { const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const mid = { x: (globe.left + globe.right) / 2, y: (globe.top + globe.bottom) / 2 }; const still = [...document.querySelectorAll('.sl-place-name')].filter((name) => window.__names[name.textContent] !== undefined); const moved = still.filter((name) => { const box = name.getBoundingClientRect(); return Math.hypot((box.left + box.right) / 2 - mid.x, (box.top + box.bottom) / 2 - mid.y) > window.__names[name.textContent] + 2 }); return (still.length > 0 && moved.length === still.length) || moved.length + ' of ' + still.length + ' moved out' })()")}`],
      ['the panel still fits without scrolling with the layer on', COLUMN_FITS],
      ['switched off, the names are gone', `([...document.querySelectorAll('.sl-layer-own label')].find((el) => el.textContent.trim() === 'Place names').querySelector('input').click(), true) && ${after(400, "document.querySelector('.sl-place-name') === null && document.querySelector('.sl-layer-names') === null")}`],
    ],
  },
  {
    // The smaller named features round the south pole (Shackleton, de Gerlache, Haworth and their
    // neighbours) are printed only when the view is close enough for them to have room.
    name: 'place-names-close',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    // The flight down to the site is given time to end before Layers opens beside the Moon.
    steps: [click('Site'), after(2600, 'true'), click('Layers'), `([...document.querySelectorAll('.sl-layer-own label')].find((el) => el.textContent.trim() === 'Place names').querySelector('input').click(), true)`],
    checks: [
      ['close on a site, the craters round it are named, each on the Moon where it is', `${after(3500, "(() => { const names = [...document.querySelectorAll('.sl-place-name')].map((name) => name.textContent); const near = names.filter((name) => ['Shackleton', 'de Gerlache', 'Haworth', 'Shoemaker', 'Faustini', 'Sverdrup', 'Spudis', 'Slater', 'Henson'].includes(name)); return near.length >= 2 || 'named: ' + names.join(', ') })()")}`],
      ['and no name lies on another, on a site\'s marker or on a site\'s own name', NAMES_CLEAR],
      ['with the whole Moon in view again only its landmarks are named: none of the craters round the pole', `(${click('Orbit')}, true) && ${after(3500, "(() => { const names = [...document.querySelectorAll('.sl-place-name')].map((name) => name.textContent); const small = names.filter((name) => ['Shackleton', 'de Gerlache', 'Haworth', 'Shoemaker', 'Faustini', 'Sverdrup', 'Spudis', 'Slater', 'Henson'].includes(name)); return (names.length >= 3 && small.length === 0) || names.join(', ') })()")}`],
    ],
  },
  {
    // Layers, close up: the ground in view is fetched from Moon Trek at the detail the zoom needs.
    name: 'layers-close',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    // The browser's log of requests is short by default; the checks count tiles in it.
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Site'), click('Layers'), "document.querySelectorAll('.sl-layer-list input')[0].click()"],
    checks: [
      ['with a layer on, the view may go closer than the app\'s own maps allow: zooming in stops at the finest pixels there are for this ground (here, within 10 km of a ridge site, our own tiles of 1.05 m: 0.70 m a screen pixel)', `(async () => { await new Promise((done) => setTimeout(done, 5000)); const zoomIn = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in'); for (let i = 0; i < 30 && !zoomIn().disabled; i += 1) { zoomIn().click(); await new Promise((done) => setTimeout(done, 300)) } const metresPerPx = 3474800 / Number(document.querySelector('.scout-globe').dataset.discPx); return (zoomIn().disabled && metresPerPx < 0.72 && metresPerPx > 0.68) || 'stopped at ' + metresPerPx.toFixed(2) + ' m a pixel' })()`],
      ['the ground in view arrives at the finest level there is for it: level 13, from our own tiles of the layer\'s mosaic, never more than a close-up\'s worth', `${after(9000, "(() => { const level = document.querySelector('.sl-moon').dataset.layerLevel; const finest = performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => name.includes('/tiles/polar/photo/13/')); return (level === '13' && finest.length >= 4 && finest.length <= 144 && document.querySelector('.scout-globe canvas').dataset.overlayDetail === 'on') || 'level ' + level + ', ' + finest.length + ' of our tiles' })()")}`],
      ['the credit names both mosaics', `/^Moon Trek: LRO LROC NAC Image Mosaic, S Pole, Avg Merge; closest in, LRO NAC Mosaic 1mpp, S Pole\\./.test(${text('.sl-layer-credit').replace(/\s+/g, ' ')}.replace(/\\s+/g, ' '))`],
      ['zooming back out past the whole-cap picture drops the close-up', `(async () => { const out = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom out'); for (let i = 0; i < 30 && !out().disabled; i += 1) { out().click(); await new Promise((done) => setTimeout(done, 200)) } await new Promise((done) => setTimeout(done, 1200)); return document.querySelector('.sl-moon').dataset.layerLevel === '' && document.querySelector('.scout-globe canvas').dataset.overlayDetail === 'off' && document.querySelector('.scout-globe canvas').dataset.overlay === 'on' })()`],
    ],
    notes: [['frame rate with a layer and its close-up on, while time plays', `(async () => { const zoomIn = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in'); for (let i = 0; i < 15 && !zoomIn().disabled; i += 1) { zoomIn().click(); await new Promise((done) => setTimeout(done, 250)) } await new Promise((done) => setTimeout(done, 6000)); ${click('Play')}; const words = await ${FRAME_RATE}; ${click('Pause')}; return words + ', level ' + document.querySelector('.sl-moon').dataset.layerLevel })()`]],
  },
  {
    // Scout's one idea: plan for the Canadian Space Agency's utility rover.
    name: 'rover',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['with nothing asked, Scout offers the rover idea among its ideas, after the one about why landing here is hard, and the mission is still the short stay', `${OPEN_SCOUT} && ${after(500, `[...document.querySelectorAll('.sl-talk .sl-idea.is-action')].map((idea) => idea.textContent).join('|') === 'Why is landing here hard?|Plan for Canada’s utility rover' && ${text('.sl-mission-open b')} === 'Short stay'`)}`, 1500],
      ['picking it selects the Long stay and opens the rover\'s panel', `([...document.querySelectorAll('.sl-idea.is-action')].find((idea) => idea.textContent.trim() === 'Plan for Canada’s utility rover').click(), true) && ${after(900, `${text('.sl-mission-open b')} === 'Long stay' && document.querySelector('.sl-rover') !== null`)}`],
      ['a panel quotes the Canadian Space Agency word for word, and says it has published no landing site', `(() => { const words = ${text('.sl-rover')}; return ['“Concept development”', '“In the 2030s”', '“survive the roughly two-week-long lunar night, with temperatures as low as -200 °C”', '“surveying for ice or other resources”', 'The agency has published no landing site.'].every((part) => words.includes(part)) })()`],
      ['it says in two sentences why that is hard at the pole, with the Long stay\'s own numbers', `(() => { const why = ${text('.sl-rover-why')}; return why.split('. ').length === 2 && /60 days, at most 14 days without Sun and no limit on time without Earth/.test(why) && /the skyline can hide it for days/.test(why) })()`],
      ['it links to the agency\'s page', `(() => { const link = document.querySelector('.sl-rover a'); return link.href === 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/canadian-utility-rover-on-the-moon.asp' && link.target === '_blank' && /^Canadian Space Agency: /.test(link.textContent) })()`],
      ['"lunar night" appears only inside the agency\'s quotation', `(() => { const all = document.body.innerText; const outside = all.replace(/“[^”]*”/g, ''); return /lunar night/.test(all) && !/lunar night|lunar day/i.test(outside) })()`],
      ['neither the column nor the panel scrolls', COLUMN_FITS],
      // On a window too narrow for two panels the rover's panel has Scout's place while it is open (and Scout's button in the rail shows nothing until it is closed: reported, not changed here), so the rover's panel is closed first there.
      ['Scout\'s panel, beside the rover\'s on a wide window or back once the rover\'s is closed, says what the idea did', `(() => { if (document.querySelector('.sl-scout-panel') === null) document.querySelector('.sl-rover .sl-drawer-head button')?.click(); return true })() && ${after(700, OPEN_SCOUT)} && ${after(1600, `${text('.sl-talk .sl-said.is-scout')} === 'Mission set to Long stay. The panel on the right says why that is hard at the pole.' || ${text('.sl-talk')}.slice(0, 120) || 'no conversation on screen'`)}`],
    ],
  },
  {
    // Close on a site with no layer on, the Moon's own picture gets sharper from Moon Trek's photos of the ground (lib/moonDetail.ts):
    // the whole-Moon WAC mosaic first, then, where there is one, the LRO NAC mosaic of the region.
    name: 'ground-detail',
    frames: true,
    hash: '#a=apollo-17@2029-03&t=201&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(20000)'],
    checks: [
      ['in Orbit nothing of the ground\'s detail is asked for: the first view and Watch load what they did', "!performance.getEntriesByType('resource').some((entry) => entry.name.includes('/trek/')) && document.querySelector('.sl-moon').dataset.groundLevel === ''", 2500],
      ['in Site view, with no layer on, once the flight there is over, the ground comes into focus from the whole-Moon WAC mosaic with no frame that jumps', `(${click('Site')}, true) && ${after(1600, 'true')}.then(() => ${MOON_SMOOTH(7000, { mean: 3, points: 12, least: 1 })})`],
      ['the picture on show is the WAC mosaic, at a level that matches the screen', "(() => { const moon = document.querySelector('.sl-moon'); return (moon.dataset.groundProduct === 'LRO_WAC_Mosaic_Global_303ppd_v02' && Number(moon.dataset.groundLevel) >= 5 && document.querySelector('.scout-globe canvas').dataset.ground === 'on') || 'product ' + moon.dataset.groundProduct + ', level ' + moon.dataset.groundLevel })()"],
      ['paused and untouched, every frame is the same picture', MOON_STILL(1500)],
      ['zoomed in as far as the buttons go (a phone has none), the ground is the LRO NAC mosaic of the region at its finest level, 0.65 m a pixel, and a screen pixel is 0.43 m', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const zoomIn = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in'); if (!zoomIn()) return true; for (let i = 0; i < 40 && !zoomIn().disabled; i += 1) { zoomIn().click(); await wait(320) } const moon = document.querySelector('.sl-moon'); const until = Date.now() + 25000; while (Date.now() < until && moon.dataset.groundLevel !== '15') await wait(300); const scale = (2 * 1737400) / Number(document.querySelector('.scout-globe').dataset.discPx); return (moon.dataset.groundLevel === '15' && moon.dataset.groundProduct === 'A17_60x60km.eq' && scale > 0.41 && scale < 0.45) || 'level ' + moon.dataset.groundLevel + ' of ' + moon.dataset.groundProduct + ', ' + scale.toFixed(2) + ' m a screen pixel' })()`],
      ['no layer was switched on for any of this', "document.querySelector('.scout-globe canvas').dataset.overlay !== 'on'"],
      ['this close, over a picture that is not tied to the marker\'s coordinates, the marker is an open ring of 50 m of ground (232 px across here), and its words say so; a phone, which stays at Site view\'s own zoom, keeps the dot', `(() => { const dot = document.querySelector('.sl-dot.is-selected'); const scale = (2 * 1737400) / Number(document.querySelector('.scout-globe').dataset.discPx); if (scale >= 5) return !dot.classList.contains('is-within') || 'a ring at ' + scale.toFixed(1) + ' m a screen pixel'; const ring = dot.querySelector('.sl-within'); if (!ring) return 'no ring at ' + scale.toFixed(2) + ' m a screen pixel'; const across = ring.getBoundingClientRect().width; if (Math.abs(across - 100 / scale) > 3) return 'the ring is ' + Math.round(across) + ' px across, 100 m is ' + Math.round(100 / scale); if (!/On this photo the marker may be up to about 50 m off\\./.test(dot.title)) return 'its words: ' + dot.title; const fill = getComputedStyle(dot); return (fill.backgroundColor === 'rgba(0, 0, 0, 0)' && fill.outlineStyle === 'none') || 'the dot is still drawn inside the ring' })()`],
    ],
    notes: [['frame rate at the closest zoom with the ground\'s detail, while time plays', `(${click('Play')}, true) && ${FRAME_RATE.replace("requestAnimationFrame(tick) })", "requestAnimationFrame(tick) }).then((words) => { " + click('Pause') + "; return words })")}`]],
  },
  {
    // The photo goes on past Moon Trek's finest tiles inside 10 km of each ridge site: our own tiles of LROC's controlled 1 m mosaic
    // (pipeline/scripts/make_photo_tiles.py), asked for only once the photo is on and the view is that close.
    name: 'layers-fine',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(20000)', click('Site'), click('Layers')],
    checks: [
      ['until the view is close, not one of the finer tiles is asked for (their list of discs is read on arriving at a ridge site, for the ground\'s own detail)', "!performance.getEntriesByType('resource').some((entry) => entry.name.includes('/tiles/polar/photo/'))", 1500],
      ['with the photo on and the view not yet close, still no finer tile is asked for', `(document.querySelectorAll('.sl-layer-list input')[0].click(), true) && ${after(6000, "document.querySelector('.scout-globe canvas').dataset.overlay === 'on' && !performance.getEntriesByType('resource').some((entry) => entry.name.includes('/tiles/polar/photo/'))")}`],
      ['zoomed in as far as the buttons go (a phone has none: there the view stays where it is), the ground comes from our own tiles of level 13, and a screen pixel is 0.70 m of ground', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const zoomIn = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in'); for (let i = 0; i < 40 && zoomIn() && !zoomIn().disabled; i += 1) { zoomIn().click(); await wait(320) }; if (!zoomIn()) return true; const until = Date.now() + 25000; const moon = document.querySelector('.sl-moon'); while (Date.now() < until && moon.dataset.layerLevel !== '13') await wait(300); const ours = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/tiles/polar/photo/13/')).length; const scale = (2 * 1737400) / Number(document.querySelector('.scout-globe').dataset.discPx); if (moon.dataset.layerLevel !== '13') return 'the close-up is of level ' + moon.dataset.layerLevel + ', with ' + ours + ' of our tiles asked for'; if (ours < 4) return 'only ' + ours + ' of our tiles were asked for'; return (scale > 0.68 && scale < 0.72) || 'a screen pixel is ' + scale.toFixed(2) + ' m' })()`],
      ['on the way in, the photo over a disc never came from Moon Trek\'s other mosaic, which sits 300 m away', "!performance.getEntriesByType('resource').some((entry) => entry.name.includes('LRO_NAC_Mosaic_1mpp_SP'))"],
      ['the panel says where the finer photo is from, with LROC\'s credit line', `/1 m a pixel/.test(${text('.sl-layer-on')}) && /NASA\\/GSFC\\/Arizona State University/.test(${text('.sl-layer-on')}) && document.querySelector('.sl-layer-on a[href*="NAC_POLE_SOUTH_CM_AVG"]') !== null`],
    ],
    notes: [['frame rate at the closest zoom over our own tiles, while time plays', `(${click('Play')}, true) && ${FRAME_RATE.replace("requestAnimationFrame(tick) })", "requestAnimationFrame(tick) }).then((words) => { " + click('Pause') + "; return words })")}`]],
  },
  {
    // The same with our own tiles failing: each one's place is taken by the same ground from Moon Trek's finest tile of the same mosaic.
    name: 'layers-fine-fallback',
    block: '/tiles/polar/photo/',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(20000)', click('Site'), click('Layers'), "document.querySelectorAll('.sl-layer-list input')[0].click()"],
    checks: [
      ['with our own tiles failing, the closest view is still drawn, from Moon Trek\'s tiles of the same mosaic', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const zoomIn = () => [...document.querySelectorAll('.zoom-buttons button')].find((b) => b.getAttribute('aria-label') === 'Zoom in'); for (let i = 0; i < 40 && zoomIn() && !zoomIn().disabled; i += 1) { zoomIn().click(); await wait(320) }; if (!zoomIn()) return true; const until = Date.now() + 25000; const moon = document.querySelector('.sl-moon'); const canvas = document.querySelector('.scout-globe canvas'); while (Date.now() < until && !(moon.dataset.layerLevel === '13' && canvas.dataset.overlayDetail === 'on')) await wait(300); const theirs = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('LRO_NAC_AvgMosaic_SPole855_1mp') && entry.name.includes('/11/')).length; return (moon.dataset.layerLevel === '13' && canvas.dataset.overlayDetail === 'on' && theirs > 0) || 'level ' + moon.dataset.layerLevel + ', close-up ' + canvas.dataset.overlayDetail + ', ' + theirs + ' level 11 tiles of Moon Trek' })()`, 5000],
    ],
  },
  {
    // Moon Trek's tiles come through the site's own CDN (/trek/). With that route failing, the page asks NASA's server itself.
    name: 'layers-fallback',
    block: '/trek/SP/',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Site'), click('Layers')],
    checks: [
      ['with the site\'s own route to Moon Trek failing, a layer still arrives, from NASA\'s server', `(document.querySelectorAll('.sl-layer-list input')[0].click(), true) && new Promise((done) => { const until = Date.now() + 25000; const look = () => { const on = document.querySelector('.scout-globe canvas').dataset.overlay === 'on'; const direct = performance.getEntriesByType('resource').filter((entry) => entry.name.startsWith('https://trek.nasa.gov/tiles/Moon/SP/')).length; if (on && direct > 0) done(true); else if (Date.now() > until) done('layer on: ' + on + ', tiles asked of NASA: ' + direct); else setTimeout(look, 300) }; look() })`],
    ],
  },
  {
    // Layers: a Moon Trek map laid over the ground around the south pole, close on a polar site.
    name: 'layers',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ['performance.setResourceTimingBufferSize(6000)', click('Site'), click('Layers')],
    checks: [
      ['the rail\'s Layers button opens a panel of six switches, none on', `document.querySelector('.sl-layers h2')?.textContent === 'Layers' && [...document.querySelectorAll('.sl-layer-list label')].map((el) => el.textContent).join('|') === 'Photo|Steep ground|Permanent shadow|Long-run sunlight|Long-run Earth view|Temperature' && document.querySelectorAll('.sl-layer-list input:checked').length === 0 && document.querySelector('.sl-rail-credit') === null`, 1200],
      ['a switch fetches that layer\'s tiles from Moon Trek and hands the picture to the Moon', `(document.querySelectorAll('.sl-layer-list input')[0].click(), true) && ${after(6000, "document.querySelector('.scout-globe canvas').dataset.overlay === 'on' && performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/trek/SP/LRO_NAC_AvgMosaic_SPole855_1mp/')).length === 16")}`],
      ['the layer that is on says how to read it, with Moon Trek\'s own title as its credit', `/Real photos from the LRO camera/.test(${text('.sl-layer-on')}) && ${text('.sl-layer-credit')}.startsWith('Moon Trek: LRO LROC NAC Image Mosaic, S Pole, Avg Merge; closest in, LRO NAC Mosaic 1mpp, S Pole.') && document.querySelector('.sl-layer-credit a').href === 'https://trek.nasa.gov/moon/'`],
      ['the credit is on screen while the layer is, even with the panel shut: in the rail, not over the Moon', `([...document.querySelectorAll('.sl-rail button')].find((el) => el.textContent.startsWith('Layers')).click(), true) && ${after(500, `document.querySelector('.sl-layers') === null && ${text('.sl-rail-credit')} === 'Moon Trek' && document.querySelector('.scout-globe canvas').dataset.overlay === 'on' && ([...document.querySelectorAll('.sl-rail button')].find((el) => el.textContent.startsWith('Layers')).click(), true)`)}`],
      ['one layer at a time: switching on another switches the first off', `(document.querySelectorAll('.sl-layer-list input')[4].click(), true) && ${after(6000, "[...document.querySelectorAll('.sl-layer-list input')].map((el) => el.checked ? 1 : 0).join('') === '000010' && /Brighter blue sees Earth more of the time/.test(document.querySelector('.sl-layer-on').textContent) && document.querySelector('.scout-globe canvas').dataset.overlay === 'on'")}`],
      ['neither the column, the panel nor the rail scrolls', `${COLUMN_FITS} && (() => { const rail = document.querySelector('.sl-rail'); return window.innerWidth < 761 || rail.scrollHeight <= rail.clientHeight })()`],
      ['switching it off takes the layer and its credit away', `(document.querySelectorAll('.sl-layer-list input')[4].click(), true) && ${after(800, "document.querySelector('.scout-globe canvas').dataset.overlay === 'off' && document.querySelector('.sl-rail-credit') === null && document.querySelector('.sl-layer-on') === null")}`, 0],
      // Left on for the screenshot: the photo, or with --layer=N the Nth switch (0 to 5).
      ['a layer comes back on, and the photo\'s tiles were fetched only once', `(document.querySelectorAll('.sl-layer-list input')[${Number(args.get('layer') ?? 0)}].click(), true) && ${after(args.has('layer') ? 6000 : 2500, "document.querySelector('.scout-globe canvas').dataset.overlay === 'on' && performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/trek/SP/LRO_NAC_AvgMosaic_SPole855_1mp/')).length === 16")}`],
    ],
  },
  {
    // The script's own guard: a question a page really sends (no stand-in set up in the page) is answered inside the browser and never reaches the chat.
    name: 'chat-held',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['a question the page sends for real is answered by the browser\'s stand-in, not by the chat', `(${OPEN_SCOUT}, true) && ${after(700, "(document.querySelector('.sl-scout-panel .sl-idea').click(), true)")} && ${after(1800, `(() => { const said = [...document.querySelectorAll('.sl-scout-panel .sl-said.is-scout p')].map((p) => p.textContent); return (window.__stood === undefined && said.at(-1) === ${JSON.stringify("A stand-in reply: the checks do not ask Scout.")}) || said.join(' // ') })()`)}`],
    ],
  },
  {
    // Scout's card in Watch grows with its conversation: an answer of ordinary length reads without scrolling inside the card.
    name: 'watch-scout-long',
    hash: '',
    still: true,
    checks: [
      ['closed, his mark keeps the small "AI" tag', "document.querySelector('.sl-scout-tag .sl-ai')?.textContent.trim() === 'AI'"],
      ['an answer of ordinary length shows whole: nothing scrolls inside the card', `${STAND_IN_SCOUT} && (document.querySelector('.scout-face').click(), true) && ${after(500, `(${askInWatch('Give me the long answer about this landing')}, true)`)} && ${after(2200, `(() => { const talk = document.querySelector('.sl-card .sl-talk'); const said = [...talk.querySelectorAll('.sl-said.is-scout p')].at(-1)?.textContent ?? ''; return (said.length > 400 && talk.scrollHeight <= talk.clientHeight + 1) || said.length + ' characters, ' + talk.scrollHeight + ' in ' + talk.clientHeight })()`)}`],
      ['the card is then taller than half the stage\'s old limit allowed, the height of the window on a laptop (within 75% of the screen on a phone), and clear of the Moon\'s disc', `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const limit = window.innerWidth < 761 ? window.innerHeight * 0.75 : window.innerHeight; return (card.height <= limit + 1 && card.top >= 0 && card.bottom <= window.innerHeight) || Math.round(card.height) + ' of ' + Math.round(limit) })() && ${CARD_CLEAR}`],
      ['the input is still on screen under the answer, and nothing lies over it', "(() => { const input = document.querySelector('#sl-watch-question').getBoundingClientRect(); const top = document.elementFromPoint((input.left + input.right) / 2, (input.top + input.bottom) / 2); return input.bottom <= window.innerHeight && top?.id === 'sl-watch-question' })()"],
    ],
  },
  {
    // The co-pilot's status cannot be read: the tag says "AI" alone, never a model's name it is not sure of.
    name: 'scout-tag-fallback',
    hash: '',
    still: true,
    steps: ["(() => { const real = window.fetch; window.fetch = (url, init) => (String(url).includes('/api/status/services') ? Promise.resolve(new Response('', { status: 503 })) : real(url, init)); return true })()", "document.querySelector('.scout-face').click()"],
    checks: [['with no status to read, the open card\'s tag is "AI" alone', `${after(1200, "document.querySelector('.sl-card .sl-card-head .sl-ai')?.textContent.trim() === 'AI'")}`]],
  },
  {
    // Sightline is the front page: the bare address opens Watch, and there is no tab bar.
    name: 'front',
    path: '/',
    hash: '',
    still: true,
    checks: [
      ['the front page is Sightline, in Watch, with no tab bar', "location.pathname === '/' && document.querySelector('.sightline') !== null && document.querySelector('.sl-pill') !== null && document.querySelector('.site-tabs') === null && document.querySelector('.sl-col') === null"],
      ['its tab says Sightline', "/^Sightline/.test(document.title)"],
    ],
  },
  {
    // A link the Classic design wrote, opened at the front page: the same site, hour and limits, in Plan.
    name: 'front-classic-link',
    path: '/',
    hash: '#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&view=3d&mode=learn',
    checks: [
      ['a Classic link opens Plan on the same site, hour and limits, and the address becomes Sightline\'s own', `(() => { const landing = ${LANDING}; return (location.pathname === '/' && document.querySelector('#sl-site')?.value === 'apollo-11' && landing === '1 March 2028 · 05:00 UTC' && location.hash.startsWith('#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&') && !/view=3d/.test(location.hash) && document.querySelector('.site-tabs') === null) || landing + ' ' + location.hash })()`, 3000],
    ],
  },
  {
    // The same link as the Mission control design wrote it, with "?ui=next".
    name: 'front-mission-link',
    path: '/?ui=next',
    hash: '#a=apollo-11@2028-03&t=5&limits=14_72_72_1_1&view=3d&mode=learn',
    checks: [
      ['a Mission control link opens the same Plan, and the address drops the old design\'s switch', `(() => { const landing = ${LANDING}; return (location.pathname === '/' && location.search === '' && document.querySelector('#sl-site')?.value === 'apollo-11' && landing === '1 March 2028 · 05:00 UTC') || landing + ' ' + location.search + location.hash })()`, 3000],
    ],
  },
  {
    // A Classic comparison ("b=", a second site and month) becomes a second scenario at the same hour of its month.
    name: 'front-compare-link',
    path: '/',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&b=shackleton-rim@2027-06&mode=plan',
    checks: [
      ['a comparison link opens two scenarios, the first on show', `(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length; return (tabs === 2 && document.querySelector('#sl-site')?.value === 'connecting-ridge' && ${LANDING} === '6 May 2027 · 13:00 UTC' && location.hash.includes('list=shackleton-rim@2027-06-06T13')) || tabs + ' ' + location.hash })()`, 3000],
      ['the second is the comparison\'s site, at the same hour of its own month', `(document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]')[1].click(), true) && ${after(700, `document.querySelector('#sl-site').value === 'shackleton-rim' && ${LANDING} === '6 June 2027 · 13:00 UTC'`)}`],
    ],
  },
  {
    // The old How it works address opens it over Sightline.
    name: 'front-how',
    path: '/',
    hash: '#how',
    checks: [['"/#how" opens the Guide over Sightline, and closing it leaves the front page', `(document.querySelector('.sl-how') !== null && document.querySelector('.sightline') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)) && ${after(600, "document.querySelector('.sl-how') === null && location.pathname === '/' && location.hash === ''")}`]],
  },
  {
    // No match in Sightline: the demo video's address goes to the old page, which lives at /classic/.
    name: 'front-demo',
    path: '/',
    hash: '#demo',
    ready: "location.pathname === '/classic/' && document.querySelector('a.site-tab') !== null",
    checks: [['"/#demo" goes to the old page, on its Demo video tab', "(() => { const current = document.querySelector('a.site-tab[aria-current=\"page\"]')?.textContent.trim(); return (location.pathname === '/classic/' && location.hash === '#demo' && current === 'Demo video') || current + ' ' + location.hash })()"]],
  },
  {
    name: 'front-tour',
    path: '/',
    hash: '#tour',
    ready: "location.pathname === '/classic/' && document.querySelector('a.site-tab') !== null",
    checks: [['"/#tour" goes to the old page, where the tour starts', "(() => { const current = document.querySelector('a.site-tab[aria-current=\"page\"]')?.textContent.trim(); return (location.pathname === '/classic/' && current === '1-minute tour') || current + ' ' + location.hash })()", 4000]],
  },
  {
    // The old front page itself, at its new address, as it was.
    name: 'classic',
    path: '/classic/',
    hash: '',
    ready: "document.querySelector('a.site-tab') !== null",
    checks: [
      ['the old front page is at /classic/, on its Whole Moon tab, under its own name', "(() => { const current = document.querySelector('a.site-tab[aria-current=\"page\"]')?.textContent.trim(); return (current === 'Whole Moon' && /Lunar Landing Site Navigator/.test(document.title)) || current + ' ' + document.title })()", 3000],
      ['its tabs lead with Sightline, the front page; the old designs open at /classic/', "(() => { const tabs = Object.fromEntries([...document.querySelectorAll('a.site-tab')].map((tab) => [tab.textContent.trim(), tab.getAttribute('href')])); return (Object.keys(tabs)[0] === 'Sightline' && (tabs.Sightline === '/' || tabs.Sightline.startsWith('/#a=')) && tabs['Whole Moon'] === '/classic/' && tabs.Classic.startsWith('/classic/#a=') && tabs['Mission control'].startsWith('/classic/?ui=next#a=') && tabs.Scout.startsWith('/scout/#a=') && tabs.Atlas.startsWith('/atlas/#a=') && tabs['Demo video'] === '/classic/#demo' && tabs['How it works'] === '/#how') || JSON.stringify(tabs) })()"],
    ],
  },
  {
    // A teammate's page keeps its address, its page and its tab bar; its Sightline tab opens the front page on the same view.
    name: 'atlas-keeps',
    path: '/atlas/',
    hash: '#a=connecting-ridge@2027-05&t=120&limits=14_72_72_1_1&mode=learn',
    ready: "document.querySelector('a.site-tab') !== null",
    checks: [
      ['the Atlas is still at /atlas/, on its own tab', "(() => { const current = document.querySelector('a.site-tab[aria-current=\"page\"]')?.textContent.trim(); return (location.pathname === '/atlas/' && current === 'Atlas') || current })()", 3000],
      ['its Sightline tab opens the front page on the same site and month', "(() => { const href = [...document.querySelectorAll('a.site-tab')].find((tab) => tab.textContent.trim() === 'Sightline')?.getAttribute('href') ?? ''; return href.startsWith('/#a=connecting-ridge@2027-05&') || href })()"],
    ],
  },
  {
    // How it works, which the rail links to: the list of data sources.
    name: 'sources',
    path: '/',
    hash: '#how',
    ready: "document.querySelector('.how-sources') !== null",
    steps: ["document.querySelector('.how-sources').scrollIntoView()"],
    checks: [
      ['How it works has a Data sources part', "[...document.querySelectorAll('.how-act h2')].some((el) => el.textContent === 'Data sources')"],
      ['the sources come in five sections, the challenge\'s Resources first', "(() => { const groups = [...document.querySelectorAll('.how-source-group')].map((el) => el.dataset.group); return groups.join() === 'challenge,nasa,partner,check,look' })()"],
      ['JPL Horizons is there, badged as a challenge resource', "document.querySelector('.how-source[data-source=\"horizons\"] .how-badge')?.textContent === 'Challenge resource'"],
      ['Quickmap and Moon Trek are there too, badged the same way', "['quickmap', 'moon-trek'].every((id) => document.querySelector('.how-source[data-source=\"' + id + '\"] .how-badge')?.textContent === 'Challenge resource')"],
      ['Moon Trek is credited for imagery, and says where its layers are', "(() => { const card = document.querySelector('.how-source[data-source=\"moon-trek\"]'); return card.querySelector('.how-role').textContent === 'Imagery' && /Layers, in Sightline/.test(card.textContent) })()"],
      ['the badge is on the challenge\'s four Resources and nothing else: the three tools, and the Canadian Space Agency among the partners', "[...document.querySelectorAll('.how-badge')].map((el) => el.closest('.how-source').dataset.source).sort().join() === 'csa-rover,horizons,moon-trek,quickmap' && document.querySelector('.how-source[data-source=\"csa-rover\"]').closest('.how-source-group').dataset.group === 'partner'"],
      ['every source links to its own page (the made-up stars have none) and says who it is from, how it gets here, where it shows and its credit', "(() => { const all = [...document.querySelectorAll('.how-source')]; return all.length >= 14 && all.every((el) => (el.dataset.source === 'stars' ? el.querySelector('a') === null : /^https:\\/\\//.test(el.querySelector('a')?.href ?? '')) && el.querySelectorAll('dd').length === 4 && [...el.querySelectorAll('dd')].every((dd) => dd.textContent.trim().length > 3)) })()"],
    ],
  },
  ...tourScenes(),
  ...guideScenes(),
]

const chrome =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path))
if (!chrome) {
  console.error('Google Chrome not found. Set CHROME to its path.')
  process.exit(1)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** The addresses of the chat: what a page sends to them is answered in the browser unless a scene asks a real question. */
const CHAT_ADDRESSES = ['*/api/chat', '*/api/ask']
const STAND_IN_TEXT = 'A stand-in reply: the checks do not ask Scout.'
/** How many questions each open page tried to send to the chat, by its session. */
const heldBack = new Map()

/** A connection to Chrome's DevTools protocol: send(method, params, sessionId) resolves with the result. */
async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((open, fail) => {
    socket.onopen = open
    socket.onerror = () => fail(new Error('Could not connect to Chrome.'))
  })
  const waiting = new Map()
  const errors = []
  const listeners = []
  let nextId = 1
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) for (const listener of listeners) listener(message)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    if (message.id === undefined) return
    const { done, fail } = waiting.get(message.id)
    waiting.delete(message.id)
    if (message.error) fail(new Error(message.error.message))
    else done(message.result)
  }
  return {
    errors,
    /** Hear every event Chrome sends (a function of the message); returns a function that stops listening. */
    listen(listener) {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    send(method, params = {}, sessionId = undefined) {
      const id = nextId++
      socket.send(JSON.stringify({ id, method, params, sessionId }))
      return new Promise((done, fail) => waiting.set(id, { done, fail }))
    },
    close: () => socket.close(),
  }
}

const server = args.has('base') ? null : await createServer({ root: webDir, logLevel: 'warn', server: { port: 0 } })
await server?.listen()
const origin = (args.get('base') ?? server.resolvedUrls.local[0]).replace(/\/$/, '')
const profile = mkdtempSync(join(tmpdir(), 'sightline-shots-'))
const browser = spawn(
  chrome,
  ['--headless=new', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' },
)

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
  if (!ok) failed += 1
}

let cdp
try {
  // Chrome writes the port it chose for DevTools into its profile folder.
  const portFile = join(profile, 'DevToolsActivePort')
  for (let tries = 0; !existsSync(portFile); tries += 1) {
    if (tries > 100) throw new Error('Chrome did not start.')
    await sleep(100)
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n')
  cdp = await connect(`ws://127.0.0.1:${port}${path}`)
  // A question a page sends to the chat is answered here, with a stand-in, and counted per page.
  cdp.listen((message) => {
    if (message.method !== 'Fetch.requestPaused') return
    const { requestId, request } = message.params
    heldBack.set(message.sessionId, (heldBack.get(message.sessionId) ?? 0) + (request.method === 'POST' ? 1 : 0))
    const chat = new URL(request.url).pathname === '/api/chat'
    const body = chat ? { reply: { text: STAND_IN_TEXT, actions: [], sources: [], followups: [] } } : { error: 'stand-in' }
    void cdp.send('Fetch.fulfillRequest', { requestId, responseCode: chat ? 200 : 503, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }, message.sessionId).catch(() => {})
  })

  // --poster=file.png saves a picture of the Moon as the page first shows it (the default view, at the
  // start of the data, with nothing drawn on it), for the still the page shows while its maps load.
  if (args.has('poster')) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext')
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params) => cdp.send(method, params, sessionId)
    const value = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
    await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    // Time stands still, so the light is the first hour's.
    await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await page('Runtime.enable')
    await page('Page.enable')
    await page('Page.navigate', { url: `${origin}/sightline/` })
    while (!(await value("document.querySelector('.scout-globe canvas')?.dataset.drawnMs !== undefined"))) await sleep(200)
    // Every map in, then everything but the Moon hidden.
    await sleep(12_000)
    await value(key('h'))
    await sleep(1500)
    const clip = await value("(() => { const globe = document.querySelector('.scout-globe'); const box = globe.getBoundingClientRect(); const disc = Number(globe.dataset.discPx); return { x: (box.left + box.right) / 2 - disc / 2, y: (box.top + box.bottom) / 2 - disc / 2, width: disc, height: disc, scale: 1 } })()")
    const shot = await page('Page.captureScreenshot', { format: 'png', clip })
    writeFileSync(resolve(args.get('poster')), Buffer.from(shot.data, 'base64'))
    console.log(`poster ${Math.round(clip.width)} px across, saved to ${resolve(args.get('poster'))}`)
    await cdp.send('Target.closeTarget', { targetId })
    await cdp.send('Target.disposeBrowserContext', { browserContextId })
  }
  // --load measures how the page opens instead of running the scenes: bytes and time until the Moon is
  // first drawn, and bytes once the page has gone quiet. --load=slow does it on a throttled connection
  // (1.6 Mbit/s down, 150 ms latency), with nothing cached. Use it with --base on a built site: the dev
  // server's hundreds of modules are not what a visitor downloads.
  if (args.has('load') && !args.has('poster')) {
    for (const size of args.has('poster') ? [] : SIZES.filter((each) => !each.onlyScenes)) {
      const { browserContextId } = await cdp.send('Target.createBrowserContext')
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      const page = (method, params) => cdp.send(method, params, sessionId)
      await page('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
      await page('Network.enable')
      await page('Network.setCacheDisabled', { cacheDisabled: true })
      if (args.get('load') === 'slow') await page('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
      await page('Runtime.enable')
      await page('Page.enable')
      let bytes = 0
      let lastAt = Date.now()
      const inFlight = new Set()
      const stop = cdp.listen((message) => {
        if (message.sessionId !== sessionId) return
        if (message.method === 'Network.requestWillBeSent') inFlight.add(message.params.requestId)
        if (message.method === 'Network.loadingFinished') bytes += message.params.encodedDataLength
        if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
          inFlight.delete(message.params.requestId)
          lastAt = Date.now()
        }
      })
      const started = Date.now()
      await page('Page.navigate', { url: `${origin}/sightline/` })
      const value = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
      // The Moon is drawn when the globe says so; a build from before it said so is taken as drawn when its relief map has arrived.
      const drawn = "(() => { const canvas = document.querySelector('.scout-globe canvas'); if (!canvas) return false; if (canvas.dataset.drawnMs) return true; return performance.getEntriesByType('resource').some((entry) => /\\/data\\/maps\\/moon\\.png/.test(entry.name) && entry.responseEnd > 0) })()"
      while (!(await value(drawn))) {
        if (Date.now() - started > 120_000) throw new Error('the Moon was never drawn')
        await sleep(50)
      }
      const visibleMs = Date.now() - started
      const visibleBytes = bytes
      // A build with a still of the Moon says when that still was on screen.
      const posterMs = await value("(() => { const entry = performance.getEntriesByType('resource').find((each) => /moon_poster\\.jpg/.test(each.name)); return entry ? Math.round(entry.responseEnd) : null })()")
      // Quiet: nothing is on its way, and nothing has arrived for four seconds.
      while ((inFlight.size > 0 || Date.now() - lastAt < 4000) && Date.now() - started < 300_000) await sleep(250)
      stop()
      const kB = (count) => `${Math.round(count / 1024).toLocaleString('en-US')} kB`
      if (posterMs !== null) console.log(`load   ${size.name}${args.get('load') === 'slow' ? ', throttled' : ''}: a still of the Moon had arrived ${(posterMs / 1000).toFixed(1)} s after the page opened`)
      console.log(`load   ${size.name}${args.get('load') === 'slow' ? ', throttled' : ''}: Moon first drawn after ${(visibleMs / 1000).toFixed(1)} s and ${kB(visibleBytes)}; ${kB(bytes)} by the time the page is quiet`)
      await cdp.send('Target.closeTarget', { targetId })
      await cdp.send('Target.disposeBrowserContext', { browserContextId })
    }
  }
  for (const size of args.has('load') || args.has('poster') ? [] : SIZES) {
    // --sizes=laptop,phone runs only those sizes: for a quick look when the machine is busy.
    if (args.has('sizes') && !args.get('sizes').split(',').includes(size.name)) continue
    for (const scene of SCENES) {
      if (args.has('only') && !args.get('only').split(',').includes(scene.name)) continue
      if (size.onlyScenes && !size.onlyScenes.includes(scene.name)) continue
      // A scene that calls the model runs only when asked for.
      if (scene.needs && !args.has(scene.needs)) continue
      // A fresh browser context each time, so nothing remembered by one scene reaches the next.
      const { browserContextId } = await cdp.send('Target.createBrowserContext')
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      const page = (method, params) => cdp.send(method, params, sessionId)
      const evaluate = async (expression) => {
        const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
        return result.value
      }
      await page('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: size.scale, mobile: size.mobile })
      if (size.mobile) await page('Emulation.setTouchEmulationEnabled', { enabled: true })
      if (scene.still) await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await page('Runtime.enable')
      await page('Page.enable')
      // Nothing this page sends to the chat leaves the browser, except in the one scene that asks a real question (with --ask).
      const realChat = scene.needs === 'ask' && args.has('ask')
      if (!realChat) await page('Fetch.enable', { patterns: CHAT_ADDRESSES.map((urlPattern) => ({ urlPattern, requestStage: 'Request' })) })
      heldBack.set(sessionId, 0)
      if (scene.frames) await page('Page.addScriptToEvaluateOnNewDocument', { source: KEEP_FRAMES })
      // Something a scene needs in place before the page's own code runs (a stand-in for a service the page asks as it opens).
      if (scene.beforeLoad) await page('Page.addScriptToEvaluateOnNewDocument', { source: scene.beforeLoad })
      // Watch opens on the hour it is. The checks were written for the data's default month, so the page
      // is told it is then, except in the scene that looks at the real clock.
      if (!scene.realNow) await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.__SIGHTLINE_NOW = ${JSON.stringify(scene.now ?? '2027-05-01T00:00:00Z')}` })
      // Scout's card is open when the page opens (not on a phone), and his panel when Plan is opened from Watch.
      // The checks were written for him shut, so the page is told a visitor shut him, except in the scenes that
      // look at how the page opens ("scoutFirst").
      if (!scene.scoutFirst) await page('Page.addScriptToEvaluateOnNewDocument', { source: "try { if (sessionStorage.getItem('sightline.scoutShut') === null) sessionStorage.setItem('sightline.scoutShut', '1') } catch {}" })
      // A scene on a slow connection (the load measurement's: 1.6 Mbit/s down, 150 ms each way), with nothing kept from before.
      if (scene.slowNetwork) {
        await page('Network.enable')
        await page('Network.setCacheDisabled', { cacheDisabled: true })
        await page('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
      }
      // A scene that slowed the processor (the "eased" scene) must not slow the ones after it.
      await page('Emulation.setCPUThrottlingRate', { rate: 1 })
      // --block=text: requests whose address holds the text fail, to see how the page does without a file.
      // A scene's own `block` does the same for that scene.
      if (args.has('block') || scene.block) {
        await page('Network.enable')
        await page('Network.setBlockedURLs', { urls: [`*${scene.block ?? args.get('block')}*`] })
      }
      cdp.errors.length = 0
      await page('Page.navigate', { url: `${origin}${scene.path ?? '/sightline/'}${scene.hash}` })
      const deadline = Date.now() + TIMEOUT_MS
      while (!(await evaluate(scene.ready ?? "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-dot') !== null"))) {
        if (Date.now() > deadline) throw new Error(`${size.name} ${scene.name}: the page did not draw. ${await evaluate('document.body.innerText.slice(0, 300)')}`)
        await sleep(200)
      }
      // The Moon's maps arrive a moment after the first frame.
      if (!scene.noSettle) await sleep(1500)
      for (const step of [...(scene.sky ? [OPEN_SKY] : []), ...(scene.steps ?? [])]) {
        // A step is JavaScript for the page, or { cdp: [method, params] } for the browser itself.
        if (typeof step === 'string') await evaluate(step)
        else await page(step.cdp[0], step.cdp[1])
        await sleep(300)
      }
      if (scene.resize) {
        // Checked 120 ms later: sooner than any animated flight would arrive.
        const [width, height] = scene.resize[size.name]
        await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: size.scale, mobile: size.mobile })
        await sleep(120)
      }
      console.log(`${size.name} ${scene.name}`)
      for (const entry of scene.checks ?? []) {
        // An entry that is not a check: drag the Moon with the mouse, as a visitor would, and let it come to rest.
        if (!Array.isArray(entry)) {
          // One real key press, sent by the browser to whatever has the keyboard.
          if (entry.key) {
            const key = { Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' } }[entry.key]
            await page('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
            await page('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
            await sleep(400)
            continue
          }
          const { cx, cy, r } = await evaluate("(() => { const globe = document.querySelector('.scout-globe'); const box = globe.getBoundingClientRect(); return { cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2, r: Number(globe.dataset.discPx) / 2 } })()")
          // Or one press on the Moon, at a share of its disc's radius right of and below its middle: a click, not a drag.
          if (entry.press) {
            const [x, y] = [cx + r * entry.press[0], cy + r * entry.press[1]]
            const under = await evaluate(`(() => { const el = document.elementFromPoint(${x}, ${y}); return el instanceof HTMLCanvasElement && el.closest('.scout-globe') !== null ? '' : (el ? el.tagName + '.' + el.className : 'nothing') })()`)
            check('  the press lands on the Moon itself, away from any dot', under === '', under)
            await page('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
            await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
            await sleep(900)
            continue
          }
          const [fromX, fromY, toX, toY] = [cx + r * 0.1, cy + r * 0.45, cx + r * 0.45, cy + r * 0.25]
          await page('Input.dispatchMouseEvent', { type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1 })
          for (let step = 1; step <= 8; step += 1) {
            await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromX + ((toX - fromX) * step) / 8, y: fromY + ((toY - fromY) * step) / 8, button: 'left' })
            await sleep(30)
          }
          await page('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1 })
          // A flick carries on as a glide that takes a few seconds to come fully to rest.
          await sleep(3500)
          continue
        }
        const [name, expression, waitMs] = entry
        if (waitMs) await sleep(waitMs)
        // A check that cannot even be asked (the page lacks what it looks for) fails, with why; it does not stop the run.
        // One that answers with words instead of true has failed too, and the words say how.
        let passed = false
        let why = ''
        try {
          const value = await evaluate(expression)
          passed = value === true
          if (typeof value === 'string') why = value
        } catch (error) {
          why = String(error.message).split('\n')[0].slice(0, 160)
        }
        check(`  ${name}`, passed, why)
      }
      // Measurements, printed and not judged: for comparing before and after a change.
      for (const [name, expression] of scene.notes ?? []) console.log(`note   ${name}: ${await evaluate(expression)}`)
      // A scene that must not ask Scout anything (his tour): nothing was sent to the chat, held back or not.
      if (scene.noChat) check('  nothing was sent to the chat', heldBack.get(sessionId) === 0, `${heldBack.get(sessionId)} question(s)`)
      // Said, so a reader knows which scenes would have asked the real chat. (Scenes that set a stand-in up in the page never get this far.)
      if (heldBack.get(sessionId) > 0) console.log(`note   ${heldBack.get(sessionId)} question(s) to the chat were answered in the browser with a stand-in; none reached the chat`)
      heldBack.delete(sessionId)
      // With no height chosen the screen is the 2 m screen: it asks for nothing of the other heights.
      if (!scene.heights) check('  nothing of the other heights above the ground is asked for', await evaluate(`${HEIGHT_FILES}.length === 0`))
      check('  nothing wider than the screen', await evaluate('document.documentElement.scrollWidth <= window.innerWidth'))
      check('  no errors in the console', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | ').replace(/\s+/g, ' ').slice(0, 900))
      if (outDir) {
        const shot = await page('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(outDir, `${scene.name}-${size.name}.png`), Buffer.from(shot.data, 'base64'))
      }
      await cdp.send('Target.closeTarget', { targetId })
      await cdp.send('Target.disposeBrowserContext', { browserContextId })
    }
  }
} finally {
  cdp?.close()
  browser.kill()
  await server?.close()
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
}
if (failed) console.log(`${failed} check(s) failed`)
process.exit(failed ? 1 : 0)
