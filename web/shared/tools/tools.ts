import type Anthropic from '@anthropic-ai/sdk'
import { type Args, type ToolContext, ToolError } from './args'
import type { ToolResult } from './facts'
import { horizonsCheck } from './horizonsTool'
import { bestMonths, bestSites, compareSites, landingWindowsInMonth, nextLanding, rankLandingOptions } from './landingTools'
import { conditionsAtTime, monthSummary, siteInfo, yearSummary } from './siteTools'
import { spotLight } from './spotTools'

/** The tool the model calls to finish. The chat loop handles it; it isn't in the list below. */
export const ANSWER_TOOL = 'give_answer'

interface Tool {
  description: string
  /** The tool's input as JSON Schema. Every object in it is closed (`additionalProperties: false`), added below. */
  parameters: (siteIds: string[]) => { properties: Record<string, unknown>; required: string[] }
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>
}

const site = (siteIds: string[], what = 'Site id.') => ({ type: 'string', enum: siteIds, description: what })
const MONTH = { type: 'string', description: 'Month as YYYY-MM.' }
const TIME = { type: 'string', description: 'UTC time as YYYY-MM-DDTHH, for example 2027-05-03T12.' }
const MEASURE = {
  type: 'string',
  enum: ['landing', 'both', 'sun', 'earth'],
  description: 'landing = days with an hour that meets the mission limits; both = share of time Sun and Earth are both up; sun; earth.',
}
/** Only to try limits other than the visitor's own, when they ask "what if". */
const LIMITS = {
  mission_days: { type: 'integer', description: 'Try a different mission length, in days.' },
  max_sun_gap_h: { type: 'integer', description: 'Try a different longest time without the Sun, in hours.' },
  max_earth_gap_h: { type: 'integer', description: 'Try a different longest time without Earth, in hours.' },
  sun_at_landing: { type: 'boolean', description: 'Try requiring (or not) the Sun up at landing.' },
  earth_at_landing: { type: 'boolean', description: 'Try requiring (or not) Earth in view at landing.' },
  earth_clearance_deg: { type: 'integer', description: 'Try requiring Earth this far above the terrain: 0, 2 or 5 degrees.' },
}

const TOOLS: Record<string, Tool> = {
  site_info: {
    description: 'Where a site is (latitude, longitude, group, ground slope) and which months the data covers.',
    parameters: (ids) => ({ properties: { site: site(ids) }, required: ['site'] }),
    run: siteInfo,
  },
  conditions_at: {
    description:
      'One hour at one site: whether the Sun is up and Earth is in view, when each next changes, and whether a landing at that hour meets the mission limits. If it does not, also the next hour that does and nearby listed sites that do.',
    parameters: (ids) => ({ properties: { site: site(ids), time: TIME, ...LIMITS }, required: ['site', 'time'] }),
    run: conditionsAtTime,
  },
  month_summary: {
    description:
      'One month at one site: share of time with Sun, Earth and both; longest stretches without each; highest Sun; sunlight on panels; how many days have an hour that meets the mission limits.',
    parameters: (ids) => ({ properties: { site: site(ids), month: MONTH, ...LIMITS }, required: ['site', 'month'] }),
    run: monthSummary,
  },
  year_summary: {
    description: 'One calendar year at one site: share of time with Sun, Earth and both, and the longest stretches without each.',
    parameters: (ids) => ({ properties: { site: site(ids), year: { type: 'integer', description: 'Calendar year.' } }, required: ['site', 'year'] }),
    run: yearSummary,
  },
  best_months: {
    description: 'The best months (and the worst) at one site by a chosen measure, over all the data or one year. Months equal at the precision shown come back together as a tie (best_months, best_tie).',
    parameters: (ids) => ({
      properties: {
        site: site(ids),
        measure: MEASURE,
        year: { type: 'integer', description: 'Only this calendar year. Leave out for all years.' },
        count: { type: 'integer', description: 'How many best months to return (default 3).' },
        ...LIMITS,
      },
      required: ['site', 'measure'],
    }),
    run: bestMonths,
  },
  best_sites: {
    description: 'Ranks every listed site for one month by a chosen measure. Sites equal at the precision shown come back together as a tie (best_sites, best_tie).',
    parameters: () => ({
      properties: { month: MONTH, measure: MEASURE, count: { type: 'integer', description: 'How many sites to return (default 5).' }, ...LIMITS },
      required: ['month', 'measure'],
    }),
    run: bestSites,
  },
  landing_windows: {
    description: 'The stretches of hours in one month, at one site, when a landing meets the mission limits.',
    parameters: (ids) => ({ properties: { site: site(ids), month: MONTH, ...LIMITS }, required: ['site', 'month'] }),
    run: landingWindowsInMonth,
  },
  next_landing: {
    description: 'The first hour at or after a given time when a landing at one site meets the mission limits. Use for "my date slipped" questions.',
    parameters: (ids) => ({ properties: { site: site(ids), time: TIME, ...LIMITS }, required: ['site', 'time'] }),
    run: nextLanding,
  },
  compare_sites: {
    description: 'Two listed sites in the same month, row by row, saying which is better or that the difference is too small to call.',
    parameters: (ids) => ({
      properties: { site_a: site(ids, 'First site id.'), site_b: site(ids, 'Second site id.'), month: MONTH },
      required: ['site_a', 'site_b', 'month'],
    }),
    run: compareSites,
  },
  spot_light: {
    description:
      'The spot the visitor tapped on the Atlas map (r0.tapped_spot), for one month: share of time with the Sun, Earth and both, the longest stretches without each, and how much the ground within 120 m differs. Only works when r0 has a tapped spot. It takes no place: the place is the one the visitor tapped.',
    parameters: () => ({ properties: { month: MONTH }, required: ['month'] }),
    run: spotLight,
  },
  rank_options: {
    description: 'Ranks two to six landing options, each a site and an hour: options that meet the limits first, then by the shortest time without the Sun, then without Earth.',
    parameters: (ids) => ({
      properties: {
        options: {
          type: 'array',
          items: { type: 'object', properties: { site: site(ids), time: TIME }, required: ['site', 'time'], additionalProperties: false },
        },
        ...LIMITS,
      },
      required: ['options'],
    }),
    run: rankLandingOptions,
  },
  horizons_check: {
    description:
      "Asks NASA JPL Horizons, live, where the Sun and Earth stand in the sky of one listed site at one hour, and sets its answer beside this app's. Use only when the visitor asks to check with NASA or Horizons, or asks whether the app's Sun and Earth positions can be trusted. It takes a second or two.",
    parameters: (ids) => ({ properties: { site: site(ids), time: TIME }, required: ['site', 'time'] }),
    run: horizonsCheck,
  },
}

/**
 * Strict tool use (`strict: true`) makes the API hold the model's input to the schema exactly. The
 * API allows at most 24 optional parameters across all strict tools in one request, and the data
 * tools that take "what if" limits have six optional ones each, so only the tools with no optional
 * parameter are strict, plus the answer, whose shape matters most (12 optional parameters). The
 * others are checked by the tools themselves (args.ts), which tell the model what was wrong.
 */
const STRICT = new Set(['site_info', 'year_summary', 'compare_sites', 'spot_light', ANSWER_TOOL])

/** The optional parameters of a schema, nested ones included: what the API's limit of 24 counts. */
export function optionalParameters(schema: unknown): number {
  if (typeof schema !== 'object' || schema === null) return 0
  const { properties = {}, required = [], items } = schema as { properties?: Record<string, unknown>; required?: string[]; items?: unknown }
  let count = optionalParameters(items)
  for (const [name, value] of Object.entries(properties)) {
    if (!required.includes(name)) count += 1
    count += optionalParameters(value)
  }
  return count
}

/** What the model is told it can call, as Anthropic tool definitions. The order never changes, so the prompt cache holds. */
export function toolDeclarations(siteIds: string[]): Anthropic.Beta.BetaTool[] {
  const data = Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    ...(STRICT.has(name) ? { strict: true } : {}),
    input_schema: { type: 'object' as const, ...tool.parameters(siteIds), additionalProperties: false },
  }))
  const answer = {
    name: ANSWER_TOOL,
    description: 'Give the visitor your answer. Call this once you have the facts you need, and only this to finish.',
    strict: true,
    input_schema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description:
            'Two to four plain sentences. Every number, date and time must be a reference like {{r2.pct_sun}}, copied from a tool result. Never type a digit yourself.',
        },
        actions: {
          type: 'array',
          description: 'Up to three buttons that take the visitor to what you described.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['open', 'compare', 'limits'], description: 'open = show one site; compare = two sites side by side; limits = change the mission limits.' },
              site: site(siteIds, 'For open: the site. For compare: the first site.'),
              site_b: site(siteIds, 'For compare: the second site.'),
              month: MONTH,
              time: { ...TIME, description: 'For open: jump to this hour. UTC, as YYYY-MM-DDTHH.' },
              ...LIMITS,
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        followups: {
          type: 'array',
          description: 'Up to three short questions the visitor might ask next.',
          items: { type: 'string' },
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
  }
  return [...data, answer]
}

/** Runs one data tool. Anything that goes wrong comes back as a message the model can act on. */
export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS[name]
  if (!tool) return { ok: false, error: `There is no tool called ${name}.` }
  try {
    return await tool.run(args, ctx)
  } catch (error) {
    if (error instanceof ToolError) return { ok: false, error: error.message }
    console.error(`chat tool ${name} failed`, error)
    return { ok: false, error: 'That could not be worked out from the data.' }
  }
}
