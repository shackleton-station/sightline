import type { ScenarioData } from '../data/loadSite'
import { explainerFacts, explainerTitle } from '../lib/explainer'

interface Props {
  data: ScenarioData
}

/** What makes this site hard or easy, for educators and the public, using its own numbers. */
export function Explainer({ data }: Props) {
  return (
    <section className="explainer" aria-labelledby="explainer-title">
      <h2 id="explainer-title">{explainerTitle(data)}</h2>
      <div className="facts">
        {explainerFacts(data).map((fact) => (
          <div key={fact.title} className="fact">
            <h3>{fact.title}</h3>
            <p>{fact.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
