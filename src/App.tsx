import { lazy, Suspense, useCallback, useState } from 'react'
import { AuthScreen } from './components/AuthScreen'
import { Exam } from './components/Exam'
import { Layout } from './components/Layout'
import { Practice } from './components/Practice'
import { useCourse } from './hooks/useCourse'
import { useI18n } from './i18n/context'
import { Dashboard } from './pages/Dashboard'

// The network lab is a large module; load it only when someone opens it.
const Lab = lazy(() => import('./lab/Lab.tsx').then((m) => ({ default: m.Lab })))
const Glossary = lazy(() => import('./components/Glossary'))
const AdminPanel = lazy(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })))

export default function App() {
  const { t } = useI18n()
  const { course, error, needAuth, refresh } = useCourse()
  const [labOpen, setLabOpen] = useState(false)
  const openLab = useCallback(() => setLabOpen(true), [])
  const closeLab = useCallback(() => setLabOpen(false), [])
  const [practiceOpen, setPracticeOpen] = useState(false)
  const openPractice = useCallback(() => setPracticeOpen(true), [])
  const closePractice = useCallback(() => setPracticeOpen(false), [])
  const [glossOpen, setGlossOpen] = useState(false)
  const openGlossary = useCallback(() => setGlossOpen(true), [])
  const closeGlossary = useCallback(() => setGlossOpen(false), [])

  const [adminOpen, setAdminOpen] = useState(false)
  const openAdmin = useCallback(() => setAdminOpen(true), [])
  const closeAdmin = useCallback(() => setAdminOpen(false), [])

  const [examOpen, setExamOpen] = useState(false)
  const openExam = useCallback(() => setExamOpen(true), [])
  const closeExam = useCallback(() => setExamOpen(false), [])

  if (needAuth) return <AuthScreen onDone={() => window.location.reload()} />

  return (
    <Layout username={course?.username} onOpenLab={course ? openLab : undefined} onOpenPractice={course ? openPractice : undefined} onOpenGlossary={course ? openGlossary : undefined} onOpenExam={course ? openExam : undefined} onOpenAdmin={course?.isAdmin ? openAdmin : undefined}>
      {course ? (
        <Dashboard course={course} refresh={refresh} />
      ) : (
        <div className="empty">
          <h1>{error ? t.noServer : t.loading}</h1>
          {error && (
            <button className="tbtn primary" onClick={() => window.location.reload()}>
              {t.retry}
            </button>
          )}
        </div>
      )}
      {practiceOpen && course && <Practice onClose={closePractice} />}
      {examOpen && course && <Exam onClose={closeExam} />}
      {glossOpen && (
        <Suspense fallback={null}>
          <Glossary onClose={closeGlossary} />
        </Suspense>
      )}
      {adminOpen && course?.isAdmin && (
        <Suspense fallback={null}>
          <AdminPanel onClose={closeAdmin} />
        </Suspense>
      )}
      {labOpen && course && (
        <Suspense fallback={null}>
          <Lab onClose={closeLab} username={course.username} />
        </Suspense>
      )}
    </Layout>
  )
}
