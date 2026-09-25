import { useEffect, useState } from 'react'

export interface Loadable<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

/** Small data hook: aborts stale requests, keeps previous data while reloading (no flicker). */
export function useFetch<T>(fn: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!fn) { setData(null); return }
    const ctl = new AbortController()
    setLoading(true)
    setError(null)
    fn(ctl.signal)
      .then((d) => { if (!ctl.signal.aborted) { setData(d); setLoading(false) } })
      .catch((e) => { if (!ctl.signal.aborted) { setError((e as Error).message); setLoading(false) } })
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])
  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}
