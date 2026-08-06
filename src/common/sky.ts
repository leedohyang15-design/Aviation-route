/**
 * What the sky over the exhibit is doing, in a sentence a child can read.
 *
 * A world map answers the question everywhere except the one place the visitor
 * is standing in, and for a seven-year-old on a school trip that is the only
 * place that counts. The globe is impressive; "지금 우리 머리 위엔 비가 와요" is
 * what makes it about them.
 *
 * Both numbers are the layer's strength as the shader DRAWS it, 0..1, sampled
 * from the same mosaic over the observer. Reading them off the picture rather
 * than off millimetres is what stops the words and the colours disagreeing:
 * if Korea is under blue on screen, this says it is raining, and it goes on
 * being true when the ramp is refitted to a different unit.
 */

/** Thresholds in drawn strength, not millimetres — see the note above. */
const RAIN_HEAVY = 0.5
const RAIN_ON = 0.14
const RAIN_TRACE = 0.02
const CLOUD_FULL = 0.6
const CLOUD_SOME = 0.25

export interface SkyLine {
  /** The sentence itself. */
  text: string
  /** One character that carries it across a room, for the dome plate. */
  icon: string
}

export function skyOverhead(rain: number | null, cloud: number | null): SkyLine | null {
  // Rain outranks cloud: it is raining under a cloud, and "구름이 많아요" while
  // water is falling on the roof reads as the exhibit not knowing.
  if (rain != null) {
    if (rain >= RAIN_HEAVY) return { text: '지금 우리 머리 위엔 비가 세차게 내려요', icon: '🌧' }
    if (rain >= RAIN_ON) return { text: '지금 우리 머리 위엔 비가 내리고 있어요', icon: '🌧' }
    if (rain >= RAIN_TRACE) return { text: '지금 우리 머리 위엔 빗방울이 조금 떨어져요', icon: '🌦' }
  }
  if (cloud != null) {
    if (cloud >= CLOUD_FULL) return { text: '지금 우리 머리 위엔 구름이 잔뜩 끼었어요', icon: '☁' }
    if (cloud >= CLOUD_SOME) return { text: '지금 우리 머리 위엔 구름이 조금 있어요', icon: '⛅' }
    // Only claim a clear sky when the cloud layer actually answered. A null
    // cloud with no rain means nothing arrived, which is not the same as fine
    // weather and must not be reported as it.
    return { text: '지금 우리 머리 위엔 구름 한 점 없어요', icon: '☀' }
  }
  return null
}
