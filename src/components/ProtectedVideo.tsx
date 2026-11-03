import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { loadVideo } from '../lib/media'

interface Props {
  src: string
  poster?: string
  startAt?: number
  volume: number
  muted: boolean
  onTime?: (seconds: number) => void
  /** Called on every time update (unthrottled). */
  onTick?: (seconds: number) => void
  onEnded?: () => void
  onDoubleClick?: () => void
}

function togglePlay(v: HTMLVideoElement | null) {
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}

// Plays a lesson with no browser controls: one play/pause button in the
// middle, no timeline, and seeking is reverted.
export function ProtectedVideo({ src, poster, startAt = 0, volume, muted, onTime, onTick, onEnded, onDoubleClick }: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLVideoElement>(null)
  const lastSaved = useRef(0)
  // Last position reached by normal playback; any jump away from it is undone.
  const lastTime = useRef(0)
  const [url, setUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(0)
  const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false)

  // Fetch and un-scramble the video; the real file never gets a URL of its own.
  useEffect(() => {
    const ctrl = new AbortController()
    let objectUrl: string | null = null
    loadVideo(src, setLoaded, ctrl.signal)
      .then((u) => {
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setFailed(true)
      })
    return () => {
      ctrl.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.volume = volume
    v.muted = muted
  }, [volume, muted, url])

  // Stop playback when the viewer leaves the page (e.g. to a recording tool).
  useEffect(() => {
    const pause = () => ref.current?.pause()
    const onVisibility = () => document.hidden && pause()
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const toggle = () => togglePlay(ref.current)

  // Space toggles playback; arrow keys and other media shortcuts do nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay(ref.current)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (failed) return <div className="video-msg">{t.videoFailed}</div>

  if (!url) {
    return (
      <div className="video-msg">
        <span>{t.videoLoading(Math.round(loaded * 100))}</span>
        <div className="load-bar">
          <div style={{ width: `${loaded * 100}%` }} />
        </div>
      </div>
    )
  }

  return (
    <>
      <video
        ref={ref}
        src={url}
        poster={poster}
        autoPlay
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        onClick={toggle}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          e.preventDefault()
          onDoubleClick?.()
        }}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          // Resume where the viewer stopped, unless that was the very end.
          const resume = startAt && startAt < v.duration - 5 ? startAt : 0
          lastTime.current = resume
          v.currentTime = resume
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime
          onTick?.(t)
          if (t >= lastTime.current && t - lastTime.current < 2) lastTime.current = t
          if (Math.abs(t - lastSaved.current) >= 5) {
            lastSaved.current = t
            onTime?.(t)
          }
        }}
        onSeeking={(e) => {
          const v = e.currentTarget
          if (Math.abs(v.currentTime - lastTime.current) > 1) v.currentTime = lastTime.current
        }}
        onPlay={() => setPlaying(true)}
        onPause={(e) => {
          setPlaying(false)
          onTime?.(e.currentTarget.currentTime)
        }}
        onEnded={() => {
          setPlaying(false)
          // Replaying starts again from the beginning.
          lastTime.current = 0
          onEnded?.()
        }}
      />
      {!playing && (
        <button type="button" className="big-play" onClick={toggle} aria-label={t.play}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l11-6.5z" /></svg>
        </button>
      )}
    </>
  )
}
