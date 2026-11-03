import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type HistoryItem, type RatingRow, type RatingView } from '../lib/api'

const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null)

function Row({ row }: { row: RatingRow }) {
  const { t } = useI18n()
  return (
    <li className={`rank-row ${row.me ? 'me' : ''}`}>
      <span className="rank-pos">{medal(row.rank) ?? row.rank}</span>
      <span className="rank-name">{row.username}</span>
      <span className="rank-score">{t.pointsN(row.score)}</span>
    </li>
  )
}

export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [data, setData] = useState<RatingView | null>(null)
  const [failed, setFailed] = useState(false)
  const [hist, setHist] = useState<HistoryItem[] | null>(null)

  useEffect(() => {
    api.rating().then(setData).catch(() => setFailed(true))
    api.history().then((h) => setHist(h.attempts)).catch(() => setHist([]))
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const me = data?.me
  const meInTop = data?.top.some((r) => r.me)

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t.profile} onClick={onClose}>
      <div className="profile-box" onClick={(e) => e.stopPropagation()}>
        <button className="mbtn close profile-close" onClick={onClose} aria-label={t.close}>
          ✕
        </button>

        {!data ? (
          <h2 className="profile-loading">{failed ? t.ratingFailed : t.loading}</h2>
        ) : (
          <>
            <div className="profile-head">
              <span className="profile-avatar" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </svg>
              </span>
              <h2>{data.username}</h2>
            </div>

            {me ? (
              <div className="profile-rank">
                <span className="rank-big">{t.place(me.rank)}</span>
                <span className="rank-of">{t.ofParticipants(data.participants)}</span>
              </div>
            ) : (
              <div className="profile-rank">
                <span className="rank-none">{t.notRanked}</span>
                <span className="rank-of">{t.takeFirstTest}</span>
              </div>
            )}

            <div className="profile-stats">
              <div className="stat-total">
                <strong>
                  {me?.score ?? 0}
                  <small>/{data.maxScore}</small>
                </strong>
                <span>{t.points}</span>
              </div>
              <div>
                <strong>
                  {me?.passed ?? 0}
                  <small>/{data.lessons}</small>
                </strong>
                <span>{t.finishedLessons}</span>
              </div>
            </div>

            {data.top.length > 0 && (
              <>
                <h3 className="rank-title">{t.rating}</h3>
                <ol className="rank-list">
                  {data.top.map((r) => (
                    <Row key={r.rank} row={r} />
                  ))}
                </ol>
                {me && !meInTop && (
                  <ol className="rank-list rank-self">
                    <Row row={me} />
                  </ol>
                )}
              </>
            )}
            <h3 className="rank-title">{t.testHistory}</h3>
            {hist && hist.length ? (
              <ol className="rank-list hist-list">
                {hist.map((h, i) => (
                  <li key={i} className="rank-row hist-row">
                    <span className="rank-pos">{t.lessonN(h.index + 1)}</span>
                    <span className="rank-name">{new Date(h.at).toLocaleString()}</span>
                    <span className={`rank-score ${h.passed ? 'pass' : 'fail'}`}>
                      {h.score}/{h.total}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">{hist ? t.noHistory : t.loading}</p>
            )}

            <button
              className="tbtn logout-btn"
              onClick={() => {
                api.logout().finally(() => window.location.reload())
              }}
            >
              ⎋ {t.logout}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
