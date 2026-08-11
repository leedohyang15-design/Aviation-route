import { GALILEAN, moonPosition, type JupiterMoon } from '@shared/jupiter'

/**
 * The four moons where they are right now, seen from above.
 *
 * FROM ABOVE, and that is a decision rather than a style. The obvious drawing
 * is the one through a telescope — four dots strung out on a line either side
 * of Jupiter — but that view depends on where Earth is, and the zero point of
 * the longitudes underneath could not be checked against a published eclipse
 * (see shared/jupiter.ts). Drawn from overhead, the picture claims only what
 * the Laplace resonance actually pins down: how the four sit relative to each
 * other. It is also the truer picture. Through a telescope Callisto looks like
 * it barely moves; from up here you can see it is simply on a much bigger ring.
 *
 * The rings are to scale with each other and Jupiter is to scale with the
 * rings, which together are the fact worth carrying away: Io skims the planet
 * and Callisto is four and a half times further out than Io.
 */
export function MoonOrrery({
  now,
  selected
}: {
  now: number
  /** Which moon to light up — the rest are drawn quietly. */
  selected?: string
}): JSX.Element {
  const S = 232
  const c = S / 2
  // Callisto's ring plus room for its dot and label.
  const scale = (S / 2 - 14) / 26.3627

  return (
    <figure className="orrery">
      <svg viewBox={`0 0 ${S} ${S}`} width="100%" role="img" aria-label="목성과 네 위성의 지금 위치">
        {GALILEAN.map((m: JupiterMoon) => (
          <circle
            key={'r' + m.id}
            cx={c}
            cy={c}
            r={m.radiusRj * scale}
            className={'ring' + (selected === m.id ? ' on' : '')}
          />
        ))}
        {/* Jupiter, at the same scale as the rings — one Jupiter radius. */}
        <circle cx={c} cy={c} r={scale} className="jove" />
        {GALILEAN.map((m) => {
          const p = moonPosition(m, now)
          const x = c + p.x * scale
          const y = c + p.y * scale
          const on = selected === m.id
          return (
            <g key={m.id} className={'moon' + (on ? ' on' : '')}>
              {on && <circle cx={x} cy={y} r={8} fill={m.color} opacity={0.22} />}
              <circle cx={x} cy={y} r={on ? 4.6 : 3.2} fill={m.color} />
            </g>
          )
        })}
      </svg>
      {/* Says what IS to scale. The rings and Jupiter are; the moons' dots are
          not, and could not be — Io would be a third of a pixel. A caption
          claiming everything is to scale would be the easiest kind of lie to
          tell here and the hardest for a visitor to catch. */}
      <figcaption>위에서 내려다본 지금 모습 · 궤도 크기는 실제 비율이에요</figcaption>
    </figure>
  )
}
