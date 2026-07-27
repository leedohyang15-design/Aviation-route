// Deterministic-ish mock flight feed for development and as an offline fallback,
// so the exhibit keeps moving even when OpenSky is rate-limited or unreachable.
// Planes fly real great-circle routes between major airports.

import type { Aircraft, GeoPoint } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { greatCirclePoints } from '../src/shared/projection'
import { POLL_INTERVAL_MS } from '../src/shared/config'

interface Airport {
  code: string
  lon: number
  lat: number
  country: string
}

const AIRPORTS: Airport[] = [
  { code: 'ICN', lon: 126.45, lat: 37.46, country: 'Republic of Korea' },
  { code: 'HND', lon: 139.78, lat: 35.55, country: 'Japan' },
  { code: 'PEK', lon: 116.6, lat: 40.08, country: 'China' },
  { code: 'SIN', lon: 103.99, lat: 1.36, country: 'Singapore' },
  { code: 'SYD', lon: 151.18, lat: -33.95, country: 'Australia' },
  { code: 'DXB', lon: 55.36, lat: 25.25, country: 'United Arab Emirates' },
  { code: 'DEL', lon: 77.1, lat: 28.57, country: 'India' },
  { code: 'FRA', lon: 8.57, lat: 50.03, country: 'Germany' },
  { code: 'LHR', lon: -0.46, lat: 51.47, country: 'United Kingdom' },
  { code: 'CDG', lon: 2.55, lat: 49.01, country: 'France' },
  { code: 'JFK', lon: -73.78, lat: 40.64, country: 'United States' },
  { code: 'LAX', lon: -118.41, lat: 33.94, country: 'United States' },
  { code: 'ORD', lon: -87.9, lat: 41.98, country: 'United States' },
  { code: 'GRU', lon: -46.47, lat: -23.43, country: 'Brazil' },
  { code: 'JNB', lon: 28.24, lat: -26.14, country: 'South Africa' },
  { code: 'YYZ', lon: -79.63, lat: 43.68, country: 'Canada' },
  { code: 'MEX', lon: -99.07, lat: 19.44, country: 'Mexico' },
  { code: 'SFO', lon: -122.38, lat: 37.62, country: 'United States' },
  { code: 'HKG', lon: 113.91, lat: 22.31, country: 'China' },
  { code: 'BKK', lon: 100.75, lat: 13.69, country: 'Thailand' }
]

const AIRLINES = ['KAL', 'AAR', 'UAL', 'DAL', 'BAW', 'AFR', 'DLH', 'UAE', 'SIA', 'ANA', 'QFA', 'JAL']

interface MockPlane {
  icao24: string
  callsign: string
  from: Airport
  to: Airport
  progress: number // 0..1 along the route
  speed: number // progress per tick
  altitude: number
  originCountry: string
}

function bearing(a: GeoPoint, b: GeoPoint): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Point at fraction t along the great circle a→b, plus the local heading. */
function pointAlong(a: GeoPoint, b: GeoPoint, t: number): { p: GeoPoint; heading: number } {
  const pts = greatCirclePoints(a, b, 64)
  const idx = Math.min(pts.length - 2, Math.max(0, Math.floor(t * (pts.length - 1))))
  const local = pts[idx]
  const next = pts[idx + 1] ?? pts[idx]
  return { p: local, heading: bearing(local, next) }
}

export function createMockFeed(count = 400): FlightFeed {
  let timer: NodeJS.Timeout | null = null
  const planes: MockPlane[] = []

  const rnd = (n: number) => Math.floor(Math.random() * n)
  const pick = <T>(arr: T[]) => arr[rnd(arr.length)]

  for (let i = 0; i < count; i++) {
    const from = pick(AIRPORTS)
    let to = pick(AIRPORTS)
    while (to === from) to = pick(AIRPORTS)
    const airline = pick(AIRLINES)
    planes.push({
      icao24: (0x400000 + i).toString(16).padStart(6, '0'),
      callsign: `${airline}${100 + rnd(900)}`,
      from,
      to,
      progress: Math.random(),
      speed: 0.004 + Math.random() * 0.01,
      altitude: 9000 + rnd(3500),
      originCountry: from.country
    })
  }

  function snapshot(): Aircraft[] {
    const now = Date.now()
    return planes.map((pl) => {
      const { p, heading } = pointAlong(pl.from, pl.to, pl.progress)
      // Fade altitude near the ends to fake climb/descent.
      const edge = Math.min(pl.progress, 1 - pl.progress)
      const alt = pl.altitude * Math.min(1, edge * 8)
      return {
        icao24: pl.icao24,
        callsign: pl.callsign,
        lon: p.lon,
        lat: p.lat,
        altitude: Math.round(alt),
        velocity: 220 + (pl.icao24.charCodeAt(0) % 40),
        heading,
        verticalRate: 0,
        onGround: edge < 0.01,
        originCountry: pl.originCountry,
        lastContact: now
      }
    })
  }

  function advance(): void {
    for (const pl of planes) {
      pl.progress += pl.speed
      if (pl.progress >= 1) {
        // Arrived: depart again from the destination to a fresh airport.
        pl.from = pl.to
        let to = pick(AIRPORTS)
        while (to === pl.from) to = pick(AIRPORTS)
        pl.to = to
        pl.progress = 0
        pl.originCountry = pl.from.country
      }
    }
  }

  return {
    source: 'mock',
    start(onSnapshot, onStatus) {
      onStatus(true)
      onSnapshot(snapshot())
      timer = setInterval(() => {
        advance()
        onSnapshot(snapshot())
      }, POLL_INTERVAL_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
    },
    getRoute(icao24) {
      const pl = planes.find((p) => p.icao24 === icao24)
      if (!pl) return null
      return greatCirclePoints(pl.from, pl.to, 128)
    }
  }
}
