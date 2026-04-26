import { Canvas } from '@react-three/fiber'
import { useGLTF, Environment, ContactShadows, Float } from '@react-three/drei'
import * as THREE from 'three'
import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLipSync, useAudioElementLipSync } from '../lib/lipSync'
import { handleShowOnMonitor, setMonitorGeoProvider, subscribeMonitor } from '../lib/monitorStore'
import { STATUS_COLORS } from '../lib/kelionStatus'
import { subscribeComposer, getComposer, openEmailComposer, closeComposer } from '../lib/composerStore'
import { setClientGeoProvider } from '../lib/clientGeoProvider'
import { setUIActionController } from '../lib/uiActionStore'
import UIActionToast from '../components/UIActionToast'
// Stage components extracted from this file for maintainability
import AvatarModel from '../components/stage/AvatarModel'
import Halo from '../components/stage/Halo'
import StudioDecor from '../components/stage/StudioDecor'
import CameraRig from '../components/stage/CameraRig'
import MonitorOverlay from '../components/stage/MonitorOverlay'
import { TopBarIconButton, AdminTabBar, VisitorsAnalyticsPanel, PayoutsPanel, MenuItem, friendlyCreditStatus, uaIsBot, uaBrowser, uaOs, refHost } from '../components/stage/AdminPanels'
import { useGeminiLive } from '../lib/geminiLive' // CACHE BUSTER: 20260426155431
import { selectPriorTurns } from '../lib/priorTurnsSelector'
import { useWakeWord } from '../lib/useWakeWord'
import { useTrial } from '../lib/useTrial'
import { useClientGeo } from '../lib/useClientGeo'
import { TUNING, isTuningEnabled } from '../lib/tuning'
import TuningPanel from '../components/TuningPanel'
import SignInModal from '../components/SignInModal'
import VoiceCloneModal from '../components/VoiceCloneModal'
import EmailComposerModal from '../components/EmailComposerModal'
import { getCsrfToken } from '../lib/api'
import {
  supportsPasskey,
  registerPasskey,
  authenticateWithPasskey,
  fetchMe,
  signOut,
} from '../lib/passkeyClient'
import {
  fetchMemory,
  extractAndStore,
  forgetAllMemory,
} from '../lib/memoryClient'
import {
  configureConversationStore,
  resetSessionExpiredLatch,
  appendMessage as appendConversationMessage,
  listConversations as listConversationsApi,
  loadConversation as loadConversationApi,
  deleteConversation as deleteConversationApi,
  startNewConversation,
  getActiveConversationId,
  setActiveConversationId,
} from '../lib/conversationStore'
import {
  pushSupported,
  getPushStatus,
  enablePush,
  disablePush,
  sendTestPing,
} from '../lib/pushClient'
import { useEmotion } from '../lib/emotionStore'

// Stage 6 — M26 voice-style menu presets (labels match server VOICE_STYLES).
const VOICE_STYLE_OPTIONS = [
  { key: 'warm',    label: 'Warm' },
  { key: 'playful', label: 'Playful' },
  { key: 'calm',    label: 'Calm' },
  { key: 'focused', label: 'Focused' },
]
async function setVoiceStyle(style) {
  try {
    const r = await fetch('/api/realtime/voice-style', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
      body: JSON.stringify({ style }),
    })
    const j = await r.json().catch(() => ({}))
    return j?.ok ? j.style : null
  } catch { return null }
}
function readVoiceStyleCookie() {
  if (typeof document === 'undefined') return 'warm'
  const m = document.cookie.match(/(?:^|;\s*)kelion\.voice_style=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : 'warm'
}

function actionBtnStyle(disabled, color, borderColor) {
  return {
    padding: '7px 12px', borderRadius: 8,
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid ' + (borderColor || 'rgba(167, 139, 250, 0.3)'),
    color: color || '#ede9fe',
    fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

// ----- Main page -----
export default function KelionStage() {
  // React-router navigator. Used for in-app route changes (e.g. the
  // "Contact us" menu item) so we stay inside the SPA and preserve
  // auth state, mic state, etc. — full-page reloads via
  // `window.location.assign` discarded the React tree and the browser
  // back button then returned to a freshly-mounted, effectively
  // logged-out-looking page until `/api/auth/me` re-resolved. Adrian
  // 2026-04-20: "cind esti logat si folosesti butonul back, te
  // intorci in pagina anterioara, dar logat".
  const navigate = useNavigate()
  // PR #200 — register the ui_navigate controller so the voice model's
  // ui_navigate tool (kelionTools.js) can actually move the user
  // between SPA routes instead of just narrating that it did. The
  // allowlist lives inside uiActionStore; this effect only wires the
  // imperative handler, it doesn't widen the allowlist.
  useEffect(() => {
    setUIActionController({
      navigate: (route) => navigate(route),
    })
    return () => setUIActionController(null)
  }, [navigate])
  const audioRef = useRef(null)
  // Real client GPS (falls back to null ? server uses IP-geo instead).
  // The hook fires once on mount; if the browser remembers a previous
  // grant there is no prompt, otherwise the browser shows its standard
  // one-time permission dialog. Coords are cached in localStorage so
  // refreshes don't re-ping the OS.
  // useClientGeo v2 exposes { coords, permission, lastError, requestNow }.
  // We forward `coords` to the Gemini Live hook (the pipeline only needs
  // lat/lon), and the top-level stage wires `requestNow` to the first
  // user gesture so iOS Safari actually shows the permission prompt —
  // see handling in onStageClick below.
  const { coords: clientGeo, permission: geoPermission, requestNow: requestGeo } = useClientGeo()
  // Register a geo provider so monitorStore can fall back to the user's
  // current coords when the model calls show_on_monitor({kind:'map'}) without
  // a query (e.g. "arata-mi harta" / "show me a map" without a place name).
  const clientGeoRef = useRef(null)
  const geoPermissionRef = useRef('unknown')
  const requestGeoRef = useRef(null)
  useEffect(() => { clientGeoRef.current = clientGeo }, [clientGeo])
  useEffect(() => { geoPermissionRef.current = geoPermission }, [geoPermission])
  useEffect(() => { requestGeoRef.current = requestGeo }, [requestGeo])
  useEffect(() => {
    setMonitorGeoProvider(() => clientGeoRef.current)
    return () => setMonitorGeoProvider(null)
  }, [])
  // Also publish the geo state to clientGeoProvider so the voice-side
  // `get_my_location` tool handler (in src/lib/kelionTools.js) can read
  // coords / permission / request-on-gesture without reaching into the
  // React tree. Tool handlers run outside React so they need a module-
  // level registry just like monitorGeoProvider above.
  useEffect(() => {
    setClientGeoProvider({
      getCoords:     () => clientGeoRef.current,
      getPermission: () => geoPermissionRef.current,
      requestNow:    () => {
        if (typeof requestGeoRef.current === 'function') requestGeoRef.current()
      },
    })
    return () => setClientGeoProvider(null)
  }, [])
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Stage 3 — auth + memory state
  const [authState, setAuthState] = useState({ signedIn: false, user: null })
  // JWT bearer-token fallback. register/login return a `token` in the body
  // and also set the httpOnly `kelion.token` cookie. In some browsers the
  // cookie may not make it back on the very next request (adblockers
  // stripping Set-Cookie, Safari ITP, strict privacy extensions, corporate
  // proxies rewriting headers). When that happens, the next authenticated
  // call (e.g. POST /api/chat) returns 401 and the UI flips to
  // "Session expired" seconds after the user signed in. Storing the token
  // in-memory and attaching it as `Authorization: Bearer …` on authenticated
  // fetches closes that gap — the server middleware already reads either
  // the header or the cookie, whichever is present.
  const authTokenRef = useRef(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryItems, setMemoryItems] = useState([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [rememberPromptOpen, setRememberPromptOpen] = useState(false)
  const [rememberBusy, setRememberBusy] = useState(false)
  const [rememberError, setRememberError] = useState(null)
  // Full sign-in modal (email+password primary, Google, passkey) — opened
  // from the top-bar "Sign in" button. Separate from the soft passkey prompt
  // above which auto-opens mid-conversation after several turns.
  const [signInModalOpen, setSignInModalOpen] = useState(false)
  const dismissedPromptRef = useRef(false)

  // Stage 5 — proactive pings state
  const [pushState, setPushState] = useState({ supported: false, enabled: false, permission: 'default' })
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState(null)

  // Admin-only — AI credits dashboard state (Stage 7 / monetization gate).
  // `creditsOpen` controls the overlay; `creditsCards` is the normalized
  // array returned by GET /api/admin/credits; `creditsLoading` shows a
  // skeleton while the server probes providers.
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [creditsCards, setCreditsCards] = useState([])
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState(null)
  // PR E2 — auto-topup configuration snapshot returned alongside the
  // provider cards (threshold, amount, last-run history). Drives the
  // info strip at the top of the AI tab so the admin can see at a
  // glance whether auto-refill is armed and when it last fired.
  const [autoTopupStatus, setAutoTopupStatus] = useState(null)
  // Revenue-split snapshot (50/50 by default between AI provider spend
  // and owner net). Loaded from /api/admin/revenue-split in parallel
  // with the raw provider cards so the overlay can show both without
  // a waterfall. null = not loaded yet; populated object after success.
  const [revenueSplit, setRevenueSplit] = useState(null)
  const [revenueSplitLoading, setRevenueSplitLoading] = useState(false)
  const [revenueSplitError, setRevenueSplitError] = useState(null)
  // Live usage ledger — most recent credit transactions across all
  // users. Auto-refreshed every 5s while the credits overlay is open
  // so Adrian can watch consumption tick in real time. Added after
  // the 2026-04-20 charge-on-open bug drained a £10 pack in seconds;
  // visibility is now a standing requirement ("permanent la toti
  // userii").
  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  // Grant / refund form — hits POST /api/admin/credits/grant.
  // Added so Adrian can refund compromised accounts (e.g. Kelion's
  // 33-credit loss from the 2026-04-20 charge-on-open incident)
  // without having to touch the browser console or a raw curl.
  const [grantEmail, setGrantEmail] = useState('')
  const [grantMinutes, setGrantMinutes] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantMessage, setGrantMessage] = useState(null) // { ok: bool, text: string }
  const isAdmin = Boolean(authState.user && authState.user.isAdmin)
  const refreshLedger = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/credits/ledger?limit=50', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setLedgerRows(Array.isArray(j.rows) ? j.rows : [])
      setLedgerError(null)
    } catch (err) {
      setLedgerError(err.message || 'Could not load ledger')
    }
  }, [])
  // Submit handler for the Grant Credits form. Validates the inputs
  // client-side (the server validates again), POSTs to the admin
  // endpoint, and refreshes the ledger on success so the new
  // admin_grant row appears immediately in Live Usage.
  const doGrant = useCallback(async () => {
    const email = grantEmail.trim().toLowerCase()
    const minutes = Number(grantMinutes)
    if (!email || !/.+@.+\..+/.test(email)) {
      setGrantMessage({ ok: false, text: 'Enter a valid email.' })
      return
    }
    if (!Number.isFinite(minutes) || minutes === 0) {
      setGrantMessage({ ok: false, text: 'Enter a non-zero number of minutes (negative = clawback).' })
      return
    }
    setGrantBusy(true)
    setGrantMessage(null)
    // Per-submission idempotency key — a double-click or retry uses
    // the same key, and the server's UNIQUE index collapses it into
    // a no-op (audit #7). The key includes email+minutes+timestamp+
    // random so two *different* intentional grants to the same user
    // stay distinct. Use crypto.randomUUID when available, fall back
    // to Date.now + Math.random for older iOS Safari.
    const rand = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const idempotencyKey = `ui:${email}:${Math.trunc(minutes)}:${rand}`
    try {
      const r = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          email,
          minutes: Math.trunc(minutes),
          note: grantNote.trim() || undefined,
          idempotencyKey,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setGrantMessage({
        ok: true,
        text: j.duplicate
          ? `Already granted (duplicate). Balance: ${j.balanceMinutes} min.`
          : `Granted ${j.deltaMinutes} min to ${j.email}. New balance: ${j.balanceMinutes} min.`,
      })
      setGrantEmail('')
      setGrantMinutes('')
      setGrantNote('')
      refreshLedger().catch(() => {})
    } catch (err) {
      setGrantMessage({ ok: false, text: err.message || 'Grant failed.' })
    } finally {
      setGrantBusy(false)
    }
  }, [grantEmail, grantMinutes, grantNote, refreshLedger])
  const openCredits = useCallback(async () => {
    setCreditsOpen(true)
    setCreditsLoading(true)
    setCreditsError(null)
    setRevenueSplitLoading(true)
    setRevenueSplitError(null)
    setLedgerLoading(true)
    const cardsPromise = fetch('/api/admin/credits', { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => {
        setCreditsCards(Array.isArray(j.cards) ? j.cards : [])
        setAutoTopupStatus(j.autoTopup || null)
      })
      .catch((err) => setCreditsError(err.message || 'Could not load AI credits'))
      .finally(() => setCreditsLoading(false))
    const splitPromise = fetch('/api/admin/revenue-split?days=30', { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => setRevenueSplit(j))
      .catch((err) => setRevenueSplitError(err.message || 'Could not load revenue split'))
      .finally(() => setRevenueSplitLoading(false))
    const ledgerPromise = refreshLedger().finally(() => setLedgerLoading(false))
    await Promise.allSettled([cardsPromise, splitPromise, ledgerPromise])
  }, [refreshLedger])

  // Poll ledger every 5s while overlay is open. Cleared on close /
  // unmount so we never leak an interval.
  useEffect(() => {
    if (!creditsOpen || !isAdmin) return undefined
    const id = setInterval(() => { refreshLedger() }, 5000)
    return () => clearInterval(id)
  }, [creditsOpen, isAdmin, refreshLedger])

  // Admin-only — Visitors overlay. One row per SPA page load recorded by
  // the server-side `visitorLog` middleware. Shows IP, country, UA,
  // referer, path, user email (if signed in), timestamp. Auto-refresh
  // every 10s while open so Adrian can watch the live flow.
  const [visitorsOpen, setVisitorsOpen] = useState(false)
  const [visitorsRows, setVisitorsRows] = useState([])
  const [visitorsStats, setVisitorsStats] = useState(null)
  // PR E4 — advanced analytics: 30-day chart, country list, device mix,
  // login?topup?usage funnel. Fetched alongside the raw rows.
  const [visitorsAnalytics, setVisitorsAnalytics] = useState(null)
  const [visitorsLoading, setVisitorsLoading] = useState(false)
  const [visitorsError, setVisitorsError] = useState(null)
  const refreshVisitors = useCallback(async () => {
    try {
      const [rRaw, rStats] = await Promise.all([
        fetch('/api/admin/visitors?limit=200&windowHours=24', { credentials: 'include' }),
        fetch('/api/admin/visitors/analytics?days=30', { credentials: 'include' }),
      ])
      if (!rRaw.ok) throw new Error(`HTTP ${rRaw.status}`)
      const j = await rRaw.json()
      setVisitorsRows(Array.isArray(j.visits) ? j.visits : [])
      setVisitorsStats(j.stats || null)
      if (rStats.ok) {
        const s = await rStats.json()
        setVisitorsAnalytics(s)
      }
      setVisitorsError(null)
    } catch (err) {
      setVisitorsError(err.message || 'Could not load visitors')
    }
  }, [])
  const openVisitors = useCallback(async () => {
    setVisitorsOpen(true)
    setVisitorsLoading(true)
    await refreshVisitors()
    setVisitorsLoading(false)
  }, [refreshVisitors])
  useEffect(() => {
    if (!visitorsOpen || !isAdmin) return undefined
    const id = setInterval(() => { refreshVisitors() }, 10000)
    return () => clearInterval(id)
  }, [visitorsOpen, isAdmin, refreshVisitors])

  // Stage 7 — monetization. User-facing top-up modal (Stripe Checkout)
  // and live balance. `buyOpen` shows the package picker; `buyBusy` is
  // true while we create the Stripe Checkout session; `balance` is
  // null until loaded so we can hide the chip until we know it.
  const [buyOpen, setBuyOpen] = useState(false)
  const [buyBusy, setBuyBusy] = useState(false)
  const [buyError, setBuyError] = useState(null)
  const [packages, setPackages] = useState([])
  const [balance, setBalance] = useState(null)
  const refreshBalance = useCallback(async () => {
    if (!authState.signedIn) { setBalance(null); return }
    try {
      const r = await fetch('/api/credits/balance', { credentials: 'include' })
      if (!r.ok) return
      const j = await r.json()
      if (typeof j.balance_minutes === 'number') setBalance(j.balance_minutes)
    } catch (_) { /* ignore */ }
  }, [authState.signedIn])
  useEffect(() => { refreshBalance() }, [refreshBalance])
  const openBuy = useCallback(async () => {
    setBuyOpen(true)
    setBuyError(null)
    if (packages.length === 0) {
      try {
        const r = await fetch('/api/credits/packages')
        const j = await r.json()
        setPackages(Array.isArray(j.packages) ? j.packages : [])
      } catch (err) {
        setBuyError('Could not load packages')
      }
    }
  }, [packages.length])
  const handleBuy = useCallback(async (pkgId) => {
    setBuyBusy(true)
    setBuyError(null)
    try {
      const r = await fetch('/api/credits/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ packageId: pkgId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) {
        throw new Error(j.error || j.hint || `HTTP ${r.status}`)
      }
      window.location.href = j.url
    } catch (err) {
      setBuyError(err.message || 'Checkout failed')
      setBuyBusy(false)
    }
  }, [])

  // If we returned from Stripe Checkout with ?credits=ok, refresh the
  // balance once and scrub the query string so reloads don't re-trigger.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('credits') === 'ok') {
      refreshBalance()
      sp.delete('credits'); sp.delete('session_id')
      const q = sp.toString()
      const clean = window.location.pathname + (q ? `?${q}` : '') + window.location.hash
      window.history.replaceState(null, '', clean)
    }
  }, [refreshBalance])

  // PWA install prompt — Chrome / Edge / Android fire `beforeinstallprompt`
  // which we stash; iOS Safari has no such event, so we show instructions
  // inline in the modal instead.
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(() =>
    typeof window !== 'undefined' && (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    )
  )
  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); setInstallPromptEvent(e) }
    const onInstalled = () => { setInstalled(true); setInstallPromptEvent(null) }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const handleInstall = useCallback(async () => {
    if (!installPromptEvent) return
    try {
      await installPromptEvent.prompt()
      setInstallPromptEvent(null)
    } catch (_) { /* user dismissed */ }
  }, [installPromptEvent])

  // Global ESC handler — closes any open overlay / drawer so the user is
  // never stuck with a side panel they cannot dismiss. Also closes the ?
  // menu. The Buy-credits modal has its own backdrop so it also closes
  // on click-outside; this just adds keyboard parity. Covers every
  // admin-shell drawer (Business / AI / Visitors / Users / Payouts) so
  // the new tabs from PR #141 share the same keyboard affordance as
  // the older ones.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      setTranscriptOpen(false)
      setMemoryOpen(false)
      setCreditsOpen(false)
      setBusinessOpen(false)
      setVisitorsOpen(false)
      setUsersOpen(false)
      setPayoutsOpen(false)
      setBuyOpen(false)
      setRememberPromptOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Admin-only — live business metrics (revenue + minutes sold/consumed).
  const [businessOpen, setBusinessOpen] = useState(false)
  const [businessData, setBusinessData] = useState(null)
  const [businessLoading, setBusinessLoading] = useState(false)
  const [businessError, setBusinessError] = useState(null)
  const openBusiness = useCallback(async () => {
    setBusinessOpen(true)
    setBusinessLoading(true)
    setBusinessError(null)
    try {
      const r = await fetch('/api/admin/business?days=30', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setBusinessData(await r.json())
    } catch (err) {
      setBusinessError(err.message || 'Could not load business metrics')
    } finally {
      setBusinessLoading(false)
    }
  }, [])

  // PR E1 — unified admin shell. Two new tab panels (Users, Payouts)
  // replace the scattered overflow-menu entries; Business / AI / Visitors
  // keep their existing open*() data fetchers but now share a tab bar at
  // the top. switchAdminTab is the single entry point the top-bar
  // "Admin · 8" button and the tab bar both call — it closes whichever
  // tab is currently visible and opens the target one, re-using the
  // existing fetcher so the data is always fresh.
  const [usersOpen, setUsersOpen] = useState(false)
  const [payoutsOpen, setPayoutsOpen] = useState(false)

  // PR E5 — Users drawer state. `usersData` holds the last list
  // response; `usersQuery`/`usersStatus` are the current filters;
  // `selectedUserId` opens a detail sub-drawer with per-user actions
  // (grant credits, ban/unban, reset password, ledger history). The
  // list re-fetches every 15s while the drawer is open so fresh
  // top-ups show up without a manual reload. All mutating calls hit
  // existing admin endpoints gated by `requireAuth` + `requireAdmin`.
  const [usersData, setUsersData] = useState(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState(null)
  const [usersQuery, setUsersQuery] = useState('')
  const [usersStatus, setUsersStatus] = useState('all')
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedHistory, setSelectedHistory] = useState(null)
  const [selectedBusy, setSelectedBusy] = useState(false)
  const [selectedResult, setSelectedResult] = useState(null)

  const refreshUsersList = useCallback(async (q = usersQuery, status = usersStatus) => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const params = new URLSearchParams()
      if (q && q.trim()) params.set('q', q.trim())
      if (status && status !== 'all') params.set('status', status)
      params.set('limit', '200')
      const r = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setUsersData(await r.json())
    } catch (err) {
      setUsersError(err.message || 'Nu am putut încarca lista de useri')
    } finally {
      setUsersLoading(false)
    }
  }, [usersQuery, usersStatus])

  const openUsers = useCallback(async () => {
    setUsersOpen(true)
    setSelectedUserId(null)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
    await refreshUsersList('', 'all')
  }, [refreshUsersList])

  const loadUserDetail = useCallback(async (userId) => {
    setSelectedUserId(userId)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
    try {
      const [userRes, histRes] = await Promise.all([
        fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include' }),
        fetch(`/api/admin/users/${encodeURIComponent(userId)}/history?limit=50`, { credentials: 'include' }),
      ])
      if (userRes.ok) setSelectedUser(await userRes.json())
      if (histRes.ok) setSelectedHistory(await histRes.json())
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Nu am putut citi detaliile' })
    }
  }, [])

  const closeUserDetail = useCallback(() => {
    setSelectedUserId(null)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
  }, [])

  const banSelectedUser = useCallback(async (banned) => {
    if (!selectedUserId || selectedBusy) return
    let reason = null
    if (banned) {
      reason = window.prompt('Motiv suspendare (op?ional):', '') || ''
    } else if (!window.confirm('Reactivezi contul?')) {
      return
    }
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/ban`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned, reason }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({ ok: true, message: banned ? 'Cont suspendat' : 'Cont reactivat' })
      await Promise.all([loadUserDetail(selectedUserId), refreshUsersList()])
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Ac?iunea a e?uat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail, refreshUsersList])

  const grantCreditsToSelected = useCallback(async () => {
    if (!selectedUserId || selectedBusy) return
    const raw = window.prompt('Câte minute adaugi? (negativ = retragi)', '10')
    if (raw == null) return
    const minutes = Number(raw)
    if (!Number.isFinite(minutes) || minutes === 0) {
      setSelectedResult({ ok: false, error: 'Introduce?i un numar diferit de 0' })
      return
    }
    const note = window.prompt('Nota (op?ional):', '') || ''
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/credits/grant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: Math.trunc(minutes), note }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({
        ok: true,
        message: `${minutes > 0 ? 'Adaugate' : 'Retrase'} ${Math.abs(Math.trunc(minutes))} minute · sold nou ${body.balance}`,
      })
      await Promise.all([loadUserDetail(selectedUserId), refreshUsersList()])
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Ac?iunea a e?uat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail, refreshUsersList])

  const resetSelectedPassword = useCallback(async () => {
    if (!selectedUserId || selectedBusy) return
    if (!window.confirm('?terg parola + passkey-ul? Userul va trebui sa se relogheaza cu Google sau passkey nou.')) {
      return
    }
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({ ok: true, message: 'Parola + passkey ?terse. Contacteaza userul.' })
      await loadUserDetail(selectedUserId)
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Ac?iunea a e?uat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail])

  // 15s live refresh of the users list while the drawer is open.
  useEffect(() => {
    if (!usersOpen) return undefined
    const id = setInterval(() => { refreshUsersList() }, 15000)
    return () => clearInterval(id)
  }, [usersOpen, refreshUsersList])

  // F3 — Adrian 2026-04-22: audit found adrianenc11@gmail.com split across
  // two user rows (id=5 Google + id=6 local signup) and the admin panel
  // had no way to collapse them. `dupGroups` holds whatever
  // /api/admin/users/duplicates returned; the card in the Users drawer
  // renders one row per group with a "Merge" button per peer. We keep
  // the group list lazy — it only loads on demand when the Users tab
  // is opened, and re-loads after each successful merge.
  const [dupGroups, setDupGroups] = useState([])
  const [dupLoading, setDupLoading] = useState(false)
  const [dupError, setDupError] = useState(null)
  const [dupBusyKey, setDupBusyKey] = useState(null)
  const [dupResult, setDupResult] = useState(null)
  const refreshDuplicateUsers = useCallback(async () => {
    setDupLoading(true)
    setDupError(null)
    try {
      const h = { Accept: 'application/json' }
      if (authTokenRef.current) h['Authorization'] = `Bearer ${authTokenRef.current}`
      const r = await fetch('/api/admin/users/duplicates', { credentials: 'include', headers: h })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json().catch(() => null)
      setDupGroups(Array.isArray(j && j.groups) ? j.groups : [])
    } catch (err) {
      setDupError(err && err.message ? err.message : 'Nu am putut încarca conturile duplicate')
    } finally {
      setDupLoading(false)
    }
  }, [])
  const mergeDuplicateUsers = useCallback(async (sourceId, targetId, email) => {
    if (sourceId == null || targetId == null) return
    const confirmMsg =
      `Merge user ${sourceId} ? ${targetId} (${email})?\n\n` +
      'Toate conversa?iile, creditele ?i istoricul sursei se vor muta pe ?inta.\n' +
      'Sursa va fi ?tearsa. Ac?iune ireversibila.'
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return
    const key = `${sourceId}->${targetId}`
    setDupBusyKey(key)
    setDupResult(null)
    try {
      const h = { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() }
      if (authTokenRef.current) h['Authorization'] = `Bearer ${authTokenRef.current}`
      const r = await fetch('/api/admin/users/merge', {
        method: 'POST',
        credentials: 'include',
        headers: h,
        body: JSON.stringify({ sourceId, targetId }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok) throw new Error((j && j.error) || `HTTP ${r.status}`)
      setDupResult({ ok: true, sourceId, targetId, email, moved: (j && j.moved) || {} })
      await refreshDuplicateUsers()
    } catch (err) {
      setDupResult({
        ok: false,
        sourceId,
        targetId,
        email,
        error: err && err.message ? err.message : 'Merge e?uat',
      })
    } finally {
      setDupBusyKey(null)
    }
  }, [refreshDuplicateUsers])

  // PR E3 — Payouts drawer pulls a live snapshot from Stripe (balance,
  // linked external account, next-payout schedule, last ~10 payouts)
  // plus the 50/50 AI-vs-profit split over the last 30 days. The
  // snapshot aggregator on the server never throws; partial failures
  // land in `payoutsData.errors` and the UI renders whatever did load.
  const [payoutsData, setPayoutsData] = useState(null)
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [payoutsError, setPayoutsError] = useState(null)
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutResult, setPayoutResult] = useState(null)
  // `refreshPayoutsData` pulls a fresh snapshot without touching
  // `payoutResult`; that way the "OK — 50.00 EUR · status in_transit"
  // banner survives the refresh triggered right after a successful
  // instant payout. `openPayouts` wraps it and additionally clears the
  // previous result so opening the drawer from scratch feels clean.
  const refreshPayoutsData = useCallback(async () => {
    setPayoutsLoading(true)
    setPayoutsError(null)
    try {
      const r = await fetch('/api/admin/payouts?days=30', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPayoutsData(await r.json())
    } catch (err) {
      setPayoutsError(err.message || 'Could not load payouts dashboard')
    } finally {
      setPayoutsLoading(false)
    }
  }, [])
  const openPayouts = useCallback(async () => {
    setPayoutsOpen(true)
    setPayoutResult(null)
    await refreshPayoutsData()
  }, [refreshPayoutsData])
  const triggerInstantPayout = useCallback(async () => {
    if (payoutBusy) return
    // A confirm() keeps this honest — an instant payout cannot be
    // undone, and the Stripe fee (~1% + €0.25) is real money.
    if (!window.confirm('Instant payout: transfera soldul disponibil pe cardul legat acum. Taxa Stripe ~1% + 0.25 EUR. Continuam?')) {
      return
    }
    setPayoutBusy(true)
    setPayoutResult(null)
    try {
      const r = await fetch('/api/admin/payouts/instant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        // Empty body ? Stripe pays out the full instant-available balance.
        body: JSON.stringify({}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error((body && body.error) || `HTTP ${r.status}`)
      }
      setPayoutResult({ ok: true, ...body })
      // Refresh the snapshot so the new payout shows up in recent list.
      // Must use `refreshPayoutsData` (not `openPayouts`) so the success
      // banner we just set isn't immediately wiped.
      refreshPayoutsData()
    } catch (err) {
      setPayoutResult({ ok: false, error: err.message || 'Instant payout failed' })
    } finally {
      setPayoutBusy(false)
    }
  }, [payoutBusy, refreshPayoutsData])

  const switchAdminTab = useCallback((tab) => {
    // Close non-target tabs first so only one panel is on screen at a
    // time. Each open*() call on the target flips its own state to true.
    if (tab !== 'business') setBusinessOpen(false)
    if (tab !== 'ai')       setCreditsOpen(false)
    if (tab !== 'visitors') setVisitorsOpen(false)
    if (tab !== 'users')    setUsersOpen(false)
    if (tab !== 'payouts')  setPayoutsOpen(false)
    if (tab === 'business') { openBusiness() }
    else if (tab === 'ai')       { openCredits() }
    else if (tab === 'visitors') { openVisitors() }
    else if (tab === 'users')    { openUsers(); refreshDuplicateUsers() }
    else if (tab === 'payouts')  { openPayouts() }
  }, [openBusiness, openCredits, openVisitors, openUsers, openPayouts, refreshDuplicateUsers])

  // Stage 6 — emotion mirroring + voice style
  const emotion = useEmotion()
  const [voiceStyle, setVoiceStyleState] = useState(() => readVoiceStyleCookie())
  const handleVoiceStyleChange = useCallback(async (style) => {
    const resolved = await setVoiceStyle(style)
    if (resolved) setVoiceStyleState(resolved)
  }, [])

  // Text chat — user-typed prompts in addition to voice. Talks to
  // /api/chat which streams assistant deltas via SSE. We keep the last
  // ~6 turns in memory so the model has short-term context; voice and
  // text share the same session but don't (yet) share a message log.
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([]) // [{ role, content }]
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState(null)
  // Conversation history — user-requested ("sa aiba optiune de save").
  // Signed-in users get server persistence via /api/conversations; guests
  // fall back to localStorage. See src/lib/conversationStore.js.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [voiceCloneOpen, setVoiceCloneOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  // Track how many messages we've already persisted so the save-effect
  // only appends deltas (not the whole transcript on every turn).
  const savedUpToRef = useRef(0)
  // F2 — "+" attach. Adrian: "lipseste + de introdus date". Accepts
  // images, PDFs and text files. For MVP we only surface the filename to
  // the model (as a bracketed note) and preview-pill it in the composer
  // so the user gets visual confirmation of the attachment. Full upload
  // + embedding support lands in a follow-up PR.
  const [attachedFile, setAttachedFile] = useState(null)
  const fileInputRef = useRef(null)
  const liveSendTextRef = useRef(null)
  const sendTextMessage = useCallback(async () => {
    const text = chatInput.trim()
    if (!text) return
    applyMuteCommand(text)
    setChatError(null)
    setChatInput('')
    setAttachedFile(null)
    if (liveSendTextRef.current) await liveSendTextRef.current(text)
  }, [chatInput])

  const micMouthOpen = useLipSync(audioRef)

  // ----- Text-chat TTS (server-side ElevenLabs, male native voice) -----
  // Adrian: "vocea nu este elevenlab, nativa, barbateasca, voce de femeie acum".
  // Previously this path used `window.speechSynthesis` which defaults to the
  // OS voice (on Windows/Chrome that's typically a female English voice).
  // We now POST the assistant's reply to /api/tts — the server synthesizes
  // with ElevenLabs (Adam — male, multilingual) or Gemini "Charon" (male)
  // and returns an audio/mpeg or audio/wav blob. We play it via an offscreen
  // <audio> element and drive the mouth from the *actual* audio amplitude
  // via `useAudioElementLipSync` (MediaElementSource ? analyzer), so the
  // avatar opens its mouth on vowels and closes it on pauses/consonants —
  // same envelope shape as the realtime-voice `useLipSync` path. If the
  // AudioContext can't be created (autoplay policy, older browsers) we
  // fall back to the legacy 4 Hz cosine so the avatar still lip-flaps.
  const {
    mouthOpen: ttsMouthOpen,
    attach: attachTtsLipSync,
    reset: resetTtsLipSync,
  } = useAudioElementLipSync()
  const [ttsCosineMouth, setTtsCosineMouth] = useState(0)
  const lastSpokenRef = useRef('')
  const ttsRafRef = useRef(null)
  const ttsAudioRef = useRef(null)
  const ttsAbortRef = useRef(null)
  // Mirror the hook's envelope into a ref so the analyzer-vs-cosine guard
  // can read the current value without waiting for a React re-render.
  const ttsMouthOpenRef = useRef(0)
  useEffect(() => { ttsMouthOpenRef.current = ttsMouthOpen }, [ttsMouthOpen])
  // statusRef and muteModeRef: declared before the TTS useEffect to avoid TDZ.
  // Their useState counterparts live after useGeminiLive; these refs are
  // synced via useEffect once the values are available.
  const statusRef = useRef('idle')
  const muteModeRef = useRef(false)
  useEffect(() => {
  }, [chatMessages, chatBusy, attachTtsLipSync, resetTtsLipSync])

  // Max of voice-chat lipsync, real-audio text-chat envelope, and cosine
  // fallback feeds the avatar. When the analyser is attached, ttsMouthOpen
  // carries the real amplitude and ttsCosineMouth stays 0; when we fall
  // back on autoplay-blocked browsers, ttsCosineMouth drives the jaw and
  // ttsMouthOpen stays 0 — taking the max means we always render whichever
  // source is active without double-counting.
  const mouthOpen = Math.max(
    micMouthOpen || 0,
    ttsMouthOpen || 0,
    ttsCosineMouth || 0,
  )

  // Track whether the half-page MonitorOverlay is currently rendered,
  // so the bottom UI (chat input bar, voice "tap to talk" pill, chat
  // bubbles, status pill) can shift to the right half on desktop and
  // float on top of the overlay instead of being half-hidden behind it.
  // Adrian (2026-04-25) screenshot showed the map covering the bottom
  // composer: "promtul de scris si vorbut sunt acoperite de pagina".
  const [monitorOpen, setMonitorOpen] = useState(false)
  const [stageNarrow, setStageNarrow] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth < 640
  ))
  useEffect(() => subscribeMonitor((s) => setMonitorOpen(!!s.src)), [])
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => setStageNarrow(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Desktop only: when the overlay covers the left 50vw, anchor the
  // composer to the center of the right half so the user always has
  // a clear typing/tapping target. On mobile the overlay is a top
  // sheet so leaving the composer at viewport-center is correct.
  const overlayShiftsBottom = monitorOpen && !stageNarrow
  const bottomLeft = overlayShiftsBottom ? '75%' : '50%'
  // z-index sits above MonitorOverlay (zIndex 40) so a transparent
  // shift fallback still keeps the composer clickable in case a
  // future change widens the overlay past 50vw.
  const bottomZIndex = overlayShiftsBottom ? 50 : undefined

  // Chat bubble auto-hide — Adrian: "chatul trebuie sa dispara dupa ce s-a
  // spus ramine doar in istoric, se afiseaza doar curent ce scrie user sau
  // avatar". We keep chatMessages as the persistent history (for context +
  // transcript panel), but fade the on-stage bubble out after 8s of quiet
  // so the avatar isn't cluttered. The timer resets on every new message
  // or when streaming resumes (chatBusy).
  const [bubbleVisible, setBubbleVisible] = useState(true)
  const bubbleHideTimerRef = useRef(null)
  useEffect(() => {
    if (chatMessages.length === 0) { setBubbleVisible(false); return }
    setBubbleVisible(true)
    if (bubbleHideTimerRef.current) clearTimeout(bubbleHideTimerRef.current)
    if (chatBusy) return
    bubbleHideTimerRef.current = setTimeout(() => setBubbleVisible(false), 8000)
    return () => { if (bubbleHideTimerRef.current) clearTimeout(bubbleHideTimerRef.current) }
  }, [chatMessages, chatBusy])

  // Single voice transport — Gemini Live on Vertex AI. Per Adrian's
  // single-LLM cleanup (April 2026): one LLM end-to-end (Gemini), one
  // voice the user hears (ElevenLabs native per detected language).
  // The dual-provider scaffold (OpenAI Realtime + auto-fallback) and
  // every escape hatch around it were removed.
  const liveHook = useGeminiLive({
    audioRef,
    coords: clientGeo,
    onBalanceUpdate: (minutes) => setBalance(minutes),
    active: true,
  })
  const {
    status,
    error,
    start,
    stop,
    turns,
    userLevel,
    // Stage 2 — Kelion Sees
    cameraStream,
    screenStream,
    visionError,
    startCamera,
    stopCamera,
    startScreen,
    stopScreen,
    // Mute/unmute voice output without restarting the session.
    setMuted: setVoiceMuted,
    // Voice-chat trial countdown returned by the active transport's
    // token mint. We no longer drive the HUD off this — the HUD
    // pulls from the shared /api/trial/status endpoint so the timer
    // also ticks for text-chat-only guests who never touch the mic.
    trial: voiceTrial,
    sendText: liveSendText,
  } = liveHook
  statusRef.current = status
  liveSendTextRef.current = liveSendText
  // -- Mute mode ----------------------------------------------------------
  // Activated when the user explicitly says "nu mai vorbi", "mute",
  // "fii silentios", etc. Suppresses both ElevenLabs text-TTS and the
  // Gemini Live voice gain. Deactivated on "stop", "reactiveaza", etc.
  // muteModeRef is declared before the TTS useEffect (above) to avoid TDZ.
  const [muteMode, setMuteMode] = useState(false)
  useEffect(() => {
    muteModeRef.current = muteMode
    if (setVoiceMuted) setVoiceMuted(muteMode)
  }, [muteMode, setVoiceMuted])

  // Regex patterns for mute/unmute detection (matches user messages in any mode)
  const MUTE_RE = /\b(nu (mai )?scoate (sun[ae]t|audio|voc[ae]|niciun sunet)|f(ii|a) (silen?ios|silen?|mut[ae]?|tacut|lini?tit)|fara (sun[ae]t|audio|voce)|opre[?s]te (sunet|audio|vocea)|taci complet|silent( mode)?|mute|no (sound|audio|voice output)|nu vorbis?|nu mai vorbis?)\b/i
  const UNMUTE_RE = /\b(stop|reactivea[zz][aa]|reactiveaz[aa]|porneste (din nou|sunet|audio|vocea?)|unmute|activeaz[aa] (sunet|audio|vocea?)|mai (vorbis?|scoate sunet)|vorbis?te( din nou)?)\b/i
  const TRANSLATOR_RE = /\b(asculta?[- ]?[?s]i traduce|traduce [?s]i(?: scrie|afis?ea[zz]a)?|interpret(ator|eaza)?|mod traduc|translator mode|audio ?to ?text|transcri(e|ere)|scrie ce (aud|se aude|spun))\b/i

  // Detect commands from user input (text chat) before sending.
  // Called in sendChat and in the voice turns watcher below.
  const applyMuteCommand = useCallback((text) => {
    if (!text) return
    if (UNMUTE_RE.test(text)) { setMuteMode(false); return }
    if (MUTE_RE.test(text)) { setMuteMode(true); return }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Watch voice turns — if user said a mute/unmute command by voice, apply it.
  useEffect(() => {
    const last = turns[turns.length - 1]
    if (!last || last.role !== 'user') return
    applyMuteCommand(last.text)
  }, [turns, applyMuteCommand])


  // chat via the shared 15-min/day IP window on the server. Collapses
  // (`applicable: false`) the moment the user signs in.
  const trialHud = useTrial({ signedIn: !!authState.signedIn })
  const trialRemainingMs = trialHud.remainingMs
  // Tap-to-talk schedules a 600 ms setTimeout to refresh the HUD; we
  // keep the id in a ref and clear it on unmount so we don't setState
  // on an unmounted component (Copilot review pr-74).
  const trialRefreshTimerRef = useRef(null)
  useEffect(() => () => {
    if (trialRefreshTimerRef.current) {
      clearTimeout(trialRefreshTimerRef.current)
      trialRefreshTimerRef.current = null
    }
  }, [])
  // Kick the Gemini Live hook's local trial state when the server flips
  // to exhausted on either surface — prevents a just-started voice
  // session from running past the shared quota that a text-chat user
  // might have burned down first.
  useEffect(() => {
    if (trialHud.applicable && !trialHud.allowed && voiceTrial && voiceTrial.active) {
      // eslint-disable-next-line no-console
      console.log('[trial] server quota exhausted — voice session will stop')
    }
  }, [trialHud.applicable, trialHud.allowed, voiceTrial])

  // Auto-open the Buy Credits modal when the voice session errors out
  // with a credit-exhausted message (Adrian: "cind ajunge iar la 0 se
  // trimite mesaj reincarca"). The Gemini Live hook already surfaces a
  // clean message from the 402 token response; we match on it so a
  // typical credit-gate trip surfaces the package picker immediately
  // instead of leaving the user to find the Credits pill.
  useEffect(() => {
    if (!error || typeof error !== 'string') return
    const low = error.toLowerCase()
    if (low.includes('no credits') || low.includes('buy a package') || low.includes('buy credits')) {
      setBuyOpen(true)
    }
  }, [error])

  const cameraVideoRef = useRef(null)
  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream
      cameraVideoRef.current.play().catch(() => {})
    }
  }, [cameraStream])

  useEffect(() => { setVoiceLevel(userLevel || 0) }, [userLevel])

  // F16 — camera ON from the moment the user enters the interface,
  // OFF only at sign-out / unmount. Adrian: "camera este on din momentul
  // intrarii pe interfata pina la inchidere la logoff sau iesire
  // accidentala din aplicatie". No debounce-off, no gating on keystroke
  // or VAD — the camera is a persistent ambient sensor for as long as
  // the stage is mounted. Manual toggle via ? menu still works for users
  // who explicitly turn it off.
  // F16 — camera auto-start once per mount. Runs for trial (not signed
  // in) AND signed-in users per spec ("camera este on din momentul
  // intrarii pe interfata"). The guard is set true on first run and
  // deliberately NEVER cleared for the lifetime of this mount — that
  // way, once the user has signed out (see stop effect below), the
  // camera will not auto-restart in the same tab without a page
  // reload. Re-engagement on re-sign-in is a reload, not an in-tab
  // flip, which matches Adrian's F16 wording "pina la inchidere".
  const cameraAutoStartedRef = useRef(false)
  // Tracks whether we've ever seen authState.signedIn === true during
  // this mount. Used to distinguish "user just signed out" from "user
  // never signed in (trial)". We only react to the sign-out transition,
  // not to the initial false-on-mount state.
  const hasBeenSignedInRef = useRef(false)
  useEffect(() => {
    if (cameraAutoStartedRef.current) return
    if (cameraStream) return // already running (manual toggle or prior mount)
    if (typeof startCamera !== 'function') return
    cameraAutoStartedRef.current = true
    // First-visit Chrome/Safari gate getUserMedia behind a user-gesture,
    // so the bare mount-time attempt below can fail silently (the user
    // never clicked yet). We attempt immediately for return visitors who
    // already granted permission, and install a one-shot gesture listener
    // that retries on the very first pointer/key/touch so the camera lights
    // up without the user ever seeing a "turn camera on" button.
    let calledOnce = false
    const tryOnce = () => {
      if (calledOnce) return
      calledOnce = true
      // startCamera is async and now rejects on getUserMedia failure — use
      // .catch() so an unhandled rejection doesn't crash the page. The
      // visionError banner already surfaces the human-readable reason.
      try { const p = startCamera(); if (p && typeof p.catch === 'function') p.catch(() => {}) } catch (_) { /* sync guard — same banner */ }
    }
    const onGesture = () => {
      tryOnce()
      // One-shot: remove listeners whether the call succeeded or not; if
      // it failed because permission was explicitly denied, retrying on
      // every click would be user-hostile.
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      window.removeEventListener('touchstart', onGesture, true)
    }
    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
    window.addEventListener('touchstart', onGesture, true)
    // Initial attempt for returning users where permission is remembered.
    // If it fails for lack of a user-gesture, the listeners above take over.
    tryOnce()
    return () => {
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      window.removeEventListener('touchstart', onGesture, true)
    }
    // We intentionally depend on `startCamera` only; cameraStream transitions
    // reset the guard path through the early returns above, so adding it here
    // would spin up a second attempt every time the stream object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCamera])

  // Stop the camera reactively when the user signs out. handleSignOut
  // only resets authState; it does NOT unmount KelionStage, so without
  // this effect the camera would keep streaming after sign-out (Codex
  // P1 on PR #42). We intentionally do NOT reset cameraAutoStartedRef
  // here (Codex P1 on PR #43): leaving the guard set prevents the
  // auto-start effect above from immediately re-firing when
  // cameraStream transitions to null.
  useEffect(() => {
    if (authState.signedIn) {
      hasBeenSignedInRef.current = true
      return
    }
    // Only stop on the signed-in ? signed-out transition, not on the
    // initial { signedIn: false } mount state (trial users).
    if (!hasBeenSignedInRef.current) return
    if (typeof stopCamera === 'function') {
      try { stopCamera() } catch (_) {}
    }
  }, [authState.signedIn, stopCamera])

  // Belt-and-braces unmount cleanup (navigation away, tab close).
  useEffect(() => {
    return () => {
      if (typeof stopCamera === 'function') {
        try { stopCamera() } catch (_) {}
      }
    }
  }, [stopCamera])

  // Adrian's spec ("cind intru pe aplicatie sa fie default delogat"):
  // every fresh page load must start in the signed-out trial state, even
  // if the user has a valid kelion.token cookie from a previous visit.
  // We intentionally do NOT hydrate auth from /api/auth/passkey/me here;
  // instead we best-effort clear the server cookie on mount so the user
  // must explicitly click "Sign in" and re-enter credentials. Auth still
  // works normally after they click through the modal — handleSignIn in
  // the modal onSuccess path does its own fetchMe + setAuthState below.
  useEffect(() => {
    let cancelled = false
    signOut().catch(() => { /* best-effort; modal will still work */ })
    if (!cancelled) setAuthState({ signedIn: false, user: null })
    return () => { cancelled = true }
  }, [])

  // Wire conversation-history store to live auth state. authTokenRef is
  // a ref so passing it lazily avoids re-wiring on every render. The
  // store picks server vs localStorage based on `signedIn`; this
  // effect is intentionally a one-time configuration, the getters stay
  // live across auth transitions.
  useEffect(() => {
    // Fresh auth cycle (either newly signed-in or back to signed-out)
    // re-arms the "session expired" one-shot so a future 401 triggers
    // the modal again.
    if (authState.signedIn) {
      try { resetSessionExpiredLatch() } catch (_) {}
    }
    configureConversationStore({
      getAuthToken: () => authTokenRef.current,
      getIsSignedIn: () => !!authState.signedIn,
      onSessionExpired: () => {
        // Audit #3: when the JWT expires mid-session, /api/conversations
        // starts returning 401. Without a prompt, the user's turns leak
        // into a hidden `g-*` guest thread and the real server thread
        // silently stops receiving messages — from their POV the
        // history "vanishes" on next reload. Tell them explicitly and
        // reopen the sign-in modal so they can restore the session.
        try { setAuthState({ signedIn: false, user: null }) } catch (_) {}
        try { setSignInModalOpen(true) } catch (_) {}
        try {
          window.alert(
            'Session expired — please sign in again to keep saving your chat history.'
          )
        } catch (_) { /* alert blocked (iframe sandbox) */ }
      },
    })
  }, [authState.signedIn])

  // Auto-save new chat messages to the conversation history backend.
  // `savedUpToRef` tracks the prefix of `chatMessages` that has already
  // been persisted so we only POST the delta.
  //
  // The old implementation saved user turns incrementally while
  // `chatBusy` was true, and held back only the streaming assistant
  // tail. On a 4xx/5xx (session expired, 402 no-credits, 429 trial
  // exhausted, upstream model failure) the `/api/chat` call threw
  // before any assistant chunk arrived — but the user turn had already
  // been POSTed and a fresh `conversations` row was already created.
  // The error banner appeared, the empty assistant placeholder got
  // popped in the catch handler (see sendTextMessage), and the DB was
  // left with a "user asked X, no reply" orphan that appeared in the
  // admin audit as 3 of 5 threads missing an assistant reply.
  //
  // New contract: never persist anything while chatBusy=true, and
  // never persist a trailing user turn (the one whose reply never
  // landed). A pair is only written after streaming completes and the
  // last message in the transcript is an assistant turn with content.
  // Retries by the user append a fresh user turn onto the unsaved
  // one — both get persisted in order once a reply finally lands, so
  // the conversation history stays faithful without producing orphans.
  useEffect(() => {
    // Defer until the streaming turn finishes — otherwise we'd race
    // the SSE loop and possibly write partial assistant content.
    if (chatBusy) return
    const total = chatMessages.length
    const start = savedUpToRef.current
    if (total <= start) {
      if (total < start) savedUpToRef.current = total // transcript was cleared
      return
    }
    // Trailing user turn with no assistant reply = error path. The
    // sendTextMessage catch block drops the empty assistant
    // placeholder, so the last slot is a user turn. Hold off on
    // persisting anything past the previously saved cursor until the
    // exchange completes successfully (or the user edits their input
    // and resends, pushing a new user turn plus a real assistant
    // reply). Skipping here prevents orphan conversations.
    const last = chatMessages[total - 1]
    if (!last || (last.role || 'user') === 'user') return
    if (!last.content || !String(last.content).trim()) return
    let cancelled = false
    ;(async () => {
      for (let i = start; i < chatMessages.length; i++) {
        if (cancelled) return
        const m = chatMessages[i]
        if (!m || !m.content || !String(m.content).trim()) break
        try {
          await appendConversationMessage({ role: m.role || 'user', content: m.content })
          // IMPORTANT: advance the cursor even when the effect got
          // cancelled mid-await. The SSE streaming path flips
          // `chatMessages` ~30×/s, so every chunk triggers a cleanup
          // that sets `cancelled=true` on the in-flight save. Gating
          // the cursor update on `!cancelled` meant a message that
          // was *successfully* persisted could still be re-sent on
          // the next effect run — which is how the same user turn
          // ended up in the DB 2–3 times (audit #1, orphan threads).
          // The save is idempotent from our side: once the POST
          // resolves, the row exists, so cursor++ is correct
          // regardless of whether we continue iterating.
          savedUpToRef.current = i + 1
        } catch { /* next change will retry from the unchanged cursor */ }
      }
    })()
    return () => { cancelled = true }
  }, [chatMessages, chatBusy])

  // Load history list whenever the panel opens.
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const items = await listConversationsApi()
      setHistoryItems(Array.isArray(items) ? items : [])
    } catch (err) {
      setHistoryError(err.message || 'Could not load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!historyOpen) return
    refreshHistory()
  }, [historyOpen, refreshHistory, authState.signedIn])

  // Actions invoked from the history panel.
  const handleNewChat = useCallback(() => {
    startNewConversation()
    savedUpToRef.current = 0
    setChatMessages([])
    setChatError(null)
    setHistoryOpen(false)
  }, [])
  const handleLoadHistory = useCallback(async (id) => {
    setHistoryError(null)
    try {
      const conv = await loadConversationApi(id)
      if (!conv) { setHistoryError('Conversation not found'); return }
      const msgs = Array.isArray(conv.messages) ? conv.messages : []
      setActiveConversationId(id)
      // Mark the full loaded transcript as "already saved" so the
      // auto-save effect doesn't re-append it as new turns.
      savedUpToRef.current = msgs.length
      setChatMessages(msgs.map((m) => ({ role: m.role, content: m.content })))
      setHistoryOpen(false)
    } catch (err) {
      setHistoryError(err.message || 'Could not load conversation')
    }
  }, [])
  const handleDeleteHistory = useCallback(async (id) => {
    try {
      await deleteConversationApi(id)
    } finally {
      if (getActiveConversationId() === id) {
        setActiveConversationId(null)
        savedUpToRef.current = 0
        setChatMessages([])
      }
      refreshHistory()
    }
  }, [refreshHistory])

  // Stage 3 — after enough user turns, if not signed in, gently open the
  // "Remember me?" prompt ONCE. Dismissed permanently per-session on close.
  const userTurnCount = useMemo(
    () => turns.filter((t) => t && t.role === 'user' && t.text && t.text.trim()).length,
    [turns]
  )
  useEffect(() => {
    if (authState.signedIn) return
    if (dismissedPromptRef.current) return
    if (rememberPromptOpen) return
    if (userTurnCount >= 4 && supportsPasskey()) {
      setRememberPromptOpen(true)
    }
  }, [userTurnCount, authState.signedIn, rememberPromptOpen])

  // Stage 3 — when the user ends a session, extract facts (if signed in)
  // AND seed the text-chat transcript with the voice turns so a user
  // who swaps from voice to text doesn't lose context.
  // Previously the user complained that "memoria intre AI-uri nu merge":
  // the voice hook's `turns` are a separate state from `chatMessages`, so
  // typing a new question after a voice chat sent the model zero context.
  // Seeding chatMessages on session end lets the next /api/chat POST
  // ship the voice history as part of `messages` (capped at 12 there).
  const turnsRef = useRef(turns)
  useEffect(() => { turnsRef.current = turns }, [turns])
  const chatMessagesRef = useRef(chatMessages)
  useEffect(() => { chatMessagesRef.current = chatMessages }, [chatMessages])
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    const justEnded = (prev && prev !== 'idle' && prev !== 'error') && (status === 'idle' || status === 'error')
    if (!justEnded) return
    const snapshot = turnsRef.current.filter((t) => t && t.role && t.text && t.text.trim())
    if (snapshot.length < 2) return
    // Seed chatMessages with the voice conversation — the two UIs share a
    // single logical thread so the user's follow-up typed question lands
    // with the voice context still in scope.
    if (chatMessagesRef.current.length === 0) {
      const seeded = snapshot.slice(-12).map((t) => ({
        role: t.role === 'assistant' ? 'assistant' : 'user',
        content: t.text,
      }))
      if (seeded.length > 0) {
        // savedUpToRef marks how many entries are already persisted to the
        // conversation history backend; voice turns are saved separately
        // by the voice transport, so treat them as already-saved here to
        // avoid a duplicate POST from the text-chat autosave effect.
        savedUpToRef.current = seeded.length
        setChatMessages(seeded)
      }
    }
    if (!authState.signedIn) return
    extractAndStore(snapshot).catch((err) => {
      console.warn('[memory extract]', err.message)
    })
  }, [status, authState.signedIn])

  // Long-term memory extraction for text chat. Previously extractAndStore
  // only fired on voice session end — a user who only typed never built
  // any long-term memory, so every text chat started cold even when
  // signed in. Trigger the same extractor once the streaming reply
  // finishes (chatBusy true?false) and the last message is a finalised
  // assistant turn. Debounced implicitly by chatBusy — further keystrokes
  // flip it true again and reset.
  const prevChatBusyRef = useRef(chatBusy)
  useEffect(() => {
    const prev = prevChatBusyRef.current
    prevChatBusyRef.current = chatBusy
    if (!prev || chatBusy) return // only on true ? false
    if (!authState.signedIn) return
    const msgs = chatMessagesRef.current
    const last = msgs[msgs.length - 1]
    if (!last || last.role !== 'assistant' || !last.content || !String(last.content).trim()) return
    // Convert {role, content} ? {role, text} for the extractor API.
    const snapshot = msgs
      .filter((m) => m && m.role && m.content && String(m.content).trim())
      .slice(-12)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        text: String(m.content),
      }))
    if (snapshot.length < 2) return
    extractAndStore(snapshot).catch((err) => {
      console.warn('[memory extract text]', err.message)
    })
  }, [chatBusy, authState.signedIn])

  const openMemory = useCallback(async () => {
    setMemoryOpen(true)
    setMemoryLoading(true)
    try {
      const r = await fetchMemory()
      setMemoryItems(Array.isArray(r.items) ? r.items : [])
    } catch (err) {
      console.warn('[memory]', err.message)
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  const handleRemember = useCallback(async () => {
    setRememberBusy(true)
    setRememberError(null)
    try {
      const nameGuess = '' // Kelion will discover the user's name over time
      const res = await registerPasskey(nameGuess)
      setAuthState({ signedIn: true, user: res.user })
      setRememberPromptOpen(false)
      // Immediately extract facts from what was said so far, so the next
      // session opens with real memory.
      const snapshot = turnsRef.current.filter((t) => t && t.role && t.text && t.text.trim())
      if (snapshot.length >= 2) {
        extractAndStore(snapshot).catch(() => {})
      }
    } catch (err) {
      setRememberError(err.message || 'Could not save the passkey')
    } finally {
      setRememberBusy(false)
    }
  }, [])

  const handleSignInExisting = useCallback(async () => {
    setRememberBusy(true)
    setRememberError(null)
    try {
      const res = await authenticateWithPasskey()
      setAuthState({ signedIn: true, user: res.user })
      setRememberPromptOpen(false)
    } catch (err) {
      setRememberError(err.message || 'Could not sign in')
    } finally {
      setRememberBusy(false)
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut().catch(() => {})
    authTokenRef.current = null
    setAuthState({ signedIn: false, user: null })
    setMemoryItems([])
    setMemoryOpen(false)
    // Don't leak the previous user's server conversation into the
    // now-signed-out guest session. Clear the active id, on-screen
    // transcript, loaded history list, and the autosave cursor.
    try { startNewConversation() } catch { /* ignore */ }
    setChatMessages([])
    setHistoryItems([])
    setHistoryOpen(false)
    savedUpToRef.current = 0
  }, [])

  const handleForgetAll = useCallback(async () => {
    if (!authState.signedIn) return
    if (!window.confirm('Forget everything Kelion knows about you? This cannot be undone.')) return
    try {
      await forgetAllMemory()
      setMemoryItems([])
    } catch (err) {
      console.warn('[memory]', err.message)
    }
  }, [authState.signedIn])

  // Stage 5 — probe current push subscription state on mount + when auth changes
  useEffect(() => {
    let cancelled = false
    if (!pushSupported()) {
      setPushState({ supported: false, enabled: false, permission: 'unsupported' })
      return
    }
    getPushStatus().then((s) => { if (!cancelled) setPushState(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [authState.signedIn])

  const handleEnablePush = useCallback(async () => {
    setPushError(null)
    setPushBusy(true)
    try {
      await enablePush()
      const s = await getPushStatus()
      setPushState(s)
    } catch (err) {
      setPushError(err.message || 'Could not enable pings.')
    } finally {
      setPushBusy(false)
    }
  }, [])

  const handleDisablePush = useCallback(async () => {
    setPushError(null)
    setPushBusy(true)
    try {
      await disablePush()
      const s = await getPushStatus()
      setPushState(s)
    } catch (err) {
      setPushError(err.message || 'Could not disable pings.')
    } finally {
      setPushBusy(false)
    }
  }, [])

  const handleTestPing = useCallback(async () => {
    setPushError(null)
    try { await sendTestPing('This is Kelion testing the ping channel.') }
    catch (err) { setPushError(err.message || 'Test ping failed.') }
  }, [])

  const statusLabel = {
    idle:       'Tap to talk',
    requesting: 'Requesting mic…',
    connecting: 'Connecting…',
    listening:  'Listening',
    thinking:   'Thinking',
    speaking:   'Speaking',
    error:      error || 'Error',
  }[status] || 'Kelion'

  // Shared entry point — tap-to-talk + wake-word both start a voice
  // session from idle. Carry any existing text/voice transcript as
  // `priorTurns` so Kelion continues the conversation instead of
  // re-greeting. chatMessages is preferred because it is the cross-mode
  // transcript (voice-end seeds it from `turns`, and any text the user
  // typed afterward appends). When chatMessages is empty we fall back
  // to the hook's raw `turns` so repeat taps on pure-voice users still
  // pick up context.
  const startVoiceWithPriorTurns = useCallback(() => {
    const priorTurns = selectPriorTurns(
      chatMessagesRef.current,
      turnsRef.current,
    )
    try { start(priorTurns.length > 0 ? { priorTurns } : undefined) }
    catch (_) { /* banner surfaces failure */ }
  }, [start])

  const onStageClick = useCallback(() => {
    if (menuOpen) return setMenuOpen(false)
    // First user gesture ? kick the geolocation permission prompt.
    // iOS Safari silently skips `getCurrentPosition` called outside a
    // real gesture, so the passive on-mount request in useClientGeo
    // often never shows a dialog on iPhone/iPad. Calling it from this
    // click handler makes iOS render the permission dialog reliably.
    // No-op once permission is already 'granted' (requestNow short-
    // circuits on repeat).
    if (geoPermission !== 'granted') {
      try { requestGeo() } catch { /* ignore — hook logs internally */ }
    }
    if (status === 'idle' || status === 'error') {
      startVoiceWithPriorTurns()
      // Tap-to-talk is a gated guest action — refresh the trial HUD so
      // the top-right countdown starts ticking immediately once the
      // token mint stamps the 15-min window server-side. No-op for
      // signed-in users (applicable: false).
      if (!authState.signedIn) {
        // Small delay so the server has time to stamp on the token mint
        // request before we poll. 600 ms is well under the first audio
        // chunk, so the HUD update feels instant. Tracked in a ref so
        // we can clear it on unmount (Copilot review pr-74) — otherwise
        // a quick navigation mid-delay would setState on an unmounted
        // useTrial consumer.
        if (trialRefreshTimerRef.current) clearTimeout(trialRefreshTimerRef.current)
        trialRefreshTimerRef.current = setTimeout(() => {
          trialRefreshTimerRef.current = null
          trialHud.refresh()
        }, 600)
      }
    }
  }, [menuOpen, status, startVoiceWithPriorTurns, geoPermission, requestGeo, authState.signedIn, trialHud])

  // ----- Wake-word "Kelion" -----
  // Adrian: "cind zic kelion se auto porneste butonul de chat".
  // When the status is idle (no live session yet, or a previous error
  // cleared the state), run a background recogniser that listens for
  // the hotword and triggers the same entry point as the tap-to-talk
  // click. The hook is a no-op on browsers without the Web Speech API
  // (Safari iOS, Firefox), so the manual tap flow stays untouched for
  // those users.
  // Wake-word is armed ONLY on 'idle' — not on 'error'. After a
  // protocol failure (1007/1008/1011) the user must tap the stage to
  // explicitly retry. Auto-retrying from 'error' re-opens a WS against
  // the same failing token / quota / model and loops the same error,
  // which is exactly the "crapa dupa 2 min de funtionare 1007" Adrian
  // reported on 2026-04-20.
  useWakeWord({
    enabled: status === 'idle',
    onDetect: () => {
      if (status === 'idle') {
        startVoiceWithPriorTurns()
        if (!authState.signedIn) {
          if (trialRefreshTimerRef.current) clearTimeout(trialRefreshTimerRef.current)
          trialRefreshTimerRef.current = setTimeout(() => {
            trialRefreshTimerRef.current = null
            trialHud.refresh()
          }, 600)
        }
      }
    },
  })

  return (
    <div
      onClick={onStageClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(ellipse at center top, #0d0b1e 0%, #05060a 70%)',
        color: '#e9d5ff',
        overflow: 'hidden',
        cursor: status === 'idle' || status === 'error' ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      {/* Debug-only Leva tuning drawer. Renders null unless the URL
          carries ?debug=1 or ?tune=1; zero cost for real users. */}
      {isTuningEnabled() && <TuningPanel />}
      {/* PR #200 — toast overlay driven by uiActionStore. Fires when
          Kelion calls ui_notify. Renders null when the queue is empty
          so idle cost is zero. */}
      <UIActionToast />
      <Canvas
        /* THREE 0.183 deprecated PCFSoftShadowMap (the r3f default when
           `shadows` is passed bare). Switch to VSMShadowMap — softer
           results and no console warning. */
        shadows={{ type: THREE.VSMShadowMap }}
        camera={{ position: [0, 0.2, 4.2], fov: 36 }}
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      >
        <color attach="background" args={['#05060a']} />
        <fog attach="fog" args={['#080614', 5.5, 12]} />
        <CameraRig />
        <Suspense fallback={null}>
          <Environment preset="city" environmentIntensity={0.35} />
          <StudioDecor />
          {/* Halo removed — Adrian asked to stop the pulsating circle behind
              the avatar; it was too busy. Status color is still conveyed
              through the spotlights + status-dot in the HUD. */}
          <group position={[1.6, 0, 0]}>
            {/* `presenting` flips true whenever Kelion is speaking an answer
                — that's when we have (or will have) content on the monitor
                and want the body to rotate ~8° toward it. When we wire the
                tool-use pipeline, this will be driven by an explicit
                "content on monitor" signal instead. */}
            <AvatarModel
              mouthOpen={mouthOpen}
              status={status}
              emotion={emotion}
              // Adrian: "avatarul nu priveste catre user" — previously the
              // body yawed ~8° toward the on-stage monitor whenever Kelion
              // spoke, which left the avatar glancing away from the webcam.
              // We always face the user now; hand gestures still fire while
              // speaking (see AvatarModel below where we key them off
              // status === 'speaking').
              presenting={false}
            />
          </group>
          <ContactShadows position={[1.6, -1.65, 0]} opacity={0.55} scale={5} blur={2.6} far={2.5} />
        </Suspense>
      </Canvas>

      {/* Half-page monitor overlay — when Kelion calls show_on_monitor (map /
          video / image / wiki / web), the content is rendered here as a 2D
          panel covering the LEFT half of the viewport on desktop (bottom
          sheet on mobile). Adrian: "inlocuirea monitorului cu jumate de
          pagina … avatarul pe dreapta". The small 3D monitor in the scene
          stays as decor. */}
      <MonitorOverlay />

      <audio ref={audioRef} autoPlay playsInline />

      {/* Last assistant text reply (when chatting by typing) — fades
          above the input bar. Only the latest assistant message shows
          so we don't clutter the stage. The bubble auto-hides 8s after
          the reply finishes (kept in history/transcript). */}
      {chatMessages.length > 0 && bubbleVisible && (() => {
        const last = chatMessages[chatMessages.length - 1]
        const userTurn = [...chatMessages].reverse().find((m) => m.role === 'user')
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 110px)',
              left: bottomLeft, transform: 'translateX(-50%)',
              width: overlayShiftsBottom ? 'min(420px, 44vw)' : 'min(680px, 92vw)',
              maxHeight: '42vh', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: 14,
              borderRadius: 16,
              background: 'rgba(10, 8, 20, 0.72)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              color: '#ede9fe',
              fontSize: 14, lineHeight: 1.45,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              zIndex: bottomZIndex,
            }}
          >
            {userTurn && (
              <div style={{
                alignSelf: 'flex-end', maxWidth: '88%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(124, 58, 237, 0.25)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                fontSize: 13,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}>{userTurn.content}</div>
            )}
            {last.role === 'assistant' && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '92%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(167, 139, 250, 0.08)',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}>
                {last.content || (chatBusy ? 'Kelion is thinking…' : '')}
              </div>
            )}
            {chatError && (
              <div style={{
                fontSize: 12, color: '#fecaca',
                background: 'rgba(80, 14, 14, 0.6)',
                padding: '6px 10px', borderRadius: 10,
              }}>{chatError}</div>
            )}
          </div>
        )
      })()}

      {/* Live voice chat bubble — mirrors the text-chat bubble above but
          reads from `turns` (populated by useGeminiLive from the Gemini Live
          inputTranscription / outputTranscription stream). Adrian: "logat
          vocea e cea corecta dar nu e chat live, nu afiseaza absolut nimic
          pe ecran". Previously the turns only rendered inside the transcript
          panel (closed by default) — so live voice users heard Kelion but
          saw nothing. This bubble shows the last user utterance + the
          streaming assistant reply while a voice session is active. It is
          hidden when the text-chat bubble is shown to avoid two overlapping
          panels. */}
      {status !== 'idle' && status !== 'error' && turns.length > 0 && !(chatMessages.length > 0 && bubbleVisible) && (() => {
        const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
        const lastUser = [...turns].reverse().find((t) => t.role === 'user')
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 110px)',
              left: bottomLeft, transform: 'translateX(-50%)',
              width: overlayShiftsBottom ? 'min(420px, 44vw)' : 'min(680px, 92vw)',
              maxHeight: '42vh', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: 14,
              borderRadius: 16,
              background: 'rgba(10, 8, 20, 0.72)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              color: '#ede9fe',
              fontSize: 14, lineHeight: 1.45,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              zIndex: bottomZIndex || 4,
            }}
          >
            {lastUser && lastUser.text && (
              <div style={{
                alignSelf: 'flex-end', maxWidth: '88%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(124, 58, 237, 0.25)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                fontSize: 13,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}>{lastUser.text}</div>
            )}
            {lastAssistant && lastAssistant.text && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '92%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(167, 139, 250, 0.08)',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}>{lastAssistant.text}</div>
            )}
            {!lastAssistant && status === 'thinking' && (
              <div style={{
                alignSelf: 'flex-start', fontSize: 13, opacity: 0.7,
                padding: '8px 12px',
              }}>Kelion is thinking…</div>
            )}
            {!lastUser && !lastAssistant && status === 'listening' && (
              <div style={{
                alignSelf: 'center', fontSize: 13, opacity: 0.7,
                padding: '8px 12px',
              }}>Listening…</div>
            )}
          </div>
        )
      })()}

      {/* Text chat composer — bottom center, above the status pill.
          Narrower (420px) than the old 680px because the wider pill was
          overlapping the stage monitor on the left. Stops click
          propagation so typing doesn't toggle the voice session.
          Submit with Enter or the send button. */}
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); sendTextMessage() }}
        style={{
          position: 'absolute',
          bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 54px)',
          left: bottomLeft, transform: 'translateX(-50%)',
          width: overlayShiftsBottom ? 'min(420px, 44vw)' : 'min(420px, 92vw)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px 6px 14px',
          borderRadius: 999,
          background: 'rgba(10, 8, 20, 0.72)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          zIndex: bottomZIndex || 50,
        }}
      >
        {/* F2 — hidden native file picker driving the "+" button below.
            Accepts images, PDFs and text files. The selected file shows
            as a dismissible pill and its filename + size land in the
            outgoing message as a bracketed note. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,text/plain,.txt,.md,.csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0]
            if (f) setAttachedFile(f)
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          disabled={chatBusy}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'rgba(167, 139, 250, 0.18)',
            border: '1px solid rgba(167, 139, 250, 0.3)',
            color: '#ede9fe',
            cursor: chatBusy ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, lineHeight: 1, flexShrink: 0, padding: 0,
          }}
          title="Attach file"
          aria-label="Attach file"
        >+</button>
        {attachedFile && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(124, 58, 237, 0.22)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            color: '#ede9fe', fontSize: 11,
            maxWidth: 130, overflow: 'hidden',
            whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            flexShrink: 0,
          }} title={attachedFile.name}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ?? {attachedFile.name}
            </span>
            <button
              type="button"
              onClick={() => {
                setAttachedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              style={{
                background: 'transparent', border: 'none',
                color: '#ede9fe', cursor: 'pointer', padding: '0 2px',
                fontSize: 13, lineHeight: 1,
              }}
              aria-label="Remove attachment"
              title="Remove attachment"
            >×</button>
          </div>
        )}
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          // Explicit paste handler — Adrian 2026-04-20: "trebuie sa
          // pot face paste la orice in tab de scris". On some
          // Capacitor / WebView builds (and occasionally on Chrome
          // when a focused 3D canvas sibling intercepts the keyboard
          // shortcut), the native `input` event from Ctrl+V never
          // fires and the input stays empty. We read the clipboard
          // directly from the event, splice it into the current
          // value at the caret position, and call setState so React
          // renders the new text. `preventDefault` blocks any
          // duplicate insertion from the browser's default handler.
          // Right-click ? Paste from the browser menu also fires
          // this event, so both paths work.
          onPaste={(e) => {
            try {
              const cd = e.clipboardData || window.clipboardData
              if (!cd) return

              // Image paste: if the clipboard carries a binary image
              // (screenshot, copied-from-browser image, drag-and-drop
              // preview), convert the first one into a File and wire it
              // through the same attachment pipeline as the paperclip.
              // This fires before the text branch so a screenshot never
              // gets silently dropped.
              const items = cd.items ? Array.from(cd.items) : []
              const imgItem = items.find((it) => it && it.kind === 'file' && typeof it.type === 'string' && it.type.startsWith('image/'))
              if (imgItem) {
                const blob = imgItem.getAsFile()
                if (blob) {
                  e.preventDefault()
                  const ext = (blob.type.split('/')[1] || 'png').split(';')[0]
                  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
                  const named = (typeof File !== 'undefined')
                    ? new File([blob], `pasted-${stamp}.${ext}`, { type: blob.type })
                    : blob
                  setAttachedFile(named)
                  if (fileInputRef.current) { try { fileInputRef.current.value = '' } catch (_) {} }
                  return
                }
              }

              const text = cd.getData ? cd.getData('text') : ''
              if (text == null || text === '') return
              e.preventDefault()
              const el = e.currentTarget
              const start = typeof el.selectionStart === 'number' ? el.selectionStart : chatInput.length
              const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : chatInput.length
              const next = chatInput.slice(0, start) + text + chatInput.slice(end)
              setChatInput(next)
              // Restore caret right after the pasted text so the user
              // can keep typing without clicking again.
              requestAnimationFrame(() => {
                try { el.setSelectionRange(start + text.length, start + text.length) } catch (_) { /* ignore */ }
              })
            } catch (_) {
              // If anything goes wrong, fall back to the browser's
              // default paste handler so we never make things worse
              // than before.
            }
          }}
          placeholder="Type to Kelion…"
          disabled={chatBusy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'transparent', border: 'none', outline: 'none',
            color: '#ede9fe',
            fontSize: 15, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '8px 2px',
            // Allow text selection / right-click menu on the input
            // itself even though the surrounding stage uses
            // `user-select: none`. Without this, some Chromium
            // builds disable the clipboard context menu on nested
            // inputs.
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}
        />
        <button
          type="submit"
          disabled={chatBusy || (chatInput.trim().length === 0 && !attachedFile)}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: (chatInput.trim().length === 0 && !attachedFile)
              ? 'rgba(167, 139, 250, 0.18)'
              : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            border: 'none', color: '#fff',
            cursor: chatBusy || (chatInput.trim().length === 0 && !attachedFile) ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: chatBusy ? 0.6 : 1,
            fontSize: 16,
          }}
          aria-label="Send message"
        >?</button>
      </form>

      {/* Status pill — bottom center */}
      <div style={{
        position: 'absolute', bottom: 'max(32px, env(safe-area-inset-bottom))',
        left: bottomLeft, transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 22px',
        borderRadius: 999,
        background: 'rgba(10, 8, 20, 0.65)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${STATUS_COLORS[status]}33`,
        color: '#ede9fe',
        fontSize: 14, fontFamily: 'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.02em',
        pointerEvents: 'none',
        zIndex: bottomZIndex || 50,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: STATUS_COLORS[status],
          boxShadow: `0 0 12px ${STATUS_COLORS[status]}`,
          // No pulsing animation — Adrian found the blinking tiring.
        }} />
        {statusLabel}
      </div>

      {/* Guest trial countdown — Adrian: "timer se afiseaza dreapta sus
          vizibil". Renders top-right, above the action bar, only while
          the server reports `applicable: true` (guests only — signed-in
          and admin users never see it). Shows MM:SS once the 15-min
          window is stamped (first gated interaction); before that it
          shows "15:00 free" as a preview. When exhausted it turns red
          and prompts sign-in. */}
      {trialHud.applicable && trialHud.loaded && !authState.signedIn && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(max(18px, env(safe-area-inset-top)) + 62px)',
            right: 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(10, 8, 20, 0.72)',
            backdropFilter: 'blur(12px)',
            border: !trialHud.allowed
              ? '1px solid rgba(239, 68, 68, 0.6)'
              : trialHud.stamped
                ? '1px solid rgba(167, 139, 250, 0.55)'
                : '1px solid rgba(167, 139, 250, 0.3)',
            color: !trialHud.allowed ? '#fecaca' : '#e9d5ff',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600,
            letterSpacing: '0.03em',
            zIndex: 25,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
          }}
          role="status"
          aria-live="polite"
          title={trialHud.stamped
            ? 'Free trial is counting down. Sign in or buy credits to keep using Kelion after it expires.'
            : '15 free minutes — the timer starts on your first message or Tap-to-talk.'}
        >
          <span aria-hidden style={{ fontSize: 13 }}>?</span>
          {!trialHud.allowed ? (
            <>Free trial used up — <button
              onClick={() => setSignInModalOpen(true)}
              style={{
                background: 'transparent', border: 'none',
                color: '#fca5a5', textDecoration: 'underline',
                cursor: 'pointer', padding: 0, font: 'inherit',
              }}
            >sign in</button></>
          ) : (
            <>Free trial · {Math.floor(trialRemainingMs / 60000)}:{String(Math.floor((trialRemainingMs % 60000) / 1000)).padStart(2, '0')} left</>
          )}
        </div>
      )}

      {/* Top-right action bar — Adrian: "panoul cu butoane e gândit
          gre?it". Simplified to: Credits/Admin pill + Sign in/out + ?.
          Camera, screen, transcript, contact all moved into the ?
          overflow menu. Camera also now auto-starts when the user types
          or speaks and auto-stops after idle (F15). */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 18, right: 18, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {/* Single-LLM cleanup (2026-04): voice transport pill removed —
            Gemini Live is the only provider, no UI swap. */}
        {/* Credits pill — hidden for admins (they have unlimited access and
            no billing; showing "0 min" confused Adrian in testing). For
            regular signed-in users we still show balance + open the Stripe
            Checkout flow on click. */}
        {authState.signedIn && !isAdmin && (
          <button
            onClick={() => openBuy()}
            style={{
              height: 36, padding: '0 12px', borderRadius: 999,
              background: 'rgba(10, 8, 20, 0.5)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(167, 139, 250, 0.25)',
              color: '#ede9fe', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            title="Buy credits"
            aria-label="Buy credits"
          >
            <span style={{ fontSize: 14 }}>??</span>
            {/* Adrian: "creditul nu trebuie sa arate minute, trebuie sa fie
                o unitate x credite". 1 credit = 1 min of Kelion Live kept
                internally (backend still tracks balance_minutes), but the
                UI shows the neutral unit label so users think in "credits"
                not "minutes". */}
            <span>Credits{balance != null ? ` · ${balance}` : ''}</span>
          </button>
        )}
        {/* Unlimited pill — admin-only, replaces Credits pill. Visual cue
            that the current account is not gated. Click opens the business
            metrics overlay, same as the overflow menu entry. */}
        {authState.signedIn && isAdmin && (
          <button
            onClick={() => switchAdminTab('business')}
            style={{
              height: 36, padding: '0 12px', borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(167, 139, 250, 0.18))',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(250, 204, 21, 0.45)',
              color: '#fef3c7', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontWeight: 600,
            }}
            title="Admin dashboard — Business, AI credits, Visitors, Users, Payouts"
            aria-label="Open admin dashboard"
          >
            <span style={{ fontSize: 14 }}>???</span>
            <span>Admin · 8</span>
          </button>
        )}
        <button
          onClick={() => {
            if (authState.signedIn) {
              handleSignOut()
            } else {
              // Full sign-in modal: email+password first, Google SSO, passkey
              // as a 1-tap alternative. Admins who need to log in with
              // credentials land here directly instead of bouncing off the
              // passkey-only prompt.
              setSignInModalOpen(true)
            }
          }}
          style={{
            height: 36, padding: '0 14px', borderRadius: 999,
            background: authState.signedIn
              ? 'rgba(239, 68, 68, 0.18)'
              : 'linear-gradient(135deg, #a78bfa, #60a5fa)',
            border: authState.signedIn
              ? '1px solid rgba(239, 68, 68, 0.45)'
              : '1px solid rgba(167, 139, 250, 0.5)',
            color: authState.signedIn ? '#fecaca' : '#0b0716',
            fontSize: 12, fontWeight: 600, letterSpacing: '0.03em',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          title={authState.signedIn ? 'Sign out' : 'Sign in'}
          aria-label={authState.signedIn ? 'Sign out' : 'Sign in'}
        >
          {authState.signedIn
            ? `Sign out${authState.user?.name ? ` · ${authState.user.name}` : ''}`
            : 'Sign in'}
        </button>
        <TopBarIconButton
          onClick={() => setMenuOpen((v) => !v)}
          active={menuOpen}
          title="More"
          ariaLabel="More options"
        >?</TopBarIconButton>
      </div>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 70, right: 18, zIndex: 20,
            minWidth: 220,
            background: 'rgba(14, 10, 28, 0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(167, 139, 250, 0.2)',
            borderRadius: 14, padding: 6,
            color: '#ede9fe', fontSize: 14,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          {/* Camera / Screen share / Transcript — tools moved back into
              the overflow menu so the top bar stays clean (Adrian: "panoul
              e gândit gre?it"). Camera also now auto-starts on speech/
              typing, so the explicit toggle here is for manual override. */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(237,233,254,0.45)',
            }}
          >
            Tools
          </div>
          <MenuItem onClick={() => {
            if (cameraStream) { stopCamera() }
            else { startCamera().catch(() => { /* banner surfaces the error */ }) }
            setMenuOpen(false)
          }}>
            {cameraStream ? '?? Turn camera off' : '?? Turn camera on'}
          </MenuItem>
          <MenuItem onClick={() => { screenStream ? stopScreen() : startScreen(); setMenuOpen(false) }}>
            {screenStream ? '??? Stop sharing screen' : '??? Share screen'}
          </MenuItem>
          <MenuItem onClick={() => { setTranscriptOpen((v) => !v); setMenuOpen(false) }}>
            {transcriptOpen ? '?? Hide transcript' : '?? Show transcript'}
          </MenuItem>
          <MenuItem onClick={() => { navigate('/contact'); setMenuOpen(false) }}>
            ?? Contact us
          </MenuItem>
          <div
            style={{
              height: 1,
              background: 'rgba(167, 139, 250, 0.15)',
              margin: '6px 8px',
            }}
          />
          {/* Stage 6 — voice style submenu */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(237,233,254,0.45)',
            }}
          >
            Voice style
          </div>
          {VOICE_STYLE_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.key}
              onClick={() => { handleVoiceStyleChange(opt.key); setMenuOpen(false) }}
            >
              <span style={{ opacity: voiceStyle === opt.key ? 1 : 0.75 }}>
                {voiceStyle === opt.key ? '? ' : '? '}
                {opt.label}
              </span>
            </MenuItem>
          ))}
          <div style={{ height: 6 }} />
          {/* Conversation history — works for guests (localStorage)
              and signed-in users (server). Above the auth gate so guests
              can find their saved threads too. */}
          <MenuItem onClick={() => { setHistoryOpen(true); setMenuOpen(false) }}>
            Conversation history
          </MenuItem>
          <MenuItem onClick={() => { handleNewChat(); setMenuOpen(false) }}>
            New chat
          </MenuItem>
          <div style={{ height: 6 }} />
          {/* Stage 3 — memory + passkey */}
          {authState.signedIn ? (
            <>
              <MenuItem onClick={() => { openMemory(); setMenuOpen(false) }}>
                What do you know about me?
              </MenuItem>
              {/* Consensual voice clone — opens the multi-step modal
                  (consent + record + manage). Signed-in only; the
                  backend route is gated by requireAuth. */}
              <MenuItem onClick={() => { setVoiceCloneOpen(true); setMenuOpen(false) }}>
                Clone my voice
              </MenuItem>
              {/* Stage 5 — proactive pings */}
              {pushState.supported && (
                pushState.enabled ? (
                  <>
                    <MenuItem
                      onClick={() => { handleTestPing(); setMenuOpen(false) }}
                      disabled={pushBusy}
                    >
                      Send a test ping
                    </MenuItem>
                    <MenuItem
                      onClick={() => { handleDisablePush(); setMenuOpen(false) }}
                      disabled={pushBusy}
                    >
                      {pushBusy ? 'Disabling pings…' : 'Disable pings'}
                    </MenuItem>
                  </>
                ) : (
                  <MenuItem
                    onClick={() => { handleEnablePush(); setMenuOpen(false) }}
                    disabled={pushBusy}
                  >
                    {pushBusy ? 'Enabling pings…' : 'Enable pings'}
                  </MenuItem>
                )
              )}
              {/* Buy credits moved to the top-right action bar. */}
              {/* PWA install — only shows when the browser actually
                  fired beforeinstallprompt (Chrome/Edge/Android). iOS
                  users get instructions inside the Buy-credits modal. */}
              {!installed && installPromptEvent && (
                <MenuItem onClick={() => { handleInstall(); setMenuOpen(false) }}>
                  Install Kelion on this device
                </MenuItem>
              )}
              {/* Admin-only — unified dashboard. One entry that opens the
                  admin shell with tabs for Business, AI credits, Visitors,
                  Users, and Payouts. Replaces the three separate menu
                  entries that used to live here (2026-04-20 Adrian:
                  "management de admin integrat intr-un singur buton"). */}
              {isAdmin && (
                <MenuItem onClick={() => { switchAdminTab('business'); setMenuOpen(false) }}>
                  Admin dashboard
                </MenuItem>
              )}
              {/* Sign out moved to the top-right action bar. */}
            </>
          ) : (
            supportsPasskey() && (
              <MenuItem onClick={() => { setRememberPromptOpen(true); setMenuOpen(false) }}>
                Remember me
              </MenuItem>
            )
          )}
          <MenuItem onClick={() => { stop(); setMenuOpen(false) }} disabled={status === 'idle'}>
            End chat
          </MenuItem>
          <div
            style={{
              height: 1,
              background: 'rgba(167, 139, 250, 0.15)',
              margin: '6px 8px',
            }}
          />
          {/* Contact duplicated in the Tools section above. */}
        </div>
      )}

      {/* Contact moved to the top-bar as an icon (??) per Adrian's
          request — the old bottom-strip was cluttering the stage. The
          menu entry now routes via react-router `navigate('/contact')`
          so the SPA stays mounted and auth state survives the browser
          back button. */}

      {/* F17 — camera self-view removed from the page per Adrian's request:
          "am cerut sa nu fie vizibila informatia pe pagina". The camera
          stream still runs (frames feed the vision pipeline for Kelion),
          but there is no visible preview thumbnail. We still mount a
          hidden <video> element so the MediaStream attachment lifecycle
          (srcObject assignment + play() trigger) works the same way it
          did with a visible preview — some browsers stall the track if
          no element ever consumes the stream. Hidden via display:none. */}
      {cameraStream && (
        <video
          ref={cameraVideoRef}
          autoPlay
          muted
          playsInline
          style={{ display: 'none' }}
        />
      )}

      {/* Screen share indicator — Kelion is watching your screen (M10) */}
      {screenStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(10, 8, 20, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(96, 165, 250, 0.4)',
            color: '#bfdbfe', fontSize: 12, letterSpacing: '0.05em',
            display: 'flex', alignItems: 'center', gap: 8,
            zIndex: 15,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#60a5fa',
            boxShadow: '0 0 8px #60a5fa',
          }} />
          Sharing screen
        </div>
      )}

      {visionError && !cameraStream && !screenStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(80, 14, 14, 0.7)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            color: '#fecaca', fontSize: 12,
            zIndex: 15,
          }}
        >
          {visionError}
        </div>
      )}

      {/* Transcript drawer — opt-in, has X + backdrop + ESC to close.
          Previously the only way to close it was to re-open the ? menu
          and pick "Hide transcript", which was not discoverable. */}
      {transcriptOpen && (
        <div
          onClick={() => setTranscriptOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
      {transcriptOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(420px, 92vw)',
            background: 'rgba(10, 8, 20, 0.82)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 24,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>TRANSCRIPT</div>
            <button
              onClick={() => setTranscriptOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close transcript"
            >?</button>
          </div>
          {turns.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Conversation will appear here.</div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{
              marginBottom: 14, padding: '10px 12px',
              borderRadius: 10,
              background: t.role === 'user' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(96, 165, 250, 0.08)',
              borderLeft: `2px solid ${t.role === 'user' ? '#a78bfa' : '#60a5fa'}`,
              fontSize: 14, lineHeight: 1.5,
            }}>
              <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 4, letterSpacing: '0.1em' }}>
                {t.role === 'user' ? 'YOU' : 'KELION'}
              </div>
              {t.text || <i style={{ opacity: 0.4 }}>…</i>}
            </div>
          ))}
        </div>
      )}

      {/* In-app email composer — opened by the compose_email_draft tool.
          The user reviews / edits / sends; nothing is delivered without
          an explicit click on Send (which routes through send_email). */}
      <EmailComposerModal authToken={authTokenRef.current} />

      {/* Full sign-in modal — triggered by the top-bar Sign in button.
          Email+password primary, Google SSO, passkey as 1-tap. */}
      <SignInModal
        open={signInModalOpen}
        onClose={() => setSignInModalOpen(false)}
        passkeySupported={supportsPasskey()}
        onAuthenticated={async (user, token) => {
          // Login succeeded. Stash the JWT in memory so subsequent calls
          // (chat, TTS, etc.) can fall back to Bearer-header auth if the
          // httpOnly cookie doesn't make it back (adblockers / privacy
          // extensions / Safari ITP). The server's requireAuth middleware
          // accepts either the header or the cookie.
          if (token) authTokenRef.current = token
          // Re-fetch /api/auth/passkey/me so we get the canonical
          // { isAdmin } flag computed server-side (covers the admin email
          // allow-list). Fall back to the raw response if the probe fails
          // — at worst the admin-only UI pieces won't render until next
          // reload.
          setSignInModalOpen(false)
          try {
            const me = await fetchMe()
            if (me && me.signedIn) {
              setAuthState({ signedIn: true, user: me.user || user || null })
              return
            }
          } catch (_) { /* ignore */ }
          setAuthState({ signedIn: true, user: user || null })
        }}
        onUsePasskey={async () => {
          // Reuse the existing WebAuthn flow. Close the modal first so the
          // OS-level passkey sheet appears in front.
          setSignInModalOpen(false)
          try {
            const res = await authenticateWithPasskey()
            setAuthState({ signedIn: true, user: res.user })
          } catch (err) {
            // Re-open with the error surfaced — but the modal has its own
            // state now, so just log; user can retry.
            console.warn('[passkey auth]', err && err.message)
          }
        }}
      />

      <VoiceCloneModal
        open={voiceCloneOpen}
        onClose={() => setVoiceCloneOpen(false)}
        userEmail={authState.user && authState.user.email}
        userName={authState.user && (authState.user.name || authState.user.displayName)}
      />

      {/* Stage 3 — "Remember me" soft prompt */}
      {rememberPromptOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            transform: 'translateX(-50%)',
            width: 'min(420px, 92vw)',
            padding: '18px 20px 16px',
            borderRadius: 18,
            background: 'rgba(14, 10, 28, 0.92)',
            backdropFilter: 'blur(22px)',
            border: '1px solid rgba(167, 139, 250, 0.32)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
            color: '#ede9fe',
            zIndex: 25,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 14 }}>
            I'd like to remember you next time.<br />
            <span style={{ opacity: 0.65, fontSize: 13 }}>
              Save a passkey on this device — no password, no email.
            </span>
          </div>
          {rememberError && (
            <div style={{
              fontSize: 12, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '8px 10px', borderRadius: 8, marginBottom: 10,
            }}>{rememberError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleRemember}
              disabled={rememberBusy}
              style={{
                flex: '1 1 auto',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
                color: '#0a0818',
                border: 'none',
                cursor: rememberBusy ? 'wait' : 'pointer',
                fontSize: 14, fontWeight: 600,
              }}
            >
              {rememberBusy ? 'Saving…' : 'Remember me'}
            </button>
            <button
              onClick={handleSignInExisting}
              disabled={rememberBusy}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.12)',
                color: '#ede9fe',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                cursor: rememberBusy ? 'wait' : 'pointer',
                fontSize: 14,
              }}
            >
              I have a passkey
            </button>
            <button
              onClick={() => {
                dismissedPromptRef.current = true
                setRememberPromptOpen(false)
                setRememberError(null)
              }}
              disabled={rememberBusy}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'transparent',
                color: '#ede9fe',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                cursor: 'pointer',
                fontSize: 14, opacity: 0.75,
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Stage 3 — memory drawer */}
      {memoryOpen && (
        <div
          onClick={() => setMemoryOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
      {memoryOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(440px, 92vw)',
            background: 'rgba(10, 8, 20, 0.82)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 24,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              WHAT I KNOW ABOUT YOU
            </div>
            <button
              onClick={() => setMemoryOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>

          {memoryLoading && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Loading…</div>
          )}
          {!memoryLoading && memoryItems.length === 0 && (
            <div style={{ opacity: 0.55, fontSize: 14, lineHeight: 1.5 }}>
              Nothing yet. Keep talking — I'll pick up on things worth remembering
              and save them here. You can review and delete anything.
            </div>
          )}
          {memoryItems.map((m) => (
            <div key={m.id} style={{
              marginBottom: 10, padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(167, 139, 250, 0.08)',
              borderLeft: '2px solid #a78bfa',
              fontSize: 14, lineHeight: 1.45,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{
                fontSize: 10, opacity: 0.55, letterSpacing: '0.12em',
              }}>{(m.kind || 'fact').toUpperCase()}</div>
              <div>{m.fact}</div>
            </div>
          ))}

          {memoryItems.length > 0 && (
            <button
              onClick={handleForgetAll}
              style={{
                marginTop: 18,
                padding: '10px 14px',
                borderRadius: 10,
                background: 'transparent',
                color: '#fecaca',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                cursor: 'pointer', fontSize: 13,
              }}
            >Forget everything</button>
          )}
        </div>
      )}

      {/* Conversation history drawer — lists saved threads for both
          guests (localStorage) and signed-in users (server). Clicking a
          row replays that transcript into the chat log. */}
      {historyOpen && (
        <div
          onClick={() => setHistoryOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
      {historyOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(460px, 94vw)',
            background: 'rgba(10, 8, 20, 0.82)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 24,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              CONVERSATION HISTORY
            </div>
            <button
              onClick={() => setHistoryOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={handleNewChat}
              style={{
                padding: '8px 12px', borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.18)',
                border: '1px solid rgba(167, 139, 250, 0.35)',
                color: '#ede9fe', cursor: 'pointer', fontSize: 13,
              }}
            >+ New chat</button>
            <button
              onClick={refreshHistory}
              style={{
                padding: '8px 12px', borderRadius: 10,
                background: 'transparent',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', cursor: 'pointer', fontSize: 13, opacity: 0.85,
              }}
            >Refresh</button>
          </div>

          {!authState.signedIn && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(250, 204, 21, 0.08)',
              border: '1px solid rgba(250, 204, 21, 0.25)',
              fontSize: 12, lineHeight: 1.5, opacity: 0.9,
            }}>
              Signed-out — history is saved locally on this browser only. Sign in
              to keep it across devices.
            </div>
          )}

          {historyLoading && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Loading…</div>
          )}
          {historyError && (
            <div style={{
              marginBottom: 10, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fecaca', fontSize: 13,
            }}>{historyError}</div>
          )}
          {!historyLoading && historyItems.length === 0 && !historyError && (
            <div style={{ opacity: 0.55, fontSize: 14, lineHeight: 1.5 }}>
              No saved conversations yet. Your chat will be saved here
              automatically as you talk.
            </div>
          )}
          {historyItems.map((c) => {
            const ts = c.updated_at ? new Date(c.updated_at) : null
            const tsLabel = ts && !Number.isNaN(ts.getTime())
              ? ts.toLocaleString()
              : ''
            return (
              <div
                key={c.id}
                style={{
                  marginBottom: 10, padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(167, 139, 250, 0.08)',
                  borderLeft: '2px solid #a78bfa',
                  fontSize: 14, lineHeight: 1.45,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}
              >
                <button
                  onClick={() => handleLoadHistory(c.id)}
                  style={{
                    flex: 1, textAlign: 'left', background: 'transparent',
                    border: 'none', color: '#ede9fe', cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>
                    {c.title || '(untitled)'}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.55 }}>
                    {c.message_count} {c.message_count === 1 ? 'message' : 'messages'}
                    {tsLabel ? ` · ${tsLabel}` : ''}
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteHistory(c.id)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fecaca', cursor: 'pointer', fontSize: 12,
                    padding: '4px 8px', borderRadius: 8,
                  }}
                  aria-label="Delete conversation"
                >Delete</button>
              </div>
            )
          })}
        </div>
      )}

      {/* User-facing Buy-credits modal — centered overlay with the
          three standard packages (starter / standard / pro). Clicking
          a package creates a Stripe Checkout session and redirects to
          Stripe's hosted page (3DS + VAT + chargebacks handled by
          Stripe). iOS users get PWA install instructions at the
          bottom since Safari has no beforeinstallprompt event. */}
      {buyOpen && (
        <div
          onClick={(e) => { e.stopPropagation(); setBuyOpen(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(3, 4, 10, 0.78)',
            backdropFilter: 'blur(14px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 30, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 96vw)',
              maxHeight: '90vh', overflowY: 'auto',
              background: 'rgba(14, 11, 26, 0.96)',
              borderRadius: 20,
              border: '1px solid rgba(167, 139, 250, 0.25)',
              padding: '22px 22px 26px 22px',
              color: '#ede9fe',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 14,
            }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.55, letterSpacing: '0.15em', marginBottom: 4 }}>
                  KELION CREDITS
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Buy credits</div>
              </div>
              <button
                onClick={() => setBuyOpen(false)}
                style={{
                  background: 'transparent', border: 'none', color: '#ede9fe',
                  fontSize: 22, cursor: 'pointer', opacity: 0.7,
                }}
                aria-label="Close"
              >?</button>
            </div>

            {balance != null && (
              <div style={{
                fontSize: 13, opacity: 0.75, marginBottom: 14,
                padding: '8px 12px',
                background: 'rgba(167, 139, 250, 0.08)',
                borderRadius: 10,
              }}>
                Current balance: <strong>{balance} credits</strong>
              </div>
            )}

            {buyError && (
              <div style={{
                fontSize: 13, color: '#fecaca',
                background: 'rgba(80, 14, 14, 0.6)',
                padding: '10px 12px', borderRadius: 10, marginBottom: 12,
              }}>{buyError}</div>
            )}

            <div style={{ display: 'grid', gap: 10 }}>
              {packages.map((pkg) => {
                const amount = (pkg.priceCents / 100).toFixed(2).replace(/\.00$/, '')
                const perCredit = (pkg.priceCents / 100 / pkg.minutes).toFixed(2)
                return (
                  <button
                    key={pkg.id}
                    onClick={() => handleBuy(pkg.id)}
                    disabled={buyBusy}
                    style={{
                      display: 'block', textAlign: 'left', width: '100%',
                      padding: '16px 18px',
                      borderRadius: 14,
                      background: pkg.highlight
                        ? 'linear-gradient(135deg, rgba(167, 139, 250, 0.18), rgba(96, 165, 250, 0.12))'
                        : 'rgba(167, 139, 250, 0.06)',
                      border: pkg.highlight
                        ? '1px solid rgba(167, 139, 250, 0.55)'
                        : '1px solid rgba(167, 139, 250, 0.2)',
                      color: '#ede9fe',
                      cursor: buyBusy ? 'wait' : 'pointer',
                      opacity: buyBusy ? 0.6 : 1,
                      transition: 'transform 0.1s, background 0.15s',
                    }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'baseline',
                      justifyContent: 'space-between', marginBottom: 4,
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{pkg.name}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>£{amount}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {pkg.minutes} credits · £{perCredit}/credit
                    </div>
                    {pkg.description && (
                      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
                        {pkg.description}
                      </div>
                    )}
                  </button>
                )
              })}
              {packages.length === 0 && !buyError && (
                <div style={{ opacity: 0.55, fontSize: 13 }}>Loading packages…</div>
              )}
            </div>

            <div style={{
              fontSize: 11, opacity: 0.5, marginTop: 16, lineHeight: 1.5,
            }}>
              You'll be redirected to Stripe's secure checkout.
              Credits never expire.
            </div>

            {!installed && !installPromptEvent && (
              <div style={{
                marginTop: 16, padding: '10px 12px',
                background: 'rgba(96, 165, 250, 0.08)',
                border: '1px solid rgba(96, 165, 250, 0.25)',
                borderRadius: 10, fontSize: 12, opacity: 0.85,
              }}>
                <strong>Add Kelion to your home screen:</strong>{' '}
                on iPhone, tap the Share button ? <em>Add to Home Screen</em>.
                On Android Chrome, tap ? ? <em>Install app</em>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin-only — live business metrics drawer. */}
      {businessOpen && (
        <div
          onClick={() => setBusinessOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {businessOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(480px, 96vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · BUSINESS — LAST 30 DAYS
            </div>
            <button
              onClick={() => setBusinessOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>
          <AdminTabBar active="business" onSelect={switchAdminTab} />

          {businessLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Crunching numbers…</div>
          )}
          {businessError && !businessLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10,
            }}>{businessError}</div>
          )}

          {!businessLoading && businessData && (() => {
            const revenueGbp = (businessData.ledger.revenueCents / 100).toFixed(2)
            // 50/50 split: half goes to AI vendors, half to us. This is a
            // gross estimate — actual AI spend is visible on the provider
            // cards. Stripe/tax fees will trim our half ~3%.
            const platformEstGbp = (businessData.ledger.revenueCents / 200).toFixed(2)
            const minutesSold = businessData.ledger.minutesSold
            const minutesConsumed = businessData.ledger.minutesConsumed
            const topups = businessData.ledger.topups
            const rows = [
              { label: 'Credit top-ups', value: topups, hint: 'Stripe Checkout sessions completed' },
              { label: 'Gross revenue', value: `£${revenueGbp}`, hint: 'Sum of paid Stripe sessions' },
              { label: 'Minutes sold', value: `${minutesSold} min`, hint: 'Credits granted to users' },
              { label: 'Minutes consumed', value: `${minutesConsumed} min`, hint: 'Live conversation time used' },
              { label: 'Platform share (est.)', value: `£${platformEstGbp}`, hint: '50% of gross, before Stripe fees' },
            ]
            return (
              <>
                {rows.map((r) => (
                  <div
                    key={r.label}
                    style={{
                      padding: '12px 14px', marginBottom: 8,
                      background: 'rgba(167, 139, 250, 0.06)',
                      border: '1px solid rgba(167, 139, 250, 0.15)',
                      borderRadius: 12,
                    }}
                  >
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}>
                      <div style={{ fontSize: 13, opacity: 0.75 }}>{r.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{r.value}</div>
                    </div>
                    {r.hint && (
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{r.hint}</div>
                    )}
                  </div>
                ))}
                {businessData.stripe && (
                  <div style={{
                    padding: '12px 14px', marginTop: 10,
                    background: 'rgba(96, 165, 250, 0.06)',
                    border: '1px solid rgba(96, 165, 250, 0.25)',
                    borderRadius: 12,
                  }}>
                    <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.1em', marginBottom: 6 }}>
                      STRIPE BALANCE
                    </div>
                    <div style={{ fontSize: 15 }}>
                      {businessData.stripe.balanceDisplay || '—'}
                    </div>
                    {businessData.stripe.message && (
                      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                        {businessData.stripe.message}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Admin-only — AI credits dashboard drawer. One card per provider
          showing real balance (where the provider exposes it) or a
          "configured" signal + a top-up link that deep-links into the
          provider's billing console. Clicking a card opens the top-up
          page in a new tab. */}
      {creditsOpen && (
        <div
          onClick={() => setCreditsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {creditsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(480px, 96vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · AI CREDITS
            </div>
            <button
              onClick={() => setCreditsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>
          <AdminTabBar active="ai" onSelect={switchAdminTab} />

          {creditsLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Fetching provider balances…</div>
          )}
          {creditsError && !creditsLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            }}>{creditsError}</div>
          )}

          {/* Revenue-split panel — shows how much of the last 30 days of
              top-up revenue is earmarked for AI provider spend vs owner
              net, and compares against the known portion of that spend
              (ElevenLabs via API; Gemini is manual). Renders above the
              provider cards so the admin sees the budget context first.
              */}
          {revenueSplitLoading && (
            <div style={{
              marginBottom: 16, padding: '12px 14px',
              borderRadius: 12, border: '1px solid rgba(167, 139, 250, 0.25)',
              background: 'rgba(167, 139, 250, 0.05)',
              fontSize: 12, opacity: 0.6,
            }}>Computing revenue split…</div>
          )}
          {!revenueSplitLoading && revenueSplitError && (
            <div style={{
              marginBottom: 16, padding: '10px 12px',
              borderRadius: 10, background: 'rgba(80, 14, 14, 0.6)',
              color: '#fecaca', fontSize: 12,
            }}>Revenue split: {revenueSplitError}</div>
          )}
          {!revenueSplitLoading && revenueSplit && (() => {
            const pct = Math.round((revenueSplit.fraction || 0.5) * 100)
            const deltaStatus = revenueSplit.delta?.status || 'ok'
            const deltaPalette = {
              ok:   { bg: 'rgba(34, 197, 94, 0.10)',  border: 'rgba(34, 197, 94, 0.45)',  text: '#bbf7d0' },
              warn: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.5)',  text: '#fde68a' },
              over: { bg: 'rgba(239, 68, 68, 0.12)',  border: 'rgba(239, 68, 68, 0.55)',  text: '#fecaca' },
            }[deltaStatus] || { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.4)', text: '#cbd5e1' }
            const row = (label, value, opts = {}) => (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 10, padding: '4px 0',
                fontSize: 13,
                opacity: opts.dim ? 0.7 : 1,
                fontWeight: opts.bold ? 600 : 400,
              }}>
                <span style={{ opacity: 0.75 }}>{label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: opts.color }}>
                  {value}
                </span>
              </div>
            )
            return (
              <div style={{
                marginBottom: 18,
                padding: '14px 16px',
                borderRadius: 14,
                background: 'rgba(167, 139, 250, 0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Revenue split ({pct}% ? AI)</div>
                  <span style={{
                    fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
                    padding: '3px 8px', borderRadius: 999,
                    background: deltaPalette.bg,
                    color: deltaPalette.text,
                    border: `1px solid ${deltaPalette.border}`,
                  }}>
                    {deltaStatus === 'ok' ? 'IN BUDGET'
                      : deltaStatus === 'warn' ? '80% USED'
                      : 'OVER BUDGET'}
                  </span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 10 }}>
                  Last {revenueSplit.window?.days ?? 30} days · {revenueSplit.revenue?.topups ?? 0} top-ups
                </div>
                {row('Gross revenue', revenueSplit.revenue?.grossDisplay || '—', { bold: true })}
                {row(`AI allocation (${pct}%)`, revenueSplit.allocation?.display || '—', { color: '#c4b5fd' })}
                {row('Owner net', revenueSplit.allocation?.ownerDisplay || '—', { dim: true })}
                <div style={{
                  height: 1, background: 'rgba(167, 139, 250, 0.2)',
                  margin: '8px 0',
                }} />
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Known AI spend (auto-measured):</div>
                {row('  ElevenLabs (est.)',
                  revenueSplit.spend?.elevenlabs?.configured
                    ? (revenueSplit.spend?.elevenlabs?.estSpendDisplay || '—')
                    : 'not configured',
                  { dim: true })}
                {row('  Gemini',
                  'manual — open GCP Billing',
                  { dim: true })}
                <div style={{
                  height: 1, background: 'rgba(167, 139, 250, 0.2)',
                  margin: '8px 0',
                }} />
                {row('Remaining AI budget',
                  revenueSplit.delta?.display || '—',
                  { bold: true, color: deltaPalette.text })}
                <a
                  href="https://console.cloud.google.com/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    fontSize: 11,
                    color: '#c4b5fd',
                    textDecoration: 'none',
                    opacity: 0.8,
                  }}
                >
                  Open GCP Billing dashboard ?
                </a>
              </div>
            )
          })()}

          {/* ----- Grant Credits — refund / comp / promo. Hits
               POST /api/admin/credits/grant. Added on 2026-04-20 so
               Adrian can refund the 33 credits lost by
               contact@kelionai.app in the charge-on-open incident
               without dropping into the browser console. Negative
               minutes = clawback. Every submission creates an
               admin_grant row in the ledger tagged with the admin's
               email for audit. ----- */}
          <div style={{
            marginBottom: 16, padding: 14,
            borderRadius: 14,
            background: 'rgba(34, 197, 94, 0.06)',
            border: '1px solid rgba(34, 197, 94, 0.28)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              Grant credits
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 10 }}>
              Refund, comp or clawback. Minutes = credits (1 min = 1 credit). Negative = remove.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="email"
                placeholder="user email (e.g. contact@kelionai.app)"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                disabled={grantBusy}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(0,0,0,0.28)',
                  color: '#f8fafc',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  placeholder="minutes (e.g. 33)"
                  value={grantMinutes}
                  onChange={(e) => setGrantMinutes(e.target.value)}
                  disabled={grantBusy}
                  style={{
                    flex: '0 0 120px',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.28)',
                    color: '#f8fafc',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="note (optional — visible in ledger)"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  disabled={grantBusy}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.28)',
                    color: '#f8fafc',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={doGrant}
                disabled={grantBusy || !grantEmail.trim() || !grantMinutes}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(34,197,94,0.5)',
                  background: grantBusy ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)',
                  color: '#ecfdf5',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: grantBusy ? 'progress' : 'pointer',
                  opacity: (grantBusy || !grantEmail.trim() || !grantMinutes) ? 0.55 : 1,
                }}
              >
                {grantBusy ? 'Granting…' : 'Grant'}
              </button>
              {grantMessage && (
                <div style={{
                  fontSize: 12,
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: grantMessage.ok
                    ? 'rgba(34, 197, 94, 0.12)'
                    : 'rgba(239, 68, 68, 0.12)',
                  color: grantMessage.ok ? '#bbf7d0' : '#fecaca',
                  border: `1px solid ${grantMessage.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                }}>
                  {grantMessage.text}
                </div>
              )}
            </div>
          </div>

          {/* ----- Live Usage — Adrian: "analiza pe consum credite in timp
               real permanent la toti userii". Flat feed of the most
               recent ledger entries across every user, auto-refreshed
               every 5 s. Added after the 2026-04-20 charge-on-open
               incident so consumption is now observable the moment it
               happens, not post-mortem. ----- */}
          <div style={{
            marginBottom: 16, padding: 14,
            borderRadius: 14,
            background: 'rgba(167, 139, 250, 0.05)',
            border: '1px solid rgba(167, 139, 250, 0.22)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.1 }}>
                Live Usage
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10, opacity: 0.65,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34,197,94,0.9)',
                }} />
                auto-refresh 5 s
              </div>
            </div>
            {ledgerError && (
              <div style={{
                fontSize: 11, color: '#fca5a5',
                padding: '6px 10px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 8,
                marginBottom: 8,
              }}>{ledgerError}</div>
            )}
            {ledgerLoading && ledgerRows.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>Loading ledger…</div>
            )}
            {!ledgerLoading && ledgerRows.length === 0 && !ledgerError && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>No transactions yet.</div>
            )}
            {ledgerRows.length > 0 && (() => {
              // Abuse heuristic: flag any user who burned >5 credits
              // in the last 5 minutes via plain consumption. Clean
              // finish-of-session is 1 credit / 60 s, so >5/5 min
              // means either a bug or tampering — exactly the fraud
              // path that hit user Kelion on 2026-04-20.
              const now = Date.now()
              const windowMs = 5 * 60 * 1000
              const byUser = new Map()
              for (const row of ledgerRows) {
                if (row.kind !== 'consumption') continue
                const ts = row.created_at ? Date.parse(row.created_at) : 0
                if (!ts || now - ts > windowMs) continue
                const key = row.user_email || `user-${row.user_id}`
                const agg = byUser.get(key) || { drained: 0, last: 0 }
                agg.drained += Math.abs(Number(row.delta_minutes) || 0)
                if (ts > agg.last) agg.last = ts
                byUser.set(key, agg)
              }
              const suspects = [...byUser.entries()]
                .filter(([, v]) => v.drained > 5)
                .sort((a, b) => b[1].drained - a[1].drained)
              return (
                <>
                  {suspects.length > 0 && (
                    <div style={{
                      padding: '8px 10px', marginBottom: 10,
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      color: '#fecaca',
                      fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        ? Abnormal drain in last 5 min
                      </div>
                      {suspects.slice(0, 3).map(([who, v]) => (
                        <div key={who} style={{ opacity: 0.9 }}>
                          {who} — {v.drained} credits
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{
                    maxHeight: 220, overflowY: 'auto',
                    borderRadius: 8,
                    background: 'rgba(0, 0, 0, 0.22)',
                  }}>
                    {ledgerRows.slice(0, 30).map((row) => {
                      const delta = Number(row.delta_minutes) || 0
                      const positive = delta > 0
                      const color = positive
                        ? '#bbf7d0'
                        : row.kind === 'admin_grant'
                          ? '#c4b5fd'
                          : '#fecaca'
                      const ts = row.created_at ? new Date(row.created_at) : null
                      const tsLabel = ts
                        ? `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`
                        : ''
                      return (
                        <div key={row.id} style={{
                          display: 'grid',
                          gridTemplateColumns: '60px 1fr 70px 60px',
                          gap: 8, alignItems: 'center',
                          padding: '6px 10px',
                          fontSize: 11,
                          borderBottom: '1px solid rgba(167, 139, 250, 0.08)',
                        }}>
                          <span style={{ opacity: 0.55, fontFamily: 'monospace' }}>{tsLabel}</span>
                          <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.user_email || `user-${row.user_id}`}
                          </span>
                          <span style={{ opacity: 0.65, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.05 }}>
                            {row.kind}
                          </span>
                          <span style={{ color, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' }}>
                            {positive ? '+' : ''}{delta}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>

          {/* PR E2 — auto-topup info strip. Shows the admin at a glance
              whether the saved card is wired, what threshold triggers
              a refill, and when we last ran. Sits above the provider
              cards so the friendly copy on each card is consistent
              with the refill policy. */}
          {!creditsLoading && autoTopupStatus && (() => {
            const s = autoTopupStatus
            const armed = s.configured && s.enabled
            const tone = armed
              ? { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.35)', text: '#bbf7d0' }
              : { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.35)', text: '#fde68a' }
            const thresholdPct = Math.round((s.threshold || 0.2) * 100)
            const lastRunLabel = (() => {
              const hist = s.history || {}
              const entries = Object.entries(hist)
              if (entries.length === 0) return null
              const latest = entries.reduce((a, b) => ((a[1]?.ts || 0) > (b[1]?.ts || 0) ? a : b))
              const [id, e] = latest
              if (!e || !e.ts) return null
              const when = new Date(e.ts).toLocaleString()
              if (e.status === 'ok') {
                return `Ultima reîncarcare: ${id} · ${e.amountEur} ${String(e.currency || 'eur').toUpperCase()} · ${when}`
              }
              return `Ultima încercare: ${id} · e?uata (${e.error || 'eroare necunoscuta'}) · ${when}`
            })()
            return (
              <div style={{
                marginBottom: 14, padding: '12px 14px',
                borderRadius: 12,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                color: tone.text,
                fontSize: 13, lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {armed
                    ? `Auto-topup armat — sub ${thresholdPct}% cardul tau Stripe e taxat cu ${s.amountEur} ${String(s.currency || 'eur').toUpperCase()}.`
                    : 'Auto-topup inactiv — leaga un card salvat în Stripe ca sa activezi.'}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {armed
                    ? `Verificam la fiecare deschidere a panoului. Cooldown ${s.cooldownHours || 24}h ca sa nu se încarce de doua ori. Primim email de confirmare sau eroare.`
                    : 'Seteaza OWNER_STRIPE_CUSTOMER_ID + OWNER_STRIPE_PAYMENT_METHOD_ID în Railway, apoi refresh. Cardul îl salvezi o data în Stripe.'}
                </div>
                {lastRunLabel && (
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                    {lastRunLabel}
                  </div>
                )}
                {!armed && (
                  <a
                    href={s.setupUrl || 'https://dashboard.stripe.com/customers'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block', marginTop: 8,
                      fontSize: 12, color: '#fde68a',
                      textDecoration: 'underline',
                    }}
                  >Deschide Stripe — Customers ?</a>
                )}
              </div>
            )
          })()}

          {!creditsLoading && creditsCards.map((c) => {
            const badge = ({
              ok: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.55)', text: '#bbf7d0', label: 'OK' },
              low: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.55)', text: '#fde68a', label: 'LOW' },
              error: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.55)', text: '#fecaca', label: 'ERROR' },
              // `unconfigured` = opt-in provider (Groq) intentionally left unset.
              // Muted slate styling (not red) so the admin sees the state
              // at-a-glance without thinking something is broken.
              unconfigured: { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.5)', text: '#e2e8f0', label: 'NOT SET' },
              unknown: { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', label: '—' },
            })[c.status] || { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', label: '—' }
            // PR E2 — friendly headline sits above the raw balance so
            // admins scanning the grid read "credit suficient" /
            // "credit aproape terminat" / "cheie lipsa" instead of
            // parsing `123,456 / 500,000 chars` every time.
            const friendly = friendlyCreditStatus(c)
            const headlineColor = ({
              ok: '#bbf7d0', warn: '#fde68a', error: '#fecaca', muted: '#e2e8f0',
            })[friendly.tone] || '#ede9fe'
            return (
              <a
                key={c.id}
                href={c.topUpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  marginBottom: 12,
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'rgba(167, 139, 250, 0.06)',
                  border: `1px solid ${badge.border}`,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.15s, transform 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.12)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.06)' }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                  <span style={{
                    fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
                    padding: '3px 8px', borderRadius: 999,
                    background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
                  }}>{badge.label}</span>
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600,
                  color: headlineColor, marginBottom: friendly.sub ? 2 : 6,
                }}>
                  {friendly.headline}
                </div>
                {friendly.sub && (
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                    {friendly.sub}
                  </div>
                )}
                {c.subtitle && (
                  <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>{c.subtitle}</div>
                )}
                {/* Raw numbers kept small so the admin can cross-check
                    against the provider dashboard without drowning the
                    friendly headline. */}
                {c.balanceDisplay && c.balanceDisplay !== '—' && (
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {c.balanceDisplay}
                  </div>
                )}
                {c.message && c.status !== 'ok' && (
                  <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
                    {c.message}
                  </div>
                )}
                <div style={{
                  fontSize: 11, opacity: 0.55, marginTop: 8,
                  letterSpacing: '0.02em',
                }}>
                  Tap to open {c.kind === 'revenue' ? 'dashboard' : 'top-up'} ?
                </div>
              </a>
            )
          })}

          {!creditsLoading && creditsCards.length === 0 && !creditsError && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>No providers configured.</div>
          )}
        </div>
      )}

      {/* Admin-only — Visitors drawer. Shows one row per SPA page load
          (IP, country, user-agent, referer, path, user email if signed
          in, timestamp). Auto-refresh 10s. Adrian 2026-04-20: "nu vad
          buton vizite reale cine a vizitat situl, ip tara restul
          datelor lor". */}
      {visitorsOpen && (
        <div
          onClick={() => setVisitorsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {visitorsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(640px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · VISITORS
            </div>
            <button
              onClick={() => setVisitorsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>
          <AdminTabBar active="visitors" onSelect={switchAdminTab} />

          {/* PR E4 — advanced analytics block (replaces the old 3-card
              24h header). Chart + country list + device mix + funnel.
              Renders only when the new endpoint returned data; the old
              rows table below is unchanged. */}
          <VisitorsAnalyticsPanel data={visitorsAnalytics} />

          {visitorsLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Loading visitors…</div>
          )}
          {visitorsError && !visitorsLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            }}>{visitorsError}</div>
          )}

          {!visitorsLoading && visitorsRows.length === 0 && !visitorsError && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>
              No visits recorded yet. This panel starts filling up as soon as
              the middleware sees a real HTML page load (not API calls).
            </div>
          )}

          {/* Scrollable list of recent visits. Bots are hidden by
              default per Adrian — only real visitors with as much
              data as we have. UA is parsed into "Chrome 120 ·
              Windows 10/11" instead of dumping the raw UA string. */}
          {!visitorsLoading && visitorsRows.length > 0 && (() => {
            const realRows = visitorsRows.filter((v) => !uaIsBot(v.userAgent))
            const hiddenBots = visitorsRows.length - realRows.length
            return (
              <>
                {hiddenBots > 0 && (
                  <div style={{
                    fontSize: 11, opacity: 0.55, marginBottom: 6,
                    fontStyle: 'italic',
                  }}>
                    {hiddenBots} hit{hiddenBots !== 1 ? '-uri' : ''} de bo?i / scanere ascunse din lista.
                  </div>
                )}
                <div style={{
                  borderRadius: 12,
                  border: '1px solid rgba(167, 139, 250, 0.18)',
                  overflow: 'hidden',
                }}>
                  {realRows.map((v) => {
                    const when = v.ts ? new Date(v.ts) : null
                    const whenShort = when && !Number.isNaN(when.getTime())
                      ? when.toLocaleString('en-GB', { hour12: false })
                      : '—'
                    const browser = uaBrowser(v.userAgent)
                    const os = uaOs(v.userAgent)
                    const ref = refHost(v.referer)
                    return (
                      <div
                        key={v.id}
                        style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid rgba(167, 139, 250, 0.08)',
                          fontSize: 12,
                          lineHeight: 1.45,
                        }}
                      >
                        <div style={{
                          display: 'flex', justifyContent: 'space-between',
                          gap: 10, marginBottom: 2,
                        }}>
                          <div style={{
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontVariantNumeric: 'tabular-nums',
                            opacity: 0.75,
                          }}>{whenShort}</div>
                          <div style={{
                            fontSize: 11, opacity: 0.6, letterSpacing: '0.05em',
                          }}>
                            <span style={{ marginRight: 4 }}>{flagEmoji(v.country)}</span>
                            {v.country || '??'} · {v.ip || '—'}
                          </div>
                        </div>
                        <div style={{ marginBottom: 2 }}>
                          <span style={{ opacity: 0.55, marginRight: 6 }}>path</span>
                          <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                            {v.path || '/'}
                          </span>
                          {v.userEmail && (
                            <span style={{
                              marginLeft: 8, padding: '1px 6px',
                              borderRadius: 6,
                              background: 'rgba(167, 139, 250, 0.15)',
                              fontSize: 11,
                            }}>{v.userEmail}</span>
                          )}
                        </div>
                        <div style={{ opacity: 0.65, fontSize: 11 }}>
                          {browser} · {os}
                          {ref && <span style={{ opacity: 0.7 }}> · ? {ref}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Admin — Users tab. Placeholder panel for now; the unified shell
          gives the tab a permanent home so it doesn't drift around the
          overflow menu, and a future PR will wire up /api/admin/users
          (list, search by email, grant credits, ban, reset password,
          view ledger). Adrian 2026-04-20: "Users list, search email,
          grant credits, ban, reset password, view history". Marked
          "nu acum" for the mutating actions — they land in PR E5. */}
      {usersOpen && (
        <div
          onClick={() => setUsersOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {usersOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(560px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · USERS
            </div>
            <button
              onClick={() => setUsersOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>
          <AdminTabBar active="users" onSelect={switchAdminTab} />

          {/* Search + status filter. Submit search on Enter or blur. */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              value={usersQuery}
              onChange={(e) => setUsersQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') refreshUsersList(usersQuery, usersStatus) }}
              onBlur={() => refreshUsersList(usersQuery, usersStatus)}
              placeholder="Cauta dupa email, nume sau ID…"
              style={{
                flex: '1 1 180px', minWidth: 160,
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', fontSize: 13, outline: 'none',
              }}
            />
            <select
              value={usersStatus}
              onChange={(e) => { setUsersStatus(e.target.value); refreshUsersList(usersQuery, e.target.value) }}
              style={{
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', fontSize: 13, outline: 'none',
              }}
            >
              <option value="all">To?i</option>
              <option value="active">Activi</option>
              <option value="banned">Suspenda?i</option>
              <option value="admin">Admini</option>
            </select>
            <button
              onClick={() => refreshUsersList(usersQuery, usersStatus)}
              disabled={usersLoading}
              style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(167, 139, 250, 0.15)',
                border: '1px solid rgba(167, 139, 250, 0.35)',
                color: '#ede9fe', fontSize: 13, cursor: 'pointer',
                opacity: usersLoading ? 0.5 : 1,
              }}
            >
              {usersLoading ? 'Se încarca…' : 'Reîncarca'}
            </button>
          </div>

          {/* F3 — Duplicate accounts card. Lists every email that has
              more than one user row and offers a "Merge" button per
              peer. Merging moves conversations, credits, memory, etc.
              from the chosen source row into the target and deletes
              the source. The API refuses a merge across different
              emails; the UI also asks for confirmation before firing
              since the action is irreversible. */}
          <div style={{
            padding: '16px',
            background: 'rgba(250, 204, 21, 0.05)',
            border: '1px solid rgba(250, 204, 21, 0.2)',
            borderRadius: 12,
            fontSize: 14,
            lineHeight: 1.5,
            marginBottom: 14,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 10,
            }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                Conturi duplicate
              </div>
              <button
                onClick={refreshDuplicateUsers}
                disabled={dupLoading}
                style={{
                  padding: '5px 10px',
                  background: 'rgba(250, 204, 21, 0.12)',
                  border: '1px solid rgba(250, 204, 21, 0.3)',
                  borderRadius: 6,
                  color: '#fef3c7',
                  fontSize: 11,
                  cursor: dupLoading ? 'wait' : 'pointer',
                  opacity: dupLoading ? 0.6 : 1,
                }}
              >
                {dupLoading ? 'Se verifica…' : 'Reîncarca'}
              </button>
            </div>
            {dupError && (
              <div style={{
                padding: '8px 10px', marginBottom: 8,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 6, fontSize: 12, color: '#fecaca',
              }}>
                {dupError}
              </div>
            )}
            {dupResult && (
              <div style={{
                padding: '8px 10px', marginBottom: 8,
                background: dupResult.ok
                  ? 'rgba(34, 197, 94, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${dupResult.ok
                  ? 'rgba(34, 197, 94, 0.3)'
                  : 'rgba(239, 68, 68, 0.3)'}`,
                borderRadius: 6, fontSize: 12,
                color: dupResult.ok ? '#bbf7d0' : '#fecaca',
              }}>
                {dupResult.ok ? (
                  <>
                    Merge reu?it: user {dupResult.sourceId} ? {dupResult.targetId}
                    {dupResult.email ? ` (${dupResult.email})` : ''}.
                    {Object.keys(dupResult.moved).length > 0 && (
                      <> Mutate: {Object.entries(dupResult.moved)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${k}=${n}`)
                        .join(', ') || '—'}.</>
                    )}
                  </>
                ) : (
                  <>Merge e?uat ({dupResult.sourceId} ? {dupResult.targetId}): {dupResult.error}</>
                )}
              </div>
            )}
            {!dupLoading && !dupError && dupGroups.length === 0 && (
              <div style={{ opacity: 0.75, fontSize: 13 }}>
                Niciun email nu are conturi multiple — totul e curat.
              </div>
            )}
            {dupGroups.map((g) => {
              const canonical = (g.users && g.users[0]) || null
              return (
                <div
                  key={g.email}
                  style={{
                    padding: '10px 12px',
                    marginBottom: 10,
                    background: 'rgba(10, 8, 20, 0.35)',
                    border: '1px solid rgba(167, 139, 250, 0.2)',
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    {g.email}
                    <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 6 }}>
                      · {g.count} conturi
                    </span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 8 }}>
                    Pastram contul cel mai vechi (primul din lista) ca ?inta.
                    Butonul "Merge ? {canonical ? `#${canonical.id}` : '…'}"
                    muta totul de pe peer pe el ?i ?terge peer-ul.
                  </div>
                  {(g.users || []).map((u, idx) => {
                    const isCanonical = canonical && u.id === canonical.id
                    const key = `${u.id}->${canonical && canonical.id}`
                    const busy = dupBusyKey === key
                    return (
                      <div
                        key={u.id}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '6px 8px', marginBottom: 4,
                          background: isCanonical
                            ? 'rgba(34, 197, 94, 0.06)'
                            : 'rgba(255, 255, 255, 0.02)',
                          border: `1px solid ${isCanonical
                            ? 'rgba(34, 197, 94, 0.25)'
                            : 'rgba(167, 139, 250, 0.12)'}`,
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>
                            #{u.id} {u.name ? `· ${u.name}` : ''}
                            {isCanonical && (
                              <span style={{
                                marginLeft: 6, fontSize: 10, fontWeight: 400,
                                color: '#bbf7d0',
                              }}>
                                ? ?inta (se pastreaza)
                              </span>
                            )}
                          </div>
                          <div style={{ opacity: 0.6, fontSize: 11 }}>
                            {u.google_id ? 'Google · ' : ''}
                            {u.password_hash ? 'parola · ' : ''}
                            {u.stripe_customer_id ? 'Stripe · ' : ''}
                            creat {u.created_at ? new Date(u.created_at).toLocaleDateString() : '?'}
                          </div>
                        </div>
                        {!isCanonical && canonical && (
                          <button
                            onClick={() => mergeDuplicateUsers(u.id, canonical.id, g.email)}
                            disabled={busy}
                            style={{
                              padding: '5px 10px',
                              background: busy
                                ? 'rgba(167, 139, 250, 0.1)'
                                : 'rgba(167, 139, 250, 0.18)',
                              border: '1px solid rgba(167, 139, 250, 0.45)',
                              borderRadius: 6,
                              color: '#ede9fe',
                              fontSize: 11,
                              cursor: busy ? 'wait' : 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {busy ? 'Merge…' : `Merge ? #${canonical.id}`}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {usersError && (
            <div style={{
              marginBottom: 10, padding: '10px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 8, fontSize: 13, color: '#fecaca',
            }}>
              {usersError}
            </div>
          )}

          {usersData && (
            <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }}>
              {usersData.total} din {usersData.totalAll} useri
              {usersData.query ? ` · filtrat dupa „${usersData.query}"` : ''}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(usersData?.users || []).map((u) => {
              const isBanned = Boolean(u.banned)
              const isAdminRow = u.role === 'admin'
              return (
                <button
                  key={u.id}
                  onClick={() => loadUserDetail(u.id)}
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    padding: '10px 12px', borderRadius: 10,
                    background: selectedUserId === u.id
                      ? 'rgba(167, 139, 250, 0.15)'
                      : 'rgba(255,255,255,0.04)',
                    border: '1px solid ' + (isBanned
                      ? 'rgba(239, 68, 68, 0.35)'
                      : 'rgba(167, 139, 250, 0.18)'),
                    color: '#ede9fe', fontSize: 13,
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{u.email || '(fara email)'}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                      {Number.isFinite(u.credits_balance_minutes)
                        ? `${u.credits_balance_minutes} min`
                        : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{u.name || '—'}</span>
                    {isAdminRow && <span style={{ color: '#fde68a' }}>admin</span>}
                    {isBanned && <span style={{ color: '#fca5a5' }}>suspendat</span>}
                    {!isBanned && !isAdminRow && <span style={{ opacity: 0.75 }}>activ</span>}
                    <span style={{ opacity: 0.55 }}>· id {String(u.id).slice(0, 10)}</span>
                  </div>
                </button>
              )
            })}
            {usersData && (usersData.users || []).length === 0 && !usersLoading && (
              <div style={{ opacity: 0.6, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                Niciun user pentru filtrul curent.
              </div>
            )}
          </div>

          {/* User detail sub-drawer — overlays the list when a row is
              clicked. Close via "? Înapoi la lista" or by picking
              another row (loadUserDetail replaces state). */}
          {selectedUserId && (
            <div style={{
              marginTop: 16, padding: '14px 14px',
              background: 'rgba(10, 8, 20, 0.6)',
              border: '1px solid rgba(167, 139, 250, 0.3)',
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <button
                  onClick={closeUserDetail}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#c4b5fd', cursor: 'pointer', fontSize: 12,
                  }}
                >? Înapoi la lista</button>
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {selectedUser?.email || selectedUserId}
                </span>
              </div>

              {!selectedUser && (
                <div style={{ opacity: 0.6, fontSize: 13 }}>Se încarca detaliile…</div>
              )}

              {selectedUser && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 12 }}>
                    <div><span style={{ opacity: 0.6 }}>Email: </span>{selectedUser.email}</div>
                    <div><span style={{ opacity: 0.6 }}>Rol: </span>{selectedUser.role}</div>
                    <div><span style={{ opacity: 0.6 }}>Credite: </span>{selectedUser.credits_balance_minutes ?? 0} min</div>
                    <div><span style={{ opacity: 0.6 }}>Status: </span>{selectedUser.banned ? 'Suspendat' : 'Activ'}</div>
                    <div><span style={{ opacity: 0.6 }}>Creat: </span>{selectedUser.created_at?.slice(0, 10) || '—'}</div>
                    <div><span style={{ opacity: 0.6 }}>Tier: </span>{selectedUser.subscription_tier || 'free'}</div>
                  </div>

                  {selectedUser.banned && selectedUser.banned_reason && (
                    <div style={{
                      fontSize: 12, padding: '8px 10px', marginBottom: 10,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 8, color: '#fecaca',
                    }}>
                      Motiv: {selectedUser.banned_reason}
                    </div>
                  )}

                  {selectedResult && (
                    <div style={{
                      fontSize: 12, padding: '8px 10px', marginBottom: 10,
                      background: selectedResult.ok
                        ? 'rgba(34, 197, 94, 0.08)'
                        : 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid ' + (selectedResult.ok
                        ? 'rgba(34, 197, 94, 0.35)'
                        : 'rgba(239, 68, 68, 0.35)'),
                      borderRadius: 8,
                      color: selectedResult.ok ? '#bbf7d0' : '#fecaca',
                    }}>
                      {selectedResult.ok ? selectedResult.message : selectedResult.error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    <button
                      onClick={grantCreditsToSelected}
                      disabled={selectedBusy}
                      style={actionBtnStyle(selectedBusy)}
                    >+/- Credite</button>
                    {selectedUser.banned ? (
                      <button
                        onClick={() => banSelectedUser(false)}
                        disabled={selectedBusy}
                        style={actionBtnStyle(selectedBusy, '#bbf7d0', 'rgba(34,197,94,0.35)')}
                      >Reactiveaza contul</button>
                    ) : (
                      <button
                        onClick={() => banSelectedUser(true)}
                        disabled={selectedBusy || selectedUser.role === 'admin'}
                        style={actionBtnStyle(selectedBusy || selectedUser.role === 'admin', '#fecaca', 'rgba(239,68,68,0.35)')}
                      >Suspenda contul</button>
                    )}
                    <button
                      onClick={resetSelectedPassword}
                      disabled={selectedBusy}
                      style={actionBtnStyle(selectedBusy)}
                    >Reseteaza parola</button>
                  </div>

                  {/* History panel */}
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6, letterSpacing: '0.1em' }}>
                    ISTORIC · ULTIMELE {selectedHistory?.rows?.length || 0} TRANZAC?II
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                    {(selectedHistory?.rows || []).map((row) => (
                      <div key={row.id} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 6,
                        background: 'rgba(255,255,255,0.03)',
                        fontSize: 11,
                      }}>
                        <span style={{ opacity: 0.75 }}>
                          {row.kind} · {row.created_at?.slice(0, 16)?.replace('T', ' ')}
                        </span>
                        <span style={{
                          color: row.delta_minutes >= 0 ? '#bbf7d0' : '#fca5a5',
                          fontWeight: 600,
                        }}>
                          {row.delta_minutes >= 0 ? '+' : ''}{row.delta_minutes} min
                        </span>
                      </div>
                    ))}
                    {(!selectedHistory?.rows || selectedHistory.rows.length === 0) && (
                      <div style={{ opacity: 0.5, fontSize: 12, textAlign: 'center', padding: 10 }}>
                        Fara tranzac?ii.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Admin — Payouts tab. Shows where the owner's half of each
          top-up ends up. Stripe already runs the automatic payout
          schedule (set once in the Stripe Dashboard); this panel is a
          read-only view into what Stripe is about to pay + a link to
          the dashboard. Future iteration (PR E3) will add the 50/50
          ledger split view and an on-demand "Instant payout" button.
          Adrian 2026-04-20: "A pot da cardul unde sa se faca payouut?"
          — answered via the "Set up payout destination" link, which
          deep-links to Stripe's external-account settings. */}
      {payoutsOpen && (
        <div
          onClick={() => setPayoutsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {payoutsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(560px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · PAYOUTS
            </div>
            <button
              onClick={() => setPayoutsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >?</button>
          </div>
          <AdminTabBar active="payouts" onSelect={switchAdminTab} />

          <div style={{
            padding: '14px 16px',
            background: 'rgba(96, 165, 250, 0.06)',
            border: '1px solid rgba(96, 165, 250, 0.25)',
            borderRadius: 12,
            fontSize: 13, lineHeight: 1.55,
            marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
              Cum ajung banii la tine
            </div>
            <div style={{ opacity: 0.82 }}>
              Stripe varsa automat soldul în contul/ cardul pe care l-ai
              conectat ca "external account". Nu trebuie sa ini?iezi tu
              nimic — odata configurat, fiecare top-up al unui user trece
              prin: Stripe Checkout ? Stripe balance ? payout automat (zilnic
              sau saptamânal, dupa setarea ta). Jumatate din fiecare top-up
              e deja rezervata intern pentru costurile AI (OpenAI, Groq,
              ElevenLabs), cealalta jumatate e profitul net.
            </div>
          </div>

          <a
            href="https://dashboard.stripe.com/settings/payouts"
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '12px 14px',
              marginBottom: 10,
              background: 'rgba(167, 139, 250, 0.12)',
              border: '1px solid rgba(167, 139, 250, 0.35)',
              borderRadius: 12,
              color: '#ede9fe',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Seteaza destina?ia payout-urilor</span>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Stripe ?</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
              Adaugi un IBAN sau un card de debit o singura data. Recomandat:
              Visa/Mastercard Debit (Revolut, Wise, Starling) pentru pla?i
              instant în 30 min.
            </div>
          </a>

          <a
            href="https://dashboard.stripe.com/payouts"
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '12px 14px',
              marginBottom: 10,
              background: 'rgba(167, 139, 250, 0.06)',
              border: '1px solid rgba(167, 139, 250, 0.15)',
              borderRadius: 12,
              color: '#ede9fe',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Istoric payout-uri</span>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Stripe ?</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
              Fiecare plata catre banca/cardul tau, cu data ?i suma.
            </div>
          </a>

          <PayoutsPanel
            data={payoutsData}
            loading={payoutsLoading}
            error={payoutsError}
            onInstantPayout={triggerInstantPayout}
            busy={payoutBusy}
            result={payoutResult}
          />
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
        html, body, #root { margin: 0; padding: 0; height: 100%; background: #05060a; overscroll-behavior: none; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}

// Compact pill button used on the top-right action bar. Keeps a consistent
// look with the ? overflow button — an accent ring appears when `active`
// so camera/screen/transcript toggles read as "on".

useGLTF.preload('/kelion-rpm_e27cb94d.glb')

