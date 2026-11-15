import { type LimitMeaning, meaningLine } from '../lib/limitMeanings'

/** What each limit means, one plain line a limit: the limit's own label, then what it is and why a mission cares. */
export function MeaningList({ list }: { list: LimitMeaning[] }) {
  return (
    <dl className="sl-means">
      {list.map((meaning) => (
        <div key={meaning.id} data-limit={meaning.id}>
          <dt>{meaning.name}</dt>
          <dd>{meaningLine(meaning)}</dd>
        </div>
      ))}
    </dl>
  )
}
