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
 * The Mars map, for the fourth tab. Same rules as the earth one: a 2:1
 * equirectangular image in the renderer's `public/`, any of jpg/png/webp.
 *
 * There is no night map and there is no terminator. Mars gets flat daylight,
 * which is not a shortcut but the honest choice: this is a mosaic assembled
 * from thousands of orbital passes over years, not a photograph of one moment,
 * so drawing a shadow across it would be inventing a time of day for a picture
 * that does not have one. What time it is on Mars is answered properly
 * elsewhere — see marsClock() in shared/probes.ts.
 */
export const MARS_TEXTURE_URL = 'mars_equirect.jpg'
/**
 * Grading for the Mars map, because Mars maps arrive graded for print.
 *
 * The earth photograph is shown at 1.0/1.0 — neutral, faithful to the source.
 * Mars mosaics are not neutral to begin with: they are colour-balanced to look
 * like the popular idea of Mars, which on a dark projector in a dark room comes
 * out as a single muddy red with the terrain lost inside it. Pulling the
 * saturation back and lifting the brightness is not making it "less red", it is
 * undoing a correction that was applied for a different medium — the craters
 * and the ridges come back, and it still reads unmistakably as Mars.
 *
 * Both are env-tunable so the exhibit can be matched to its own projector
 * without a rebuild, which is the only way anyone can actually judge this.
 */
export const MARS_SATURATION = Number(readEnv('MARS_SATURATION') ?? 0.62)
/**
 * Per-channel gain. This, not saturation, is what answers "too red".
 *
 * Desaturating a red-dominant image only walks it toward grey — the hue stays
 * where it was, so the map goes from bright red to dull red. What actually
 * moves it is lifting green and blue against red, which takes it from the
 * blood-red of a Viking-era colour calibration toward the butterscotch that
 * white-balanced surface photographs from Curiosity actually show. That is not
 * a stylisation away from the truth; it is a step toward it.
 *
 * Measured on representative pixels, the red-to-green ratio of typical terrain
 * goes 1.69 (raw) → 1.46 (saturation alone) → 1.21 (with this).
 */
export const MARS_TINT = (readEnv('MARS_TINT') ?? '0.94,1.03,1.18')
  .split(',')
  .map(Number)
/**
 * Mid-tone lift as a gamma, deliberately not a brightness multiply.
 *
 * A multiply takes the brightest thing on the map first, and on Mars that is
 * the polar caps: at 1.28 they clipped to flat white and read as a pink band
 * smeared across the top and bottom of the frame — which is what the caps
 * looked like on the first attempt. A power below one lifts the terrain and
 * leaves 1.0 at 1.0, so the caps stay caps.
 */
export const MARS_LIFT = Number(readEnv('MARS_LIFT') ?? 1.3)

/**
 * Mip chain and anisotropic filtering on the world maps. On by default.
 *
 * It was off, on the theory that a wrapping texture's pyramid is built with its
 * edges clamped and draws a hairline where the map joins itself. That theory
 * was never tested, and it was answering the wrong symptom: what the exhibit
 * shows is a line that CRAWLS when the globe is turned, and a seam sits still.
 * Rendering the background alone with the wrap forced into the centre of the
 * frame found one percent of rows stepping there, a third of a grey level.
 *
 * Crawling is undersampling. The day map is 16384px wide against a 1664px
 * frame, so a screen pixel covers about ten texels and a linear sample reads
 * four; move the offset a fraction and it reads four DIFFERENT ones. A mip
 * chain answers exactly that, and brings anisotropy with it.
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
 * MapTiler Weather — cloud AND rain from one place, which is the whole point.
 *
 * The previous arrangement took cloud from NASA GIBS and rain from RainViewer,
 * and it showed: two products from two sensors at two resolutions that
 * disagreed with each other and with the official numbers. GIBS gives infrared
 * brightness, from which cloud has to be GUESSED by a luminance heuristic —
 * which is why Korea never matched its published cloud cover. RainViewer's free
 * tier has no satellite at all, and its radar only exists over countries with
 * ground radar, so Africa and the oceans were simply blank.
 *
 * MapTiler serves both as GFS model fields on one key: real cloud-cover percent
 * and real radar reflectivity, global, on the same grid, in one tile scheme.
 * They are DATA tiles — the value is packed into the pixel, not painted — so
 * the colour ramp is ours, and a wrong-looking rain colour is now a number in
 * this file rather than somebody else's palette.
 *
 * Requires a key (free, non-commercial): https://cloud.maptiler.com/account/keys
 * Put it in .env as MAPTILER_KEY. Without one the exhibit falls back to the old
 * GIBS + RainViewer pair rather than showing an empty sky.
 */
export const MAPTILER_KEY = readEnv('MAPTILER_KEY') ?? ''
export const MAPTILER_WEATHER_INDEX =
  readEnv('MAPTILER_WEATHER_INDEX') ?? 'https://api.maptiler.com/weather/latest.json'
export const MAPTILER_TILE_BASE =
  readEnv('MAPTILER_TILE_BASE') ?? 'https://api.maptiler.com/tiles'
/**
 * Which variable each layer is, as `id|id|id` — the first one the key's index
 * actually carries wins.
 *
 * Alternatives, not a single name, because entitlement varies: the exhibit's
 * own key answers with temperature, pressure, precipitation, wind and radar,
 * and NO cloud variable of any kind. So cloud falls through this list and then
 * out to GIBS, and the log says which happened.
 */
export const MAPTILER_VARIABLES: Record<'cloud' | 'rain' | 'wind', string> = {
  cloud:
    readEnv('MAPTILER_CLOUD_VARIABLE') ??
    'cloud_cover-total:gfs|cloud_cover-high:gfs|cloud-cover:gfs',
  // Precipitation first, reflectivity second. Reflectivity is what a radar
  // returns and it is genuinely patchy — the model only lights it up where it
  // has hydrometeors big enough to scatter. Every public weather map anyone
  // compares this against, Windy included, paints an hour's precipitation
  // instead, which is broader, smoother and the thing people mean by "where is
  // it raining". The ramp already reads the unit off the index, so switching
  // costs nothing.
  rain: readEnv('MAPTILER_RAIN_VARIABLE') ?? 'precipitation-1h:gfs|radar-composite:gfs',
  /*
   * Wind, which the index has been offering all along.
   *
   * Every poll listed it — temperature, pressure, precipitation, WIND, radar —
   * while the tab used two of the five. It is the one field that is worth
   * animating on its own: cloud and rain are pictures of a moment and stepping
   * them faster only makes them flicker, but wind is a direction at every
   * point, so particles can be let loose in it and the map moves continuously
   * without pretending to new data.
   */
  wind: readEnv('MAPTILER_WIND_VARIABLE') ?? 'wind-10m:gfs'
}
/**
 * How many keyframes to bring back, newest first.
 *
 * The index carries a whole time series, which is what makes the tab stop
 * looking like a photograph: the renderer cross-fades through them so the
 * weather actually drifts. Each extra keyframe is another full tile grid, so
 * this is the one knob that trades bandwidth for motion. 1 = a still picture.
 */
export const WEATHER_FRAME_COUNT = Number(readEnv('WEATHER_FRAME_COUNT') ?? 4)

/**
 * How many wind keyframes. One, on purpose.
 *
 * The motion in a wind layer comes from particles travelling through the field,
 * not from the field changing — Windy animates a single analysis for hours the
 * same way. A second keyframe would double the bytes to buy a change nobody can
 * see behind moving particles.
 */
export const WEATHER_WIND_FRAMES = Number(readEnv('WEATHER_WIND_FRAMES') ?? 1)

/**
 * The flow animation: how many particles, how long a streak, how long each
 * lives, and how much the speed is exaggerated.
 *
 * The exaggeration is large and deliberate. Ten metres a second is about a
 * ten-thousandth of a degree per second, which on a world map is no motion at
 * all. What an exhibit needs from a wind layer is the SHAPE of the flow — the
 * jet streams, the way air turns around a low — and that reads correctly at any
 * speed so long as fast air visibly outruns slow air.
 */
/*
 * Long thin ribbons, not travelling dots.
 *
 * These four numbers are not free choices — they have to be worked out in
 * PIXELS or the streak comes out as a speck. The frame is 1664px for 360°, so
 * one degree of longitude is 4.6px, and 20 m/s (an ordinary wind) advances
 * `SPEED / 111320` degrees a second. The tail is TAIL frames long, which at
 * 60fps is TAIL/60 seconds of that travel.
 *
 * At the first attempt — SPEED 14000, TAIL 16 — that arithmetic came to a
 * streak THREE PIXELS long, which is a dot however carefully it is tapered.
 * The numbers below put an ordinary wind at a ~25px hair drifting at ~37px a
 * second and a jet stream at ~75px, which is what the reference picture shows:
 * many fine curved strokes, not a few fat ones.
 */
export const WEATHER_WIND_PARTICLES = Number(readEnv('WEATHER_WIND_PARTICLES') ?? 1400)
export const WEATHER_WIND_TAIL = Number(readEnv('WEATHER_WIND_TAIL') ?? 40)
export const WEATHER_WIND_LIFE = Number(readEnv('WEATHER_WIND_LIFE') ?? 300)
export const WEATHER_WIND_SPEED = Number(readEnv('WEATHER_WIND_SPEED') ?? 45000)
/**
 * How the speed becomes a distance: `REF * (speed/REF)^GAMMA`.
 *
 * Straight proportion does not work here. Surface wind is mostly 2-8 m/s and a
 * jet stream is sixty, so proportion hands the whole visual range to the jets
 * and leaves the ground motionless — a 3 m/s breeze came out as a four-pixel
 * mark. The fractional power keeps the ordering (fast air still visibly
 * outruns slow air) while lifting the bottom of the range into view: at these
 * numbers 3 m/s draws ~10px, 8 m/s ~16px, 50 m/s ~35px.
 */
export const WEATHER_WIND_REF = Number(readEnv('WEATHER_WIND_REF') ?? 18)
export const WEATHER_WIND_GAMMA = Number(readEnv('WEATHER_WIND_GAMMA') ?? 0.45)
/**
 * Stroke width in pixels, including the dark rim.
 *
 * The rim is not decoration. A white hairline is legible over ocean and
 * invisible over bright desert or cloud, and the exhibit shows all three at
 * once; a dark edge under the bright core keeps the stroke readable on any
 * background and antialiases an edge that was previously a hard quad boundary.
 */
export const WEATHER_WIND_WIDTH = Number(readEnv('WEATHER_WIND_WIDTH') ?? 2.6)
/** Seconds of wall clock per keyframe in the loop, and the cross-fade share. */
/**
 * Wall clock per keyframe. Slower now that the wind carries the motion.
 *
 * At 2.2s the cloud and rain were restless — a whole three-hour loop in
 * thirteen seconds, which reads as flicker rather than weather moving. The
 * point of a step is to be NOTICED, and between steps there is now something
 * genuinely continuous to watch.
 */
export const WEATHER_FRAME_HOLD_MS = Number(readEnv('WEATHER_FRAME_HOLD_MS') ?? 6000)
/**
 * Ceiling on one layer's whole series, in megabytes.
 *
 * A two-channel variable's low byte turns over every 1/65536th of its range,
 * so it is noise even where the field is smooth — and PNG cannot compress
 * noise. A four-step radar series measured 54MB against a cloud series' 5MB,
 * and that number gets broadcast to both windows and written to disk. Frames
 * are fetched newest-first and the fetch stops here, so what a full budget
 * costs is a shorter animation, never the picture of right now.
 */
export const WEATHER_MAX_SERIES_MB = Number(readEnv('WEATHER_MAX_SERIES_MB') ?? 24)

/**
 * RainViewer's free public index — the fallback rain source, used only when no
 * MapTiler key is configured.
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
 * How old the disk cache may be and still be worth putting on screen.
 *
 * The cache exists so an offline start is not a blank earth, and that is worth
 * having. What it must not do is present three-hour-old weather as the sky:
 * open the exhibit at three in the afternoon and the plate said nine in the
 * morning, which is not a stale picture so much as a wrong one. The model
 * publishes hourly, so a live series is at most an hour old plus the
 * publication lag; ninety minutes is clear of that and far short of the gap
 * that made this obvious.
 */
export const WEATHER_CACHE_MAX_AGE_MS = Number(readEnv('WEATHER_CACHE_MAX_AGE_MS') ?? 90 * 60_000)

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
 * EUMETSAT's public WMS. No key, no registration.
 *
 * Needed because NASA GIBS does not carry Meteosat. Its catalogue was read in
 * full on the exhibit machine — 2938 layers — and its only geostationary
 * infrared is GOES-East, GOES-West and Himawari; everything else that mentions
 * infrared is a polar-orbiting swath. Those three see from 155W round to about
 * 5E, which leaves 5E to 61E with no cloud at all: east Africa, the Middle
 * East and the western Indian Ocean. That is the black gap on the left of the
 * frame, and no spelling of a NASA layer name was ever going to fill it,
 * because the pictures are not there. Meteosat is the satellite that looks at
 * that longitude, and this is where its owner publishes it.
 */
export const WEATHER_EUMETSAT_URL =
  readEnv('WEATHER_EUMETSAT_URL') ?? 'https://view.eumetsat.int/geoserver/wms'

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
const EUM = `@${WEATHER_EUMETSAT_URL}`
export const WEATHER_GIBS_SLOTS = (
  readEnv('WEATHER_GIBS_SLOTS') ??
  [
    // No GeoColor spares. GeoColor is a VISIBLE-light true-colour composite,
    // not a brightness temperature: by day it is white cloud over bright
    // desert and blue ocean, and it carries the day/night terminator inside
    // the picture. Dropped into a mosaic of infrared discs and then stretched
    // onto the common scale, it comes out as a bright patch that stays bright
    // where the rest of the globe goes dark. It was only ever meant as a spare
    // spelling; it is a different measurement and there is no scale on which
    // it agrees with the other four sensors.
    '-75:GOES-East_ABI_Band13_Clean_Infrared',
    '-137:GOES-West_ABI_Band13_Clean_Infrared',
    '140.7:Himawari_AHI_Band13_Clean_Infrared',
    // msg_fes first: both of these are confirmed answering on the exhibit
    // machine, and a first choice that always fails is a wasted request on
    // every poll for as long as the exhibit runs. mtg_fd stays behind it —
    // the 0-degree position is handing over from Meteosat Second Generation
    // to Third, and on the day MSG stops answering the spare takes over with
    // nobody having to notice.
    `0:msg_fes:ir108|mtg_fd:ir105|meteosat:msg_ir108${EUM}`,
    `45.5:msg_iodc:ir108|mtg_iodc:ir105|meteosat_iodc:ir108${EUM}`
  ].join(',')
)
  .split(',')
  .map((entry) => {
    // The endpoint comes off first: a GeoServer layer name contains a colon
    // (workspace:layer), so the longitude has to be split off at the FIRST
    // colon and everything after it kept whole.
    const at = entry.indexOf('@')
    const url = at >= 0 ? entry.slice(at + 1).trim() : undefined
    const rest = (at >= 0 ? entry.slice(0, at) : entry).trim()
    const colon = rest.indexOf(':')
    const lon = Number(rest.slice(0, colon))
    const names = rest
      .slice(colon + 1)
      .split('|')
      .filter(Boolean)
    return { lon, names, url }
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
 * Pixel width of ONE geostationary patch — 160 degrees wide, and square.
 *
 * This used to be the width of a whole -180..180 image, which is where the
 * "구름 해상도가 너무 낮다" came from: a sensor sees eighty degrees around the
 * point it hangs over, so nearly two thirds of that image was empty space and
 * the disc itself got a third of the pixels. The same 1024 across 160 degrees
 * is 6.4 pixels per degree against the old 2.8 — two and a quarter times
 * sharper, for the same bytes on the wire.
 */
export const WEATHER_GIBS_WIDTH = Number(readEnv('WEATHER_GIBS_WIDTH') ?? 1024)

/**
 * A single seamless global infrared layer, tried before the discs. `off` skips
 * it. Comma-separated alternatives; the catalogue is also searched for anything
 * that looks like a merged IR product.
 *
 * `off` by default, because the exhibit machine has now told us: MERGIR — the
 * merged infrared this was written for — is not in that endpoint's catalogue,
 * and neither is anything else global. Leaving it on cost a failed request
 * every poll to prove a fact we already know. Set it to a layer name if a
 * different endpoint does carry one; the machinery is still here and is still
 * the better shape of answer when it exists.
 */
export const WEATHER_GIBS_GLOBAL = readEnv('WEATHER_GIBS_GLOBAL') ?? 'off'
/**
 * How many past steps the cloud animates over, and how far apart.
 *
 * The geostationary sensors publish every ten minutes, so these are real
 * observations rather than an interpolation — twenty minutes of actual
 * weather. Each step is another full set of sensor requests, so this is the
 * knob that trades bandwidth for movement; 1 is a single still picture.
 */
export const WEATHER_CLOUD_STEPS = Number(readEnv('WEATHER_CLOUD_STEPS') ?? 4)
export const WEATHER_CLOUD_STEP_MS = Number(readEnv('WEATHER_CLOUD_STEP_MS') ?? 15 * 60_000)

/** Pixel width of the global image; height is a third of it (360deg by 120). */
export const WEATHER_GIBS_GLOBAL_WIDTH = Number(readEnv('WEATHER_GIBS_GLOBAL_WIDTH') ?? 3072)
