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
import { isPlausibleCoord } from '../src/shared/projection'
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
  /** The elements' epoch, verbatim from the TLE (YYDDD.DDDDDDDD). */
  epoch: string
  /** Revolution number at epoch. */
  revNumber: number
  /** International designator, e.g. "1998-067A", and the launch year from it. */
  cosparId: string
  launchYear: number | null
  /** Orbit shape, from the semi-major axis and eccentricity. */
  apogeeKm: number
  perigeeKm: number
  eccentricity: number
}

/** Equatorial radius, km — the datum SGP4's normalized distances are in. */
const EARTH_R = 6378.137

/**
 * The international designator, from fixed columns 10–17 of line 1: two digits
 * of launch year, three of launch number, then the piece. "98067A" is the ISS's
 * first module. The two-digit year rolls over at 57, per the format's own rule.
 */
function parseCospar(line1: string): { id: string; year: number | null } {
  const raw = line1.slice(9, 17).trim()
  const m = /^(\d{2})(\d{3})([A-Z]{1,3})$/.exec(raw)
  if (!m) return { id: raw, year: null }
  const yy = Number(m[1])
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  return { id: `${year}-${m[2]}${m[3]}`, year }
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
      const cospar = parseCospar(t.line1)
      // `error` is SGP4's own "these elements are unusable" signal.
      if (!rec || rec.error) continue
      if (!Number.isFinite(rec.no) || rec.no <= 0) continue
      next.push({
        rec,
        id: t.noradId,
        name: t.name,
        periodMin: (2 * Math.PI) / rec.no,
        inclination: rec.inclo * DEG,
        // Fixed columns, per the TLE format: epoch in line 1, revolution count
        // in line 2. satellite.js keeps neither in a form we can show.
        epoch: t.line1.slice(18, 32).trim(),
        revNumber: Number(t.line2.slice(63, 68).trim()) || 0,
        cosparId: cospar.id,
        launchYear: cospar.year,
        // satrec.a is the semi-major axis in Earth radii.
        apogeeKm: rec.a * (1 + rec.ecco) * EARTH_R - EARTH_R,
        perigeeKm: rec.a * (1 - rec.ecco) * EARTH_R - EARTH_R,
        eccentricity: rec.ecco
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
    // A decayed or garbage element set can propagate to a nonsense sub-point;
    // (0, 0) in particular would plot as a phantom on the equator.
    if (fix && isPlausibleCoord(fix.lon, fix.lat)) {
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

/** True while a loop body is alive, including across its awaits. */
let running = false

export function startSatellites(onSnapshot: (s: Satellite[]) => void): void {
  stopped = false
  // Guarding on `stopped` alone was not enough: a full pass takes a second or
  // two and propagateAll never checks it, so a 🛰→✈→🛰 tap sequence completed
  // inside one pass found `stopped` true again and started a SECOND loop. The
  // first then resumed past its own post-await check, broadcast, and rescheduled
  // — two loops propagating sixteen thousand satellites on the main process,
  // racing to write `latest` and overwriting each other's timer handle. The
  // flag has to be owned by the loop body, not by the start/stop pair.
  if (running) return
  running = true
  const loop = async (): Promise<void> => {
    if (stopped) {
      running = false
      return
    }
    const started = Date.now()
    try {
      latest = await propagateAll()
      onSnapshot(latest)
    } catch (err) {
      opsLog(`[sat] propagation failed: ${(err as Error).message}`)
    }
    if (stopped) {
      running = false
      return
    }
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

  const at = (ms: number): (GeoPoint & { t: number }) | null => {
    const p = fixAt(e.rec, new Date(ms))
    return p ? { lon: p.lon, lat: p.lat, t: ms } : null
  }

  const pts: (GeoPoint & { t: number })[] = []
  for (let i = 0; i <= samples; i++) {
    const p = at(start + i * step)
    if (p) pts.push(p)
  }
  if (pts.length <= 2) return null

  // Even time steps are not even steps on the map. Near the poles a polar orbit
  // — which is most of what is up there once Starlink is off — sweeps a whole
  // hemisphere of longitude in two or three samples, so on an equirectangular
  // frame the turn came out as a handful of long chords with visibly chopped
  // corners while the rest of the track was smooth. Subdividing by distance in
  // MAP degrees (not on the sphere: a chord's length on screen is what's being
  // fixed) puts the extra samples exactly where the projection stretches, and
  // costs nothing along the parts that were already fine.
  const MAX_GAP_DEG = 4 // ≈18px of a 1664px-wide frame
  const MAX_DEPTH = 6
  const gapTooBig = (a: GeoPoint, b: GeoPoint): boolean => {
    let dLon = b.lon - a.lon
    if (dLon > 180) dLon -= 360
    else if (dLon < -180) dLon += 360
    return Math.hypot(dLon, b.lat - a.lat) > MAX_GAP_DEG
  }

  const out: GeoPoint[] = [{ lon: pts[0].lon, lat: pts[0].lat }]
  for (let i = 1; i < pts.length; i++) {
    const refine = (a: typeof pts[0], b: typeof pts[0], depth: number): void => {
      if (depth < MAX_DEPTH && gapTooBig(a, b)) {
        const mid = at((a.t + b.t) / 2)
        if (mid) {
          refine(a, mid, depth + 1)
          out.push({ lon: mid.lon, lat: mid.lat })
          refine(mid, b, depth + 1)
          return
        }
      }
    }
    refine(pts[i - 1], pts[i], 0)
    out.push({ lon: pts[i].lon, lat: pts[i].lat })
  }
  return out
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
  // A pass lasts about ten minutes, so a two-minute stride cannot step over
  // one — and it costs a quarter of what a thirty-second stride did. The rise
  // time is then walked back at the fine stride, so the answer is no coarser.
  const STEP_SEC = 120
  const FINE_SEC = 20
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
    // Somewhere in the last stride it crossed the horizon: walk back to find
    // where, so a two-minute stride does not report a two-minute-late rise.
    let rise = s
    for (let k = s - FINE_SEC; k > s - STEP_SEC; k -= FINE_SEC) {
      const e2 = elevationAt(t0 + k * 1000)
      if (e2 == null || e2 <= 0) break
      rise = k
    }
    // Then walk the pass forward to its highest point.
    let max = el
    for (let k = rise; k <= rise + 20 * 60; k += FINE_SEC) {
      const e2 = elevationAt(t0 + k * 1000)
      if (e2 == null || e2 <= 0) break
      max = Math.max(max, e2)
    }
    return { inSec: rise, maxElevationDeg: max, alwaysUp: false }
  }
  return null // never rises here (e.g. a low-inclination orbit seen from Seoul)
}

/** Straight-line distance from the exhibit to the satellite right now, km. */
function rangeNow(rec: sat.SatRec): number | null {
  const when = new Date()
  const pv = sat.propagate(rec, when) as { position?: sat.EciVec3<number> | false }
  if (!pv || !pv.position) return null
  const ecf = sat.eciToEcf(pv.position as sat.EciVec3<number>, sat.gstime(when))
  const r = sat.ecfToLookAngles(observer, ecf).rangeSat
  return Number.isFinite(r) ? r : null
}

/**
 * Rich detail for the selected satellite (panel + orbit line).
 *
 * `withPass` is off by the caller's choice, not by accident. Working out when
 * a satellite next rises means propagating its orbit across the next day, and
 * for one that never rises here that is the whole day's worth — hundreds of
 * milliseconds on the hub's only thread, spent BEFORE the card can be sent.
 * So the card goes out first without that one line, and the hub asks again
 * with the pass a tick later. The card appears at once and fills itself in.
 */
export function getDetail(id: string, withPass = true): SatelliteDetail | null {
  const e = entries.find((x) => x.id === id)
  if (!e) return null
  const s = latest.find((x) => x.id === id)
  const pass = withPass ? nextPass(id) : null
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
    overheadNow: pass ? pass.inSec === 0 : undefined,
    tleEpoch: e.epoch || undefined,
    revNumber: e.revNumber || undefined,
    cosparId: e.cosparId || undefined,
    launchYear: e.launchYear ?? undefined,
    apogeeKm: e.apogeeKm,
    perigeeKm: e.perigeeKm,
    eccentricity: e.eccentricity,
    rangeKm: rangeNow(e.rec) ?? undefined
  }
}
