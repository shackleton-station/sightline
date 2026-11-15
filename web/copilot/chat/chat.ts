import type Anthropic from '@anthropic-ai/sdk'
import { hourOf, locateHour } from '../../src/lib/mission'
import { distanceKm } from '../../src/lib/slip'
import type { SiteInfo } from '../../src/data/contract'
import { parseCustomSite, type ViewState } from '../../src/lib/urlState'
import type { Model } from '../model'
import { callModel, fallbackRan, MODEL_CALL_TIMEOUT_MS, type ModelGuard, modelGuard } from '../modelCall'
import { span } from '../../shared/trace'
import { asksToChangeLimits, buildActions, type ChatAction, LIMIT_ARGS } from './actions'
import type { Args } from '../../shared/tools/args'
import type { SiteData } from '../../shared/tools/data'
import { distanceWords, fact, type Fact, isoAt, latitudeLabel, limitFacts, limitsLabel, longitudeLabel, monthWords, whenLabel } from '../../shared/tools/facts'
import { yearsOf } from '../../src/lib/span'
import { asksAboutPresent, dateBasis, type DateBasis, dayLabel, realHourIso } from './dates'
import { buildPrompt, systemPrompt } from './prompt'
import { cleanFollowup, fallbackAnswer, renderAnswer, type FactBook, visitorsAmounts } from './render'
import { scenarioScene } from './scenarios'
import type { HorizonsAsk } from '../../shared/tools/horizonsTool'
import { kmLabel } from '../../shared/tools/spotTools'
import type { Tie } from '../../shared/tools/ties'
import { ANSWER_TOOL, runTool, toolDeclarations } from '../../shared/tools/tools'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ChatReply {
  text: string
  /**
   * A question the page can ask with one press: the same question for the date on the time bar,
   * offered when the answer was about the present and the bar is on another day.
   */
  ask?: { label: string; question: string }
  /** Buttons that open the views the answer talks about. */
  actions: ChatAction[]
  /** What was looked up to answer, in the order it was looked up. */
  sources: string[]
  followups: string[]
}

/**
 * `fellBack` is true when the model couldn't produce a clean answer and the server wrote one from the facts.
 * `refusal` is set when the model declined the question (`stop_reason: "refusal"`), even after the
 * server-side fallback had its go: the reply then says plainly that it could not be answered, and
 * `category` is the API's reason (`stop_details.category`, null when it names none). `servedBy` names
 * the fallback model when one wrote any part of the answer.
 * A failure says why: `circuit-open` (the breaker refused, no call was made), `busy` (the model was out
 * of capacity) or `failed`; and, when known, how long to wait before asking again.
 */
export type ChatOutcome =
  | { ok: true; reply: ChatReply; fellBack: boolean; refusal?: { category: string | null }; servedBy?: string }
  | { ok: false; why: 'circuit-open' | 'busy' | 'failed'; retryAfterMs: number | null }

/** At most this many calls to the model per question; the last is told to answer. */
const MAX_ROUNDS = 5
/** A question's whole time: every model call, retries included, starts and ends inside it. */
export const CHAT_DEADLINE_MS = 25_000
const DEADLINE_MS = CHAT_DEADLINE_MS
/**
 * Room for one call's thinking and its reply together (thinking counts toward it, though its text
 * is not returned). The most measured in one call was 598 output tokens (Fable 5.2 at high effort; 550 on
 * Opus 5.5 at low), so this leaves more than three times that (docs/decisions/0009-copilot-on-claude.md).
 */
export const CHAT_MAX_TOKENS = 2048
/** A draft that breaks the number rule is sent back once; after that the server writes the answer. */
const ANSWER_RETRIES = 1

/** What the visitor reads when the model declines a question. Honest, and with no reason it cannot back up. */
export const REFUSAL_TEXT = "I can't answer that one: the language model behind me declined the question. I can tell you when the Sun and Earth are up at the listed sites, and when a landing fits your limits."

/** The line added to the last round's message: the model may no longer be forced to call a tool, so it is asked to. */
export const LAST_ROUND = `This is your last turn: call ${ANSWER_TOOL} now with the facts you have.`

/** What the visitor is looking at, as facts the model can cite like any tool result (reference r0). */
export async function viewFacts(view: ViewState, data: SiteData, spot: { lat: number; lon: number } | null = null, watching = false, dates: ViewDates | null = null): Promise<Fact[]> {
  const sites = await data.sites()
  const [first] = sites
  const flags = await data.flags(first.id)
  const describe = (siteId: string, key: string, label: string): Fact[] => {
    const listed = sites.find((site) => site.id === siteId)
    if (listed) return [fact(key, label, listed.name)]
    const point = parseCustomSite(siteId)
    if (!point) return []
    const nearest = sites.map((site) => ({ site, km: distanceKm(point, site) })).sort((a, b) => a.km - b.km)[0]
    return [
      fact(key, label, 'a custom point (not a listed site, so the tools cannot look it up; the column on the visitor\'s screen is worked out for the exact point, and your figures are for the nearest listed site)'),
      fact(`${key}_nearest`, 'Nearest listed site', nearest.site.name),
      fact(`${key}_nearest_distance`, 'Its distance from the custom point', distanceWords(nearest.km)),
    ]
  }
  const monthStart = hourOf(flags.start, `${view.a.month}-01T00:00:00Z`)
  // On the opening screen (Watch) the visitor is looking at the whole Moon and has chosen no site:
  // the link names a site only because a link must, so it is not passed on as theirs.
  // The date the answer is for, decided from the question (dates.ts): the real date for a question
  // about the present, the time bar's for one about the screen. The view already holds that date.
  const present = dates?.basis === 'present'
  const when = [
    fact('month', present ? 'The real month now ("this month"): the month this answer is for' : 'Month on screen', monthWords(view.a.month)),
    fact('time', present ? 'The real date and hour now, UTC ("now", "today", "tonight"): the hour this answer is for' : 'Hour on screen', whenLabel(isoAt(flags.start, monthStart + view.index))),
    ...(present ? [fact('year', 'The real year now ("this year")', view.a.month.slice(0, 4))] : []),
    ...(dates ? [fact('date_asked', 'Which date the question is about (already decided: use month and time as given)', present ? 'the present: the real date, not the time bar' : 'what the screen shows: the date on the time bar')] : []),
    ...(dates && present ? [fact('time_bar', 'The hour on the visitor\'s time bar (not what they asked about; the app mentions it itself)', whenLabel(dates.barIso))] : []),
    ...(dates && !present ? [fact('real_time', 'The real date and hour now, UTC', whenLabel(dates.realIso))] : []),
    ...(dates?.outside ? [fact('real_date_outside_data', 'The real date is outside the data: say so plainly, and that the answer is for the nearest date inside it', `the real date, ${whenLabel(dates.outside)}, is outside the data; this is for the nearest date inside it`)] : []),
  ]
  // On the opening screen (Watch) the visitor is looking at the whole Moon and has chosen no site:
  // the link names a site only because a link must, so it is not passed on as theirs.
  if (watching) {
    return [
      fact('no_site_chosen', 'The visitor\'s screen', 'the whole Moon, with no site chosen: there is no "site on your screen"'),
      ...when,
      fact('limits', 'Mission limits', limitsLabel(view.requirements)),
      ...limitFacts(view.requirements),
      ...(spot ? tappedFacts(spot, sites) : []),
    ]
  }
  return [
    ...describe(view.a.site, 'site', 'Site on screen'),
    ...(view.b ? describe(view.b.site, 'compared_with', 'Compared with') : []),
    ...when,
    fact('limits', 'Mission limits', limitsLabel(view.requirements)),
    ...limitFacts(view.requirements),
    ...(spot ? tappedFacts(spot, sites) : []),
  ]
}

/** The ground the visitor tapped on the Atlas map, as facts: where it is and the listed site nearest it. */
function tappedFacts(spot: { lat: number; lon: number }, sites: SiteInfo[]): Fact[] {
  const nearest = sites.map((site) => ({ site, km: distanceKm(spot, site) })).sort((a, b) => a.km - b.km)[0]
  return [
    fact('tapped_spot', 'Spot the visitor tapped on the Atlas map (not a listed site; spot_light looks it up)', `${latitudeLabel(spot.lat)}, ${longitudeLabel(spot.lon)}`),
    fact('tapped_spot_nearest', 'Listed site nearest the tapped spot', nearest.site.name),
    fact('tapped_spot_distance', 'Its distance from the tapped spot', kmLabel(nearest.km)),
  ]
}

/** The two dates a question can be about, and which one it is about. `outside` is the real date when the data does not hold it. */
export interface ViewDates {
  basis: DateBasis
  barIso: string
  realIso: string
  outside: string | null
}

/**
 * Answers one message. The model can only call our read-only tools and then `give_answer`; it never
 * writes a number, a link or a button itself. See render.ts and actions.ts for how those are made.
 */
export async function runChat(
  input: { turns: ChatTurn[]; view: ViewState; spot?: { lat: number; lon: number } | null; /** The view as the page sent it, which a Sightline link's scenarios are read from. */ viewHash?: unknown },
  deps: {
    model: Model
    data: SiteData
    now?: () => number
    wait?: (ms: number) => Promise<void>
    /** Retries and the circuit breaker around each model call (../modelCall.ts). One per process; a fresh one if not given. */
    guard?: ModelGuard
    /** Told each time something is looked up, so a waiting visitor can be shown what is happening. */
    onStep?: (title: string) => void
    /**
     * When the question's time is up, in ms since the epoch. Default: 25 s from now. A request that
     * first waited for someone else's answer (shared/singleFlight.ts) passes its own, counted from
     * when it arrived, so waiting and then answering still fit in the same 25 s.
     */
    deadline?: number
    /** The way to ask NASA JPL Horizons, for the tool that checks an hour with it (../horizons.ts). */
    horizons?: HorizonsAsk
    /** The real time, in ms since the epoch: what "now" means when a question is about the present. Default: the server's clock. */
    clock?: () => number
  },
): Promise<ChatOutcome> {
  const now = deps.now ?? Date.now
  const guard = deps.guard ?? modelGuard({ now, wait: deps.wait })
  const deadline = deps.deadline ?? now() + DEADLINE_MS
  const sites = await deps.data.sites()
  const flags = await deps.data.flags(sites[0].id)
  // The opening screen says so in its link (`watch=1`): no site is chosen there.
  const watching = typeof input.viewHash === 'string' && new URLSearchParams(input.viewHash.replace(/^#/, '')).has('watch')
  const range = await deps.data.range()
  const system = systemPrompt(range)
  // The years the data covers may be typed: "in 2028" is a name for a year, not a measurement.
  // What an answer may carry besides references: the sites' names, the data's years, and the amounts the visitor typed in this question.
  const allowedWords = [...sites.map((site) => site.name), '3D', ...yearsOf({ from: range.first_year, to: range.last_year }).map(String), ...visitorsAmounts(input.turns.filter((turn) => turn.role === 'user').at(-1)?.text ?? '')]
  // On the Sightline screen the visitor has up to four scenarios: the one on show becomes the view.
  const scene = await scenarioScene(input.viewHash, input.view, deps.data)
  const shown = scene?.view ?? input.view
  // Which date the question is about (dates.ts). A question about the present is answered for the
  // real date and hour, kept inside the data: the view is moved there, so the tools, the facts and
  // the buttons all start from the date the answer is for. The time bar's own hour is kept beside it.
  const asked = input.turns.filter((turn) => turn.role === 'user').at(-1)?.text ?? ''
  const basis = dateBasis(asked, watching)
  const barHour = hourOf(flags.start, `${shown.a.month}-01T00:00:00Z`) + shown.index
  const realIso = realHourIso(input.viewHash, (deps.clock ?? Date.now)())
  const realHour = Math.min(Math.max(hourOf(flags.start, realIso), 0), flags.sun.length - 1)
  const dates: ViewDates = { basis, barIso: isoAt(flags.start, barHour), realIso: isoAt(flags.start, realHour), outside: isoAt(flags.start, realHour) === realIso ? null : realIso }
  const place = locateHour(flags.start, realHour)
  const view = basis === 'present' ? { ...shown, a: { ...shown.a, month: place.month }, index: place.index } : shown
  // The answer was about the present and the time bar is on another day: one short sentence says
  // so, and one button asks the same question for the bar's date. Only when the visitor used a word
  // about the present; a question with no date in it gets no note.
  const barApart = asksAboutPresent(asked) && Math.abs(barHour - realHour) > 24 ? { note: ` The time bar is on ${dayLabel(dates.barIso)}.`, ask: { label: `Ask for ${dayLabel(dates.barIso)}`, question: `${asked.trim().slice(0, 300)} (for the date on the time bar)` } } : null
  const context = { data: deps.data, requirements: view.requirements, spot: input.spot ?? null, horizons: deps.horizons, hourIso: isoAt(flags.start, hourOf(flags.start, `${view.a.month}-01T00:00:00Z`) + view.index) }

  const book: FactBook = new Map([['r0', [...(await viewFacts(view, deps.data, input.spot ?? null, watching, dates)), ...(scene?.facts ?? [])]]])
  const sources: string[] = []
  /** What the tools found tied for best, for the buttons: the first is offered and the button says there are others. */
  const ties: Tie[] = []
  // A button that changes the limits is offered only when the visitor asked what would change the
  // verdict: in so many words, or so that a tool had to try other limits to answer.
  let limitsAsked = asksToChangeLimits(input.turns.filter((turn) => turn.role === 'user').at(-1)?.text ?? '')
  const declarations = toolDeclarations(sites.map((site) => site.id))
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: buildPrompt(input.turns, book.get('r0') ?? [], sites) }]
  let retriesLeft = ANSWER_RETRIES
  /** The fallback model, once one has written any part of this answer. */
  let servedBy: string | undefined

  const finish = (text: string, answer?: Args, fellBack = false): ChatOutcome => ({
    ok: true,
    fellBack,
    ...(servedBy ? { servedBy } : {}),
    reply: {
      text: barApart ? `${text}${barApart.note}` : text,
      ...(barApart ? { ask: barApart.ask } : {}),
      actions: buildActions(answer?.actions, view, sites, flags, ties, limitsAsked),
      sources,
      followups: (Array.isArray(answer?.followups) ? answer.followups : [])
        .map((item) => cleanFollowup(item, allowedWords))
        .filter((item): item is string => item !== null)
        .slice(0, 3),
    },
  })

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    if (deadline - now() <= 0) break
    const last = round === MAX_ROUNDS
    // The visitor's side of the next round. On the round before the last it also asks for the answer:
    // these models refuse a forced tool call, so the prompt asks instead.
    const reply = (content: Anthropic.Beta.BetaContentBlockParam[]) => {
      messages.push({ role: 'user', content: round + 1 === MAX_ROUNDS ? [...content, { type: 'text', text: LAST_ROUND }] : content })
    }
    // Retries with growing, random waits, inside the deadline, and the circuit breaker (../modelCall.ts).
    // A copy of the messages, so each request is a record of what was sent then.
    const called = await callModel(deps.model, { system, messages: [...messages], tools: declarations, max_tokens: CHAT_MAX_TOKENS }, guard, {
      deadline,
      callTimeoutMs: MODEL_CALL_TIMEOUT_MS,
      name: `model call ${round}`,
    })
    if (!called.ok) {
      // With facts already in hand, show them rather than an error.
      return book.size > 1 ? finish(fallbackAnswer(book), undefined, true) : { ok: false, why: called.reason, retryAfterMs: called.retryAfterMs }
    }
    const message = called.message
    if (fallbackRan(message)) servedBy = message.model
    // Read the stop reason before the content.
    if (message.stop_reason === 'refusal') {
      // Declined, by the model asked and by any fallback after it. Nothing it wrote is shown.
      const category = message.stop_details?.category ?? null
      console.warn(`co-pilot: the model declined a question (category: ${category ?? 'none'}${servedBy ? `, after a fallback to ${servedBy}` : ''})`)
      return { ok: true, fellBack: false, refusal: { category }, ...(servedBy ? { servedBy } : {}), reply: { text: REFUSAL_TEXT, actions: [], sources, followups: [] } }
    }
    if (message.stop_reason === 'max_tokens') {
      // Cut off: a tool call in it may be missing part of its input, so nothing in it is run.
      console.warn(`co-pilot: a model call reached max_tokens (${CHAT_MAX_TOKENS}); answering from the facts`)
      return finish(fallbackAnswer(book), undefined, true)
    }
    const uses = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
    // The model's turn goes back exactly as it came, thinking and fallback blocks included: the API
    // checks the thinking blocks against the conversation that produced them.
    messages.push({ role: 'assistant', content: message.content })
    if (uses.length === 0) {
      reply([{ type: 'text', text: `Call ${ANSWER_TOOL} to answer.` }])
      continue
    }

    // Every tool call gets its result, all in one message, in the order they were asked for.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    let answer: { use: Anthropic.Beta.BetaToolUseBlock; args: Args } | null = null
    for (const use of uses) {
      const args = (typeof use.input === 'object' && use.input !== null ? use.input : {}) as Args
      if (use.name === ANSWER_TOOL) {
        answer = { use, args }
        continue
      }
      const tool = use.name
      if (LIMIT_ARGS.some((name) => name in args)) limitsAsked = true
      const result = await span(`tool ${tool}`, () => runTool(tool, args, context))
      const ref = `r${book.size}`
      if (result.ok) {
        book.set(ref, result.facts)
        if (result.ties) ties.push(...result.ties)
        if (!sources.includes(result.title)) sources.push(result.title)
        deps.onStep?.(result.title)
      }
      results.push(
        result.ok
          ? toolResult(use, { ref, cite_as: `{{${ref}.<key>}}`, facts: Object.fromEntries(result.facts.map((item) => [item.key, { value: item.value, means: item.label }])) })
          : toolResult(use, { error: result.error }, true),
      )
    }

    if (answer) {
      const rendered = renderAnswer(typeof answer.args.text === 'string' ? answer.args.text : '', book, allowedWords)
      if (rendered.ok) return finish(rendered.text, answer.args)
      if (retriesLeft === 0 || last) return finish(fallbackAnswer(book), answer.args, true)
      retriesLeft -= 1
      results.push(toolResult(answer.use, { error: rendered.problem }, true))
    }
    reply(results)
  }
  return finish(fallbackAnswer(book), undefined, true)
}

/** A tool's result for the model: JSON, marked as an error when the call could not be answered. */
function toolResult(use: Anthropic.Beta.BetaToolUseBlock, payload: unknown, isError = false): Anthropic.Beta.BetaToolResultBlockParam {
  return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(payload), ...(isError ? { is_error: true } : {}) }
}
