import { useCallback, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'
import { UI_LANGS } from '../i18n/strings'
import { ProfileModal } from './ProfileModal'

interface Props {
  username?: string
  onOpenLab?: () => void
  onOpenPractice?: () => void
  onOpenGlossary?: () => void
  onOpenExam?: () => void
  children: ReactNode
}

export function Layout({ username, onOpenLab, onOpenPractice, onOpenGlossary, onOpenExam, children }: Props) {
  const { t, lang, setLang } = useI18n()
  const [profile, setProfile] = useState(false)
  const closeProfile = useCallback(() => setProfile(false), [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden>
            <svg viewBox="0 0 24 24">
              <rect x="3" y="14" width="18" height="6" rx="1.5" />
              <path d="M7 17h.01M10 17h.01M12 14V8M8 6.5a5.5 5.5 0 0 1 8 0M5.5 4a9 9 0 0 1 13 0" />
            </svg>
          </span>
          <span className="brand-name">{t.siteTitle}</span>
        </div>
        <nav className="topbar-nav">
          {onOpenPractice && (
            <button type="button" className="lab-btn" onClick={onOpenPractice} title={t.openPractice}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="4" y="3" width="16" height="18" rx="2" />
                <path d="m8 9 2 2 4-4M8 16h8" />
              </svg>
              <span className="nav-lbl">{t.openPractice}</span>
            </button>
          )}
          {onOpenExam && (
            <button type="button" className="lab-btn" onClick={onOpenExam} title={t.exam}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M9 4h6v3H9zM7 5.5H5.5A1.5 1.5 0 0 0 4 7v12.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H17" />
                <path d="M8 12h1M8 16h1M12 12h4M12 16h4" />
              </svg>
              <span className="nav-lbl">{t.exam}</span>
            </button>
          )}
          {onOpenLab && (
            <button type="button" className="lab-btn" onClick={onOpenLab} title={t.openLab}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <circle cx="5" cy="18" r="2.5" />
                <circle cx="19" cy="18" r="2.5" />
                <circle cx="12" cy="5" r="2.5" />
                <path d="M7 16.5 10.5 7M17 16.5 13.5 7M7.5 18h9" />
              </svg>
              <span className="nav-lbl">{t.openLab}</span>
            </button>
          )}
          {onOpenGlossary && (
            <button type="button" className="lab-btn gloss-btn" onClick={onOpenGlossary} title={t.glossary}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
                <path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" />
              </svg>
              <span className="nav-lbl">{t.glossary}</span>
            </button>
          )}
          <div className="ui-lang" role="group" aria-label="Til / Язык / Language">
            {UI_LANGS.map((l) => (
              <button key={l.id} className={l.id === lang ? 'active' : ''} onClick={() => setLang(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </nav>
        {username && (
          <button type="button" className="user-chip" onClick={() => setProfile(true)} title={t.profile}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <span className="user-name">{username}</span>
            <span className="chip-trophy" aria-hidden>
              🏆
            </span>
          </button>
        )}
      </header>
      <main className="content">{children}</main>
      {profile && <ProfileModal onClose={closeProfile} />}
    </div>
  )
}
