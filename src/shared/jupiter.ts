// Jupiter, which is not a place.
//
// Every other tab in this exhibit is about somewhere you could stand. Mars has
// twelve landing sites; Earth has airports. Jupiter has no ground at all — the
// one machine ever sent into it fell for fifty-seven minutes and was crushed
// without reaching anything — so the tab cannot be "where did we land". It is
// about the four worlds going round it, which is what Galileo saw in 1610 and
// what a child with binoculars can still see tonight.
//
// Like shared/probes.ts this file never touches the network. The moons' places
// are arithmetic, the histories are settled, and the two spacecraft on their
// way have departure dates that already happened.

/* ------------------------------------------------------------------ *
 * The planet
 * ------------------------------------------------------------------ */

/** Equatorial radius, km. The moons' orbits below are in units of this. */
export const JUPITER_RADIUS_KM = 71492

/**
 * System III, the rotation of the magnetic field — 9h 55m 29.7s.
 *
 * Jupiter has no single day. The equator laps the poles by about five minutes
 * because the visible surface is weather rather than ground, so the convention
 * is to time the magnetic field, which is anchored to the deep interior and is
 * the only part that rotates as one body. This is the number every Jupiter map
 * is drawn in.
 */
export const JUPITER_DAY_MS = 35729.7 * 1000

/* ------------------------------------------------------------------ *
 * Where the moons are
 * ------------------------------------------------------------------ */

const RAD = Math.PI / 180

export interface JupiterMoon {
  id: string
  name: string
  subtitle: string
  /** Mean longitude at J2000.0, degrees. */
  l0: number
  /** Degrees per day. */
  rate: number
  /** Orbit radius in Jupiter radii — the moons' orbits are near-circular. */
  radiusRj: number
  /** Distance from Jupiter, km, as published. */
  distanceKm: number
  /** Diameter, km. */
  diameterKm: number
  /** Marker colour, warm to cool going outward. */
  color: string
  /** The one thing about it. */
  headline: string
  /** Sentences for the card, in the order a child should meet them. */
  facts: string[]
}

/**
 * Mean longitudes of the Galilean satellites, J2000.0 epoch.
 *
 * WHAT IS VERIFIED. The four rates reproduce the published sidereal periods
 * exactly to nine significant figures — 1.769137786, 3.551181041, 7.15455296
 * and 16.6890184 days — and the inner three satisfy the Laplace resonance
 * identity to the last digit: l1 − 3·l2 + 2·l3 is exactly 180° at epoch and
 * its daily term cancels to 1e-9 °/day, so the relation holds for centuries.
 * That identity is a real constraint on the RELATIVE phases of Io, Europa and
 * Ganymede, not a restatement of the periods, and it is what makes the picture
 * of the four of them trustworthy.
 *
 * WHAT IS NOT. The absolute zero point could not be checked against a
 * published event: the satellite-event tables (Project Pluto, TheSkyLive) are
 * unreachable from where this was written. So the card draws the system from
 * ABOVE, with no direction to Earth marked and no claim about which side of
 * Jupiter a moon appears on tonight — the geometry the resonance pins down is
 * shown, and the geometry it does not is not drawn. If somebody can open one
 * of those tables on the exhibit machine, an eclipse time would pin the phase
 * in about a minute and the card could then say which side to look at.
 */
export const GALILEAN: JupiterMoon[] = [
  {
    id: 'io',
    name: '이오',
    subtitle: 'Io',
    l0: 106.07719,
    rate: 203.48895579,
    radiusRj: 5.9057,
    distanceKm: 421700,
    diameterKm: 3643,
    color: '#ffd166',
    headline: '태양계에서 가장 화산이 많은 곳',
    facts: [
      '화산이 400개 넘게 있고, 지금 이 순간에도 터지고 있어요.',
      '목성이 잡아당겼다 놓았다 하면서 속을 주물러서, 안이 계속 뜨거워요.',
      '유황 때문에 온통 노랗고 주황색이에요.'
    ]
  },
  {
    id: 'europa',
    name: '유로파',
    subtitle: 'Europa',
    l0: 175.73161,
    rate: 101.374724735,
    radiusRj: 9.3966,
    distanceKm: 671034,
    diameterKm: 3122,
    color: '#9be8ff',
    headline: '얼음 밑에 바다가 있는 곳',
    facts: [
      '표면은 온통 얼음인데, 그 아래에 지구 바다를 전부 합친 것보다 많은 물이 있어요.',
      '태양계에서 가장 매끈해요. 높은 산이 거의 없어요.',
      '생명이 있을지도 몰라서, 지금 탐사선이 이곳으로 날아가고 있어요.'
    ]
  },
  {
    id: 'ganymede',
    name: '가니메데',
    subtitle: 'Ganymede',
    l0: 120.55883,
    rate: 50.317609207,
    radiusRj: 14.9883,
    distanceKm: 1070412,
    diameterKm: 5268,
    color: '#c9b8a8',
    headline: '태양계에서 가장 큰 위성',
    facts: [
      '수성보다도 커요. 위성인데 행성보다 큰 거예요.',
      '위성 중에 자기장을 가진 건 여기 하나뿐이에요.',
      '여기에도 얼음 밑에 바다가 있는 것 같아요.'
    ]
  },
  {
    id: 'callisto',
    name: '칼리스토',
    subtitle: 'Callisto',
    l0: 84.44459,
    rate: 21.571071177,
    radiusRj: 26.3627,
    distanceKm: 1882709,
    diameterKm: 4821,
    color: '#9fb6cf',
    headline: '가장 많이 얻어맞은 곳',
    facts: [
      '태양계에서 구덩이가 가장 빽빽한 곳이에요. 새 구덩이가 들어설 자리가 없어요.',
      '40억 년 동안 거의 그대로예요. 태양계의 옛날 모습을 그대로 보여줘요.',
      '목성에서 멀어서 방사선이 약해요. 언젠가 사람이 머문다면 여기일 거예요.'
    ]
  }
]

/** Days since J2000.0 (TT ignored — a minute of it moves Io by 0.14°). */
function daysSinceJ2000(ms: number): number {
  return ms / 86400000 + 2440587.5 - 2451545.0
}

/** Mean longitude of a moon in its orbit, 0..360. */
export function moonLongitude(m: JupiterMoon, ms: number): number {
  return (((m.l0 + m.rate * daysSinceJ2000(ms)) % 360) + 360) % 360
}

/**
 * Where a moon is, seen from above the orbital plane, in Jupiter radii.
 *
 * y is negated so that increasing longitude runs anticlockwise on an SVG,
 * whose y axis points down — all four go the same way round, and drawing one
 * of them backwards would be the kind of error that still looks fine.
 */
export function moonPosition(m: JupiterMoon, ms: number): { x: number; y: number } {
  const a = moonLongitude(m, ms) * RAD
  return { x: m.radiusRj * Math.cos(a), y: -m.radiusRj * Math.sin(a) }
}

/** How far through its orbit, 0..1 — for a progress ring on the card. */
export function moonPhase(m: JupiterMoon, ms: number): number {
  return moonLongitude(m, ms) / 360
}

/** Orbit period in days, from the rate rather than stored twice. */
export function moonPeriodDays(m: JupiterMoon): number {
  return 360 / m.rate
}

/* ------------------------------------------------------------------ *
 * The one thing that ever went in
 * ------------------------------------------------------------------ */

/**
 * Where the Galileo probe entered, 7 December 1995.
 *
 * 6.5°N, 4.4°W — and that W matters. Jupiter's System III longitudes run WEST,
 * the opposite way to the east-positive convention the renderer wants and the
 * opposite way to Mars, which this project already got wrong once in the rover
 * track parser. 4.4°W is 355.6°E.
 *
 * It is the only marker on this planet because it is the only place anything
 * has ever been. It fell for 57 minutes and 36 seconds, reached 23 times the
 * air pressure at sea level, and was crushed. There is no ground under it.
 */
export const GALILEO_PROBE = {
  id: 'galileo-probe',
  name: '갈릴레오 탐사기',
  subtitle: 'Galileo Probe',
  lonWest: 4.4,
  lat: 6.5,
  entered: '1995-12-07',
  /** Seconds of working life after entry. */
  lastedSec: 57 * 60 + 36,
  /** Pressure reached, in Earth atmospheres. */
  bar: 23,
  color: '#ff9d6b'
} as const

/** West longitude to the renderer's east-positive −180..180. */
export function westToRendererLon(lonWest: number): number {
  const e = ((360 - (lonWest % 360)) % 360 + 360) % 360
  return e > 180 ? e - 360 : e
}

/* ------------------------------------------------------------------ *
 * On their way
 * ------------------------------------------------------------------ */

export interface JupiterVisitor {
  id: string
  name: string
  subtitle: string
  agency: string
  /** Launch, ISO. */
  launched: string
  /**
   * Arrival, to the MONTH — which is the precision the published plans have
   * and the precision this shows. A day here would be invented.
   */
  arrivesYm: string
  arrivesLabel: string
  target: string
  why: string
  color: string
}

export const JUPITER_BOUND: JupiterVisitor[] = [
  {
    id: 'clipper',
    name: '유로파 클리퍼',
    subtitle: 'Europa Clipper',
    agency: 'NASA',
    launched: '2024-10-14',
    arrivesYm: '2030-04',
    arrivesLabel: '2030년 4월',
    target: '유로파',
    why: '얼음 밑 바다에 생명이 살 만한지 알아보러 가요. 유로파 옆을 50번 스쳐 지나갈 거예요.',
    color: '#7ce0a8'
  },
  {
    id: 'juice',
    name: '주스',
    subtitle: 'JUICE',
    agency: 'ESA',
    launched: '2023-04-14',
    arrivesYm: '2031-07',
    arrivesLabel: '2031년 7월',
    target: '가니메데',
    why: '가니메데를 도는 첫 탐사선이 될 거예요. 다른 행성의 위성을 도는 건 처음이에요.',
    color: '#b48cff'
  }
]

/** Months from now until a YYYY-MM, never negative. */
export function monthsUntil(ym: string, nowMs: number): number {
  const [y, m] = ym.split('-').map(Number)
  const now = new Date(nowMs)
  return Math.max(0, (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth()))
}

/** 68 -> "5년 8개월". Years alone is too coarse when the wait is this long. */
export function waitLabel(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (!y) return `${m}개월`
  return m ? `${y}년 ${m}개월` : `${y}년`
}

/** How far along the cruise is, 0..1 — launch to arrival. */
export function cruiseProgress(v: JupiterVisitor, nowMs: number): number {
  const from = Date.parse(v.launched + 'T00:00:00Z')
  const to = Date.parse(v.arrivesYm + '-01T00:00:00Z')
  return Math.max(0, Math.min(1, (nowMs - from) / (to - from)))
}
