/**
 * "Pulse of the planet": how much is happening right now (last hour, places today, a 24-hour sparkline, the busiest
 * categories) and a headline ticker that cycles through the freshest events worldwide.
 */
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { Category, Filters, Pulse } from '../../api/types'
import { useFetch } from '../../app/useFetch'
import { useI18n } from '../../i18n'
import { relTime } from '../../util/format'

export function PulseCard({ refreshKey, onCategory }: { refreshKey: number; onCategory: (slug: string) => void }) {
  const { t, lang } = useI18n()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const h = window.setInterval(() => setTick((x) => x + 1), 60_000)
    return () => window.clearInterval(h)
  }, [])
  const res = useFetch((signal) => api.pulse(lang).then((p) => (signal.aborted ? undefined : p)), [lang, refreshKey, tick])
  const p: Pulse | undefined = res.data ?? undefined
  if (!p) return null
  const max = Math.max(1, ...p.hourly)
  const day = p.hourly.reduce((a, b) => a + b, 0)
  const w = 132, h = 30, bw = w / p.hourly.length
  return (
    <section className="pulse" aria-label={t.pulseTitle}>
      <div className="pulse__head">
        <span className="pulse__beat" aria-hidden />
        <span className="pulse__title">{t.pulseTitle}</span>
      </div>
      <div className="pulse__body">
        <div className="pulse__numbers">
          {/* a quiet hour shows the day instead of a lonely zero */}
          <strong className="pulse__big">{p.last_hour || day}</strong>
          <span className="pulse__caption">{p.last_hour ? t.pulseHour : t.pulseDay}</span>
          <span className="pulse__caption pulse__caption--muted">{t.pulsePlaces(p.places_24h)}</span>
        </div>
        <svg className="pulse__spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
          aria-label={t.pulseSpark}>
          {p.hourly.map((n, i) => {
            const bh = Math.max(1.5, (n / max) * (h - 2))
            return <rect key={i} x={i * bw + 0.8} y={h - bh} width={bw - 1.6} height={bh} rx={1.2}
              className={i === p.hourly.length - 1 ? 'pulse__bar pulse__bar--now' : 'pulse__bar'} />
          })}
        </svg>
      </div>
      {p.top.length ? (
        <div className="pulse__cats">
          {p.top.slice(0, 3).map((c) => (
            <button key={c.category} type="button" className="pulse__cat" onClick={() => onCategory(c.category)}
              title={t.pulseFilter(c.name)}>
              <span className="pulse__dot" style={{ background: c.color }} />{c.name} <b>{c.count}</b>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

interface TickerItem { id: number; title: string; category: string; last: string }

export function Ticker({ filters, categories, refreshKey, onOpen }: {
  filters: Filters; categories: Category[]; refreshKey: number; onOpen: (id: number) => void }) {
  const { t, lang } = useI18n()
  const res = useFetch((signal) => api.aggregate('events', filters, lang, '-180,-85,180,85', signal),
    [JSON.stringify(filters), lang, refreshKey])
  const items: TickerItem[] = useMemo(() => (res.data?.features ?? []).slice(0, 12).map((f) => {
    const p = f.properties as Record<string, unknown>
    return { id: Number(p.id), title: String(p.title), category: String(p.category), last: String(p.last) }
  }), [res.data])
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || items.length < 2) return
    const h = window.setInterval(() => setI((x) => (x + 1) % items.length), 5200)
    return () => window.clearInterval(h)
  }, [paused, items.length])
  if (!items.length) return null
  const it = items[i % items.length]
  const color = categories.find((c) => c.slug === it.category)?.color ?? '#9aa3b5'
  return (
    <button type="button" className="ticker" onClick={() => onOpen(it.id)} onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      aria-label={`${t.tickerNow}: ${it.title}`}>
      <span className="ticker__label">{t.tickerNow}</span>
      <span className="ticker__dot" style={{ background: color }} />
      <span key={it.id} className="ticker__text">{it.title}</span>
      <span className="ticker__time">{relTime(it.last, lang)}</span>
    </button>
  )
}
