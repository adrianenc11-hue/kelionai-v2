'use strict';
const APP_CFG = require('../config/app');
// server/routes/legal-api.js
// ═══════════════════════════════════════════════════════════════
// ${APP_CFG.APP_NAME} — Legal API (/api/legal/terms, /api/legal/privacy)
// Returns structured JSON for frontend legal display & tests.
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// GET /api/legal/terms — Terms of Service (JSON)
// ═══════════════════════════════════════════════════════════════
router.get('/terms', (req, res) => {
  res.json({
    title: 'Terms of Service',
    version: '1.0',
    lastUpdated: '2026-01-01',
    sections: [
      {
        heading: 'Acceptance of Terms',
        content:
          `By accessing or using ${APP_CFG.APP_NAME} ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, you may not use the Service.`,
      },
      {
        heading: 'Description of Service',
        content:
          `${APP_CFG.APP_NAME} is an AI-powered assistant with 3D avatars offering voice interaction, multilingual support, and intelligent conversation capabilities.`,
      },
      {
        heading: 'User Accounts',
        content:
          'You are responsible for maintaining the confidentiality of your account credentials. You must notify us immediately of any unauthorized use.',
      },
      {
        heading: 'Acceptable Use',
        content:
          'You agree not to use the Service for any unlawful purpose, to harass or harm others, to transmit malware, or to attempt to gain unauthorized access to any systems.',
      },
      {
        heading: 'Intellectual Property',
        content:
          `All content, features, and functionality of the Service are owned by ${APP_CFG.APP_NAME} and are protected by intellectual property laws.`,
      },
      {
        heading: 'Limitation of Liability',
        content:
          `The Service is provided "as is" without warranties of any kind. ${APP_CFG.APP_NAME} shall not be liable for any indirect, incidental, or consequential damages.`,
      },
      {
        heading: 'Termination',
        content:
          'We may terminate or suspend your access to the Service at any time, without prior notice, for conduct that we believe violates these Terms.',
      },
      {
        heading: 'Changes to Terms',
        content:
          'We reserve the right to modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the new Terms.',
      },
    ],
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/legal/privacy — Privacy Policy (JSON)
// ═══════════════════════════════════════════════════════════════
router.get('/privacy', (req, res) => {
  res.json({
    title: 'Privacy Policy',
    version: '1.0',
    lastUpdated: '2026-01-01',
    sections: [
      {
        heading: 'Information We Collect',
        content:
          'We collect information you provide directly (email, name) and automatically (IP address, browser type, usage data) when you use the Service.',
      },
      {
        heading: 'How We Use Information',
        content:
          'We use your information to provide and improve the Service, personalize your experience, communicate with you, and ensure security.',
      },
      {
        heading: 'Data Storage',
        content:
          'Your data is stored securely using Supabase (PostgreSQL) with encryption at rest and in transit. We retain data only as long as necessary.',
      },
      {
        heading: 'Third-Party Services',
        content:
          'We use third-party AI providers (OpenAI, Anthropic, Google) to process your messages. These providers have their own privacy policies.',
      },
      {
        heading: 'Cookies',
        content:
          'We use essential cookies for authentication and preferences. We do not use tracking cookies without your consent.',
      },
      {
        heading: 'Your Rights (GDPR)',
        content:
          'You have the right to access, correct, delete, or export your personal data. Contact us or use the GDPR tools in your account settings.',
      },
      {
        heading: 'Data Security',
        content:
          'We implement industry-standard security measures including encryption, rate limiting, and access controls to protect your data.',
      },
      {
        heading: 'Contact',
        content: `For privacy-related inquiries, contact us at ${process.env.PRIVACY_EMAIL || process.env.CONTACT_EMAIL || 'privacy@' + (process.env.APP_DOMAIN || require('../config/app').APP_DOMAIN || 'app.local')}.`,
      },
    ],
  });
});

module.exports = router;
