// ═══════════════════════════════════════════════════════════════
// KelionAI — Layer 6: Safety Classifier (Schema Antropic Integral)
// Clasificator conținut: filtrare input/output toxic, NSFW, harmful
// + OpenAI Moderation API + Rate limit bypass detection
// Zero hardcodate — totul din process.env
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { API_ENDPOINTS } = require('./config/models');

// ── Categorii de conținut interzis ──
const BLOCKED_CATEGORIES = {
  violence: {
    patterns: [
      /\b(ucide|omoara|injunghie|impusca|decapiteaz|sinucide|omoar[aă]|asasin|bomb[aă]|explozie)\b/gi,
      /\b(kill|murder|stab|shoot|behead|suicide|assassin|bomb|explode|massacre)\b/gi,
    ],
    severity: 'high',
    message: 'Continutul solicitat implica violenta si nu poate fi generat.',
  },
  hate_speech: {
    patterns: [
      /\b(rasism|xenofob|antisemit|homofob|nazist|neo-?nazi|supremat|inferio[rl])\b/gi,
      /\b(racist|xenophob|antisemit|homophob|nazi|neo-?nazi|supremac|inferior\s+race)\b/gi,
    ],
    severity: 'high',
    message: 'Continutul solicitat contine discurs de ura si nu poate fi generat.',
  },
  sexual_content: {
    patterns: [
      /\b(pornograf|sex\s+explicit|nud\s+complet|act\s+sexual|organ[eul]\s+genital)\b/gi,
      /\b(pornograph|explicit\s+sex|full\s+nud|sexual\s+act|genital)\b/gi,
    ],
    severity: 'high',
    message: 'Continut NSFW detectat - nu poate fi generat.',
  },
  self_harm: {
    patterns: [
      /\b(sinucid|suicid|autovatamar|self.?harm|eutanasi|cum\s+sa\s+mor|vreau\s+sa\s+mor)\b/gi,
      /\b(suicide|self.?harm|cut\s+my|hang\s+myself|overdose|euthanasi|want\s+to\s+die|how\s+to\s+die)\b/gi,
    ],
    severity: 'critical',
    message:
      'Daca treci printr-o perioada dificila, te rog contacteaza o linie de criza: 0800 801 200 (Romania) sau 116 123 (EU). Nu esti singur/a.',
  },
  illegal_activity: {
    patterns: [
      /\b(hack\s+into|sparge?\s+parola|fabrica?\s+drog|explozibil|aram[aă]\s+chimic|weaponize)\b/gi,
      /\b(how\s+to\s+hack|crack\s+password|make\s+drugs|explosive|chemical\s+weapon|weaponize)\b/gi,
    ],
    severity: 'high',
    message: 'Nu pot ajuta cu activitati ilegale.',
  },
  personal_data: {
    patterns: [
      /\b(CNP|cod\s+numeric\s+personal|numar\s+card|card\s+bancar|IBAN)\b/gi,
      /\b(social\s+security|credit\s+card\s+number|bank\s+account|routing\s+number)\b/gi,
      /\b\d{13}\b/,
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
    ],
    severity: 'medium',
    message: 'Am detectat date personale sensibile. Pentru siguranta ta, nu le stochez si nu le trimit mai departe.',
  },
};

// ── Cuvinte trigger care necesita analiza suplimentara ──
const CONTEXT_TRIGGERS = [
  /\b(arma|weapon|gun|pistol|knife|cutit)\b/gi,
  /\b(drog|drug|heroina|cocaina|metamfetamina|meth)\b/gi,
  /\b(furt|theft|steal|rob|jaf)\b/gi,
];

class SafetyClassifier {
  constructor() {
    this._stats = {
      total: 0,
      blocked: 0,
      warnings: 0,
      passed: 0,
      byCategory: {},
    };
    this._bypassTracker = new Map();
    this._BYPASS_LIMIT = 5;
    this._BYPASS_WINDOW_MS = 10 * 60 * 1000;
    this._BYPASS_BLOCK_MS = 60 * 60 * 1000;
  }

  classify(text, direction = 'input', userId = null) {
    if (!text || typeof text !== 'string') return { safe: true };
    this._stats.total++;

    if (userId && this._isUserBlocked(userId)) {
      return {
        safe: false,
        category: 'rate_limited',
        severity: 'high',
        message: 'Ai fost blocat temporar pentru tentative repetate de bypass al filtrelor de siguranta.',
        action: 'block',
      };
    }

    for (const [catName, cat] of Object.entries(BLOCKED_CATEGORIES)) {
      for (const pattern of cat.patterns) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          this._stats.blocked++;
          this._stats.byCategory[catName] = (this._stats.byCategory[catName] || 0) + 1;
          if (userId) this._trackBypassAttempt(userId);

          logger.warn(
            {
              component: 'SafetyClassifier',
              category: catName,
              severity: cat.severity,
              direction,
              userId,
              textPreview: text.substring(0, 80),
            },
            `🛡️ Continut blocat: ${catName}`
          );

          if (catName === 'self_harm') {
            return {
              safe: false,
              category: catName,
              severity: 'critical',
              message: cat.message,
              action: 'redirect_help',
            };
          }
          if (catName === 'personal_data' && direction === 'output') {
            return {
              safe: true,
              category: catName,
              severity: cat.severity,
              message: cat.message,
              redacted: this._redactPII(text),
              action: 'redact',
            };
          }
          return { safe: false, category: catName, severity: cat.severity, message: cat.message, action: 'block' };
        }
      }
    }

    for (const trigger of CONTEXT_TRIGGERS) {
      trigger.lastIndex = 0;
      if (trigger.test(text)) {
        this._stats.warnings++;
        return { safe: true, category: 'context_sensitive', severity: 'low', action: 'monitor' };
      }
    }

    if (this._detectInjection(text)) {
      this._stats.blocked++;
      if (userId) this._trackBypassAttempt(userId);
      logger.warn({ component: 'SafetyClassifier', direction, userId }, '🛡️ Prompt injection detectat');
      return {
        safe: false,
        category: 'injection',
        severity: 'high',
        message: 'Mesajul contine tentativa de manipulare a AI-ului si a fost filtrat.',
        action: 'block',
      };
    }

    this._stats.passed++;
    return { safe: true };
  }

  // ── OpenAI Moderation API (gratuit) ──
  async classifyWithModeration(text) {
    if (!text || typeof text !== 'string') return { safe: true };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return this.classify(text);

    try {
      const r = await fetch(`${API_ENDPOINTS.OPENAI}/moderations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ input: text }),
        signal: AbortSignal.timeout(5000),
      });

      if (!r.ok) {
        logger.warn({ component: 'SafetyClassifier', status: r.status }, 'OpenAI Moderation failed, using local');
        return this.classify(text);
      }

      const data = await r.json();
      const result = data.results && data.results[0];

      if (result && result.flagged) {
        const flaggedCats = Object.entries(result.categories || {})
          .filter(function (entry) {
            return entry[1];
          })
          .map(function (entry) {
            return entry[0];
          });

        const scores = result.category_scores || {};
        const scoreValues = Object.values(scores);
        const maxScore = scoreValues.length > 0 ? Math.max.apply(null, scoreValues) : 0;

        this._stats.blocked++;
        this._stats.byCategory['openai_moderation'] = (this._stats.byCategory['openai_moderation'] || 0) + 1;

        logger.warn(
          {
            component: 'SafetyClassifier',
            categories: flaggedCats,
            maxScore: maxScore.toFixed(3),
            source: 'openai-moderation',
          },
          '🛡️ OpenAI Moderation: flagged (' + flaggedCats.join(', ') + ')'
        );

        return {
          safe: false,
          category: flaggedCats[0] || 'unknown',
          allCategories: flaggedCats,
          severity: maxScore > 0.8 ? 'critical' : maxScore > 0.5 ? 'high' : 'medium',
          score: maxScore,
          message: 'Continut detectat ca nesigur: ' + flaggedCats.join(', '),
          source: 'openai-moderation',
          action: 'block',
        };
      }

      this._stats.passed++;
      return { safe: true, source: 'openai-moderation' };
    } catch (e) {
      logger.warn({ component: 'SafetyClassifier', err: e.message }, 'Moderation API error, using local');
      return this.classify(text);
    }
  }

  // ── Full check: local + OpenAI Moderation ──
  async fullCheck(text, direction, userId) {
    const localResult = this.classify(text, direction || 'input', userId || null);
    if (!localResult.safe) return localResult;

    const moderationResult = await this.classifyWithModeration(text);
    if (!moderationResult.safe) {
      if (userId) this._trackBypassAttempt(userId);
      return moderationResult;
    }

    return { safe: true, checkedBy: ['local', 'openai-moderation'] };
  }

  // ── Output filtering (verifica raspunsul AI) ──
  async classifyOutput(text) {
    const localResult = this.classify(text, 'output');
    if (!localResult.safe) return localResult;

    const moderationResult = await this.classifyWithModeration(text);
    if (!moderationResult.safe) {
      return Object.assign({}, moderationResult, { direction: 'output', action: 'filter_response' });
    }

    return { safe: true, direction: 'output' };
  }

  // ── Bypass rate limiting ──
  _trackBypassAttempt(userId) {
    const now = Date.now();
    let tracker = this._bypassTracker.get(userId);

    if (!tracker || now - tracker.lastAttempt > this._BYPASS_WINDOW_MS) {
      tracker = { count: 0, lastAttempt: now, blockedUntil: 0 };
    }

    tracker.count++;
    tracker.lastAttempt = now;

    if (tracker.count >= this._BYPASS_LIMIT) {
      tracker.blockedUntil = now + this._BYPASS_BLOCK_MS;
      logger.warn(
        { component: 'SafetyClassifier', userId, attempts: tracker.count },
        '🚫 User auto-blocked: ' + tracker.count + ' bypass attempts'
      );
    }

    this._bypassTracker.set(userId, tracker);
  }

  _isUserBlocked(userId) {
    const tracker = this._bypassTracker.get(userId);
    if (!tracker) return false;
    if (tracker.blockedUntil && Date.now() < tracker.blockedUntil) return true;
    if (tracker.blockedUntil && Date.now() >= tracker.blockedUntil) {
      this._bypassTracker.delete(userId);
    }
    return false;
  }

  _detectInjection(text) {
    const injectionPatterns = [
      /ignore\s+(all\s+)?previous\s+instructions/i,
      /you\s+are\s+now\s+(?:DAN|jailbroken|unrestricted|unfiltered)/i,
      /disregard\s+(?:all|your)\s+(?:rules|guidelines|instructions)/i,
      /act\s+as\s+(?:if\s+you\s+have\s+no|an?\s+(?:evil|unethical))/i,
      /pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:hacker|criminal|terrorist)/i,
      /\[system\s*\]/i,
      /\{\{.*system.*\}\}/i,
    ];
    return injectionPatterns.some(function (p) {
      return p.test(text);
    });
  }

  _redactPII(text) {
    return text
      .replace(/\b\d{13}\b/g, '[CNP REDACTAT]')
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD REDACTAT]')
      .replace(/\b[A-Z]{2}\d{2}[A-Z]{4}\d{4,20}\b/g, '[IBAN REDACTAT]')
      .replace(/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3,4}\b/g, '[TELEFON REDACTAT]');
  }

  getStats() {
    return Object.assign({}, this._stats, { blockedUsers: this._bypassTracker.size });
  }

  reset() {
    this._stats = { total: 0, blocked: 0, warnings: 0, passed: 0, byCategory: {} };
    this._bypassTracker.clear();
  }
}

const safetyClassifier = new SafetyClassifier();

module.exports = { SafetyClassifier, safetyClassifier };
