import {
  PROBE_STATE_LABEL,
  marsClock,
  missionSol,
  type MarsProbe
} from '@shared/probes'
import type { MarsLiveWire } from '@shared/types'
import { SOL_MS } from '@shared/probes'
import { TraverseMap } from './TraverseMap'
import { useAutoScroll } from './useAutoScroll'

/**
 * Sols as a length of time on Earth.
 *
 * A Martian day is 2.7% longer than ours, so this is not the same number with
 * a different label — 5,111 sols is 14.4 Earth years, not 14.0. Rounded to a
 * half year, because the point is the scale and not the precision.
 */
function earthYears(sol: number): string {
  const years = (sol * SOL_MS) / (365.2425 * 86400000)
  if (years < 1) return `${Math.round(years * 12)}개월`
  return `${(Math.round(years * 2) / 2).toFixed(1).replace('.0', '')}년`
}

/**
 * A lander's life, as a timeline rather than a path.
 *
 * The other cards in this exhibit answer "where is it going". This one cannot:
 * a rover's entire life of driving is three pixels wide at the scale a planet
 * fits on a screen, and no amount of zooming makes a dot on Mars into a
 * journey the way a flight path is one. So the journey is told in TIME. The
 * globe says where it came down; this says what happened after.
 *
 * Everything here is settled history from shared/probes.ts. Nothing on this
 * card can fail to load, which is why the tab works with the building's
 * internet unplugged.
 *
 * The traverse is drawn HERE and nowhere else. It went on the globe for one
 * commit and the globe had to zoom to 160x to make 21km of driving into
 * something visible, which is a magnification that turns the map underneath
 * into mush and reads as the exhibit having lost its place. The path has its
 * own scale; this is the frame that scale fits in.
 */
export function ProbeTimelineCard({
  probe,
  live
}: {
  probe: MarsProbe
  /** Today's figures for a rover that is still driving. Absent for the rest,
   *  and absent for these two until the daily check has ever succeeded. */
  live?: MarsLiveWire
}): JSX.Element {
  const scroller = useAutoScroll<HTMLOListElement>()
  const now = Date.now()
  /*
   * The live sol when there is one, the arithmetic when there is not.
   *
   * They should agree to within a day — the count here is (now - landing) over
   * the length of a sol — but the mission's own number is the one printed on
   * NASA's pages and the one a visitor might have read this morning, so when it
   * is available it wins. When it is not, the arithmetic is still right, and
   * nothing on this card waits for the network.
   */
  const sol = live?.sol ?? missionSol(probe, now)
  const drivenKm = live?.drivenKm ?? probe.drivenKm
  const drivenLabel = live ? '오늘까지' : probe.drivenAsOf ? `${probe.drivenAsOf}년 기준` : null
  const landedYear = probe.landed.slice(0, 4)
  const endedYear = probe.ended?.slice(0, 4)

  return (
    <div className={'probe-card ' + probe.status}>
      {/* A rule in the status colour down the whole card. On a screen where
          three tabs already use a card, the first thing to establish is which
          exhibit this belongs to, and colour does that before any word is read. */}
      <div className="probe-edge" />
      <div className="probe-head">
        <div className="probe-name">
          {probe.name}
          <span className="probe-sub">{probe.subtitle}</span>
        </div>
        <div className="probe-state">{PROBE_STATE_LABEL[probe.status]}</div>
      </div>
      <div className="probe-where">
        <b>{probe.place}</b>
        <span>{probe.agency} · {probe.kind === 'rover' ? '탐사차' : '착륙선'}</span>
      </div>

      <div className="probe-facts">
        {/* Sols, not days. Every one of these missions counts its own life in
            Martian mornings, and "4,900번째 아침" is a truer thing to hand a
            child than a number of Earth days would be. */}
        {probe.status !== 'lost' && (
          <div>
            <b>{sol.toLocaleString()}솔</b>
            {/* A sol count with no yardstick is just a big number. "5,111" and
                "14년" are the same fact, and only one of them is a length of
                time a nine-year-old has actually lived through. */}
            <span>
              {probe.status === 'active' ? '화성에서 맞은 아침' : '일한 날'} · 지구로{' '}
              {earthYears(sol)}
            </span>
          </div>
        )}
        {drivenKm > 0 && (
          <div>
            <b>{drivenKm < 1 ? `${Math.round(drivenKm * 1000)} m` : `${drivenKm.toFixed(1)} km`}</b>
            {/* Laps of a running track, because that is the only unit of
                distance every child in the building has personally walked.
                Under a kilometre it is left alone — "100 m" is already the
                length of a race they have run. */}
            <span>
              {drivenLabel ? `달린 거리 · ${drivenLabel}` : '달린 거리'}
              {drivenKm >= 1 && ` · 운동장 ${Math.round(drivenKm / 0.4).toLocaleString()}바퀴`}
            </span>
          </div>
        )}
        {/* Distance from the landing site, which is not the same number as the
            odometry and is the one a child can picture: a rover wanders, so
            34km of driving can end up four from where it came down. */}
        {live && live.fromLandingKm >= 0.1 && (
          <div>
            <b>{live.fromLandingKm.toFixed(1)} km</b>
            <span>내린 곳에서 떨어진 거리</span>
          </div>
        )}
        {/* The one number here that is not history. A clock nobody can read
            anywhere else on Earth, ticking on a planet in the picture. */}
        <div>
          <b>{marsClock(probe.lonEast, now)}</b>
          <span>그곳의 지금 시각</span>
        </div>
      </div>

      {/* The path, at its own scale. Only the two still driving have one — the
          rest either never moved or predate anybody publishing a track. */}
      {live && live.path?.length > 1 && (
        <TraverseMap path={live.path} drivenKm={drivenKm} />
      )}

      {/* The timeline is the part that grows, so it is the part that scrolls —
          and it scrolls itself, because Opportunity's runs 114px past the
          bottom of the box and nobody at a kiosk drags inside a panel. */}
      <ol className="probe-timeline" ref={scroller}>
        <li className="landing">
          <span className="when">{landedYear}</span>
          <span className="what">화성에 내려앉았어요.</span>
        </li>
        {probe.chapters.map((c, i) => (
          <li key={i}>
            <span className="when">{c.when}</span>
            <span className="what">{c.what}</span>
          </li>
        ))}
        {probe.status === 'active' ? (
          <li className="live">
            <span className="when">지금</span>
            <span className="what">
              {live
                ? `${sol.toLocaleString()}번째 아침을 맞았어요. 아직 화성에 있어요.`
                : '아직 화성에 있어요.'}
            </span>
          </li>
        ) : (
          endedYear && (
            <li className="end">
              <span className="when">{endedYear}</span>
              <span className="what">여기서 멈췄어요.</span>
            </li>
          )
        )}
      </ol>
    </div>
  )
}
