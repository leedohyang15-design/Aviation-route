import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'

// The projector expects the equirect frame at exactly this pixel size, anchored
// top-left; the rest of the output stays black.
const FRAME = { w: 1664, h: 838 }

/** A duration as a big figure and the words around it. */
function hhmm(sec: number): { lead: string; unit: string } {
  const m = Math.max(0, Math.round(sec / 60))
  if (m < 60) return { lead: String(m), unit: '분' }
  return { lead: `${Math.floor(m / 60)}시간 ${m % 60}분`, unit: '' }
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

  /**
   * The one line the projected frame carries.
   *
   * Everything else that used to sit here — the flight number, the airline, the
   * altitude, the speed, the aircraft type — moved to the control screen, where
   * someone is close enough to read it. On the dome it was detail nobody could
   * resolve, competing with the thing they came to watch. What survives is the
   * single number a visitor actually wants from across a room: how long until it
   * gets there, or until it passes over us.
   */
  const callout = useMemo<{ lead: string; rest: string }>(() => {
    if (isSat) {
      const sd = state.selected && satDetail?.id === state.selected ? satDetail : null
      if (!sd) return { lead: '', rest: '' }
      if (sd.overheadNow) return { lead: '지금', rest: '우리 머리 위!' }
      if (sd.nextPassSec == null) return { lead: '', rest: '' }
      const { lead, unit } = hhmm(sd.nextPassSec)
      return { lead, rest: `${unit} 뒤 머리 위를 지나가요` }
    }
    if (!sel || !d || d.etaRemainingSec == null || d.etaRemainingSec <= 0) {
      return { lead: '', rest: '' }
    }
    const { lead, unit } = hhmm(d.etaRemainingSec)
    const where = d.destination?.city ?? d.destination?.code
    return { lead, rest: `${unit} 뒤 ${where ? `${where}에 ` : ''}도착해요` }
  }, [isSat, state.selected, satDetail, sel, d])

  useEffect(() => {
    if (!canvasRef.current) return
    // `sphere: true` — this frame is projected onto a dome, so icons are
    // corrected for the curvature that squashes them toward the poles.
    const globe = new Globe(canvasRef.current, { fixedSize: FRAME, sphere: true })
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
  useEffect(() => globeRef.current?.setCallout(callout.lead, callout.rest), [callout])

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
