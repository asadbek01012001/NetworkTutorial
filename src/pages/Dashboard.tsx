import { useCallback, useState } from 'react'
import { AzamatSection } from '../components/AzamatSection'
import { GlobeBackground } from '../components/GlobeBackground'
import { LessonCard } from '../components/LessonCard'
import { TopologyMap } from '../components/TopologyMap'
import { VideoModal } from '../components/VideoModal'
import { useI18n } from '../i18n/context'
import { canWatch, lessonTitle, type CourseView, type LessonView } from '../lib/api'

interface Props {
  course: CourseView
  refresh: () => Promise<CourseView | null>
}

export function Dashboard({ course, refresh }: Props) {
  const { t, lang } = useI18n()
  const [openId, setOpenId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpenId(null)
    refresh()
  }, [refresh])

  const { lessons } = course
  const openLesson = (l: LessonView) => canWatch(l.state) && setOpenId(l.id)

  // Lessons unlock in order, so the next one is the first not finished.
  const next = lessons.find((l) => l.state === 'open' || l.state === 'test') ?? lessons[0]
  const nextIndex = lessons.indexOf(next)
  const startLabel =
    next.state === 'test' ? t.takeTest : next.position > 0 ? t.resume : t.start

  const openIndex = lessons.findIndex((l) => l.id === openId)
  const opened = openIndex >= 0 ? lessons[openIndex] : null

  return (
    <>
      <GlobeBackground />
      <section className="hero">
        <div className="hero-text">
          <h1>
            {t.heroTop}
            <br />
            <span className="grad">{t.heroBottom}</span>
          </h1>
          <p className="lead">{t.tagline}</p>

          <button type="button" className="start" onClick={() => openLesson(next)}>
            <span className="start-icon" aria-hidden>
              <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
            </span>
            <span>
              <span className="start-label">{startLabel}</span>
              <span className="start-title">
                {t.lessonN(next.number ?? nextIndex + 1)}: {lessonTitle(next, lang)}
              </span>
            </span>
          </button>
        </div>

        <div className="hero-map">
          <TopologyMap lessons={lessons} nextId={next.id} onOpen={openLesson} />
        </div>
      </section>

      <section className="lessons">
        <h2>{t.lessons}</h2>
        <div className="grid">
          {lessons.map((l, i) => (
            <LessonCard key={l.id} lesson={l} index={i} onOpen={openLesson} />
          ))}
        </div>
      </section>

      <AzamatSection />

      {opened && (
        <VideoModal
          key={opened.id}
          lesson={opened}
          index={openIndex}
          hasNext={openIndex < lessons.length - 1}
          onClose={close}
          onChanged={refresh}
          onNext={async () => {
            const c = await refresh()
            const n = c?.lessons[openIndex + 1]
            setOpenId(n && canWatch(n.state) ? n.id : null)
          }}
        />
      )}
    </>
  )
}
