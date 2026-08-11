// Sanity checks for the Earth->Mars trip arithmetic (no test runner needed):
//   npx tsx scripts/test-mars-future.ts
//
// Everything here is checked against dates that were published years before
// this file existed, which is the only kind of check worth having for an
// almanac. The oppositions come from the observing tables; the 2020 departure
// is the day Perseverance actually left.
import {
  MARS_TARGETS,
  nextOpposition,
  nextTransferWindow,
  targetPosition,
  daysUntil
} from '../src/shared/mars-future'

let failures = 0
function assert(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    console.error(`FAIL  ${name}`)
    failures++
  }
}
const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const at = (iso: string): number => Date.parse(iso + 'T00:00:00Z')
const gap = (ms: number, iso: string): number => Math.abs(ms - at(iso)) / 86400000

// --- oppositions: Mars at its closest, from the published observing tables ---
console.log('\noppositions')
const OPP = ['2020-10-13', '2022-12-08', '2025-01-16', '2027-02-19', '2029-03-25']
let cursor = at('2020-01-01')
for (const want of OPP) {
  const got = nextOpposition(cursor)
  assert(`${want} (got ${day(got)}, ${gap(got, want).toFixed(1)}d)`, gap(got, want) < 1.5)
  cursor = got + 30 * 86400000
}

// --- departure windows -------------------------------------------------------
// Perseverance is the tight one: a real launch on a real day. The rest only
// have a month in the record, because a window is about four weeks wide.
console.log('\ndeparture windows')
const w2020 = nextTransferWindow(at('2019-06-01'))
assert(
  `2020 within 7d of Perseverance's 2020-07-30 (got ${day(w2020.departMs)})`,
  gap(w2020.departMs, '2020-07-30') < 7
)
const MONTHS: [string, string][] = [
  ['2022-01-01', '2022-09'],
  ['2023-06-01', '2024-10'],
  ['2025-06-01', '2026-11']
]
for (const [from, month] of MONTHS) {
  const w = nextTransferWindow(at(from))
  assert(`${month} window (got ${day(w.departMs)})`, day(w.departMs).startsWith(month))
}

// Flight time swings with Mars's distance at arrival — it is not a constant,
// and a card that printed "259일" every time would be quietly wrong.
console.log('\nflight times')
for (const from of ['2019-06-01', '2025-06-01', '2030-01-01']) {
  const w = nextTransferWindow(at(from))
  assert(
    `${day(w.departMs)} -> ${day(w.arriveMs)} in 230..290d (${w.travelDays.toFixed(0)})`,
    w.travelDays > 230 && w.travelDays < 290
  )
  assert(
    `${day(w.departMs)} arrival matches travelDays`,
    Math.abs(w.arriveMs - w.departMs - w.travelDays * 86400000) < 1000
  )
}

// Windows repeat on the synodic period, ~780 days. Anything else means the
// crossing search is finding the same one twice or skipping one.
console.log('\ncadence')
let prev = nextTransferWindow(at('2019-06-01')).departMs
for (let i = 0; i < 5; i++) {
  const next = nextTransferWindow(prev + 30 * 86400000).departMs
  const spanD = (next - prev) / 86400000
  assert(`${day(prev)} -> ${day(next)} is 730..830d (${spanD.toFixed(0)})`, spanD > 730 && spanD < 830)
  prev = next
}

// --- the map side ------------------------------------------------------------
console.log('\nlanding regions')
assert('three regions', MARS_TARGETS.length === 3)
for (const t of MARS_TARGETS) {
  const p = targetPosition(t)
  assert(`${t.name} lon in -180..180 (${p.lon.toFixed(2)})`, p.lon >= -180 && p.lon <= 180)
  // All three are northern-lowland sites between Elysium and Amazonis. A west
  // longitude read as east would land one of them outside this box, which is
  // the exact failure that put a rover 8,000km from its landing site once.
  assert(`${t.name} in the northern lowlands (${t.lat}N)`, t.lat > 30 && t.lat < 55)
  assert(`${t.name} east lon 160..190 (${t.lonEast})`, t.lonEast > 160 && t.lonEast < 190)
}
assert('Erebus Montes 185.02W reads as 174.98E', Math.abs(MARS_TARGETS[1].lonEast - 174.98) < 0.01)
assert('Arcadia 184.3E wraps to -175.7', Math.abs(targetPosition(MARS_TARGETS[0]).lon + 175.7) < 0.01)

// --- countdown ---------------------------------------------------------------
console.log('\ncountdown')
const t0 = at('2026-08-11')
assert('daysUntil rounds up, never negative', daysUntil(t0 - 1e9, t0) === 0)
assert('daysUntil same instant is 0', daysUntil(t0, t0) === 0)
assert('daysUntil 1.2 days out is 2', daysUntil(t0 + 1.2 * 86400000, t0) === 2)

console.log(failures === 0 ? '\nall good' : `\n${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
