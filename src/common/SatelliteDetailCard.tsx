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

// The notes below have to actually differ between satellites. An earlier set
// bucketed altitude into four bands, and since most of the catalogue sits
// between 400 and 900 km, nearly every object showed the identical sentence —
// which reads as a canned message rather than as information about the thing
// the visitor just tapped. Each note here is derived from a number that is
// genuinely different per object: its launch, the shape of its orbit, how many
// laps it has done, how far away it is right now.

/** Seoul→Busan, the yardstick. Scaling by it keeps the comparison relatable
 * while still giving every satellite its own number. */
const BUSAN_KM = 325

function altitudeNote(km: number): string {
  const times = km / BUSAN_KM
  const n = times >= 10 ? Math.round(times) : times.toFixed(1)
  return `서울에서 부산까지 거리의 약 ${n}배 높이에 있어요`
}

function launchNote(d: SatelliteDetail): string | null {
  if (d.launchYear == null) return null
  const years = new Date().getFullYear() - d.launchYear
  if (years <= 0) return `${d.launchYear}년에 올라간 새 위성이에요`
  return `${d.launchYear}년에 올라가 ${years}년째 돌고 있어요`
}

function shapeNote(d: SatelliteDetail): string | null {
  if (d.apogeeKm == null || d.perigeeKm == null) return null
  const spread = d.apogeeKm - d.perigeeKm
  if (spread < 100) return '거의 완벽한 동그라미를 그리며 돌아요'
  return (
    `높을 땐 ${Math.round(d.apogeeKm).toLocaleString()}km, ` +
    `낮을 땐 ${Math.round(d.perigeeKm).toLocaleString()}km — 길쭉한 타원을 그려요`
  )
}

/** A near-polar orbit at low altitude is almost always sun-synchronous, which
 * is why so many Earth-observation satellites share that 98° inclination. */
function isSunSynchronous(d: SatelliteDetail): boolean {
  return d.inclinationDeg >= 95 && d.inclinationDeg <= 104 && d.altKm < 1600
}

function pathNote(d: SatelliteDetail): string {
  if (d.periodMin >= 1400) return '지구가 도는 속도와 똑같아서, 하늘에 멈춰 있는 것처럼 보여요'
  if (isSunSynchronous(d)) return '태양동기궤도 — 늘 같은 시각에 같은 곳 위를 지나가요'
  if (d.inclinationDeg > 80) return '북극과 남극 위를 지나며 돌아요'
  if (d.inclinationDeg < 5) return '적도 바로 위를 따라 돌아요'
  return `적도에서 ${Math.round(d.inclinationDeg)}° 기울어진 길을 돌아요`
}

function lapsNote(d: SatelliteDetail): string | null {
  if (!d.revNumber) return null
  return `지금까지 지구를 ${d.revNumber.toLocaleString()}바퀴 돌았어요`
}

function rangeNote(d: SatelliteDetail): string | null {
  if (d.rangeKm == null) return null
  return `지금 여기서 ${Math.round(d.rangeKm).toLocaleString()}km 떨어져 있어요`
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
  const notes = [
    launchNote(d),
    altitudeNote(d.altKm),
    shapeNote(d),
    pathNote(d),
    lapsNote(d),
    rangeNote(d)
  ].filter((n): n is string => n != null)
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
        <span>COSPAR {d.cosparId ?? '—'}</span>
        <span>TLE EPOCH {d.tleEpoch ?? '—'}</span>
      </div>
    </div>
  )
}
