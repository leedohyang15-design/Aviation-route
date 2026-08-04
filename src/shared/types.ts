// Shared domain types + the WebSocket message protocol used between the
// backend hub, the control window, and the display window.

/** A single aircraft state, normalized from the data source. */
export interface Aircraft {
  /** Unique 24-bit ICAO transponder address (hex). Stable id per airframe. */
  icao24: string
  /** Callsign / flight number, trimmed (may be empty). */
  callsign: string
  /** Longitude in degrees, -180..180. */
  lon: number
  /** Latitude in degrees, -90..90. */
  lat: number
  /** Barometric altitude in metres (null when unknown). */
  altitude: number | null
  /** Ground speed in m/s (null when unknown). */
  velocity: number | null
  /** True track / heading in degrees clockwise from north (null when unknown). */
  heading: number | null
  /** Vertical rate in m/s, +up (null when unknown). */
  verticalRate: number | null
  /** True when the airframe reports itself on the ground. */
  onGround: boolean
  /** Origin country as reported by the data source. */
  originCountry: string
  /** Epoch millis of the last position update from the source. */
  lastContact: number
  /**
   * Whether a published route (origin + destination) exists for this callsign.
   * `undefined` means "not looked up yet" — filters must treat that as visible,
   * so a slow or unreachable route API never empties the sky.
   */
  hasRoute?: boolean
}

/** Which layer the exhibit is showing. Tabs switch between them. */
export type ExhibitMode = 'flight' | 'satellite' | 'weather'

/** The two weather products, each its own chip on the control screen. Both are
 * global: `cloud` is total cloud cover in percent, `rain` is radar
 * reflectivity. */
export type WeatherLayer = 'cloud' | 'rain'

/**
 * How to turn a data tile's pixel back into a real-world number.
 *
 * MapTiler's weather tiles are measurements, not pictures: the value is packed
 * big-endian across one to three colour channels and linearly mapped onto
 * [min, max] in the variable's own unit (percent for cloud, dBZ for radar).
 * Alpha is the no-data mask. The renderer decodes it and applies OUR colour
 * ramp, which is why the rain is no longer somebody else's shade of red.
 */
export interface WeatherDecode {
  /** Real-world value at the bottom of the packed range. */
  min: number
  /** Real-world value at the top of it. */
  max: number
  /** Which channels carry the value, most significant first, e.g. "r", "rgb". */
  channels: string
  /** The variable's unit, for the log and the caption. */
  unit?: string
}

/** One assembled weather picture: a grid of Mercator tiles at one zoom level,
 * each carried as a data URL so the renderer can draw it into a canvas without
 * tripping over cross-origin tainting (the packaged app runs from file://). */
export interface WeatherFrame {
  layer: WeatherLayer
  /**
   * How the imagery is laid out. Tile services hand out Web Mercator, which the
   * renderer remaps; NASA's WMS hands out plate carrée, which is already the
   * frame's own projection and must NOT be remapped. Getting this wrong slides
   * everything toward or away from the equator, which is exactly the sort of
   * thing that looks almost right.
   */
  projection: 'mercator' | 'equirect'
  /**
   * How to put it on the globe.
   *
   * `photo` is a seamless picture of the earth — draw it where it has data and
   * let it be the earth. `cloud` is a geostationary disc, which is opaque out
   * to its own horizon and useless past it, so the cloud has to be lifted out
   * of it and the edge faded away.
   */
  blend?: 'photo' | 'cloud' | 'data'
  /** Present when `blend` is `data`: how to read a value out of a pixel. */
  decode?: WeatherDecode
  /** Tile pyramid level; the grid is 2^z by 2^z. A single full-frame image is
   * z=0, and several of them at (0,0) composite in the order they arrive —
   * which is how the geostationary discs are stitched into one globe. */
  z: number
  /** When the imagery was taken, epoch ms. */
  time: number
  /**
   * Where this frame sits in the animation loop, and how long the loop is.
   *
   * The source publishes a time series, and the tab looked like a photograph
   * until we used it. The renderer holds every step of a layer's series and
   * cross-fades through them in `step` order, so the weather drifts instead of
   * sitting still between polls. Absent (or steps=1) means a single picture.
   */
  step?: number
  steps?: number
  tiles: {
    x: number
    y: number
    url: string
    /**
     * For a geostationary disc: the longitude it sits over. The sensor sees
     * less and less as you go round the limb and then nothing at all, and the
     * "nothing" arrives as a hard edge in the image. Knowing where the disc is
     * centred lets the renderer fade each one out toward its own horizon, so
     * neighbouring sensors cross-blend instead of butting up against each other.
     */
    centerLon?: number
  }[]
}

/** Orbit class — drives colour and the filter chips. */
export type OrbitClass = 'leo' | 'starlink' | 'meo' | 'geo'

/** One satellite, propagated from its orbital elements. Deliberately the same
 * shape the renderer already needs for aircraft (id / name / position / heading
 * / speed) so the map, selection, and camera work unchanged. */
export interface Satellite {
  /** NORAD catalogue number. */
  id: string
  name: string
  lon: number
  lat: number
  /** Altitude above sea level, kilometres (aircraft use metres). */
  altKm: number
  /** Ground speed of the sub-satellite point, km/s. */
  speedKmS: number
  /** Direction of travel in degrees clockwise from north. */
  heading: number
  orbit: OrbitClass
}

/** On-demand detail for the selected satellite (panel + orbit line). */
export interface SatelliteDetail {
  id: string
  name: string
  altKm: number
  speedKmS: number
  /** Time for one orbit, minutes. */
  periodMin: number
  inclinationDeg: number
  orbit: OrbitClass
  /** One full orbit's ground track, or null if it couldn't be computed. */
  track: GeoPoint[] | null
  /** Seconds until it next rises over the exhibit, when that's known. */
  nextPassSec?: number
  /** How high it gets during that pass, degrees above the horizon. */
  passMaxElevationDeg?: number
  /** True when it is above the horizon right now. */
  overheadNow?: boolean
  /** Epoch of the elements this is propagated from, in the TLE's own
   * YYDDD.DDDDDDDD notation. Shown as provenance: it is how old the numbers on
   * screen actually are. */
  tleEpoch?: string
  /** Revolution number at epoch — how many times it has been round. */
  revNumber?: number
  /** International designator, e.g. "1998-067A" — the launch it came up on. */
  cosparId?: string
  /** Year it was launched, from that designator. */
  launchYear?: number
  /** Highest and lowest points of the orbit. Equal for a circular one; far
   * apart for a transfer or Molniya orbit, which is worth showing. */
  apogeeKm?: number
  perigeeKm?: number
  /** 0 = a perfect circle. */
  eccentricity?: number
  /** How far away it is from the exhibit right now, kilometres. */
  rangeKm?: number
}

/** A single point of a rendered route, in geographic coordinates. */
export interface GeoPoint {
  lon: number
  lat: number
}

export interface Airport {
  code: string // IATA/ICAO code shown in the panel, e.g. "ICN"
  city?: string // human city name, e.g. "서울"
  countryCode?: string // ISO 3166-1 alpha-2 (lowercase), e.g. "kr" — for the flag
  lon: number
  lat: number
}

/**
 * Rich, on-demand detail for the selected aircraft (panel + route). Fully
 * populated by the mock feed; best-effort (adsbdb/hexdb) for real OpenSky data.
 */
export interface FlightDetail {
  icao24: string
  airline?: string // "Korean Air"
  flightNo?: string // callsign, "KE902"
  origin?: Airport
  destination?: Airport
  aircraftType?: string // "B787-9"
  departureTime?: number // epoch millis
  etaRemainingSec?: number // seconds to arrival
  progress?: number // 0..1 along the route
  route: GeoPoint[] | null // great-circle origin→destination
  /** When `route` is null, a short human reason why (shown on both screens):
   * e.g. "공개 노선 데이터 없음", "군용기 · 노선 비공개", "위치가 노선과 불일치". */
  noRouteReason?: string
}

/** The equirectangular view the display shows, driven by the control map. */
export interface ViewState {
  centerLon: number
  centerLat: number
  /** Normalized span (1 = whole world, smaller = zoomed in). */
  span: number
}

export type OverlayKey = 'dayNight' | 'airports' | 'stats' | 'grid'

/**
 * Which feed the exhibit shows.
 *   'auto' — real OpenSky data, falling back to simulation if it stalls.
 *   'mock' — always the simulation (useful for demos, or when credits run out).
 */
export type FeedMode = 'auto' | 'mock'

/** Filters the operator can apply; an empty/undefined field means "no filter". */
export interface FlightFilter {
  originCountry?: string
  /** Only show aircraft at or above this altitude (metres). */
  minAltitude?: number
  /** Only show aircraft at or below this altitude (metres). */
  maxAltitude?: number
  /** Hide aircraft reporting on-ground. */
  airborneOnly?: boolean
  /** Categories to hide (empty/absent = show all): one of CategoryKey. */
  hiddenCategories?: string[]
  /** Show only identifiable aircraft — those with a known operator callsign —
   * and hide the GA/private/unknown long tail. Off by default; the operator can
   * turn it on, or just hide the 기타 category chip, which does the same thing
   * while still showing what it would add back. */
  scheduledOnly?: boolean
  /** Hide aircraft confirmed to have no published route, so visitors don't pick
   * a plane that can't show one. Aircraft not yet looked up stay visible. */
  routeOnly?: boolean
}

/**
 * Authoritative presentation state held by the hub. The hub rebroadcasts it
 * on every change so every window (and any late-joining window) stays in sync.
 */
export interface PresentationState {
  /** Currently selected aircraft (icao24), or null. */
  selected: string | null
  filter: FlightFilter
  /** Equirectangular view (center + zoom), driven by the control map. */
  view: ViewState
  overlays: Record<OverlayKey, boolean>
  /** Day/night preview hour 0–24 (KST), or null = live current time. */
  dayNightHour: number | null
  /** Live data or forced simulation. Defaults to live. */
  feedMode: FeedMode
  /** Aircraft layer or satellite layer. Defaults to aircraft. */
  mode: ExhibitMode
  /** Orbit classes to hide in satellite mode (empty = show all). */
  hiddenOrbits: OrbitClass[]
  /** Weather products to hide in weather mode (empty = show both). */
  hiddenWeather: WeatherLayer[]
}

export const DEFAULT_PRESENTATION_STATE: PresentationState = {
  selected: null,
  // Show everything that is airborne. Both of the filters that used to hide
  // aircraft are off: `scheduledOnly` was cutting roughly half of OpenSky's
  // report (7,100 reported, 3,500 drawn) because general-aviation and private
  // callsigns aren't recognisable as airlines, and `routeOnly` hid the ~5% with
  // no published route. The unidentifiable ones are now their own 기타 category
  // instead of being dropped, so the sky is full and the counts stay honest.
  filter: {
    airborneOnly: true,
    scheduledOnly: false,
    routeOnly: false,
    // Private and general-aviation traffic is about half of everything reported
    // and has no route to show, so it starts hidden — the chip says how many it
    // would add, and one tap brings them back.
    hiddenCategories: ['other']
  },
  view: { centerLon: 0, centerLat: 0, span: 1 }, // whole world
  // Day/night is always on (automatic). Grid on so the frame reads as a map.
  overlays: { dayNight: true, airports: false, stats: true, grid: true },
  dayNightHour: null, // live time
  feedMode: 'auto', // real data by default; the operator can force simulation
  mode: 'flight',
  // Starlink is roughly two thirds of the catalogue and swamps everything else,
  // so it starts hidden; turning the chip on makes the shells appear at once,
  // which reads as a reveal rather than as noise.
  hiddenOrbits: ['starlink'],
  // Clouds cover the whole globe and read as "a photograph of the earth right
  // now"; radar only exists over the countries that have radars, so on a world
  // map it starts as scattered patches with nothing between them. Clouds first,
  // rain on a tap.
  hiddenWeather: ['rain']
}

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

/** Messages the hub pushes to clients. */
export type ServerMessage =
  | { type: 'aircraft'; mode: 'full' | 'delta'; data: Aircraft[]; removed?: string[]; serverTime: number }
  | { type: 'state'; state: PresentationState }
  | { type: 'route'; icao24: string; points: GeoPoint[] | null }
  | { type: 'detail'; detail: FlightDetail | null }
  | { type: 'satellites'; data: Satellite[]; serverTime: number }
  | { type: 'satDetail'; detail: SatelliteDetail | null }
  | { type: 'weather'; frame: WeatherFrame }
  | {
      type: 'status'
      /** Which feed is actually painting the screen right now. */
      source: 'opensky' | 'mock'
      connected: boolean
      count: number
      /** Whether live data is possible at all (OpenSky credentials present).
       * Lets the UI say "connecting" instead of implying a config problem. */
      credentials: boolean
    }

/** Commands clients send to the hub. The hub applies them to PresentationState. */
export type ClientMessage =
  | { type: 'select'; icao24: string | null }
  | { type: 'setFilter'; filter: FlightFilter }
  | { type: 'setView'; view: ViewState }
  | { type: 'toggleOverlay'; key: OverlayKey; value?: boolean }
  | { type: 'setDayNight'; hour: number | null }
  | { type: 'setFeedMode'; mode: FeedMode }
  | { type: 'setMode'; mode: ExhibitMode }
  | { type: 'setHiddenOrbits'; orbits: OrbitClass[] }
  | { type: 'setHiddenWeather'; layers: WeatherLayer[] }
  | { type: 'hello'; role: 'control' | 'display' }
