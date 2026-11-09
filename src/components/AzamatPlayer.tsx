import Hls from 'hls.js/light'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useI18n } from '../i18n/context'
import { api, type AzamatVideo } from '../lib/api'
import { VolumeControl, Watermark } from './VideoModal'

interface Props {
  video: AzamatVideo
  onClose: () => void
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SPEED_KEY = 'azamat-speed'
// timeupdate fires every ~0.25 s; a bigger jump than this is a seek, not playback.
const PLAY_STEP = 3

function clock(s: number) {
  if (!Number.isFinite(s)) s = 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function savedSpeed() {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY))
    return SPEEDS.includes(v) ? v : 1
  } catch {
    return 1
  }
}

// Plays one lecture of the "Azamat Qodirov darslari" section. The lectures
// stream as encrypted HLS (backend/azamat.go). Own controls instead of the
// browser's: the viewer may seek back freely but never past the furthest
// point already watched (kept on the server), may speed up to 2x, and there
// is no full screen.
export default function AzamatPlayer({ video, onClose }: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(video.position)
  const [dur, setDur] = useState(video.duration)
  const [far, setFar] = useState(Math.max(video.furthest ?? 0, video.position))
  const [speed, setSpeed] = useState(savedSpeed)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [notice, setNotice] = useState(false)
  const furthest = useRef(far)
  const lastTick = useRef(video.position)
  const lastSaved = useRef(video.position)
  const noticeTimer = useRef(0)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const src = `hls/azamat/${video.id}/index.m3u8`
    let hls: Hls | null = null
    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 60 })
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls?.startLoad()
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls?.recoverMediaError()
        else setFailed(true)
      })
      hls.loadSource(src)
      hls.attachMedia(v)
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src // Safari plays HLS (and its AES key) natively
    } else {
      setFailed(true)
    }
    return () => hls?.destroy()
  }, [video.id])

  const save = useCallback(
    (pos: number) => {
      lastSaved.current = pos
      api.azamatProgress(video.id, pos, furthest.current).catch(() => {})
    },
    [video.id],
  )

  const showNotice = () => {
    setNotice(true)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(false), 2500)
  }

  // Every seek goes through here: anything past the watched part is pulled back.
  const seek = (to: number) => {
    const v = ref.current
    if (!v) return
    if (to > furthest.current + 0.5) {
      showNotice()
      to = furthest.current
    }
    v.currentTime = Math.max(0, to)
    lastTick.current = v.currentTime
    setCur(v.currentTime)
  }

  const toggle = () => {
    const v = ref.current
    if (!v) return
    if (v.paused) v.play().catch(() => {})
    else v.pause()
  }

  const changeSpeed = (s: number) => {
    setSpeed(s)
    if (ref.current) ref.current.playbackRate = s
    try {
      localStorage.setItem(SPEED_KEY, String(s))
    } catch {
      /* private mode: just not remembered */
    }
  }

  useEffect(() => {
    const v = ref.current
    if (v) {
      v.volume = volume
      v.muted = muted
    }
  }, [volume, muted])

  useEffect(() => {
    const v = ref.current
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (v) seek(v.currentTime - 10)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (v) seek(v.currentTime + 10)
      }
    }
    // No full screen for these lectures, whatever tries to start it.
    const noFull = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
    }
    // Like the course videos: stop when the viewer leaves the page.
    const pause = () => v?.pause()
    const onVisibility = () => document.hidden && pause()
    document.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', noFull)
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', onVisibility)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', noFull)
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', onVisibility)
      document.body.style.overflow = ''
      window.clearTimeout(noticeTimer.current)
      if (v && v.currentTime > 0) api.azamatProgress(video.id, v.currentTime, furthest.current).catch(() => {})
    }
    // seek/toggle only touch refs, so the first render's copies are fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, video.id])

  const total = dur || video.duration
  const curPct = total ? (cur / total) * 100 : 0
  const farPct = total ? (far / total) * 100 : 0

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={t.azamatTitle} onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            <span>{t.lessonN(video.number)}</span> · {video.title || t.azamatTitle}
          </h2>
          <div className="modal-actions">
            <button className="mbtn close" onClick={onClose} aria-label={t.close}>
              ✕
            </button>
          </div>
        </div>
        <div className="stage">
          {failed ? (
            <div className="video-msg">{t.videoFailed}</div>
          ) : (
            <video
              ref={ref}
              poster={video.poster}
              autoPlay
              playsInline
              controlsList="nodownload nofullscreen noremoteplayback noplaybackrate"
              disablePictureInPicture
              disableRemotePlayback
              onClick={toggle}
              onDoubleClick={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                v.playbackRate = speed
                if (Number.isFinite(v.duration)) setDur(v.duration)
                // Resume where the viewer stopped, unless that was the very end.
                if (video.position > 0 && video.position < v.duration - 15) {
                  v.currentTime = video.position
                  lastTick.current = video.position
                }
              }}
              onRateChange={(e) => {
                // Keep the speed within 0.5x–2x even if changed from outside.
                const v = e.currentTarget
                if (v.playbackRate > 2 || v.playbackRate < 0.5) v.playbackRate = speed
              }}
              onSeeking={(e) => {
                const v = e.currentTarget
                if (v.currentTime > furthest.current + 1) {
                  showNotice()
                  v.currentTime = furthest.current
                }
                lastTick.current = v.currentTime
              }}
              onTimeUpdate={(e) => {
                const v = e.currentTarget
                const pos = v.currentTime
                // Only real playback moves the "watched" mark forward.
                if (!v.seeking && pos > furthest.current && pos - lastTick.current < PLAY_STEP) {
                  furthest.current = pos
                  setFar(pos)
                }
                lastTick.current = pos
                setCur(pos)
                if (Math.abs(pos - lastSaved.current) >= 10) save(pos)
              }}
              onPlay={() => setPlaying(true)}
              onPause={(e) => {
                setPlaying(false)
                save(e.currentTarget.currentTime)
              }}
              onEnded={(e) => {
                setPlaying(false)
                furthest.current = e.currentTarget.duration
                setFar(furthest.current)
                save(e.currentTarget.duration)
              }}
            />
          )}
          <Watermark />
          {notice && <div className="stage-notice">{t.azamatNoSkip}</div>}
        </div>

        {!failed && (
          <div className="az-controls">
            <button className="az-btn" onClick={toggle} aria-label={playing ? t.azamatPause : t.azamatPlay}>
              <svg viewBox="0 0 24 24" aria-hidden>
                {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
              </svg>
            </button>
            <button className="az-btn" onClick={() => seek(cur - 10)} aria-label={t.azamatBack} title={t.azamatBack}>
              <svg viewBox="0 0 24 24" aria-hidden className="stroke">
                <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
                <text x="12" y="15.5" textAnchor="middle">10</text>
              </svg>
            </button>
            {/* Times are shown in "viewer time": at 2x a 40-minute lecture takes 20 minutes. */}
            <span className="az-time">{clock(cur / speed)}</span>
            <input
              className="az-seek"
              type="range"
              min={0}
              max={total}
              step={1}
              value={Math.min(cur, total)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label={t.azamatTitle}
              style={{ '--cur': `${curPct}%`, '--far': `${farPct}%` } as CSSProperties}
            />
            <span className="az-time">{clock(total / speed)}</span>
            <label className="az-speed" title={t.azamatSpeed}>
              <span>{t.azamatSpeed}</span>
              <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}x
                  </option>
                ))}
              </select>
            </label>
            <VolumeControl
              volume={volume}
              muted={muted}
              onVolume={(x) => {
                setVolume(x)
                setMuted(x === 0)
              }}
              onMute={() => setMuted((m) => !m)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
