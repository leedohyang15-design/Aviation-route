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
  const { aircraft, state, route, detail } = useHub('display')

  const visible = useMemo(
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, state.filter, state.selected]
  )
  const sel = state.selected ? visible.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

  // Compact info string shown next to the selected plane (instead of a big card):
  // flight no / origin→destination / altitude·speed·type.
  const infoLines = useMemo(() => {
    if (!sel) return null
    const flightNo = d?.flightNo ?? sel.callsign?.trim() ?? sel.icao24.toUpperCase()
    const lines = [flightNo]
    if (d?.origin?.code || d?.destination?.code) {
      lines.push(`${d?.origin?.code ?? '—'} → ${d?.destination?.code ?? '—'}`)
    }
    const bits: string[] = []
    if (sel.altitude != null) bits.push(`${Math.round(sel.altitude).toLocaleString()}m`)
    if (sel.velocity != null) bits.push(`${Math.round(sel.velocity * 3.6)}km/h`)
    if (d?.aircraftType) bits.push(d.aircraftType)
    if (bits.length) lines.push(bits.join(' · '))
    return lines
  }, [sel, d])

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

  useEffect(() => globeRef.current?.setAircraft(visible), [visible])
  useEffect(() => globeRef.current?.setView(state.view), [state.view])
  useEffect(() => globeRef.current?.setOverlays(state.overlays), [state.overlays])
  useEffect(() => globeRef.current?.setSelected(state.selected), [state.selected])
  useEffect(() => globeRef.current?.setRoute(route.points), [route])
  useEffect(() => globeRef.current?.setNightHour(state.dayNightHour), [state.dayNightHour])
  useEffect(() => {
    globeRef.current?.setEndpointLabels(d?.origin?.city ?? null, d?.destination?.city ?? null)
    globeRef.current?.setEndpointFlags(
      d?.origin?.countryCode ?? null,
      d?.destination?.countryCode ?? null
    )
  }, [d])
  useEffect(() => globeRef.current?.setInfoLabel(infoLines), [infoLines])

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
