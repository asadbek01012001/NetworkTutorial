import { useState } from 'react'
import { useI18n } from '../i18n/context'
import type { TestQuestion } from '../lib/api'

interface Props {
  questions: TestQuestion[]
  /** Called once with every answer; resolves when the result is ready. */
  onFinish: (answers: number[]) => Promise<void>
}

// One question per screen with big answer buttons (lesson tests).
export function QuestionSteps({ questions, onFinish }: Props) {
  const { t } = useI18n()
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [sending, setSending] = useState(false)

  const q = questions[current]
  const chosen = answers[current]
  const last = current === questions.length - 1

  const next = async () => {
    if (!last) {
      setCurrent(current + 1)
      return
    }
    setSending(true)
    try {
      await onFinish(answers)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="test-box">
      <div className="test-progress">
        <span>{t.questionOf(current + 1, questions.length)}</span>
        <div className="test-bar">
          <div style={{ width: `${((current + 1) / questions.length) * 100}%` }} />
        </div>
      </div>
      <h3 className="test-q">{q.q}</h3>
      <div className="test-options">
        {q.options.map((o, i) => (
          <button
            key={i}
            className={`option ${chosen === i ? 'chosen' : ''}`}
            onClick={() => {
              const a = [...answers]
              a[current] = i
              setAnswers(a)
            }}
          >
            <span className="option-letter">{'ABCD'[i]}</span>
            {o}
          </button>
        ))}
      </div>
      <div className="test-actions end">
        {current > 0 && (
          <button className="tbtn" onClick={() => setCurrent(current - 1)}>
            {t.back}
          </button>
        )}
        <button className="tbtn primary" disabled={chosen === undefined || sending} onClick={next}>
          {last ? t.showResult : t.nextQuestion}
        </button>
      </div>
    </div>
  )
}
