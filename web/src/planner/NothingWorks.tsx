import { useMemo } from 'react'
import type { Requirements } from '../lib/mission'
import { longestMissionThatFits, type PlannerSite, whatEachLimitCosts } from './plannerModel'
import { looseningWords, plural } from './words'

interface Props {
  sites: PlannerSite[]
  requirements: Requirements
  onChange: (requirements: Requirements) => void
}

/**
 * Shown when no site has a landing in any month: says so, and says which limit is in the way, from
 * the same data, so an empty grid is an answer and not a dead end.
 */
export function NothingWorks({ sites, requirements, onChange }: Props) {
  const costs = useMemo(() => whatEachLimitCosts(sites, requirements), [sites, requirements])
  const longest = useMemo(() => longestMissionThatFits(sites, requirements), [sites, requirements])
  return (
    <div className="pl-nothing" role="status">
      <h2>No site has a landing that survives this mission, in any month.</h2>
      <p>The grid below is empty because of your limits, not because the data is missing. What each limit is costing:</p>
      <ul>
        {costs.map((cost) => (
          <li key={cost.what}>{looseningWords(cost)}</li>
        ))}
        <li>
          {longest === null ? (
            'Even the shortest mission has no landing with the other limits as they are.'
          ) : (
            <>
              The longest mission with a landing somewhere, other limits unchanged, is {plural(longest, 'day')}.{' '}
              <button type="button" className="pl-link" onClick={() => onChange({ ...requirements, missionDays: longest })}>
                Set the mission to {plural(longest, 'day')}
              </button>
            </>
          )}
        </li>
      </ul>
    </div>
  )
}
