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
import type { WeatherDecode, WeatherFrame, WeatherLayer } from '../src/shared/types'
import {
  MAPTILER_KEY,
  MAPTILER_TILE_BASE,
  MAPTILER_VARIABLES,
  MAPTILER_WEATHER_INDEX,
  WEATHER_FRAME_COUNT,
  WEATHER_MAX_SERIES_MB,
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
const CACHE_VERSION = 4

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
 * The key, read when it is needed rather than when this file was loaded.
 *
 * The config module's constants are frozen at import time, and an entry point
 * that loads .env after its imports would freeze this one empty — which is
 * exactly what happened, and it fails silently by falling back to the old
 * source. `server/boot-env.ts` fixes the ordering; this makes the value
 * impossible to freeze wrong even if a bundler ever reorders the two.
 */
function mtKey(): string {
  return process.env.MAPTILER_KEY?.trim() || MAPTILER_KEY
}
function mtIndexUrl(): string {
  return process.env.MAPTILER_WEATHER_INDEX || MAPTILER_WEATHER_INDEX
}
function mtTileBase(): string {
  return process.env.MAPTILER_TILE_BASE || MAPTILER_TILE_BASE
}

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

/** How old the newest frame is, in ms — what the dome caption counts. */
export function weatherAge(): number | null {
  let newest = 0
  for (const frames of latest.values()) newest = Math.max(newest, seriesTime(frames))
  return newest ? Date.now() - newest : null
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
// MapTiler Weather — the primary source when a key is configured.
// ---------------------------------------------------------------------------

/** `latest.json`. Only the fields we use are described; the shape is taken from
 * the published @maptiler/weather types. */
interface MtIndex {
  variables?: {
    tile_format?: string
    metadata?: {
      maxzoom?: number
      weather_variable?: {
        name?: string
        unit?: string
        attribution?: string
        variable_id?: string
        decoding?: { min?: number; max?: number; channels?: string }
      }
    }
    keyframes?: { id: string; timestamp: string }[]
  }[]
}

type MtVariable = NonNullable<MtIndex['variables']>[number]

/** One data tile. Same envelope as the imagery tiles — a data: URL, so the
 * packaged app's file:// origin never taints the canvas. */
async function fetchMtTile(
  tilesetId: string,
  format: string,
  x: number,
  y: number
): Promise<{ x: number; y: number; url: string } | null> {
  const url =
    `${mtTileBase()}/${encodeURIComponent(tilesetId)}/` +
    `${WEATHER_ZOOM}/${x}/${y}.${format}?key=${encodeURIComponent(mtKey())}`
  try {
    const res = await fetchWithTimeout(url, WEATHER_TIMEOUT_MS)
    if (!res.ok) {
      // Never log the URL: it carries the key.
      lastTileError = `HTTP ${res.status} on ${tilesetId} ${WEATHER_ZOOM}/${x}/${y}`
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length) {
      lastTileError = `empty 200 body on ${tilesetId} ${WEATHER_ZOOM}/${x}/${y}`
      return null
    }
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
    return { x, y, url: `data:${mime};base64,${buf.toString('base64')}` }
  } catch (err) {
    lastTileError = `${(err as Error).message} on ${tilesetId} ${WEATHER_ZOOM}/${x}/${y}`
    return null
  }
}

/** Every tile of one keyframe, a few sockets at a time. */
async function fetchMtKeyframe(
  layer: WeatherLayer,
  tilesetId: string,
  format: string,
  time: number,
  decode: WeatherDecode,
  step: number,
  steps: number
): Promise<WeatherFrame | null> {
  const n = 1 << WEATHER_ZOOM
  const wanted: { x: number; y: number }[] = []
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) wanted.push({ x, y })

  const tiles: WeatherFrame['tiles'] = []
  const BATCH = 8
  for (let i = 0; i < wanted.length; i += BATCH) {
    if (stopped) return null
    const got = await Promise.all(
      wanted.slice(i, i + BATCH).map((t) => fetchMtTile(tilesetId, format, t.x, t.y))
    )
    for (const t of got) if (t) tiles.push(t)
  }
  if (!tiles.length) return null
  return { layer, projection: 'mercator', blend: 'data', decode, z: WEATHER_ZOOM, time, tiles, step, steps }
}

/**
 * One layer's animation series from MapTiler.
 *
 * The index hands back a whole time series per variable; we take the newest
 * WEATHER_FRAME_COUNT keyframes, oldest first, so the renderer can walk them in
 * order. Every fact needed to read the pixels — the packing channels and the
 * value range — comes from the index rather than being hard-coded here, because
 * the one thing that cannot be checked from a sandbox is what the service
 * actually sends.
 */
async function fetchMaptilerLayer(
  index: MtIndex,
  layer: WeatherLayer
): Promise<WeatherFrame[] | null> {
  const wantIds = MAPTILER_VARIABLES[layer].split('|').map((s) => s.trim()).filter(Boolean)
  const offered = (index.variables ?? []).map((x) => x.metadata?.weather_variable?.variable_id)
  /*
   * OUR order of preference, not the index's.
   *
   * This was `variables.find(x => wantIds.includes(x.id))`, which walks the
   * INDEX and stops at the first entry that happens to be on our list — so with
   * the index ordering precipitation before radar, the second choice won. The
   * exhibit asked for reflectivity and got millimetres, and the ramp is
   * calibrated in dBZ, so almost nothing crossed the threshold.
   */
  let v: MtVariable | undefined
  for (const id of wantIds) {
    v = index.variables?.find((x) => x.metadata?.weather_variable?.variable_id === id)
    if (v) break
  }
  if (!v) {
    // Named alternatives, because which variables a key is entitled to is not
    // something that can be checked from here — the exhibit's own key turned
    // out to carry temperature, pressure, precipitation, wind and radar, and
    // no cloud of any kind.
    opsLog(
      `[weather] ${layer}: none of "${wantIds.join('", "')}" is in the index. ` +
        `It offered: ${offered.filter(Boolean).join(', ') || 'nothing'}`
    )
    return null
  }
  const wantId = v.metadata?.weather_variable?.variable_id ?? wantIds[0]
  const wv = v.metadata?.weather_variable
  const d = wv?.decoding
  if (!d || typeof d.min !== 'number' || typeof d.max !== 'number' || !d.channels) {
    opsLog(`[weather] ${layer}: "${wantId}" carries no decoding block — cannot read its pixels`)
    return null
  }
  const keys = v.keyframes ?? []
  if (!keys.length) {
    opsLog(`[weather] ${layer}: "${wantId}" has no keyframes`)
    return null
  }
  const decode: WeatherDecode = { min: d.min, max: d.max, channels: d.channels, unit: wv?.unit }
  const format = v.tile_format && v.tile_format !== 'pbf' ? v.tile_format : 'png'
  const wanted = keys.slice(Math.max(0, keys.length - WEATHER_FRAME_COUNT))

  /*
   * Newest keyframe first, and stop when the series has spent its byte budget.
   *
   * A two-channel variable packs its value across a high and a low byte, and
   * the low byte turns over every 1/65536th of the range — so it is noise even
   * where the weather is perfectly smooth, and PNG cannot compress noise. A
   * four-step radar series measured FIFTY-FOUR megabytes against a cloud
   * series' five. That is a number that gets broadcast to both windows and
   * written to the disk cache, so it needs a ceiling rather than a hope.
   *
   * Newest-first is what makes the ceiling safe to hit: whatever gets dropped
   * is the far end of the animation, never the picture of right now.
   */
  const budget = WEATHER_MAX_SERIES_MB * 1e6
  const newestFirst: WeatherFrame[] = []
  let bytes = 0
  for (let i = wanted.length - 1; i >= 0; i--) {
    if (stopped) return null
    if (newestFirst.length && bytes >= budget) break
    const k = wanted[i]
    const time = Date.parse(k.timestamp)
    const frame = await fetchMtKeyframe(
      layer,
      k.id,
      format,
      Number.isFinite(time) ? time : Date.now(),
      decode,
      0, // renumbered below, once we know how many survived
      0
    )
    if (!frame) continue
    newestFirst.push(frame)
    bytes += frame.tiles.reduce((m, t) => m + t.url.length, 0)
  }
  if (!newestFirst.length) {
    opsLog(`[weather] ${layer}: every tile failed. Last error: ${lastTileError || 'none recorded'}`)
    return null
  }
  const series = newestFirst.reverse()
  series.forEach((f, i) => {
    f.step = i
    f.steps = series.length
  })
  opsLog(
    `[weather] ${layer}: ${wv?.name ?? wantId} — ${series.length}/${wanted.length} keyframes, ` +
      `${series[0].tiles.length}/${1 << (WEATHER_ZOOM * 2)} tiles each, ${(bytes / 1e6).toFixed(1)}MB, ` +
      `${d.min}–${d.max} ${wv?.unit ?? ''} packed in "${d.channels}"`
  )
  if (series.length < wanted.length) {
    // Never silently: a shorter loop is a visible change and the reason for it
    // belongs in the log, not in somebody's guess.
    opsLog(
      `[weather] ${layer}: stopped at ${series.length} of ${wanted.length} keyframes — ` +
        `${(bytes / 1e6).toFixed(1)}MB reached the ${WEATHER_MAX_SERIES_MB}MB budget. ` +
        `The animation is shorter; the current picture is unaffected. ` +
        `Raise WEATHER_MAX_SERIES_MB or lower WEATHER_FRAME_COUNT to change that.`
    )
  }
  return series
}

/** One poll of MapTiler: index, then both layers' series. */
async function pollMaptiler(onFrame: (f: WeatherFrame) => void): Promise<void> {
  const url = `${mtIndexUrl()}?key=${encodeURIComponent(mtKey())}`
  const res = await fetchWithTimeout(url, WEATHER_TIMEOUT_MS)
  // The key is in the URL, so the message says the status and nothing else.
  if (!res.ok) throw new Error(`weather index HTTP ${res.status} (key rejected?)`)
  const index = (await res.json()) as MtIndex
  if (!Array.isArray(index?.variables)) throw new Error('index has no variables — the API shape has changed')

  for (const layer of LAYERS) {
    if (stopped) return
    let series = await fetchMaptilerLayer(index, layer)
    if (!series && layer === 'cloud' && WEATHER_CLOUD_SOURCE !== 'off') {
      // MapTiler has the rain but not the cloud on this key. Falling through to
      // GIBS beats the alternative, which is what happened the first time: the
      // layer quietly kept whatever the disk cache held, so the screen showed a
      // cloud picture from hours ago next to live rain and nothing said so.
      opsLog('[weather] cloud: falling back to NASA GIBS for this layer')
      const frame = await fetchGibsCloud()
      series = frame ? [frame] : null
    }
    if (!series) continue
    // Same moment as what is already on screen: nothing to send.
    if (seriesTime(latest.get(layer) ?? []) === seriesTime(series)) continue
    latest.set(layer, series)
    for (const f of series) onFrame(f)
  }
  saveCache()
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
  get: (layer: string, bbox: [number, number, number, number], w: number, h: number) => Promise<string | null>
): Promise<WeatherFrame | null> {
  const wanted = WEATHER_GIBS_GLOBAL.split(',').map((s) => s.trim()).filter(Boolean)
  if (!wanted.length || wanted[0] === 'off') return null
  const names = [...wanted]
  // Whatever the catalogue calls a merged/global IR product, in case the
  // configured spelling is not the one this endpoint uses.
  for (const n of await gibsLayerNames()) {
    if (/merg/i.test(n) && /ir|infrared/i.test(n) && !names.includes(n)) names.push(n)
  }
  const W = WEATHER_GIBS_GLOBAL_WIDTH
  const H = Math.round(W / 3) // 360 degrees by 120
  for (const name of names) {
    if (stopped) return null
    const url = await get(name, [-180, -60, 180, 60], W, H)
    if (!url) continue
    opsLog(`[weather] cloud: one global picture from "${name}" — no discs, no seams`)
    return {
      layer: 'cloud',
      projection: 'equirect',
      blend: 'cloud',
      z: 0,
      time: Date.now(),
      // No centerLon: this is not a disc, so there is no horizon to fade to.
      tiles: [{ x: 0, y: 0, url, bbox: [-180, -60, 180, 60] }]
    }
  }
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

async function fetchGibsCloud(): Promise<WeatherFrame | null> {
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
    h: number
  ): Promise<string | null> => {
    // WMS 1.3.0 with CRS:84-style axis order for EPSG:4326 is lat,lon.
    const [west, south, east, north] = bbox
    const url =
      `${WEATHER_GIBS_URL}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0` +
      `&LAYERS=${encodeURIComponent(layer)}&CRS=EPSG:4326` +
      `&BBOX=${south},${west},${north},${east}` +
      `&WIDTH=${w}&HEIGHT=${h}&FORMAT=image%2Fpng&TRANSPARENT=TRUE`
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

  const global = await fetchGibsGlobalCloud(get)
  if (global) return global

  const got: WeatherFrame['tiles'] = []
  const place = (url: string, lon: number): void => {
    got.push({ x: 0, y: 0, url, centerLon: lon, bbox: [lon - HALF, -HALF, lon + HALF, HALF] })
  }
  for (const slot of WEATHER_GIBS_SLOTS) {
    if (stopped) return null
    let filled = false
    for (const name of slot.names) {
      const url = await get(name, [slot.lon - HALF, -HALF, slot.lon + HALF, HALF], W, H)
      if (!url) continue
      place(url, slot.lon)
      filled = true
      break // one picture per slot; the rest of its names are spares
    }
    // Configured names exhausted — ask the catalogue what this sensor is really
    // called rather than leaving a hole in the globe.
    if (!filled && !stopped) {
      const found = await findGibsLayer(slot.names)
      if (found) {
        opsLog(`[weather] cloud: ${slot.lon}° is published as "${found}" — using that`)
        const url = await get(found, [slot.lon - HALF, -HALF, slot.lon + HALF, HALF], W, H)
        if (url) {
          place(url, slot.lon)
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
  if (mtKey()) return pollMaptiler(onFrame)
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
        latest.set('cloud', [frame])
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
  // Say which source is live, every time. "Is MapTiler actually on?" is not a
  // question anybody should have to answer by looking at the picture.
  opsLog(
    mtKey()
      ? `[weather] source: MapTiler — key ...${mtKey().slice(-4)}, ` +
        `${WEATHER_FRAME_COUNT} keyframes, cloud=${MAPTILER_VARIABLES.cloud} rain=${MAPTILER_VARIABLES.rain}`
      : '[weather] source: NASA GIBS + RainViewer (FALLBACK). No MAPTILER_KEY reached the hub — ' +
        'put MAPTILER_KEY="..." in the .env beside the exe. Rain will be missing over Africa and the oceans.'
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
