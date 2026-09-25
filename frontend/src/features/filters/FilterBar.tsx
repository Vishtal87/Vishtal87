/** Time window segmented control + category & source-type multi-select popovers + custom period. */
import { useEffect, useRef, useState } from 'react'
import type { Category, Filters, Window } from '../../api/types'
import { Icon } from '../../design/icons'
import { Chip } from '../../design/ui'
import { useI18n } from '../../i18n'

const WINDOWS: Window[] = ['now', '15m', '1h', '3h', '24h', '7d', 'custom']
const SOURCE_GROUPS = ['telegram', 'media', 'youtube', 'official', 'blogs', 'aggregators'] as const
const SOURCE_ICONS: Record<string, string> = { telegram: 'send', media: 'news', youtube: 'video', official: 'landmark',
  blogs: 'users', aggregators: 'layers' }

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return { open, setOpen, ref }
}

function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function FilterBar({ filters, categories, onChange }: { filters: Filters; categories: Category[]
  onChange: (f: Partial<Filters>) => void }) {
  const { t } = useI18n()
  const cats = usePopover()
  const srcs = usePopover()
  const period = usePopover()
  const [from, setFrom] = useState(toLocalInput(filters.from ?? new Date(Date.now() - 7 * 864e5).toISOString()))
  const [to, setTo] = useState(toLocalInput(filters.to))

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <div className="filters" role="toolbar" aria-label="Фильтры">
      <div className="segmented" role="radiogroup" aria-label="Время">
        {WINDOWS.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={filters.window === w}
            className={`segmented__btn ${filters.window === w ? 'is-on' : ''} ${w === 'now' ? 'segmented__btn--now' : ''}`}
            onClick={() => (w === 'custom' ? period.setOpen(true) : onChange({ window: w }))}>
            {w === 'now' ? <span className="live-dot" /> : null}
            {w === 'custom' ? <Icon name="clock" size={15} /> : null}
            {t.windows[w]}
          </button>
        ))}
      </div>
      {period.open ? (
        <div className="popover popover--period" ref={period.ref}>
          <label>{t.from}<input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>{t.to}<input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="popover__actions">
            <button type="button" className="btn btn--text" onClick={() => period.setOpen(false)}>{t.close}</button>
            <button type="button" className="btn btn--filled" onClick={() => {
              onChange({ window: 'custom', from: new Date(from).toISOString(), to: new Date(to).toISOString() })
              period.setOpen(false)
            }}>{t.apply}</button>
          </div>
        </div>
      ) : null}

      <div className="filters__group" ref={cats.ref}>
        <Chip icon="layers" selected={filters.cats.length > 0} onClick={() => cats.setOpen(!cats.open)}>
          {filters.cats.length ? `${t.categories} · ${filters.cats.length}` : t.categories}
        </Chip>
        {cats.open ? (
          <div className="popover" role="dialog" aria-label={t.categories}>
            <div className="popover__chips">
              {categories.map((c) => (
                <Chip key={c.slug} color={c.color} selected={filters.cats.includes(c.slug)}
                  onClick={() => onChange({ cats: toggle(filters.cats, c.slug) })}>{c.name}</Chip>
              ))}
            </div>
            <div className="popover__actions">
              <button type="button" className="btn btn--text" onClick={() => onChange({ cats: [] })}>{t.reset}</button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="filters__group" ref={srcs.ref}>
        <Chip icon="news" selected={filters.sources.length > 0} onClick={() => srcs.setOpen(!srcs.open)}>
          {filters.sources.length ? `${t.sources} · ${filters.sources.length}` : t.sources}
        </Chip>
        {srcs.open ? (
          <div className="popover" role="dialog" aria-label={t.sources}>
            <div className="popover__chips">
              {SOURCE_GROUPS.map((g) => (
                <Chip key={g} icon={SOURCE_ICONS[g]} selected={filters.sources.includes(g)}
                  onClick={() => onChange({ sources: toggle(filters.sources, g) })}>{t.sourceGroups[g]}</Chip>
              ))}
            </div>
            <div className="popover__actions">
              <button type="button" className="btn btn--text" onClick={() => onChange({ sources: [] })}>{t.reset}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
