import { useI18n } from '../i18n/context'
import { canWatch, lessonTitle, type LessonView } from '../lib/api'

interface Props {
  lesson: LessonView
  index: number
  onOpen: (lesson: LessonView) => void
}

export function LessonCard({ lesson, index, onOpen }: Props) {
  const { t, lang } = useI18n()
  const number = lesson.number ?? index + 1
  const watchable = canWatch(lesson.state)
  // The frame from the video in the interface language, if that video exists.
  const poster = lesson.videos.find((v) => v.lang === lang)?.poster ?? lesson.poster

  const body = (
    <>
      <div className="card-media">
        <img src={poster} alt="" loading="lazy" draggable={false} />
        {lesson.state === 'open' && (
          <span className="card-play" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
          </span>
        )}
        {lesson.state === 'locked' && (
          <span className="card-lock" aria-hidden>
            <svg viewBox="0 0 24 24">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
        )}
        {lesson.state === 'test' && <span className="card-test">{t.testBadge}</span>}
        {lesson.state === 'done' && <span className="card-done" aria-label={t.done}>✓</span>}
      </div>
      <div className="card-body">
        <span className="card-num">{t.lessonN(number)}</span>
        <h3>{lessonTitle(lesson, lang)}</h3>
        {lesson.state === 'locked' && <span className="card-soon">{t.finishFirst(number - 1)}</span>}
        {lesson.state === 'test' && <span className="card-soon test">{t.passTest}</span>}
        {lesson.state === 'done' && <span className="card-soon done">{t.testScore(lesson.bestScore)}</span>}
      </div>
    </>
  )

  return watchable ? (
    <button type="button" className="card" onClick={() => onOpen(lesson)}>
      {body}
    </button>
  ) : (
    <div className="card soon locked" aria-disabled>
      {body}
    </div>
  )
}
