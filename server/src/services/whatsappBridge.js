'use strict';

// ── WhatsApp Bridge for Kelion AI ────────────────────────────────
// Connects Kelion to WhatsApp using whatsapp-web.js (QR-based auth,
// no Business API needed). Kelion responds ONLY when its name is
// mentioned in a message ("Kelion, ...").
//
// Architecture:
//   WhatsApp message → name detection → Kelion AI chat API → response → WhatsApp
//
// The bridge runs as a singleton service inside the existing Express
// server, sharing the same process and DB connection.

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const EventEmitter = require('events');

// ── Configuration ────────────────────────────────────────────────
const TRIGGER_NAMES = ['kelion', 'kelionai', 'kel'];
const MAX_RESPONSE_LENGTH = 4096; // WhatsApp message limit
const RATE_LIMIT_MS = 2000; // Min gap between responses to same chat
const SESSION_DIR = '.wwebjs_auth'; // Relative to server/ dir

class WhatsAppBridge extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.qrCode = null;       // Current QR as data URL
    this.status = 'disconnected'; // disconnected | qr_pending | ready | error
    this.stats = { messagesReceived: 0, responseSent: 0, errors: 0, startedAt: null };
    this._rateLimitMap = new Map(); // chatId → lastResponseTs
    this._chatHandler = null; // Reference to the chat/AI handler
  }

  /**
   * Initialize the WhatsApp client.
   * @param {Function} chatHandler - async (message, senderName, chatName, isGroup) => string
   */
  async init(chatHandler) {
    if (this.client) {
      console.warn('[WhatsApp] Bridge already initialized');
      return;
    }

    this._chatHandler = chatHandler;
    this.status = 'disconnected';

    try {
      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process',
          ],
        },
      });

      // ── QR Code event ──
      this.client.on('qr', async (qr) => {
        this.status = 'qr_pending';
        try {
          this.qrCode = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        } catch (err) {
          console.error('[WhatsApp] QR generation failed:', err.message);
          this.qrCode = null;
        }
        console.log('[WhatsApp] QR code generated — scan with your phone');
        this.emit('qr', this.qrCode);
      });

      // ── Ready event ──
      this.client.on('ready', () => {
        this.status = 'ready';
        this.qrCode = null; // No longer needed
        this.stats.startedAt = new Date().toISOString();
        console.log('[WhatsApp] ✅ Connected and ready!');
        this.emit('ready');
      });

      // ── Message event ──
      this.client.on('message', async (msg) => {
        try {
          await this._handleMessage(msg);
        } catch (err) {
          this.stats.errors++;
          console.error('[WhatsApp] Message handling error:', err.message);
        }
      });

      // ── Disconnected event ──
      this.client.on('disconnected', (reason) => {
        this.status = 'disconnected';
        this.qrCode = null;
        console.warn('[WhatsApp] Disconnected:', reason);
        this.emit('disconnected', reason);
      });

      // ── Auth failure ──
      this.client.on('auth_failure', (msg) => {
        this.status = 'error';
        console.error('[WhatsApp] Auth failure:', msg);
        this.emit('error', msg);
      });

      await this.client.initialize();
      console.log('[WhatsApp] Client initializing...');

    } catch (err) {
      this.status = 'error';
      console.error('[WhatsApp] Init failed:', err.message);
      this.emit('error', err.message);
    }
  }

  /**
   * Handle an incoming WhatsApp message.
   * Responds ONLY when Kelion's name is mentioned.
   */
  async _handleMessage(msg) {
    // Ignore status updates, own messages, media-only
    if (msg.isStatus || msg.fromMe) return;

    this.stats.messagesReceived++;
    const body = (msg.body || '').trim();
    if (!body) return;

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const chatName = chat.name || 'DM';

    // ── Trigger detection ──
    // In groups: respond ONLY when Kelion's name is mentioned
    // In private chats: always respond (it's a direct message)
    const bodyLower = body.toLowerCase();
    const isMentioned = TRIGGER_NAMES.some(name => bodyLower.includes(name));

    if (isGroup && !isMentioned) {
      return; // Ignore group messages that don't mention Kelion
    }

    // ── Rate limiting ──
    const chatId = chat.id._serialized;
    const now = Date.now();
    const lastResponse = this._rateLimitMap.get(chatId) || 0;
    if (now - lastResponse < RATE_LIMIT_MS) {
      return; // Too fast, skip
    }

    // ── Extract the actual question (remove the trigger word) ──
    let question = body;
    for (const name of TRIGGER_NAMES) {
      // Remove "Kelion," or "Kelion " from the beginning
      const regex = new RegExp(`^${name}[,:\\s]*`, 'i');
      question = question.replace(regex, '').trim();
    }
    if (!question) question = body; // If nothing left, use original

    // ── Get sender info ──
    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.name || contact.number || 'Unknown';

    console.log(`[WhatsApp] ${isGroup ? `[${chatName}]` : '[DM]'} ${senderName}: ${question.slice(0, 100)}`);

    // ── Send to Kelion AI ──
    if (!this._chatHandler) {
      console.warn('[WhatsApp] No chat handler configured');
      return;
    }

    // Show "typing" indicator
    await chat.sendStateTyping();

    try {
      const response = await this._chatHandler(question, senderName, chatName, isGroup);

      if (response && typeof response === 'string') {
        // Truncate if too long
        const finalResponse = response.length > MAX_RESPONSE_LENGTH
          ? response.slice(0, MAX_RESPONSE_LENGTH - 20) + '\n\n... (truncated)'
          : response;

        await msg.reply(finalResponse);
        this._rateLimitMap.set(chatId, Date.now());
        this.stats.responseSent++;
        console.log(`[WhatsApp] Replied to ${senderName} (${finalResponse.length} chars)`);
      }
    } catch (err) {
      this.stats.errors++;
      console.error(`[WhatsApp] AI response error:`, err.message);
      await msg.reply('⚠️ Scuze, am întâmpinat o eroare. Încearcă din nou.');
    } finally {
      await chat.clearState();
    }
  }

  /**
   * Get current status and stats.
   */
  getStatus() {
    return {
      status: this.status,
      qrCode: this.qrCode,
      stats: this.stats,
      isReady: this.status === 'ready',
    };
  }

  /**
   * Disconnect and cleanup.
   */
  async destroy() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch (err) {
        console.warn('[WhatsApp] Destroy error:', err.message);
      }
      this.client = null;
      this.status = 'disconnected';
      this.qrCode = null;
    }
  }

  /**
   * Logout (clear session) and reinitialize.
   */
  async logout() {
    if (this.client) {
      try {
        await this.client.logout();
      } catch (err) {
        console.warn('[WhatsApp] Logout error:', err.message);
      }
      await this.destroy();
    }
  }
}

// Singleton instance
const bridge = new WhatsAppBridge();

module.exports = bridge;
module.exports.WhatsAppBridge = WhatsAppBridge;
