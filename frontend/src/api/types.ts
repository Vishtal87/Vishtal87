export type Window = 'now' | '15m' | '1h' | '3h' | '24h' | '7d' | 'custom'
export type Level = 'continent' | 'country' | 'admin1' | 'admin2' | 'locality' | 'events'
export type Trust = 'official' | 'multiple_sources' | 'single_source' | 'unverified'

export interface Filters {
  window: Window
  from?: string
  to?: string
  cats: string[]
  sources: string[]
}

export interface Crumb { id: number; kind: string; name: string }

export interface Place {
  id: number
  kind: string
  place_class: string | null
  local_type: string | null
  name: string
  country_code: string | null
  population: number
  timezone: string | null
  lat: number
  lon: number
  breadcrumb: Crumb[]
}

export interface SearchResult extends Omit<Place, 'timezone'> {
  matched_name: string
  match: 'exact' | 'prefix' | 'fuzzy'
}

export interface EventItem {
  id: number
  title: string
  original_title: string
  title_lang: string | null
  summary: string
  category: string
  event_type: string | null
  trust: Trust
  sources: number
  articles: number
  independent: number
  first_seen: string
  last_update: string
  event_time: string | null
  is_live: boolean
  precision: string
  relation: string
  radius_m: number | null
  place_id: number | null
  place_name: string | null
  lat: number | null
  lon: number | null
  synthetic: boolean
  source_types: string[]
  distance_km?: number
}

export interface PlaceFeed {
  place: Place
  window: Window
  total: number
  by_category: Record<string, number>
  events: EventItem[]
  next_cursor: string | null
  region_wide: EventItem[]
  nearby: EventItem[]
  children: { id: number; kind: string; name: string; n: number }[]
}

export interface SourceRef {
  article_id: number
  source: { id: number; name: string; type: string; trust_tier: number; synthetic: boolean; access_model: string }
  url: string | null
  title: string
  excerpt: string
  lang: string | null
  media: string
  published_at: string
  fetched_at: string
  tz_assumed: boolean
  copy_of: number | null
  forwarded_from: string | null
  version: number
  versions: { version: number; title: string; published_at: string }[]
  location: { place_id: number | null; name: string | null; precision: string | null; relation: string | null
    confidence: number | null; outlier_km: number | null }
}

export interface TimelineItem {
  at: string
  kind: 'report' | 'official' | 'video' | 'copy' | 'update'
  source: string
  source_type: string
  title: string
  article_id: number
  first?: boolean
  superseded?: boolean
}

export interface EventDetail extends EventItem {
  place: Place | null
  trust_text: string
  trust_note: string
  location_confidence: number
  why_here: {
    precision: string; relation: string; radius_m: number | null; confidence: number
    agreeing_sources: number; total_sources: number
    anchor: { id: number; name: string; kind: string } | null
    matched_text: string | null; cues: Record<string, unknown> | null; reason: string | null
    alternatives: { id: number; name: string; kind: string; score: number }[]
    ambiguity: number | null
    point_hint: { origin: string; km: number; agrees: boolean } | null
    outliers: { article_id: number; km: number }[]
  }
  reports: SourceRef[]
  timeline: TimelineItem[]
  related: EventItem[]
}

export interface Category { slug: string; name: string; color: string; icon: string }

export interface LiveEvent {
  log_id: number
  op: 'created' | 'updated' | 'removed' | 'merged'
  id: number
  title: string
  category: string
  lat: number | null
  lon: number | null
  ancestors: number[]
  place_ru: string | null
  place_en: string | null
  trust_label: Trust
  source_count: number
  synthetic: boolean
  last_article_at: string
}

export interface Health {
  status: string
  realtime: { connected: boolean; subscribers: number }
  sources: { enabled: number; healthy: number; failing: number; synthetic: number }
  events: { active: number; last_event_at: string | null }
  demo_mode: boolean
}

export interface Pulse {
  last_hour: number
  places_24h: number
  hourly: number[]                  // new events per hour, oldest first, the current hour last
  top: { category: string; name: string; color: string; count: number }[]
}
