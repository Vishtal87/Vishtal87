/** Event card: what, where, when, who reports it (with originals), how it unfolded, and why it is placed here. */
import { useState } from 'react'
import { api } from '../../api/client'
import type { Category, EventDetail } from '../../api/types'
import { useFetch } from '../../app/useFetch'
import { Icon, SOURCE_ICON } from '../../design/icons'
import { CategoryDot, DemoTag, ErrorState, EventRow, IconButton, Skeleton, TrustBadge } from '../../design/ui'
import { useI18n } from '../../i18n'
import { clock, dateTime, hostOf, relTime } from '../../util/format'

interface Props {
  eventId: number
  categories: Category[]
  refreshKey: number
  onBack: (() => void) | null
  onClose: () => void
  onOpenPlace: (id: number) => void
  onOpenEvent: (id: number) => void
  onLoaded: (e: EventDetail) => void
}

export function EventCard(p: Props) {
  const { t, lang } = useI18n()
  const [whyOpen, setWhyOpen] = useState(false)
  const ev = useFetch<EventDetail>((signal) => api.event(p.eventId, lang, signal).then((d) => { p.onLoaded(d); return d }),
    [p.eventId, lang, p.refreshKey])
  const d = ev.data
  const cat = d ? p.categories.find((c) => c.slug === d.category) : undefined
  const tz = d?.place?.timezone
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <article className="panel__inner" aria-live="polite">
      <header className="panel__header">
        {p.onBack ? <IconButton icon="back" label={t.back} onClick={p.onBack} /> : null}
        <div className="panel__heading">
          {d ? (
            <div className="event-card__badges">
              <span className="cat-chip" style={{ '--chip-accent': cat?.color } as React.CSSProperties}>
                <CategoryDot cat={d.category} categories={p.categories} />{cat?.name ?? d.category}
              </span>
              <TrustBadge trust={d.trust} />
              {d.synthetic ? <DemoTag /> : null}
            </div>
          ) : null}
          <h2 className="event-card__title">{d?.title ?? '…'}</h2>
          {d?.title_lang ? <span className="lang-note"><Icon name="lang" size={14} /> {d.title_lang.toUpperCase()}</span> : null}
        </div>
        <IconButton icon="close" label={t.close} onClick={p.onClose} />
      </header>

      {ev.error && !d ? <ErrorState message={ev.error} onRetry={ev.reload} /> : null}
      {!d && ev.loading ? <Skeleton lines={8} /> : null}

      {d ? (
        <div className="panel__scroll">
          <dl className="facts">
            <div>
              <dt><Icon name="pin" size={16} /></dt>
              <dd>
                {d.place ? (
                  <button type="button" className="link" onClick={() => p.onOpenPlace(d.place!.id)}>
                    {d.relation === 'near' && d.why_here.anchor ? t.nearCity(d.why_here.anchor.name) : d.place.name}
                  </button>
                ) : '—'}
                {d.place ? <small>{d.place.breadcrumb.slice(1).map((b) => b.name).join(' › ')}</small> : null}
              </dd>
            </div>
            <div>
              <dt><Icon name="clock" size={16} /></dt>
              <dd>
                <span>{t.happened}: {dateTime(d.event_time ?? d.first_seen, lang)}</span>
                {tz && tz !== userTz ? <small>{clock(d.event_time ?? d.first_seen, lang, tz)} {t.localTime}</small> : null}
                <small>{t.updated} {relTime(d.last_update, lang)}</small>
              </dd>
            </div>
            <div>
              <dt><Icon name="news" size={16} /></dt>
              <dd>
                <span>{t.sourcesN(d.sources)} · {t.independentN(d.independent)}</span>
                <small>{t.trustNote}</small>
              </dd>
            </div>
          </dl>

          {d.summary ? (
            <div className="section">
              <h3>{t.summary}</h3>
              <p className="summary">{d.summary}</p>
            </div>
          ) : null}

          <div className="section why">
            <button type="button" className="why__toggle" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)}>
              <Icon name="target" size={18} /> {t.whyHere}
              <span className="meter" title={`${t.confidence}: ${Math.round(d.why_here.confidence * 100)}%`}>
                <span style={{ width: `${Math.round(d.why_here.confidence * 100)}%` }} />
              </span>
              <Icon name="down" size={18} className={whyOpen ? 'rot' : ''} />
            </button>
            {whyOpen ? (
              <div className="why__body">
                <p><b>{t.relation[d.why_here.relation as keyof typeof t.relation] ?? d.why_here.relation}</b>
                  {d.why_here.radius_m ? ` · ${t.radius(Math.round(d.why_here.radius_m / 1000))}` : ''}</p>
                {d.why_here.matched_text ? <p>{t.matched}: «{d.why_here.matched_text}»
                  {d.why_here.cues && (d.why_here.cues as Record<string, string>).type_label
                    ? ` (${(d.why_here.cues as Record<string, string>).type_label})` : ''}</p> : null}
                {d.why_here.reason ? <p><small>{d.why_here.reason}</small></p> : null}
                <p>{t.agreeing(d.why_here.agreeing_sources, d.why_here.total_sources)}</p>
                <p>{t.confidence}: {Math.round(d.why_here.confidence * 100)}%</p>
                {d.why_here.outliers.length ? <p className="warn">{t.outliers(d.why_here.outliers.length)}</p> : null}
                {d.why_here.point_hint && !d.why_here.point_hint.agrees ? <p className="warn">{t.geotagConflict} ({d.why_here.point_hint.km} км)</p> : null}
                {d.why_here.alternatives.length ? (
                  <p><small>{t.alternatives}: {d.why_here.alternatives.map((a) => a.name).join(', ')}</small></p>) : null}
              </div>
            ) : null}
          </div>

          <div className="section">
            <h3>{t.sourcesTitle}</h3>
            <ul className="sources">
              {d.reports.map((s) => (
                <li key={s.article_id} className={`source ${s.copy_of ? 'source--copy' : ''}`}>
                  <div className="source__head">
                    <span className={`source__icon source__icon--${s.source.type}`}><Icon name={SOURCE_ICON[s.source.type] ?? 'news'} size={16} /></span>
                    <span className="source__name">{s.source.name}</span>
                    {s.source.synthetic ? <DemoTag /> : null}
                    <time dateTime={s.published_at} title={s.tz_assumed ? 'время без часового пояса в источнике' : undefined}>
                      {clock(s.published_at, lang)}
                    </time>
                  </div>
                  <p className="source__title">{s.title}</p>
                  {s.excerpt && s.excerpt !== s.title ? <p className="source__excerpt">{s.excerpt}</p> : null}
                  <div className="source__meta">
                    {s.copy_of ? <span className="tag"><Icon name="copy" size={13} /> {t.copyOf}</span> : null}
                    {s.version > 1 ? <span className="tag">{t.version(s.version)}</span> : null}
                    {s.lang && s.lang !== lang ? <span className="tag">{s.lang.toUpperCase()}</span> : null}
                    {s.media === 'video' ? <span className="tag"><Icon name="video" size={13} /> video</span> : null}
                    {s.location.outlier_km != null ? <span className="tag tag--warn">≠ {s.location.name} ({s.location.outlier_km} км)</span> : null}
                    {s.url ? (
                      <a className="btn btn--text btn--sm" href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                        {t.openOriginal} <Icon name="external" size={14} /><span className="sr-only"> ({hostOf(s.url)})</span>
                      </a>) : null}
                    <a className="provenance-link" href={`/api/articles/${s.article_id}/provenance`} target="_blank"
                      rel="noopener noreferrer" title={t.provenance}><Icon name="info" size={14} /></a>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="section">
            <h3>{t.timeline}</h3>
            <ol className="timeline">
              {d.timeline.map((it, i) => (
                <li key={`${it.article_id}-${i}`} className={`timeline__item timeline__item--${it.kind} ${it.superseded ? 'is-superseded' : ''}`}>
                  <time dateTime={it.at}>{clock(it.at, lang)}</time>
                  <div>
                    <span className="timeline__kind">{t.timelineKinds[it.kind]}{it.first ? ` · ${t.first}` : ''}</span>
                    <span className="timeline__src">{it.source}</span>
                    <span className="timeline__title">{it.title}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {d.related.length ? (
            <div className="section">
              <h3>{t.related}</h3>
              <ul className="event-list">
                {d.related.map((e) => <EventRow key={e.id} e={e} categories={p.categories} onOpen={p.onOpenEvent} />)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
