import { createClient, createCluster } from 'redis'
import { DELETE_IF_SCRIPT, SLIDING_WINDOW_SCRIPT } from '../shared/redisStore'

/**
 * The Redis Cluster drill: hash slots, a key that moves when the cluster is resharded, and what a
 * client does when it is redirected. It only reads and writes its own keys (`clps:drill:…`, which
 * expire in an hour), and prints what it sees. It is not part of the service: it is a second file
 * in the co-pilot's image, run by hand from inside the network.
 *
 *   node cluster-drill.cjs before      (default) the slot map; twelve keys written with a plain
 *                                      client, which is refused with MOVED for most of them; the
 *                                      same keys with the cluster client, which follows the map;
 *                                      hash tags; where each key lives, remembered in the cluster
 *   node cluster-drill.cjs watch 120   while the cluster is resharded: asks each key's old shard
 *                                      for it twice a second, with a plain client, and prints each
 *                                      change (the value, then ASK while its slot is moving, then
 *                                      MOVED), following an ASK by hand the way a cluster client does
 *   node cluster-drill.cjs after       the slot map again; which of the twelve keys moved, and that
 *                                      every one still holds its value
 *
 * Where to connect: CACHE_CLUSTER_HOST and CACHE_CLUSTER_PORT (the discovery endpoint), the same
 * settings the co-pilot service reads. How to run it: docs/ARCHITECTURE_PHASE_4.md, section 3.
 */
const host = process.env.CACHE_CLUSTER_HOST
const port = Number(process.env.CACHE_CLUSTER_PORT ?? 6379)
const step = process.argv[2] ?? process.env.DRILL_STEP ?? 'before'
const KEYS = Array.from({ length: 12 }, (_, n) => `clps:drill:key:${String(n).padStart(2, '0')}`)
/** Where the twelve keys lived at the `before` step. Its hash tag keeps it in the slot of "map". */
const MAP_KEY = 'clps:drill:{map}'
const TTL_S = 3600

interface Shard {
  /** The primary's address as the cluster announces it. */
  host: string
  port: number
  id: string
  /** Slot ranges this shard owns, inclusive: [[0, 5460], …]. */
  ranges: [number, number][]
}

const text = (value: unknown) => (Buffer.isBuffer(value) ? value.toString() : String(value))
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** One command on one connection, as a client that knows nothing about clusters would send it. Never throws: an error comes back as its text. */
async function raw(client: Plain, ...command: string[]): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await client.sendCommand(command) }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}

/** A client that knows nothing about clusters, connected to one node. */
async function plainClient(to: { host: string; port: number }) {
  const client = createClient({ socket: { host: to.host, port: to.port, connectTimeout: 5000, reconnectStrategy: false } })
  client.on('error', () => {})
  await client.connect()
  return client
}
type Plain = Awaited<ReturnType<typeof plainClient>>

/** The library's cluster client: it reads the slot map through the discovery endpoint and follows redirects. */
async function clusterClient() {
  const cluster = createCluster({ rootNodes: [{ socket: { host, port } }] })
  cluster.on('error', () => {})
  await cluster.connect()
  return cluster
}
type Cluster = Awaited<ReturnType<typeof clusterClient>>

/** A reply that is a list of name, value, name, value (RESP2) or a map (RESP3), as an object. */
function pairs(reply: unknown): Record<string, unknown> {
  if (Array.isArray(reply)) return Object.fromEntries(Array.from({ length: Math.floor(reply.length / 2) }, (_, n) => [text(reply[2 * n]), reply[2 * n + 1]]))
  if (reply instanceof Map) return Object.fromEntries([...reply.entries()].map(([name, value]) => [text(name), value]))
  return (reply ?? {}) as Record<string, unknown>
}

/** The shards and the slots each owns, from CLUSTER SHARDS; from CLUSTER SLOTS on a server that has no such command. */
async function readShards(client: Plain): Promise<Shard[]> {
  const shards = await raw(client, 'CLUSTER', 'SHARDS')
  if (shards.ok && Array.isArray(shards.value)) {
    return shards.value
      .map((entry): Shard | null => {
        const shard = pairs(entry)
        const slots = (shard.slots as unknown[]).map(Number)
        const primary = (shard.nodes as unknown[]).map(pairs).find((node) => text(node.role) === 'master')
        if (!primary) return null
        return {
          host: text(primary.endpoint ?? primary.ip),
          port: Number(primary.port),
          id: text(primary.id),
          ranges: Array.from({ length: slots.length / 2 }, (_, n): [number, number] => [slots[2 * n], slots[2 * n + 1]]),
        }
      })
      .filter((shard): shard is Shard => shard !== null && shard.ranges.length > 0)
      .sort((a, b) => a.ranges[0][0] - b.ranges[0][0])
  }
  const slots = await raw(client, 'CLUSTER', 'SLOTS')
  if (!slots.ok) throw new Error(`neither CLUSTER SHARDS nor CLUSTER SLOTS answered: ${slots.error}`)
  const byNode = new Map<string, Shard>()
  for (const [from, to, primary] of slots.value as [number, number, unknown[]][]) {
    const [nodeHost, nodePort, id] = [text(primary[0]), Number(primary[1]), text(primary[2])]
    const shard = byNode.get(id) ?? { host: nodeHost, port: nodePort, id, ranges: [] }
    shard.ranges.push([Number(from), Number(to)])
    byNode.set(id, shard)
  }
  return [...byNode.values()].sort((a, b) => a.ranges[0][0] - b.ranges[0][0])
}

const ownerOf = (shards: Shard[], slot: number) => shards.find((shard) => shard.ranges.some(([from, to]) => slot >= from && slot <= to))
const address = (shard: { host: string; port: number } | undefined) => (shard ? `${shard.host}:${shard.port}` : 'nobody')
const slotCount = (shard: Shard) => shard.ranges.reduce((sum, [from, to]) => sum + to - from + 1, 0)

function printShards(shards: Shard[]): void {
  console.log(`\nThe slot map: ${shards.length} shards, 16384 slots`)
  for (const [n, shard] of shards.entries()) {
    console.log(`  shard ${n + 1}  ${address(shard).padEnd(22)} ${String(slotCount(shard)).padStart(5)} slots  ${shard.ranges.map(([from, to]) => `${from}-${to}`).join(', ')}  (node ${shard.id.slice(0, 8)})`)
  }
}

async function slotOf(client: Plain, key: string): Promise<number> {
  const answer = await raw(client, 'CLUSTER', 'KEYSLOT', key)
  if (!answer.ok) throw new Error(`CLUSTER KEYSLOT ${key}: ${answer.error}`)
  return Number(answer.value)
}

async function before(entry: Plain): Promise<void> {
  const shards = await readShards(entry)
  printShards(shards)

  console.log('\n1. A plain client, connected to one node, writes twelve keys. It does not know the slot map.')
  console.log(`   ${'key'.padEnd(20)} ${'slot'.padStart(5)}  ${'owner'.padEnd(22)} what the node it asked said`)
  let refused = 0
  for (const key of KEYS) {
    const slot = await slotOf(entry, key)
    const wrote = await raw(entry, 'SET', key, `value of ${key}`, 'EX', String(TTL_S))
    if (!wrote.ok) refused += 1
    console.log(`   ${key.padEnd(20)} ${String(slot).padStart(5)}  ${address(ownerOf(shards, slot)).padEnd(22)} ${wrote.ok ? text(wrote.value) : wrote.error}`)
  }
  console.log(`   ${refused} of ${KEYS.length} were refused. "MOVED <slot> <address>" means: that slot is not mine, ask there. The key was not written.`)

  console.log('\n2. The cluster client writes the same keys. It read the slot map first, and sends each key to its owner.')
  const cluster = await clusterClient()
  for (const key of KEYS) await cluster.set(key, `value of ${key}`, { EX: TTL_S })
  const read = await Promise.all(KEYS.map((key) => cluster.get(key)))
  console.log(`   ${read.filter((value, n) => value === `value of ${KEYS[n]}`).length} of ${KEYS.length} written and read back, with no error shown to the caller.`)

  console.log('\n3. Hash tags. Only the part of a key inside {braces} is hashed, so keys with the same tag share a slot.')
  for (const key of ['clps:cache:copilot:abc', 'clps:lock:copilot:abc', 'clps:cache:{copilot:abc}', 'clps:lock:{copilot:abc}']) {
    console.log(`   ${key.padEnd(28)} slot ${await slotOf(entry, key)}`)
  }
  // A script that touches two keys: it must find both on one shard, so both must be in one slot.
  const twoKeys = "redis.call('SET', KEYS[1], ARGV[1], 'EX', 60) redis.call('SET', KEYS[2], ARGV[1], 'EX', 60) return 1"
  const apart = await cluster.eval(twoKeys, { keys: ['clps:drill:cache:abc', 'clps:drill:lock:abc'], arguments: ['x'] }).then(
    () => 'ran',
    (error: unknown) => errorText(error),
  )
  const together = await cluster.eval(twoKeys, { keys: ['clps:drill:cache:{abc}', 'clps:drill:lock:{abc}'], arguments: ['x'] }).then(
    () => 'ran',
    (error: unknown) => errorText(error),
  )
  console.log(`   A script with two keys in different slots:  ${apart}`)
  console.log(`   The same script, the keys sharing a tag:    ${together}`)
  // This repository's own scripts each name one key, so they run on a cluster as they are.
  const window = await cluster.eval(SLIDING_WINDOW_SCRIPT, { keys: ['clps:drill:limit:visitor'], arguments: [String(Date.now()), '60000', '6', 'drill'] })
  await cluster.set('clps:drill:lock:one', 'token', { EX: 60 })
  const released = await cluster.eval(DELETE_IF_SCRIPT, { keys: ['clps:drill:lock:one'], arguments: ['token'] })
  console.log(`   This repository's scripts name one key each: the rate limit answered ${text(window)}, the lock release ${text(released)}.`)

  // Remember where each key lives, in the cluster itself, for the `after` step.
  const map = Object.fromEntries(await Promise.all(KEYS.map(async (key) => [key, { slot: await slotOf(entry, key), owner: address(ownerOf(shards, await slotOf(entry, key))) }])))
  await cluster.set(MAP_KEY, JSON.stringify({ at: new Date().toISOString(), shards: shards.length, map }), { EX: TTL_S })
  console.log(`\nRemembered where the twelve keys live (${MAP_KEY}, for an hour). Now change the number of shards, and run the "after" step.`)
  cluster.destroy()
}

interface Remembered {
  at: string
  shards: number
  map: Record<string, { slot: number; owner: string }>
}

async function remembered(): Promise<{ cluster: Cluster; was: Remembered }> {
  const cluster = await clusterClient()
  const kept = await cluster.get(MAP_KEY)
  if (!kept) throw new Error(`${MAP_KEY} is not there: run the "before" step first (it is kept for an hour)`)
  return { cluster, was: JSON.parse(kept) as Remembered }
}

async function after(entry: Plain): Promise<void> {
  const { cluster, was } = await remembered()
  const shards = await readShards(entry)
  printShards(shards)
  console.log(`\nThe twelve keys, against where they lived at ${was.at} (${was.shards} shards then, ${shards.length} now)`)
  console.log(`   ${'key'.padEnd(20)} ${'slot'.padStart(5)}  ${'before'.padEnd(22)} ${'now'.padEnd(22)} ${'moved'.padEnd(6)} value still there`)
  let moved = 0
  let intact = 0
  for (const key of KEYS) {
    const slot = await slotOf(entry, key)
    const now = address(ownerOf(shards, slot))
    const value = await cluster.get(key)
    const didMove = now !== was.map[key].owner
    if (didMove) moved += 1
    if (value === `value of ${key}`) intact += 1
    console.log(`   ${key.padEnd(20)} ${String(slot).padStart(5)}  ${was.map[key].owner.padEnd(22)} ${now.padEnd(22)} ${(didMove ? 'yes' : 'no').padEnd(6)} ${value === `value of ${key}` ? 'yes' : `NO (${value})`}`)
  }
  console.log(`   ${moved} of ${KEYS.length} keys moved to another shard. Each key's slot is the same as before: a slot never changes, its owner does.`)
  console.log(`   ${intact} of ${KEYS.length} still hold their value: the keys travelled with their slots.`)
  cluster.destroy()
}

/** While the cluster is resharded: ask each key's old owner for it, with a plain client, and print each change. */
async function watch(entry: Plain, seconds: number): Promise<void> {
  const { cluster, was } = await remembered()
  cluster.destroy()
  const nodes = new Map<string, Plain>()
  const nodeFor = async (owner: string): Promise<Plain> => {
    const found = nodes.get(owner)
    if (found) return found
    const [nodeHost, nodePort] = [owner.slice(0, owner.lastIndexOf(':')), Number(owner.slice(owner.lastIndexOf(':') + 1))]
    const client = await plainClient({ host: nodeHost, port: nodePort })
    nodes.set(owner, client)
    return client
  }
  console.log(`\nAsking each key's old shard for it, twice a second, for ${seconds} s. A line is printed when an answer changes.`)
  const last = new Map<string, string>()
  const started = Date.now()
  while (Date.now() - started < seconds * 1000) {
    for (const key of KEYS) {
      const owner = was.map[key].owner
      const answer = await nodeFor(owner)
        .then((node) => raw(node, 'GET', key))
        .catch((error: unknown) => ({ ok: false as const, error: `could not connect: ${errorText(error)}` }))
      let said = answer.ok ? (answer.value === null ? 'nothing there' : 'the value') : answer.error
      // What a cluster client does with ASK: go to the address given, say ASKING, and repeat the command there, once.
      const ask = !answer.ok && /^ASK (\d+) (.+)$/.exec(answer.error)
      if (ask) {
        const there = await nodeFor(ask[2])
        await raw(there, 'ASKING')
        const followed = await raw(there, 'GET', key)
        said += `  -> ASKING, then GET at ${ask[2]}: ${followed.ok ? (followed.value === null ? 'nothing there' : 'the value') : followed.error}`
      }
      if (last.get(key) !== said) {
        last.set(key, said)
        console.log(`   ${((Date.now() - started) / 1000).toFixed(1).padStart(6)} s  ${key}  (slot ${was.map[key].slot}, was on ${owner})  ${said}`)
      }
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  for (const node of nodes.values()) node.destroy()
  void entry
}

async function main(): Promise<void> {
  if (!host) throw new Error('CACHE_CLUSTER_HOST is not set: the address of the cluster\'s discovery endpoint')
  console.log(`Redis Cluster drill, step "${step}", through ${host}:${port}`)
  const entry = await plainClient({ host, port })
  try {
    if (step === 'before') await before(entry)
    else if (step === 'after') await after(entry)
    else if (step === 'watch') await watch(entry, Number(process.argv[3] ?? process.env.DRILL_SECONDS ?? 120))
    else throw new Error(`unknown step "${step}": before, watch or after`)
  } finally {
    entry.destroy()
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(`The drill stopped: ${errorText(error)}`)
    process.exit(1)
  },
)
