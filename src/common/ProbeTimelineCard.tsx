import {
  PROBE_STATE_LABEL,
  marsClock,
  missionSol,
  type MarsProbe
} from '@shared/probes'

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
 */
export function ProbeTimelineCard({ probe }: { probe: MarsProbe }): JSX.Element {
  const now = Date.now()
  const sol = missionSol(probe, now)
  const landedYear = probe.landed.slice(0, 4)
  const endedYear = probe.ended?.slice(0, 4)

  return (
    <div className={'probe-card ' + probe.status}>
      <div className="probe-head">
        <div className="probe-name">
          {probe.name}
          <span className="probe-sub">{probe.subtitle}</span>
        </div>
        <div className="probe-state">{PROBE_STATE_LABEL[probe.status]}</div>
      </div>

      <div className="probe-facts">
        <div>
          <b>{probe.place}</b>
          <span>{probe.agency}</span>
        </div>
        {/* Sols, not days. Every one of these missions counts its own life in
            Martian mornings, and "4,900번째 아침" is a truer thing to hand a
            child than a number of Earth days would be. */}
        {probe.status !== 'lost' && (
          <div>
            <b>{sol.toLocaleString()}솔</b>
            <span>{probe.status === 'active' ? '화성에서 맞은 아침' : '일한 날'}</span>
          </div>
        )}
        {probe.drivenKm > 0 && (
          <div>
            <b>{probe.drivenKm < 1 ? `${Math.round(probe.drivenKm * 1000)} m` : `${probe.drivenKm} km`}</b>
            <span>{probe.drivenAsOf ? `달린 거리 · ${probe.drivenAsOf}년 기준` : '달린 거리'}</span>
          </div>
        )}
        {/* The one number here that is not history. A clock nobody can read
            anywhere else on Earth, ticking on a planet in the picture. */}
        <div>
          <b>{marsClock(probe.lonEast, now)}</b>
          <span>그곳의 지금 시각</span>
        </div>
      </div>

      <ol className="probe-timeline">
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
            <span className="what">아직 화성에 있어요.</span>
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
