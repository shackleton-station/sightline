import type { SharedStore } from '../shared/store'
import type { AskLimits } from './ask'
import type { ChatLimits } from './chat/handler'

const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * MINUTE_MS

/**
 * How many questions each limit allows. The two `allDay` numbers together are the most the model can
 * cost in a day, whoever asks. At the default model and speed (Claude Opus 5.5, fast, low effort) the
 * dearest question measured cost $0.1037 for the chat (the first after the prompt cache had gone cold)
 * and $0.0155 for a typed question: 120 × $0.1037 + 150 × $0.0155 = $14.77 a day at most, under the
 * captain's $15 (docs/decisions/0009-copilot-on-claude.md has the measurements). With Gemini the chat
 * allowed 1,500 a day for everyone and 60 per visitor.
 *
 * `each` and `eachDay` are per visitor: one browser at one address (`visitorKeys` in shared/http.ts).
 * `address` and `addressDay` cap everyone at one network address together. A room on one Wi-Fi shares
 * an address, so this is where it gets more than one visitor's allowance; and since a page names its
 * own browser, it is also the most anyone can get by making up new ones. Left unset, they are
 * `ADDRESS_SHARE` times the visitor's limits.
 */
export const LIMITS = {
  // A chat message can take several model calls, so its limits are tighter than a typed question's.
  chat: { each: 6, eachDay: 20, all: 30, allDay: 120 },
  ask: { each: 10, eachDay: 30, all: 30, allDay: 150 },
} as const

/** How many visitors' allowance one network address gets, unless set on its own. */
export const ADDRESS_SHARE = 4

type Set = 'each' | 'eachDay' | 'all' | 'allDay'
type Which = Set | 'address' | 'addressDay'
export type CopilotLimitNumbers = { chat: Record<Which, number>; ask: Record<Which, number> }

const SETTING_SUFFIX: Record<Which, string> = { each: 'EACH', eachDay: 'EACH_DAY', all: 'ALL', allDay: 'ALL_DAY', address: 'ADDRESS', addressDay: 'ADDRESS_DAY' }

/** The defaults, with the address limits worked out from the visitor's. */
export const DEFAULT_LIMITS: CopilotLimitNumbers = limitsFrom({})

/**
 * The limits, with any `COPILOT_LIMIT_<CHAT|ASK>_<EACH|EACH_DAY|ALL|ALL_DAY|ADDRESS|ADDRESS_DAY>`
 * setting in place of the default (Terraform's `copilot_limits`, for an event). A setting that is not
 * a whole number of at least 1 is ignored, so a typo can loosen nothing by accident. An address limit
 * that is not set follows the visitor's limit it multiplies, so raising `EACH` for an event raises it too.
 */
export function limitsFrom(env: Record<string, string | undefined>): CopilotLimitNumbers {
  const setting = (kind: 'chat' | 'ask', which: Which): number | null => {
    const raw = env[`COPILOT_LIMIT_${kind.toUpperCase()}_${SETTING_SUFFIX[which]}`]
    const n = raw === undefined ? NaN : Number(raw)
    return Number.isInteger(n) && n >= 1 ? n : null
  }
  const pick = (kind: 'chat' | 'ask'): Record<Which, number> => {
    const out = { ...LIMITS[kind] } as Record<Set, number>
    for (const which of ['each', 'eachDay', 'all', 'allDay'] as Set[]) out[which] = setting(kind, which) ?? out[which]
    return {
      ...out,
      address: setting(kind, 'address') ?? out.each * ADDRESS_SHARE,
      addressDay: setting(kind, 'addressDay') ?? out.eachDay * ADDRESS_SHARE,
    }
  }
  return { chat: pick('chat'), ask: pick('ask') }
}

/**
 * The co-pilot's rate limits. On Redis every copy of the service counts in the same keys
 * (`clps:limit:chat:each:<visitor>` and so on), so a visitor gets one allowance whichever copy
 * answers. A daily limit refuses with a 429 and a `Retry-After` that runs until the day's oldest
 * counted question is a day old.
 */
export function copilotLimits(store: SharedStore, numbers: CopilotLimitNumbers = DEFAULT_LIMITS): { ask: AskLimits; chat: ChatLimits } {
  return {
    ask: {
      each: store.limiter('ask:each', numbers.ask.each, MINUTE_MS),
      eachDay: store.limiter('ask:each-day', numbers.ask.eachDay, DAY_MS),
      address: store.limiter('ask:address', numbers.ask.address, MINUTE_MS),
      addressDay: store.limiter('ask:address-day', numbers.ask.addressDay, DAY_MS),
      all: store.limiter('ask:all', numbers.ask.all, MINUTE_MS),
      allDay: store.limiter('ask:all-day', numbers.ask.allDay, DAY_MS),
    },
    chat: {
      each: store.limiter('chat:each', numbers.chat.each, MINUTE_MS),
      eachDay: store.limiter('chat:each-day', numbers.chat.eachDay, DAY_MS),
      address: store.limiter('chat:address', numbers.chat.address, MINUTE_MS),
      addressDay: store.limiter('chat:address-day', numbers.chat.addressDay, DAY_MS),
      all: store.limiter('chat:all', numbers.chat.all, MINUTE_MS),
      allDay: store.limiter('chat:all-day', numbers.chat.allDay, DAY_MS),
    },
  }
}
