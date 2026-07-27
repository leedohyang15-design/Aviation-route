import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { Globe } from './globe'

export function DisplayApp(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const { aircraft, state, connected, source, route } = useHub('display')

  const visible = useMemo(() => applyFilter(aircraft, state.filter), [aircraft, state.filter])

  // Boot the three.js engine once.
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

  // Push state/data into the engine.
  useEffect(() => globeRef.current?.setAircraft(visible), [visible])
  useEffect(() => globeRef.current?.setLonOffset(state.lonOffset), [state.lonOffset])
  useEffect(() => globeRef.current?.setOverlays(state.overlays), [state.overlays])
  useEffect(() => globeRef.current?.setSelected(state.selected), [state.selected])
  useEffect(() => globeRef.current?.setRoute(route.points), [route])

  const sel = state.selected ? aircraft.find((a) => a.icao24 === state.selected) : null

  return (
    <div className="display-root">
      <div className="stage">
        <canvas ref={canvasRef} />
      </div>

      <header className="hud hud-top">
        <h1>실시간 항공 경로</h1>
        <span className="subtitle">Real-time Global Air Traffic</span>
      </header>

      {state.overlays.stats && (
        <div className="hud hud-stats">
          <div>
            <b>{visible.length.toLocaleString()}</b> 대 비행 중
          </div>
          <div className={connected ? 'ok' : 'warn'}>
            {source === 'mock' ? '시뮬레이션 데이터' : 'OpenSky Network'} ·{' '}
            {connected ? '연결됨' : '재연결 중…'}
          </div>
        </div>
      )}

      {sel && (
        <div className="hud hud-card">
          <div className="callsign">{sel.callsign || sel.icao24.toUpperCase()}</div>
          <dl>
            <div>
              <dt>고도</dt>
              <dd>{sel.altitude != null ? `${Math.round(sel.altitude).toLocaleString()} m` : '—'}</dd>
            </div>
            <div>
              <dt>속도</dt>
              <dd>{sel.velocity != null ? `${Math.round(sel.velocity * 3.6)} km/h` : '—'}</dd>
            </div>
            <div>
              <dt>방위</dt>
              <dd>{sel.heading != null ? `${Math.round(sel.heading)}°` : '—'}</dd>
            </div>
            <div>
              <dt>국적</dt>
              <dd>{sel.originCountry || '—'}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  )
}
