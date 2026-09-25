/** Default panel: the freshest events in the current view (so the globe is never "silent"). */
import { api } from '../../api/client'
import type { Category, Filters } from '../../api/types'
import { useFetch } from '../../app/useFetch'
import { EventRow, Skeleton } from '../../design/ui'
import { useI18n } from '../../i18n'
import type { EventItem } from '../../api/types'

export function LatestPanel({ bbox, filters, categories, refreshKey, onOpenEvent, collapsed, onToggle }: {
  bbox: string | null; filters: Filters; categories: Category[]; refreshKey: number; onOpenEvent: (id: number) => void
  collapsed: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n()
  const box = bbox ?? '-180,-85,180,85'
  const res = useFetch((signal) => api.aggregate('events', filters, lang, box, signal), [box, JSON.stringify(filters), lang, refreshKey])
  const items: EventItem[] = (res.data?.features ?? []).slice(0, 25).map((f) => {
    const p = f.properties as Record<string, unknown>
    return {
      id: Number(p.id), title: String(p.title), original_title: String(p.title), title_lang: null, summary: '',
      category: String(p.category), event_type: null, trust: p.trust as EventItem['trust'], sources: Number(p.sources),
      articles: Number(p.articles), independent: 0, first_seen: String(p.last), last_update: String(p.last),
      event_time: null, is_live: true, precision: String(p.precision), relation: String(p.relation),
      radius_m: (p.radius_m as number) ?? null, place_id: Number(p.place) || null, place_name: null, lat: null, lon: null,
      synthetic: Boolean(p.synthetic), source_types: [],
    }
  })
  return (
    <section className={`panel__inner latest ${collapsed ? 'is-collapsed' : ''}`}>
      <button type="button" className="latest__head" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="live-dot" />
        <span>{t.latest}</span>
        <span className="latest__count">{res.data?.features.length ?? ''}</span>
      </button>
      {!collapsed ? (
        <div className="panel__scroll">
          {!res.data && res.loading ? <Skeleton lines={5} /> : null}
          <ul className="event-list">
            {items.map((e) => <EventRow key={e.id} e={e} categories={categories} onOpen={onOpenEvent} showPlace={false} />)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
