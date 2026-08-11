// Control window map: the SAME equirectangular renderer as the projected display
// (three.js `Globe`), interactive. Full-screen; drag spins/pans, wheel/pinch and
// on-screen +/− zoom, click selects the nearest aircraft. Map-anchored controls
// (compass, zoom, reset) live here since this owns the renderer.
import { useEffect, useRef } from 'react'
import type {
  Aircraft,
  GeoPoint,
  ViewState,
  ExhibitMode,
  Satellite,
  WeatherFrame,
  WeatherLayer
} from '@shared/types'
import * as THREE from 'three'
import { MARS_PROBES, PROBE_COLOR, probePosition } from '@shared/probes'
import { CompassRose } from '../common/CompassRose'
import { Globe, type SelectionAnchor } from '../display/globe'

interface Props {
  /** Which layer to render; switching clears the other one's objects. */
  mode?: ExhibitMode
  satellites?: Satellite[]
  /** Each layer's animation series, and which of them the operator has on. */
  weather?: { cloud: WeatherFrame[]; rain: WeatherFrame[]; wind: WeatherFrame[] }
  hiddenWeather?: WeatherLayer[]
  /** Today's rover positions by probe id, so the dots sit where they are now. */
  marsLive?: Record<string, { lon: number; lat: number; path?: [number, number][] }>
  aircraft: Aircraft[]
  selected: string | null
  route: GeoPoint[] | null
  noRouteForSelected?: boolean
  onSelect: (icao24: string | null) => void
  onView: (view: ViewState) => void
  onAttract?: (active: boolean) => void
  /** Where the selected object is on screen, so the card can sit beside it. */
  onAnchor?: (p: SelectionAnchor | null) => void
  /** The moment the weather picture on screen is of. The renderer owns the
   * animation, so it is the only thing that knows which step is being drawn. */
  onWeatherTime?: (t: number | null) => void
  /** Which band the rain over the exhibit falls into; null for nothing to say. */
  onLocalSky?: (rain: number | null) => void
  /** A line for the exe's log. The dome cannot report on a camera it does not have. */
  onNote?: (text: string) => void
  /** Filled with a function that re-arms the attract countdown, so taps on the
   * overlay UI (search, chips, tabs) count as operator activity too. */
  pokeRef?: React.MutableRefObject<(() => void) | null>
  dayNightHour?: number | null
  originCity?: string | null
  destCity?: string | null
  originFlag?: string | null
  destFlag?: string | null
}

export function MapView({
  mode = 'flight',
  satellites,
  weather,
  hiddenWeather,
  marsLive,
  aircraft,
  selected,
  route,
  noRouteForSelected = false,
  onSelect,
  onView,
  onAttract,
  onAnchor,
  onWeatherTime,
  onLocalSky,
  onNote,
  pokeRef,
  dayNightHour = null,
  originCity = null,
  destCity = null,
  originFlag = null,
  destFlag = null
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onAttractRef = useRef(onAttract)
  onAttractRef.current = onAttract
  const onAnchorRef = useRef(onAnchor)
  onAnchorRef.current = onAnchor
  const onWeatherTimeRef = useRef(onWeatherTime)
  onWeatherTimeRef.current = onWeatherTime
  const onLocalSkyRef = useRef(onLocalSky)
  onLocalSkyRef.current = onLocalSky
  const onNoteRef = useRef(onNote)
  onNoteRef.current = onNote

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const globe = new Globe(canvas, { interactive: true })
    globe.onViewChange = (v) => onViewRef.current(v)
    globe.onSelectChange = (s) => onSelectRef.current(s)
    globe.onAttractChange = (a) => onAttractRef.current?.(a)
    globe.onSelectedAnchor = (p) => onAnchorRef.current?.(p)
    if (pokeRef) pokeRef.current = () => globe.pokeActivity()
    globe.onWeatherTime = (t) => onWeatherTimeRef.current?.(t)
    globe.onLocalSky = (r) => onLocalSkyRef.current?.(r)
    // The control window reports too. It used to be silent because the dome
    // measured the same pixels and two copies of every line is noise — but the
    // dome does not zoom, so anything about the camera can only be seen here.
    globe.onNote = (t) => onNoteRef.current?.(t)
    globeRef.current = globe
    globe.start()
    // Refit/recenter whenever the map area changes size (also fixes the initial
    // pass before layout has settled, so the 2:1 frame stays vertically centered).
    const ro = new ResizeObserver(() => globe.resize())
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    requestAnimationFrame(() => globe.resize())
    return () => {
      ro.disconnect()
      globe.dispose()
      globeRef.current = null
    }
  }, [])

  // Wipe the previous layer's objects so they don't linger under the new one.
  useEffect(() => {
    // A switch, not a boolean: the fourth mode used to inherit the aircraft
    // branch and draw landing sites as aeroplanes pointing at a heading.
    globeRef.current?.setObjectKind(
      mode === 'satellite' ? 'satellite' : mode === 'mars' ? 'probe' : 'aircraft'
    )
    globeRef.current?.setPlanet(mode === 'mars' ? 'mars' : 'earth')
    globeRef.current?.clearObjects()
  }, [mode])
  const isMars = mode === 'mars'
  useEffect(() => {
    if (!isMars) return
    globeRef.current?.setProbes(
      MARS_PROBES.map((p) => ({
        id: p.id,
        ...probePosition(p, marsLive?.[p.id]),
        color: new THREE.Color(PROBE_COLOR[p.status])
      }))
    )
  }, [isMars, marsLive])
  useEffect(() => {
    if (mode === 'flight') globeRef.current?.setAircraft(aircraft)
  }, [mode, aircraft])
  useEffect(() => {
    if (mode === 'satellite' && satellites) globeRef.current?.setSatellites(satellites)
  }, [mode, satellites])
  const isWeather = mode === 'weather'
  const showCloud = isWeather && !(hiddenWeather ?? []).includes('cloud')
  const showRain = isWeather && !(hiddenWeather ?? []).includes('rain')
  // The series follows the MODE and the chip only flips a uniform, so toggling
  // a layer costs a frame instead of four mosaic rebuilds.
  useEffect(
    () => globeRef.current?.setWeatherSeries(isWeather ? weather?.cloud ?? null : null, 'cloud'),
    [isWeather, weather?.cloud]
  )
  useEffect(
    () => globeRef.current?.setWeatherSeries(isWeather ? weather?.rain ?? null : null, 'rain'),
    [isWeather, weather?.rain]
  )
  useEffect(() => {
    globeRef.current?.setWeatherVisible('cloud', showCloud)
    globeRef.current?.setWeatherVisible('rain', showRain)
  }, [showCloud, showRain])
  const showWind = isWeather && !(hiddenWeather ?? []).includes('wind')
  useEffect(() => {
    globeRef.current?.setWeatherSeries(showWind ? weather?.wind ?? null : null, 'wind')
    globeRef.current?.setWindVisible(showWind)
  }, [showWind, weather?.wind])
  useEffect(() => globeRef.current?.setSelected(selected), [selected])
  useEffect(() => {
    // On Mars the "route" is the traverse; the globe's polyline is the same
    // machinery, pointed at different points. See DisplayApp for the note.
    if (isMars) {
      const p = selected ? marsLive?.[selected] : null
      const path = (p as { path?: [number, number][] } | undefined)?.path
      globeRef.current?.setRoute(path?.length ? path.map(([lon, lat]) => ({ lon, lat })) : null)
      return
    }
    globeRef.current?.setRoute(route)
  }, [isMars, marsLive, selected, route])
  useEffect(
    () => globeRef.current?.autoAdvanceOnNoRoute(noRouteForSelected),
    [noRouteForSelected, selected]
  )
  useEffect(() => globeRef.current?.setNightHour(dayNightHour), [dayNightHour])
  useEffect(
    () => globeRef.current?.setEndpointLabels(originCity, destCity),
    [originCity, destCity]
  )
  useEffect(
    () => globeRef.current?.setEndpointFlags(originFlag, destFlag),
    [originFlag, destFlag]
  )

  const poke = () => globeRef.current?.pokeActivity()

  return (
    <div className="map-wrap">
      <div className="map">
        <canvas ref={canvasRef} />
      </div>

      <div className="ctrl-topright">
        <div className="ctrl-compass">
          <CompassRose />
        </div>
        <div className="ctrl-zoom">
          <button
            aria-label="확대"
            onClick={() => {
              poke()
              globeRef.current?.zoomBy(0.7)
            }}
          >
            +
          </button>
          <button
            aria-label="축소"
            onClick={() => {
              poke()
              globeRef.current?.zoomBy(1.4)
            }}
          >
            −
          </button>
        </div>
        <button
          className="reset-btn"
          onClick={() => {
            poke()
            globeRef.current?.home()
          }}
        >
          🌏 전체 보기
        </button>
      </div>
    </div>
  )
}
