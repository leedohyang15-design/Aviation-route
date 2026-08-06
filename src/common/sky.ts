/**
 * What the sky over the exhibit is doing, in a sentence a child can read.
 *
 * A world map answers the question everywhere except the one place the visitor
 * is standing in, and for a seven-year-old on a school trip that is the only
 * place that counts. The globe is impressive; "지금 우리 머리 위엔 비가 와요" is
 * what makes it about them.
 *
 * RAIN ONLY, and that is a correctness decision rather than a design one.
 *
 * The cloud picture is five geostationary sensors merged, and to make them
 * agree each one is stretched against ITS OWN distribution — the median of
 * what that satellite can see becomes 0 and its 98th percentile becomes 1
 * (`mergePatches` in globe.ts). Half of every sensor's view is therefore zero
 * by construction. That is exactly right for drawing a picture where five
 * cameras look like one, and completely wrong as a measurement: a zero means
 * "less cloud than the average of everything this satellite happens to be
 * pointed at this hour", not "no cloud". Saying 구름 한 점 없어요 on the back
 * of it would be inventing a fact.
 *
 * Rain has no such problem. It arrives as model values in a declared unit,
 * decoded from the pixel and put through a ramp calibrated to that unit, so it
 * means the same thing everywhere on the globe. It is the one thing here the
 * exhibit can honestly assert about a single place.
 *
 * The number is the layer's strength as the shader DRAWS it, 0..1, sampled
 * from the same mosaic over the observer — so the words and the colours cannot
 * disagree, and it stays right when the ramp is refitted to a different unit.
 */

/*
 * Thresholds in drawn strength, not millimetres — see the note above.
 *
 * They have to be worked out through the ramp rather than chosen, because the
 * ramp is not linear. It runs 0.05..8 mm/h through a gamma of 0.35, so drawn
 * strength s corresponds to 0.05 + s^(1/0.35) * 7.95 mm/h. The first attempt
 * picked round-looking numbers directly and they came out as:
 *
 *     0.02 -> 0.050 mm/h   (the ramp's own floor: any rain at all)
 *     0.14 -> 0.079 mm/h   (drizzle below what anyone would call rain)
 *     0.50 -> 1.147 mm/h   (ordinary steady rain, announced as 세차게)
 *
 * — so on a nearly dry day the plate would have said it was raining, and
 * ordinary rain would have been called heavy. Inverting the ramp for the rates
 * actually meant gives the values below. For reference the measured world
 * distribution is p90 0.20mm, p99 1.37mm, p99.9 3.73mm, so "세차게" lands
 * around the wettest tenth of a percent of the planet, which is right.
 *
 * These assume the millimetre ramp in globe.ts. Change rainAnchors or
 * rainGamma and these have to be re-derived.
 */
const RAIN_HEAVY = 0.783 // 4 mm/h
const RAIN_ON = 0.475 // 1 mm/h
const RAIN_TRACE = 0.17 // 0.1 mm/h

export interface SkyLine {
  /** The sentence itself. */
  text: string
  /** One character that carries it across a room, for the control screen. */
  icon: string
}

export function skyOverhead(rain: number | null): SkyLine | null {
  // Nothing decoded yet, or no data over us: say nothing. Silence is the only
  // honest output here, and an exhibit that occasionally omits a line reads far
  // better than one that occasionally lies.
  if (rain == null) return null
  if (rain >= RAIN_HEAVY) return { text: '지금 우리 머리 위엔 비가 세차게 내려요', icon: '🌧' }
  if (rain >= RAIN_ON) return { text: '지금 우리 머리 위엔 비가 내리고 있어요', icon: '🌧' }
  if (rain >= RAIN_TRACE) return { text: '지금 우리 머리 위엔 빗방울이 조금 떨어져요', icon: '🌦' }
  return { text: '지금 우리 머리 위엔 비가 오지 않아요', icon: '🌤' }
}
