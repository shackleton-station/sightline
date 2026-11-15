import type { ReactNode } from 'react'

/** One box of a flow. */
export interface FlowStep {
  name: string
  /** One plain line. */
  does: string
  /** The exact technology, for engineers. */
  tech: string
}

/** Numbered boxes, in order: side by side on a wide screen, one under another on a phone. Real text, so it reflows and reads aloud. */
export function Flow({ steps, label }: { steps: FlowStep[]; label: string }) {
  return (
    <ol className="how-flow" aria-label={label}>
      {steps.map((step) => (
        <li key={step.name} className="how-node">
          <strong>{step.name}</strong>
          <span>{step.does}</span>
          <code>{step.tech}</code>
        </li>
      ))}
    </ol>
  )
}

/** The Guide's sections, in the order the page and its bar of links give them. */
export const GUIDE_STEPS = [
  { id: 'how-challenge', number: '1', name: 'The challenge' },
  { id: 'how-data', number: '2', name: 'The data' },
  { id: 'how-solution', number: '3', name: 'The solution' },
  { id: 'how-proof', number: '4', name: 'The proof' },
  { id: 'how-scout', number: null, name: 'Scout' },
  { id: 'how-stack', number: null, name: 'What it runs on' },
] as const

export type GuideStepId = (typeof GUIDE_STEPS)[number]['id']

/** One section of the Guide: a small label, a heading, a sentence or two, then its parts. */
export function GuideStep({ id, kicker, title, intro, children }: { id: GuideStepId; kicker: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section className="how-step" id={id} aria-labelledby={`${id}-title`}>
      <p className="how-kicker">{kicker}</p>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="how-lede">{intro}</p>
      {children}
    </section>
  )
}
