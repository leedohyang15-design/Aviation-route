// Control window map: the SAME equirectangular renderer as the projected display
// (three.js `Globe`), interactive. Full-screen; drag spins/pans, wheel/pinch and
// on-screen +/− zoom, click selects the nearest aircraft. Map-anchored controls
// (compass, zoom, reset) live here since this owns the renderer.
import { useEffect, useRef } from 'react'
import type { Aircraft, GeoPoint, ViewState } from '@shared/types'
import { CompassRose } from '../common/CompassRose'
import { Globe } from '../display/globe'

interface Props {
  aircraft: Aircraft[]
  selected: string | null
  route: GeoPoint[] | null
  noRouteForSelected?: boolean
  onSelect: (icao24: string | null) => void
  onView: (view: ViewState) => void
  dayNightHour?: number | null
  originCity?: string | null
  destCity?: string | null
  originFlag?: string | null
  destFlag?: string | null
}

export function MapView({
  aircraft,
  selected,
  route,
  noRouteForSelected = false,
  onSelect,
  onView,
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const globe = new Globe(canvas, { interactive: true })
    globe.onViewChange = (v) => onViewRef.current(v)
    globe.onSelectChange = (s) => onSelectRef.current(s)
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

  useEffect(() => globeRef.current?.setAircraft(aircraft), [aircraft])
  useEffect(() => globeRef.current?.setSelected(selected), [selected])
  useEffect(() => globeRef.current?.setRoute(route), [route])
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
