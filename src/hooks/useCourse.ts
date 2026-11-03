import { useCallback, useEffect, useState } from 'react'
import { api, AuthError, type CourseView } from '../lib/api'

export function useCourse() {
  const [course, setCourse] = useState<CourseView | null>(null)
  const [error, setError] = useState(false)
  const [needAuth, setNeedAuth] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const c = await api.course()
      setCourse(c)
      setError(false)
      setNeedAuth(false)
      return c
    } catch (e) {
      if (e instanceof AuthError) setNeedAuth(true)
      else setError(true)
      return null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .course()
      .then((c) => !cancelled && setCourse(c))
      .catch((e) => {
        if (cancelled) return
        if (e instanceof AuthError) setNeedAuth(true)
        else setError(true)
      })
    // Any request answered with "log in first" (e.g. an expired session).
    const onAuth = () => {
      setCourse(null)
      setNeedAuth(true)
    }
    window.addEventListener('auth-required', onAuth)
    return () => {
      cancelled = true
      window.removeEventListener('auth-required', onAuth)
    }
  }, [])

  return { course, error, needAuth, refresh }
}
