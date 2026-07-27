// Equirectangular display engine (three.js). Renders a 2:1 frame that the
// sphere-projection software wraps onto the physical globe:
//   - background: earth texture (or procedural ocean) + optional graticule and
//     day/night terminator, shifted horizontally by the longitude spin;
//   - aircraft: an InstancedMesh of heading-oriented triangles, colored by
//     altitude, positioned with the shared equirectangular projection and eased
//     between polls for smooth motion;
//   - the selected aircraft's great-circle route, split at the antimeridian.
//
// Coordinate convention: an orthographic camera with x∈[0,1] (left→right =
// −180→+180 after spin) and y∈[0,1] (bottom→top = −90→+90). worldY = 1 − v.

import * as THREE from 'three'
import type { Aircraft, GeoPoint, OverlayKey } from '@shared/types'
import { projectNorm, wrapLon, splitAtAntimeridian } from '@shared/projection'
import { EARTH_TEXTURE_URL } from '@shared/config'

const CAPACITY = 16000 // max aircraft instances

function altitudeColor(alt: number | null): THREE.Color {
  // Low = warm, high = cool. Mirrors typical flight-tracker palettes.
  const a = Math.max(0, Math.min(1, (alt ?? 0) / 12000))
  const c = new THREE.Color()
  c.setHSL(0.08 + a * 0.5, 0.9, 0.55)
  return c
}

interface Eased {
  lon: number
  lat: number
  heading: number
  tLon: number
  tLat: number
  tHeading: number
  color: THREE.Color
}

export class Globe {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10)
  private bg: THREE.Mesh
  private bgUniforms: Record<string, THREE.IUniform>
  private planes: THREE.InstancedMesh
  private selectedRing: THREE.Mesh
  private routeGroup = new THREE.Group()
  private raf = 0

  private eased = new Map<string, Eased>()
  private order: string[] = [] // stable instance ordering
  private lonOffset = 0
  private selected: string | null = null
  private dummy = new THREE.Object3D()

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setClearColor(0x000000, 1)
    this.scene.add(this.routeGroup)

    // --- Background ---
    this.bgUniforms = {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uLonOffset: { value: 0 },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uShowDayNight: { value: 1 },
      uShowGrid: { value: 0 }
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
        uniform vec3 uSunDir; uniform float uShowDayNight; uniform float uShowGrid;
        void main() {
          float texU = fract(vUv.x - uLonOffset / 360.0);
          vec2 uv = vec2(texU, vUv.y);
          vec3 col = uHasMap > 0.5 ? texture2D(uMap, uv).rgb : vec3(0.03, 0.09, 0.18);
          float lon = uv.x * 360.0 - 180.0;
          float lat = vUv.y * 180.0 - 90.0;
          if (uShowGrid > 0.5) {
            float glon = abs(fract(lon / 30.0 + 0.5) - 0.5);
            float glat = abs(fract(lat / 30.0 + 0.5) - 0.5);
            float line = min(glon, glat);
            float grid = smoothstep(0.015, 0.0, line);
            col = mix(col, vec3(0.4, 0.6, 0.85), grid * 0.35);
          }
          if (uShowDayNight > 0.5) {
            float la = radians(lat); float lo = radians(lon);
            vec3 n = vec3(cos(la) * cos(lo), cos(la) * sin(lo), sin(la));
            float d = dot(n, normalize(uSunDir));
            float night = smoothstep(0.12, -0.12, d);
            col *= mix(1.0, 0.35, night);
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat)
    this.bg.position.set(0.5, 0.5, -1)
    this.scene.add(this.bg)

    // --- Aircraft instances (small triangles pointing +y = north) ---
    const s = 0.006
    const tri = new THREE.BufferGeometry()
    tri.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, s * 1.6, 0, -s, -s, 0, s, -s, 0], 3)
    )
    this.planes = new THREE.InstancedMesh(tri, new THREE.MeshBasicMaterial(), CAPACITY)
    this.planes.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.planes.count = 0
    this.scene.add(this.planes)

    // --- Selection ring ---
    this.selectedRing = new THREE.Mesh(
      new THREE.RingGeometry(0.012, 0.017, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    )
    this.selectedRing.visible = false
    this.selectedRing.position.z = 0.5
    this.scene.add(this.selectedRing)

    this.tryLoadEarth()
    this.resize()
  }

  /** Try to swap in a real photographic earth if the asset is present. */
  private tryLoadEarth(): void {
    new THREE.TextureLoader().load(
      EARTH_TEXTURE_URL,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.wrapS = THREE.RepeatWrapping
        this.bgUniforms.uMap.value = tex
        this.bgUniforms.uHasMap.value = 1
      },
      undefined,
      () => {
        /* no asset — keep procedural ocean + graticule */
      }
    )
  }

  setLonOffset(deg: number): void {
    this.lonOffset = deg
    this.bgUniforms.uLonOffset.value = deg
  }

  setOverlays(overlays: Record<OverlayKey, boolean>): void {
    this.bgUniforms.uShowDayNight.value = overlays.dayNight ? 1 : 0
    this.bgUniforms.uShowGrid.value = overlays.grid ? 1 : 0
  }

  setSelected(icao24: string | null): void {
    this.selected = icao24
    this.selectedRing.visible = false
  }

  /** Update aircraft targets; new ids appear, missing ids fade out (removed). */
  setAircraft(list: Aircraft[]): void {
    const seen = new Set<string>()
    for (const a of list) {
      seen.add(a.icao24)
      const color = altitudeColor(a.altitude)
      const h = ((a.heading ?? 0) * Math.PI) / 180
      const cur = this.eased.get(a.icao24)
      if (cur) {
        cur.tLon = a.lon
        cur.tLat = a.lat
        cur.tHeading = h
        cur.color = color
      } else {
        this.eased.set(a.icao24, {
          lon: a.lon,
          lat: a.lat,
          heading: h,
          tLon: a.lon,
          tLat: a.lat,
          tHeading: h,
          color
        })
        this.order.push(a.icao24)
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

  setRoute(points: GeoPoint[] | null): void {
    this.routeGroup.clear()
    if (!points || points.length < 2) return
    const mat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.85 })
    for (const seg of splitAtAntimeridian(points)) {
      if (seg.length < 2) continue
      const geo = new THREE.BufferGeometry()
      const pos = new Float32Array(seg.length * 3)
      seg.forEach((p, i) => {
        const { u, v } = projectNorm(p.lon, p.lat, this.lonOffset)
        pos[i * 3] = u
        pos[i * 3 + 1] = 1 - v
        pos[i * 3 + 2] = 0.2
      })
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      this.routeGroup.add(new THREE.Line(geo, mat))
    }
  }

  private updateSunDir(): void {
    // Subsolar point from UTC time (low-precision, good enough for a terminator).
    const now = new Date()
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60
    const subLon = -(utcHours - 12) * 15
    const dayOfYear =
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.UTC(now.getUTCFullYear(), 0, 0)) /
      86400000
    const decl = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81) * Math.PI) / 180)
    const la = (decl * Math.PI) / 180
    const lo = (subLon * Math.PI) / 180
    ;(this.bgUniforms.uSunDir.value as THREE.Vector3).set(
      Math.cos(la) * Math.cos(lo),
      Math.cos(la) * Math.sin(lo),
      Math.sin(la)
    )
  }

  private frame = (): void => {
    // Ease each aircraft toward its target (wrap-aware in longitude).
    const k = 0.12
    let i = 0
    for (const id of this.order) {
      const e = this.eased.get(id)
      if (!e) continue
      e.lon += wrapLon(e.tLon - e.lon) * k
      e.lat += (e.tLat - e.lat) * k
      e.heading += ((((e.tHeading - e.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI) -
        Math.PI) *
        k
      const { u, v } = projectNorm(e.lon, e.lat, this.lonOffset)
      this.dummy.position.set(u, 1 - v, 0)
      this.dummy.rotation.z = -e.heading
      const scale = id === this.selected ? 2.2 : 1
      this.dummy.scale.set(scale, scale, 1)
      this.dummy.updateMatrix()
      this.planes.setMatrixAt(i, this.dummy.matrix)
      this.planes.setColorAt(i, id === this.selected ? new THREE.Color(0xffffff) : e.color)
      if (id === this.selected) {
        this.selectedRing.position.set(u, 1 - v, 0.5)
        this.selectedRing.visible = true
      }
      i++
    }
    this.planes.count = i
    this.planes.instanceMatrix.needsUpdate = true
    if (this.planes.instanceColor) this.planes.instanceColor.needsUpdate = true
    if (this.selected && !this.eased.has(this.selected)) this.selectedRing.visible = false

    this.updateSunDir()
    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.frame)
  }

  start(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    // Keep an exact 2:1 frame, letterboxed inside whatever the window gives us.
    const w = parent.clientWidth
    const h = parent.clientHeight
    let rw = w
    let rh = w / 2
    if (rh > h) {
      rh = h
      rw = h * 2
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(rw, rh, true)
    this.canvas.style.width = `${rw}px`
    this.canvas.style.height = `${rh}px`
  }

  dispose(): void {
    this.stop()
    this.renderer.dispose()
  }
}
