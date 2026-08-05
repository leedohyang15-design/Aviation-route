// Real-time weather imagery: the clouds a geostationary satellite saw a few
// minutes ago, and where it is raining under them.
//
// The tiles are fetched HERE rather than in the renderer for two reasons. The
// packaged app loads its pages from file://, so a cross-origin image drawn into
// a canvas taints it and the WebGL upload then throws — data: URLs, which is
// what this module hands out, never do. And fetching once for both windows
// keeps the timeouts, the backoff, the disk cache and the log in the one place
// the rest of the exhibit's network policy already lives.
//
// The imagery is in Web Mercator, the renderer is equirectangular. Nothing is
// reprojected here: Mercator's x is linear in longitude, so the remap is a
// vertical formula the fragment shader does for free (see globe.ts).

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { WeatherFrame, WeatherLayer } from '../src/shared/types'
import {
  WEATHER_FRAME_COUNT,
  WEATHER_INDEX_URL,
  WEATHER_POLL_MS,
  WEATHER_TILE_PX,
  WEATHER_TIMEOUT_MS,
  WEATHER_ZOOM,
  WEATHER_CLOUD_SOURCE,
  WEATHER_GIBS_URL,
  WEATHER_GIBS_SLOTS,
  WEATHER_GIBS_WIDTH,
  WEATHER_GIBS_GLOBAL,
  WEATHER_GIBS_GLOBAL_WIDTH,
  WEATHER_CLOUD_STEPS,
  WEATHER_CLOUD_STEP_MS,
  WEATHER_RAIN_COLOR,
  OPENWEATHER_KEY,
  OWM_TILE_BASE,
  OWM_TILE_BASE_V2,
  OWM_LAYERS
} from '../src/shared/config'
import { fetchWithTimeout } from './http'
import { dataPath, dataPathCandidates } from './datadir'
import { opsLog } from './log'

const CACHE_NAME = 'aviation-route-weather.json'
const CACHE_PATH = dataPath(CACHE_NAME)
/**
 * Bump this whenever the shape of a frame changes.
 *
 * A cached frame is replayed at startup so an offline exhibit still has a sky,
 * but a frame made by an older build is made differently — the mosaic era wrote
 * a single full-frame picture with no sub-satellite longitude on it, which the
 * renderer draws as an unfeathered rectangle. That is why the weather started
 * as a rectangle and only became a globe once the first poll landed: it was
 * yesterday's format on screen, not today's.
 */
// 5: frames carry a `source` and OpenWeatherMap frames are painted rather than
// packed. A cached frame from the old source, replayed under the new badge,
// would credit the wrong service for the picture on screen.
const CACHE_VERSION = 5

/** RainViewer's index. Only the fields we use are described. */
interface Index {
  host: string
  radar?: { past?: { time: number; path: string }[] }
  satellite?: { infrared?: { time: number; path: string }[] }
}

interface Persisted {
  version: number
  saved: number
  frames: WeatherFrame[]
}

const LAYERS: WeatherLayer[] = ['cloud', 'rain']

/**
 * The newest SERIES we have for each layer, whether from the network or the
 * cache — one entry per animation step, in loop order. Kept so a
 * later-connecting window, or a failed poll, still has weather to show.
 */
const latest = new Map<WeatherLayer, WeatherFrame[]>()

/** The newest moment in a layer's series, epoch ms. */
function seriesTime(frames: WeatherFrame[]): number {
  let t = 0
  for (const f of frames) t = Math.max(t, f.time)
  return t
}

let timer: ReturnType<typeof setTimeout> | null = null
let stopped = true
/** True while a poll body is alive, including across its awaits — the guard has
 * to be owned by the loop, not by the start/stop pair, or a fast mode toggle
 * during a fetch leaves two loops running (the same bug the OpenSky and
 * satellite loops had). */
let running = false
/** Consecutive failures, for the backoff. */
let failures = 0

/**
 * Past cloud steps, by the timestamp they were taken at.
 *
 * The animation walks the last three quarters of an hour, and those pictures
 * do not change once taken — so they are fetched once and kept, and each poll
 * downloads only the step that is genuinely new.
 */
const cloudSteps = new Map<number, WeatherFrame['tiles']>()

/** What is on screen right now, for a window that has just connected. */
export function weatherFrames(): WeatherFrame[] {
  return [...latest.values()].flat()
}

function loadCache(): void {
  for (const path of dataPathCandidates(CACHE_NAME)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Persisted
      if (data.version !== CACHE_VERSION || !Array.isArray(data.frames)) continue
      for (const f of data.frames) {
        if (!f?.layer || !f.tiles?.length) continue
        const series = latest.get(f.layer) ?? []
        series.push(f)
        latest.set(f.layer, series)
      }
      for (const series of latest.values()) series.sort((a, b) => (a.step ?? 0) - (b.step ?? 0))
      const age = Math.round((Date.now() - data.saved) / 60_000)
      opsLog(
        `[weather] ${weatherFrames().length} frames from cache (${age}분 전) — ` +
          `showing those until a poll lands`
      )
      return
    } catch {
      /* no cache, or a corrupt one: neither is a reason not to start */
    }
  }
}

/** What was last written, so an unchanged cache is not written again. */
let savedAt = 0

/**
 * Write the cache without stopping the world.
 *
 * This used to be writeFileSync, and the frames it writes are five
 * base64-encoded satellite images — well over ten megabytes. Leaving weather
 * mode calls it, so every tap of another tab blocked the hub long enough that
 * the mode change did not reach the windows until the NEXT tap: from the
 * control screen it looked as though you could not get out of the weather tab
 * at all.
 */
function saveCache(): void {
  if (!latest.size) return
  let newest = 0
  for (const frames of latest.values()) newest = Math.max(newest, seriesTime(frames))
  if (newest === savedAt) return // nothing new since the last write
  savedAt = newest
  const data: Persisted = { version: CACHE_VERSION, saved: Date.now(), frames: weatherFrames() }
  void writeFile(CACHE_PATH, JSON.stringify(data)).catch((err: Error) => {
    opsLog(`[weather] could not write ${CACHE_NAME}: ${err.message}`)
  })
}

/** The tile path for one layer's newest frame, or null if the index has none. */
function newestPath(index: Index, layer: WeatherLayer): { time: number; path: string } | null {
  const list = layer === 'cloud' ? index.satellite?.infrared : index.radar?.past
  if (!list || !list.length) return null
  return list[list.length - 1]
}

/**
 * The colour and option segments of the tile path.
 *
 * They are not the same for the two products: infrared has one colour ramp
 * (0) and no snow layer to separate, while radar takes a scheme number and a
 * smooth/snow pair. Asking for radar's options on a satellite tile is the kind
 * of thing that answers 404 for every tile in the grid.
 */
const TILE_STYLE: Record<WeatherLayer, string> = {
  cloud: '0/0_0',
  rain: `${WEATHER_RAIN_COLOR}/1_1`
}

/** Why the last tile that failed, failed — so the log can say more than "no". */
let lastTileError = ''

async function fetchTile(
  host: string,
  layer: WeatherLayer,
  path: string,
  x: number,
  y: number
): Promise<{ x: number; y: number; url: string } | null> {
  const url = `${host}${path}/${WEATHER_TILE_PX}/${WEATHER_ZOOM}/${x}/${y}/${TILE_STYLE[layer]}.png`
  try {
    const res = await fetchWithTimeout(url, WEATHER_TIMEOUT_MS)
    if (!res.ok) {
      lastTileError = `HTTP ${res.status} — ${url}`
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) {
      lastTileError = `empty 200 body — ${url}`
      return null
    }
    return { x, y, url: `data:image/png;base64,${buf.toString('base64')}` }
  } catch (err) {
    lastTileError = `${(err as Error).message} — ${url}`
    return null // one missing tile is a hole in the picture, not a failure
  }
}

/** Fetch every tile of one frame, a few at a time so a 64-tile grid doesn't
 * open 64 sockets at once. */
async function fetchFrame(
  host: string,
  layer: WeatherLayer,
  time: number,
  path: string
): Promise<WeatherFrame | null> {
  const n = 1 << WEATHER_ZOOM
  const wanted: { x: number; y: number }[] = []
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) wanted.push({ x, y })

  const tiles: WeatherFrame['tiles'] = []
  const BATCH = 8
  for (let i = 0; i < wanted.length; i += BATCH) {
    if (stopped) return null
    const got = await Promise.all(
      wanted.slice(i, i + BATCH).map((t) => fetchTile(host, layer, path, t.x, t.y))
    )
    for (const t of got) if (t) tiles.push(t)
  }
  if (!tiles.length) return null
  return { layer, projection: 'mercator', z: WEATHER_ZOOM, time: time * 1000, tiles }
}

// ---------------------------------------------------------------------------
// OpenWeatherMap - cloud and rain from one model at one instant.
// ---------------------------------------------------------------------------

/**
 * The key, read when it is needed rather than when this file was loaded.
 *
 * The config module's constants are frozen at import time, and an entry point
 * that loads .env after its imports would freeze this one empty - which has
 * happened here before, and it fails silently. server/boot-env.ts fixes the
 * ordering; this makes the value impossible to freeze wrong even if a bundler
 * ever reorders the two.
 */
function owmKey(): string {
  return process.env.OPENWEATHER_KEY?.trim() || OPENWEATHER_KEY
}

/** Which OpenWeatherMap API answered this key, decided once per run. */
let owmApi: 1 | 2 | null = null

function owmTileUrl(layer: WeatherLayer, x: number, y: number, at: number | null): string {
  const [v1, v2] = OWM_LAYERS[layer]
  const key = encodeURIComponent(owmKey())
  if (owmApi === 2) {
    const date = at ? `&date=${Math.floor(at / 1000)}` : ''
    return `${OWM_TILE_BASE_V2}/${v2}/${WEATHER_ZOOM}/${x}/${y}?appid=${key}${date}`
  }
  return `${OWM_TILE_BASE}/${v1}/${WEATHER_ZOOM}/${x}/${y}.png?appid=${key}`
}

async function fetchOwmTile(
  layer: WeatherLayer,
  x: number,
  y: number,
  at: number | null
): Promise<{ x: number; y: number; url: string } | null> {
  try {
    // Never log the URL: it carries the key.
    const res = await fetchWithTimeout(owmTileUrl(layer, x, y, at), WEATHER_TIMEOUT_MS)
    if (!res.ok) {
      lastTileError = `HTTP ${res.status} on ${layer} ${WEATHER_ZOOM}/${x}/${y}`
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) {
      lastTileError = `empty 200 body on ${layer} ${WEATHER_ZOOM}/${x}/${y}`
      return null
    }
    return { x, y, url: `data:image/png;base64,${buf.toString('base64')}` }
  } catch (err) {
    lastTileError = `${(err as Error).message} on ${layer} ${WEATHER_ZOOM}/${x}/${y}`
    return null
  }
}

/**
 * One moment of one layer.
 *
 * These tiles arrive already painted rather than as packed values, so the
 * renderer takes them down the photo path: for the cloud the alpha IS the
 * cover, and for the rain the service's own palette is used as it stands. That
 * costs the intensity ramp its control over the colours and buys the thing this
 * source exists for — both layers drawn from one model at one instant.
 */
async function fetchOwmFrame(
  layer: WeatherLayer,
  at: number | null,
  step: number,
  steps: number
): Promise<WeatherFrame | null> {
  const n = 1 << WEATHER_ZOOM
  const wanted: { x: number; y: number }[] = []
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) wanted.push({ x, y })
  const tiles: WeatherFrame['tiles'] = []
  // Six at a time: the free plan allows sixty calls a minute and a full grid is
  // sixty-four, so a burst of the whole grid would trip the limit on its own.
  const BATCH = 6
  for (let i = 0; i < wanted.length; i += BATCH) {
    if (stopped) return null
    const got = await Promise.all(wanted.slice(i, i + BATCH).map((t) => fetchOwmTile(layer, t.x, t.y, at)))
    for (const t of got) if (t) tiles.push(t)
  }
  if (!tiles.length) return null
  return {
    layer,
    projection: 'mercator',
    blend: 'photo',
    source: '© OpenWeatherMap · 모델 실황',
    z: WEATHER_ZOOM,
    time: at ?? Date.now(),
    tiles,
    step,
    steps
  }
}

/**
 * One poll of OpenWeatherMap: both layers, same model, same instants.
 *
 * The instants are chosen once and used for BOTH layers, which is the whole
 * point of the source — there is no clock to follow because there is only one
 * clock. Hourly steps ending at the present, matching what the animation
 * already expects.
 */
async function pollOpenWeather(onFrame: (f: WeatherFrame) => boolean | void): Promise<boolean> {
  if (owmApi === null) {
    // Probe once. A free key may not be entitled to Maps 2.0, and the
    // difference decides whether the tab animates or shows a single moment.
    owmApi = 2
    const probe = await fetchOwmTile('cloud', 0, 0, Date.now())
    if (!probe) {
      owmApi = 1
      opsLog(
        `[weather] OpenWeatherMap: Maps 2.0 refused this key (${lastTileError}) - ` +
          `using Maps 1.0, which is current-only, so the tab shows one moment rather than a loop`
      )
    } else {
      opsLog('[weather] OpenWeatherMap: Maps 2.0 answered - animating')
    }
  }

  /*
   * One tile before a hundred and twenty-eight.
   *
   * A key that is not yet live refuses every tile, and asking the whole grid
   * twice to find that out is a hundred and twenty-eight pointless requests
   * against a rate limit, every poll. The probe is also why owmApi is reset
   * below: a key that starts working may well be entitled to Maps 2.0, and
   * without the reset it would stay pinned to the fallback for the rest of the
   * run.
   */
  if (!(await fetchOwmTile('cloud', 0, 0, null))) {
    owmApi = null
    opsLog(
      `[weather] OpenWeatherMap: ${lastTileError}. ` +
        (/401/.test(lastTileError)
          ? 'A new key is not live immediately - OpenWeatherMap takes anywhere from ten minutes ' +
            'to a couple of hours to activate one. Nothing to do but wait; this retries every poll. ' +
            'If it is still 401 tomorrow, check for a stray space or quote around the key in .env.'
          : 'Falling back to the previous source for this poll.')
    )
    return false
  }

  const steps = owmApi === 2 ? Math.max(1, WEATHER_FRAME_COUNT) : 1
  const HOUR = 3600_000
  const now = Math.floor(Date.now() / HOUR) * HOUR
  const times: (number | null)[] =
    owmApi === 2 ? Array.from({ length: steps }, (_, i) => now - (steps - 1 - i) * HOUR) : [null]

  let delivered = false
  for (const layer of LAYERS) {
    if (stopped) return delivered
    const series: WeatherFrame[] = []
    for (let i = 0; i < times.length; i++) {
      const f = await fetchOwmFrame(layer, times[i], i, times.length)
      if (f) series.push(f)
    }
    if (!series.length) {
      opsLog(`[weather] OpenWeatherMap ${layer}: every tile failed. Last: ${lastTileError || 'none'}`)
      continue
    }
    delivered = true
    series.forEach((f, i) => {
      f.step = i
      f.steps = series.length
    })
    if (seriesTime(latest.get(layer) ?? []) === seriesTime(series)) continue
    latest.set(layer, series)
    for (const f of series) onFrame(f)
    opsLog(
      `[weather] OpenWeatherMap ${layer}: ${series.length} step(s), ` +
        `${series[0].tiles.length}/${1 << (WEATHER_ZOOM * 2)} tiles each`
    )
  }
  saveCache()
  return delivered
}

/**
 * The cloud picture, from NASA GIBS.
 *
 * One request per layer, plate carrée, full globe — no tile grid and no
 * reprojection, because this is already the projection the frame is drawn in.
 * The geostationary layers are discs, so several are requested and stacked at
 * the same position; the renderer's mosaic canvas composites them in order,
 * which is how three sensors become one globe.
 *
 * Which layers actually exist is the one thing that cannot be checked from
 * here, so each candidate is tried in turn and the log names the winner.
 */

/** Every layer name GIBS advertises, fetched once per run and only if needed. */
let gibsCatalogue: string[] | null = null

/** Punctuation-insensitive words, minus the ones every IR layer shares. */
const GENERIC = new Set([
  'band13', 'band', '13', 'clean', 'infrared', 'ir', 'abi', 'ahi', 'seviri',
  'geocolor', 'msg', 'v1', 'best'
])
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !GENERIC.has(t))
}

/**
 * Ask GIBS what it actually publishes.
 *
 * Two of the five sensors were configured with names that do not exist — every
 * candidate for both Meteosat slots came back as a service exception, so there
 * was no cloud at all over Africa or the Indian Ocean. Guessing the spelling
 * has now failed twice, which is the point at which a program should stop
 * guessing and read the catalogue. GetCapabilities is large, so this runs at
 * most once per run and only after a slot has actually failed.
 */
async function gibsLayerNames(): Promise<string[]> {
  if (gibsCatalogue) return gibsCatalogue
  gibsCatalogue = []
  try {
    const url = `${WEATHER_GIBS_URL}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`
    const res = await fetchWithTimeout(url, Math.max(WEATHER_TIMEOUT_MS, 30_000))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()
    gibsCatalogue = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1])
    opsLog(
      `[weather] cloud: read the GIBS catalogue — ${gibsCatalogue.length} layers, ` +
        `${(xml.length / 1e6).toFixed(1)}MB`
    )
  } catch (err) {
    opsLog(`[weather] cloud: could not read the GIBS catalogue: ${(err as Error).message}`)
  }
  return gibsCatalogue
}

/**
 * A real layer name for a slot whose configured names all failed.
 *
 * A candidate's distinctive words — "meteosat" and "11", or "iodc" — have to
 * ALL appear in the real name, and the real name has to be an infrared one.
 * That matches the same sensor spelled differently without ever matching its
 * neighbour: Meteosat-9 does not contain "11".
 */
async function findGibsLayer(candidates: string[]): Promise<string | null> {
  const all = await gibsLayerNames()
  if (!all.length) return null
  const infrared = all.filter((n) => /band ?_?13|infrared/i.test(n))
  for (const cand of candidates) {
    const need = tokens(cand)
    if (!need.length) continue
    const hit = infrared.find((n) => {
      const have = new Set(n.toLowerCase().split(/[^a-z0-9]+/))
      return need.every((t) => have.has(t))
    })
    if (hit) return hit
  }
  return null
}

/**
 * One seamless global infrared image, if GIBS publishes one.
 *
 * Five geostationary discs was always the second-best answer: two of them turn
 * out not to exist in the catalogue at all — hence no cloud over Africa or the
 * Indian Ocean — and the three that do have to be feathered into each other,
 * which is a class of edge artefact rather than a fixed one. A merged IR
 * product is the same measurement already mosaicked by the people who own the
 * sensors: one request, no seams, nothing missing between GOES and Himawari.
 *
 * It covers 60S to 60N. Neither do the discs reach the poles, and on an
 * equirectangular dome frame those rows are the extreme top and bottom edge.
 */
async function fetchGibsGlobalCloud(
  get: (
    layer: string,
    bbox: [number, number, number, number],
    w: number,
    h: number
  ) => Promise<{ url: string; bytes: number } | null>
): Promise<WeatherFrame | null> {
  const wanted = WEATHER_GIBS_GLOBAL.split(',').map((s) => s.trim()).filter(Boolean)
  if (!wanted.length || wanted[0] === 'off') return null
  const W = WEATHER_GIBS_GLOBAL_WIDTH
  const H = Math.round(W / 3) // 360 degrees by 120
  const frame = (url: string): WeatherFrame => ({
    layer: 'cloud',
    projection: 'equirect',
    blend: 'cloud',
    z: 0,
    time: Date.now(),
    // No centerLon: this is not a disc, so there is no horizon to fade to.
    tiles: [{ x: 0, y: 0, url, bbox: [-180, -60, 180, 60] }]
  })

  // The configured name first, and ALONE if it works. Reading the catalogue is
  // two and a half megabytes of XML, and doing it up front made every cold
  // start pay for it before the first cloud picture even when the name was
  // right — the catalogue is for when we are lost, not for when we are not.
  for (const name of wanted) {
    if (stopped) return null
    const got = await get(name, [-180, -60, 180, 60], W, H)
    if (!got) continue
    opsLog(`[weather] cloud: one global picture from "${name}" — no discs, no seams`)
    return frame(got.url)
  }

  // Configured names exhausted: now it is worth asking what this endpoint
  // calls a merged infrared product.
  const names: string[] = []
  for (const n of await gibsLayerNames()) {
    if (/merg/i.test(n) && /ir|infrared/i.test(n) && !wanted.includes(n)) names.push(n)
  }
  for (const name of names) {
    if (stopped) return null
    const got = await get(name, [-180, -60, 180, 60], W, H)
    if (!got) continue
    opsLog(
      `[weather] cloud: one global picture from "${name}" — no discs, no seams. ` +
        `Put WEATHER_GIBS_GLOBAL="${name}" in .env to skip the catalogue next time`
    )
    return frame(got.url)
  }
  names.unshift(...wanted)
  // What the catalogue DOES have that is anything like a global infrared
  // product. Two rounds have now been spent asking for names that turned out
  // not to exist; this line ends that by printing the real ones.
  const all = await gibsLayerNames()
  const nearby = all
    .filter((n) => /merg|globa|infrared|band ?_?13|brightness ?_?temp/i.test(n))
    .slice(0, 25)
  opsLog(
    `[weather] cloud: no global IR layer (tried ${names.slice(0, 4).join(', ')}` +
      `${names.length > 4 ? ` and ${names.length - 4} more` : ''}) — falling back to the discs`
  )
  opsLog(
    `[weather] cloud: the catalogue's IR-ish layers (${nearby.length} of ${all.length} shown): ` +
      (nearby.join(', ') || 'none matched') +
      ` — set WEATHER_GIBS_GLOBAL in .env to whichever is the global one`
  )
  return null
}

/**
 * @param timeline The instants the rain series settled on, oldest first. When
 *   present the cloud is asked for exactly those moments instead of inventing
 *   its own, which is what makes the two layers one animation rather than two
 *   that happen to be on screen together.
 */
async function fetchGibsCloud(timeline?: number[] | null): Promise<WeatherFrame[] | null> {
  /*
   * Each disc is requested over ITS OWN patch of the globe, not the whole one.
   *
   * A geostationary sensor sees about eighty degrees in every direction from
   * the point it hangs over. Asking for that disc on a full -180..180 canvas
   * spends nearly two thirds of the pixels on empty space, and the disc itself
   * lands on the remaining third — so a 1024-wide request bought about 2.8
   * pixels per degree and the cloud looked like a smudge. The same 1024 pixels
   * across 160 degrees is 6.4 per degree: two and a quarter times sharper for
   * the same bytes on the wire.
   */
  const HALF = 80
  const W = WEATHER_GIBS_WIDTH
  const H = W // the patch is square in degrees, so square in pixels
  const get = async (
    layer: string,
    bbox: [number, number, number, number],
    w: number,
    h: number,
    endpoint = WEATHER_GIBS_URL,
    time?: string
  ): Promise<{ url: string; bytes: number } | null> => {
    // WMS 1.3.0 with CRS:84-style axis order for EPSG:4326 is lat,lon.
    const [west, south, east, north] = bbox
    const url =
      `${endpoint}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
      `&LAYERS=${encodeURIComponent(layer)}&CRS=EPSG:4326` +
      `&BBOX=${south},${west},${north},${east}` +
      `&WIDTH=${w}&HEIGHT=${h}&FORMAT=image%2Fpng&TRANSPARENT=TRUE` +
      (time ? `&TIME=${encodeURIComponent(time)}` : '')
    try {
      const res = await fetchWithTimeout(url, WEATHER_TIMEOUT_MS)
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.includes('image')) {
        // GIBS answers a service exception as XML with a 200, so the content
        // type is what tells a picture from a complaint.
        lastTileError = `${res.status} ${type || 'no content-type'} — ${layer}`
        return null
      }
      const buf = Buffer.from(await res.arrayBuffer())
      opsLog(`[weather] cloud: ${layer} answered, ${(buf.length / 1e6).toFixed(1)}MB`)
      // Debug: keep the raw sensor pictures beside the exe. There is a hairline
      // down the finished map that has survived two rounds of reasoning and
      // does not appear against synthetic imagery, so the next step is to look
      // at the actual pixels rather than to guess again. Off unless asked for.
      if (process.env.WEATHER_DEBUG_DUMP) {
        const file = dataPath(`weather-disc-${layer.replace(/[^A-Za-z0-9]+/g, '_')}.png`)
        void writeFile(file, buf)
          .then(() => opsLog(`[weather] debug: wrote ${file}`))
          .catch((e: Error) => opsLog(`[weather] debug: could not write ${file}: ${e.message}`))
      }
      return { url: `data:image/png;base64,${buf.toString('base64')}`, bytes: buf.length }
    } catch (err) {
      lastTileError = `${(err as Error).message} — ${layer}`
      return null
    }
  }

  const global = await fetchGibsGlobalCloud(get)
  if (global) return [global]

  const got: WeatherFrame['tiles'] = []

  /*
   * A WMS cannot serve a box that crosses the antimeridian, and three of these
   * five ask for one.
   *
   * Himawari sits at 140.7E, so its eighty degrees reach 220.7 — past 180. The
   * server does not wrap; it fills everything beyond with nothing and returns
   * an image with a DEAD STRAIGHT VERTICAL EDGE at 180. Pasting that put a
   * hard line down the map that no amount of feathering could hide, because
   * the feather fades by distance from the satellite and this edge is not at a
   * constant distance from anything. It is exactly the hairline that moved
   * with the map and only appeared with cloud on, and it is visible in the raw
   * sensor pictures the debug dump wrote out.
   *
   * So a crossing slot becomes two requests, one either side of the
   * antimeridian, each with its own box and a width in proportion to its span
   * so both come back at the same pixels per degree.
   */
  const spansFor = (lon: number): [number, number][] => {
    const west = lon - HALF
    const east = lon + HALF
    if (west < -180) return [[west + 360, 180], [-180, east]]
    if (east > 180) return [[west, 180], [-180, east - 360]]
    return [[west, east]]
  }
  /** Compressed bytes per pixel of each sensor's live picture this poll — the
   * yardstick a past step of the same sensor is measured against. */
  const liveDensity = new Map<number, number>()
  const fetchSlot = async (
    name: string,
    lon: number,
    endpoint?: string,
    time?: string,
    into: WeatherFrame['tiles'] = got
  ): Promise<boolean> => {
    const spans = spansFor(lon)
    const parts: WeatherFrame['tiles'] = []
    let bytes = 0
    let pixels = 0
    for (const [west, east] of spans) {
      const deg = east - west
      // Same pixels per degree in every part, so the renderer can read the
      // mosaic's scale off whichever one decodes first.
      const w = Math.max(16, Math.round((W * deg) / (HALF * 2)))
      const got = await get(name, [west, -HALF, east, HALF], w, H, endpoint, time)
      if (!got) return false
      /*
       * A blank half is not a failure — it is the truth.
       *
       * These layers are published clipped at the antimeridian, so the half of
       * Himawari that lies past 180 does not exist and comes back as a valid,
       * entirely transparent PNG. Splitting the request did not conjure the
       * data; it just fetched the emptiness in its own file. Dropping the
       * empty half keeps the sensor and lets the renderer taper the edge
       * instead of pasting a rectangle of nothing over its neighbour.
       *
       * Blank compresses to about a kilobyte whatever its size, and real
       * imagery to a hundred times that, so the floor scales with the pixels.
       */
      const floor = Math.max(800, Math.round((w * H) / 200))
      if (got.bytes < floor) {
        opsLog(
          `[weather] cloud: ${name} has nothing for ${west.toFixed(0)}..${east.toFixed(0)}° ` +
            `(${got.bytes} bytes) — that piece is dropped`
        )
        continue
      }
      parts.push({ x: 0, y: 0, url: got.url, centerLon: lon, bbox: [west, -HALF, east, HALF] })
      bytes += got.bytes
      pixels += w * H
    }
    if (!parts.length) {
      lastTileError = `every piece blank — ${name}`
      return false
    }
    /*
     * A past step has to look like the same sensor, not merely be non-empty.
     *
     * The blank floor only catches an empty picture. What it lets through is a
     * scan that is half finished, or an archive answering a timestamp it does
     * not really hold with a flat wash — and that lands on the globe as a
     * rectangle of the patch's own bounding box with a hard straight edge,
     * which is the one shape weather never has. Compressed size per pixel is a
     * cheap stand-in for "how much detail is in here": cloud fields sit in a
     * narrow band, and a wash or a part-scan falls far outside it.
     *
     * Only past steps are judged, and only against the live picture from the
     * same sensor this same poll — so the comparison is like for like, and the
     * live picture itself is never rejected on a guess.
     */
    const density = bytes / Math.max(1, pixels)
    if (!time) {
      liveDensity.set(lon, density)
    } else {
      const live = liveDensity.get(lon)
      if (live && (density < live * 0.25 || density > live * 4)) {
        opsLog(
          `[weather] cloud: ${name} at ${time} is ${(density / live).toFixed(2)}× the detail of ` +
            `its live picture — that does not look like ${lon}°'s imagery, so the step is refused`
        )
        lastTileError = `implausible step — ${name} at ${time}`
        return false
      }
    }
    into.push(...parts)
    return true
  }

  for (const slot of WEATHER_GIBS_SLOTS) {
    if (stopped) return null
    let filled = false
    for (const name of slot.names) {
      if (!(await fetchSlot(name, slot.lon, slot.url))) continue
      filled = true
      break // one picture per slot; the rest of its names are spares
    }
    // Configured names exhausted — ask the catalogue what this sensor is really
    // called rather than leaving a hole in the globe. Only for slots on the
    // default endpoint: the catalogue we can read is that one's.
    if (!filled && !stopped && !slot.url) {
      const found = await findGibsLayer(slot.names)
      if (found) {
        opsLog(`[weather] cloud: ${slot.lon}° is published as "${found}" — using that`)
        if (await fetchSlot(found, slot.lon)) {
          filled = true
          // Say it once, plainly, so the name can be pinned in .env and the
          // catalogue never has to be read again.
          opsLog(
            `[weather] cloud: put WEATHER_GIBS_SLOTS in .env with "${slot.lon}:${found}" ` +
              `to skip the catalogue lookup next time`
          )
        }
      }
    }
    if (!filled) {
      opsLog(`[weather] cloud: nothing at ${slot.lon}° — tried ${slot.names.join(', ')}. Last: ${lastTileError}`)
    }
  }
  if (!got.length) return null
  // Count sensors, not images: a slot that crosses the antimeridian is two.
  const sensors = new Set(got.map((t) => t.centerLon)).size
  opsLog(
    `[weather] cloud: ${sensors}/${WEATHER_GIBS_SLOTS.length} sensors — ` +
      `composited from ${got.length} images`
  )
  const nowFrame: WeatherFrame = {
    layer: 'cloud',
    projection: 'equirect',
    blend: 'cloud',
    z: 0,
    time: Date.now(),
    tiles: got
  }

  /*
   * The earlier steps, so the cloud moves too.
   *
   * GIBS takes a TIME, so the same five sensors can be asked what they saw a
   * quarter-hour and a half-hour ago — a loop of real observations rather than
   * an interpolation.
   *
   * Each step is kept BY ITS TIMESTAMP and reused. Without that, every poll
   * re-downloaded the same four pictures under new names: the step that was
   * "fifteen minutes ago" last time is "thirty minutes ago" this time and is
   * the identical image, so re-fetching it was pulling tens of megabytes from
   * NASA every five minutes to show something already in memory. Now only the
   * genuinely new step is fetched, which is what makes a longer loop
   * affordable — and a longer loop is the whole point, because over twenty
   * minutes the clouds barely move and all anybody sees is the jump back to
   * the start.
   */
  const steps = Math.max(1, WEATHER_CLOUD_STEPS)
  const shared = timeline && timeline.length > 1 ? timeline : null
  if ((steps < 2 && !shared) || stopped) return [nowFrame]
  const nowSensors = new Set(got.map((t) => t.centerLon))
  const wantedAt: number[] = []
  if (shared) {
    /*
     * The rain's own instants, to the sensors' ten-minute cadence.
     *
     * Every one of them is in the past — the rain window was moved to end at
     * the present precisely so that this request is answerable. The live
     * picture is dropped in this case: it was taken minutes ago and the rain's
     * newest step can be up to an hour old, and showing them side by side is
     * the exact mismatch this is here to remove. Being an hour behind together
     * beats being right now and wrong about each other.
     */
    for (const t of shared) wantedAt.push(Math.floor(t / 600_000) * 600_000)
    opsLog(
      `[weather] cloud: following the rain's clock — ${wantedAt.length} steps, ` +
        `${Math.round((Date.now() - wantedAt[0]) / 60_000)}min ago to ` +
        `${Math.round((Date.now() - wantedAt[wantedAt.length - 1]) / 60_000)}min ago`
    )
  } else {
    for (let back = steps - 1; back >= 1; back--) {
      // Snap to the sensors' own ten-minute cadence, or the server has to pick
      // for us and may pick the same picture twice.
      wantedAt.push(Math.floor((Date.now() - back * WEATHER_CLOUD_STEP_MS) / 600_000) * 600_000)
    }
  }

  const series: WeatherFrame[] = []
  let reused = 0
  for (const at of wantedAt) {
    if (stopped) break
    const have = cloudSteps.get(at)
    if (have) {
      series.push({ ...nowFrame, time: at, tiles: have })
      reused++
      continue
    }
    const stamp = new Date(at).toISOString().replace(/\.\d+Z$/, 'Z')
    const tiles: WeatherFrame['tiles'] = []
    for (const slot of WEATHER_GIBS_SLOTS) {
      // Only the sensors the present frame actually has. Chasing one that is
      // already missing wastes a request, and a step that covered MORE of the
      // globe than its neighbours would make that region blink in the loop.
      if (!nowSensors.has(slot.lon)) continue
      for (const name of slot.names) {
        if (await fetchSlot(name, slot.lon, slot.url, stamp, tiles)) break
      }
    }
    // Same sensors as now, or the loop flickers wherever they disagree.
    if (new Set(tiles.map((t) => t.centerLon)).size === nowSensors.size && tiles.length) {
      cloudSteps.set(at, tiles)
      series.push({ ...nowFrame, time: at, tiles })
    } else if (shared) {
      /*
       * Hold the previous picture rather than dropping the step.
       *
       * Both layers are played back off the wall clock, so a loop of three
       * cloud steps against four rain steps runs at a different rate and the
       * two slide out of phase within a minute — which is the thing this whole
       * change exists to stop. A repeated frame costs one held beat; a missing
       * frame costs the synchronisation.
       */
      // Nothing earlier to hold on the very first step, so the live picture
      // stands in for it — stale by a step, but the count is what matters.
      series.push({ ...(series[series.length - 1] ?? nowFrame), time: at })
      opsLog(`[weather] cloud: nothing for ${stamp} — holding the previous step to stay in sync`)
    } else {
      opsLog(`[weather] cloud: no complete picture for ${stamp} — that step is skipped`)
    }
  }
  // Anything no longer in the loop is memory nobody is looking at.
  for (const at of [...cloudSteps.keys()]) {
    if (!wantedAt.includes(at)) cloudSteps.delete(at)
  }
  // On the shared clock the live picture is not one of the rain's moments, so
  // it is not part of the loop. It is still the safety net if every step failed.
  if (!shared || !series.length) series.push(nowFrame)
  series.forEach((f, i) => {
    f.step = i
    f.steps = series.length
  })
  if (series.length > 1) {
    const span = Math.round((series[series.length - 1].time - series[0].time) / 60_000)
    opsLog(
      `[weather] cloud: ${series.length} steps over ${span}min - animating ` +
        `(${reused} reused, ${series.length - 1 - reused} fetched)`
    )
  }
  return series
}

async function poll(onFrame: (f: WeatherFrame) => void): Promise<void> {
  /*
   * Fall THROUGH when it fails, do not fall over.
   *
   * Setting the key made OpenWeatherMap the only source tried, so the first
   * poll after adding a key that was not live yet emptied the tab completely.
   * A new source is a preference, never a commitment: if it delivers nothing,
   * the one that was working before still runs on the same poll.
   */
  if (owmKey() && (await pollOpenWeather(onFrame))) return
  const res = await fetchWithTimeout(WEATHER_INDEX_URL, WEATHER_TIMEOUT_MS)
  if (!res.ok) throw new Error(`index HTTP ${res.status}`)
  const index = (await res.json()) as Index
  if (!index?.host) throw new Error('index has no host — the API shape has changed')
  // What the index actually offered, verbatim. If clouds never appear, this one
  // line says whether the product is missing from the feed entirely (which is
  // an account/tier question) or present but unfetchable (which is ours).
  opsLog(
    `[weather] index ok: host=${index.host} ` +
      `satellite.infrared=${index.satellite?.infrared?.length ?? 'MISSING'} ` +
      `radar.past=${index.radar?.past?.length ?? 'MISSING'} ` +
      `(top-level keys: ${Object.keys(index).join(',')})`
  )

  for (const layer of LAYERS) {
    if (stopped) return
    if (layer === 'cloud' && WEATHER_CLOUD_SOURCE !== 'rainviewer') {
      if (WEATHER_CLOUD_SOURCE === 'off') continue
      const frames = await fetchGibsCloud()
      if (frames) {
        latest.set('cloud', frames)
        for (const f of frames) onFrame(f)
      }
      continue
    }
    const newest = newestPath(index, layer)
    if (!newest) {
      opsLog(
        `[weather] ${layer}: the index carries no frames for this product — ` +
          `it is not something this feed is offering, so no request was made`
      )
      continue
    }
    // Already showing this exact picture: don't re-download it.
    if (seriesTime(latest.get(layer) ?? []) === newest.time * 1000) continue
    const frame = await fetchFrame(index.host, layer, newest.time, newest.path)
    if (!frame) {
      opsLog(
        `[weather] ${layer}: every tile failed — keeping the previous frame. ` +
          `Last error: ${lastTileError || 'none recorded'}`
      )
      continue
    }
    latest.set(layer, [frame])
    onFrame(frame)
    const bytes = frame.tiles.reduce((n, t) => n + t.url.length, 0)
    const age = Math.round((Date.now() - frame.time) / 60_000)
    opsLog(
      `[weather] ${layer}: ${frame.tiles.length}/${1 << (WEATHER_ZOOM * 2)} tiles, ` +
        `${(bytes / 1e6).toFixed(1)}MB, taken ${age}분 전`
    )
  }
  saveCache()
}

/**
 * Start looking for weather. Safe to call while already running (the mode tabs
 * are buttons a visitor can press repeatedly); the live loop simply carries on.
 */
export function startWeather(onFrame: (f: WeatherFrame) => void): void {
  stopped = false
  if (running) return
  running = true
  if (!latest.size) loadCache()
  // Whatever we already have goes out, so switching to the tab never shows an
  // empty earth while a poll is in flight — but NOT on this tick. Each frame is
  // several base64'd satellite images, and stringifying them is the hub's only
  // thread; doing it inline made the mode change itself arrive late.
  const replay = weatherFrames()
  setImmediate(() => {
    for (const f of replay) if (!stopped) onFrame(f)
  })
  // Say which source is live, every time. "Is the key actually on?" is not a
  // question anybody should have to answer by looking at the picture.
  opsLog(
    owmKey()
      ? `[weather] source: OpenWeatherMap - key ...${owmKey().slice(-4)}, cloud and rain from ` +
        `ONE model at ONE instant (${OWM_LAYERS.cloud[0]} + ${OWM_LAYERS.rain[0]})`
      : '[weather] source: NASA GIBS + RainViewer (FALLBACK). No OPENWEATHER_KEY reached the hub - ' +
        'put OPENWEATHER_KEY="..." in the .env beside the exe. Until then the cloud is a satellite ' +
        'photograph and the rain only exists where a country has ground radar.'
  )

  const loop = async (): Promise<void> => {
    if (stopped) {
      running = false
      return
    }
    try {
      await poll(onFrame)
      failures = 0
    } catch (err) {
      failures++
      // Loudly, and never swallowed: the exe has no console, and this project
      // has already lost weeks to an external endpoint that quietly did nothing.
      opsLog(
        `[weather] poll failed (${failures}): ${(err as Error).message} — ` +
          `${latest.size ? 'the last frame stays on screen' : 'nothing to show yet'}`
      )
    }
    if (stopped) {
      running = false
      return
    }
    const wait = failures ? Math.min(WEATHER_POLL_MS, 30_000 * 2 ** (failures - 1)) : WEATHER_POLL_MS
    timer = setTimeout(() => void loop(), wait)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  void loop()
}

export function stopWeather(): void {
  stopped = true
  // Clearing the pending timer means the loop body is ASLEEP, not running, so
  // nobody is left to clear `running` — and while it stays set, start() sees a
  // live loop and returns, so the layer never updates again. A tab away and
  // back was enough to kill it silently. When the body IS mid-flight `timer` is
  // null and it clears the flag itself on the next check.
  if (timer) {
    clearTimeout(timer)
    timer = null
    running = false
  }
  saveCache()
}
