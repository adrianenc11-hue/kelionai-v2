// ═══════════════════════════════════════════════════════════════
// KelionAI — Alerts Module
// Email notifications + DB persistence for: credit issues, AI status,
// self-healing, critical errors, new users, payments
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger        = require('./logger');
const { sendEmail } = require('./mailer');

const ADMIN_EMAILS = (process.env.ADMIN_EMAIL || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);

const APP_NAME = process.env.APP_NAME || 'KelionAI';
const APP_URL  = process.env.APP_URL  || 'https://kelionai.com';

// ── Deduplication: nu trimite același alert de 2 ori în 1 oră ──
const _sentCache = new Map(); // key → timestamp
const DEDUP_MS   = 60 * 60 * 1000; // 1 oră

function _shouldSend(key) {
  const last = _sentCache.get(key);
  if (last && (Date.now() - last) < DEDUP_MS) return false;
  _sentCache.set(key, Date.now());
  return true;
}

// ── Persistă alerta în DB (non-blocking, silent fail) ──
async function _persistAlert({ pool, alertType, subject, message, recipientEmail, userId, userEmail, status, errorMsg, metadata }) {
  if (!pool) return;
  try {
    // Derive a human-readable message from subject if not provided
    const msgText = message || subject || alertType;
    // Status 'unread' for admin panel display; keep original status in metadata
    const dbStatus = (status === 'sent') ? 'unread' : (status || 'unread');
    await pool.query(
      `INSERT INTO alert_logs
         (alert_type, subject, message, recipient_email, user_id, user_email, status, error_msg, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        alertType,
        subject,
        msgText,
        recipientEmail || ADMIN_EMAILS[0] || null,
        userId    || null,
        userEmail || null,
        dbStatus,
        errorMsg  || null,
        JSON.stringify(metadata || {}),
      ]
    );
  } catch (e) {
    // Fallback: try without message column (older schema)
    try {
      await pool.query(
        `INSERT INTO alert_logs
           (alert_type, subject, recipient_email, user_id, user_email, status, error_msg, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          alertType,
          subject,
          recipientEmail || ADMIN_EMAILS[0] || null,
          userId    || null,
          userEmail || null,
          (status === 'sent') ? 'unread' : (status || 'unread'),
          errorMsg  || null,
          JSON.stringify(metadata || {}),
        ]
      );
    } catch (e2) {
      logger.warn({ component: 'Alerts', err: e2.message }, 'Could not persist alert to DB');
    }
  }
}

// ── Shared email wrapper ──
async function _sendToAdmins({ subject, html, text, dedupeKey, pool, alertType, userId, userEmail, metadata }) {
  if (!ADMIN_EMAILS.length) {
    logger.warn({ component: 'Alerts' }, 'No ADMIN_EMAIL configured — alert skipped');
    await _persistAlert({ pool, alertType, subject, status: 'skipped', errorMsg: 'no_admin_email', userId, userEmail, metadata });
    return { ok: false, reason: 'no_admin_email' };
  }
  if (dedupeKey && !_shouldSend(dedupeKey)) {
    logger.debug({ component: 'Alerts', dedupeKey }, 'Alert deduplicated — skipped');
    // Nu persistăm alertele deduplicate (ar umple DB-ul)
    return { ok: false, reason: 'deduplicated' };
  }

  const results = await Promise.allSettled(
    ADMIN_EMAILS.map(to => sendEmail({ to, subject, html, text }))
  );

  const ok = results.some(r => r.status === 'fulfilled' && r.value?.ok);
  const failedResults = results.filter(r => r.status === 'rejected' || !r.value?.ok);
  const errorMsg = !ok && failedResults[0]
    ? (failedResults[0].reason?.message || 'send_failed')
    : null;

  logger.info({ component: 'Alerts', subject, ok }, 'Admin alert sent');

  // Persistă în DB
  await _persistAlert({
    pool,
    alertType,
    subject,
    recipientEmail: ADMIN_EMAILS.join(', '),
    userId,
    userEmail,
    status: ok ? 'sent' : 'failed',
    errorMsg,
    metadata,
  });

  return { ok };
}

// ── HTML wrapper ──
function _wrap(title, color, body) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:600px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:${color};padding:24px 28px;display:flex;align-items:center;gap:12px">
      <h1 style="margin:0;color:#fff;font-size:1.2rem">${title}</h1>
    </div>
    <div style="padding:24px 28px">
      ${body}
    </div>
    <div style="padding:14px 28px;border-top:1px solid #334155;text-align:center;color:#475569;font-size:0.75rem">
      ${APP_NAME} · <a href="${APP_URL}/admin" style="color:#6366f1">Admin Dashboard</a>
      · <span style="color:#334155">${new Date().toISOString()}</span>
    </div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// 1. CREDIT ALERT — utilizator cu credite scăzute / epuizate
// ─────────────────────────────────────────────────────────────
async function alertCreditLow({ userId, email, creditsLeft, plan, threshold = 10, pool }) {
  const isZero    = creditsLeft <= 0;
  const dedupeKey = `credit:${userId}:${isZero ? 'zero' : 'low'}`;
  const subject   = isZero
    ? `⚠️ [${APP_NAME}] Credite epuizate — ${email}`
    : `🔔 [${APP_NAME}] Credite scăzute (${creditsLeft} rămase) — ${email}`;

  const color = isZero ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'linear-gradient(135deg,#d97706,#b45309)';
  const icon  = isZero ? '🚨' : '⚠️';

  const html = _wrap(
    `${icon} ${isZero ? 'Credite Epuizate' : 'Credite Scăzute'}`,
    color,
    `<table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#94a3b8;width:140px">Utilizator</td><td style="color:#e2e8f0;font-weight:600">${email}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">User ID</td><td style="color:#64748b;font-size:0.85rem;font-family:monospace">${userId}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Credite rămase</td><td style="color:${isZero ? '#f87171' : '#fbbf24'};font-weight:700;font-size:1.1rem">${creditsLeft}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Plan</td><td style="color:#e2e8f0">${plan || 'free'}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Prag alertă</td><td style="color:#e2e8f0">${threshold} credite</td></tr>
    </table>
    <div style="margin-top:20px;padding:14px;background:rgba(99,102,241,0.1);border-radius:8px;border:1px solid rgba(99,102,241,0.2)">
      <p style="margin:0;color:#a5b4fc;font-size:0.9rem">
        ${isZero
          ? '🔴 Utilizatorul nu mai poate folosi serviciile AI. Considerați contactarea pentru upgrade.'
          : `🟡 Utilizatorul se apropie de limita de credite. Pragul de alertă este ${threshold} credite.`}
      </p>
    </div>
    <div style="margin-top:16px;text-align:center">
      <a href="${APP_URL}/admin/users?id=${userId}" 
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">
        Vezi utilizatorul în Admin →
      </a>
    </div>`
  );

  const text = `${subject}\n\nUtilizator: ${email}\nCredite: ${creditsLeft}\nPlan: ${plan || 'free'}\n\nAdmin: ${APP_URL}/admin/users`;
  return _sendToAdmins({
    subject, html, text, dedupeKey, pool,
    alertType: isZero ? 'credit_zero' : 'credit_low',
    userId, userEmail: email,
    metadata: { creditsLeft, plan, threshold },
  });
}

// ─────────────────────────────────────────────────────────────
// 2. AI STATUS ALERT — provider AI down / erori repetate
// ─────────────────────────────────────────────────────────────
async function alertAIStatus({ provider, status, errorRate, lastError, affectedUsers = 0, pool }) {
  const isDown    = status === 'down' || errorRate > 0.5;
  const dedupeKey = `ai:${provider}:${isDown ? 'down' : 'degraded'}`;
  const subject   = isDown
    ? `🔴 [${APP_NAME}] AI Provider DOWN — ${provider}`
    : `🟡 [${APP_NAME}] AI Provider degradat — ${provider} (${Math.round(errorRate * 100)}% erori)`;

  const color = isDown
    ? 'linear-gradient(135deg,#dc2626,#b91c1c)'
    : 'linear-gradient(135deg,#d97706,#b45309)';

  const html = _wrap(
    `${isDown ? '🔴 Provider Down' : '🟡 Provider Degradat'}: ${provider}`,
    color,
    `<table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#94a3b8;width:160px">Provider</td><td style="color:#e2e8f0;font-weight:600;text-transform:uppercase">${provider}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Status</td>
          <td style="color:${isDown ? '#f87171' : '#fbbf24'};font-weight:700">${isDown ? '🔴 DOWN' : '🟡 DEGRADED'}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Rata de erori</td><td style="color:#e2e8f0">${Math.round((errorRate || 0) * 100)}%</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Utilizatori afectați</td><td style="color:#e2e8f0">${affectedUsers}</td></tr>
      ${lastError ? `<tr><td style="padding:8px 0;color:#94a3b8;vertical-align:top">Ultima eroare</td>
          <td style="color:#f87171;font-size:0.82rem;font-family:monospace;word-break:break-all">${lastError}</td></tr>` : ''}
    </table>
    <div style="margin-top:20px;padding:14px;background:rgba(220,38,38,0.1);border-radius:8px;border:1px solid rgba(220,38,38,0.2)">
      <p style="margin:0;color:#fca5a5;font-size:0.9rem">
        ${isDown
          ? '🔴 Sistemul a comutat automat pe provider-ul de backup. Verificați cheia API și statusul provider-ului.'
          : '🟡 Provider-ul funcționează parțial. Monitorizați situația.'}
      </p>
    </div>
    <div style="margin-top:16px;text-align:center">
      <a href="${APP_URL}/admin" 
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">
        Deschide Admin Dashboard →
      </a>
    </div>`
  );

  const text = `${subject}\n\nProvider: ${provider}\nStatus: ${status}\nRata erori: ${Math.round((errorRate || 0) * 100)}%\nUtilizatori afectați: ${affectedUsers}\n${lastError ? `Eroare: ${lastError}\n` : ''}\nAdmin: ${APP_URL}/admin`;
  return _sendToAdmins({
    subject, html, text, dedupeKey, pool,
    alertType: isDown ? 'ai_down' : 'ai_degraded',
    metadata: { provider, status, errorRate, affectedUsers, lastError },
  });
}

// ─────────────────────────────────────────────────────────────
// 4. CRITICAL ERROR ALERT — eroare fatală server
// ─────────────────────────────────────────────────────────────
async function alertCriticalError({ component, error, stack, context = {}, pool }) {
  const dedupeKey = `error:${component}:${error?.slice(0, 40)}`;
  const subject   = `🚨 [${APP_NAME}] Eroare critică — ${component}`;

  const html = _wrap(
    `🚨 Eroare Critică: ${component}`,
    'linear-gradient(135deg,#dc2626,#7f1d1d)',
    `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="padding:8px 0;color:#94a3b8;width:140px">Componentă</td><td style="color:#f87171;font-weight:600">${component}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Eroare</td><td style="color:#fca5a5;font-size:0.9rem">${error}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Timp</td><td style="color:#64748b;font-size:0.85rem">${new Date().toISOString()}</td></tr>
    </table>
    ${stack ? `<div style="background:#0f172a;border-radius:8px;padding:14px;margin-bottom:16px;overflow-x:auto">
      <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;text-transform:uppercase">Stack Trace</p>
      <pre style="margin:0;color:#f87171;font-size:0.75rem;font-family:monospace;white-space:pre-wrap;word-break:break-all">${stack.slice(0, 1000)}</pre>
    </div>` : ''}
    ${Object.keys(context).length > 0 ? `<div style="background:#0f172a;border-radius:8px;padding:14px">
      <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;text-transform:uppercase">Context</p>
      <pre style="margin:0;color:#94a3b8;font-size:0.75rem;font-family:monospace">${JSON.stringify(context, null, 2).slice(0, 500)}</pre>
    </div>` : ''}
    <div style="margin-top:20px;text-align:center">
      <a href="${APP_URL}/admin" 
         style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">
        Verifică Admin Dashboard →
      </a>
    </div>`
  );

  const text = `${subject}\n\nComponentă: ${component}\nEroare: ${error}\n\nAdmin: ${APP_URL}/admin`;
  return _sendToAdmins({
    subject, html, text, dedupeKey, pool,
    alertType: 'critical_error',
    metadata: { component, error: error?.slice(0, 200), hasStack: !!stack },
  });
}

// ─────────────────────────────────────────────────────────────
// 5. NEW USER ALERT — utilizator nou înregistrat
// ─────────────────────────────────────────────────────────────
async function alertNewUser({ userId, email, plan, referredBy, pool }) {
  const subject = `👤 [${APP_NAME}] Utilizator nou: ${email}`;
  const html = _wrap(
    '👤 Utilizator Nou Înregistrat',
    'linear-gradient(135deg,#059669,#047857)',
    `<table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#94a3b8;width:140px">Email</td><td style="color:#e2e8f0;font-weight:600">${email}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">User ID</td><td style="color:#64748b;font-size:0.85rem;font-family:monospace">${userId}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Plan</td><td style="color:#e2e8f0">${plan || 'free'}</td></tr>
      ${referredBy ? `<tr><td style="padding:8px 0;color:#94a3b8">Referit de</td><td style="color:#22d3ee">${referredBy}</td></tr>` : ''}
      <tr><td style="padding:8px 0;color:#94a3b8">Data</td><td style="color:#64748b">${new Date().toLocaleString('ro-RO')}</td></tr>
    </table>
    <div style="margin-top:16px;text-align:center">
      <a href="${APP_URL}/admin/users?id=${userId}" 
         style="background:linear-gradient(135deg,#059669,#047857);color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">
        Vezi utilizatorul →
      </a>
    </div>`
  );
  const text = `Utilizator nou: ${email}\nPlan: ${plan || 'free'}\n${referredBy ? `Referit de: ${referredBy}\n` : ''}\nAdmin: ${APP_URL}/admin/users`;
  // No dedup for new users
  return _sendToAdmins({
    subject, html, text, pool,
    alertType: 'new_user',
    userId, userEmail: email,
    metadata: { plan, referredBy: referredBy || null },
  });
}

// ─────────────────────────────────────────────────────────────
// 6. PAYMENT ALERT — plată reușită sau eșuată
// ─────────────────────────────────────────────────────────────
async function alertPayment({ userId, email, amount, currency = 'USD', plan, status, stripeId, pool }) {
  const isSuccess = status === 'succeeded' || status === 'paid';
  const subject   = isSuccess
    ? `💳 [${APP_NAME}] Plată reușită — ${email} (${amount} ${currency.toUpperCase()})`
    : `❌ [${APP_NAME}] Plată eșuată — ${email}`;

  const color = isSuccess
    ? 'linear-gradient(135deg,#059669,#047857)'
    : 'linear-gradient(135deg,#dc2626,#b91c1c)';

  const html = _wrap(
    `${isSuccess ? '💳 Plată Reușită' : '❌ Plată Eșuată'}`,
    color,
    `<table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#94a3b8;width:140px">Email</td><td style="color:#e2e8f0;font-weight:600">${email}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Sumă</td><td style="color:${isSuccess ? '#22c55e' : '#f87171'};font-weight:700;font-size:1.1rem">${amount} ${currency.toUpperCase()}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Plan</td><td style="color:#e2e8f0">${plan || '-'}</td></tr>
      <tr><td style="padding:8px 0;color:#94a3b8">Status</td><td style="color:${isSuccess ? '#22c55e' : '#f87171'};font-weight:600">${status}</td></tr>
      ${stripeId ? `<tr><td style="padding:8px 0;color:#94a3b8">Stripe ID</td><td style="color:#64748b;font-size:0.8rem;font-family:monospace">${stripeId}</td></tr>` : ''}
    </table>
    <div style="margin-top:16px;text-align:center">
      <a href="${APP_URL}/admin/billing" 
         style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:0.9rem;display:inline-block">
        Vezi Billing Dashboard →
      </a>
    </div>`
  );
  const text = `${subject}\n\nEmail: ${email}\nSumă: ${amount} ${currency.toUpperCase()}\nPlan: ${plan || '-'}\nStatus: ${status}\n\nAdmin: ${APP_URL}/admin/billing`;
  return _sendToAdmins({
    subject, html, text, pool,
    alertType: isSuccess ? 'payment_success' : 'payment_failed',
    userId, userEmail: email,
    metadata: { amount, currency, plan, status, stripeId: stripeId || null },
  });
}

module.exports = {
  alertCreditLow,
  alertAIStatus,
  alertCriticalError,
  alertNewUser,
  alertPayment,
};