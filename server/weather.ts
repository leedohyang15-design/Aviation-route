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
  WEATHER_INDEX_URL,
  WEATHER_POLL_MS,
  WEATHER_TILE_PX,
  WEATHER_TIMEOUT_MS,
  WEATHER_ZOOM,
  WEATHER_CLOUD_SOURCE,
  WEATHER_GIBS_URL,
  WEATHER_GIBS_SLOTS,
  WEATHER_GIBS_WIDTH,
  WEATHER_RAIN_COLOR
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
const CACHE_VERSION = 2

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

/** The newest frame we have for each layer, whether from the network or the
 * cache. Kept so a later-connecting window, or a failed poll, still has a
 * picture to show. */
const latest = new Map<WeatherLayer, WeatherFrame>()

let timer: ReturnType<typeof setTimeout> | null = null
let stopped = true
/** True while a poll body is alive, including across its awaits — the guard has
 * to be owned by the loop, not by the start/stop pair, or a fast mode toggle
 * during a fetch leaves two loops running (the same bug the OpenSky and
 * satellite loops had). */
let running = false
/** Consecutive failures, for the backoff. */
let failures = 0

/** What is on screen right now, for a window that has just connected. */
export function weatherFrames(): WeatherFrame[] {
  return [...latest.values()]
}

/** How old the newest frame is, in ms — what the dome caption counts. */
export function weatherAge(): number | null {
  let newest = 0
  for (const f of latest.values()) newest = Math.max(newest, f.time)
  return newest ? Date.now() - newest : null
}

function loadCache(): void {
  for (const path of dataPathCandidates(CACHE_NAME)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Persisted
      if (data.version !== CACHE_VERSION || !Array.isArray(data.frames)) continue
      for (const f of data.frames) if (f?.layer && f.tiles?.length) latest.set(f.layer, f)
      const age = Math.round((Date.now() - data.saved) / 60_000)
      opsLog(`[weather] ${latest.size} frames from cache (${age}분 전) — showing those until a poll lands`)
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
  for (const f of latest.values()) newest = Math.max(newest, f.time)
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
async function fetchGibsCloud(): Promise<WeatherFrame | null> {
  const W = WEATHER_GIBS_WIDTH
  const H = Math.round(W / 2)
  const get = async (layer: string): Promise<string | null> => {
    const url =
      `${WEATHER_GIBS_URL}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
      `&LAYERS=${encodeURIComponent(layer)}&CRS=EPSG:4326&BBOX=-90,-180,90,180` +
      `&WIDTH=${W}&HEIGHT=${H}&FORMAT=image%2Fpng&TRANSPARENT=TRUE`
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
      // A fully transparent image is a valid PNG and a useless picture.
      if (buf.length < 20_000) {
        lastTileError = `only ${buf.length} bytes (blank?) — ${layer}`
        return null
      }
      opsLog(`[weather] cloud: ${layer} answered, ${(buf.length / 1e6).toFixed(1)}MB`)
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch (err) {
      lastTileError = `${(err as Error).message} — ${layer}`
      return null
    }
  }

  const got: WeatherFrame['tiles'] = []
  for (const slot of WEATHER_GIBS_SLOTS) {
    if (stopped) return null
    let filled = false
    for (const name of slot.names) {
      const url = await get(name)
      if (!url) continue
      got.push({ x: 0, y: 0, url, centerLon: slot.lon })
      filled = true
      break // one picture per slot; the rest of its names are spares
    }
    if (!filled) {
      opsLog(`[weather] cloud: nothing at ${slot.lon}° — tried ${slot.names.join(', ')}. Last: ${lastTileError}`)
    }
  }
  if (!got.length) return null
  opsLog(`[weather] cloud: ${got.length}/${WEATHER_GIBS_SLOTS.length} sensors — composited`)
  return {
    layer: 'cloud',
    projection: 'equirect',
    blend: 'cloud',
    z: 0,
    time: Date.now(),
    tiles: got
  }
}

async function poll(onFrame: (f: WeatherFrame) => void): Promise<void> {
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
      const frame = await fetchGibsCloud()
      if (frame) {
        latest.set('cloud', frame)
        onFrame(frame)
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
    if (latest.get(layer)?.time === newest.time * 1000) continue
    const frame = await fetchFrame(index.host, layer, newest.time, newest.path)
    if (!frame) {
      opsLog(
        `[weather] ${layer}: every tile failed — keeping the previous frame. ` +
          `Last error: ${lastTileError || 'none recorded'}`
      )
      continue
    }
    latest.set(layer, frame)
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
  const replay = [...latest.values()]
  setImmediate(() => {
    for (const f of replay) if (!stopped) onFrame(f)
  })

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
