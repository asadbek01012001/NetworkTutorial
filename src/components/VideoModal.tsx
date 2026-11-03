import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '../i18n/context'
import { api, lessonTitle, type Lang, type LessonView } from '../lib/api'
import { mapTime } from '../lib/timeline'
import { ProtectedVideo } from './ProtectedVideo'
import { TestView } from './TestView'

interface Props {
  lesson: LessonView
  index: number
  hasNext: boolean
  onClose: () => void
  onNext: () => void
  /** Called after the server state changed (video done, test passed). */
  onChanged: () => void
}

const VOLUME_KEY = 'network-tutorial-volume'
const LANG_KEY = 'network-tutorial-lang'
const LANG_NAMES: Record<Lang, string> = { uz: 'O‘zbekcha', en: 'English', ru: 'Русский' }

// Video language: the viewer's last choice, else the interface language.
function savedLang(uiLang: string): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'uz' || v === 'en' || v === 'ru') return v
  } catch {
    // ignore
  }
  return uiLang === 'en' || uiLang === 'ru' ? uiLang : 'uz'
}

function savedVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    const v = Number(raw)
    return raw !== null && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  } catch {
    return 1
  }
}

// A moving mark over the video so recordings are traceable to this site.
function Watermark() {
  const { t } = useI18n()
  const [pos, setPos] = useState({ x: 8, y: 10 })
  useEffect(() => {
    const id = window.setInterval(() => setPos({ x: 5 + Math.random() * 60, y: 8 + Math.random() * 70 }), 6000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="watermark" style={{ left: `${pos.x}%`, top: `${pos.y}%` }} aria-hidden>
      {t.siteTitle}
    </div>
  )
}

interface VolumeProps {
  volume: number
  muted: boolean
  onVolume: (v: number) => void
  onMute: () => void
}

function VolumeControl({ volume, muted, onVolume, onMute }: VolumeProps) {
  const { t } = useI18n()
  const silent = muted || volume === 0
  return (
    <div className="volume">
      <button className="vol-btn" onClick={onMute} aria-label={silent ? t.unmute : t.mute}>
        <svg viewBox="0 0 24 24" aria-hidden>
          <path className="spk" d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
          {silent ? (
            <path d="m16 9.5 5 5m0-5-5 5" />
          ) : (
            <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
          )}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={silent ? 0 : volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        aria-label={t.volume}
        style={{ '--fill': `${(silent ? 0 : volume) * 100}%` } as CSSProperties}
      />
    </div>
  )
}

interface LangProps {
  langs: Lang[]
  lang: Lang
  onLang: (l: Lang) => void
}

function LangSwitch({ langs, lang, onLang }: LangProps) {
  const { t } = useI18n()
  if (langs.length < 2) return null
  return (
    <div className="lang-switch" role="group" aria-label={t.videoLang}>
      {langs.map((l) => (
        <button key={l} className={l === lang ? 'active' : ''} onClick={() => onLang(l)}>
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  )
}

export function VideoModal({ lesson, index, hasNext, onClose, onNext, onChanged }: Props) {
  const { t, lang: uiLang } = useI18n()
  const title = lessonTitle(lesson, uiLang)
  const stage = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'video' | 'test'>(lesson.state === 'test' ? 'test' : 'video')
  const [notice, setNotice] = useState('')
  const [full, setFull] = useState(false)
  const [volume, setVolume] = useState(savedVolume)
  const [muted, setMuted] = useState(false)
  const [barVisible, setBarVisible] = useState(true)
  const hideTimer = useRef(0)

  // Language: remembered between lessons. Progress is stored on the Uzbek
  // timeline, so positions are mapped through the matching time marks.
  const uz = lesson.videos[0]
  const [lang, setLang] = useState<Lang>(() =>
    lesson.videos.some((v) => v.lang === savedLang(uiLang)) ? savedLang(uiLang) : uz.lang,
  )
  const video = lesson.videos.find((v) => v.lang === lang) ?? uz
  const toUz = (t: number) => mapTime(t, video.marks, uz.marks)
  // Current position on the Uzbek timeline, kept up to date while playing.
  const uzPos = useRef(lesson.position)
  const [resumeUz, setResumeUz] = useState(lesson.position)

  const changeLang = (l: Lang) => {
    if (l === lang) return
    setResumeUz(uzPos.current)
    setLang(l)
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      // ignore
    }
  }
  const langSwitch = <LangSwitch langs={lesson.videos.map((v) => v.lang)} lang={lang} onLang={changeLang} />

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.fullscreenElement && onClose()
    const onFs = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      document.body.style.overflow = ''
      window.clearTimeout(hideTimer.current)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
  }, [onClose])

  const changeVolume = (v: number) => {
    setVolume(v)
    setMuted(v === 0)
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      // ignore
    }
  }
  const toggleMute = () => {
    if (volume === 0) changeVolume(0.5)
    else setMuted((m) => !m)
  }

  // Fullscreen the whole stage (video + watermark), not the bare video element.
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    else stage.current?.requestFullscreen().catch(() => {})
  }

  // In fullscreen the top bar shows on mouse movement and hides when idle.
  const wake = () => {
    setBarVisible(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setBarVisible(false), 2500)
  }

  const finishVideo = async () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    try {
      await api.complete(lesson.id)
      onChanged()
      // A lesson already passed doesn't need its test again.
      if (lesson.state !== 'done') setMode('test')
    } catch {
      setNotice(t.notWatched)
    }
  }

  const volumeControl = (
    <VolumeControl volume={volume} muted={muted} onVolume={changeVolume} onMute={toggleMute} />
  )

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <span>{t.lessonN(lesson.number ?? index + 1)}:</span> {title}
            {mode === 'test' && <span className="head-test"> · {t.testBadge}</span>}
          </h2>
          {mode === 'test' && (
            <div className="modal-actions">
              <button className="mbtn close" onClick={onClose} aria-label={t.close}>
                ✕
              </button>
            </div>
          )}
        </div>

        {mode === 'video' && (
          // Language on the left, the other controls on the right.
          <div className="video-bar">
            {langSwitch}
            <div className="modal-actions">
              {volumeControl}
              <button className="mbtn" onClick={toggleFull}>
                {t.bigScreen}
              </button>
              <button className="mbtn close" onClick={onClose} aria-label={t.close}>
                ✕
              </button>
            </div>
          </div>
        )}

        {mode === 'video' ? (
          <div className={`stage ${full && !barVisible ? 'idle' : ''}`} ref={stage} onMouseMove={full ? wake : undefined}>
            <ProtectedVideo
              key={lang}
              src={`media/${lesson.id}.${lang}.dat`}
              poster={video.poster}
              startAt={mapTime(resumeUz, uz.marks, video.marks)}
              volume={volume}
              muted={muted}
              onTick={(t) => {
                uzPos.current = toUz(t)
              }}
              onTime={(t) => {
                api.progress(lesson.id, toUz(t)).catch(() => {})
              }}
              onEnded={finishVideo}
              onDoubleClick={toggleFull}
            />
            <Watermark />
            {notice && <div className="stage-notice">{notice}</div>}
            {full && (
              <div className={`fs-bar ${barVisible ? '' : 'hidden'}`}>
                {langSwitch}
                {volumeControl}
                <button className="mbtn" onClick={toggleFull}>
                  {t.smallScreen}
                </button>
              </div>
            )}
          </div>
        ) : (
          <TestView
            lessonId={lesson.id}
            hasNext={hasNext}
            onPassed={onChanged}
            onNext={onNext}
            onRewatch={() => setMode('video')}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}
