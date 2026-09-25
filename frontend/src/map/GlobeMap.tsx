/**
 * The globe. Imperative MapLibre inside React: sources are updated with setData, React only passes intent.
 * Zoom decides the aggregation level: continents -> countries -> regions -> settlements -> individual events.
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MLMap, MapLayerMouseEvent, VectorTileSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { api } from '../api/client'
import type { Category, Filters, Level, LiveEvent } from '../api/types'
import { baseStyle, LIGHT, type Palette } from './style'

export interface CameraTarget { lat: number; lon: number; zoom: number; nonce: number }
export interface MapStats { level: Level; total: number; shown: number; loading: boolean; error: string | null }

interface Props {
  filters: Filters
  lang: string
  palette: Palette
  categories: Category[]
  selectedPlace: { id: number; lat: number; lon: number } | null
  initialCamera: { lat: number; lon: number; zoom: number } | null
  flyTo: CameraTarget | null
  live: LiveEvent[]
  refreshKey: number
  onSelectPlace: (id: number, kind: string, lat: number, lon: number) => void
  onSelectEvent: (id: number) => void
  onCamera: (c: { lat: number; lon: number; zoom: number; bbox: string }) => void
  onStats: (s: MapStats) => void
}

// MapLibre 6 runs its tile parsing in a module worker that imports a shared chunk: `?worker&url` makes Vite bundle
// the worker with its imports into one self-contained file (plain `?url` would copy the entry file alone -> 404 in prod).
maplibregl.setWorkerUrl(workerUrl)

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
// continents & countries: small global result, cached per filter set; finer levels are viewport-bounded
const GLOBAL_LEVELS: Level[] = ['continent', 'country']

export function levelFor(zoom: number): Level {
  if (zoom < 2.2) return 'continent'
  if (zoom < 3.4) return 'country'
  if (zoom < 5.2) return 'admin1'
  if (zoom < 8.4) return 'locality'
  return 'events'
}

export function zoomFor(kind: string, population = 0): number {
  switch (kind) {
    case 'continent': return 2.4
    case 'country': return population > 50_000_000 ? 3.3 : 4.6
    case 'admin1': return 6.2
    case 'admin2': return 8
    case 'sublocality': return 13
    case 'locality': return population > 500_000 ? 9.6 : population > 50_000 ? 10.8 : 12.2
    default: return 9
  }
}

function circlePolygon(lon: number, lat: number, radiusM: number, steps = 64): Feature<Polygon> {
  const coords: [number, number][] = []
  const d = radiusM / 6371008.8
  const la1 = (lat * Math.PI) / 180
  const lo1 = (lon * Math.PI) / 180
  for (let i = 0; i <= steps; i++) {
    const b = (2 * Math.PI * i) / steps
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
    const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
    coords.push([(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} }
}

function applyPalette(map: MLMap, pal: Palette) {
  map.setPaintProperty('ocean', 'background-color', pal.ocean)
  map.setPaintProperty('land', 'fill-color', pal.land)
  map.setPaintProperty('borders', 'line-color', pal.border)
  map.setPaintProperty('place-dots', 'circle-color', pal.dots)
  map.setPaintProperty('place-labels', 'text-halo-color', pal.halo)
  map.setPaintProperty('place-labels', 'text-color', pal.label)
  // activity names must stay readable over land and water in both themes
  map.setPaintProperty('activity-label', 'text-color', pal === LIGHT ? '#1b2230' : '#ffffff')
  map.setPaintProperty('activity-label', 'text-halo-color', pal === LIGHT ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)')
  map.setSky({ 'sky-color': pal.sky, 'horizon-color': pal.horizon, 'fog-color': pal.ocean, 'sky-horizon-blend': 0.6,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] })
}

function applyCategoryColors(map: MLMap, categories: Category[]) {
  if (!categories.length) return
  map.setPaintProperty('activity-circle', 'circle-color', colorExpr(categories, 'top_category'))
  map.setPaintProperty('activity-glow', 'circle-color', colorExpr(categories, 'top_category'))
  map.setPaintProperty('ev-point', 'circle-color', colorExpr(categories, 'category'))
  map.setPaintProperty('area-point', 'circle-color', colorExpr(categories, 'category'))
}

function colorExpr(categories: Category[], prop: string): maplibregl.ExpressionSpecification {
  const pairs = categories.flatMap((c) => [c.slug, c.color])
  return (pairs.length ? ['match', ['get', prop], ...pairs, '#9aa3b5'] : ['to-color', '#9aa3b5']) as unknown as maplibregl.ExpressionSpecification
}

function filtersKey(f: Filters): string {
  return [f.window, f.from, f.to, f.cats.join(','), f.sources.join(',')].join('|')
}

export function GlobeMap(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const ready = useRef(false)
  const props = useRef(p)
  props.current = p
  const lastKey = useRef('')
  const abort = useRef<AbortController | null>(null)
  const livePoints = useRef<{ lon: number; lat: number; t0: number }[]>([])
  const anim = useRef<number | null>(null)

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!el.current) return
    const cam = p.initialCamera ?? { lat: 34, lon: 32, zoom: 1.9 }
    const map = new maplibregl.Map({
      container: el.current,
      style: baseStyle(p.palette, p.lang),
      center: [cam.lon, cam.lat],
      zoom: cam.zoom,
      maxPitch: 55,
      attributionControl: { compact: true },
      localIdeographFontFamily: '"Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif',
      cancelPendingTileRequestsWhileZooming: true,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), 'bottom-right')
    map.on('load', () => {
      addLayers(map)
      ready.current = true
      applyCategoryColors(map, props.current.categories)
      applyPalette(map, props.current.palette)
      const c = map.getCenter()
      props.current.onCamera({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), bbox: bboxString(map, 0) })
      load(true)
    })
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'map-tip', offset: 12 })
    const interactive = ['activity-circle', 'area-point', 'ev-point', 'ev-cluster']
    for (const id of interactive) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; popup.remove() })
      map.on('mousemove', id, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const pr = f.properties as Record<string, unknown>
        const text = id === 'activity-circle' ? `${pr.name} · ${pr.count}`
          : id === 'ev-cluster' ? `${pr.point_count}` : String(pr.title ?? '')
        popup.setLngLat(e.lngLat).setText(text).addTo(map)
      })
    }
    map.on('click', 'activity-circle', (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const pr = f.properties as Record<string, unknown>
      const [lon, lat] = (f.geometry as Point).coordinates
      props.current.onSelectPlace(Number(pr.id), String(pr.kind), lat, lon)
    })
    for (const id of ['ev-point', 'area-point']) {
      map.on('click', id, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (f) props.current.onSelectEvent(Number((f.properties as Record<string, unknown>).id))
      })
    }
    map.on('click', 'ev-cluster', async (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const src = map.getSource('events') as GeoJSONSource
      const cid = Number((f.properties as Record<string, unknown>).cluster_id)
      const zoom = await src.getClusterExpansionZoom(cid)
      const [lon, lat] = (f.geometry as Point).coordinates
      if (zoom > 16 || zoom <= map.getZoom() + 0.2) {
        // events stacked on one place (all geolocated to the settlement centre): open the place feed
        const leaves = await src.getClusterLeaves(cid, 1, 0)
        const place = Number((leaves[0]?.properties as Record<string, unknown>)?.place)
        if (place) props.current.onSelectPlace(place, 'locality', lat, lon)
      } else {
        map.easeTo({ center: [lon, lat], zoom: zoom + 0.3, duration: 600 })
      }
    })
    map.on('moveend', () => {
      const c = map.getCenter()
      props.current.onCamera({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), bbox: bboxString(map, 0) })
      load(false)
    })
    return () => {
      abort.current?.abort()
      if (anim.current) cancelAnimationFrame(anim.current)
      map.remove()
      mapRef.current = null
      ready.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- palette & language of base labels
  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) applyPalette(map, p.palette)
  }, [p.palette])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    ;(map.getSource('base') as VectorTileSource).setTiles([`${location.origin}/tiles/base/{z}/{x}/{y}.pbf?lang=${p.lang}`])
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lang])

  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) applyCategoryColors(map, p.categories)
  }, [p.categories])

  // ---------------------------------------------------------------- data reload on filters / refresh
  useEffect(() => { load(true) /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filtersKey(p.filters), p.refreshKey])

  // ---------------------------------------------------------------- camera commands
  useEffect(() => {
    const map = mapRef.current
    if (!map || !p.flyTo) return
    map.flyTo({ center: [p.flyTo.lon, p.flyTo.lat], zoom: p.flyTo.zoom, speed: 1.1, curve: 1.5, essential: true })
  }, [p.flyTo])

  // ---------------------------------------------------------------- selection highlight
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current) return
    const s = p.selectedPlace
    ;(map.getSource('selection') as GeoJSONSource).setData(s ? {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: {} }],
    } : EMPTY)
  }, [p.selectedPlace])

  // ---------------------------------------------------------------- live pulses
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready.current || !p.live.length) return
    const newest = p.live[0]
    if (newest.lat == null || newest.lon == null) return
    livePoints.current = [...livePoints.current.filter((x) => performance.now() - x.t0 < 60_000),
      { lon: newest.lon, lat: newest.lat, t0: performance.now() }]
    if (anim.current == null) animate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.live])

  function animate() {
    const map = mapRef.current
    if (!map) return
    const now = performance.now()
    livePoints.current = livePoints.current.filter((x) => now - x.t0 < 60_000)
    const feats = livePoints.current.map((x) => ({
      type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [x.lon, x.lat] },
      properties: { phase: ((now - x.t0) % 1800) / 1800, age: (now - x.t0) / 60_000 },
    }))
    ;(map.getSource('live') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
    anim.current = feats.length ? requestAnimationFrame(animate) : null
  }

  // ---------------------------------------------------------------- loading
  async function load(force: boolean) {
    const map = mapRef.current
    if (!map || !ready.current) return
    const cur = props.current
    const level = levelFor(map.getZoom())
    const global = GLOBAL_LEVELS.includes(level)
    const bbox = global ? undefined : bboxString(map, 0.3)
    const key = [level, filtersKey(cur.filters), cur.lang, global ? '' : roundBbox(bbox!), cur.refreshKey].join('#')
    if (!force && key === lastKey.current) return
    lastKey.current = key
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    cur.onStats({ level, total: 0, shown: 0, loading: true, error: null })
    try {
      const fc = await api.aggregate(level, cur.filters, cur.lang, bbox, ctl.signal)
      if (ctl.signal.aborted) return
      const activity = fc.features.filter((f) => f.properties?.kind !== 'area_event' && f.properties?.kind !== 'event')
      const events = level === 'events' ? fc.features.map((f) => ({ ...f, properties: { ...f.properties,
        place: f.properties?.place ?? null } })) : []
      const areaEvents = fc.features.filter((f) => f.properties?.kind === 'area_event')
      const withRadius = [...areaEvents, ...events].filter((f) => (f.properties as Record<string, unknown> | null)?.radius_m)
      ;(map.getSource('activity') as GeoJSONSource).setData({ type: 'FeatureCollection', features: activity })
      ;(map.getSource('events') as GeoJSONSource).setData({ type: 'FeatureCollection', features: events })
      ;(map.getSource('area-points') as GeoJSONSource).setData({ type: 'FeatureCollection', features: areaEvents })
      ;(map.getSource('areas') as GeoJSONSource).setData({
        type: 'FeatureCollection',
        features: withRadius.map((f) => {
          const [lon, lat] = (f.geometry as Point).coordinates
          const pr = f.properties as Record<string, unknown>
          const poly = circlePolygon(lon, lat, Number(pr.radius_m))
          poly.properties = { category: pr.category }
          return poly
        }),
      })
      cur.onStats({ level, total: fc.meta?.total_events ?? fc.features.length, shown: fc.features.length, loading: false,
        error: null })
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      lastKey.current = ''
      cur.onStats({ level, total: 0, shown: 0, loading: false, error: (e as Error).message })
    }
  }

  return <div ref={el} className="globe" role="application" aria-label="Интерактивная карта событий" />
}

// ------------------------------------------------------------------------------------------------------------
function bboxString(map: MLMap, pad: number): string {
  const b = map.getBounds()
  let w = b.getWest(), e = b.getEast()
  const s = Math.max(-85, b.getSouth()), n = Math.min(85, b.getNorth())
  const dx = (e - w) * pad, dy = (n - s) * pad
  w -= dx; e += dx
  if (e - w >= 360) { w = -180; e = 180 }
  return [w, Math.max(-90, s - dy), e, Math.min(90, n + dy)].map((x) => x.toFixed(3)).join(',')
}

function roundBbox(b: string): string {
  return b.split(',').map((x) => Math.round(Number(x) * 4) / 4).join(',')
}

function addLayers(map: MLMap) {
  map.addSource('areas', { type: 'geojson', data: EMPTY })
  map.addSource('activity', { type: 'geojson', data: EMPTY })
  map.addSource('area-points', { type: 'geojson', data: EMPTY })
  map.addSource('events', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 38, clusterMaxZoom: 15 })
  map.addSource('selection', { type: 'geojson', data: EMPTY })
  map.addSource('live', { type: 'geojson', data: EMPTY })
  const countR: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 11, 5, 18, 20, 30, 100, 52]

  map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': '#ffb86b', 'fill-opacity': 0.08 } })
  map.addLayer({ id: 'areas-line', type: 'line', source: 'areas',
    paint: { 'line-color': '#ffb86b', 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } })
  map.addLayer({ id: 'activity-glow', type: 'circle', source: 'activity',
    paint: { 'circle-radius': ['*', 1.9, countR], 'circle-color': '#8ab4ff', 'circle-opacity': 0.14, 'circle-blur': 0.9 } })
  map.addLayer({ id: 'activity-circle', type: 'circle', source: 'activity',
    paint: { 'circle-radius': countR, 'circle-color': '#8ab4ff', 'circle-opacity': 0.88,
      'circle-stroke-color': 'rgba(255,255,255,0.85)', 'circle-stroke-width': ['case', ['>', ['get', 'fresh'], 0], 2.5, 1.2] } })
  map.addLayer({ id: 'activity-count', type: 'symbol', source: 'activity',
    layout: {
      'text-field': ['to-string', ['get', 'count']], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 12, 10, 17],
      'text-allow-overlap': true, 'text-ignore-placement': true,
    },
    paint: { 'text-color': '#0b1220', 'text-halo-color': 'rgba(255,255,255,0.35)', 'text-halo-width': 0.6 } })
  map.addLayer({ id: 'activity-label', type: 'symbol', source: 'activity',
    layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12.5,
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
      'text-radial-offset': ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 1.1, 5, 1.7, 20, 2.6, 100, 4.3],
      'symbol-sort-key': ['-', 0, ['get', 'count']], 'text-max-width': 10, 'text-padding': 3,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 1.4 } })
  map.addLayer({ id: 'area-point', type: 'circle', source: 'area-points',
    paint: { 'circle-radius': 7, 'circle-color': '#ffb86b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
  map.addLayer({ id: 'ev-cluster', type: 'circle', source: 'events', filter: ['has', 'point_count'],
    paint: { 'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'point_count']], 1, 14, 10, 34],
      'circle-color': '#8ab4ff', 'circle-opacity': 0.9, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } })
  map.addLayer({ id: 'ev-cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 13 },
    paint: { 'text-color': '#08142a' } })
  map.addLayer({ id: 'ev-point', type: 'circle', source: 'events', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-radius': 8, 'circle-color': '#8ab4ff', 'circle-stroke-width': 2.2,
      'circle-stroke-color': ['match', ['get', 'trust'], 'official', '#6fdca8', 'multiple_sources', '#8ab4ff', '#ffffff'] } })
  map.addLayer({ id: 'selection-ring', type: 'circle', source: 'selection',
    paint: { 'circle-radius': 26, 'circle-color': 'transparent', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9 } })
  map.addLayer({ id: 'live-pulse', type: 'circle', source: 'live',
    paint: { 'circle-radius': ['+', 8, ['*', 34, ['get', 'phase']]], 'circle-color': '#ff5c47',
      'circle-opacity': ['*', ['-', 1, ['get', 'phase']], ['-', 1, ['get', 'age']], 0.55],
      'circle-stroke-color': '#ff5c47', 'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['*', ['-', 1, ['get', 'phase']], ['-', 1, ['get', 'age']]] } })
}
