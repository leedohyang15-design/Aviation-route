// Shared runtime configuration.
//
// On the Node side (hub / electron main) values come from process.env so the
// exhibit machine can be tuned without a rebuild. In the browser renderer
// `process` is undefined, so the defaults below are used — the defaults are the
// correct local values, and only advanced deployments need to override them.

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[key] != null) {
    return process.env[key]
  }
  return undefined
}

/** Port the local WebSocket hub listens on. */
export const HUB_PORT = Number(readEnv('HUB_PORT') ?? 8787)

/** ws:// URL the renderer windows connect to (hub is always local). */
export const HUB_URL = readEnv('HUB_URL') ?? `ws://127.0.0.1:${HUB_PORT}`

/**
 * Poll interval (ms) for OpenSky. The free tier is 4000 credits/day and a
 * worldwide /states/all request costs 4 credits, so only ~1000 requests/day.
 *   15s → ~960 credits/hour → budget gone in ~4h (too fast for an exhibit).
 *   90s → ~160 credits/hour → lasts ~25h, i.e. runs indefinitely day to day.
 * Positions stay smooth between polls via dead-reckoning (advance each plane
 * along its heading at its ground speed, then correct on the next snapshot), so
 * a long interval costs almost nothing visually. Override via env if needed.
 */
export const OPENSKY_POLL_INTERVAL_MS = Number(readEnv('OPENSKY_POLL_INTERVAL_MS') ?? 90000)

/** Poll interval (ms) for the mock feed (no credit limits — can be brisk). */
export const MOCK_POLL_INTERVAL_MS = Number(readEnv('MOCK_POLL_INTERVAL_MS') ?? 5000)

/**
 * How many aircraft the simulation flies. Roughly matches what OpenSky reports
 * airborne worldwide at a given moment, so the simulated sky looks as busy as
 * the real one. Stays under the renderer's instance CAPACITY (16000).
 */
export const MOCK_AIRCRAFT_COUNT = Number(readEnv('MOCK_AIRCRAFT_COUNT') ?? 6000)

/**
 * Route lookup (adsbdb). OpenSky's snapshot has no origin/destination, so routes
 * are resolved by callsign and cached; aircraft confirmed to have no route are
 * hidden. adsbdb answers one callsign per request, so a background loop makes one
 * request every this many milliseconds — a steady, low load on a free service,
 * deliberately independent of the poll interval. 400ms ≈ 2.5/s clears a typical
 * ~4,000-callsign backlog in under half an hour, and the disk cache means that
 * cost is paid roughly once a day. Lower it to converge faster.
 */
export const ROUTE_LOOKUP_INTERVAL_MS = Number(readEnv('ROUTE_LOOKUP_INTERVAL_MS') ?? 300)
/** Cap on cached callsigns; the oldest are dropped when the file is written. */
export const ROUTE_CACHE_MAX = Number(readEnv('ROUTE_CACHE_MAX') ?? 20000)
/** How long a resolved route stays cached (routes rarely change mid-day). */
export const ROUTE_CACHE_TTL_MS = Number(readEnv('ROUTE_CACHE_TTL_MS') ?? 24 * 3600_000)
/** How long a "no route" answer sticks before we try that callsign again. */
export const ROUTE_NEGATIVE_TTL_MS = Number(readEnv('ROUTE_NEGATIVE_TTL_MS') ?? 6 * 3600_000)

/** Equirectangular render target. Must stay exactly 2:1 for sphere projection. */
export const EQUIRECT_WIDTH = Number(readEnv('EQUIRECT_WIDTH') ?? 4096)
export const EQUIRECT_HEIGHT = EQUIRECT_WIDTH / 2

/**
 * Optional photographic earth texture. Drop an equirectangular (2:1) image at
 * this path (renderer `public/` in dev, next to the built html in production).
 * If absent, the display falls back to a procedural ocean + graticule.
 */
export const EARTH_TEXTURE_URL = 'earth_equirect.jpg'

/**
 * Optional night-lights (city lights) texture, shown at night per Korea time.
 * Drop a 2:1 "Black Marble" image here; if absent, night just dims globally.
 */
export const EARTH_NIGHT_URL = 'earth_night.jpg'

// ---------------------------------------------------------------------------
// Satellite mode
// ---------------------------------------------------------------------------

/**
 * Celestrak's general-perturbations catalogue of active satellites (~11,000
 * objects, ~2MB as TLE). TLEs are regenerated roughly daily and Celestrak asks
 * that clients not re-fetch more often than the data changes, so the app
 * downloads once a day and keeps a copy on disk.
 */
export const TLE_URL =
  readEnv('TLE_URL') ?? 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=TLE'
/** How long a downloaded TLE set is considered current. */
export const TLE_MAX_AGE_MS = Number(readEnv('TLE_MAX_AGE_MS') ?? 24 * 3600_000)

/**
 * Target period between satellite position updates. Propagating the whole
 * catalogue takes a second or two, and at orbital speed a couple of seconds is
 * ~0.15° of longitude — under a pixel at world view — so the renderer's existing
 * easing and dead reckoning carry the motion between updates. Lower it for a
 * smaller catalogue.
 */
export const SAT_TICK_MS = Number(readEnv('SAT_TICK_MS') ?? 2000)
/**
 * Propagation yields to the event loop whenever a slice has run this long, so a
 * tick never blocks the main process long enough to stall WebSocket sends or
 * make the windows stutter — however large the catalogue grows.
 */
export const SAT_SLICE_MS = Number(readEnv('SAT_SLICE_MS') ?? 8)
/** Where the exhibit is, for "when does it pass over us?" (Seoul). */
export const OBSERVER_LAT = Number(readEnv('OBSERVER_LAT') ?? 37.5665)
export const OBSERVER_LON = Number(readEnv('OBSERVER_LON') ?? 126.978)

// ---------------------------------------------------------------------------
// Weather mode
// ---------------------------------------------------------------------------

/**
 * RainViewer's free public index: the last two hours of frames for both the
 * global geostationary infrared (clouds) and the ground-radar precipitation
 * products, plus the tile host to fetch them from. No key, no registration.
 */
export const WEATHER_INDEX_URL =
  readEnv('WEATHER_INDEX_URL') ?? 'https://api.rainviewer.com/public/weather-maps.json'

/**
 * How often to look for a newer frame. The source publishes every ten minutes,
 * so five is often enough to pick one up promptly without asking twice for the
 * same picture.
 */
export const WEATHER_POLL_MS = Number(readEnv('WEATHER_POLL_MS') ?? 5 * 60_000)

/**
 * Tile pyramid level. z=3 is an 8x8 grid — 64 tiles, 2048x2048 once assembled,
 * which is 5.7 pixels per degree against the dome frame's 4.6, so the imagery
 * is at the frame's own resolution and no finer. z=4 quadruples both the
 * request count and the texture memory for detail the dome cannot show.
 */
export const WEATHER_ZOOM = Number(readEnv('WEATHER_ZOOM') ?? 3)
/** Tile edge in pixels. RainViewer serves 256 and 512. */
export const WEATHER_TILE_PX = Number(readEnv('WEATHER_TILE_PX') ?? 256)
/** Per-request timeout for the index and for each tile. */
export const WEATHER_TIMEOUT_MS = Number(readEnv('WEATHER_TIMEOUT_MS') ?? 12_000)
/** How stale a cached frame may be before it is described as old on screen. */
export const WEATHER_MAX_AGE_MS = Number(readEnv('WEATHER_MAX_AGE_MS') ?? 30 * 60_000)

/**
 * Where the cloud picture comes from.
 *
 * NOT from RainViewer: its free tier answers `satellite.infrared: []` — the
 * product exists in the index and carries no frames, which is the polite way
 * of saying it is a paid one. Rain still comes from there.
 *
 * NASA GIBS serves plate carrée directly, which is the frame's own projection,
 * so a cloud picture is one request and no reprojection at all.
 */
export const WEATHER_CLOUD_SOURCE = readEnv('WEATHER_CLOUD_SOURCE') ?? 'gibs'
export const WEATHER_GIBS_URL =
  readEnv('WEATHER_GIBS_URL') ?? 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi'
/**
 * The geostationary sensors, as `longitude:name|name|name` slots.
 *
 * One picture per slot, the first name that answers; the renderer fades each
 * one out at its own horizon so neighbours cross-blend. FIVE slots, because
 * four leaves a hole: GOES East and West cover the Americas and the Pacific,
 * Himawari covers Asia, and without the two Meteosats there is nothing at all
 * over Africa and the Indian Ocean — which is the black gap that made the
 * first attempt look broken.
 *
 * Clean Infrared rather than GeoColor: it sees cloud at night as well as by
 * day, and being greyscale it separates from the ground far more cleanly than
 * a colour composite full of city lights and deserts. GeoColor is listed
 * second in each slot in case a Band 13 name is not the one GIBS uses.
 *
 * Which names exist is the one thing that cannot be checked from here, so the
 * log names the layer that answered in each slot. Trim this list once the
 * exhibit machine has told us.
 */
export const WEATHER_GIBS_SLOTS = (
  readEnv('WEATHER_GIBS_SLOTS') ??
  [
    '-75:GOES-East_ABI_Band13_Clean_Infrared|GOES-East_ABI_GeoColor',
    '-137:GOES-West_ABI_Band13_Clean_Infrared|GOES-West_ABI_GeoColor',
    '140.7:Himawari_AHI_Band13_Clean_Infrared|Himawari_AHI_GeoColor',
    '0:MSG_Meteosat_11_Band13_Clean_Infrared|Meteosat-11_Band13_Clean_Infrared|MSG_Band13_Clean_Infrared',
    '45.5:MSG_Meteosat_9_Band13_Clean_Infrared|Meteosat-9_Band13_Clean_Infrared|MSG_IODC_Band13_Clean_Infrared'
  ].join(',')
)
  .split(',')
  .map((entry) => {
    const [lon, names] = entry.split(':')
    return { lon: Number(lon), names: (names ?? '').split('|').filter(Boolean) }
  })
  .filter((s) => Number.isFinite(s.lon) && s.names.length)

/**
 * RainViewer's colour scheme for the rain tiles. 2 is Universal Blue, the one
 * the free tier serves, and the one the legend on the control screen is drawn
 * to match — change them together or the key will lie.
 */
export const WEATHER_RAIN_COLOR = Number(readEnv('WEATHER_RAIN_COLOR') ?? 2)

/**
 * How strongly the cloud reads against the earth under it.
 *
 * Infrared is a measurement, not a photograph: thin high cirrus and a deep
 * thunderhead differ by a lot in the data and by very little in brightness once
 * it is drawn, so straight extraction comes out as a pale wash. Above 1 the
 * cloud is pushed toward what it looks like from a plane window.
 */
export const WEATHER_CLOUD_OPACITY = Number(readEnv('WEATHER_CLOUD_OPACITY') ?? 1.45)

/**
 * Width of the requested plate-carrée image; height is half, always.
 *
 * 1024, not 2048. Each disc only covers about a quarter of the globe, so most
 * of a full-width request is transparency — and five of them, base64'd into one
 * WebSocket message, is over ten megabytes to stringify. That stringify happens
 * on the hub's only thread, which is why switching INTO the weather tab used to
 * hang long enough that the tab looked stuck.
 */
export const WEATHER_GIBS_WIDTH = Number(readEnv('WEATHER_GIBS_WIDTH') ?? 1024)
