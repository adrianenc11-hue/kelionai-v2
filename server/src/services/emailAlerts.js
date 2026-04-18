'use strict';

/**
 * Lightweight email alert dispatcher for admin-only notifications
 * (AI credit low-balance, etc.).
 *
 * We don't ship an SMTP client by default — instead we wire up two
 * transport options that can be configured purely via env vars:
 *
 *  1. Resend (https://resend.com) — preferred because it needs only an
 *     API key (RESEND_API_KEY) and accepts JSON. No DKIM setup required
 *     for transactional alerts sent to our own inbox.
 *
 *  2. Generic webhook — POST JSON to ALERT_WEBHOOK_URL. Useful for
 *     Slack/Discord/n8n. The payload mirrors the email body.
 *
 * If neither is set we log to stdout so the alert shows up in Railway
 * logs — still visible, still actionable, just not pushed to email.
 *
 * ALERT_TO defaults to contact@kelionai.app per Adrian's explicit
 * instruction ("sa fie trimis email catre contact@kelionai.app").
 */

const DEFAULT_TO = 'contact@kelionai.app';

async function sendEmailAlert({ subject, text, html, to }) {
  const recipient = to || process.env.ALERT_TO || DEFAULT_TO;
  const payload = {
    to: recipient,
    subject: subject || 'Kelion AI alert',
    text: text || '',
    html: html || undefined,
  };

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.ALERT_FROM || 'alerts@kelionai.app',
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
      });
      if (r.ok) {
        return { ok: true, transport: 'resend' };
      }
      const body = await r.text().catch(() => '');
      console.warn('[alerts/resend] HTTP', r.status, body.slice(0, 200));
    } catch (err) {
      console.warn('[alerts/resend] error:', err && err.message);
    }
  }

  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook) {
    try {
      const r = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        return { ok: true, transport: 'webhook' };
      }
      console.warn('[alerts/webhook] HTTP', r.status);
    } catch (err) {
      console.warn('[alerts/webhook] error:', err && err.message);
    }
  }

  // Last resort: log. Railway captures this; admin can still see it.
  console.log('[alert]', JSON.stringify(payload));
  return { ok: false, transport: 'log' };
}

module.exports = { sendEmailAlert };
