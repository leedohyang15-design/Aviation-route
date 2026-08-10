import { useEffect, useMemo, useRef, useState } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { skyOverhead } from '../common/sky'
import * as THREE from 'three'
import {
  MARS_PROBES,
  PROBE_COLOR,
  eastToRendererLon,
  marsClock,
  missionSol
} from '@shared/probes'
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
  /*
   * The moment being DRAWN, which is not the newest moment received.
   *
   * The series is four hourly steps that ping-pong past at six seconds each,
   * so naming the newest one left the plate reading "10시 기준" over a picture
   * of seven o'clock for most of the loop. The renderer owns the animation, so
   * it is the only thing that can say which step is on screen; `weatherAt` is
   * the fallback for the moment before the first tick lands.
   */
  const [shownAt, setShownAt] = useState<number | null>(null)
  /* Which band the rain over the exhibit falls into, or null for nothing to say. */
  const [rainHere, setRainHere] = useState<number | null>(null)
  const mode = state.mode
  const isSat = mode === 'satellite'
  const isWeather = mode === 'weather'
  const isMars = mode === 'mars'
  /*
   * A slow tick, only on Mars.
   *
   * The plate carries the local time where the selected probe is standing, and
   * a clock that never moves is worse than no clock. Twenty seconds is far
   * finer than the minute it displays and costs nothing; every other tab gets
   * no timer at all.
   */
  const [marsTick, setMarsTick] = useState(0)
  useEffect(() => {
    if (!isMars) return
    const t = setInterval(() => setMarsTick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [isMars])
  const hiddenWx = (state.hiddenWeather ?? []).join(',')
  const showCloud = isWeather && !hiddenWx.includes('cloud')
  const showRain = isWeather && !hiddenWx.includes('rain')
  const showWind = isWeather && !hiddenWx.includes('wind')
  /*
   * Keyed on the CONTENT of the filters, not on their identity.
   *
   * Same trap as the weather chips above: `state` is parsed from JSON, so
   * `hiddenOrbits` and `filter` are new objects on every broadcast, and a drag
   * broadcasts ten a second. These memos were therefore recomputing over the
   * whole catalogue — thousands of satellites, thousands of aircraft — and
   * handing the renderer a new array each time, which re-uploads the instance
   * buffers. Nothing had actually changed on any of those passes.
   */
  const orbitsKey = (state.hiddenOrbits ?? []).join(',')
  const filterKey = JSON.stringify(state.filter ?? null)
  const satVisible = useMemo(
    () => satellites.filter((x) => !orbitsKey.split(',').includes(x.orbit)),
    [satellites, orbitsKey]
  )

  const visible = useMemo(
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterKey IS state.filter, by value
    () => applyFilter(aircraft, state.filter, state.selected),
    [aircraft, filterKey, state.selected]
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
    /*
     * Mars: a place, and how long the thing standing there has been standing.
     *
     * The traverse cannot be the story on a dome — a rover's whole life's
     * driving is three pixels at this scale — so the number that carries the
     * plate is TIME instead of distance: how many Martian mornings this machine
     * has woken up to. That is a figure a child can hold, and it is the same
     * shape of answer the other tabs give (minutes to arrival, minutes to a
     * pass overhead).
     */
    if (isMars) {
      void marsTick
      const p = MARS_PROBES.find((x) => x.id === state.selected)
      if (!p) {
        const alive = MARS_PROBES.filter((x) => x.status === 'active').length
        return {
          ...NOTHING,
          title: '화성',
          prefix: `사람이 보낸 로봇 ${MARS_PROBES.length}대가 여기 내려앉았고, 그중 ${alive}대는 지금도 일하고 있어요`
        }
      }
      const now = Date.now()
      const sol = missionSol(p, now)
      const title = `${p.name}   ${p.place}`
      if (p.status === 'lost') {
        return { ...NOTHING, title, prefix: `${p.landed.slice(0, 4)}년에 내렸지만 소식이 끊겼어요` }
      }
      if (p.status === 'active') {
        return {
          title,
          prefix: `화성에 온 지`,
          value: `${sol.toLocaleString()}솔`,
          suffix: `· 그곳은 지금 ${marsClock(p.lonEast, now)}`
        }
      }
      return {
        title,
        prefix: `${p.landed.slice(0, 4)}년부터`,
        value: `${sol.toLocaleString()}솔`,
        suffix: '동안 일했어요'
      }
    }
    // Weather has nothing to select, so the plate says what the picture is and
    // how old it is — the one thing that stops a still image reading as a
    // decoration rather than as today's sky.
    if (isWeather) {
      const at = shownAt ?? weatherAt
      if (!at) return { ...NOTHING, title: '지구의 날씨', prefix: '영상을 불러오는 중이에요' }
      const t = new Date(at)
      const hh = t.getHours()
      const label = `${hh < 12 ? '오전' : '오후'} ${hh % 12 || 12}시${t.getMinutes() ? ` ${t.getMinutes()}분` : ''}`
      /*
       * The big line is about the visitor, not about the planet.
       *
       * "지구의 날씨" names the picture, which anyone can already see. What a
       * child cannot get from a world map is the one place they are standing
       * in, so that goes in the slot the dome makes readable from across a
       * room; the hour drops to the small line beneath it.
       */
      const here = skyOverhead(rainHere)
      // Text only, no icon. The plate is drawn as canvas text rather than as
      // HTML, so an emoji here depends on a font fallback nobody has verified
      // on the exhibit machine, and a tofu box on the dome is worse than a
      // plain sentence. The control screen keeps the icon: it is HTML, and its
      // weather chips already prove the emoji render there.
      return {
        ...NOTHING,
        title: here ? here.text : '지구의 날씨',
        prefix: here ? `${label} 기준 지구의 날씨` : `${label} 기준`
      }
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
  }, [isSat, isWeather, isMars, marsTick, shownAt, weatherAt, rainHere, state.selected, satDetail, sel, d])

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
    // A switch on the mode, not a boolean. `isSat ? 'satellite' : 'aircraft'`
    // quietly gave the fourth tab aeroplane silhouettes pointing at headings
    // that landers do not have.
    globeRef.current?.setObjectKind(isSat ? 'satellite' : isMars ? 'probe' : 'aircraft')
    globeRef.current?.setPlanet(isMars ? 'mars' : 'earth')
    globeRef.current?.clearObjects()
  }, [mode, isSat, isMars])
  useEffect(() => {
    if (!isMars) return
    globeRef.current?.setProbes(
      MARS_PROBES.map((p) => ({
        id: p.id,
        lon: eastToRendererLon(p.lonEast),
        lat: p.lat,
        color: new THREE.Color(PROBE_COLOR[p.status])
      }))
    )
  }, [isMars])
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
    g.onWeatherTime = setShownAt
    g.onLocalSky = setRainHere
  }, [send])

  /*
   * Loading and showing are separate.
   *
   * The series follows the MODE, so leaving weather gives the textures back;
   * the chip only flips a uniform. Tying the two together meant a chip threw
   * away four decoded mosaics and rebuilt them on the way back, which is a
   * frozen second for a toggle that changed no data.
   */
  useEffect(() => {
    globeRef.current?.setWeatherSeries(isWeather ? weather.cloud : null, 'cloud')
  }, [isWeather, weather.cloud])
  useEffect(() => {
    globeRef.current?.setWeatherSeries(isWeather ? weather.rain : null, 'rain')
  }, [isWeather, weather.rain])
  /*
   * Booleans as dependencies, never the array itself.
   *
   * `state` arrives as JSON, so every field of it is a NEW object on every
   * broadcast — and the hub broadcasts the whole state on a view change, which
   * a drag emits ten times a second. Depending on `state.hiddenWeather` fired
   * the wind effect on all of them, and that effect rebuilds a sixty-four tile
   * mosaic and decodes it into a field. Turning the globe in weather mode was
   * doing that continuously; pressing any chip did it once, which is the lag
   * that was actually noticed.
   */
  useEffect(() => {
    globeRef.current?.setWeatherVisible('cloud', showCloud)
    globeRef.current?.setWeatherVisible('rain', showRain)
  }, [showCloud, showRain])
  useEffect(() => {
    globeRef.current?.setWeatherSeries(showWind ? weather.wind : null, 'wind')
    globeRef.current?.setWindVisible(showWind)
  }, [showWind, weather.wind])
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
