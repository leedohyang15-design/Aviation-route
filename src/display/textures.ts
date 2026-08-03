// Pure canvas-texture + geometry helpers for the Globe renderer. These are
// stateless (no scene/class dependencies), so they live apart from the main
// engine file to keep globe.ts focused on rendering state.
import * as THREE from 'three'
import type { FlightCategory } from '../common/flightClass'

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
// The dome info card.
//
// A printed instrument slip: warm paper, ruled rows, monospaced figures. It
// replaces a stack of coloured text lines, which on the projected dome came out
// as illegible smudges — the contrast of dark type on light paper is what
// survives the projection, and the fixed structure is what makes it readable at
// a glance from across a room.
//
// Everything below is laid out in DESIGN UNITS and rasterized at SS× that, so
// the card stays sharp however large it's drawn. The column width is FIXED, and
// text is fitted into it: letting the card grow to its content meant a
// satellite called "TRANSPORTER-15 OBJECT H" produced a far wider card than one
// called "ISS", which is distracting on a projection and unlike any real
// instrument. `screenH` converts the design height into a fraction of the frame.
// ---------------------------------------------------------------------------

export interface InfoTile {
  label: string
  value: string
  unit?: string
}

export interface InfoCard {
  kind: 'aircraft' | 'satellite'
  /** Optional strip above everything: who operates it, and a boxed state word. */
  header?: { left: string; badge: string }
  /** The big identifier: flight number or satellite name. */
  title: string
  /** Small right-aligned note beside it — the state, or the flight level. */
  note: string
  /** Aircraft only: the origin → destination block. */
  leg?: {
    fromCode: string
    fromCity: string
    toCode: string
    toCity: string
    /** Total trip time, e.g. "4H 05M" — null when it can't be worked out. */
    duration: string | null
    progress: number | null
  }
  /** The countdown that gives the numbers meaning. `unit` is set out small
   * beside the figure, the way the tiles do it, so the caption stays a phrase. */
  hero?: { label: string; value: string; unit?: string; caption: string; fill: number | null }
  tiles: InfoTile[]
}

const PAPER = '#f7f5f0'
const HEADER_BG = '#eae7e0'
const INK = '#14120f'
const MUTED = '#8d887e'
const RULE = '#d8d3c8'
const ACCENT = '#e8590c'

const MONO = `'Consolas','SFMono-Regular',ui-monospace,monospace`
const SANS = `'Pretendard',system-ui,-apple-system,'Segoe UI',sans-serif`

const SS = 3 // supersample: canvas pixels per design unit
/** Design units spanning the full height of the display frame. Sets how large
 * the card lands on the dome — bigger number, smaller card. */
const DESIGN_FRAME_H = 728

const PAD = 14
const EDGE_W = 3 // accent stripe down the left edge (aircraft only)
const CONTENT_W = 250

const ROW_HEADER = 22
const ROW_TITLE = 30
const ROW_LEG = 46
const ROW_HERO = 36
const SCALE_H = 12 // the ruled countdown strip, when there is one
const ROW_TILES = 34

/** `letterSpacing` is a Chromium canvas property that TypeScript's DOM lib
 * doesn't know about yet; it is what gives the labels their tracked-out look. */
type Ctx = CanvasRenderingContext2D & { letterSpacing?: string }

function setFont(g: Ctx, family: string, size: number, weight = '400', spacing = 0): void {
  g.font = `${weight} ${size * SS}px ${family}`
  g.letterSpacing = `${spacing * SS}px`
}

function measure(g: Ctx, text: string, family: string, size: number, weight = '400', spacing = 0): number {
  setFont(g, family, size, weight, spacing)
  return g.measureText(text).width / SS
}

interface Fitted {
  text: string
  size: number
  width: number
}

/**
 * Fit `text` into `maxW` design units: shrink the type down to `minSize`, and
 * only if that still isn't enough, cut it with an ellipsis. Shrinking first
 * keeps the whole name readable in the common case; clipping is the last resort
 * for the genuinely absurd ones.
 */
function fitText(
  g: Ctx,
  text: string,
  family: string,
  size: number,
  maxW: number,
  minSize: number,
  weight = '400',
  spacing = 0
): Fitted {
  let w = measure(g, text, family, size, weight, spacing)
  if (w <= maxW) return { text, size, width: w }
  const shrunk = Math.max(minSize, size * (maxW / w))
  w = measure(g, text, family, shrunk, weight, spacing)
  if (w <= maxW) return { text, size: shrunk, width: w }
  let cut = text
  while (cut.length > 1) {
    cut = cut.slice(0, -1)
    const candidate = cut.trimEnd() + '…'
    w = measure(g, candidate, family, shrunk, weight, spacing)
    if (w <= maxW) return { text: candidate, size: shrunk, width: w }
  }
  return { text: cut, size: shrunk, width: w }
}

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** A small right-pointing aeroplane, for the position marker on the leg line. */
function planeGlyph(g: Ctx, x: number, y: number, s: number, color: string): void {
  g.save()
  g.translate(x * SS, y * SS)
  g.scale(s * SS, s * SS)
  g.fillStyle = color
  g.beginPath()
  g.moveTo(1, 0)
  g.lineTo(-0.5, 0.75)
  g.lineTo(-0.15, 0)
  g.lineTo(-0.5, -0.75)
  g.closePath()
  g.fill()
  g.restore()
}

export function cardTexture(card: InfoCard): {
  tex: THREE.CanvasTexture
  aspect: number
  screenH: number
} {
  const accent = card.kind === 'aircraft' ? ACCENT : INK
  const edge = card.kind === 'aircraft' ? EDGE_W : 0
  const m = document.createElement('canvas').getContext('2d') as Ctx

  // --- Fit the text to the fixed column, rather than the column to the text ---
  const noteW = measure(m, card.note, MONO, 8.5, '600', 1.4)
  const title = fitText(m, card.title, MONO, 18, CONTENT_W - noteW - 16, 10, '700', 0.3)

  const headerLeft = card.header
    ? fitText(m, card.header.left, SANS, 9.5, CONTENT_W - 70, 7, '600')
    : null

  // Each end of the leg takes half of what the dashed line doesn't need.
  const LEG_LINE_MIN = 60
  const legHalf = (CONTENT_W - LEG_LINE_MIN) / 2
  const leg = card.leg
    ? {
        fromCode: fitText(m, card.leg.fromCode, MONO, 20, legHalf, 12, '700', 0.3),
        toCode: fitText(m, card.leg.toCode, MONO, 20, legHalf, 12, '700', 0.3),
        fromCity: fitText(m, card.leg.fromCity, SANS, 10, legHalf, 7, '500'),
        toCity: fitText(m, card.leg.toCity, SANS, 10, legHalf, 7, '500')
      }
    : null

  const heroLabelW = card.hero ? measure(m, card.hero.label, MONO, 9, '600', 1.3) : 0
  const heroValueW = card.hero ? measure(m, card.hero.value, MONO, 22, '700') : 0
  const heroUnitW = card.hero?.unit ? 1 + measure(m, card.hero.unit, MONO, 10, '600') : 0
  const heroCaption = card.hero
    ? fitText(
        m,
        card.hero.caption,
        SANS,
        11,
        Math.max(36, CONTENT_W - heroLabelW - heroValueW - heroUnitW - 19),
        7,
        '600'
      )
    : null

  // Tiles share the column equally, so the hairlines line up whatever the values.
  const tileW = CONTENT_W / Math.max(1, card.tiles.length)
  const tiles = card.tiles.map((t) => {
    const unitW = t.unit ? 2 + measure(m, t.unit, MONO, 8, '600') : 0
    return {
      label: fitText(m, t.label, MONO, 7.5, tileW - 8, 5.5, '600', 1.4),
      value: fitText(m, t.value, MONO, 14, tileW - 8 - unitW, 8, '700'),
      unit: t.unit
    }
  })

  const hasScale = card.hero?.fill != null
  const H =
    (card.header ? ROW_HEADER : 0) +
    ROW_TITLE +
    (card.leg ? ROW_LEG : 0) +
    (card.hero ? ROW_HERO + (hasScale ? SCALE_H : 0) : 0) +
    ROW_TILES
  const W = edge + PAD + CONTENT_W + PAD

  // --- Draw ---
  const c = document.createElement('canvas')
  c.width = Math.ceil(W * SS)
  c.height = Math.ceil(H * SS)
  const g = c.getContext('2d') as Ctx
  g.textBaseline = 'alphabetic'

  roundRect(g, 0, 0, W * SS, H * SS, 4 * SS)
  g.fillStyle = PAPER
  g.fill()
  g.save()
  g.clip() // keep the accent stripe and header inside the rounded corners

  if (edge) {
    g.fillStyle = ACCENT
    g.fillRect(0, 0, edge * SS, H * SS)
  }

  const x0 = edge + PAD
  const x1 = x0 + CONTENT_W
  let y = 0
  const rule = (): void => {
    g.fillStyle = RULE
    g.fillRect(x0 * SS, Math.round(y * SS), CONTENT_W * SS, Math.max(1, Math.round(SS / 2)))
  }

  // Header strip: operator on the left, state in a box on the right.
  if (card.header && headerLeft) {
    g.fillStyle = HEADER_BG
    g.fillRect(edge * SS, 0, (W - edge) * SS, ROW_HEADER * SS)
    setFont(g, SANS, headerLeft.size, '600')
    g.fillStyle = INK
    g.fillText(headerLeft.text, x0 * SS, 14.5 * SS)
    const bw = measure(g, card.header.badge, MONO, 7.5, '600', 1.4) + 12
    g.strokeStyle = MUTED
    g.lineWidth = Math.max(1, Math.round(SS / 2))
    roundRect(g, (x1 - bw) * SS, 5 * SS, bw * SS, 12 * SS, 1.5 * SS)
    g.stroke()
    setFont(g, MONO, 7.5, '600', 1.4)
    g.fillStyle = MUTED
    g.textAlign = 'center'
    g.fillText(card.header.badge, (x1 - bw / 2) * SS, 13.5 * SS)
    g.textAlign = 'left'
    y += ROW_HEADER
    rule()
  }
  g.restore()

  // Title row: identifier left, note right, joined by a hairline when there's
  // room — it ties the two ends of the row together the way a form rule does.
  setFont(g, MONO, title.size, '700', 0.3)
  g.fillStyle = accent
  g.fillText(title.text, x0 * SS, (y + 22) * SS)
  setFont(g, MONO, 8.5, '600', 1.4)
  g.fillStyle = MUTED
  g.textAlign = 'right'
  g.fillText(card.note, x1 * SS, (y + 20) * SS)
  g.textAlign = 'left'
  const gapA = x0 + title.width + 10
  const gapB = x1 - noteW - 10
  if (gapB > gapA + 12) {
    g.fillStyle = RULE
    g.fillRect(gapA * SS, (y + 17) * SS, (gapB - gapA) * SS, Math.max(1, Math.round(SS / 2)))
  }
  y += ROW_TITLE
  rule()

  // Leg row: codes big, city names under them, the trip strung between.
  if (card.leg && leg) {
    setFont(g, MONO, leg.fromCode.size, '700', 0.3)
    g.fillStyle = INK
    g.fillText(leg.fromCode.text, x0 * SS, (y + 24) * SS)
    g.textAlign = 'right'
    setFont(g, MONO, leg.toCode.size, '700', 0.3)
    g.fillText(leg.toCode.text, x1 * SS, (y + 24) * SS)
    g.textAlign = 'left'
    setFont(g, SANS, leg.fromCity.size, '500')
    g.fillStyle = MUTED
    g.fillText(leg.fromCity.text, x0 * SS, (y + 38) * SS)
    g.textAlign = 'right'
    setFont(g, SANS, leg.toCity.size, '500')
    g.fillText(leg.toCity.text, x1 * SS, (y + 38) * SS)
    g.textAlign = 'left'

    const lineA = x0 + Math.max(leg.fromCode.width, leg.fromCity.width) + 12
    const lineB = x1 - Math.max(leg.toCode.width, leg.toCity.width) - 12
    if (lineB > lineA + 20) {
      const mid = y + 19
      g.strokeStyle = RULE
      g.lineWidth = Math.max(1, SS)
      g.setLineDash([3 * SS, 3 * SS])
      g.beginPath()
      g.moveTo(lineA * SS, mid * SS)
      g.lineTo(lineB * SS, mid * SS)
      g.stroke()
      g.setLineDash([])
      const t = card.leg.progress == null ? 0.5 : Math.max(0, Math.min(1, card.leg.progress))
      planeGlyph(g, lineA + (lineB - lineA) * t, mid, 5, ACCENT)
      if (card.leg.duration) {
        setFont(g, MONO, 8, '600', 1.2)
        g.fillStyle = MUTED
        g.textAlign = 'center'
        g.fillText(card.leg.duration, ((lineA + lineB) / 2) * SS, (mid + 15) * SS)
        g.textAlign = 'left'
      }
    }
    y += ROW_LEG
    rule()
  }

  // Hero row: the countdown, with an optional ruled scale under it.
  if (card.hero && heroCaption) {
    setFont(g, MONO, 9, '600', 1.3)
    g.fillStyle = MUTED
    g.fillText(card.hero.label, x0 * SS, (y + 23) * SS)
    setFont(g, MONO, 22, '700')
    g.fillStyle = accent
    g.fillText(card.hero.value, (x0 + heroLabelW + 7) * SS, (y + 25) * SS)
    if (card.hero.unit) {
      setFont(g, MONO, 10, '600')
      g.fillStyle = MUTED
      g.fillText(card.hero.unit, (x0 + heroLabelW + heroValueW + 8) * SS, (y + 24) * SS)
    }
    setFont(g, SANS, heroCaption.size, '600')
    g.fillStyle = INK
    g.fillText(heroCaption.text, (x0 + heroLabelW + heroValueW + heroUnitW + 14) * SS, (y + 24) * SS)
    y += ROW_HERO
    if (hasScale) {
      // Ruled scale: ticks fill toward the event, the marker stands taller.
      const n = 34
      const step = CONTENT_W / n
      const lit = Math.round(Math.max(0, Math.min(1, card.hero.fill as number)) * (n - 1))
      for (let i = 0; i < n; i++) {
        const isMarker = i === lit
        g.fillStyle = isMarker ? ACCENT : i < lit ? 'rgba(232,89,12,0.5)' : RULE
        const th = isMarker ? 11 : 7
        g.fillRect(
          Math.round((x0 + i * step) * SS),
          Math.round((y + SCALE_H - 2 - th) * SS),
          Math.max(1, Math.round(SS)),
          th * SS
        )
      }
      y += SCALE_H
    }
    rule()
  }

  // Tile row: equal columns, label over value, separated by hairlines.
  tiles.forEach((t, i) => {
    const tx = x0 + i * tileW
    if (i > 0) {
      g.fillStyle = RULE
      g.fillRect(Math.round((tx - 7) * SS), (y + 7) * SS, Math.max(1, Math.round(SS / 2)), 20 * SS)
    }
    setFont(g, MONO, t.label.size, '600', 1.4)
    g.fillStyle = MUTED
    g.fillText(t.label.text, tx * SS, (y + 13) * SS)
    setFont(g, MONO, t.value.size, '700')
    g.fillStyle = INK
    g.fillText(t.value.text, tx * SS, (y + 28) * SS)
    if (t.unit) {
      setFont(g, MONO, 8, '600')
      g.fillStyle = MUTED
      g.fillText(t.unit, (tx + t.value.width + 2) * SS, (y + 28) * SS)
    }
  })

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return { tex, aspect: W / H, screenH: H / DESIGN_FRAME_H }
}

// Icon color by flight category: passenger cyan, cargo amber, military green.
const CAT_COLOR = {
  passenger: new THREE.Color('#35c1ff'),
  cargo: new THREE.Color('#f5a623'),
  military: new THREE.Color('#74d16a')
} as const
export function categoryColor(cat: FlightCategory): THREE.Color {
  return cat === 'military' ? CAT_COLOR.military : cat === 'cargo' ? CAT_COLOR.cargo : CAT_COLOR.passenger
}

/** Colour per orbit class, so the shells read apart at a glance: low orbit
 * cyan, the Starlink shells violet (they're most of the sky), navigation gold,
 * geostationary a warm red that sits still over the equator. */
export function orbitColor(orbit: string): THREE.Color {
  switch (orbit) {
    case 'starlink':
      return new THREE.Color('#b48cff')
    case 'meo':
      return new THREE.Color('#ffd166')
    case 'geo':
      return new THREE.Color('#ff7b6b')
    default:
      return new THREE.Color('#5ce1e6')
  }
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
