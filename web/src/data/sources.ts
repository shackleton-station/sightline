/**
 * Every outside source the app uses, in one place: who provides it, what it does here, how it gets
 * here, how to credit it and where a visitor meets it. How it works renders this list, and
 * `sources.test.ts` fails when it and the repository's REFERENCES.md disagree.
 *
 * Add a source here when the app starts using it, not before.
 */

/** What a source does in the app. */
export type SourceRole = 'computes' | 'checks' | 'imagery' | 'context'

/** The section of the list a source sits in. */
export type SourceGroup = 'challenge' | 'nasa' | 'partner' | 'check' | 'look'

export interface DataSource {
  id: string
  name: string
  provider: string
  group: SourceGroup
  role: SourceRole
  /** On the challenge page's Resources tab, though it sits in another section here: it carries the same badge. */
  challengeResource?: true
  /** What it does in the app, in one plain line. */
  does: string
  /** How it reaches the app. */
  fetched: string
  credit: string
  /** Where a visitor meets it. */
  shows: string
  /** The source's own page. Every one of these must be in REFERENCES.md. Empty for something the app makes itself. */
  urls: string[]
  /** The start of each REFERENCES.md row (its first cell) this entry stands for. */
  refs: [string, ...string[]]
}

export const ROLE_LABEL: Record<SourceRole, string> = {
  computes: 'Computes numbers',
  checks: 'Checks numbers',
  imagery: 'Imagery',
  context: 'Context',
}

/** The sections, in the order How it works shows them. */
export const SOURCE_GROUPS: { id: SourceGroup; title: string; note: string }[] = [
  { id: 'challenge', title: 'From the challenge’s Resources', note: 'The tools the challenge page itself lists.' },
  { id: 'nasa', title: 'Other NASA data', note: 'The terrain and the positions every number is computed from.' },
  { id: 'partner', title: 'Partner agencies and published work', note: 'Names, places and constants from outside NASA.' },
  { id: 'check', title: 'Checks', note: 'NASA’s own results, used only to test ours.' },
  { id: 'look', title: 'Looks only', note: 'Pictures that make the Moon and Earth look right. No number is read from them.' },
]

export const DATA_SOURCES: DataSource[] = [
  {
    id: 'horizons',
    name: 'JPL Horizons',
    provider: 'NASA Jet Propulsion Laboratory',
    group: 'challenge',
    role: 'checks',
    does: 'An independent answer for where the Sun and Earth stand in a site’s sky, compared with ours.',
    fetched: 'The pipeline asks the Horizons API for every hour of every year of the data at each site, one request at a time, and saves the largest and the typical gap. For a custom point the site’s server asks Horizons for the one hour on screen when a visitor asks, and keeps the answer.',
    credit: 'NASA/JPL Solar System Dynamics, Horizons System',
    shows: 'Under the numbers in Sightline, with a link to NASA’s own answer for the hour on screen; Check with Horizons, for a custom point; Open in Horizons, under the site field; each site’s checks, in How it works',
    urls: ['https://ssd.jpl.nasa.gov/api/horizons.api', 'https://ssd-api.jpl.nasa.gov/doc/horizons.html'],
    refs: ['JPL Horizons API'],
  },
  {
    id: 'quickmap',
    name: 'LROC Quickmap',
    provider: 'The Lunar Reconnaissance Orbiter Camera team',
    group: 'challenge',
    role: 'context',
    does: 'The real ground at the site on show, in the LRO camera’s own map.',
    fetched: 'Nothing is fetched: the app builds a link that opens Quickmap on the site. Checked by loading it at every listed site.',
    credit: 'LROC QuickMap',
    shows: 'Open in Quickmap, under the site field in Sightline',
    urls: ['https://quickmap.lroc.im-ldi.com'],
    refs: ['LROC QuickMap'],
  },
  {
    id: 'moon-trek',
    name: 'Moon Trek',
    provider: 'NASA Solar System Treks',
    group: 'challenge',
    role: 'imagery',
    does: 'NASA’s own maps of the ground around the south pole, laid over the Moon on show: photos, slope, permanent shadow, long-run sunlight, long-run Earth view and temperature. And the site on show, opened in Moon Trek itself. And, close on a site with no layer on, the Moon’s own picture getting sharper: LROC’s whole-Moon WAC mosaic (83 m a pixel as tiles), and LRO NAC mosaics of the ground round the three Apollo sites, Blue Ghost 1, SLIM and Chang’e 4 (0.65 m) and IM-1 (2.6 m). Of these, the south-pole mosaic the ridge sites use is tied to laser-altimeter ground tracks (controlled); the WAC mosaic and the NAC mosaics round the other sites are not. Measured on 14 November 2026 at the closest zoom, the lunar module is about 12 m from Apollo 11’s marker, about 10 m from Apollo 15’s, and what looks like it about 45 m from Apollo 17’s; so close on those sites the marker is a ring of 50 m, not a dot.',
    fetched: 'A layer’s tiles are fetched when its switch is turned on, through this site’s own cache in front of Moon Trek’s server, which asks NASA for a tile once and keeps it a month. If that cache does not answer, the browser asks Moon Trek itself. Within 10 km of each ridge site the photo goes on to 1 m a pixel, from tiles cut once from LROC’s own files of the same mosaic (credit NASA/GSFC/Arizona State University). Close on a site with no layer on, the ground in view is fetched the same way, only what the view needs, and drawn as the ground’s fine grain on the globe’s own tone and the hour’s light.',
    credit: 'NASA Solar System Treks, Moon Trek; each layer is shown with Moon Trek’s own title; the WAC and NAC mosaics are LROC’s (NASA/GSFC/Arizona State University)',
    shows: 'Layers, on the Moon’s stage; Open in Moon Trek, under the site field; Site view, as the view closes in',
    urls: ['https://trek.nasa.gov/moon/', 'https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon'],
    refs: ['Moon Trek'],
  },
  {
    id: 'lola-south-pole',
    name: 'LOLA south-pole terrain, 20 m',
    provider: 'NASA Goddard, Planetary Geodesy Data Archive',
    group: 'nasa',
    role: 'computes',
    does: 'The shape of the ground from 80° S to the pole: the horizon around every polar site and the map of polar light.',
    fetched: 'Downloaded once by the pipeline; the app ships only the results.',
    credit: 'NASA GSFC PGDA; Barker et al. 2023',
    shows: 'Every polar site’s hours, the skyline, Surface, and the lit ground close on a polar site',
    urls: ['https://pgda.gsfc.nasa.gov/products/90', 'https://doi.org/10.3847/PSJ/acf3e1'],
    refs: ['LOLA south-polar DEM', 'Map images'],
  },
  {
    id: 'lola-global',
    name: 'LOLA global terrain, 237 m',
    provider: 'NASA Planetary Data System',
    group: 'nasa',
    role: 'computes',
    does: 'The shape of the ground away from the pole: the horizon at the Apollo and recent landing sites, and the globe’s relief.',
    fetched: 'Downloaded once by the pipeline; the app ships only the results.',
    credit: 'NASA PDS Geosciences Node, LRO LOLA',
    shows: 'Every site away from the pole, and the globe',
    urls: ['https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/'],
    refs: ['LOLA global DEM'],
  },
  {
    id: 'lola-sites',
    name: 'LOLA high-resolution south-pole sites, 5 m',
    provider: 'NASA Goddard, Planetary Geodesy Data Archive',
    group: 'nasa',
    role: 'computes',
    does: 'Where the four polar ridge sites are, and how much a landing 100 m off changes the answer.',
    fetched: 'Downloaded once by the pipeline; the app ships only the results.',
    credit: 'NASA GSFC PGDA; Barker et al. 2021; Mazarico et al. 2011',
    shows: 'The four polar sites and their ranges',
    urls: ['https://pgda.gsfc.nasa.gov/products/78', 'https://doi.org/10.1016/j.pss.2020.105119'],
    refs: ['High-Resolution LOLA Topography', 'LOLA 5 m terrain'],
  },
  {
    id: 'spice',
    name: 'NAIF SPICE kernels',
    provider: 'NASA Jet Propulsion Laboratory, NAIF',
    group: 'nasa',
    role: 'computes',
    does: 'Where the Sun, Earth and Moon are and how the Moon is turned, for every hour.',
    fetched: 'Five kernel files downloaded once by the pipeline; the app ships only the results.',
    credit: 'NASA/JPL NAIF generic kernels (DE440)',
    shows: 'Every hour of every site',
    urls: ['https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'],
    refs: ['`naif0012.tls`', '`de440s.bsp`', '`moon_pa_de421_1900-2050.bpc`', '`moon_080317.tf`', '`pck00011.tpc`'],
  },
  {
    id: 'apollo-sites',
    name: 'Apollo landing coordinates',
    provider: 'NASA Space Science Data Coordinated Archive',
    group: 'nasa',
    role: 'context',
    does: 'Where the Apollo landers stand.',
    fetched: 'Read from NASA’s page and kept in the pipeline’s site list, with the page’s address.',
    credit: 'NASA NSSDCA',
    shows: 'The site list and the globe’s labels',
    urls: ['https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html'],
    refs: ['Apollo landing coordinates'],
  },
  {
    id: 'lro-landers',
    name: 'Recent landers, as found by LRO',
    provider: 'NASA and the LROC team, Arizona State University',
    group: 'nasa',
    role: 'context',
    does: 'Where Blue Ghost, Odysseus, Athena, Chandrayaan-3, SLIM and Chang’e 4 stand.',
    fetched: 'Read from each NASA or LROC page and kept in the pipeline’s site list, with the page’s address.',
    credit: 'NASA/GSFC/Arizona State University',
    shows: 'The site list',
    urls: [
      'https://lroc.im-ldi.com/images/1407',
      'https://lroc.im-ldi.com/images/1408',
      'https://lroc.im-ldi.com/images/1314',
      'https://lroc.im-ldi.com/images/1087',
      'https://www.nasa.gov/missions/lro/nasas-lro-images-intuitive-machines-odysseus-lander/',
      'https://www.nasa.gov/missions/lro/nasas-lro-spots-japans-moon-lander/',
    ],
    refs: ['Blue Ghost Mission 1 coordinates', 'IM-1 Odysseus coordinates', 'IM-2 Athena coordinates', 'Chandrayaan-3 coordinates', 'SLIM coordinates', 'Chang\'e 4 coordinates'],
  },
  {
    id: 'future-targets',
    name: 'NASA’s pages on landings still to come',
    provider: 'NASA Science and NASA news releases',
    group: 'nasa',
    role: 'context',
    does: 'Where the next CLPS deliveries are bound, and one of the Artemis III candidate regions. NASA names each place and gives no coordinates, so each is shown at the IAU Gazetteer’s center for it, marked approximate.',
    fetched: 'NASA’s sentence for each place is kept in the pipeline with its page and date; the point comes from the Gazetteer’s table.',
    credit: 'NASA; IAU Gazetteer of Planetary Nomenclature for the points',
    shows: 'Future targets, in Sightline’s site list',
    urls: [
      'https://science.nasa.gov/lunar-science/clps-deliveries/cp-11/',
      'https://science.nasa.gov/lunar-science/clps-deliveries/cp-22-science/',
      'https://science.nasa.gov/lunar-science/clps-deliveries/cs-11/',
      'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/',
    ],
    refs: ['Future landing places named by NASA'],
  },
  {
    id: 'fact-sheets',
    name: 'Moon and Earth fact sheets',
    provider: 'NASA Space Science Data Coordinated Archive',
    group: 'nasa',
    role: 'context',
    does: 'The Moon’s temperature range and Earth’s tilt, for the comparison with a day on Earth.',
    fetched: 'Read from NASA’s pages and kept in the code, with the pages’ addresses.',
    credit: 'NASA NSSDCA',
    shows: 'Earth compared with the Moon',
    urls: ['https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html'],
    refs: ['Moon and Earth fact sheets'],
  },
  {
    id: 'csa-rover',
    name: 'Canadian Space Agency: the lunar utility rover',
    provider: 'Canadian Space Agency',
    group: 'partner',
    role: 'context',
    challengeResource: true,
    does: 'A real mission to plan for: Scout’s idea selects a long stay and quotes what the agency says the rover must survive.',
    fetched: 'Four short quotations from the agency’s page, kept in the code with the page’s address and date. The agency has published no landing site, and the app gives none.',
    credit: 'Canadian Space Agency',
    shows: 'Scout’s idea in Sightline, “Plan for Canada’s utility rover”',
    // First the agency's Moon exploration page, the address the challenge's Resources tab gives; then the rover's own page beneath it, which the quotations are from.
    urls: ['https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/', 'https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/canadian-utility-rover-on-the-moon.asp'],
    refs: ['Canadian Space Agency'],
  },
  {
    id: 'gazetteer',
    name: 'Gazetteer of Planetary Nomenclature',
    provider: 'International Astronomical Union and USGS Astrogeology',
    group: 'partner',
    role: 'context',
    does: 'The official names and centers of the Moon’s seas, craters and mountains, and of the Chang’e 3, 5 and 6 landing sites.',
    fetched: 'Downloaded once by the pipeline; the app ships a short list of names.',
    credit: 'IAU Working Group for Planetary System Nomenclature; USGS Astrogeology Science Center',
    shows: 'Place names on the globe',
    urls: ['https://planetarynames.wr.usgs.gov'],
    refs: ['IAU Gazetteer of Planetary Nomenclature'],
  },
  {
    id: 'solar-constant',
    name: 'The Sun’s strength, 1361 W/m²',
    provider: 'Kopp and Lean, 2011',
    group: 'partner',
    role: 'computes',
    does: 'Turns the share of the Sun in view into power on a panel.',
    fetched: 'One number from the paper, kept in the code.',
    credit: 'Kopp & Lean 2011, Geophysical Research Letters',
    shows: 'Power on a panel',
    urls: ['https://doi.org/10.1029/2010GL045777'],
    refs: ['Solar constant'],
  },
  {
    id: 'pgda-averages',
    name: 'LOLA long-run sunlight and Earth-visibility maps',
    provider: 'NASA Goddard, Planetary Geodesy Data Archive',
    group: 'check',
    role: 'checks',
    does: 'NASA’s own long-run averages, compared with ours at each polar site and across the map of polar light.',
    fetched: 'Downloaded once by the pipeline; the app ships the comparison.',
    credit: 'NASA GSFC PGDA; Mazarico et al. 2011',
    shows: 'Each polar site’s checks and the polar map’s check, in the Guide',
    urls: ['https://pgda.gsfc.nasa.gov/products/69', 'https://doi.org/10.1016/j.icarus.2010.10.030'],
    refs: ['LOLA illumination + Earth visibility maps'],
  },
  {
    id: 'lroc-wac',
    name: 'LROC wide-angle photos of the south pole',
    provider: 'NASA and the LROC team, Arizona State University',
    group: 'check',
    role: 'checks',
    does: 'Real photos of the polar ground, dated and averaged, compared with the light we compute.',
    fetched: 'Downloaded once by the pipeline; the app ships the comparison.',
    credit: 'NASA/GSFC/Arizona State University; Speyerer & Robinson 2013',
    shows: 'The checks of the sites closest to the pole',
    urls: ['https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_ILL_TWI_SOUTH', 'https://data.lroc.im-ldi.com/lroc/view_rdr/WAC_POLE_MOVIE_SOUTH'],
    refs: ['LROC WAC time-weighted south pole illumination map', 'LROC WAC south pole movie frames'],
  },
  {
    id: 'moon-colour',
    name: 'CGI Moon Kit color map',
    provider: 'NASA’s Scientific Visualization Studio',
    group: 'look',
    role: 'imagery',
    does: 'The color of the Moon’s surface.',
    fetched: 'One image, resized and shipped with the app in three sizes; a fourth, 8,192 pixels round the Moon, is fetched only by a laptop that zooms in.',
    credit: 'NASA’s Scientific Visualization Studio',
    shows: 'The Moon, in Orbit and Site',
    urls: ['https://svs.gsfc.nasa.gov/4720'],
    refs: ['NASA SVS CGI Moon Kit'],
  },
  {
    id: 'blue-marble',
    name: 'Blue Marble',
    provider: 'NASA Goddard, Visible Earth',
    group: 'look',
    role: 'imagery',
    does: 'The look of Earth: in Surface’s sky, and beside the Moon in Orbit, where Earth is in its true direction and phase but not to scale (it is drawn right next to the Moon).',
    fetched: 'One image, resized and shipped with the app.',
    credit: 'NASA Goddard Space Flight Center; R. Stöckli, R. Simmon',
    shows: 'Earth in Surface; Earth beside the Moon in Orbit',
    urls: ['https://commons.wikimedia.org/wiki/File:Whole_world_-_land_and_oceans.jpg'],
    refs: ['NASA Blue Marble'],
  },
  {
    id: 'stars',
    name: 'The stars around the Moon',
    provider: 'Made by this app',
    group: 'look',
    role: 'imagery',
    does: 'A made-up field of stars behind the Moon. It is not a star map and stands for no real star.',
    fetched: 'Generated in the browser from a fixed seed, so it is the same on every visit.',
    credit: 'Team Shackleton Station (generated by code, not by AI)',
    shows: 'Behind the Moon in Sightline',
    urls: [],
    refs: ['Stars around the Moon in Sightline'],
  },
]

/** The sources of one section, in the list's order. */
export function sourcesIn(group: SourceGroup): DataSource[] {
  return DATA_SOURCES.filter((source) => source.group === group)
}
