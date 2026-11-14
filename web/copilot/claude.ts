import { execFile } from 'node:child_process'
import Anthropic from '@anthropic-ai/sdk'
import { oidcFederationProvider } from '@anthropic-ai/sdk/lib/credentials/oidc-federation'
import type { IdentityTokenProvider } from '@anthropic-ai/sdk/lib/credentials/types'
import type { Model, ModelRequest } from './model'

/**
 * The model: Claude on the Anthropic API, through the official SDK (docs/decisions/0009-copilot-on-claude.md).
 *
 * Every request carries the same four settings, read once from the environment:
 * - CLAUDE_MODEL (default claude-opus-5-5): which Claude answers.
 * - CLAUDE_SPEED (default fast): fast mode runs the same model with quicker output, at twice the
 *   price. Empty (or `none`) leaves the field out, which is what a model without fast mode needs
 *   (claude-sonnet-5-5). `standard` sends it explicitly.
 * - CLAUDE_EFFORT (default low): how much the model thinks. Thinking itself is never configured:
 *   on these models it is always on (adaptive), and a `disabled` setting is refused with a 400.
 *   Effort is the one control, and picking a tool and wording two sentences needs little.
 * - Server-side fallbacks, always on (`fallbacks: "default"`): if the model's safety classifiers
 *   decline a question, the API runs it again on the model Anthropic recommends for that kind of
 *   decline, inside the same call. It needs the beta endpoint and its header.
 *
 * How the service signs in is below (`ClaudeAuth`): Workload Identity Federation in the cloud, so no
 * key is stored anywhere.
 *
 * So switching to claude-fable-5-2 at high effort, or to claude-sonnet-5-5 at standard speed, is
 * a change of settings, not of code.
 */

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]
export type Speed = 'fast' | 'standard'

export interface ClaudeSettings {
  model: string
  /** Null: the request has no `speed` field. */
  speed: Speed | null
  effort: Effort
}

export const DEFAULT_CLAUDE: ClaudeSettings = { model: 'claude-opus-5-5', speed: 'fast', effort: 'low' }

/** The server-side fallback beta. The `"default"` form needs this date of it, not the earlier one. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/**
 * The settings from the environment. An unset variable takes its default; an empty CLAUDE_SPEED
 * means "no speed field". A value that is not one of the known ones stops the service at start,
 * rather than turning into a 400 on every question.
 */
export function readClaudeSettings(env: Record<string, string | undefined>): ClaudeSettings {
  const model = env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE.model
  const speedSetting = env.CLAUDE_SPEED === undefined ? DEFAULT_CLAUDE.speed : env.CLAUDE_SPEED.trim()
  let speed: Speed | null
  if (speedSetting === null || speedSetting === '' || speedSetting === 'none') speed = null
  else if (speedSetting === 'fast' || speedSetting === 'standard') speed = speedSetting
  else throw new Error(`CLAUDE_SPEED must be fast, standard, or empty (no speed field), not "${speedSetting}"`)
  const effort = env.CLAUDE_EFFORT?.trim() || DEFAULT_CLAUDE.effort
  if (!(EFFORTS as readonly string[]).includes(effort)) throw new Error(`CLAUDE_EFFORT must be one of ${EFFORTS.join(', ')}, not "${effort}"`)
  return { model, speed, effort: effort as Effort }
}

/** The settings in a few words, for the status and the log. */
export function describeClaude(settings: ClaudeSettings): string {
  return `${settings.model}, ${settings.speed ? `${settings.speed} speed` : 'no speed field'}, ${settings.effort} effort, fallbacks on`
}

/**
 * The whole request body for one call. Pure, so tests can check every shape of it.
 *
 * - No `thinking` field: adaptive thinking is the default and the only mode these models accept.
 * - `tool_choice` is `auto` whenever there are tools. Forcing a call (`any` or `tool`) is a 400 on
 *   these models; the prompt says which tool to call instead.
 * - No assistant prefill: the last message is always the visitor's side (a 400 otherwise).
 * - Caching: the tools and the system prompt are the same for every question, so they are marked
 *   for the prompt cache (the system block's `cache_control`); the top-level `cache_control` marks
 *   the end of each request, so the next round of the same question reads all of it back.
 */
export function claudeRequest(settings: ClaudeSettings, request: ModelRequest): Anthropic.Beta.MessageCreateParamsNonStreaming {
  return {
    model: settings.model,
    max_tokens: request.max_tokens,
    ...(request.system ? { system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }] } : {}),
    messages: request.messages,
    ...(request.tools && request.tools.length > 0 ? { tools: request.tools, tool_choice: { type: 'auto' } } : {}),
    output_config: { effort: settings.effort, ...(request.format ? { format: request.format } : {}) },
    ...(settings.speed ? { speed: settings.speed } : {}),
    cache_control: { type: 'ephemeral' },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
  }
}

/** The part of the SDK client this file uses, so tests can pass a fake one that never touches the network. */
export interface ClaudeClient {
  beta: { messages: { create(body: Anthropic.Beta.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<Anthropic.Beta.BetaMessage> } }
}

/**
 * HOW THE SERVICE PROVES WHO IT IS. No key is stored anywhere (docs/decisions/0009-copilot-on-claude.md).
 *
 * In the cloud: Anthropic's Workload Identity Federation. The co-pilot's Google service account
 * asks Google's metadata server for an identity token addressed to Anthropic; the SDK trades it at
 * Anthropic's token endpoint for a short-lived access token, under a federation rule that names that
 * one Google account (its numeric id and its email), and calls the API with it. The SDK keeps the
 * access token and trades a fresh Google token before it runs out (the rule's lifetime, 600 s by
 * default; a Google token lasts about an hour). The settings are identifiers, not secrets.
 *
 * On a developer's laptop, either the same federation with the identity token from gcloud,
 * impersonating the co-pilot's service account (ANTHROPIC_IDENTITY_FROM_GCLOUD), or the developer's
 * own ANTHROPIC_API_KEY from their environment. Federation wins when both are set.
 */
export type ClaudeAuth =
  | {
      kind: 'federation'
      federationRuleId: string
      organizationId: string
      serviceAccountId?: string
      workspaceId?: string
      /** Where the Google identity token comes from: the metadata server (Cloud Run), or gcloud impersonating this service account (a laptop). */
      identity: { from: 'metadata' } | { from: 'gcloud'; serviceAccount: string }
    }
  | { kind: 'api-key' }
  | { kind: 'none' }

/** The audience the identity token names, and the federation rule pins. */
export const ANTHROPIC_AUDIENCE = 'https://api.anthropic.com'
const METADATA_IDENTITY = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${ANTHROPIC_AUDIENCE}&format=full`

/**
 * Which way to authenticate, from the environment. The federation settings come as a set: a rule
 * without its organization (or the reverse) stops the service at start. ANTHROPIC_IDENTITY_FROM_GCLOUD
 * is for a laptop only, and refused on Cloud Run (K_SERVICE), where the metadata server is the source.
 */
export function readClaudeAuth(env: Record<string, string | undefined>): ClaudeAuth {
  const value = (name: string) => env[name]?.trim() || undefined
  const federationRuleId = value('ANTHROPIC_FEDERATION_RULE_ID')
  const organizationId = value('ANTHROPIC_ORGANIZATION_ID')
  if (federationRuleId || organizationId) {
    if (!federationRuleId || !organizationId) throw new Error('Workload Identity Federation needs both ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID')
    const impersonate = value('ANTHROPIC_IDENTITY_FROM_GCLOUD')
    if (impersonate && env.K_SERVICE) throw new Error('ANTHROPIC_IDENTITY_FROM_GCLOUD is for a laptop: on Cloud Run the identity token comes from the metadata server')
    return {
      kind: 'federation',
      federationRuleId,
      organizationId,
      serviceAccountId: value('ANTHROPIC_SERVICE_ACCOUNT_ID'),
      workspaceId: value('ANTHROPIC_WORKSPACE_ID'),
      identity: impersonate ? { from: 'gcloud', serviceAccount: impersonate } : { from: 'metadata' },
    }
  }
  return value('ANTHROPIC_API_KEY') ? { kind: 'api-key' } : { kind: 'none' }
}

/** The way in, in a few words, for the log and the status. Identifiers only: never a token or a key. */
export function describeAuth(auth: ClaudeAuth): string {
  if (auth.kind === 'federation') return `workload identity federation (rule ${auth.federationRuleId}, identity token from ${auth.identity.from === 'metadata' ? "Google's metadata server" : `gcloud, impersonating ${auth.identity.serviceAccount}`})`
  return auth.kind === 'api-key' ? 'ANTHROPIC_API_KEY from the environment' : 'none'
}

/** Google's identity token for this service's own account, from the metadata server Cloud Run provides. */
export function metadataIdentityToken(fetcher: typeof fetch = fetch): IdentityTokenProvider {
  return async () => {
    const response = await fetcher(METADATA_IDENTITY, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`the metadata server answered HTTP ${response.status} for an identity token`)
    return (await response.text()).trim()
  }
}

/**
 * The same token on a laptop: gcloud, impersonating the co-pilot's service account (the developer
 * needs Token Creator on it). `--include-email` puts the email claim in, which the rule matches.
 * The token is passed straight to the SDK and never written down or printed.
 */
export function gcloudIdentityToken(serviceAccount: string): IdentityTokenProvider {
  return () =>
    new Promise((resolve, reject) => {
      execFile(
        'gcloud',
        ['auth', 'print-identity-token', `--impersonate-service-account=${serviceAccount}`, `--audiences=${ANTHROPIC_AUDIENCE}`, '--include-email'],
        { timeout: 20_000 },
        (error, stdout) => (error ? reject(new Error(`gcloud could not make an identity token for ${serviceAccount} (exit ${String((error as { code?: unknown }).code ?? '?')})`)) : resolve(stdout.trim())),
      )
    })
}

/**
 * The SDK client the service uses. Its own retries are off (`maxRetries: 0`): modelCall.ts already
 * retries with jitter inside the request's deadline and feeds the circuit breaker, and two retry
 * policies stacked would multiply the tries. `timeoutMs` is a backstop; each call is also cut off by
 * the signal modelCall.ts passes. Null when there is no way to authenticate.
 *
 * With federation the provider is given explicitly, because an ANTHROPIC_API_KEY in the environment
 * would otherwise outrank it. The client wraps it in its own token cache.
 */
export function claudeClient(auth: ClaudeAuth, timeoutMs: number): Anthropic | null {
  if (auth.kind === 'none') return null
  if (auth.kind === 'api-key') return new Anthropic({ maxRetries: 0, timeout: timeoutMs })
  const credentials = oidcFederationProvider({
    identityTokenProvider: auth.identity.from === 'metadata' ? metadataIdentityToken() : gcloudIdentityToken(auth.identity.serviceAccount),
    federationRuleId: auth.federationRuleId,
    organizationId: auth.organizationId,
    serviceAccountId: auth.serviceAccountId,
    workspaceId: auth.workspaceId,
    baseURL: ANTHROPIC_AUDIENCE,
    fetch,
  })
  return new Anthropic({ credentials, maxRetries: 0, timeout: timeoutMs })
}

export function claudeModel(settings: ClaudeSettings, client: ClaudeClient): Model {
  return {
    async generate(request, signal) {
      return client.beta.messages.create(claudeRequest(settings, request), { signal })
    },
  }
}
