import type { Requirements } from '../../src/lib/mission'
import { fact, type Fact, limitWords } from './facts'
import { listWords } from './ties'

/**
 * What a tool tried in place of the visitor's own limits, as one fact: only the limits that differ,
 * each as it was tried with the visitor's own beside it ("a 3-day mission in place of the 14-day
 * mission"). Nothing when the tool used the visitor's limits as they are. A what-if answer names
 * this and the limit that decides the answer; the whole list of limits is for a visitor who asks
 * what was checked.
 */
export function limitsChanged(own: Requirements, used: Requirements): Fact[] {
  const [mine, tried] = [limitWords(own), limitWords(used)]
  const changed = (Object.keys(tried) as (keyof Requirements)[]).filter((key) => tried[key] !== mine[key])
  if (changed.length === 0) return []
  const clause = (key: keyof Requirements) => (key === 'missionDays' ? `a ${tried[key]} in place of the ${mine[key]}` : `${tried[key]} in place of ${mine[key]}`)
  return [
    fact(
      'limits_changed',
      "What was tried in place of the visitor's own limits (everything else is as on their screen), as a clause after \"with\": for a what-if, say this and not the whole list",
      listWords(changed.map(clause)),
    ),
  ]
}
