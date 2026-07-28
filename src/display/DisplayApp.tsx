import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { FlightDetailCard } from '../common/FlightDetailCard'
import { CompassRose } from '../common/CompassRose'
import { Globe } from './globe'

export function DisplayApp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const { aircraft, state, connected, source, route, detail } = useHub('display')

  const visible = useMemo(() => applyFilter(aircraft, state.filter), [aircraft, state.filter])

  useEffect(() => {
    if (!canvasRef.current) return
    const globe = new Globe(canvasRef.current)
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

  const sel = state.selected ? aircraft.find((a) => a.icao24 === state.selected) : null
  const d = detail && detail.icao24 === state.selected ? detail : null

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>

      <header className="hud hud-top">
        <h1>실시간 항공 경로</h1>
        <span className="subtitle">Real-time Global Air Traffic</span>
      </header>

      {/* Always visible: how many are flying + data source/connection. */}
      <div className="hud hud-stats">
        <div>
          <b>{visible.length.toLocaleString()}</b> 대 비행 중
        </div>
        <div className={connected ? 'ok' : 'warn'}>
          {source === 'mock' ? '시뮬레이션 데이터' : 'OpenSky Network'} ·{' '}
          {connected ? '연결됨' : '재연결 중…'}
        </div>
      </div>

      {/* Fixed 8-point compass — stays put regardless of pan/zoom. */}
      <div className="hud hud-compass">
        <CompassRose />
      </div>

      {sel && (
        <div className="hud hud-card">
          <FlightDetailCard aircraft={sel} detail={d} />
        </div>
      )}
    </div>
  )
}
