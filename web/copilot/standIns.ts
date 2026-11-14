import Anthropic, { type APIError } from '@anthropic-ai/sdk'
import type { Model, ModelMessage, ModelRequest } from './model'

/**
 * Two stand-ins for the model, both off unless switched on (copilot/index.ts).
 *
 * `scriptedModel` answers without calling Claude: it looks up one month and answers with a reference
 * to it, the way the real model is made to. It exists so the real image can be run on a laptop or in
 * Compose, streaming included, with no API key and without paying for a model call. The service
 * refuses to start with it on Cloud Run.
 *
 * `faultyModel` sits in front of the real model and answers a share of calls with an error itself,
 * without calling Claude. It is how the circuit breaker is shown to work on the live service: fault
 * injection at the load balancer (infra/copilot.tf) sits between the visitor and the service, so it
 * tests the page and the bulkhead, but it never reaches the call from the service to the model,
 * which is where the breaker is. Off by default; switched on by a Terraform variable for a drill.
 */

/** The parts of a message the stand-ins and tests choose. */
export interface MessageParts {
  content: Anthropic.Beta.BetaContentBlock[]
  stop_reason?: Anthropic.Beta.BetaStopReason
  stop_details?: Anthropic.Beta.BetaRefusalStopDetails | null
  model?: string
  usage?: Partial<Anthropic.Beta.BetaUsage>
}

/** A whole message as the API returns it, from the few parts that matter. */
export function claudeMessage(parts: MessageParts): ModelMessage {
  return {
    id: `msg_standin_${Math.random().toString(36).slice(2, 10)}`,
    type: 'message',
    role: 'assistant',
    model: parts.model ?? 'claude-opus-5-5',
    content: parts.content,
    stop_reason: parts.stop_reason ?? (parts.content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn'),
    stop_sequence: null,
    stop_details: parts.stop_details ?? null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      inference_geo: null,
      input_tokens: 0,
      iterations: null,
      output_tokens: 0,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: null,
      ...parts.usage,
    },
  }
}

let calls = 0
/** A `tool_use` block, as the model writes one. */
export function toolUse(name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock {
  calls += 1
  return { type: 'tool_use', id: `toolu_standin_${calls}`, name, input }
}

export function textBlock(text: string): Anthropic.Beta.BetaTextBlock {
  return { type: 'text', text, citations: null }
}

/** A refusal as the API returns one: HTTP 200, `stop_reason: "refusal"`, and its category. */
export function refusal(category: Anthropic.Beta.BetaRefusalStopDetails['category'], parts: Partial<MessageParts> = {}): ModelMessage {
  return claudeMessage({
    content: [],
    ...parts,
    stop_reason: 'refusal',
    stop_details: { type: 'refusal', category, explanation: null, fallback_credit_token: null, fallback_has_prefill_claim: null, recommended_model: null },
  })
}

/** The block that marks where one model declined and a fallback model carried on. */
export function fallbackBlock(from: string, to: string, category: Anthropic.Beta.BetaRefusalStopDetails['category'] = 'cyber'): Anthropic.Beta.BetaFallbackBlock {
  return { type: 'fallback', from: { model: from }, to: { model: to }, trigger: { type: 'refusal', category } }
}

/** How many times the model has spoken in this conversation: 0 on the first call. */
function modelTurns(request: ModelRequest): number {
  return request.messages.filter((message) => message.role === 'assistant').length
}

export function scriptedModel(options: { delayMs?: number; onCall?: (calls: number) => void } = {}): Model {
  let made = 0
  return {
    async generate(request, signal) {
      // Told of each call, so a laptop run can count them: one question is two calls (a lookup, then the answer).
      made += 1
      options.onCall?.(made)
      if (options.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, options.delayMs)
          signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new Anthropic.APIUserAbortError())
          })
        })
      }
      // The typed-question box asks for a structured answer, not tools.
      if (request.format) return claudeMessage({ content: [textBlock(JSON.stringify({ sites: ['connecting-ridge'], month: '2027-05' }))] })
      if (modelTurns(request) === 0) return claudeMessage({ content: [toolUse('month_summary', { site: 'connecting-ridge', month: '2027-05' })] })
      return claudeMessage({ content: [toolUse('give_answer', { text: 'The Sun is up {{r1.pct_sun}} of {{r1.month}} at Connecting Ridge. (A scripted stand-in answered this, not the model.)' })] })
    },
  }
}

/** The error the SDK raises for an HTTP status, as the real client would throw it. */
export function apiError(status: number, headers: Record<string, string> = {}): APIError {
  return Anthropic.APIError.generate(status, { type: 'error', error: { type: 'api_error', message: 'injected' } }, 'injected', new Headers(headers))
}

/** A share of calls failed on purpose: `MODEL_FAULTS=<status>@<percent>`, for example `529@100`. */
export interface Faults {
  status: number
  percent: number
}

/** Reads the setting. Null if it is empty or not of that form, so a typo switches nothing on. */
export function readFaults(value: string | undefined): Faults | null {
  const match = /^(\d{3})@(\d{1,3}(?:\.\d+)?)$/.exec((value ?? '').trim())
  if (!match) return null
  const status = Number(match[1])
  const percent = Number(match[2])
  return status >= 400 && status <= 599 && percent > 0 && percent <= 100 ? { status, percent } : null
}

export function faultyModel(inner: Model, faults: Faults, random: () => number = Math.random): Model {
  return {
    generate(request, signal) {
      if (random() * 100 < faults.percent) return Promise.reject(apiError(faults.status))
      return inner.generate(request, signal)
    },
  }
}
