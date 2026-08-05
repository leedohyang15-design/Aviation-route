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

/**
 * Mip chain and anisotropic filtering on the world maps. On by default.
 *
 * It was off, on the theory that a wrapping texture's pyramid is built with its
 * edges clamped and draws a hairline where the map joins itself. That theory
 * was never tested and it was answering the wrong symptom. What the exhibit
 * actually shows is a line that CRAWLS when the globe is turned, and a seam
 * does not crawl — it sits still. Rendering the background alone with the wrap
 * forced into the middle of the frame found nothing there: one percent of rows,
 * a third of a grey level.
 *
 * Crawling is what undersampling looks like. The day map is sixteen thousand
 * pixels wide against a sixteen-hundred-pixel frame, so a screen pixel covers
 * about ten texels and a linear sample reads four of them. Move the offset a
 * fraction and it reads four DIFFERENT ones — the map fizzes along its
 * highest-contrast edges. A mip chain is the answer to exactly that, and it
 * brings anisotropic filtering with it, which is what keeps an equirectangular
 * map sharp where it is stretched.
 *
 * Set to 0 to go back, and the seam test in the log reports what the wrap
 * column is doing either way, so the trade is measurable rather than argued.
 */
export const EARTH_MIPMAPS = (readEnv('EARTH_MIPMAPS') ?? '1') !== '0'

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
 * OpenWeatherMap: cloud AND rain from ONE model on ONE key.
 *
 * The exhibit's problem was never that either layer was wrong. It was that they
 * are different KINDS of thing: the cloud a geostationary camera's infrared
 * photograph, the rain a model's opinion. Measured on the same grid at the same
 * instants they correlate at 0.39 — right place, right time, still not the same
 * weather, because infrared sees cold tops rather than cloud and the model
 * parameterises convection inside its cells.
 *
 * Every public map they get compared against solves this the same way: their
 * "cloud" is not a photograph either, it is the model's own total cloud cover.
 * One model, one timestamp, so the two agree by construction.
 *
 * Two APIs, because which one a free key may use is the thing that cannot be
 * checked from here. Maps 2.0 takes a `date` and so can animate; Maps 1.0 is
 * current-only. It probes 2.0, falls back to 1.0, and the log says which is
 * live and therefore whether the tab animates.
 */
/**
 * Tile pyramid level for OpenWeatherMap. 2 = a 4x4 grid, 1024px around the world.
 *
 * Not 3. A free key allows sixty calls a minute, and level 3 is sixty-four
 * tiles per layer — a hundred and twenty-eight a poll, which walks straight
 * into the limit and comes back 401. Level 2 is thirty-two a poll and stays far
 * under it.
 *
 * The resolution is not the sacrifice it looks like: this is model output, and
 * the model's own grid is a quarter of a degree — about fourteen hundred cells
 * around the equator. A thousand-pixel texture is close to the resolution the
 * numbers actually have, so most of what level 3 bought was a sharper picture
 * of an interpolation.
 */
export const OWM_ZOOM = Number(readEnv('OWM_ZOOM') ?? 2)

export const OPENWEATHER_KEY = readEnv('OPENWEATHER_KEY') ?? ''
export const OWM_TILE_BASE = readEnv('OWM_TILE_BASE') ?? 'https://tile.openweathermap.org/map'
export const OWM_TILE_BASE_V2 =
  readEnv('OWM_TILE_BASE_V2') ?? 'https://maps.openweathermap.org/maps/2.0/weather'
/** Layer ids: [Maps 1.0 name, Maps 2.0 op code]. */
export const OWM_LAYERS: Record<'cloud' | 'rain', [string, string]> = {
  cloud: ['clouds_new', 'CL'],
  rain: ['precipitation_new', 'PR0']
}

export const WEATHER_FRAME_COUNT = Number(readEnv('WEATHER_FRAME_COUNT') ?? 4)
/** Seconds of wall clock per keyframe in the loop, and the cross-fade share. */
export const WEATHER_FRAME_HOLD_MS = Number(readEnv('WEATHER_FRAME_HOLD_MS') ?? 2200)
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
/** Per-request timeout for the index and for each tile. */
export const WEATHER_TIMEOUT_MS = Number(readEnv('WEATHER_TIMEOUT_MS') ?? 12_000)

/**
 * The geostationary sensors, as `longitude:name|name|name` slots, optionally
 * followed by `@endpoint` when that sensor is not on the default one.
 *
 * One picture per slot, the first name that answers; the renderer fades each
 * one out at its own horizon so neighbours cross-blend. Five slots, because
 * four leaves the hole described above.
 *
 * Clean Infrared rather than a colour composite: it sees cloud at night as
 * well as by day, and being greyscale it separates from the ground far more
 * cleanly than a picture full of city lights and deserts. The Meteosat slots
 * list several names because the 0-degree position has been handing over from
 * Meteosat Second to Third Generation, so both spellings are worth trying.
 *
 * Which names exist is the one thing that cannot be checked from here, so the
 * log names the layer that answered in each slot. Trim this list once the
 * exhibit machine has told us.
 */
/**
 * How strongly the cloud reads against the earth under it.
 *
 * Infrared is a measurement, not a photograph: thin high cirrus and a deep
 * thunderhead differ by a lot in the data and by very little in brightness once
 * it is drawn, so straight extraction comes out as a pale wash. Above 1 the
 * cloud is pushed toward what it looks like from a plane window.
 */
export const WEATHER_CLOUD_OPACITY = Number(readEnv('WEATHER_CLOUD_OPACITY') ?? 1.45)

