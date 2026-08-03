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
  type SatelliteDetail
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
          setState(msg.state)
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
    satDetail
  }
}
