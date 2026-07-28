import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Aircraft, GeoPoint, ViewState } from '@shared/types'
import { nearestRouteIndex, wrapLon } from '@shared/projection'
import { planeImageData } from '@shared/plane'

/** Convert the map's current viewport into the display's ViewState. */
function mapToView(map: maplibregl.Map): ViewState {
  const c = map.getCenter()
  const b = map.getBounds()
  let span = (b.getEast() - b.getWest()) / 360
  if (span <= 0) span += 1 // antimeridian wrap
  // Normalize longitude so it never leaves [-180,180] (else the display clamp breaks).
  return { centerLon: wrapLon(c.lng), centerLat: c.lat, span: Math.max(0.02, Math.min(1, span)) }
}

// Free MapLibre demo vector style — no API token required. Needs network; if the
// exhibit runs offline, swap for a locally hosted style/tiles.
const STYLE_URL = 'https://demotiles.maplibre.org/style.json'

function toFeatureCollection(aircraft: Aircraft[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: aircraft.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        icao24: a.icao24,
        callsign: a.callsign || a.icao24.toUpperCase(),
        altitude: a.altitude ?? 0,
        heading: a.heading ?? 0
      }
    }))
  }
}

/** Route split into flown (origin→now) and remaining (now→dest) for coloring. */
function toRouteFC(route: GeoPoint[] | null, selPos: GeoPoint | null): GeoJSON.FeatureCollection {
  if (!route || route.length < 2) return { type: 'FeatureCollection', features: [] }
  const idx = selPos ? nearestRouteIndex(route, selPos) : route.length - 1
  const line = (pts: GeoPoint[], kind: string): GeoJSON.Feature | null =>
    pts.length >= 2
      ? {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) },
          properties: { kind }
        }
      : null
  return {
    type: 'FeatureCollection',
    features: [line(route.slice(idx), 'remaining'), line(route.slice(0, idx + 1), 'flown')].filter(
      (f): f is GeoJSON.Feature => f !== null
    )
  }
}

interface Props {
  aircraft: Aircraft[]
  selected: string | null
  route: GeoPoint[] | null
  onSelect: (icao24: string | null) => void
  onView: (view: ViewState) => void
}

export function MapView({ aircraft, selected, route, onSelect, onView }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const followRef = useRef<string | null>(null) // icao24 being followed, or null

  // Init once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [10, 25],
      zoom: 1.3,
      attributionControl: false,
      renderWorldCopies: true // pan past an edge wraps to the other side of the globe
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // Manually dragging the map stops following the selected plane.
    map.on('dragstart', () => (followRef.current = null))

    map.on('load', async () => {
      // Hide the demo style's dashed graticule so it doesn't clash with routes.
      for (const id of ['geolines', 'geolines-label']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
      }

      // Register the airplane icon (used only for the selected aircraft).
      try {
        const img = await planeImageData(64)
        if (!map.hasImage('plane')) map.addImage('plane', img, { pixelRatio: 2 })
      } catch {
        /* icon optional */
      }

      map.addSource('aircraft', { type: 'geojson', data: toFeatureCollection([]) })
      map.addSource('route', { type: 'geojson', data: toRouteFC(null, null) })

      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['match', ['get', 'kind'], 'flown', '#ff3b30', '#ffe08a'],
          'line-width': ['match', ['get', 'kind'], 'flown', 3, 2],
          'line-opacity': ['match', ['get', 'kind'], 'flown', 0.95, 0.35]
        }
      })

      // Unselected aircraft = dots colored by altitude. The selected one is hidden
      // here and shown as an airplane icon instead.
      map.addLayer({
        id: 'aircraft-dots',
        type: 'circle',
        source: 'aircraft',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'icao24'], selected ?? '__none__'], 0, 4],
          'circle-color': [
            'interpolate',
            ['linear'],
            ['get', 'altitude'],
            0,
            '#ff9f45',
            6000,
            '#ffe066',
            12000,
            '#5ad2ff'
          ],
          'circle-stroke-width': 0.5,
          'circle-stroke-color': '#ffffff'
        }
      })

      map.addLayer({
        id: 'aircraft-selected',
        type: 'symbol',
        source: 'aircraft',
        filter: ['==', ['get', 'icao24'], selected ?? '__none__'],
        layout: {
          'icon-image': 'plane',
          'icon-size': 0.5,
          'icon-rotate': ['get', 'heading'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true
        }
      })

      map.on('click', 'aircraft-dots', (e) => {
        const f = e.features?.[0]
        if (f) onSelectRef.current(String(f.properties?.icao24))
      })
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: ['aircraft-dots'] })
        if (hits.length === 0) onSelectRef.current(null)
      })
      map.on('mouseenter', 'aircraft-dots', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'aircraft-dots', () => (map.getCanvas().style.cursor = ''))

      // The display mirrors the control map's viewport (live while panning/zooming).
      map.on('move', () => onViewRef.current(mapToView(map)))
      onViewRef.current(mapToView(map)) // initial sync

      loadedRef.current = true
      map.getSource<maplibregl.GeoJSONSource>('aircraft')?.setData(toFeatureCollection(aircraft))
    })

    return () => {
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update aircraft data.
  useEffect(() => {
    if (!loadedRef.current) return
    mapRef.current
      ?.getSource<maplibregl.GeoJSONSource>('aircraft')
      ?.setData(toFeatureCollection(aircraft))
  }, [aircraft])

  // Route split (recomputed with the selected plane's current position).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const sel = selected ? aircraft.find((a) => a.icao24 === selected) : null
    const selPos = sel ? { lon: sel.lon, lat: sel.lat } : null
    map.getSource<maplibregl.GeoJSONSource>('route')?.setData(toRouteFC(route, selPos))
  }, [route, selected, aircraft])

  // Selection: hide the selected dot, show the airplane icon on it, and fly to it.
  const prevSel = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setPaintProperty('aircraft-dots', 'circle-radius', [
      'case',
      ['==', ['get', 'icao24'], selected ?? '__none__'],
      0,
      4
    ])
    map.setFilter('aircraft-selected', ['==', ['get', 'icao24'], selected ?? '__none__'])
    if (selected && selected !== prevSel.current) {
      followRef.current = selected // start following the newly selected plane
      const a = aircraft.find((x) => x.icao24 === selected)
      if (a) map.flyTo({ center: [a.lon, a.lat], zoom: Math.max(map.getZoom(), 4), duration: 1500 })
    }
    if (!selected) followRef.current = null
    prevSel.current = selected
  }, [selected, aircraft])

  // Follow the selected plane: recenter on it each snapshot (until the user drags).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current || !followRef.current) return
    const a = aircraft.find((x) => x.icao24 === followRef.current)
    if (a) map.easeTo({ center: [a.lon, a.lat], duration: 1200 })
  }, [aircraft])

  const resetView = () => {
    onSelectRef.current(null)
    mapRef.current?.flyTo({ center: [10, 25], zoom: 1.3, duration: 900 })
  }

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <button className="reset-btn" onClick={resetView}>
        🌏 전체 보기
      </button>
    </div>
  )
}
