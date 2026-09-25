/** Global place search: homonyms are shown with their administrative context. "/" focuses it. */
import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { SearchResult } from '../../api/types'
import { Icon } from '../../design/icons'
import { useI18n } from '../../i18n'
import { compact } from '../../util/format'

export function SearchBar({ near, onPick }: { near: { lat: number; lon: number } | null
  onPick: (r: SearchResult) => void }) {
  const { t, lang } = useI18n()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const picked = useRef<string | null>(null)   // text put into the field by a pick: not a new query

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); input.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (q.trim().length < 2 || q === picked.current) { setResults(null); return }
    const ctl = new AbortController()
    const h = setTimeout(() => {
      api.search(q.trim(), lang, near ?? undefined, ctl.signal)
        .then((d) => { setResults(d.results); setActive(0); setOpen(true) })
        .catch(() => { /* aborted or offline: keep previous */ })
    }, 180)
    return () => { clearTimeout(h); ctl.abort() }
    // near is intentionally not a dependency: moving the map must not re-run the query
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lang])

  const pick = (r: SearchResult) => {
    onPick(r)
    setOpen(false)
    picked.current = r.name
    setQ(r.name)
    input.current?.blur()
  }

  return (
    <div className="search" role="search">
      <div className="search__field">
        <Icon name="search" size={20} />
        <input ref={input} value={q} placeholder={t.searchPlaceholder} aria-label={t.searchPlaceholder}
          role="combobox" aria-expanded={open} aria-controls="search-results" aria-autocomplete="list"
          onChange={(e) => { picked.current = null; setQ(e.target.value) }} onFocus={() => results && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!results?.length) return
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Enter') pick(results[active])
            if (e.key === 'Escape') setOpen(false)
          }} />
        {q ? <button type="button" className="icon-btn icon-btn--sm" aria-label={t.close}
          onClick={() => { setQ(''); setResults(null); input.current?.focus() }}><Icon name="close" size={18} /></button>
          : <kbd className="search__kbd">/</kbd>}
      </div>
      {open && results ? (
        <ul id="search-results" className="search__results" role="listbox">
          {results.length === 0 ? <li className="search__empty">{t.searchEmpty}</li> : results.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button type="button" className={`search__item ${i === active ? 'is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}>
                <Icon name={r.kind === 'locality' || r.kind === 'sublocality' ? 'pin' : 'globe'} size={18} />
                <span className="search__text">
                  <span className="search__name">{r.name}
                    {r.matched_name && r.matched_name !== r.name ? <em> · {r.matched_name}</em> : null}</span>
                  <span className="search__ctx">
                    {(r.local_type ?? (r.place_class && t.classes[r.place_class]) ?? t.kinds[r.kind] ?? r.kind)}
                    {r.breadcrumb.length ? ` · ${r.breadcrumb.slice(1).map((b) => b.name).join(' › ')}` : ''}
                  </span>
                </span>
                {r.population > 0 ? <span className="search__pop">{compact(r.population, lang)} {t.population}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
