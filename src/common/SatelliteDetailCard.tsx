// The satellite readout on the control screen. Deliberately NOT the
// boarding-pass card reused with different words: a boarding pass is about a
// journey with two ends, and an orbit has neither. This reads like a printed
// telemetry sheet — fixed-width labels, ruled sections, a ticked countdown
// scale — so the two modes feel like two different instruments.
//
// The overhead pass is the hero. Everything else on screen is a number a child
// can't picture; "it flies over us in 42 minutes" is the one they can.

import type { SatelliteDetail, OrbitClass } from '@shared/types'

const ORBIT_LABEL: Record<OrbitClass, string> = {
  leo: '저궤도',
  starlink: '스타링크',
  meo: '중궤도',
  geo: '정지궤도'
}

/** A comparison a child can picture, rather than a bare number. */
function altitudeStory(km: number): string {
  if (km >= 30000) return '지구 어디서 봐도 늘 같은 자리에 있어요'
  if (km >= 15000) return '지구 지름보다 더 높이 떠 있어요'
  if (km >= 1000) return '서울에서 도쿄까지 거리보다 더 높아요'
  if (km >= 300) return '서울에서 부산보다 조금 더 먼 높이예요'
  return '아주 낮게 도는 위성이에요'
}

function periodStory(min: number): string {
  if (min >= 1400) return '지구가 도는 속도와 똑같아서, 하늘에 멈춰 있는 것처럼 보여요'
  if (min >= 300) return `${Math.round(min / 60)}시간에 지구를 한 바퀴 돌아요`
  return `${Math.round(min)}분에 지구를 한 바퀴 돌아요`
}

function inclinationStory(deg: number): string {
  if (deg < 5) return '적도 위를 따라 돌아요'
  if (deg > 80) return '북극과 남극 위를 지나며 돌아요'
  return `적도에서 ${Math.round(deg)}° 기울어져 돌아요`
}

interface Pass {
  big: string
  unit: string
  caption: string
  soon: boolean
  /** 0..1 for the tick scale — how close the pass is (1 = now). */
  fill: number
}

/** An hour is the widest countdown worth drawing on the scale; past that the
 * bar would sit near empty for hours and stop reading as progress. */
const PASS_SCALE_SEC = 3600

function passReadout(d: SatelliteDetail): Pass {
  if (d.overheadNow) {
    return {
      big: 'NOW',
      unit: '',
      caption:
        d.passMaxElevationDeg != null
          ? `지금 우리 하늘 위 · ${Math.round(d.passMaxElevationDeg)}° 높이`
          : '지금 우리 하늘 위에 있어요',
      soon: true,
      fill: 1
    }
  }
  if (d.nextPassSec == null) {
    return { big: '—', unit: '', caption: '우리나라 위로는 지나가지 않아요', soon: false, fill: 0 }
  }
  const min = Math.round(d.nextPassSec / 60)
  const big = min >= 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : String(min)
  return {
    big,
    unit: min >= 60 ? 'HR' : 'MIN',
    caption:
      d.passMaxElevationDeg != null
        ? `뒤에 머리 위를 지나가요 · 하늘 ${Math.round(d.passMaxElevationDeg)}° 높이까지`
        : '뒤에 머리 위를 지나가요',
    soon: min <= 30,
    fill: Math.max(0, Math.min(1, 1 - d.nextPassSec / PASS_SCALE_SEC))
  }
}

const TICKS = 34

/** The ruled countdown scale. Ticks left of the marker are lit. */
function TickScale({ fill }: { fill: number }): JSX.Element {
  const lit = Math.round(fill * (TICKS - 1))
  return (
    <div className="sat-scale" aria-hidden>
      {Array.from({ length: TICKS }, (_, i) => (
        <span key={i} className={'sat-tick' + (i === lit ? ' now' : i < lit ? ' lit' : '')} />
      ))}
    </div>
  )
}

function Tile({ label, value, unit }: { label: string; value: string; unit: string }): JSX.Element {
  return (
    <div className="sat-tile">
      <div className="sat-tile-label">{label}</div>
      <div className="sat-tile-value">
        {value}
        <span className="sat-tile-unit">{unit}</span>
      </div>
    </div>
  )
}

export function SatelliteDetailCard({ detail: d }: { detail: SatelliteDetail | null }): JSX.Element {
  if (!d) {
    return (
      <div className="sat-panel">
        <div className="sat-head">
          <span className="sat-head-title">◆ ORBITAL TELEMETRY</span>
        </div>
        <div className="sat-loading">위성 정보를 불러오는 중…</div>
      </div>
    )
  }
  const pass = passReadout(d)
  const notes = [altitudeStory(d.altKm), periodStory(d.periodMin), inclinationStory(d.inclinationDeg)]
  return (
    <div className="sat-panel">
      <div className="sat-head">
        <span className="sat-head-title">◆ ORBITAL TELEMETRY</span>
        <span className="sat-head-id">NORAD {d.id}</span>
      </div>

      <div className="sat-body">
        <div className="sat-section">
          <div className="sat-label">OBJECT DESIGNATION</div>
          <div className="sat-name">{d.name}</div>
          <div className="sat-classline">
            <span className="sat-class">{ORBIT_LABEL[d.orbit]}</span>
            <span className="sat-rule" />
            <span className="sat-status">▲ TRACKING</span>
          </div>
        </div>

        <div className={'sat-section sat-pass' + (pass.soon ? ' soon' : '')}>
          <div className="sat-label">T-MINUS · 우리 머리 위까지</div>
          <div className="sat-pass-big">
            {pass.big}
            {pass.unit && <span className="sat-pass-unit">{pass.unit}</span>}
          </div>
          <TickScale fill={pass.fill} />
          <div className="sat-pass-caption">{pass.caption}</div>
        </div>

        <div className="sat-tiles">
          <Tile label="ALTITUDE" value={Math.round(d.altKm).toLocaleString()} unit="km" />
          <Tile label="SPEED" value={d.speedKmS.toFixed(1)} unit="km/s" />
          <Tile label="PERIOD" value={String(Math.round(d.periodMin))} unit="min" />
          <Tile label="INCLINATION" value={String(Math.round(d.inclinationDeg))} unit="°" />
        </div>

        <ol className="sat-story">
          {notes.map((n, i) => (
            <li key={i}>
              <span className="sat-story-no">{String(i + 1).padStart(2, '0')}</span>
              <span>{n}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="sat-foot">
        <span>TLE EPOCH {d.tleEpoch ?? '—'}</span>
        <span>REV {d.revNumber != null ? d.revNumber.toLocaleString() : '—'}</span>
      </div>
    </div>
  )
}
