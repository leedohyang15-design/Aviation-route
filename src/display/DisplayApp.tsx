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
  /** What the thing IS — the line that used to be missing. */
  title: string
  prefix: string
  value: string
  suffix: string
}
const NOTHING: Callout = { title: '', prefix: '', value: '', suffix: '' }

/**
 * The colour key for the layer on screen. Kept here rather than in the
 * renderer because these are the same colours and the same words the control
 * screen's chips use — one list, two places to read it.
 */
const FLIGHT_LEGEND = [
  { color: '#35c1ff', label: '여객기' },
  { color: '#f5a623', label: '화물기' },
  { color: '#74d16a', label: '군용기' },
  { color: '#93a4b8', label: '자가용 · 기타' }
] as const
const SAT_LEGEND = [
  { color: '#5ce1e6', label: '저궤도' },
  { color: '#b48cff', label: '스타링크' },
  { color: '#ffd166', label: '중궤도' },
  { color: '#ff7b6b', label: '정지궤도' }
] as const

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
    // Satellites carry no caption at all: the orbit line is the whole story on
    // the dome, and the pass forecast is on the control screen where it can be
    // read properly.
    // A satellite gets its name and nothing else. The pass forecast and the
    // orbital figures live on the control screen; on the dome the orbit line is
    // the whole story, and all the caption has to do is say whose it is.
    if (isSat) return satDetail ? { ...NOTHING, title: satDetail.name } : NOTHING
    if (!sel) return NOTHING
    // Once something is selected the frame always says SOMETHING about it. An
    // empty callout used to be the outcome for two ordinary cases — a flight on
    // final approach with nothing left to count down, and one whose route we
    // don't have — and in both the dome just went quiet with a plane
    // highlighted on it and no explanation.
    const flight = (sel.callsign || '').trim()
    if (!d) return { ...NOTHING, title: flight, prefix: '정보를 불러오는 중이에요' }
    const where = d.destination?.city ?? d.destination?.code
    const from = d.origin?.city ?? d.origin?.code
    // The name line: the flight number, then where it is going, so the dome
    // answers "what am I watching?" before it answers "how long?".
    const title = [flight || d.airline, from && where ? `${from} → ${where}` : where ?? d.airline]
      .filter(Boolean)
      .join('   ')
    if (!d.route) return { ...NOTHING, title, prefix: d.noRouteReason ?? '경로 정보가 없어요' }
    if (d.etaRemainingSec == null || d.etaRemainingSec < 60) {
      return { ...NOTHING, title, prefix: where ? `곧 ${where}에 도착해요` : '곧 도착해요' }
    }
    return { title, prefix: '도착까지', value: hhmm(d.etaRemainingSec), suffix: '남음' }
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
  useEffect(
    () => globeRef.current?.setCallout(callout.title, callout.prefix, callout.value, callout.suffix),
    [callout]
  )
  // The colour key, so the dome can be read without someone standing next to it.
  useEffect(
    () => globeRef.current?.setLegend(isSat ? SAT_LEGEND : FLIGHT_LEGEND),
    [isSat]
  )

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
