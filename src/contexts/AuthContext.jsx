import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, AUTH_BASE } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const navigate = useNavigate()

  const fetchMe = useCallback(async () => {
    try {
      const data = await api.get('/auth/me')
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
    const params = new URLSearchParams(window.location.search)
    const authError = params.get('auth_error')
    if (authError) {
      setError(decodeURIComponent(authError))
      const url = new URL(window.location.href)
      url.searchParams.delete('auth_error')
      window.history.replaceState({}, '', url.toString())
      setLoading(false)
      return
    }
    const payment = params.get('payment')
    if (payment) {
      const url = new URL(window.location.href)
      url.searchParams.delete('payment')
      window.history.replaceState({}, '', url.toString())
      if (payment === 'success') {
        fetchMe().then(() => navigate('/dashboard'))
        return
      }
    }
    fetchMe()
  }, [fetchMe])

  const login = useCallback(() => {
    window.location.href = `${AUTH_BASE}/auth/google/start`
  }, [])

  const localLogin = useCallback(async (email, password) => {
    try {
      const res = await api.post(`/auth/local/login`, { email, password })
      if (res.user) {
        await fetchMe()
        setError(null)
        navigate('/chat')
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
      const res = await api.post(`/auth/local/register`, { email, password, name })
      if (res.user) {
        await fetchMe()
        setError(null)
        navigate('/chat')
        return { success: true, ...res }
      }
      return { success: false, message: 'Invalid response from server' }
    } catch (err) {
      const msg = err.body?.error || err.message
      setError(msg)
      return { success: false, message: msg }
    }
  }, [fetchMe])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {})
    } catch (_) {}
    setUser(null)
    navigate('/login')
  }, [navigate])

  const refreshUser = fetchMe

  // isAdmin is determined by the role field returned from the server — no hardcoded emails
  const isAdmin = user?.role === 'admin'

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
