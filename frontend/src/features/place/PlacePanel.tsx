/** Feed of one geographic point — from a country down to a hamlet of 50 people. */
import { useState } from 'react'
import { api } from '../../api/client'
import type { Category, EventItem, Filters, Place, PlaceFeed } from '../../api/types'
import { useFetch } from '../../app/useFetch'
import { Icon } from '../../design/icons'
import { Chip, ErrorState, EventRow, IconButton, Skeleton } from '../../design/ui'
import { useI18n } from '../../i18n'
import { compact } from '../../util/format'

interface Props {
  placeId: number
  filters: Filters
  categories: Category[]
  refreshKey: number
  onOpenEvent: (id: number) => void
  onOpenPlace: (id: number) => void
  onFilters: (f: Partial<Filters>) => void
  onClose: () => void
  onLoaded: (p: Place) => void
}

export function PlacePanel(p: Props) {
  const { t, lang } = useI18n()
  const [more, setMore] = useState<EventItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const feed = useFetch<PlaceFeed>((signal) => api.place(p.placeId, p.filters, lang, undefined, signal).then((d) => {
    setMore([]); setCursor(d.next_cursor); p.onLoaded(d.place); return d
  }), [p.placeId, JSON.stringify(p.filters), lang, p.refreshKey])

  const d = feed.data
  const place = d?.place
  const typeLabel = place ? (place.local_type ?? (place.place_class && t.classes[place.place_class]) ?? t.kinds[place.kind] ?? place.kind) : ''

  const loadMore = async () => {
    if (!cursor) return
    const next = await api.place(p.placeId, p.filters, lang, cursor)
    setMore((m) => [...m, ...next.events])
    setCursor(next.next_cursor)
  }

  return (
    <section className="panel__inner" aria-live="polite">
      <header className="panel__header">
        <div className="panel__heading">
          <span className="overline">{typeLabel}{place && place.population > 0 ? ` · ${compact(place.population, lang)} ${t.population}` : ''}</span>
          <h2>{place?.name ?? '…'}</h2>
          {place ? (
            <nav className="crumbs" aria-label="breadcrumb">
              {place.breadcrumb.map((b) => (
                <button key={b.id} type="button" onClick={() => p.onOpenPlace(b.id)}>{b.name}</button>
              ))}
            </nav>
          ) : null}
        </div>
        <IconButton icon="close" label={t.close} onClick={p.onClose} />
      </header>

      {feed.error && !d ? <ErrorState message={feed.error} onRetry={feed.reload} /> : null}
      {!d && feed.loading ? <Skeleton lines={6} /> : null}

      {d ? (
        <div className="panel__scroll">
          <div className="stat">
            <span className="stat__num">{d.total}</span>
            <span className="stat__label">{t.eventsCount(d.total).replace(/^\d+\s/, '')} {t.forWindow[d.window]}</span>
            {feed.loading ? <span className="spinner" aria-label={t.loading} /> : null}
          </div>
          {Object.keys(d.by_category).length > 0 ? (
            <div className="chips-row">
              {Object.entries(d.by_category).sort((a, b) => b[1] - a[1]).map(([slug, n]) => {
                const c = p.categories.find((x) => x.slug === slug)
                return (
                  <Chip key={slug} color={c?.color} selected={p.filters.cats.includes(slug)}
                    onClick={() => p.onFilters({ cats: p.filters.cats.includes(slug) ? p.filters.cats.filter((x) => x !== slug) : [slug] })}>
                    {c?.name ?? slug} · {n}
                  </Chip>
                )
              })}
            </div>
          ) : null}

          {d.children.length > 0 ? (
            <div className="section">
              <h3>{t.subplaces}</h3>
              <div className="chips-row">
                {d.children.map((c) => (
                  <Chip key={c.id} icon="pin" onClick={() => p.onOpenPlace(c.id)}>{c.name} · {c.n}</Chip>
                ))}
              </div>
            </div>
          ) : null}

          {d.total === 0 ? (
            <div className="state state--empty">
              <Icon name="globe" size={36} />
              <p>{t.noEvents}</p>
              <small>{t.noEventsHint}</small>
              <div className="state__actions">
                {d.window !== '7d' ? <button type="button" className="btn btn--tonal" onClick={() => p.onFilters({ window: '7d' })}>{t.widen}</button> : null}
                {place && place.breadcrumb.length > 1 ? (
                  <button type="button" className="btn btn--text" onClick={() => p.onOpenPlace(place.breadcrumb[place.breadcrumb.length - 1].id)}>
                    {t.showParent}: {place.breadcrumb[place.breadcrumb.length - 1].name}
                  </button>) : null}
              </div>
            </div>
          ) : (
            <div className="section">
              <h3>{t.inside}</h3>
              <ul className="event-list">
                {[...d.events, ...more].map((e) => (
                  <EventRow key={e.id} e={e} categories={p.categories} onOpen={p.onOpenEvent}
                    showPlace={e.place_id !== p.placeId} />
                ))}
              </ul>
              {cursor ? <button type="button" className="btn btn--text btn--block" onClick={loadMore}>{t.loadMore}</button> : null}
            </div>
          )}

          {d.region_wide.length > 0 ? (
            <div className="section">
              <h3>{t.regionWide}</h3>
              <ul className="event-list">
                {d.region_wide.map((e) => <EventRow key={e.id} e={e} categories={p.categories} onOpen={p.onOpenEvent} />)}
              </ul>
            </div>
          ) : null}
          {d.nearby.length > 0 ? (
            <div className="section">
              <h3>{t.nearby}</h3>
              <ul className="event-list">
                {d.nearby.map((e) => <EventRow key={e.id} e={e} categories={p.categories} onOpen={p.onOpenEvent} />)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
