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
import { applySettings } from '@shared/live-settings'
import {
  DEFAULT_PRESENTATION_STATE,
  type Aircraft,
  type ClientMessage,
  type FlightDetail,
  type GeoPoint,
  type MarsLiveWire,
  type PresentationState,
  type Satellite,
  type SatelliteDetail,
  type LogLine,
  type SettingsView,
  type WeatherFrame
} from '@shared/types'

export interface HubView {
  send: (msg: ClientMessage) => void
  aircraft: Aircraft[]
  state: PresentationState
  connected: boolean
  source: 'opensky' | null
  /** Whether OpenSky credentials are configured (live data is possible). */
  credentials: boolean
  route: { icao24: string; points: GeoPoint[] | null }
  detail: FlightDetail | null
  satellites: Satellite[]
  /** When the element set behind those positions was downloaded, epoch ms. */
  tleAt: number | null
  /** Why the satellite tab is empty, when it is empty and not just loading.
   *  See the ServerMessage field this mirrors. */
  tleError: string | null
  satDetail: SatelliteDetail | null
  /** What the operator can change, as the hub allows a window to see it.
   *  Null until the hub's first message. */
  settings: SettingsView | null
  /** The operator log, oldest first. Empty until watchLog(true) is called —
   *  a window that is not showing the log does not carry it. */
  log: LogLine[]
  /** Start or stop receiving log lines. */
  watchLog: (on: boolean) => void
  /** The newest animation series for each weather layer, in loop order. */
  weather: { cloud: WeatherFrame[]; rain: WeatherFrame[]; wind: WeatherFrame[] }
  /** How old the newest weather picture is, in whole minutes (null = none yet). */
  weatherAt: number | null
  /** Live rover positions by probe id; empty until (or unless) the check lands. */
  marsLive: Record<string, MarsLiveWire>
  weatherSource: string | null
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
  const [source, setSource] = useState<'opensky' | null>(null)
  const [credentials, setCredentials] = useState(false)
  const [route, setRoute] = useState<{ icao24: string; points: GeoPoint[] | null }>({
    icao24: '',
    points: null
  })
  const [detail, setDetail] = useState<FlightDetail | null>(null)
  const [satellites, setSatellites] = useState<Satellite[]>([])
  const [tleAt, setTleAt] = useState<number | null>(null)
  const [tleError, setTleError] = useState<string | null>(null)
  const [satDetail, setSatDetail] = useState<SatelliteDetail | null>(null)
  /** Live rover positions, keyed by probe id. Empty until the daily check lands. */
  const [marsLive, setMarsLive] = useState<Record<string, MarsLiveWire>>({})
  const [weather, setWeather] = useState<{ cloud: WeatherFrame[]; rain: WeatherFrame[]; wind: WeatherFrame[] }>({
    cloud: [],
    rain: [],
    wind: []
  })
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [log, setLog] = useState<LogLine[]>([])
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
          // Only on a change: this arrives every couple of seconds and the
          // value moves once a day, so setting it unconditionally would
          // re-render the whole control window for nothing.
          setTleAt((prev) => (prev === msg.tleAt ? prev : msg.tleAt))
          setTleError((prev) => (prev === msg.tleError ? prev : msg.tleError))
          break
        case 'satDetail':
          setSatDetail(msg.detail)
          break
        case 'logHistory':
          setLog(msg.lines)
          break
        case 'log':
          setLog((prev) => {
            /*
             * A repeat updates the row it repeats, it does not add one.
             *
             * The hub counts identical consecutive lines rather than sending
             * them again, so the same id arriving twice means "that one now
             * says x2". Appending it would undo the counting and put the four
             * hundred copies straight back on screen.
             */
            const last = prev[prev.length - 1]
            if (last && last.id === msg.line.id) {
              const next = prev.slice()
              next[next.length - 1] = msg.line
              return next
            }
            // Same cap the hub keeps, so a window left open all week does not
            // grow without bound.
            const next = prev.length >= 2000 ? prev.slice(prev.length - 1999) : prev.slice()
            next.push(msg.line)
            return next
          })
          break
        case 'settings':
          /*
           * Into the module store FIRST, then into React.
           *
           * The three.js frame loop reads the module store sixty times a second
           * and never sees React state at all, so the order here decides
           * whether the very next frame draws the new numbers or the old ones.
           * The React copy is only for the settings screen's own inputs.
           */
          applySettings(msg.settings)
          setSettings(msg.settings)
          break
        case 'marsLive':
          setMarsLive(Object.fromEntries(msg.data.map((r) => [r.id, r])))
          break
        case 'weather': {
          // A series arrives one frame at a time, step 0 first. Step 0 is
          // therefore the signal to start a fresh series — otherwise a shorter
          // new series would keep the tail of the old one and the loop would
          // jump back in time every time it came round.
          const f = msg.frame
          const step = f.step ?? 0
          setWeather((prev) => {
            const next = step === 0 ? [] : prev[f.layer].slice()
            next[step] = f
            return { ...prev, [f.layer]: next }
          })
          break
        }
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
  const watchLog = useCallback((on: boolean) => {
    busRef.current?.send({ type: 'watchLog', on })
    if (!on) setLog([])
  }, [])

  return {
    send,
    aircraft,
    state,
    /** What the operator can change. Null until the hub's first message. */
    settings,
    log,
    watchLog,
    connected,
    source,
    credentials,
    route,
    detail,
    satellites,
    tleAt,
    tleError,
    satDetail,
    marsLive,
    weather,
    /** Whose imagery is on screen, taken from the newest frame so the badge
     * can never credit a source the picture did not come from. */
    weatherSource:
      [...weather.cloud, ...weather.rain].sort((a, b) => b.time - a.time)[0]?.source ?? null,
    /**
     * The moment the weather on screen describes, as a clock time.
     *
     * "59분 전" reads as a stale exhibit, and it invites the reasonable but
     * wrong conclusion that polling more often would fix it. It would not: the
     * model publishes on the hour, so asking every five minutes returns the
     * same hourly step. What the number actually means is "this is the 4pm
     * analysis", and saying THAT is both honest and unremarkable.
     */
    weatherAt: (() => {
      const newest = [...weather.cloud, ...weather.rain].reduce((n, f) => Math.max(n, f?.time ?? 0), 0)
      return newest || null
    })(),
 }
}
