// React hook shared by both windows: opens the Bus, tracks the live aircraft
// snapshot, the authoritative PresentationState, connection status, and the
// route for the selected aircraft.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bus } from '@shared/bus'
import { HUB_URL } from '@shared/config'
import {
  DEFAULT_PRESENTATION_STATE,
  type Aircraft,
  type GeoPoint,
  type PresentationState
} from '@shared/types'

export interface HubView {
  bus: Bus
  aircraft: Aircraft[]
  state: PresentationState
  connected: boolean
  source: 'opensky' | 'mock' | null
  route: { icao24: string; points: GeoPoint[] | null }
}

export function useHub(role: 'control' | 'display'): HubView {
  const bus = useMemo(() => new Bus(HUB_URL, role), [role])
  const [aircraft, setAircraft] = useState<Aircraft[]>([])
  const [state, setState] = useState<PresentationState>(DEFAULT_PRESENTATION_STATE)
  const [connected, setConnected] = useState(false)
  const [source, setSource] = useState<'opensky' | 'mock' | null>(null)
  const [route, setRoute] = useState<{ icao24: string; points: GeoPoint[] | null }>({
    icao24: '',
    points: null
  })
  // Avoid re-subscribing when only data changes.
  const busRef = useRef(bus)
  busRef.current = bus

  useEffect(() => {
    const off = bus.onMessage((msg) => {
      switch (msg.type) {
        case 'aircraft':
          setAircraft(msg.data)
          break
        case 'state':
          setState(msg.state)
          break
        case 'status':
          setSource(msg.source)
          break
        case 'route':
          setRoute({ icao24: msg.icao24, points: msg.points })
          break
      }
    })
    const offStatus = bus.onStatus(setConnected)
    bus.connect()
    return () => {
      off()
      offStatus()
      bus.dispose()
    }
  }, [bus])

  return { bus, aircraft, state, connected, source, route }
}
