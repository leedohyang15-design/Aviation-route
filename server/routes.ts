// Bulk route resolution.
//
// OpenSky's /states/all carries no origin/destination, so a route can only be
// found by asking a community database for the callsign. Doing that one plane at
// a time (on selection) means the exhibit can only discover a missing route
// AFTER a visitor has already picked the plane. This module resolves routes for
// many aircraft up front so route-less flights can be filtered out before anyone
// sees them.
//
// adsb.lol's routeset endpoint takes a LIST of planes per request, which is what
// makes this affordable: one request covers a whole chunk. It is a free
// community service, so requests are chunked, sent sequentially, capped per poll
// cycle, and every answer (including "no route") is cached so a callsign is
// asked about once, not once per poll.
//
// Everything here fails open: an unreachable API leaves routes "unknown", and
// unknown aircraft are shown, never hidden.

import { cityKo } from '../src/common/airports'
import {
  ROUTE_LOOKUP_CHUNK,
  ROUTE_LOOKUP_CHUNKS_PER_POLL,
  ROUTE_CACHE_TTL_MS,
  ROUTE_NEGATIVE_TTL_MS
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

export function cacheRoute(callsign: string, ports: RoutePorts | null): void {
  if (callsign) cache.set(norm(callsign), { ports, ts: Date.now() })
}

/** True when a route has both endpoints — the only case we can draw a line for. */
function complete(p: RoutePorts | null): boolean {
  return !!p && !!p.origin && !!p.destination
}

const port = (p: Record<string, unknown> | null | undefined): RoutePort | undefined => {
  if (!p || p.lon == null || p.lat == null) return undefined
  const iata = (p.iata as string) || undefined
  return {
    code: iata || (p.icao as string) || '',
    city: koCity(iata, p.location as string | undefined),
    countryCode: ((p.countryiso2 as string) || '').toLowerCase() || undefined,
    lon: p.lon as number,
    lat: p.lat as number
  }
}

export interface PlaneQuery {
  callsign: string
  lat: number
  lon: number
}

/**
 * One adsb.lol routeset request for a batch of planes. Returns a map of
 * callsign → route (only entries the API actually answered for).
 *
 * The response is an array; each element carries its own `callsign`, so results
 * are matched by name rather than by position. Index matching is only used as a
 * fallback when the API omits the callsign AND the array lines up 1:1 — matching
 * by position on a short/reordered response would attach one flight's route to
 * another, which is exactly the mismatch the display already has to guard
 * against.
 */
export async function lookupRoutes(batch: PlaneQuery[]): Promise<Map<string, RoutePorts>> {
  const out = new Map<string, RoutePorts>()
  if (!batch.length) return out
  const res = await fetch('https://api.adsb.lol/api/0/routeset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Some public APIs reject or silently drop requests from the default
      // runtime agent — identify the exhibit instead.
      'User-Agent': 'aviation-route-exhibit/0.1 (museum kiosk)'
    },
    body: JSON.stringify({
      planes: batch.map((p) => ({ callsign: p.callsign, lat: p.lat, lng: p.lon }))
    })
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${batch.length} planes`)
  // Read as text first: an empty 200 body (what an over-large batch returns)
  // would otherwise surface as a bare "Unexpected end of JSON input" with no
  // clue about the status, the batch size, or what came back.
  const text = await res.text()
  if (!text.trim()) throw new Error(`empty 200 body for ${batch.length} planes`)
  let arr: Record<string, unknown>[]
  try {
    arr = JSON.parse(text) as Record<string, unknown>[]
  } catch {
    throw new Error(`bad JSON for ${batch.length} planes: ${text.slice(0, 120)}`)
  }
  if (!Array.isArray(arr)) throw new Error(`not an array for ${batch.length} planes`)

  arr.forEach((row, i) => {
    const named = typeof row?.callsign === 'string' ? norm(row.callsign as string) : null
    const cs = named ?? (arr.length === batch.length ? norm(batch[i].callsign) : null)
    if (!cs) return
    const aps = row?._airports as Record<string, unknown>[] | undefined
    if (!Array.isArray(aps) || aps.length < 2) return
    const ports: RoutePorts = { origin: port(aps[0]), destination: port(aps[aps.length - 1]) }
    if (complete(ports)) out.set(cs, ports)
  })
  return out
}

// Only one resolution pass runs at a time; a poll arriving mid-pass is skipped
// rather than stacking requests on a free API.
let running = false

// The API's real per-request limit isn't documented, and exceeding it comes back
// as an empty 200 body rather than an error. Start at the configured size and
// halve on failure until requests go through, then stay there — so the exhibit
// finds a working batch size by itself instead of failing every cycle.
const MIN_CHUNK = 5
let chunkSize = Math.max(MIN_CHUNK, ROUTE_LOOKUP_CHUNK)
/** Failures tolerated per pass before giving up until the next poll. */
const MAX_FAILURES = 4

/**
 * Resolve routes for any of these planes we haven't asked about yet, in chunks,
 * sequentially, up to the per-poll cap. Callsigns the API doesn't answer for are
 * cached as "no route" so they aren't retried every cycle.
 */
export async function resolveRoutes(planes: PlaneQuery[]): Promise<void> {
  if (running) return
  const pending: PlaneQuery[] = []
  const seen = new Set<string>()
  for (const p of planes) {
    const cs = norm(p.callsign)
    if (!cs || seen.has(cs) || fresh(cache.get(cs))) continue
    seen.add(cs)
    pending.push({ ...p, callsign: cs })
  }
  if (!pending.length) return

  running = true
  const budget = ROUTE_LOOKUP_CHUNKS_PER_POLL * ROUTE_LOOKUP_CHUNK
  const work = pending.slice(0, budget)
  let found = 0
  let none = 0
  let i = 0
  let failures = 0
  try {
    while (i < work.length && failures < MAX_FAILURES) {
      const chunk = work.slice(i, i + chunkSize)
      let answers: Map<string, RoutePorts>
      try {
        answers = await lookupRoutes(chunk)
      } catch (err) {
        failures++
        if (chunkSize > MIN_CHUNK) {
          // Probably too many planes per request — shrink and retry the same
          // planes. The smaller size sticks, so later cycles start there.
          chunkSize = Math.max(MIN_CHUNK, Math.floor(chunkSize / 2))
          opsLog(`[routes] ${(err as Error).message} — retrying with batches of ${chunkSize}`)
          continue
        }
        // Even the smallest batch failed: the API is down or has changed. Fail
        // open (these planes stay visible) and wait for the next poll.
        opsLog(`[routes] lookup failed: ${(err as Error).message} — leaving the rest unknown`)
        break
      }
      for (const p of chunk) {
        const ports = answers.get(p.callsign) ?? null
        cacheRoute(p.callsign, ports)
        if (ports) found++
        else none++
      }
      i += chunk.length
    }
  } finally {
    running = false
  }
  if (found || none) {
    const skipped = pending.length - work.length
    opsLog(
      `[routes] resolved ${found + none} callsigns — route ${found} / none ${none}; ` +
        `cache ${cache.size}${skipped ? `, ${skipped} queued for next poll` : ''}`
    )
  }
}
