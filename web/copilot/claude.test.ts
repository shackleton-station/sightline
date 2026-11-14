import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { askRequest } from './ask'
import { type ClaudeClient, claudeClient, claudeModel, claudeRequest, DEFAULT_CLAUDE, describeAuth, FALLBACK_BETA, metadataIdentityToken, readClaudeAuth, readClaudeSettings } from './claude'
import type { ModelRequest } from './model'
import { claudeMessage, textBlock } from './standIns'

const CHAT: ModelRequest = {
  system: 'The rules.',
  messages: [{ role: 'user', content: 'How sunny is it?' }],
  tools: [{ name: 'site_info', description: 'Where a site is.', strict: true, input_schema: { type: 'object', properties: { site: { type: 'string' } }, required: ['site'], additionalProperties: false } }],
  max_tokens: 4096,
}

describe('the settings', () => {
  it('defaults to Claude Opus 5.5, fast, low effort', () => {
    expect(readClaudeSettings({})).toEqual({ model: 'claude-opus-5-5', speed: 'fast', effort: 'low' })
    expect(DEFAULT_CLAUDE).toEqual({ model: 'claude-opus-5-5', speed: 'fast', effort: 'low' })
  })

  it('switches model, speed and effort without a code change', () => {
    expect(readClaudeSettings({ CLAUDE_MODEL: 'claude-fable-5-2', CLAUDE_EFFORT: 'high' })).toEqual({ model: 'claude-fable-5-2', speed: 'fast', effort: 'high' })
    // An empty speed means no speed field: what a model without fast mode needs.
    expect(readClaudeSettings({ CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_SPEED: '' })).toEqual({ model: 'claude-sonnet-5-5', speed: null, effort: 'low' })
    expect(readClaudeSettings({ CLAUDE_SPEED: 'none' }).speed).toBeNull()
    expect(readClaudeSettings({ CLAUDE_SPEED: 'standard' }).speed).toBe('standard')
    // Empty model and effort take the defaults.
    expect(readClaudeSettings({ CLAUDE_MODEL: ' ', CLAUDE_EFFORT: '' })).toEqual(DEFAULT_CLAUDE)
  })

  it('refuses a setting it does not know, at start', () => {
    expect(() => readClaudeSettings({ CLAUDE_SPEED: 'turbo' })).toThrow(/CLAUDE_SPEED/)
    expect(() => readClaudeSettings({ CLAUDE_EFFORT: 'none' })).toThrow(/CLAUDE_EFFORT/)
  })
})

describe('the request', () => {
  it('on the default settings: fast, low effort, fallbacks, no thinking field, tools on auto', () => {
    const body = claudeRequest(DEFAULT_CLAUDE, CHAT)
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      speed: 'fast',
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: [FALLBACK_BETA],
      tool_choice: { type: 'auto' },
      messages: CHAT.messages,
      tools: CHAT.tools,
    })
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01')
    expect('thinking' in body).toBe(false)
    // The system prompt is marked for the prompt cache, and so is the end of the request.
    expect(body.system).toEqual([{ type: 'text', text: 'The rules.', cache_control: { type: 'ephemeral' } }])
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    // Never a prefill: the last message is the visitor's side.
    expect(body.messages.at(-1)?.role).toBe('user')
  })

  it('for Claude Fable 5.2 at high effort', () => {
    const body = claudeRequest(readClaudeSettings({ CLAUDE_MODEL: 'claude-fable-5-2', CLAUDE_EFFORT: 'high' }), CHAT)
    expect(body).toMatchObject({ model: 'claude-fable-5-2', speed: 'fast', output_config: { effort: 'high' }, fallbacks: 'default' })
    expect('thinking' in body).toBe(false)
  })

  it('for Claude Sonnet 5.5 with no speed field', () => {
    const body = claudeRequest(readClaudeSettings({ CLAUDE_MODEL: 'claude-sonnet-5-5', CLAUDE_SPEED: '' }), CHAT)
    expect(body.model).toBe('claude-sonnet-5-5')
    expect('speed' in body).toBe(false)
    expect(body).toMatchObject({ output_config: { effort: 'low' }, fallbacks: 'default', betas: [FALLBACK_BETA] })
  })

  it('for a typed question: a structured output, no tools and no tool choice', () => {
    const body = claudeRequest(DEFAULT_CLAUDE, askRequest('two weeks in March 2027', [{ id: 'connecting-ridge', name: 'Connecting Ridge', group: 'Shackleton' }], { first: '2026-01', last: '2049-12', from: '2027-01' }))
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } })
    expect(body.output_config?.format?.schema).toMatchObject({ additionalProperties: false })
    expect('tools' in body).toBe(false)
    expect('tool_choice' in body).toBe(false)
    expect('system' in body).toBe(false)
  })

  it('goes to the beta endpoint, with the call’s signal, through any client', async () => {
    const create = vi.fn(async () => claudeMessage({ content: [textBlock('Hello.')] }))
    const client: ClaudeClient = { beta: { messages: { create } } }
    const signal = AbortSignal.timeout(1000)
    const message = await claudeModel(DEFAULT_CLAUDE, client).generate(CHAT, signal)
    expect(message.stop_reason).toBe('end_turn')
    expect(create).toHaveBeenCalledWith(claudeRequest(DEFAULT_CLAUDE, CHAT), { signal })
  })
})

describe('signing in, with no stored key', () => {
  const FEDERATION = { ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test', ANTHROPIC_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000000', ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test' }

  it('uses Workload Identity Federation when its settings are there, even beside a key', () => {
    expect(readClaudeAuth({ ...FEDERATION, ANTHROPIC_API_KEY: 'a-developer-key' })).toEqual({
      kind: 'federation',
      federationRuleId: 'fdrl_test',
      organizationId: '00000000-0000-4000-8000-000000000000',
      serviceAccountId: 'svac_test',
      workspaceId: undefined,
      identity: { from: 'metadata' },
    })
    expect(readClaudeAuth({ ...FEDERATION, ANTHROPIC_WORKSPACE_ID: 'wrkspc_test' })).toMatchObject({ workspaceId: 'wrkspc_test' })
  })

  it('on a laptop, gets the identity token from gcloud, and never on Cloud Run', () => {
    expect(readClaudeAuth({ ...FEDERATION, ANTHROPIC_IDENTITY_FROM_GCLOUD: 'copilot@example.iam.gserviceaccount.com' })).toMatchObject({ identity: { from: 'gcloud', serviceAccount: 'copilot@example.iam.gserviceaccount.com' } })
    expect(() => readClaudeAuth({ ...FEDERATION, ANTHROPIC_IDENTITY_FROM_GCLOUD: 'x', K_SERVICE: 'clps-copilot' })).toThrow(/laptop/)
  })

  it('falls back to a developer’s own key, and otherwise has none', () => {
    expect(readClaudeAuth({ ANTHROPIC_API_KEY: 'a-developer-key' })).toEqual({ kind: 'api-key' })
    expect(readClaudeAuth({ ANTHROPIC_API_KEY: '' })).toEqual({ kind: 'none' })
    expect(readClaudeAuth({})).toEqual({ kind: 'none' })
    expect(claudeClient({ kind: 'none' }, 10_000)).toBeNull()
  })

  it('refuses half the federation settings, at start', () => {
    expect(() => readClaudeAuth({ ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test' })).toThrow(/both/)
    expect(() => readClaudeAuth({ ANTHROPIC_ORGANIZATION_ID: 'org' })).toThrow(/both/)
  })

  it('describes the way in with identifiers only', () => {
    const auth = readClaudeAuth({ ...FEDERATION, ANTHROPIC_API_KEY: 'a-developer-key' })
    expect(describeAuth(auth)).toContain('fdrl_test')
    expect(describeAuth(auth)).not.toContain('a-developer-key')
    expect(describeAuth({ kind: 'api-key' })).toBe('ANTHROPIC_API_KEY from the environment')
  })

  it('builds a client that signs in by federation, with no network until the first call', () => {
    const client = claudeClient(readClaudeAuth(FEDERATION), 10_000)
    expect(client).toBeInstanceOf(Anthropic)
    expect(client?.maxRetries).toBe(0)
    expect(client?.timeout).toBe(10_000)
  })

  it('asks the metadata server for a token addressed to Anthropic, with the email claim', async () => {
    const fetcher = vi.fn(async () => new Response('header.payload.signature\n'))
    expect(await metadataIdentityToken(fetcher as unknown as typeof fetch)()).toBe('header.payload.signature')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=https://api.anthropic.com&format=full')
    expect(init.headers).toEqual({ 'Metadata-Flavor': 'Google' })
    const refused = vi.fn(async () => new Response('no', { status: 404 }))
    await expect(metadataIdentityToken(refused as unknown as typeof fetch)()).rejects.toThrow(/HTTP 404/)
  })
})
