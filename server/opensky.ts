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
import { greatCirclePoints, greatCircleDistanceKm, nearestRouteIndex } from '../src/shared/projection'

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
      if (lon == null || lat == null) continue // no position → skip
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
        console.warn(
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
      console.error('[opensky] poll error:', (err as Error).message)
      return OPENSKY_POLL_INTERVAL_MS
    } finally {
      clearTimeout(to)
    }
  }

  return {
    source: 'opensky',
    start(onSnapshot, onStatus) {
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

interface RoutePorts {
  airline?: string
  origin?: { code: string; city?: string; lon: number; lat: number }
  destination?: { code: string; city?: string; lon: number; lat: number }
}

async function fetchRoute(callsign: string): Promise<RoutePorts | null> {
  if (!callsign) return null
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`)
    if (!res.ok) return null
    const j = (await res.json()) as any
    const fr = j?.response?.flightroute
    if (!fr) return null
    const port = (p: any) =>
      p && p.longitude != null && p.latitude != null
        ? {
            code: p.iata_code || p.icao_code || '',
            city: p.municipality,
            countryCode: (p.country_iso_name || '').toLowerCase() || undefined,
            lon: p.longitude,
            lat: p.latitude
          }
        : undefined
    return { airline: fr.airline?.name, origin: port(fr.origin), destination: port(fr.destination) }
  } catch {
    return null
  }
}

async function fetchType(icao24: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://hexdb.io/api/v1/aircraft/${icao24}`)
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
  // Key by icao24 + callsign so a new leg (new callsign) re-enriches instead of
  // reusing the previous leg's origin/destination.
  const key = `${icao24}|${ac?.callsign ?? ''}`
  const cached = cache.get(key)
  // Route/type are static per airframe/leg; recompute only progress/ETA below.
  const enrich =
    cached ??
    (await (async () => {
      const [ports, type] = await Promise.all([fetchRoute(ac?.callsign ?? ''), fetchType(icao24)])
      return {
        icao24,
        airline: ports?.airline,
        flightNo: ac?.callsign,
        origin: ports?.origin,
        destination: ports?.destination,
        aircraftType: type
      }
    })())
  // Only cache once the route actually resolved — otherwise a transient adsbdb
  // failure would be cached permanently and never retried.
  if (!cached && enrich.origin && enrich.destination) cache.set(key, enrich as FlightDetail)

  const detail: FlightDetail = { ...(enrich as FlightDetail), route: null }
  const o = detail.origin
  const d = detail.destination
  if (o && d) {
    const route = greatCirclePoints(o, d, 128)
    detail.route = route
    if (ac) {
      const idx = nearestRouteIndex(route, { lon: ac.lon, lat: ac.lat })
      detail.progress = route.length > 1 ? idx / (route.length - 1) : 0
      const remainKm = greatCircleDistanceKm({ lon: ac.lon, lat: ac.lat }, d)
      if (ac.velocity && ac.velocity > 20) detail.etaRemainingSec = (remainKm * 1000) / ac.velocity
    }
  }
  return detail
}
