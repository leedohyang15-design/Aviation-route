// React hook shared by both windows: opens the Bus, tracks the live aircraft
// snapshot, the authoritative PresentationState, connection status, and the
// route for the selected aircraft.
//
// The Bus is created INSIDE the effect (not memoized) so React 18 StrictMode's
// mount→unmount→mount cycle disposes the first socket and builds a fresh one on
// the final mount — reusing a disposed Bus would leave it permanently closed and
// no data would ever arrive. Commands go through a stable `send` that targets
// whichever Bus is currently live.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bus } from '@shared/bus'
import { HUB_URL } from '@shared/config'
import {
  DEFAULT_PRESENTATION_STATE,
  type Aircraft,
  type ClientMessage,
  type FlightDetail,
  type GeoPoint,
  type PresentationState,
  type Satellite,
  type SatelliteDetail,
  type WeatherFrame
} from '@shared/types'

export interface HubView {
  send: (msg: ClientMessage) => void
  aircraft: Aircraft[]
  state: PresentationState
  connected: boolean
  source: 'opensky' | 'mock' | null
  /** Whether OpenSky credentials are configured (live data is possible). */
  credentials: boolean
  route: { icao24: string; points: GeoPoint[] | null }
  detail: FlightDetail | null
  satellites: Satellite[]
  satDetail: SatelliteDetail | null
  /** The newest assembled picture for each weather layer. */
  weather: { cloud: WeatherFrame | null; rain: WeatherFrame | null }
  /** How old the newest weather picture is, in whole minutes (null = none yet). */
  weatherAgeMin: number | null
}

/**
 * A new state object, but with every sub-object that didn't actually change
 * kept at its OLD identity.
 *
 * The hub answers every setView with the whole PresentationState, and a drag
 * emits ten of those a second. Each arrives as fresh JSON, so `filter`,
 * `hiddenOrbits` and `view` were new objects every time even when only `view`
 * had changed — which invalidated every useMemo keyed on them and made both
 * windows re-filter six thousand aircraft, or rebuild sixteen thousand
 * satellites, ten times a second while somebody was spinning the globe.
 * Comparing by value here is a few string compares; the work it saves is the
 * whole downstream pipeline.
 */
function reuseUnchanged<T extends object>(prev: T, next: T): T {
  const out = { ...next } as Record<string, unknown>
  let same = true
  for (const key of Object.keys(out)) {
    const a = (prev as Record<string, unknown>)[key]
    const b = out[key]
    if (a === b) continue
    if (typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b)) {
      out[key] = a // unchanged in value — keep the identity memos are keyed on
    } else {
      same = false
    }
  }
  return same && Object.keys(prev).length === Object.keys(out).length ? prev : (out as T)
}

export function useHub(role: 'control' | 'display'): HubView {
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [state, setState] = useState<PresentationState>(DEFAULT_PRESENTATION_STATE)
  const [connected, setConnected] = useState(false)
  const [source, setSource] = useState<'opensky' | 'mock' | null>(null)
  const [credentials, setCredentials] = useState(false)
  const [route, setRoute] = useState<{ icao24: string; points: GeoPoint[] | null }>({
    icao24: '',
    points: null
  })
  const [detail, setDetail] = useState<FlightDetail | null>(null)
  const [satellites, setSatellites] = useState<Satellite[]>([])
  const [satDetail, setSatDetail] = useState<SatelliteDetail | null>(null)
  const [weather, setWeather] = useState<{ cloud: WeatherFrame | null; rain: WeatherFrame | null }>(
    { cloud: null, rain: null }
  )
  // Recomputed on a slow tick rather than per render: the caption counts whole
  // minutes, so anything faster is work nobody can see.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const busRef = useRef<Bus | null>(null)

  useEffect(() => {
    const bus = new Bus(HUB_URL, role)
    busRef.current = bus
    bus.onMessage((msg) => {
      switch (msg.type) {
        case 'aircraft':
          setAircraft(msg.data)
          break
        case 'state':
          setState((prev) => reuseUnchanged(prev, msg.state))
          break
        case 'status':
          setSource(msg.source)
          setCredentials(msg.credentials)
          break
        case 'route':
          setRoute({ icao24: msg.icao24, points: msg.points })
          break
        case 'detail':
          setDetail(msg.detail)
          break
        case 'satellites':
          setSatellites(msg.data)
          break
        case 'satDetail':
          setSatDetail(msg.detail)
          break
        case 'weather':
          setWeather((prev) => ({ ...prev, [msg.frame.layer]: msg.frame }))
          break
      }
    })
    bus.onStatus(setConnected)
    bus.connect()
    return () => {
      bus.dispose()
      busRef.current = null
    }
  }, [role])

  const send = useCallback((msg: ClientMessage) => busRef.current?.send(msg), [])

  return {
    send,
    aircraft,
    state,
    connected,
    source,
    credentials,
    route,
    detail,
    satellites,
    satDetail,
    weather,
    weatherAgeMin: (() => {
      const newest = Math.max(weather.cloud?.time ?? 0, weather.rain?.time ?? 0)
      return newest ? Math.max(0, Math.round((now - newest) / 60_000)) : null
    })()
  }
}
