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
    this.lastError = null;    // Last error message for admin visibility
    this.stats = { messagesReceived: 0, responseSent: 0, errors: 0, startedAt: null };
    this._rateLimitMap = new Map(); // chatId → lastResponseTs
    this._greetedContacts = new Set(); // contactId → boolean
    this._activeTranslators = new Set(); // chatId → true (translate all messages)
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
      // Resolve Chromium absolute path on production (nixpacks / Railway).
      // Puppeteer requires a real filesystem path, not a command name.
      let execPath = undefined;
      if (process.env.NODE_ENV === 'production') {
        execPath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
        if (!execPath) {
          const { execSync } = require('child_process');
          const fs = require('fs');
          // 1. Try resolving via shell (command -v is POSIX, always available)
          for (const cmd of ['chromium', 'chromium-browser', 'google-chrome']) {
            try {
              // readlink -f resolves symlinks to the actual binary
              const resolved = execSync(`readlink -f "$(command -v ${cmd})" 2>/dev/null`, {
                encoding: 'utf8', timeout: 3000,
              }).trim();
              if (resolved && fs.existsSync(resolved)) {
                execPath = resolved;
                break;
              }
            } catch (_) {}
          }
          // 2. Scan known nix store paths
          if (!execPath) {
            try {
              const found = execSync('find /nix/store -maxdepth 3 -name chromium -type f 2>/dev/null | head -1', {
                encoding: 'utf8', timeout: 5000,
              }).trim();
              if (found && fs.existsSync(found)) execPath = found;
            } catch (_) {}
          }
          // 3. If nothing found, don't set executablePath — let Puppeteer use its bundled browser
        }
        console.log(`[WhatsApp] Chromium path: ${execPath || '(puppeteer default)'}`);
      }

      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
        puppeteer: {
          executablePath: execPath,
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--no-first-run',
            '--no-zygote',
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
        this.lastError = null;
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
        this.lastError = `Auth failure: ${msg}`;
        console.error('[WhatsApp] Auth failure:', msg);
        this.emit('error', msg);
      });

      await this.client.initialize();
      console.log('[WhatsApp] Client initializing...');

    } catch (err) {
      this.status = 'error';
      this.lastError = `Init failed: ${err.message}`;
      console.error('[WhatsApp] Init failed:', err.message);
      this.emit('error', err.message);
    }
  }

  /**
   * Handle an incoming WhatsApp message.
   * Responds ONLY when Kelion's name is mentioned.
   */
  async _handleMessage(msg) {
    // Ignore status updates
    if (msg.isStatus) return;

    const body = (msg.body || '').trim();
    if (!body) return;

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const chatName = chat.name || 'DM';
    const chatId = chat.id._serialized;

    // ── Command: Toggle Translator Mode ──
    const bodyLower = body.toLowerCase();
    if (bodyLower === '!traduci on' || bodyLower === '!translate on') {
      this._activeTranslators.add(chatId);
      await msg.reply('✅ Translator automat activat. Voi traduce automat mesajele primite în română, și mesajele tale în limba interlocutorului.');
      return;
    }
    if (bodyLower === '!traduci off' || bodyLower === '!translate off') {
      this._activeTranslators.delete(chatId);
      await msg.reply('❌ Translator automat dezactivat.');
      return;
    }

    const isTranslateMode = this._activeTranslators.has(chatId);
    const isExplicitTranslate = bodyLower.startsWith('traduci:') || bodyLower.startsWith('translate:');

    // Ignore our own messages UNLESS translate mode is on, or we used an explicit trigger
    if (msg.fromMe && !isTranslateMode && !isExplicitTranslate) {
      return;
    }

    this.stats.messagesReceived++;

    // ── Trigger detection ──
    // In groups: respond ONLY when Kelion's name is mentioned (or translate mode on)
    // In private chats: always respond (it's a direct message)
    const isMentioned = TRIGGER_NAMES.some(name => bodyLower.includes(name));

    if (isGroup && !isMentioned && !isTranslateMode && !isExplicitTranslate) {
      return; // Ignore group messages that don't trigger Kelion
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
    const contactId = contact.id._serialized;

    // ── Auto-Greeting for New DMs ──
    if (!isGroup && !this._greetedContacts.has(contactId)) {
      this._greetedContacts.add(contactId);
      const greeting = "🤖 Hello! I am Kelion, an AI assistant. Please tell me your preferred language (e.g., English, Romanian, Spanish) so I can assist you better.\n\nSalut! Sunt Kelion, un asistent AI. Te rog spune-mi limba ta preferată pentru a te putea ajuta mai bine.";
      await msg.reply(greeting);
      // We continue processing their message normally after greeting
    }

    console.log(`[WhatsApp] ${isGroup ? `[${chatName}]` : '[DM]'} ${senderName}: ${question.slice(0, 100)}`);

    // ── Send to Kelion AI ──
    if (!this._chatHandler) {
      console.warn('[WhatsApp] No chat handler configured');
      return;
    }

    // Show "typing" indicator
    await chat.sendStateTyping();

    try {
      const response = await this._chatHandler(
        question, 
        senderName, 
        chatName, 
        isGroup, 
        { isTranslateMode, isFromAdmin: msg.fromMe, isExplicitTranslate }
      );

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
      lastError: this.lastError,
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
