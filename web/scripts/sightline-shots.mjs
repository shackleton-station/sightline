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
const SIZES = [
  { name: 'laptop', width: 1440, height: 900, scale: 1, mobile: false },
  { name: 'phone', width: 390, height: 844, scale: 2, mobile: true },
  // A smaller laptop, for the scenes that ask whether the side panels fit without scrolling.
  { name: 'small-laptop', width: 1366, height: 768, scale: 1, mobile: false, onlyScenes: ['skyline-fold', 'skyline-four', 'compass-below', 'compass-below-watch', 'tour-video', 'hype-egg', 'other-site', 'tour', 'tour-restore', 'watch-scout-long', 'heights', 'heights-link', 'planner-moon', 'planner-find', 'planner-compare', 'rows-panels', 'plan-link', 'mission', 'compare-four', 'steady', 'horizons', 'layers', 'rover', 'site-light', 'layouts', 'scout-panel', 'marginal', 'planner', 'planner-four', 'near-side', 'brief', 'why', 'earth-partly'] },
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
/** Scout's panel answers from a stand-in in these checks, so no model is called: what the page sent is kept in window.__sent. */
/** An answer of an ordinary length, about what Scout writes for a question with one or two lookups (470 characters). */
const LONG_REPLY = 'Connecting Ridge has the Sun for 82% of May 2027, and Earth in view for 58% of it. The longest stretch without the Sun is 118 hours, from 1 May, which is longer than your mission can last without power: your limit is 24 hours. Landing on 6 May at 13:00 puts the Sun and Earth both in view at touchdown, but the dark stretch that follows is the problem. The first landing that fits your limits is 21 June at 17:00, when the Sun stays up for the whole mission.'
/** The tag in an open card's or panel's header: "AI · " and the model the co-pilot's status names, or "AI" alone if the status cannot be read. */
const MODEL_TAG = (selector) => `(async () => { const tag = document.querySelector(${JSON.stringify(selector)}); const status = await fetch('/api/status/services').then((r) => (r.ok ? r.json() : null)).catch(() => null); const id = status?.services?.copilot?.status?.modelSettings?.model ?? null; const match = id ? /^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?/.exec(id) : null; const name = match ? 'Claude ' + match[1][0].toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '') : null; const says = tag?.textContent.trim(); const want = name ? 'AI · ' + name : 'AI'; if (says !== want) throw new Error('status says ' + id + '; the tag says: ' + says); const box = tag.getBoundingClientRect(); return /AI-generated/.test(tag.getAttribute('title') ?? tag.dataset.tip ?? '') && box.height < 24 && box.right <= tag.closest('header').getBoundingClientRect().right })()`
const STAND_IN_SCOUT = `(() => { if (window.__stood) return true; window.__stood = true; window.__sent = []; const real = window.fetch; window.fetch = async (url, init) => { if (String(url).includes('/api/chat')) { window.__sent.push(JSON.parse(init.body)); const asked = JSON.parse(init.body).messages.at(-1).text; if (/fail/i.test(asked) || window.__failNext) return new Response(JSON.stringify({ error: 'unavailable' }), { status: 503, headers: { 'content-type': 'application/json' } }); const actions = /where/i.test(asked) ? [{ label: 'Shackleton Rim, 1 June 2027, 22:00', hash: '#a=shackleton-rim@2027-06&t=22&limits=14_24_99999_1_1&mode=plan' }] : []; const text = /long/i.test(asked) ? ${JSON.stringify(LONG_REPLY)} : 'A stand-in reply, number ' + window.__sent.length + '.'; return new Response(JSON.stringify({ reply: { text, actions, sources: [], followups: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }) } return real(url, init) }; return true })()`
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
/** True on a laptop when the skyline's header and the river's header are each one row, with "Fold" at the row's right end. Says which is not. */
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
    if (Math.max(...middles) - Math.min(...middles) > 4 || box.height > 40) throw new Error('the ' + name + ' header is ' + Math.round(box.height) + ' px high at ' + Math.round(box.width) + ' px wide: more than one row')
    if (head.scrollWidth > head.clientWidth + 1 || parts.some((el) => el.getBoundingClientRect().right > box.right + 1)) throw new Error('the ' + name + ' header spills past its right edge at ' + Math.round(box.width) + ' px wide')
    if (fold !== parts.at(-1) || box.right - fold.getBoundingClientRect().right > 2) throw new Error('"Fold" is not at the right end of the ' + name + ' header')
    for (let i = 1; i < parts.length; i += 1) if (parts[i].getBoundingClientRect().left < parts[i - 1].getBoundingClientRect().right - 1) throw new Error('parts of the ' + name + ' header overlap at ' + Math.round(box.width) + ' px wide: ' + parts[i - 1].className + ' and ' + parts[i].className)
  }
  return true
})()`
/** True when nothing the page says (its text, tooltips, labels and placeholders) uses a word that is kept out: the old words for time, or "ridge" for the terrain's outline as seen from the site. */
const OWN_WORDS = "!/lunar night|lunar day|playhead|scrub|above the ridge|below the ridge|clear the ridge|the ridge hides|the ridge cuts/i.test(document.body.innerText + [...document.querySelectorAll('[title], [aria-label], [placeholder]')].map((el) => (el.title || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')).join(' '))"
/** True when Scout's area shows three questions to tap and the one thing to try (on a short laptop screen, three ideas in all), each a button, each whole inside the area. */
const IDEAS_WHOLE = `(() => { const area = document.querySelector('.sl-ask-says').getBoundingClientRect(); const short = window.innerWidth >= 761 && window.innerHeight < 820; const ideas = [...document.querySelectorAll('.sl-ask-says .sl-idea')].filter((idea) => idea.getClientRects().length > 0); const questions = ideas.filter((idea) => !idea.classList.contains('is-action')).length; return (questions === 3 || (short && ideas.length === 3 && questions === 2)) && ideas.every((idea) => idea.tagName === 'BUTTON' && idea.getBoundingClientRect().top >= area.top - 0.5 && idea.getBoundingClientRect().bottom <= area.bottom + 0.5) })()`
/** In Plan a strip this high is kept clear under the Moon, for the note that says the Moon is not showing the landing: the Moon is fitted to the room above it. */
const STRIP = `(document.querySelector('.sightline.is-plan') ? 30 : 0)`
/** The note on the stage that says the Moon is not showing the landing: its words, its two links, and that it lies inside the stage and clear of the Moon's disc at Orbit. Throws with what it found when not. */
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
  if (words !== 'Showing ${when}, not the landing' || links.join('|') !== 'Back to landing|Land here' || !inside || !clear) throw new Error(words + ' [' + links.join('|') + '] inside ' + inside + ', clear of the disc ' + clear)
  return true
})()`
/** Presses one of the note's two links, by its words. */
const noteLink = (words) => `[...document.querySelectorAll('.sl-off-landing .sl-link')].find((link) => link.textContent.trim() === ${JSON.stringify(words)}).click()`
/** True when the river's legend is on the page once: in the header's row, or in "More" when it does not fit there, never both. Opens "More" to look, and shuts it again. */
const LEGEND_ONCE = `(async () => { const more = document.querySelector('.sl-river .sl-more'); if (more && more.getAttribute('aria-expanded') !== 'true') { more.click(); await new Promise((next) => setTimeout(next, 250)) } const legends = [...document.querySelectorAll('.sl-river .sl-legend')]; const words = (document.querySelector('.sl-river-top').textContent.match(/Neither/g) || []).length; const boxes = document.querySelectorAll('.sl-river-top input[type="checkbox"]').length; const menu = document.querySelector('.sl-menu'); const empty = menu !== null && menu.children.length === 0; if (more && document.querySelector('.sl-menu')) { more.click(); await new Promise((next) => setTimeout(next, 150)) } if (legends.length !== 1 || words !== 1 || boxes > 1 || empty) throw new Error(legends.length + ' legends, "Neither" ' + words + ' times, ' + boxes + ' "A day on Earth" boxes' + (empty ? ', an empty menu' : '')); return true })()`
/** True when Scout's open card is inside the stage and does not lie over the Moon's disc. Says where each is when not. */
const CARD_CLEAR = `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const near = { x: Math.min(Math.max(cx, card.left), card.right), y: Math.min(Math.max(cy, card.top), card.bottom) }; const clear = Math.hypot(near.x - cx, near.y - cy) >= r; const inside = card.left >= stage.left - 0.5 && card.right <= stage.right + 0.5 && card.top >= stage.top && card.bottom <= stage.bottom + 0.5; if (!clear || !inside || r < 60) throw new Error('card ' + Math.round(card.left) + ' to ' + Math.round(card.right) + ' across, ' + Math.round(card.top) + ' to ' + Math.round(card.bottom) + ' down; disc centre ' + Math.round(cx) + ', ' + Math.round(cy) + ', radius ' + Math.round(r)); return true })()`
/** Types into Scout's input in Watch and sends it. */
const askInWatch = (question) => `(() => { const form = document.querySelector('.sl-card .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(question)}); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true })()`
/** How far a row's body is above the skyline, signed as the time bar's readout writes it: "0.6°", "−0.2°". */
const rowAbove = (name) => `(() => { const main = document.querySelector('.sl-fact.is-${name} .sl-fact-main'); const figure = main.firstChild.textContent.trim(); return (main.querySelector('small').textContent.trim() === 'below the skyline' && figure !== '0.0°' ? '−' : '') + figure })()`
/** True when the three rows (the Sun, Earth, the ground) each show a name, a main figure and a small line in full, at one fixed height. Throws with what it found when not. */
const ROWS_WHOLE = `(() => { const rows = [...document.querySelectorAll('.sl-facts > .sl-fact')]; const names = rows.map((row) => row.querySelector('dt').textContent.trim()); const parts = rows.flatMap((row) => [row.querySelector('dt'), row.querySelector('.sl-fact-main'), ...row.querySelectorAll('.sl-fact-small')]); const cut = parts.filter((el) => !el || el.textContent.trim() === '' || el.scrollWidth > el.clientWidth + 1 || el.textContent.trim().endsWith('…') || getComputedStyle(el).textOverflow === 'ellipsis'); const spills = rows.filter((row) => row.scrollHeight > row.clientHeight + 1); const wrapped = rows.flatMap((row) => [...row.querySelectorAll('.sl-fact-small')]).filter((line) => line.getBoundingClientRect().height > 1.6 * parseFloat(getComputedStyle(line).fontSize) * 1.3); const many = rows.filter((row) => row.querySelectorAll('.sl-fact-small').length > 2 || row.querySelectorAll('.sl-fact-small').length < 1); if (names.join('|') !== 'Sun|Earth|Ground' || cut.length > 0 || spills.length > 0 || wrapped.length > 0 || many.length > 0 || /elevation/i.test(document.querySelector('.sl-facts').innerText)) throw new Error('rows ' + names.join('|') + '; cut: ' + cut.map((el) => (el ? el.textContent.trim() : 'missing')).join(' / ') + '; rows that spill: ' + spills.length + '; small lines that wrap: ' + wrapped.map((line) => line.textContent.trim()).join(' / ') + '; rows with no or over two small lines: ' + many.length + '; ' + document.querySelector('.sl-facts').innerText.replace(/\\n/g, ' | ')); return true })()`
/** True when the column is the redesigned one: exactly three plan controls, a verdict, the three rows, no tiles, and nothing that scrolls on a laptop. */
const COLUMN_SHAPE = `(() => { const controls = [...document.querySelectorAll('.sl-plan > .sl-plan-row')]; const kinds = controls.map((row) => (row.querySelector('#sl-site') ? 'site' : row.querySelector('.sl-pick') ? 'landing' : row.querySelector('.sl-mission-open') ? 'mission' : '?')); const boxed = [...document.querySelectorAll('.sl-answer *')].filter((el) => parseFloat(getComputedStyle(el).borderTopWidth) > 0 && parseFloat(getComputedStyle(el).borderLeftWidth) > 0 && el.getClientRects().length > 0); if (kinds.join('|') !== 'site|landing|mission' || controls.some((row) => row.querySelector('svg.sl-plan-icon') === null) || document.querySelector('.sl-col label, .sl-col .sl-label') !== null || document.querySelector('.sl-verdict .sl-verdict-line') === null || document.querySelectorAll('.sl-facts > .sl-fact').length !== 3 || document.querySelector('.sl-numbers') !== null || boxed.length > 0) throw new Error('controls ' + kinds.join('|') + '; boxed in the answer: ' + boxed.map((el) => el.className).join(',')); return ${NOTHING_SCROLLS} && ${COLUMN_FITS} })()`
/** True when nothing on the page has the question-mark cursor. */
const NO_HELP_CURSOR = "[...document.querySelectorAll('*')].every((el) => getComputedStyle(el).cursor !== 'help')"
/** Chooses one of the two extra entries at the foot of the site's own list: '__custom' or '__tools'. */
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
const LABELS_WHOLE = `(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name')]; const cut = rows.filter((row) => row.scrollWidth > row.clientWidth + 1 || row.textContent.includes('…') || [...row.querySelectorAll('span')].some((part) => part.scrollWidth > part.clientWidth + 1)); if (rows.length < 2 || cut.length > 0) throw new Error(rows.map((row) => row.textContent.trim() + ' (' + row.scrollWidth + ' of ' + row.clientWidth + ')').join(' | ')); return true })()`
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
/**
 * A step of the tour is on show as it should be: Scout's bubble holds its title, its words and
 * "i of n"; everything the step is about that is on screen has a ring, inside the window; neither
 * a ring nor the bubble lies over the Moon's disc; and the bubble does not cover what it rings.
 */
const TOUR_STEP = (i) => {
  const step = TOUR.steps[i]
  return `(() => { const bubble = document.querySelector('.sl-tour'); if (!bubble) throw new Error('no bubble'); if (bubble.dataset.step !== ${JSON.stringify(step.id)}) throw new Error('the bubble is on step ' + bubble.dataset.step); const says = bubble.querySelector('.sl-tour-say').textContent.trim(); const title = bubble.querySelector('.sl-tour-title').textContent.trim(); const count = bubble.querySelector('.sl-tour-count').textContent.replace(/\\s+/g, ' ').trim(); const shown = (el) => { if (el.closest('[hidden]')) return false; const b = el.getBoundingClientRect(); const style = getComputedStyle(el); return b.width >= 2 && b.height >= 2 && style.visibility !== 'hidden' && style.display !== 'none' && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth }; const targets = ${JSON.stringify(step.targets)}.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(shown); const rings = [...document.querySelectorAll('.sl-tour-ring')].map((ring) => ring.getBoundingClientRect()); const box = bubble.getBoundingClientRect(); const globe = document.querySelector('.scout-globe'); const g = globe.getBoundingClientRect(); const r = Number(globe.dataset.discPx) / 2; const cx = (g.left + g.right) / 2; const cy = (g.top + g.bottom) / 2; const overDisc = (b) => r > 0 && Math.hypot(Math.min(Math.max(cx, b.left), b.right) - cx, Math.min(Math.max(cy, b.top), b.bottom) - cy) < r - 1; const inWindow = (b, air) => b.left >= -air && b.top >= -air && b.right <= innerWidth + air && b.bottom <= innerHeight + air; const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; const wrong = []; if (says !== ${JSON.stringify(step.say)}) wrong.push('says: ' + says); if (title !== ${JSON.stringify(step.title)}) wrong.push('title: ' + title); if (count !== '${i + 1} of ${TOUR.steps.length}') wrong.push('count: ' + count); if (targets.length === 0) wrong.push('nothing on screen to ring'); if (rings.length !== targets.length) wrong.push(rings.length + ' rings for ' + targets.length + ' things'); if (!rings.every((ring) => inWindow(ring, 6))) wrong.push('a ring leaves the window'); if (rings.some(overDisc)) wrong.push('a ring is over the Moon'); if (!inWindow(box, 0.5)) wrong.push('the bubble leaves the window: ' + Math.round(box.left) + ',' + Math.round(box.top) + ' to ' + Math.round(box.right) + ',' + Math.round(box.bottom)); if (overDisc(box)) wrong.push('the bubble is over the Moon'); if (rings.some((ring) => hits(box, ring))) wrong.push('the bubble covers what it rings'); if (bubble.scrollHeight > bubble.clientHeight + 1) wrong.push('the bubble scrolls'); if (wrong.length) throw new Error(wrong.join('; ')); return true })()`
}
/** Put in the page before the tour's video is asked for: its file answers as a video (true) or is not there (false), whatever the server has. */
const TOUR_VIDEO = (there) => `(() => { const real = window.fetch; window.fetch = (url, init) => (String(url).endsWith(${JSON.stringify(TOUR.video.file)}) ? Promise.resolve(new Response(null, ${there ? "{ status: 200, headers: { 'content-type': 'video/mp4' } }" : '{ status: 404 }'})) : real(url, init)); return true })()`
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
        ['How it works opens with "How to use Sightline": the tour\'s eight steps, word for word, and "Take the tour"', `(() => { window.__before = { hash: location.hash, tabs: document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length, site: document.querySelector('#sl-site').value }; ${click('How it works')}; return true })() && ${after(900, `(() => { const first = document.querySelector('.sl-how .how > section, .sl-how .how > div'); const items = [...document.querySelectorAll('.how-use-steps li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); const want = ${JSON.stringify(TOUR.steps.map((step) => `${step.title}. ${step.say}`))}; return (document.querySelector('#how-use-title').textContent === 'How to use Sightline' && first.classList.contains('how-use') && JSON.stringify(items) === JSON.stringify(want) && document.querySelector('.how-tour-button').textContent.trim() === 'Take the tour' && document.querySelector('.how-video') === null) || items.slice(0, 2).join(' // ') })()`)}`],
        [`"Take the tour" closes the sheet and starts at ${stepName(0)}`, `(document.querySelector('.how-tour-button').click(), true) && ${after(1200, `document.querySelector('.sl-how') === null && document.querySelector('.sl-compare') === null && ${TOUR_STEP(0)}`)}`],
        ['three steps on, the tour is on its own landing, not the visitor\'s', `${TOUR_NEXT} && ${after(700, TOUR_NEXT)} && ${after(1500, TOUR_NEXT)} && ${after(2500, `${TOUR_STEP(3)} && document.querySelector('#sl-site').value === 'connecting-ridge'`)}`],
        ['Escape closes it there and the screen is back as the visitor had it: both scenarios, the second on show, Compare open, the same address', `${TOUR_KEY('Escape')} && ${after(1200, "(() => { const tabs = document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length; const back = document.querySelector('.sl-tour') === null && document.querySelector('.sl-tour-ring') === null && tabs === window.__before.tabs && document.querySelector('#sl-site').value === window.__before.site && location.hash === window.__before.hash && document.querySelector('.sl-compare') !== null; return back || tabs + ' ' + document.querySelector('#sl-site').value + ' ' + location.hash })()")}`],
        ['once the tour has been taken, How it works offers it again', `(${click('How it works')}, true) && ${after(900, "document.querySelector('.how-tour-button')?.textContent.trim() === 'Take the tour again' || document.querySelector('.how-tour-button')?.textContent")} && ${after(1000, `(${click('Back to the Moon')}, true)`)}`],
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
      // The tutorial video exists (its file answers as a video): How it works shows a player, and the tour's last step leads to it.
      name: 'tour-video',
      hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
      noChat: true,
      steps: [TOUR_VIDEO(true)],
      checks: [
        ['with the video in place, How it works shows a player under the steps: the file, its poster and its captions, and nothing is fetched until it is played', `(${click('How it works')}, true) && ${after(1200, `(() => { const video = document.querySelector('.how-use .how-video video'); if (!video) return false; return (video.querySelector('source').getAttribute('src') === ${JSON.stringify(TOUR.video.file)} && video.getAttribute('poster') === ${JSON.stringify(TOUR.video.poster)} && video.querySelector('track').getAttribute('src') === ${JSON.stringify(TOUR.video.captions)} && video.querySelector('track').kind === 'captions' && video.controls && video.preload === 'none' && /AI-generated/.test(document.querySelector('.how-video .how-caption').textContent)) || video.outerHTML.slice(0, 200) })()`)}`],
        ['the tour\'s last step links to the video, which closes the tour and opens How it works at the player', `(document.querySelector('.how-tour-button').click(), true) && ${after(900, `(async () => { for (let i = 0; i < ${n - 1}; i += 1) { document.querySelector('.sl-tour .sl-tour-next').click(); await new Promise((done) => setTimeout(done, 450)) } const link = document.querySelector('.sl-tour .sl-tour-video'); if (link?.textContent.trim() !== 'Watch the video') return 'no link on step ' + document.querySelector('.sl-tour')?.dataset.step; link.click(); await new Promise((done) => setTimeout(done, 900)); const video = document.querySelector('.sl-how .how-video video'); const box = video?.getBoundingClientRect(); return (document.querySelector('.sl-tour') === null && video !== null && box.top >= 0 && box.bottom <= innerHeight + 1) || 'the player is at ' + Math.round(box?.top) + ' to ' + Math.round(box?.bottom) })()`)}`],
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
const SCENES = [
  {
    // Small things that make the screen explain itself: a word in each plan control, what the keys do, what a band is, what each view shows, what the skyline's thin lines are.
    name: 'explains-itself',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['each of the three plan controls says what it is in one tiny word inside it, clear of its value, and the column still fits', `(() => { const rows = [...document.querySelectorAll('.sl-plan > .sl-plan-row')]; const words = rows.map((row) => row.querySelector('.sl-plan-label')?.textContent.trim()).join('|'); if (words !== 'Site|Landing|Mission') return words; for (const row of rows) { const label = row.querySelector('.sl-plan-label').getBoundingClientRect(); const control = row.querySelector('select, .sl-pick, .sl-mission-open').getBoundingClientRect(); if (label.left < control.left || label.right > control.right || label.top < control.top || label.bottom > control.bottom) return 'a label is outside its control'; const value = row.querySelector('.sl-pick .sl-pick-part:last-of-type, .sl-mission-open b'); if (value && value.getBoundingClientRect().right > label.left - 4) return 'a label is on its control\\'s value: ' + row.textContent.trim().slice(0, 40) } const select = document.querySelector('#sl-site'); const name = document.createElement('span'); name.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:' + getComputedStyle(select).font; name.textContent = select.selectedOptions[0].textContent; document.body.append(name); const end = select.getBoundingClientRect().left + parseFloat(getComputedStyle(select).paddingLeft) + name.getBoundingClientRect().width; name.remove(); return end <= rows[0].querySelector('.sl-plan-label').getBoundingClientRect().left - 4 || 'the site\\'s name runs into its label' })() && ${COLUMN_FITS} && ${NOTHING_SCROLLS}`],
      ['the play button\'s hover text says what the keys do: Space, the arrows for an hour, Shift for a day', "(() => { const play = document.querySelector('.sl-river .sl-round'); const words = play.getAttribute('title') ?? play.dataset.tip ?? ''; return (/Space/.test(words) && /arrows move one hour/.test(words) && /Shift, one day/.test(words) && getComputedStyle(play).cursor !== 'help') || words })()"],
      ['and the keys do it: Shift with the right arrow moves a day, the left arrow an hour back', `(document.activeElement?.blur(), window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })), true) && ${after(400, `${text('.sl-now')} === '7 May 2027 · 13:00 UTC' && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })), true)`)} && ${after(800, `${text('.sl-now')} === '7 May 2027 · 12:00 UTC' || ${text('.sl-now')}`)}`],
      ['each of the three views says what it shows in five words or fewer', "(() => { const tips = [...document.querySelectorAll('.sl-heights button')].map((button) => button.getAttribute('title') ?? button.dataset.tip ?? ''); return (tips.length === 3 && tips.every((tip) => tip.length > 0 && tip.split(/\\s+/).length <= 5)) || tips.join(' | ') })()"],
      ['pointing at a band of the time bar says what it is, when it starts and ends and how long it lasts, inside the time bar', `${POINT_AT_BAND(0, 0.5)} && ${after(300, BAND_LINE)}`],
      ['the hours it says are the band\'s own: its length is the time from its start to its end, and the state is the one the bar shows when moved there', `(() => { const words = document.querySelector('.sl-band-tip').textContent.trim(); const parts = /^(.+?) · (\\d+) (\\w+) (\\d\\d):00 to (\\d+) (\\w+) (\\d\\d):00 · (\\d+) h$/.exec(words); const at = (day, month, hour) => Date.parse(day + ' ' + month + ' 2027 ' + hour + ':00 UTC'); const length = (at(parts[5], parts[6], parts[7]) - at(parts[2], parts[3], parts[4])) / 3600000; window.__band = parts[1]; const seek = document.querySelector('.sl-seek'); const box = seek.getBoundingClientRect(); const down = { bubbles: true, pointerType: 'mouse', pointerId: 1, clientX: box.left + box.width * 0.5, clientY: box.top + 4 }; seek.setPointerCapture = () => {}; seek.dispatchEvent(new PointerEvent('pointerdown', down)); seek.dispatchEvent(new PointerEvent('pointerup', down)); return length === Number(parts[8]) || words })() && ${after(500, `(document.querySelector('.sl-river .sl-chip')?.textContent.trim() === window.__band || document.querySelector('.sl-river .sl-chip')?.textContent.trim() + ' is not ' + window.__band) && document.querySelector('.sl-band-tip') === null`)}`],
      ['another band has another line, near an end of the bar it stays inside it, and it goes when the pointer leaves', `${POINT_AT_BAND(0, 0.995)} && ${after(300, `(${BAND_LINE}) === true && (() => { const first = document.querySelector('.sl-band-tip').textContent; ${POINT_AT_BAND(0, 0.003)}; return new Promise((done) => setTimeout(() => { const second = document.querySelector('.sl-band-tip')?.textContent; const fine = ${BAND_LINE}; const seek = document.querySelector('.sl-seek'); seek.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body })); setTimeout(() => done((fine === true && second !== first && document.querySelector('.sl-band-tip') === null) || fine + ' // ' + first + ' // ' + second + ' // still there: ' + (document.querySelector('.sl-band-tip') !== null)), 300) }, 300)) })()`)}`],
      ['with the keyboard on the time bar, the band the bar is in shows the same way', `(document.querySelector('.sl-seek input').focus(), true) && ${after(300, `(${BAND_LINE}) === true && (document.querySelector('.sl-seek input').blur(), true)`)} && ${after(600, "document.querySelector('.sl-band-tip') === null")}`],
      ['the landing\'s control has no drop-down arrow, since it opens a calendar and not a list; the site\'s keeps its own; the calendar still opens on a press and with Enter', `(() => { const pick = document.querySelector('.sl-plan .sl-pick'); if (pick.querySelector('.sl-pick-mark') !== null || /[▾▼⌄]/.test(pick.textContent)) return 'an arrow is still there'; if (getComputedStyle(document.querySelector('#sl-site')).appearance === 'none') return 'the site list lost its arrow'; let opened = 0; HTMLInputElement.prototype.showPicker = function () { opened += 1 }; const date = pick.querySelector('input[type="date"]'); date.click(); date.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); const label = pick.parentElement.querySelector('.sl-plan-label').getBoundingClientRect(); const box = pick.getBoundingClientRect(); return (opened === 2 && label.right <= box.right - 4 && label.left > pick.querySelector('.sl-pick-part:last-of-type').getBoundingClientRect().right + 4) || 'opened ' + opened + ' times; label ' + Math.round(label.left) + ' to ' + Math.round(label.right) + ' in ' + Math.round(box.right) })()`],
    ],
  },
  {
    // The Mission panel's Advanced fold and the Planner's Advanced are one mission: what is set in one shows in the other.
    name: 'mission-advanced',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    heights: true,
    steps: [click('Mission'), "document.querySelector('.sl-advanced-link').click()"],
    checks: [
      ['an antenna height picked in the Mission panel is the mission\'s: the link carries it and the column says it in its small line', `${PICK_HEIGHT('Antenna height', 10)} && ${after(3000, "(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; return (/&ha=10/.test(location.hash) && !/hp=/.test(location.hash) && /antenna at 10 m/.test(line)) || location.hash + ' // ' + line })()")}`, 900],
      ['with a height chosen the open panel still fits with nothing to scroll', "(() => { if (window.innerWidth < 761) return true; const drawer = document.querySelector('.sl-drawer'); const last = drawer.lastElementChild.getBoundingClientRect(); return (drawer.scrollHeight <= drawer.clientHeight && last.bottom <= innerHeight) || 'panel ' + drawer.scrollHeight + ' in ' + drawer.clientHeight })()"],
      ['Earth\'s clearance set there is the mission\'s too', `(() => { const select = document.querySelector('#sl-m-clear'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '5'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(600, "document.querySelector('#sl-m-clear').value === '5'")}`],
      ['the Planner\'s Advanced shows the same two choices', `(${click('Planner')}, true) && ${after(1500, "(() => { const pressed = [...document.querySelector('.sl-full .sl-height-pick[aria-label=\"Antenna height\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); const clear = document.querySelector('.sl-full #sl-m-clear').value; return (pressed === '10 m' && clear === '5') || pressed + ', ' + clear })()")}`],
      ['a panel height picked in the Planner shows in the Mission panel\'s fold, back on the Moon', `${PICK_HEIGHT('Solar panel height', 5)} && ${after(2500, "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)")} && ${after(3500, `(${click('Mission')}, true)`)} && ${after(4200, "(document.querySelector('.sl-advanced-link').click(), true)")} && ${after(5000, "(() => { const pressed = (label) => [...document.querySelector('.sl-drawer .sl-height-pick[aria-label=\"' + label + '\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); return (pressed('Solar panel height') === '5 m' && pressed('Antenna height') === '10 m' && document.querySelector('.sl-drawer #sl-m-clear').value === '5') || pressed('Solar panel height') + ', ' + pressed('Antenna height') })()")}`],
    ],
  },
  {
    // A custom point is worked out at 2 m only: in the Mission panel's fold the two heights are off, with the reason.
    name: 'mission-advanced-custom',
    hash: '#a=-88.5,40@2027-05&t=200&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Mission'), "document.querySelector('.sl-advanced-link').click()"],
    checks: [
      ['with a custom point the fold\'s two heights are off, with the short reason; Earth\'s clearance can still be set', "(() => { const drawer = document.querySelector('.sl-drawer'); const buttons = [...drawer.querySelectorAll('.sl-height-pick button')]; const reason = drawer.querySelector('.sl-height-choice .sl-quiet')?.textContent ?? ''; return (buttons.length === 6 && buttons.every((button) => button.disabled) && reason === 'A custom point is worked out at 2 m only.' && !drawer.querySelector('#sl-m-clear').disabled) || reason + ' ' + buttons.length })()", 1500],
      ['and the panel still fits with nothing to scroll', "(() => { if (window.innerWidth < 761) return true; const drawer = document.querySelector('.sl-drawer'); const last = drawer.lastElementChild.getBoundingClientRect(); return (drawer.scrollHeight <= drawer.clientHeight && last.bottom <= innerHeight) || 'panel ' + drawer.scrollHeight + ' in ' + drawer.clientHeight })()"],
    ],
  },
  {
    // A landing that does not fit here, on a date that does fit at another site of the same group.
    name: 'other-site',
    hash: '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan',
    still: true,
    checks: [
      ['under the next landing that fits, a second line offers the nearest site of the same group where this date fits', `/Does not fit the mission/.test(${text('.sl-verdict-words')}) && /^Next landing that fits: /.test(${text('.sl-next')}.trim()) && (${text('.sl-elsewhere')}.replace(/\\s+/g, ' ').trim() === 'Fits at Peak near Shackleton on this date ›' || ${text('.sl-elsewhere')})`],
      ['its hover text says how far that site is and what a click does; no help cursor', "(() => { const line = document.querySelector('.sl-elsewhere'); return (/^Peak near Shackleton is 42 km away\\. Adds it, on this date, as another scenario$/.test(line.title) && getComputedStyle(line).cursor !== 'help') || line.title })()"],
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
      ['Watch opens on today\'s date and hour (UTC)', "(() => { const now = new Date(); const day = now.getUTCDate() + ' ' + now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + now.getUTCFullYear(); const shown = document.querySelector('.sl-date').textContent; return shown.includes(day) || shown + ' is not ' + day })()"],
      ['the Moon is drawn for that hour, with its sites', "document.querySelector('.scout-globe canvas') !== null && document.querySelectorAll('.sl-dot').length >= 3"],
      ['Plan opened from there lands at this hour', `(${click('Plan a landing')}, true) && ${after(900, "(() => { const now = new Date(); const when = now.getUTCDate() + ' ' + now.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' }) + ' ' + now.getUTCFullYear() + ' · ' + String(now.getUTCHours()).padStart(2, '0') + ':00 UTC'; const shown = [...document.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join(''); return shown.includes(when) || shown + ' is not ' + when })()")}`],
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
      ['"Light and shadow" switched on fades in: the shadow arrives with no frame that jumps', `(${click('Pause')}, ${click('Layers')}, true) && ${after(1200, 'true')}.then(() => { document.querySelector('.sl-layer-own input').click(); return ${MOON_SMOOTH(7000, { mean: 4, least: 5 })} })`],
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
      ['the address carries the scenario in the app\'s link format', "location.hash === '#a=connecting-ridge@2027-05&t=0&limits=14_24_99999_1_1&mode=plan'"],
      ['the answer has its verdict, one line that starts "At landing:" with no date repeated under the control, and its three rows', `/^At landing: (sunlit|partly sunlit|no sunlight), Earth /.test(${text('.sl-sentence')}.trim()) && document.querySelector('.sl-time') === null && !/\\d{4} · \\d\\d:00/.test(document.querySelector('.sl-answer').innerText) && document.querySelectorAll('.sl-facts > .sl-fact').length === 3 && document.querySelector('.sl-verdict-line') !== null`, 1500],
      ['the column is the redesigned one: three plan controls, a verdict, the Sun, Earth and Ground rows, no tiles, no boxes in the answer, nothing scrolling', COLUMN_SHAPE],
      ['nothing on the page has the question-mark cursor', NO_HELP_CURSOR],
      ['resting the pointer on a row shows its explanation in the screen\'s one tooltip, promptly, off the Moon\'s disc, and readable by a screen reader', `(document.querySelector('.sl-fact.is-earth').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })), true) && ${after(500, "(() => { const row = document.querySelector('.sl-fact.is-earth'); const tip = document.querySelector('.sl-tip'); if (!tip) throw new Error('no tooltip'); const box = tip.getBoundingClientRect(); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const near = { x: Math.min(Math.max(cx, box.left), box.right), y: Math.min(Math.max(cy, box.top), box.bottom) }; return tip.getAttribute('role') === 'tooltip' && /^Elevation −?\\d+\\.\\d° from level\\. Height of the disc's centre above the terrain's skyline/.test(tip.textContent) && !row.hasAttribute('title') && row.getAttribute('aria-description') === tip.textContent && (window.innerWidth < 761 || (box.left >= 0 && box.right <= window.innerWidth && box.top >= 0 && box.bottom <= window.innerHeight && Math.hypot(near.x - cx, near.y - cy) >= r)) && document.querySelectorAll('.sl-tip').length === 1 })()")}`],
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
      ['the Sun\'s row gives the sunlight at landing in W/m², on a surface facing the Sun: what is available, not a power figure', "(() => { const row = document.querySelector('.sl-fact.is-sun'); return /^(sets|rises) in [\\d dh]+ · \\d+ W\\/m²$|^stays (up|down) · \\d+ W\\/m²$/.test(row.querySelector('.sl-fact-small').textContent.trim()) && /not a power figure/.test(row.getAttribute('title') ?? row.dataset.tip ?? '') && !/panel/i.test(document.querySelector('.sl-facts').textContent) })()"],
      ['every row shows its name, its main figure and its small line in full, one small line, or two where a disc is cut, never three', ROWS_WHOLE],
      ['the mission control is one line with its picture, named for a screen reader, and says the preset\'s name', "(() => { const card = document.querySelector('.sl-mission-open'); return card.getBoundingClientRect().height < 40 && card.querySelector('small') === null && card.textContent.trim().startsWith('Short stay') && card.getAttribute('aria-label') === 'Mission: Short stay' && card.closest('.sl-plan-row').querySelector('svg.sl-plan-icon') !== null })()"],
      ['the Sun and Earth rows lead with how far each is from the skyline and which side, and keep the elevation for the hover text, which leads with it and explains both', `(() => { const row = (name) => document.querySelector('.sl-fact.is-' + name); const reads = (name) => /^\\d+\\.\\d°$/.test(row(name).querySelector('.sl-fact-main').firstChild.textContent.trim()) && /^(above|below) the skyline$/.test(row(name).querySelector('.sl-fact-main small').textContent.trim()) && !/elevation/i.test(row(name).textContent); const whole = (name) => row(name).getAttribute('title') ?? row(name).dataset.tip ?? ''; const leads = (name) => /^Elevation −?\\d+\\.\\d° from level\\. /.test(whole(name)); const tip = (name) => whole(name).replace(/^Elevation −?\\d+\\.\\d° from level\\. /, ''); return reads('sun') && reads('earth') && leads('sun') && leads('earth') && tip('earth') === "Height of the disc's centre above the terrain's skyline in that direction, seen from the landing site 2 m above the ground. Elevation is measured from a level horizon; on high ground the skyline sits below level, so a body can be below level and still in view." && tip('sun').startsWith(tip('earth')) })()`],
      ['at Orbit the Moon\'s disc is at least 80% of the stage\'s shorter side, with every marker and name inside the stage', MOON_FILLS],
      ['with the skyline and the river open, the whole disc is inside the stage with a margin on every side', DISC_INSIDE],
      // On a laptop folding the strips makes the stage taller; on a phone they are in the sheet and the stage keeps its size.
      ['with both strips folded, the disc is re-fitted to the stage at once: bigger where the stage grew, and still inside', `(() => { const disc = () => Number(document.querySelector('.scout-globe').dataset.discPx); const tall = () => document.querySelector('.sl-stage').getBoundingClientRect().height; const before = [disc(), tall()]; document.querySelector('.sl-sky .sl-fold').click(); document.querySelector('.sl-river .sl-fold').click(); return new Promise((done) => setTimeout(() => done((tall() > before[1] + 1 ? disc() > before[0] : disc() === before[0]) && ${DISC_INSIDE} && ${MOON_FILLS}), 120)) })()`],
      ['and opened again (the time bar by its button, the skyline by its door), it is fitted back at once', `(() => { document.querySelector('.sl-river .sl-fold').click(); ${OPEN_SKY}; return new Promise((done) => setTimeout(() => done(${DISC_INSIDE}), 400)) })()`],
      ['the skyline\'s land fills at least a third of the strip\'s height', RIDGE_FILLS],
      ['the scenario\'s site is outlined: its own dot, or the group it is in', "document.querySelectorAll('.sl-dot.is-selected, .sl-group-dot.is-selected').length === 1"],
      ['in Plan at Orbit no marker or name prints over another', DOTS_CLEAR],
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
      ['Scout is not in the left column, and nothing in the column scrolls', `${STAND_IN_SCOUT} && document.querySelector('.sl-col .sl-ask, .sl-col #sl-question, .sl-col .sl-ask-name') === null && ${NOTHING_SCROLLS}`, 1200],
      ['"Scout", with his mark, is the first of the tools on the rail', "(() => { const tools = [...document.querySelectorAll('.sl-rail button, .sl-rail a')].map((el) => el.textContent.trim()); const scout = document.querySelector('.sl-rail-scout'); return scout !== null && scout.querySelector('.scout-badge') !== null && scout.textContent.trim() === 'Scout' && tools.indexOf('Scout') < tools.indexOf('Mission') && tools.indexOf('Scout') < tools.indexOf('Compare') })()"],
      ['it opens a panel on the right whose conversation area is at least half the screen\'s height, with the input at its foot', `(document.querySelector('.sl-rail-scout').click(), true) && ${after(700, "(() => { const panel = document.querySelector('.sl-scout-panel'); const talk = panel.querySelector('.sl-talk').getBoundingClientRect(); const input = panel.querySelector('#sl-question').getBoundingClientRect(); const box = panel.getBoundingClientRect(); return document.querySelector('.sl-rail-scout').getAttribute('aria-pressed') === 'true' && talk.height >= window.innerHeight / 2 && input.top >= talk.bottom - 1 && box.bottom - input.bottom < 24 && (window.innerWidth < 761 || box.left > window.innerWidth / 2) })()")}`],
      ['the tag in the panel\'s header names the model the co-pilot\'s status reports', `${after(1500, MODEL_TAG('.sl-scout-panel .sl-drawer-head .sl-ai'))}`],
      ['its header has his mark, his name and the "AI" tag; the input is marked so password managers leave it alone', "(() => { const head = document.querySelector('.sl-scout-panel .sl-ask-name'); const tag = head.querySelector('.sl-ai'); const el = document.querySelector('#sl-question'); return head.querySelector('.scout-badge') !== null && /Scout/.test(head.textContent) && /^AI( · Claude [A-Z][a-z]+ \\d+(\\.\\d+)?)?$/.test(tag.textContent.trim()) && /AI-generated/.test(tag.title) && el.type === 'text' && el.name === 'question' && el.getAttribute('autocomplete') === 'off' && el.hasAttribute('data-1p-ignore') && el.getAttribute('data-lpignore') === 'true' && el.hasAttribute('data-bwignore') && el.getAttribute('data-form-type') === 'other' })()"],
      ['with nothing said yet it offers three questions for the scenario on show, and the rover idea', "(() => { const ideas = [...document.querySelectorAll('.sl-talk .sl-idea')]; return ideas.filter((idea) => !idea.classList.contains('is-action')).map((idea) => idea.textContent).join('|') === \"Why doesn't this landing fit?|When is the best landing here in 2027?|Which of my scenarios is best, and why?\" && ideas.filter((idea) => idea.classList.contains('is-action')).length === 1 && ideas.every((idea) => idea.tagName === 'BUTTON') })()"],
      ['with the panel open the whole Moon and every name are inside the stage, and each strip\'s header is one row', `${STAGE_HOLDS} && ${HEADS_ONE_ROW}`],
      ['tapping an idea asks it: the question and the reply show in the panel, and the ideas leave', `(document.querySelector('.sl-talk .sl-idea').click(), true) && ${after(900, "(() => { const said = [...document.querySelectorAll('.sl-talk .sl-said')]; return said.length === 2 && said[0].classList.contains('is-visitor') && said[0].textContent === \"Why doesn't this landing fit?\" && said[1].classList.contains('is-scout') && said[1].textContent === 'A stand-in reply, number 1.' && document.querySelector('.sl-talk .sl-idea') === null })()")}`],
      ['Scout is told the scenario on show: the link sent has B on show, with A beside it', "(() => { const sent = window.__sent[0]; const link = new URLSearchParams(sent.view.replace(/^#/, '')); return link.get('sc') === '1' && link.get('a') === 'connecting-ridge@2027-05' && link.get('list') === 'shackleton-rim@2027-05-06T13' && sent.messages.at(-1).text === \"Why doesn't this landing fit?\" })()"],
      ['closing the panel and opening it again keeps the conversation', `(${click('Close')}, true) && ${after(400, `document.querySelector('.sl-scout-panel') === null && (document.querySelector('.sl-rail-scout').click(), true)`)} && ${after(500, "document.querySelectorAll('.sl-talk .sl-said').length === 2 && document.querySelector('.sl-talk .sl-said.is-scout').textContent === 'A stand-in reply, number 1.'")}`],
      ['with scenario A chosen, a typed question goes with A on show, and joins the same conversation', `(async () => { document.querySelector('.sl-tabs button[aria-label="Scenario A"]').click(); await new Promise((next) => setTimeout(next, 400)); if (document.querySelector('.sl-scout-panel') === null) document.querySelector('.sl-rail-scout').click(); await new Promise((next) => setTimeout(next, 400)); const form = document.querySelector('.sl-scout-panel .sl-ask'); const input = form.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'And this one?'); input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); await new Promise((next) => setTimeout(next, 900)); const link = new URLSearchParams(window.__sent[1].view.replace(/^#/, '')); return window.__sent.length === 2 && link.get('sc') === '0' && window.__sent[1].messages.length === 3 && document.querySelectorAll('.sl-talk .sl-said').length === 4 && document.querySelector('#sl-question').value === '' })()`],
      ['neither the column nor the panel scrolls sideways, and the page is no wider than the screen', "document.documentElement.scrollWidth <= window.innerWidth && (window.innerWidth < 761 || document.querySelector('.sl-scout-panel').scrollWidth <= document.querySelector('.sl-scout-panel').clientWidth)"],
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
      ['the card has his name and the "AI" tag, a close control, three ideas written for Watch, and an input password managers leave alone', "(() => { const card = document.querySelector('.sl-card'); const el = card.querySelector('#sl-watch-question'); const ideas = [...card.querySelectorAll('.sl-idea')].map((idea) => idea.textContent); return /Scout/.test(card.querySelector('.sl-card-head').textContent) && card.querySelector('.sl-ai') !== null && [...card.querySelectorAll('.sl-card-head button')].some((button) => button.textContent.trim() === 'Close') && ideas.join('|') === 'What am I looking at?|Which site has the most Sun this month?|Where can a lander see Earth right now?' && el.type === 'text' && el.name === 'question' && el.getAttribute('autocomplete') === 'off' && el.hasAttribute('data-1p-ignore') && el.getAttribute('data-lpignore') === 'true' && el.hasAttribute('data-bwignore') && el.getAttribute('data-form-type') === 'other' })()", 700],
      ['the card is 264 to 320 px wide on a laptop and as tall as the sky beside the Moon (no taller than 75% of the screen on a phone), and does not cover the Moon\'s disc', `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); return window.innerWidth < 761 ? card.height <= window.innerHeight * 0.75 + 1 : card.width >= 264 && card.width <= 328 && card.height <= stage.height })() && ${CARD_CLEAR}`, 700],
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
      ['a landing that fits with under half the Sun\'s disc in view is "Fits, marginal", in the Sun\'s gold, with its reason on one line', `(() => { const verdict = document.querySelector('.sl-verdict'); const reasons = [...verdict.querySelectorAll('.sl-reasons li')].map((li) => li.textContent.trim()); return ${text('.sl-verdict-words')}.trim() === '✓ Fits, marginal' && verdict.classList.contains('is-marginal') && getComputedStyle(verdict.querySelector('.sl-verdict-words')).color === getComputedStyle(document.querySelector('.sl-fact.is-sun .sl-fact-mark')).backgroundColor && reasons.length === 1 && /^(under 1|\\d+)% of the Sun's disc is in view at landing$/.test(reasons[0]) })()`, 2500],
      ['a landing that fits, even marginally, is not offered a next landing; "Why?" is beside its verdict', "document.querySelector('.sl-next') === null && document.querySelector('.sl-verdict .sl-why').textContent.trim() === 'Why?'"],
      ['Compare calls it marginal too, and says why', `(${click('Compare')}, true) && ${after(900, "(() => { const fits = [...document.querySelectorAll('.sl-compare tbody tr')].at(-1); return /Marginal/.test(fits.querySelector('td').textContent) && /^A fits, marginal: (under 1|\\d+)% of the Sun's disc is in view at landing\\.$/.test(document.querySelector('.sl-compare-why.is-info li').textContent) })()")}`],
      ['the same site four hours later, added as scenario B, fits without the word marginal, here and in Compare', `(document.querySelector('.sl-tabs button[aria-label="Add a scenario"]').click(), true) && ${after(500, `(() => { const hour = document.querySelector('.sl-pick select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(hour, '22'); hour.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)} && ${after(3000, `${text('.sl-verdict-words')}.trim() === '✓ Fits the mission' && document.querySelector('.sl-reasons') === null && document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 2 && [...document.querySelectorAll('.sl-compare tbody tr')].at(-1).querySelectorAll('td')[1].textContent.trim() === '✓ Yes'`)}`],
      ['the river\'s two rows, one site on two landings the same day, are told apart by the date and hour', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name')].map((row) => row.textContent.trim()); const dates = [...document.querySelectorAll('.sl-river .sl-row-date')]; if (rows.join('|') !== 'A · 1 June 2027 18:00|B · 1 June 2027 ' + document.querySelector('.sl-pick select').value + ':00') throw new Error(rows.join('|')); return dates.every((date) => { const box = date.getBoundingClientRect(); const row = date.closest('.sl-row-name').getBoundingClientRect(); return box.width > 20 && box.right <= row.right + 0.5 && date.scrollWidth <= date.clientWidth + 1 }) && document.querySelector('.sl-river .sl-row-site') === null && /^Scenario A: Shackleton Rim · 1 June 2027 · 18:00 UTC$/.test(document.querySelector('.sl-river .sl-row-name').getAttribute('aria-label')) })()"],
    ],
  },
  {
    // The Planner: the same scenarios with the whole window. Two landings at one site, so the aligned rows can be told apart.
    name: 'planner',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=connecting-ridge@2027-06-21T17',
    checks: [
      ['the rail has ten controls, the three heights grouped as one, with "How it works" in its lower group, and none of them leaves the page (a phone has the "rail" scene\'s one row instead)', "window.innerWidth < 761 || (() => { const rail = document.querySelector('.sl-rail'); const controls = [...rail.children].filter((el) => el.tagName !== 'HR'); const names = controls.map((el) => (el.classList.contains('sl-heights') ? [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/') : el.textContent.trim())); return rail.querySelector('a') === null && document.querySelector('a[href^=\"/planner\"], a[href^=\"/surface\"]') === null && controls.length <= 10 && names.join('|') === 'Orbit/Site/Surface|Layers|Scout|Mission|Compare|Accuracy|Planner|New Planner|How it works|Home' && rail.querySelectorAll('button').length === 12 && [...rail.children].findIndex((el) => el.textContent.trim() === 'How it works') > [...rail.children].findIndex((el) => el.textContent.trim() === 'Planner') + 1 })()", 1200],
      ['Share is a small icon button beside the name, with a name; there is no "?" icon, so How it works has one way in', "(() => { const tools = [...document.querySelectorAll('.sl-col-head .sl-head-tools .sl-icon')]; return tools.length === 1 && tools[0].getAttribute('aria-label') === 'Share' && tools[0].tagName === 'BUTTON' && tools[0].getBoundingClientRect().width <= 28 && (window.innerWidth < 761 || document.querySelector('.sl-title').getBoundingClientRect().right <= tools[0].getBoundingClientRect().left) && [...document.querySelectorAll('button')].filter((button) => /How it works/.test(button.getAttribute('aria-label') ?? button.textContent)).length === 1 })()"],
      ['the river offers Day, Month and Year, and nothing else', "[...document.querySelectorAll('.sl-river .sl-zooms button, .sl-menu .sl-zooms button')].map((button) => button.textContent.trim()).join('|') === 'Day|Month|Year' || (document.querySelector('.sl-more').click(), [...document.querySelectorAll('.sl-menu .sl-zooms button')].map((button) => button.textContent.trim()).join('|') === 'Day|Month|Year')"],
      ['"Planner" opens it over the whole window, on Find, with the Moon kept small in a corner; the scenarios are as they were and the address gains only the open tab', `(() => { window.__hash = location.hash; document.body.click(); ${click('Planner')}; return true })() && ${after(900, "(() => { const full = document.querySelector('.sl-full').getBoundingClientRect(); const moon = document.querySelector('.sl-stage').getBoundingClientRect(); return location.hash === window.__hash + '&planner=find' && location.pathname.startsWith('/sightline') && full.width >= window.innerWidth - 2 && getComputedStyle(document.querySelector('.sl-wrap')).display === 'none' && document.querySelector('.sl-rail') === null && moon.width <= 160 && moon.height <= 160 && document.querySelector('.scout-globe') !== null && document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Find' && document.querySelector('.pl-months') !== null && document.querySelectorAll('.pl-header .sl-tabs button[aria-label^=Scenario]').length === 2 })()")}`],
      ['the Compare tab has a column per scenario, headed by its site and landing, and the address follows the tab', `(${click('Compare')}, true) && ${after(500, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')].map((th) => th.querySelector('select').value + ' ' + [...th.querySelectorAll('.sl-pick .sl-value')].map((part) => part.textContent).join('')); return location.hash === window.__hash + '&planner=compare' && document.querySelector('.pl-months') === null && heads.length === 2 && heads[0] === 'connecting-ridge 6 May 2027 · 13:00 UTC' && heads[1] === 'connecting-ridge 21 June 2027 · 17:00 UTC' })()")}`],
      ['the rows are in groups, the verdict first: whether each scenario fits and why, then at landing, power, radio, the ground and science, with the best value in a row marked and no score that blends them', "(() => { const table = document.querySelector('.sl-full-table'); const groups = [...table.querySelectorAll('tbody')].map((body) => body.dataset.group + ':' + [...body.querySelectorAll('tr:not(.pl-group-row) > th')].map((th) => th.textContent.trim()).join('|')); const names = [...table.querySelectorAll('.pl-group-row th')].map((th) => th.textContent.trim()).join('|'); const cells = (name) => [...[...table.querySelectorAll('tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); const fits = cells('Fits the mission'); return groups.join(' / ') === \"verdict:Fits the mission / landing:In view|Sun's elevation, °|Sun above the skyline, °|Earth's elevation, °|Earth above the skyline, ° / power:Sunlit, %|Longest dark spell, h|Sunlight on a panel, W/m²|Sun in view at landing, % / radio:Earth in view, %|Longest radio silence, h|Sun and Earth together, % / ground:Slope, ° / science:Permanent shadow, nearest|Shadow of 10 km² or more, nearest\" && names === 'At landing|Power|Radio|Ground|Science' && ['Sun\\'s elevation, °', 'Sun above the skyline, °', 'Earth\\'s elevation, °', 'Earth above the skyline, °'].every((name) => cells(name).every((cell) => /^−?\\d+\\.\\d$/.test(cell))) && fits.length === 2 && /^✗ No: Sun down for 95 h; your limit is 24 h$/.test(fits[0]) && fits[1] === '✓ Yes' && table.querySelectorAll('td.is-best').length >= 3 && !/score/i.test(table.textContent) })()"],
      ['under it, one time row per scenario starts at its own landing hour, on an axis of days since landing', "(() => { const rows = [...document.querySelectorAll('.sl-aligned-row')]; const bands = rows.map((row) => [...row.querySelectorAll('rect')].map((rect) => rect.getAttribute('class') + rect.getAttribute('x') + '+' + rect.getAttribute('width')).join(',')); const first = rows.map((row) => row.querySelector('rect').getAttribute('class').replace('sl-run is-', '')); const atLanding = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent === 'In view').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.dataset.state); const axis = [...document.querySelectorAll('.sl-aligned .sl-axis .sl-track span')].map((tick) => tick.textContent); return Number(rows[1].dataset.firstHour) - Number(rows[0].dataset.firstHour) === 1108 && rows.every((row) => row.dataset.hours === '336' && row.querySelector('rect').getAttribute('x') === '0') && bands[0] !== bands[1] && first.join('|') === atLanding.join('|') && axis[0] === 'landing' && /^day \\d+$/.test(axis.at(-1)) })()"],
      ['the export writes the table as CSV', `(() => { window.__csv = null; URL.createObjectURL = (blob) => { void blob.text().then((text) => { window.__csv = text }); return 'blob:stand-in' }; HTMLAnchorElement.prototype.click = function () {}; ${click('Export')}; return true })() && ${after(500, "typeof window.__csv === 'string' && window.__csv.split('\\n')[0] === ',A · Connecting Ridge · 2027-05-06T13:00:00Z,B · Connecting Ridge · 2027-06-21T17:00:00Z' && /\\n\"Sunlit, %\",61,/.test(window.__csv) && /\\n\"Permanent shadow, nearest\",0\\.1 km,/.test(window.__csv) && window.__csv.match(/\\nFits the mission,/g).length === 1 && /\\nMission,/.test(window.__csv)")}`],
      ['on Find, a cell opens its month under the grid and "Add as C" adds it without leaving the Planner; Compare then has three columns', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); ${click('Find')}; await wait(400); [...document.querySelectorAll('.pl-months button')].find((cell) => cell.dataset.site === 'shackleton-rim' && cell.dataset.month === '2027-09').click(); await wait(400); const add = document.querySelector('.pl-strip .pl-add button'); if (!add || add.textContent.trim() !== 'Add as C') return false; add.click(); await wait(600); const stayed = document.querySelector('.sl-full') !== null && /Added as C/.test(document.querySelector('.pl-strip .pl-add').textContent) && location.hash.includes('~shackleton-rim@2027-09-'); ${click('Compare')}; await wait(500); const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return stayed && heads.length === 3 && heads[2].querySelector('select').value === 'shackleton-rim' && /September 2027/.test(heads[2].querySelector('.sl-pick').textContent) && document.querySelectorAll('.sl-aligned-row').length === 3 })()`],
      ['Scout opens beside the table, which keeps its whole width on screen (the page scrolls down, as the Planner always has)', `(document.querySelector('.sl-full-head .sl-rail-scout').click(), true) && ${after(900, "(() => { const panel = document.querySelector('.sl-scout-panel'); const table = document.querySelector('.sl-full-table').getBoundingClientRect(); const rows = document.querySelector('.sl-aligned').getBoundingClientRect(); if (window.innerWidth < 761) return panel !== null; const box = panel.getBoundingClientRect(); const scroller = document.querySelector('.sl-full-scroll'); const head = document.querySelector('.sl-full-table thead th:not(.pl-add-col)').getBoundingClientRect().width; if (!(table.left >= 0 && table.right <= box.left + 0.5 && table.top >= 0 && scroller.scrollWidth <= scroller.clientWidth + 1 && rows.right <= box.left + 0.5 && head > 60)) throw new Error('table ' + Math.round(table.left) + ' to ' + Math.round(table.right) + ' across from ' + Math.round(table.top) + ' down; panel from ' + Math.round(box.left) + '; scroller ' + scroller.scrollWidth + ' of ' + scroller.clientWidth + '; rows to ' + Math.round(rows.right) + '; a column is ' + Math.round(head)); return true })()")}`],
      ['Escape closes nothing but the Planner: back on the Moon, the three scenarios and the address are kept', `(() => { if (window.innerWidth < 761) ${click('Close')}; window.__hash = location.hash; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })() && ${after(900, "document.querySelector('.sl-full') === null && document.querySelector('.sl-rail') !== null && document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 3 && location.hash === window.__hash.replace(/&planner=(find|compare)/, '') && document.querySelectorAll('.sl-river .sl-row-name').length === 3")}`],
      ['the small Moon in the Planner\'s corner is a way back too', `(document.querySelector('.sl-scout-panel') && ${click('Close')}, ${click('Planner')}, true) && ${after(700, "(() => { const back = document.querySelector('.sl-mini-back'); if (!back || back.getAttribute('aria-label') !== 'Back to the Moon') return false; back.click(); return true })()")} && ${after(700, "document.querySelector('.sl-full') === null && document.querySelector('.sl-col') !== null")}`],
      ['How opens as a sheet over the scene, on this page, and names the model the co-pilot\'s status reports', `(${click('How it works')}, true) && ${after(1500, "(async () => { const sheet = document.querySelector('.sl-how'); const status = await fetch('/api/status/services').then((r) => (r.ok ? r.json() : null)).catch(() => null); const id = status?.services?.copilot?.status?.modelSettings?.model ?? null; const match = id ? /^claude-([a-z]+)-(\\d+)(?:-(\\d{1,2}))?/.exec(id) : null; const name = match ? 'Claude ' + match[1][0].toUpperCase() + match[1].slice(1) + ' ' + match[2] + (match[3] ? '.' + match[3] : '') : null; const line = sheet.querySelector('.how-scout-model').textContent.replace(/\\s+/g, ' ').trim(); const says = name ? line.startsWith('Scout is Anthropic’s Claude (' + name + ').') : line.startsWith('Scout is Anthropic’s Claude.'); if (!says) throw new Error('status says ' + id + '; the sheet says: ' + line.slice(0, 80)); return location.pathname.startsWith('/sightline') && sheet.getAttribute('role') === 'dialog' && /read-only tools/.test(line) && /never works out a number himself/.test(line) })()")}`],
      ['Escape closes the sheet', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(500, "document.querySelector('.sl-how') === null && document.querySelector('.sl-col') !== null")}`],
      ['Surface shows the surface view inside the stage, on this page, and Orbit brings the Moon back', `(${click('Surface')}, true) && ${after(900, "(() => { const frame = document.querySelector('.sl-stage iframe.sl-surface'); return frame !== null && frame.getAttribute('src').startsWith('/surface/#a=connecting-ridge@2027-05') && location.pathname.startsWith('/sightline') && document.querySelector('.sl-heights button[aria-pressed=\"true\"]').textContent.trim() === 'Surface' })()")} && (${click('Orbit')}, true) && ${after(500, "document.querySelector('.sl-surface') === null")}`],
    ],
  },
  {
    // The Planner's Find tab: every site by month, a cell opening its month, and adding from it.
    name: 'planner-find',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13&planner=find',
    // The link opens the Planner itself, where the Moon is small and has no site dots to wait for.
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.pl-months') !== null",
    checks: [
      ['a link that names the tab opens the Planner on Find: every listed site, in its group, by the twelve months of the landing\'s year', "(() => { const grid = document.querySelector('.pl-months'); const months = [...grid.querySelectorAll('thead th')].map((th) => th.textContent).join(''); const groups = [...grid.querySelectorAll('.pl-group-row th')].map((th) => th.textContent); const rows = grid.querySelectorAll('tbody tr:not(.pl-group-row)').length; return document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Find' && months === 'JanFebMarAprMayJunJulAugSepOctNovDec' && groups.join('|') === 'South pole ridges|CLPS|Apollo|Other countries' && rows === 13 && grid.dataset.year === '2027' && grid.querySelectorAll('td button').length === 13 * 12 })()", 1500],
      ['a cell says on how many days of its month a landing fits, or "none", worked out for every site in under 50 ms; the legend is one line', "(() => { const cells = [...document.querySelectorAll('.pl-months td button')]; const legend = document.querySelector('.pl-find-legend').getBoundingClientRect(); const ms = Number(document.querySelector('.pl-find').dataset.fitMs); return document.querySelector('.pl-measures [aria-pressed=true]').textContent === 'Landings that fit' && cells.every((cell) => (cell.textContent === 'none' && cell.dataset.days === '0') || (/^\\d+$/.test(cell.textContent) && cell.textContent === cell.dataset.days && Number(cell.dataset.days) <= 31)) && cells.some((cell) => cell.textContent === 'none') && cells.some((cell) => Number(cell.dataset.days) > 0) && legend.height < 26 && ms >= 0 && ms < 50 })()"],
      ['a cell\'s count matches the verdict: its month opens under the grid with the same days marked, the first landing named is added as C without leaving the page, and Compare\'s verdict says it fits', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const cell = [...document.querySelectorAll('.pl-months td button')].find((one) => one.dataset.site === 'connecting-ridge' && Number(one.dataset.days) > 0); const days = Number(cell.dataset.days); cell.click(); await wait(400); const strip = document.querySelector('.pl-strip'); const marked = new Set(); for (const rect of strip.querySelectorAll('.pl-fit')) for (let hour = Number(rect.getAttribute('x')); hour < Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')); hour += 1) marked.add(Math.floor(hour / 24)); const named = strip.querySelector('.pl-landings button[aria-pressed=true]').textContent; const add = strip.querySelector('.pl-add button'); if (marked.size !== days || !/^First that fits: \\d+ \\w+ 2027 · \\d\\d:00 UTC$/.test(named) || add.textContent.trim() !== 'Add as C') return false; add.click(); await wait(600); const stayed = document.querySelector('.pl-months') !== null && /Added as C\\./.test(strip.textContent) && document.querySelectorAll('.pl-header .sl-tabs button[aria-label^=Scenario]').length === 3; ${click('Compare')}; await wait(500); const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); ${click('Find')}; await wait(300); return stayed && fits.length === 3 && fits[2] === '✓ Yes' })()`],
      ['"none" is none: the first hour of such a month, added as D, is one the verdict refuses; with four scenarios a cell says one must be removed first', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const cell = [...document.querySelectorAll('.pl-months td button')].find((one) => one.dataset.days === '0'); cell.click(); await wait(400); const strip = document.querySelector('.pl-strip'); const add = strip.querySelector('.pl-add button'); if (!/No landing in \\w+ 2027 fits the mission\\. On the 1st at 00:00 UTC: \\S/.test(strip.textContent) || strip.querySelector('.pl-fit') !== null || add.textContent.trim() !== 'Add the 1st as D') return false; add.click(); await wait(600); ${click('Compare')}; await wait(500); const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); ${click('Find')}; await wait(300); [...document.querySelectorAll('.pl-months td button')].find((one) => Number(one.dataset.days) > 0).click(); await wait(300); const full = document.querySelector('.pl-strip .pl-add'); return fits.length === 4 && /^✗ No/.test(fits[3]) && full.querySelector('button') === null && full.textContent.trim() === 'Four scenarios at most: remove one to add another.' })()`],
      ['Sun, Earth, and Sun and Earth show the share of the month in view, in percent', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const seen = []; for (const name of ['Sun', 'Earth', 'Sun and Earth']) { [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === name).click(); await wait(250); const cells = [...document.querySelectorAll('.pl-months td button')].map((cell) => cell.textContent); seen.push(cells.every((cell) => /^(\\d{1,3}|<1)$/.test(cell) && (cell === '<1' || Number(cell) <= 100)) && /% of the month$/.test(document.querySelector('.pl-find-legend').textContent.split(':')[0])) } const apollo = [...document.querySelectorAll('.pl-months td button')].filter((cell) => cell.dataset.site === 'apollo-11').map((cell) => cell.textContent); [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === 'Earth').click(); await wait(250); const earth = [...document.querySelectorAll('.pl-months td button')].filter((cell) => cell.dataset.site === 'apollo-11' || cell.dataset.site === 'change-4').map((cell) => cell.textContent); [...document.querySelectorAll('.pl-measures button')].find((button) => button.textContent === 'Landings that fit').click(); await wait(250); return seen.every(Boolean) && apollo.every((cell) => Number(cell) > 30 && Number(cell) < 70) && earth.filter((cell) => cell === '100').length === 12 && earth.filter((cell) => cell === '0').length === 12 })()`],
      ['the mission on the left changes the counts at once, and "Example: Canada\'s utility rover" sets the Long stay example with the agency\'s own words and link', `(async () => { const wait = (ms) => new Promise((done) => setTimeout(done, ms)); const counts = () => [...document.querySelectorAll('.pl-months td button')].map((cell) => cell.dataset.days).join(','); const before = counts(); ${click("Example: Canada’s utility rover")}; await wait(500); const note = document.querySelector('.pl-rover'); const link = note.querySelector('a'); const rover = counts(); const ok = rover !== before && location.hash.includes('limits=60_336_') && /in its own words/.test(note.textContent) && /an example and not the rover’s own figures/.test(note.textContent) && /published no landing site/.test(note.textContent) && link.href.startsWith('https://www.asc-csa.gc.ca/') && link.target === '_blank'; ${click('Short stay example')}; await wait(500); return ok && counts() === before && document.querySelector('.pl-rover') === null })()`],
      ['the open tab survives a reload: Compare stays Compare', `(${click('Compare')}, true) && ${after(400, "(location.hash.includes('planner=compare') && (window.__reloaded = false, location.reload(), true))")}`],
      ['after the reload the Planner is open on Compare with the four scenarios, and Find is one press away', `window.__reloaded === undefined && document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Compare' && document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)').length === 4 && (${click('Find')}, true) && ${after(400, "document.querySelector('.pl-months') !== null && location.hash.includes('planner=find')")}`, 6000],
      ['Brief opens the written brief for the scenario on show, as the main screen\'s does, and Escape closes it and nothing else', `(${click('Brief')}, true) && ${after(2500, "document.querySelector('.sl-brief-sheet') !== null")} && ${after(2600, "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)")} && ${after(4000, "document.querySelector('.sl-brief-sheet') === null && document.querySelector('.sl-full') !== null")}`],
      ['Share opens the main screen\'s short list: copy the link, or the brief', `(document.querySelector('.pl-header .sl-icon[aria-label="Share"]').click(), true) && ${after(300, "(() => { const names = [...document.querySelectorAll('.pl-header .sl-share-menu button')].map((button) => button.textContent.trim()).join('|'); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return names === 'Copy link|Brief' })()")}`],
      ['the header reads back, title, tabs, scenarios A to D, then Brief, Share, Export and Scout, and nothing is wider than the screen', "(() => { const head = document.querySelector('.pl-header'); const order = [...head.querySelectorAll('.pl-back, h2, .pl-tabs, .sl-tabs, .pl-tools')].map((part) => part.className || part.tagName).join('|'); const tools = [...head.querySelectorAll('.pl-tools > button, .pl-tools .sl-icon')].map((tool) => tool.getAttribute('aria-label') ?? tool.textContent.trim()).join('|'); return /pl-back\\|H2\\|pl-tabs\\|sl-tabs\\|pl-tools/.test(order) && head.querySelector('.pl-back').textContent.trim() === '‹ Moon' && head.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4 && tools === 'Brief|Share|Export|Scout' && document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.sl-full').scrollWidth <= document.querySelector('.sl-full').clientWidth + 1 })()"],
      ['"‹ Moon" goes back to the Moon with the four scenarios intact, and the address drops the tab', `(${click('‹ Moon')}, true) && ${after(900, "document.querySelector('.sl-full') === null && document.querySelector('.sl-rail') !== null && document.querySelectorAll('.sl-col-head .sl-tabs button[aria-label^=Scenario], .sl-tabs button[aria-label^=Scenario]').length >= 4 && !location.hash.includes('planner=') && location.hash.includes('~connecting-ridge@2027-')")}`],
      ['the small Moon is a way back too, named "Back to the Moon"', `(document.body.click(), ${click('Planner')}, true) && ${after(900, "(() => { const back = document.querySelector('.sl-mini-back'); const ok = document.querySelector('.pl-months') !== null && back.getAttribute('aria-label') === 'Back to the Moon' && /Back to the Moon/.test(back.title); back.click(); return ok })()")} && ${after(1800, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4")}`],
      ['and Escape goes back as well, with the scenarios as they were', `(document.body.click(), ${click('Planner')}, true) && ${after(900, "(document.querySelector('.sl-full') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true))")} && ${after(1800, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 4 && !location.hash.includes('planner=')")}`],
    ],
  },
  {
    // The Planner's Compare tab: a column per scenario, edited in its header, the rows in groups, and adding from the last column.
    name: 'planner-compare',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=apollo-11@2027-06-01T00&planner=compare',
    ready: "document.querySelector('.scout-globe canvas') !== null && document.querySelector('.sl-full-table') !== null",
    checks: [
      ['a link opens the Planner on Compare: a column per scenario, each headed by its site and its date as controls and a remove, then "Add scenario"', "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; const add = document.querySelector('.sl-full-table thead th.pl-add-col'); return document.querySelector('.pl-tabs [aria-selected=true]').textContent === 'Compare' && heads.length === 2 && heads.every((head) => head.querySelector('select') !== null && head.querySelector('.sl-pick input[type=date]') !== null && head.querySelector('button[aria-label^=\"Remove scenario\"]') !== null) && heads[0].querySelector('select').value === 'connecting-ridge' && heads[1].querySelector('select').value === 'apollo-11' && add !== null && add.querySelector('select') !== null && add.querySelector('.pl-add-button').textContent.trim() === 'Add as C' })()", 1500],
      ['"Detailed planner" is a plain link in the header to that page, opened on the scenario on show with the mission\'s limits; choosing B makes it B\'s', `(() => { const link = document.querySelector('.pl-header a.pl-detailed'); const box = link.getBoundingClientRect(); if (link.textContent.trim() !== 'Detailed planner' || link.getAttribute('href') !== '/planner/#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=apollo-11@2027-06-01T00' || box.width < 40 || box.right > window.innerWidth) throw new Error(link.getAttribute('href') + ' ' + Math.round(box.right)); document.querySelector('.sl-full-table button[aria-label="Scenario B"]').click(); return true })() && ${after(400, "(() => { const href = document.querySelector('.pl-header a.pl-detailed').getAttribute('href'); document.querySelector('.sl-full-table button[aria-label=\"Scenario A\"]').click(); if (href !== '/planner/#a=apollo-11@2027-06&t=0&limits=14_24_99999_1_1&mode=plan&list=connecting-ridge@2027-05-06T13') throw new Error(href); return true })()")}`],
      ['science: the distance to permanent shadow is NASA\'s, in km, a site outside its maps says "none mapped within" how far, and the row\'s hover text says what the term means and where it is from', `${after(1500, "(() => { const rows = [...document.querySelectorAll('.sl-full-table tbody[data-group=science] tr:not(.pl-group-row)')]; const cells = rows.map((row) => [...row.querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.replace('★', '').trim())); const tip = rows[0].querySelector('th').title; return fetch('/data/shadow.json').then((r) => r.json()).then((shadow) => cells[0][0] === shadow.sites['connecting-ridge'].patch.distance_km.toFixed(1) + ' km' && cells[1][0] === shadow.sites['connecting-ridge'].region.distance_km.toFixed(0) + ' km' && cells[0][1] === 'none mapped within ' + shadow.sites['apollo-11'].patch.map_edge_km.toLocaleString('en-US') + ' km' && cells[1][1] === cells[0][1] && tip.includes(shadow.what) && tip.includes(shadow.source.name) && /Mazarico/.test(tip) && getComputedStyle(rows[0].querySelector('th')).cursor !== 'help') })()")}`, 6000],
      ['changing B\'s site in its header changes that scenario only: A is as it was, and the link follows', `(() => { window.__a = document.querySelector('.sl-full-table thead th select').value + document.querySelector('.sl-full-table thead th .sl-pick').textContent; const select = document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col) .pl-th > select')[1]; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'shackleton-rim'); select.dispatchEvent(new Event('change', { bubbles: true })); return true })() && ${after(700, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return heads.length === 2 && heads[1].querySelector('select').value === 'shackleton-rim' && /1 June 2027 · 00:00 UTC/.test(heads[1].querySelector('.sl-pick').textContent) && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && location.hash.includes('list=shackleton-rim@2027-06-01T00') && !location.hash.includes('apollo-11') })()")}`],
      ['changing B\'s date in its header moves B\'s landing only, and its numbers follow', `(() => { const cell = (name, column) => [...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td')[column].textContent; window.__before = [cell('Sunlit, %', 0), cell('Sunlit, %', 1)]; const date = document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col) .sl-pick input[type=date]')[1]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(date, '2027-08-10'); date.dispatchEvent(new Event('input', { bubbles: true })); return true })() && ${after(900, "(() => { const cell = (name, column) => [...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === name).querySelectorAll('td')[column].textContent; const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return /10 August 2027 · 00:00 UTC/.test(heads[1].querySelector('.sl-pick').textContent) && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && cell('Sunlit, %', 0) === window.__before[0] && cell('Sunlit, %', 1) !== window.__before[1] && location.hash.includes('shackleton-rim@2027-08-10T00') })()")}`],
      ['"Add scenario" offers the site on show at its next landing that fits, and "Add as C" adds it here: C\'s verdict is that it fits', `(() => { const add = document.querySelector('.sl-full-table thead th.pl-add-col'); window.__offer = add.querySelector('select').value + '|' + add.querySelector('.sl-pick').textContent; add.querySelector('.pl-add-button').click(); return add.querySelector('select').value === 'connecting-ridge' })() && ${after(900, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; const fits = [...[...document.querySelectorAll('.sl-full-table tbody tr')].find((row) => row.querySelector('th').textContent.trim() === 'Fits the mission').querySelectorAll('td:not(.pl-add-col)')].map((td) => td.textContent.trim()); return document.querySelector('.sl-full-table') !== null && heads.length === 3 && heads[2].querySelector('select').value + '|' + heads[2].querySelector('.sl-pick').textContent === window.__offer && fits[2] === '✓ Yes' && document.querySelectorAll('.sl-aligned-row').length === 3 && document.querySelector('.pl-add-button').textContent.trim() === 'Add as D' })()")}`],
      ['on a laptop the table does not scroll sideways and nothing is wider than the screen; on a phone the tab is one column whose table scrolls inside its own frame', "(() => { const scroller = document.querySelector('.pl-compare .sl-full-scroll'); const page = document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector('.sl-full').scrollWidth <= document.querySelector('.sl-full').clientWidth + 1; return page && (window.innerWidth < 761 ? getComputedStyle(scroller).overflowX === 'auto' : scroller.scrollWidth <= scroller.clientWidth + 1) })()"],
      ['removing C from its column leaves A and B as they were', `(document.querySelector('.sl-full-table button[aria-label="Remove scenario C"]').click(), true) && ${after(600, "(() => { const heads = [...document.querySelectorAll('.sl-full-table thead th:not(.pl-add-col)')]; return heads.length === 2 && heads[0].querySelector('select').value + heads[0].querySelector('.sl-pick').textContent === window.__a && heads[1].querySelector('select').value === 'shackleton-rim' })()")}`],
      ['back on the Moon the main screen shows the scenarios as Compare left them', `(${click('‹ Moon')}, true) && ${after(900, "document.querySelector('.sl-full') === null && document.querySelectorAll('.sl-tabs button[aria-label^=Scenario]').length === 2 && location.hash.includes('list=shackleton-rim@2027-08-10T00') && !location.hash.includes('planner=')")}`],
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
      ['back on the Moon the column says the heights in one small line, each row\'s hover text names its own height, and nothing in the column scrolls', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(1500, `(() => { const line = document.querySelector('.sl-heights-line')?.textContent ?? ''; const tip = (name) => document.querySelector('.sl-fact.is-' + name).getAttribute('title') ?? document.querySelector('.sl-fact.is-' + name).dataset.tip ?? ''; return (line === 'panel at 2 m, antenna at 10 m' && / 2 m above the ground/.test(tip('sun')) && / 10 m above the ground/.test(tip('earth')) && /Matches Horizons within/.test(document.querySelector('.sl-horizons').textContent) && ${NOTHING_SCROLLS} && ${COLUMN_FITS}) || line + ' // ' + tip('earth').slice(0, 160) })()`)}`],
      ['the main screen\'s Mission panel has no height choice until its Advanced fold is opened; there it shows what the Planner set', `(${click('Mission')}, true) && ${after(700, `(document.querySelector('.sl-height-pick') === null && (document.querySelector('.sl-advanced-link').click(), true))`)} && ${after(900, "(() => { const pressed = (label) => [...document.querySelector('.sl-drawer .sl-height-pick[aria-label=\"' + label + '\"]').querySelectorAll('button')].find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent.trim(); return (pressed('Solar panel height') === '2 m' && pressed('Antenna height') === '10 m') || pressed('Solar panel height') + ', ' + pressed('Antenna height') })()")}`],
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
      ['the Sun\'s row is read at 10 m and Earth\'s at 4 m', "(() => { const tip = (name) => document.querySelector('.sl-fact.is-' + name).getAttribute('title') ?? document.querySelector('.sl-fact.is-' + name).dataset.tip ?? ''; return (/ 10 m above the ground/.test(tip('sun')) && / 4 m above the ground/.test(tip('earth'))) || tip('sun').slice(0, 200) })()"],
      ['only the 10 m and 4 m files were fetched', `(() => { const files = ${HEIGHT_FILES}; return (files.length > 0 && files.every((name) => /\\/heights\\/(10|4)m\\//.test(name)) && files.some((name) => name.includes('/heights/10m/shackleton-rim/2027-05/track.json.gz')) && files.some((name) => name.includes('/heights/4m/shackleton-rim/horizon.json.gz'))) || files.slice(0, 6).join(' ') })()`],
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
      ['every row shows its words in full, and Earth\'s hover text gives an elevation of tens of degrees', `(() => { const row = document.querySelector('.sl-fact.is-earth'); return /^Elevation \\d\\d\\.\\d° from level\\. /.test(row.getAttribute('title') ?? row.dataset.tip ?? '') })() && ${ROWS_WHOLE}`],
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
      ['Share opens a short list: copy the link, or the brief', `(document.querySelector('.sl-icon[aria-label="Share"]').click(), true) && ${after(300, "[...document.querySelectorAll('.sl-share-menu button')].map((button) => button.textContent.trim()).join('|') === 'Copy link|Brief'")}`, 1200],
      ['"Brief" opens the written brief for the scenario on show, as a sheet on this page', `([...document.querySelectorAll('.sl-share-menu button')].find((button) => button.textContent.trim() === 'Brief').click(), true) && ${after(2500, "(() => { const sheet = document.querySelector('.sl-brief-sheet'); const brief = sheet.querySelector('.pl-brief'); return sheet.getAttribute('role') === 'dialog' && location.pathname.startsWith('/sightline') && brief.querySelector('h2').textContent.replace(/\\s+/g, ' ').trim() === 'Shackleton Rim, May 2027' && brief.querySelector('.pl-when').textContent.trim() === '6 May 2027, 13:00 UTC' && document.querySelector('.sl-share-menu') === null })()")}`],
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
      ['with four scenarios at one site every row shows its letter and its full date, the site is left out, and nothing is shortened', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name')]; const cut = rows.filter((row) => row.scrollWidth > row.clientWidth + 1 || [...row.querySelectorAll('span')].some((part) => part.scrollWidth > part.clientWidth + 1)); if (rows.map((row) => row.textContent.trim()).join('|') !== 'A · 26 May 2027|B · 21 June 2027|C · 3 October 2027|D · 17 October 2028' || cut.length > 0 || document.querySelector('.sl-river .sl-row-site') !== null) throw new Error(rows.map((row) => row.textContent.trim() + ' (' + row.scrollWidth + ' of ' + row.clientWidth + ')').join(' | ')); return rows.every((row) => /Connecting Ridge/.test(row.title) && /^Scenario [A-D]: Connecting Ridge · \\d+ \\w+ 202[78] · \\d\\d:00 UTC$/.test(row.getAttribute('aria-label'))) })()", 1500],
      ['the label column is only as wide as those labels need', "(() => { const name = document.querySelector('.sl-river .sl-row-name').getBoundingClientRect().width; return name < 190 })()"],
    ],
  },
  {
    // Two sites: the date still shows in full, and the site comes after it.
    name: 'rows-two-sites',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=peak-near-shackleton@2027-09-17T12',
    checks: [
      ['with two sites on two dates a row shows a short date and then its site, both whole, and the full label is the tooltip', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name')]; const dates = rows.map((row) => row.querySelector('.sl-row-date')); const whole = dates.every((date) => date.scrollWidth <= date.clientWidth + 1 && date.getBoundingClientRect().right <= date.closest('.sl-row-name').getBoundingClientRect().right); if (dates.map((date) => date.textContent.trim()).join('|') !== 'A · 6 May|B · 17 Sep' || !whole) throw new Error(rows.map((row) => row.textContent.trim()).join(' | ')); return rows.map((row) => row.title).join('|') === 'A · Connecting Ridge · 6 May 2027 · 13:00 UTC|B · Peak near Shackleton · 17 September 2027 · 12:00 UTC' && (window.innerWidth < 761 || rows.map((row) => row.querySelector('.sl-row-site').textContent.trim()).join('|') === '· Connecting Ridge|· Peak near Shackleton') })()", 1500],
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
      ['with Earth\'s centre below the skyline and Earth still counted in view, the sentence says "Earth partly in view"', `/Earth partly in view$/.test(${SENTENCE}) && ${rowAbove('earth')} === '−0.9°'`, 3000],
      ['the Earth row says how much of its disc shows, on a second small line', "/^(under 1|\\\\d+)% of the disc showing$/.test(document.querySelector('.sl-fact.is-earth .sl-fact-small.is-showing')?.textContent.trim() ?? '') && document.querySelectorAll('.sl-fact.is-earth .sl-fact-small').length === 2"],
      ['the landing otherwise fits, so the verdict is "Fits, marginal", because only the edge of Earth is in view at landing', `(() => { const reasons = [...document.querySelectorAll('.sl-reasons li')].map((li) => li.textContent.trim()); if (${text('.sl-verdict-words')}.trim() !== '✓ Fits, marginal' || !reasons.includes('only the edge of Earth is in view at landing')) throw new Error(${text('.sl-verdict')}); return document.querySelector('.sl-verdict').classList.contains('is-marginal') })()`],
      ['the time bar\'s chip, on the landing, says so too', `/^Sun, part of Earth$/.test(${text('.sl-river .sl-chip')}.trim())`],
      ['and so does Compare', `(${click('Compare')}, true) && ${after(900, "(() => { const fits = [...document.querySelectorAll('.sl-compare tbody tr')].at(-1); return /Marginal/.test(fits.querySelector('td').textContent) && /only the edge of Earth is in view at landing/.test(document.querySelector('.sl-compare-why.is-info').textContent) })()")}`],
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
      ['with Mission open the Moon and names fit, and each header is one row', onLaptop(click('Mission'), 900, `document.querySelector('.sl-drawer') !== null && ${STAGE_HOLDS} && ${HEADS_ONE_ROW}`)],
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
      ['at this landing the Sun\'s elevation is negative and the Sun is in view: its main figure is above the skyline and its hover text gives the negative elevation', `(() => { const row = document.querySelector('.sl-fact.is-sun'); return /^Sunlit/.test(${SENTENCE}) && parseFloat(row.querySelector('.sl-fact-main').firstChild.textContent) > 0 && row.querySelector('.sl-fact-main small').textContent.trim() === 'above the skyline' && /^Elevation −\\d+\\.\\d° from level\\. /.test(row.getAttribute('title') ?? row.dataset.tip ?? '') })()`],
      ['the readout by the time bar is one row: the date, a state chip with its colour and words, and the heights above the skyline when the row has room', `(() => {
        const row = document.querySelector('.sl-river-head')
        const chip = row.querySelector('.sl-chip')
        const heights = row.querySelector('.sl-moment-heights')
        const state = [...chip.classList].find((name) => name.startsWith('is-'))
        const words = { 'is-both': ['Sun and Earth', 'Sun, part of Earth'], 'is-sun': ['Sun only'], 'is-earth': ['Earth only', 'Part of Earth'], 'is-none': ['Neither'] }
        const named = words[state].includes(chip.textContent.trim()) && chip.querySelector('.sl-key').classList.contains(state)
        const order = row.querySelector('.sl-now').nextElementSibling === chip && (heights === null || chip.nextElementSibling === heights) && row.querySelector('.sl-link') === null
        return named && order && (window.innerWidth < 1440 || (heights !== null && heights.title.startsWith("Height of the disc's centre above the terrain's skyline"))) && ${HEADS_ONE_ROW}
      })()`],
      ['the sentence is one line of body text, and every part of the answer that is drawn has something in it', "(() => { const sentence = document.querySelector('.sl-sentence'); const line = parseFloat(getComputedStyle(sentence).lineHeight); const parts = [...document.querySelectorAll('.sl-answer > *')].filter((el) => !el.classList.contains('sl-horizons')); return sentence.getBoundingClientRect().height < 1.2 * line && parseFloat(getComputedStyle(sentence).fontSize) <= 15 && parts.every((el) => el.textContent.trim() !== '') })()"],
      ['every row shows its words in full: one small line, or two where a disc is cut, never three', ROWS_WHOLE],
      ['the page says "skyline", never "the ridge", for the terrain\'s outline', OWN_WORDS],
      ['nothing in the column scrolls, and no area inside it', NOTHING_SCROLLS],
      ['the rows\' figures are of one width and never wrap', "[...document.querySelectorAll('.sl-fact-main')].every((value) => getComputedStyle(value).fontVariantNumeric.includes('tabular-nums') && getComputedStyle(value).whiteSpace === 'nowrap')"],
      ['neither the column nor a panel scrolls', COLUMN_FITS],
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
    // The view belongs to the visitor: after a drag it stays where it was left, through time playing
    // and the stage changing size, until the compass is pressed.
    name: 'free-view',
    sky: true,
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: ["document.querySelector('.sl-river .sl-round[aria-label=\"Play\"]').click()"],
    checks: [
      ['before any drag the view is the default one and there is no compass', "(() => { window.__pose0 = document.querySelector('.scout-globe').dataset.pose; return document.querySelector('.sl-recentre') === null && typeof window.__pose0 === 'string' })()"],
      { drag: true },
      ['after a drag the view has turned and the compass appears, named "Recentre the Moon", in the stage\'s corner clear of the disc', `(() => {
        const globe = document.querySelector('.scout-globe')
        window.__pose1 = globe.dataset.pose
        const compass = document.querySelector('.sl-recentre')
        if (!compass || window.__pose1 === window.__pose0) return false
        const stage = document.querySelector('.sl-stage').getBoundingClientRect()
        const box = compass.getBoundingClientRect()
        const disc = globe.getBoundingClientRect()
        const reach = Math.hypot((box.left + box.right) / 2 - (disc.left + disc.right) / 2, (box.top + box.bottom) / 2 - (disc.top + disc.bottom) / 2)
        return compass.getAttribute('aria-label') === 'Recentre the Moon' && box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && reach >= Number(globe.dataset.discPx) / 2 + box.width / 2 && compass.closest('.sl-view-tools') !== null
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
      ['folding a strip changes the stage\'s size, not the view\'s direction, and the disc still fits', `(document.querySelector('.sl-sky .sl-fold').click(), true) && ${after(400, `document.querySelector('.scout-globe').dataset.pose === window.__pose1 && ${DISC_INSIDE}`)}`],
      ['one press of the compass returns the default view and removes the compass', `(document.querySelector('.sl-recentre').click(), true) && ${after(1200, `document.querySelector('.scout-globe').dataset.pose === window.__pose0 && document.querySelector('.sl-recentre') === null && ${DISC_INSIDE}`)}`],
      ['picking a site that is out of view turns the Moon to show it; one already in view leaves the view alone', `(() => { const pick = (id) => { const select = document.querySelector('#sl-site'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, id); select.dispatchEvent(new Event('change', { bubbles: true })) }; pick('shackleton-rim'); return new Promise((done) => setTimeout(() => { const stayed = document.querySelector('.scout-globe').dataset.pose === window.__pose0; pick('apollo-11'); setTimeout(() => { const dot = document.querySelector('.sl-dot.is-selected'); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const box = dot?.getBoundingClientRect(); done(stayed && dot !== null && dot.getAttribute('aria-label').startsWith('Apollo 11') && box.left >= stage.left && box.right <= stage.right && box.top >= stage.top && box.bottom <= stage.bottom && document.querySelector('.sl-recentre') !== null) }, 1500) }, 700)) })()`],
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
      ['a press opens the strip above the time bar: the skyline all the way round, the Sun and Earth named on it with their paths; the stage gives it the room; the link carries it and the visit keeps it', `${OPEN_SKY} && ${after(900, "(() => { const sky = document.querySelector('.sl-sky'); if (!sky) return 'no strip'; const river = document.querySelector('.sl-river').getBoundingClientRect(); const box = sky.getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const door = document.querySelector('.sl-river .sl-sky-door'); return (document.querySelector('.sl-sky-land')?.getAttribute('d')?.length > 2000 && document.querySelectorAll('.sl-sky-path.is-sun').length > 0 && document.querySelectorAll('.sl-sky-path.is-earth').length > 0 && /Sun/.test(sky.querySelector('svg').textContent) && /Earth/.test(sky.querySelector('svg').textContent) && (window.innerWidth < 761 || (box.bottom <= river.top + 1 && box.top >= stage.bottom - 1 && stage.height < window.__stage)) && /[&#]sky=1/.test(location.hash) && sessionStorage.getItem('sightline.skyFolded') === '0' && (door === null || door.getAttribute('aria-expanded') === 'true')) || 'strip ' + Math.round(box.top) + ' to ' + Math.round(box.bottom) + ', stage ' + Math.round(stage.height) + ' was ' + Math.round(window.__stage) + ', ' + location.hash })()")}`],
      ['the same press folds it again, and the stage takes the room back', `(async () => { let door = document.querySelector('.sl-river .sl-sky-door'); if (!door) { document.querySelector('.sl-river .sl-more').click(); await new Promise((done) => setTimeout(done, 200)); door = document.querySelector('.sl-river .sl-sky-door') } door.click(); return true })() && ${after(900, "(document.querySelector('.sl-sky') === null && !/sky=/.test(location.hash) && Math.abs(document.querySelector('.sl-stage').getBoundingClientRect().height - window.__stage) < 2) || 'still open, or the stage is ' + Math.round(document.querySelector('.sl-stage').getBoundingClientRect().height) + ' not ' + Math.round(window.__stage)")}`],
      ['open again, its own "Fold" folds it too', `${OPEN_SKY} && ${after(700, "(document.querySelector('.sl-sky .sl-fold').click(), true)")} && ${after(1400, "document.querySelector('.sl-sky') === null && sessionStorage.getItem('sightline.skyFolded') === '1'")}`],
      ['in the Surface view the screen is as it was: the strip is not drawn there, and is back in Orbit', `${OPEN_SKY} && ${after(700, `(${click('Surface')}, true)`)} && ${after(3000, `(document.querySelector('.sl-sky') === null || 'the strip is drawn in Surface') && (${click('Orbit')}, true)`)} && ${after(5000, "document.querySelector('.sl-sky') !== null || 'the strip did not come back in Orbit'")}`],
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
    ],
  },
  {
    name: 'river',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [pickDate('2027-05-13T13:00'), click('Year'), click('Month')],
    checks: [
      ['the river draws the month in runs of state', "document.querySelectorAll('.sl-river .sl-run').length > 3"],
      ['a new landing date moves the landing and the playhead with it', `${LANDING} === '13 May 2027 · 13:00 UTC' && ${text('.sl-now')} === '13 May 2027 · 13:00 UTC' && location.hash.includes('t=301')`],
      ['the landing has its marker and the mission its bar', "document.querySelector('.sl-landing') !== null && document.querySelector('.sl-mission') !== null"],
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
      ['with the time bar a day ahead the column still shows the landing\'s sentence and numbers, and a note on the stage says the Moon is showing another moment', `(() => { window.__answer = document.querySelector('.sl-answer').innerText; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })); return true })() && ${after(700, `(() => { const dd = [${rowAbove('sun')}, ${rowAbove('earth')}]; const bar = (document.querySelector('.sl-moment-heights')?.textContent.replace(/\\s*[▸▾]\\s*$/, '').trim() ?? null); return ${text('.sl-now')} === '22 June 2027 · 17:00 UTC' && ${LANDING} === '21 June 2027 · 17:00 UTC' && document.querySelector('.sl-answer').innerText === window.__answer && !/…/.test(window.__answer) && (bar === null || (/^Sun −?\\d+\\.\\d° · Earth −?\\d+\\.\\d° above the skyline$/.test(bar) && bar !== 'Sun ' + dd[0] + ' · Earth ' + dd[1] + ' above the skyline')) && document.querySelector('.sl-river .sl-link') === null && ${NOTE_SAYS('22 June 2027 · 17:00 UTC')} })()`)}`],
      ['"Back to landing" puts the time bar back on the landing, and the note goes', `(${noteLink('Back to landing')}, true) && ${after(600, `${text('.sl-now')} === '21 June 2027 · 17:00 UTC' && ${LANDING} === '21 June 2027 · 17:00 UTC' && document.querySelector('.sl-off-landing') === null && document.querySelector('.sl-answer').innerText === window.__answer`)}`],
      ['"Land here" makes the moment on the time bar the landing: the column updates to it and the note goes', `(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })), true) && ${after(500, `(${noteLink('Land here')}, true)`)} && ${after(700, `(() => { const dd = [${rowAbove('sun')}, ${rowAbove('earth')}]; return ${LANDING} === '22 June 2027 · 17:00 UTC' && document.querySelector('.sl-off-landing') === null && location.hash.startsWith('#a=connecting-ridge@2027-06&t=521&') && document.querySelector('.sl-answer').innerText !== window.__answer && ${LANDING} === '22 June 2027 · 17:00 UTC' && (() => { const bar = (document.querySelector('.sl-moment-heights')?.textContent.replace(/\\s*[▸▾]\\s*$/, '').trim() ?? null); return bar === null || bar === 'Sun ' + dd[0] + ' · Earth ' + dd[1] + ' above the skyline' })() })()`)}`],
      ['"+ Add" then a date yields two scenarios at one site on different dates', `(document.querySelector('.sl-tabs button[aria-label="Add a scenario"]').click(), true) && ${after(400, `document.querySelectorAll('.sl-tabs button[aria-label^="Scenario"]').length === 2 && ${pickDate('2027-08-02T06:00')}`)} && ${after(500, "location.hash.startsWith('#a=connecting-ridge@2027-06&t=521&') && location.hash.includes('list=connecting-ridge@2027-08-02T06') && location.hash.includes('sc=1') && [...document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]')].every((row) => row.title.includes('Connecting Ridge')) && [...document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]')].map((row) => row.textContent.trim()).join('|') === 'A · 22 June 2027|B · 2 August 2027'")}`],
      ['the column has no "Compare another date" or "Land at the playhead" button', "![...document.querySelectorAll('.sl-col button')].some((button) => /Compare another date|playhead/i.test(button.textContent))"],
      ['the tab that adds a scenario is a bare "+", named "Add a scenario"', `(() => { const add = [...document.querySelectorAll('.sl-tabs button')].at(-1); return add.textContent.trim() === '+' && add.getAttribute('aria-label') === 'Add a scenario' })()`],
      ['every tab carries a "−"; B\'s removes B, an undo notice appears, and with one scenario left there is no "−"', `(() => { const minus = [...document.querySelectorAll('.sl-tabs .sl-tab-remove')]; return minus.length === 2 && minus.map((button) => button.getAttribute('aria-label')).join('|') === 'Remove scenario A|Remove scenario B' && minus.every((button) => button.textContent.trim() === '−') && (minus[1].click(), true) })() && ${after(300, "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 1 && document.querySelector('.sl-tabs .sl-tab-remove') === null && !location.hash.includes('list=') && /^Removed scenario B · Undo$/.test(document.querySelector('.sl-removed').textContent.replace(/\\s+/g, ' ').trim())")}`],
    ],
  },
  {
    name: 'mission',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Mission')],
    checks: [
      ['"Mission" in the rail opens the panel, on the default preset', "document.querySelector('.sl-drawer h2')?.textContent === 'Mission' && document.querySelector('.sl-presets button[aria-pressed=\"true\"]')?.textContent.includes('Short stay') && [...document.querySelectorAll('.sl-rail button')].find((button) => button.textContent.trim() === 'Mission').getAttribute('aria-pressed') === 'true' && document.querySelector('.sl-mission-open').getAttribute('aria-expanded') === 'true'"],
      ['"Mission" is the first of the rail\'s tools, above Compare', "(() => { const names = [...document.querySelectorAll('.sl-rail button, .sl-rail a')].map((el) => el.textContent.trim()); return names.indexOf('Mission') === names.indexOf('Compare') - 1 && names.indexOf('Mission') > names.indexOf('Surface') })()"],
      ['the panel holds the presets and the six basic parameters, and nothing else', "(() => { const drawer = document.querySelector('.sl-drawer'); const presets = [...drawer.querySelectorAll('.sl-presets button')].map((button) => button.textContent.replace(/\\s+/g, ' ').trim()); return presets.join('|') === 'Short stay example|Long stay example|Custom' && drawer.querySelectorAll('.sl-param').length === 6 && drawer.querySelector('#sl-m-clear') === null && drawer.querySelector('#sl-m-panel') === null && drawer.querySelector('.sl-assume') === null && drawer.querySelector('details') === null })()"],
      ['the default landing does not fit: the reason, on one line, names the limit', `/^Sun down for \\d+ h; your limit is 24 h$/.test(${text('.sl-reasons li')}.trim()) && document.querySelector('.sl-verdict').classList.contains('is-miss')`, 1200],
      ['every numeric parameter is a slider, and radio silence starts at its last stop, "No limit"', "(() => { const drawer = document.querySelector('.sl-drawer'); const sliders = [...drawer.querySelectorAll('input[type=\"range\"]')]; const silence = drawer.querySelector('#sl-m-silence'); const dark = drawer.querySelector('#sl-m-dark'); return sliders.length === 4 && drawer.querySelector('select') === null && drawer.querySelector('input[type=\"number\"]') === null && silence.type === 'range' && silence.step === dark.step && silence.min === dark.min && Number(silence.max) === 400 + Number(dark.step) && Number(dark.max) === 168 && Number(drawer.querySelector('#sl-m-days').max) === 30 && silence.value === silence.max && silence.closest('.sl-param').querySelector('output').textContent === 'No limit' && silence.getAttribute('aria-valuetext') === 'No limit' })()"],
      ['one stop down from "No limit" is a limit in hours, and the link carries it', `(() => { const silence = document.querySelector('#sl-m-silence'); const set = (value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(silence, String(value)); silence.dispatchEvent(new Event('input', { bubbles: true })) }; set(400); return new Promise((done) => setTimeout(() => { const limited = silence.closest('.sl-param').querySelector('output').textContent === '400 h' && location.hash.includes('limits=14_24_400_1_1'); set(404); setTimeout(() => done(limited && location.hash.includes('limits=14_24_99999_1_1') && silence.closest('.sl-param').querySelector('output').textContent === 'No limit'), 300) }, 300)) })()`],
      ['neither the column nor the Mission panel scrolls', COLUMN_FITS],
      ['the long-stay preset changes the mission, the verdict and the address', `(${click('Long stay example')}, true) && new Promise((done) => setTimeout(() => done(location.hash.includes('limits=60_336_99999_1_1') && location.hash.includes('slope=15') && /Long stay/.test(document.querySelector('.sl-mission-open').textContent) && !/limit is 24 h/.test(document.querySelector('.sl-verdict').textContent)), 400))`],
      ['Long stay sets no limit on radio silence: its slider is at "No limit"', "document.querySelector('#sl-m-silence').getAttribute('aria-valuetext') === 'No limit' && !/radio silence/.test(document.querySelector('.sl-mission-open').textContent)"],
      ['the panel has no caption about how the Sun moves', `!/circles the horizon/.test(${text('.sl-drawer')})`],
      ['with the drawer open, the whole disc is inside the narrower stage with a margin on every side', DISC_INSIDE],
      ['the drawer sits beside the stage, not over it', "window.innerWidth < 761 || document.querySelector('.sl-drawer').getBoundingClientRect().left >= document.querySelector('.sl-stage').getBoundingClientRect().right - 1"],
      ['Advanced is a fold in the same panel, closed at first: no clearance setting and no heights until it is opened', "(() => { const link = document.querySelector('.sl-advanced-link'); return link.getAttribute('aria-expanded') === 'false' && /^Advanced/.test(link.textContent.trim()) && document.querySelector('#sl-m-clear') === null && document.querySelector('.sl-drawer .sl-height-pick') === null })()"],
      ['opened, it holds what the Planner\'s Advanced holds: how far Earth must clear the skyline, the panel\'s and the antenna\'s heights at 2 m, and the note on landing accuracy from the site\'s own files', `(document.querySelector('.sl-advanced-link').click(), true) && ${after(900, `(() => { const drawer = document.querySelector('.sl-drawer'); const pressed = (label) => [...drawer.querySelector('.sl-height-pick[aria-label="' + label + '"]').querySelectorAll('button')].filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent.trim()).join(); const notes = drawer.querySelector('.sl-assume').textContent; return (drawer.querySelector('h2').textContent === 'Mission' && document.querySelector('.sl-advanced-link').getAttribute('aria-expanded') === 'true' && drawer.querySelectorAll('select').length === 1 && drawer.querySelector('#sl-m-clear').value === '0' && pressed('Solar panel height') === '2 m' && pressed('Antenna height') === '2 m' && [...drawer.querySelectorAll('.sl-height-pick button')].every((button) => !button.disabled && button.title.length > 10) && /Landing accuracy: 100 m\\. Within 100 m of this point the Sun is up (between \\d+% and \\d+%|about \\d+%) of the month/.test(notes) && drawer.querySelectorAll('.sl-assume p').length === 1) || notes.slice(0, 160) })()`)}`],
      ['with the fold open the presets are one row and the whole panel is on screen with nothing to scroll, beside the stage, the Moon\'s disc whole', `(() => { if (window.innerWidth < 761) return true; const drawer = document.querySelector('.sl-drawer'); const tops = new Set([...drawer.querySelectorAll('.sl-presets button')].map((button) => Math.round(button.getBoundingClientRect().top))); const last = drawer.lastElementChild.getBoundingClientRect(); const box = drawer.getBoundingClientRect(); return (tops.size === 1 && drawer.scrollHeight <= drawer.clientHeight && last.bottom <= Math.min(box.bottom, innerHeight) && box.left >= document.querySelector('.sl-stage').getBoundingClientRect().right - 1) || 'preset rows ' + tops.size + ', panel ' + drawer.scrollHeight + ' in ' + drawer.clientHeight + ', last ends ' + Math.round(last.bottom) + ' of ' + innerHeight })() && ${DISC_INSIDE} && ${COLUMN_FITS}`],
      ['closing the fold puts the presets back one under another; the panel opened again starts with the fold closed', `(document.querySelector('.sl-advanced-link').click(), true) && ${after(400, "(() => { const tops = new Set([...document.querySelectorAll('.sl-drawer .sl-presets button')].map((button) => Math.round(button.getBoundingClientRect().top))); return document.querySelector('#sl-m-clear') === null && (window.innerWidth < 761 || tops.size === 3) })()")} && ${after(500, `(document.querySelector('.sl-advanced-link').click(), ${click('Close')}, true)`)} && ${after(1000, `(${click(' Mission'.trim())}, true)`)} && ${after(1700, "document.querySelector('.sl-drawer h2')?.textContent === 'Mission' && document.querySelector('.sl-advanced-link').getAttribute('aria-expanded') === 'false'")}`],
      ['nothing the page says in its own words uses "lunar night", "lunar day", "playhead" or "scrub", or "the ridge" for the skyline', OWN_WORDS],
      ['and "‹ Mission" leads back', `(${click('‹ Mission')}, true) && ${after(300, "document.querySelector('.sl-drawer h2').textContent === 'Mission'")}`],
    ],
  },
  {
    name: 'compare',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13',
    steps: [click('Compare')],
    checks: [
      ['a link with two scenarios opens both: two tabs and two river rows', "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 2 && document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]').length === 2"],
      ['with the Compare drawer open, the whole disc is inside the stage with a margin on every side', DISC_INSIDE],
      ['a short list says which site and landing each letter is', "(() => { const items = [...document.querySelectorAll('.sl-compare-legend li')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()); return items.length === 2 && /^A ?Connecting Ridge ?6 May 2027 · 13:00 UTC$/.test(items[0]) && /^B ?Shackleton Rim ?6 May 2027 · 13:00 UTC$/.test(items[1]) })()"],
      ['the table\'s heads are the letters, its rows carry their units, and its cells are bare numbers with the best marked and the hours under each share', "(() => { const heads = [...document.querySelectorAll('.sl-compare thead th')].map((th) => th.textContent.trim()); const rows = [...document.querySelectorAll('.sl-compare tbody tr')]; const names = rows.map((row) => row.querySelector('th').textContent.trim()); const cells = rows.slice(0, 5).flatMap((row) => [...row.querySelectorAll('td')].map((td) => td.textContent.trim())); return heads.join('') === 'AB' && names.join('|') === \"Sunlit, %|Longest dark spell, h|Earth in view, %|Longest radio silence, h|Sun and Earth together, %|Sunlight on a panel, W/m²|Slope, °|At landing|Sun's elevation, °|Sun above the skyline, °|Earth's elevation, °|Earth above the skyline, °|Fits the mission\" && cells.length === 10 && cells.every((cell) => /^[\\d.]+( ★)?( \\d+ of \\d+ h)?$/.test(cell)) && cells.filter((cell) => / of \\d+ h$/.test(cell)).length === 6 && document.querySelectorAll('.sl-compare td.is-best').length > 0 })()"],
      ['the next landing that fits is offered when the landing misses the limits, and adds scenario C, which fits', `/^Next landing that fits: /.test(${text('.sl-next')}.trim()) && (document.querySelector('.sl-next').click(), true) && ${after(2500, `document.querySelectorAll('.sl-compare thead th').length === 3 && location.hash.includes('&sc=2') && /✓ (Yes|Marginal)/.test(document.querySelector('.sl-compare tbody tr:last-child td:last-child').textContent) && /^✓ Fits/.test(${text('.sl-verdict-words')}.trim()) && document.querySelector('.sl-next') === null`)}`],
      ['picking B makes it the scenario on show', "(document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]')[1].click(), true) && new Promise((done) => setTimeout(() => done(document.querySelector('#sl-site').value === 'shackleton-rim' && location.hash.includes('&sc=1')), 300))"],
      ['its tab\'s "−" removes it, leaving two; Compare has no remove button of its own', `(() => { const minus = document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario B"]'); return minus !== null && ![...document.querySelectorAll('.sl-compare button')].some((button) => /Remove/.test(button.textContent)) && (minus.click(), true) })() && new Promise((done) => setTimeout(() => done(document.querySelectorAll('.sl-compare thead th').length === 2 && !location.hash.includes('shackleton-rim')), 300))`],
    ],
  },
  {
    // The easter egg: no Hype button until its name is typed on the screen, outside a text box. Then the button is in the rail and its panel opens.
    name: 'hype-egg',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['before the word is typed there is no Hype button, in the rail or in "More", and nothing names it', "![...document.querySelectorAll('.sl-rail button')].some((button) => /hype/i.test(button.textContent)) && document.querySelector('.sl-hype') === null && document.querySelector('a[href*=\"hype\"]') === null && !/hype/i.test(document.body.innerText)"],
      ['typed into Scout\'s question box, the word is only a word: no button, no panel', `(${OPEN_SCOUT}, true) && ${after(700, "(() => { const box = document.querySelector('#sl-question'); box.focus(); for (const key of 'hype') box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); return true })()")} && ${after(1500, "location.pathname === '/sightline/' && document.querySelector('.sl-hype') === null && document.querySelector('.sl-rail-hype') === null && document.querySelector('.sl-scout-panel') !== null")}`],
      ['typed on the screen, it stays on this page: a Hype button appears in the rail and its panel opens, with the video, its poster and one line', `(document.activeElement?.blur(), ${TYPE_HYPE}) && ${after(1200, "(() => { const panel = document.querySelector('.sl-drawer.sl-hype'); if (!panel) return 'no panel at ' + location.pathname; const video = panel.querySelector('video'); const lines = [...panel.querySelectorAll('p')].map((p) => p.textContent.trim()); const button = window.innerWidth < 761 ? null : document.querySelector('.sl-rail .sl-rail-hype'); return (location.pathname === '/sightline/' && document.querySelector('.sightline.is-plan') !== null && panel.querySelector('h2').textContent === 'Hype' && [...panel.querySelectorAll('.sl-drawer-head button')].map((b) => b.textContent.trim()).join() === 'Close' && video.getAttribute('poster') === '/media/hype-poster.jpg' && video.querySelector('source').getAttribute('src') === '/media/hype.mp4' && video.controls && lines.length === 1 && /^AI-generated/.test(lines[0]) && panel.querySelector('.site-tabs, a') === null && (window.innerWidth < 761 || (button.textContent.trim() === 'Hype' && button.getAttribute('aria-pressed') === 'true')) && sessionStorage.getItem('sightline.hype') === '1') || lines.join(' // ') })()")}`],
      ['the panel is a panel like the others: the same width, nothing scrolling, and the Moon\'s whole disc beside it, not under it', `(() => { const panel = document.querySelector('.sl-hype'); const line = panel.querySelector('p').getBoundingClientRect(); const oneLine = line.height < 1.9 * parseFloat(getComputedStyle(panel.querySelector('p')).fontSize) * 1.5; if (window.innerWidth < 761) return oneLine && panel.scrollHeight <= panel.clientHeight + 1; return (Math.abs(panel.getBoundingClientRect().width - 304) <= 2 && oneLine && panel.scrollHeight <= panel.clientHeight && panel.getBoundingClientRect().left >= document.querySelector('.sl-stage').getBoundingClientRect().right - 1) || Math.round(panel.getBoundingClientRect().width) + ' wide, ' + panel.scrollHeight + ' in ' + panel.clientHeight })() && ${COLUMN_FITS} && (window.innerWidth < 761 || ${DISC_INSIDE})`],
      ['Close shuts it and the button stays; the button opens it again, and Escape shuts it', `(${click('Close')}, true) && ${after(500, `(() => { if (document.querySelector('.sl-hype') !== null) return 'still open'; if (window.innerWidth < 761) { ${click('More')}; } return true })()`)} && ${after(900, "(() => { const button = [...document.querySelectorAll('.sl-rail button')].find((b) => b.textContent.trim() === 'Hype'); if (!button) return 'no button'; button.click(); return true })()")} && ${after(1500, "(document.querySelector('.sl-hype') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true))")} && ${after(2100, "document.querySelector('.sl-hype') === null && [...document.querySelectorAll('.sl-rail button')].some((b) => b.textContent.trim() === 'Hype')")}`],
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
      ['removing B from its own tab while A is on show leaves two, A still on show, and the old C lettered B', `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario B"]').click(), true) && ${after(400, "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]')].map((row) => row.textContent.trim()); const tabs = [...document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]')]; if (rows.join('|') !== 'A · 6 May · Connecting Ridge|B · 1 Jun · de Gerlache Rim') throw new Error(rows.join('|')); return tabs.length === 2 && tabs[0].getAttribute('aria-pressed') === 'true' && document.querySelector('#sl-site').value === 'connecting-ridge' && location.hash.includes('list=de-gerlache-rim@2027-06-01T00') && !location.hash.includes('shackleton-rim') && !location.hash.includes('sc=') })()")}`],
      ['a notice says "Removed scenario B · Undo", and it is not over the Moon', "(() => { const notice = document.querySelector('.sl-removed'); if (!notice) return false; const box = notice.getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const over = box.left < stage.right && box.right > stage.left && box.top < stage.bottom && box.bottom > stage.top; return /^Removed scenario B · Undo$/.test(notice.textContent.replace(/\\s+/g, ' ').trim()) && notice.getAttribute('role') === 'status' && !over })()"],
      ['the tab row still does not wrap', TABS_ONE_ROW],
      ['Undo restores all three in order, with A still on show', `(document.querySelector('.sl-removed button').click(), true) && ${after(400, "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]')].map((row) => row.textContent.trim()); if (rows.join('|') !== 'A · 6 May · Connecting Ridge|B · 6 May · Shackleton Rim|C · 1 Jun · de Gerlache Rim') throw new Error(rows.join('|')); return document.querySelector('.sl-tabs button[aria-label=\"Scenario A\"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.sl-removed') === null && location.hash.includes('list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00') })()")}`],
      ['removing the scenario on show shows the one that takes its place; the notice goes after about five seconds', `(document.querySelector('.sl-tabs .sl-tab-remove[aria-label="Remove scenario A"]').click(), true) && ${after(400, "document.querySelector('#sl-site').value === 'shackleton-rim' && document.querySelector('.sl-tabs button[aria-label=\"Scenario A\"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.sl-removed') !== null")} && ${after(5600, "document.querySelector('.sl-removed') === null && document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 2")}`],
    ],
  },
  {
    // Four sites on four dates, the longest labels: none is cut, whichever panel is open.
    name: 'rows-panels',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    checks: [
      ['with sites and dates both differing, a row shows its letter, a short date and its site', "(() => { const rows = [...document.querySelectorAll('.sl-river .sl-row-name')].map((row) => row.textContent.replace(/\\s+/g, ' ').trim()); return rows.join('|') === 'A · 6 May · Connecting Ridge|B · 6 May · Shackleton Rim|C · 1 Jun · de Gerlache Rim|D · 10 Jul · Peak near Shackleton' || rows.join('|') })()", 1500],
      ['with no panel open no label is cut', `window.innerWidth < 761 || ${LABELS_WHOLE}`],
      ['with Scout\'s panel open no label is cut', `window.innerWidth < 761 || ((document.querySelector('.sl-rail .sl-rail-scout').click(), true) && ${after(700, `document.querySelector('.sl-scout-panel') !== null && ${LABELS_WHOLE}`)})`],
      ['with the Mission panel open no label is cut', `window.innerWidth < 761 || ((${click('Mission')}, true) && ${after(700, `document.querySelector('.sl-drawer') !== null && document.querySelector('.sl-scout-panel') === null && ${LABELS_WHOLE}`)})`],
      ['with the Compare panel open no label is cut', `window.innerWidth < 761 || ((${click('Compare')}, true) && ${after(700, `document.querySelector('.sl-compare') !== null && ${LABELS_WHOLE}`)})`],
      ['with the Layers panel open no label is cut', `window.innerWidth < 761 || (([...document.querySelectorAll('.sl-rail > button')].find((button) => button.textContent.trim().startsWith('Layers')).click(), true) && ${after(700, `document.querySelector('.sl-compare') === null && document.querySelector('.sl-drawer') !== null && ${LABELS_WHOLE}`)})`],
      ['each label\'s tooltip and accessible name still say the site and the landing in full', "[...document.querySelectorAll('.sl-river .sl-row-name')].every((row) => /2027/.test(row.title || row.dataset.tip || '') && /2027/.test(row.getAttribute('aria-label') ?? ''))"],
    ],
  },
  {
    // A first visit: on a laptop Scout's card is open beside the Moon, as tall as the empty sky; on a phone he is his mark and one line.
    name: 'scout-first',
    hash: '',
    still: true,
    scoutFirst: true,
    checks: [
      ['on a laptop the page opens with his card open, his greeting, three ideas and an input that has not taken the focus; on a phone he is shut', "window.innerWidth < 1180 ? document.querySelector('.sl-card') === null && document.querySelector('.scout-face').getAttribute('aria-expanded') === 'false' : (() => { const card = document.querySelector('.sl-card'); return card !== null && card.querySelector('.sl-hello p') !== null && card.querySelectorAll('.sl-idea').length === 3 && card.querySelector('.sl-ask input') !== null && document.activeElement !== card.querySelector('.sl-ask input') })()", 600],
      ['the card takes most of the height of the stage, under the name of the page, and is not over the disc of the Moon or the play control', `window.innerWidth < 1180 || (() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const nearX = Math.max(card.left, Math.min(cx, card.right)); const nearY = Math.max(card.top, Math.min(cy, card.bottom)); const clear = Math.hypot(cx - nearX, cy - nearY) >= r; const pill = document.querySelector('.sl-pill').getBoundingClientRect(); const name = document.querySelector('.sl-brand').getBoundingClientRect(); return (card.height >= 0.6 * stage.height && card.top >= name.bottom && clear && (card.right <= pill.left || card.bottom <= pill.top)) || JSON.stringify({ height: card.height, stage: stage.height, top: card.top, name: name.bottom, clear }) })()`, 1500],
      ['the tour has a chip of its own, outlined until the tour is taken: under his mark on a laptop, under the key on a phone, clear of the card, the play control and the disc of the Moon', "(() => { const chip = document.querySelector('.sl-tour-chip'); if (!chip) return 'no chip'; const at = chip.getBoundingClientRect(); const apart = (sel) => { const el = document.querySelector(sel); if (!el) return true; const b = el.getBoundingClientRect(); return at.right <= b.left || at.left >= b.right || at.bottom <= b.top || at.top >= b.bottom }; const globe = document.querySelector('.scout-globe').getBoundingClientRect(); const r = Number(document.querySelector('.scout-globe').dataset.discPx) / 2; const cx = (globe.left + globe.right) / 2; const cy = (globe.top + globe.bottom) / 2; const clear = Math.hypot(cx - Math.max(at.left, Math.min(cx, at.right)), cy - Math.max(at.top, Math.min(cy, at.bottom))) >= r; const face = document.querySelector('.scout-face').getBoundingClientRect(); const placed = window.innerWidth < 900 ? at.top < window.innerHeight / 3 : at.top >= face.bottom; return (chip.textContent.trim().endsWith('One-minute tour') && chip.classList.contains('is-new') && placed && clear && apart('.sl-card') && apart('.sl-pill') && apart('.sl-watch-key') && apart('.sl-brand') && apart('.scout-face') && at.left >= 0 && at.right <= window.innerWidth) || JSON.stringify({ at, placed, clear }) })()", 600],
      ['shutting the card is kept for the visit, not for good', `window.innerWidth < 1180 || ((document.querySelector('.sl-card .sl-card-head button').click(), true) && ${after(300, "document.querySelector('.sl-card') === null && sessionStorage.getItem('sightline.scoutShut') === '1' && localStorage.getItem('sightline.scoutShut') === null")})`],
      ['his mark opens it again, as tall as before, and that is remembered too', `window.innerWidth < 1180 || ((document.querySelector('.scout-face').click(), true) && ${after(500, "document.querySelector('.sl-card.is-tall') !== null && sessionStorage.getItem('sightline.scoutShut') === '0'")})`],
      ['the chip starts the tour at its first step, and is gone while the tour is on', `(document.querySelector('.sl-tour-chip').click(), true) && ${after(900, "document.querySelector('.sl-tour') !== null && document.querySelector('.sl-tour-chip') === null && localStorage.getItem('sightline.tourTaken') === '1'")}`],
    ],
  },
  {
    // Scout stays open from Watch into Plan and back, until the visitor shuts him. A phone is left as it was: his panel is a full sheet there.
    // Motion is left on here, so the card is really drawn growing into the panel.
    name: 'scout-plan',
    hash: '',
    scoutFirst: true,
    checks: [
      ['"Plan a landing" opens Plan with his panel open beside it (on a phone, with no panel over it), and the greeting’s ideas give way to the panel’s own', `(${click('Plan a landing')}, true) && ${after(900, "document.querySelector('.sightline.is-plan') !== null && document.querySelector('.sl-card') === null && (document.querySelector('.sl-scout-panel') !== null) === (window.innerWidth >= 761)")}`],
      ['the card and the panel have one name for the browser to draw the one growing into the other', "window.innerWidth < 761 || getComputedStyle(document.querySelector('.sl-scout-panel')).viewTransitionName === 'scout'"],
      ['Home brings his card back in Watch', `window.innerWidth < 761 || ((document.querySelector('.sl-rail-home').click(), true) && ${after(900, "document.querySelector('.sightline.is-watch') !== null && document.querySelector('.sl-card') !== null && getComputedStyle(document.querySelector('.sl-card')).viewTransitionName === 'scout'")})`],
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
    // The rail on a phone is one row: the heights, Scout and "More", which opens the rest as a short menu.
    name: 'rail',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['on a laptop the rail is as it was, with no "More"', "window.innerWidth < 761 || (document.querySelector('.sl-rail-more') === null && document.querySelector('.sl-rail-menu') === null && [...document.querySelectorAll('.sl-rail > button')].map((button) => button.firstChild.textContent.trim() || button.textContent.trim()).join('|') === 'Layers|Scout|Mission|Compare|Accuracy|Planner|New Planner|How it works|Home')"],
      ['on a phone the rail is one row: the three heights, Scout and "More"', "window.innerWidth > 760 || (() => { const rail = document.querySelector('.sl-rail'); const shown = [...rail.children].filter((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0); const names = shown.map((el) => (el.classList.contains('sl-heights') ? [...el.querySelectorAll('button')].map((b) => b.textContent.trim()).join('/') : el.textContent.trim())); const boxes = shown.map((el) => el.getBoundingClientRect()); const oneRow = boxes.every((box) => box.top < boxes[0].bottom && box.bottom > boxes[0].top) && boxes.every((box) => box.left >= 0 && box.right <= window.innerWidth); return (names.join('|') === 'Orbit/Site/Surface|Scout|More' && oneRow && rail.getBoundingClientRect().height < 60) || names.join('|') + ' one row: ' + oneRow + ' height ' + rail.getBoundingClientRect().height })()"],
      ['"More" opens the rest as a short menu, inside the window, on an opaque ground', `window.innerWidth > 760 || ((${click('More')}, true) && ${after(300, "(() => { const menu = document.querySelector('.sl-rail-menu.is-open'); if (!menu) return false; const names = [...menu.querySelectorAll('button')].map((button) => button.firstChild.textContent.trim() || button.textContent.trim()); const box = menu.getBoundingClientRect(); return (names.join('|') === 'Layers|Mission|Compare|Accuracy|Planner|New Planner|How it works|Home|Tour' && box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight && /^rgb\\(/.test(getComputedStyle(menu).backgroundColor) && document.querySelector('.sl-rail-more').getAttribute('aria-expanded') === 'true') || names.join('|') + ' ' + JSON.stringify(box) })()")})`],
      ['Escape closes the menu', `window.innerWidth > 760 || ((window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true) && ${after(300, "document.querySelector('.sl-rail-menu.is-open') === null && document.querySelector('.sl-rail-more').getAttribute('aria-expanded') === 'false'")})`],
      ['a choice from the menu does its work and closes the menu', `window.innerWidth > 760 || ((${click('More')}, true) && ${after(300, `(${click('Mission')}, true)`)} && ${after(900, "document.querySelector('.sl-rail-menu.is-open') === null && document.querySelector('.sl-drawer') !== null")})`],
    ],
  },
  {
    name: 'compare-four',
    hash: '#a=connecting-ridge@2027-05&t=133&limits=14_24_99999_1_1&mode=plan&list=shackleton-rim@2027-05-06T13~de-gerlache-rim@2027-06-01T00~peak-near-shackleton@2027-07-10T12',
    steps: [click('Compare')],
    checks: [
      ['four scenarios: four tabs, four rows on the river, four columns in Compare', "document.querySelectorAll('.sl-tabs button[aria-label^=\"Scenario\"]').length === 4 && document.querySelectorAll('.sl-river .sl-row-name[aria-pressed]').length === 4 && [...document.querySelectorAll('.sl-compare thead th')].map((th) => th.textContent.trim()).join('') === 'ABCD'", 600],
      ['the four tabs stay on one row at the column\'s width, each with its "−" on its corner', `document.querySelectorAll('.sl-tabs button').length === 8 && ${TABS_ONE_ROW} && ${BADGES_ON_CORNERS}`],
      ['with Compare open the page says "skyline", never "the ridge", for the terrain\'s outline', OWN_WORDS],
      ['on a phone each letter is a comfortable touch target, and each badge has one larger than it looks', "window.innerWidth > 760 || ([...document.querySelectorAll('.sl-tabs .sl-tab > button:first-child, .sl-tabs > button')].every((button) => button.getBoundingClientRect().width >= 36 && button.getBoundingClientRect().height >= 36) && [...document.querySelectorAll('.sl-tabs .sl-tab-remove')].every((badge) => badge.getBoundingClientRect().width - 2 * parseFloat(getComputedStyle(badge, '::after').top) >= 34))"],
      ['with four there is no tab to add a fifth', "document.querySelector('.sl-tabs button[aria-label=\"Add a scenario\"]') === null"],
      ['the note under Compare\'s table is "★ best in its row" and nothing more', "(() => { const notes = [...document.querySelectorAll('.sl-compare .sl-quiet')].map((note) => note.textContent.trim()); return (notes.length === 1 && notes[0] === '★ best in its row') || notes.join(' | ') })()"],
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
      ['asking sends the point and the hour on show to the site\'s own server, never to JPL, and puts NASA\'s two elevations beside the page\'s own (the elevations in the hover text of the Sun\'s and Earth\'s rows)', `(async () => { const real = window.fetch; const sent = []; window.fetch = async (url, init) => { if (!String(url).includes('/api/chat/horizons')) return real(url, init); sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ sun: { azDeg: 100.5, elDeg: -2.053957 }, earth: { azDeg: 200.25, elDeg: 1.234 }, ephemeris: 'DE441', cached: false }), { status: 200, headers: { 'content-type': 'application/json' } }) }; document.querySelector('.sl-horizons button').click(); await new Promise((done) => setTimeout(done, 600)); window.fetch = real; const words = document.querySelector('.sl-horizons').textContent; const body = sent[0]?.body; const shown = ['sun', 'earth'].map((name) => Number(/Elevation (−?\\d+(\\.\\d+)?)/.exec(document.querySelector('.sl-fact.is-' + name).getAttribute('title') ?? document.querySelector('.sl-fact.is-' + name).dataset.tip ?? '')[1].replace('−', '-'))); const ours = (/ours (.+)$/.exec(words)?.[1] ?? '').split(', ').map((value) => Number(value.replace('°', '').replace('−', '-'))); return (sent.length === 1 && sent[0].url.startsWith('/api/chat/horizons') && body.lat === -88.5 && body.lon === 40 && /^2027-05-\\d\\dT\\d\\d:00:00Z$/.test(body.hour) && /^Horizons: Sun −2\\.05°, Earth 1\\.23° · ours /.test(words) && ours.length === 2 && ours.every((value, i) => Math.abs(value - shown[i]) <= 0.051)) || 'sent ' + JSON.stringify(sent).slice(0, 120) + '; shows: ' + words + '; the page has ' + JSON.stringify(shown) + ', the line has ' + JSON.stringify(ours) })()`],
      ['the answer is one quiet line, and the column still does not scroll', `(() => { const line = document.querySelector('.sl-horizons'); return window.innerWidth < 761 || getComputedStyle(line).display === 'none' || line.getBoundingClientRect().height < 22 })() && ${COLUMN_FITS}`],
      ['a custom point opens in Quickmap and Moon Trek, and not in Horizons: its height was never worked out', `${siteMore('__tools')} && ${after(400, "[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap,Moon Trek'")}`],
    ],
  },
  {
    // The answer's line about JPL Horizons, at a listed site: the same link as plan-link, the fullest column.
    name: 'horizons',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    checks: [
      ['the answer says how closely this site matches Horizons, from the comparison file, which covers every hour of the data', `(async () => { const file = await fetch('/data/horizons.json').then((r) => r.json()); const within = (Math.ceil(file.sites['shackleton-rim'].max_deg * 100 - 1e-9) / 100).toFixed(2) + '°'; return ${text('.sl-horizons')}.trim().startsWith('✓ Matches Horizons within ' + within) && file.sites['shackleton-rim'].hours === (await fetch('/data/range.json').then((r) => r.json())).hours })()`, 1500],
      ['Reproduce in Horizons opens NASA\'s own query for this site and this hour, once for the Sun and once for Earth', `(async () => { const [file, sites] = await Promise.all(['horizons.json', 'sites.json'].map((name) => fetch('/data/' + name).then((r) => r.json()))); const site = sites.find((s) => s.id === 'shackleton-rim'); const point = "'" + [((site.lon % 360) + 360) % 360, site.lat, file.sites[site.id].alt_km].join(',') + "'"; const links = [...document.querySelectorAll('.sl-horizons a')].map((a) => new URL(a.href)); return links.length === 2 && links.every((u) => u.origin + u.pathname === 'https://ssd.jpl.nasa.gov/api/horizons.api' && u.searchParams.get('SITE_COORD') === point && u.searchParams.get('CENTER') === "'coord@301'" && u.searchParams.get('START_TIME') === "'2027-05-06 13:00'" && u.searchParams.get('QUANTITIES') === "'4'") && links[0].searchParams.get('COMMAND') === "'10'" && links[1].searchParams.get('COMMAND') === "'399'" && [...document.querySelectorAll('.sl-horizons a')].every((a) => a.target === '_blank' && a.title.startsWith('Reproduce in Horizons')) })()`],
      ['the line is one quiet line under the rows, with a tick, and the column still does not scroll', `(() => { const line = document.querySelector('.sl-horizons'); const rows = document.querySelector('.sl-facts'); const col = document.querySelector('.sl-col'); const ok = getComputedStyle(line).display !== 'none' && line.getBoundingClientRect().top >= rows.getBoundingClientRect().bottom && (window.innerWidth < 761 || line.getBoundingClientRect().height < 22) && ${COLUMN_FITS}; if (!ok) throw new Error('line ' + Math.round(line.getBoundingClientRect().height) + ' px high; column ' + col.scrollHeight + ' of ' + col.clientHeight + ' px high'); return true })()`],
      ['the query is for the landing\'s hour: moving the time bar leaves it, and "Land here" moves it', `(${key('ArrowRight')}, true) && ${after(400, `new URL(document.querySelector('.sl-horizons a').href).searchParams.get('START_TIME') === "'2027-05-06 13:00'" && (${noteLink('Land here')}, true)`)} && ${after(400, `new URL(document.querySelector('.sl-horizons a').href).searchParams.get('START_TIME') === "'2027-05-06 14:00'"`)}`],
    ],
  },
  {
    // The site on show, opened in NASA's tools: three links inside the site field's disclosure.
    name: 'open-in',
    hash: '#a=shackleton-rim@2027-05&t=133&limits=14_24_99999_1_1&mode=plan',
    steps: [siteMore('__tools')],
    checks: [
      ['the site field opens on three links, in a line: Quickmap, Moon Trek, Horizons', `[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap,Moon Trek,Horizons' && ${text('.sl-open-in')}.startsWith('Open in ') && [...document.querySelectorAll('.sl-open-in a')].every((a) => a.target === '_blank' && a.title.startsWith('Open in ' + a.textContent))`, 1500],
      ['Quickmap opens 40 km of ground on its south-pole view, centred on the site as the app\'s own list gives it', `(async () => { const site = (await fetch('/data/sites.json').then((r) => r.json())).find((s) => s.id === 'shackleton-rim'); const url = new URL(document.querySelectorAll('.sl-open-in a')[0].href); const [x0, y0, x1, y1] = url.searchParams.get('prjExtent').split(',').map(Number); const r = 1737400 * Math.cos(site.lat * Math.PI / 180); const x = r * Math.sin(site.lon * Math.PI / 180); const y = r * Math.cos(site.lon * Math.PI / 180); return url.origin === 'https://quickmap.lroc.im-ldi.com' && url.searchParams.get('proj') === '17' && x1 - x0 === 40000 && y1 - y0 === 40000 && Math.abs((x0 + x1) / 2 - x) <= 1 && Math.abs((y0 + y1) / 2 - y) <= 1 })()`],
      ['Moon Trek opens its south-pole map on the same place', `(() => { const url = new URL(document.querySelectorAll('.sl-open-in a')[1].href); const hash = new URLSearchParams(url.hash.slice(1)); return url.origin + url.pathname === 'https://trek.nasa.gov/moon/' && hash.get('p') === 'urn:ogc:def:crs:IAU2000::30120' && Math.hypot(Number(hash.get('x')), Number(hash.get('y'))) < 160000 })()`],
      ['Horizons opens the Sun\'s query for the site at the landing hour', `(() => { const url = new URL(document.querySelectorAll('.sl-open-in a')[2].href); return url.origin + url.pathname === 'https://ssd.jpl.nasa.gov/api/horizons.api' && url.searchParams.get('COMMAND') === "'10'" && url.searchParams.get('START_TIME') === "'2027-05-06 13:00'" })()`],
      ['the links open in a small block under the site control, with a close button, and the column does not scroll', `document.querySelector('.sl-plan-more .sl-open-in') !== null && document.querySelector('.sl-plan-more button[aria-label="Close"]') !== null && document.querySelector('.sl-coords summary, .sl-col details') === null && ${COLUMN_FITS}`],
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
      ['"Light and shadow" is a layer, off by default, that a polar site can switch on', `(${click('Layers')}, true) && ${after(900, "(() => { const own = document.querySelector('.sl-layer-own input'); return own !== null && !own.checked && !own.disabled && /Light and shadow/.test(document.querySelector('.sl-layer-own').textContent) })()")}`],
      ['switched on, the ground\'s brightness changes: shadow from the light grid, for the hour on the clock', `(() => { const moon = document.querySelector('.sl-moon'); const last = (frames) => frames[frames.length - 1]; return (${MOON_FRAMES(300)}).then((frames) => { window.__plain = last(frames); document.querySelector('.sl-layer-own input').click(); return new Promise((done) => { const until = Date.now() + 20000; const look = () => (moon.dataset.grid === 'on' && moon.dataset.gridSun !== '') || Date.now() > until ? done() : setTimeout(look, 200); look() }) }).then(() => new Promise((done) => setTimeout(done, 2500))).then(() => ${MOON_FRAMES(300)}).then((frames) => { const lit = last(frames); if (moon.dataset.grid !== 'on' || moon.dataset.gridSun === '') return 'the light grid did not arrive'; window.__shaded = lit; return Math.abs(lit.mean - window.__plain.mean) > 0.5 || 'the ground did not change: mean ' + window.__plain.mean.toFixed(2) + ' to ' + lit.mean.toFixed(2) }) })()`],
      ['the grid has the site sunlit at this hour, and so does the answer: the picture and the numbers agree', `document.querySelector('.sl-moon').dataset.gridSun === 'true' && /^(Sunlit|Partly sunlit)/.test(${SENTENCE})`],
      ['its caption says what one cell of the grid covers', `/One cell is \\d+ m of ground/.test(${text('.sl-layer-shade')}) || ${text('.sl-layer-shade')}`],
      ['it only darkens: no point of the ground is brighter with it on', `(() => { const brighter = window.__shaded.points.filter((value, k) => value > window.__plain.points[k] + 6).length; return brighter === 0 || brighter + ' points are brighter with the layer on' })()`],
      ['with it on and nothing touched, every frame is the same picture', MOON_STILL(1500)],
      ['switched off, the picture is exactly what it was before', `(() => { document.querySelector('.sl-layer-own input').click(); return new Promise((done) => setTimeout(done, 3000)).then(() => ${MOON_FRAMES(300)}).then((frames) => { const now = frames[frames.length - 1]; return (document.querySelector('.sl-moon').dataset.grid === 'off' && now.sum === window.__plain.sum) || 'not the same picture: mean ' + window.__plain.mean.toFixed(3) + ' before, ' + now.mean.toFixed(3) + ' after' }) })()`],
      ['back in Orbit the bar and the arrow are gone', `(${click('Orbit')}, true) && ${after(1500, "document.querySelector('.sl-scale') === null && document.querySelector('.sl-to-earth') === null")} && (${click('Site')}, true)`],
    ],
    notes: [['frame rate close on the site with Light and shadow on, while time plays', `(document.querySelector('.sl-layer-own input').click(), ${click('Play')}, true) && ${after(3000, 'true')}.then(() => ${FRAME_RATE}).then((words) => { ${click('Pause')}; return words })`]],
  },
  {
    // Close on Connecting Ridge two hours after the Sun sets there (the site's own track has it up until hour 452 of May 2027 and down from 453).
    name: 'site-dark',
    hash: '#a=connecting-ridge@2027-05&t=455&limits=14_24_99999_1_1&mode=plan',
    steps: [click('Site'), click('Layers'), "document.querySelector('.sl-layer-own input').click()"],
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
      ['its tooltip says what is true about it and that it is not to scale', `(() => { const name = document.querySelector('.sl-earth-name'); return name !== null && /^Earth, on the side of the Moon it lies toward and lit as it is at this moment \\(\\d+% of its face in sunlight from here\\)\\. Not to scale/.test(name.title) && name.getAttribute('aria-label') === name.title })()`],
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
      ['the field says where the point comes from: the IAU centre, and NASA\'s own sentence with its date', `(() => { const title = document.querySelector('#sl-site').title; return title.startsWith('Approximate region: the centre of Mons Mouton in the IAU Gazetteer. NASA names the place and gives no coordinates') && title.includes('will deliver six NASA CLPS science payloads to Mons Mouton.') && /NASA, 2026-06-10/.test(title) })()`],
      ['it opens in Quickmap like any point (Moon Trek\'s south-pole link is proven to 158 km from the pole; this centre is 164 km out)', `${siteMore('__tools')} && ${after(400, "[...document.querySelectorAll('.sl-open-in a')].map((a) => a.textContent).join() === 'Quickmap'")}`],
      ['the column does not scroll with that block open', COLUMN_FITS],
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
      ['with nothing asked, Scout offers the rover idea among its ideas, and the mission is still the short stay', `${OPEN_SCOUT} && ${after(500, `[...document.querySelectorAll('.sl-talk .sl-idea.is-action')].map((idea) => idea.textContent).join('|') === 'Plan for Canada’s utility rover' && ${text('.sl-mission-open b')} === 'Short stay'`)}`, 1500],
      ['picking it selects the Long stay and opens the rover\'s panel in Scout\'s place', `(document.querySelector('.sl-idea.is-action').click(), true) && ${after(900, `${text('.sl-mission-open b')} === 'Long stay' && document.querySelector('.sl-rover') !== null && document.querySelector('.sl-scout-panel') === null`)}`],
      ['a panel quotes the Canadian Space Agency word for word, and says it has published no landing site', `(() => { const words = ${text('.sl-rover')}; return ['“Concept development”', '“In the 2030s”', '“survive the roughly two-week-long lunar night, with temperatures as low as -200 °C”', '“surveying for ice or other resources”', 'The agency has published no landing site.'].every((part) => words.includes(part)) })()`],
      ['it says in two sentences why that is hard at the pole, with the Long stay\'s own numbers', `(() => { const why = ${text('.sl-rover-why')}; return why.split('. ').length === 2 && /60 days, at most 14 days without Sun and no limit on time without Earth/.test(why) && /the skyline can hide it for days/.test(why) })()`],
      ['it links to the agency\'s page', `(() => { const link = document.querySelector('.sl-rover a'); return link.href === 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/canadian-utility-rover-on-the-moon.asp' && link.target === '_blank' && /^Canadian Space Agency: /.test(link.textContent) })()`],
      ['"lunar night" appears only inside the agency\'s quotation', `(() => { const all = document.body.innerText; const outside = all.replace(/“[^”]*”/g, ''); return /lunar night/.test(all) && !/lunar night|lunar day/i.test(outside) })()`],
      ['neither the column nor the panel scrolls', COLUMN_FITS],
      ['reopening Scout, his panel says what the idea did', `(document.querySelector('.sl-rail-scout').click(), true) && ${after(500, `${text('.sl-talk .sl-said.is-scout')} === 'Mission set to Long stay. The panel on the right says why that is hard at the pole.'`)}`],
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
      ['this close, over a picture that is not tied to the marker\'s coordinates, the marker is an open ring of 50 m of ground (232 px across here), and its words say so; a phone, which stays at Site view\'s own zoom, keeps the dot', `(() => { const dot = document.querySelector('.sl-dot.is-selected'); const scale = (2 * 1737400) / Number(document.querySelector('.scout-globe').dataset.discPx); if (scale >= 5) return !dot.classList.contains('is-within') || 'a ring at ' + scale.toFixed(1) + ' m a screen pixel'; const ring = dot.querySelector('.sl-within'); if (!ring) return 'no ring at ' + scale.toFixed(2) + ' m a screen pixel'; const across = ring.getBoundingClientRect().width; if (Math.abs(across - 100 / scale) > 3) return 'the ring is ' + Math.round(across) + ' px across, 100 m is ' + Math.round(100 / scale); if (!/Within about 50 m: this picture is not tied/.test(dot.title)) return 'its words: ' + dot.title; const fill = getComputedStyle(dot); return (fill.backgroundColor === 'rgba(0, 0, 0, 0)' && fill.outlineStyle === 'none') || 'the dot is still drawn inside the ring' })()`],
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
      ['the card is then taller than half the stage\'s old limit allowed, still within 70% of the stage (75% of the screen on a phone), and clear of the Moon\'s disc', `(() => { const card = document.querySelector('.sl-card').getBoundingClientRect(); const stage = document.querySelector('.sl-stage').getBoundingClientRect(); const limit = window.innerWidth < 761 ? window.innerHeight * 0.75 : stage.height * 0.7; return (card.height <= limit + 1 && card.top >= 0 && card.bottom <= window.innerHeight) || Math.round(card.height) + ' of ' + Math.round(limit) })() && ${CARD_CLEAR}`],
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
    checks: [['"/#how" opens How it works over Sightline, and closing it leaves the front page', `(document.querySelector('.sl-how') !== null && document.querySelector('.sightline') !== null && (window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true)) && ${after(600, "document.querySelector('.sl-how') === null && location.pathname === '/' && location.hash === ''")}`]],
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
          const { cx, cy, r } = await evaluate("(() => { const globe = document.querySelector('.scout-globe'); const box = globe.getBoundingClientRect(); return { cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2, r: Number(globe.dataset.discPx) / 2 } })()")
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
