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
  WEATHER_POLL_MS,
  WEATHER_TIMEOUT_MS,
  WEATHER_ZOOM,
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

/** Why the last tile that failed, failed - so the log can say more than "no". */
let lastTileError = ''

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
 * One poll.
 *
 * OpenWeatherMap and nothing else. There used to be a keyless fallback behind
 * this — NASA GIBS for the cloud, RainViewer for the rain — and it was removed
 * on purpose rather than left as insurance. It was not insurance: its cloud was
 * a geostationary infrared photograph and its rain only existed where a country
 * has ground radar, which is a different pairing of measurements from the one
 * this tab is built to show, with its own seams, its own clock and its own
 * failure modes. Half of the past week's faults came from that pairing rather
 * than from either source alone.
 *
 * So when the key is missing or not yet live, the tab shows nothing and says
 * so. That is a state somebody can fix in a minute; a plausible wrong picture
 * is not.
 */
async function poll(onFrame: (f: WeatherFrame) => void): Promise<void> {
  if (!owmKey()) throw new Error('no OPENWEATHER_KEY — put it in the .env beside the exe')
  if (!(await pollOpenWeather(onFrame))) throw new Error(lastTileError || 'every tile failed')
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
      : '[weather] source: NONE. No OPENWEATHER_KEY reached the hub - put OPENWEATHER_KEY="..." ' +
        'in the .env beside the exe. There is no fallback any more: the tab stays empty until ' +
        'the key answers, which is a state somebody can fix rather than a wrong picture nobody spots.'
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
