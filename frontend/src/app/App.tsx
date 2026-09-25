import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, invalidate } from '../api/client'
import type { Category, EventDetail, Filters, Health, LiveEvent, Place, SearchResult } from '../api/types'
import { Icon } from '../design/icons'
import { IconButton } from '../design/ui'
import { EventCard } from '../features/event/EventCard'
import { FilterBar } from '../features/filters/FilterBar'
import { LiveIndicator, Toasts } from '../features/live/Live'
import { LatestPanel } from '../features/place/LatestPanel'
import { PlacePanel } from '../features/place/PlacePanel'
import { SearchBar } from '../features/search/SearchBar'
import { setLang, useI18n } from '../i18n'
import { GlobeMap, levelFor, zoomFor, type CameraTarget, type MapStats } from '../map/GlobeMap'
import { DARK, LIGHT } from '../map/style'
import { update, useAppState } from './state'
import { useLive } from './useLive'

type Theme = 'dark' | 'light'
function initialTheme(): Theme {
  try {
    const s = localStorage.getItem('theme')
    if (s === 'dark' || s === 'light') return s
  } catch { /* storage unavailable */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const LEVEL_LABEL: Record<string, { ru: string; en: string }> = {
  continent: { ru: 'Континенты', en: 'Continents' }, country: { ru: 'Страны', en: 'Countries' },
  admin1: { ru: 'Регионы', en: 'Regions' }, admin2: { ru: 'Районы', en: 'Districts' },
  locality: { ru: 'Населённые пункты', en: 'Settlements' }, events: { ru: 'События', en: 'Events' },
}

function padBbox(bbox: string, pad: number, minSpanDeg: number): string {
  let [w, s, e, n] = bbox.split(',').map(Number)
  const dx = Math.max((e - w) * pad, (minSpanDeg - (e - w)) / 2, 0)
  const dy = Math.max((n - s) * pad, (minSpanDeg - (n - s)) / 2, 0)
  w -= dx; e += dx; s = Math.max(-90, s - dy); n = Math.min(90, n + dy)
  if (e - w >= 360) { w = -180; e = 180 }
  return [w, s, e, n].map((x) => x.toFixed(2)).join(',')
}

export function App() {
  const s = useAppState()
  const { t, lang } = useI18n()
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [categories, setCategories] = useState<Category[]>([])
  const [health, setHealth] = useState<Health | null>(null)
  const [camera, setCamera] = useState<{ lat: number; lon: number; zoom: number; bbox: string } | null>(null)
  const [flyTo, setFlyTo] = useState<CameraTarget | null>(null)
  const [placeGeo, setPlaceGeo] = useState<Place | null>(null)
  const [stats, setStats] = useState<MapStats | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [lastLive, setLastLive] = useState<LiveEvent | null>(null)
  const [latestCollapsed, setLatestCollapsed] = useState(() => window.innerWidth < 720)
  const refreshTimer = useRef<number | null>(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])
  useEffect(() => { api.categories(lang).then(setCategories).catch(() => setCategories([])) }, [lang])
  useEffect(() => {
    const load = () => api.health().then(setHealth).catch(() => setHealth(null))
    load()
    const h = setInterval(load, 30_000)
    return () => clearInterval(h)
  }, [])

  const onFilters = useCallback((f: Partial<Filters>) => update({ filters: { ...s.filters, ...f } }, 'replace'), [s.filters])

  const openPlace = useCallback((id: number, kind?: string, lat?: number, lon?: number, population = 0) => {
    update({ place: id, event: null })
    if (lat != null && lon != null && kind) setFlyTo({ lat, lon, zoom: zoomFor(kind, population), nonce: Date.now() })
  }, [])
  const openEvent = useCallback((id: number) => update({ event: id }), [])

  const onPick = useCallback((r: SearchResult) => {
    setPlaceGeo(null)
    openPlace(r.id, r.kind, r.lat, r.lon, r.population)
  }, [openPlace])

  const onPlaceLoaded = useCallback((p: Place) => {
    setPlaceGeo(p)
  }, [])
  const flewForPlace = useRef<number | null>(null)
  useEffect(() => {
    // deep link / breadcrumb navigation: fly once the place is known
    if (placeGeo && s.place === placeGeo.id && flewForPlace.current !== placeGeo.id) {
      flewForPlace.current = placeGeo.id
      if (!camera || Math.abs(camera.lat - placeGeo.lat) > 0.05 || Math.abs(camera.lon - placeGeo.lon) > 0.05) {
        setFlyTo({ lat: placeGeo.lat, lon: placeGeo.lon, zoom: zoomFor(placeGeo.kind, placeGeo.population), nonce: Date.now() })
      }
    }
  }, [placeGeo, s.place, camera])

  const onEventLoaded = useCallback((e: EventDetail) => {
    if (e.lat != null && e.lon != null && !s.place) {
      setFlyTo({ lat: e.lat, lon: e.lon, zoom: Math.max(camera?.zoom ?? 0, 9), nonce: Date.now() })
    }
  }, [s.place, camera?.zoom])

  const onCamera = useCallback((c: { lat: number; lon: number; zoom: number; bbox: string }) => {
    setCamera(c)
    update({ camera: { lat: c.lat, lon: c.lon, zoom: c.zoom } }, 'replace')
  }, [])

  // live area = viewport with a generous margin: a new event 15 km beyond the screen edge still deserves a toast
  const liveBbox = useMemo(() => (camera && camera.zoom >= 4 ? padBbox(camera.bbox, 1.0, 1.5) : null), [camera])
  const onLive = useCallback((ev: LiveEvent) => {
    setLastLive(ev)
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => { invalidate('/api/'); setRefreshKey((k) => k + 1) }, 1200)
  }, [])
  const live = useLive(s.filters, liveBbox, onLive)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') {
        if (s.event) update({ event: null })
        else if (s.place) update({ place: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.event, s.place])

  const palette = theme === 'dark' ? DARK : LIGHT
  const selected = useMemo(() => (placeGeo && s.place === placeGeo.id ? { id: placeGeo.id, lat: placeGeo.lat, lon: placeGeo.lon } : null),
    [placeGeo, s.place])
  const level = stats?.level ?? levelFor(camera?.zoom ?? s.camera?.zoom ?? 1.6)
  const panelOpen = Boolean(s.event || s.place)

  return (
    <div className={`app ${panelOpen ? 'has-panel' : ''}`}>
      <div className="space" aria-hidden />
      <GlobeMap filters={s.filters} lang={lang} palette={palette} categories={categories} selectedPlace={selected}
        initialCamera={s.camera} flyTo={flyTo} live={live.events} refreshKey={refreshKey}
        onSelectPlace={(id, kind, lat, lon) => openPlace(id, kind, lat, lon)} onSelectEvent={openEvent}
        onCamera={onCamera} onStats={setStats} />

      <header className="topbar">
        <div className="brand" title={t.tagline}>
          <span className="brand__mark"><Icon name="globe" size={22} /></span>
          <span className="brand__name">{t.appName}</span>
        </div>
        <SearchBar near={camera ? { lat: camera.lat, lon: camera.lon } : null} onPick={onPick} />
        <div className="topbar__actions">
          <LiveIndicator connected={live.connected} unseen={live.unseen} onClick={() => {
            live.markSeen()
            const ev = live.events[0]
            if (ev) openEvent(ev.id)
          }} />
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={t.theme} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
          <button type="button" className="icon-btn lang-btn" aria-label={t.lang} onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')}>
            {lang === 'ru' ? 'EN' : 'RU'}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <FilterBar filters={s.filters} categories={categories} onChange={onFilters} />
      </div>

      {health?.demo_mode || (health && health.sources.failing > 0) ? (
        <div className="banners">
          {health.demo_mode ? <div className="demo-banner" role="note"><Icon name="info" size={16} /> {t.demo}</div> : null}
          {health.sources.failing > 0 ? (
            <div className="demo-banner demo-banner--muted" role="status" title={t.sourcesDown(health.sources.failing, health.sources.enabled)}>
              <Icon name="info" size={16} /> {t.sourcesDown(health.sources.failing, health.sources.enabled)}
            </div>) : null}
        </div>) : null}

      <div className="map-status" aria-live="polite">
        <nav className="crumbs crumbs--map" aria-label="breadcrumb">
          <button type="button" onClick={() => { update({ place: null, event: null }); setFlyTo({ lat: 30, lon: 30, zoom: 1.4, nonce: Date.now() }) }}>
            <Icon name="globe" size={14} /> {t.earth}
          </button>
          {placeGeo && s.place === placeGeo.id ? [...placeGeo.breadcrumb.slice(1), { id: placeGeo.id, name: placeGeo.name, kind: placeGeo.kind }]
            .map((b) => <button key={b.id} type="button" onClick={() => openPlace(b.id)}>{b.name}</button>) : null}
        </nav>
        <span className="map-status__level">
          {LEVEL_LABEL[level]?.[lang] ?? level}
          {stats && !stats.loading && !stats.error ? ` · ${t.eventsCount(stats.total)} ${t.forWindow[s.filters.window]}` : ''}
          {stats?.loading ? <span className="spinner spinner--sm" /> : null}
          {stats?.error ? <span className="warn"> · {t.error}</span> : null}
          {level === 'continent' || level === 'country' ? <span className="hint"> · {t.zoomHint}</span> : null}
        </span>
      </div>

      <aside className={`panel ${panelOpen ? 'is-open' : 'is-latest'}`} aria-label="Панель">
        {s.event ? (
          <EventCard eventId={s.event} categories={categories} refreshKey={refreshKey}
            onBack={s.place ? () => update({ event: null }) : null} onClose={() => update({ event: null, place: null })}
            onOpenPlace={(id) => openPlace(id)} onOpenEvent={openEvent} onLoaded={onEventLoaded} />
        ) : s.place ? (
          <PlacePanel placeId={s.place} filters={s.filters} categories={categories} refreshKey={refreshKey}
            onOpenEvent={openEvent} onOpenPlace={(id) => openPlace(id)} onFilters={onFilters}
            onClose={() => update({ place: null })} onLoaded={onPlaceLoaded} />
        ) : (
          <LatestPanel bbox={camera && camera.zoom >= 3 ? camera.bbox : null} filters={s.filters} categories={categories}
            refreshKey={refreshKey} onOpenEvent={openEvent} collapsed={latestCollapsed}
            onToggle={() => setLatestCollapsed(!latestCollapsed)} />
        )}
      </aside>

      <Toasts incoming={lastLive} onOpen={openEvent} />
    </div>
  )
}
