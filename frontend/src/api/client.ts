import type { FeatureCollection } from 'geojson'
import type { Category, EventDetail, Filters, Health, Level, PlaceFeed, Pulse, SearchResult } from './types'

const cache = new Map<string, { at: number; data: unknown }>()
const TTL_MS = 20_000

function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  return u.toString()
}

export function filterParams(f: Filters): Record<string, string | undefined> {
  return {
    window: f.window,
    from: f.window === 'custom' ? f.from : undefined,
    to: f.window === 'custom' ? f.to : undefined,
    cats: f.cats.join(',') || undefined,
    sources: f.sources.join(',') || undefined,
  }
}

async function get<T>(path: string, signal?: AbortSignal, useCache = true): Promise<T> {
  const hit = cache.get(path)
  if (useCache && hit && Date.now() - hit.at < TTL_MS) return hit.data as T
  const res = await fetch(path, { signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${path}`)
  const data = (await res.json()) as T
  cache.set(path, { at: Date.now(), data })
  if (cache.size > 300) cache.delete(cache.keys().next().value as string)
  return data
}

export function invalidate(prefix = ''): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k)
}

export const api = {
  search: (q: string, lang: string, near?: { lat: number; lon: number }, signal?: AbortSignal) =>
    get<{ results: SearchResult[] }>(`/api/geo/search?${qs({ q, lang, lat: near?.lat, lon: near?.lon, limit: 10 })}`, signal),
  aggregate: (level: Level, f: Filters, lang: string, bbox?: string, signal?: AbortSignal) =>
    get<FeatureCollection & { meta?: { total_events: number } }>(
      `/api/map/aggregate?${qs({ level, lang, bbox, ...filterParams(f) })}`, signal),
  place: (id: number, f: Filters, lang: string, cursor?: string, signal?: AbortSignal) =>
    get<PlaceFeed>(`/api/places/${id}/events?${qs({ lang, cursor, ...filterParams(f) })}`, signal),
  event: (id: number, lang: string, signal?: AbortSignal) =>
    get<EventDetail>(`/api/events/${id}?${qs({ lang })}`, signal, false),
  categories: (lang: string) => get<Category[]>(`/api/categories?${qs({ lang })}`),
  health: () => get<Health>('/api/health', undefined, false),
  /** [lon, lat, population] of the largest cities: the lights of the night side */
  lights: () => get<[number, number, number][]>('/api/geo/lights'),
  pulse: (lang: string) => get<Pulse>(`/api/stats/pulse?${qs({ lang })}`, undefined, false),
}
