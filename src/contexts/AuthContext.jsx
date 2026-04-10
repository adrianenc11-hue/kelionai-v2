import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, AUTH_BASE } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const fetchMe = useCallback(async () => {
    try {
      const data = await api.get('/api/users/me')
      setUser(data)
      setError(null)
    } catch (err) {
      if (err.status === 401) {
        setUser(null)
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Check for auth_error in URL (from OAuth redirect)
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    if (authError) {
      setError(decodeURIComponent(authError))
      // Remove the query param from URL without reloading
      const url = new URL(window.location.href)
      url.searchParams.delete('auth_error')
      window.history.replaceState({}, '', url.toString())
      setLoading(false)
      return
    }

    fetchMe()
  }, [fetchMe])

  const login = useCallback(() => {
    window.location.href = `${AUTH_BASE}/auth/google/start`
  }, [])

  const localLogin = useCallback(async (email, password) => {
    try {
      const res = await api.post(
        `/auth/local/login`,
        { email, password }
      )
      if (res.token) {
        await fetchMe()
        setError(null)
        // Redirect to dashboard/home after successful login
        window.location.href = '/'
        return { success: true, ...res }
      }
      return { success: false, message: 'Invalid response from server' }
    } catch (err) {
      const msg = err.body?.error || err.message
      setError(msg)
      return { success: false, message: msg }
    }
  }, [fetchMe])

  const registerLocal = useCallback(async (email, password, name) => {
    try {
      const res = await api.post(
        `/auth/local/register`,
        { email, password, name }
      );
      if (res.token) {
        await fetchMe();
        setError(null);
        // Redirect to dashboard/home after successful registration
        window.location.href = '/'
        return { success: true, ...res };
      }
      return { success: false, message: 'Invalid response from server' };
    } catch (err) {
      const msg = err.body?.error || err.message
      setError(msg);
      return { success: false, message: msg };
    }
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {})
    } catch (_) {
      // ignore errors on logout
    }
    setUser(null)
  }, [])

  const refreshUser = fetchMe

  const ADMIN_EMAILS = (
    typeof window !== 'undefined' && Array.isArray(window.__ADMIN_EMAILS__)
      ? window.__ADMIN_EMAILS__
      : ['adrianenc11@gmail.com']
  )
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email)

  return (
    <AuthContext.Provider value={{ user, loading, error, setError, login, localLogin, registerLocal, logout, refreshUser, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
