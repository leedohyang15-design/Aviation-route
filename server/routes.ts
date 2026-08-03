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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planes: batch.map((p) => ({ callsign: p.callsign, lat: p.lat, lng: p.lon }))
    })
  })
  if (!res.ok) throw new Error(`adsb.lol routeset ${res.status}`)
  const arr = (await res.json()) as Record<string, unknown>[]
  if (!Array.isArray(arr)) throw new Error('adsb.lol routeset: unexpected response shape')

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
  try {
    for (let i = 0; i < work.length; i += ROUTE_LOOKUP_CHUNK) {
      const chunk = work.slice(i, i + ROUTE_LOOKUP_CHUNK)
      let answers: Map<string, RoutePorts>
      try {
        answers = await lookupRoutes(chunk)
      } catch (err) {
        // Fail open: leave this chunk unknown (so its planes stay visible) and
        // stop for this cycle instead of hammering an API that just failed.
        opsLog(`[routes] lookup failed: ${(err as Error).message} — leaving ${chunk.length} unknown`)
        break
      }
      for (const p of chunk) {
        const ports = answers.get(p.callsign) ?? null
        cacheRoute(p.callsign, ports)
        if (ports) found++
        else none++
      }
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
