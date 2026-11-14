import { useEffect, useState } from 'react'
import type { LrocCheck, LrocPhotos } from '../data/contract'
import { loadLrocCheck, loadLrocPhotos, type ScenarioData } from '../data/loadSite'
import { lrocNotes, photoNotes } from '../lib/spread'
import { customNotes, validationNotes } from '../lib/verdict'

interface Props {
  data: ScenarioData
}

/** LROC's map made from photos stops here. */
const LROC_MAP_REACH_LAT = -88

/** How far this site's numbers can be trusted, including where they don't agree with NASA's maps. */
export function TrustNotes({ data }: Props) {
  const { validation, custom, summary } = data
  const inPhotos = data.site.lat <= LROC_MAP_REACH_LAT
  const [check, setCheck] = useState<LrocCheck | null>(null)
  const [photos, setPhotos] = useState<LrocPhotos | null>(null)

  useEffect(() => {
    if (!inPhotos) return
    let current = true
    loadLrocCheck()
      .then((loaded) => {
        if (current) setCheck(loaded)
      })
      .catch((reason: unknown) => console.error(reason))
    loadLrocPhotos()
      .then((loaded) => {
        if (current) setPhotos(loaded)
      })
      .catch((reason: unknown) => console.error(reason))
    return () => {
      current = false
    }
  }, [inPhotos])

  const notes = validation ? validationNotes(validation, summary.obs_height_m) : null
  return (
    <ul className="trust">
      {notes && (
        <>
          <li>{notes.horizons}</li>
          <li>{notes.terrain}</li>
          {[notes.earth, notes.sun].map((note) => (
            <li key={note.text} className={note.warning ? 'warning' : undefined}>
              {note.text}
            </li>
          ))}
        </>
      )}
      {custom && customNotes(custom).map((note) => <li key={note}>{note}</li>)}
      {inPhotos && check && lrocNotes(check, data.site.id).map((note) => <li key={note}>{note}</li>)}
      {inPhotos && photos && photoNotes(photos, data.site.id).map((note) => <li key={note}>{note}</li>)}
    </ul>
  )
}
