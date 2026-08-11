// Everything that has ever landed on Mars and still has a place on a map,
// plus the arithmetic for what time it is where each of them sits.
//
// This file carries no network calls and never will. The coordinates and the
// dates are settled history; the words are written for a seven-year-old in a
// museum, which is not something an API returns. A later phase can layer the
// two live rovers' current sol and odometry on top — see PHASE 2 below — but
// the exhibit is complete without it, and works with the building's internet
// unplugged.

/**
 * Longitude, the one thing about Mars that silently mirrors a map.
 *
 * Every modern Mars product uses PLANETOCENTRIC EAST longitude, 0 to 360.
 * Older ones — the Viking era, most textbooks printed before about 2000 — use
 * WEST longitude, which runs the other way. The renderer wants -180..180 east.
 *
 * So the table below stores what the sources state, `lonEast` in 0..360, and
 * exactly one function converts. This project has already had a layer drawn
 * mirrored because two pieces of code disagreed about which way was up
 * (`mercUV` in globe.ts); the same mistake in longitude would put Olympus Mons
 * in the wrong hemisphere and nothing about the picture would look obviously
 * wrong. There is a check for it in the tests: Olympus Mons is 18.65°N,
 * 226.2°E, which is 133.8°W, and must come out at -133.8.
 */
export function eastToRendererLon(lonEast: number): number {
  const e = ((lonEast % 360) + 360) % 360
  return e > 180 ? e - 360 : e
}

export type ProbeStatus =
  /** Still working. */
  | 'active'
  /** Reached the surface, did its job, and was switched off or fell silent. */
  | 'ended'
  /** Reached the surface and was never heard from properly. */
  | 'lost'

export type ProbeKind = 'rover' | 'lander'

/**
 * Dot colour by state, shared so the map and the control list cannot disagree.
 *
 * Warm amber for the two that are still working, cool grey-blue for the ones
 * that finished, dim red for the ones that arrived and were never heard from.
 * On an ochre planet the living ones have to be the brightest thing on screen.
 */
export const PROBE_COLOR: Record<ProbeStatus, string> = {
  active: '#ffd166',
  ended: '#9fb6cf',
  lost: '#d2735f'
}

/** The one-word state, for a chip or a card. */
export const PROBE_STATE_LABEL: Record<ProbeStatus, string> = {
  active: '지금도 일하는 중',
  ended: '임무를 마쳤어요',
  lost: '소식이 끊겼어요'
}

export interface ProbeChapter {
  /** What to put in the margin: a year, or a sol, or a date. */
  when: string
  /** One sentence. The whole card is read standing up, by a child. */
  what: string
}

export interface MarsProbe {
  id: string
  /** Korean display name, then the name it is known by internationally. */
  name: string
  subtitle: string
  agency: string
  kind: ProbeKind
  status: ProbeStatus
  /** Planetocentric east longitude, 0..360 — the convention the sources use. */
  lonEast: number
  lat: number
  /** Where it came down, in words. */
  place: string
  /** Landing date, ISO. Used for the sol count as well as the timeline. */
  landed: string
  /**
   * When it stopped, ISO — absent while it is still going.
   *
   * The date of LAST CONTACT, not of the press conference. Opportunity fell
   * silent in June 2018 and NASA declared the mission over in February 2019,
   * and using the later date put its sol count at 5,350 against a documented
   * final sol of 5,111. The sol count is how long the machine actually worked,
   * so it has to run to the last day it worked.
   */
  ended?: string
  /**
   * Kilometres driven. Fixed for anything that has finished; for the two live
   * rovers this is a snapshot and `drivenAsOf` says when from, because it is
   * still climbing and an exhibit must not present a stale number as today's.
   */
  drivenKm: number
  drivenAsOf?: string
  chapters: ProbeChapter[]
}

/**
 * PHASE 2, when someone has verified the endpoints from the exhibit machine:
 * NASA's MMGIS publishes waypoint JSON for the two live rovers, which would
 * make `drivenKm`, the current sol and the last-known position live instead of
 * a snapshot. It is deliberately not wired yet. The proxy in the development
 * sandbox blocks mars.nasa.gov, and this project has already lost weeks to an
 * endpoint that was written into the code without anybody ever seeing it
 * answer (see the note on adsb.lol in server/routes.ts).
 */

export const MARS_PROBES: MarsProbe[] = [
  {
    id: 'mars3',
    name: '마르스 3호',
    subtitle: 'Mars 3',
    agency: '소련',
    kind: 'lander',
    status: 'lost',
    lat: -45,
    lonEast: 202,
    place: '시레눔 테라',
    landed: '1971-12-02',
    ended: '1971-12-02',
    drivenKm: 0,
    chapters: [
      { when: '1971', what: '인류가 다른 행성에 처음으로 무사히 내려놓은 물건이에요.' },
      { when: '착륙 20초 뒤', what: '사진을 보내기 시작하다가 끊겼어요. 화면의 절반도 오지 못했어요.' },
      { when: '지금', what: '왜 끊겼는지는 아직 아무도 몰라요. 모래폭풍이 한창일 때였어요.' }
    ]
  },
  {
    id: 'viking1',
    name: '바이킹 1호',
    subtitle: 'Viking 1',
    agency: 'NASA',
    kind: 'lander',
    status: 'ended',
    lat: 22.27,
    lonEast: 312.05,
    place: '크리세 평원',
    landed: '1976-07-20',
    ended: '1982-11-11',
    drivenKm: 0,
    chapters: [
      { when: '1976', what: '화성 땅에서 찍은 첫 사진을 보내왔어요. 하늘이 분홍색이었어요.' },
      { when: '1976~1982', what: '6년 넉 달을 버텼어요. 예정은 90일이었어요.' },
      { when: '마지막', what: '지구에서 잘못된 명령을 보내는 바람에 안테나가 딴 곳을 보게 됐어요.' }
    ]
  },
  {
    id: 'viking2',
    name: '바이킹 2호',
    subtitle: 'Viking 2',
    agency: 'NASA',
    kind: 'lander',
    status: 'ended',
    lat: 47.64,
    lonEast: 134.29,
    place: '우토피아 평원',
    landed: '1976-09-03',
    ended: '1980-04-11',
    drivenKm: 0,
    chapters: [
      { when: '1976', what: '흙을 퍼서 생명체가 있는지 검사했어요.' },
      { when: '1979', what: '화성에 서리가 내리는 걸 처음으로 봤어요.' }
    ]
  },
  {
    id: 'sojourner',
    name: '소저너',
    subtitle: 'Sojourner · Mars Pathfinder',
    agency: 'NASA',
    kind: 'rover',
    status: 'ended',
    lat: 19.13,
    lonEast: 326.78,
    place: '아레스 계곡',
    landed: '1997-07-04',
    ended: '1997-09-27',
    drivenKm: 0.1,
    chapters: [
      { when: '1997', what: '화성에서 처음으로 바퀴를 굴린 로봇이에요. 전자레인지만 했어요.' },
      { when: '83일', what: '착륙선에서 100미터도 채 못 갔지만, 그게 시작이었어요.' },
      { when: '이름', what: '노예 해방 운동가 소저너 트루스의 이름을 열두 살 아이가 지어 보냈어요.' }
    ]
  },
  {
    id: 'beagle2',
    name: '비글 2호',
    subtitle: 'Beagle 2',
    agency: '유럽·영국',
    kind: 'lander',
    status: 'lost',
    lat: 11.53,
    lonEast: 90.43,
    place: '이시디스 평원',
    landed: '2003-12-25',
    ended: '2003-12-25',
    drivenKm: 0,
    chapters: [
      { when: '2003', what: '크리스마스에 내렸는데 소식이 없었어요. 12년 동안 실종이었어요.' },
      { when: '2015', what: '화성을 도는 위성이 사진에서 찾아냈어요. 무사히 내렸더라고요.' },
      { when: '원인', what: '태양전지 날개 넉 장 중 하나가 안 펴져서 안테나가 가려져 있었어요.' }
    ]
  },
  {
    id: 'spirit',
    name: '스피릿',
    subtitle: 'Spirit · MER-A',
    agency: 'NASA',
    kind: 'rover',
    status: 'ended',
    lat: -14.57,
    lonEast: 175.47,
    place: '구세프 crater',
    landed: '2004-01-04',
    ended: '2010-03-22',
    drivenKm: 7.73,
    chapters: [
      { when: '2004', what: '90일만 일하기로 하고 왔어요.' },
      { when: '2006', what: '바퀴 하나가 고장 났어요. 그때부터 뒤로 끌며 다녔어요.' },
      { when: '2009', what: '모래에 빠져서 못 나왔어요. 그 자리에서 1년을 더 관측했어요.' },
      { when: '2010', what: '화성의 겨울에 햇빛을 못 받아 잠들었어요. 6년을 일했어요.' }
    ]
  },
  {
    id: 'opportunity',
    name: '오퍼튜니티',
    subtitle: 'Opportunity · MER-B',
    agency: 'NASA',
    kind: 'rover',
    status: 'ended',
    lat: -1.95,
    lonEast: 354.47,
    place: '메리디아니 평원',
    landed: '2004-01-25',
    ended: '2018-06-10',
    drivenKm: 45.16,
    chapters: [
      { when: '2004', what: '쌍둥이 스피릿과 함께, 역시 90일 예정으로 왔어요.' },
      { when: '2011', what: '마라톤 거리를 넘겼어요. 다른 행성에서 42km를 걸은 최초의 것이에요.' },
      { when: '2018', what: '행성 전체를 덮는 모래폭풍이 왔어요.' },
      {
        when: '마지막 신호',
        what: '"배터리가 부족하고, 주변이 어두워지고 있어요." 90일 예정으로 와서 5,100번의 화성 아침을 맞았어요.'
      },
      { when: '2019', what: '여덟 달을 더 불러봤지만 대답이 없어서, 그제야 작별 인사를 했어요.' }
    ]
  },
  {
    id: 'phoenix',
    name: '피닉스',
    subtitle: 'Phoenix',
    agency: 'NASA',
    kind: 'lander',
    status: 'ended',
    lat: 68.22,
    lonEast: 234.3,
    place: '화성 북극 근처',
    landed: '2008-05-25',
    ended: '2008-11-02',
    drivenKm: 0,
    chapters: [
      { when: '2008', what: '삽으로 흙을 퍼냈더니 하얀 것이 나왔어요. 며칠 뒤 사라졌어요.' },
      { when: '증명', what: '녹은 게 아니라 증발한 거예요. 그래서 그게 물 얼음이라는 걸 알았어요.' },
      { when: '겨울', what: '북극에 겨울이 오면서 햇빛이 끊겼어요. 예정대로였어요.' }
    ]
  },
  {
    id: 'curiosity',
    name: '큐리오시티',
    subtitle: 'Curiosity · MSL',
    agency: 'NASA',
    kind: 'rover',
    status: 'active',
    lat: -4.5895,
    lonEast: 137.4417,
    place: '게일 crater · 샤프산',
    landed: '2012-08-06',
    drivenKm: 34,
    drivenAsOf: '2025',
    chapters: [
      { when: '2012', what: '하늘에 뜬 크레인이 줄로 내려놨어요. 자동차만큼 커서 에어백을 못 썼거든요.' },
      { when: '2013', what: '옛날에 이 자리가 마실 수 있는 물이 흐르던 호수였다는 걸 밝혀냈어요.' },
      { when: '지금', what: '산을 오르는 중이에요. 지금도 매일 사진을 보내와요.' }
    ]
  },
  {
    id: 'insight',
    name: '인사이트',
    subtitle: 'InSight',
    agency: 'NASA',
    kind: 'lander',
    status: 'ended',
    lat: 4.502,
    lonEast: 135.623,
    place: '엘리시움 평원',
    landed: '2018-11-26',
    ended: '2022-12-21',
    drivenKm: 0,
    chapters: [
      { when: '2018', what: '움직이지 않는 대신 화성에 귀를 대러 왔어요.' },
      { when: '2019', what: '화성의 지진을 처음으로 들었어요. 별똥별이 떨어지는 소리도 들었어요.' },
      { when: '2022', what: '태양전지에 먼지가 쌓여 전기가 모자랐어요. 마지막으로 사진 한 장을 보냈어요.' }
    ]
  },
  {
    id: 'zhurong',
    name: '주룽',
    subtitle: 'Zhurong · 天问一号',
    agency: '중국',
    kind: 'rover',
    status: 'ended',
    lat: 25.066,
    lonEast: 109.925,
    place: '우토피아 평원',
    landed: '2021-05-15',
    ended: '2022-05-20',
    drivenKm: 1.9,
    chapters: [
      { when: '2021', what: '중국이 처음 보낸 화성 탐사차예요. 첫 시도에 성공했어요.' },
      { when: '2022', what: '겨울을 나려고 스스로 잠들었어요.' },
      { when: '그 뒤', what: '봄이 왔는데 깨어나지 못했어요. 먼지가 너무 쌓인 것 같아요.' }
    ]
  },
  {
    id: 'perseverance',
    name: '퍼서비어런스',
    subtitle: 'Perseverance · Mars 2020',
    agency: 'NASA',
    kind: 'rover',
    status: 'active',
    lat: 18.4447,
    lonEast: 77.4508,
    place: '예제로 crater',
    landed: '2021-02-18',
    drivenKm: 33,
    drivenAsOf: '2025',
    chapters: [
      { when: '2021', what: '옛날에 강물이 호수로 흘러들던 삼각주에 내렸어요.' },
      { when: '2021', what: '함께 온 헬리콥터 인제뉴어티가 다른 행성에서 처음으로 날았어요.' },
      { when: '지금', what: '돌 조각을 뽑아 땅에 놓아두고 있어요. 언젠가 지구로 가져오려고요.' }
    ]
  }
]

// ---------------------------------------------------------------------------
// What time is it there
// ---------------------------------------------------------------------------

/** A Mars day: 24 hours 39 minutes 35.244 seconds, in milliseconds. */
export const SOL_MS = 88775244

/**
 * Mars Sol Date, the count of Martian days since 1873-12-29.
 *
 * Standard Allison & McEwen formulation, as used by NASA's Mars24. Terrestrial
 * Time runs 69.184s ahead of UTC and has done since the last leap second, so
 * that offset is a constant here rather than a table.
 */
export function marsSolDate(nowMs: number): number {
  const jdUt = nowMs / 86400000 + 2440587.5
  const jdTt = jdUt + 69.184 / 86400
  return (jdTt - 2451549.5) / 1.02749125 + 44796.0 - 0.00096
}

/**
 * Local mean solar time at a longitude, as hours 0..24.
 *
 * Mars time runs west: the prime meridian's clock is Coordinated Mars Time and
 * every degree WEST of it is another 1/15th of an hour behind. The table stores
 * east longitude, so it is converted here rather than at each call site.
 */
export function marsLocalHours(lonEast: number, nowMs: number): number {
  const msd = marsSolDate(nowMs)
  const mtc = (msd - Math.floor(msd)) * 24
  const west = (((360 - lonEast) % 360) + 360) % 360
  return ((mtc - west / 15) % 24 + 24) % 24
}

/** That time as "14:07". */
export function marsClock(lonEast: number, nowMs: number): string {
  const h = marsLocalHours(lonEast, nowMs)
  const hh = Math.floor(h)
  const mm = Math.floor((h - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Where the sun is directly overhead on Mars, right now.
 *
 * The exhibit already draws a terminator on Earth, and it is worth being clear
 * that this is not the same objection as the one that kept the Mars map flat
 * lit. A shadow BAKED INTO a mosaic would be a fiction — the picture is
 * assembled from years of passes and has no time of day. A terminator drawn
 * OVER it is a statement about where the sun is at this instant, which is a
 * fact, and the earth map is the same kind of cloud-free composite underneath
 * the same treatment.
 *
 * Two numbers, and neither is Earth's. The longitude comes from Coordinated
 * Mars Time: local solar noon is where LMST reads 12, and LMST is MTC minus
 * west longitude over fifteen, so the subsolar meridian is
 * `360 - 15*(MTC - 12)`. The declination needs Mars' seasons — its axis is
 * tilted 25.19 degrees against Earth's 23.44, and its year is 687 days, so
 * borrowing Earth's day-of-year formula would put Martian summer in the wrong
 * month and the wrong hemisphere.
 *
 * Ls, the areocentric solar longitude, is the standard Mars24 series: a mean
 * sun angle linear in time plus an equation of centre. The perturbation terms
 * are left out, which costs under a tenth of a degree — far below anything a
 * terminator on a dome can show.
 */
export function marsSubsolar(nowMs: number): { lon: number; decl: number } {
  const jdTt = nowMs / 86400000 + 2440587.5 + 69.184 / 86400
  const dj = jdTt - 2451545.0
  const rad = Math.PI / 180
  // Mars mean anomaly and the fictitious mean sun, degrees.
  const m = (19.3871 + 0.52402073 * dj) * rad
  const alphaFms = 270.3871 + 0.524038496 * dj
  // Equation of centre: the difference between the real sun and the mean one.
  const eoc =
    10.691 * Math.sin(m) +
    0.623 * Math.sin(2 * m) +
    0.05 * Math.sin(3 * m) +
    0.005 * Math.sin(4 * m) +
    0.0005 * Math.sin(5 * m)
  const ls = (((alphaFms + eoc) % 360) + 360) % 360
  // 25.19 degrees of axial tilt, against Earth's 23.44.
  const decl = Math.asin(Math.sin(25.19 * rad) * Math.sin(ls * rad)) / rad

  const msd = marsSolDate(nowMs)
  const mtc = (msd - Math.floor(msd)) * 24
  const east = (((360 - 15 * (mtc - 12)) % 360) + 360) % 360
  return { lon: eastToRendererLon(east), decl }
}

/**
 * Which sol of its own mission a probe is on, counting the landing day as 0.
 *
 * Sols rather than days because that is how every one of these missions counts,
 * and because "화성에서 4,700번째 아침" is a truer thing to say to a child than
 * a number of Earth days would be.
 */
export function missionSol(probe: MarsProbe, nowMs: number): number {
  const from = Date.parse(probe.landed)
  const to = probe.ended ? Date.parse(probe.ended) : nowMs
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.max(0, Math.floor((to - from) / SOL_MS))
}

/**
 * Where to draw a probe: today's position if the live check has one, else the
 * landing site.
 *
 * Both windows call this rather than each doing the merge, because the two
 * decide independently what to draw and a disagreement between them is a
 * disagreement between the dome and the touchscreen a metre apart. The shape of
 * `live` is kept structural rather than importing the wire type, so this file
 * stays free of everything except its own data.
 */
export function probePosition(
  probe: MarsProbe,
  live?: { lon: number; lat: number }
): { lon: number; lat: number } {
  if (live && Number.isFinite(live.lon) && Number.isFinite(live.lat)) {
    return { lon: live.lon, lat: live.lat }
  }
  return { lon: eastToRendererLon(probe.lonEast), lat: probe.lat }
}

/** The probe nearest a point, for taps that land near a dot but not on one. */
export function nearestProbe(lon: number, lat: number, maxDeg = 12): MarsProbe | null {
  let best: MarsProbe | null = null
  let bestD = maxDeg
  for (const p of MARS_PROBES) {
    const dLon = Math.abs(((eastToRendererLon(p.lonEast) - lon + 540) % 360) - 180)
    const d = Math.hypot(dLon * Math.cos((lat * Math.PI) / 180), p.lat - lat)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}
