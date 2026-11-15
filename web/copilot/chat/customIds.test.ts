import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { SiteInfo } from '../../src/data/contract'
import type { Bucket } from '../../shared/bucket'
import { siteData } from '../../shared/tools/data'
import type { Model } from '../model'
import { claudeMessage, toolUse } from '../standIns'
import { viewFrom } from './actions'
import { runChat } from './chat'
import { CUSTOM_SITE_IDS, customIds } from './customIds'

// A custom point a few meters from Connecting Ridge: the committed test tiles cover it, so this runs in CI.
const POINT = '-89.45267,-137.14865'
const NAME = 'Custom point 89.453°S, 137.149°W'
const dataDir = fileURLToPath(new URL('../../public/data', import.meta.url))
const tileDirs = ['../../public/tiles/', '../../src/lib/test-tiles/'].map((dir) => fileURLToPath(new URL(dir, import.meta.url)))
const bucket: Bucket = {
  async get(key) {
    const match = /^tiles\/((?:polar|global)\/\d+_\d+)\.bin\.gz$/.exec(key)
    const path = match ? tileDirs.map((dir) => `${dir}${match[1]}.bin.gz`).find((one) => existsSync(one)) : undefined
    if (!path) return null
    const body = readFileSync(path)
    return { status: 200, body: new Response(body).body, length: String(body.length), contentRange: null, etag: null }
  },
}
const data = siteData(dataDir, bucket)

type Call = { name: string; args: Record<string, unknown> }
function scripted(...turns: Call[][]) {
  const generate = vi.fn<Model['generate']>()
  for (const turn of turns) generate.mockImplementationOnce(async () => claudeMessage({ content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...turn.map((made) => toolUse(made.name, made.args))] }))
  return { generate }
}
const ask = (model: Model, hash: string, text: string) => runChat({ turns: [{ role: 'user', text }], view: viewFrom(hash), viewHash: hash }, { model, data, wait: async () => {}, clock: () => Date.parse('2026-11-15T02:00:00Z') })
const CUSTOM = `#a=${POINT}@2027-05&t=100&limits=14_72_72_1_1&mode=plan`
const LISTED = '#a=connecting-ridge@2027-05&t=100&limits=14_72_72_1_1&mode=plan'

describe('the ids the model knows a custom point by', () => {
  const point = (id: string, name: string) => ({ id, name, lat: 0, lon: 0, group: 'Custom' }) as SiteInfo

  it('gives each custom point a fixed id, in order, and puts the real one back wherever a site is named', () => {
    const ids = customIds([point('-89.46,-137.2', 'Custom point A'), point('-88.9,40', 'Custom point B')])
    expect(ids.shown.map((site) => site.id)).toEqual(['custom-1', 'custom-2'])
    expect(ids.real('custom-2')).toBe('-88.9,40')
    expect(ids.fixed('-89.46,-137.2')).toBe('custom-1')
    expect(ids.real('connecting-ridge')).toBe('connecting-ridge')
    expect(ids.withReal({ site: 'custom-1', time: '2027-05-05T04' })).toEqual({ site: '-89.46,-137.2', time: '2027-05-05T04' })
    expect(ids.withReal({ site_a: 'custom-1', site_b: 'shackleton-rim' })).toEqual({ site_a: '-89.46,-137.2', site_b: 'shackleton-rim' })
    expect(ids.withReal({ options: [{ site: 'custom-2', time: 'x' }], text: 'custom-1 in words is left to inWords', actions: [{ type: 'open', site: 'custom-1' }] })).toEqual({
      options: [{ site: '-88.9,40', time: 'x' }],
      text: 'custom-1 in words is left to inWords',
      actions: [{ type: 'open', site: '-89.46,-137.2' }],
    })
    // A fixed id that stands for nothing is left as it is: the tool then says the site is unknown.
    expect(ids.withReal({ site: 'custom-5' })).toEqual({ site: 'custom-5' })
    expect(ids.inWords('The Sun is up at custom-1.')).toBe('The Sun is up at Custom point A.')
    expect(CUSTOM_SITE_IDS).toHaveLength(6)
  })
})

describe('a question at a custom point', () => {
  it('gives the model the same tools and the same rules, word for word, as a question at a listed site or at another point', async () => {
    const asked = async (hash: string) => {
      const model = scripted([{ name: 'give_answer', args: { text: 'Yes.' } }])
      await ask(model, hash, 'Is the Sun up here?')
      const request = model.generate.mock.calls[0][0]
      return { tools: JSON.stringify(request.tools), system: JSON.stringify(request.system), prompt: JSON.stringify(request.messages) }
    }
    const [listed, custom] = [await asked(LISTED), await asked(CUSTOM)]
    expect(custom.tools).toBe(listed.tools)
    expect(custom.system).toBe(listed.system)
    // The point's coordinates are nowhere in the tools: a new point makes no new tool schema.
    expect(custom.tools).not.toContain('-89.45')
    for (const id of CUSTOM_SITE_IDS) expect(listed.tools).toContain(`"${id}"`)
    // The point is named in the question's own part, under its fixed id, with the id the tools take.
    expect(custom.prompt).toContain(`- custom-1: ${NAME}`)
    expect(custom.prompt).toMatch(/site_id: custom-1/)
    expect(listed.prompt).not.toContain('custom-1:')
  })

  it('a tool called with the fixed id looks the point itself up, and a button with it opens the point', async () => {
    const model = scripted(
      [{ name: 'conditions_at', args: { site: 'custom-1', time: '2027-05-05T04' } }],
      [{ name: 'give_answer', args: { text: 'At custom-1 the Sun is {{r1.sun}}.', actions: [{ type: 'open', site: 'custom-1', month: '2027-06' }] } }],
    )
    const outcome = await ask(model, CUSTOM, 'Is the Sun up here?')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.fellBack).toBe(false)
    expect(outcome.reply.sources.join(' ')).toContain(NAME)
    // The visitor never reads the fixed id: the point's name stands in its place.
    expect(outcome.reply.text).toMatch(new RegExp(`^At ${NAME.replace(/[.°]/g, '\\$&')} the Sun is (up|down)\\.$`))
    expect(outcome.reply.actions.map((action) => action.hash).join(' ')).toContain(`#a=${POINT}@2027-06`)
  })
})
