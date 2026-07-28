// Rich flight-detail card shared by the display (sphere HUD) and the control
// panel, so both show the same info on selection. Presentation-only.
import { splitAtAntimeridian } from '@shared/projection'
import type { Aircraft, FlightDetail, GeoPoint } from '@shared/types'
import { PLANE_DATA_URI } from '@shared/plane'
import { EARTH_TEXTURE_URL } from '@shared/config'
import './detail-card.css'

const KST = 'Asia/Seoul'

function fmtTime(ms?: number): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: KST })
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
  const [nx, ny] = toXY(route[Math.min(idx, route.length - 1)])
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

interface Props {
  aircraft: Aircraft
  detail: FlightDetail | null
}

export function FlightDetailCard({ aircraft: sel, detail: d }: Props): JSX.Element {
  return (
    <div className="fdcard">
      <div className="fd-airline">
        <img src={PLANE_DATA_URI} alt="" />
        {d?.airline ?? '—'}
      </div>
      <div className="fd-flightno">{d?.flightNo ?? sel.callsign ?? sel.icao24.toUpperCase()}</div>

      <div className="fd-od">
        <div className="fd-port">
          <span className="fd-pin">🚩</span>
          <span className="fd-city">{d?.origin?.city ?? '—'}</span>
          <span className="fd-code">{d?.origin?.code ?? ''}</span>
        </div>
        <div className="fd-arrow">↓</div>
        <div className="fd-port">
          <span className="fd-pin">📍</span>
          <span className="fd-city">{d?.destination?.city ?? '—'}</span>
          <span className="fd-code">{d?.destination?.code ?? ''}</span>
        </div>
      </div>

      <dl className="fd-metrics">
        <div>
          <dt>고도</dt>
          <dd>{sel.altitude != null ? `${Math.round(sel.altitude).toLocaleString()} m` : '—'}</dd>
        </div>
        <div>
          <dt>속도</dt>
          <dd>{sel.velocity != null ? `${Math.round(sel.velocity * 3.6)} km/h` : '—'}</dd>
        </div>
      </dl>

      <div className="fd-type">
        <dt>기종</dt>
        <dd>{d?.aircraftType ?? '—'}</dd>
      </div>

      {d && (d.progress != null || d.route) && (
        <div className="fd-progress">
          <div className="fd-pbar">
            <span style={{ width: `${Math.round((d.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="fd-ptimes">
            <span>출발 {fmtTime(d.departureTime)}</span>
            <span>남은 {fmtRemaining(d.etaRemainingSec)}</span>
          </div>
          <MiniRoute detail={d} />
        </div>
      )}
    </div>
  )
}
