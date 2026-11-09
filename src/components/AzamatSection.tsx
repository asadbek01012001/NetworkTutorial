import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type AzamatVideo } from '../lib/api'

// The player brings in hls.js; load it only when a lecture is opened.
const AzamatPlayer = lazy(() => import('./AzamatPlayer'))

function clock(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

// "Azamat Qodirov darslari": recorded lectures, all open, shown under the course lessons.
export function AzamatSection() {
  const { t } = useI18n()
  const [videos, setVideos] = useState<AzamatVideo[]>([])
  const [open, setOpen] = useState<AzamatVideo | null>(null)

  const load = useCallback(() => {
    api
      .azamat()
      .then((r) => setVideos(r.videos))
      .catch(() => {})
  }, [])
  useEffect(load, [load])

  const close = useCallback(() => {
    setOpen(null)
    // Give the last progress save a moment, then show the new positions.
    window.setTimeout(load, 400)
  }, [load])

  if (!videos.length) return null

  return (
    <section className="lessons azamat">
      <h2>{t.azamatTitle}</h2>
      <p className="azamat-lead">{t.azamatLead}</p>
      <div className="grid">
        {videos.map((v) => {
          const mins = Math.round(v.duration / 60)
          const share = v.done ? 1 : Math.min(1, v.position / v.duration)
          return (
            <button type="button" key={v.id} className="card" onClick={() => setOpen(v)}>
              <div className="card-media">
                <img src={v.poster} alt="" loading="lazy" draggable={false} />
                <span className="card-play" aria-hidden>
                  <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
                </span>
                {v.done && <span className="card-done" aria-label={t.azamatWatched}>✓</span>}
                <span className="card-time">{t.hoursMinutes(Math.floor(mins / 60), mins % 60)}</span>
                {share > 0 && (
                  <span className="card-progress" aria-hidden>
                    <span style={{ width: `${share * 100}%` }} />
                  </span>
                )}
              </div>
              <div className="card-body">
                <span className="card-num">{t.lessonN(v.number)}</span>
                <h3>{v.title || t.lessonN(v.number)}</h3>
                {v.done ? (
                  <span className="card-soon done">{t.azamatWatched}</span>
                ) : (
                  v.position > 0 && <span className="card-soon">{t.azamatResume(clock(v.position))}</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {open && (
        <Suspense fallback={null}>
          <AzamatPlayer video={open} onClose={close} />
        </Suspense>
      )}
    </section>
  )
}
