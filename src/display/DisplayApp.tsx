import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'
import type { OrbitClass } from '@shared/types'

const ORBIT_LABEL: Record<OrbitClass, string> = {
  leo: '저궤도',
  starlink: '스타링크',
  meo: '중궤도',
  geo: '정지궤도'
}

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

export function DisplayApp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const { send, aircraft, state, route, detail, satellites, satDetail, weather, weatherAt } =
    useHub('display')
  const mode = state.mode
  const isSat = mode === 'satellite'
  const isWeather = mode === 'weather'
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
    // Weather has nothing to select, so the plate says what the picture is and
    // how old it is — the one thing that stops a still image reading as a
    // decoration rather than as today's sky.
    if (isWeather) {
      if (!weatherAt) return { ...NOTHING, title: '지구의 날씨', prefix: '영상을 불러오는 중이에요' }
      const t = new Date(weatherAt)
      const hh = t.getHours()
      const label = `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}시${t.getMinutes() ? ` ${t.getMinutes()}분` : ''}`
      return { ...NOTHING, title: '지구의 날씨', prefix: `${label} 기준` }
    }
    // Satellites carry no caption at all: the orbit line is the whole story on
    // the dome, and the pass forecast is on the control screen where it can be
    // read properly.
    // The satellite plate answers the same two questions the aircraft one does:
    // what is it, and when does it get here. "When does it get here" for
    // something in orbit is when it comes over us, which is the one number that
    // makes a dot on a map feel like it is about to be overhead.
    if (isSat) {
      const sd = satDetail
      if (!sd) return NOTHING
      const title = `${sd.name}   ${ORBIT_LABEL[sd.orbit]} · ${Math.round(sd.altKm).toLocaleString()} km`
      if (sd.overheadNow) return { ...NOTHING, title, prefix: '지금 우리 머리 위에 있어요' }
      if (sd.nextPassSec == null) {
        // Geostationary satellites sit over one spot forever; the rest of the
        // "never" cases are orbits whose inclination never reaches us.
        return {
          ...NOTHING,
          title,
          prefix: sd.orbit === 'geo' ? '적도 위 한자리에 멈춰 있어요' : '우리 하늘로는 지나가지 않아요'
        }
      }
      return { title, prefix: '머리 위까지', value: hhmm(sd.nextPassSec), suffix: '남음' }
    }
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
  }, [isSat, isWeather, weatherAt, state.selected, satDetail, sel, d])

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
  }, [mode, isSat])
  useEffect(() => {
    if (mode === 'flight') globeRef.current?.setAircraft(visible)
  }, [mode, visible])
  useEffect(() => {
    if (isSat) globeRef.current?.setSatellites(satVisible)
  }, [isSat, satVisible])
  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    // Only the dome window reports. Both windows decode the same pixels and
    // would reach the same numbers, so wiring both would double every line.
    g.onNote = (text) => send({ type: 'note', text })
  }, [send])

  // Each layer is hung on or taken off the earth on its own, so a chip toggles
  // instantly instead of waiting for the next poll.
  useEffect(() => {
    const on = !(state.hiddenWeather ?? []).includes('cloud')
    globeRef.current?.setWeatherSeries(isWeather && on ? weather.cloud : null, 'cloud')
  }, [isWeather, weather.cloud, state.hiddenWeather])
  useEffect(() => {
    const on = !(state.hiddenWeather ?? []).includes('rain')
    globeRef.current?.setWeatherSeries(isWeather && on ? weather.rain : null, 'rain')
  }, [isWeather, weather.rain, state.hiddenWeather])
  useEffect(() => {
    const on = !(state.hiddenWeather ?? []).includes('wind')
    globeRef.current?.setWeatherSeries(isWeather && on ? weather.wind : null, 'wind')
    globeRef.current?.setWindVisible(isWeather && on)
  }, [isWeather, weather.wind, state.hiddenWeather])
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
    () =>
      globeRef.current?.setCallout(
        callout.title,
        callout.prefix,
        callout.value,
        callout.suffix,
        isSat
      ),
    [callout, isSat]
  )

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
