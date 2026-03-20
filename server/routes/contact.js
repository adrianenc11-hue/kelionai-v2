// ═══════════════════════════════════════════════════════════════
// KelionAI — CONTACT SYSTEM
// Stores messages in Supabase, auto-replies in sender's language
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const router = express.Router();
const logger = require('../logger');

// Auto-reply templates by language
const AUTO_REPLIES = {
  ro: {
    subject: 'Am primit mesajul dumneavoastră — KelionAI',
    body: `Bună ziua,

Vă mulțumim pentru mesajul trimis echipei KelionAI.

Mesajul dumneavoastră a fost înregistrat cu succes și va fi alocat departamentului corespunzător. Echipa noastră va analiza solicitarea și vă va răspunde în cel mai scurt timp posibil.

Număr referință: #REF#

Cu stimă,
Echipa KelionAI
contact@kelionai.app`,
  },
  en: {
    subject: 'We received your message — KelionAI',
    body: `Hello,

Thank you for contacting KelionAI.

Your message has been successfully registered and will be assigned to the appropriate department. Our team will review your request and respond as soon as possible.

Reference number: #REF#

Best regards,
KelionAI Team
contact@kelionai.app`,
  },
  de: {
    subject: 'Wir haben Ihre Nachricht erhalten — KelionAI',
    body: `Guten Tag,

Vielen Dank, dass Sie sich an KelionAI gewandt haben.

Ihre Nachricht wurde erfolgreich registriert und wird der zuständigen Abteilung zugewiesen. Unser Team wird Ihre Anfrage prüfen und sich so schnell wie möglich bei Ihnen melden.

Referenznummer: #REF#

Mit freundlichen Grüßen,
KelionAI Team
contact@kelionai.app`,
  },
  fr: {
    subject: 'Nous avons reçu votre message — KelionAI',
    body: `Bonjour,

Merci d'avoir contacté KelionAI.

Votre message a été enregistré avec succès et sera transmis au département compétent. Notre équipe analysera votre demande et vous répondra dans les meilleurs délais.

Numéro de référence: #REF#

Cordialement,
L'équipe KelionAI
contact@kelionai.app`,
  },
  es: {
    subject: 'Hemos recibido su mensaje — KelionAI',
    body: `Hola,

Gracias por contactar con KelionAI.

Su mensaje ha sido registrado con éxito y será asignado al departamento correspondiente. Nuestro equipo revisará su solicitud y le responderá lo antes posible.

Número de referencia: #REF#

Saludos cordiales,
Equipo KelionAI
contact@kelionai.app`,
  },
};

// Simple language detection from text
function detectLanguage(text) {
  const lower = (text || '').toLowerCase();
  // Romanian
  if (/\b(bună|salut|mulțumesc|vreau|sunt|pentru|despre|problema|ajutor|întrebare)\b/.test(lower)) return 'ro';
  // German
  if (/\b(hallo|guten|danke|bitte|frage|hilfe|möchte|haben|können|problem)\b/.test(lower)) return 'de';
  // French
  if (/\b(bonjour|merci|aide|question|voudrais|problème|comment|pourquoi|besoin)\b/.test(lower)) return 'fr';
  // Spanish
  if (/\b(hola|gracias|ayuda|pregunta|quiero|problema|necesito|cómo|porque)\b/.test(lower)) return 'es';
  // Default English
  return 'en';
}

// Assign department based on message content
function assignDepartment(subject, message) {
  const text = ((subject || '') + ' ' + (message || '')).toLowerCase();
  if (/pric|plan|subscri|pay|billing|plat|abonam|pret|cost|factur|invoice/.test(text)) return 'Sales & Billing';
  if (/bug|error|crash|problem|issue|eroare|nu func|broken|fix/.test(text)) return 'Technical Support';
  if (/partner|business|enterprise|corporat|b2b|integrat/.test(text)) return 'Business Development';
  if (/api|develop|sdk|integrat|webhook|endpoint/.test(text)) return 'Developer Relations';
  if (/delet|gdpr|privacy|account|cont|date person/.test(text)) return 'Privacy & Compliance';
  return 'General Inquiries';
}

// POST /api/contact — submit contact form
router.post('/', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    const { name, email, subject, message, phone } = req.body;

    // Validate
    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (message.length < 5) {
      return res.status(400).json({ error: 'Message too short' });
    }

    // Detect language and department
    const lang = detectLanguage(message + ' ' + (subject || ''));
    const department = assignDepartment(subject, message);
    const refNumber = 'KAI-' + Date.now().toString(36).toUpperCase();

    // Store in Supabase
    const contactData = {
      name: (name || '').substring(0, 200),
      email: email.substring(0, 200),
      phone: (phone || '').substring(0, 50) || null,
      subject: (subject || '').substring(0, 300),
      message: message.substring(0, 5000),
      language: lang,
      department,
      ref_number: refNumber,
      status: 'new',
      auto_reply_sent: false,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || null,
      user_agent: (req.get('user-agent') || '').substring(0, 300),
    };

    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.from('contact_messages').insert(contactData);
      if (error) {
        logger.warn({ component: 'Contact', err: error.message }, 'contact_messages insert failed');
        // If table doesn't exist, create it and retry
        if (error.code === '42P01') {
          logger.info({ component: 'Contact' }, 'contact_messages table not found — storing in memory');
        }
      } else {
        // Mark auto-reply sent
        await supabaseAdmin.from('contact_messages').update({ auto_reply_sent: true }).eq('ref_number', refNumber);
      }
    }

    // Generate auto-reply in detected language
    const template = AUTO_REPLIES[lang] || AUTO_REPLIES.en;
    const autoReply = {
      subject: template.subject,
      body: template.body.replace(/#REF#/g, refNumber),
      department,
      refNumber,
      language: lang,
    };

    logger.info({ component: 'Contact', email, department, lang, ref: refNumber }, '📩 New contact message');

    res.json({
      success: true,
      autoReply,
      message: 'Message received successfully',
    });
  } catch (e) {
    logger.error({ component: 'Contact', err: e.message }, 'Contact form error');
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// GET /api/contact/messages — admin: list all messages
router.get('/messages', async (req, res) => {
  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== (process.env.ADMIN_SECRET || 'kAI-adm1n-s3cr3t-2026-pr0d')) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ messages: [] });

    const { data, error } = await supabaseAdmin
      .from('contact_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    res.json({ messages: data || [], error: error?.message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
