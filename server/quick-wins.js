// ═══════════════════════════════════════════════════════════════
// KelionAI — Quick Wins Module (Sprint #4)
// Bookmarks, Templates, Webhooks, Rate Limiting, Theme, CoT
// ═══════════════════════════════════════════════════════════════
"use strict";

// ══════════════════════════════════════════════════════════
// 1. CONVERSATION BOOKMARKS
// ══════════════════════════════════════════════════════════
const bookmarks = new Map(); // userId -> [{id, messageId, text, avatar, timestamp}]

function addBookmark(userId, data) {
  if (!bookmarks.has(userId)) bookmarks.set(userId, []);
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    messageId: data.messageId || null,
    text: (data.text || "").slice(0, 500),
    avatar: data.avatar || "kelion",
    timestamp: new Date().toISOString(),
  };
  bookmarks.get(userId).unshift(entry);
  if (bookmarks.get(userId).length > 100) bookmarks.get(userId).pop();
  return entry;
}

function getBookmarks(userId) {
  return bookmarks.get(userId) || [];
}
function deleteBookmark(userId, bookmarkId) {
  const list = bookmarks.get(userId) || [];
  const idx = list.findIndex((b) => b.id === bookmarkId);
  if (idx >= 0) {
    list.splice(idx, 1);
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════
// 2. PROMPT TEMPLATE LIBRARY
// ══════════════════════════════════════════════════════════
const templates = new Map();

// Seed defaults
const defaultTemplates = [
  {
    id: "code_review",
    name: "Code Review",
    category: "coding",
    prompt:
      "Review this code for bugs, performance issues, and best practices:\n\n{code}",
    icon: "🔍",
  },
  {
    id: "explain_concept",
    name: "Explain Concept",
    category: "learning",
    prompt: "Explain {topic} in simple terms, with examples and analogies.",
    icon: "📚",
  },
  {
    id: "market_analysis",
    name: "Market Analysis",
    category: "trading",
    prompt:
      "Analyze the current market conditions for {asset}. Include: trend, support/resistance, volume analysis, and recommendation.",
    icon: "📈",
  },
  {
    id: "email_draft",
    name: "Email Draft",
    category: "writing",
    prompt:
      "Write a professional email about {subject}. Tone: {tone}. Include: greeting, body, call to action, sign-off.",
    icon: "✉️",
  },
  {
    id: "debug_help",
    name: "Debug Helper",
    category: "coding",
    prompt:
      "I'm getting this error:\n{error}\n\nIn this code:\n{code}\n\nHelp me fix it.",
    icon: "🐛",
  },
  {
    id: "summarize",
    name: "Summarize",
    category: "research",
    prompt:
      "Summarize the following text in {length} sentences, keeping the key points:\n\n{text}",
    icon: "📋",
  },
  {
    id: "translate_ro",
    name: "Translate RO↔EN",
    category: "language",
    prompt:
      "Translate the following between Romanian and English, maintaining natural tone:\n\n{text}",
    icon: "🌐",
  },
  {
    id: "investment_eval",
    name: "Investment Evaluation",
    category: "trading",
    prompt:
      "Evaluate {asset} as an investment opportunity. Consider: fundamentals, risk/reward, entry points, time horizon.",
    icon: "💰",
  },
];
defaultTemplates.forEach((t) =>
  templates.set(t.id, {
    ...t,
    createdAt: new Date().toISOString(),
    isDefault: true,
  }),
);

function getTemplates() {
  return Array.from(templates.values());
}
function getTemplate(id) {
  return templates.get(id) || null;
}
function createTemplate(data) {
  const id = data.id || Date.now().toString(36);
  const entry = {
    id,
    name: data.name,
    category: data.category || "general",
    prompt: data.prompt,
    icon: data.icon || "📝",
    createdAt: new Date().toISOString(),
    isDefault: false,
  };
  templates.set(id, entry);
  return entry;
}
function deleteTemplate(id) {
  return templates.delete(id);
}

// ══════════════════════════════════════════════════════════
// 3. WEBHOOK SYSTEM
// ══════════════════════════════════════════════════════════
const webhooks = new Map();

function registerWebhook(data) {
  const id = Date.now().toString(36);
  const hook = {
    id,
    url: data.url,
    events: data.events || ["message"],
    secret: data.secret || "",
    active: true,
    createdAt: new Date().toISOString(),
    deliveries: 0,
    lastError: null,
  };
  webhooks.set(id, hook);
  return hook;
}

async function fireWebhook(event, payload) {
  for (const [, hook] of webhooks) {
    if (!hook.active || !hook.events.includes(event)) continue;
    try {
      await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Secret": hook.secret,
        },
        body: JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          data: payload,
        }),
      });
      hook.deliveries++;
    } catch (err) {
      hook.lastError = err.message;
    }
  }
}

function getWebhooks() {
  return Array.from(webhooks.values());
}
function deleteWebhook(id) {
  return webhooks.delete(id);
}

// ══════════════════════════════════════════════════════════
// 4. RATE LIMITING TRACKER
// ══════════════════════════════════════════════════════════
const rateLimits = new Map(); // ip/userId -> {count, windowStart, blocked}

function trackRateLimit(key, limit = 30, windowMs = 60000) {
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = {
      count: 0,
      windowStart: now,
      blocked: false,
      totalBlocks: entry ? entry.totalBlocks : 0,
    };
    rateLimits.set(key, entry);
  }
  entry.count++;
  if (entry.count > limit) {
    entry.blocked = true;
    entry.totalBlocks++;
  }
  return entry;
}

function getRateLimitStats() {
  const stats = {
    totalTracked: rateLimits.size,
    currentlyBlocked: 0,
    topUsers: [],
  };
  for (const [key, entry] of rateLimits) {
    if (entry.blocked) stats.currentlyBlocked++;
    stats.topUsers.push({
      key,
      count: entry.count,
      blocked: entry.blocked,
      totalBlocks: entry.totalBlocks,
    });
  }
  stats.topUsers.sort((a, b) => b.count - a.count);
  stats.topUsers = stats.topUsers.slice(0, 20);
  return stats;
}

module.exports = {
  addBookmark,
  getBookmarks,
  deleteBookmark,
  getTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  registerWebhook,
  fireWebhook,
  getWebhooks,
  deleteWebhook,
  trackRateLimit,
  getRateLimitStats,
};
