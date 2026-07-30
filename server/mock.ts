// Deterministic-ish mock flight feed for development and as an offline fallback,
// so the exhibit keeps moving even when OpenSky is rate-limited or unreachable.
// Planes fly real great-circle routes between major airports, and carry full
// detail (airline, route, aircraft type, progress, times) for the panel.
//
// Everything visitors can read is Korean: airline names come from the shared
// ICAO table and city names from the shared IATA table, so the simulation reads
// the same as the real feed.

import type { Aircraft, FlightDetail, GeoPoint } from '../src/shared/types'
import type { FlightFeed } from './feed'
import {
  greatCirclePoints,
  greatCirclePointAt,
  greatCircleDistanceKm
} from '../src/shared/projection'
import { MOCK_POLL_INTERVAL_MS, MOCK_AIRCRAFT_COUNT } from '../src/shared/config'
import { cityKo } from '../src/common/airports'
import { AIRLINES, airlineFromCallsign } from '../src/common/airlines'

interface Airport {
  code: string
  lon: number
  lat: number
  /** ISO 3166-1 alpha-2, for the endpoint flag images. */
  iso: string
  /** Korean country name — used as the aircraft's origin country. */
  country: string
}

// Major worldwide airports. Korean city names come from the shared IATA table
// (`cityKo`), so only coordinates and country need to live here.
const A = (code: string, lon: number, lat: number, iso: string, country: string): Airport => ({
  code,
  lon,
  lat,
  iso,
  country
})

const AIRPORTS: Airport[] = [
  // --- Korea / Japan ---
  A('ICN', 126.45, 37.46, 'kr', '대한민국'),
  A('GMP', 126.79, 37.56, 'kr', '대한민국'),
  A('CJU', 126.49, 33.51, 'kr', '대한민국'),
  A('PUS', 128.94, 35.18, 'kr', '대한민국'),
  A('HND', 139.78, 35.55, 'jp', '일본'),
  A('NRT', 140.39, 35.77, 'jp', '일본'),
  A('KIX', 135.24, 34.43, 'jp', '일본'),
  A('CTS', 141.69, 42.78, 'jp', '일본'),
  A('FUK', 130.45, 33.59, 'jp', '일본'),
  A('NGO', 136.81, 34.86, 'jp', '일본'),
  // --- China / Taiwan / Hong Kong ---
  A('PEK', 116.6, 40.08, 'cn', '중국'),
  A('PKX', 116.41, 39.51, 'cn', '중국'),
  A('PVG', 121.81, 31.14, 'cn', '중국'),
  A('SHA', 121.34, 31.2, 'cn', '중국'),
  A('CAN', 113.3, 23.39, 'cn', '중국'),
  A('SZX', 113.81, 22.64, 'cn', '중국'),
  A('CTU', 103.95, 30.58, 'cn', '중국'),
  A('KMG', 102.93, 25.1, 'cn', '중국'),
  A('XIY', 108.75, 34.45, 'cn', '중국'),
  A('HGH', 120.43, 30.23, 'cn', '중국'),
  A('TSN', 117.35, 39.12, 'cn', '중국'),
  A('TPE', 121.23, 25.08, 'tw', '대만'),
  A('HKG', 113.91, 22.31, 'hk', '홍콩'),
  A('MFM', 113.59, 22.15, 'mo', '마카오'),
  // --- Southeast Asia ---
  A('MNL', 121.02, 14.51, 'ph', '필리핀'),
  A('CEB', 123.98, 10.31, 'ph', '필리핀'),
  A('SIN', 103.99, 1.36, 'sg', '싱가포르'),
  A('KUL', 101.71, 2.74, 'my', '말레이시아'),
  A('BKK', 100.75, 13.69, 'th', '태국'),
  A('DMK', 100.61, 13.91, 'th', '태국'),
  A('HKT', 98.31, 8.11, 'th', '태국'),
  A('CGK', 106.66, -6.13, 'id', '인도네시아'),
  A('DPS', 115.17, -8.75, 'id', '인도네시아'),
  A('SGN', 106.66, 10.82, 'vn', '베트남'),
  A('HAN', 105.81, 21.22, 'vn', '베트남'),
  A('RGN', 96.13, 16.91, 'mm', '미얀마'),
  A('PNH', 104.84, 11.55, 'kh', '캄보디아'),
  A('VTE', 102.56, 17.99, 'la', '라오스'),
  // --- South Asia ---
  A('DEL', 77.1, 28.57, 'in', '인도'),
  A('BOM', 72.87, 19.09, 'in', '인도'),
  A('BLR', 77.71, 13.2, 'in', '인도'),
  A('MAA', 80.17, 12.99, 'in', '인도'),
  A('CCU', 88.45, 22.65, 'in', '인도'),
  A('HYD', 78.43, 17.24, 'in', '인도'),
  A('CMB', 79.88, 7.18, 'lk', '스리랑카'),
  A('DAC', 90.4, 23.84, 'bd', '방글라데시'),
  A('KTM', 85.36, 27.7, 'np', '네팔'),
  A('ISB', 72.83, 33.55, 'pk', '파키스탄'),
  A('KHI', 67.16, 24.91, 'pk', '파키스탄'),
  A('LHE', 74.4, 31.52, 'pk', '파키스탄'),
  // --- Middle East ---
  A('DXB', 55.36, 25.25, 'ae', '아랍에미리트'),
  A('AUH', 54.65, 24.43, 'ae', '아랍에미리트'),
  A('DOH', 51.61, 25.27, 'qa', '카타르'),
  A('RUH', 46.7, 24.96, 'sa', '사우디아라비아'),
  A('JED', 39.16, 21.68, 'sa', '사우디아라비아'),
  A('KWI', 47.97, 29.23, 'kw', '쿠웨이트'),
  A('BAH', 50.63, 26.27, 'bh', '바레인'),
  A('MCT', 58.28, 23.59, 'om', '오만'),
  A('AMM', 35.99, 31.72, 'jo', '요르단'),
  A('TLV', 34.87, 32.01, 'il', '이스라엘'),
  A('IST', 28.74, 41.26, 'tr', '튀르키예'),
  A('SAW', 29.31, 40.9, 'tr', '튀르키예'),
  A('ESB', 32.99, 40.13, 'tr', '튀르키예'),
  A('AYT', 30.8, 36.9, 'tr', '튀르키예'),
  // --- Russia ---
  A('SVO', 37.41, 55.97, 'ru', '러시아'),
  A('DME', 37.9, 55.41, 'ru', '러시아'),
  A('LED', 30.26, 59.8, 'ru', '러시아'),
  A('KZN', 49.28, 55.61, 'ru', '러시아'),
  A('OVB', 82.65, 55.01, 'ru', '러시아'),
  // --- Europe ---
  A('FRA', 8.57, 50.03, 'de', '독일'),
  A('MUC', 11.79, 48.35, 'de', '독일'),
  A('BER', 13.5, 52.36, 'de', '독일'),
  A('DUS', 6.77, 51.29, 'de', '독일'),
  A('HAM', 10.0, 53.63, 'de', '독일'),
  A('CDG', 2.55, 49.01, 'fr', '프랑스'),
  A('ORY', 2.36, 48.73, 'fr', '프랑스'),
  A('NCE', 7.22, 43.66, 'fr', '프랑스'),
  A('LYS', 5.08, 45.73, 'fr', '프랑스'),
  A('LHR', -0.46, 51.47, 'gb', '영국'),
  A('LGW', -0.19, 51.15, 'gb', '영국'),
  A('STN', 0.23, 51.89, 'gb', '영국'),
  A('MAN', -2.27, 53.35, 'gb', '영국'),
  A('EDI', -3.37, 55.95, 'gb', '영국'),
  A('AMS', 4.76, 52.31, 'nl', '네덜란드'),
  A('BRU', 4.48, 50.9, 'be', '벨기에'),
  A('ZRH', 8.55, 47.46, 'ch', '스위스'),
  A('GVA', 6.11, 46.24, 'ch', '스위스'),
  A('VIE', 16.57, 48.11, 'at', '오스트리아'),
  A('CPH', 12.65, 55.62, 'dk', '덴마크'),
  A('ARN', 17.92, 59.65, 'se', '스웨덴'),
  A('OSL', 11.1, 60.19, 'no', '노르웨이'),
  A('HEL', 24.96, 60.32, 'fi', '핀란드'),
  A('MAD', -3.57, 40.47, 'es', '스페인'),
  A('BCN', 2.08, 41.3, 'es', '스페인'),
  A('LIS', -9.14, 38.77, 'pt', '포르투갈'),
  A('OPO', -8.68, 41.24, 'pt', '포르투갈'),
  A('FCO', 12.25, 41.8, 'it', '이탈리아'),
  A('MXP', 8.71, 45.63, 'it', '이탈리아'),
  A('VCE', 12.35, 45.51, 'it', '이탈리아'),
  A('NAP', 14.29, 40.89, 'it', '이탈리아'),
  A('ATH', 23.95, 37.94, 'gr', '그리스'),
  A('PRG', 14.26, 50.1, 'cz', '체코'),
  A('WAW', 20.97, 52.17, 'pl', '폴란드'),
  A('BUD', 19.26, 47.44, 'hu', '헝가리'),
  A('OTP', 26.09, 44.57, 'ro', '루마니아'),
  A('KBP', 30.89, 50.34, 'ua', '우크라이나'),
  A('DUB', -6.27, 53.42, 'ie', '아일랜드'),
  A('KEF', -22.61, 63.99, 'is', '아이슬란드'),
  // --- North America ---
  A('JFK', -73.78, 40.64, 'us', '미국'),
  A('EWR', -74.17, 40.69, 'us', '미국'),
  A('LGA', -73.87, 40.78, 'us', '미국'),
  A('LAX', -118.41, 33.94, 'us', '미국'),
  A('SFO', -122.38, 37.62, 'us', '미국'),
  A('SEA', -122.31, 47.45, 'us', '미국'),
  A('ORD', -87.9, 41.98, 'us', '미국'),
  A('ATL', -84.43, 33.64, 'us', '미국'),
  A('DFW', -97.04, 32.9, 'us', '미국'),
  A('IAH', -95.34, 29.98, 'us', '미국'),
  A('DEN', -104.67, 39.86, 'us', '미국'),
  A('LAS', -115.15, 36.08, 'us', '미국'),
  A('PHX', -112.01, 33.44, 'us', '미국'),
  A('MIA', -80.29, 25.79, 'us', '미국'),
  A('MCO', -81.31, 28.43, 'us', '미국'),
  A('BOS', -71.01, 42.36, 'us', '미국'),
  A('IAD', -77.46, 38.94, 'us', '미국'),
  A('PHL', -75.24, 39.87, 'us', '미국'),
  A('MSP', -93.22, 44.88, 'us', '미국'),
  A('DTW', -83.35, 42.21, 'us', '미국'),
  A('CLT', -80.94, 35.21, 'us', '미국'),
  A('SLC', -111.98, 40.79, 'us', '미국'),
  A('SAN', -117.19, 32.73, 'us', '미국'),
  A('PDX', -122.6, 45.59, 'us', '미국'),
  A('HNL', -157.92, 21.32, 'us', '미국'),
  A('ANC', -149.99, 61.17, 'us', '미국'),
  A('YYZ', -79.63, 43.68, 'ca', '캐나다'),
  A('YVR', -123.18, 49.19, 'ca', '캐나다'),
  A('YUL', -73.74, 45.47, 'ca', '캐나다'),
  A('YYC', -114.02, 51.13, 'ca', '캐나다'),
  A('YEG', -113.58, 53.31, 'ca', '캐나다'),
  A('MEX', -99.07, 19.44, 'mx', '멕시코'),
  A('CUN', -86.87, 21.04, 'mx', '멕시코'),
  A('GDL', -103.31, 20.52, 'mx', '멕시코'),
  // --- South America ---
  A('GRU', -46.47, -23.43, 'br', '브라질'),
  A('GIG', -43.25, -22.81, 'br', '브라질'),
  A('BSB', -47.92, -15.87, 'br', '브라질'),
  A('EZE', -58.54, -34.82, 'ar', '아르헨티나'),
  A('SCL', -70.79, -33.39, 'cl', '칠레'),
  A('LIM', -77.11, -12.02, 'pe', '페루'),
  A('BOG', -74.15, 4.7, 'co', '콜롬비아'),
  A('UIO', -78.36, -0.13, 'ec', '에콰도르'),
  A('PTY', -79.38, 9.07, 'pa', '파나마'),
  A('CCS', -66.99, 10.6, 've', '베네수엘라'),
  A('MVD', -56.03, -34.84, 'uy', '우루과이'),
  // --- Africa ---
  A('JNB', 28.24, -26.14, 'za', '남아프리카공화국'),
  A('CPT', 18.6, -33.97, 'za', '남아프리카공화국'),
  A('DUR', 31.12, -29.61, 'za', '남아프리카공화국'),
  A('NBO', 36.93, -1.32, 'ke', '케냐'),
  A('ADD', 38.8, 8.98, 'et', '에티오피아'),
  A('CAI', 31.41, 30.12, 'eg', '이집트'),
  A('CMN', -7.59, 33.37, 'ma', '모로코'),
  A('LOS', 3.32, 6.58, 'ng', '나이지리아'),
  A('ACC', -0.17, 5.61, 'gh', '가나'),
  A('DAR', 39.2, -6.87, 'tz', '탄자니아'),
  A('TUN', 10.23, 36.85, 'tn', '튀니지'),
  A('ALG', 3.21, 36.69, 'dz', '알제리'),
  // --- Oceania ---
  A('SYD', 151.18, -33.95, 'au', '호주'),
  A('MEL', 144.84, -37.67, 'au', '호주'),
  A('BNE', 153.12, -27.38, 'au', '호주'),
  A('PER', 115.97, -31.94, 'au', '호주'),
  A('ADL', 138.53, -34.95, 'au', '호주'),
  A('AKL', 174.79, -37.01, 'nz', '뉴질랜드'),
  A('CHC', 172.53, -43.49, 'nz', '뉴질랜드'),
  A('WLG', 174.81, -41.33, 'nz', '뉴질랜드'),
  A('NAN', 177.44, -17.75, 'fj', '피지')
]

// Operator codes from the shared table, so every mock callsign resolves to a
// Korean airline name (and passes the "known flight" filter) like real data does.
const AIRLINE_CODES = Object.keys(AIRLINES)

const TYPES = [
  'B787-9',
  'A350-900',
  'B777-300ER',
  'A330-300',
  'B747-8',
  'A380-800',
  'B737-800',
  'A320-200',
  'A321neo',
  'B737 MAX 8',
  'B767-300',
  'E190'
]

interface MockPlane {
  icao24: string
  callsign: string
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

/** Current point plus local heading. This runs for every plane on every tick, so
 * it samples the two points it needs instead of building the whole path. */
function pointAlong(a: GeoPoint, b: GeoPoint, t: number): { p: GeoPoint; heading: number } {
  const p = greatCirclePointAt(a, b, t)
  const ahead = greatCirclePointAt(a, b, Math.min(1, t + 0.002))
  return { p, heading: bearing(p, ahead) }
}

export function createMockFeed(count = MOCK_AIRCRAFT_COUNT): FlightFeed {
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

  // Thousands of planes are JSON-encoded and sent to both windows on every tick,
  // so trim float noise: 4 decimals of lon/lat is ~11 m, far finer than a pixel.
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4

  function snapshot(): Aircraft[] {
    const now = Date.now()
    return planes.map((pl) => {
      const { p, heading } = pointAlong(pl.from, pl.to, pl.progress)
      const edge = Math.min(pl.progress, 1 - pl.progress)
      const alt = pl.altitude * Math.min(1, edge * 8)
      return {
        icao24: pl.icao24,
        callsign: pl.callsign,
        lon: r4(p.lon),
        lat: r4(p.lat),
        altitude: Math.round(alt),
        velocity: pl.velocity,
        heading: Math.round(heading * 10) / 10,
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

  /** Airport → the panel's endpoint shape, with the Korean city name. */
  const endpoint = (ap: Airport) => ({
    code: ap.code,
    city: cityKo(ap.code) ?? ap.code,
    countryCode: ap.iso,
    lon: ap.lon,
    lat: ap.lat
  })

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
        airline: airlineFromCallsign(pl.callsign) ?? pl.callsign.slice(0, 3),
        flightNo: pl.callsign,
        origin: endpoint(pl.from),
        destination: endpoint(pl.to),
        aircraftType: pl.aircraftType,
        departureTime: now - pl.progress * durationSec * 1000,
        etaRemainingSec: (1 - pl.progress) * durationSec,
        progress: pl.progress,
        route: greatCirclePoints(pl.from, pl.to, 128)
      }
    }
  }
}
