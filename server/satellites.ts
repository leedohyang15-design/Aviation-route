// Satellite positions, orbits, and overhead passes — all computed locally with
// SGP4 from the TLE set, so this needs no network after the daily download.
//
// ~11,000 propagations per tick costs well over a hundred milliseconds, which
// would stall WebSocket sends if done in one go, so a tick is sliced into chunks
// that yield to the event loop between them. Positions go out once a second;
// at orbital speed that is ~0.07° of longitude, so the renderer's existing
// easing carries the motion smoothly between updates.

import * as sat from 'satellite.js'
import type { Satellite, SatelliteDetail, GeoPoint } from '../src/shared/types'
import { SAT_TICK_MS, SAT_SLICE_MS, OBSERVER_LAT, OBSERVER_LON } from '../src/shared/config'
import { loadTles, type TleRecord } from './tle'
import { opsLog } from './log'

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

interface Entry {
  rec: sat.SatRec
  id: string
  name: string
  /** Orbital period in minutes, from mean motion. */
  periodMin: number
  /** Inclination in degrees. */
  inclination: number
}

const observer = {
  longitude: OBSERVER_LON * RAD,
  latitude: OBSERVER_LAT * RAD,
  height: 0.05 // km above sea level — Seoul, near enough
}

let entries: Entry[] = []
let latest: Satellite[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let stopped = true

/** Orbit class, which is what the colours and the filter chips key off. */
export function orbitClass(altKm: number, name: string): Satellite['orbit'] {
  if (/^STARLINK/i.test(name)) return 'starlink'
  if (altKm >= 30000) return 'geo'
  if (altKm >= 2000) return 'meo'
  return 'leo'
}

/** Earth's rotation rate, rad/s — needed to express velocity relative to the
 * ground rather than to the stars. */
const OMEGA = 7.2921159e-5

interface Fix {
  lon: number
  lat: number
  altKm: number
  /** Ground speed of the sub-satellite point, km/s. */
  groundSpeed: number
  /** Direction of travel over the ground, degrees clockwise from north. */
  heading: number
}

/**
 * Position, ground speed and heading in ONE propagation.
 *
 * Heading used to come from propagating a second time a second later and taking
 * the bearing between the two points, which doubled the cost of every tick — at
 * 11,000 satellites that was the difference between keeping up and not. SGP4
 * already returns a velocity vector, so rotating it into the local
 * east/north frame gives the same answer for free.
 */
function fixAt(rec: sat.SatRec, when: Date): Fix | null {
  const pv = sat.propagate(rec, when) as {
    position?: sat.EciVec3<number> | false
    velocity?: sat.EciVec3<number> | false
  }
  if (!pv || !pv.position || !pv.velocity) return null
  const gmst = sat.gstime(when)
  const gd = sat.eciToGeodetic(pv.position as sat.EciVec3<number>, gmst)
  const lon = sat.degreesLong(gd.longitude)
  const lat = sat.degreesLat(gd.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  // Both vectors into the Earth-fixed frame, then subtract the frame's own
  // rotation so the velocity is relative to the ground under the satellite.
  const r = sat.eciToEcf(pv.position as sat.EciVec3<number>, gmst)
  const v = sat.eciToEcf(pv.velocity as sat.EciVec3<number>, gmst)
  const vx = v.x + OMEGA * r.y
  const vy = v.y - OMEGA * r.x
  const vz = v.z

  const λ = gd.longitude
  const φ = gd.latitude
  const sinλ = Math.sin(λ)
  const cosλ = Math.cos(λ)
  const sinφ = Math.sin(φ)
  const cosφ = Math.cos(φ)
  const east = -sinλ * vx + cosλ * vy
  const north = -sinφ * cosλ * vx - sinφ * sinλ * vy + cosφ * vz

  return {
    lon,
    lat,
    altKm: gd.height,
    groundSpeed: Math.hypot(east, north),
    heading: ((Math.atan2(east, north) * DEG) % 360 + 360) % 360
  }
}

/** Load the elements. Safe to call again later to refresh. */
export async function initSatellites(path?: string): Promise<number> {
  const tles: TleRecord[] = path ? await loadTles(path) : await loadTles()
  const next: Entry[] = []
  for (const t of tles) {
    try {
      const rec = sat.twoline2satrec(t.line1, t.line2)
      // `error` is SGP4's own "these elements are unusable" signal.
      if (!rec || rec.error) continue
      if (!Number.isFinite(rec.no) || rec.no <= 0) continue
      next.push({
        rec,
        id: t.noradId,
        name: t.name,
        periodMin: (2 * Math.PI) / rec.no,
        inclination: rec.inclo * DEG
      })
    } catch {
      /* one unusable satellite shouldn't cost us the catalogue */
    }
  }
  entries = next
  opsLog(`[sat] ${entries.length} satellites ready for propagation`)
  return entries.length
}

/**
 * Propagate everything once, yielding to the event loop whenever a slice has
 * taken long enough. A fixed chunk count made the slice size depend on the
 * catalogue size — fine for hundreds, a 280ms stall for eleven thousand — so the
 * budget is expressed in milliseconds instead.
 */
async function propagateAll(): Promise<Satellite[]> {
  const when = new Date()
  const out: Satellite[] = []
  let sliceStart = Date.now()
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const fix = fixAt(e.rec, when)
    if (fix) {
      out.push({
        id: e.id,
        name: e.name,
        lon: fix.lon,
        lat: fix.lat,
        altKm: fix.altKm,
        speedKmS: fix.groundSpeed,
        heading: fix.heading,
        orbit: orbitClass(fix.altKm, e.name)
      })
    }
    if (Date.now() - sliceStart >= SAT_SLICE_MS) {
      await new Promise((r) => setImmediate(r))
      sliceStart = Date.now()
    }
  }
  return out
}

/** Latest computed positions (empty until the first tick completes). */
export function snapshot(): Satellite[] {
  return latest
}

export function startSatellites(onSnapshot: (s: Satellite[]) => void): void {
  if (!stopped) return
  stopped = false
  const loop = async (): Promise<void> => {
    if (stopped) return
    const started = Date.now()
    try {
      latest = await propagateAll()
      onSnapshot(latest)
    } catch (err) {
      opsLog(`[sat] propagation failed: ${(err as Error).message}`)
    }
    if (stopped) return
    // Aim for a steady period: a full catalogue takes a second or two to
    // propagate, and adding the interval on top of that would stretch the gap
    // between updates instead of holding it.
    const wait = Math.max(50, SAT_TICK_MS - (Date.now() - started))
    timer = setTimeout(() => void loop(), wait)
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }
  void loop()
}

export function stopSatellites(): void {
  stopped = true
  if (timer) clearTimeout(timer)
  timer = null
}

/**
 * One full orbit's ground track, centred on now: half a period behind (the path
 * already flown) through half a period ahead. Returned as a single polyline —
 * the renderer already splits it where it crosses the antimeridian, which an
 * orbit does on nearly every pass.
 */
export function orbitTrack(id: string, samples = 180): GeoPoint[] | null {
  const e = entries.find((x) => x.id === id)
  if (!e) return null
  const periodMs = e.periodMin * 60_000
  const start = Date.now() - periodMs / 2
  const step = periodMs / samples
  const pts: GeoPoint[] = []
  for (let i = 0; i <= samples; i++) {
    const p = fixAt(e.rec, new Date(start + i * step))
    if (p) pts.push({ lon: p.lon, lat: p.lat })
  }
  return pts.length > 2 ? pts : null
}

/**
 * When this satellite next climbs above the exhibit's horizon, and how high it
 * gets. Only ever run for the one selected satellite, so a coarse 30s scan over
 * the next day is cheap — a few thousand propagations, tens of milliseconds.
 */
export function nextPass(
  id: string
): { inSec: number; maxElevationDeg: number; alwaysUp: boolean } | null {
  const e = entries.find((x) => x.id === id)
  if (!e) return null
  const STEP_SEC = 30
  const HORIZON_SEC = 24 * 3600
  const t0 = Date.now()

  const elevationAt = (ms: number): number | null => {
    const when = new Date(ms)
    const pv = sat.propagate(e.rec, when) as { position?: sat.EciVec3<number> | false }
    if (!pv || !pv.position) return null
    const ecf = sat.eciToEcf(pv.position as sat.EciVec3<number>, sat.gstime(when))
    return sat.ecfToLookAngles(observer, ecf).elevation * DEG
  }

  const startEl = elevationAt(t0)
  if (startEl == null) return null
  // Geostationary satellites are either permanently up or permanently below the
  // horizon; "next pass" is the wrong question for them.
  if (e.periodMin > 1400) return { inSec: 0, maxElevationDeg: startEl, alwaysUp: startEl > 0 }
  if (startEl > 0) return { inSec: 0, maxElevationDeg: startEl, alwaysUp: false }

  for (let s = STEP_SEC; s <= HORIZON_SEC; s += STEP_SEC) {
    const el = elevationAt(t0 + s * 1000)
    if (el == null || el <= 0) continue
    // Found the rise; walk the pass to its highest point.
    let max = el
    for (let k = s; k <= s + 20 * 60; k += STEP_SEC) {
      const e2 = elevationAt(t0 + k * 1000)
      if (e2 == null || e2 <= 0) break
      max = Math.max(max, e2)
    }
    return { inSec: s, maxElevationDeg: max, alwaysUp: false }
  }
  return null // never rises here (e.g. a low-inclination orbit seen from Seoul)
}

/** Rich detail for the selected satellite (panel + orbit line). */
export function getDetail(id: string): SatelliteDetail | null {
  const e = entries.find((x) => x.id === id)
  if (!e) return null
  const s = latest.find((x) => x.id === id)
  const pass = nextPass(id)
  return {
    id: e.id,
    name: e.name,
    altKm: s?.altKm ?? 0,
    speedKmS: s?.speedKmS ?? 0,
    periodMin: e.periodMin,
    inclinationDeg: e.inclination,
    orbit: s?.orbit ?? 'leo',
    track: orbitTrack(id),
    nextPassSec: pass && !pass.alwaysUp && pass.inSec > 0 ? pass.inSec : undefined,
    passMaxElevationDeg: pass?.maxElevationDeg,
    overheadNow: pass ? pass.inSec === 0 : undefined
  }
}
