import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type ExamQuestion, type ExamResult } from '../lib/api'
import { QuestionSteps } from './QuestionSteps'

// The general exam over the whole course: every attempt gets new random
// questions from the server, with the result and an answer review at the end.
// It does not count towards the rating.
export function Exam({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [stats, setStats] = useState<{ size: number; best: number; attempts: number } | null>(null)
  const [exam, setExam] = useState<{ id: number; questions: ExamQuestion[] } | null>(null)
  const [starting, setStarting] = useState(false)
  const [failed, setFailed] = useState(false)
  const [answers, setAnswers] = useState<number[]>([])
  const [result, setResult] = useState<ExamResult | null>(null)

  useEffect(() => {
    api
      .exam()
      .then(setStats)
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

  const start = async () => {
    setStarting(true)
    try {
      setExam(await api.newExam())
      setResult(null)
      setAnswers([])
    } catch {
      setFailed(true)
    } finally {
      setStarting(false)
    }
  }

  let body
  if (failed) body = <div className="test-box test-center"><h3>{t.testFailedLoad}</h3></div>
  else if (!stats) body = <div className="test-box test-center"><h3>{t.loading}</h3></div>
  else if (exam && result) {
    const { questions } = exam
    const percent = Math.round((result.score / result.total) * 100)
    const good = result.score / result.total >= 0.7
    body = (
      <>
        <div className="test-box test-center">
          <div className={`score ${good ? 'pass' : 'fail'}`}>
            {result.score}/{result.total}
          </div>
          <h3>{t.examPercent(percent)}</h3>
          <p className="exam-note">{t.examBest(result.best, result.total, stats.attempts)}</p>
          <div className="test-actions">
            <button className="tbtn primary" disabled={starting} onClick={start}>
              {t.retake}
            </button>
            <button className="tbtn" onClick={onClose}>
              {t.close}
            </button>
          </div>
        </div>
        <h2 className="exam-review-title">{t.examReview}</h2>
        <ol className="exam-review">
          {questions.map((q, i) => {
            const ok = answers[i] === result.correct[i]
            return (
              <li key={i} className={ok ? 'ok' : 'bad'}>
                <div className="exam-q">
                  <span className="exam-mark" aria-hidden>{ok ? '✓' : '✗'}</span>
                  <span>
                    {i + 1}. {q.q} <small>· {t.lessonN(q.lesson)}</small>
                  </span>
                </div>
                {!ok && (
                  <div className="exam-a bad">
                    {t.examYour}: <b>{q.options[answers[i]]}</b>
                  </div>
                )}
                <div className="exam-a ok">
                  {t.examRight}: <b>{q.options[result.correct[i]]}</b>
                </div>
              </li>
            )
          })}
        </ol>
      </>
    )
  } else if (!exam)
    body = (
      <div className="test-box test-center">
        <h3>{t.examIntro(stats.size)}</h3>
        {stats.attempts > 0 && <p className="exam-note">{t.examBest(stats.best, stats.size, stats.attempts)}</p>}
        <div className="test-actions">
          <button className="tbtn primary" disabled={starting} onClick={start}>
            {t.examStart}
          </button>
        </div>
      </div>
    )
  else
    body = (
      <QuestionSteps
        key={exam.id}
        questions={exam.questions}
        onFinish={async (a) => {
          try {
            const r = await api.submitExam(exam.id, a)
            setAnswers(a)
            setResult(r)
            setStats((s) => s && { ...s, best: r.best, attempts: s.attempts + 1 })
          } catch {
            setFailed(true)
          }
        }}
      />
    )

  return (
    <div className="practice" role="dialog" aria-modal="true" aria-label={t.exam}>
      <header className="practice-bar">
        <h1>{t.exam}</h1>
        <button className="mbtn close" onClick={onClose} aria-label="✕">
          ✕
        </button>
      </header>
      <div className="practice-body">
        <div className="exam-wrap">{body}</div>
      </div>
    </div>
  )
}
