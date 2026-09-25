/** LIVE indicator + toasts for new events (no page reload). */
import { useEffect, useState } from 'react'
import type { LiveEvent } from '../../api/types'
import { Icon } from '../../design/icons'
import { useI18n } from '../../i18n'

export function LiveIndicator({ connected, unseen, onClick }: { connected: boolean; unseen: number; onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className={`live ${connected ? 'is-on' : 'is-off'}`} onClick={onClick}
      title={connected ? t.live : t.reconnecting} aria-live="polite">
      <span className="live-dot" />
      <span>{connected ? t.live : t.reconnecting}</span>
      {unseen > 0 ? <span className="live__badge">{t.liveNew(unseen)}</span> : null}
    </button>
  )
}

interface Toast { key: number; ev: LiveEvent }

export function Toasts({ incoming, onOpen }: { incoming: LiveEvent | null; onOpen: (id: number) => void }) {
  const { lang } = useI18n()
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => {
    if (!incoming || incoming.op !== 'created') return
    const key = incoming.log_id
    setToasts((ts) => [{ key, ev: incoming }, ...ts].slice(0, 3))
    const h = setTimeout(() => setToasts((ts) => ts.filter((x) => x.key !== key)), 9000)
    return () => clearTimeout(h)
  }, [incoming])
  return (
    <div className="toasts" role="status">
      {toasts.map(({ key, ev }) => (
        <button key={key} type="button" className="toast" onClick={() => { onOpen(ev.id); setToasts((ts) => ts.filter((x) => x.key !== key)) }}>
          <span className="live-dot" />
          <span className="toast__body">
            <span className="toast__place"><Icon name="pin" size={13} /> {(lang === 'ru' ? ev.place_ru : ev.place_en) ?? ''}</span>
            <span className="toast__title">{ev.title}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      ))}
    </div>
  )
}
