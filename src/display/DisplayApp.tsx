import { useEffect, useMemo, useRef } from 'react'
import type { FlightDetail, OrbitClass, SatelliteDetail } from '@shared/types'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'
import type { InfoCard, InfoTile } from './textures'

// The projector expects the equirect frame at exactly this pixel size, anchored
// top-left; the rest of the output stays black.
const FRAME = { w: 1664, h: 838 }

/** The class shown on the card's side tab. */
const ORBIT_TAB: Record<OrbitClass, string> = {
  leo: 'LEO',
  starlink: 'STARLINK',
  meo: 'MEO',
  geo: 'GEO'
}

/** How wide the countdown scale reads — an hour for a pass, six for a flight.
 * Past that the bar sits near empty and stops reading as progress. */
const PASS_SCALE_SEC = 3600

/** A duration split into the big mono number and the words after it: `h:mm`
 * needs no unit, bare minutes do. */
function duration(sec: number, tail: string): { value: string; caption: string } {
  const m = Math.round(sec / 60)
  return m >= 60
    ? { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, caption: tail }
    : { value: String(m), caption: `분 ${tail}` }
}

function satPassHero(sd: SatelliteDetail): InfoCard['hero'] {
  if (sd.overheadNow) {
    return { label: 'T−', value: 'NOW', caption: '지금 우리 하늘 위에 있어요', fill: 1 }
  }
  if (sd.nextPassSec == null) {
    return { label: 'T−', value: '—', caption: '우리나라 위로는 안 지나가요', fill: null }
  }
  return {
    label: 'T−',
    ...duration(sd.nextPassSec, '뒤 머리 위를 지나가요'),
    fill: Math.max(0, Math.min(1, 1 - sd.nextPassSec / PASS_SCALE_SEC))
  }
}

function etaHero(d: FlightDetail): InfoCard['hero'] {
  if (d.etaRemainingSec == null || d.etaRemainingSec <= 0) {
    return { label: 'ETA', value: '—', caption: '곧 도착해요', fill: d.progress ?? null }
  }
  return { label: 'ETA', ...duration(d.etaRemainingSec, '뒤 도착해요'), fill: d.progress ?? null }
}

/** Why there's no route — or that we're still asking. */
function noRouteText(d: FlightDetail | null): string {
  if (!d) return '경로를 찾는 중이에요'
  return d.noRouteReason ?? '공개된 경로 정보가 없어요'
}

export function DisplayApp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const { aircraft, state, route, detail, satellites, satDetail } = useHub('display')
  const isSat = state.mode === 'satellite'
  const satVisible = useMemo(
    () => satellites.filter((x) => !(state.hiddenOrbits ?? []).includes(x.orbit)),
    [satellites, state.hiddenOrbits]
  )

  const visible = useMemo(
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, state.filter, state.selected]
  )
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

  // The instrument card shown next to the selected object on the dome.
  const infoCard = useMemo<InfoCard | null>(() => {
    if (isSat) {
      if (!state.selected) return null
      const sd = satDetail && satDetail.id === state.selected ? satDetail : null
      if (!sd) {
        return {
          kind: 'satellite',
          heading: 'SATELLITE — 위성',
          tab: '',
          title: '· · ·',
          status: 'ACQUIRING',
          tiles: [{ label: 'STATUS', value: '위성을 찾는 중' }]
        }
      }
      return {
        kind: 'satellite',
        heading: 'SATELLITE — 위성',
        tab: ORBIT_TAB[sd.orbit],
        title: sd.name,
        status: 'TRACKING',
        hero: satPassHero(sd),
        tiles: [
          { label: 'ALT', value: Math.round(sd.altKm).toLocaleString(), unit: 'km' },
          { label: 'VEL', value: sd.speedKmS.toFixed(1), unit: 'km/s' },
          { label: 'ORBIT', value: String(Math.round(sd.periodMin)), unit: 'min' }
        ]
      }
    }
    if (!sel) return null
    const flightNo = d?.flightNo ?? sel.callsign?.trim() ?? sel.icao24.toUpperCase()
    const tiles: InfoTile[] = [
      {
        label: 'ALT',
        value: sel.altitude != null ? Math.round(sel.altitude).toLocaleString() : '—',
        unit: sel.altitude != null ? 'm' : undefined
      },
      {
        label: 'GS',
        value: sel.velocity != null ? String(Math.round(sel.velocity * 3.6)) : '—',
        unit: sel.velocity != null ? 'km/h' : undefined
      },
      { label: 'TYPE', value: d?.aircraftType ?? '—' }
    ]
    const routed = !!(d && (d.origin?.code || d.destination?.code))
    return {
      kind: 'aircraft',
      heading: 'AIRCRAFT — 비행기',
      // Flight level: the altitude in hundreds of feet, as air traffic says it.
      tab: sel.altitude != null ? `FL${Math.round((sel.altitude * 3.28084) / 100)}` : '',
      title: flightNo,
      status: routed ? 'EN ROUTE' : d ? 'NO ROUTE' : 'QUERYING',
      leg: routed
        ? {
            // City names (Korean when known) read better than airport codes.
            from: d!.origin?.city ?? d!.origin?.code ?? '—',
            to: d!.destination?.city ?? d!.destination?.code ?? '—',
            progress: d!.progress ?? null
          }
        : undefined,
      hero: routed ? etaHero(d!) : { label: '', value: '—', caption: noRouteText(d), fill: null },
      tiles
    }
  }, [isSat, state.selected, satDetail, sel, d])

  useEffect(() => {
    if (!canvasRef.current) return
    const globe = new Globe(canvasRef.current, { fixedSize: FRAME })
    globeRef.current = globe
    globe.start()
    const onResize = () => globe.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      globe.dispose()
      globeRef.current = null
    }
  }, [])

  useEffect(() => {
    globeRef.current?.setObjectKind(isSat ? 'satellite' : 'aircraft')
    globeRef.current?.clearObjects()
  }, [isSat])
  useEffect(() => {
    if (!isSat) globeRef.current?.setAircraft(visible)
  }, [isSat, visible])
  useEffect(() => {
    if (isSat) globeRef.current?.setSatellites(satVisible)
  }, [isSat, satVisible])
  useEffect(() => globeRef.current?.setView(state.view), [state.view])
  useEffect(() => globeRef.current?.setOverlays(state.overlays), [state.overlays])
  useEffect(() => globeRef.current?.setSelected(state.selected), [state.selected])
  useEffect(() => globeRef.current?.setRoute(route.points), [route])
  useEffect(() => globeRef.current?.setNightHour(state.dayNightHour), [state.dayNightHour])
  useEffect(() => {
    // Satellites have no origin or destination, so never carry the aviation
    // place names and flags across a mode switch.
    if (isSat) {
      globeRef.current?.setEndpointLabels(null, null)
      globeRef.current?.setEndpointFlags(null, null)
      return
    }
    globeRef.current?.setEndpointLabels(d?.origin?.city ?? null, d?.destination?.city ?? null)
    globeRef.current?.setEndpointFlags(
      d?.origin?.countryCode ?? null,
      d?.destination?.countryCode ?? null
    )
  }, [isSat, d])
  useEffect(() => globeRef.current?.setInfoCard(infoCard), [infoCard])

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
