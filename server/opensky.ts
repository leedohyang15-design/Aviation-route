// OpenSky Network feed. Uses OAuth2 client-credentials (the current OpenSky auth
// scheme) so a single backend can poll the worldwide /states/all endpoint.
//
// Provision credentials at https://opensky-network.org/ (account → API client)
// and inject them as env vars:
//   OPENSKY_CLIENT_ID, OPENSKY_CLIENT_SECRET
//
// Only ONE process should ever poll — that is exactly what the hub is for.

import type { Aircraft } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { OPENSKY_POLL_INTERVAL_MS } from '../src/shared/config'

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
    try {
      const bearer = await fetchToken()
      const ctrl = new AbortController()
      const to = setTimeout(() => ctrl.abort(), 15_000)
      const res = await fetch(STATES_URL, {
        headers: { Authorization: `Bearer ${bearer}` },
        signal: ctrl.signal
      })
      clearTimeout(to)

      if (res.status === 429) {
        // Out of credits: honour the server's retry-after (default 5 min).
        const retry = Number(res.headers.get('X-Rate-Limit-Retry-After-Seconds')) || 300
        onStatus(false)
        console.warn(`[opensky] rate limited (429). Backing off ${retry}s.`)
        return retry * 1000
      }
      if (!res.ok) throw new Error(`OpenSky /states/all failed: ${res.status}`)

      const remaining = res.headers.get('X-Rate-Limit-Remaining')
      const json = (await res.json()) as { time: number; states: RawState[] | null }
      const aircraft = normalize(json.states ?? [], json.time)
      onStatus(true)
      onSnapshot(aircraft)
      if (remaining != null) console.log(`[opensky] ${aircraft.length} aircraft, ${remaining} credits left`)
      return OPENSKY_POLL_INTERVAL_MS
    } catch (err) {
      onStatus(false)
      console.error('[opensky] poll error:', (err as Error).message)
      return OPENSKY_POLL_INTERVAL_MS
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
    // OpenSky /states/all carries no origin/destination, so no route yet.
    // P3 enrichment (adsbdb.com / hexdb.io) would populate this.
    getRoute() {
      return null
    }
  }
}
