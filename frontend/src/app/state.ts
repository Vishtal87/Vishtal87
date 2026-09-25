/** URL-backed app state: every view (place, event, filters, camera) is a shareable link. */
import { useSyncExternalStore } from 'react'
import type { Filters, Window } from '../api/types'

export interface AppState {
  place: number | null
  event: number | null
  filters: Filters
  camera: { lat: number; lon: number; zoom: number } | null
}

const WINDOWS: Window[] = ['now', '15m', '1h', '3h', '24h', '7d', 'custom']

function parse(): AppState {
  const q = new URLSearchParams(location.search)
  const num = (k: string) => (q.get(k) ? Number(q.get(k)) : null)
  const w = q.get('w') as Window
  const cam = q.get('c')?.split(',').map(Number)
  return {
    place: num('place'),
    event: num('event'),
    filters: {
      window: WINDOWS.includes(w) ? w : '24h',
      from: q.get('from') ?? undefined,
      to: q.get('to') ?? undefined,
      cats: q.get('cats')?.split(',').filter(Boolean) ?? [],
      sources: q.get('src')?.split(',').filter(Boolean) ?? [],
    },
    camera: cam && cam.length === 3 && cam.every(Number.isFinite) ? { lat: cam[0], lon: cam[1], zoom: cam[2] } : null,
  }
}

function serialize(s: AppState): string {
  const q = new URLSearchParams()
  if (s.place) q.set('place', String(s.place))
  if (s.event) q.set('event', String(s.event))
  if (s.filters.window !== '24h') q.set('w', s.filters.window)
  if (s.filters.window === 'custom') {
    if (s.filters.from) q.set('from', s.filters.from)
    if (s.filters.to) q.set('to', s.filters.to)
  }
  if (s.filters.cats.length) q.set('cats', s.filters.cats.join(','))
  if (s.filters.sources.length) q.set('src', s.filters.sources.join(','))
  if (s.camera) q.set('c', [s.camera.lat.toFixed(4), s.camera.lon.toFixed(4), s.camera.zoom.toFixed(2)].join(','))
  const str = q.toString()
  return str ? `?${str}` : location.pathname
}

let state = parse()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

window.addEventListener('popstate', () => { state = parse(); emit() })

/** push = new history entry (navigation: place/event); replace = camera moves, filter tweaks */
export function update(patch: Partial<AppState>, mode: 'push' | 'replace' = 'push'): void {
  state = { ...state, ...patch, filters: { ...state.filters, ...(patch.filters ?? {}) } }
  const url = serialize(state)
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(null, '', url)
  emit()
}

export function useAppState(): AppState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => state)
}

export function getState(): AppState { return state }
