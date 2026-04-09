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

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {})
    } catch (_) {
      // ignore errors on logout
    }
    setUser(null)
  }, [])

  const refreshUser = fetchMe

  const isAdmin = user?.email === 'adrianenc11@gmail.com' ||
    (Array.isArray(window.__ADMIN_EMAILS__)
      ? window.__ADMIN_EMAILS__.includes(user?.email)
      : false)

  return (
    <AuthContext.Provider value={{ user, loading, error, setError, login, logout, refreshUser, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
