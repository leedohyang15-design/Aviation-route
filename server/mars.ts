// Where the two live rovers actually are today, and how far they have driven.
//
// Everything the Mars tab NEEDS is settled history in src/shared/probes.ts and
// works with the building unplugged. This adds the only part of it that moves:
// Curiosity and Perseverance are still driving, so their sol count and their
// odometry climb every few days, and a snapshot from last year presented as
// today's is the sort of small lie an exhibit should not tell.
//
// It is entirely optional. Every failure path here ends in "the static figure
// stands", and the tab is complete without a single successful request.

import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import {
  MARS_MAX_DRIFT_KM,
  MARS_POLL_MS,
  MARS_WAYPOINTS,
  WEATHER_TIMEOUT_MS
} from '../src/shared/config'
import { MARS_PROBES, eastToRendererLon } from '../src/shared/probes'
import { fetchWithTimeout } from './http'
import { dataPath, dataPathCandidates } from './datadir'
import { opsLog } from './log'

const CACHE_NAME = 'aviation-route-mars.json'
const CACHE_VERSION = 1

/** What a live rover adds on top of its entry in the static table. */
export interface MarsLive {
  id: string
  lon: number
  lat: number
  sol: number
  /** Kilometres driven, or null when the file did not carry a distance. */
  drivenKm: number | null
  /** How far from its landing site, km — the figure a child can picture. */
  fromLandingKm: number
  /**
   * The whole traverse, thinned, as [lon, lat] in renderer degrees.
   *
   * It cannot go on the globe: Curiosity's wanderings span about 21km, which
   * is 1.6 pixels at world view and 16 at the deepest zoom the map allows, and
   * reaching 600 would need 364x — at which point one pixel of the 23,040-wide
   * Mars map covers 26 screen pixels and the ground under the line is mush.
   * The path has its own scale, so it gets its own frame: the card draws it
   * with a scale bar and no basemap at all, which is how every published
   * traverse map reads anyway.
   */
  path: [number, number][]
  /** When this was fetched, epoch ms. */
  at: number
}

const live = new Map<string, MarsLive>()
let timer: ReturnType<typeof setTimeout> | null = null
let stopped = true
let running = false
let failures = 0
/** Logged once per rover, so the property names can be checked without guessing. */
const shapeLogged = new Set<string>()

export function marsLive(): MarsLive[] {
  return [...live.values()]
}

/**
 * Mars is 3,396.2 km in radius, which is where every distance here comes from.
 *
 * Using Earth's radius would inflate every figure by 88%, and the number this
 * feeds — "착륙한 곳에서 N km" — is one a child is invited to picture.
 */
const MARS_RADIUS_KM = 3396.2

function greatCircleKm(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLon = (bLon - aLon) * rad
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * How many points of the traverse to keep.
 *
 * The files carry 1,371 and 691 waypoints. Drawn into a card 260 pixels wide
 * that is five points per pixel, so most of them are describing a shape nobody
 * can see — and every one of them is bytes over the socket and bytes in the
 * disk cache. Thinning by taking every Nth keeps the shape because a rover's
 * track is dense ALONG its path rather than clustered; the first and last are
 * always kept, so the landing site and today are exact.
 */
const MAX_PATH = 400

/** The first key that exists and holds a finite number. */
function pickNumber(props: Record<string, unknown>, names: string[]): { key: string; value: number } | null {
  for (const n of names) {
    for (const k of Object.keys(props)) {
      if (k.toLowerCase() !== n) continue
      const v = Number(props[k])
      if (Number.isFinite(v)) return { key: k, value: v }
    }
  }
  return null
}

/**
 * Read a waypoint file without assuming its shape.
 *
 * These are NASA's own MMGIS layers and nobody here has watched one answer —
 * the development sandbox's proxy refuses mars.nasa.gov — so this discovers
 * rather than asserts. It takes a GeoJSON FeatureCollection or a bare array,
 * finds the newest waypoint by sol, and looks for the sol and the odometry
 * under any of the names these files are known to use, reporting which ones it
 * actually found. If the format is not what is expected, the log says exactly
 * what it saw instead of the layer quietly doing nothing — which is the failure
 * mode this project has already paid for once (see server/routes.ts on
 * adsb.lol).
 *
 * Exported so it can be exercised without a network. It is checked against a
 * FeatureCollection, a bare array, kilometres, metres, a file with no sol at
 * all, an empty file and an HTML error page — and against a longitude read as
 * west, which it catches at 8,039km from the landing site.
 */
export function parseWaypoints(json: unknown, id: string): MarsLive | null {
  const root = json as { features?: unknown[] } | unknown[]
  const feats = (Array.isArray(root) ? root : root?.features) as
    | { properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } }[]
    | undefined
  if (!Array.isArray(feats) || !feats.length) {
    opsLog(`[mars] ${id}: no features in the waypoint file — the format has changed`)
    return null
  }

  let best: (typeof feats)[number] | null = null
  let bestSol = -1
  let solKey = ''
  for (const f of feats) {
    const props = f?.properties ?? {}
    const sol = pickNumber(props, ['sol', 'sol_number', 'solnumber'])
    if (!sol) continue
    if (sol.value > bestSol) {
      bestSol = sol.value
      best = f
      solKey = sol.key
    }
  }
  if (!best) {
    const keys = Object.keys(feats[feats.length - 1]?.properties ?? {}).join(', ')
    opsLog(`[mars] ${id}: no sol on any of ${feats.length} waypoints. Keys seen: ${keys || 'none'}`)
    return null
  }

  const props = best.properties ?? {}
  if (!shapeLogged.has(id)) {
    shapeLogged.add(id)
    opsLog(`[mars] ${id}: waypoint fields — ${Object.keys(props).join(', ')}`)
  }

  const coords = best.geometry?.coordinates as number[] | undefined
  if (!Array.isArray(coords) || coords.length < 2) {
    opsLog(`[mars] ${id}: newest waypoint has no point geometry — nothing to place`)
    return null
  }
  // GeoJSON is [lon, lat]. The longitude may be 0..360 or -180..180 depending
  // on the layer; one function handles both, and the sanity check below would
  // catch it if it were west longitude instead.
  const lon = eastToRendererLon(Number(coords[0]))
  const lat = Number(coords[1])
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) {
    opsLog(`[mars] ${id}: newest waypoint is at ${coords[0]},${coords[1]} — not a coordinate`)
    return null
  }

  // Kilometres if the file says km, metres if it says m. Nothing is assumed
  // from the magnitude: a rover that has driven 34 km and one that has driven
  // 34,000 m are the same rover, and guessing from the number is how a layer
  // ends up an order of magnitude out with nobody noticing.
  const km = pickNumber(props, ['dist_km', 'dist_total_km', 'drive_km', 'odometry_km'])
  const m = pickNumber(props, ['dist_m', 'dist_total_m', 'drive_m', 'odometry_m', 'dist'])
  const driven = km ? km.value : m ? m.value / 1000 : null
  const distKey = km?.key ?? m?.key ?? '—'

  const probe = MARS_PROBES.find((p) => p.id === id)
  const home = probe ? eastToRendererLon(probe.lonEast) : lon
  const homeLat = probe?.lat ?? lat
  const fromLandingKm = greatCircleKm(home, homeLat, lon, lat)

  /*
   * A rover cannot be on the other side of the planet.
   *
   * The furthest any of them has ever travelled is Opportunity's 45km, so a
   * position hundreds of kilometres from the landing site is not a rover that
   * has been busy — it is a longitude convention read backwards, or the wrong
   * file. Refusing it keeps the dot where the history says it is rather than
   * putting Perseverance in the southern highlands and saying nothing.
   */
  if (fromLandingKm > MARS_MAX_DRIFT_KM) {
    opsLog(
      `[mars] ${id}: waypoint is ${fromLandingKm.toFixed(0)}km from the landing site — ` +
        `refused (no rover has driven a tenth of that). Longitude convention?`
    )
    return null
  }

  /*
   * The track, in sol order and thinned.
   *
   * Sorted rather than trusted: the file's order is whatever the publisher's
   * pipeline emitted, and a path drawn in the wrong order is not a slower
   * version of the right one, it is a scribble. Points further from the
   * landing site than any rover has ever driven are dropped here as well — one
   * bad row would otherwise set the bounding box and squash the real path into
   * a dot in the corner.
   */
  const track: [number, number][] = feats
    .map((f) => {
      const s = pickNumber(f?.properties ?? {}, ['sol', 'sol_number', 'solnumber'])
      const c = f?.geometry?.coordinates as number[] | undefined
      return { sol: s?.value ?? -1, c }
    })
    .filter((t) => t.sol >= 0 && Array.isArray(t.c) && t.c.length >= 2)
    .sort((a, b) => a.sol - b.sol)
    .map((t) => [eastToRendererLon(Number(t.c![0])), Number(t.c![1])] as [number, number])
    .filter(
      ([x, y]) =>
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        greatCircleKm(home, homeLat, x, y) <= MARS_MAX_DRIFT_KM
    )
  const step = Math.max(1, Math.ceil(track.length / MAX_PATH))
  const path = track.filter((_, i) => i % step === 0)
  if (track.length && path[path.length - 1] !== track[track.length - 1]) {
    path.push(track[track.length - 1])
  }

  opsLog(
    `[mars] ${id}: sol ${bestSol} (from "${solKey}"), ` +
      `${driven == null ? 'no odometry' : `${driven.toFixed(2)}km (from "${distKey}")`}, ` +
      `${lat.toFixed(4)},${lon.toFixed(4)} — ${fromLandingKm.toFixed(1)}km from where it landed, ` +
      `${feats.length} waypoints → ${path.length} drawn`
  )
  return { id, lon, lat, sol: bestSol, drivenKm: driven, fromLandingKm, path, at: Date.now() }
}

function loadCache(): void {
  for (const path of dataPathCandidates(CACHE_NAME)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; rovers: MarsLive[] }
      if (data.version !== CACHE_VERSION || !Array.isArray(data.rovers)) continue
      for (const r of data.rovers) if (r?.id) live.set(r.id, r)
      const age = Math.round((Date.now() - Math.max(...data.rovers.map((r) => r.at))) / 3600_000)
      opsLog(`[mars] ${live.size} rover positions from cache (${age}시간 전)`)
      return
    } catch {
      /* no cache, or a corrupt one: the static table is the floor either way */
    }
  }
}

function saveCache(): void {
  if (!live.size) return
  void writeFile(
    dataPath(CACHE_NAME),
    JSON.stringify({ version: CACHE_VERSION, rovers: marsLive() })
  ).catch((err: Error) => opsLog(`[mars] could not write ${CACHE_NAME}: ${err.message}`))
}

async function poll(onUpdate: () => void): Promise<void> {
  let changed = false
  for (const [id, url] of Object.entries(MARS_WAYPOINTS)) {
    if (stopped) return
    if (!url) continue
    const res = await fetchWithTimeout(url, WEATHER_TIMEOUT_MS)
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`)
    const next = parseWaypoints(await res.json(), id)
    if (!next) continue
    const prev = live.get(id)
    live.set(id, next)
    if (!prev || prev.sol !== next.sol) changed = true
  }
  if (changed) {
    saveCache()
    onUpdate()
  }
}

/**
 * Start the daily check.
 *
 * Daily because that is how fast the data moves: a rover drives a few times a
 * week and the waypoint file is republished a few sols behind. Anything more
 * frequent is asking NASA the same question repeatedly for an answer that
 * cannot have changed.
 */
export function startMars(onUpdate: () => void): void {
  stopped = false
  if (running) return
  running = true
  if (!live.size) loadCache()
  if (!Object.values(MARS_WAYPOINTS).some(Boolean)) {
    opsLog('[mars] live rover positions are off (MARS_WAYPOINTS empty) — the static table stands')
    return
  }
  const loop = async (): Promise<void> => {
    if (stopped) {
      running = false
      return
    }
    try {
      await poll(onUpdate)
      failures = 0
    } catch (err) {
      failures++
      // Never swallowed. The exhibit is fine without this — the static figures
      // stand — but "fine without it" and "silently absent" are different, and
      // only one of them can be diagnosed a month later from a log file.
      opsLog(
        `[mars] check failed (${failures}): ${(err as Error).message} — ` +
          `${live.size ? 'the last known positions stand' : 'the landing sites stand'}`
      )
    }
    if (stopped) {
      running = false
      return
    }
    const wait = failures ? Math.min(MARS_POLL_MS, 60_000 * 2 ** (failures - 1)) : MARS_POLL_MS
    timer = setTimeout(() => void loop(), wait)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  void loop()
}

export function stopMars(): void {
  stopped = true
  if (timer) clearTimeout(timer)
  timer = null
}
