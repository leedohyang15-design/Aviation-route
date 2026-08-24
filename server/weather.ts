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
  MAPTILER_TILE_BASE,
  MAPTILER_VARIABLES,
  MAPTILER_WEATHER_INDEX,
  WEATHER_FRAME_COUNT,
  WEATHER_WIND_FRAMES,
  WEATHER_MAX_SERIES_MB,
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
} from '../src/shared/config'
import { fetchWithTimeout } from './http'
import { dataPath, dataPathCandidates } from './datadir'
import { settings } from './settings'
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
// packed. A cached MapTiler frame replayed under the new badge would credit the
// wrong service for the picture on screen.
// 6: the OpenWeatherMap era wrote frames under 5 with its own attribution on
// them, and a cached frame carries its badge with it — so the tab kept crediting
// a service that is no longer fetched. Bumping the version drops those.
const CACHE_VERSION = 6

interface Persisted {
  version: number
  saved: number
  frames: WeatherFrame[]
}

const LAYERS: WeatherLayer[] = ['cloud', 'rain', 'wind']

/**
 * Who to credit, on the frame itself.
 *
 * Both services are named because both are used: the rain and the wind are
 * MapTiler's numbers, the cloud is NASA's and EUMETSAT's photographs. It rides
 * on the frame rather than in the state so the badge can never credit a source
 * the picture on screen did not come from — which is exactly what happened when
 * cached frames outlived the service that made them.
 */
const ATTRIBUTION = '© MapTiler · NASA GIBS · EUMETSAT'

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
  // Through settings(), not process.env — see creds() in opensky.ts. The
  // environment still wins inside settings(), so a .env keeps working; a key
  // typed into the settings screen now works too, which it did not before.
  return settings().maptilerKey.trim()
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

/**
 * Is what we are holding recent enough to put on a wall?
 *
 * The one rule, in one place. The hub decides what to SHOW with it and the poll
 * below decides what to WAIT for with it, and those two must not be able to
 * disagree — a picture the hub refuses to display is also a picture the poll
 * must not treat as "already on screen", or the tab stays blank while the poll
 * politely holds a fresh layer back on behalf of a stale one nobody can see.
 */
export function haveFreshFrames(): boolean {
  const frames = weatherFrames()
  return frames.length > 0 && Date.now() - seriesTime(frames) <= settings().weatherMaxAgeMs
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

/** Why the last tile that failed, failed — so the log can say more than "no". */
let lastTileError = ''



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
  return {
    layer,
    projection: 'mercator',
    blend: 'data',
    source: ATTRIBUTION,
    feed: 'maptiler',
    decode,
    z: WEATHER_ZOOM,
    time,
    tiles,
    step,
    steps
  }
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

  /*
   * Start at NOW, not at the end of the list.
   *
   * These keyframes are a model run: they reach days into the future, and
   * `slice(-N)` was taking the last four — the furthest forecast steps there
   * are. The exhibit was showing next week's rain and calling it real time,
   * which is why it looked nothing like what everyone else was showing for
   * today. The step nearest the present goes first and the animation runs
   * forward from there, which is both the honest picture and a moving one.
   */
  const now = Date.now()
  const stamps = keys.map((k) => Date.parse(k.timestamp))
  /*
   * The newest step that has already HAPPENED, not merely the nearest one.
   *
   * Nearest could be half an hour into the future, and the cloud beside it is
   * a photograph taken minutes ago. A forecast and an observation of different
   * moments disagree in exactly the way that was reported: rain sitting where
   * the sky is empty, and a storm on the picture with nothing falling out of
   * it. Taking the last step at or before now puts the two layers on the same
   * side of the present, which is as close as a model and a camera get.
   */
  let start = 0
  let bestPast = -1
  for (let i = 0; i < keys.length; i++) {
    if (!Number.isFinite(stamps[i])) continue
    if (stamps[i] <= now) bestPast = i
    if (Math.abs(stamps[i] - now) < Math.abs((stamps[start] || 0) - now)) start = i
  }
  if (bestPast >= 0) start = bestPast
  /*
   * The window ENDS at the present and reaches backwards.
   *
   * It used to start at the present and run forward through the model's
   * forecast steps, while the cloud beside it ran backwards through the last
   * three quarters of an hour of photographs. Two animations, opposite
   * directions, different spacing — so step 2 of the rain was an hour into the
   * future and step 2 of the cloud was half an hour into the past, and no
   * amount of tuning either one could make them agree. Ending both at now and
   * reaching back puts every step on a moment that has actually happened,
   * which is the one kind of moment a camera can also be asked about.
   */
  const end = Math.max(0, Math.min(start, keys.length - 1))
  // Wind takes one keyframe: the motion comes from particles travelling
  // through the field, not from the field changing.
  const want = layer === 'wind' ? Math.max(1, WEATHER_WIND_FRAMES) : WEATHER_FRAME_COUNT
  const from = Math.max(0, end - want + 1)
  const wanted = keys.slice(from, end + 1)
  start = from
  const off = (t: number): string => {
    const m = Math.round((t - now) / 60_000)
    return Number.isFinite(m) ? (m >= 0 ? `+${m}분` : `${m}분`) : '?'
  }
  /*
   * Local clock times, not offsets in minutes.
   *
   * The caption now names the moment the weather is FROM, and "why does it say
   * nine when it is ten" is a question about which keyframe was chosen — which
   * an offset in minutes does not answer. This prints the step actually taken
   * and the one after it, so a window that is an hour behind when a fresher
   * step existed is visible rather than inferred.
   */
  const clock = (t: number): string =>
    Number.isFinite(t) ? new Date(t).toTimeString().slice(0, 5) : '?'
  opsLog(
    `[weather] ${layer}: ${keys.length} keyframes span ${off(stamps[0])}…${off(stamps[keys.length - 1])}; ` +
      `taking ${wanted.length} ending ${clock(stamps[end])} local (${off(stamps[end])}), ` +
      `next step ${clock(stamps[end + 1])} (${off(stamps[end + 1])}), now ${clock(now)}`
  )

  /*
   * The same moment as last time means there is nothing to download.
   *
   * The model publishes on the hour and this polls every five minutes, so
   * eleven polls in twelve ask for a window that is already on screen. Each of
   * those fetched the entire series again — sixty-four tiles per step, per
   * layer — and then threw it away at the identical-timestamp check in the
   * caller. The check belongs here, in front of the bytes rather than behind
   * them.
   *
   * The comparison is on the NEWEST moment alone, not the whole list, because
   * a series that hit its byte budget is shorter than the window that was
   * asked for; the window is anchored at its newest step, so if that has not
   * moved neither has anything behind it.
   */
  const have = latest.get(layer)
  const newest = Date.parse(wanted[wanted.length - 1]?.timestamp ?? '')
  // Same moments AND the same pipeline. A cloud series the GIBS fallback filled
  // in lands on the very timestamps MapTiler would have used -- both are GFS
  // hourly -- so matching on time alone would keep a recovered MapTiler layer
  // locked out for as long as the hour held.
  const mine = have?.length ? have.every((f) => f.feed === 'maptiler') : false
  if (mine && Number.isFinite(newest) && seriesTime(have!) === newest) {
    opsLog(
      `[weather] ${layer}: still ${clock(newest)} local — nothing new published, no tiles fetched`
    )
    return have ?? null
  }

  /*
   * Nearest to now first, and stop when the series has spent its byte budget.
   *
   * A two-channel variable packs its value across a high and a low byte, and
   * the low byte turns over every 1/65536th of the range — so it is noise even
   * where the weather is perfectly smooth, and PNG cannot compress noise. A
   * four-step radar series measured FIFTY-FOUR megabytes against a cloud
   * series' five. That is a number that gets broadcast to both windows and
   * written to the disk cache, so it needs a ceiling rather than a hope.
   *
   * The order is what makes the ceiling safe to hit: the fetch runs from the
   * present BACKWARDS, so a full budget costs the oldest end of the animation
   * and never the picture of right now. The series is put back into forward
   * order below, because that is the direction it is watched in.
   */
  const budget = WEATHER_MAX_SERIES_MB * 1e6
  const series: WeatherFrame[] = []
  let bytes = 0
  for (const k of [...wanted].reverse()) {
    if (stopped) return null
    if (series.length && bytes >= budget) break
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
    series.push(frame)
    bytes += frame.tiles.reduce((m, t) => m + t.url.length, 0)
  }
  if (!series.length) {
    opsLog(`[weather] ${layer}: every tile failed. Last error: ${lastTileError || 'none recorded'}`)
    return null
  }
  series.sort((a, b) => a.time - b.time)
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

  /*
   * Rain, then wind, then cloud — and the order is load-bearing twice over.
   *
   * Rain has to go first because it owns the clock: which moments exist at all
   * is the model's to decide, it publishes hourly steps, and the camera can be
   * asked for any minute, so the only order that produces one shared timeline
   * is the one that asks the constrained side first.
   *
   * Wind goes second because it is cheap and cloud is not. Cloud is thirty-odd
   * separate satellite images -- five sensors for the live picture and again
   * for every archive step -- while the wind is a single keyframe. Behind the
   * cloud, the wind took minutes to reach the screen on a cold start and the
   * log simply ended before it was ever mentioned. In front, it arrives with
   * the rain.
   *
   * The comparator this replaces did produce this order for three layers, but
   * only by accident: it was not a consistent ordering, and a fourth layer
   * would have shuffled the other three unpredictably.
   */
  const ORDER: WeatherLayer[] = ['rain', 'wind', 'cloud']
  const ready: { layer: WeatherLayer; series: WeatherFrame[] }[] = []
  let timeline: number[] | null = null
  /*
   * Is there anything on screen for a new layer to be inconsistent WITH?
   *
   * The all-or-nothing swap below exists to stop this hour's rain being drawn
   * over last hour's cloud. That is a real fault and the rule is right — but it
   * only applies when there IS a coherent picture up. On a cold start there is
   * not: the held cache is hours old, the hub refuses to show it, and the tab
   * is blank. Holding the rain back then buys nothing and costs everything,
   * because the layer it is waiting for is thirty-odd satellite photographs and
   * takes minutes. Somebody pressing 날씨 in that window got an empty planet.
   *
   * So when the screen is blank, each layer goes up as it lands. They cannot
   * disagree with each other: they are all from THIS poll, and the cloud
   * follows the rain's clock by construction. The stale cache goes at the same
   * time — a picture too old to show is also too old to be the baseline the
   * skip test below compares against.
   */
  const blank = !haveFreshFrames()
  if (blank && latest.size) {
    latest.clear()
    opsLog(
      `[weather] the held picture is too old to show — dropped, so this poll ` +
        `starts from an empty screen and publishes each layer as it lands`
    )
  }
  for (const layer of ORDER.filter((l) => LAYERS.includes(l))) {
    if (stopped) return
    let series = await fetchMaptilerLayer(index, layer)
    if (series && layer === 'rain' && series.length > 1) {
      timeline = series.map((f) => f.time)
    }
    if (!series && layer === 'cloud' && WEATHER_CLOUD_SOURCE !== 'off') {
      // MapTiler has the rain but not the cloud on this key. Falling through to
      // GIBS beats the alternative, which is what happened the first time: the
      // layer quietly kept whatever the disk cache held, so the screen showed a
      // cloud picture from hours ago next to live rain and nothing said so.
      opsLog('[weather] cloud: falling back to NASA GIBS for this layer')
      series = await fetchGibsCloud(timeline)
    }
    if (!series) continue
    // Same moment as what is already on screen: nothing to send.
    if (seriesTime(latest.get(layer) ?? []) === seriesTime(series)) continue
    if (blank) {
      // Nothing up there to clash with — see the note on `blank`.
      latest.set(layer, series)
      opsLog(`[weather] ${layer}: up now rather than waiting for the slower layers`)
      for (const f of series) {
        if (stopped) return
        onFrame(f)
        await new Promise((r) => setImmediate(r))
      }
      continue
    }
    // Held, not published. `latest` is what a window reads when it connects and
    // what the next poll compares against, so writing it here would hand a
    // window that arrived mid-poll the same mismatched pair by another door.
    ready.push({ layer, series })
  }
  /*
   * All of it, or none of it — the layers go out together.
   *
   * They were sent the moment each one finished, and the layers do not finish
   * together: the rain is 256 packed tiles and the cloud is thirty-odd
   * separate satellite photographs, so the rain lands in seconds and the cloud
   * takes the better part of a minute. In that gap the screen carried this
   * hour's rain over last hour's cloud, and said so:
   *
   *   clocks (local): cloud [13:00 14:00 15:00 16:00]
   *                    rain [14:00 15:00 16:00 17:00] -> NOT IN SYNC
   *
   * Which is precisely the fault the shared clock exists to prevent -- rain
   * falling where the sky is empty -- reintroduced as a transient. A whole
   * poll's worth of layers swapped at once keeps the set on screen internally
   * consistent at every instant: until the new cloud is ready, the previous
   * rain stays beside the previous cloud, which is a complete and honest
   * picture of an hour ago rather than an incoherent one of now.
   *
   * A yield between frames because each is several megabytes of base64 and
   * stringifying them is the hub's only thread; sent in one burst they arrive
   * late and the windows stutter.
   */
  // One synchronous pass, so there is no tick at which `latest` holds this
  // hour's rain beside last hour's cloud.
  for (const { layer, series } of ready) latest.set(layer, series)
  for (const { series } of ready) {
    for (const f of series) {
      if (stopped) return
      onFrame(f)
      await new Promise((r) => setImmediate(r))
    }
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
    feed: 'gibs',
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
   * Following a timeline that has not moved: there is nothing to go and get.
   *
   * The per-step cache below already stops the archive pictures being fetched
   * twice, but the LIVE disc set is pulled at the top of every poll and then
   * discarded whenever a shared timeline is in force — five sensor images
   * every five minutes, to be thrown away. When the rain's newest instant is
   * the one the cloud is already built on, the whole trip can be skipped.
   */
  const had = latest.get('cloud')
  const mine = had?.length ? had.every((f) => f.feed === 'gibs') : false
  if (timeline?.length && mine && seriesTime(had!) === timeline[timeline.length - 1]) {
    opsLog('[weather] cloud: rain is on the same instants as last poll — nothing fetched')
    return had ?? null
  }
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
  /*
   * How many pieces each sensor's LIVE picture came in.
   *
   * A sensor whose view crosses the antimeridian is fetched as two spans, and a
   * blank one of those is dropped as "the truth" — correct for the live
   * picture, where the emptiness is geometry. For a PAST step it is not the
   * truth, it is a hole: the same sensor that answered with two pieces a minute
   * ago answering with one means half its sky is missing from that step, and
   * the step is otherwise accepted because the sensor is still counted as
   * present. On screen that is a typhoon that exists at 10:00 and at 12:00 and
   * vanishes at 11:00.
   */
  const livePieces = new Map<number, number>()
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
      livePieces.set(lon, parts.length)
    } else {
      const wanted = livePieces.get(lon)
      if (wanted != null && parts.length < wanted) {
        opsLog(
          `[weather] cloud: ${name} at ${time} came back with ${parts.length} of its ` +
            `${wanted} pieces — half its sky is missing, so the step is refused`
        )
        lastTileError = `incomplete step — ${name} at ${time}`
        return false
      }
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
    source: ATTRIBUTION,
    feed: 'gibs',
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
    /*
     * The five sensors at once, not one after another.
     *
     * A step is five satellites and each is a megabyte, and this waited for
     * every one of them in turn — then did it again for the next step, and the
     * next. On a cold start that is thirty-odd sequential downloads before a
     * single cloud reaches the screen, with the wind queued behind all of it.
     * The sensors are independent, so there is nothing to wait for.
     *
     * Each slot writes into its OWN array and they are joined in the order the
     * slots are declared. Sharing one array would have the pictures land in
     * whatever order the network returned them, and a mosaic that composites
     * in a different order on every poll is a mosaic that can flicker.
     *
     * Within a slot the names stay sequential: they are spares, tried in turn
     * until one answers, which is a fallback and not a fan-out.
     */
    const live = WEATHER_GIBS_SLOTS.filter((s) => nowSensors.has(s.lon))
    const perSlot = await Promise.all(
      live.map(async (slot) => {
        const out: WeatherFrame['tiles'] = []
        for (const name of slot.names) {
          if (await fetchSlot(name, slot.lon, slot.url, stamp, out)) break
        }
        return out
      })
    )
    const tiles: WeatherFrame['tiles'] = perSlot.flat()
    /*
     * The same sensors as now — the same ONES, not merely as many.
     *
     * Comparing sizes lets a step through that swapped one sensor for another,
     * which leaves a hole exactly where the missing one looked and puts a
     * second copy of somewhere else beside it.
     */
    const stepSensors = new Set(tiles.map((t) => t.centerLon))
    const sameSensors =
      stepSensors.size === nowSensors.size && [...nowSensors].every((lon) => stepSensors.has(lon))
    if (sameSensors && tiles.length) {
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

/**
 * One poll.
 *
 * The cloud needs no key and never did. It comes from the geostationary
 * satellites — NASA GIBS and EUMETSAT, both open — so it runs whether or not
 * MapTiler is configured. Requiring the key before doing anything took the
 * cloud down with the rain, which is a fault of the plumbing rather than of the
 * data: the two are simply not related.
 *
 * With a key, MapTiler supplies the rain and the wind as packed VALUES rather
 * than a painted picture, and the cloud follows the rain's timestamps so both
 * describe the same moments. Without one, the cloud keeps its own clock and the
 * log says the rain is missing and why.
 */
async function poll(onFrame: (f: WeatherFrame) => void): Promise<void> {
  if (mtKey()) return pollMaptiler(onFrame)
  const frames = await fetchGibsCloud(null)
  if (!frames) throw new Error(`no cloud: ${lastTileError || 'every sensor failed'}`)
  if (seriesTime(latest.get('cloud') ?? []) !== seriesTime(frames)) {
    latest.set('cloud', frames)
    for (const f of frames) onFrame(f)
    saveCache()
  }
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
  /*
   * No replay here any more.
   *
   * This used to push everything it had at whoever was listening, which was
   * right while the poll only ran with the tab open. It now runs from startup
   * and stays running, so this function is called once, long before any window
   * cares — and the second call, the one that actually accompanies a visitor
   * pressing 날씨, returns at the `running` guard above without sending a
   * thing. Handing the current picture to the windows is the hub's job, where
   * it can also decide whether the picture is recent enough to be worth
   * showing at all.
   */
  // Say which source is live, every time. "Is MapTiler actually on?" is not a
  // question anybody should have to answer by looking at the picture.
  opsLog(
    mtKey()
      ? `[weather] source: MapTiler ...${mtKey().slice(-4)} for rain and wind, geostationary ` +
        `satellites for cloud — ${WEATHER_FRAME_COUNT} keyframes, rain=${MAPTILER_VARIABLES.rain}`
      : '[weather] source: geostationary satellites for cloud only. MapTiler 키가 없어 비와 ' +
        '바람이 빠집니다 — 설정 화면(톱니바퀴 길게 누르기)의 "MapTiler 키"에 넣고 다시 시작하세요.'
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
    const pollMs = settings().weatherPollMs
    const wait = failures ? Math.min(pollMs, 30_000 * 2 ** (failures - 1)) : pollMs
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
