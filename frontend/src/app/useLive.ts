/** Realtime subscription (SSE). Reconnects with `since` so no change is lost between subscriptions. */
import { useEffect, useRef, useState } from 'react'
import type { Filters, LiveEvent } from '../api/types'

export interface LiveState { connected: boolean; events: LiveEvent[]; unseen: number }

export function useLive(filters: Filters, bbox: string | null, onEvent: (e: LiveEvent) => void) {
  const [state, setState] = useState<LiveState>({ connected: false, events: [], unseen: 0 })
  const lastId = useRef<number | null>(null)
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    const q = new URLSearchParams()
    if (filters.cats.length) q.set('cats', filters.cats.join(','))
    if (filters.sources.length) q.set('sources', filters.sources.join(','))
    if (bbox) q.set('bbox', bbox)
    if (lastId.current != null) q.set('since', String(lastId.current))
    const es = new EventSource(`/api/stream?${q}`)
    es.addEventListener('hello', (m) => {
      const d = JSON.parse((m as MessageEvent).data)
      if (lastId.current == null) lastId.current = d.last_log_id
      setState((s) => ({ ...s, connected: true }))
    })
    es.addEventListener('event', (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as LiveEvent
      lastId.current = Math.max(lastId.current ?? 0, ev.log_id)
      setState((s) => ({ connected: true, events: [ev, ...s.events.filter((x) => x.id !== ev.id)].slice(0, 50),
        unseen: s.unseen + (ev.op === 'created' ? 1 : 0) }))
      cb.current(ev)
    })
    es.onerror = () => setState((s) => ({ ...s, connected: false }))
    es.onopen = () => setState((s) => ({ ...s, connected: true }))
    return () => es.close()
  }, [filters.cats.join(','), filters.sources.join(','), bbox])

  const markSeen = () => setState((s) => ({ ...s, unseen: 0 }))
  return { ...state, markSeen }
}
