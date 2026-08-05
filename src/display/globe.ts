// Equirectangular display engine (three.js). Renders a 2:1 frame that the
// sphere-projection software wraps onto the physical globe:
//   - background: earth texture (or procedural ocean) + graticule and a
//     real-time day/night terminator;
//   - aircraft: unselected as altitude-colored dots (an InstancedMesh), the
//     selected one as an airplane sprite rotated by heading; positions eased and
//     dead-reckoned between polls for smooth motion;
//   - the selected aircraft's great-circle route (flown red, remaining faint).
//
// Coordinate convention: an orthographic camera over the [0,1]×[0,1] earth
// (x = (lon+180)/360, worldY = (lat+90)/180). The camera rect is the zoom/pan
// view, eased toward the target set by setView() (driven by the control map).

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import type {
  Aircraft,
  GeoPoint,
  OverlayKey,
  Satellite,
  ViewState,
  WeatherFrame,
  WeatherLayer
} from '@shared/types'
import { projectNorm, wrapLon, nearestRouteIndex, isPlausibleCoord } from '@shared/projection'
import {
  EARTH_TEXTURE_URL,
  EARTH_NIGHT_URL,
  EARTH_MIPMAPS,
  WEATHER_CLOUD_OPACITY,
  WEATHER_FRAME_HOLD_MS
} from '@shared/config'
import { PLANE_DATA_URI } from '@shared/plane'
import { categoryKey } from '../common/flightClass'
import {
  screenAngle,
  dotTexture,
  pinTexture,
  textTexture,
  glowTexture,
  lightTexture,
  LIGHT_QUAD_SCALE,
  LIGHT_SPOTS,
  calloutTexture,
  categoryColor,
  orbitColor,
  plainDotTexture,
  satelliteTexture
} from './textures'

/** Below this altitude a flight is near one end of its journey, which is when
 * it is worth showing. */
const STORY_ALT_M = 6000
/** Quiet time before the exhibit lets go of whatever the last visitor left
 * selected and returns to the whole world. */
const IDLE_RELEASE_MS = 90_000
const HOME_LON = 127.5
const HOME_LAT = 37.5
/** Where the selected object is on screen, and what the card needs to know to
 * sit next to it without covering anything. */
/**
 * Where rain starts to show, and where the ramp saturates — in whatever unit
 * the service says the variable is in.
 *
 * Which variable the rain layer ends up being depends on what the key is
 * entitled to: reflectivity in dBZ, or an hour's depth in millimetres. The two
 * scales have nothing in common — 12 dBZ is drizzle you would not bother
 * drawing and 12mm in an hour is a warning — so the thresholds cannot be
 * constants. They come from the unit, with a proportional fallback for a unit
 * nobody here has seen.
 */
export interface SelectionAnchor {
  x: number
  y: number
  /** Current view span (1 = whole world, MIN_SPAN = fully zoomed in). */
  span: number
  /**
   * Everything on screen the card must not cover, in client pixels: the route
   * itself, sampled along its length, plus its two endpoint markers. A single
   * "which side is the route on" hint was not enough — a route that runs off
   * both sides of the aircraft has no clear side, and the card landed on the
   * destination anyway.
   */
  avoid: { x: number; y: number; hard?: boolean }[]
  /**
   * True while the camera is still easing toward its target — selecting
   * recentres and zooms, and that takes a second. A card placed against a
   * moving camera is placed against a map that is about to be somewhere else.
   */
  moving: boolean
  /** Where the camera itself is pointing. The object drifts on its own; this
   * changes only when someone moves the map. */
  viewLon: number
}

const CAPACITY = 20000 // max rendered objects (aircraft ~7k, satellites ~11k)
const MIN_SPAN = 0.1 // most the control map may zoom in (≈10×) — down to city level

// How big an object is drawn, as a fraction of the frame, at a given zoom.
//
// Holding the on-screen size constant across zoom (which is what a plain
// `scale = span` does) is wrong at both ends: zoomed out, seven thousand
// full-size icons merge into a single textured mat with no map underneath;
// zoomed into one city, the handful left over look lost. Sizing by the square
// root of the span shrinks them ~40% at world view and grows them ~2× at full
// zoom, so density stays roughly readable throughout.
//
// Satellites get the smaller constant: they are drawn as dots, there are twice
// as many, and a dot needs far fewer pixels than a silhouette to read.
const ICON_K = { aircraft: 0.62, satellite: 0.3 } as const
/** Exponent below 1 = icons shrink when zoomed out. 0.7 doubles them between
 * world view and full zoom, which is enough to matter without ballooning. */
const ICON_ZOOM_P = 0.7
function iconScaleFor(kind: 'aircraft' | 'satellite', span: number): number {
  return ICON_K[kind] * Math.pow(Math.max(MIN_SPAN, Math.min(1, span)), ICON_ZOOM_P)
}

// Sizes below are HEIGHTS as a fraction of the frame; widths are derived from
// each texture's aspect and the frame aspect (see quadSize). The display frame
// is projected onto a dome, which throws away a lot of effective resolution, so
// anything carrying text is deliberately generous — text that reads fine on a
// monitor disappears there.
const ICON_H = 0.025 // unselected aircraft icon / satellite dot
const SEL_H = 0.05 // the selected object
const MARKER_H = 0.022 // origin dot
const PIN_H = 0.036 // destination pin
const PIN_ASPECT = 64 / 96 // matches pinTexture's canvas
const LABEL_H = 0.028 // origin/destination place name
const FLAG_H = 0.03 // country flag

// The selection's halo: warm cabin light for an aircraft, cold instrument
// light for a satellite. Sized as a multiple of the icon.
const GLOW_COLOR = { aircraft: '#ffcf8a', satellite: '#9be8ff' } as const
const GLOW_SCALE = 3.4

/** One full turn of the earth, compressed. At the real fifteen degrees an hour
 * the terminator would not visibly move during a visit. */
const DAY_PERIOD_MS = 6 * 60 * 1000
/** How long one breath of the night-time lights takes. Slow on purpose: a short
 * cycle across thousands of icons reads as flicker, not as lights coming on. */
const PULSE_MS = 4200

/**
 * Widest an icon may be stretched near the poles on the projected sphere.
 *
 * The correction is 1/cos(latitude), which runs away at the pole — 11x at 85°.
 * Five is already generous, and past it the shape is doing more harm than the
 * squashing it fixes.
 */
/** Plates get a shorter leash than icons — see plateStretch. */
const MAX_PLATE_STRETCH = 2
/** Widest a corrected plate may become, as a fraction of the frame. */
const MAX_PLATE_W = 0.86
const MAX_POLE_STRETCH = 5

interface Eased {
  lon: number // current rendered position
  lat: number
  heading: number // radians
  speed: number // ground speed, m/s (for dead reckoning)
  tLon: number // latest snapshot position (correction target)
  tLat: number
  tHeading: number
  color: THREE.Color
}

const M_PER_DEG = 111_320 // metres per degree of latitude

export class Globe {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10)
  private bg: THREE.Mesh
  private bgUniforms: Record<string, THREE.IUniform>
  private planes: THREE.InstancedMesh
  private selectedPlane: THREE.Mesh
  /** Pulsing red lights on the selected object's wingtips (or solar panels) —
   * the marker for "this is the one you picked". */
  private selectedLights!: THREE.Mesh
  private planeLightTex!: THREE.CanvasTexture
  private satLightTex!: THREE.CanvasTexture
  /** Halo behind the selection, which lights up as the map goes dark. */
  private selectedGlow!: THREE.Mesh
  // Sun position for this frame, shared by the background shader and the
  // per-object lighting so an aircraft's lights agree with the ground below it.
  private sunLon = 0
  private sunDecl = 0
  private sunLonRad = 0
  private sinDecl = 0
  private cosDecl = 1
  /** 0..1 breathing cycle for the night-time lights. */
  private pulse = 0
  private originMarker!: THREE.Mesh
  private destMarker!: THREE.Mesh
  private originLabel!: THREE.Mesh
  private destLabel!: THREE.Mesh
  private infoLabel!: THREE.Mesh
  private originFlag!: THREE.Mesh
  private destFlag!: THREE.Mesh
  private flagCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>()
  /** Size of the selection furniture (world units) — tracks the view span, so
   * markers, labels and the info chip keep a constant on-screen size. */
  private uiScale = 1
  /** Size of the instanced icons/dots (world units). Deliberately NOT constant
   * on screen — see ICON_K. */
  private iconScale = ICON_K.aircraft
  private routeGroup = new THREE.Group()
  private routePoints: GeoPoint[] | null = null
  private lastRouteIdx = -1
  private lastRouteOffset = NaN
  /**
   * A dark casing under the route, for the same reason the orbit has one: the
   * remaining leg is pale yellow, which vanishes over pale ground — the steppe
   * and desert across Mongolia and central Asia especially, which happens to be
   * where a great many long-haul routes run. Outlining it works over any
   * terrain, where no single colour does.
   */
  private routeCasingMat = new LineMaterial({
    color: 0x0a1020,
    linewidth: 9,
    transparent: true,
    opacity: 0.55
  })
  private flownMat = new LineMaterial({ color: 0xff3b30, linewidth: 5, transparent: true })
  private remainMat = new LineMaterial({
    color: 0xffe08a,
    linewidth: 3.5,
    transparent: true,
    // Was 0.4, which on top of the colour clash left the leg barely there.
    opacity: 0.92
  })
  /**
   * Orbits are drawn as one continuous line: a satellite has no departure to
   * have flown from, so splitting the track into "done" and "to go" would be
   * inventing a story the object doesn't have.
   *
   * Drawn as a bright core over a dark casing, rather than in a colour of its
   * own. It was cyan, which is exactly the colour of a low-orbit dot — the line
   * disappeared into the swarm it was drawn through. Every colour that reads
   * well on the night side washes out over the daylit one and vice versa, so
   * the casing does the work: white on near-black stands out against anything
   * underneath it, and belongs to no orbit class.
   */
  private orbitCasingMat = new LineMaterial({
    color: 0x0a1020,
    linewidth: 8,
    transparent: true,
    opacity: 0.55
  })
  private orbitMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 3,
    transparent: true,
    opacity: 0.95
  })
  private raf = 0
  private lastFrame = 0

  /** Which kind of object is on screen. Satellites are drawn as dots (an icon
   * per object is unreadable at catalogue scale) and have no origin/destination,
   * so several pieces of the flight presentation are suppressed for them. */
  private kind: 'aircraft' | 'satellite' = 'aircraft'
  private planeTex!: THREE.Texture
  private dotTex!: THREE.CanvasTexture
  private satTex!: THREE.CanvasTexture
  private eased = new Map<string, Eased>()
  private order: string[] = [] // stable instance ordering
  private selected: string | null = null
  /** Objects with something to show — a confirmed route, or (for a satellite)
   * an orbit, which is always. Only the attract cycle consults this. */
  private routed = new Set<string>()
  /** Aircraft with a route that are low enough to be climbing out of, or
   * settling into, an airport — the ones with something happening. */
  private story = new Set<string>()
  /** When the operator last touched anything, for the idle release. */
  private lastActivity = Date.now()
  private released = false
  private spriteMat = new THREE.Matrix4()
  private scratchColor = new THREE.Color()
  /** Rendered pixel width ÷ height (2:1 by construction). The world is [0,1]²,
   * so this is how much a world-space square is stretched horizontally. */
  private frameAspect = 2
  // Camera view rect in normalized [0,1] coords: current (eased) + target.
  // Horizontal pan is done via lonOffset (so it wraps seamlessly); the camera x
  // stays centered on 0.5. The camera y handles vertical pan + zoom.
  private viewRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetRect = { left: 0, right: 1, top: 1, bottom: 0 }
  private targetSpan = 1
  private lonOffset = 0 // eased longitude offset (= -centerLon)
  private targetLonOffset = 0
  // The projected display never zooms: it always shows the whole world. The only
  // freedom is the horizontal spin (longitude offset). When a route is selected
  // we lock the spin so origin+destination sit symmetrically around center;
  // otherwise the control map's pan drives it.
  private controlCenterLon = 0
  private routeCenterLon: number | null = null
  private pendingRecenter = false // center on the route once, on selection only
  private hasEarthTexture = false
  private nightHourOverride: number | null = null // null = live time

  // Interactive (control) mode: the operator drives the camera locally with
  // drag/wheel and clicks to select, emitting view/selection back to the hub.
  private interactive = false
  /** True on the projected frame, where icons must be corrected for the
   * sphere's curvature. False on the flat control screen. */
  private sphereIcons = false
  onViewChange: ((v: ViewState) => void) | null = null
  onSelectChange: ((icao24: string | null) => void) | null = null
  /**
   * Where the selected object currently is, in client pixels — so the control
   * screen can put its card next to the thing that was tapped instead of always
   * in the same corner. Null when nothing is selected or it isn't on screen.
   */
  onSelectedAnchor: ((p: SelectionAnchor | null) => void) | null = null
  private lastAnchor: SelectionAnchor | null = null
  /** Extra keep-out points in world coords (u, screen-y): the endpoint markers,
   * their place names and their flags. Refreshed each frame by the route block,
   * and read by emitAnchor on the next one. */
  private extraAvoid: { u: number; y: number }[] = []
  // Fired true when the exhibit is auto-cycling (attract), false on operator input.
  onAttractChange: ((active: boolean) => void) | null = null
  /** Set to hand a finished weather texture back for inspection (debug only). */
  onDebugImage: ((name: string, dataUrl: string) => void) | null = null
  private debugDumped = new Set<string>()
  /** Set to put a line in the exe's log from the renderer. */
  onNote: ((text: string) => void) | null = null
  /** The moments each layer is currently showing, for the clock report. */
  private wxTimes: Record<WeatherLayer, number[]> = { cloud: [], rain: [] }
  private iCenterLon = 127.5
  private iCenterLat = 37.5
  private iSpan = 1
  private lastViewEmit = 0
  private viewEmitTimer: ReturnType<typeof setTimeout> | null = null
  private dragging = false
  private lastPX = 0
  private lastPY = 0
  private movedDuringDrag = false
  private inputCleanup: (() => void) | null = null
  // Attract mode: after 30s with no operator input, auto-select a random flight
  // (and keep cycling every 30s) so the exhibit demos itself when unattended.
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private readonly idleMs = 30000
  // When the selected flight has no route, move on after this long.
  private noRouteTimer: ReturnType<typeof setTimeout> | null = null
  // Active pointers (for pinch-zoom) and the pinch anchor.
  private pointers = new Map<number, { x: number; y: number }>()
  private pinchStartDist = 0
  private pinchStartSpan = 1
  // If set, the canvas renders at this exact pixel size (top-left), rest black —
  // for a projector that expects the equirect frame in a fixed region.
  private fixedSize: { w: number; h: number } | null = null
  /**
   * One decoded animation series per weather layer.
   *
   * `token` is what keeps a slow series from overwriting a fast one: switching
   * chips or landing a new poll while sixty tiles are still decoding used to
   * leave whichever finished LAST on screen, which is not necessarily the one
   * that was asked for.
   */
  private wx: Record<
    WeatherLayer,
    { textures: THREE.Texture[]; token: number; byTime?: Map<number, THREE.Texture> }
  > = {
    cloud: { textures: [], token: 0 },
    rain: { textures: [], token: 0 }
  }

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { interactive?: boolean; sphere?: boolean; fixedSize?: { w: number; h: number } } = {}
  ) {
    this.interactive = !!opts.interactive
    this.sphereIcons = !!opts.sphere
    this.fixedSize = opts.fixedSize ?? null
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x000000, 1)
    this.scene.add(this.routeGroup)

    // --- Background ---
    this.bgUniforms = {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uNightMap: { value: null },
      uHasNight: { value: 0 },
      uLonOffset: { value: 0 },
      // Sun position, in degrees. Night is computed per pixel from these, so
      // the frame really is half lit and half dark with a terminator between.
      uSunLon: { value: 0 },
      uSunDecl: { value: 0 },
      uNightFloor: { value: 0.22 }, // how much of the day map survives at night
      // Weather. Two Mercator mosaics, remapped to this frame in the shader.
      uCloud: { value: null },
      uHasCloud: { value: 0 },
      // 1 = the picture is Web Mercator and needs the row remap; 0 = it is
      // already plate carrée, i.e. this frame's own projection.
      uCloudMerc: { value: 1 },
      // 1 = a seamless photograph of the earth, drawn where it has data;
      // 0 = a geostationary disc the cloud has to be lifted out of.
      uCloudPhoto: { value: 0 },
      uCloudAmt: { value: WEATHER_CLOUD_OPACITY },
      uRain: { value: null },
      uHasRain: { value: 0 },
      uRainMerc: { value: 1 },
      // --- Animated data layers -------------------------------------------
      // The source publishes a time series, so each layer holds TWO textures
      // and a blend between them; the loop walks the series and the picture
      // drifts instead of standing still for the whole poll interval.
      uCloudB: { value: null },
      uCloudMix: { value: 0 },
      uRainB: { value: null },
      uRainMix: { value: 0 },
      // 1 = the tile is a measurement, not a picture: the value is packed into
      // the channels and coloured HERE, so the palette is ours.
      uCloudData: { value: 0 },
      uRainData: { value: 0 },
      // Channel weights that pack the bytes back into one integer, and the
      // largest that integer can be. Both come from the service's own index.
      uCloudChanW: { value: new THREE.Vector3(1, 0, 0) },
      uCloudPacked: { value: 255 },
      uCloudRange: { value: new THREE.Vector2(0, 100) },
      uRainChanW: { value: new THREE.Vector3(1, 0, 0) },
      uRainPacked: { value: 255 },
      uRainRange: { value: new THREE.Vector2(-30, 75) },
      // Where rain starts to show and where it saturates, in the variable's own
      // unit. Set from the index's declared unit — see applyDecode.
      uRainScale: { value: new THREE.Vector2(12, 70) },
      // Curve applied to the normalised intensity. 1 is linear; below 1 lifts
      // the light end, which is where nearly all the rain in the world is.
      uRainGamma: { value: 1 },
      uShowGrid: { value: 1 },
      uBrightness: { value: 1.0 }, // neutral — show the image faithfully
      uSaturation: { value: 1.0 } // neutral — keep the source photo's saturation
    }
    const bgMat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap; uniform float uHasMap; uniform float uLonOffset;
        uniform sampler2D uNightMap; uniform float uHasNight;
        uniform float uSunLon; uniform float uSunDecl; uniform float uNightFloor;
        uniform sampler2D uCloud; uniform float uHasCloud; uniform float uCloudMerc;
        uniform float uCloudPhoto; uniform float uCloudAmt;
        uniform sampler2D uRain; uniform float uHasRain; uniform float uRainMerc;
        uniform sampler2D uCloudB; uniform float uCloudMix;
        uniform sampler2D uRainB; uniform float uRainMix;
        uniform float uCloudData; uniform float uRainData;
        uniform vec3 uCloudChanW; uniform float uCloudPacked; uniform vec2 uCloudRange;
        uniform vec3 uRainChanW; uniform float uRainPacked; uniform vec2 uRainRange;
        uniform vec2 uRainScale; // x = where rain starts to show, y = full intensity
        uniform float uRainGamma;
        uniform float uShowGrid; uniform float uBrightness; uniform float uSaturation;

        // Unpack one data pixel into [real value, coverage]. The channels are
        // big-endian bytes of one integer; alpha is the no-data mask.
        vec2 unpack(vec4 c, vec3 w, float packed, vec2 range) {
          float v = dot(c.rgb * 255.0, w) / max(packed, 1.0);
          return vec2(mix(range.x, range.y, v), c.a);
        }
        // Two steps of the series, decoded THEN blended. Blending the packed
        // bytes instead would mix the high byte of one frame with the low byte
        // of another, which is not a halfway value, it is noise.
        vec2 readData(sampler2D a, sampler2D b, float m, vec2 uv, vec3 w, float p, vec2 r) {
          vec2 A = unpack(texture2D(a, uv), w, p, r);
          vec2 B = unpack(texture2D(b, uv), w, p, r);
          return mix(A, B, m);
        }
        // Rain, in the colours everyone already reads as rain, over a
        // NORMALISED intensity rather than a raw number. The layer can arrive
        // as reflectivity in dBZ or as depth in millimetres depending on what
        // the key is entitled to, and stops written in dBZ mean nothing in mm:
        // twelve is drizzle in one unit and a flood in the other. uRainLo and
        // uRainTop carry the unit's own two anchors and this works in between.
        vec3 rainRamp(float t) {
          vec3 c = mix(vec3(0.24, 0.55, 0.95), vec3(0.20, 0.85, 0.85), smoothstep(0.05, 0.22, t));
          c = mix(c, vec3(0.30, 0.85, 0.35), smoothstep(0.22, 0.40, t));
          c = mix(c, vec3(0.98, 0.88, 0.25), smoothstep(0.40, 0.57, t));
          c = mix(c, vec3(0.98, 0.52, 0.16), smoothstep(0.57, 0.69, t));
          c = mix(c, vec3(0.92, 0.20, 0.28), smoothstep(0.69, 0.86, t));
          return mix(c, vec3(0.86, 0.36, 0.92), smoothstep(0.86, 1.0, t));
        }
        void main() {
          // No fract(): let RepeatWrapping tile the texture. fract() creates a
          // huge UV derivative at the wrap, which picks the wrong mip level and
          // draws a vertical seam when the map wraps around.
          vec2 uv = vec2(vUv.x - uLonOffset / 360.0, vUv.y);
          vec3 day = uHasMap > 0.5 ? texture2D(uMap, uv).rgb : vec3(0.05, 0.12, 0.22);
          // Brightness + saturation grade on the daytime image.
          float luma = dot(day, vec3(0.299, 0.587, 0.114));
          day = mix(vec3(luma), day, uSaturation) * uBrightness;

          if (uShowGrid > 0.5) {
            float lon = uv.x * 360.0 - 180.0;
            float lat = vUv.y * 180.0 - 90.0;
            float glon = abs(fract(lon / 30.0 + 0.5) - 0.5);
            float glat = abs(fract(lat / 30.0 + 0.5) - 0.5);
            float grid = smoothstep(0.015, 0.0, min(glon, glat));
            day = mix(day, vec3(0.4, 0.6, 0.85), grid * 0.3);
          }

          // Day and night as they actually are: the half of the world facing the
          // sun is lit, the other half isn't, and the terminator between them
          // sweeps west as the earth turns. This replaces a single global dim
          // that darkened the whole map at once — which is not what anyone has
          // ever seen the earth do.
          //
          // Standard solar geometry: the cosine of the sun's zenith angle at a
          // point is sin(lat)sin(decl) + cos(lat)cos(decl)cos(lon - sunLon).
          // Positive means the sun is up. The smoothstep widens the crossing
          // into the soft band of twilight rather than a hard edge.
          float rad = 3.14159265 / 180.0;
          float plat = (vUv.y * 180.0 - 90.0) * rad;
          float plon = (uv.x * 360.0 - 180.0) * rad;
          float sdecl = uSunDecl * rad;
          float slon = uSunLon * rad;
          float cosZenith =
            sin(plat) * sin(sdecl) + cos(plat) * cos(sdecl) * cos(plon - slon);
          float uNight = smoothstep(0.10, -0.10, cosZenith);

          // Weather arrives as Web Mercator tiles. Mercator's x is linear in
          // longitude, so the same uv.x works (offset and seam wrap included)
          // and only the row has to be remapped. Outside |lat| 85.05 Mercator
          // has no data at all, which is why the poles stay bare.
          float latDeg = vUv.y * 180.0 - 90.0;
          float mercY = 0.5 - log(tan(0.78539816 + plat * 0.5)) / 6.28318531;
          float inMerc = step(abs(latDeg), 85.05);
          // uv.x directly, no fract() — same reasoning as the earth map above:
          // RepeatWrapping tiles it, and fract() would blow up the derivative
          // at the wrap and pick the wrong mip level, drawing a seam.
          vec2 mercUV = vec2(uv.x, mercY);
          vec2 flatUV = vec2(uv.x, vUv.y);

          // Night = moonlit earth + city lights (from the night texture) glowing.
          //
          // The floor used to be 0.10, which left the land indistinguishable
          // from the sea — the city lights ended up floating in black with no
          // coastline behind them. Keeping a third of the day map, desaturated
          // and shifted toward blue, reads as moonlight: the continents stay
          // legible while it still plainly isn't daytime.
          float nluma = dot(day, vec3(0.299, 0.587, 0.114));
          vec3 moonlit = mix(vec3(nluma), day, 0.6) * vec3(0.70, 0.82, 1.18) * uNightFloor;
          vec3 lights = uHasNight > 0.5 ? texture2D(uNightMap, uv).rgb * 1.6 : vec3(0.0);
          vec3 night = moonlit + lights;
          vec3 col = mix(day, night, uNight);

          // Cloud goes in AFTER the terminator, not before.
          //
          // Infrared is a measurement of how cold the cloud top is, not a
          // photograph of sunlight bouncing off it — the sensor sees the same
          // storm at midnight as at noon, which is the whole reason for using
          // it. Putting it in with the daylight and then dimming it to a fifth
          // for the night side made half the world's weather invisible, which
          // is exactly what it looked like. And it is drawn toward white rather
          // than toward the sensor's own grey, because a grey cloud over a dark
          // ocean is a grey nobody can see.
          if (uHasCloud > 0.5 && uCloudData > 0.5) {
            // Total cloud cover, in percent, straight from the model — not a
            // brightness the code has to guess cloud out of. Below about a
            // tenth of the sky nobody would call it cloudy, so that is where
            // the white starts; solid overcast is solid white.
            vec2 d = readData(uCloud, uCloudB, uCloudMix,
                              uCloudMerc > 0.5 ? mercUV : flatUV,
                              uCloudChanW, uCloudPacked, uCloudRange);
            // Stops just short of opaque so a downpour still reads through
            // solid overcast — which is the pair of facts a visitor came to
            // see, and hiding one behind the other helps nobody.
            float a = smoothstep(10.0, 88.0, d.x) * 0.88
                      * d.y * (uCloudMerc > 0.5 ? inMerc : 1.0);
            col = mix(col, vec3(0.97, 0.98, 1.0), a);
          } else if (uHasCloud > 0.5) {
            // The mosaic already IS the answer.
            //
            // Every sensor's picture was reduced to one number — how much
            // cloud — and stretched onto a common scale while the mosaic was
            // built, precisely so that five instruments with five different
            // palettes and calibrations would agree. Guessing cloud out of the
            // colour again here would undo that, on a texture whose colour is
            // now nothing but that number written three times.
            vec4 c = texture2D(uCloud, uCloudMerc > 0.5 ? mercUV : flatUV);
            float lifted = clamp(smoothstep(0.06, 0.46, c.r) * uCloudAmt, 0.0, 1.0);
            float a = c.a
              * (uCloudPhoto > 0.5 ? 1.0 : lifted)
              * (uCloudMerc > 0.5 ? inMerc : 1.0);
            // White, with none of the source's hue.
            //
            // A quarter of the sensor's colour used to survive, which was
            // right for a true-colour composite and wrong for this one: these
            // layers carry a temperature palette, so a quarter of it came
            // through as green and pink speckles scattered through the cloud
            // that looked like rain and vanished when the cloud chip went off.
            // The palette's job here is to say WHERE and HOW MUCH, which is
            // the opacity; the colour is not information we want on the globe.
            vec3 tint = uCloudPhoto > 0.5 ? c.rgb : vec3(0.97, 0.98, 1.0);
            col = mix(col, tint, a);
          }

          /*
           * The rain is drawn at full strength, wherever the model puts it.
           *
           * It was briefly multiplied by how much cloud the camera saw at the
           * same pixel, to stop rain appearing under a clear black sky. That
           * treated a timing bug as a physics problem: the two layers were on
           * opposite clocks — the rain animating an hour into the future, the
           * cloud three quarters of an hour into the past — so of course they
           * disagreed about where a storm was, and multiplying them just
           * deleted the rain instead. A typhoon with no rain falling out of it
           * is a worse lie than rain slightly offset from its cloud.
           *
           * The clocks are shared now (see the rain window in server/weather.ts,
           * which the cloud follows), so the two agree because they are about
           * the same moment, which is the only way they ever could.
           */

          // Rain goes in last: it is a data overlay, not a photograph, and a
          // storm that vanishes at sunset is a storm nobody can point at.
          if (uHasRain > 0.5 && uRainData > 0.5) {
            // Below uRainScale.x is the drizzle the eye cannot pick out of a
            // cloud deck anyway, and drawing it turned whole oceans a flat
            // wash; the ramp fades in from there and saturates at a downpour.
            vec2 d = readData(uRain, uRainB, uRainMix,
                              uRainMerc > 0.5 ? mercUV : flatUV,
                              uRainChanW, uRainPacked, uRainRange);
            float lin = clamp((d.x - uRainScale.x) / max(uRainScale.y - uRainScale.x, 1e-4), 0.0, 1.0);
            // Rain spans orders of magnitude — a tenth of a millimetre an hour
            // and forty are both rain, and a linear ramp puts everything
            // anybody actually stands in inside the first two percent of it.
            // The gamma is what makes drizzle a colour instead of a rounding
            // error; for reflectivity, already a log scale by definition, it
            // is 1 and this does nothing.
            float t = pow(lin, uRainGamma);
            /*
             * Opacity carries intensity too, not just the colour.
             *
             * This used to reach full opacity at a tenth of the ramp, which
             * for the measured field is 0.07mm an hour — so ninety-nine
             * percent of the world's rain was drawn at full strength in the
             * ramp's first colour, and a typhoon was the same solid cyan as
             * drizzle over the Southern Ocean. A floor keeps light rain
             * visible without letting it shout: a wash at the bottom, solid by
             * the time it is worth carrying a coat for.
             *
             * That floor is 0.45, not 0.30. The field is quantised in steps of
             * about two tenths of a millimetre, so the lightest rain there is
             * IS the ninetieth percentile — there is nothing fainter for the
             * ramp to separate it from. At 0.30 over a night ocean it was
             * invisible, and beside a public map the difference read as our
             * having no rain at all rather than as our rain being lighter.
             */
            // The floor applies to rain, not to everywhere: a dry pixel sits at
            // t = 0 and the first factor holds it at nothing. Without it the
            // floor would wash the whole planet pale blue.
            float a = smoothstep(0.0, 0.02, t) * mix(0.45, 1.0, smoothstep(0.10, 0.55, t)) * d.y
                      * (uRainMerc > 0.5 ? inMerc : 1.0);
            col = mix(col, rainRamp(t), a * 0.92);
          } else if (uHasRain > 0.5) {
            vec4 r = texture2D(uRain, uRainMerc > 0.5 ? mercUV : flatUV);
            col = mix(col, r.rgb, r.a * (uRainMerc > 0.5 ? inMerc : 1.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat)
    this.bg.position.set(0.5, 0.5, -1)
    this.scene.add(this.bg)

    // --- Aircraft: every plane is a small airplane icon, colored by altitude ---
    const planeTex = new THREE.TextureLoader().load(PLANE_DATA_URI)
    planeTex.colorSpace = THREE.SRGBColorSpace
    this.planeTex = this.tuneSprite(planeTex)
    this.dotTex = this.tuneSprite(plainDotTexture())
    this.satTex = this.tuneSprite(satelliteTexture())
    // Unit quad: every sprite's real size lives in its instance matrix, because
    // width has to be derived from the frame aspect (see setSpriteMatrix).
    const quad = new THREE.PlaneGeometry(1, 1)
    this.planes = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ map: planeTex, transparent: true, alphaTest: 0.35 }),
      CAPACITY
    )
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // Base geometry sits at the origin (a corner of the [0,1] view), so its
    // bounding sphere would frustum-cull the whole mesh — disable culling.
    this.planes.frustumCulled = false
    this.planes.count = 0
    this.scene.add(this.planes)


    // --- Selected aircraft: a larger, bright airplane icon ---
    // Additive so it brightens the map beneath rather than pasting a grey disc
    // over it; depth-tested off nothing, just drawn under the icon.
    this.selectedGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.tuneSprite(glowTexture()),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0
      })
    )
    this.selectedGlow.visible = false
    this.selectedGlow.matrixAutoUpdate = false
    this.selectedGlow.frustumCulled = false
    this.scene.add(this.selectedGlow)

    // Additive, so the lights add to the icon under them rather than pasting a
    // disc over it, and so turning them down turns them off completely.
    this.planeLightTex = this.tuneSprite(lightTexture(LIGHT_SPOTS.aircraft))
    this.satLightTex = this.tuneSprite(lightTexture(LIGHT_SPOTS.satellite))
    this.selectedLights = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.planeLightTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    this.selectedLights.visible = false
    this.selectedLights.matrixAutoUpdate = false
    this.selectedLights.frustumCulled = false
    this.scene.add(this.selectedLights)

    this.selectedPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: planeTex, transparent: true })
    )
    this.selectedPlane.visible = false
    // Its transform is written directly (rotation has to happen in screen space).
    this.selectedPlane.matrixAutoUpdate = false
    this.selectedPlane.frustumCulled = false
    this.scene.add(this.selectedPlane)

    // --- Origin (dot) / destination (pin) markers on the selected route ---
    const mkMarker = (tex: THREE.Texture, aspect: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true })
      )
      m.visible = false
      m.position.z = 0.65
      m.userData.aspect = aspect
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.originMarker = mkMarker(this.tuneSprite(dotTexture('#33c1ff')), 1)
    this.destMarker = mkMarker(this.tuneSprite(pinTexture('#ff3b30')), PIN_ASPECT)

    // Origin / destination place-name labels (created empty; text set on select).
    const label = (): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ transparent: true, depthTest: false })
      )
      m.visible = false
      m.renderOrder = 10
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.originLabel = label()
    this.destLabel = label()
    this.infoLabel = label() // flight info chip next to the selected plane
    this.originFlag = label() // country flag above the origin marker
    this.destFlag = label() // country flag above the destination marker

    this.tryLoadEarth()
    this.resize()
    if (this.interactive) {
      this.attachInput()
      this.applyInteractiveView()
      this.startAttractTimer()
    }
  }

  /**
   * Filtering for a sprite (icon, dot, marker). Same anisotropy + mipmap chain
   * as the earth, but clamped rather than repeating: a sprite that wraps samples
   * the opposite edge of its own texture and smears colour across its outline.
   * Without this the icons were minified with a plain bilinear filter, which is
   * what made them look chewed-up once they were only a dozen pixels across.
   */
  private tuneSprite<T extends THREE.Texture>(tex: T): T {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    tex.needsUpdate = true
    return tex
  }

  /**
   * Transform for a rotatable sprite (aircraft icon, satellite dot, selection).
   *
   * The world is the unit square but the frame is 2:1, so a world-space square
   * lands on screen twice as wide as it is tall — which is why the dots were
   * ellipses — and a world-space rotation comes out sheared, because rotating
   * and then stretching unequally are not the same operation in either order.
   *
   * Both go away if the sprite is built square in SCREEN space and squashed
   * back into world x afterwards: M = diag(1/aspect, 1) · R(angle) · size.
   * `size` is therefore a height, as a fraction of the frame.
   */
  private setSpriteMatrix(
    u: number,
    y: number,
    z: number,
    size: number,
    angle: number,
    latDeg?: number
  ): THREE.Matrix4 {
    const c = Math.cos(angle) * size
    const s = Math.sin(angle) * size
    // On the projected sphere the frame is squeezed horizontally toward the
    // poles — a whole 360° of longitude collapses into a point — so an icon
    // that is square in the frame comes out pinched on the dome, more and more
    // the further from the equator it is. Widening it by 1/cos(latitude) undoes
    // exactly that, and only on the dome: the control screen shows the flat
    // frame, where nothing is squeezed and the correction would be the bug.
    const ax =
      this.sphereIcons && latDeg != null
        ? this.frameAspect *
          Math.max(1 / MAX_POLE_STRETCH, Math.cos((latDeg * Math.PI) / 180))
        : this.frameAspect
    // prettier-ignore
    this.spriteMat.set(
      c / ax, -s / ax, 0, u,
      s,       c,      0, y,
      0,       0,      1, z,
      0,       0,      0, 1
    )
    return this.spriteMat
  }

  /**
   * Which way the icon points.
   *
   * On the flat frame a great circle is a curve, so an icon has to follow the
   * frame's tangent (screenAngle) to look like it is going where it is going.
   * On the sphere that curvature is gone — the shape correction above has
   * already turned the local frame back into a square patch of ground — so the
   * plain geographic heading is the right one, and using the flat correction
   * there would twist every icon away from its track.
   */
  private iconAngle(headingRad: number, latDeg: number): number {
    return this.sphereIcons
      ? Math.atan2(-Math.sin(headingRad), Math.cos(headingRad))
      : screenAngle(headingRad, latDeg)
  }

  /** Width in world units for an axis-aligned quad of screen height `h` whose
   * texture has the given width/height ratio. */
  private quadWidth(h: number, texAspect: number): number {
    return (h * texAspect) / this.frameAspect
  }

  /**
   * How much wider a screen-space plate has to be drawn at this latitude.
   *
   * The icons have had this since the dome went in — the projection squeezes
   * horizontally toward the poles, so a square drawn in the frame arrives on
   * the dome pinched — but the plates did not, and a callout over Alaska came
   * out narrow and unreadable while the aircraft under it was correct. Same
   * correction, same clamp, applied to the same axis.
   */
  private poleStretch(latDeg: number, max = MAX_POLE_STRETCH): number {
    if (!this.sphereIcons) return 1
    return 1 / Math.max(1 / max, Math.cos((latDeg * Math.PI) / 180))
  }

  /**
   * The same correction for a text plate, which needs a tighter leash than an
   * icon does. An icon is a few percent of the frame, so multiplying it by five
   * over Alaska is invisible; a callout is already a third of the frame wide,
   * and five times that is a band across the whole projection. Correct as far
   * as the plate can be corrected without running off the frame, and let the
   * last few degrees of latitude go under-corrected rather than unreadable.
   */
  private plateStretch(latDeg: number, width: number): number {
    const want = this.poleStretch(latDeg, MAX_PLATE_STRETCH)
    return Math.max(1, Math.min(want, MAX_PLATE_W / Math.max(width, 1e-4)))
  }

  /** Apply crisp filtering (mipmaps + anisotropy) to reduce shimmer/blur. */
  private tuneTexture(tex: THREE.Texture): void {
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    // See EARTH_MIPMAPS: a wrapping texture's mip chain is built with the
    // edges clamped, so the two sides of the wrap disagree at every reduced
    // level — which draws as a hairline exactly where the map joins itself.
    tex.generateMipmaps = EARTH_MIPMAPS
    tex.minFilter = EARTH_MIPMAPS ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    if (EARTH_MIPMAPS) tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    tex.needsUpdate = true
  }

  /**
   * Measure the map image where it joins itself.
   *
   * A faint vertical line sits on the globe in every mode, so it belongs to the
   * background map rather than to anything drawn over it. The map wraps in
   * longitude, and there are three quite different reasons a wrap can show, each
   * needing a different fix — which is why this measures rather than guesses.
   *
   * The image is sampled at three places: the two columns that meet when it
   * wraps, and a pair of neighbours in the middle for scale. Only twelve columns
   * are ever drawn, at full resolution, so an eight-thousand-pixel-wide source
   * costs a hundred kilobytes and no resampling that could hide the very
   * difference being looked for.
   *
   *   join much larger than the interior  the picture does not actually wrap;
   *                                       its two ends are different places
   *   join near zero                      the meridian is in the file TWICE, so
   *                                       wrapping repeats a column
   *   join about the interior             the file is fine and the line is ours
   */
  /**
   * How hard the map is being squeezed, and what the GPU was told to do about it.
   *
   * The files wrap cleanly, so the line is in the drawing — and the two ways it
   * can be are opposites. Minifying sixteen thousand pixels into sixteen
   * hundred means every screen pixel covers ten texels, and with no mip chain a
   * linear sample reads four of them and guesses; that is aliasing, and it is
   * worst where the sampling pattern is discontinuous, which is the wrap. Turn
   * the chain on and the reduced levels are built with their edges CLAMPED —
   * the driver's generateMipmap does not know the texture repeats — so the two
   * sides of the wrap disagree at every level but the largest, which draws a
   * hairline in exactly the same place for the opposite reason.
   *
   * Which one is happening is not something to reason about from a photograph
   * of a screen, so this states the numbers and the A/B settles it.
   */
  private reportSampling(tex: THREE.Texture, label: string): void {
    const img = tex.image as HTMLImageElement | undefined
    if (!this.onNote || !img?.width) return
    const caps = this.renderer.capabilities
    const gl = this.renderer.getContext()
    const across = gl.drawingBufferWidth || 1
    // At full world view the whole texture spans the frame; zoomed in, less of
    // it does. iSpan is the fraction of the world on screen.
    const texelsPerPixel = (img.width * Math.max(0.02, this.iSpan)) / across
    this.onNote(
      `[earth] ${label} sampling: ${img.width}px wide into ${across}px = ` +
        `${texelsPerPixel.toFixed(1)} texels per pixel at this zoom; ` +
        `mipmaps ${tex.generateMipmaps ? 'ON' : 'OFF'}, anisotropy ${tex.anisotropy}, ` +
        `gpu max texture ${caps.maxTextureSize}px, max anisotropy ${caps.getMaxAnisotropy()}` +
        `${img.width > caps.maxTextureSize ? ' - TOO BIG FOR THIS GPU' : ''}`
    )
  }

  private measureWrap(tex: THREE.Texture, label: string): void {
    const img = tex.image as HTMLImageElement | undefined
    if (!this.onNote || !img?.width) return
    try {
      const W = img.width
      const H = Math.min(1024, img.height)
      const c = document.createElement('canvas')
      c.width = 12
      c.height = H
      const ctx = c.getContext('2d')!
      // Left edge, right edge, and a middle pair — each at native resolution.
      ctx.drawImage(img, 0, 0, 4, img.height, 0, 0, 4, H)
      ctx.drawImage(img, W - 4, 0, 4, img.height, 4, 0, 4, H)
      ctx.drawImage(img, W >> 1, 0, 4, img.height, 8, 0, 4, H)
      const d = ctx.getImageData(0, 0, 12, H).data
      const at = (x: number, y: number): number[] => {
        const o = (y * 12 + x) * 4
        return [d[o], d[o + 1], d[o + 2]]
      }
      const diff = (ax: number, bx: number): number => {
        let sum = 0
        for (let y = 0; y < H; y++) {
          const p = at(ax, y)
          const q = at(bx, y)
          sum += (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3
        }
        return sum / H
      }
      const join = diff(7, 0) // last column against first — what wrapping joins
      const edge = diff(6, 7) // the last two columns, as a local baseline
      const mid = diff(8, 9) // an untouched interior pair
      const pot = (n: number): boolean => (n & (n - 1)) === 0
      this.onNote(
        `[earth] ${label} ${W}x${img.height} ` +
          `${img.width === img.height * 2 ? '2:1' : 'NOT 2:1'} ` +
          `${pot(W) && pot(img.height) ? 'pow2' : 'not-pow2'}; ` +
          `wrap join ${join.toFixed(1)} vs neighbours ${edge.toFixed(1)}/${mid.toFixed(1)} ` +
          `-> ${
            join > Math.max(edge, mid) * 3 + 2
              ? 'SEAM IN THE FILE (its two ends are not the same meridian)'
              : join < Math.min(edge, mid) * 0.3
                ? 'DUPLICATED COLUMN (the meridian is in the file twice)'
                : 'file wraps cleanly - the line is in the rendering'
          }`
      )
    } catch {
      /* a cross-origin image would taint the canvas; a diagnostic is not worth a crash */
    }
  }

  /** Try to swap in a real photographic earth if the asset is present. */
  /** Try each url in turn (first that loads wins); call onFail if none load. */
  private loadFirstTexture(
    urls: string[],
    onOk: (tex: THREE.Texture) => void,
    onFail: () => void
  ): void {
    const loader = new THREE.TextureLoader()
    const seen = new Set<string>()
    const list = urls.filter((u) => u && !seen.has(u) && (seen.add(u), true))
    const tryAt = (i: number): void => {
      if (i >= list.length) return onFail()
      loader.load(list[i], onOk, undefined, () => tryAt(i + 1))
    }
    tryAt(0)
  }

  /** Candidate filenames so a .png / .jpeg / alt name still works, not just the
   * exact configured .jpg. */
  private textureCandidates(url: string): string[] {
    const base = url.replace(/\.(jpe?g|png|webp)$/i, '')
    return [url, `${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}.webp`]
  }

  private tryLoadEarth(): void {
    this.loadFirstTexture(
      this.textureCandidates(EARTH_TEXTURE_URL),
      (tex) => {
        this.tuneTexture(tex)
        this.bgUniforms.uMap.value = tex
        this.bgUniforms.uHasMap.value = 1
        // Photographic maps carry their own graticule — drop the procedural grid.
        this.bgUniforms.uShowGrid.value = 0
        this.hasEarthTexture = true
        console.log(`[earth] loaded day texture (${tex.image?.src ?? EARTH_TEXTURE_URL})`)
        this.measureWrap(tex, 'day')
        this.reportSampling(tex, 'day')
      },
      () => {
        console.warn(
          `[earth] no/invalid day texture — using procedural ocean+grid. ` +
            `Put a 2:1 image at public/${EARTH_TEXTURE_URL} (or .png). ` +
            `Check the file name has no hidden double extension.`
        )
      }
    )
    // Optional night-lights texture (city lights) for the KST night effect.
    this.loadFirstTexture(
      this.textureCandidates(EARTH_NIGHT_URL),
      (tex) => {
        this.tuneTexture(tex)
        this.bgUniforms.uNightMap.value = tex
        this.bgUniforms.uHasNight.value = 1
        console.log(`[earth] loaded night texture`)
        this.measureWrap(tex, 'night')
        this.reportSampling(tex, 'night')
      },
      () => {
        /* no night texture — night side just dims globally */
      }
    )
  }

  /** The control map's viewport. On the projected display we only take the
   * horizontal center (the spin) and ignore zoom/vertical entirely — the sphere
   * always shows the whole world so nothing is ever cropped on the dome. In
   * interactive mode the operator's own camera is authoritative, so this is a
   * no-op (feeding the hub's echoed view back in would fight the input). */
  setView(view: ViewState): void {
    if (this.interactive) return
    this.controlCenterLon = view.centerLon
    this.applyViewTarget()
  }

  /** Display mode camera target: always full-world (no zoom). When a route is
   * selected, center the spin on the midpoint longitude between origin and
   * destination so both endpoints sit as close to center as possible; otherwise
   * follow the control map's horizontal pan. */
  private applyViewTarget(): void {
    const center = this.routeCenterLon ?? this.controlCenterLon
    this.targetLonOffset = -center
    this.targetRect = { left: 0, right: 1, top: 1, bottom: 0 }
    this.targetSpan = 1
  }

  /** Interactive mode camera target from the operator's intent (drag/wheel).
   * Horizontal via lonOffset (wraps); vertical + zoom via the camera y-rect,
   * clamped so the rect never leaves the [0,1] background plane. */
  private applyInteractiveView(): void {
    const s = Math.max(MIN_SPAN, Math.min(1, this.iSpan))
    this.targetLonOffset = -this.iCenterLon
    let vCenter = (this.iCenterLat + 90) / 180
    vCenter = Math.max(s / 2, Math.min(1 - s / 2, vCenter))
    this.iCenterLat = vCenter * 180 - 90 // reflect the clamp back so drag stays consistent
    this.targetRect = {
      left: 0.5 - s / 2,
      right: 0.5 + s / 2,
      top: vCenter + s / 2,
      bottom: vCenter - s / 2
    }
    this.targetSpan = s
  }

  /** Reset the interactive view to the home (whole-world, Korea-centered) view
   * and clear the selection. Wired to the "🌏 전체 보기" button. */
  home(): void {
    this.iCenterLon = HOME_LON
    this.iCenterLat = HOME_LAT
    this.iSpan = 1
    this.applyInteractiveView()
    this.emitView()
    this.onSelectChange?.(null)
  }

  /** (Re)start the 30s attract countdown. Any operator input calls this. */
  private startAttractTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.autoPick(), this.idleMs)
  }

  /** Auto-select a random flight, then keep cycling every 30s until a real
   * interaction resets the countdown. */
  private autoPick(): void {
    // Before picking the next one, let go of the last. A selection pins the
    // dome to that object's longitude, so whatever the last visitor tapped
    // stayed on screen for everyone after them until someone found the reset
    // button. One release, at the first auto-pick after the room goes quiet.
    if (!this.released && Date.now() - this.lastActivity > IDLE_RELEASE_MS) {
      this.released = true
      this.iCenterLon = HOME_LON
      this.iCenterLat = HOME_LAT
      this.iSpan = 1
      this.applyInteractiveView()
      this.emitView()
    }
    const next = this.randomPick(true)
    if (next) this.onSelectChange?.(next)
    // Reset BOTH timers through the single scheduler so they can't accumulate.
    // (Directly re-assigning idleTimer here used to orphan the pending timer when
    // the no-route auto-advance also fired autoPick, stacking timers → the screen
    // flipped between random planes.)
    if (this.noRouteTimer) {
      clearTimeout(this.noRouteTimer)
      this.noRouteTimer = null
    }
    this.startAttractTimer()
    this.onAttractChange?.(true) // now demoing itself → show the touch invite
  }

  /** Operator input resets the attract countdown and hides the touch invite. */
  private resetAttract(): void {
    this.lastActivity = Date.now()
    this.released = false
    this.onAttractChange?.(false)
    this.startAttractTimer()
  }

  /** Any operator activity (incl. the reset button) resets the attract countdown. */
  pokeActivity(): void {
    if (this.interactive) this.resetAttract()
  }

  /**
   * Kept as a no-op so the control's wiring doesn't have to know this went away.
   *
   * This used to jump to another flight ~10s after landing on a route-less one,
   * back when such a plane showed a card that was mostly blank. It now shows a
   * full readout — flight number, level, altitude, speed, type — so cutting the
   * visitor off after ten seconds punished them for tapping the wrong dot.
   */
  autoAdvanceOnNoRoute(_active: boolean): void {
    if (this.noRouteTimer) {
      clearTimeout(this.noRouteTimer)
      this.noRouteTimer = null
    }
  }

  /** Programmatic zoom for the on-screen +/− buttons (factor <1 zooms in). */
  zoomBy(factor: number): void {
    this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.iSpan * factor))
    this.applyInteractiveView()
    this.emitView()
    this.resetAttract()
  }

  /** World coords → client pixels: the inverse of screenToWorld, used to tell
   * the control screen where the selected object is sitting. */
  private emitAnchor(worldX: number, worldY: number): void {
    if (!this.onSelectedAnchor) return
    const r = this.canvas.getBoundingClientRect()
    const { left: L, right: R, top: T, bottom: B } = this.viewRect
    // The world wraps, so the same object can be half a turn out of the rect.
    let wx = worldX
    while (wx < L - 0.5) wx += 1
    while (wx > R + 0.5) wx -= 1
    const toClient = (u: number, y: number) => {
      let x = u
      while (x < L - 0.5) x += 1
      while (x > R + 0.5) x -= 1
      return {
        x: r.left + ((x - L) / (R - L || 1)) * r.width,
        y: r.top + ((T - y) / (T - B || 1)) * r.height
      }
    }
    // Sample the route sparsely — the card only needs to know where the line
    // runs, not to trace it — and always include both ends, which carry the
    // markers, the place names and the flags.
    const avoid: SelectionAnchor['avoid'] = []
    // An orbit is not a route. A flight path is the answer to "where is it
    // going", so a card over it hides the point of tapping; an orbit is a ring
    // round the whole globe that says the same thing everywhere, and treating
    // it as sacred meant no spot on the screen was ever clear and the card fled
    // to a corner. So the orbit is simply not something to avoid.
    const pts = this.kind === 'satellite' ? null : this.routePoints
    if (pts && pts.length) {
      const step = Math.max(1, Math.ceil(pts.length / 40))
      for (let i = 0; i < pts.length; i += step) {
        const q = projectNorm(pts[i].lon, pts[i].lat, this.lonOffset)
        avoid.push(toClient(q.u, 1 - q.v))
      }
      const last = pts[pts.length - 1]
      const q = projectNorm(last.lon, last.lat, this.lonOffset)
      avoid.push(toClient(q.u, 1 - q.v))
    }
    // The place names and flags sit well outside their markers, so sampling the
    // route alone left them uncovered by the check and covered by the card.
    // They are marked hard: a route is long and hiding a little of it is a
    // nuisance, while hiding the destination is the whole answer gone.
    for (const e of this.extraAvoid) {
      const p = toClient(e.u, e.y)
      avoid.push({ ...p, hard: true })
    }
    const c = toClient(worldX, worldY)
    const near = (a: number, b: number) => Math.abs(a - b) < 5e-4
    const parked =
      !this.pendingRecenter &&
      near(this.viewRect.left, this.targetRect.left) &&
      near(this.viewRect.right, this.targetRect.right) &&
      near(this.viewRect.top, this.targetRect.top) &&
      near(this.viewRect.bottom, this.targetRect.bottom) &&
      near(this.lonOffset, this.targetLonOffset) &&
      Math.abs(this.uiScale - this.targetSpan) < 2e-3
    const p: SelectionAnchor = {
      x: c.x,
      y: c.y,
      span: this.targetSpan,
      viewLon: -this.targetLonOffset,
      avoid,
      moving: !parked
    }
    const prev = this.lastAnchor
    // Only when it actually moved: this runs every frame, and a card that
    // re-lays-out sixty times a second jitters.
    if (
      prev &&
      Math.abs(prev.x - p.x) < 3 &&
      Math.abs(prev.y - p.y) < 3 &&
      prev.avoid.length === p.avoid.length &&
      prev.moving === p.moving &&
      Math.abs(prev.viewLon - p.viewLon) < 0.05 &&
      Math.abs(prev.span - p.span) < 0.01
    ) {
      return
    }
    this.lastAnchor = p
    this.onSelectedAnchor(p)
  }

  private clearAnchor(): void {
    if (!this.lastAnchor) return
    this.lastAnchor = null
    this.onSelectedAnchor?.(null)
  }

  /** Screen (client) pixel → world coords in the renderer's [0,1] frame, using
   * the current eased camera rect. Uses the canvas's own rect (the letterboxed
   * 2:1 area), not the parent. Returns world x (= u) / world y (= 1 - v). */
  private screenToWorld(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect()
    const W = r.width || 1
    const H = r.height || 1
    const { left: L, right: R, top: T, bottom: B } = this.viewRect
    const worldX = L + ((clientX - r.left) / W) * (R - L)
    const worldY = T - ((clientY - r.top) / H) * (T - B)
    return { worldX, worldY, W, H, L, R, T, B }
  }

  /** Pick the aircraft nearest the click within a pixel threshold (or null). */
  private selectAt(clientX: number, clientY: number): void {
    const { worldX, worldY, W, H, L, R, T, B } = this.screenToWorld(clientX, clientY)
    const spanX = R - L || 1
    const spanY = T - B || 1
    let best: string | null = null
    // Sized for a child's fingertip on the exhibit's touchscreen, not a mouse
    // pointer: 14px meant a miss unless you hit the dot almost exactly, and the
    // miss reads as "it's broken" rather than "aim better". Nearest-within
    // still applies, so a generous radius costs precision only where the dots
    // are already too dense to aim at individually.
    let bestPx = 34 // pixel threshold (zoom-independent)
    for (const [id, e] of this.eased) {
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      const py = 1 - v
      let du = u - worldX
      if (du > 0.5) du -= 1
      else if (du < -0.5) du += 1
      const dxPx = (du / spanX) * W
      const dyPx = ((py - worldY) / spanY) * H
      const px = Math.hypot(dxPx, dyPx)
      if (px < bestPx) {
        bestPx = px
        best = id
      }
    }
    // A click shows the plane and resets the 30s attract countdown (pointerdown
    // already re-armed it), so the clicked plane holds for 30s and then the
    // auto-cycle resumes with a fresh random pick.
    this.onSelectChange?.(best)
  }

  /**
   * A random object, never the one already selected (so every pick visibly
   * changes something).
   *
   * `preferRouted` splits the two callers by what they are for. The attract
   * cycle is the exhibit demonstrating itself to an empty room, and it should
   * land on something with a journey to show; now that the unidentifiable long
   * tail is visible, roughly half of all aircraft are private flights that have
   * no published route and never will, so an unbiased pick showed an empty map
   * about half the time. Tab is the operator deliberately asking for a
   * different aircraft, so it stays completely unbiased — as does clicking,
   * which never went through here at all.
   */
  private randomPick(preferRouted: boolean): string | null {
    const all = [...this.eased.keys()]
    if (!all.length) return null
    // Best: something mid-story. Next: anything with a route at all. Last:
    // whatever is up there.
    const story = preferRouted ? all.filter((id) => this.story.has(id)) : []
    const routed = preferRouted && !story.length ? all.filter((id) => this.routed.has(id)) : []
    const ids = story.length ? story : routed.length ? routed : all
    if (ids.length === 1) return ids[0]
    let id = ids[Math.floor(Math.random() * ids.length)]
    while (id === this.selected) id = ids[Math.floor(Math.random() * ids.length)]
    return id
  }

  /** Attach drag-pan / wheel-zoom / click-select handlers (interactive mode). */
  private attachInput(): void {
    const canvas = this.canvas
    canvas.style.cursor = 'grab'
    const onDown = (ev: PointerEvent) => {
      this.resetAttract() // operator is here — postpone the auto-demo
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      canvas.setPointerCapture?.(ev.pointerId)
      if (this.pointers.size >= 2) {
        // Two fingers → pinch-zoom; record the initial finger distance + span.
        const [a, b] = [...this.pointers.values()]
        this.pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.pinchStartSpan = this.iSpan
        this.dragging = false
      } else {
        this.dragging = true
        this.movedDuringDrag = false
        this.lastPX = ev.clientX
        this.lastPY = ev.clientY
        canvas.style.cursor = 'grabbing'
      }
    }
    const onMove = (ev: PointerEvent) => {
      const p = this.pointers.get(ev.pointerId)
      if (p) {
        p.x = ev.clientX
        p.y = ev.clientY
      }
      if (this.pointers.size >= 2) {
        // Pinch: span scales with the inverse of the finger-distance change.
        const [a, b] = [...this.pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
        this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.pinchStartSpan * (this.pinchStartDist / dist)))
        this.movedDuringDrag = true
        this.applyInteractiveView()
        this.emitView()
        return
      }
      if (!this.dragging) return
      const r = canvas.getBoundingClientRect()
      const W = r.width || 1
      const H = r.height || 1
      const spanX = this.viewRect.right - this.viewRect.left
      const spanY = this.viewRect.top - this.viewRect.bottom
      const dx = ev.clientX - this.lastPX
      const dy = ev.clientY - this.lastPY
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        this.movedDuringDrag = true
      }
      // Horizontal: keep the grabbed point under the cursor → centerLon shifts opposite.
      const du = (dx / W) * spanX
      this.iCenterLon = wrapLon(this.iCenterLon - 360 * du)
      // Vertical: dragging content down reveals the north → center latitude rises.
      const dv = (dy / H) * spanY
      this.iCenterLat += dv * 180
      this.lastPX = ev.clientX
      this.lastPY = ev.clientY
      this.applyInteractiveView()
      this.emitView()
    }
    const onUp = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId)
      canvas.releasePointerCapture?.(ev.pointerId)
      if (this.pointers.size === 1) {
        // One finger remains after a pinch → resume single-finger drag from it.
        const [only] = [...this.pointers.values()]
        this.lastPX = only.x
        this.lastPY = only.y
        this.dragging = true
        this.movedDuringDrag = true // not a tap
        return
      }
      if (this.pointers.size === 0) {
        if (this.dragging && !this.movedDuringDrag) this.selectAt(ev.clientX, ev.clientY)
        this.dragging = false
        canvas.style.cursor = 'grab'
        this.emitView()
      }
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      this.resetAttract() // operator is here — postpone the auto-demo
      this.iSpan = Math.max(MIN_SPAN, Math.min(1, this.iSpan * Math.exp(ev.deltaY * 0.0015)))
      this.applyInteractiveView()
      this.emitView()
    }
    // Arrow keys pan the map (left/right spins the globe, up/down tilts);
    // Tab / Shift+Tab step through the planes. Both are manual input, so they
    // reset the attract countdown.
    const onKey = (ev: KeyboardEvent) => {
      const panX = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0
      const panY = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0
      if (panX || panY) {
        ev.preventDefault()
        this.resetAttract() // operator is here — postpone the auto-demo
        // Step proportionally to the zoom so one press moves the same fraction
        // of the screen however far in the operator is.
        const s = Math.max(MIN_SPAN, Math.min(1, this.iSpan))
        if (panX) this.iCenterLon = wrapLon(this.iCenterLon + panX * 20 * s)
        if (panY) this.iCenterLat += panY * 10 * s
        this.applyInteractiveView() // clamps latitude to keep the view on the map
        this.emitView()
        return
      }
      if (ev.key !== 'Tab') return
      ev.preventDefault()
      // Jump to a random flight. Stepping in feed order was effectively a fixed
      // sequence — it ignored the view and replayed the same run every time.
      const next = this.randomPick(false)
      if (!next) return
      this.resetAttract()
      this.onSelectChange?.(next)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    this.inputCleanup = () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey)
      this.pointers.clear()
    }
  }

  /** Emit the current interactive view to the hub, throttled (~100ms) with a
   * trailing flush so a continuous drag/zoom doesn't flood the broadcast. */
  private emitView(): void {
    const cb = this.onViewChange
    if (!cb) return
    const fire = () =>
      cb({
        centerLon: wrapLon(this.iCenterLon),
        centerLat: this.iCenterLat,
        span: Math.max(0.02, Math.min(1, this.iSpan))
      })
    const now = performance.now()
    const wait = 100 - (now - this.lastViewEmit)
    if (wait <= 0) {
      this.lastViewEmit = now
      if (this.viewEmitTimer) {
        clearTimeout(this.viewEmitTimer)
        this.viewEmitTimer = null
      }
      fire()
    } else if (!this.viewEmitTimer) {
      this.viewEmitTimer = setTimeout(() => {
        this.lastViewEmit = performance.now()
        this.viewEmitTimer = null
        fire()
      }, wait)
    }
  }

  setOverlays(overlays: Record<OverlayKey, boolean>): void {
    // Day/night is always on. Grid only when there's no photographic earth
    // (a photo carries its own graticule — avoid doubling).
    this.bgUniforms.uShowGrid.value = !this.hasEarthTexture && overlays.grid ? 1 : 0
  }

  setSelected(icao24: string | null): void {
    if (icao24 !== this.selected) {
      // Selection changed → drop the previous route/markers/labels/flags right
      // away so nothing from the old plane lingers (or gets drawn through the new
      // plane) while the new detail is fetched.
      this.routePoints = null
      this.lastRouteOffset = NaN
      this.disposeRouteGroup()
      for (const m of [
        this.originMarker,
        this.destMarker,
        this.originLabel,
        this.destLabel,
        this.originFlag,
        this.destFlag
      ]) {
        m.visible = false
      }
    }
    this.selected = icao24
    this.selectedPlane.visible = false
    this.selectedGlow.visible = false
    this.selectedLights.visible = false
    if (icao24) {
      // Request a one-shot camera align on the plane — done in frame() the moment
      // the selected plane is rendered, so it works with OR without a route and
      // never misses (route timing / off-route drops no longer matter).
      this.pendingRecenter = true
    } else {
      // Deselected → release the spin back to the control's pan.
      this.routeCenterLon = null
      this.pendingRecenter = false
      if (!this.interactive) this.applyViewTarget()
    }
  }

  /** Center the camera once on the selected plane (called from frame() when it is
   * first rendered). Works for routed and route-less planes alike. */
  private recenterOnPlane(lon: number, lat: number): void {
    if (this.interactive) {
      this.iCenterLon = lon
      this.iCenterLat = lat
      // A moderate span (not full zoom-out): at span 1 the vertical center is
      // pinned to the equator, so a plane away from lat 0 could never actually
      // be centered — that was the "centering sometimes fails" bug. Zooming in a
      // little gives room to center the plane vertically as well as horizontally.
      this.iSpan = Math.min(this.iSpan, 0.6)
      this.applyInteractiveView()
      this.emitView()
    } else {
      this.routeCenterLon = lon
      this.applyViewTarget()
    }
    this.pendingRecenter = false
  }

  /** Update aircraft targets; new ids appear, missing ids fade out (removed). */
  setAircraft(list: Aircraft[]): void {
    const seen = new Set<string>()
    for (const a of list) {
      // The feeds already drop these, but the renderer is where a bad
      // coordinate becomes a visible phantom, so it checks for itself.
      if (!isPlausibleCoord(a.lon, a.lat)) continue
      seen.add(a.icao24)
      const color = categoryColor(categoryKey(a.callsign, null, a.hasRoute))
      const h = ((a.heading ?? 0) * Math.PI) / 180
      const speed = a.onGround ? 0 : a.velocity ?? 0
      const cur = this.eased.get(a.icao24)
      if (cur) {
        cur.tLon = a.lon
        cur.tLat = a.lat
        cur.tHeading = h
        cur.speed = speed
        cur.color = color
      } else {
        this.eased.set(a.icao24, {
          lon: a.lon,
          lat: a.lat,
          heading: h,
          speed,
          tLon: a.lon,
          tLat: a.lat,
          tHeading: h,
          color
        })
        this.order.push(a.icao24)
      }
    }
    this.routed.clear()
    this.story.clear()
    for (const a of list) {
      if (!a.hasRoute) continue
      this.routed.add(a.icao24)
      // Below the cruise levels and still moving: just off a runway or on the
      // way down to one. "That one took off a few minutes ago" is a story; an
      // anonymous dot at 11 km over Siberia, three hours from anywhere, is not.
      if (!a.onGround && a.altitude != null && a.altitude < STORY_ALT_M) {
        this.story.add(a.icao24)
      }
    }
    // Drop aircraft no longer reported.
    for (const id of [...this.eased.keys()]) {
      if (!seen.has(id)) {
        this.eased.delete(id)
      }
    }
    this.order = this.order.filter((id) => this.eased.has(id))
  }

  /**
   * Satellites, written into the same eased/order structures aircraft use — the
   * renderer only ever needed position, heading, speed and colour, and a
   * satellite supplies all four. Selection, zoom, day/night and dead reckoning
   * therefore work unchanged; only the colour scale and the units differ.
   */
  setSatellites(list: Satellite[]): void {
    const seen = new Set<string>()
    for (const s of list) {
      if (!isPlausibleCoord(s.lon, s.lat)) continue
      seen.add(s.id)
      const color = orbitColor(s.orbit)
      const h = (s.heading * Math.PI) / 180
      const speed = s.speedKmS * 1000 // km/s → m/s, the unit dead reckoning uses
      const cur = this.eased.get(s.id)
      if (cur) {
        cur.tLon = s.lon
        cur.tLat = s.lat
        cur.tHeading = h
        cur.speed = speed
        cur.color = color
      } else {
        this.eased.set(s.id, {
          lon: s.lon,
          lat: s.lat,
          heading: h,
          speed,
          tLon: s.lon,
          tLat: s.lat,
          tHeading: h,
          color
        })
        this.order.push(s.id)
      }
    }
    // Every satellite has an orbit, so the attract cycle has no reason to prefer.
    this.routed.clear()
    this.story.clear()
    for (const s of list) this.routed.add(s.id)
    for (const id of [...this.eased.keys()]) if (!seen.has(id)) this.eased.delete(id)
    this.order = this.order.filter((id) => this.eased.has(id))
  }

  /**
   * Switch what the renderer is drawing. Swaps the instance and selection
   * textures, and gates the aircraft-only furniture (endpoint markers, place
   * names, flags, flown/remaining split) that makes no sense for an orbit.
   */
  setObjectKind(kind: 'aircraft' | 'satellite'): void {
    if (kind === this.kind) return
    this.kind = kind
    const inst = this.planes.material as THREE.MeshBasicMaterial
    const selMat = this.selectedPlane.material as THREE.MeshBasicMaterial
    inst.map = kind === 'satellite' ? this.dotTex : this.planeTex
    // A dot has no silhouette to clip, and alphaTest would eat its soft edge.
    inst.alphaTest = kind === 'satellite' ? 0 : 0.35
    inst.needsUpdate = true
    selMat.map = kind === 'satellite' ? this.satTex : this.planeTex
    selMat.needsUpdate = true
    ;(this.selectedGlow.material as THREE.MeshBasicMaterial).color.set(GLOW_COLOR[kind])
    // An aircraft's lights are out on the wingtips, a satellite's beacon is on
    // its nose — nowhere near each other in icon space, so each kind gets its
    // own texture rather than one shared set of spots.
    const litMat = this.selectedLights.material as THREE.MeshBasicMaterial
    litMat.map = kind === 'satellite' ? this.satLightTex : this.planeLightTex
    litMat.needsUpdate = true
    if (kind === 'satellite') {
      for (const m of [
        this.originMarker,
        this.destMarker,
        this.originLabel,
        this.destLabel,
        this.originFlag,
        this.destFlag
      ]) {
        m.visible = false
      }
    }
  }

  /** Drop every tracked object — used when switching layers so the old one
   * doesn't linger while the new one's first snapshot is in flight. */
  clearObjects(): void {
    this.eased.clear()
    this.routed.clear()
    this.story.clear()
    this.order = []
    this.selected = null
    this.selectedPlane.visible = false
    this.selectedGlow.visible = false
    this.selectedLights.visible = false
    // And the route with them. The hub sends a route:null on the switch, but it
    // arrives on its own schedule, and until it did an aircraft's flight path
    // hung over the satellite map with no aircraft under it. Dropping it here
    // makes the switch atomic from the renderer's side.
    this.routePoints = null
    this.lastRouteIdx = -1
    this.lastRouteOffset = NaN
    this.routeCenterLon = null
    this.disposeRouteGroup()
    for (const m of [
      this.originMarker,
      this.destMarker,
      this.originLabel,
      this.destLabel,
      this.originFlag,
      this.destFlag,
      this.infoLabel
    ]) {
      m.visible = false
    }
  }

  /** Set origin/destination place-name labels (null clears them). */
  setEndpointLabels(originCity: string | null, destCity: string | null): void {
    const apply = (mesh: THREE.Mesh, text: string | null) => {
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.map?.dispose()
      if (text) {
        const { tex, aspect } = textTexture(text)
        mat.map = this.tuneSprite(tex)
        mat.needsUpdate = true
        mesh.userData.aspect = aspect
        mesh.visible = true
      } else {
        mat.map = null
        mesh.visible = false
      }
    }
    apply(this.originLabel, originCity)
    apply(this.destLabel, destCity)
  }

  /** Country flags above the origin/destination markers (ISO2 code, or null). */
  setEndpointFlags(originCode: string | null, destCode: string | null): void {
    const set = (mesh: THREE.Mesh, code: string | null) => {
      if (code) {
        this.loadFlag(code, mesh)
      } else {
        ;(mesh.material as THREE.MeshBasicMaterial).map = null
        mesh.visible = false
      }
    }
    set(this.originFlag, originCode)
    set(this.destFlag, destCode)
  }

  /** Load a flag SVG (public/flags/<code>.svg) into a canvas texture (cached). */
  private loadFlag(code: string, mesh: THREE.Mesh): void {
    const apply = (tex: THREE.CanvasTexture, aspect: number) => {
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.map = tex
      mat.needsUpdate = true
      mesh.userData.aspect = aspect
    }
    const cached = this.flagCache.get(code)
    if (cached) {
      apply(cached.tex, cached.aspect)
      return
    }
    const img = new Image()
    img.onload = () => {
      const w = 128
      const h = 96
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 5
      ctx.strokeRect(2.5, 2.5, w - 5, h - 5)
      const tex = this.tuneSprite(new THREE.CanvasTexture(c))
      const entry = { tex, aspect: w / h }
      this.flagCache.set(code, entry)
      apply(tex, entry.aspect)
    }
    img.onerror = () => {
      /* no flag for this country — leave the mesh hidden */
    }
    img.src = `flags/${code}.svg`
  }

  /** The plate the dome carries: what the object is, and how long until it
   * lands or passes overhead. All-empty clears it. */
  setCallout(title: string, prefix: string, value: string, suffix: string, compact = false): void {
    const mat = this.infoLabel.material as THREE.MeshBasicMaterial
    mat.map?.dispose()
    if (title || prefix || value || suffix) {
      const { tex, aspect, screenH } = calloutTexture(title, prefix, value, suffix, compact)
      mat.map = this.tuneSprite(tex)
      mat.needsUpdate = true
      this.infoLabel.userData.aspect = aspect
      this.infoLabel.userData.screenH = screenH
    } else {
      mat.map = null
      this.infoLabel.visible = false
    }
  }

  /** Free the route lines' GPU geometries before clearing (they are rebuilt on
   * pan/progress; without disposal the buffers leak over a long session). */
  private disposeRouteGroup(): void {
    for (const child of this.routeGroup.children) {
      const line = child as Line2
      line.geometry?.dispose()
    }
    this.routeGroup.clear()
  }

  setRoute(points: GeoPoint[] | null): void {
    const next = points && points.length >= 2 ? points : null
    // The hub re-sends the route every snapshot to keep ETA/progress fresh. Skip
    // the rebuild + re-center when the endpoints are unchanged — only a new
    // selection or a re-route actually changes the line. Rebuilding every few
    // seconds would flicker the line and jitter the camera.
    const cur = this.routePoints
    const same =
      !!next &&
      !!cur &&
      next[0].lon === cur[0].lon &&
      next[0].lat === cur[0].lat &&
      next[next.length - 1].lon === cur[cur.length - 1].lon &&
      next[next.length - 1].lat === cur[cur.length - 1].lat
    if (same) return

    this.routePoints = next
    this.lastRouteIdx = -1
    this.lastRouteOffset = NaN // force a rebuild next frame
    this.disposeRouteGroup()
    const on = !!this.routePoints
    this.originMarker.visible = on
    this.destMarker.visible = on
    // Camera alignment on selection is handled in frame() (recenterOnPlane), so it
    // works with or without a route and can't miss due to route timing.
  }

  /** Add fat (Line2) segments for a polyline, split at the actual display seam.
   * The seam (where projected u wraps 0↔1) depends on the pan offset, NOT on
   * geographic ±180, so we project first and cut where u jumps — otherwise the
   * line breaks mid-screen whenever the map is panned off the prime meridian. */
  private addRouteLines(points: GeoPoint[], mat: LineMaterial, z = 0.2): void {
    let positions: number[] = []
    let prevU = NaN
    const flush = () => {
      if (positions.length >= 6) {
        const geo = new LineGeometry()
        geo.setPositions(positions)
        const line = new Line2(geo, mat)
        line.frustumCulled = false
        this.routeGroup.add(line)
      }
      positions = []
    }
    for (const p of points) {
      const { u, v } = projectNorm(p.lon, p.lat, this.lonOffset)
      if (!Number.isNaN(prevU) && Math.abs(u - prevU) > 0.5) flush() // wrapped the seam
      positions.push(u, 1 - v, z)
      prevU = u
    }
    flush()
  }

  /** Rebuild the route split at `idx`: flown (origin→now) red, remaining faint.
   * Orbits skip the split and draw as a single line. */
  private buildRoute(idx: number): void {
    this.disposeRouteGroup()
    const pts = this.routePoints
    if (!pts) return
    if (this.kind === 'satellite') {
      if (pts.length >= 2) {
        this.addRouteLines(pts, this.orbitCasingMat, 0.18)
        this.addRouteLines(pts, this.orbitMat, 0.22)
      }
      return
    }
    const remaining = pts.slice(idx)
    const flown = pts.slice(0, idx + 1)
    if (pts.length >= 2) this.addRouteLines(pts, this.routeCasingMat, 0.18)
    if (remaining.length >= 2) this.addRouteLines(remaining, this.remainMat, 0.2)
    if (flown.length >= 2) this.addRouteLines(flown, this.flownMat, 0.22)
  }

  /**
   * Assemble one weather frame into a texture.
   *
   * The tiles are a Mercator grid; they are drawn into one canvas here and the
   * fragment shader does the remap onto the equirectangular frame. The texture
   * is only swapped in once every tile has decoded, so the map never shows a
   * half-built picture — and the previous frame stays up until then, which is
   * also what happens when a poll fails.
   */
  private buildWeatherTexture(frame: WeatherFrame): Promise<THREE.Texture | null> {
    const n = 1 << frame.z
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    let drawn = 0
    let side = 0
    const patches = frame.tiles.filter((t) => t.bbox && t.centerLon != null)

    const finishTexture = (): THREE.Texture | null => {
      const tex = new THREE.CanvasTexture(canvas)
      this.tuneTexture(tex)
      /*
       * No mipmaps on a weather texture. Two reasons, and neither applies to
       * the earth map underneath, which keeps its pyramid.
       *
       * For a data tile the pyramid is meaningless: the value is packed
       * big-endian across channels, and the average of two high bytes is not
       * the high byte of the average.
       *
       * For the cloud it is about the seam. This texture wraps in longitude,
       * and choosing a mip level is the one part of sampling that has to agree
       * across that wrap. The pyramid was buying almost nothing anyway: a
       * 2048-wide texture on a 1664-wide frame is barely minified even at full
       * world view.
       */
      tex.generateMipmaps = false
      tex.minFilter = THREE.LinearFilter
      // Hand the assembled mosaic back once per layer per run, when asked. A
      // 2048-wide PNG is a couple of megabytes and the point is to look at it
      // in an image viewer, not to stream it.
      const key = `${frame.layer}-${frame.blend ?? 'plain'}`
      if (this.onDebugImage && !this.debugDumped.has(key)) {
        this.debugDumped.add(key)
        try {
          this.onDebugImage(key, canvas.toDataURL('image/png'))
        } catch {
          /* a tainted canvas would throw; the dump is not worth a crash */
        }
      }
      return tex
    }

    /*
     * Merge the sensors by WEIGHTED AVERAGE, not by painting one over another.
     *
     * Five geostationary discs overlap, and every previous attempt drew them in
     * turn with a soft edge and hoped the joins would disappear. They never
     * could. Paint-over gives whichever disc was drawn last, so two sensors at
     * full strength meet in a hard edge; soften them both and the total opacity
     * dips in the overlap instead, which is a band rather than a line; fade
     * them out where their data is cut and the band becomes a gap. Each fix
     * traded one artefact for another because the operation was wrong.
     *
     * The right operation is an average weighted by how well each sensor sees
     * that point: sum(weight x colour) / sum(weight). Where two discs overlap
     * it is a true crossfade; where only one reaches — the far side of the
     * antimeridian, say — its weight is the only weight, so it gets full say
     * and there is no gap and nothing to taper. The seams are not hidden, they
     * stop existing.
     */
    const mergePatches = (imgs: Map<number, HTMLImageElement>): void => {
      const W = canvas.width
      const H = canvas.height
      // One number per pixel: how much cloud. The colour of the source is not
      // information anybody wants on the globe, only its opacity.
      const acc = new Float32Array(W * H)
      const wacc = new Float32Array(W * H)
      const RAD = Math.PI / 180
      // Full weight within 25 degrees of the sub-satellite point, tailing to
      // nothing by 78 — a real disc runs out at about 81, and stopping short
      // of that drops the noisy limb. The exact numbers matter far less now:
      // the normalisation is what makes the joins invisible, the falloff only
      // decides which sensor's word carries more where they disagree.
      const NEAR = Math.cos(25 * RAD)
      const FAR = Math.cos(78 * RAD)

      /*
       * Pull the cloud out HERE, per sensor, and put every sensor on the same
       * scale before merging.
       *
       * Two facts made the join at 180 degrees visible no matter how the
       * pixels were blended. These layers are not one product: GOES and
       * Himawari come back with a temperature palette laid over grey, the
       * Meteosats come back as plain greyscale, and "how bright is cloud"
       * means something different in each. And at the antimeridian only ONE
       * sensor has data on each side, because the others are published clipped
       * there — so normalising the weights cannot help, since each side is
       * already the only opinion going and gets full say.
       *
       * So each patch is reduced to a single number per pixel — how much cloud
       * — and then stretched onto a common scale using its OWN distribution:
       * its median becomes clear sky and its 98th percentile becomes solid
       * cloud. Two sensors looking at the same weather now agree on what to
       * call it, and the seam has nothing left to be a seam about.
       */
      const cloudness = (r: number, g: number, b: number): number => {
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        // Colour means colder, which means higher cloud, not less of it.
        const sat = mx > 1 ? (mx - mn) / mx : 0
        return Math.max(lum, sat * 0.85)
      }

      /** Sensors whose picture carried no usable contrast this frame. */
      const flat: number[] = []
      for (const [i, t] of patches.entries()) {
        const img = imgs.get(i)
        if (!img) continue
        const [west, south, east, north] = t.bbox as [number, number, number, number]
        const centerLon = t.centerLon as number
        // Resample the patch to its footprint on the world canvas once, then
        // read it as numbers. Whole pixels: the wrapped copy has to land on the
        // same sub-pixel phase as the unwrapped one or they disagree at 180.
        const px = (lon: number): number => Math.round(((lon + 180) / 360) * W)
        const py = (lat: number): number => Math.round(((90 - lat) / 180) * H)
        const x0 = px(west)
        const y0 = py(north)
        const pw = px(east) - x0
        const ph = py(south) - y0
        if (pw <= 0 || ph <= 0) continue
        const tmp = document.createElement('canvas')
        tmp.width = pw
        tmp.height = ph
        const tctx = tmp.getContext('2d')!
        tctx.drawImage(img, 0, 0, pw, ph)
        const src = tctx.getImageData(0, 0, pw, ph).data

        // This sensor's own distribution, from a coarse sample of its valid
        // pixels — enough for two percentiles and far cheaper than all of them.
        const hist = new Int32Array(64)
        let counted = 0
        for (let k = 0; k < pw * ph; k += 7) {
          const o = k * 4
          if (!src[o + 3]) continue
          hist[Math.min(63, (cloudness(src[o], src[o + 1], src[o + 2]) * 64) | 0)]++
          counted++
        }
        if (!counted) continue
        const at = (frac: number): number => {
          let seen = 0
          for (let bin = 0; bin < 64; bin++) {
            seen += hist[bin]
            if (seen >= counted * frac) return (bin + 0.5) / 64
          }
          return 1
        }
        const lo = at(0.5) // half of what a satellite sees is not cloud
        const spread = at(0.98) - lo
        /*
         * A patch with no contrast is not cloud, and stretching it is what drew
         * the pale rectangle over the north Pacific.
         *
         * The stretch divides by (p98 - median), and the floor under that
         * divisor used to be a fiftieth. So an image that is nearly all one
         * value — a half-finished scan, or an archive answering a timestamp it
         * does not hold with a flat wash — had its remaining two percent of
         * variation blown up to the full range, and landed on the globe as a
         * bright rectangle of the patch's own bounding box. The normalisation
         * that makes five sensors agree was manufacturing the artefact.
         *
         * Sixty-four bins put the quantisation at about 0.016, so four bins of
         * spread is the least a real cloud field can show. Below that there is
         * nothing to normalise and the patch is dropped: a gap where one sensor
         * is missing is honest, and its neighbours already overlap it.
         */
        if (spread < 0.06) {
          flat.push(centerLon)
          continue
        }
        const hi = lo + spread

        for (let j = 0; j < ph; j++) {
          const y = y0 + j
          if (y < 0 || y >= H) continue
          const lat = (90 - ((y + 0.5) / H) * 180) * RAD
          const cosLat = Math.cos(lat)
          for (let i2 = 0; i2 < pw; i2++) {
            const o = (j * pw + i2) * 4
            const a = src[o + 3]
            if (!a) continue // outside the disc: the sensor has no opinion here
            const xw = x0 + i2
            // The world wraps, so a patch that runs off one edge comes back on
            // the other. Modulo, rather than drawing the picture three times.
            const x = ((xw % W) + W) % W
            const lonDeg = -180 + ((x + 0.5) / W) * 360
            const cosD = cosLat * Math.cos((lonDeg - centerLon) * RAD)
            let w = (cosD - FAR) / (NEAR - FAR)
            if (w <= 0) continue
            if (w > 1) w = 1
            w = w * w * (3 - 2 * w) * (a / 255)
            let c = (cloudness(src[o], src[o + 1], src[o + 2]) - lo) / (hi - lo)
            c = c < 0 ? 0 : c > 1 ? 1 : c
            const k = y * W + x
            wacc[k] += w
            acc[k] += c * w
          }
        }
      }

      if (flat.length) {
        this.onNote?.(
          `[weather] cloud: dropped ${flat.length} flat-wash sensor picture(s) at ` +
            `${flat.join(', ')} deg (no contrast to normalise)`
        )
      }

      const out = ctx.createImageData(W, H)
      for (let k = 0; k < W * H; k++) {
        const w = wacc[k]
        if (w <= 0) continue
        const o = k * 4
        // Red carries the answer; the shader reads that one channel and paints
        // its own white. Green and blue carry it too so the texture still
        // looks like what it is if anyone dumps it.
        const c = Math.round(255 * Math.min(1, acc[k] / w))
        out.data[o] = c
        out.data[o + 1] = c
        out.data[o + 2] = c
        // Total weight IS the coverage: one sensor at half strength on its own
        // limb fades out, two at half strength together do not.
        out.data[o + 3] = Math.round(255 * Math.min(1, w))
      }
      ctx.putImageData(out, 0, 0)
    }

    return new Promise((resolve) => {
      // --- The geostationary mosaic: decode every patch, then merge them all.
      if (patches.length) {
        const imgs = new Map<number, HTMLImageElement>()
        let seen = 0
        const done = (): void => {
          if (++seen < patches.length) return
          if (!imgs.size) return resolve(null)
          const first = imgs.values().next().value as HTMLImageElement
          const firstIdx = [...imgs.keys()][0]
          const bb = patches[firstIdx].bbox as [number, number, number, number]
          // A patch covers only its own corner of the world, so the canvas is
          // sized from its pixels-per-degree. A power of two, because this
          // texture wraps and a wrapping NPOT texture is the one case where
          // mipmapping and REPEAT need not agree.
          const ppd = (first.width || 256) / Math.max(1, bb[2] - bb[0])
          const pot = 2 ** Math.round(Math.log2(Math.min(8192, 360 * ppd)))
          canvas.width = pot
          canvas.height = pot / 2
          mergePatches(imgs)
          resolve(finishTexture())
        }
        for (const [i, t] of patches.entries()) {
          const img = new Image()
          img.onload = () => {
            imgs.set(i, img)
            done()
          }
          img.onerror = () => done()
          img.src = t.url
        }
        return
      }

      // --- A tile grid, or one seamless image covering a stated box.
      const finish = (): void => {
        if (!side) return resolve(null)
        resolve(finishTexture())
      }
      for (const t of frame.tiles) {
        const img = new Image()
        img.onload = () => {
          if (!side) {
            side = img.width || 256
            if (t.bbox) {
              // One picture over a known box — a global product, which needs a
              // 2:1 world around it rather than a square of its own size.
              const ppd = side / Math.max(1, t.bbox[2] - t.bbox[0])
              const pot = 2 ** Math.round(Math.log2(Math.min(8192, 360 * ppd)))
              canvas.width = pot
              canvas.height = pot / 2
            } else {
              canvas.width = canvas.height = side * n
            }
          }
          if (t.bbox) {
            const [west, south, east, north] = t.bbox
            const px = (lon: number): number => Math.round(((lon + 180) / 360) * canvas.width)
            const py = (lat: number): number => Math.round(((90 - lat) / 180) * canvas.height)
            ctx.drawImage(img, px(west), py(north), px(east) - px(west), py(south) - py(north))
            if (++drawn === frame.tiles.length) finish()
            return
          }
          ctx.drawImage(img, t.x * side, t.y * side, side, side)
          if (++drawn === frame.tiles.length) finish()
        }
        img.onerror = () => {
          if (++drawn === frame.tiles.length) finish()
        }
        img.src = t.url
      }
    })
  }

  /**
   * Put one layer's whole animation series on the globe.
   *
   * Every step is decoded into its own texture and the set is swapped in as a
   * unit, so the map never shows a half-built picture and the previous series
   * stays up until the new one is complete — which is also what happens when a
   * poll fails. The walk through the series happens per render frame in
   * `tickWeather`, not here.
   */
  setWeatherSeries(frames: WeatherFrame[] | null, layer: WeatherLayer): void {
    const slot = this.wx[layer]
    const token = ++slot.token
    const usable = (frames ?? []).filter((f) => f && f.tiles.length)
    // Measure this series once, on whichever of its frames finishes first.
    if (!usable.length) {
      for (const t of slot.byTime?.values() ?? []) t.dispose()
      slot.byTime?.clear()
      slot.textures = []
      this.bgUniforms[layer === 'cloud' ? 'uHasCloud' : 'uHasRain'].value = 0
      this.bgUniforms[layer === 'cloud' ? 'uCloud' : 'uRain'].value = null
      this.bgUniforms[layer === 'cloud' ? 'uCloudB' : 'uRainB'].value = null
      return
    }
    /*
     * Decode each MOMENT once, not each arrival.
     *
     * The hub sends a series a frame at a time, and this rebuilt every step of
     * it on every one of those messages: four frames arriving meant ten full
     * mosaics decoded and thrown away, each one a 2048x1024 canvas with five
     * satellite images resampled into it. That is the stutter — the picture
     * freezes while the same pictures are built again. The log made it visible
     * before the eye did: the same step measured three times in a row.
     *
     * A texture is keyed by the moment it shows, so a rebuild costs only the
     * step that is genuinely new.
     */
    const wanted = new Set(usable.map((f) => `${f.time}`))
    void Promise.all(
      usable.map((f) => {
        const have = slot.byTime?.get(f.time)
        if (have) return Promise.resolve(have)
        return this.buildWeatherTexture(f).then((t) => {
          if (t) (slot.byTime ??= new Map()).set(f.time, t)
          return t
        })
      })
    ).then((built) => {
      // A newer series started while this one was decoding: throw this away.
      if (token !== slot.token) return
      /*
       * Fill a refused step with its nearest good neighbour rather than
       * dropping it. Playback is off the wall clock, so a three-step loop
       * beside a four-step one drifts out of phase within a minute — the
       * length is what keeps the two layers on the same moment.
       */
      for (let i = 0; i < built.length; i++) {
        if (built[i]) continue
        for (let d = 1; d < built.length && !built[i]; d++) {
          built[i] = built[i - d] ?? built[i + d] ?? null
        }
      }
      const textures = built.filter((t): t is THREE.Texture => !!t)
      if (textures.length !== built.length || !textures.length) return
      // Anything no longer in the loop is GPU memory nobody is looking at.
      for (const [time, tex] of slot.byTime ?? []) {
        if (!wanted.has(`${time}`)) {
          tex.dispose()
          slot.byTime?.delete(time)
        }
      }
      slot.textures = textures
      const head = usable[0]
      const isData = head.blend === 'data'
      if (layer === 'cloud') {
        this.bgUniforms.uHasCloud.value = 1
        this.bgUniforms.uCloudMerc.value = head.projection === 'mercator' ? 1 : 0
        this.bgUniforms.uCloudPhoto.value = head.blend === 'photo' ? 1 : 0
        this.bgUniforms.uCloudData.value = isData ? 1 : 0
      } else {
        this.bgUniforms.uHasRain.value = 1
        this.bgUniforms.uRainMerc.value = head.projection === 'mercator' ? 1 : 0
        this.bgUniforms.uRainData.value = isData ? 1 : 0
      }
      /*
       * Print both layers' timelines whenever either changes.
       *
       * Whether the two are on the same clock is a fact about two lists of
       * numbers, and until now the only way to judge it was to look at the
       * globe and argue. If the steps line up here and the picture still looks
       * wrong, the clock is not the problem and the remaining difference is
       * the one that cannot be fixed by timing: a model's opinion against a
       * camera's photograph.
       */
      this.wxTimes[layer] = usable.map((f) => f.time)
      const hm = (t: number): string => new Date(t).toISOString().slice(11, 16)
      const c = this.wxTimes.cloud
      const r = this.wxTimes.rain
      // Only once a series is all here. The hub sends frames one at a time, so
      // a partial series compared against a complete one reads as out of sync
      // for a second or two — three false alarms per poll, and the true "IN
      // SYNC" at the end was the easiest line to miss.
      const whole = usable.length >= (head.steps ?? usable.length)
      // Measure the finished picture a few seconds after the last series
      // lands, once per poll.
      if (whole && c.length && r.length) {
        const same = c.length === r.length && c.every((t, i) => Math.abs(t - r[i]) <= 600_000)
        this.onNote?.(
          `[weather] clocks: cloud [${c.map(hm).join(' ')}] rain [${r.map(hm).join(' ')}] ` +
            `-> ${same ? 'IN SYNC' : 'NOT IN SYNC'}`
        )
      }
      this.tickWeather()
    })
  }

  /**
   * Find the straight edges in a composed cloud texture and say where they are.
   *
   * A bright band with hard horizontal sides keeps coming back, and it has now
   * been "fixed" three times from the shape of a screenshot alone. Weather has
   * no straight edges, so whatever draws one is machinery — but which piece of
   * machinery is decided entirely by WHERE the edge falls, and a photograph of
   * a screen cannot be measured. Each candidate leaves a different fingerprint:
   *
   *   ±85.05, ±66.51, ±40.98, ±21.94, 0°   a Mercator tile row at zoom 3
   *   ±80°                                 a geostationary patch's bounding box
   *   ±180, ±135, ±90, ±45, 0°             a tile column, either way
   *
   * So the renderer measures its own output — mean absolute difference between
   * neighbouring rows, then columns, against the median row — and prints the
   * outliers in degrees. One log line then names the culprit instead of a
   * fourth guess. The reference boundaries are printed alongside so the match
   * can be read directly rather than worked out.
   */
  /**
   * The same measurement, applied to a loaded map image.
   *
   * The weather textures came back clean on every step, so whatever draws the
   * band is underneath them — and the base map is the one thing on screen in
   * all three modes, which matches the report that the line is there with the
   * planes and the satellites too. A truncated or part-decoded image file
   * shows exactly this: flat rows with a hard boundary where the decode
   * stopped. Sampled down to 2048 wide, which keeps a band and costs a
   * hundredth of the memory of an 8k source.
   */
  /**
   * Walk each layer through its series.
   *
   * One step is held for WEATHER_FRAME_HOLD_MS and the last third of that is a
   * cross-fade into the next, so the weather drifts rather than cutting. Both
   * windows drive this off the same wall clock, so the dome and the control
   * screen show the same moment without a byte of hub traffic.
   */
  private tickWeather(): void {
    for (const layer of ['cloud', 'rain'] as WeatherLayer[]) {
      const tex = this.wx[layer].textures
      const a = layer === 'cloud' ? 'uCloud' : 'uRain'
      const b = layer === 'cloud' ? 'uCloudB' : 'uRainB'
      const m = layer === 'cloud' ? 'uCloudMix' : 'uRainMix'
      if (!tex.length) continue
      if (tex.length === 1) {
        this.bgUniforms[a].value = tex[0]
        this.bgUniforms[b].value = tex[0]
        this.bgUniforms[m].value = 0
        continue
      }
      /*
       * Back and forth, never round and round.
       *
       * A loop that runs 0,1,2 and starts again at 0 has to jump three
       * quarters of an hour backwards once a cycle, and over three quarters of
       * an hour the clouds move less than that jump does — so the jump is the
       * only motion anybody sees, and it reads as the picture glitching. A
       * ping-pong has no seam to jump over: it plays forwards, then backwards,
       * and every step is a small change from the one before it.
       */
      const hold = WEATHER_FRAME_HOLD_MS
      const legs = Math.max(1, (tex.length - 1) * 2)
      const phase = (Date.now() % (hold * legs)) / hold
      const leg = Math.min(legs - 1, Math.floor(phase))
      const fwd = leg < tex.length - 1
      const i = fwd ? leg : legs - leg
      const next = fwd ? i + 1 : i - 1
      const t = phase - leg
      // Hold, then ease across. A linear blend over the whole step makes every
      // moment a half-dissolve, which reads as blur rather than movement.
      const FADE = 0.34
      const raw = t < 1 - FADE ? 0 : (t - (1 - FADE)) / FADE
      this.bgUniforms[a].value = tex[Math.max(0, Math.min(tex.length - 1, i))]
      this.bgUniforms[b].value = tex[Math.max(0, Math.min(tex.length - 1, next))]
      this.bgUniforms[m].value = raw * raw * (3 - 2 * raw)
    }
  }

  /** Override the day/night clock (KST hour 0–24), or null for live time. */
  setNightHour(hour: number | null): void {
    this.nightHourOverride = hour
  }

  /**
   * Where the sun is overhead, for this frame.
   *
   * The declination is the real one for today's date, so the terminator leans
   * the way it actually does this time of year and the polar day/night is
   * right. The longitude is driven by the exhibit's own clock rather than the
   * real one: at fifteen degrees an hour nothing would visibly move during a
   * visit, so a full turn is compressed into DAY_PERIOD_MS. Both windows read
   * the same wall clock, so they stay in step with no hub traffic.
   */
  private updateSun(): void {
    const now = new Date()
    const start = Date.UTC(now.getUTCFullYear(), 0, 0)
    const dayOfYear = (now.getTime() - start) / 86_400_000
    this.sunDecl = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365.24)

    const phase =
      this.nightHourOverride != null
        ? this.nightHourOverride / 24
        : (Date.now() % DAY_PERIOD_MS) / DAY_PERIOD_MS
    // Subsolar longitude runs west as the earth turns east.
    this.sunLon = wrapLon(180 - phase * 360)
    this.bgUniforms.uSunLon.value = this.sunLon
    this.bgUniforms.uSunDecl.value = this.sunDecl

    const d = (this.sunDecl * Math.PI) / 180
    this.sinDecl = Math.sin(d)
    this.cosDecl = Math.cos(d)
    this.sunLonRad = (this.sunLon * Math.PI) / 180

    // A slow breath rather than a blink: bright, dim, bright, over PULSE_MS.
    this.pulse = 0.5 - 0.5 * Math.cos((2 * Math.PI * (Date.now() % PULSE_MS)) / PULSE_MS)
  }

  /** How dark it is where this object is: 0 in daylight, 1 in full night.
   * Same solar geometry the background shader uses, so the lights an aircraft
   * shows agree with the ground beneath it. */
  private nightAt(lonDeg: number, latDeg: number): number {
    const la = (latDeg * Math.PI) / 180
    const lo = (lonDeg * Math.PI) / 180
    const cosZenith =
      Math.sin(la) * this.sinDecl + Math.cos(la) * this.cosDecl * Math.cos(lo - this.sunLonRad)
    // Matches the shader's smoothstep(0.10, -0.10, cosZenith).
    const t = Math.max(0, Math.min(1, (0.1 - cosZenith) / 0.2))
    return t * t * (3 - 2 * t)
  }

  private frame = (now: number): void => {
    // Time step (seconds), capped so a backgrounded tab doesn't teleport planes.
    const dt = this.lastFrame ? Math.min(0.5, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now

    // Selection furniture holds a constant on-screen size; the icons shrink at
    // world view and grow when zoomed in so the swarm stays readable.
    this.uiScale += (this.targetSpan - this.uiScale) * 0.28
    this.iconScale += (iconScaleFor(this.kind, this.targetSpan) - this.iconScale) * 0.28

    // Ease the horizontal offset (wrap-aware) — this pans the world seamlessly.
    this.lonOffset += wrapLon(this.targetLonOffset - this.lonOffset) * 0.28
    this.bgUniforms.uLonOffset.value = this.lonOffset

    // Dead reckoning: advance each plane along its heading at its ground speed,
    // then gently correct toward the latest snapshot. This keeps motion smooth
    // even when real updates are up to 90s apart (OpenSky credit budget).
    const correct = 0.1
    // Only dim others when the selected plane is actually on screen (else a
    // filtered-out/dropped selection would darken the whole map).
    const selVisible = this.selected != null && this.eased.has(this.selected)
    let i = 0
    for (const id of this.order) {
      if (i >= CAPACITY) break // never write past the instance buffer
      const e = this.eased.get(id)
      if (!e) continue
      if (e.speed > 0 && dt > 0) {
        const cosLat = Math.max(0.05, Math.cos((e.lat * Math.PI) / 180))
        const dLat = ((e.speed * Math.cos(e.heading)) / M_PER_DEG) * dt
        const dLon = ((e.speed * Math.sin(e.heading)) / (M_PER_DEG * cosLat)) * dt
        e.lat += dLat
        e.lon += dLon
        // Advance the correction target too, so it tracks the plane's real
        // motion instead of dragging it back toward a snapshot that may be up to
        // 90s old. Without this the dead reckoning and the pull-back cancel out,
        // the plane barely moves between polls, then jumps a whole interval's
        // worth when the next snapshot lands. The snapshot resets the target to
        // truth; `correct` only smooths the small residual — no jump.
        e.tLat += dLat
        e.tLon += dLon
      }
      e.lon = wrapLon(e.lon + wrapLon(e.tLon - e.lon) * correct)
      e.lat += (e.tLat - e.lat) * correct
      e.heading += ((((e.tHeading - e.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI) -
        Math.PI) *
        0.1
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      const angle = this.iconAngle(e.heading, e.lat) // align icon to its track
      const isSel = id === this.selected
      // The selected object is drawn separately, larger and brighter — and for
      // an aircraft, snapped onto its route line. Leaving its instance in as
      // well drew it twice, in two different places, both highlighted. Collapse
      // it to nothing instead of removing it, so instance order stays stable.
      // A dot has no nose to point, and rotating one only makes it shimmer.
      this.planes.setMatrixAt(
        i,
        this.setSpriteMatrix(
          u,
          1 - v,
          0,
          isSel ? 0 : ICON_H * this.iconScale,
          this.kind === 'satellite' ? 0 : angle,
          e.lat
        )
      )
      // Light up over the night side, and breathe while there. The lift is
      // per-object now, from that object's own local night, so aircraft cross
      // into the dark and out again as the terminator sweeps past them rather
      // than the whole map brightening at once. Then dim the unselected ones so
      // the selection still stands out.
      const localNight = this.nightAt(e.lon, e.lat)
      this.scratchColor
        .copy(e.color)
        .multiplyScalar(1 + localNight * (0.35 + 0.55 * this.pulse))
      if (selVisible && !isSel) this.scratchColor.multiplyScalar(0.28)
      this.planes.setColorAt(i, this.scratchColor)

      if (isSel) {
        // First frame the selected plane is rendered → center the camera on it.
        if (this.pendingRecenter) this.recenterOnPlane(e.lon, e.lat)
        const ps = this.uiScale
        const placeSelected = (au: number, ay: number, ang: number, alat: number): void => {
          this.selectedPlane.matrix.copy(this.setSpriteMatrix(au, ay, 0.7, SEL_H * ps, ang, alat))
          this.selectedPlane.matrixWorldNeedsUpdate = true
          // The halo sits under the icon, unrotated (a glow has no heading) and
          // fades up as the map darkens, so the selection reads as lit at night.
          this.selectedGlow.matrix.copy(
            this.setSpriteMatrix(au, ay, 0.66, SEL_H * ps * GLOW_SCALE, 0, alat)
          )
          this.selectedGlow.matrixWorldNeedsUpdate = true
          const glowMat = this.selectedGlow.material as THREE.MeshBasicMaterial
          glowMat.opacity = 0.1 + this.nightAt(e.lon, e.lat) * (0.25 + 0.6 * this.pulse)
          this.selectedGlow.visible = true
          // Blinking red lights — wingtips on an aircraft, a nose beacon on a
          // satellite — shown in the dark, which is when a real one shows them.
          // Only on the targeted object: every plane carrying them turned the
          // night side into a field of red specks and hid the one thing the
          // visitor is meant to be following. Additive over the icon, so as it
          // crosses back into daylight they fade out with the local night
          // rather than switching off.
          const night = this.nightAt(e.lon, e.lat)
          if (night > 0.01) {
            this.selectedLights.matrix.copy(
              this.setSpriteMatrix(au, ay, 0.72, SEL_H * ps * LIGHT_QUAD_SCALE, ang, alat)
            )
            this.selectedLights.matrixWorldNeedsUpdate = true
            const lit = night * (0.25 + 0.75 * this.pulse)
            ;(this.selectedLights.material as THREE.MeshBasicMaterial).color.setRGB(
              lit,
              lit * 0.06,
              lit * 0.04
            )
            this.selectedLights.visible = true
          } else {
            this.selectedLights.visible = false
          }
        }
        // A satellite icon is drawn upright; turning it to the ground track just
        // makes the solar panels point at nothing.
        placeSelected(u, 1 - v, this.kind === 'satellite' ? 0 : angle, e.lat)
        this.emitAnchor(u, 1 - v)
        this.selectedPlane.visible = true
        // Place the info chip. Centered on the plane, offset either to the side
        // (no route) or PERPENDICULAR to the route (routed) so it clears the
        // origin/destination flags & names, which lie ALONG the route axis.
        const placeInfoChip = (au: number, ay: number, offX: number, offY: number): void => {
          const infoMat = this.infoLabel.material as THREE.MeshBasicMaterial
          if (!infoMat.map) return
          // The card reports the on-screen height its layout wants, so adding a
          // row grows the card instead of shrinking the text inside it.
          const lh = (this.infoLabel.userData.screenH as number) * ps
          const asp = (this.infoLabel.userData.aspect as number) || 3
          const base = this.quadWidth(lh, asp)
          const lw = base * this.plateStretch(e.lat, base)
          // Push the chip a full plane-width off the anchor so it never covers the
          // aircraft icon, and clamp it to stay on the 2:1 frame.
          const clr = 0.045 * ps
          const cx = Math.max(lw / 2, Math.min(1 - lw / 2, au + offX * (lw / 2 + clr)))
          const cy = Math.max(lh / 2, Math.min(1 - lh / 2, ay + offY * (lh / 2 + clr)))
          this.infoLabel.scale.set(lw, lh, 1)
          this.infoLabel.position.set(cx, cy, 0.75)
          this.infoLabel.visible = true
        }
        // Place the card beside the object, flipping to the other side near the
        // frame edge. Used whenever there's no route axis to work around.
        const placeChipBeside = (au: number, ay: number): void => {
          const lw = this.plateStretch(e.lat, 0.3) * this.quadWidth(
            (this.infoLabel.userData.screenH as number) * ps,
            (this.infoLabel.userData.aspect as number) || 3
          )
          placeInfoChip(au, ay, au + lw + 0.02 < 1 ? 1 : -1, 0)
        }
        // Reposition origin/destination markers (they move with the pan offset).
        // Orbits have no endpoints — an orbit is a loop, so a "from" marker and a
        // place name would both be fiction. Skipped entirely for satellites.
        if (this.routePoints && this.kind === 'satellite') {
          for (const m of [
            this.originMarker,
            this.destMarker,
            this.originLabel,
            this.destLabel,
            this.originFlag,
            this.destFlag
          ]) {
            m.visible = false
          }
          // The orbit still has to be built. Rebuilding on offset change keeps it
          // locked to the earth as the map pans, exactly as routes do.
          if (this.lonOffset !== this.lastRouteOffset) {
            this.buildRoute(0)
            this.lastRouteIdx = 0
            this.lastRouteOffset = this.lonOffset
          }
          // Put the icon ON its orbit, the way a selected aircraft is put on its
          // route. The dot's own position is eased and dead-reckoned between
          // ticks, and at 7.6 km/s that lag is a visible gap — the satellite
          // appeared to be flying alongside its own track rather than on it.
          // The track is where it actually is, so snap to the nearest point.
          const oi = nearestRouteIndex(this.routePoints, { lon: e.lon, lat: e.lat })
          if (oi >= 0) {
            const on = this.routePoints[oi]
            const sp = projectNorm(on.lon, on.lat, this.lonOffset)
            placeSelected(sp.u, 1 - sp.v, 0, on.lat)
            placeChipBeside(sp.u, 1 - sp.v)
          } else {
            placeChipBeside(u, 1 - v)
          }
        } else if (this.routePoints) {
          const o = this.routePoints[0]
          const de = this.routePoints[this.routePoints.length - 1]
          const op = projectNorm(o.lon, o.lat, this.lonOffset)
          const dp = projectNorm(de.lon, de.lat, this.lonOffset)
          const markH = MARKER_H * ps
          const pinH = PIN_H * ps
          const oStretch = this.poleStretch(o.lat, MAX_PLATE_STRETCH)
          const dStretch = this.poleStretch(de.lat, MAX_PLATE_STRETCH)
          this.originMarker.scale.set(this.quadWidth(markH, 1) * oStretch, markH, 1)
          this.destMarker.scale.set(this.quadWidth(pinH, PIN_ASPECT) * dStretch, pinH, 1)
          this.originMarker.position.set(op.u, 1 - op.v, 0.65)
          // Lift the pin so its bottom tip (not center) sits on the coordinate.
          this.destMarker.position.set(dp.u, 1 - dp.v + pinH / 2, 0.65)
          this.originMarker.visible = true
          this.destMarker.visible = true
          // Lay out each endpoint's name + flag as a stack that extends OUTWARD
          // along the route, away from the OTHER endpoint. Because the two stacks
          // point in opposite directions, they can never overlap each other — for
          // any geometry, including short, near-vertical, or coincident endpoints
          // (that was the recurring "flag detached / labels piled up" bug). The
          // marker stays on its true coordinate; the name sits just outside it,
          // the flag just beyond the name.
          const oy = 1 - op.v
          const dy0 = 1 - dp.v
          let dirX = op.u - dp.u
          if (dirX > 0.5) dirX -= 1
          else if (dirX < -0.5) dirX += 1
          let dirY = oy - dy0
          let dlen = Math.hypot(dirX, dirY)
          if (dlen < 1e-4) {
            dirX = 0
            dirY = 1
            dlen = 1
          }
          dirX /= dlen
          dirY /= dlen
          const lblH = LABEL_H * ps
          const fh = FLAG_H * ps
          const margin = 0.01 * ps
          // Distance a box (w×h) must sit out along the route so its inner edge
          // just clears the centre — its half-extent PROJECTED on the outward
          // direction. A wide name (Bangalore) therefore pushes itself further
          // out, so two names never collide even on a very short route.
          const halfAlong = (w: number, h: number) =>
            Math.abs(dirX) * (w / 2) + Math.abs(dirY) * (h / 2)
          const placeLabel = (
            lbl: THREE.Mesh,
            mu: number,
            my: number,
            sign: number,
            stretch: number
          ): number => {
            const asp = (lbl.userData.aspect as number) || 4
            const w = this.quadWidth(lblH, asp) * stretch
            lbl.scale.set(w, lblH, 1)
            const half = halfAlong(w, lblH)
            const g = margin + half
            lbl.position.set(mu + sign * dirX * g, my + sign * dirY * g, 0.68)
            return g + half + 0.006 * ps // outer edge (+gap) → where the flag begins
          }
          const oOuter = placeLabel(this.originLabel, op.u, oy, 1, oStretch)
          const dOuter = placeLabel(this.destLabel, dp.u, dy0, -1, dStretch)
          const placeFlag = (
            flag: THREE.Mesh,
            mu: number,
            my: number,
            sign: number,
            outer: number,
            stretch: number
          ) => {
            if (!(flag.material as THREE.MeshBasicMaterial).map) {
              flag.visible = false
              return
            }
            const asp = (flag.userData.aspect as number) || 1.33
            const w = this.quadWidth(fh, asp) * stretch
            flag.scale.set(w, fh, 1)
            const g = outer + halfAlong(w, fh)
            flag.position.set(mu + sign * dirX * g, my + sign * dirY * g, 0.66)
            flag.visible = true
          }
          placeFlag(this.originFlag, op.u, oy, 1, oOuter, oStretch)
          placeFlag(this.destFlag, dp.u, dy0, -1, dOuter, dStretch)
          // Remember where the endpoint furniture ended up, corners included, so
          // the control card can be told to keep off it.
          this.extraAvoid = []
          for (const m of [
            this.originMarker,
            this.destMarker,
            this.originLabel,
            this.destLabel,
            this.originFlag,
            this.destFlag
          ]) {
            if (!m.visible) continue
            const hw = m.scale.x / 2
            const hh = m.scale.y / 2
            for (const sx of [-1, 0, 1]) {
              for (const sy of [-1, 0, 1]) {
                this.extraAvoid.push({ u: m.position.x + sx * hw, y: m.position.y + sy * hh })
              }
            }
          }
          // Split the route at the plane's nearest point; rebuild when that split
          // or the pan offset changed so the line stays aligned to the earth.
          const idx = nearestRouteIndex(this.routePoints, { lon: e.lon, lat: e.lat })
          // Snap the selected plane ONTO its route: draw the icon at the nearest
          // route point (the flown/remaining split) pointing along the line,
          // instead of at its raw position. Real aircraft deviate from the drawn
          // great circle (airways, wind), which would otherwise float the plane
          // off its own line — this pulls it back on, exactly as requested.
          const snap = this.routePoints[idx]
          const sp = projectNorm(snap.lon, snap.lat, this.lonOffset)
          const a2 = this.routePoints[Math.min(idx + 1, this.routePoints.length - 1)]
          const a1 = this.routePoints[Math.max(idx - 1, 0)]
          const φ1 = (a1.lat * Math.PI) / 180
          const φ2 = (a2.lat * Math.PI) / 180
          const Δλ = ((a2.lon - a1.lon) * Math.PI) / 180
          const bearing = Math.atan2(
            Math.sin(Δλ) * Math.cos(φ2),
            Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
          )
          placeSelected(sp.u, 1 - sp.v, this.iconAngle(bearing, snap.lat), snap.lat)
          // Info chip offset PERPENDICULAR to the route so it never lands on the
          // origin/destination flags & names (which run along the route axis).
          const pa1 = projectNorm(a1.lon, a1.lat, this.lonOffset)
          const pa2 = projectNorm(a2.lon, a2.lat, this.lonOffset)
          let tX = pa2.u - pa1.u
          if (tX > 0.5) tX -= 1
          else if (tX < -0.5) tX += 1
          const tY = pa1.v - pa2.v // screen-y tangent (screen y = 1 - v)
          const tl = Math.hypot(tX, tY) || 1
          let pX = -tY / tl
          let pY = tX / tl
          // Offset toward the vertical center so the chip stays on the frame.
          if (pY > 0 !== 1 - sp.v < 0.5) {
            pX = -pX
            pY = -pY
          }
          placeInfoChip(sp.u, 1 - sp.v, pX, pY)
          if (idx !== this.lastRouteIdx || this.lonOffset !== this.lastRouteOffset) {
            this.buildRoute(idx)
            this.lastRouteIdx = idx
            this.lastRouteOffset = this.lonOffset
          }
        } else {
          placeChipBeside(u, 1 - v)
        }
      }
      i++
    }
    this.planes.count = i
    this.planes.instanceMatrix.needsUpdate = true
    if (this.planes.instanceColor) this.planes.instanceColor.needsUpdate = true
    // If the selected plane vanished (filtered out / dropped), hide its overlays.
    if (!this.selected || !this.eased.has(this.selected)) {
      this.extraAvoid = []
      this.clearAnchor()
      this.selectedPlane.visible = false
      this.selectedGlow.visible = false
      this.selectedLights.visible = false
      this.originMarker.visible = false
      this.destMarker.visible = false
      this.originLabel.visible = false
      this.destLabel.visible = false
      this.infoLabel.visible = false
      this.originFlag.visible = false
      this.destFlag.visible = false
    }

    // Ease the camera toward the target view (zoom/pan) and keep icon size
    // constant on screen by scaling geometry with the view span.
    const vk = 0.28
    this.viewRect.left += (this.targetRect.left - this.viewRect.left) * vk
    this.viewRect.right += (this.targetRect.right - this.viewRect.right) * vk
    this.viewRect.top += (this.targetRect.top - this.viewRect.top) * vk
    this.viewRect.bottom += (this.targetRect.bottom - this.viewRect.bottom) * vk
    this.camera.left = this.viewRect.left
    this.camera.right = this.viewRect.right
    this.camera.top = this.viewRect.top
    this.camera.bottom = this.viewRect.bottom
    this.camera.updateProjectionMatrix()

    this.updateSun()
    this.tickWeather()
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.frame)
  }

  start(): void {
    this.lastFrame = 0
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    let rw: number
    let rh: number
    if (this.fixedSize) {
      // Exact projector frame (top-left); the rest of the window stays black.
      rw = this.fixedSize.w
      rh = this.fixedSize.h
    } else {
      // Keep an exact 2:1 frame, letterboxed inside whatever the window gives us.
      const w = parent.clientWidth
      const h = parent.clientHeight
      rw = w
      rh = w / 2
      if (rh > h) {
        rh = h
        rw = h * 2
      }
    }
    this.frameAspect = rh > 0 ? rw / rh : 2
    const pr = Math.min(window.devicePixelRatio, 3) // higher cap → sharper output
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(rw, rh, true)
    this.canvas.style.width = `${rw}px`
    this.canvas.style.height = `${rh}px`
    // Fat lines need the drawing-buffer resolution in pixels.
    this.flownMat.resolution.set(rw * pr, rh * pr)
    this.remainMat.resolution.set(rw * pr, rh * pr)
    this.orbitMat.resolution.set(rw * pr, rh * pr)
    this.orbitCasingMat.resolution.set(rw * pr, rh * pr)
    this.routeCasingMat.resolution.set(rw * pr, rh * pr)
  }

  dispose(): void {
    this.stop()
    this.inputCleanup?.()
    this.inputCleanup = null
    if (this.viewEmitTimer) {
      clearTimeout(this.viewEmitTimer)
      this.viewEmitTimer = null
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
    if (this.noRouteTimer) {
      clearTimeout(this.noRouteTimer)
      this.noRouteTimer = null
    }
    this.renderer.dispose()
  }
}
