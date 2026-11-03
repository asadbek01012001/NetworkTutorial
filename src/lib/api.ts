// Client for the Go backend (backend/). The visitor is identified by an
// httpOnly cookie the server sets on the first /api/course call.

export type LessonState = 'locked' | 'open' | 'test' | 'done'

export type Lang = 'uz' | 'en' | 'ru'

export interface VideoView {
  lang: Lang
  poster: string
  duration: number
  /** Time marks that match across languages (same narration lines). */
  marks: number[]
}

export interface LessonView {
  id: string
  title: string
  /** Title per interface language (uz, ru, en). */
  titles: Record<string, string>
  /** Uzbek duration; `position` is always on the Uzbek timeline. */
  duration: number
  poster: string
  /** Available languages; the first is Uzbek. */
  videos: VideoView[]
  state: LessonState
  position: number
  bestScore: number
}

export interface CourseView {
  username: string
  passScore: number
  lessons: LessonView[]
}

export interface TestQuestion {
  q: string
  options: string[]
}

export interface TestResult {
  score: number
  total: number
  passed: boolean
  passScore: number
  wrong: number[]
}

export interface ExamQuestion extends TestQuestion {
  /** Lesson number the question is about. */
  lesson: number
}

export interface ExamResult {
  score: number
  total: number
  /** Correct option index for every question. */
  correct: number[]
  best: number
}

export interface RatingRow {
  rank: number
  username: string
  score: number
  passed: number
  me: boolean
}

export interface RatingView {
  username: string
  me: RatingRow | null
  participants: number
  maxScore: number
  lessons: number
  top: RatingRow[]
}

export interface HistoryItem {
  lessonId: string
  index: number
  score: number
  total: number
  passed: boolean
  at: string
}

/** The server needs a login (no valid session token). */
export class AuthError extends Error {}

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 401 && err.error === 'auth') {
      window.dispatchEvent(new Event('auth-required'))
      throw new AuthError('auth')
    }
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status)
  }
  return res.json() as Promise<T>
}

export type PracticeKind = 'switch' | 'subnet' | 'range'
export interface SwitchTask {
  ports: { name: string; device?: string }[]
  hubHosts: string[]
  table: Record<string, string[]>
  src: string
  dst: string
}
export interface SubnetTask {
  ip: string
  prefix: number
}
export interface RangeTask {
  ip: number[]
  mask: number[]
  ipBin: string[]
  maskBin: string[]
}
export interface PracticeTask {
  id: number
  kind: PracticeKind
  num: number
  count: number
  task: SwitchTask | SubnetTask | RangeTask
  total: number
}
export interface PracticeResult {
  score: number
  total: number
  fields: Record<string, boolean>
  correct: Record<string, string> | { ports: string[]; statements: string[] }
}
export interface PracticeStat {
  done: number
  perfect: number
  points: number
  total: number
}

export const api = {
  course: () => call<CourseView>('GET', 'api/course'),
  progress: (id: string, position: number) => call('POST', `api/lessons/${id}/progress`, { position }),
  complete: (id: string) => call('POST', `api/lessons/${id}/complete`),
  test: (id: string) => call<{ passScore: number; questions: TestQuestion[] }>('GET', `api/lessons/${id}/test`),
  submitTest: (id: string, answers: number[]) => call<TestResult>('POST', `api/lessons/${id}/test`, { answers }),
  exam: () => call<{ size: number; best: number; attempts: number }>('GET', 'api/exam'),
  newExam: () => call<{ id: number; questions: ExamQuestion[] }>('POST', 'api/exam/new'),
  submitExam: (id: number, answers: number[]) => call<ExamResult>('POST', `api/exam/${id}`, { answers }),
  rating: () => call<RatingView>('GET', 'api/rating'),
  history: () => call<{ attempts: HistoryItem[] }>('GET', 'api/history'),
  login: (username: string, password: string) => call<{ username: string }>('POST', 'api/auth/login', { username, password }),
  register: (password: string) => call<{ username: string }>('POST', 'api/auth/register', { password }),
  logout: () => call<{ ok: boolean }>('POST', 'api/auth/logout'),
  nextUsername: () => call<{ username: string }>('GET', 'api/auth/next'),
  practiceStats: () => call<{ stats: Record<PracticeKind, PracticeStat> }>('GET', 'api/practice'),
  practiceCurrent: (kind: PracticeKind) => call<PracticeTask>('GET', `api/practice/current/${kind}`),
  practiceNew: (kind: PracticeKind) => call<PracticeTask>('POST', `api/practice/new/${kind}`),
  practiceCheck: (id: number, answers: unknown) => call<PracticeResult>('POST', `api/practice/check/${id}`, { answers }),
}

export const canWatch = (s: LessonState) => s !== 'locked'

export const lessonTitle = (l: LessonView, lang: string) => l.titles?.[lang] ?? l.title
