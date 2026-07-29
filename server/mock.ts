// Deterministic-ish mock flight feed for development and as an offline fallback,
// so the exhibit keeps moving even when OpenSky is rate-limited or unreachable.
// Planes fly real great-circle routes between major airports, and carry full
// detail (airline, route, aircraft type, progress, times) for the panel.

import type { Aircraft, FlightDetail, GeoPoint } from '../src/shared/types'
import type { FlightFeed } from './feed'
import { greatCirclePoints, greatCircleDistanceKm } from '../src/shared/projection'
import { MOCK_POLL_INTERVAL_MS } from '../src/shared/config'
import { cityKo } from '../src/common/airports'

interface Airport {
  code: string
  city: string
  lon: number
  lat: number
  country: string
}

const AIRPORTS: Airport[] = [
  { code: 'ICN', city: 'Seoul', lon: 126.45, lat: 37.46, country: 'Republic of Korea' },
  { code: 'HND', city: 'Tokyo', lon: 139.78, lat: 35.55, country: 'Japan' },
  { code: 'PEK', city: 'Beijing', lon: 116.6, lat: 40.08, country: 'China' },
  { code: 'SIN', city: 'Singapore', lon: 103.99, lat: 1.36, country: 'Singapore' },
  { code: 'SYD', city: 'Sydney', lon: 151.18, lat: -33.95, country: 'Australia' },
  { code: 'DXB', city: 'Dubai', lon: 55.36, lat: 25.25, country: 'United Arab Emirates' },
  { code: 'DEL', city: 'Delhi', lon: 77.1, lat: 28.57, country: 'India' },
  { code: 'FRA', city: 'Frankfurt', lon: 8.57, lat: 50.03, country: 'Germany' },
  { code: 'LHR', city: 'London', lon: -0.46, lat: 51.47, country: 'United Kingdom' },
  { code: 'CDG', city: 'Paris', lon: 2.55, lat: 49.01, country: 'France' },
  { code: 'JFK', city: 'New York', lon: -73.78, lat: 40.64, country: 'United States' },
  { code: 'LAX', city: 'Los Angeles', lon: -118.41, lat: 33.94, country: 'United States' },
  { code: 'ORD', city: 'Chicago', lon: -87.9, lat: 41.98, country: 'United States' },
  { code: 'GRU', city: 'Sao Paulo', lon: -46.47, lat: -23.43, country: 'Brazil' },
  { code: 'JNB', city: 'Johannesburg', lon: 28.24, lat: -26.14, country: 'South Africa' },
  { code: 'YYZ', city: 'Toronto', lon: -79.63, lat: 43.68, country: 'Canada' },
  { code: 'MEX', city: 'Mexico City', lon: -99.07, lat: 19.44, country: 'Mexico' },
  { code: 'SFO', city: 'San Francisco', lon: -122.38, lat: 37.62, country: 'United States' },
  { code: 'HKG', city: 'Hong Kong', lon: 113.91, lat: 22.31, country: 'China' },
  { code: 'BKK', city: 'Bangkok', lon: 100.75, lat: 13.69, country: 'Thailand' }
]

const AIRLINES: Record<string, string> = {
  KAL: 'Korean Air',
  AAR: 'Asiana Airlines',
  UAL: 'United Airlines',
  DAL: 'Delta Air Lines',
  BAW: 'British Airways',
  AFR: 'Air France',
  DLH: 'Lufthansa',
  UAE: 'Emirates',
  SIA: 'Singapore Airlines',
  ANA: 'All Nippon Airways',
  QFA: 'Qantas',
  JAL: 'Japan Airlines'
}
const AIRLINE_CODES = Object.keys(AIRLINES)

/** Full country name → ISO 3166-1 alpha-2 (for the endpoint flag images). */
const COUNTRY_ISO: Record<string, string> = {
  'Republic of Korea': 'kr',
  Japan: 'jp',
  China: 'cn',
  Singapore: 'sg',
  Australia: 'au',
  'United Arab Emirates': 'ae',
  India: 'in',
  Germany: 'de',
  'United Kingdom': 'gb',
  France: 'fr',
  'United States': 'us',
  Brazil: 'br',
  'South Africa': 'za',
  Canada: 'ca',
  Mexico: 'mx',
  Thailand: 'th'
}
const TYPES = ['B787-9', 'A350-900', 'B777-300ER', 'A330-300', 'B747-8', 'A380-800', 'B737-800']

interface MockPlane {
  icao24: string
  callsign: string
  airlineCode: string
  aircraftType: string
  from: Airport
  to: Airport
  progress: number // 0..1 along the route
  speed: number // progress per tick
  velocity: number // m/s ground speed
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
    const airlineCode = pick(AIRLINE_CODES)
    planes.push({
      icao24: (0x400000 + i).toString(16).padStart(6, '0'),
      callsign: `${airlineCode}${100 + rnd(900)}`,
      airlineCode,
      aircraftType: pick(TYPES),
      from,
      to,
      progress: Math.random(),
      speed: 0.004 + Math.random() * 0.01,
      velocity: 230 + rnd(30),
      altitude: 9000 + rnd(3500),
      originCountry: from.country
    })
  }

  function snapshot(): Aircraft[] {
    const now = Date.now()
    return planes.map((pl) => {
      const { p, heading } = pointAlong(pl.from, pl.to, pl.progress)
      const edge = Math.min(pl.progress, 1 - pl.progress)
      const alt = pl.altitude * Math.min(1, edge * 8)
      return {
        icao24: pl.icao24,
        callsign: pl.callsign,
        lon: p.lon,
        lat: p.lat,
        altitude: Math.round(alt),
        velocity: pl.velocity,
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
        pl.from = pl.to
        let to = pick(AIRPORTS)
        while (to === pl.from) to = pick(AIRPORTS)
        pl.to = to
        pl.progress = 0
        pl.originCountry = pl.from.country
        pl.aircraftType = pick(TYPES)
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
      }, MOCK_POLL_INTERVAL_MS)
    },
    stop() {
      if (timer) clearInterval(timer)
    },
    async getDetail(icao24: string): Promise<FlightDetail | null> {
      const pl = planes.find((p) => p.icao24 === icao24)
      if (!pl) return null
      const distanceKm = greatCircleDistanceKm(pl.from, pl.to)
      const durationSec = (distanceKm * 1000) / pl.velocity
      const now = Date.now()
      return {
        icao24,
        airline: AIRLINES[pl.airlineCode] ?? pl.airlineCode,
        flightNo: pl.callsign,
        origin: {
          code: pl.from.code,
          city: cityKo(pl.from.code) ?? pl.from.city,
          countryCode: COUNTRY_ISO[pl.from.country],
          lon: pl.from.lon,
          lat: pl.from.lat
        },
        destination: {
          code: pl.to.code,
          city: cityKo(pl.to.code) ?? pl.to.city,
          countryCode: COUNTRY_ISO[pl.to.country],
          lon: pl.to.lon,
          lat: pl.to.lat
        },
        aircraftType: pl.aircraftType,
        departureTime: now - pl.progress * durationSec * 1000,
        etaRemainingSec: (1 - pl.progress) * durationSec,
        progress: pl.progress,
        route: greatCirclePoints(pl.from, pl.to, 128)
      }
    }
  }
}
