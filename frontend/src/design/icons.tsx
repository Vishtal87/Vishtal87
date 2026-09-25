/** Inline SVG icon set (24px grid, stroke-based, currentColor). No icon font / CDN dependency. */
import type { JSX } from 'react'

const P: Record<string, JSX.Element> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.8 5.4 3.8 8.5s-1.3 5.9-3.8 8.5c-2.5-2.6-3.8-5.4-3.8-8.5S9.5 6.1 12 3.5z" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" /></>,
  timeline: <><path d="M7 4v16" /><circle cx="7" cy="7" r="1.8" /><circle cx="7" cy="17" r="1.8" /><path d="M11 7h9M11 17h7" /></>,
  layers: <><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5L12 17l8.5-4.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M19 14.5A7.5 7.5 0 019.5 5a7.5 7.5 0 109.5 9.5z" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V6a1 1 0 011-1h9" /></>,
  video: <><rect x="3.5" y="6" width="12" height="12" rx="2" /><path d="M15.5 10.5l5-3v9l-5-3z" /></>,
  send: <path d="M4 11.5L20 4l-5.5 16-3.2-6.3L4 11.5zM11.3 13.7L20 4" />,
  news: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12.5h8M8 16h5" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12.2l2.3 2.3 4.7-4.9" /></>,
  users: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M16 14.6c2.2.2 3.9 1.6 4.5 4.4" /></>,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.5-5.4 3.6-8.3.4 1.9 1.5 3 2.6 3.4-.3-2.8.9-5.4 3.2-6.9-.3 3 1.2 4.6 2.5 6.4 1 1.4 1.1 2.8 1.1 3.9 0 4-2.8 7.7-6.5 7.7z" />,
  shield: <path d="M12 3.5l7 2.8v5.4c0 4.6-3 7.9-7 9.3-4-1.4-7-4.7-7-9.3V6.3z" />,
  cloud: <path d="M7.5 18.5h9.8a3.7 3.7 0 00.6-7.4 5.5 5.5 0 00-10.6-.9 3.9 3.9 0 00.2 8.3z" />,
  bus: <><rect x="5" y="4" width="14" height="13" rx="2.5" /><path d="M5 11h14M8 20v-3M16 20v-3" /><circle cx="8.5" cy="14" r=".6" /><circle cx="15.5" cy="14" r=".6" /></>,
  landmark: <path d="M4 9.5L12 5l8 4.5M5.5 10v7M10 10v7M14 10v7M18.5 10v7M4 19.5h16" />,
  trending: <path d="M4 17l5-5 3.5 3.5L20 8M15 8h5v5" />,
  briefcase: <><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M9 8V6a1 1 0 011-1h4a1 1 0 011 1v2M4 13h16" /></>,
  palette: <path d="M12 3.5a8.5 8.5 0 100 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.7 1.8-1.7h2.2a3.9 3.9 0 003.9-3.9C20.5 6.9 16.7 3.5 12 3.5zM7.8 11.5h.01M10 7.8h.01M14.4 7.8h.01" />,
  trophy: <path d="M8 4.5h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13.5V17M8.5 20h7M10 17h4v3h-4z" />,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5" /></>,
  megaphone: <path d="M4 10v4h3l7 4V6L7 10zM17 9.5a3.5 3.5 0 010 5M7 14l1 5h2.5l-1-4.4" />,
  dot: <circle cx="12" cy="12" r="4" />,
  lang: <path d="M4 5h9M8.5 3v2c0 4-2.2 7.2-5 8.5M6 9c1 2.3 3 4 5.5 4.8M13 20l3.5-9 3.5 9M14.2 17h4.6" />,
}

export function Icon({ name, size = 20, title, className }: { name: string; size?: number; title?: string; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {P[name] ?? P.dot}
    </svg>
  )
}

export const SOURCE_ICON: Record<string, string> = {
  telegram: 'send', youtube: 'video', official: 'landmark', organization: 'landmark', media: 'news',
  regional_media: 'news', local_media: 'news', tv: 'video', blog: 'users', ugc: 'users', aggregator: 'layers',
}
