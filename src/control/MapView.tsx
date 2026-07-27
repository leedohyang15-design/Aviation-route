import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import type { Aircraft, GeoPoint } from '@shared/types'

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

interface Props {
  aircraft: Aircraft[]
  selected: string | null
  route: GeoPoint[] | null
  onSelect: (icao24: string | null) => void
}

export function MapView({ aircraft, selected, route, onSelect }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Init once.
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [10, 25],
      zoom: 1.3,
      attributionControl: false
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('aircraft', { type: 'geojson', data: toFeatureCollection([]) })
      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      })
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        paint: { 'line-color': '#ffe08a', 'line-width': 2.5, 'line-opacity': 0.9 }
      })
      map.addLayer({
        id: 'aircraft-dots',
        type: 'circle',
        source: 'aircraft',
        paint: {
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 8, 4],
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
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3,
            0.5
          ],
          'circle-stroke-color': '#ffffff'
        }
      })

      map.on('click', 'aircraft-dots', (e) => {
        const f = e.features?.[0]
        if (f) onSelectRef.current(String(f.properties?.icao24))
      })
      map.on('click', (e) => {
        // Click on empty map clears selection.
        const hits = map.queryRenderedFeatures(e.point, { layers: ['aircraft-dots'] })
        if (hits.length === 0) onSelectRef.current(null)
      })
      map.on('mouseenter', 'aircraft-dots', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'aircraft-dots', () => (map.getCanvas().style.cursor = ''))

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

  // Route line.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const data: GeoJSON.FeatureCollection = route
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: route.map((p) => [p.lon, p.lat]) },
              properties: {}
            }
          ]
        }
      : { type: 'FeatureCollection', features: [] }
    map.getSource<maplibregl.GeoJSONSource>('route')?.setData(data)
  }, [route])

  // Highlight selected via a paint expression keyed on the id property.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setPaintProperty('aircraft-dots', 'circle-radius', [
      'case',
      ['==', ['get', 'icao24'], selected ?? '__none__'],
      9,
      4
    ])
    map.setPaintProperty('aircraft-dots', 'circle-stroke-width', [
      'case',
      ['==', ['get', 'icao24'], selected ?? '__none__'],
      3,
      0.5
    ])
  }, [selected])

  return <div ref={containerRef} className="map" />
}
