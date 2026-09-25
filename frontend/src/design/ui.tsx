/** Small shared UI building blocks (Material 3 flavoured). */
import type { ReactNode } from 'react'
import type { Category, EventItem, Trust } from '../api/types'
import { useI18n } from '../i18n'
import { relTime } from '../util/format'
import { Icon } from './icons'

export function Chip(props: { selected?: boolean; onClick?: () => void; children: ReactNode; icon?: string
  color?: string; title?: string; className?: string }) {
  return (
    <button type="button" className={`chip ${props.selected ? 'chip--on' : ''} ${props.className ?? ''}`}
      aria-pressed={props.selected} onClick={props.onClick} title={props.title}
      style={props.color ? ({ '--chip-accent': props.color } as React.CSSProperties) : undefined}>
      {props.icon ? <Icon name={props.icon} size={16} /> : null}
      {props.color && !props.icon ? <span className="chip__dot" /> : null}
      <span>{props.children}</span>
    </button>
  )
}

export function IconButton(props: { icon: string; label: string; onClick?: () => void; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${props.className ?? ''}`} aria-label={props.label} title={props.label}
      onClick={props.onClick}>
      <Icon name={props.icon} size={20} />
    </button>
  )
}

export function TrustBadge({ trust, compact }: { trust: Trust; compact?: boolean }) {
  const { t } = useI18n()
  const icon = trust === 'official' ? 'landmark' : trust === 'multiple_sources' ? 'check' : trust === 'unverified' ? 'info' : 'dot'
  return (
    <span className={`trust trust--${trust}`} title={t.trustNote}>
      <Icon name={icon} size={14} />
      {!compact && <span>{t.trust[trust]}</span>}
    </span>
  )
}

export function DemoTag() {
  const { t } = useI18n()
  return <span className="demo-tag" title={t.demo}>{t.demoShort}</span>
}

export function CategoryDot({ cat, categories }: { cat: string; categories: Category[] }) {
  const c = categories.find((x) => x.slug === cat)
  return (
    <span className="cat-icon" style={{ background: c?.color ?? '#9aa3b5' }} title={c?.name ?? cat}>
      <Icon name={c?.icon ?? 'dot'} size={15} />
    </span>
  )
}

export function EventRow({ e, categories, onOpen, showPlace = true }: { e: EventItem; categories: Category[]
  onOpen: (id: number) => void; showPlace?: boolean }) {
  const { t, lang } = useI18n()
  return (
    <li>
      <button type="button" className="event-row" onClick={() => onOpen(e.id)}>
        <CategoryDot cat={e.category} categories={categories} />
        <span className="event-row__body">
          <span className="event-row__title">{e.title}</span>
          <span className="event-row__meta">
            {showPlace && e.place_name ? <span className="event-row__place"><Icon name="pin" size={13} />{e.place_name}
              {e.relation === 'near' ? ` · ${t.relation.near.toLowerCase()}` : ''}</span> : null}
            <span>{relTime(e.last_update, lang)}</span>
            <span>{t.sourcesN(e.sources)}</span>
            {e.distance_km != null ? <span>{e.distance_km} км</span> : null}
          </span>
        </span>
        <span className="event-row__side">
          <TrustBadge trust={e.trust} compact />
          {e.synthetic ? <DemoTag /> : null}
        </span>
      </button>
    </li>
  )
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return <div className="skeleton" aria-busy="true">{Array.from({ length: lines }, (_, i) => <span key={i} />)}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div className="state state--error" role="alert">
      <Icon name="info" size={28} />
      <p>{t.error}</p>
      <small>{message}</small>
      <button type="button" className="btn btn--tonal" onClick={onRetry}>{t.retry}</button>
    </div>
  )
}
