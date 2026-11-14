import type Anthropic from '@anthropic-ai/sdk'

/**
 * What the co-pilot asks the model, without the settings every request shares (which model, its
 * speed and effort, the fallbacks): those are added by the client (claude.ts), so the chat loop and
 * the typed-question box never name a model.
 */
export interface ModelRequest {
  /** The fixed rules. Never anything a visitor typed. */
  system?: string
  messages: Anthropic.Beta.BetaMessageParam[]
  /** Read-only tools the model may call. `tool_choice` is always `auto`: these models refuse a forced call. */
  tools?: Anthropic.Beta.BetaTool[]
  /** The only shape the answer may take (structured output), for the typed-question box. */
  format?: Anthropic.Beta.BetaJSONOutputFormat
  /** Room for the model's thinking and its reply together. */
  max_tokens: number
}

/** Claude's answer, exactly as the API returns it. Read `stop_reason` before `content`. */
export type ModelMessage = Anthropic.Beta.BetaMessage

/** The language model, as the co-pilot calls it. Tests pass a scripted fake; `index.ts` passes Claude (claude.ts). */
export interface Model {
  /**
   * Sends one request and returns the message. Rejects with the SDK's typed errors
   * (`Anthropic.APIError` and its subclasses, which carry the HTTP status and headers) when the API
   * refuses or cannot be reached, and when `signal` aborts.
   */
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelMessage>
}
