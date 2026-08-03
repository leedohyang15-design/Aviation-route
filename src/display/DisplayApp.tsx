import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'

// The projector expects the equirect frame at exactly this pixel size, anchored
// top-left; the rest of the output stays black.
const FRAME = { w: 1664, h: 838 }

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

  // Compact info string shown next to the selected plane (instead of a big card):
  // flight no / origin→destination (or category · route unknown) / altitude·speed·type.
  const infoLines = useMemo(() => {
    if (isSat) {
      if (!state.selected) return null
      const sd = satDetail && satDetail.id === state.selected ? satDetail : null
      if (!sd) return ['위성을 찾는 중… 🛰']
      const lines = [sd.name]
      if (sd.overheadNow) lines.push('🛰 지금 우리 하늘 위!')
      else if (sd.nextPassSec != null) {
        const m = Math.round(sd.nextPassSec / 60)
        lines.push(m >= 60 ? `🛰 ${Math.floor(m / 60)}시간 ${m % 60}분 뒤 머리 위` : `🛰 ${m}분 뒤 머리 위`)
      } else lines.push('우리나라 위로는 안 지나가요')
      lines.push(
        `${Math.round(sd.altKm).toLocaleString()}km · ${sd.speedKmS.toFixed(1)}km/s · 한 바퀴 ${Math.round(sd.periodMin)}분`
      )
      return lines
    }
    if (!sel) return null
    const flightNo = d?.flightNo ?? sel.callsign?.trim() ?? sel.icao24.toUpperCase()
    const lines = [flightNo]
    if (!d) {
      // Detail still loading (lookup in flight) — transient placeholder.
      lines.push('여행 중… ✈')
    } else if (d.origin?.code || d.destination?.code) {
      // City names (Korean when known) read better than airport codes for kids.
      const o = d.origin?.city ?? d.origin?.code ?? '—'
      const de = d.destination?.city ?? d.destination?.code ?? '—'
      lines.push(`${o} → ${de}`)
      // Fun countdown to arrival.
      if (d.etaRemainingSec != null && d.etaRemainingSec > 0) {
        const h = Math.floor(d.etaRemainingSec / 3600)
        const m = Math.round((d.etaRemainingSec % 3600) / 60)
        lines.push(`🛬 도착까지 ${h > 0 ? `${h}시간 ` : ''}${m}분`)
      }
    } else {
      // Detail resolved but no route: show WHY (the control auto-advances after
      // ~10s). Don't keep saying "여행 중" once the lookup has actually failed.
      lines.push(d.noRouteReason ?? '경로 미확인')
    }
    const bits: string[] = []
    if (sel.altitude != null) bits.push(`${Math.round(sel.altitude).toLocaleString()}m`)
    if (sel.velocity != null) bits.push(`${Math.round(sel.velocity * 3.6)}km/h`)
    if (d?.aircraftType) bits.push(d.aircraftType)
    if (bits.length) lines.push(bits.join(' · '))
    return lines
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
  useEffect(() => globeRef.current?.setInfoLabel(infoLines), [infoLines])

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
