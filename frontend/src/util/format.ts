import type { Lang } from '../i18n'

export function relTime(iso: string, lang: Lang, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
  if (Math.abs(s) < 60) return rtf.format(-Math.max(s, 0), 'second')
  const m = Math.round(s / 60)
  if (Math.abs(m) < 60) return rtf.format(-m, 'minute')
  const h = Math.round(m / 60)
  if (Math.abs(h) < 24) return rtf.format(-h, 'hour')
  return rtf.format(-Math.round(h / 24), 'day')
}

export function clock(iso: string, lang: Lang, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', timeZone: timeZone ?? undefined }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  }
}

export function dateTime(iso: string, lang: Lang, timeZone?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
  try {
    return new Intl.DateTimeFormat(lang, { ...opts, timeZone: timeZone ?? undefined }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat(lang, opts).format(new Date(iso))
  }
}

export function compact(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang, { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)
}

export function hostOf(url: string | null): string {
  if (!url) return ''
  try { return new URL(url).host } catch { return '' }
}
