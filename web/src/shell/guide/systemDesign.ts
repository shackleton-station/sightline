/**
 * The system, as the Guide draws it: its boxes by area, and the arrows between them. Every line is
 * what `infra/`, the services' code and the deploy workflows say today (docs/SYSTEM_DESIGN.md).
 */

/** Whose a box is: our own code, a store of data, or a service that is managed for us or outside. */
export type BoxKind = 'ours' | 'store' | 'outside'

export interface SystemBox {
  id: string
  kind: BoxKind
  name: string
  says: string
}

export interface SystemArea {
  id: 'edge' | 'request' | 'build' | 'events' | 'watch'
  title: string
  boxes: SystemBox[]
}

type Side = 'top' | 'right' | 'bottom' | 'left'

export interface SystemArrow {
  from: string
  to: string
  /** The sides the arrow leaves and arrives by. Two left sides make an arrow that goes round the boxes between. */
  sides: [Side, Side]
  /** How far along the side it leaves, 0 to 1; the middle when left out. */
  at?: number
  /** The failure path is dashed; a status check is dotted. */
  line?: 'failure' | 'status'
  /** The arrow in words, for the list under the picture. */
  says: string
}

/** What changes with the build: how many sites, which years, and the model's name as Scout's service reports it. */
export interface SystemFacts {
  siteCount: number
  span: string
  model: string | null
}

export function systemAreas({ siteCount, span, model }: SystemFacts): SystemArea[] {
  return [
    {
      id: 'edge',
      title: 'Edge',
      boxes: [
        { id: 'browser', kind: 'outside', name: 'Browser', says: 'React pages and Three.js 3D views. Custom points are computed here. Sign in with Google is optional.' },
        { id: 'lb', kind: 'outside', name: 'Load balancer + Cloud CDN', says: 'lunarsightline.com, with a managed certificate. Sends each path to its service, to the bucket or to Moon Trek. The header x-clps-canary reaches a new version.' },
        { id: 'armor', kind: 'outside', name: 'Cloud Armor', says: 'The firewall on the paths to the services and Moon Trek: 120 API calls a minute per address, a 5-minute ban past 3,000 a minute, and an XSS rule that only watches.' },
        { id: 'trek', kind: 'outside', name: 'NASA Moon Trek', says: '/trek/ passes trek.nasa.gov map tiles through the CDN, kept 30 days.' },
        { id: 'buckets', kind: 'outside', name: 'Backend buckets', says: 'Terrain tiles and the light grid, kept a day; video, kept an hour. No server in the path.' },
      ],
    },
    {
      id: 'request',
      title: 'Request path · Cloud Run, us-east4',
      boxes: [
        { id: 'plans', kind: 'ours', name: 'clps-plans', says: 'Saves, opens, lists and deletes mission plans at /api/plans. Checks Google sign-in itself.' },
        { id: 'fs-plans', kind: 'store', name: 'Firestore · plans', says: 'Plans and idempotency keys, newest first for each owner. Only clps-plans can touch it.' },
        { id: 'web', kind: 'ours', name: 'clps-web', says: 'The Sightline app at / and /sightline/, the earlier tabbed site at /classic/. Site data, Scout’s voice, presenters’ rooms, today’s counts and the status checks.' },
        { id: 'tts', kind: 'outside', name: 'Text-to-Speech', says: 'Scout’s voice, at most 200 texts a day.' },
        { id: 'copilot', kind: 'ours', name: 'clps-copilot · Scout', says: 'Claude with 14 read-only lookups, at /api/chat and /api/ask. Check with Horizons. Retries, a circuit breaker and an outbox.' },
        { id: 'anthropic', kind: 'outside', name: 'Anthropic API · Claude', says: `${model ?? 'Claude'}. Signed in by workload identity federation, so no key is stored.` },
        { id: 'storage', kind: 'store', name: 'Cloud Storage', says: 'Terrain tiles, the light grid and video. Scout reads the light grid for ground a visitor taps.' },
        { id: 'horizons', kind: 'outside', name: 'NASA JPL Horizons API', says: 'Sun and Earth angles for one point and hour, when a visitor asks. Kept 30 days.' },
        { id: 'redis', kind: 'store', name: 'Redis · Memorystore', says: 'Shared by web, plans and co-pilot: rate limits, cached answers, the event outbox, the circuit breaker and presenters’ rooms. Without it the services fall back or switch the feature off. Switched off since November 2026 to cut cost: each service now keeps these in its own memory. One setting turns it back on.' },
      ],
    },
    {
      id: 'build',
      title: 'Build and deploy',
      boxes: [
        { id: 'github', kind: 'outside', name: 'GitHub', says: 'shackleton-station/sightline. Every change is a pull request to main.' },
        { id: 'pipeline', kind: 'ours', name: 'Data pipeline · Python', says: `NASA SPICE kernels and LOLA terrain in, hourly Sun and Earth visibility out: ${siteCount} sites, ${span}. Results are built into the images; tiles go to the bucket.` },
        { id: 'actions', kind: 'outside', name: 'GitHub Actions', says: 'Checks on every pull request, and a deploy workflow for each service. Signs in to Google Cloud with no stored key (Workload Identity Federation).' },
        { id: 'terraform', kind: 'ours', name: 'Terraform pipeline', says: 'The resources in infra/. A plan is posted on each pull request and applied on merge, after a destroy guard. A nightly check looks for drift.' },
        { id: 'registry', kind: 'outside', name: 'Artifact Registry', says: 'One image for each service.' },
        { id: 'canary', kind: 'outside', name: 'Canary deploy · web, plans, co-pilot', says: 'A new version gets no visitors and is tested through the load balancer with x-clps-canary; then a tenth of visitors for a minute, then all. It goes back on failure. The events worker goes from no messages to all.' },
      ],
    },
    {
      id: 'events',
      title: 'Async events',
      boxes: [
        { id: 'pubsub', kind: 'outside', name: 'Pub/Sub', says: 'Question events, delivered at least once.' },
        { id: 'worker', kind: 'ours', name: 'clps-events-worker', says: 'Private: signed push only. Counts each event once.' },
        { id: 'fs-stats', kind: 'store', name: 'Firestore · stats', says: 'The day’s counts in 8 shards. clps-web reads them.' },
        { id: 'bigquery', kind: 'store', name: 'BigQuery', says: 'The question log by day, kept 90 days, with 3 saved views.' },
        { id: 'dead', kind: 'outside', name: 'Dead letter', says: 'After 5 failed tries, from either subscription. An email alert.' },
      ],
    },
    {
      id: 'watch',
      title: 'Observability',
      boxes: [
        { id: 'trace', kind: 'outside', name: 'Cloud Trace', says: 'One trace for each request, even across the queue.' },
        { id: 'slo', kind: 'outside', name: 'Objectives over 28 days', says: 'web: 99.5% succeed, 90% within 2 s · plans: 99.5%, 95% within 1 s · co-pilot: 99%, 90% within 10 s.' },
        { id: 'alerts', kind: 'outside', name: 'Alerts by email', says: 'An objective burning down, the site down, the breaker open, the worker behind, a dead letter. A monthly budget emails the billing admins.' },
      ],
    },
  ]
}

export const SYSTEM_ARROWS: SystemArrow[] = [
  { from: 'browser', to: 'lb', sides: ['bottom', 'top'], says: 'The browser reaches everything through the load balancer: it is the one door in.' },
  { from: 'lb', to: 'armor', sides: ['bottom', 'top'], says: 'Requests for a service or for Moon Trek pass Cloud Armor.' },
  { from: 'armor', to: 'plans', sides: ['right', 'left'], at: 0.25, says: '/api/plans goes to clps-plans.' },
  { from: 'armor', to: 'web', sides: ['right', 'left'], says: 'Pages, site data and the rest of /api go to clps-web.' },
  { from: 'armor', to: 'copilot', sides: ['right', 'left'], at: 0.75, says: '/api/chat and /api/ask go to clps-copilot.' },
  { from: 'armor', to: 'trek', sides: ['bottom', 'top'], says: '/trek/ goes to NASA Moon Trek.' },
  { from: 'lb', to: 'buckets', sides: ['left', 'left'], says: 'Tiles and video go from the load balancer straight to the backend buckets.' },
  { from: 'buckets', to: 'storage', sides: ['right', 'left'], says: 'The backend buckets read Cloud Storage.' },
  { from: 'plans', to: 'fs-plans', sides: ['right', 'left'], says: 'clps-plans keeps plans in its Firestore database.' },
  { from: 'web', to: 'tts', sides: ['right', 'left'], says: 'clps-web asks Text-to-Speech for Scout’s voice.' },
  { from: 'web', to: 'plans', sides: ['top', 'bottom'], line: 'status', says: 'clps-web asks clps-plans for its status, with a Google identity token.' },
  { from: 'web', to: 'copilot', sides: ['bottom', 'top'], line: 'status', says: 'clps-web asks clps-copilot for its status, the same way.' },
  { from: 'copilot', to: 'anthropic', sides: ['right', 'left'], at: 0.3, says: 'clps-copilot calls Claude on the Anthropic API.' },
  { from: 'copilot', to: 'horizons', sides: ['right', 'left'], at: 0.75, says: 'clps-copilot asks JPL Horizons when a visitor checks a point.' },
  { from: 'copilot', to: 'storage', sides: ['bottom', 'top'], says: 'clps-copilot reads the light grid from Cloud Storage.' },
  { from: 'copilot', to: 'pubsub', sides: ['left', 'left'], at: 0.85, says: 'clps-copilot publishes each question to Pub/Sub, through the outbox.' },
  { from: 'pubsub', to: 'worker', sides: ['right', 'left'], says: 'Pub/Sub pushes each event to the events worker.' },
  { from: 'worker', to: 'fs-stats', sides: ['right', 'left'], says: 'The worker adds it to the day’s counts.' },
  { from: 'pubsub', to: 'bigquery', sides: ['bottom', 'top'], says: 'Pub/Sub also writes each event to BigQuery.' },
  { from: 'worker', to: 'dead', sides: ['bottom', 'top'], line: 'failure', says: 'An event that fails 5 times goes to the dead letter topic.' },
  { from: 'github', to: 'actions', sides: ['bottom', 'top'], says: 'A pull request starts GitHub Actions.' },
  { from: 'actions', to: 'registry', sides: ['bottom', 'top'], says: 'A deploy builds an image and stores it in Artifact Registry.' },
  { from: 'registry', to: 'canary', sides: ['bottom', 'top'], says: 'The image is rolled out in steps.' },
  { from: 'actions', to: 'terraform', sides: ['right', 'left'], says: 'GitHub Actions also runs the Terraform pipeline.' },
]
