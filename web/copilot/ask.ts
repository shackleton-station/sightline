import { ASK_MAX_CHARS, type AskMonths, askMonths, askSchema, buildAskPrompt, sanitizeAsk, type AskSite } from '../src/lib/ask'
import { originAllowed, reply, visitorKeys } from '../shared/http'
import type { Limiter } from '../shared/store'
import type { SiteData } from '../shared/tools/data'
import { busyReply, countIfAllowed, MODEL_BUSY_WAIT_MS, saysLongerThan } from './busy'
import type { CopilotDeps } from './deps'
import type { Model, ModelRequest } from './model'
import { callModel, MODEL_CALL_TIMEOUT_MS, type ModelGuard, modelGuard } from './modelCall'

/** The whole request's time, retries included. One model call answers a typed question, each try in its own 10 s. */
const DEADLINE_MS = 20_000
/** Room for the model's thinking and a few settings as JSON. The most measured was 61 output tokens (docs/decisions/0009-copilot-on-claude.md). */
export const ASK_MAX_TOKENS = 1024

async function readQuestion(request: Request): Promise<string | null> {
  const text = await request.text()
  if (text.length > ASK_MAX_CHARS * 4) return null
  try {
    const body: unknown = JSON.parse(text)
    const question = typeof body === 'object' && body !== null ? (body as { question?: unknown }).question : null
    if (typeof question !== 'string') return null
    const trimmed = question.trim()
    return trimmed.length > 0 && trimmed.length <= ASK_MAX_CHARS ? trimmed : null
  } catch {
    return null
  }
}

/**
 * The request the model gets: the question fenced in a prompt, and the only shape it may answer in,
 * as a structured output (`output_config.format`). Not a forced tool call (refused by these models)
 * and not a prefilled answer (refused too).
 */
export function askRequest(question: string, sites: AskSite[], months: AskMonths): ModelRequest {
  return {
    messages: [{ role: 'user', content: buildAskPrompt(question, sites, months) }],
    format: { type: 'json_schema', schema: askSchema(sites.map((site) => site.id), months) as Record<string, unknown> },
    max_tokens: ASK_MAX_TOKENS,
  }
}

type Asked = { ok: true; value: unknown } | { ok: false; why: 'circuit-open' | 'busy' | 'failed' | 'refused'; retryAfterMs: number | null }

/** The model's answer as parsed JSON, or a reason it isn't available. */
async function askModel(question: string, sites: AskSite[], months: AskMonths, model: Model, guard: ModelGuard): Promise<Asked> {
  const called = await callModel(model, askRequest(question, sites, months), guard, { deadline: guard.now() + DEADLINE_MS, callTimeoutMs: MODEL_CALL_TIMEOUT_MS, name: 'model call' })
  if (!called.ok) return { ok: false, why: called.reason, retryAfterMs: called.retryAfterMs }
  const { message } = called
  // The stop reason first: a refusal's text need not match the schema, and a cut-off answer is not JSON.
  if (message.stop_reason === 'refusal') {
    console.warn(`typed question: the model declined it (category: ${message.stop_details?.category ?? 'none'})`)
    return { ok: false, why: 'refused', retryAfterMs: null }
  }
  if (message.stop_reason !== 'end_turn') return { ok: false, why: 'failed', retryAfterMs: null }
  // The answer is the text block; thinking blocks come before it.
  const text = message.content.filter((block) => block.type === 'text').at(-1)?.text
  if (!text) return { ok: false, why: 'failed', retryAfterMs: null }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, why: 'failed', retryAfterMs: null }
  }
}

export interface AskLimits {
  /** Per visitor, per minute. */
  each: Limiter
  /** Per visitor, per day. */
  eachDay: Limiter
  /** Everyone at one network address together, per minute and per day (limits.ts). */
  address: Limiter
  addressDay: Limiter
  /** Everyone together, per minute and per day, so one busy room can't run up the bill. */
  all: Limiter
  allDay: Limiter
}

/**
 * POST /api/ask: turns a typed question into app settings. The model only picks a site, month and
 * limits; `sanitizeAsk` drops anything the inputs wouldn't accept, and the app computes every number.
 *
 * The list of sites comes from the site data the service carries, like everything the co-pilot
 * reads. It used to be bundled into the program when it was built, which put a second copy of the
 * data outside the data version's reach (baseline 2.5, item 4).
 *
 * "Not now" answers carry a `Retry-After` header, as `/api/chat`'s do (`busy.ts`).
 */
export async function handleAsk(request: Request, deps: CopilotDeps, limits: AskLimits, data: SiteData, guard: ModelGuard = modelGuard({ now: deps.now })): Promise<Response> {
  if (request.method !== 'POST') return reply({ error: 'method' }, 405)
  if (!originAllowed(request, deps.allowedOrigins)) return reply({ error: 'origin' }, 403)
  // Read before anything is counted: a malformed question is a 400 and spends nothing, even when a limit is full.
  if (saysLongerThan(request, ASK_MAX_CHARS * 16)) return reply({ error: 'bad-question' }, 400)
  const question = await readQuestion(request)
  if (question === null) return reply({ error: 'bad-question' }, 400)
  if (!deps.model) return reply({ error: 'not-configured' }, 503)

  // Counted only if all four allow it, so a refused call (429) spends nothing.
  const { address, visitor } = visitorKeys(request, deps.trustedProxies)
  const refused = await countIfAllowed([
    [limits.each, visitor],
    [limits.eachDay, visitor],
    [limits.address, address],
    [limits.addressDay, address],
    [limits.all, 'all'],
    [limits.allDay, 'all'],
  ])
  if (refused !== null) return busyReply(429, refused)

  const sites: AskSite[] = (await data.sites()).map(({ id, name, group }) => ({ id, name, group }))
  // The months a question can name are the data's own first and last, like the list of sites.
  const months = askMonths(await data.range())
  let answer: Asked
  try {
    answer = await askModel(question, sites, months, deps.model, guard)
  } catch {
    return reply({ error: 'upstream' }, 502)
  }
  if (!answer.ok) {
    if (answer.why === 'failed') return reply({ error: 'upstream' }, 502)
    // Declined by the model, after any fallback: asking the same again would be declined again.
    if (answer.why === 'refused') return reply({ error: 'declined' }, 422)
    return busyReply(answer.why === 'circuit-open' ? 503 : 429, answer.retryAfterMs ?? MODEL_BUSY_WAIT_MS)
  }

  const result = sanitizeAsk(answer.value, sites.map((site) => site.id), months)
  if (!result) return reply({ error: 'not-understood' }, 422)
  return reply({ result })
}
