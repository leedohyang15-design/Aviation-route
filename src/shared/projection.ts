// Equirectangular (plate carrée) projection helpers.
//
// The display frame is a 2:1 rectangle where longitude maps linearly across the
// width and latitude linearly down the height. The sphere-projection software
// wraps that rectangle onto the physical globe, so we never do Web-Mercator or
// any non-linear projection here.
//
// Longitude "spin" is the ONLY rotation (per product decision), applied as a
// horizontal offset with wrap-around — no 3-axis re-projection needed.

import type { GeoPoint } from './types'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** Normalize any longitude into the [-180, 180) range. */
export function wrapLon(lon: number): number {
  let x = ((lon + 180) % 360 + 360) % 360 - 180
  // ((...) % 360 + 360) % 360 keeps it non-negative before shifting back.
  if (x === 180) x = -180
  return x
}

/**
 * Project a geographic point to normalized equirectangular coordinates.
 * Returns u in [0,1) (left→right = -180→180 after offset) and v in [0,1]
 * (top→bottom = +90→-90). Multiply by width/height for pixels, or feed
 * straight into a shader.
 */
export function projectNorm(lon: number, lat: number, lonOffset = 0): { u: number; v: number } {
  const u = (wrapLon(lon + lonOffset) + 180) / 360
  const v = (90 - lat) / 180
  return { u, v }
}

/**
 * Whether a reported position is worth drawing.
 *
 * Rejects anything that isn't a finite in-range number, and also the exact point
 * (0, 0) — "null island" in the Gulf of Guinea, where every feed's
 * missing-coordinate default lands. Genuine traffic crosses it for a few seconds
 * a day; a placeholder sits there forever, and a pile of them draws as a hard
 * dot or streak on the equator that looks like data but isn't.
 */
export function isPlausibleCoord(lon: unknown, lat: unknown): boolean {
  if (typeof lon !== 'number' || typeof lat !== 'number') return false
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return false
  return !(lon === 0 && lat === 0)
}

/** Project to pixel coordinates for a width×(width/2) target. */
export function project(
  lon: number,
  lat: number,
  lonOffset: number,
  width: number,
  height: number
): { x: number; y: number } {
  const { u, v } = projectNorm(lon, lat, lonOffset)
  return { x: u * width, y: v * height }
}

function toVec(lon: number, lat: number): [number, number, number] {
  const la = lat * DEG2RAD
  const lo = lon * DEG2RAD
  const c = Math.cos(la)
  return [c * Math.cos(lo), c * Math.sin(lo), Math.sin(la)]
}

function toGeo(v: [number, number, number]): GeoPoint {
  const [x, y, z] = v
  return { lon: Math.atan2(y, x) * RAD2DEG, lat: Math.asin(Math.max(-1, Math.min(1, z))) * RAD2DEG }
}

/**
 * Sample the great-circle path between two points as `segments+1` geographic
 * points (slerp on the unit sphere). A straight line in equirectangular space
 * is NOT the real flight path — this produces the curve that, on the globe, is
 * the shortest route (e.g. over the pole for Seoul→New York).
 */
export function greatCirclePoints(a: GeoPoint, b: GeoPoint, segments = 128): GeoPoint[] {
  const va = toVec(a.lon, a.lat)
  const vb = toVec(b.lon, b.lat)
  let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]
  dot = Math.max(-1, Math.min(1, dot))
  const omega = Math.acos(dot)

  // Antipodal or coincident: fall back to a straight interpolation of endpoints.
  if (!isFinite(omega) || omega < 1e-6) {
    return [a, b]
  }

  const sinOmega = Math.sin(omega)
  const out: GeoPoint[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const s0 = Math.sin((1 - t) * omega) / sinOmega
    const s1 = Math.sin(t * omega) / sinOmega
    const v: [number, number, number] = [
      s0 * va[0] + s1 * vb[0],
      s0 * va[1] + s1 * vb[1],
      s0 * va[2] + s1 * vb[2]
    ]
    out.push(toGeo(v))
  }
  return out
}

/**
 * A single point at fraction `t` (0..1) along the great circle a→b. Same slerp
 * as `greatCirclePoints`, but without building the whole path — used by the mock
 * feed, which advances thousands of planes on every tick and only ever needs
 * each one's current position.
 */
export function greatCirclePointAt(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const va = toVec(a.lon, a.lat)
  const vb = toVec(b.lon, b.lat)
  let dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]
  dot = Math.max(-1, Math.min(1, dot))
  const omega = Math.acos(dot)
  if (!isFinite(omega) || omega < 1e-6) return a

  const sinOmega = Math.sin(omega)
  const s0 = Math.sin((1 - t) * omega) / sinOmega
  const s1 = Math.sin(t * omega) / sinOmega
  return toGeo([s0 * va[0] + s1 * vb[0], s0 * va[1] + s1 * vb[1], s0 * va[2] + s1 * vb[2]])
}

/** Great-circle distance between two points in kilometres. */
export function greatCircleDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const φ1 = a.lat * DEG2RAD
  const φ2 = b.lat * DEG2RAD
  const dφ = (b.lat - a.lat) * DEG2RAD
  const dλ = (b.lon - a.lon) * DEG2RAD
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Index of the route point nearest a position (squared lon/lat distance). */
export function nearestRouteIndex(route: GeoPoint[], pos: GeoPoint): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < route.length; i++) {
    const dx = wrapLon(route[i].lon - pos.lon)
    const dy = route[i].lat - pos.lat
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * Split a polyline into sub-segments wherever it crosses the antimeridian
 * (±180°), so the renderer never draws a line streaking across the whole frame.
 * A crossing is detected when consecutive longitudes jump by more than 180°.
 */
export function splitAtAntimeridian(points: GeoPoint[]): GeoPoint[][] {
  if (points.length < 2) return [points]
  const segments: GeoPoint[][] = []
  let current: GeoPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    if (Math.abs(cur.lon - prev.lon) > 180) {
      segments.push(current)
      current = [cur]
    } else {
      current.push(cur)
    }
  }
  segments.push(current)
  return segments
}
