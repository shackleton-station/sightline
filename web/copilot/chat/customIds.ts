import type { SiteInfo } from '../../src/data/contract'

/**
 * The ids the model knows the visitor's own points by. A custom point's real id is its coordinates
 * ("-89.46,-137.2"), different for every point. Written into the tools' list of site ids, as it was,
 * each new point made a new tool schema: the prompt cache missed and the model service prepared the
 * schema from scratch, so the first question at any new custom point waited about 17 s for it (one
 * model call cut off at 10 s, then a slow second try). With these fixed ids in the list instead, the
 * tools are word for word the same for every question, whatever is on the visitor's screen.
 */
export const CUSTOM_SITE_IDS = ['custom-1', 'custom-2', 'custom-3', 'custom-4', 'custom-5', 'custom-6'] as const

/** The parameters, in a tool's input or a button, that hold a site id. */
const SITE_KEYS = new Set(['site', 'site_a', 'site_b'])

export interface CustomIds {
  /** The custom points as the model is shown them: each under its fixed id. */
  shown: SiteInfo[]
  /** A fixed id's real one; anything else is given back as it is. */
  real: (id: string) => string
  /** A real id's fixed one; anything else is given back as it is. */
  fixed: (id: string) => string
  /** What the model sent (a tool's input, or its answer with its buttons), with every fixed id in a site parameter put back to the real one. */
  withReal: <T>(value: T) => T
  /** Words of the model's with a fixed id in them, should it ever write one: the point's name stands in its place, so a visitor never reads "custom-1". */
  inWords: (text: string) => string
}

/** The custom points on the visitor's screen, each given one of the fixed ids, in order. Points past the last fixed id keep their own. */
export function customIds(customs: SiteInfo[]): CustomIds {
  const toReal = new Map<string, string>()
  const toFixed = new Map<string, string>()
  customs.slice(0, CUSTOM_SITE_IDS.length).forEach((site, i) => {
    toReal.set(CUSTOM_SITE_IDS[i], site.id)
    toFixed.set(site.id, CUSTOM_SITE_IDS[i])
  })
  const withReal = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map((item) => withReal(item)) as T
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SITE_KEYS.has(key) && typeof item === 'string' ? (toReal.get(item) ?? item) : withReal(item)])) as T
    }
    return value
  }
  const names = new Map(customs.slice(0, CUSTOM_SITE_IDS.length).map((site, i) => [CUSTOM_SITE_IDS[i] as string, site.name]))
  return {
    inWords: (text) => [...names].reduce((words, [id, name]) => words.split(id).join(name), text),
    shown: customs.map((site) => ({ ...site, id: toFixed.get(site.id) ?? site.id })),
    real: (id) => toReal.get(id) ?? id,
    fixed: (id) => toFixed.get(id) ?? id,
    withReal,
  }
}
