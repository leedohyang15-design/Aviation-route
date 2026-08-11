// Pure canvas-texture + geometry helpers for the Globe renderer. These are
// stateless (no scene/class dependencies), so they live apart from the main
// engine file to keep globe.ts focused on rendering state.
import * as THREE from 'three'
import type { CategoryKey } from '../common/flightClass'

/** Screen-space heading (radians) for the icon: on equirectangular a great
 * circle is curved, so the on-screen tangent differs from the geographic
 * bearing — 1/cos(lat) stretches longitude. This keeps icons aligned to motion. */
export function screenAngle(headingRad: number, latDeg: number): number {
  const cosLat = Math.max(0.05, Math.cos((latDeg * Math.PI) / 180))
  const dx = Math.sin(headingRad) / cosLat
  const dy = Math.cos(headingRad)
  return Math.atan2(-dx, dy)
}

/** A round dot with a white ring — the origin/departure marker. */
export function dotTexture(color: string): THREE.CanvasTexture {
  const s = 64
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = s * 0.09
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** A teardrop location pin (tip at bottom-center) — the destination marker. */
export function pinTexture(color: string): THREE.CanvasTexture {
  const W = 64
  const H = 96
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const cx = W / 2
  const cy = W * 0.46
  const r = W * 0.34
  ctx.fillStyle = color
  // Stalk from the head down to the tip.
  ctx.beginPath()
  ctx.moveTo(cx - r * 0.72, cy + r * 0.4)
  ctx.lineTo(cx + r * 0.72, cy + r * 0.4)
  ctx.lineTo(cx, H - 3)
  ctx.closePath()
  ctx.fill()
  // Round head.
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = W * 0.06
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  // White hole in the middle.
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * A soft halo, drawn additively behind the selected object so it reads as lit
 * once the map goes dark. Two stops rather than one: a bright small core that
 * looks like a lamp, and a wide faint falloff that lifts the map around it.
 */
export function glowTexture(): THREE.CanvasTexture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.12, 'rgba(255,255,255,0.75)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The lights an object carries in the dark, drawn as soft dots on a transparent
 * quad — an aircraft's two wingtip lights, a satellite's single beacon on its
 * nose. Drawn white and tinted where it's used, and only ever for the selected
 * object: this marks what the operator has targeted, so it says "this one"
 * rather than decorating the whole swarm.
 *
 * Spots are in icon-relative coordinates, where the icon spans -1..1 in both
 * axes (y down, since that is how the silhouettes are drawn). The quad is
 * larger than the icon by LIGHT_QUAD_SCALE so the glow can bloom past the
 * silhouette the way a real light does; the icon still maps to the middle of
 * it, so a spot lands exactly where it was placed whatever that scale is.
 */
export function lightTexture(spots: readonly { x: number; y: number }[]): THREE.CanvasTexture {
  const S = 160
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const half = S / 2 / LIGHT_QUAD_SCALE // half-width of the icon inside this quad
  for (const spot of spots) {
    const cx = S / 2 + spot.x * half
    const cy = S / 2 + spot.y * half
    const r = S * 0.13
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.arc(cx, cy, r, 0, Math.PI * 2)
    g.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Where the lights sit on each icon, read off the silhouettes themselves:
 * PLANE_SVG's wings reach x=5.5 and 58.5 of a 64 box at y=42, and
 * satelliteTexture's dish sits at the top of the body, at y=-24 of 128.
 */
export const LIGHT_SPOTS = {
  aircraft: [
    { x: -(32 - 5.5) / 32, y: (42 - 32) / 32 },
    { x: (32 - 5.5) / 32, y: (42 - 32) / 32 }
  ],
  satellite: [{ x: 0, y: -24 / 64 }]
} as const

/** How much larger the light quad is than the icon it rides on. */
export const LIGHT_QUAD_SCALE = 1.7

/** A CanvasTexture of a text label (white with dark outline). Returns aspect w/h. */
export function textTexture(text: string): { tex: THREE.CanvasTexture; aspect: number } {
  const fontSize = 44
  const pad = 12
  const c = document.createElement('canvas')
  let ctx = c.getContext('2d')!
  ctx.font = `bold ${fontSize}px sans-serif`
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2
  const h = fontSize + pad * 2
  c.width = w
  c.height = h
  ctx = c.getContext('2d')!
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, w / 2, h / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, w / 2, h / 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: w / h }
}

// ---------------------------------------------------------------------------
// The dome callout.
//
// The projected frame carries ONE piece of text now, and it is the only thing
// on it a visitor across the room can read: how long until the aircraft lands,
// or until the satellite is overhead. The full instrument card moved to the
// control screen, where an operator is close enough to read six rows of
// figures; on the dome those rows were detail nobody could resolve, competing
// with the thing they were actually watching.
//
// Dark type on a light plate, because that is the contrast that survives a
// projector. Laid out in DESIGN UNITS and rasterized at SS x, as the card was.
// ---------------------------------------------------------------------------

const PAPER = '#f7f5f0'
const INK = '#14120f'
const ACCENT = '#e8590c'

/**
 * What the plate is made of.
 *
 * There are two, and they exist for the same reason the control screen has
 * three different cards: the plate should look like the thing it belongs to.
 * Flight is a boarding pass, so the dome plate is a paper tag with an orange
 * rule — that is the whole visual argument of the aircraft tab and it works
 * over dark ocean.
 *
 * Mars does not work that way. The planet fills the frame in bright ochre, and
 * a cream card on it is two light surfaces arguing; the control screen's own
 * Mars card is dark glass for exactly this reason, so the dome now matches it.
 * The accent travels with the object rather than being fixed, so the rule down
 * the edge is the same colour as the dot the visitor just tapped.
 */
export interface CalloutSkin {
  /** Plate fill. Alpha is allowed — the label material is transparent. */
  paper: string
  /** Text colour for the title and the words around the figure. */
  ink: string
  /** The edge rule, and the figure itself. */
  accent: string
  /** Hairline under the title. */
  rule: string
  /** Outline, or none. Dark plates need one; the paper tag does not. */
  border?: string
  /** Corner radius in design units. The tag is soft, the instrument is not. */
  radius?: number
  /** Set the title in the figure's monospace rather than the sans. */
  mono?: boolean
  /**
   * Paint the title row as a dark bar with the title reversed out of it.
   *
   * This is the satellite sheet's signature — `.sat-head` and `.sat-foot`
   * bracket that card in solid ink — and it is the only part of it that
   * survives being shrunk to a two-line plate and looked at from the far side
   * of a room.
   */
  headBar?: boolean
}

const PAPER_SKIN: CalloutSkin = {
  paper: PAPER,
  ink: INK,
  accent: ACCENT,
  rule: 'rgba(20,18,15,0.16)'
}

/**
 * The telemetry sheet's own materials, for the satellite plate.
 *
 * These four values are copied from `.sat-panel` in control.css and are meant
 * to stay copied. The plate was the aircraft tab's boarding-pass tag, which is
 * a different object from the ruled instrument in the operator's hands — close
 * enough to look like a mistake rather than a choice.
 *
 * The head bar is the part that does the work. A first attempt at this changed
 * only the cream (#f7f5f0 to #f4f1ea), the corner radius (6 to 3) and the
 * title's typeface, all of which are true to the sheet and none of which can
 * be seen from where the exhibit is actually viewed — a correct change that
 * was, from any useful distance, no change at all. The solid ink bar across
 * the top is what the sheet looks like from across a room, so that is what
 * the plate wears.
 */
export function telemetrySkin(): CalloutSkin {
  return {
    paper: '#f4f1ea',
    ink: '#14120f',
    accent: '#e8590c',
    rule: '#d8d3c8',
    radius: 3,
    mono: true,
    headBar: true
  }
}

/** The dark-glass plate, matching .probe-card on the control screen. */
export function panelSkin(accent: string): CalloutSkin {
  return {
    paper: 'rgba(10,15,27,0.92)',
    ink: '#eaf2ff',
    accent,
    rule: 'rgba(255,255,255,0.16)',
    border: 'rgba(255,255,255,0.16)'
  }
}

const MONO = `'Consolas','SFMono-Regular',ui-monospace,monospace`
const SANS = `'Pretendard',system-ui,-apple-system,'Segoe UI',sans-serif`

const SS = 3 // supersample: canvas pixels per design unit
/** Design units spanning the frame height. Smaller number, bigger callout. */
const CALLOUT_FRAME_H = 780

const CALLOUT_H = 50
/** Height of the name line above the figure. */
const TITLE_H = 27
const CALLOUT_PAD = 17
const EDGE_W = 5 // accent bar down the leading edge

type Ctx = CanvasRenderingContext2D

/**
 * The plate the dome carries.
 *
 * A title line naming the object — "KE902  인천 → 파리" — over the one figure a
 * visitor wants from across a room: "도착까지 [11시간 37분] 남음", with the
 * figure set large and in the accent colour and the words around it smaller.
 *
 * The title is what the dome was missing. The countdown alone told thirty
 * people watching that something arrives in three hours without ever saying
 * what, or where from — that answer only existed on the operator's screen.
 */
export function calloutTexture(
  title: string,
  prefix: string,
  value: string,
  suffix: string,
  /** Draw it smaller. A satellite's countdown runs to "12시간 1분" and reads as
   * shouting at the size the flight ETA needs; the aircraft plate is the one
   * people read across the room, so only this one shrinks. */
  compact = false,
  skin: CalloutSkin = PAPER_SKIN
): { tex: THREE.CanvasTexture; aspect: number; screenH: number } {
  const measuring = document.createElement('canvas').getContext('2d') as Ctx
  const valueFont = `700 ${27 * SS}px ${MONO}`
  const wordFont = `600 ${19 * SS}px ${SANS}`
  const titleFont = `700 ${16 * SS}px ${skin.mono ? MONO : SANS}`
  measuring.font = wordFont
  const preW = prefix ? measuring.measureText(prefix).width / SS : 0
  const sufW = suffix ? measuring.measureText(suffix).width / SS : 0
  measuring.font = valueFont
  const valW = value ? measuring.measureText(value).width / SS : 0
  measuring.font = titleFont
  const titleW = title ? measuring.measureText(title).width / SS : 0
  const gap = 9
  const gaps = (prefix && value ? gap : 0) + (value && suffix ? gap : 0)
  const lineW = preW + valW + sufW + gaps
  const hasLine = lineW > 0
  const W = EDGE_W + CALLOUT_PAD + Math.max(lineW, titleW) + CALLOUT_PAD
  const titleH = title ? TITLE_H : 0
  const lineH = hasLine ? CALLOUT_H : 0
  const H = titleH + lineH

  const c = document.createElement('canvas')
  c.width = Math.ceil(W * SS)
  c.height = Math.ceil(H * SS)
  const g = c.getContext('2d') as Ctx

  const r = (skin.radius ?? 6) * SS
  // Traced rather than drawn once, because three things need this exact
  // outline: the fill, the clip that keeps the accent rule and the head bar
  // inside the rounded corners, and the border stroke.
  const plate = (): void => {
    g.beginPath()
    g.moveTo(r, 0)
    g.arcTo(c.width, 0, c.width, c.height, r)
    g.arcTo(c.width, c.height, 0, c.height, r)
    g.arcTo(0, c.height, 0, 0, r)
    g.arcTo(0, 0, c.width, 0, r)
    g.closePath()
  }
  plate()
  g.fillStyle = skin.paper
  g.fill()
  g.save()
  g.clip()
  g.fillStyle = skin.accent
  g.fillRect(0, 0, EDGE_W * SS, c.height)
  g.restore()
  // The outline goes on after the bar so the bar butts into it rather than
  // over it. A translucent plate needs it: without one, a dark card over the
  // night side of Mars has no edge at all and reads as a hole in the planet.
  if (skin.border) {
    plate()
    g.strokeStyle = skin.border
    g.lineWidth = SS
    g.stroke()
  }

  const left = (EDGE_W + CALLOUT_PAD) * SS
  if (title) {
    if (skin.headBar) {
      // Runs the full width and butts into the accent rule, exactly as
      // .sat-head does on the card, and clipped to the plate so the top
      // corners stay round. No hairline underneath it — the change of ground
      // already separates the name from the figure, and a rule as well would
      // be two devices doing one job.
      g.save()
      plate()
      g.clip()
      g.fillStyle = skin.ink
      g.fillRect(EDGE_W * SS, 0, c.width, titleH * SS)
      g.restore()
    }
    g.font = titleFont
    g.fillStyle = skin.headBar ? skin.paper : skin.ink
    g.fillText(title, left, 20 * SS)
    if (hasLine && !skin.headBar) {
      // Hairline between the name and the figure, inset from the accent bar.
      g.fillStyle = skin.rule
      g.fillRect(left, titleH * SS - SS, c.width - left - CALLOUT_PAD * SS, SS)
    }
  }
  let x = left
  const baseline = (titleH + 33.5) * SS
  if (prefix) {
    g.font = wordFont
    g.fillStyle = skin.ink
    g.fillText(prefix, x, baseline)
    x += (preW + gap) * SS
  }
  if (value) {
    g.font = valueFont
    g.fillStyle = skin.accent
    g.fillText(value, x, baseline)
    x += (valW + gap) * SS
  }
  if (suffix) {
    g.font = wordFont
    g.fillStyle = skin.ink
    g.fillText(suffix, x, baseline)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: W / H, screenH: (H / CALLOUT_FRAME_H) * (compact ? 0.72 : 1) }
}

// Icon color by flight category: passenger cyan, cargo amber, military green,
// unidentifiable grey.
const CAT_COLOR: Record<CategoryKey, THREE.Color> = {
  passenger: new THREE.Color('#35c1ff'),
  cargo: new THREE.Color('#f5a623'),
  military: new THREE.Color('#74d16a'),
  other: new THREE.Color('#93a4b8')
}
export function categoryColor(cat: CategoryKey): THREE.Color {
  return CAT_COLOR[cat] ?? CAT_COLOR.passenger
}

/** Colour per orbit class, so the shells read apart at a glance: low orbit
 * cyan, the Starlink shells violet (they're most of the sky), navigation gold,
 * geostationary a warm red that sits still over the equator.
 *
 * Shared constants, like CAT_COLOR — this used to parse a hex string per call,
 * and the call is per satellite per refresh, so a drag over a sixteen-thousand
 * object catalogue spent whole frames building Colors that were then only ever
 * read (frame() copies into a scratch before scaling, and never mutates these). */
const ORBIT_COLOR: Record<string, THREE.Color> = {
  starlink: new THREE.Color('#b48cff'),
  meo: new THREE.Color('#ffd166'),
  geo: new THREE.Color('#ff7b6b'),
  leo: new THREE.Color('#5ce1e6')
}
export function orbitColor(orbit: string): THREE.Color {
  return ORBIT_COLOR[orbit] ?? ORBIT_COLOR.leo
}

/** A plain filled dot — what unselected satellites are drawn as. Sixteen
 * thousand icons overlap into noise, whereas dots read as a swarm, which is
 * what a satellite constellation actually looks like.
 *
 * The disc is solid out to 80% of its radius and only feathers over the last
 * sliver. An earlier version faded from the very centre outwards, which at the
 * ten-or-so screen pixels a dot actually occupies left no solid core at all —
 * every dot came out a grey smudge. */
export function plainDotTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const r = s * 0.46
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.8, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)') // just enough to antialias the rim
  g.fillStyle = grad
  g.beginPath()
  g.arc(s / 2, s / 2, r, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** The selected satellite: a body with two solar panels, drawn white so the
 * per-object colour tints it. Unmistakably not an aeroplane, which is the whole
 * point — only one is ever on screen, so the detail costs nothing. */
export function satelliteTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.translate(s / 2, s / 2)
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#ffffff'
  g.lineCap = 'round'

  // Body.
  g.fillRect(-13, -18, 26, 36)
  // Booms out to each panel.
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(-13, 0)
  g.lineTo(-24, 0)
  g.moveTo(13, 0)
  g.lineTo(24, 0)
  g.stroke()
  // Solar panels, with a gap so the cells read at a glance.
  for (const dir of [-1, 1]) {
    const x = dir === -1 ? -56 : 24
    g.fillRect(x, -20, 32, 17)
    g.fillRect(x, 3, 32, 17)
  }
  // Dish on top.
  g.beginPath()
  g.arc(0, -24, 8, 0, Math.PI * 2)
  g.fill()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * A landing site, for the Mars tab.
 *
 * Not a dot. A satellite is a dot because a dot is the honest icon for a thing
 * too far away to have a shape; a lander is on the ground and there are twelve
 * of them on an otherwise empty planet, so they should read as marks ON a map
 * rather than objects above one. A diamond does that at any size — it is the
 * one silhouette that cannot be mistaken for the satellite dot even at ten
 * pixels, which is the size these are drawn at when the whole planet is on
 * screen.
 *
 * White, so the per-object colour tints it: amber for the two still working,
 * grey-blue for the ones that finished, dim red for the ones that arrived and
 * were never heard from.
 */
export function probeTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const m = s / 2
  const r = s * 0.42
  // A hollow diamond with a solid centre: the ring survives being tinted dark
  // against bright terrain, and the centre keeps it visible when it shrinks.
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.lineWidth = s * 0.11
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(m, m - r)
  g.lineTo(m + r, m)
  g.lineTo(m, m + r)
  g.lineTo(m - r, m)
  g.closePath()
  g.stroke()
  g.fillStyle = 'rgba(255,255,255,1)'
  g.beginPath()
  g.arc(m, m, s * 0.13, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The selected probe: a rover in profile — body, mast, six wheels.
 *
 * Only one is ever on screen, so the detail costs nothing, and it is the same
 * bargain the satellite icon makes: the crowd is abstract marks, the one you
 * tapped is a picture of the thing. Half of these are landers rather than
 * rovers and they get the same silhouette anyway; at this size the wheels read
 * as "a machine", which is the distinction that matters to a seven-year-old.
 */
export function roverTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(255,255,255,1)'
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.lineCap = 'round'
  g.lineJoin = 'round'
  // Body
  g.beginPath()
  g.roundRect(s * 0.2, s * 0.42, s * 0.6, s * 0.22, s * 0.05)
  g.fill()
  // Mast and camera head
  g.lineWidth = s * 0.055
  g.beginPath()
  g.moveTo(s * 0.32, s * 0.42)
  g.lineTo(s * 0.32, s * 0.24)
  g.stroke()
  g.beginPath()
  g.roundRect(s * 0.24, s * 0.16, s * 0.17, s * 0.1, s * 0.03)
  g.fill()
  // Six wheels, three a side in profile
  for (const x of [0.27, 0.5, 0.73]) {
    g.beginPath()
    g.arc(s * x, s * 0.72, s * 0.085, 0, Math.PI * 2)
    g.fill()
  }
  // The ground it stands on, so it never floats
  g.lineWidth = s * 0.04
  g.beginPath()
  g.moveTo(s * 0.14, s * 0.83)
  g.lineTo(s * 0.86, s * 0.83)
  g.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * A moon: a ball, not a mark on a map.
 *
 * The landing-site diamond is a symbol for a PLACE — it says "something is
 * here" about a point on a surface. The four Galilean moons are not places on
 * Jupiter, they are worlds going round it, and a diamond made them read as
 * four more landing sites on the cloud tops. A filled disc with a soft rim is
 * the shape of the thing itself, and at a glance across a room it is the only
 * shape on any of the five tabs that says "this is round".
 */
export function moonTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const m = s / 2
  // A soft halo first, so a pale moon still separates from a pale cloud band.
  const halo = g.createRadialGradient(m, m, s * 0.36, m, m, s * 0.5)
  halo.addColorStop(0, 'rgba(255,255,255,0.5)')
  halo.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = halo
  g.beginPath()
  g.arc(m, m, s * 0.5, 0, Math.PI * 2)
  g.fill()
  /*
   * The body. Lit from the upper left, which is the direction every drawing of
   * a sphere has been lit since before anybody drew a planet.
   *
   * Four tenths of the canvas, not under three. At the old radius well over
   * half of the quad was halo, so making the icon bigger mostly made its glow
   * bigger — a moon drawn 33 pixels wide put a 19-pixel ball on the dome. The
   * halo still has room to do its job, which is to separate a pale moon from a
   * pale cloud band, without being most of the picture.
   */
  const body = g.createRadialGradient(m - s * 0.12, m - s * 0.12, s * 0.04, m, m, s * 0.4)
  body.addColorStop(0, 'rgba(255,255,255,1)')
  body.addColorStop(0.65, 'rgba(255,255,255,0.94)')
  body.addColorStop(1, 'rgba(255,255,255,0.72)')
  g.fillStyle = body
  g.beginPath()
  g.arc(m, m, s * 0.4, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * The selected marker for a place nobody has landed on yet.
 *
 * The rover icon cannot do this job — it is a picture of a machine, and the
 * whole point of these three dots is that there is no machine there. A survey
 * reticle says "somebody has measured this spot and is thinking about it",
 * which is exactly the claim, and it is a shape with no vehicle in it at all.
 */
export function targetTexture(): THREE.CanvasTexture {
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!
  const m = s / 2
  g.strokeStyle = 'rgba(255,255,255,1)'
  g.fillStyle = 'rgba(255,255,255,1)'
  g.lineCap = 'round'
  // The ring, left open at the four ticks so the shape reads as something
  // drawn ON the ground rather than as a filled dot with a halo round it.
  g.lineWidth = s * 0.075
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + Math.PI / 12
    g.beginPath()
    g.arc(m, m, s * 0.3, a, a + Math.PI / 3)
    g.stroke()
  }
  // Ticks reaching in from outside the ring, through the gaps.
  g.lineWidth = s * 0.06
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2)
    g.beginPath()
    g.moveTo(m + Math.cos(a) * s * 0.44, m + Math.sin(a) * s * 0.44)
    g.lineTo(m + Math.cos(a) * s * 0.22, m + Math.sin(a) * s * 0.22)
    g.stroke()
  }
  g.beginPath()
  g.arc(m, m, s * 0.075, 0, Math.PI * 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
