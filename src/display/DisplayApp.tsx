import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'

// The projector expects the equirect frame at exactly this pixel size, anchored
// top-left; the rest of the output stays black.
const FRAME = { w: 1664, h: 838 }

/** A duration as the figure that goes in the callout's accent slot. */
function hhmm(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60))
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`
}

interface Callout {
  prefix: string
  value: string
  suffix: string
}
const NOTHING: Callout = { prefix: '', value: '', suffix: '' }

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
  const callout = useMemo<Callout>(() => {
    if (isSat) {
      if (!state.selected) return NOTHING
      const sd = satDetail?.id === state.selected ? satDetail : null
      if (!sd) return { ...NOTHING, prefix: '위성을 찾는 중이에요' }
      if (sd.overheadNow) return { prefix: '지금', value: '우리 머리 위', suffix: '' }
      if (sd.nextPassSec == null) return { ...NOTHING, prefix: '우리나라 위로는 지나가지 않아요' }
      return { prefix: '머리 위까지', value: hhmm(sd.nextPassSec), suffix: '남음' }
    }
    if (!sel) return NOTHING
    // Once something is selected the frame always says SOMETHING about it. An
    // empty callout used to be the outcome for two ordinary cases — a flight on
    // final approach with nothing left to count down, and one whose route we
    // don't have — and in both the dome just went quiet with a plane
    // highlighted on it and no explanation.
    if (!d) return { ...NOTHING, prefix: '정보를 불러오는 중이에요' }
    const where = d.destination?.city ?? d.destination?.code
    if (!d.route) return { ...NOTHING, prefix: d.noRouteReason ?? '경로 정보가 없어요' }
    if (d.etaRemainingSec == null || d.etaRemainingSec < 60) {
      return { ...NOTHING, prefix: where ? `곧 ${where}에 도착해요` : '곧 도착해요' }
    }
    return { prefix: '도착까지', value: hhmm(d.etaRemainingSec), suffix: '남음' }
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
  useEffect(() => globeRef.current?.setCallout(callout.prefix, callout.value, callout.suffix), [callout])

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
