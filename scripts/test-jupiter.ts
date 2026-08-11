// Sanity checks for the Jupiter moon arithmetic (no test runner needed):
//   npm run test:jupiter
//
// The strong one is the Laplace resonance. Io, Europa and Ganymede are locked
// in a 4:2:1 relationship discovered by Laplace in 1805, and the identity
//
//     l1 - 3*l2 + 2*l3 = 180 degrees
//
// holds for as long as the resonance does. It constrains the three satellites'
// RELATIVE phases, not just their periods, so reproducing it is real evidence
// that the epoch longitudes below are the right ones and not merely
// self-consistent. It also means the three can never all be lined up on the
// same side of Jupiter — which is a fact worth knowing before drawing them.
import {
  GALILEAN,
  GALILEO_PROBE,
  JUPITER_BOUND,
  cruiseProgress,
  moonLongitude,
  moonPeriodDays,
  moonPosition,
  monthsUntil,
  waitLabel,
  westToRendererLon
} from '../src/shared/jupiter'

let failures = 0
function assert(name: string, cond: boolean): void {
  if (cond) console.log(`  ok  ${name}`)
  else {
    console.error(`FAIL  ${name}`)
    failures++
  }
}
const at = (iso: string): number => Date.parse(iso + 'T00:00:00Z')

// --- periods, against the published sidereal values ------------------------
console.log('\nsidereal periods')
const PUBLISHED: [string, number][] = [
  ['이오', 1.769137786],
  ['유로파', 3.551181041],
  ['가니메데', 7.15455296],
  ['칼리스토', 16.6890184]
]
// A tenth of a second per orbit. Tighter than that is tighter than the
// published figures are quoted to: Callisto's 16.6890184 has nine significant
// digits, and the last of them is worth 0.015 seconds.
GALILEAN.forEach((m, i) => {
  const [, want] = PUBLISHED[i]
  const got = moonPeriodDays(m)
  const errSec = Math.abs(got - want) * 86400
  assert(`${m.name} ${got.toFixed(9)}일 = ${want} (${errSec.toExponential(1)}초 차)`, errSec < 0.1)
})

// --- the Laplace resonance -------------------------------------------------
console.log('\nlaplace resonance  l1 - 3*l2 + 2*l3 = 180°')
const [io, eu, ga] = GALILEAN
for (const iso of ['2000-01-01', '2026-08-11', '2031-07-01', '2075-01-01', '1900-01-01']) {
  const t = at(iso)
  const raw = moonLongitude(io, t) - 3 * moonLongitude(eu, t) + 2 * moonLongitude(ga, t)
  const wrapped = (((raw % 360) + 360) % 360)
  assert(`${iso}  ${wrapped.toFixed(6)}°`, Math.abs(wrapped - 180) < 1e-3)
}
// And therefore the three are never in the same place at once.
console.log('\n...so the inner three can never line up together')
let minSpread = 360
for (let d = 0; d < 4000; d++) {
  const t = at('2026-01-01') + d * 3600_000
  const [a, b, c] = [io, eu, ga].map((m) => moonLongitude(m, t))
  const sep = (x: number, y: number): number => {
    const q = Math.abs(x - y) % 360
    return q > 180 ? 360 - q : q
  }
  minSpread = Math.min(minSpread, Math.max(sep(a, b), sep(b, c), sep(a, c)))
}
assert(`가장 가까웠을 때도 ${minSpread.toFixed(1)}° 벌어져 있음`, minSpread > 20)

// --- positions -------------------------------------------------------------
console.log('\npositions')
for (const m of GALILEAN) {
  const p = moonPosition(m, at('2026-08-11'))
  const r = Math.hypot(p.x, p.y)
  assert(`${m.name} 궤도 반지름 ${r.toFixed(4)} Rj`, Math.abs(r - m.radiusRj) < 1e-9)
  // Stored km and stored Jupiter radii must agree — two numbers for one fact.
  const impliedKm = m.radiusRj * 71492
  assert(
    `${m.name} ${m.radiusRj} Rj = ${Math.round(impliedKm).toLocaleString()} km vs ${m.distanceKm.toLocaleString()}`,
    Math.abs(impliedKm - m.distanceKm) / m.distanceKm < 0.005
  )
}
// All four go the same way round: longitude rising means y falling at y=0.
for (const m of GALILEAN) {
  const t = at('2026-08-11')
  const step = (moonPeriodDays(m) * 86400000) / 40
  const a = moonPosition(m, t)
  const b = moonPosition(m, t + step)
  const cross = a.x * b.y - a.y * b.x
  assert(`${m.name} 도는 방향이 같음`, cross < 0)
}
assert('가니메데가 가장 큼', Math.max(...GALILEAN.map((m) => m.diameterKm)) === 5268)
assert('수성(4,879km)보다 큼', 5268 > 4879)

// --- longitude convention --------------------------------------------------
console.log('\nlongitude (System III runs WEST)')
assert('4.4°W -> 355.6°E -> -4.4', Math.abs(westToRendererLon(4.4) + 4.4) < 1e-9)
assert('90°W -> 270°E -> -90', Math.abs(westToRendererLon(90) + 90) < 1e-9)
assert('270°W -> 90°E -> +90', Math.abs(westToRendererLon(270) - 90) < 1e-9)
assert('0°W -> 0', Math.abs(westToRendererLon(0)) < 1e-9)
assert(
  `갈릴레오 탐사기 ${GALILEO_PROBE.lonWest}°W -> ${westToRendererLon(GALILEO_PROBE.lonWest).toFixed(1)}`,
  Math.abs(westToRendererLon(GALILEO_PROBE.lonWest) + 4.4) < 1e-9
)
assert('57분 36초 = 3,456초', GALILEO_PROBE.lastedSec === 3456)

// --- the two on their way --------------------------------------------------
console.log('\non their way')
const now = at('2026-08-11')
for (const v of JUPITER_BOUND) {
  const months = monthsUntil(v.arrivesYm, now)
  const p = cruiseProgress(v, now)
  assert(
    `${v.name}: ${waitLabel(months)} 남음, ${(p * 100).toFixed(0)}% 왔음`,
    months > 0 && p > 0 && p < 1
  )
  assert(`${v.name} 발사가 도착보다 먼저`, Date.parse(v.launched) < Date.parse(v.arrivesYm + '-01'))
}
assert('클리퍼가 주스보다 먼저 도착', monthsUntil('2030-04', now) < monthsUntil('2031-07', now))
assert('도착일이 지나면 0개월', monthsUntil('2020-01', now) === 0)
assert('waitLabel(44) = 3년 8개월', waitLabel(44) === '3년 8개월')
assert('waitLabel(24) = 2년', waitLabel(24) === '2년')
assert('waitLabel(7) = 7개월', waitLabel(7) === '7개월')

console.log(failures === 0 ? '\nall good' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
