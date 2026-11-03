import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { UI_LANGS } from '../i18n/strings'
import { api, ApiError } from '../lib/api'

// Shown when there is no valid session token. Log in: username + password.
// Sign up: confirm a Gmail (Google account) first, then choose a username and
// a password. When Google sign-up isn't configured on the server, sign-up
// asks only for the username and the password.

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; context?: string; ux_mode?: string }): void
  renderButton(el: HTMLElement, o: Record<string, unknown>): void
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let gisLoading: Promise<void> | null = null
function loadGoogle(): Promise<void> {
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      gisLoading = null
      reject(new Error('gsi'))
    }
    document.head.appendChild(s)
  })
  return gisLoading
}

// The e-mail inside a Google ID token, only for showing it (the server verifies the token).
function tokenEmail(credential: string): string {
  try {
    const part = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)).email ?? ''
  } catch {
    return ''
  }
}

const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/

export function AuthScreen({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null) // null = not known yet
  const [credential, setCredential] = useState('')
  const [gisFailed, setGisFailed] = useState(false)
  const googleBtn = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api
      .authConfig()
      .then((c) => setClientId(c.googleClientId))
      .catch(() => setClientId(''))
  }, [])

  const needGoogle = mode === 'register' && !!clientId && !credential

  // Google's own button (it opens Google's account chooser).
  useEffect(() => {
    if (!needGoogle || !clientId) return
    let alive = true
    loadGoogle()
      .then(() => {
        if (!alive || !googleBtn.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: clientId,
          context: 'signup',
          ux_mode: 'popup',
          callback: (r) => {
            setCredential(r.credential)
            setError('')
          },
        })
        window.google.accounts.id.renderButton(googleBtn.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signup_with',
          width: 320,
          locale: lang,
        })
      })
      .catch(() => alive && setGisFailed(true))
    return () => {
      alive = false
    }
  }, [needGoogle, clientId, lang])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (!USERNAME.test(name.trim())) return setError(t.usernameRules)
      if (pw.length < 6) return setError(t.pwRules)
      if (pw !== pw2) return setError(t.pwMismatch)
    }
    setBusy(true)
    try {
      if (mode === 'login') await api.login(name.trim(), pw)
      else await api.register(credential, name.trim(), pw)
      onDone()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'google') setCredential('')
      setError(
        code === 'too_many'
          ? t.tooMany
          : code === 'invalid'
            ? t.pwRules
            : code === 'blocked'
              ? t.blockedLogin
              : code === 'bad_username'
                ? t.usernameRules
                : code === 'taken'
                  ? t.usernameTaken
                  : code === 'email_taken'
                    ? t.emailTaken
                    : code === 'google'
                      ? t.googleFailed
                      : mode === 'login'
                        ? t.wrongLogin
                        : t.noServer,
      )
    } finally {
      setBusy(false)
    }
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
    setPw('')
    setPw2('')
  }

  const email = credential ? tokenEmail(credential) : ''

  return (
    <div className="auth">
      <div className="ui-lang auth-lang" role="group">
        {UI_LANGS.map((l) => (
          <button key={l.id} className={l.id === lang ? 'active' : ''} onClick={() => setLang(l.id)}>
            {l.label}
          </button>
        ))}
      </div>
      <form className="auth-box" onSubmit={submit}>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => mode !== 'login' && switchMode()}>
            {t.login}
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => mode !== 'register' && switchMode()}>
            {t.register}
          </button>
        </div>
        <h1>{mode === 'login' ? t.authTitle : t.register}</h1>
        <p className="auth-sub">{mode === 'login' || !clientId ? t.authSub : t.signupGoogle}</p>

        {needGoogle ? (
          <div className="auth-google">
            <div ref={googleBtn} className="auth-google-btn" />
            {gisFailed ? <div className="auth-error">{t.noServer}</div> : <em>{t.googleLoading}</em>}
          </div>
        ) : (
          <>
            {mode === 'register' && email && (
              <div className="auth-gmail">
                <span>
                  {t.googleAs}: <b>{email}</b>
                </span>
                <button type="button" className="auth-switch" onClick={() => setCredential('')}>
                  {t.changeGoogle}
                </button>
              </div>
            )}
            <label className="auth-field">
              <span>{t.username}</span>
              <input
                value={name}
                autoComplete="username"
                autoFocus
                maxLength={32}
                onChange={(e) => setName(e.target.value.replace(/\s/g, ''))}
              />
              {mode === 'register' && <em>{t.usernameRules}</em>}
            </label>
            <label className="auth-field">
              <span>{t.password}</span>
              <input
                type="password"
                value={pw}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                maxLength={72}
                onChange={(e) => setPw(e.target.value)}
              />
              {mode === 'register' && <em>{t.pwRules}</em>}
            </label>
            {mode === 'register' && (
              <label className="auth-field">
                <span>{t.password2}</span>
                <input type="password" value={pw2} autoComplete="new-password" maxLength={72} onChange={(e) => setPw2(e.target.value)} />
              </label>
            )}
          </>
        )}
        {error && <div className="auth-error">{error}</div>}
        {!needGoogle && (
          <button className="tbtn primary auth-submit" disabled={busy || clientId === null || !pw || !name || (mode === 'register' && !pw2)}>
            {mode === 'login' ? t.login : t.register}
          </button>
        )}
        <button type="button" className="auth-switch" onClick={switchMode}>
          {mode === 'login' ? t.noAccount : t.haveAccount}
        </button>
      </form>
    </div>
  )
}
