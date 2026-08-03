// The satellite equivalent of the boarding-pass card: what this thing is, how
// it moves, and — the part visitors actually care about — when it will be over
// their heads. Numbers are paired with a plain-language line, because "고도
// 420km" means nothing to a child until it's compared with something they know.

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

function passLine(d: SatelliteDetail): { text: string; soon: boolean } {
  if (d.overheadNow) {
    const el = d.passMaxElevationDeg
    return { text: `🛰 지금 우리 하늘 위에 있어요!${el != null ? ` (${Math.round(el)}° 높이)` : ''}`, soon: true }
  }
  if (d.nextPassSec == null) return { text: '우리나라 위로는 지나가지 않아요', soon: false }
  const min = Math.round(d.nextPassSec / 60)
  const when = min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`
  const el = d.passMaxElevationDeg != null ? ` (하늘 ${Math.round(d.passMaxElevationDeg)}° 높이까지)` : ''
  return { text: `🛰 약 ${when} 뒤 우리 머리 위를 지나가요!${el}`, soon: min <= 30 }
}

export function SatelliteDetailCard({ detail: d }: { detail: SatelliteDetail | null }): JSX.Element {
  if (!d) {
    return (
      <div className="bp">
        <div className="bp-head">
          <div className="bp-air">🛰 위성</div>
        </div>
        <div className="bp-noroute">위성 정보를 불러오는 중…</div>
      </div>
    )
  }
  const pass = passLine(d)
  return (
    <div className="bp">
      <div className="bp-head">
        <div className="bp-air">🛰 {ORBIT_LABEL[d.orbit]}</div>
        <div className="bp-no">{d.name}</div>
      </div>

      <div className={'bp-noroute' + (pass.soon ? ' soon' : '')}>{pass.text}</div>

      <div className="bp-grid">
        <div>
          <span className="k">고도</span>
          <span className="v">{Math.round(d.altKm).toLocaleString()}km</span>
        </div>
        <div>
          <span className="k">속도</span>
          <span className="v">{d.speedKmS.toFixed(1)}km/s</span>
        </div>
        <div>
          <span className="k">한 바퀴</span>
          <span className="v">{Math.round(d.periodMin)}분</span>
        </div>
        <div>
          <span className="k">기울기</span>
          <span className="v">{Math.round(d.inclinationDeg)}°</span>
        </div>
      </div>

      <ul className="sat-story">
        <li>{altitudeStory(d.altKm)}</li>
        <li>{periodStory(d.periodMin)}</li>
        <li>{inclinationStory(d.inclinationDeg)}</li>
      </ul>

      <div className="bp-foot">NORAD {d.id}</div>
    </div>
  )
}
