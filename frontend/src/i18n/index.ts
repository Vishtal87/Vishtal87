/** Minimal i18n: UI strings in ru/en; content (news) stays in its original language. */
import { useSyncExternalStore } from 'react'

const ru = {
  appName: 'Pulse',
  tagline: 'Живая карта событий',
  searchPlaceholder: 'Страна, регион, город, деревня…',
  searchEmpty: 'Ничего не найдено. Попробуйте другое написание.',
  earth: 'Земля',
  live: 'LIVE',
  liveNew: (n: number) => `${n} ${plural(n, 'новое', 'новых', 'новых')}`,
  reconnecting: 'Переподключение…',
  windows: { now: 'Сейчас', '15m': '15 мин', '1h': '1 час', '3h': '3 часа', '24h': '24 часа', '7d': '7 дней', custom: 'Период' },
  categories: 'Категории',
  allCategories: 'Все категории',
  sources: 'Источники',
  sourceGroups: { telegram: 'Telegram', media: 'СМИ и ТВ', youtube: 'YouTube', official: 'Официальные', blogs: 'Блоги', aggregators: 'Агрегаторы' },
  from: 'С', to: 'По', apply: 'Применить', reset: 'Сбросить', close: 'Закрыть', back: 'Назад',
  eventsCount: (n: number) => `${n} ${plural(n, 'событие', 'события', 'событий')}`,
  forWindow: { now: 'прямо сейчас', '15m': 'за 15 минут', '1h': 'за час', '3h': 'за 3 часа', '24h': 'за 24 часа', '7d': 'за 7 дней', custom: 'за период' },
  noEvents: 'Сейчас нет доступных материалов',
  noEventsHint: 'Для этого места за выбранный период публикаций не найдено.',
  widen: 'Показать за 7 дней',
  showParent: 'Показать весь регион',
  regionWide: 'По региону целиком',
  nearby: 'Рядом',
  inside: 'События здесь',
  subplaces: 'Где происходит',
  loadMore: 'Показать ещё',
  sourcesN: (n: number) => `${n} ${plural(n, 'источник', 'источника', 'источников')}`,
  independentN: (n: number) => `${n} незав.`,
  updated: 'Обновлено',
  happened: 'Произошло',
  firstReport: 'Первое сообщение',
  localTime: 'местное время',
  trust: {
    official: 'Официальный источник',
    multiple_sources: 'Несколько независимых источников',
    single_source: 'Один источник',
    unverified: 'Не подтверждено',
  },
  trustNote: 'Метка показывает, кто сообщает. Это не подтверждение достоверности.',
  summary: 'Кратко',
  sourcesTitle: 'Источники',
  openOriginal: 'Открыть оригинал',
  copyOf: 'Копия / пересылка',
  forwarded: 'Переслано из',
  version: (v: number) => `Версия ${v}`,
  timeline: 'Хронология',
  timelineKinds: { report: 'Сообщение', official: 'Официальное сообщение', video: 'Видео', copy: 'Пересылка', update: 'Обновление' },
  first: 'первое',
  whyHere: 'Почему здесь?',
  confidence: 'Уверенность',
  matched: 'Найдено в тексте',
  agreeing: (a: number, t: number) => `${a} из ${t} источников указывают это место`,
  relation: { in: 'В населённом пункте', near: 'Рядом с ориентиром', region: 'По региону в целом', source_area: 'По местоположению источника', coordinates: 'По координатам', about: 'Упоминание организации' },
  radius: (km: number) => `радиус ~${km} км`,
  alternatives: 'Другие варианты',
  outliers: (n: number) => `${n} ${plural(n, 'источник указал', 'источника указали', 'источников указали')} другое место — не учтено`,
  geotagConflict: 'Геотег источника не совпал с текстом',
  related: 'Связанные события',
  provenance: 'Происхождение данных',
  demo: 'Демо-режим: синтетические тестовые данные',
  demoShort: 'ДЕМО',
  loading: 'Загрузка…',
  error: 'Не удалось загрузить данные',
  retry: 'Повторить',
  nearCity: (name: string) => `рядом с «${name}»`,
  zoomHint: 'Приблизьте, чтобы увидеть населённые пункты',
  latest: 'Последние события в видимой области',
  theme: 'Тема',
  lang: 'Язык',
  population: 'нас.',
  kinds: { continent: 'Континент', country: 'Страна', admin1: 'Регион', admin2: 'Район', admin3: 'Округ', admin4: 'Муниципалитет', locality: 'Населённый пункт', sublocality: 'Район города' } as Record<string, string>,
  // size classes are global heuristics; the local legal type (станица, хутор…) comes from data when known
  classes: { city: 'Город', town: 'Населённый пункт', village: 'Населённый пункт', hamlet: 'Малый населённый пункт', settlement: 'Населённый пункт', neighbourhood: 'Микрорайон' } as Record<string, string>,
}

type Dict = typeof ru

const en: Dict = {
  ...ru,
  tagline: 'Live map of world events',
  searchPlaceholder: 'Country, region, city, village…',
  searchEmpty: 'Nothing found. Try another spelling.',
  earth: 'Earth',
  liveNew: (n) => `${n} new`,
  reconnecting: 'Reconnecting…',
  windows: { now: 'Now', '15m': '15 min', '1h': '1 hour', '3h': '3 hours', '24h': '24 hours', '7d': '7 days', custom: 'Period' },
  categories: 'Categories', allCategories: 'All categories', sources: 'Sources',
  sourceGroups: { telegram: 'Telegram', media: 'Media & TV', youtube: 'YouTube', official: 'Official', blogs: 'Blogs', aggregators: 'Aggregators' },
  from: 'From', to: 'To', apply: 'Apply', reset: 'Reset', close: 'Close', back: 'Back',
  eventsCount: (n) => `${n} ${n === 1 ? 'event' : 'events'}`,
  forWindow: { now: 'right now', '15m': 'in 15 minutes', '1h': 'in the last hour', '3h': 'in 3 hours', '24h': 'in 24 hours', '7d': 'in 7 days', custom: 'in period' },
  noEvents: 'No materials available right now',
  noEventsHint: 'No publications found for this place in the selected period.',
  widen: 'Show 7 days', showParent: 'Show whole region', regionWide: 'Region-wide', nearby: 'Nearby',
  inside: 'Events here', subplaces: 'Where it happens', loadMore: 'Load more',
  sourcesN: (n) => `${n} ${n === 1 ? 'source' : 'sources'}`,
  independentN: (n) => `${n} indep.`,
  updated: 'Updated', happened: 'Happened', firstReport: 'First report', localTime: 'local time',
  trust: { official: 'Official source', multiple_sources: 'Several independent sources', single_source: 'Single source', unverified: 'Unverified' },
  trustNote: 'The label shows who reports it. It does not confirm accuracy.',
  summary: 'Summary', sourcesTitle: 'Sources', openOriginal: 'Open original', copyOf: 'Copy / forward', forwarded: 'Forwarded from',
  version: (v) => `Version ${v}`, timeline: 'Timeline',
  timelineKinds: { report: 'Report', official: 'Official statement', video: 'Video', copy: 'Forward', update: 'Update' },
  first: 'first', whyHere: 'Why here?', confidence: 'Confidence', matched: 'Found in text',
  agreeing: (a, t) => `${a} of ${t} sources point to this place`,
  relation: { in: 'In the place', near: 'Near a landmark', region: 'Region-wide', source_area: 'By source location', coordinates: 'By coordinates', about: 'Organisation mention' },
  radius: (km) => `radius ~${km} km`, alternatives: 'Other readings',
  outliers: (n) => `${n} source(s) pointed elsewhere — ignored`, geotagConflict: "Source geotag disagreed with the text",
  related: 'Related events', provenance: 'Data provenance', demo: 'Demo mode: synthetic test data', demoShort: 'DEMO',
  loading: 'Loading…', error: 'Failed to load data', retry: 'Retry', nearCity: (name) => `near “${name}”`,
  zoomHint: 'Zoom in to see settlements', latest: 'Latest events in view', theme: 'Theme', lang: 'Language', population: 'pop.',
  kinds: { continent: 'Continent', country: 'Country', admin1: 'Region', admin2: 'District', admin3: 'County', admin4: 'Municipality', locality: 'Settlement', sublocality: 'Neighbourhood' },
  classes: { city: 'City', town: 'Settlement', village: 'Settlement', hamlet: 'Small settlement', settlement: 'Settlement', neighbourhood: 'Neighbourhood' },
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

const dicts = { ru, en }
export type Lang = keyof typeof dicts
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang')
    if (saved === 'ru' || saved === 'en') return saved
  } catch { /* storage unavailable */ }
  return navigator.language.startsWith('ru') ? 'ru' : 'en'
}
let current: Lang = initialLang()
const listeners = new Set<() => void>()

export function setLang(l: Lang): void {
  current = l
  try { localStorage.setItem('lang', l) } catch { /* private mode */ }
  document.documentElement.lang = l
  listeners.forEach((f) => f())
}

export function useI18n(): { t: Dict; lang: Lang } {
  const lang = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => current)
  return { t: dicts[lang], lang }
}

export function getLang(): Lang { return current }
