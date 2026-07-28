import { useEffect, useMemo, useRef } from 'react'
import { useHub } from '../common/useHub'
import { applyFilter } from '../common/filter'
import { splitAtAntimeridian } from '@shared/projection'
import type { FlightDetail, GeoPoint } from '@shared/types'
import { PLANE_DATA_URI } from '@shared/plane'
import { EARTH_TEXTURE_URL } from '@shared/config'
import { Globe } from './globe'

const KST = 'Asia/Seoul'

function fmtTime(ms?: number): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: KST
  })
}

function fmtRemaining(sec?: number): string {
  if (sec == null || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

/** Small 2:1 route thumbnail: great-circle path (flown red, rest faint) + now. */
function MiniRoute({ detail }: { detail: FlightDetail }): JSX.Element | null {
  const W = 260
  const H = 130
  const route = detail.route
  if (!route || route.length < 2) return null
  const toXY = (p: GeoPoint) => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H]
  const idx = Math.max(1, Math.round((detail.progress ?? 0) * (route.length - 1)))
  const poly = (pts: GeoPoint[], color: string, opacity: number, width: number) =>
    splitAtAntimeridian(pts).map((seg, i) =>
      seg.length < 2 ? null : (
        <polyline
          key={`${color}-${i}`}
          points={seg.map((p) => toXY(p).join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeOpacity={opacity}
          strokeWidth={width}
        />
      )
    )
  const now = route[Math.min(idx, route.length - 1)]
  const [nx, ny] = toXY(now)
  const [ox, oy] = toXY(route[0])
  const [dx, dy] = toXY(route[route.length - 1])
  return (
    <svg className="mini-route" viewBox={`0 0 ${W} ${H}`} width="100%">
      <clipPath id="mini-clip">
        <rect x={0} y={0} width={W} height={H} rx={8} />
      </clipPath>
      <g clipPath="url(#mini-clip)">
        <image href={EARTH_TEXTURE_URL} x={0} y={0} width={W} height={H} preserveAspectRatio="none" opacity={0.55} />
        <rect x={0} y={0} width={W} height={H} fill="#0a1020" opacity={0.35} />
        {poly(route.slice(idx), '#ffe08a', 0.5, 1.5)}
        {poly(route.slice(0, idx + 1), '#ff3b30', 0.95, 2.5)}
        <circle cx={nx} cy={ny} r={3.5} fill="#fff" />
        <text x={ox} y={oy} fontSize={13} textAnchor="middle" dominantBaseline="central">🚩</text>
        <text x={dx} y={dy} fontSize={13} textAnchor="middle" dominantBaseline="central">📍</text>
      </g>
      <rect x={0} y={0} width={W} height={H} rx={8} fill="none" stroke="#22304e" />
    </svg>
  )
}

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
          <div className="airline">
            <img src={PLANE_DATA_URI} alt="" />
            {d?.airline ?? '—'}
          </div>
          <div className="flightno">{d?.flightNo ?? sel.callsign ?? sel.icao24.toUpperCase()}</div>

          <div className="route-od">
            <div className="port">
              <span className="pin">🚩</span>
              <span className="city">{d?.origin?.city ?? '—'}</span>
              <span className="code">{d?.origin?.code ?? ''}</span>
            </div>
            <div className="arrow">↓</div>
            <div className="port">
              <span className="pin">📍</span>
              <span className="city">{d?.destination?.city ?? '—'}</span>
              <span className="code">{d?.destination?.code ?? ''}</span>
            </div>
          </div>

          <dl className="metrics">
            <div>
              <dt>고도</dt>
              <dd>{sel.altitude != null ? `${Math.round(sel.altitude).toLocaleString()} m` : '—'}</dd>
            </div>
            <div>
              <dt>속도</dt>
              <dd>{sel.velocity != null ? `${Math.round(sel.velocity * 3.6)} km/h` : '—'}</dd>
            </div>
          </dl>

          <div className="type">
            <dt>기종</dt>
            <dd>{d?.aircraftType ?? '—'}</dd>
          </div>

          {d && (d.progress != null || d.route) && (
            <div className="progress-block">
              <div className="pbar">
                <span style={{ width: `${Math.round((d.progress ?? 0) * 100)}%` }} />
              </div>
              <div className="ptimes">
                <span>출발 {fmtTime(d.departureTime)}</span>
                <span>남은 {fmtRemaining(d.etaRemainingSec)}</span>
              </div>
              <MiniRoute detail={d} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
