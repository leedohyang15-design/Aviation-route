// The other half of the Mars tab: not where robots have been, but when a
// person could go and where they would put it down.
//
// Like shared/probes.ts this file never touches the network, and for the same
// reason — but there is a second reason here. A schedule is the most
// perishable thing in spaceflight. An exhibit that hard-codes "2026년에
//갑니다!" is wrong the moment it slips, and it will slip. So the number this
// tab leads with is the one nobody can postpone: the next date the two planets
// are actually in the right places. That is arithmetic, it recomputes itself
// every time the card is drawn, and it will still be right in 2035.
//
// What a company plans goes UNDERNEATH that, with the date it was said on
// attached, so a visitor reading it in two years can tell how old it is.

import { eastToRendererLon } from './probes'

/* ------------------------------------------------------------------ *
 * Where the two planets are
 * ------------------------------------------------------------------ */

const RAD = Math.PI / 180
const DAY_MS = 86400000
/** Days in a Julian year — the unit Kepler's third law comes out in below. */
const YEAR_D = 365.25636

/**
 * Standish's approximate elements for the inner planets, J2000, per Julian
 * century. Published for 1800–2050 at about an arcminute; this exhibit needs
 * a day, so there is roughly three orders of magnitude of headroom.
 *
 * Verified against the last five Mars oppositions (2020-10-13, 2022-12-08,
 * 2025-01-16, 2027-02-19, 2029-03-25): every one lands within a day.
 */
interface Elements {
  /** Semi-major axis, AU. */
  a0: number
  a1: number
  /** Eccentricity. */
  e0: number
  e1: number
  /** Mean longitude, degrees. */
  L0: number
  L1: number
  /** Longitude of perihelion, degrees. */
  w0: number
  w1: number
}

const EARTH: Elements = {
  a0: 1.00000261,
  a1: 0.00000562,
  e0: 0.01671123,
  e1: -0.00004392,
  L0: 100.46457166,
  L1: 35999.37244981,
  w0: 102.93768193,
  w1: 0.32327364
}

const MARS: Elements = {
  a0: 1.52371034,
  a1: 0.00001847,
  e0: 0.0933941,
  e1: 0.00007882,
  L0: -4.55343205,
  L1: 19140.30268499,
  w0: -23.94362959,
  w1: 0.44441088
}

/** Julian centuries since J2000, from a Unix millisecond. */
function centuries(ms: number): number {
  return (ms / DAY_MS + 2440587.5 - 2451545.0) / 36525
}

/**
 * Heliocentric longitude and distance of a planet.
 *
 * Inclination is dropped: Mars sits 1.85° out of the ecliptic, which moves its
 * projected longitude by under a tenth of a degree — a couple of hours on a
 * date this file rounds to the day.
 */
function orbit(el: Elements, t: number): { lon: number; r: number } {
  const a = el.a0 + el.a1 * t
  const e = el.e0 + el.e1 * t
  const L = el.L0 + el.L1 * t
  const w = el.w0 + el.w1 * t
  let M = (((L - w) % 360) + 360) % 360
  if (M > 180) M -= 360
  // Kepler's equation. Newton from M converges to machine precision in a
  // handful of steps at these eccentricities; twelve is free and certain.
  let E = M + (e / RAD) * Math.sin(M * RAD)
  for (let i = 0; i < 12; i++) {
    E += (M - (E - (e / RAD) * Math.sin(E * RAD))) / (1 - e * Math.cos(E * RAD))
  }
  const nu =
    (2 *
      Math.atan2(
        Math.sqrt(1 + e) * Math.sin((E * RAD) / 2),
        Math.sqrt(1 - e) * Math.cos((E * RAD) / 2)
      )) /
    RAD
  return { lon: (((nu + w) % 360) + 360) % 360, r: a * (1 - e * Math.cos(E * RAD)) }
}

/** Mars minus Earth in heliocentric longitude, 0..360. Zero at opposition. */
function separation(ms: number): number {
  const t = centuries(ms)
  return (((orbit(MARS, t).lon - orbit(EARTH, t).lon) % 360) + 360) % 360
}

/**
 * Walk forward until `f` wraps 360 -> 0, then bisect. Both quantities below
 * decrease with time (Earth laps Mars), so a jump upward is the crossing.
 */
function nextZero(from: number, f: (ms: number) => number, stepDays = 4): number {
  let prev = f(from)
  for (let k = 1; k < 260; k++) {
    const ms = from + k * stepDays * DAY_MS
    const cur = f(ms)
    if (cur > prev + 180) {
      let lo = ms - stepDays * DAY_MS
      let hi = ms
      for (let i = 0; i < 44; i++) {
        const mid = (lo + hi) / 2
        if (f(mid) < 180) lo = mid
        else hi = mid
      }
      return hi
    }
    prev = cur
  }
  // Unreachable for real inputs: a synodic period is 780 days and the loop
  // covers 1,040. Returning the horizon beats throwing inside a render.
  return from + 260 * stepDays * DAY_MS
}

/**
 * The next time Mars is opposite the Sun from us — closest, biggest, brightest.
 * Happens about every 26 months, and is the thing a child can go outside and
 * look at, which is why it is on the card next to a launch date nobody can see.
 */
export function nextOpposition(nowMs: number): number {
  return nextZero(nowMs, separation)
}

/**
 * How long a Hohmann transfer takes from where Earth is now to where Mars will
 * be when it arrives, and by how much the geometry misses.
 *
 * The textbook figure is 259 days from a lead angle of 44.3°, computed from
 * the two MEAN radii — and it is 8 weeks wrong for 2020, because Mars's orbit
 * is eccentric enough (e=0.093) that the distance at arrival swings between
 * 1.38 and 1.67 AU. So the radii are the ACTUAL ones: guess a flight time,
 * look up where Mars will be then, size the transfer ellipse to that distance,
 * repeat. It settles in three or four passes.
 *
 * Against real departures this lands 2 days from Perseverance's 2020-07-30 and
 * inside the right month for the 2022, 2024 and 2026 windows.
 */
function transfer(departMs: number): { days: number; miss: number } {
  const home = orbit(EARTH, centuries(departMs))
  let days = 259
  for (let i = 0; i < 8; i++) {
    const there = orbit(MARS, centuries(departMs + days * DAY_MS))
    // Half of one orbit of the ellipse that just touches both circles.
    days = 0.5 * Math.pow((home.r + there.r) / 2, 1.5) * YEAR_D
  }
  const there = orbit(MARS, centuries(departMs + days * DAY_MS))
  // A half-ellipse arrives exactly opposite where it left. Anything else and
  // the spacecraft gets to Mars's orbit while Mars is somewhere else.
  return { days, miss: (((there.lon - home.lon - 180) % 360) + 360) % 360 }
}

export interface TransferWindow {
  /** Best departure, ms. The real window is roughly a month wide around it. */
  departMs: number
  /** Arrival, ms. */
  arriveMs: number
  /** Flight time in days. Swings 240–285 depending on where Mars is. */
  travelDays: number
}

/**
 * The next date it is worth leaving Earth for Mars.
 *
 * Memoised by the hour, because the card ticks once a second and this is a
 * couple of thousand Kepler solves — nothing at all once an hour, rude at 1Hz.
 * A Map rather than one slot: the card asks twice, once from now and once from
 * just after the answer, to show how long the wait is if this one is missed.
 * A single slot would thrash between the two and cache nothing.
 */
const windowCache = new Map<number, TransferWindow>()

export function nextTransferWindow(nowMs: number): TransferWindow {
  const hour = Math.floor(nowMs / 3600000)
  const hit = windowCache.get(hour)
  if (hit) return hit
  const departMs = nextZero(nowMs, (ms) => transfer(ms).miss)
  const { days } = transfer(departMs)
  const win: TransferWindow = {
    departMs,
    arriveMs: departMs + days * DAY_MS,
    travelDays: days
  }
  // The exhibit runs for months without a reload, so the map is bounded.
  if (windowCache.size > 8) windowCache.clear()
  windowCache.set(hour, win)
  return win
}

/**
 * Whole days from now until then, rounded up so the last day reads "1일 남았어요"
 * rather than "0일".
 */
export function daysUntil(targetMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((targetMs - nowMs) / DAY_MS))
}

/* ------------------------------------------------------------------ *
 * Where they are thinking of landing
 * ------------------------------------------------------------------ */

/**
 * Green, and deliberately not near any of the three probe colours.
 *
 * Amber, grey-blue and dim red already mean working / finished / lost, and all
 * three sit inside Mars's own hue. A place nobody has been is not a fourth
 * state of a machine, so it gets the one hue on the far side of the wheel from
 * the planet — which is also the only colour on this screen that will never be
 * mistaken for terrain.
 */
export const TARGET_COLOR = '#7ce0a8'

export interface MarsTarget {
  id: string
  name: string
  subtitle: string
  /** Planetocentric east longitude, 0..360, as the gazetteer states it. */
  lonEast: number
  lat: number
  /** One line on why this patch of ground and not another. */
  note: string
}

/**
 * Three regions, from the USGS/IAU Gazetteer of Planetary Nomenclature.
 *
 * These are the centres of the NAMED FEATURES, not surveyed landing ellipses —
 * the published candidate sites are clusters of dozens of ellipses a few
 * kilometres wide, which is far below one pixel here, and picking one of them
 * would claim a precision the exhibit does not have. So the dots mean "this
 * neighbourhood", and the card says so.
 *
 * Erebus Montes is listed as 185.02°W. That is a west longitude — greater than
 * 180, which is the tell — and reads 174.98°E. Getting this backwards would
 * put it 20° away on the far side of nothing in particular and look completely
 * plausible, which is exactly how the rover-track parser was fooled once.
 */
export const MARS_TARGETS: MarsTarget[] = [
  {
    id: 'tgt-arcadia',
    name: '아르카디아 평원',
    subtitle: 'Arcadia Planitia',
    lonEast: 184.3,
    lat: 47.2,
    note: '땅속에 깨끗한 얼음이 두껍게 쌓여 있다고 알려진 넓은 평원이에요.'
  },
  {
    id: 'tgt-erebus',
    name: '에레보스 산맥',
    subtitle: 'Erebus Montes',
    lonEast: 174.98,
    lat: 35.66,
    note: '스페이스X가 2019년에 처음 고른 착륙 후보지가 이 산맥 동쪽 평원이에요.'
  },
  {
    id: 'tgt-phlegra',
    name: '플레그라 산맥',
    subtitle: 'Phlegra Montes',
    lonEast: 163.71,
    lat: 40.4,
    note: '얼음이 얕게 묻혀 있고 땅이 평평해서 내려앉기 좋아요.'
  }
]

/** Renderer longitude, ready for the globe. */
export function targetPosition(t: MarsTarget): { lon: number; lat: number } {
  return { lon: eastToRendererLon(t.lonEast), lat: t.lat }
}

export function isTargetId(id: string | null | undefined): boolean {
  return !!id && MARS_TARGETS.some((t) => t.id === id)
}

/**
 * What a company currently says, and WHEN it said it.
 *
 * The date is not decoration. Every previous version of this sentence was also
 * true when it was written — five Starships were going in late 2026 right up
 * until February 2026, when SpaceX put Mars back five to seven years to get
 * the Moon lander done first. A visitor who can see the "기준" can tell whether
 * they are reading news or history; without it the panel just quietly lies.
 */
export const MARS_PLAN = {
  asOf: '2026년 2월',
  who: '스페이스X',
  what:
    '다섯 대를 2026년 말에 보내려 했지만, 달 착륙선을 먼저 만들기로 하고 화성행을 5~7년 미뤘어요.',
  why: '우주에서 연료를 옮겨 담는 기술이 아직 남아 있거든요.'
} as const
