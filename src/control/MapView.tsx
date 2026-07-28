// Control window map. Uses the SAME equirectangular renderer as the projected
// display (three.js `Globe`), in interactive mode — so the operator sees exactly
// what the dome shows (same photographic earth, same airplane icons, same
// day/night). Drag spins/pans, wheel zooms, click selects the nearest aircraft.
import { useEffect, useRef } from 'react'
import type { Aircraft, GeoPoint, ViewState } from '@shared/types'
import { Globe } from '../display/globe'

interface Props {
  aircraft: Aircraft[]
  selected: string | null
  route: GeoPoint[] | null
  onSelect: (icao24: string | null) => void
  onView: (view: ViewState) => void
  dayNightHour?: number | null
  originCity?: string | null
  destCity?: string | null
}

export function MapView({
  aircraft,
  selected,
  route,
  onSelect,
  onView,
  dayNightHour = null,
  originCity = null,
  destCity = null
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  // Stable wrappers so the renderer always calls the latest callbacks.
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Create the renderer once.
  useEffect(() => {
    if (!canvasRef.current) return
    const globe = new Globe(canvasRef.current, { interactive: true })
    globe.onViewChange = (v) => onViewRef.current(v)
    globe.onSelectChange = (s) => onSelectRef.current(s)
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

  useEffect(() => globeRef.current?.setAircraft(aircraft), [aircraft])
  useEffect(() => globeRef.current?.setSelected(selected), [selected])
  useEffect(() => globeRef.current?.setRoute(route), [route])
  useEffect(() => globeRef.current?.setNightHour(dayNightHour), [dayNightHour])
  useEffect(
    () => globeRef.current?.setEndpointLabels(originCity, destCity),
    [originCity, destCity]
  )

  return (
    <div className="map-wrap">
      <div className="map">
        <canvas ref={canvasRef} />
      </div>
      <button className="reset-btn" onClick={() => globeRef.current?.home()}>
        🌏 전체 보기
      </button>
    </div>
  )
}
