// ═══════════════════════════════════════════════════════════════
// KelionAI — Real-time Notification System (SSE-based)
// Lightweight server → admin push notifications
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');

// Connected SSE clients
const clients = new Set();

// Notification queue (last 50 for new connections)
const recentNotifications = [];
const MAX_RECENT = 50;

/**
 * Send a notification to all connected admin clients
 * @param {string} type - Notification type (info|warn|error|success|trade|user|system)
 * @param {string} message - Human-readable message
 * @param {object} [data] - Optional extra data
 */
function notify(type, message, data = {}) {
  const notification = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type: type || 'info',
    message,
    data,
    timestamp: new Date().toISOString(),
  };

  // Store in recent
  recentNotifications.push(notification);
  if (recentNotifications.length > MAX_RECENT) recentNotifications.shift();

  // Push to all connected clients
  const payload = `data: ${JSON.stringify(notification)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }

  logger.info({ component: 'Notify', type, msg: message }, `📢 ${message}`);
}

/**
 * Express middleware — SSE stream for admin notifications
 * GET /api/admin/notifications/stream
 */
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send recent notifications on connect
  for (const n of recentNotifications.slice(-10)) {
    res.write(`data: ${JSON.stringify(n)}\n\n`);
  }

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 30000);

  clients.add(res);
  logger.info({ component: 'Notify' }, `Admin SSE connected (${clients.size} total)`);

  req.on('close', () => {
    clients.delete(res);
    clearInterval(heartbeat);
    logger.info({ component: 'Notify' }, `Admin SSE disconnected (${clients.size} remaining)`);
  });
}

/**
 * Get recent notifications (for REST fallback)
 */
function getRecent(limit = 20) {
  return recentNotifications.slice(-limit);
}

module.exports = { notify, sseHandler, getRecent };
