import { useEffect, useMemo, useRef } from 'react'
import type { FlightDetail, OrbitClass, SatelliteDetail } from '@shared/types'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'
import type { InfoCard, InfoTile } from './textures'

// The projector expects the equirect frame at exactly this pixel size, anchored
// top-left; the rest of the output stays black.
const FRAME = { w: 1664, h: 838 }

/** The orbit class, shown beside the state word on the card. */
const ORBIT_NOTE: Record<OrbitClass, string> = {
  leo: 'LEO',
  starlink: 'STARLINK',
  meo: 'MEO',
  geo: 'GEO'
}

/** How wide the countdown scale reads — an hour for a pass, six for a flight.
 * Past that the bar sits near empty and stops reading as progress. */
const PASS_SCALE_SEC = 3600

/** A countdown as a big figure plus its unit: `h:mm` needs none, minutes do. */
function countdown(sec: number): { value: string; unit?: string } {
  const m = Math.round(sec / 60)
  return m >= 60 ? { value: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` } : { value: String(m), unit: '분' }
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
    ...countdown(sd.nextPassSec),
    caption: '뒤 머리 위를 지나가요',
    fill: Math.max(0, Math.min(1, 1 - sd.nextPassSec / PASS_SCALE_SEC))
  }
}

/**
 * The satellite's span row: the launch it rode up on, and the laps it has flown
 * since. The marker sits at how far through its current orbit it is — the one
 * thing on the card that visibly moves.
 */
function satSpan(sd: SatelliteDetail): InfoCard['span'] {
  const years = sd.launchYear != null ? new Date().getFullYear() - sd.launchYear : null
  const shape =
    sd.apogeeKm != null && sd.perigeeKm != null && sd.apogeeKm - sd.perigeeKm >= 100
      ? '타원궤도'
      : '원궤도'
  return {
    leftValue: sd.launchYear != null ? String(sd.launchYear) : '—',
    leftLabel: years != null && years > 0 ? `${years}년째 비행` : '발사',
    rightValue: sd.revNumber != null ? sd.revNumber.toLocaleString() : '—',
    rightLabel: '바퀴 돌았어요',
    middle: shape,
    progress: null,
    marker: 'dot'
  }
}

function etaHero(d: FlightDetail): InfoCard['hero'] {
  if (d.etaRemainingSec == null || d.etaRemainingSec <= 0) {
    return { label: 'ETA', value: '—', caption: '곧 도착해요', fill: d.progress ?? null }
  }
  return {
    label: 'ETA',
    ...countdown(d.etaRemainingSec),
    caption: '뒤 도착해요',
    fill: d.progress ?? null
  }
}

/**
 * Total gate-to-gate time as "4H 05M". Preferred from the departure stamp;
 * otherwise back-calculated from how far along the route the aircraft is,
 * which real-data flights often have when the departure time is missing.
 */
function tripDuration(d: FlightDetail): string | null {
  let totalSec: number | null = null
  if (d.departureTime != null && d.etaRemainingSec != null) {
    totalSec = (Date.now() - d.departureTime) / 1000 + d.etaRemainingSec
  } else if (d.etaRemainingSec != null && d.progress != null && d.progress < 0.98) {
    totalSec = d.etaRemainingSec / (1 - d.progress)
  }
  if (totalSec == null || !Number.isFinite(totalSec) || totalSec <= 0) return null
  const m = Math.round(totalSec / 60)
  return `${Math.floor(m / 60)}H ${String(m % 60).padStart(2, '0')}M`
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
          title: '· · ·',
          note: 'ACQUIRING',
          tiles: [{ label: 'STATUS', value: '위성을 찾는 중' }]
        }
      }
      return {
        kind: 'satellite',
        title: sd.name,
        // The orbit class rides along with the state word: it's the one thing
        // about a satellite a visitor can act on ("that's the one that stands
        // still"), and this card has no other slot for it.
        note: `${ORBIT_NOTE[sd.orbit]} · TRACKING`,
        // The satellite's equivalent of a flight leg: where it came from (the
        // launch) and how far it has got (laps flown). Unlike altitude or speed,
        // these differ enormously between objects, which is what makes the card
        // worth reading twice.
        span: satSpan(sd),
        hero: satPassHero(sd),
        tiles: [
          { label: 'ALT', value: Math.round(sd.altKm).toLocaleString(), unit: 'km' },
          { label: 'VEL', value: sd.speedKmS.toFixed(1), unit: 'km/s' },
          { label: 'ORBIT', value: String(Math.round(sd.periodMin)), unit: 'min' },
          {
            label: 'RANGE',
            value: sd.rangeKm != null ? Math.round(sd.rangeKm).toLocaleString() : '—',
            unit: sd.rangeKm != null ? 'km' : undefined
          }
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
      header: {
        left: `✈ ${d?.airline ?? '항공편'}`,
        badge: routed ? 'EN ROUTE' : d ? 'NO ROUTE' : 'QUERYING'
      },
      title: flightNo,
      // Flight level: the altitude in hundreds of feet, as air traffic says it.
      note: sel.altitude != null ? `FL${Math.round((sel.altitude * 3.28084) / 100)}` : '',
      span: routed
        ? {
            leftValue: d!.origin?.code ?? '—',
            rightValue: d!.destination?.code ?? '—',
            // City names (Korean when known) read better than airport codes.
            leftLabel: d!.origin?.city ?? '',
            rightLabel: d!.destination?.city ?? '',
            middle: tripDuration(d!),
            progress: d!.progress ?? null,
            marker: 'plane'
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
