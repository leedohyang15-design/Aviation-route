// Bulk route resolution.
//
// OpenSky's /states/all carries no origin/destination, so a route can only be
// found by asking a community database for the callsign. Doing that one plane at
// a time (on selection) means the exhibit can only discover a missing route
// AFTER a visitor has already picked the plane. This module resolves routes for
// many aircraft up front so route-less flights can be filtered out before anyone
// sees them.
//
// Routes come from adsbdb, which answers one callsign per request. There is no
// batch endpoint, so instead of bursting we spread the requests evenly across
// the poll interval — a steady trickle rather than a flood on a free service —
// and cache every answer, including "no route", so each callsign is asked about
// once rather than once per poll. The cache is also written to disk, so a kiosk
// restarted the next morning starts warm instead of re-asking for everything.
//
// (An earlier version used adsb.lol's routeset endpoint, which takes a list of
// planes per request. It was removed: that endpoint answers every request —
// including a plain GET — with "201 Created" and an empty body, i.e. it does not
// exist in the form we assumed, so no batch was ever resolved.)
//
// Everything here fails open: an unreachable API leaves routes "unknown", and
// unknown aircraft are shown, never hidden.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { cityKo } from '../src/common/airports'
import {
  ROUTE_LOOKUP_PER_POLL,
  ROUTE_CACHE_TTL_MS,
  ROUTE_NEGATIVE_TTL_MS,
  ROUTE_CACHE_MAX,
  OPENSKY_POLL_INTERVAL_MS
} from '../src/shared/config'
import { opsLog } from './log'

export interface RoutePort {
  code: string
  city?: string
  countryCode?: string
  lon: number
  lat: number
}

export interface RoutePorts {
  airline?: string
  origin?: RoutePort
  destination?: RoutePort
}

/** Korean city for an airport code, logging codes we have no translation for
 * (once each) so they can be collected and added in a batch — instead of
 * hunting for them one screenshot at a time. */
const missingCity = new Set<string>()
export function koCity(code: string | undefined, english: string | undefined): string | undefined {
  const ko = cityKo(code)
  if (ko) return ko
  if (code && !missingCity.has(code)) {
    missingCity.add(code)
    console.log(`[city] no Korean for ${code}${english ? ` (${english})` : ''} — add to airports.ts`)
  }
  return english
}

interface Entry {
  ports: RoutePorts | null // null = confirmed no route
  ts: number
}

/** Callsign → route (or confirmed absence). Shared by the bulk resolver and the
 * per-selection detail lookup, so selecting a plane usually needs no network. */
const cache = new Map<string, Entry>()

const norm = (callsign: string) => callsign.trim().toUpperCase()

function fresh(e: Entry | undefined): e is Entry {
  if (!e) return false
  const ttl = e.ports ? ROUTE_CACHE_TTL_MS : ROUTE_NEGATIVE_TTL_MS
  return Date.now() - e.ts < ttl
}

/** Cached route for a callsign: RoutePorts, null (confirmed none), or undefined
 * (not looked up yet / expired). */
export function cachedRoute(callsign: string | undefined): RoutePorts | null | undefined {
  if (!callsign) return undefined
  const e = cache.get(norm(callsign))
  return fresh(e) ? e.ports : undefined
}

/** Whether this callsign is known to have a route. undefined = not yet known,
 * which callers must treat as "show it" (fail open). */
export function hasRoute(callsign: string | undefined): boolean | undefined {
  const r = cachedRoute(callsign)
  return r === undefined ? undefined : r !== null
}

let dirty = false

export function cacheRoute(callsign: string, ports: RoutePorts | null): void {
  if (!callsign) return
  cache.set(norm(callsign), { ports, ts: Date.now() })
  dirty = true
}

// ---------------------------------------------------------------------------
// adsbdb lookup
// ---------------------------------------------------------------------------

/** Thrown for 429 so the caller can back off rather than treat it as "no route". */
class RateLimited extends Error {}

/**
 * Look up one callsign. Returns the route, or null when adsbdb has no entry for
 * it (a real answer worth caching). Throws on transport/API failure so the
 * caller leaves the callsign unknown instead of hiding the plane.
 */
export async function lookupRoute(callsign: string): Promise<RoutePorts | null> {
  const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'aviation-route-exhibit/0.1 (museum kiosk)'
    }
  })
  if (res.status === 429) throw new RateLimited('rate limited (429)')
  // 404 is adsbdb's "unknown callsign" — a definite answer, not a failure.
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = (await res.json()) as {
    response?: { flightroute?: Record<string, Record<string, unknown> & { name?: string }> }
  }
  const fr = j?.response?.flightroute
  if (!fr) return null
  const port = (p: Record<string, unknown> | undefined): RoutePort | undefined => {
    if (!p || p.longitude == null || p.latitude == null) return undefined
    const iata = (p.iata_code as string) || undefined
    return {
      code: iata || (p.icao_code as string) || '',
      city: koCity(iata, p.municipality as string | undefined),
      countryCode: ((p.country_iso_name as string) || '').toLowerCase() || undefined,
      lon: p.longitude as number,
      lat: p.latitude as number
    }
  }
  const origin = port(fr.origin)
  const destination = port(fr.destination)
  // Only a route with BOTH endpoints can be drawn; treat a half-answer as none.
  if (!origin || !destination) return null
  return { airline: fr.airline?.name, origin, destination }
}

// Only one resolution pass runs at a time; a poll arriving mid-pass is skipped
// rather than stacking requests on a free API.
let running = false
/** Poll cycles to sit out after a 429, decremented once per pass. */
let cooldown = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Resolve routes for any of these planes we haven't asked about yet, pacing the
 * requests evenly across one poll interval. Callsigns adsbdb has no entry for
 * are cached as "no route" so they aren't retried every cycle.
 */
export async function resolveRoutes(planes: { callsign: string }[]): Promise<void> {
  if (running) return
  if (cooldown > 0) {
    cooldown--
    return
  }
  const pending: string[] = []
  const seen = new Set<string>()
  for (const p of planes) {
    const cs = norm(p.callsign)
    if (!cs || seen.has(cs) || fresh(cache.get(cs))) continue
    seen.add(cs)
    pending.push(cs)
  }
  if (!pending.length) return

  running = true
  const work = pending.slice(0, ROUTE_LOOKUP_PER_POLL)
  // Spread the budget across the poll interval instead of bursting: a steady
  // ~1 request/second rather than hundreds at once.
  const gap = Math.max(0, Math.floor(OPENSKY_POLL_INTERVAL_MS / Math.max(1, ROUTE_LOOKUP_PER_POLL)))
  let found = 0
  let none = 0
  let failed = 0
  try {
    for (const cs of work) {
      try {
        const ports = await lookupRoute(cs)
        cacheRoute(cs, ports)
        if (ports) found++
        else none++
      } catch (err) {
        if (err instanceof RateLimited) {
          cooldown = 2 // sit out a couple of cycles before trying again
          opsLog(`[routes] adsbdb rate-limited — pausing lookups for ${cooldown} poll cycles`)
          break
        }
        // Transport error: leave this callsign unknown (plane stays visible).
        if (++failed >= 10) {
          opsLog(`[routes] adsbdb unreachable (${(err as Error).message}) — retrying next poll`)
          break
        }
      }
      if (gap) await sleep(gap)
    }
  } finally {
    running = false
  }
  if (found || none || failed) {
    const left = pending.length - found - none
    opsLog(
      `[routes] adsbdb ${found + none} lookups — route ${found} / none ${none}` +
        `${failed ? ` / failed ${failed}` : ''}; cache ${cache.size}, ${left} queued`
    )
  }
  saveIfDue()
}

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------
//
// Flight numbers fly the same route day after day, so yesterday's answers are
// almost all still valid this morning. Persisting the cache next to the
// executable means a kiosk restarted daily starts already filtered instead of
// spending the first hour re-asking adsbdb for the same callsigns.

const CACHE_PATH = join(dirname(process.execPath), 'aviation-route-routes.json')
const SAVE_INTERVAL_MS = 5 * 60_000
let lastSave = 0

interface Persisted {
  version: number
  saved: number
  entries: Record<string, { p: RoutePorts | null; t: number }>
}

export function loadRouteCache(path = CACHE_PATH): void {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return // no cache yet — normal on first run
  }
  try {
    const data = JSON.parse(text) as Persisted
    if (data?.version !== 1 || !data.entries) return
    let loaded = 0
    for (const [cs, e] of Object.entries(data.entries)) {
      const entry: Entry = { ports: e.p, ts: e.t }
      if (!fresh(entry)) continue // expired while the exhibit was off
      cache.set(cs, entry)
      loaded++
    }
    opsLog(`[routes] loaded ${loaded} cached routes from ${path}`)
  } catch (err) {
    // A truncated or corrupt file must never stop the exhibit starting.
    opsLog(`[routes] ignoring unreadable route cache: ${(err as Error).message}`)
  }
}

export function saveRouteCache(path = CACHE_PATH): void {
  if (!dirty) return
  // Cap the file: drop the oldest entries first so it can't grow without bound.
  let entries = [...cache.entries()]
  if (entries.length > ROUTE_CACHE_MAX) {
    entries.sort((a, b) => b[1].ts - a[1].ts)
    entries = entries.slice(0, ROUTE_CACHE_MAX)
    cache.clear()
    for (const [cs, e] of entries) cache.set(cs, e)
  }
  const data: Persisted = {
    version: 1,
    saved: Date.now(),
    entries: Object.fromEntries(entries.map(([cs, e]) => [cs, { p: e.ports, t: e.ts }]))
  }
  try {
    writeFileSync(path, JSON.stringify(data))
    dirty = false
    lastSave = Date.now()
  } catch (err) {
    opsLog(`[routes] could not save route cache: ${(err as Error).message}`)
  }
}

/** Save at most every few minutes — the cache is an optimisation, not a log. */
function saveIfDue(): void {
  if (dirty && Date.now() - lastSave > SAVE_INTERVAL_MS) saveRouteCache()
}

/** Test seam: number of cached callsigns. */
export function routeCacheSize(): number {
  return cache.size
}
