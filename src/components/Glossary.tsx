import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'

interface Term {
  id: string
  term: string
  abbr: string
  cat: string
  names: Record<string, string>
  def: Record<string, string>
  see: string[]
}

// Apostrophe variants and case must not matter when searching ("o'g'il" = "o‘g‘il").
const norm = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`´]/g, "'")

// One page with every term: search, category filter and related-term links.
export default function Glossary({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n()
  const [terms, setTerms] = useState<Term[] | null>(null)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('')
  const [flash, setFlash] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    import('../data/glossary.json').then((m) => setTerms(m.default as Term[]))
  }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', h)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const byId = useMemo(() => new Map((terms ?? []).map((x) => [x.id, x])), [terms])
  const cats = useMemo(() => {
    const count = new Map<string, number>()
    for (const x of terms ?? []) count.set(x.cat, (count.get(x.cat) ?? 0) + 1)
    return [...count.entries()]
  }, [terms])

  const shown = useMemo(() => {
    const q = norm(query.trim())
    const list = (terms ?? []).filter((x) => !cat || x.cat === cat)
    if (!q) return list
    // Name matches first, then matches inside the explanation.
    const scored: [number, Term][] = []
    for (const x of list) {
      const names = [x.term, x.abbr, ...Object.values(x.names)].map(norm)
      let score = -1
      if (names.some((n) => n === q)) score = 0
      else if (names.some((n) => n.startsWith(q))) score = 1
      else if (names.some((n) => n.includes(q))) score = 2
      else if (norm(x.def[lang] ?? x.def.en).includes(q)) score = 3
      if (score >= 0) scored.push([score, x])
    }
    return scored.sort((a, b) => a[0] - b[0]).map(([, x]) => x)
  }, [terms, query, cat, lang])

  // Jump to a related term, clearing filters that would hide it.
  const goTo = (id: string) => {
    if (!shown.some((x) => x.id === id)) {
      setQuery('')
      setCat('')
    }
    setFlash(id)
    requestAnimationFrame(() => document.getElementById(`gl-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  return (
    <div className="gloss" role="dialog" aria-modal="true" aria-label={t.glossTitle}>
      <header className="gloss-bar">
        <h1>{t.glossTitle}</h1>
        {terms && <span className="gloss-count">{t.glossCount(shown.length)}</span>}
        <button className="mbtn close" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </header>
      <div className="gloss-tools">
        <input
          className="gloss-search"
          type="search"
          value={query}
          autoFocus
          placeholder={t.glossSearch}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t.glossSearch}
        />
        <div className="gloss-cats">
          <button className={!cat ? 'active' : ''} onClick={() => setCat('')}>
            {t.glossAll}
          </button>
          {cats.map(([c, n]) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(cat === c ? '' : c)}>
              {t.glossCats[c] ?? c} <small>{n}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="gloss-list" ref={listRef}>
        {!terms && <p className="gloss-empty">{t.loading}</p>}
        {terms && !shown.length && <p className="gloss-empty">{t.glossNone}</p>}
        {shown.map((x) => {
          const local = x.names[lang] ?? x.term
          return (
            <article key={x.id} id={`gl-${x.id}`} className={`gloss-item ${flash === x.id ? 'flash' : ''}`} onAnimationEnd={() => setFlash('')}>
              <div className="gloss-head">
                <h2>{x.term}</h2>
                {local.toLowerCase() !== x.term.toLowerCase() && <span className="gloss-local">{local}</span>}
                <span className="gloss-tag">{t.glossCats[x.cat] ?? x.cat}</span>
              </div>
              {x.abbr && <p className="gloss-abbr">{x.abbr}</p>}
              <p className="gloss-def">{x.def[lang] ?? x.def.en}</p>
              {x.see.length > 0 && (
                <div className="gloss-see">
                  <span>{t.glossSee}:</span>
                  {x.see
                    .filter((id) => byId.has(id))
                    .map((id) => (
                      <button key={id} onClick={() => goTo(id)}>
                        {byId.get(id)!.term}
                      </button>
                    ))}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
