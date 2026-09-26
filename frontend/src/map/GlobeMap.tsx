/**
 * The globe. Imperative MapLibre inside React: sources are updated with setData, React only passes intent.
 * World view (zoom < 3.4): countries tinted by activity + hotspots at every place with news, the real night side
 * with city lights, slow rotation while nobody touches the map. Closer: regions -> settlements -> single events.
 */
import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, ImageSource, Map as MLMap, MapLayerMouseEvent, VectorTileSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { api } from '../api/client'
import type { Category, Filters, Level, LiveEvent } from '../api/types'
import { baseStyle, LIGHT, skySpec, type Palette } from './style'
import { nightImage, nightness, subsolarPoint, sunSine, WORLD_MERCATOR } from './sun'

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
  autoRotate: boolean
  onSelectPlace: (id: number, kind: string, lat: number, lon: number) => void
  onSelectEvent: (id: number) => void
  onCamera: (c: { lat: number; lon: number; zoom: number; bbox: string }) => void
  onStats: (s: MapStats) => void
}

// MapLibre 6 runs its tile parsing in a module worker that imports a shared chunk: `?worker&url` makes Vite bundle
// the worker with its imports into one self-contained file (plain `?url` would copy the entry file alone -> 404 in prod).
maplibregl.setWorkerUrl(workerUrl)

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const WORLD_ZOOM = 3.4
const IDLE_MS = 12_000                 // rotation starts after this long without a touch
const DEG_PER_MS = 360 / (240 * 1000)  // one turn in 4 minutes
const RECENT_MS = 60 * 60_000          // hotspots updated within the last hour pulse
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

export function levelFor(zoom: number): Level {
  if (zoom < WORLD_ZOOM) return 'country'
  if (zoom < 5.2) return 'admin1'
  if (zoom < 8.4) return 'locality'
  return 'events'
}

export function zoomFor(kind: string, population = 0): number {
  switch (kind) {
    case 'continent': return 2.4
    case 'country': return population > 50_000_000 ? 3.5 : 4.6
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
  map.setPaintProperty('coast-glow', 'line-color', pal.glow)
  map.setPaintProperty('coast-glow', 'line-opacity',
    ['interpolate', ['linear'], ['zoom'], 0, pal.glowOpacity, 5, pal.glowOpacity * 0.35, 7.5, 0])
  map.setPaintProperty('place-dots', 'circle-color', pal.dots)
  map.setPaintProperty('place-labels', 'text-halo-color', pal.halo)
  map.setPaintProperty('place-labels', 'text-color', pal.label)
  map.setPaintProperty('city-lights', 'circle-color', pal.lights)
  // activity names must stay readable over land and water in both themes
  const light = pal === LIGHT
  for (const id of ['activity-label', 'hot-label']) {
    map.setPaintProperty(id, 'text-color', light ? '#1b2230' : '#ffffff')
    map.setPaintProperty(id, 'text-halo-color', light ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.65)')
  }
  map.setSky(skySpec(pal)!)
}

function applyCategoryColors(map: MLMap, categories: Category[]) {
  if (!categories.length) return
  map.setPaintProperty('activity-circle', 'circle-color', colorExpr(categories, 'top_category'))
  map.setPaintProperty('activity-glow', 'circle-color', colorExpr(categories, 'top_category'))
  map.setPaintProperty('ev-point', 'circle-color', colorExpr(categories, 'category'))
  map.setPaintProperty('area-point', 'circle-color', colorExpr(categories, 'category'))
  for (const id of ['hot-glow', 'hot-core', 'hot-pulse']) {
    map.setPaintProperty(id, id === 'hot-pulse' ? 'circle-stroke-color' : 'circle-color', colorExpr(categories, 'top_category'))
  }
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
  const lights = useRef<[number, number, number][]>([])
  const lastTouch = useRef(performance.now())
  const hasRecent = useRef(false)

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
      addLayers(map, props.current.palette)
      ready.current = true
      applyCategoryColors(map, props.current.categories)
      applyPalette(map, props.current.palette)
      refreshNight()
      api.lights().then((l) => { lights.current = l; refreshNight() }).catch(() => undefined)
      const c = map.getCenter()
      props.current.onCamera({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), bbox: bboxString(map, 0) })
      load(true)
    })
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'map-tip', offset: 12 })
    const interactive = ['activity-circle', 'area-point', 'ev-point', 'ev-cluster', 'hot-core']
    for (const id of interactive) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; popup.remove() })
      map.on('mousemove', id, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const pr = f.properties as Record<string, unknown>
        const text = id === 'activity-circle' || id === 'hot-core' ? `${pr.name} · ${pr.count}`
          : id === 'ev-cluster' ? `${pr.point_count}` : String(pr.title ?? '')
        popup.setLngLat(e.lngLat).setText(text).addTo(map)
      })
    }
    for (const id of ['activity-circle', 'hot-core']) {
      map.on('click', id, (e: MapLayerMouseEvent) => {
        const f = e.features?.[0]
        if (!f) return
        const pr = f.properties as Record<string, unknown>
        const [lon, lat] = (f.geometry as Point).coordinates
        props.current.onSelectPlace(Number(pr.id), String(pr.kind), lat, lon)
      })
    }
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
    const touched = () => { lastTouch.current = performance.now() }
    for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart', 'rotatestart', 'pitchstart'] as const) map.on(ev, touched)
    map.on('moveend', (e) => {
      if ((e as unknown as { autoRotate?: boolean }).autoRotate) return   // our own rotation: nothing to reload
      const c = map.getCenter()
      props.current.onCamera({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), bbox: bboxString(map, 0) })
      load(false)
    })

    // one animation loop: idle rotation + pulse of recent hotspots
    let raf = 0, prev = 0, lastPulse = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      if (!ready.current || document.hidden) { prev = t; return }
      const dt = prev ? Math.min(t - prev, 100) : 16
      prev = t
      const still = reducedMotion()
      if (props.current.autoRotate && !still && t - lastTouch.current > IDLE_MS && map.getZoom() < WORLD_ZOOM - 0.2
          && !map.isMoving()) {
        const c = map.getCenter()
        map.jumpTo({ center: [c.lng + dt * DEG_PER_MS, c.lat] }, { autoRotate: true })
      }
      if (hasRecent.current && !still && t - lastPulse > 40) {
        lastPulse = t
        const phase = (t % 2200) / 2200
        map.setPaintProperty('hot-pulse', 'circle-radius', ['+', ['interpolate', ['linear'], ['sqrt', ['get', 'count']],
          1, 5, 20, 12], 4 + 22 * phase])
        map.setPaintProperty('hot-pulse', 'circle-stroke-opacity', 0.9 * (1 - phase))
      }
    }
    raf = requestAnimationFrame(tick)
    const nightTimer = window.setInterval(refreshNight, 60_000)

    return () => {
      abort.current?.abort()
      cancelAnimationFrame(raf)
      window.clearInterval(nightTimer)
      if (anim.current) cancelAnimationFrame(anim.current)
      map.remove()
      mapRef.current = null
      ready.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- the night side and city lights (every minute)
  function refreshNight() {
    const map = mapRef.current
    if (!map || !ready.current) return
    const pal = props.current.palette
    const now = new Date()
    const url = nightImage(now, pal.night, pal.nightAlpha)
    if (url) (map.getSource('night') as ImageSource | undefined)?.updateImage({ url, coordinates: WORLD_MERCATOR })
    const sun = subsolarPoint(now)
    const feats = []
    for (const [lon, lat, pop] of lights.current) {
      const n = nightness(sunSine(lat, lon, sun))
      if (n > 0.05) feats.push({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [lon, lat] },
        properties: { n, p: pop } })
    }
    ;(map.getSource('lights') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
  }

  // ---------------------------------------------------------------- palette & language of base labels
  useEffect(() => {
    const map = mapRef.current
    if (map && ready.current) { applyPalette(map, p.palette); refreshNight() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    lastTouch.current = performance.now()
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
    const world = level === 'country'
    const bbox = world ? undefined : bboxString(map, 0.3)
    const key = [level, filtersKey(cur.filters), cur.lang, world ? '' : roundBbox(bbox!), cur.refreshKey].join('#')
    if (!force && key === lastKey.current) return
    lastKey.current = key
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    cur.onStats({ level, total: 0, shown: 0, loading: true, error: null })
    try {
      if (world) {
        // countries tinted by how much is going on + a hotspot at every place with news, worldwide
        const [countries, places] = await Promise.all([
          api.aggregate('country', cur.filters, cur.lang, undefined, ctl.signal),
          api.aggregate('locality', cur.filters, cur.lang, undefined, ctl.signal),
        ])
        if (ctl.signal.aborted) return
        setCountryHeat(map, countries.features)
        const now = Date.now()
        const hot = places.features.filter((f) => f.properties?.kind === 'locality').map((f) => ({ ...f, properties: {
          ...f.properties, recent: now - Date.parse(String(f.properties?.last)) < RECENT_MS ? 1 : 0 } }))
        hasRecent.current = hot.some((f) => f.properties.recent)
        ;(map.getSource('hotspots') as GeoJSONSource).setData({ type: 'FeatureCollection', features: hot })
        for (const id of ['activity', 'events', 'area-points', 'areas']) (map.getSource(id) as GeoJSONSource).setData(EMPTY)
        map.setFilter('place-labels', null)
        cur.onStats({ level, total: countries.meta?.total_events ?? 0, shown: hot.length, loading: false, error: null })
        return
      }
      const fc = await api.aggregate(level, cur.filters, cur.lang, bbox, ctl.signal)
      if (ctl.signal.aborted) return
      setCountryHeat(map, [])
      hasRecent.current = false
      ;(map.getSource('hotspots') as GeoJSONSource).setData(EMPTY)
      const activity = fc.features.filter((f) => f.properties?.kind !== 'area_event' && f.properties?.kind !== 'event')
      const events = level === 'events' ? fc.features.map((f) => ({ ...f, properties: { ...f.properties,
        place: f.properties?.place ?? null } })) : []
      const areaEvents = fc.features.filter((f) => f.properties?.kind === 'area_event')
      const withRadius = [...areaEvents, ...events].filter((f) => (f.properties as Record<string, unknown> | null)?.radius_m)
      ;(map.getSource('activity') as GeoJSONSource).setData({ type: 'FeatureCollection', features: activity })
      // a place with an activity bubble is already named by it: hide the base-map label underneath (no doubles)
      const named = activity.map((f) => f.properties?.id).filter((id): id is number => typeof id === 'number')
      map.setFilter('place-labels', named.length ? ['!', ['in', ['get', 'id'], ['literal', named]]] : null)
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
const COOL = [46, 104, 230], WARM = [118, 176, 255]    // countries with news light up: the more, the brighter

function setCountryHeat(map: MLMap, countries: Feature[]) {
  const counts = countries.map((f) => [Number(f.properties?.id), Number(f.properties?.count) || 0] as const)
  const max = Math.max(1, ...counts.map(([, n]) => n))
  const heat = counts.map(([id, n]) => [id, Math.sqrt(n / max)] as const)
  const color = heat.flatMap(([id, t]) => [id, `rgb(${COOL.map((c, i) => Math.round(c + (WARM[i] - c) * t)).join(',')})`])
  const opacity = heat.flatMap(([id, t]) => [id, 0.08 + 0.2 * t])
  const expr = (pairs: (number | string)[], fallback: number | string) =>
    (pairs.length ? ['match', ['get', 'id'], ...pairs, fallback] : fallback) as unknown as maplibregl.ExpressionSpecification
  map.setPaintProperty('country-heat', 'fill-color', expr(color, '#000000'))
  map.setPaintProperty('country-heat', 'fill-opacity', expr(opacity, 0))
}

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

const lightsOpacity = (k: number): maplibregl.ExpressionSpecification =>
  ['*', k, ['get', 'n'], ['interpolate', ['linear'], ['get', 'p'], 30000, 0.45, 1000000, 0.9]]

function addLayers(map: MLMap, pal: Palette) {
  map.addSource('night', { type: 'image', url: nightImage(new Date(), pal.night, pal.nightAlpha), coordinates: WORLD_MERCATOR })
  map.addSource('lights', { type: 'geojson', data: EMPTY })
  map.addSource('hotspots', { type: 'geojson', data: EMPTY })
  map.addSource('areas', { type: 'geojson', data: EMPTY })
  map.addSource('activity', { type: 'geojson', data: EMPTY })
  map.addSource('area-points', { type: 'geojson', data: EMPTY })
  map.addSource('events', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 38, clusterMaxZoom: 15 })
  map.addSource('selection', { type: 'geojson', data: EMPTY })
  map.addSource('live', { type: 'geojson', data: EMPTY })
  const countR: maplibregl.ExpressionSpecification = ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 11, 5, 18, 20, 30, 100, 52]

  // under the base labels: activity tint of countries, the night, the lights of cities at night
  map.addLayer({ id: 'country-heat', type: 'fill', source: 'base', 'source-layer': 'countries', maxzoom: WORLD_ZOOM + 0.6,
    paint: { 'fill-color': '#ff8a4c', 'fill-opacity': 0, 'fill-opacity-transition': { duration: 600 } } }, 'coast-glow')
  map.addLayer({ id: 'night', type: 'raster', source: 'night',
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 0, 1, 6, 0.85, 9, 0.5], 'raster-fade-duration': 0,
      'raster-resampling': 'linear' } }, 'place-dots')
  map.addLayer({ id: 'city-lights', type: 'circle', source: 'lights', maxzoom: 7.5,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'],
        1, ['interpolate', ['linear'], ['get', 'p'], 30000, 0.5, 1000000, 1.5, 10000000, 3.2],
        6, ['interpolate', ['linear'], ['get', 'p'], 30000, 1.2, 1000000, 3.5, 10000000, 7]],
      'circle-color': pal.lights, 'circle-blur': 0.9,
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0, lightsOpacity(0.9), 5.5, lightsOpacity(0.6), 7.5, 0],
    } }, 'place-dots')

  map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': '#ffb86b', 'fill-opacity': 0.08 } })
  map.addLayer({ id: 'areas-line', type: 'line', source: 'areas',
    paint: { 'line-color': '#ffb86b', 'line-width': 1.4, 'line-dasharray': [2, 2], 'line-opacity': 0.8 } })
  map.addLayer({ id: 'activity-glow', type: 'circle', source: 'activity',
    paint: { 'circle-radius': ['*', 2.1, countR], 'circle-color': '#8ab4ff', 'circle-opacity': 0.2, 'circle-blur': 1 } })
  map.addLayer({ id: 'activity-circle', type: 'circle', source: 'activity',
    paint: { 'circle-radius': countR, 'circle-color': '#8ab4ff', 'circle-opacity': 0.9,
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

  // world view hotspots: a glow sized by the amount of news, a bright core, a ring pulsing while it is fresh
  const hotR = (lo: number, hi: number): maplibregl.ExpressionSpecification =>
    ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, lo, 5, (lo + hi) / 2.2, 20, hi]
  map.addLayer({ id: 'hot-glow', type: 'circle', source: 'hotspots',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, hotR(11, 34), 3.4, hotR(16, 52)],
      'circle-color': '#8ab4ff', 'circle-opacity': 0.42, 'circle-blur': 0.85 } })
  map.addLayer({ id: 'hot-pulse', type: 'circle', source: 'hotspots', filter: ['==', ['get', 'recent'], 1],
    paint: { 'circle-radius': 10, 'circle-color': 'transparent', 'circle-stroke-width': 1.6, 'circle-stroke-color': '#8ab4ff',
      'circle-stroke-opacity': 0.6 } })
  map.addLayer({ id: 'hot-core', type: 'circle', source: 'hotspots',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, hotR(2.8, 6), 3.4, hotR(3.6, 8)],
      'circle-color': '#8ab4ff', 'circle-opacity': 0.95, 'circle-stroke-color': 'rgba(255,255,255,0.9)',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 3.4, 1.2] } })
  map.addLayer({ id: 'hot-label', type: 'symbol', source: 'hotspots', filter: ['>=', ['get', 'count'], 2],
    layout: {
      'text-field': ['concat', ['get', 'name'], ' · ', ['to-string', ['get', 'count']]], 'text-font': ['Noto Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['sqrt', ['get', 'count']], 1, 11, 10, 13.5],
      'text-variable-anchor': ['top', 'bottom', 'left', 'right'], 'text-radial-offset': 0.9,
      'symbol-sort-key': ['-', 0, ['get', 'count']], 'text-padding': 6, 'text-max-width': 12,
    },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.65)', 'text-halo-width': 1.4, 'text-opacity': 0.92 } })

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
