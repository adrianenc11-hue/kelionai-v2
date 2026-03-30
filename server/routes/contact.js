// ═══════════════════════════════════════════════════════════════
// KelionAI — Contact System (/api/contact/*)
//
// POST /send          — trimite mesaj + auto-reply user + notif admin
// GET  /inbox         — admin: inbox mesaje primite
// PUT  /inbox/:id/reply — admin: răspunde la mesaj
// PUT  /inbox/:id/read  — admin: marchează ca citit
// DELETE /inbox/:id   — admin: șterge mesaj
// GET  /inbox/:id     — admin: detalii mesaj
// ═══════════════════════════════════════════════════════════════
'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const logger    = require('../logger');
const { sendEmail } = require('../mailer');

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many messages. Please wait 15 minutes.' },
});

// ── Departments config ──
const DEPARTMENTS = {
  Commercial:  { email: process.env.CONTACT_EMAIL_COMMERCIAL || process.env.ADMIN_EMAIL, label: 'Commercial' },
  Technical:   { email: process.env.CONTACT_EMAIL_TECH       || process.env.ADMIN_EMAIL, label: 'Technical Support' },
  Support:     { email: process.env.CONTACT_EMAIL_SUPPORT    || process.env.ADMIN_EMAIL, label: 'General Support' },
  Billing:     { email: process.env.CONTACT_EMAIL_BILLING    || process.env.ADMIN_EMAIL, label: 'Billing & Payments' },
  Partnership: { email: process.env.CONTACT_EMAIL            || process.env.ADMIN_EMAIL, label: 'Partnerships' },
  Other:       { email: process.env.ADMIN_EMAIL,                                         label: 'General' },
};

function genRef() {
  return 'KEL-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// POST /api/contact/send
// ─────────────────────────────────────────────────────────────
router.post('/send', contactLimiter, async (req, res) => {
  try {
    const { name, email, subject, message, department = 'Support', phone, priority = 'normal' } = req.body;

    if (!email || !message || !name) {
      return res.status(400).json({ error: 'Name, email and message are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (message.trim().length < 10) {
      return res.status(400).json({ error: 'Message too short (min 10 characters).' });
    }

    const refNumber = genRef();
    const dept      = DEPARTMENTS[department] || DEPARTMENTS.Support;
    const now       = new Date();
    const { supabaseAdmin } = req.app.locals;

    // ── Save to DB ──
    let contactId = null;
    if (supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin.from('contact_messages').insert({
          ref_number:  refNumber,
          name:        name.trim(),
          email:       email.trim().toLowerCase(),
          subject:     (subject || '').trim() || `[${department}] Contact`,
          message:     message.trim(),
          department,
          phone:       phone || null,
          priority,
          status:      'unread',
          ip:          req.ip,
          user_agent:  req.headers['user-agent']?.slice(0, 200),
        }).select('id').single();
        contactId = data?.id;
      } catch (dbErr) {
        logger.warn({ component: 'Contact', err: dbErr.message }, 'DB save failed (non-fatal)');
      }
    }

    // ── Auto-reply to user ──
    const autoReplyResult = await sendEmail({
      to:      email,
      subject: `✅ Am primit mesajul tău — Ref: ${refNumber}`,
      html:    buildAutoReplyEmail(name, refNumber, department, message, now),
      replyTo: dept.email || process.env.ADMIN_EMAIL,
    });

    // ── Notify admin ──
    const adminEmail = dept.email || process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await sendEmail({
        to:      adminEmail,
        subject: `📬 [${department}] Mesaj nou de la ${name} — ${refNumber}`,
        html:    buildAdminNotifEmail(name, email, subject, message, department, refNumber, phone, priority, contactId),
        replyTo: email,
      }).catch(() => {});
    }

    logger.info({ component: 'Contact', refNumber, email, department }, 'Contact message sent');

    return res.json({
      success: true,
      autoReply: {
        refNumber,
        department: dept.label,
        body: `Dragă ${name}, am primit mesajul tău (Ref: ${refNumber}) și îți vom răspunde în cel mai scurt timp. Departamentul ${dept.label} va prelua solicitarea ta.`,
        emailSent: autoReplyResult.ok,
      },
    });
  } catch (err) {
    logger.error({ component: 'Contact', err: err.message }, 'POST /send failed');
    return res.status(500).json({ error: 'Failed to send message. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/contact/inbox — Admin: lista mesaje
// ─────────────────────────────────────────────────────────────
router.get('/inbox', async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const user = await getUserFromToken(req).catch(() => null);
    if (!user || (user.email !== process.env.ADMIN_EMAIL && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { status, department, priority, search, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('contact_messages')
      .select('id, ref_number, name, email, subject, department, priority, status, created_at, replied_at')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status)     query = query.eq('status', status);
    if (department) query = query.eq('department', department);
    if (priority)   query = query.eq('priority', priority);
    if (search)     query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,subject.ilike.%${search}%`);

    const { data: messages, error } = await query;
    if (error) throw error;

    const { count: unread } = await supabaseAdmin
      .from('contact_messages')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'unread');

    return res.json({ messages: messages || [], unread: unread || 0 });
  } catch (err) {
    logger.error({ component: 'Contact', err: err.message }, 'GET /inbox failed');
    return res.status(500).json({ error: 'Failed to fetch inbox' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/contact/inbox/:id — Admin: detalii mesaj
// ─────────────────────────────────────────────────────────────
router.get('/inbox/:id', async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });
    const user = await getUserFromToken(req).catch(() => null);
    if (!user || (user.email !== process.env.ADMIN_EMAIL && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { data, error } = await supabaseAdmin
      .from('contact_messages')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Message not found' });

    // Mark as read
    if (data.status === 'unread') {
      await supabaseAdmin.from('contact_messages').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', req.params.id);
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/contact/inbox/:id/reply — Admin: răspunde la mesaj
// ─────────────────────────────────────────────────────────────
router.put('/inbox/:id/reply', async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });
    const user = await getUserFromToken(req).catch(() => null);
    if (!user || (user.email !== process.env.ADMIN_EMAIL && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { replyText } = req.body;
    if (!replyText || replyText.trim().length < 5) {
      return res.status(400).json({ error: 'Reply text required (min 5 chars)' });
    }

    const { data: msg } = await supabaseAdmin.from('contact_messages').select('*').eq('id', req.params.id).single();
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    // Send reply email
    const mailResult = await sendEmail({
      to:      msg.email,
      subject: `Re: ${msg.subject || 'Mesajul tău'} — Ref: ${msg.ref_number}`,
      html:    buildAdminReplyEmail(msg.name, replyText, msg.message, msg.ref_number),
      replyTo: process.env.ADMIN_EMAIL,
    });

    // Update DB
    await supabaseAdmin.from('contact_messages').update({
      status:     'replied',
      reply_text: replyText.trim(),
      replied_at: new Date().toISOString(),
      replied_by: user.email,
    }).eq('id', req.params.id);

    logger.info({ component: 'Contact', msgId: req.params.id, to: msg.email }, 'Admin reply sent');
    return res.json({ success: true, emailSent: mailResult.ok });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/contact/inbox/:id/read — Marchează ca citit
// ─────────────────────────────────────────────────────────────
router.put('/inbox/:id/read', async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });
    const user = await getUserFromToken(req).catch(() => null);
    if (!user || (user.email !== process.env.ADMIN_EMAIL && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await supabaseAdmin.from('contact_messages').update({ status: 'read', read_at: new Date().toISOString() }).eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/contact/inbox/:id
// ─────────────────────────────────────────────────────────────
router.delete('/inbox/:id', async (req, res) => {
  try {
    const { supabaseAdmin, getUserFromToken } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });
    const user = await getUserFromToken(req).catch(() => null);
    if (!user || (user.email !== process.env.ADMIN_EMAIL && user.role !== 'admin')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    await supabaseAdmin.from('contact_messages').delete().eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Email Templates
// ═══════════════════════════════════════════════════════════════

function buildAutoReplyEmail(name, refNumber, department, originalMessage, date) {
  const appName = process.env.APP_NAME || 'KelionAI';
  const appUrl  = process.env.APP_URL  || 'https://kelionai.com';
  const dateStr = date.toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:580px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center">
      <div style="font-size:2rem;margin-bottom:8px">✉️</div>
      <h1 style="margin:0;color:#fff;font-size:1.4rem">${appName}</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:0.9rem">Am primit mesajul tău</p>
    </div>
    <div style="padding:28px">
      <p>Dragă <strong>${name}</strong>,</p>
      <p>Îți mulțumim că ne-ai contactat. Am primit mesajul tău și echipa noastră îl va analiza cu atenție.</p>

      <div style="background:#0f172a;border-radius:8px;padding:16px;margin:20px 0;border-left:3px solid #6366f1">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px">DETALII CERERE</p>
        <p style="margin:4px 0"><strong>Număr referință:</strong> <code style="background:#1e293b;padding:2px 6px;border-radius:4px;color:#22d3ee">${refNumber}</code></p>
        <p style="margin:4px 0"><strong>Departament:</strong> ${department}</p>
        <p style="margin:4px 0"><strong>Data:</strong> ${dateStr}</p>
      </div>

      <div style="background:#0f172a;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px">MESAJUL TĂU</p>
        <p style="margin:0;color:#cbd5e1;font-style:italic;line-height:1.6">"${originalMessage.slice(0, 300)}${originalMessage.length > 300 ? '...' : ''}"</p>
      </div>

      <p>⏱️ <strong>Timp de răspuns estimat:</strong> 24-48 ore lucrătoare</p>
      <p style="color:#94a3b8;font-size:0.85rem">Păstrează numărul de referință <strong>${refNumber}</strong> pentru orice urmărire ulterioară.</p>

      <div style="text-align:center;margin-top:24px">
        <a href="${appUrl}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">
          Vizitează ${appName} →
        </a>
      </div>
    </div>
    <div style="padding:16px;text-align:center;color:#475569;font-size:0.75rem;border-top:1px solid #334155">
      ${appName} · <a href="${appUrl}" style="color:#6366f1">${appUrl}</a>
    </div>
  </div>
</body></html>`;
}

function buildAdminNotifEmail(name, email, subject, message, department, refNumber, phone, priority, contactId) {
  const priorityColor = priority === 'urgent' ? '#ef4444' : priority === 'high' ? '#f97316' : '#22d3ee';
  const adminUrl = process.env.APP_URL ? `${process.env.APP_URL}/admin` : '#';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:580px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:#1e293b;padding:20px 28px;border-bottom:1px solid #334155;display:flex;align-items:center;gap:12px">
      <div style="background:${priorityColor};color:#fff;padding:4px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;text-transform:uppercase">${priority}</div>
      <div style="color:#94a3b8;font-size:0.85rem">📬 Mesaj nou — ${department}</div>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#94a3b8;font-size:0.85rem;width:120px">De la:</td><td style="padding:6px 0"><strong>${name}</strong> &lt;${email}&gt;</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;font-size:0.85rem">Referință:</td><td style="padding:6px 0"><code style="background:#0f172a;padding:2px 6px;border-radius:4px;color:#22d3ee">${refNumber}</code></td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;font-size:0.85rem">Subiect:</td><td style="padding:6px 0">${subject || '—'}</td></tr>
        <tr><td style="padding:6px 0;color:#94a3b8;font-size:0.85rem">Departament:</td><td style="padding:6px 0">${department}</td></tr>
        ${phone ? `<tr><td style="padding:6px 0;color:#94a3b8;font-size:0.85rem">Telefon:</td><td style="padding:6px 0">${phone}</td></tr>` : ''}
      </table>

      <div style="background:#0f172a;border-radius:8px;padding:16px;margin:20px 0;border-left:3px solid #6366f1">
        <p style="margin:0 0 8px;color:#94a3b8;font-size:0.8rem;text-transform:uppercase;letter-spacing:1px">MESAJ</p>
        <p style="margin:0;line-height:1.7;white-space:pre-wrap">${message}</p>
      </div>

      <div style="text-align:center;margin-top:20px;display:flex;gap:12px;justify-content:center">
        <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject || 'Mesajul tău')} — Ref: ${refNumber}" 
           style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem">
          ↩ Răspunde direct
        </a>
        <a href="${adminUrl}#contact" 
           style="background:#334155;color:#e2e8f0;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem">
          📋 Admin Panel
        </a>
      </div>
    </div>
  </div>
</body></html>`;
}

function buildAdminReplyEmail(name, replyText, originalMessage, refNumber) {
  const appName = process.env.APP_NAME || 'KelionAI';
  const appUrl  = process.env.APP_URL  || 'https://kelionai.com';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:system-ui,sans-serif;color:#e2e8f0">
  <div style="max-width:580px;margin:40px auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155">
    <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:1.3rem">Răspuns de la ${appName}</h1>
      <p style="color:rgba(255,255,255,0.8);margin:6px 0 0;font-size:0.85rem">Ref: ${refNumber}</p>
    </div>
    <div style="padding:28px">
      <p>Dragă <strong>${name}</strong>,</p>
      <div style="background:#0f172a;border-radius:8px;padding:20px;margin:16px 0;border-left:3px solid #22d3ee">
        <p style="margin:0;line-height:1.7;white-space:pre-wrap">${replyText}</p>
      </div>
      <hr style="border:none;border-top:1px solid #334155;margin:20px 0">
      <p style="color:#64748b;font-size:0.8rem">Mesajul tău original:</p>
      <p style="color:#64748b;font-size:0.8rem;font-style:italic;line-height:1.5">"${originalMessage?.slice(0, 200) || ''}..."</p>
      <div style="text-align:center;margin-top:24px">
        <a href="${appUrl}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">
          Vizitează ${appName} →
        </a>
      </div>
    </div>
  </div>
</body></html>`;
}

module.exports = router;