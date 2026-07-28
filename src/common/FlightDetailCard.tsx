// Boarding-pass style flight card, shown on the control panel (the projected
// sphere stays clean — no card there). Presentation-only.
import { splitAtAntimeridian } from '@shared/projection'
import type { Aircraft, FlightDetail, GeoPoint } from '@shared/types'
import { PLANE_DATA_URI } from '@shared/plane'
import './detail-card.css'

const KST = 'Asia/Seoul'
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function fmtClock(ms?: number): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: KST
  })
}

function fmtDur(sec?: number): string {
  if (sec == null || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return `${h}H ${String(m).padStart(2, '0')}M`
}

function fmtDepart(ms?: number): string {
  if (ms == null) return '—'
  return new Date(ms).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: KST
  })
}

function fmtRemain(sec?: number): string {
  if (sec == null || sec < 0) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

/** Small stable hash of a string → unsigned 32-bit int. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Decorative seat number derived from the aircraft id (stable per plane). */
function seatOf(id: string): string {
  const h = hash(id)
  return `${(h % 48) + 1}${'ABCDEFGH'[h % 8]}`
}

/** Deterministic barcode: bar widths seeded by the flight code. */
function Barcode({ seed }: { seed: string }): JSX.Element {
  let s = hash(seed) || 1
  const bars: number[] = []
  for (let i = 0; i < 60; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    bars.push(1 + (s % 4))
  }
  const total = bars.reduce((a, b) => a + b, 0)
  let x = 0
  return (
    <svg className="bp-barcode" viewBox={`0 0 ${total} 40`} preserveAspectRatio="none">
      {bars.map((w, i) => {
        const rx = x
        x += w
        return i % 2 === 0 ? <rect key={i} x={rx} y={0} width={w} height={40} fill="#1b2430" /> : null
      })}
    </svg>
  )
}

/** Clean green/blue world thumbnail with the great-circle route dashed on top. */
function MiniRoute({ detail }: { detail: FlightDetail }): JSX.Element | null {
  const W = 300
  const H = 150
  const route = detail.route
  if (!route || route.length < 2) return null
  const toXY = (p: GeoPoint) => [((p.lon + 180) / 360) * W, ((90 - p.lat) / 180) * H]
  const idx = Math.min(route.length - 1, Math.max(0, Math.round((detail.progress ?? 0) * (route.length - 1))))
  const dashed = (pts: GeoPoint[], color: string, width: number) =>
    splitAtAntimeridian(pts).map((seg, i) =>
      seg.length < 2 ? null : (
        <polyline
          key={`${color}-${i}`}
          points={seg.map((p) => toXY(p).join(',')).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
      )
    )
  const [ox, oy] = toXY(route[0])
  const [dx, dy] = toXY(route[route.length - 1])
  const [nx, ny] = toXY(route[idx])
  return (
    <svg className="bp-map" viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none">
      <clipPath id="bp-clip">
        <rect x={0} y={0} width={W} height={H} rx={10} />
      </clipPath>
      <g clipPath="url(#bp-clip)">
        <image href="world_flat.svg" x={0} y={0} width={W} height={H} preserveAspectRatio="none" />
        {/* Upcoming route (now→destination) in yellow so it stands out; flown grey. */}
        {dashed(route.slice(idx), '#ffcf33', 2)}
        {dashed(route.slice(0, idx + 1), '#5b6b7d', 1.6)}
        <circle cx={ox} cy={oy} r={4.5} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} />
        <circle cx={dx} cy={dy} r={4.5} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />
        <image href={PLANE_DATA_URI} x={nx - 7} y={ny - 7} width={14} height={14} />
      </g>
    </svg>
  )
}

interface Props {
  aircraft: Aircraft
  detail: FlightDetail | null
}

export function FlightDetailCard({ aircraft: sel, detail: d }: Props): JSX.Element {
  const flightNo = d?.flightNo ?? sel.callsign?.trim() ?? sel.icao24.toUpperCase()
  const dep = d?.departureTime
  const eta = d?.etaRemainingSec
  const totalSec = dep != null && eta != null ? Math.max(0, (Date.now() - dep) / 1000 + eta) : undefined
  const arriveMs = dep != null && totalSec != null ? dep + totalSec * 1000 : undefined
  const dateMs = dep ?? Date.now()
  const dt = new Date(dateMs)
  const dateCode = `${String(dt.getUTCDate()).padStart(2, '0')}${MONTHS[dt.getUTCMonth()]}`
  const barSeed = `${flightNo}${d?.origin?.code ?? ''}${d?.destination?.code ?? ''}`

  return (
    <div className="bpass">
      <div className="bp-head">
        <div className="bp-airline">
          <span className="bp-plane">✈</span>
          {d?.airline ?? '—'}
        </div>
        <span className="bp-badge">BOARDING PASS</span>
      </div>

      <div className="bp-flightrow">
        <span className="bp-flightno">{flightNo}</span>
        <span className="bp-seat">SEAT {seatOf(sel.icao24)}</span>
      </div>

      <div className="bp-rule" />

      <div className="bp-od">
        <div className="bp-end">
          <div className="bp-code">{d?.origin?.code ?? '—'}</div>
          <div className="bp-city">{d?.origin?.city ?? '—'}</div>
          <div className="bp-time">{fmtClock(dep)}</div>
        </div>
        <div className="bp-mid">
          <span className="bp-plane bp-planeicon">✈</span>
          <div className="bp-dashline" />
          <div className="bp-dur">{fmtDur(totalSec)}</div>
        </div>
        <div className="bp-end bp-right">
          <div className="bp-code">{d?.destination?.code ?? '—'}</div>
          <div className="bp-city">{d?.destination?.city ?? '—'}</div>
          <div className="bp-time">{fmtClock(arriveMs)}</div>
        </div>
      </div>

      <div className="bp-tear">
        <span className="bp-notch left" />
        <span className="bp-dots" />
        <span className="bp-notch right" />
      </div>

      <dl className="bp-metrics">
        <div>
          <dt>고도</dt>
          <dd>{sel.altitude != null ? `${Math.round(sel.altitude).toLocaleString()} m` : '—'}</dd>
        </div>
        <div>
          <dt>속도</dt>
          <dd>{sel.velocity != null ? `${Math.round(sel.velocity * 3.6)} km/h` : '—'}</dd>
        </div>
        <div>
          <dt>기종</dt>
          <dd>{d?.aircraftType ?? '—'}</dd>
        </div>
      </dl>

      {d && (d.progress != null || d.route) && (
        <>
          <div className="bp-pbar">
            <span style={{ width: `${Math.round((d.progress ?? 0) * 100)}%` }} />
          </div>
          <div className="bp-ptimes">
            <span>출발 {fmtDepart(dep)}</span>
            <span>남은 시간 {fmtRemain(eta)}</span>
          </div>
          <MiniRoute detail={d} />
        </>
      )}

      <Barcode seed={barSeed} />
      <div className="bp-footer">
        {flightNo} {d?.origin?.code ?? '—'} {d?.destination?.code ?? '—'} {dateCode}
      </div>
    </div>
  )
}
