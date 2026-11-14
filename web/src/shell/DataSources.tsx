import { DATA_SOURCES, ROLE_LABEL, SOURCE_GROUPS, sourcesIn } from '../data/sources'

/** Every outside source the app uses, by section, from the one registry (`data/sources.ts`). */
export function DataSources() {
  return (
    <div className="how-sources">
      {SOURCE_GROUPS.map((group) => {
        const sources = sourcesIn(group.id)
        if (sources.length === 0) return null
        return (
          <section key={group.id} className="how-source-group" data-group={group.id} aria-labelledby={`how-sources-${group.id}`}>
            <h3 id={`how-sources-${group.id}`}>{group.title}</h3>
            <p className="how-caption">{group.note}</p>
            <ul>
              {sources.map((source) => (
                <li key={source.id} className="how-source" data-source={source.id}>
                  <p className="how-source-name">
                    {source.urls.length > 0 ? (
                      <a href={source.urls[0]} target="_blank" rel="noreferrer">
                        {source.name}
                      </a>
                    ) : (
                      source.name
                    )}
                    {(group.id === 'challenge' || source.challengeResource) && <span className="how-badge">Challenge resource</span>}
                    <span className="how-role">{ROLE_LABEL[source.role]}</span>
                  </p>
                  <p className="how-source-does">{source.does}</p>
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
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="how-caption">
        {DATA_SOURCES.length} sources. A test fails if this list and the project’s list of references ever disagree.
      </p>
    </div>
  )
}
