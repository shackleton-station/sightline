import { useState } from 'react'
import { DATA_SOURCES, ROLE_LABEL, SOURCE_GROUPS, type SourceRole, sourcesIn } from '../data/sources'

/** The tabs: every source, then one tab for each thing a source can do here. */
const TABS: { role: SourceRole | 'all'; name: string }[] = [
  { role: 'all', name: 'All' },
  { role: 'computes', name: 'Computes the numbers' },
  { role: 'checks', name: 'Checks the numbers' },
  { role: 'context', name: 'Places and context' },
  { role: 'imagery', name: 'Imagery' },
]

/**
 * Every outside source the app uses, from the one registry (`data/sources.ts`): a card each, the
 * challenge's own Resources first, under tabs by what a source does here. A card opens on who it is
 * from, how it gets here, where it shows and its credit.
 */
export function DataSources() {
  const [tab, setTab] = useState<SourceRole | 'all'>('all')
  const sources = SOURCE_GROUPS.flatMap((group) => sourcesIn(group.id))
  return (
    <div className="how-sources">
      <div className="how-tabs" role="group" aria-label="Show sources that">
        {TABS.map(({ role, name }) => (
          <button key={role} type="button" aria-pressed={tab === role} onClick={() => setTab(role)}>
            {name} {role === 'all' ? sources.length : sources.filter((source) => source.role === role).length}
          </button>
        ))}
      </div>
      <ul className="how-source-list">
        {sources.map((source) => (
          <li key={source.id} hidden={tab !== 'all' && source.role !== tab}>
            <details className="how-source" data-source={source.id} data-role={source.role} data-group={source.group}>
              <summary>
                <span className="how-source-name">{source.name}</span>
                <span className="how-source-does">{source.does}</span>
                {(source.group === 'challenge' || source.challengeResource) && <span className="how-badge">Challenge resource</span>}
                <span className="how-role">{ROLE_LABEL[source.role]}</span>
              </summary>
              <dl>
                <div>
                  <dt>From</dt>
                  <dd>{source.provider}</dd>
                </div>
                <div>
                  <dt>How it gets here</dt>
                  <dd>{source.fetched}</dd>
                </div>
                <div>
                  <dt>Where you see it</dt>
                  <dd>{source.shows}</dd>
                </div>
                <div>
                  <dt>Credit</dt>
                  <dd>{source.credit}</dd>
                </div>
              </dl>
              {source.urls.length > 0 && (
                <p className="how-source-link">
                  <a href={source.urls[0]} target="_blank" rel="noreferrer">
                    Open the source
                  </a>
                </p>
              )}
            </details>
          </li>
        ))}
      </ul>
      <p className="how-note">
        Press a card for the detail. “Challenge resource” marks the tools the challenge page itself lists. {DATA_SOURCES.length} sources: a test fails if this list and the
        project’s list of references ever disagree.
      </p>
    </div>
  )
}
