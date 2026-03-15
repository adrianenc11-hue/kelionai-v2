// ═══════════════════════════════════════════════════════════════
// KelionAI — User Feedback + Live Sessions + Error Tracking
// Combined module for Sprint #2 features
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

// ══════════════════════════════════════════════════════════
// 1. USER FEEDBACK (thumbs up/down)
// ══════════════════════════════════════════════════════════
const feedbackStore = [];

function recordFeedback(data) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    userId: data.userId || "anonymous",
    messageId: data.messageId || null,
    type: data.type, // 'up' | 'down'
    comment: data.comment || "",
    avatar: data.avatar || "kelion",
    timestamp: new Date().toISOString(),
  };
  feedbackStore.unshift(entry);
  if (feedbackStore.length > 500) feedbackStore.pop();
  logger.info({ component: "Feedback", type: entry.type, user: entry.userId }, "Feedback recorded");
  return entry;
}

function getFeedbackStats() {
  const total = feedbackStore.length;
  const up = feedbackStore.filter(f => f.type === "up").length;
  const down = feedbackStore.filter(f => f.type === "down").length;
  const rate = total > 0 ? ((up / total) * 100).toFixed(1) : "0";
  const last24h = feedbackStore.filter(f => Date.now() - new Date(f.timestamp).getTime() < 86400000);
  return { total, up, down, satisfactionRate: rate + "%", last24h: last24h.length, recent: feedbackStore.slice(0, 50) };
}

// ══════════════════════════════════════════════════════════
// 2. LIVE SESSIONS TRACKER
// ══════════════════════════════════════════════════════════
const activeSessions = new Map();

function trackSession(userId, data) {
  activeSessions.set(userId, {
    userId,
    email: data.email || "unknown",
    avatar: data.avatar || "kelion",
    page: data.page || "/",
    lastSeen: Date.now(),
    connectedAt: activeSessions.has(userId) ? activeSessions.get(userId).connectedAt : Date.now(),
    ip: data.ip || "",
    userAgent: data.userAgent || "",
  });
}

function heartbeat(userId) {
  const s = activeSessions.get(userId);
  if (s) s.lastSeen = Date.now();
}

function getLiveSessions() {
  const now = Date.now();
  const TIMEOUT = 120000; // 2 min
  // Clean stale
  for (const [uid, s] of activeSessions) {
    if (now - s.lastSeen > TIMEOUT) activeSessions.delete(uid);
  }
  const list = [];
  for (const [, s] of activeSessions) {
    list.push({
      ...s,
      duration: Math.round((now - s.connectedAt) / 1000),
      idle: Math.round((now - s.lastSeen) / 1000),
    });
  }
  return { online: list.length, sessions: list };
}

// ══════════════════════════════════════════════════════════
// 3. ERROR TRACKING
// ══════════════════════════════════════════════════════════
const errorLog = [];
const errorCounts = {};

function trackError(data) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    message: data.message || "Unknown error",
    stack: data.stack || "",
    source: data.source || "server",
    route: data.route || "",
    userId: data.userId || "",
    severity: data.severity || "error",
    timestamp: new Date().toISOString(),
  };
  errorLog.unshift(entry);
  if (errorLog.length > 1000) errorLog.pop();

  // Count by message for frequency
  const key = entry.message.slice(0, 100);
  errorCounts[key] = (errorCounts[key] || 0) + 1;

  logger.error({ component: "ErrorTracker", source: entry.source, route: entry.route }, entry.message);
  return entry;
}

function getErrorStats() {
  const total = errorLog.length;
  const last1h = errorLog.filter(e => Date.now() - new Date(e.timestamp).getTime() < 3600000).length;
  const last24h = errorLog.filter(e => Date.now() - new Date(e.timestamp).getTime() < 86400000).length;

  // Top errors by frequency
  const topErrors = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([msg, count]) => ({ message: msg, count }));

  // By source
  const bySource = {};
  for (const e of errorLog) {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  }

  return { total, last1h, last24h, topErrors, bySource, recent: errorLog.slice(0, 50) };
}

module.exports = {
  recordFeedback, getFeedbackStats,
  trackSession, heartbeat, getLiveSessions,
  trackError, getErrorStats,
};
