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
 * Rain has no such problem. It arrives as model values in a declared unit, so
 * it can be compared against real rates and means the same thing everywhere.
 *
 * This file holds no thresholds. Deciding which band a reading falls into is
 * the renderer's job (`rainLevelCuts` in globe.ts), because that decision
 * depends on the variable's unit and on the ramp beside it — the first attempt
 * kept the thresholds here in drawn-strength terms, which meant inverting the
 * colour ramp by hand and keeping the answer in a different file from the
 * ramp. It was wrong within a day. What arrives here is a band, and all this
 * decides is the words.
 */

/**
 * 0 none · 1 a few drops · 2 raining · 3 pouring · null nothing to say.
 *
 * Both 0 and null produce no sentence, for different reasons and to the same
 * end. Null is "the data cannot support a claim" — a painted rain map, a unit
 * that did not match, no rain layer drawn. Zero is "it is not raining", which
 * IS known and simply is not worth a line on a plate: the exhibit is about the
 * weather that is happening, and a caption announcing an absence over an earth
 * with nothing drawn on it reads as a fault rather than as a fact.
 */
export interface SkyLine {
  /** The sentence itself. */
  text: string
  /** One character that carries it across a room, for the control screen. */
  icon: string
}

export function skyOverhead(level: number | null): SkyLine | null {
  if (level == null || level <= 0) return null
  if (level >= 3) return { text: '지금 우리 머리 위엔 비가 세차게 내려요', icon: '🌧' }
  if (level >= 2) return { text: '지금 우리 머리 위엔 비가 내리고 있어요', icon: '🌧' }
  return { text: '지금 우리 머리 위엔 빗방울이 조금 떨어져요', icon: '🌦' }
}
