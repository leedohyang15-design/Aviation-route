// Lightweight sanity checks for the projection math (no test runner needed):
//   npm run test:projection
import {
  wrapLon,
  projectNorm,
  greatCirclePoints,
  splitAtAntimeridian
} from '../src/shared/projection'

let failures = 0
function assert(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    console.error(`FAIL  ${name}`)
    failures++
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

// wrapLon
assert('wrapLon(190) -> -170', near(wrapLon(190), -170))
assert('wrapLon(-190) -> 170', near(wrapLon(-190), 170))
assert('wrapLon(0) -> 0', near(wrapLon(0), 0))

// projectNorm: prime meridian at equator -> center of frame
const c = projectNorm(0, 0, 0)
assert('projectNorm(0,0) u=0.5', near(c.u, 0.5))
assert('projectNorm(0,0) v=0.5', near(c.v, 0.5))
// North pole -> top (v=0); lon -180 -> left (u=0)
assert('projectNorm(-180,90) u=0 v=0', near(projectNorm(-180, 90, 0).u, 0) && near(projectNorm(-180, 90, 0).v, 0))
// Longitude spin shifts u
assert('spin +90 moves lon0 to u=0.75', near(projectNorm(0, 0, 90).u, 0.75))

// great circle: Seoul -> New York should bow north (max lat > both endpoints)
const gc = greatCirclePoints({ lon: 126.97, lat: 37.57 }, { lon: -74.0, lat: 40.71 }, 64)
const maxLat = Math.max(...gc.map((p) => p.lat))
assert('Seoul->NY great circle bows north (>50°)', maxLat > 50)
assert('great circle endpoints preserved', near(gc[0].lat, 37.57, 1e-3) && near(gc[gc.length - 1].lat, 40.71, 1e-3))

// antimeridian split
const crossing = [
  { lon: 170, lat: 0 },
  { lon: 178, lat: 5 },
  { lon: -175, lat: 10 }, // jumps across ±180
  { lon: -170, lat: 15 }
]
const segs = splitAtAntimeridian(crossing)
assert('antimeridian split -> 2 segments', segs.length === 2)
assert('no split for normal line', splitAtAntimeridian([{ lon: 0, lat: 0 }, { lon: 10, lat: 0 }]).length === 1)

console.log(failures === 0 ? '\nAll projection checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
