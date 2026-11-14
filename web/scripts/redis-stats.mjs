// Prints the cache's hit rate per kind of key, what single flight did, and the memory Redis uses.
// Read-only: it changes nothing, and asks no question of the model.
//
//   node scripts/redis-stats.mjs https://lunarsightline.com                  hit rates, flights, memory
//   node scripts/redis-stats.mjs https://lunarsightline.com --monitoring     and Google's own numbers
//   node scripts/redis-stats.mjs http://localhost:8083                          on a laptop (Compose)
//   node scripts/redis-stats.mjs https://lunarsightline.com --json           the raw answer
//
// Two sources, because each sees what the other cannot:
//
//   1. The co-pilot service's GET /api/chat/status/cache. Every cache read adds one to a counter in
//      Redis (`clps:stats:<day>`, fields like `cache:copilot:hit`), whichever copy of whichever
//      service made it, so the numbers are whole. It also asks Redis for the memory in use (INFO),
//      which a laptop cannot do itself: the instance has a private address. `copilot` is kept
//      answers; `speak` is spoken audio, counted by the web server into the same Redis.
//      The counters live in the instance: they are gone when it is replaced. Read them before.
//
//   2. With --monitoring: Cloud Monitoring's Memorystore metrics, read as you (`gcloud auth
//      print-access-token`). Memory used and its ratio, the instance's own hit ratio (every key
//      lookup together, not per kind: it includes the breaker's and the locks' reads), connected
//      clients, and, on an instance with read replicas, how far the replica is behind. With
//      --cluster <name> also the Redis Cluster's memory and keys per shard. These are a minute or
//      two behind, and survive the instance being replaced (a new instance is a new series).
//
// Options: --project (default clps-compute-6z1nc), --region (us-east4), --instance (clps-web-store; clps-web-store-standard-ha while the replica window is on),
// --cluster <name> (default: none), --minutes (how far back --monitoring looks, default 10).
import { execFileSync } from 'node:child_process'

const base = (process.argv[2] ?? '').replace(/\/$/, '')
const flag = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : fallback
}
const has = (name) => process.argv.includes(name)
if (!base || base.startsWith('--')) {
  console.error('Usage: node scripts/redis-stats.mjs <site or co-pilot service URL> [--monitoring] [--cluster <name>] [--project <id>] [--region <region>] [--instance <name>] [--minutes <n>] [--json]')
  process.exit(2)
}

const percent = (share) => (share === null || share === undefined ? 'no reads' : `${(share * 100).toFixed(1)}%`)
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const pad = (text, width) => String(text).padEnd(width)

// ---------- 1. The service's own counters ----------

const response = await fetch(`${base}/api/chat/status/cache`, { signal: AbortSignal.timeout(15_000) }).catch((error) => ({ ok: false, status: 0, error }))
if (!response.ok) {
  console.error(`GET ${base}/api/chat/status/cache answered ${response.status || response.error?.message}. The co-pilot service answers it; a version from before Phase 4 has no such address.`)
  // Google's numbers do not depend on the service: carry on to them if they were asked for.
  if (!has('--monitoring')) process.exit(1)
}
const status = response.ok ? await response.json() : null
if (!status) {
  // Nothing to print from the service.
} else if (has('--json')) {
  console.log(JSON.stringify(status, null, 2))
} else {
  console.log(`Read at ${status.readAt} from ${base}`)
  console.log(`Store, as the copy that answered sees it: ${status.redis.state}; read endpoint ${status.redis.readEndpoint}; ${status.redis.connections} connection(s) made; ${status.redis.fallbacks} call(s) answered from memory`)
  console.log(status.memory ? `Redis memory in use (primary): ${megabytes(status.memory.usedBytes)}${status.memory.maxBytes ? ` of ${megabytes(status.memory.maxBytes)} (${((status.memory.usedBytes / status.memory.maxBytes) * 100).toFixed(2)}%)` : ''}` : 'Redis memory: could not be asked (no Redis, or it did not answer)')
  if (status.days.length === 0) console.log('No counters: this copy has no Redis, or it could not be read.')
  for (const day of status.days) {
    console.log(`\n${day.day} (UTC)`)
    const kinds = Object.keys(day.cache).sort()
    if (kinds.length === 0) console.log('  no cache reads counted')
    else console.log(`  ${pad('kind', 10)}${pad('reads', 8)}${pad('hits', 8)}${pad('misses', 8)}hit rate`)
    for (const kind of kinds) {
      const { hits, misses, hitRate } = day.cache[kind]
      console.log(`  ${pad(kind, 10)}${pad(hits + misses, 8)}${pad(hits, 8)}${pad(misses, 8)}${percent(hitRate)}`)
    }
    for (const [kind, flights] of Object.entries(day.flights)) {
      const total = Object.values(flights).reduce((sum, n) => sum + n, 0)
      const saved = (flights.waited ?? 0) + (flights.found ?? 0)
      console.log(`  single flight, ${kind}: ${Object.entries(flights).map(([how, n]) => `${how} ${n}`).join(', ')} (${saved} of ${total} missed questions answered without a model call of their own)`)
    }
    for (const [kind, n] of Object.entries(day.clusterFellBack)) console.log(`  Redis Cluster, ${kind}: ${n} read(s) or write(s) went to the ordinary instance instead`)
  }
}

// ---------- 2. Cloud Monitoring ----------

if (has('--monitoring')) {
  const project = flag('--project', 'clps-compute-6z1nc')
  const region = flag('--region', 'us-east4')
  const instance = flag('--instance', 'clps-web-store')
  const cluster = flag('--cluster', null)
  const minutes = Number(flag('--minutes', '10'))
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim()
  const end = new Date()
  const start = new Date(end.getTime() - minutes * 60_000)

  /** The latest point of each series of a metric: `[{ labels, value, at }]`. */
  const latest = async (type, resourceFilter) => {
    const query = new URLSearchParams({ filter: `metric.type = "${type}" AND ${resourceFilter}`, 'interval.startTime': start.toISOString(), 'interval.endTime': end.toISOString() })
    const answer = await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?${query}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    if (!answer.ok) return { error: `HTTP ${answer.status}` }
    const { timeSeries = [] } = await answer.json()
    return timeSeries.map((series) => {
      const point = series.points?.[0]
      const value = point?.value ?? {}
      return { labels: { ...series.resource?.labels, ...series.metric?.labels }, value: Number(value.doubleValue ?? value.int64Value ?? Number.NaN), at: point?.interval?.endTime }
    })
  }
  const show = (name, series, format) => {
    if (series.error) return console.log(`  ${pad(name, 34)}could not be read (${series.error})`)
    if (series.length === 0) return console.log(`  ${pad(name, 34)}no data in the last ${minutes} minutes`)
    for (const point of series) {
      const which = [point.labels.role, point.labels.node_id, point.labels.shard_id].filter(Boolean).join(' ')
      console.log(`  ${pad(name, 34)}${pad(format(point.value), 14)}${which ? `${which}  ` : ''}(${point.at})`)
    }
  }

  const ofInstance = `resource.type = "redis_instance" AND resource.labels.instance_id = "projects/${project}/locations/${region}/instances/${instance}"`
  console.log(`\nCloud Monitoring, instance ${instance} (${region}), latest point in the last ${minutes} minutes`)
  show('memory used', await latest('redis.googleapis.com/stats/memory/usage', ofInstance), megabytes)
  show('memory used, share of the limit', await latest('redis.googleapis.com/stats/memory/usage_ratio', ofInstance), (value) => `${(value * 100).toFixed(2)}%`)
  show('hit ratio, every key lookup', await latest('redis.googleapis.com/stats/cache_hit_ratio', ofInstance), (value) => `${(value * 100).toFixed(1)}%`)
  show('connected clients', await latest('redis.googleapis.com/clients/connected', ofInstance), (value) => String(value))
  show('replica behind the primary', await latest('redis.googleapis.com/replication/master/slaves/lag', ofInstance), (value) => `${value} s`)

  if (cluster) {
    const ofCluster = `resource.type = "redis.googleapis.com/Cluster" AND resource.labels.cluster_id = "${cluster}"`
    const ofNodes = `resource.type = "redis.googleapis.com/ClusterNode" AND resource.labels.cluster_id = "${cluster}"`
    console.log(`\nCloud Monitoring, Redis Cluster ${cluster} (${region})`)
    show('memory used, all shards', await latest('redis.googleapis.com/cluster/memory/total_used_memory', ofCluster), megabytes)
    show('memory used, average share', await latest('redis.googleapis.com/cluster/memory/average_utilization', ofCluster), (value) => `${(value * 100).toFixed(2)}%`)
    show('keys, all shards', await latest('redis.googleapis.com/cluster/keyspace/total_keys', ofCluster), (value) => String(value))
    show('keys, per node', await latest('redis.googleapis.com/cluster/node/keyspace/total_keys', ofNodes), (value) => String(value))
  }
}
