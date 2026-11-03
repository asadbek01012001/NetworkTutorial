import { useEffect, useState, type FormEvent } from 'react'
import { useI18n } from '../i18n/context'
import { UI_LANGS } from '../i18n/strings'
import { api, ApiError } from '../lib/api'

// Shown when there is no valid session token: log in or create an account.
// On sign-up the site gives the username itself; the person only chooses a password.
export function AuthScreen({ onDone }: { onDone: () => void }) {
  const { t, lang, setLang } = useI18n()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [nextName, setNextName] = useState('')
  const [created, setCreated] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The name the new account will get, shown in a locked field.
  useEffect(() => {
    if (mode !== 'register') return
    api
      .nextUsername()
      .then((r) => setNextName(r.username))
      .catch(() => setNextName(''))
  }, [mode])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (pw.length < 6) return setError(t.pwRules)
      if (pw !== pw2) return setError(t.pwMismatch)
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        await api.login(name.trim(), pw)
        onDone()
      } else {
        setCreated((await api.register(pw)).username)
      }
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(code === 'too_many' ? t.tooMany : code === 'invalid' ? t.pwRules : t.wrongLogin)
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

  const langs = (
    <div className="ui-lang auth-lang" role="group">
      {UI_LANGS.map((l) => (
        <button key={l.id} className={l.id === lang ? 'active' : ''} onClick={() => setLang(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  )

  // After sign-up: show the given name big, so it can be written down.
  if (created) {
    return (
      <div className="auth">
        {langs}
        <div className="auth-box">
          <h1>{t.yourName}</h1>
          <div className="auth-name">{created}</div>
          <p className="auth-sub">{t.rememberIt}</p>
          <button className="tbtn primary auth-submit" onClick={onDone} autoFocus>
            {t.enterSite}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth">
      {langs}
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
        <p className="auth-sub">{t.authSub}</p>
        <label className="auth-field">
          <span>{t.username}</span>
          {mode === 'login' ? (
            <input value={name} autoComplete="username" autoFocus maxLength={24} onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} />
          ) : (
            <>
              <input value={nextName} disabled readOnly className="auth-locked" />
              <em>{t.nameAuto}</em>
            </>
          )}
        </label>
        <label className="auth-field">
          <span>{t.password}</span>
          <input
            type="password"
            value={pw}
            autoFocus={mode === 'register'}
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
        {error && <div className="auth-error">{error}</div>}
        <button className="tbtn primary auth-submit" disabled={busy || !pw || (mode === 'login' ? !name : !pw2)}>
          {mode === 'login' ? t.login : t.register}
        </button>
        <button type="button" className="auth-switch" onClick={switchMode}>
          {mode === 'login' ? t.noAccount : t.haveAccount}
        </button>
      </form>
    </div>
  )
}
