import { useI18n } from '../i18n/context'
import { canWatch, lessonTitle, type LessonView } from '../lib/api'

// The course drawn as a network: a central router with one host per lesson.

const SIZE = 560
const C = SIZE / 2
const RING = 210

interface Props {
  lessons: LessonView[]
  nextId?: string
  onOpen: (lesson: LessonView) => void
}

export function TopologyMap({ lessons, nextId, onOpen }: Props) {
  const { t, lang } = useI18n()
  const hosts = lessons.map((lesson, i) => {
    const a = ((-90 + (i * 360) / lessons.length) * Math.PI) / 180
    return { lesson, i, x: C + RING * Math.cos(a), y: C + RING * Math.sin(a) }
  })

  return (
    <svg className="topo" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={t.mapLabel}>
      <defs>
        <radialGradient id="core-glow">
          <stop offset="0" stopColor="var(--cyan)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx={C} cy={C} r={RING} className="topo-orbit" />

      {hosts.map((h) => {
        const d = `M${C},${C} L${h.x},${h.y}`
        return (
          <g key={h.lesson.id}>
            <path d={d} className={`topo-link ${h.lesson.state}`} />
            {canWatch(h.lesson.state) && (
              <circle r="4" className={`packet ${h.lesson.state}`}>
                <animateMotion dur="1.8s" repeatCount="indefinite" path={d} begin={`${h.i * 0.3}s`} />
              </circle>
            )}
          </g>
        )
      })}

      <circle cx={C} cy={C} r="95" fill="url(#core-glow)" />
      <g className="topo-core">
        <circle cx={C} cy={C} r="44" />
        <path d={`M${C - 18},${C - 8} h36 m-9,-8 l9,8 -9,8 M${C + 18},${C + 8} h-36 m9,-8 l-9,8 9,8`} />
      </g>

      {hosts.map((h) => {
        const { lesson } = h
        const watchable = canWatch(lesson.state)
        const open = () => watchable && onOpen(lesson)
        return (
          <g
            key={lesson.id}
            className={`topo-host ${lesson.state}`}
            onClick={open}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
            tabIndex={watchable ? 0 : -1}
            role={watchable ? 'button' : undefined}
            aria-label={`${t.lessonN(h.i + 1)}: ${lessonTitle(lesson, lang)}${lesson.state === 'locked' ? ` (${t.locked})` : ''}`}
          >
            <title>{`${t.lessonN(h.i + 1)}: ${lessonTitle(lesson, lang)}`}</title>
            {lesson.id === nextId && <circle cx={h.x} cy={h.y} r="30" className="pulse" />}
            <circle cx={h.x} cy={h.y} r="30" className="host-dot" />
            {lesson.state === 'locked' ? (
              <path
                className="host-lock"
                d={`M${h.x - 9},${h.y - 1} h18 v13 h-18 z M${h.x - 5.5},${h.y - 1} v-5 a5.5,5.5 0 0 1 11,0 v5`}
              />
            ) : (
              <text x={h.x} y={h.y + 8} className="host-num">
                {lesson.state === 'done' ? '✓' : lesson.state === 'test' ? '?' : h.i + 1}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
