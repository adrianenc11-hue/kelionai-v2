// Admin panel components extracted from KelionStage.jsx.
// These are used by the admin dashboard overlay inside the main stage.

function TopBarIconButton({ children, onClick, disabled, active, title, ariaLabel }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        width: 36, height: 36, borderRadius: 999,
        background: active
          ? 'rgba(167, 139, 250, 0.25)'
          : 'rgba(10, 8, 20, 0.5)',
        backdropFilter: 'blur(12px)',
        border: active
          ? '1px solid rgba(167, 139, 250, 0.75)'
          : '1px solid rgba(167, 139, 250, 0.25)',
        color: disabled ? '#6b7280' : '#ede9fe',
        fontSize: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >{children}</button>
  )
}

// Admin shell — single entry point behaves like a dashboard with tabs.
// Each tab maps 1:1 to an existing modal drawer (Business / AI / Visitors)
// or a new placeholder panel (Users / Payouts). The parent component owns
// one open state per tab; this bar only issues `onSelect(key)` and lets
// the parent do the routing so the existing open*() data-fetch helpers
// are reused without duplication.
//
// 2026-04-20 Adrian: "gindeste o structura informationala de admin adevarata,
// un management integrat intru-un singur buton acolo cu subutoane".
const ADMIN_TABS = [
  { key: 'business', label: 'Business', emoji: '💼' },
  { key: 'ai',       label: 'AI',       emoji: '🧠' },
  { key: 'visitors', label: 'Visitors', emoji: '👥' },
  { key: 'users',    label: 'Users',    emoji: '🧑‍🤝‍🧑' },
  { key: 'payouts',  label: 'Payouts',  emoji: '💸' },
];

function AdminTabBar({ active, onSelect }) {
  return (
    <div
      style={{
        display: 'flex', gap: 4, flexWrap: 'wrap',
        marginBottom: 14, paddingBottom: 10,
        borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
      }}
    >
      {ADMIN_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            style={{
              padding: '6px 11px',
              fontSize: 12,
              background: isActive
                ? 'rgba(167, 139, 250, 0.25)'
                : 'rgba(167, 139, 250, 0.06)',
              border: isActive
                ? '1px solid rgba(167, 139, 250, 0.55)'
                : '1px solid rgba(167, 139, 250, 0.12)',
              color: isActive ? '#fff' : 'rgba(237, 233, 254, 0.72)',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: isActive ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 5,
              transition: 'background 0.12s, border-color 0.12s',
            }}
            aria-pressed={isActive}
            aria-label={`Admin tab: ${t.label}`}
          >
            <span aria-hidden="true">{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// PR E4 — Visitors analytics. Replaces the old "super rudimentar"
// top-5 country tally with a 30-day chart, full country list, device
// mix, and login→topup→usage funnel. Renders whatever fields the
// server returned; missing pieces degrade silently instead of
// blanking the whole block.
function flagEmoji(code) {
  // Two-letter ISO country code → Unicode flag emoji. We don't ship a
  // country-code table just to render flags: the emoji is assembled
  // from the two regional-indicator code points.
  if (!code || typeof code !== 'string' || code.length < 2) return ''
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  const base = 0x1f1e6 - 65
  return String.fromCodePoint(base + cc.charCodeAt(0), base + cc.charCodeAt(1))
}

// Client-side UA classifiers. Mirror the server-side ones in
// `server/src/services/visitorAnalytics.js` so the per-visit row in
// the admin table reads "Chrome 120 on Windows" instead of dumping the
// raw UA string. Real-time enrichment, no DB call.
function uaIsBot(ua) {
  if (!ua) return false
  return /bot|crawl|spider|slurp|bing|google|yandex|duckduck|facebookexternalhit|embedly|preview|http[-_ ]?client|python-requests|curl\/|wget|go-http|java\//i.test(ua)
}
function uaBrowser(ua) {
  if (!ua) return 'Unknown'
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\/|Opera/i.test(ua)) return 'Opera'
  if (/Vivaldi/i.test(ua)) return 'Vivaldi'
  if (/Firefox\//i.test(ua)) {
    const m = ua.match(/Firefox\/([0-9]+)/i)
    return m ? `Firefox ${m[1]}` : 'Firefox'
  }
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet'
  if (/Chrome\//i.test(ua)) {
    const m = ua.match(/Chrome\/([0-9]+)/i)
    return m ? `Chrome ${m[1]}` : 'Chrome'
  }
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) {
    const m = ua.match(/Version\/([0-9]+)/i)
    return m ? `Safari ${m[1]}` : 'Safari'
  }
  return 'Other'
}
function uaOs(ua) {
  if (!ua) return 'Unknown'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Android/i.test(ua)) {
    const m = ua.match(/Android ([0-9]+)/i)
    return m ? `Android ${m[1]}` : 'Android'
  }
  if (/Windows NT 10/i.test(ua)) return 'Windows 10/11'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Other'
}
function refHost(ref) {
  if (!ref || typeof ref !== 'string') return null
  try {
    const u = new URL(ref)
    let h = (u.hostname || '').toLowerCase()
    if (h.startsWith('www.')) h = h.slice(4)
    return h || null
  } catch (_) {
    return null
  }
}

function VisitorsAnalyticsPanel({ data }) {
  if (!data) return null
  const totals = data.totals || { visits: 0, signedInVisits: 0, uniqueUsers: 0 }
  const byCountry = Array.isArray(data.byCountry) ? data.byCountry : []
  const byDevice = data.byDevice || {}
  const byBrowser = Array.isArray(data.byBrowser) ? data.byBrowser : []
  const byOs = Array.isArray(data.byOs) ? data.byOs : []
  const topReferrers = Array.isArray(data.topReferrers) ? data.topReferrers : []
  const topPaths = Array.isArray(data.topPaths) ? data.topPaths : []
  const byDay = Array.isArray(data.byDay) ? data.byDay : []
  const funnel = data.funnel || {}
  const bots = data.bots || { count: 0, byCountry: [] }

  // Sparkline path for the 30-day visitors chart. Inline SVG keeps us
  // from pulling a charting dep for one line + a filled area.
  const w = 600, h = 90, pad = 4
  const maxDay = Math.max(1, ...byDay.map((d) => d.count))
  const pts = byDay.map((d, i) => {
    const x = pad + (byDay.length > 1 ? (i / (byDay.length - 1)) * (w - 2 * pad) : w / 2)
    const y = h - pad - ((d.count / maxDay) * (h - 2 * pad))
    return [x, y]
  })
  const linePath = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ')
  const areaPath = pts.length
    ? `${linePath} L${pts[pts.length - 1][0]},${h - pad} L${pts[0][0]},${h - pad} Z`
    : ''

  // Adrian 2026-04-25: "boti nu-i mai afisam, doar reali cu datele lor
  // cit mai complete". Bots are excluded from `byDevice` server-side;
  // the chart reflects only real visitors.
  const deviceOrder = [
    ['desktop', 'Desktop', '#818cf8'],
    ['mobile', 'Mobil', '#f472b6'],
    ['tablet', 'Tabletă', '#34d399'],
    ['unknown', 'Necunoscut', '#64748b'],
  ]
  const deviceTotal = deviceOrder.reduce((a, [k]) => a + (byDevice[k] || 0), 0) || 1

  const funnelSteps = [
    { label: 'Vizite', count: funnel.visits || 0 },
    { label: 'Vizite cu cont logat', count: funnel.signedInVisits || 0 },
    { label: 'Utilizatori unici logați', count: funnel.uniqueSignedInUsers || 0 },
    { label: 'Au făcut top-up', count: funnel.usersWithTopup || 0 },
    { label: 'Au consumat credite', count: funnel.usersWithConsumption || 0 },
  ]
  const funnelMax = Math.max(1, ...funnelSteps.map((s) => s.count))

  const maxCountry = byCountry[0] ? byCountry[0].count : 1
  const topCountries = byCountry.slice(0, 10)

  const card = {
    padding: '12px 14px', borderRadius: 10,
    background: 'rgba(167, 139, 250, 0.06)',
    border: '1px solid rgba(167, 139, 250, 0.2)',
  }
  const label = { fontSize: 10, opacity: 0.6, letterSpacing: '0.1em' }
  const value = { fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      {/* KPI row — last 30 days totals. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        <div style={card}>
          <div style={label}>VIZITE 30Z</div>
          <div style={value}>{totals.visits}</div>
        </div>
        <div style={card}>
          <div style={label}>LOGAȚI</div>
          <div style={value}>{totals.uniqueUsers}</div>
        </div>
        <div style={card}>
          <div style={label}>% LOGAT</div>
          <div style={value}>
            {totals.visits > 0 ? Math.round((totals.signedInVisits * 100) / totals.visits) : 0}%
          </div>
        </div>
      </div>

      {/* 30-day chart */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 4 }}>TRAFIC / ZI · ULTIMELE 30 ZILE</div>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 90 }}>
          {areaPath && <path d={areaPath} fill="rgba(167, 139, 250, 0.25)" />}
          {linePath && <path d={linePath} fill="none" stroke="#a78bfa" strokeWidth="1.5" />}
        </svg>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.5 }}>
          <span>{byDay[0] ? byDay[0].day : ''}</span>
          <span>azi</span>
        </div>
      </div>

      {/* Geografie — full country list (replaces old top-5) */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 6 }}>
          GEOGRAFIE · {byCountry.length} țări
        </div>
        {topCountries.length === 0 ? (
          <div style={{ fontSize: 12, opacity: 0.55 }}>
            Niciun country header primit. Pe Railway nu e CDN geo-header
            (cf-ipcountry); vezi middleware/visitorLog.js.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topCountries.map((c) => (
              <div key={c.country} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 24, fontSize: 16 }}>{flagEmoji(c.country)}</span>
                <span style={{ width: 40, fontFamily: 'ui-monospace, monospace' }}>{c.country}</span>
                <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                  <div style={{
                    height: '100%', width: `${(c.count / maxCountry) * 100}%`,
                    background: '#a78bfa', borderRadius: 3,
                  }} />
                </div>
                <span style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {c.count}
                </span>
              </div>
            ))}
            {byCountry.length > topCountries.length && (
              <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
                + încă {byCountry.length - topCountries.length} țări
              </div>
            )}
          </div>
        )}
      </div>

      {/* Device mix */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 6 }}>DISPOZITIVE</div>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
          {deviceOrder.map(([k, , color]) => {
            const n = byDevice[k] || 0
            if (!n) return null
            return (
              <div key={k} style={{ width: `${(n * 100) / deviceTotal}%`, background: color }} />
            )
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 12 }}>
          {deviceOrder.map(([k, lbl, color]) => (
            <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, background: color, borderRadius: 2, display: 'inline-block' }} />
              {lbl}: <b style={{ fontVariantNumeric: 'tabular-nums' }}>{byDevice[k] || 0}</b>
            </span>
          ))}
        </div>
      </div>

      {/* Browser + OS mix — two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <RankList card={card} label="BROWSER" rows={byBrowser} accent="#a78bfa" />
        <RankList card={card} label="SISTEM" rows={byOs} accent="#f472b6" />
      </div>

      {/* Top referrers + landing paths */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <RankList
          card={card} label="DE UNDE VIN (REFERRERS)"
          rows={topReferrers} accent="#34d399"
          empty="Doar trafic direct (fără referrer header)."
        />
        <RankList
          card={card} label="PAGINI DE INTRARE"
          rows={topPaths} accent="#818cf8"
          empty="Niciun path înregistrat."
        />
      </div>

      {/* Funnel */}
      <div style={card}>
        <div style={{ ...label, marginBottom: 6 }}>CONVERSIE (VIZITĂ → CLIENT)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {funnelSteps.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ flex: '0 0 180px', opacity: 0.8 }}>{s.label}</span>
              <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                <div style={{
                  height: '100%',
                  width: `${(s.count / funnelMax) * 100}%`,
                  background: 'linear-gradient(90deg,#a78bfa,#f472b6)',
                  borderRadius: 4,
                }} />
              </div>
              <span style={{ width: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bots — small footnote, not a primary metric */}
      {bots.count > 0 && (
        <div style={{ ...card, opacity: 0.7 }}>
          <div style={{ ...label, marginBottom: 4 }}>BOȚI / CRAWLERS (excluși din restul calculelor)</div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <b>{bots.count}</b> hit-uri identificate ca scanere / crawlere
            (Googlebot, scanere de vulnerabilități pe `/xmlrpc.php`, etc.)
            în ultimele {data.windowDays || 30} zile. Nu apar în vizite,
            țări, dispozitive sau funnel.
          </div>
        </div>
      )}
    </div>
  )
}

// Reusable bar-chart row list. Used for browser / OS / referrer /
// landing-path widgets so they all look consistent and can fit two
// to a row on the admin grid.
function RankList({ card, label, rows, accent, empty }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const labelStyle = { fontSize: 10, opacity: 0.6, letterSpacing: '0.1em' }
  return (
    <div style={card}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.55 }}>{empty || '—'}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ flex: '0 0 130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.key}
              </span>
              <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                <div style={{
                  height: '100%', width: `${(r.count / max) * 100}%`,
                  background: accent || '#a78bfa', borderRadius: 3,
                }} />
              </div>
              <span style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// PR E3 — Payouts panel. Live Stripe balance + destination + recent
// payouts + 50/50 split over the last 30 days. The server aggregator
// never throws; partial failures come back in `data.errors` and we
// render whatever did load.
function PayoutsPanel({ data, loading, error, onInstantPayout, busy, result }) {
  if (loading && !data) {
    return <div style={{ fontSize: 13, opacity: 0.7, padding: '14px 4px' }}>Se încarcă…</div>
  }
  if (error) {
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px',
        background: 'rgba(248, 113, 113, 0.08)',
        border: '1px solid rgba(248, 113, 113, 0.35)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nu pot încărca payout-urile</div>
        <div style={{ opacity: 0.85 }}>{error}</div>
      </div>
    )
  }
  if (!data) return null
  if (!data.configured) {
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px',
        background: 'rgba(250, 204, 21, 0.08)',
        border: '1px solid rgba(250, 204, 21, 0.35)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Stripe nu e încă legat</div>
        <div style={{ opacity: 0.85 }}>
          Setează STRIPE_SECRET_KEY pe server ca să vezi soldul real aici.
        </div>
      </div>
    )
  }

  const fmt = (bucket) => (bucket && bucket.display) || '—'
  // `buildRevenueSplit` returns { window, fraction, revenue, allocation, ... };
  // the earlier draft guessed the shape and the 50/50 card silently rendered
  // three "—" values on prod. Pull the fields from their real paths.
  const split = data.split || {}
  const days = (split.window && split.window.days) || 30
  const gross = split.revenue && split.revenue.grossDisplay
  const reserved = split.allocation && split.allocation.display
  const profit = split.allocation && split.allocation.ownerDisplay
  const recent = Array.isArray(data.recentPayouts) ? data.recentPayouts : []
  const destination = data.destination
  const canInstant = Boolean(data.instantEligible) && (data.balance && data.balance.instantAvailable && data.balance.instantAvailable.amount > 0)

  return (
    <div>
      {/* Live balance */}
      <div style={{
        marginTop: 4, padding: '14px 16px',
        background: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid rgba(16, 185, 129, 0.25)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Sold Stripe</div>
        <PayoutsRow label="Disponibil acum" value={fmt(data.balance && data.balance.available)} />
        <PayoutsRow label="În tranzit (pending)" value={fmt(data.balance && data.balance.pending)} />
        <PayoutsRow label="Eligibil pentru instant" value={fmt(data.balance && data.balance.instantAvailable)} />
      </div>

      {/* Destination + schedule */}
      {destination && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: 'rgba(96, 165, 250, 0.06)',
          border: '1px solid rgba(96, 165, 250, 0.22)',
          borderRadius: 12, fontSize: 13, lineHeight: 1.55,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Destinație payout</div>
          <PayoutsRow
            label="Tip"
            value={
              destination.type === 'card'
                ? `Card ${destination.brand || ''} •••• ${destination.last4 || '????'}`
                : destination.type === 'bank_account'
                  ? `IBAN •••• ${destination.last4 || '????'} (${destination.country || ''})`
                  : destination.type || 'nesetat'
            }
          />
          <PayoutsRow label="Program" value={formatSchedule(data.schedule)} />
        </div>
      )}

      {/* 50/50 split */}
      <div style={{
        marginTop: 10, padding: '12px 14px',
        background: 'rgba(167, 139, 250, 0.06)',
        border: '1px solid rgba(167, 139, 250, 0.22)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Split 50/50 · ultimele {days} zile</div>
        <PayoutsRow label="Venit brut" value={gross || '—'} />
        <PayoutsRow label="Rezervat pentru AI" value={reserved || '—'} />
        <PayoutsRow label="Profit net (al tău)" value={profit || '—'} bold />
      </div>

      {/* Instant payout CTA */}
      <button
        onClick={onInstantPayout}
        disabled={busy || !canInstant}
        style={{
          marginTop: 10, width: '100%',
          padding: '12px 14px',
          background: canInstant
            ? 'linear-gradient(180deg, rgba(167, 139, 250, 0.32), rgba(139, 92, 246, 0.22))'
            : 'rgba(167, 139, 250, 0.08)',
          color: canInstant ? '#fff' : 'rgba(237, 233, 254, 0.5)',
          border: '1px solid rgba(167, 139, 250, 0.35)',
          borderRadius: 12,
          fontSize: 14, fontWeight: 600,
          cursor: canInstant && !busy ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Trimit…' : canInstant ? 'Instant payout pe card (~30 min, taxa ~1% + 0.25 EUR)' : 'Instant payout indisponibil (nimic eligibil acum)'}
      </button>

      {/* Result of the last trigger */}
      {result && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: result.ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(248, 113, 113, 0.08)',
          border: result.ok ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(248, 113, 113, 0.35)',
          borderRadius: 10, fontSize: 12, lineHeight: 1.5,
        }}>
          {result.ok
            ? `OK — ${result.display} · status ${result.status}${result.arrivalDateMs ? ' · ETA ' + new Date(result.arrivalDateMs).toLocaleString() : ''}`
            : `Eroare: ${result.error}`}
        </div>
      )}

      {/* Recent payouts */}
      {recent.length > 0 && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12, fontSize: 12, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Ultimele payout-uri</div>
          {recent.slice(0, 10).map((p) => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.04)',
              gap: 8,
            }}>
              <span style={{ opacity: 0.72 }}>
                {p.createdMs ? new Date(p.createdMs).toLocaleDateString() : '—'} · {p.method || 'standard'}
              </span>
              <span style={{ textAlign: 'right' }}>
                {p.display || '—'} <span style={{ opacity: 0.55 }}>· {p.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Partial-failure hints (balance loaded but account failed, etc) */}
      {Array.isArray(data.errors) && data.errors.length > 0 && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: 'rgba(250, 204, 21, 0.06)',
          border: '1px solid rgba(250, 204, 21, 0.2)',
          borderRadius: 10, fontSize: 11, lineHeight: 1.5, opacity: 0.85,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Avertismente Stripe</div>
          {data.errors.map((e, i) => (
            <div key={i} style={{ opacity: 0.8 }}>{e.source}: {e.message}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function PayoutsRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  )
}

function formatSchedule(schedule) {
  if (!schedule || !schedule.interval) return '—'
  const { interval, delayDays, monthlyAnchor, weeklyAnchor } = schedule
  if (interval === 'manual') return 'Manual (doar instant)'
  if (interval === 'daily') return `Zilnic (T+${delayDays ?? '?'} zile)`
  if (interval === 'weekly') return `Săptămânal${weeklyAnchor ? ' · ' + weeklyAnchor : ''}`
  if (interval === 'monthly') return `Lunar${monthlyAnchor ? ' · ziua ' + monthlyAnchor : ''}`
  return interval
}

// PR E2 — translate raw provider card state into human-friendly copy
// the admin actually wants to read ("credit suficient ✓" / "credit
// scăzut — reîncarcă aici →" / "cheie lipsă"). The technical message
// and balance string stay as a small secondary line for when the admin
// needs to debug, but the big headline is always in plain Romanian.
//
// Adrian 2026-04-20: "poti schimba stilul de comunicare, la ai ex
// credit suficient, atentie la ai .. x.. trebuie credit".
function friendlyCreditStatus(card) {
  if (!card) return { headline: '—', tone: 'muted', sub: null };
  const isRevenue = card.kind === 'revenue';
  switch (card.status) {
    case 'ok':
      return {
        headline: isRevenue ? 'Venit — în cont' : 'Credit suficient ✓',
        tone: 'ok',
        sub: isRevenue ? 'Banii așteaptă payout-ul automat.' : null,
      };
    case 'low':
      return {
        headline: 'Credit aproape terminat — reîncarcă aici →',
        tone: 'warn',
        sub: 'Atingi cardul ca să deschizi pagina de top-up a providerului.',
      };
    case 'error':
      return {
        headline: 'Problemă cu cheia — deschide providerul →',
        tone: 'error',
        sub: 'Cheia nu răspunde; verifică-o sau rotește-o din dashboard-ul providerului.',
      };
    case 'unconfigured':
      return {
        headline: 'Opțional — nesetat',
        tone: 'muted',
        sub: 'Providerul nu-i obligatoriu; adaugă cheia dacă vrei să-l activezi.',
      };
    default:
      return {
        headline: card.balanceDisplay || 'Stare necunoscută',
        tone: 'muted',
        sub: null,
      };
  }
}

function MenuItem({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%',
        padding: '10px 14px', textAlign: 'left',
        background: 'transparent', border: 'none',
        color: disabled ? '#6b7280' : '#ede9fe',
        fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 8,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = 'rgba(167, 139, 250, 0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >{children}</button>
  )
}


export { TopBarIconButton, AdminTabBar, VisitorsAnalyticsPanel, PayoutsPanel, MenuItem, friendlyCreditStatus, uaIsBot, uaBrowser, uaOs, refHost }
