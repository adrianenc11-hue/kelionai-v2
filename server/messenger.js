// KelionAI v2.4 — MESSENGER BOT (Full AI: Text + Audio + Video + Image + Documents)
// Webhook: configured via APP_URL env var
"use strict";

const express = require("express");
const crypto = require("crypto");
const fetch = require("node-fetch");
const logger = require("./logger");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { getVoiceId } = require("./config/voices");
const { MODELS } = require("./config/models");

const router = express.Router();

// ═══ TIMEOUT HELPER — prevents hanging on slow/dead APIs ═══
function withTimeout(promise, ms = 10000, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ═══ TOKEN HEALTH CHECK AT STARTUP ═══
if (process.env.FB_PAGE_ACCESS_TOKEN) {
  setTimeout(async () => {
    try {
      const res = await withTimeout(
        fetch("https://graph.facebook.com/v21.0/me?access_token=" + process.env.FB_PAGE_ACCESS_TOKEN),
        5000, "fb:tokenHealthCheck"
      );
      if (res.ok) {
        const data = await res.json();
        logger.info({ component: "Messenger", pageId: data.id, name: data.name }, "✅ Token VALID — Messenger ready");
      } else {
        const err = await res.text().catch(() => "(no body)");
        logger.error({ component: "Messenger", status: res.status, body: err }, "❌ Token INVALID or EXPIRED — Messenger will NOT work");
      }
    } catch (e) {
      logger.error({ component: "Messenger", err: e.message }, "❌ Token health check FAILED");
    }
  }, 4000);
}

// STATS (counters only — no unbounded Sets)
const stats = { messagesReceived: 0, repliesSent: 0, uniqueSenders: 0 };

// CONVERSATION CONTEXT — stored in Supabase messenger_messages
const MAX_CONTEXT_MESSAGES = 50;

async function addToHistory(senderId, from, text) {
  if (_supabase) {
    try {
      await _supabase.from("messenger_messages").insert({
        sender_id: senderId,
        role: from === "user" ? "user" : "assistant",
        content: (text || "").slice(0, 2000),
      });
    } catch (e) {
      logger.warn({ component: "Messenger", err: e.message }, "DB history write failed");
    }
  }
}

async function getContextSummary(senderId) {
  if (!_supabase) return "";
  try {
    const { data } = await _supabase
      .from("messenger_messages")
      .select("role, content")
      .eq("sender_id", senderId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_MESSAGES);
    if (!data || data.length === 0) return "";
    return data.reverse().map((h) => h.role + ": " + h.content).join("\n");
  } catch (e) {
    logger.warn({ component: "Messenger", err: e.message }, "DB history read failed");
    return "";
  }
}

// LRU cache for known users (max 50 entries, backed by Supabase)
const _userCache = new Map();
const _USER_CACHE_MAX = 50;
const FREE_MESSAGES_LIMIT = 15;

// FEATURE 6: SUBSCRIBER MANAGEMENT
const subscribedUsers = new Set();
const lastMessageTime = new Map();
let _supabase = null;

function setSupabase(client) {
  _supabase = client;
  // Restore subscribers from DB on startup
  if (client) {
    client
      .from("messenger_subscribers")
      .select("sender_id")
      .then(function (result) {
        if (result.data) {
          result.data.forEach(function (row) {
            subscribedUsers.add(row.sender_id);
          });
          if (subscribedUsers.size > 0)
            logger.info(
              { component: "Messenger", count: subscribedUsers.size },
              "Subscribers restored",
            );
        }
      })
      .catch(function (err) {
        logger.warn(
          { component: "Messenger", err: err && err.message },
          "Could not restore messenger_subscribers (table may not exist)",
        );
      });
  }
}

// TEMPORARY MEDIA BUFFERS (for TTS voice + image serving)
const mediaBuffers = new Map();

// Clean up expired media buffers every 10 minutes
setInterval(function () {
  const now = Date.now();
  mediaBuffers.forEach(function (entry, id) {
    if (now > entry.expiresAt) mediaBuffers.delete(id);
  });
}, 600000).unref();

async function getKnownUser(senderId, supabase) {
  // Check tiny LRU cache first
  if (_userCache.has(senderId)) return _userCache.get(senderId);
  const db = supabase || _supabase;
  if (db) {
    try {
      const { data } = await db
        .from("messenger_users")
        .select("*")
        .eq("sender_id", senderId)
        .single();
      if (data) {
        const user = {
          lang: data.language,
          name: data.name,
          firstSeen: data.first_seen,
          character: data.character || "kelion",
          messageCount: data.message_count || 0,
        };
        // LRU eviction
        if (_userCache.size >= _USER_CACHE_MAX) {
          const oldest = _userCache.keys().next().value;
          _userCache.delete(oldest);
        }
        _userCache.set(senderId, user);
        return user;
      }
    } catch (e) {
      logger.warn({ component: "Messenger", err: e.message }, "table may not exist");
    }
  }
  return null;
}

async function saveKnownUser(senderId, lang, name, supabase) {
  const db = supabase || _supabase;
  // Update cache
  const cached = _userCache.get(senderId) || {};
  const user = { ...cached, lang, name, firstSeen: cached.firstSeen || new Date().toISOString() };
  if (_userCache.size >= _USER_CACHE_MAX) {
    const oldest = _userCache.keys().next().value;
    _userCache.delete(oldest);
  }
  _userCache.set(senderId, user);
  if (db) {
    try {
      await db.from("messenger_users").upsert(
        {
          sender_id: senderId,
          language: lang,
          name: name || null,
          first_seen: user.firstSeen,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "sender_id" },
      );
    } catch (e) {
      logger.warn({ component: "Messenger", err: e.message }, "DB write failed");
    }
  }
}

// Character selection — stored in Supabase messenger_users.character
async function getChatCharacter(senderId) {
  const user = await getKnownUser(senderId, _supabase);
  return (user && user.character) || "kelion";
}

async function setChatCharacter(senderId, character) {
  // Update cache
  const cached = _userCache.get(senderId);
  if (cached) cached.character = character;
  if (_supabase) {
    try {
      await _supabase.from("messenger_users")
        .update({ character })
        .eq("sender_id", senderId);
    } catch (e) {
      logger.warn({ component: "Messenger", err: e.message }, "character update failed");
    }
  }
}

// Message count — stored in Supabase
async function getUserMessageCount(senderId) {
  const user = await getKnownUser(senderId, _supabase);
  return (user && user.messageCount) || 0;
}

async function incrementUserMessageCount(senderId) {
  const cached = _userCache.get(senderId);
  if (cached) cached.messageCount = (cached.messageCount || 0) + 1;
  if (_supabase) {
    try {
      await _supabase.rpc("increment_messenger_message_count", { p_sender_id: senderId }).catch(() => {
        // Fallback if RPC not available
        _supabase.from("messenger_users")
          .update({ message_count: (cached && cached.messageCount) || 1 })
          .eq("sender_id", senderId);
      });
    } catch (e) {
      logger.warn({ component: "Messenger", err: e.message }, "message count update failed");
    }
  }
}

// LANGUAGE DETECTION
function detectLanguage(text) {
  const t = (text || "").toLowerCase();
  // Script-based detection first (unambiguous)
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u0590-\u05FF]/.test(text)) return "he";
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  if (/[\u0400-\u04FF]/.test(text)) {
    if (/\b(я|ти|він|вона|ми|ви|вони|привіт|дякую|так|ні)\b/.test(text))
      return "uk";
    return "ru";
  }
  // Latin-based detection
  if (
    /\b(the|is|are|what|how|can|will|do|you|my|hi|hello|help|please)\b/.test(t)
  )
    return "en";
  if (
    /\b(și|sau|este|sunt|pentru|care|cum|unde|vreau|poți|bună|salut|mulțumesc)\b/.test(
      t,
    )
  )
    return "ro";
  if (
    /\b(ich|du|er|sie|wir|ist|sind|mit|für|auf|hallo|danke|bitte|wie|was)\b/.test(
      t,
    )
  )
    return "de";
  if (
    /\b(je|tu|il|elle|nous|est|avec|pour|dans|bonjour|merci|oui|non|comment)\b/.test(
      t,
    )
  )
    return "fr";
  if (/\b(yo|tú|él|ella|nosotros|hola|gracias|sí|cómo|para)\b/.test(t))
    return "es";
  if (/\b(io|tu|lui|lei|noi|ciao|grazie|sì|come|sono)\b/.test(t)) return "it";
  if (/\b(eu|tu|ele|ela|nós|olá|obrigado|sim|não|como|para)\b/.test(t))
    return "pt";
  if (/\b(ik|jij|hij|zij|wij|hallo|dank|ja|nee|hoe)\b/.test(t)) return "nl";
  if (/\b(ja|ty|on|ona|my|cześć|dziękuję|tak|nie|jak)\b/.test(t)) return "pl";
  if (/\b(ben|sen|bu|için|ile|merhaba|teşekkür|evet|hayır)\b/.test(t))
    return "tr";
  return "ro";
}

// RATE LIMITING — stays in memory (ephemeral, needs speed)
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const _RATE_LIMIT_MAX_ENTRIES = 200;
const senderRateLimits = new Map();

function isRateLimited(senderId) {
  const now = Date.now();
  const entry = senderRateLimits.get(senderId);
  if (!entry || now >= entry.resetAt) {
    // Evict expired entries if over limit
    if (senderRateLimits.size >= _RATE_LIMIT_MAX_ENTRIES) {
      for (const [k, v] of senderRateLimits) {
        if (now >= v.resetAt) senderRateLimits.delete(k);
        if (senderRateLimits.size < _RATE_LIMIT_MAX_ENTRIES) break;
      }
    }
    senderRateLimits.set(senderId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}

// ═══ ADMIN KEYWORD BLACKLIST ═══
const ADMIN_KEYWORDS =
  /\b(admin|administrator|dashboard|panou\s*admin|setări\s*admin|settings\s*admin|admin\s*panel|admin\s*mode|deschide\s*admin)\b/i;

// ═══ GROUP STATE — for smart intervention ═══
const messengerGroupState = new Map(); // chatId -> { lastActivity, unansweredQuestions, lastIntervention }
const GROUP_INTERVENTION_COOLDOWN = 5 * 60 * 1000;
const GROUP_PAUSE_THRESHOLD = 2 * 60 * 1000;

function _updateMessengerGroupState(chatId, text) {
  const state = messengerGroupState.get(chatId) || {
    lastActivity: 0,
    unansweredQuestions: [],
    lastIntervention: 0,
  };
  state.lastActivity = Date.now();
  if (text && text.trim().endsWith("?")) {
    state.unansweredQuestions.push({ text: text, time: Date.now() });
    if (state.unansweredQuestions.length > 5) state.unansweredQuestions.shift();
  }
  messengerGroupState.set(chatId, state);
}

function _messengerShouldIntervene(chatId, isDirectlyAddressed) {
  if (isDirectlyAddressed) return true;
  const state = messengerGroupState.get(chatId);
  if (!state) return false;
  if (
    state.lastIntervention &&
    Date.now() - state.lastIntervention < GROUP_INTERVENTION_COOLDOWN
  )
    return false;
  if (
    Date.now() - state.lastActivity > GROUP_PAUSE_THRESHOLD &&
    state.unansweredQuestions.length > 0
  )
    return true;
  return false;
}

function _getMessengerInterventionPrefix(lang) {
  const prefixes = {
    ro: "Scuzați că intervin, dar cred că pot ajuta cu asta... ",
    en: "Sorry to jump in, but I might be able to help with that... ",
    es: "Disculpen la interrupción, pero creo que puedo ayudar... ",
    fr: "Excusez-moi d'intervenir, mais je peux peut-être aider... ",
    de: "Entschuldigung, dass ich mich einmische, aber ich kann vielleicht helfen... ",
    it: "Scusate se mi intrometto, ma credo di poter aiutare... ",
    pt: "Desculpem a intromissão, mas talvez eu possa ajudar... ",
    nl: "Sorry dat ik me erbij mengt, maar ik kan misschien helpen... ",
    pl: "Przepraszam, że się wtrącam, ale może mogę pomóc... ",
    ru: "Извините, что вмешиваюсь, но я, возможно, могу помочь... ",
    ja: "割り込んですみませんが、お手伝いできるかもしれません... ",
    zh: "打扰一下，我或许可以帮上忙... ",
  };
  return prefixes[lang] || prefixes.en;
}

// GET SENDER PROFILE
async function getSenderProfile(senderId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/" +
      senderId +
      "?fields=first_name,last_name&access_token=" +
      token,
    ), 5000, "getSenderProfile");
    if (res.ok) {
      const data = await res.json();
      return data.first_name
        ? (data.first_name + " " + (data.last_name || "")).trim()
        : null;
    }
  } catch (e) {
    logger.warn(
      { component: "Messenger", senderId, err: e.message },
      "Failed to get sender profile",
    );
  }
  return null;
}

// DOWNLOAD MEDIA FROM URL
async function downloadMediaFromUrl(url) {
  try {
    const res = await withTimeout(fetch(url), 10000, "downloadMediaFromUrl");
    if (res.ok) {
      const ab = await withTimeout(res.arrayBuffer(), 10000, "downloadMediaFromUrl:readBody");
      return Buffer.from(ab);
    }
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "Media download failed",
    );
  }
  return null;
}

// ANALYZE IMAGE WITH GPT-5.4 VISION
async function analyzeImage(imageBuffer, caption, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey)
    return (
      caption || "I received an image but no vision API key is configured."
    );

  const base64Image = imageBuffer.toString("base64");
  const mediaType = mimeType || "image/jpeg";
  const userPrompt = caption
    ? 'Utilizatorul a trimis aceasta imagine cu textul: "' +
    caption +
    '". Descrie ce vezi, identifica persoane, obiecte, locuri, texte.'
    : "Descrie in detaliu ce vezi in aceasta imagine. Identifica persoane, obiecte, locuri, texte vizibile, culori, actiuni.";

  try {
    const res = await withTimeout(fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.OPENAI_VISION,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              {
                type: "image_url",
                image_url: {
                  url: "data:" + mediaType + ";base64," + base64Image,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      }),
    }), 25000, "analyzeImage");
    if (res.ok) {
      const data = await res.json();
      return (
        (data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content) ||
        "Am vazut imaginea."
      );
    }
  } catch (e) {
    logger.error({ component: "Messenger", err: e.message }, "Vision error");
  }
  return "Nu am putut analiza imaginea momentan.";
}

// TRANSCRIBE AUDIO (Whisper)
async function transcribeAudio(audioBuffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = process.env.GROQ_API_KEY
    ? "https://api.groq.com/openai/v1"
    : "https://api.openai.com/v1";
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "audio.mp4",
    contentType: mimeType || "audio/mp4",
  });
  form.append(
    "model",
    process.env.GROQ_API_KEY ? MODELS.WHISPER : MODELS.OPENAI_WHISPER,
  );
  try {
    const res = await withTimeout(fetch(baseUrl + "/audio/transcriptions", {
      method: "POST",
      headers: Object.assign(
        { Authorization: "Bearer " + apiKey },
        form.getHeaders(),
      ),
      body: form,
    }), 20000, "transcribeAudio");
    if (res.ok) {
      const data = await res.json();
      return data.text || "";
    }
  } catch (e) {
    logger.error({ component: "Messenger", err: e.message }, "STT failed");
  }
  return null;
}

// FEATURE 1: EXTRACT DOCUMENT TEXT
async function extractDocumentText(buffer, mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  try {
    if (mimeType === "application/pdf" || ext === "pdf") {
      const data = await pdfParse(buffer);
      return (data.text || "").slice(0, 3000);
    }
    if (
      mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const result = await mammoth.extractRawText({ buffer: buffer });
      return (result.value || "").slice(0, 3000);
    }
    if (
      ["txt", "csv", "json", "md"].includes(ext) ||
      (mimeType && mimeType.startsWith("text/"))
    ) {
      return buffer.toString("utf8").slice(0, 3000);
    }
  } catch (e) {
    logger.warn(
      { component: "Messenger", err: e.message },
      "Document extraction failed",
    );
  }
  return null;
}

// SEND MESSAGE (Feature 5: optional quickReplies)
async function sendMessage(recipientId, text, quickReplies) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  const message = { text: text.slice(0, 2000) };
  if (quickReplies && quickReplies.length > 0) {
    message.quick_replies = quickReplies
      .map(function (qr) {
        if (typeof qr === "string") {
          return {
            content_type: "text",
            title: qr.slice(0, 20),
            payload: qr.toUpperCase().replace(/[^A-Z0-9]/g, "_"),
          };
        }
        return qr;
      })
      .slice(0, 13);
  }
  const res = await withTimeout(fetch(
    "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: message,
      }),
    },
  ), 10000, "sendMessage");
  if (!res.ok) {
    const body = await res.text();
    logger.error(
      { component: "Messenger", status: res.status, body: body },
      "Send failed",
    );
  }
}

// SEND TYPING INDICATOR
async function sendTypingOn(recipientId) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  try {
    await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          sender_action: "typing_on",
        }),
      },
    ), 5000, "sendTypingOn");
  } catch (e) {
    logger.warn(
      { component: "Messenger", err: e.message },
      "sendTypingOn failed",
    );
  }
}

// FEATURE 2: SEND AUDIO MESSAGE
async function sendAudioMessage(recipientId, audioUrl) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "audio",
              payload: { url: audioUrl, is_reusable: true },
            },
          },
        }),
      },
    ), 10000, "sendAudioMessage");
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { component: "Messenger", status: res.status, body: body },
        "Audio send failed",
      );
    }
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "sendAudioMessage error",
    );
  }
}

// FEATURE 2: GENERATE AND SEND VOICE REPLY
async function generateAndSendVoice(recipientId, text, character) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return;
  const appUrl = process.env.APP_URL;
  try {
    const voiceId = getVoiceId(character);
    const res = await withTimeout(fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + voiceId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        body: JSON.stringify({
          text: text.slice(0, 500),
          model_id: MODELS.ELEVENLABS_MODEL,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    ), 12000, "generateVoice:elevenlabs");
    if (!res.ok) return;
    const audioBuffer = Buffer.from(await withTimeout(res.arrayBuffer(), 10000, "generateVoice:readBody"));
    const audioId = crypto.randomBytes(16).toString("hex");
    mediaBuffers.set(audioId, {
      buffer: audioBuffer,
      contentType: "audio/mpeg",
      expiresAt: Date.now() + 3600000,
    });
    const audioUrl = appUrl + "/api/messenger/media/" + audioId;
    await sendAudioMessage(recipientId, audioUrl);
    logger.info(
      { component: "Messenger", recipientId: recipientId },
      "Voice reply sent",
    );
  } catch (e) {
    logger.warn(
      { component: "Messenger", err: e.message },
      "Voice generation failed",
    );
  }
}

// FEATURE 3: SEND IMAGE MESSAGE
async function sendImageMessage(recipientId, imageUrl) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "image",
              payload: { url: imageUrl, is_reusable: true },
            },
          },
        }),
      },
    ), 10000, "sendImageMessage");
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { component: "Messenger", status: res.status, body: body },
        "Image send failed",
      );
    }
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "sendImageMessage error",
    );
  }
}

// FEATURE 3: SEND GENERIC TEMPLATE (Carousel)
async function sendGenericTemplate(recipientId, elements) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: elements.slice(0, 10),
              },
            },
          },
        }),
      },
    ), 10000, "sendGenericTemplate");
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { component: "Messenger", status: res.status, body: body },
        "Generic template send failed",
      );
    }
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "sendGenericTemplate error",
    );
  }
}

// FEATURE 3: SEND BUTTON TEMPLATE
async function _sendButtonTemplate(recipientId, text, buttons) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return;
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messages?access_token=" + token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: text.slice(0, 640),
                buttons: buttons.slice(0, 3),
              },
            },
          },
        }),
      },
    ), 10000, "sendButtonTemplate");
    if (!res.ok) {
      const body = await res.text();
      logger.error(
        { component: "Messenger", status: res.status, body: body },
        "Button template send failed",
      );
    }
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "sendButtonTemplate error",
    );
  }
}

// FEATURE 4: SETUP PERSISTENT MENU
async function setupPersistentMenu() {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token) return { error: "No page token configured" };
  try {
    const res = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me/messenger_profile?access_token=" +
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persistent_menu: [
            {
              locale: "default",
              composer_input_disabled: false,
              call_to_actions: [
                {
                  type: "postback",
                  title: "🤖 Kelion",
                  payload: "SWITCH_KELION",
                },
                { type: "postback", title: "👩‍💻 Kira", payload: "SWITCH_KIRA" },
                {
                  type: "web_url",
                  title: "🌐 KelionAI",
                  url: process.env.APP_URL,
                },
                { type: "postback", title: "📰 Știri", payload: "GET_NEWS" },
                { type: "postback", title: "❓ Ajutor", payload: "GET_HELP" },
              ],
            },
          ],
        }),
      },
    ), 10000, "setupPersistentMenu");
    const data = await res.json();
    logger.info(
      { component: "Messenger", result: data },
      "Persistent menu set up",
    );
    return data;
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "setupPersistentMenu failed",
    );
    return { error: e.message };
  }
}

// FEATURE 4: HANDLE POSTBACK EVENTS
async function handlePostback(senderId, payload, appLocals) {
  try {
    if (payload === "SWITCH_KELION") {
      await setChatCharacter(senderId, "kelion");
      await sendMessage(senderId, "🤖 Kelion este acum asistentul tau!", [
        "💬 Chat",
        "📰 Știri",
        "🌤️ Meteo",
      ]);
    } else if (payload === "SWITCH_KIRA") {
      await setChatCharacter(senderId, "kira");
      await sendMessage(senderId, "👩‍💻 Kira este acum asistenta ta!", [
        "💬 Chat",
        "📰 Știri",
        "🌤️ Meteo",
      ]);
    } else if (payload === "GET_NEWS") {
      const getArticles = appLocals && appLocals._getNewsArticles;
      const articles = getArticles ? getArticles() : [];
      if (articles && articles.length > 0) {
        await sendMessage(senderId, "📰 Ultimele stiri:");
        await sendGenericTemplate(
          senderId,
          buildNewsElements(articles.slice(0, 3)),
        );
      } else {
        await sendMessage(
          senderId,
          "📰 Nu am stiri disponibile momentan. Revino curand!",
        );
      }
    } else if (payload === "GET_HELP") {
      await sendMessage(
        senderId,
        "❓ Cum te pot ajuta:\n\n" +
        "📝 Trimite text — raspund intrebarii tale\n" +
        "🖼️ Trimite imagine — analizez poza\n" +
        "🎤 Trimite mesaj vocal — transcriu si raspund\n" +
        "📄 Trimite document — extrag si analizez textul\n" +
        '📰 Scrie "stiri" — iti trimit ultimele stiri\n' +
        '🤖 Scrie "kelion" sau "kira" — schimba asistentul\n' +
        '🔔 Scrie "aboneaza-ma" — notificari stiri\n\n' +
        `🌐 Mai multe pe ${process.env.APP_URL}`,
        ["💬 Chat", "📰 Știri", "🌐 Site"],
      );
    }
  } catch (e) {
    logger.warn(
      {
        component: "Messenger",
        senderId: senderId,
        payload: payload,
        err: e.message,
      },
      "Postback handling failed",
    );
  }
}

// HELPER: BUILD NEWS CAROUSEL ELEMENTS
function buildNewsElements(articles) {
  return articles.map(function (a) {
    return {
      title: (a.title || "Știre").slice(0, 80),
      subtitle: (a.description || a.summary || "").slice(0, 80),
      image_url: a.image || a.imageUrl || (process.env.APP_URL + "/og-image.jpg"),
      default_action: {
        type: "web_url",
        url: a.url || a.link || process.env.APP_URL,
      },
      buttons: [
        {
          type: "web_url",
          title: "🔗 Citeste",
          url: a.url || a.link || process.env.APP_URL,
        },
      ],
    };
  });
}

// FEATURE 6: BROADCAST TO SUBSCRIBERS
async function _broadcastToSubscribers(message, quickReplies) {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  let sent = 0;
  for (const userId of subscribedUsers) {
    const lastMsg = lastMessageTime.get(userId) || 0;
    if (now - lastMsg > windowMs) continue;
    try {
      await sendMessage(userId, message, quickReplies);
      sent++;
    } catch (e) {
      logger.warn(
        { component: "Messenger", userId: userId, err: e.message },
        "Broadcast to subscriber failed",
      );
    }
  }
  return sent;
}

// FEATURE 6: NOTIFY SUBSCRIBERS WITH NEWS (exported for index.js)
async function notifySubscribersNews(articles) {
  if (!articles || articles.length === 0) return;
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const top3 = articles.slice(0, 3);
  const elements = buildNewsElements(top3);
  const targets = Array.from(subscribedUsers);
  for (let i = 0; i < targets.length; i++) {
    const userId = targets[i];
    const lastMsg = lastMessageTime.get(userId) || 0;
    if (now - lastMsg > windowMs) continue;
    try {
      await sendMessage(userId, "📰 Stiri noi pentru tine:");
      await sendGenericTemplate(userId, elements);
      logger.info(
        { component: "Messenger", userId: userId },
        "News notification sent",
      );
    } catch (e) {
      logger.warn(
        { component: "Messenger", userId: userId, err: e.message },
        "News notification failed",
      );
    }
  }
}

// GENERATE IMAGE VIA DALL-E 3
async function generateImage(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await withTimeout(fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.DALL_E,
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        response_format: "url",
      }),
    }), 30000, "generateImage:DALL-E");
    if (res.ok) {
      const data = await res.json();
      return data.data && data.data[0] && data.data[0].url;
    }
  } catch (e) {
    logger.warn(
      { component: "Messenger", err: e.message },
      "Image generation failed",
    );
  }
  return null;
}

// SERVE TEMPORARY MEDIA BUFFERS (audio/images)
router.get("/media/:id", function (req, res) {
  const entry = mediaBuffers.get(req.params.id);
  if (!entry || Date.now() > entry.expiresAt)
    return res.status(404).send("Not found");
  res.set("Content-Type", entry.contentType);
  res.send(entry.buffer);
});

// WEBHOOK VERIFICATION
router.get("/webhook", function (req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const verifyToken = process.env.FB_VERIFY_TOKEN || process.env.MESSENGER_VERIFY_TOKEN || "kelionai_verify_2024";
  if (mode === "subscribe" && token === verifyToken) {
    logger.info({ component: "Messenger" }, "Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ═══ AUTO-SUBSCRIBE PAGE TO WEBHOOKS ═══
router.get("/subscribe", async function (req, res) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!token)
    return res.status(500).json({ error: "FB_PAGE_ACCESS_TOKEN not set" });
  try {
    const meRes = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/me?access_token=" + token,
    ), 10000, "subscribe:getPageId");
    const me = await meRes.json();
    if (!me.id)
      return res.status(500).json({ error: "Cannot get page ID", details: me });
    const subRes = await withTimeout(fetch(
      "https://graph.facebook.com/v21.0/" + me.id + "/subscribed_apps",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields:
            "messages,messaging_postbacks,message_deliveries,message_reads",
          access_token: token,
        }),
      },
    ), 10000, "subscribe:subscribeApps");
    const result = await subRes.json();
    logger.info(
      { component: "Messenger", pageId: me.id, result: result },
      "Webhook subscription result",
    );
    res.json({ success: result.success, pageId: me.id, pageName: me.name });
  } catch (e) {
    logger.error(
      { component: "Messenger", err: e.message },
      "Subscribe failed",
    );
    res.status(500).json({ error: e.message });
  }
});

// FEATURE 4: SETUP MENU ENDPOINT
router.get("/setup-menu", async function (req, res) {
  const result = await setupPersistentMenu();
  res.json(result);
});

// INCOMING MESSAGE HANDLER
router.post("/webhook", async function (req, res) {
  res.sendStatus(200);
  try {
    // CRITICAL: req.body should be a Buffer because of express.raw() in index.js
    // Handle both raw Buffer and already-parsed JSON (defensive)
    let rawBody, body;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
      body = JSON.parse(rawBody.toString());
    } else if (typeof req.body === "string") {
      rawBody = Buffer.from(req.body);
      body = JSON.parse(req.body);
    } else if (req.body && typeof req.body === "object") {
      // Already parsed by express.json()
      rawBody = Buffer.from(JSON.stringify(req.body));
      body = req.body;
    } else {
      logger.warn({ component: "Messenger" }, "Empty or missing body");
      return;
    }

    // HMAC-SHA256 validation
    const appSecret = process.env.FB_APP_SECRET;
    if (appSecret) {
      const sig = req.headers["x-hub-signature-256"];
      if (!sig) {
        logger.warn({ component: "Messenger" }, "Missing signature");
        return;
      }
      const expected =
        "sha256=" +
        crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
      if (
        sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
      ) {
        logger.warn({ component: "Messenger" }, "Invalid signature");
        return;
      }
    }

    if (body.object !== "page") return;

    for (let e = 0; e < (body.entry || []).length; e++) {
      const entry = body.entry[e];
      for (let m = 0; m < (entry.messaging || []).length; m++) {
        const event = entry.messaging[m];
        const senderId = event.sender && event.sender.id;
        if (!senderId) continue;

        // FEATURE 4: HANDLE POSTBACK EVENTS
        if (event.postback) {
          lastMessageTime.set(senderId, Date.now());
          await handlePostback(
            senderId,
            event.postback.payload,
            req.app.locals,
          );
          stats.messagesReceived++;
          stats.uniqueSenders++;
          stats.repliesSent++;
          continue;
        }

        const message = event.message;
        if (!message || message.is_echo) continue;

        stats.messagesReceived++;
        stats.uniqueSenders++;
        lastMessageTime.set(senderId, Date.now());
        if (isRateLimited(senderId)) continue;

        await sendTypingOn(senderId);

        let userText = "";
        let visionResponse = null;
        const attachments = message.attachments || [];
        let receivedAudio = false;

        // FEATURE 5: HANDLE QUICK REPLY PAYLOAD
        if (message.quick_reply && message.quick_reply.payload) {
          const qrPayload = message.quick_reply.payload;
          if (
            qrPayload === "SWITCH_KELION" ||
            qrPayload === "SWITCH_KIRA" ||
            qrPayload === "GET_NEWS" ||
            qrPayload === "GET_HELP"
          ) {
            await handlePostback(senderId, qrPayload, req.app.locals);
            stats.repliesSent++;
            continue;
          }
          // Use payload as text if it doesn't match a known command
          if (!message.text) userText = qrPayload;
        }

        // HANDLE TEXT
        if (message.text) {
          userText = message.text;
        }

        // HANDLE ATTACHMENTS (image, audio, video, file)
        for (let a = 0; a < attachments.length; a++) {
          const att = attachments[a];
          const attType = att.type;
          const attUrl = att.payload && att.payload.url;
          if (!attUrl) continue;

          if (attType === "image") {
            const imgBuffer = await downloadMediaFromUrl(attUrl);
            if (imgBuffer) {
              visionResponse = await analyzeImage(
                imgBuffer,
                message.text || null,
                "image/jpeg",
              );
              if (!userText) userText = "Am trimis o imagine";
            }
          } else if (attType === "audio") {
            receivedAudio = true;
            const audBuffer = await downloadMediaFromUrl(attUrl);
            if (audBuffer) {
              const transcript = await transcribeAudio(audBuffer, "audio/mp4");
              if (transcript) {
                userText = transcript;
              } else {
                userText = "[Voice message - could not transcribe]";
              }
            }
          } else if (attType === "video") {
            const vidBuffer = await downloadMediaFromUrl(attUrl);
            if (vidBuffer) {
              const vidTranscript = await transcribeAudio(
                vidBuffer,
                "video/mp4",
              );
              if (vidTranscript) {
                visionResponse =
                  'Am analizat videoclipul tau. Am auzit: "' +
                  vidTranscript +
                  '"';
              } else {
                visionResponse =
                  "Am primit videoclipul dar nu am putut extrage continut.";
              }
              if (!userText) userText = "Am trimis un videoclip";
            }
          } else if (attType === "file") {
            // FEATURE 1: DOCUMENT TEXT ANALYSIS
            const fileBuffer = await downloadMediaFromUrl(attUrl);
            if (fileBuffer) {
              const fileName = (att.payload && att.payload.name) || "";
              const fileMime = (att.payload && att.payload.mime_type) || "";
              const extractedText = await extractDocumentText(
                fileBuffer,
                fileMime,
                fileName,
              );
              if (extractedText) {
                if (!userText) userText = "Am trimis un document";
                visionResponse = null; // will use AI for document
                userText =
                  "Analizeaza urmatorul continut din documentul meu:\n\n" +
                  extractedText;
              } else {
                if (!userText) userText = "Am trimis un document";
                visionResponse =
                  "Am primit documentul. Formatul nu este suportat momentan (suport: PDF, DOCX, TXT, CSV, JSON, MD).";
              }
            } else {
              if (!userText) userText = "Am trimis un document";
              visionResponse =
                "Nu am putut descarca documentul. Te rog incearca din nou.";
            }
          }
        }

        if (!userText && !visionResponse) continue;

        // ADMIN KEYWORD BLACKLIST — total silence for non-owners
        if (userText && ADMIN_KEYWORDS.test(userText)) continue;

        // GET SENDER NAME
        const senderName = (await getSenderProfile(senderId)) || "User";
        addToHistory(senderId, senderName, userText);

        // CHARACTER SELECTION
        if (/^(kelion|kira)$/i.test((userText || "").trim())) {
          const charName = userText.trim().toLowerCase();
          await setChatCharacter(senderId, charName);
          const displayName = charName === "kelion" ? "Kelion" : "Kira";
          await sendMessage(
            senderId,
            (charName === "kelion" ? "🤖 " : "👩‍💻 ") +
            displayName +
            " este acum asistentul tau. Cu ce te pot ajuta?",
            ["💬 Chat", "📰 Știri", "🌤️ Meteo"],
          );
          stats.repliesSent++;
          continue;
        }

        // FEATURE 6: SUBSCRIBE / UNSUBSCRIBE
        const supabase =
          req.app.locals.supabaseAdmin || req.app.locals.supabase;
        const textLower = (userText || "").toLowerCase().trim();
        if (/^(subscribe|aboneaza-ma|notificari)$/i.test(textLower)) {
          subscribedUsers.add(senderId);
          if (supabase) {
            try {
              await supabase.from("messenger_subscribers").upsert(
                {
                  sender_id: senderId,
                  subscribed_at: new Date().toISOString(),
                },
                { onConflict: "sender_id" },
              );
            } catch (ex) {
              logger.warn(
                { component: "Messenger", err: ex.message },
                "table may not exist",
              );
            }
          }
          await sendMessage(
            senderId,
            '✅ Esti abonat la notificari de stiri! Vei fi notificat cand apar stiri noi.\n\nScrie "dezaboneaza-ma" oricand pentru a opri notificarile.',
          );
          stats.repliesSent++;
          continue;
        }
        if (/^(unsubscribe|dezaboneaza-ma)$/i.test(textLower)) {
          subscribedUsers.delete(senderId);
          if (supabase) {
            try {
              await supabase
                .from("messenger_subscribers")
                .delete()
                .eq("sender_id", senderId);
            } catch (ex) {
              logger.warn(
                { component: "Messenger", err: ex.message },
                "table may not exist",
              );
            }
          }
          await sendMessage(
            senderId,
            "❌ Ai fost dezabonat de la notificari. Ne vedem curand! 👋",
          );
          stats.repliesSent++;
          continue;
        }

        // NEWS REQUEST — show carousel
        if (/\b(stiri|news|noutati|ultimele\s+stiri)\b/i.test(textLower)) {
          const getArticles = req.app.locals._getNewsArticles;
          const articles = getArticles ? getArticles() : [];
          if (articles && articles.length > 0) {
            await sendMessage(senderId, "📰 Ultimele stiri:");
            await sendGenericTemplate(
              senderId,
              buildNewsElements(articles.slice(0, 3)),
            );
            addToHistory(
              senderId,
              (await getChatCharacter(senderId)) === "kira" ? "Kira" : "Kelion",
              "Stiri trimise",
            );
            stats.repliesSent++;
            continue;
          }
        }

        const character = (await getChatCharacter(senderId)) || "kelion";

        // IMAGE GENERATION REQUEST (Feature 3)
        if (
          !visionResponse &&
          /\b(genereaz[aă]\s+imagine|generate\s+image|creeaz[aă]\s+(o\s+)?imagine|deseneaz[aă])\b/i.test(
            userText,
          )
        ) {
          const imageUrl = await generateImage(userText);
          if (imageUrl) {
            await sendMessage(
              senderId,
              "🎨 Iata imaginea generata pentru tine!",
            );
            await sendImageMessage(senderId, imageUrl);
            addToHistory(
              senderId,
              character === "kira" ? "Kira" : "Kelion",
              "Imagine generata",
            );
            stats.repliesSent++;
            continue;
          }
        }

        // AI RESPONSE
        let reply;
        const detectedLangForReply = detectLanguage(userText || "");
        if (visionResponse) {
          reply = visionResponse;
        } else {
          const brain = req.app.locals.brain;
          const context = await getContextSummary(senderId);
          const prompt = context
            ? "[Context:\n" + context + "]\nUser: " + userText
            : userText;

          if (brain) {
            try {
              const timeout = new Promise(function (_, reject) {
                setTimeout(function () {
                  reject(new Error("Brain timeout"));
                }, 20000);
              });
              const result = await Promise.race([
                brain.think(
                  prompt,
                  character,
                  [],
                  detectedLangForReply || "auto",
                ),
                timeout,
              ]);
              reply =
                (result && result.enrichedMessage) ||
                "Nu am putut procesa mesajul.";
            } catch (err) {
              logger.warn(
                { component: "Messenger", err: err.message },
                "Brain error",
              );
              reply = "Momentan sunt ocupat. Incearca din nou.";
            }
          } else {
            reply = `Sunt KelionAI! Viziteaza ${process.env.APP_URL}`;
          }
        }

        // DETERMINE QUICK REPLIES FOR RESPONSE
        const msgCount = await incrementUserMessageCount(senderId);
        let replyQuickReplies;
        if (msgCount === FREE_MESSAGES_LIMIT) {
          replyQuickReplies = ["💎 Upgrade", "🌐 Site"];
        }

        await sendMessage(senderId, reply, replyQuickReplies);
        addToHistory(senderId, character === "kira" ? "Kira" : "Kelion", reply);
        stats.repliesSent++;

        // ═══ BRAIN INTEGRATION — save chat memory ═══
        const brainRef = req.app.locals.brain;
        if (brainRef) {
          brainRef.saveMemory(null, "text", "Messenger " + (senderName || senderId) + ": " + (userText || "").substring(0, 200) + " | Reply: " + reply.substring(0, 300), {
            platform: "messenger", character
          }).catch(() => { });
        }

        // FEATURE 2: VOICE REPLY when user sent audio
        if (receivedAudio) {
          await generateAndSendVoice(senderId, reply, character);
        }

        // USER PROTOCOL
        const known = await getKnownUser(senderId, supabase);

        if (!known) {
          const detectedLang = detectLanguage(userText || "");
          await saveKnownUser(senderId, detectedLang, senderName, supabase);
          // FEATURE 5: Quick replies for new users
          setTimeout(async function () {
            try {
              await sendMessage(
                senderId,
                "👋 Bun venit! Sunt " +
                (character === "kira" ? "Kira" : "Kelion") +
                ", asistentul tau AI.\n\nCe doresti sa faci?",
                ["🤖 Kelion", "👩‍💻 Kira", "📰 Știri", "❓ Ajutor"],
              );
            } catch (ex) {
              logger.warn(
                { component: "Messenger", err: ex.message },
                "Welcome message failed",
              );
            }
          }, 1500);
        } else {
          if (msgCount === 1) {
            const greetings = {
              ro: "Bine ai revenit, " + (known.name || "prietene") + "! 😊",
              en: "Welcome back, " + (known.name || "friend") + "! 😊",
              de: "Willkommen zuruck, " + (known.name || "Freund") + "! 😊",
              fr: "Bon retour, " + (known.name || "ami") + "! 😊",
              es: "Bienvenido de nuevo, " + (known.name || "amigo") + "! 😊",
            };
            setTimeout(async function () {
              try {
                await sendMessage(
                  senderId,
                  greetings[known.lang] || greetings.en,
                );
              } catch (ex) {
                logger.warn(
                  { component: "Messenger", err: ex.message },
                  "Return greeting failed",
                );
              }
            }, 1000);
          }
          const newLang = detectLanguage(userText || "");
          if (newLang !== known.lang) {
            await saveKnownUser(senderId, newLang, known.name, supabase);
          }
        }

        if (msgCount === FREE_MESSAGES_LIMIT) {
          setTimeout(async function () {
            try {
              await sendMessage(
                senderId,
                "Ai folosit " +
                FREE_MESSAGES_LIMIT +
                " mesaje gratuite!\n\n" +
                `Continua cu functii premium pe ${process.env.APP_URL}:\n` +
                "Chat nelimitat cu AI\nAvatare 3D\nVoce naturala\n\n" +
                `Aboneaza-te: ${process.env.APP_URL}/pricing`,
                ["💎 Upgrade", "🌐 Site"],
              );
            } catch (ex) {
              logger.warn(
                { component: "Messenger", err: ex.message },
                "Free limit message failed",
              );
            }
          }, 3000);
        }

        // SAVE TO SUPABASE
        if (supabase) {
          try {
            await supabase.from("messenger_messages").insert({
              sender_id: senderId,
              direction: "in",
              message_type:
                attachments.length > 0 ? attachments[0].type : "text",
              text: userText,
              created_at: new Date().toISOString(),
            });
            await supabase.from("messenger_messages").insert({
              sender_id: senderId,
              direction: "out",
              message_type: "text",
              text: reply,
              created_at: new Date().toISOString(),
            });
          } catch (ex) {
            logger.warn(
              { component: "Messenger", err: ex.message },
              "table may not exist",
            );
          }
        }
      }
    }
  } catch (ex) {
    logger.error(
      { component: "Messenger", err: ex.message },
      "Webhook handler error",
    );
  }
});

// HEALTH
router.get("/health", function (req, res) {
  res.json({
    status:
      process.env.FB_PAGE_ACCESS_TOKEN && process.env.FB_APP_SECRET
        ? "configured"
        : "misconfigured",
    hasPageToken: !!process.env.FB_PAGE_ACCESS_TOKEN,
    hasAppSecret: !!process.env.FB_APP_SECRET,
    hasVerifyToken: !!(process.env.FB_VERIFY_TOKEN || process.env.MESSENGER_VERIFY_TOKEN || true),
    graphApiVersion: "v21.0",
    visionEnabled: !!process.env.OPENAI_API_KEY,
    sttEnabled: !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY),
    ttsEnabled: !!process.env.ELEVENLABS_API_KEY,
    stats: getStats(),
    webhookUrl:
      (process.env.APP_URL) +
      "/api/messenger/webhook",
  });
});

function getStats() {
  return {
    messagesReceived: stats.messagesReceived,
    repliesSent: stats.repliesSent,
    activeSenders: stats.uniqueSenders,
    subscribers: subscribedUsers.size,
  };
}

module.exports = {
  router,
  getStats,
  notifySubscribersNews,
  setupPersistentMenu,
  setSupabase,
};
