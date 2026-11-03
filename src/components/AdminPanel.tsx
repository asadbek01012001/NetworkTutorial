import { useCallback, useEffect, useState } from 'react'
import {
  admin,
  type AdminLogEntry,
  type AdminQuestion,
  type AdminStats,
  type AdminUser,
  type AdminUserDetail,
  type LessonState,
  type PracticeKind,
} from '../lib/api'

// Admin panel (Uzbek only — it is for the site owner). Full screen like the
// practice view: overview, accounts, test-question analysis and the action log.

type Tab = 'stats' | 'users' | 'questions' | 'log'
const PAGES: { id: Tab; label: string; icon: string }[] = [
  { id: 'stats', label: 'Dashboard', icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-4H4z' },
  { id: 'users', label: 'Foydalanuvchilar', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14.5a7 7 0 0 1 4 6.5' },
  { id: 'questions', label: 'Test savollari', icon: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
  { id: 'log', label: 'Jurnal', icon: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' },
]

// The open page lives in the address (#admin/<page>[/<user id>]) so a reload
// or the browser's Back button keeps the admin where they were.
function parseHash(): { tab: Tab; userId: number | null } {
  const [, page, id] = window.location.hash.slice(1).split('/')
  const tab = PAGES.some((p) => p.id === page) ? (page as Tab) : 'stats'
  const n = Number(id)
  return { tab, userId: tab === 'users' && n > 0 ? n : null }
}
const go = (tab: Tab, userId?: number | null) => {
  window.location.hash = `admin/${tab}${userId ? `/${userId}` : ''}`
}

const STATE_LABEL: Record<LessonState, string> = {
  done: 'Tugatgan',
  test: 'Test kutilmoqda',
  open: 'Ko‘ryapti',
  locked: 'Yopiq',
}
const KIND_LABEL: Record<PracticeKind, string> = { switch: 'Switch / MAC', subnet: 'Subnet jadval', range: 'IP + mask' }
const ACTION_LABEL: Record<AdminLogEntry['action'], string> = {
  password: 'Yangi parol berdi',
  block: 'Blokladi',
  unblock: 'Blokdan chiqardi',
  reset: 'Progressni tozaladi',
  delete: 'O‘chirdi',
}

const pad = (n: number) => String(n).padStart(2, '0')
function fmtDate(iso: string | null | undefined, time = true) {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
  return time ? `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}` : day
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0)

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState(false)
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    setError(false)
    load()
      .then((d) => alive && setData(d))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return { data, error, reload }
}

export function AdminPanel({ username, onClose }: { username: string; onClose: () => void }) {
  const [{ tab, userId }, setRoute] = useState(parseHash)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const page = PAGES.find((p) => p.id === tab)!
  return (
    <div className="adm adm-shell" role="dialog" aria-label="Admin panel">
      <aside className="adm-side">
        <div className="adm-brand">
          <span className="adm-brand-icon" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <span>Admin panel</span>
        </div>
        <nav className="adm-nav">
          {PAGES.map((p) => (
            <button key={p.id} className={p.id === tab ? 'active' : ''} aria-current={p.id === tab ? 'page' : undefined} onClick={() => go(p.id)}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={p.icon} />
              </svg>
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span className="adm-me">{username}</span>
          <button className="adm-exit" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span>Saytga qaytish</span>
          </button>
        </div>
      </aside>

      <section className="adm-main">
        <header className="adm-top">
          <h1>{userId ? 'Foydalanuvchi' : page.label}</h1>
          <button className="mbtn" onClick={() => setReloadKey((k) => k + 1)}>
            ⟳ Yangilash
          </button>
        </header>
        <div className="adm-body" key={`${tab}-${userId}-${reloadKey}`}>
          {tab === 'stats' && <StatsTab />}
          {tab === 'users' &&
            (userId === null ? <UsersTab onOpen={(id) => go('users', id)} /> : <UserView id={userId} onBack={() => go('users')} />)}
          {tab === 'questions' && <QuestionsTab />}
          {tab === 'log' && <LogTab />}
        </div>
      </section>
    </div>
  )
}

const LoadError = () => <div className="auth-error">Ma’lumotni yuklab bo‘lmadi</div>
const Loading = () => <p className="adm-muted">Yuklanmoqda…</p>

// ---------- overview ----------

function StatsTab() {
  const { data, error } = useLoad<AdminStats>(admin.stats, [])
  if (error) return <LoadError />
  if (!data) return <Loading />
  const c = data.counts
  const tiles: [string, string | number, string?][] = [
    ['Akkauntlar', c.accounts, c.blocked ? `${c.blocked} ta bloklangan` : undefined],
    ['Bugun faol', c.activeToday],
    ['7 kunda faol', c.active7d],
    ['Bugun yangi', c.newToday],
    ['7 kunda yangi', c.new7d],
    ['Kursni tugatgan', c.finished],
    ['Dars testlari', c.tests, `${pct(c.testsPassed, c.tests)}% o‘tgan`],
    ['Umumiy test', c.exams, c.exams ? `o‘rtacha ${c.examAvg}%` : undefined],
    ['Mashqlar', c.practice],
  ]
  const max = Math.max(1, ...data.signups.map((d) => d.count))
  const first = data.lessons[0]?.started || 0
  return (
    <div className="adm-wrap">
      <div className="adm-tiles">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="adm-tile">
            <span className="adm-tile-label">{label}</span>
            <span className="adm-tile-value">{value}</span>
            {sub && <span className="adm-tile-sub">{sub}</span>}
          </div>
        ))}
      </div>

      <h2 className="adm-h2">Ro‘yxatdan o‘tish — oxirgi 30 kun</h2>
      <div className="adm-bars" role="img" aria-label="Kunlik ro‘yxatdan o‘tishlar">
        {data.signups.map((d) => (
          <div key={d.day} className="adm-bar" title={`${fmtDate(d.day, false)}: ${d.count}`}>
            {d.count > 0 && <span className="adm-bar-n">{d.count}</span>}
            <span className="adm-bar-fill" style={{ height: `${(d.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="adm-bars-axis">
        <span>{fmtDate(data.signups[0]?.day, false)}</span>
        <span>Bugun</span>
      </div>

      <h2 className="adm-h2">Darslar bo‘yicha</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Dars</th>
              <th>Boshlagan</th>
              <th>Video ko‘rgan</th>
              <th>Test o‘tgan</th>
              <th>Urinishlar</th>
              <th>O‘rtacha ball</th>
            </tr>
          </thead>
          <tbody>
            {data.lessons.map((l) => (
              <tr key={l.index}>
                <td>
                  <b>{l.index + 1}.</b> {l.title}
                </td>
                <td>{l.started}</td>
                <td>{l.videoDone}</td>
                <td>
                  <span className="adm-funnel">
                    <span className="adm-funnel-fill" style={{ width: `${pct(l.passed, first)}%` }} />
                    <span className="adm-funnel-n">{l.passed}</span>
                  </span>
                </td>
                <td>{l.attempts}</td>
                <td className={l.attempts && l.avgScore < data.passScore ? 'adm-warn' : ''}>{l.attempts ? `${l.avgScore} / 10` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- accounts ----------

function UserStatus({ u }: { u: AdminUser }) {
  if (u.isAdmin) return <span className="adm-tag admin">Admin</span>
  if (u.blocked) return <span className="adm-tag bad">Bloklangan</span>
  if (!u.hasPassword) return <span className="adm-tag old">Eski</span>
  return <span className="adm-tag ok">Faol</span>
}

function UsersTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  const { data, error } = useLoad(() => admin.users(query), [query])
  return (
    <div className="adm-wrap">
      <div className="adm-search">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Login yoki IP bo‘yicha qidirish"
          aria-label="Qidirish"
        />
        {data && <span className="adm-muted">{data.users.length} ta</span>}
      </div>
      {error && <LoadError />}
      {!data && !error && <Loading />}
      {data && (
        <div className="adm-table-wrap">
          <table className="adm-table adm-click">
            <thead>
              <tr>
                <th>Login</th>
                <th>Holat</th>
                <th>Ro‘yxatdan o‘tgan</th>
                <th>Oxirgi faollik</th>
                <th>O‘tgan darslar</th>
                <th>Ball</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} tabIndex={0} onClick={() => onOpen(u.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(u.id)}>
                  <td>
                    <b>{u.username}</b>
                  </td>
                  <td>
                    <UserStatus u={u} />
                  </td>
                  <td>{fmtDate(u.createdAt, false)}</td>
                  <td>{fmtDate(u.lastSeen)}</td>
                  <td>{u.passed}</td>
                  <td>{u.score}</td>
                </tr>
              ))}
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={6} className="adm-muted">
                    Hech kim topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

type Pending = 'password' | 'block' | 'reset' | 'delete' | null

function UserView({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, error, reload } = useLoad<AdminUserDetail>(() => admin.user(id), [id])
  const [confirm, setConfirm] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [newPw, setNewPw] = useState<string | null>(null)

  if (error) return <LoadError />
  if (!data) return <Loading />
  const u = data.user

  const run = async (what: Exclude<Pending, null>) => {
    if (confirm !== what) {
      setConfirm(what)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      if (what === 'password') {
        setNewPw((await admin.newPassword(u.id)).password)
        setMsg({ ok: true, text: 'Yangi parol yaratildi. Uni foydalanuvchiga bering.' })
      } else if (what === 'block') {
        await admin.block(u.id, !u.blocked)
        setMsg({ ok: true, text: u.blocked ? 'Blokdan chiqarildi' : 'Bloklandi' })
      } else if (what === 'reset') {
        await admin.reset(u.id)
        setMsg({ ok: true, text: 'Progress tozalandi' })
      } else {
        await admin.remove(u.id)
        onBack()
        return
      }
      reload()
    } catch {
      setMsg({ ok: false, text: 'Bajarib bo‘lmadi' })
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const btn = (what: Exclude<Pending, null>, label: string, danger = false) => (
    <button
      className={`tbtn adm-act${danger ? ' danger' : ''}${confirm === what ? ' confirm' : ''}`}
      disabled={busy || u.isAdmin}
      onClick={() => run(what)}
      onBlur={() => confirm === what && setConfirm(null)}
    >
      {confirm === what ? 'Tasdiqlang' : label}
    </button>
  )

  return (
    <div className="adm-wrap">
      <button className="mbtn" onClick={onBack}>
        ← Ro‘yxatga qaytish
      </button>

      <div className="adm-user-head">
        <h2>{u.username}</h2>
        <UserStatus u={u} />
      </div>
      <div className="adm-facts">
        <span>
          Ro‘yxatdan o‘tgan: <b>{fmtDate(u.createdAt)}</b>
        </span>
        <span>
          Oxirgi faollik: <b>{fmtDate(u.lastSeen)}</b>
        </span>
        <span>
          IP: <b>{u.ip}</b>
        </span>
        <span>
          Ball: <b>{u.score}</b> · O‘tgan darslar: <b>{u.passed}</b>
        </span>
      </div>

      {u.isAdmin ? (
        <p className="adm-muted">Admin akkauntini paneldan o‘zgartirib bo‘lmaydi.</p>
      ) : (
        <div className="adm-actions">
          {btn('password', 'Yangi parol berish')}
          {btn('block', u.blocked ? 'Blokdan chiqarish' : 'Bloklash', !u.blocked)}
          {btn('reset', 'Progressni tozalash', true)}
          {btn('delete', 'Akkauntni o‘chirish', true)}
        </div>
      )}
      {confirm && <p className="adm-muted">Amalni bajarish uchun tugmani yana bir marta bosing.</p>}
      {msg && <div className={msg.ok ? 'adm-ok' : 'auth-error'}>{msg.text}</div>}
      {newPw && (
        <div className="adm-pw">
          <span>
            Login: <b>{u.username}</b>
          </span>
          <span>
            Yangi parol: <b className="adm-pw-val">{newPw}</b>
          </span>
        </div>
      )}

      <h2 className="adm-h2">Darslar</h2>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Dars</th>
              <th>Holat</th>
              <th>Video ko‘rilgan</th>
              <th>Eng yaxshi ball</th>
              <th>Urinishlar</th>
            </tr>
          </thead>
          <tbody>
            {data.lessons.map((l) => (
              <tr key={l.index}>
                <td>
                  <b>{l.index + 1}.</b> {l.title}
                </td>
                <td>
                  <span className={`adm-state ${l.state}`}>{STATE_LABEL[l.state]}</span>
                </td>
                <td>{l.state === 'locked' && !l.watched ? '—' : `${l.watched}%`}</td>
                <td>{l.attempts ? `${l.bestScore} / 10` : '—'}</td>
                <td>{l.attempts || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="adm-cols">
        <section>
          <h2 className="adm-h2">Dars testlari tarixi</h2>
          {data.tests.length === 0 ? (
            <p className="adm-muted">Hali test topshirmagan</p>
          ) : (
            <ul className="adm-list">
              {data.tests.map((t, i) => (
                <li key={i}>
                  <span>{t.index + 1}-dars</span>
                  <b className={t.score >= 7 ? 'adm-good' : 'adm-warn'}>
                    {t.score} / {t.total}
                  </b>
                  <span className="adm-muted">{fmtDate(t.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="adm-h2">Umumiy test</h2>
          {data.exams.length === 0 ? (
            <p className="adm-muted">Topshirmagan</p>
          ) : (
            <ul className="adm-list">
              {data.exams.map((t, i) => (
                <li key={i}>
                  <b>
                    {t.score} / {t.total}
                  </b>
                  <span>{pct(t.score, t.total)}%</span>
                  <span className="adm-muted">{fmtDate(t.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="adm-h2">Mashqlar</h2>
          {data.practice.length === 0 ? (
            <p className="adm-muted">Mashq bajarmagan</p>
          ) : (
            <ul className="adm-list">
              {data.practice.map((p) => (
                <li key={p.kind}>
                  <span>{KIND_LABEL[p.kind] ?? p.kind}</span>
                  <b>{p.done} ta</b>
                  <span>{pct(p.score, p.total)}% to‘g‘ri</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="adm-h2">Ochiq sessiyalar</h2>
          {data.sessions.length === 0 ? (
            <p className="adm-muted">Yo‘q</p>
          ) : (
            <ul className="adm-list">
              {data.sessions.map((s, i) => (
                <li key={i}>
                  <b>{s.ip}</b>
                  <span>{browserName(s.userAgent)}</span>
                  <span className="adm-muted">{fmtDate(s.lastSeen)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function browserName(ua: string) {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Yandex' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Brauzer'
  return os ? `${br}, ${os}` : br
}

// ---------- test questions ----------

function QuestionsTab() {
  const { data, error } = useLoad(admin.questions, [])
  const [lesson, setLesson] = useState(0)
  if (error) return <LoadError />
  if (!data) return <Loading />
  const l = data.lessons[lesson]
  const rate = (q: AdminQuestion) => (q.answered ? q.wrong / q.answered : -1)
  const qs = [...(l?.questions ?? [])].sort((a, b) => rate(b) - rate(a))
  return (
    <div className="adm-wrap">
      <div className="adm-lesson-pick" role="tablist" aria-label="Dars">
        {data.lessons.map((x) => (
          <button key={x.index} className={x.index === lesson ? 'active' : ''} onClick={() => setLesson(x.index)} title={x.title}>
            {x.index + 1}
          </button>
        ))}
      </div>
      {l && (
        <>
          <h2 className="adm-h2">
            {l.index + 1}. {l.title}
          </h2>
          <p className="adm-muted">Eng ko‘p xato qilinadigan savollar tepada.</p>
          {qs.map((q) => (
            <div key={q.n} className="adm-q">
              <div className="adm-q-head">
                <span className="adm-q-n">{q.n}-savol</span>
                {q.answered ? (
                  <span className={rate(q) >= 0.5 ? 'adm-warn' : rate(q) >= 0.25 ? 'adm-mid' : 'adm-good'}>
                    Xato: {pct(q.wrong, q.answered)}% ({q.wrong} / {q.answered})
                  </span>
                ) : (
                  <span className="adm-muted">Hali javob berilmagan</span>
                )}
              </div>
              <p className="adm-q-text">{q.q}</p>
              <ul className="adm-opts">
                {q.options.map((o, i) => (
                  <li key={i} className={i === q.answer ? 'right' : ''}>
                    <span className="adm-opt-fill" style={{ width: `${pct(q.picks[i], q.answered)}%` }} />
                    <span className="adm-opt-text">
                      {i === q.answer && '✓ '}
                      {o}
                    </span>
                    <b>{q.picks[i]}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ---------- action log ----------

function LogTab() {
  const { data, error } = useLoad(admin.log, [])
  if (error) return <LoadError />
  if (!data) return <Loading />
  if (data.log.length === 0) return <p className="adm-muted">Hali hech qanday amal bajarilmagan.</p>
  return (
    <div className="adm-wrap">
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Vaqt</th>
              <th>Admin</th>
              <th>Amal</th>
              <th>Kimga</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {data.log.map((e, i) => (
              <tr key={i}>
                <td>{fmtDate(e.at)}</td>
                <td>{e.admin}</td>
                <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                <td>
                  <b>{e.target}</b>
                </td>
                <td>{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
