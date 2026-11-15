import { useEffect, useState } from 'react'
import type { LrocPhotos } from '../../data/contract'
import { type HorizonsCheck, loadHorizonsCheck } from '../../data/horizonsCheck'
import type { LightChecks } from '../../data/lightChecks'
import { loadLrocPhotos } from '../../data/loadSite'
import type { ScenarioData } from '../../data/scenarioData'
import { TrustNotes } from '../../components/TrustNotes'
import { monthLabel } from '../../lib/months'
import { GuideStep } from './GuideParts'

interface Props {
  data: ScenarioData | null
  /** The years the data covers, in words. */
  span: string
  light: LightChecks | null
}

/** A file of the pipeline's, fetched once the section is on the page; null until it is here or if the build has none. */
function useLoaded<T>(load: () => Promise<T | null>): T | null {
  const [found, setFound] = useState<T | null>(null)
  useEffect(() => {
    let current = true
    load()
      .then((loaded) => {
        if (current) setFound(loaded)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [load])
  return found
}

/**
 * Step 4: three checks against NASA's own results, each with its figure read from the pipeline's
 * files; what happens when the model is made wrong on purpose; this site's own notes; the limits.
 */
export function GuideProof({ data, span, light }: Props) {
  const horizons = useLoaded<HorizonsCheck>(loadHorizonsCheck)
  const photos = useLoaded<LrocPhotos>(loadLrocPhotos)
  const sites = horizons ? Object.values(horizons.sites) : []
  const largest = sites.length > 0 ? Math.max(...sites.map((site) => site.max_deg)) : null
  const lit = photos?.groups.well_lit?.ground.clear
  const photoPct = lit?.balanced_agreement_pct != null ? Math.round(lit.balanced_agreement_pct) : null
  const height = data ? `${data.summary.obs_height_m} m` : '2 m'

  return (
    <GuideStep id="how-proof" kicker="Step 4" title="Make sure the math is right" intro="We check our numbers against NASA’s, three ways, and say so where they disagree.">
      <ul className="how-checks">
        {largest !== null && (
          <li className="how-check" data-check="horizons">
            <b>{largest <= 0.01 ? '0.01°' : `${largest.toFixed(2)}°`}</b>
            <h3>Positions match JPL Horizons</h3>
            <p>
              NASA’s own calculator for where the Sun and Earth stand in a site’s sky. Over every hour of {span} at each of the {sites.length} listed sites, the largest gap from
              the angles the screen draws is {largest.toFixed(3)}°. The feature guide “Check it in NASA’s tools” shows how to see NASA’s answer yourself.
            </p>
          </li>
        )}
        {light && (
          <li className="how-check" data-check="map">
            <b>{light.meanAbs.toFixed(1)} pts</b>
            <h3>Sunlight matches NASA’s map</h3>
            <p>
              Across {light.pixels.toLocaleString('en-US')} pixels of polar ground, our long-run sunlight is within {light.meanAbs.toFixed(1)} points of NASA’s own map on
              average (correlation {light.r.toFixed(2)}).
            </p>
          </li>
        )}
        {photos && photoPct !== null && (
          <li className="how-check" data-check="photos">
            <b>{photoPct}%</b>
            <h3>It matches dated photos</h3>
            <p>
              Did the model have the ground lit at the moment a real orbiter photo was taken? On {photos.control_pixels} well-lit spots, across {photos.frames_sampled} photos
              from {photos.first.slice(0, 4)}–{photos.last.slice(2, 4)}, it calls {photoPct}% of the clear photos right, counting lit and dark equally.
            </p>
          </li>
        )}
      </ul>

      {light && (
        <>
          <h3>We also try to break it</h3>
          <p className="how-caption">
            A good test fails when the model is wrong. So the map and the photos are checked again against a deliberately wrong sky. Turn the sky half way round and the match with NASA’s map falls
            from {light.r.toFixed(2)} to {light.rTurned.toFixed(2)}; take the terrain away and it falls to {light.rNoTerrain.toFixed(2)}.
            {lit?.wrong_sun_agreement_pct != null && ` With the Sun half a month out of step, the photo test scores ${Math.round(lit.wrong_sun_agreement_pct)}%.`} At {light.sites}{' '}
            listed sites the map’s code gives {light.worstAgreePct === 100 ? 'the site’s own answer in every one' : `the site’s own answer in at least ${light.worstAgreePct}%`} of{' '}
            {light.hours.toLocaleString('en-US')} hours.
          </p>
        </>
      )}

      <h3>{data ? `For ${data.site.name}, ${monthLabel(data.month)}` : 'For the site on show'}</h3>
      {data ? (
        <>
          <TrustNotes data={data} />
          {/* The plan's line gives another figure for the same agreement: said here, so the two do not read as a disagreement. */}
          <p className="how-caption">
            Two figures are given for JPL Horizons, and they measure the same agreement. The one above is the pipeline’s own check at the moments it counts, on directions before they are
            rounded. The plan’s line, “Matches Horizons within 0.01°”, is every hour of the tracks the screen draws, which are stored to 0.01°: there the largest gap is the
            rounding.
          </p>
        </>
      ) : (
        <p className="how-caption">Loading the checks for this site…</p>
      )}

      <h3>What it cannot tell you</h3>
      <ul className="how-limits">
        <li>
          <strong>Small things do not show.</strong> {data?.validation ? `Near ${data.site.name} the terrain is LOLA at ${data.validation.terrain_resolution_m.toFixed(0)} m a pixel, so` : 'The terrain is a grid of pixels, so'} smaller rocks and craters are not in it.
        </li>
        <li>
          <strong>The brightest ground is the hardest to confirm.</strong> There the comparison with NASA’s map says little. Where a site’s own figure and the map disagree, the notes above say so.
        </li>
        <li>
          <strong>A point is not a patch.</strong> Every number is for one point, {height} above the ground. {light ? `A neighbor ${light.pixelM} m away can differ, so the page gives a range.` : 'Ground a short way off can differ, so the page gives a range.'}
        </li>
        <li>
          <strong>Times are good to the hour, not the minute.</strong> The data is hourly, and every time is UTC.
        </li>
        <li>
          <strong>It is a hackathon project.</strong> A first pass for learning and comparison, not for real mission decisions.
        </li>
      </ul>
    </GuideStep>
  )
}
