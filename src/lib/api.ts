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
  /** Position in the full course; lessons an admin hid for this user leave a gap. */
  number?: number
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
  role?: Role
  /** Teacher or higher: may open the panel. */
  staff?: boolean
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

// ---- admin panel ----
export type Role = 'student' | 'teacher' | 'admin' | 'superadmin'
export interface AdminCounts {
  students: number
  teachers: number
  admins: number
  oldAccounts: number
  blocked: number
  activeToday: number
  active7d: number
  newToday: number
  new7d: number
  tests: number
  testsPassed: number
  avgScore: number
  exams: number
  examAvg: number
  practice: number
  finished: number
}
export interface AdminStats {
  counts: AdminCounts
  daily: { day: string; active: number; signups: number; passed: number; failed: number }[]
  progress: { label: string; count: number }[]
  lessons: AdminLesson[]
  passScore: number
}
export interface AdminUser {
  id: number
  username: string
  createdAt: string
  lastSeen: string | null
  ip: string
  passed: number
  score: number
  tests: number
  blocked: boolean
  role: Role
  hasPassword: boolean
  email: string
}
export interface AdminAttempt {
  id: number
  index: number
  score: number
  total: number
  at: string
}
export type AccessMode = 'queue' | 'open' | 'hidden'
export type AdminLessonState = LessonState | 'hidden'
export interface AdminLesson {
  id: string
  index: number
  title: string
  duration: number
  langs: Lang[]
  poster: string
  questions: number
  started: number
  videoDone: number
  passed: number
  attempts: number
  avgScore: number
  opened: number
  hidden: number
}
export interface AdminLessonUser {
  id: number
  username: string
  lastSeen: string | null
  blocked: boolean
  hasPassword: boolean
  state: AdminLessonState
  access: AccessMode
  watched: number
  bestScore: number
  attempts: number
}
export interface AdminUserDetail {
  user: AdminUser
  lessons: { id: string; index: number; title: string; state: AdminLessonState; access: AccessMode; watched: number; bestScore: number; attempts: number }[]
  tests: AdminAttempt[]
  exams: AdminAttempt[]
  practice: { kind: PracticeKind; done: number; score: number; total: number }[]
  sessions: { ip: string; userAgent: string; lastSeen: string }[]
  canManage: boolean
  canAccess: boolean
}
export interface AdminQuestion {
  n: number
  q: string
  options: string[]
  answer: number
  answered: number
  wrong: number
  picks: number[]
}
export type AttemptKind = 'test' | 'exam'
export interface AdminAttemptDetail {
  kind: AttemptKind
  index: number
  title: string
  score: number
  total: number
  at: string
  changed: boolean // the lesson test was edited after this attempt
  questions: { q: string; options: string[]; answer: number; picked: number; lesson: number }[]
}
export interface AdminLogEntry {
  admin: string
  action: 'password' | 'block' | 'unblock' | 'reset' | 'delete' | 'access_open' | 'access_queue' | 'access_hidden' | 'create' | 'role'
  target: string
  details: string
  ip: string
  at: string
}

export const admin = {
  stats: () => call<AdminStats>('GET', 'api/admin/stats'),
  users: (q: string, role = '') => call<{ users: AdminUser[] }>('GET', `api/admin/users?q=${encodeURIComponent(q)}&role=${role}`),
  createUser: (username: string, role: Role) => call<{ id: number; username: string; password: string }>('POST', 'api/admin/users', { username, role }),
  setRole: (id: number, role: Role) => call<{ ok: boolean }>('POST', `api/admin/users/${id}/role`, { role }),
  user: (id: number) => call<AdminUserDetail>('GET', `api/admin/users/${id}`),
  newPassword: (id: number) => call<{ username: string; password: string }>('POST', `api/admin/users/${id}/password`),
  block: (id: number, blocked: boolean) => call<{ ok: boolean }>('POST', `api/admin/users/${id}/block`, { blocked }),
  reset: (id: number) => call<{ ok: boolean }>('POST', `api/admin/users/${id}/reset`),
  remove: (id: number) => call<{ ok: boolean }>('DELETE', `api/admin/users/${id}`),
  lessons: () => call<{ lessons: AdminLesson[]; passScore: number }>('GET', 'api/admin/lessons'),
  lessonUsers: (id: string, q: string) =>
    call<{ lesson: AdminLesson; users: AdminLessonUser[] }>('GET', `api/admin/lessons/${id}/users?q=${encodeURIComponent(q)}`),
  setAccess: (id: string, userId: number, mode: AccessMode) => call<{ ok: boolean }>('POST', `api/admin/lessons/${id}/access`, { userId, mode }),
  questions: () => call<{ lessons: { index: number; title: string; questions: AdminQuestion[] }[] }>('GET', 'api/admin/questions'),
  log: () => call<{ log: AdminLogEntry[] }>('GET', 'api/admin/log'),
  attempt: (kind: AttemptKind, id: number) => call<AdminAttemptDetail>('GET', `api/admin/attempts/${kind}/${id}`),
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
  register: (credential: string, username: string, password: string) =>
    call<{ username: string }>('POST', 'api/auth/register', { credential, username, password }),
  authConfig: () => call<{ googleClientId: string }>('GET', 'api/auth/config'),
  logout: () => call<{ ok: boolean }>('POST', 'api/auth/logout'),
  practiceStats: () => call<{ stats: Record<PracticeKind, PracticeStat> }>('GET', 'api/practice'),
  practiceCurrent: (kind: PracticeKind) => call<PracticeTask>('GET', `api/practice/current/${kind}`),
  practiceNew: (kind: PracticeKind) => call<PracticeTask>('POST', `api/practice/new/${kind}`),
  practiceCheck: (id: number, answers: unknown) => call<PracticeResult>('POST', `api/practice/check/${id}`, { answers }),
}

export const canWatch = (s: LessonState) => s !== 'locked'

export const lessonTitle = (l: LessonView, lang: string) => l.titles?.[lang] ?? l.title
