import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/context'
import { api, type TestQuestion, type TestResult } from '../lib/api'
import { QuestionSteps } from './QuestionSteps'

interface Props {
  lessonId: string
  hasNext: boolean
  onPassed: () => void
  onNext: () => void
  onRewatch: () => void
  onClose: () => void
}

// The 10-question test after a lesson video; passing it unlocks the next lesson.
export function TestView({ lessonId, hasNext, onPassed, onNext, onRewatch, onClose }: Props) {
  const { t } = useI18n()
  const [questions, setQuestions] = useState<TestQuestion[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [round, setRound] = useState(0)

  useEffect(() => {
    api
      .test(lessonId)
      .then((res) => setQuestions(res.questions))
      .catch(() => setFailed(true))
  }, [lessonId])

  if (failed) return <div className="test-box test-center"><h3>{t.testFailedLoad}</h3></div>
  if (!questions) return <div className="test-box test-center"><h3>{t.loading}</h3></div>

  if (result) {
    return (
      <div className="test-box test-center">
        <div className={`score ${result.passed ? 'pass' : 'fail'}`}>
          {result.score}/{result.total}
        </div>
        {result.passed ? (
          <>
            <h3>{t.passed}</h3>
            <p>{hasNext ? t.nextUnlocked : t.courseDone}</p>
            <div className="test-actions">
              {hasNext && (
                <button className="tbtn primary" onClick={onNext}>
                  {t.nextLesson}
                </button>
              )}
              <button className="tbtn" onClick={onClose}>
                {t.close}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>{t.needAtLeast(result.passScore)}</h3>
            <p>{t.wrongAnswers(result.wrong.map((i) => i + 1).join(', '))}</p>
            <div className="test-actions">
              <button
                className="tbtn primary"
                onClick={() => {
                  setResult(null)
                  setRound(round + 1)
                }}
              >
                {t.retake}
              </button>
              <button className="tbtn" onClick={onRewatch}>
                {t.rewatch}
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <QuestionSteps
      key={round}
      questions={questions}
      onFinish={async (answers) => {
        try {
          const r = await api.submitTest(lessonId, answers)
          setResult(r)
          if (r.passed) onPassed()
        } catch {
          setFailed(true)
        }
      }}
    />
  )
}
