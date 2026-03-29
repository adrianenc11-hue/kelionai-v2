// ═══════════════════════════════════════════════════════════════
// KelionAI — Mailer module
// Supports: Resend (primary), SMTP via Nodemailer (fallback)
// Usage: await sendEmail({ to, subject, html, text })
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

const FROM_NAME  = process.env.EMAIL_FROM_NAME  || 'KelionAI';
const FROM_EMAIL = process.env.EMAIL_FROM_ADDR  || 'noreply@kelionai.com';
const FROM       = `${FROM_NAME} <${FROM_EMAIL}>`;

/**
 * Send a transactional email.
 * Priority: Resend API → Nodemailer SMTP → log-only (dev)
 */
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject) {
    logger.warn({ component: 'Mailer' }, 'sendEmail called without to/subject — skipped');
    return { ok: false, reason: 'missing_params' };
  }

  // ── 1. Resend ──
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:     FROM,
          to:       [to],
          subject,
          html:     html || undefined,
          text:     text || undefined,
          reply_to: replyTo || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        logger.info({ component: 'Mailer', to, subject, id: data.id }, 'Email sent via Resend');
        return { ok: true, provider: 'resend', id: data.id };
      }
      logger.warn({ component: 'Mailer', to, err: data.message }, 'Resend failed, trying SMTP');
    } catch (err) {
      logger.warn({ component: 'Mailer', err: err.message }, 'Resend error, trying SMTP');
    }
  }

  // ── 2. Nodemailer SMTP ──
  if (process.env.SMTP_HOST) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST,
        port:   parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      const info = await transporter.sendMail({
        from:    FROM,
        to,
        subject,
        html:    html || undefined,
        text:    text || undefined,
        replyTo: replyTo || undefined,
      });
      logger.info({ component: 'Mailer', to, subject, msgId: info.messageId }, 'Email sent via SMTP');
      return { ok: true, provider: 'smtp', id: info.messageId };
    } catch (err) {
      logger.error({ component: 'Mailer', err: err.message }, 'SMTP send failed');
    }
  }

  // ── 3. Dev fallback — log only ──
  logger.info(
    { component: 'Mailer', to, subject },
    '[DEV] No email provider configured — email logged only. Set RESEND_API_KEY or SMTP_HOST.'
  );
  return { ok: false, reason: 'no_provider' };
}

/**
 * Send referral invite email to a potential new user.
 */
async function sendReferralInvite({ to, senderName, code, appUrl }) {
  const url = `${appUrl || process.env.APP_URL || 'https://kelionai.com'}/register?ref=${code}`;
  const subject = `${senderName} te invită să încerci KelionAI — 5 zile bonus gratuit! 🎁`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:560px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:1.5rem">🤖 KelionAI — Asistentul tău AI</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">Invitație personală de la ${senderName}</p>
    </div>
    <div style="padding:28px">
      <p>Salut!</p>
      <p><strong>${senderName}</strong> te-a invitat să descoperi <strong>KelionAI</strong> — 
         asistentul AI cu memorie, voce și acces la internet.</p>

      <div style="background:#0f172a;border-radius:8px;padding:20px;margin:24px 0;text-align:center">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:0.85rem">CODUL TĂU DE INVITAȚIE</p>
        <div style="font-size:1.6rem;font-weight:700;letter-spacing:3px;color:#22d3ee;font-family:monospace">${code}</div>
        <p style="margin:8px 0 0;color:#64748b;font-size:0.8rem">Valabil 14 zile</p>
      </div>

      <div style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 8px;font-weight:600;color:#a5b4fc">🎁 Bonus pentru tine:</p>
        <ul style="margin:0;padding-left:20px;color:#cbd5e1">
          <li>5 zile gratuite la primul abonament</li>
          <li>Acces complet la toate funcțiile AI</li>
          <li>Fără card de credit pentru perioada de bonus</li>
        </ul>
      </div>

      <div style="text-align:center;margin:28px 0">
        <a href="${url}" 
           style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;display:inline-block">
          Activează bonusul de 5 zile →
        </a>
      </div>

      <p style="color:#64748b;font-size:0.82rem;text-align:center">
        Sau copiază linkul: <a href="${url}" style="color:#6366f1">${url}</a>
      </p>
    </div>
    <div style="padding:16px;text-align:center;color:#475569;font-size:0.75rem;border-top:1px solid #334155">
      KelionAI · Dacă nu dorești să primești invitații, ignoră acest email.
    </div>
  </div>
</body>
</html>`;

  const text = `${senderName} te invită la KelionAI!\n\nCodul tău: ${code}\nLink: ${url}\n\nBonus: 5 zile gratuite la primul abonament.`;

  return sendEmail({ to, subject, html, text });
}

module.exports = { sendEmail, sendReferralInvite };