import type Anthropic from '@anthropic-ai/sdk'
import { hourOf } from '../../src/lib/mission'
import { distanceKm } from '../../src/lib/slip'
import type { SiteInfo } from '../../src/data/contract'
import { parseCustomSite, type ViewState } from '../../src/lib/urlState'
import type { Model } from '../model'
import { callModel, fallbackRan, MODEL_CALL_TIMEOUT_MS, type ModelGuard, modelGuard } from '../modelCall'
import { span } from '../../shared/trace'
import { buildActions, type ChatAction } from './actions'
import type { Args } from '../../shared/tools/args'
import type { SiteData } from '../../shared/tools/data'
import { fact, type Fact, isoAt, latitudeLabel, limitsLabel, longitudeLabel, monthWords, whenLabel } from '../../shared/tools/facts'
import { yearsOf } from '../../src/lib/span'
import { buildPrompt, systemPrompt } from './prompt'
import { cleanFollowup, type FactBook, fallbackAnswer, renderAnswer } from './render'
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
export async function viewFacts(view: ViewState, data: SiteData, spot: { lat: number; lon: number } | null = null): Promise<Fact[]> {
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
      fact(key, label, 'a custom point (not a listed site, so the tools cannot look it up)'),
      fact(`${key}_nearest`, 'Nearest listed site', nearest.site.name),
      fact(`${key}_nearest_distance`, 'Its distance from the custom point', `${nearest.km.toFixed(0)} km`),
    ]
  }
  const monthStart = hourOf(flags.start, `${view.a.month}-01T00:00:00Z`)
  return [
    ...describe(view.a.site, 'site', 'Site on screen'),
    ...(view.b ? describe(view.b.site, 'compared_with', 'Compared with') : []),
    fact('month', 'Month on screen', monthWords(view.a.month)),
    fact('time', 'Hour on screen', whenLabel(isoAt(flags.start, monthStart + view.index))),
    fact('limits', 'Mission limits', limitsLabel(view.requirements)),
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
  },
): Promise<ChatOutcome> {
  const now = deps.now ?? Date.now
  const guard = deps.guard ?? modelGuard({ now, wait: deps.wait })
  const deadline = deps.deadline ?? now() + DEADLINE_MS
  const sites = await deps.data.sites()
  const flags = await deps.data.flags(sites[0].id)
  const range = await deps.data.range()
  const system = systemPrompt(range)
  // The years the data covers may be typed: "in 2028" is a name for a year, not a measurement.
  const allowedWords = [...sites.map((site) => site.name), '3D', ...yearsOf({ from: range.first_year, to: range.last_year }).map(String)]
  // On the Sightline screen the visitor has up to four scenarios: the one on show becomes the view.
  const scene = await scenarioScene(input.viewHash, input.view, deps.data)
  const view = scene?.view ?? input.view
  const context = { data: deps.data, requirements: view.requirements, spot: input.spot ?? null, horizons: deps.horizons }

  const book: FactBook = new Map([['r0', [...(await viewFacts(view, deps.data, input.spot ?? null)), ...(scene?.facts ?? [])]]])
  const sources: string[] = []
  /** What the tools found tied for best, for the buttons: the first is offered and the button says there are others. */
  const ties: Tie[] = []
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
      text,
      actions: buildActions(answer?.actions, view, sites, flags, ties),
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
