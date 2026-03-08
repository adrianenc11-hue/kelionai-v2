// ═══════════════════════════════════════════════════════════════
// KelionAI v2.5 — WHATSAPP BOT (Cloud API)
// Text + Audio (STT/TTS) + Video (camera analysis)
// Webhook: configured via APP_URL env var
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const _crypto = require("crypto");
const fetch = require("node-fetch");
const FormData = require("form-data");
const logger = require("./logger");
const { getVoiceId } = require("./config/voices");
const { MODELS } = require("./config/models");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const router = express.Router();

// ═══ CONFIG ═══
const PHONE_NUMBER_ID =
  process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_TOKEN =
  process.env.WA_ACCESS_TOKEN ||
  process.env.WHATSAPP_TOKEN ||
  process.env.WHATSAPP_ACCESS_TOKEN;
const WA_VERIFY_TOKEN =
  process.env.WA_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || null;
const GRAPH_API = "https://graph.facebook.com/v21.0";

// ═══ TIMEOUT HELPER — prevents hanging on slow/dead APIs ═══
function withTimeout(promise, ms = 10000, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

// ═══ STATS (counters only — no unbounded Sets) ═══
const stats = { messagesReceived: 0, repliesSent: 0, uniqueUsers: 0 };

// ═══ STARTUP VALIDATION ═══
if (!WA_TOKEN) {
  logger.warn(
    { component: "WhatsApp" },
    "WhatsApp token not set. Set WA_ACCESS_TOKEN (or WHATSAPP_TOKEN) — bot will not send messages",
  );
}
if (!PHONE_NUMBER_ID) {
  logger.warn(
    { component: "WhatsApp" },
    "WhatsApp Phone Number ID not set. Set WA_PHONE_NUMBER_ID — bot will not send messages",
  );
}
if (!WA_VERIFY_TOKEN) {
  logger.warn(
    { component: "WhatsApp" },
    "WA_VERIFY_TOKEN not set — webhook verification is DISABLED. Set WA_VERIFY_TOKEN env var to enable it.",
  );
}

// ═══ ADMIN OUTBOUND MESSAGE ENDPOINT ═══
router.post("/send", express.json(), async (req, res) => {
  // Simple auth via x-admin-secret
  const adminSecret = req.headers["x-admin-secret"];
  const expectedAdminSecret = process.env.ADMIN_SECRET;

  if (!expectedAdminSecret || adminSecret !== expectedAdminSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { to, text } = req.body;
  if (!to || !text) {
    return res.status(400).json({ error: "Missing 'to' or 'text' in body" });
  }

  try {
    await sendTextMessage(to, text);
    res.json({ success: true, to, text });
  } catch (e) {
    logger.error({ component: "WhatsApp", err: e.message }, "Manual send error");
    res.status(500).json({ error: "Send failed", details: e.message });
  }
});

// ═══ CHARACTER SELECTION — backed by Supabase whatsapp_users.character ═══

// ═══ CONVERSATION CONTEXT — stored in Supabase whatsapp_messages ═══
const MAX_CONTEXT_MESSAGES = 50;
let _supabase = null;

function setSupabase(client) { _supabase = client; }

async function addToHistory(chatId, from, text) {
  if (_supabase) {
    try {
      await _supabase.from("whatsapp_messages").insert({
        phone: chatId,
        role: from === "user" ? "user" : "assistant",
        content: (text || "").slice(0, 2000),
      });
    } catch (e) {
      logger.warn({ component: "WhatsApp", err: e.message }, "DB history write failed");
    }
  }
}

async function getContextSummary(chatId) {
  if (!_supabase) return "";
  try {
    const { data } = await _supabase
      .from("whatsapp_messages")
      .select("role, content")
      .eq("phone", chatId)
      .order("created_at", { ascending: false })
      .limit(MAX_CONTEXT_MESSAGES);
    if (!data || data.length === 0) return "";
    return data.reverse().map((h) => h.role + ": " + h.content).join("\n");
  } catch (e) {
    logger.warn({ component: "WhatsApp", err: e.message }, "DB history read failed");
    return "";
  }
}

// ═══ CHECK IF BOT IS ADDRESSED ═══
function getAddressedCharacter(text) {
  const lower = (text || "").toLowerCase();
  if (/\b(kira)\b/.test(lower)) return "kira";
  if (/\b(kelion)\b/.test(lower)) return "kelion";
  return null;
}

function isGroupChat(msg) {
  return msg && msg.from && msg.from.includes("-");
}

// ═══ RATE LIMITING — stays in memory (ephemeral) ═══
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const _RATE_LIMIT_MAX_ENTRIES = 200;
const userRateLimits = new Map();

// LRU cache for known users (max 50, backed by Supabase)
const _userCache = new Map();
const _USER_CACHE_MAX = 50;
const FREE_MESSAGES_LIMIT = 15;

// ═══ KNOWN USERS — backed by Supabase whatsapp_users ═══
const knownUsers = null; // REMOVED — use _userCache + Supabase

async function getKnownUser(phoneNumber, supabase) {
  if (_userCache.has(phoneNumber)) return _userCache.get(phoneNumber);
  const db = supabase || _supabase;
  if (db) {
    try {
      const { data } = await db
        .from("whatsapp_users")
        .select("*")
        .eq("phone", phoneNumber)
        .single();
      if (data) {
        const user = {
          lang: data.language,
          name: data.name,
          firstSeen: data.created_at,
          character: data.character || "kelion",
          messageCount: data.message_count || 0,
        };
        if (_userCache.size >= _USER_CACHE_MAX) {
          const oldest = _userCache.keys().next().value;
          _userCache.delete(oldest);
        }
        _userCache.set(phoneNumber, user);
        return user;
      }
    } catch (e) {
      logger.warn({ component: "WhatsApp", err: e.message }, "table may not exist");
    }
  }
  return null;
}

async function saveKnownUser(phoneNumber, lang, name, supabase) {
  const db = supabase || _supabase;
  const cached = _userCache.get(phoneNumber) || {};
  const user = { ...cached, lang, name, firstSeen: cached.firstSeen || new Date().toISOString() };
  if (_userCache.size >= _USER_CACHE_MAX) {
    const oldest = _userCache.keys().next().value;
    _userCache.delete(oldest);
  }
  _userCache.set(phoneNumber, user);
  if (db) {
    try {
      await db.from("whatsapp_users").upsert(
        {
          phone: phoneNumber,
          language: lang,
          name: name || null,
          created_at: user.firstSeen,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "phone" },
      );
    } catch (e) {
      logger.warn({ component: "WhatsApp", err: e.message }, "DB write failed");
    }
  }
}

// ═══ AUTO-DETECT LANGUAGE ═══
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

function isRateLimited(phone) {
  const now = Date.now();
  const entry = userRateLimits.get(phone);
  if (!entry || now >= entry.resetAt) {
    if (userRateLimits.size >= _RATE_LIMIT_MAX_ENTRIES) {
      for (const [k, v] of userRateLimits) {
        if (now >= v.resetAt) userRateLimits.delete(k);
        if (userRateLimits.size < _RATE_LIMIT_MAX_ENTRIES) break;
      }
    }
    userRateLimits.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
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
const groupState = new Map(); // chatId -> { lastActivity, unansweredQuestions, lastIntervention }
const GROUP_INTERVENTION_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const GROUP_PAUSE_THRESHOLD = 2 * 60 * 1000; // 2 minutes

function updateGroupState(chatId, text) {
  const state = groupState.get(chatId) || {
    lastActivity: 0,
    unansweredQuestions: [],
    lastIntervention: 0,
  };
  state.lastActivity = Date.now();
  // Track unanswered questions (messages ending with ?)
  if (text && text.trim().endsWith("?")) {
    state.unansweredQuestions.push({ text, time: Date.now() });
    if (state.unansweredQuestions.length > 5) state.unansweredQuestions.shift();
  }
  groupState.set(chatId, state);
}

function shouldIntervene(chatId, isDirectlyAddressed) {
  if (isDirectlyAddressed) return true;
  const state = groupState.get(chatId);
  if (!state) return false;
  // Cooldown: don't intervene more than once per 5 minutes
  if (
    state.lastIntervention &&
    Date.now() - state.lastIntervention < GROUP_INTERVENTION_COOLDOWN
  )
    return false;
  // Intervene only if there's been a pause > 2 min and there are unanswered questions
  if (
    Date.now() - state.lastActivity > GROUP_PAUSE_THRESHOLD &&
    state.unansweredQuestions.length > 0
  ) {
    return true;
  }
  return false;
}

function getInterventionPrefix(lang) {
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

// ═══ SEND WHATSAPP TEXT MESSAGE ═══
async function sendTextMessage(to, text) {
  if (!WA_TOKEN || !PHONE_NUMBER_ID) {
    logger.warn(
      { component: "WhatsApp" },
      "WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID not set",
    );
    return;
  }
  const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text.slice(0, 4096) },
    }),
  });
  if (res.ok) {
    logger.info({ component: "WhatsApp", to }, "Text message sent");
  } else {
    const body = await res.text();
    logger.error(
      { component: "WhatsApp", status: res.status, body },
      "Failed to send text",
    );
  }
}

// ═══ SEND WHATSAPP AUDIO MESSAGE ═══
async function sendAudioMessage(to, mediaId) {
  if (!WA_TOKEN || !PHONE_NUMBER_ID) return;
  const res = await fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { id: mediaId },
    }),
  });
  if (res.ok) {
    logger.info({ component: "WhatsApp", to }, "Audio message sent");
  } else {
    const body = await res.text();
    logger.error(
      { component: "WhatsApp", status: res.status, body },
      "Failed to send audio",
    );
  }
}

// ═══ DOWNLOAD WHATSAPP MEDIA ═══
async function downloadMedia(mediaId) {
  if (!WA_TOKEN) return null;
  try {
    // Step 1: get media URL (timeout 10s)
    const metaRes = await withTimeout(
      fetch(`${GRAPH_API}/${mediaId}`, {
        headers: { Authorization: `Bearer ${WA_TOKEN}` },
      }),
      10000,
      "downloadMedia:getMeta",
    );
    if (!metaRes.ok) {
      logger.error(
        { component: "WhatsApp", mediaId, status: metaRes.status },
        "Failed to get media URL",
      );
      return null;
    }
    const meta = await metaRes.json();

    // Step 2: download binary (timeout 15s — audio files can be large)
    const dataRes = await withTimeout(
      fetch(meta.url, {
        headers: { Authorization: `Bearer ${WA_TOKEN}` },
      }),
      15000,
      "downloadMedia:download",
    );
    if (!dataRes.ok) {
      logger.error(
        { component: "WhatsApp", mediaId, status: dataRes.status },
        "Failed to download media",
      );
      return null;
    }
    const ab = await withTimeout(dataRes.arrayBuffer(), 15000, "downloadMedia:readBody");
    return Buffer.from(ab);
  } catch (e) {
    logger.error(
      { component: "WhatsApp", mediaId, err: e.message },
      "downloadMedia error",
    );
    return null;
  }
}

// ═══ UPLOAD MEDIA TO WHATSAPP ═══
async function uploadMedia(buffer, mimeType) {
  if (!WA_TOKEN || !PHONE_NUMBER_ID) return null;
  try {
    const form = new FormData();
    form.append("file", buffer, {
      filename: "audio.ogg",
      contentType: mimeType || "audio/ogg",
    });
    form.append("messaging_product", "whatsapp");
    const res = await withTimeout(
      fetch(`${GRAPH_API}/${PHONE_NUMBER_ID}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WA_TOKEN}`, ...form.getHeaders() },
        body: form,
      }),
      12000,
      "uploadMedia",
    );
    if (res.ok) {
      const data = await res.json();
      return data.id || null;
    }
    logger.error(
      { component: "WhatsApp", status: res.status },
      "Media upload failed",
    );
  } catch (e) {
    logger.error(
      { component: "WhatsApp", err: e.message },
      "uploadMedia error",
    );
  }
  return null;
}

// ═══ SPEECH-TO-TEXT (Whisper via OpenAI or Groq) ═══
async function transcribeAudio(audioBuffer, mimeType) {
  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error({ component: "WhatsApp" }, "No STT API key configured (GROQ_API_KEY or OPENAI_API_KEY)");
    return null;
  }
  const baseUrl = process.env.GROQ_API_KEY
    ? "https://api.groq.com/openai/v1"
    : "https://api.openai.com/v1";

  try {
    const form = new FormData();
    form.append("file", audioBuffer, {
      filename: "audio.ogg",
      contentType: mimeType || "audio/ogg",
    });
    form.append(
      "model",
      process.env.GROQ_API_KEY ? MODELS.WHISPER : MODELS.OPENAI_WHISPER,
    );

    const res = await withTimeout(
      fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, ...form.getHeaders() },
        body: form,
      }),
      20000,
      "transcribeAudio",
    );
    if (res.ok) {
      const data = await res.json();
      return data.text || "";
    }
    const errBody = await res.text().catch(() => "(no body)");
    logger.error({ component: "WhatsApp", status: res.status, body: errBody }, "STT failed");
    return null;
  } catch (e) {
    logger.error({ component: "WhatsApp", err: e.message }, "transcribeAudio error");
    return null;
  }
}

// ═══ TEXT-TO-SPEECH (ElevenLabs) ═══
async function generateSpeech(text, lang, character) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;
  const voiceId = getVoiceId(character);

  try {
    const res = await withTimeout(
      fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.slice(0, 1000),
            model_id: MODELS.ELEVENLABS_MODEL,
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        },
      ),
      12000,
      "generateSpeech",
    );
    if (res.ok) {
      const ab = await withTimeout(res.arrayBuffer(), 10000, "generateSpeech:readBody");
      return Buffer.from(ab);
    }
    logger.error({ component: "WhatsApp", status: res.status }, "TTS API failed");
    return null;
  } catch (e) {
    logger.error({ component: "WhatsApp", err: e.message }, "generateSpeech error");
    return null;
  }
}

// ═══ EXTRACT DOCUMENT TEXT (PDF, DOCX, TXT, CSV, JSON, MD) ═══
async function extractDocumentText(buffer, mimeType, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  try {
    if (mimeType === "application/pdf" || ext === "pdf") {
      const data = await pdfParse(buffer);
      return (data.text || "").slice(0, 3000);
    }
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const result = await mammoth.extractRawText({ buffer: buffer });
      return (result.value || "").slice(0, 3000);
    }
    if (
      ["txt", "csv", "json", "md", "xml", "html", "log"].includes(ext) ||
      (mimeType && mimeType.startsWith("text/"))
    ) {
      return buffer.toString("utf8").slice(0, 3000);
    }
  } catch (e) {
    logger.warn(
      { component: "WhatsApp", err: e.message },
      "Document extraction failed",
    );
  }
  return null;
}

// ═══ ANALYZE VIDEO (extract audio, transcribe) ═══
async function analyzeVideo(videoBuffer) {
  // For video: extract audio track and transcribe
  // WhatsApp sends video as mp4, we can use the audio from it
  // Use Whisper which handles mp4 audio extraction
  return transcribeAudio(videoBuffer, "video/mp4");
}

// ═══ WEBHOOK VERIFICATION (GET) ═══
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (!WA_VERIFY_TOKEN) {
    logger.warn(
      { component: "WhatsApp" },
      "Webhook verification attempted but WA_VERIFY_TOKEN is not set",
    );
    return res.sendStatus(403);
  }
  if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
    logger.info({ component: "WhatsApp" }, "Webhook verified");
    return res.status(200).send(challenge);
  }
  logger.warn({ component: "WhatsApp" }, "Webhook verification failed");
  res.sendStatus(403);
});

// ═══ INCOMING MESSAGE HANDLER (POST) ═══
router.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Always respond 200 first

  try {
    let body;
    try {
      body =
        typeof req.body === "string"
          ? JSON.parse(req.body)
          : Buffer.isBuffer(req.body)
            ? JSON.parse(req.body.toString())
            : req.body;
    } catch (parseErr) {
      logger.error(
        { component: "WhatsApp", err: parseErr.message },
        "Failed to parse request body",
      );
      return;
    }

    if (!body.entry) return;

    for (const entry of body.entry) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = change.value;
        if (!value || !value.messages) continue;

        for (const msg of value.messages) {
          const phone = msg.from; // sender phone number
          const msgType = msg.type;
          const contactName =
            value.contacts && value.contacts[0] && value.contacts[0].profile
              ? value.contacts[0].profile.name
              : null;

          stats.messagesReceived++;
          stats.uniqueUsers++;

          if (isRateLimited(phone)) continue;

          let userText = "";
          let respondWithAudio = false;

          // ═══ HANDLE MESSAGE TYPES ═══
          if (msgType === "text") {
            userText = msg.text.body;
          } else if (msgType === "audio") {
            // Voice message → transcribe
            respondWithAudio = true;
            try {
              const audioBuffer = await downloadMedia(msg.audio.id);
              if (audioBuffer) {
                userText = await transcribeAudio(
                  audioBuffer,
                  msg.audio.mime_type,
                );
                if (!userText)
                  userText = "[Could not transcribe voice message]";
              }
            } catch (e) {
              logger.error(
                { component: "WhatsApp", err: e.message },
                "Audio processing failed",
              );
              userText = "[Audio processing error]";
            }
          } else if (msgType === "video") {
            // Video → analyze (extract audio, transcribe)
            try {
              const videoBuffer = await downloadMedia(msg.video.id);
              if (videoBuffer) {
                userText = await analyzeVideo(videoBuffer);
                if (!userText) userText = "[Could not analyze video]";
              }
            } catch (e) {
              logger.error(
                { component: "WhatsApp", err: e.message },
                "Video processing failed",
              );
              userText = "[Video processing error]";
            }
          } else if (msgType === "image") {
            // Image → download and analyze with GPT-5.4 Vision
            try {
              const imageBuffer = await downloadMedia(msg.image.id);
              if (imageBuffer) {
                const caption = msg.image.caption || "";
                const b64 = imageBuffer.toString("base64");
                const mimeType = msg.image.mime_type || "image/jpeg";
                const openaiKey = process.env.OPENAI_API_KEY;
                if (openaiKey) {
                  const visionRes = await withTimeout(
                    fetch(
                      "https://api.openai.com/v1/chat/completions",
                      {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${openaiKey}`,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          model: MODELS.OPENAI_VISION,
                          messages: [
                            {
                              role: "user",
                              content: [
                                {
                                  type: "image_url",
                                  image_url: {
                                    url: `data:${mimeType};base64,${b64}`,
                                  },
                                },
                                {
                                  type: "text",
                                  text:
                                    caption || "Describe this image in detail.",
                                },
                              ],
                            },
                          ],
                          max_tokens: 500,
                        }),
                      },
                    ),
                    15000,
                    "imageVision",
                  );
                  if (visionRes.ok) {
                    const visionData = await visionRes.json();
                    const description =
                      visionData.choices &&
                      visionData.choices[0] &&
                      visionData.choices[0].message &&
                      visionData.choices[0].message.content;
                    userText = caption
                      ? `${caption}\n[Image description: ${description}]`
                      : `[Image: ${description}]`;
                  } else {
                    userText = caption || "Describe this image";
                  }
                } else {
                  userText = caption || "Describe this image";
                }
              } else {
                userText = msg.image.caption || "Describe this image";
              }
            } catch (e) {
              logger.error(
                { component: "WhatsApp", err: e.message },
                "Image analysis failed",
              );
              userText = msg.image.caption || "Describe this image";
            }
          } else if (msgType === "sticker") {
            // Sticker → try to analyze with Vision, fallback to text acknowledgment
            try {
              const stickerBuffer = await downloadMedia(msg.sticker.id);
              if (stickerBuffer && process.env.OPENAI_API_KEY) {
                const b64 = stickerBuffer.toString("base64");
                const mimeType = msg.sticker.mime_type || "image/webp";
                const visionRes = await withTimeout(
                  fetch("https://api.openai.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      model: MODELS.OPENAI_VISION,
                      messages: [{
                        role: "user",
                        content: [
                          { type: "image_url", image_url: { url: `data:${mimeType};base64,${b64}` } },
                          { type: "text", text: "This is a WhatsApp sticker. Briefly describe what it shows (emotion, character, action)." },
                        ],
                      }],
                      max_tokens: 150,
                    }),
                  }),
                  10000,
                  "stickerVision",
                );
                if (visionRes.ok) {
                  const visionData = await visionRes.json();
                  const desc = visionData.choices?.[0]?.message?.content || "a sticker";
                  userText = `[User sent a sticker: ${desc}]`;
                } else {
                  userText = "[User sent a sticker]";
                }
              } else {
                userText = "[User sent a sticker]";
              }
            } catch (e) {
              logger.warn({ component: "WhatsApp", err: e.message }, "Sticker analysis failed");
              userText = "[User sent a sticker]";
            }
          } else if (msgType === "document") {
            // Document → download and extract text (PDF, DOCX, TXT, CSV, JSON, MD)
            try {
              const docBuffer = await downloadMedia(msg.document.id);
              const filename = msg.document.filename || "document";
              const mimeType = msg.document.mime_type || "";
              const caption = msg.document.caption || "";
              if (docBuffer) {
                const docText = await extractDocumentText(docBuffer, mimeType, filename);
                if (docText) {
                  userText = caption
                    ? `${caption}\n[Document "${filename}" content:\n${docText}]`
                    : `[Document "${filename}" content:\n${docText}]`;
                } else {
                  userText = caption
                    ? `${caption}\n[User sent a document: ${filename} (${mimeType}) — format not supported for text extraction]`
                    : `[User sent a document: ${filename} (${mimeType}) — format not supported for text extraction]`;
                }
              } else {
                userText = `[User sent a document: ${filename} — could not download]`;
              }
            } catch (e) {
              logger.error({ component: "WhatsApp", err: e.message }, "Document processing failed");
              userText = "[User sent a document — processing error]";
            }
          } else if (msgType === "location") {
            // Location → format coordinates and provide context
            const loc = msg.location;
            const lat = loc.latitude;
            const lng = loc.longitude;
            const name = loc.name || "";
            const address = loc.address || "";
            userText = name
              ? `[User shared location: ${name}${address ? ", " + address : ""} (${lat}, ${lng})]`
              : `[User shared location: coordinates ${lat}, ${lng}${address ? " — " + address : ""}]`;
          } else if (msgType === "contacts") {
            // Contacts → acknowledge and describe
            const contacts = msg.contacts || [];
            const names = contacts.map(c => {
              const fn = c.name?.formatted_name || c.name?.first_name || "Unknown";
              const phone = c.phones?.[0]?.phone || "";
              return phone ? `${fn} (${phone})` : fn;
            }).join(", ");
            userText = `[User shared contact(s): ${names}]`;
          } else if (msgType === "reaction") {
            // Reactions → silently acknowledge (don't generate a full AI response)
            continue;
          } else {
            // Unknown/unsupported type → inform AI about it
            userText = `[User sent an unsupported message type: ${msgType}]`;
          }

          if (!userText) continue;

          // ═══ ADMIN KEYWORD BLACKLIST — total silence for non-owners ═══
          if (ADMIN_KEYWORDS.test(userText)) continue;

          // ═══ DETERMINE CHAT TYPE & CHARACTER ═══
          const isGroup = isGroupChat(msg);
          const chatId = isGroup ? msg.group_id || phone : phone;

          // Always store message in conversation history (listening mode)
          addToHistory(chatId, contactName || phone, userText);

          // Update group state for smart intervention
          if (isGroup) updateGroupState(chatId, userText);

          // ═══ CHARACTER SELECTION ═══
          // 1:1: user can type "kelion" or "kira" to select character
          if (!isGroup && /^(kelion|kira)$/i.test(userText.trim())) {
            const char = userText.trim().toLowerCase();
            // Save character to DB
            if (_supabase) {
              try {
                await _supabase.from("whatsapp_users")
                  .update({ character: char })
                  .eq("phone", phone);
                const cached = _userCache.get(phone);
                if (cached) cached.character = char;
              } catch (e) { /* ignore */ }
            }
            const name = char === "kelion" ? "Kelion" : "Kira";
            await sendTextMessage(
              phone,
              `${char === "kelion" ? "🤖" : "👩‍💻"} ${name} este acum asistentul tău. Cu ce te pot ajuta?`,
            );
            stats.repliesSent++;
            continue;
          }

          // ═══ GROUP LOGIC: respond only when addressed or for polite intervention ═══
          if (isGroup) {
            const addressed = getAddressedCharacter(userText);
            if (!shouldIntervene(chatId, !!addressed)) {
              // Not addressed and no polite intervention warranted → stay silent
              continue;
            }
            // Set active character for this response
            if (addressed) {
              if (_supabase) {
                try {
                  await _supabase.from("whatsapp_users").update({ character: addressed }).eq("phone", phone);
                  const cached = _userCache.get(phone);
                  if (cached) cached.character = addressed;
                } catch (e) { /* ignore */ }
              }
            }
            // Mark intervention time
            const gs = groupState.get(chatId);
            if (gs) {
              gs.lastIntervention = Date.now();
              gs.unansweredQuestions = [];
            }
          }

          // Get selected character (default: kelion)
          const knownUser = await getKnownUser(phone, _supabase);
          const character = (knownUser && knownUser.character) || "kelion";

          // ═══ AI RESPONSE (with conversation context) ═══
          let reply;
          const brain = req.app.locals.brain;
          const context = await getContextSummary(chatId);
          const detectedLangForPrompt = detectLanguage(userText);
          const prompt = context
            ? `[Conversation context:\n${context}]\n\nUser: ${userText}`
            : userText;

          if (brain) {
            try {
              const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Brain timeout")), 15000),
              );
              const result = await Promise.race([
                brain.think(
                  prompt,
                  character,
                  [],
                  detectedLangForPrompt || "auto",
                ),
                timeout,
              ]);
              reply =
                (result && result.enrichedMessage) ||
                "Nu am putut procesa mesajul.";
            } catch (e) {
              logger.warn(
                { component: "WhatsApp", err: e.message },
                "Brain unavailable",
              );
              reply = "Momentan sunt ocupat. Încearcă din nou.";
            }
          } else {
            reply =
              `Sunt KelionAI! Pentru experiența completă vizitează ${process.env.APP_URL}`;
          }

          // Prefix polite intervention phrase for unsolicited group responses
          if (isGroup && !getAddressedCharacter(userText)) {
            const lang = detectedLangForPrompt || "en";
            reply = getInterventionPrefix(lang) + reply;
          }

          // Send text response always
          await sendTextMessage(phone, reply);
          stats.repliesSent++;

          // ═══ BRAIN INTEGRATION — save chat memory ═══
          if (brain) {
            brain.saveMemory(null, "text", "WhatsApp " + phone + ": " + userText.substring(0, 200) + " | Reply: " + reply.substring(0, 300), {
              platform: "whatsapp", character
            }).catch(() => { });
          }

          // If voice message → also send audio response
          if (respondWithAudio) {
            try {
              const speechBuffer = await generateSpeech(
                reply,
                detectedLangForPrompt,
                character,
              );
              if (speechBuffer) {
                const mediaId = await uploadMedia(speechBuffer, "audio/ogg");
                if (mediaId) {
                  await sendAudioMessage(phone, mediaId);
                } else {
                  logger.warn(
                    { component: "WhatsApp" },
                    "TTS audio upload failed, text-only response sent",
                  );
                }
              }
            } catch (e) {
              logger.warn(
                { component: "WhatsApp", err: e.message },
                "TTS failed",
              );
            }
          }

          const supabase =
            req.app.locals.supabaseAdmin || req.app.locals.supabase;
          const known = await getKnownUser(phone, supabase);
          const msgCount = known ? (known.messageCount || 0) + 1 : 1;
          // Update message count in DB
          if (supabase) {
            try {
              await supabase.from("whatsapp_users")
                .update({ message_count: msgCount })
                .eq("phone", phone);
              if (_userCache.has(phone)) _userCache.get(phone).messageCount = msgCount;
            } catch (e) { /* ignore */ }
          }

          if (!known) {
            const detectedLang = detectLanguage(userText);
            await saveKnownUser(phone, detectedLang, contactName, supabase);

            const isJustGreeting =
              /^(h(ello|i|ey)|salut|bun[aă]|ciao|hola|bonjour|hallo|ola)[!?.,\s]*$/i.test(
                userText.trim(),
              );
            if (isJustGreeting) {
              setTimeout(async () => {
                await sendTextMessage(
                  phone,
                  "We can provide support in any language you wish. Feel free to speak in your language. 🌍",
                );
              }, 1500);
            }
          } else {
            if (msgCount === 1) {
              const greetings = {
                ro: `Bine ai revenit, ${known.name || "prietene"}! 😊`,
                en: `Welcome back, ${known.name || "friend"}! 😊`,
                de: `Willkommen zurück, ${known.name || "Freund"}! 😊`,
                fr: `Bon retour, ${known.name || "ami"}! 😊`,
                es: `Bienvenido de nuevo, ${known.name || "amigo"}! 😊`,
                it: `Bentornato, ${known.name || "amico"}! 😊`,
              };
              await sendTextMessage(
                phone,
                greetings[known.lang] || greetings.en,
              );
            }
            const newLang = detectLanguage(userText);
            if (newLang !== known.lang) {
              await saveKnownUser(phone, newLang, known.name, supabase);
            }
          }

          // Free limit promo
          if (msgCount === FREE_MESSAGES_LIMIT) {
            setTimeout(async () => {
              await sendTextMessage(
                phone,
                `⭐ Ai folosit ${FREE_MESSAGES_LIMIT} mesaje gratuite!\n\n` +
                `Continuă cu funcții premium pe kelionai.app:\n` +
                `• 💬 Chat nelimitat cu AI\n` +
                `• 🎭 Avatare 3D\n` +
                `• 🔊 Voce naturală\n\n` +
                `🌐 Abonează-te: ${process.env.APP_URL}/pricing`,
              );
            }, 3000);
          }
        }
      }
    }
  } catch (e) {
    logger.error(
      { component: "WhatsApp", err: e.message },
      "Webhook handler error",
    );
  }
});

// ═══ JOKES / BANCURI SECTION ═══
const JOKES = {
  ro: [
    "De ce nu joacă peștii tenis? Pentru că le e frică de fileu! 🐟",
    'Bulă la școală: "Doamna învățătoare, pot fi pedepsit pentru ceva ce n-am făcut?" "Nu, Bulă." "Bine, nu mi-am făcut temele." 📚',
    "Ce face un crocodil când întâlnește o femeie frumoasă? O complimentează! 🐊",
    'Un optimist și un pesimist la bar. Pesimistul: "Mai rău de atât nu se poate!" Optimistul: "Ba da, se poate!" 🍺',
    "Cum se numește un magician care și-a pierdut magia? Ian. 🪄",
  ],
};

router.get("/joke", async (req, res) => {
  const lang = req.query.lang || "ro";
  const jokes = JOKES[lang] || JOKES.ro;
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  res.json({ joke, language: lang });
});

// ═══ SEND MESSAGE API (Admin) ═══
router.post("/send", async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message) {
      return res.status(400).json({ error: "to (phone number) and message are required" });
    }
    if (!WA_TOKEN || !PHONE_NUMBER_ID) {
      return res.status(503).json({ error: "WhatsApp not configured (missing WA_ACCESS_TOKEN or WA_PHONE_NUMBER_ID)" });
    }
    await sendTextMessage(to, message);
    stats.repliesSent++;
    res.json({ success: true, to, messageLength: message.length });
  } catch (e) {
    res.status(500).json({ error: "Send failed: " + e.message });
  }
});

// ═══ HEALTH ENDPOINT ═══
router.get("/health", (req, res) => {
  res.json({
    status: WA_TOKEN && PHONE_NUMBER_ID ? "configured" : "misconfigured",
    hasToken: !!WA_TOKEN,
    hasPhoneNumberId: !!PHONE_NUMBER_ID,
    hasVerifyToken: !!WA_VERIFY_TOKEN,
    stats: {
      messagesReceived: stats.messagesReceived,
      repliesSent: stats.repliesSent,
      activeUsers: stats.uniqueUsers,
    },
    webhookUrl:
      (process.env.APP_URL) + "/api/whatsapp/webhook",
  });
});

function getStats() {
  return {
    messagesReceived: stats.messagesReceived,
    repliesSent: stats.repliesSent,
    activeUsers: stats.uniqueUsers,
  };
}

module.exports = { router, getStats, setSupabase };
