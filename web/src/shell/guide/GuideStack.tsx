import type { ReactNode } from 'react'
import { Flow, type FlowStep, GuideStep } from './GuideParts'

const VISIT: FlowStep[] = [
  { name: 'You', does: 'open lunarsightline.com', tech: 'Cloud DNS · Cloud Domains' },
  { name: 'Load balancer', does: 'ends HTTPS and serves cached files from near you', tech: 'Global Application Load Balancer · Cloud CDN · managed certificate' },
  { name: 'Web server', does: 'sends the app, streams terrain and answers questions', tech: 'Cloud Run · Node 22 · Hono · Docker' },
  { name: 'Storage, memory and AI', does: 'hold the terrain, the shared counts and saved plans, and run the language model', tech: 'Cloud Storage · Redis (Memorystore) · Firestore · Claude (Anthropic API)' },
]

const SHIP: FlowStep[] = [
  { name: 'A change', does: 'is proposed and reviewed', tech: 'GitHub pull request' },
  { name: 'Checks', does: 'type-check, test and build everything', tech: 'GitHub Actions · vitest · pytest · ruff' },
  { name: 'Sign-in with no key', does: 'GitHub proves which repository and branch it is', tech: 'Workload Identity Federation' },
  { name: 'Deploy in steps', does: 'test the new version with no visitors, give it a tenth of them, then all; go back if anything fails', tech: 'Artifact Registry · Cloud Run canary · automatic rollback' },
]

const COUNT: FlowStep[] = [
  { name: 'A question is answered', does: 'and a small note about it is kept before the answer leaves', tech: 'an outbox in Redis · the event has its own id' },
  { name: 'A queue', does: 'holds the note until every reader has it, and sends it again if one fails', tech: 'Pub/Sub · at-least-once delivery · retries, then a dead-letter topic' },
  { name: 'A worker', does: 'that no visitor can reach counts it, once, however often it arrives', tech: 'Cloud Run, private · its own identity · one atomic write' },
  { name: 'The day’s counts', does: 'are kept in several pieces, and this page adds them up', tech: 'Firestore · sharded counters · read-only for the web server' },
]

const REBUILD: FlowStep[] = [
  { name: 'NASA data', does: 'is downloaded once and kept out of the repository', tech: 'LOLA terrain · SPICE kernels · PGDA maps' },
  { name: 'The pipeline', does: 'works out every site and hour, then checks itself', tech: 'Python 3.12 · SpiceyPy · NumPy · a Compute Engine VM' },
  { name: 'Small results', does: 'are saved with the code, so every change is reviewed', tech: 'JSON in Git' },
  { name: 'Terrain tiles', does: 'are too big for Git, so they go to a private bucket', tech: 'Cloud Storage · gcloud storage rsync' },
]

const STACK: { layer: string; items: string[] }[] = [
  { layer: 'In your browser', items: ['React 19', 'TypeScript', 'Vite', 'Three.js (WebGL2)', 'our own terrain-lighting shader', 'D3'] },
  { layer: 'Server', items: ['Node 22', 'Hono', 'Docker', 'Cloud Run'] },
  { layer: 'Google Cloud', items: ['Cloud Storage', 'Memorystore (Redis)', 'Firestore', 'Load Balancing', 'Cloud CDN', 'Cloud DNS', 'Cloud Armor', 'Pub/Sub', 'BigQuery', 'Cloud Trace', 'Artifact Registry', 'Cloud Monitoring'] },
  { layer: 'Language model', items: ['Claude on the Anthropic API', 'signed in by workload identity federation, no stored key'] },
  { layer: 'Built and shipped with', items: ['Terraform', 'GitHub Actions', 'Workload Identity Federation'] },
  { layer: 'Data pipeline', items: ['Python 3.12', 'SpiceyPy (NAIF SPICE)', 'NumPy', 'Numba', 'Rasterio', 'PyProj', 'uv'] },
]

const IN_SHORT = [
  { title: 'When you open it', says: 'A global load balancer serves cached files from near you. A small web server sends the app; terrain comes straight from storage, and questions go to Scout’s own service.' },
  { title: 'When we change it', says: 'Every change is a pull request, tested and built by itself, then released to a tenth of visitors first. If anything fails, it goes back on its own.' },
  { title: 'When the data is rebuilt', says: 'A Python pipeline downloads NASA’s files once, works out every site and hour, then checks itself. Small results live with the code; terrain tiles go to cloud storage.' },
]

/**
 * What the site runs on: three short cards, the stack, the services as they are right now, and
 * each flow step by step for a reader who wants it.
 */
export function GuideStack({ children }: { /** The services' status right now, drawn by the page that reads it. */ children: ReactNode }) {
  return (
    <GuideStep id="how-stack" kicker="Under the hood" title="What it runs on" intro="The whole site is described in code, so it can be rebuilt from nothing in minutes. There are no passwords or keys stored anywhere in it.">
      <ul className="how-cards">
        {IN_SHORT.map((card) => (
          <li key={card.title} className="how-card">
            <h4>{card.title}</h4>
            <p>{card.says}</p>
          </li>
        ))}
      </ul>

      <h3>The stack</h3>
      <dl className="how-stack">
        {STACK.map(({ layer, items }) => (
          <div key={layer}>
            <dt>{layer}</dt>
            <dd>
              {items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="how-note">
        Watching over it: an uptime check that emails us if the site stops answering, an objective (99.5% of requests succeed) with alerts, a trace of every request, and a
        budget alert. Every part is declared in Terraform.
      </p>

      <h3>The services, right now</h3>
      <p className="how-caption">
        The site is several services behind one address. The load balancer sends each path to its own, so when one fails the others keep going. The web server asks the others how
        they are, proving who it is with a short-lived token from Google, and gives each one second to answer.
      </p>
      {children}

      <details className="how-more">
        <summary>Each flow, step by step</summary>
        <h4>When you open the site</h4>
        <Flow steps={VISIT} label="What happens when you open the site" />
        <h4>When we change it</h4>
        <Flow steps={SHIP} label="How a change reaches the site" />
        <h4>When the data is rebuilt</h4>
        <Flow steps={REBUILD} label="How the data is rebuilt" />
        <h4>When someone asks Scout a question</h4>
        <Flow steps={COUNT} label="How a question is counted" />
      </details>
    </GuideStep>
  )
}
