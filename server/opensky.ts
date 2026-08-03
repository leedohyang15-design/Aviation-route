// OpenSky Network feed. Uses OAuth2 client-credentials (the current OpenSky auth
// scheme) so a single backend can poll the worldwide /states/all endpoint.
//
// Provision credentials at https://opensky-network.org/ (account → API client)
// and inject them as env vars:
//   OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET
//
// Only ONE process should ever poll — that is exactly what the hub is for.

import type { Aircraft, FlightDetail } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { OPENSKY_POLL_INTERVAL_MS } from '../src/shared/config'
import {
  greatCirclePoints,
  greatCircleDistanceKm,
  isPlausibleCoord,
  nearestRouteIndex
} from '../src/shared/projection'
import { flightCategory } from '../src/common/flightClass'
import { cachedRoute, cacheRoute, lookupRoute, queueRoute } from './routes'
import { opsLog } from './log'

const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const STATES_URL = 'https://opensky-network.org/api/states/all'

// Index positions in the OpenSky "state vector" array.
const enum S {
  icao24 = 0,
  callsign = 1,
  originCountry = 2,
  lastContact = 4,
  lon = 5,
  lat = 6,
  baroAltitude = 7,
  onGround = 8,
  velocity = 9,
  trueTrack = 10,
  verticalRate = 11
}

type RawState = (number | string | boolean | null)[]

export function hasOpenSkyCredentials(): boolean {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET)
}

export function createOpenSkyFeed(): FlightFeed {
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  let token: string | null = null
  let tokenExpiry = 0
  // Latest position per aircraft, for detail lookups (progress/ETA).
  const latest = new Map<string, Aircraft>()
  // Enrichment cache keyed by icao24 (routes rarely change during a session).
  const detailCache = new Map<string, FlightDetail>()

  async function fetchToken(): Promise<string> {
    const now = Date.now()
    if (token && now < tokenExpiry - 30_000) return token

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID as string,
      client_secret: process.env.OPENSKY_CLIENT_SECRET as string
    })
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    if (!res.ok) {
      // Surface OpenSky's reason (e.g. "invalid_client") to make 401s diagnosable.
      const detail = await res.text().catch(() => '')
      throw new Error(`OpenSky token request failed: ${res.status} ${detail}`.trim())
    }
    const json = (await res.json()) as { access_token: string; expires_in: number }
    token = json.access_token
    tokenExpiry = now + json.expires_in * 1000
    return token
  }

  function normalize(states: RawState[], serverTime: number): Aircraft[] {
    const out: Aircraft[] = []
    for (const s of states) {
      const lon = s[S.lon] as number | null
      const lat = s[S.lat] as number | null
      // No position, an impossible one, or the null-island placeholder → skip.
      // Drawing those puts a phantom dot on the equator at 0°E.
      if (lon == null || lat == null || !isPlausibleCoord(lon, lat)) continue
      out.push({
        icao24: (s[S.icao24] as string) ?? '',
        callsign: ((s[S.callsign] as string) ?? '').trim(),
        lon,
        lat,
        altitude: (s[S.baroAltitude] as number | null) ?? null,
        velocity: (s[S.velocity] as number | null) ?? null,
        heading: (s[S.trueTrack] as number | null) ?? null,
        verticalRate: (s[S.verticalRate] as number | null) ?? null,
        onGround: Boolean(s[S.onGround]),
        originCountry: (s[S.originCountry] as string) ?? '',
        lastContact: ((s[S.lastContact] as number | null) ?? serverTime) * 1000
      })
    }
    return out
  }

  /** Poll once; returns how many ms to wait before the next poll. */
  async function poll(
    onSnapshot: (a: Aircraft[]) => void,
    onStatus: (connected: boolean) => void
  ): Promise<number> {
    const ctrl = new AbortController()
    const to = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const bearer = await fetchToken()
      const res = await fetch(STATES_URL, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: ctrl.signal
      })

      if (res.status === 401) {
        // Token rejected (revoked / early expiry). Drop it so the next poll
        // fetches a fresh one instead of looping on the dead token.
        token = null
        tokenExpiry = 0
        throw new Error('OpenSky /states/all failed: 401 (token invalidated)')
      }
      if (res.status === 429) {
        // Out of credits: honour the server's retry-after but cap it so we
        // re-check periodically and recover automatically after the daily reset.
        // The mock fallback covers the screen meanwhile.
        const retry = Number(res.headers.get('X-Rate-Limit-Retry-After-Seconds')) || 300
        const wait = Math.min(retry, 30 * 60) // cap at 30 min
        onStatus(false)
        opsLog(
          `[opensky] rate limited (429). Credits exhausted; server says retry in ${retry}s. ` +
            `Re-checking in ${wait}s; mock fallback is covering the display.`
        )
        return wait * 1000
      }
      if (!res.ok) throw new Error(`OpenSky /states/all failed: ${res.status}`)

      const remaining = res.headers.get('X-Rate-Limit-Remaining')
      const json = (await res.json()) as { time: number; states: RawState[] | null }
      const aircraft = normalize(json.states ?? [], json.time)
      latest.clear()
      for (const a of aircraft) latest.set(a.icao24, a)
      onStatus(true)
      onSnapshot(aircraft)
      if (remaining != null) console.log(`[opensky] ${aircraft.length} aircraft, ${remaining} credits left`)
      return OPENSKY_POLL_INTERVAL_MS
    } catch (err) {
      onStatus(false)
      // "fetch failed" is undici's generic wrapper; the real reason (DNS,
      // refused connection, TLS, timeout/abort) is in err.cause. Surface it so a
      // transient blip can be told apart from a real network/firewall problem.
      const e = err as Error & { cause?: { message?: string; code?: string } }
      const cause = e.cause?.code || e.cause?.message
      opsLog(
        `[opensky] poll error: ${e.message}${cause ? ` — cause: ${cause}` : ''}. ` +
          `Mock fallback covers the screen; retrying in ${OPENSKY_POLL_INTERVAL_MS / 1000}s.`
      )
      return OPENSKY_POLL_INTERVAL_MS
    } finally {
      clearTimeout(to)
    }
  }

  return {
    source: 'opensky',
    start(onSnapshot, onStatus) {
      stopped = false // allow a restart after stop() (satellite mode pauses us)
      const loop = async () => {
        if (stopped) return
        const wait = await poll(onSnapshot, onStatus)
        if (!stopped) timer = setTimeout(loop, wait)
      }
      void loop()
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
    },
    getDetail(icao24: string) {
      return buildDetail(icao24, latest, detailCache)
    }
  }
}

// ---------------------------------------------------------------------------
// Enrichment: OpenSky states carry no origin/destination/type, so fetch them
// best-effort from public APIs and cache. Failures degrade to partial detail.
// ---------------------------------------------------------------------------

async function fetchType(icao24: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(icao24)}`)
    if (!res.ok) return undefined
    const j = (await res.json()) as any
    return j?.Type || j?.ICAOTypeCode || undefined
  } catch {
    return undefined
  }
}

async function buildDetail(
  icao24: string,
  latest: Map<string, Aircraft>,
  cache: Map<string, FlightDetail>
): Promise<FlightDetail | null> {
  const ac = latest.get(icao24)
  const callsign = ac?.callsign?.trim() ?? ''
  // Key by icao24 + callsign so a new leg (new callsign) re-enriches instead of
  // reusing the previous leg's origin/destination.
  const key = `${icao24}|${callsign}`
  const prev = cache.get(key) as (FlightDetail & { _ts?: number }) | undefined

  // The route comes from the SHARED cache in routes.ts — the same one the
  // background resolver fills and writes to disk. This module used to keep its
  // own duplicate adsbdb client, which meant every selection made a fresh
  // network request even though the answer was already cached, competing with
  // the resolver for the same free API. Worse, that client swallowed every error
  // — including 429 — as "no route", so once the resolver had wound itself up to
  // several lookups a second, every aircraft a visitor tapped came back with no
  // route at all. It also still called adsb.lol, an endpoint proven not to exist.
  let ports = cachedRoute(callsign)
  let rateLimited = false
  if (ports === undefined && callsign) {
    try {
      ports = await lookupRoute(callsign)
      cacheRoute(callsign, ports) // the resolver benefits from this answer too
    } catch {
      // Rate-limited or unreachable. Leave it UNKNOWN rather than caching a
      // negative — and hand it to the resolver, which paces itself and backs off.
      ports = undefined
      rateLimited = true
      queueRoute(callsign)
    }
  }

  // The aircraft type is separate (hexdb, keyed by airframe) and rarely changes,
  // so it is worth keeping on the per-selection cache.
  let type = prev?.aircraftType
  if (type === undefined && !prev) type = await fetchType(icao24)

  const enrich: FlightDetail & { _ts?: number } = {
    icao24,
    airline: ports?.airline,
    flightNo: callsign || undefined,
    origin: ports?.origin,
    destination: ports?.destination,
    aircraftType: type,
    route: null,
    _ts: Date.now()
  }
  cache.set(key, enrich)

  const detail: FlightDetail = { ...(enrich as FlightDetail), route: null }
  const o = detail.origin
  const d = detail.destination
  let mismatch = false
  if (o && d) {
    const route = greatCirclePoints(o, d, 128)
    const here = ac ? { lon: ac.lon, lat: ac.lat } : null
    const idx = here ? nearestRouteIndex(route, here) : 0
    // Sanity-check the route against where the plane actually is: we only want
    // to reject a callsign that has been mapped to a completely different flight
    // (another continent), not a real one that isn't flying the exact great
    // circle.
    //
    // The old fixed 800km budget rejected an enormous number of genuine
    // long-haul flights. Aircraft do not fly great circles: North Atlantic
    // tracks, ETOPS routing, weather, and above all the airspace closures that
    // send Europe↔Asia traffic on long southern detours all put a perfectly
    // normal flight one to two thousand kilometres off the direct line. Those
    // were the flights showing "경로를 확인하는 중이에요" forever.
    //
    // Scale the budget with the length of the trip instead — a short hop really
    // can't be 500km off course, a 10,000km one easily can.
    const routeKm = greatCircleDistanceKm(o, d)
    // A third of the trip, floored at 500km and capped at 3,000km. Measured
    // against real cases: a Seoul–London southern routing sits ~2,400km off the
    // direct line, while a callsign matched to the wrong flight is 8,000km or
    // more out — so there is a wide margin between "detouring" and "not this
    // flight at all".
    const budgetKm = Math.min(3000, Math.max(500, routeKm * 0.32))
    const offRouteKm = here ? greatCircleDistanceKm(here, route[idx]) : 0
    if (offRouteKm > budgetKm) {
      detail.origin = undefined
      detail.destination = undefined
      mismatch = true
    } else {
      detail.route = route
      const progress = route.length > 1 ? idx / (route.length - 1) : 0
      detail.progress = progress
      // Estimate departure + remaining time from progress and total flight time
      // (great-circle distance ÷ ground speed). OpenSky gives no schedule.
      if (ac && ac.velocity && ac.velocity > 20) {
        const totalSec = (greatCircleDistanceKm(o, d) * 1000) / ac.velocity
        detail.etaRemainingSec = (1 - progress) * totalSec
        detail.departureTime = Date.now() - progress * totalSec * 1000
      }
    }
  }

  // No route line? Explain why on both screens — and be honest about the
  // difference between "we asked and there is none" and "we haven't been able
  // to ask yet", which used to read identically.
  if (!detail.route) {
    detail.noRouteReason = !callsign
      ? '정보가 없는 비행기예요'
      : rateLimited || ports === undefined
        ? '경로를 찾는 중이에요'
        : mismatch
          ? '지금은 경로를 알 수 없어요'
          : flightCategory(callsign) === 'military'
            ? '비밀 비행기예요 🤫'
            : '경로 정보가 없어요'
  }
  return detail
}
