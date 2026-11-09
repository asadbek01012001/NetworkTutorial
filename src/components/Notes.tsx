import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type AzamatNote } from '../lib/api'

// Study notes for the "Azamat Qodirov darslari" lectures: a lesson list on the
// left, the chosen lesson's notes on the right. The notes (backend/content/
// azamat-notes.json) are our own HTML made from the board recordings, so they
// are rendered as is.
export default function Notes({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [notes, setNotes] = useState<AzamatNote[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [cur, setCur] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .azamatNotes()
      .then(setNotes)
      .catch(() => setFailed(true))
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

  // Wide tables scroll inside their own box instead of widening the page.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = 0
    el.querySelectorAll('table').forEach((tb) => {
      if (tb.parentElement?.classList.contains('nt-tbl')) return
      const w = document.createElement('div')
      w.className = 'nt-tbl'
      tb.replaceWith(w)
      w.appendChild(tb)
    })
  }, [cur, notes])

  const note = notes?.[cur]

  return (
    <div className="gloss notes" role="dialog" aria-modal="true" aria-label={t.notesTitle}>
      <header className="gloss-bar">
        <h1>{t.notesTitle}</h1>
        <button className="mbtn close" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </header>
      <div className="nt-wrap">
        <nav className="nt-list" aria-label={t.notesLessons}>
          {notes?.map((n, i) => (
            <button key={n.id} className={i === cur ? 'active' : ''} onClick={() => setCur(i)}>
              <span className="nt-num">{n.number}</span>
              <span>{n.title}</span>
            </button>
          ))}
        </nav>
        <div className="nt-body" ref={bodyRef}>
          {failed && <p className="gloss-empty">{t.noServer}</p>}
          {!notes && !failed && <p className="gloss-empty">{t.loading}</p>}
          {notes && !notes.length && <p className="gloss-empty">{t.glossNone}</p>}
          {note && (
            <article className="nt-article">
              {cur === 0 && <p className="nt-lead">{t.notesLead}</p>}
              <p className="nt-eyebrow">{t.lessonN(note.number)}</p>
              <h2>{note.title}</h2>
              <p className="nt-meta" dangerouslySetInnerHTML={{ __html: note.meta }} />
              <div dangerouslySetInnerHTML={{ __html: note.html }} />
              <div className="nt-pager">
                {cur > 0 && (
                  <button className="mbtn" onClick={() => setCur(cur - 1)}>
                    ← {t.lessonN(notes![cur - 1].number)}
                  </button>
                )}
                {cur < notes!.length - 1 && (
                  <button className="mbtn next" onClick={() => setCur(cur + 1)}>
                    {t.lessonN(notes![cur + 1].number)} →
                  </button>
                )}
              </div>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
