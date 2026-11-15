import type { RefObject } from 'react'
import type { ScenarioData } from '../../data/scenarioData'
import { GuideEarthDay } from './GuideEarthDay'
import { GuideStep, type GuideStepId } from './GuideParts'
import { SUN_AND_EARTH_SKIM } from '../../lib/moonExplained'

interface Props {
  /** The site and month on show, for the comparison with a day on Earth; null while it loads. */
  data: ScenarioData | null
  /** Why the site on show is hard, from that site's own figures; null while they load, and on a page with no scenario. */
  why: string[] | null
  /** Where "Why this site is hard" is on the page: Scout's ready idea opens the Guide there. */
  whyHere: RefObject<HTMLElement | null>
  /** Bring another part of the Guide to the top. */
  onGo: (id: GuideStepId) => void
}

/** Why the south pole, each line from a NASA page that is read and cited in REFERENCES.md. */
const WHY_POLE = [
  {
    title: 'Ground that never sees the Sun',
    says: 'Some crater floors here have not seen sunlight in billions of years and fall to −203 °C. NASA says such ground can keep water and other frozen resources.',
  },
  {
    title: 'Ridges that are lit for long stretches',
    says: 'A few high ridges near the pole catch the low Sun when the ground around them is dark. By our model the Sun is at least partly in view for most of the year from the four ridge sites listed here, which come from NASA’s terrain study of them.',
  },
  {
    title: 'Where crews are meant to land',
    says: 'NASA has named nine candidate regions near the south pole for Artemis III, its first crewed Moon landing in more than 50 years.',
  },
]

/** Recent landings toward the south pole, each line from the NASA or LROC page it links to. Dates are UTC days as those pages give them. */
const LANDINGS: { name: string; when: string; how: 'ok' | 'part' | 'lost'; says: string; source: string; href: string }[] = [
  {
    name: 'Luna 25 (Russia)',
    when: '19 August 2023',
    how: 'lost',
    says: 'An anomaly during descent. It hit the Moon about 400 km short of its landing point at 69.5° S.',
    source: 'NASA',
    href: 'https://www.nasa.gov/missions/lro/nasas-lro-observes-crater-likely-from-luna-25-impact/',
  },
  {
    name: 'Chandrayaan-3 (India)',
    when: '23 August 2023',
    how: 'ok',
    says: 'Touched down about 600 km from the south pole, at 69.37° S.',
    source: 'LROC',
    href: 'https://lroc.im-ldi.com/images/1314',
  },
  {
    name: 'IM-1 Odysseus',
    when: '22 February 2024',
    how: 'part',
    says: 'Landed softly at 80.13° S and came to rest in a worn crater where the ground slopes 12°.',
    source: 'NASA',
    href: 'https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/',
  },
  {
    name: 'IM-2 Athena',
    when: '6 March 2025',
    how: 'part',
    says: 'Closer to the pole than any lander before it. It ended on its side in a crater 20 m wide.',
    source: 'LROC',
    href: 'https://lroc.im-ldi.com/images/1408',
  },
]

const QUESTIONS = [
  { ask: 'Can we land here and keep power and radio?', says: 'Find a place and an hour with the Sun for power and Earth for radio, for the whole mission.' },
  { ask: 'What if the date slips?', says: 'Launches run late. Does the plan still fit next week, or next month?' },
  { ask: 'What if the landing point slips?', says: 'No lander comes down exactly on its mark. How far off can it be and still fit?' },
]

/**
 * Step 1: why the south pole, why landing there is hard (a picture, then the site on show's own
 * figures), what recent landings ran into, and the challenge as three questions.
 */
export function GuideChallenge({ data, why, whyHere, onGo }: Props) {
  return (
    <GuideStep
      id="how-challenge"
      kicker="Step 1"
      title="Understand the challenge"
      intro={SUN_AND_EARTH_SKIM}
    >
      <h3>Why the south pole</h3>
      <ul className="how-cards">
        {WHY_POLE.map((card) => (
          <li key={card.title} className="how-card">
            <h4>{card.title}</h4>
            <p>{card.says}</p>
          </li>
        ))}
      </ul>

      <h3>Why it is hard to land and stay</h3>
      <figure className="how-fig">
        <svg viewBox="0 52 860 198" role="img" aria-label="A lander on a ridge. The Sun, low on one horizon, lights it. Earth, low on the other horizon, is hidden behind a hill.">
          <defs>
            <linearGradient id="how-fig-light" x1="0" x2="1">
              <stop offset="0" stopColor="#e9b44c" stopOpacity="0.55" />
              <stop offset="1" stopColor="#e9b44c" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="20" y1="170" x2="840" y2="170" stroke="#3b3346" strokeDasharray="4 6" />
          <circle cx="70" cy="140" r="20" fill="#e9b44c" />
          <text x="70" y="108" fill="#e9b44c" fontSize="14" fontWeight="700" textAnchor="middle">
            Sun, low
          </text>
          <path d="M92 142 L420 122 L420 132 Z" fill="url(#how-fig-light)" />
          <path d="M0 250 L0 185 L110 178 L190 150 L250 176 L330 168 L400 128 L440 128 L500 172 L560 150 L640 98 L700 150 L770 176 L860 182 L860 250 Z" fill="#2a2633" stroke="#43475c" />
          <path d="M190 150 L250 176 L330 168 L300 200 L230 200 Z" fill="#0c0b10" />
          <text x="262" y="222" fill="#9a927f" fontSize="12" textAnchor="middle">
            shadowed crater
          </text>
          <text x="22" y="183" fill="#9a927f" fontSize="12">
            level horizon
          </text>
          <g transform="translate(420 128)">
            <rect x="-11" y="-18" width="22" height="12" rx="2" fill="#f6efe0" />
            <path d="M-11 -6 L-18 0 M11 -6 L18 0 M0 -18 L0 -30" stroke="#f6efe0" strokeWidth="2" />
            <circle cx="0" cy="-32" r="3" fill="#57c08a" />
          </g>
          <text x="420" y="74" fill="#f6efe0" fontSize="14" fontWeight="700" textAnchor="middle">
            Lander on a ridge
          </text>
          <text x="335" y="116" fill="#57c08a" fontSize="13" textAnchor="middle">
            ✓ sunlight: power
          </text>
          <circle cx="790" cy="150" r="15" fill="#5b9bea" />
          <text x="790" y="122" fill="#5b9bea" fontSize="14" fontWeight="700" textAnchor="middle">
            Earth, low
          </text>
          <line x1="434" y1="100" x2="622" y2="118" stroke="#e8505a" strokeWidth="2" strokeDasharray="6 5" />
          <text x="610" y="78" fill="#e8505a" fontSize="13" textAnchor="middle">
            ✗ hill in the way: no radio
          </text>
        </svg>
        <figcaption>A sketch, not to scale. Same lander, same hour: lit by the Sun, cut off from Earth. Move it, or wait a week, and the answer can change.</figcaption>
      </figure>
      <p className="how-caption">
        The same low light makes the descent hard. NASA expects long, dark shadows to hide the ground from a vehicle coming down at the south pole, even with advanced sensors.
      </p>

      {/* Why the site on show is hard, in a few sentences made of that site's own figures. */}
      {why && why.length > 0 && (
        <section ref={whyHere} className="how-why" aria-labelledby="how-why-title" tabIndex={-1}>
          <h3 id="how-why-title">Why this site is hard</h3>
          <ul className="how-why-lines">
            {why.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="how-start-note">This site’s own figures, for the scenario on show.</p>
        </section>
      )}

      {/* How unlike Earth it is, in the app's own figures for the month on show. */}
      {data && <GuideEarthDay data={data} />}

      <h3>Recent landings toward the south pole</h3>
      <ul className="how-landings">
        {LANDINGS.map((landing) => (
          <li key={landing.name} data-how={landing.how}>
            <b>{landing.name}</b>
            <span>{landing.when}</span>
            <p>
              {landing.says}{' '}
              <a href={landing.href} target="_blank" rel="noreferrer">
                {landing.source}
              </a>
            </p>
          </li>
        ))}
      </ul>

      <div className="how-case">
        <p className="how-kicker">The closest anyone has come</p>
        <h4>Athena: about 160 km from the pole, on its side in a crater</h4>
        <p>
          On 6 March 2025 Intuitive Machines’ Athena landed at 84.79° S, closer to the south pole than any lander before it. It hit the surface faster than intended and ended on
          its side inside a crater 20 m wide, more than 400 m from where it was meant to land. On its side it could not fully run its drill and instruments before its batteries
          ran down, and the mission was ended early the next day.
        </p>
        <p className="how-note">
          From{' '}
          <a href="https://www.nasa.gov/news-release/nasa-receives-some-data-before-intuitive-machines-ends-lunar-mission/" target="_blank" rel="noreferrer">
            NASA’s account of the mission
          </a>{' '}
          and{' '}
          <a href="https://lroc.im-ldi.com/images/1408" target="_blank" rel="noreferrer">
            LROC’s picture of the lander
          </a>
          . The distance from the pole is worked out from LROC’s coordinates. IM-2 Athena, IM-1 Odysseus and Chandrayaan-3 are sites you can open in Sightline.
        </p>
      </div>

      <h3>The challenge, in three questions</h3>
      <ol className="how-questions">
        {QUESTIONS.map((question, i) => (
          <li key={question.ask}>
            <button type="button" onClick={() => onGo('how-solution')}>
              <i>{i + 1}</i>
              <b>{question.ask}</b>
              <span>{question.says}</span>
            </button>
          </li>
        ))}
      </ol>
      <p className="how-note">
        Our reading of the NASA Space Apps 2026 challenge “Lunar Landing Site Navigator”: a tool for mission planners, educators and the public to compare south-pole landing sites
        and dates by where the Sun and Earth stand above the local horizon.
      </p>
    </GuideStep>
  )
}
