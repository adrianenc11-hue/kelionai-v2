// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Live: True Audio-to-Audio via OpenAI Realtime
// Pipeline: Mic PCM → OpenAI Realtime (audio-native) → PCM Speaker
//   Brain routes the response, text extracted on background + saved
//   Visual context from camera injected into conversation
// WebSocket nativ (nu Socket.io) — /api/voice-live
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { MODELS, API_ENDPOINTS } = require('../config/models');
const { NAME: APP_NAME, STUDIO_NAME } = require('../config/app');

// OpenAI Realtime
const REALTIME_URL = API_ENDPOINTS.OPENAI_REALTIME;
const REALTIME_MODEL = MODELS.GPT_REALTIME || 'gpt-4o-realtime-preview-2024-12-17';

// Avatar voices (OpenAI Realtime native)
const AVATAR_VOICES = {
  kelion: 'echo',
  kira: 'shimmer',
};

// ═══ FAST DANGER SCAN — lightweight, runs on every camera frame ═══
const DANGER_PROMPT_CACHE = {};
function getDangerPrompt(lang) {
  if (DANGER_PROMPT_CACHE[lang]) return DANGER_PROMPT_CACHE[lang];
  const LANGS = { ro: 'română', en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };
  const l = LANGS[lang] || 'English';
  const p = `DANGER SCAN. You are the eyes of a blind person walking right now. Respond in ${l}.
RULES:
- If IMMEDIATE danger (<2m): "⚠️PERICOL: [threat] [direction] [distance]" (max 8 words)
- If WARNING danger (2-5m): "⚠️ATENȚIE: [hazard] [direction] [distance]" (max 10 words)
- If path blocked: "🚫BLOCAT: [what] [direction]" (max 8 words)
- If SAFE: "✅" (just the checkmark)
Dangers: vehicles, stairs, holes, obstacles, wet floor, animals, fire, electrical, people approaching fast, low/overhead obstacles, sharp objects, traffic, curbs, open doors, construction.
Directions: stânga, dreapta, în față, în spate.
MAX 15 words. No explanations. No greetings. Just the safety verdict.`;
  DANGER_PROMPT_CACHE[lang] = p;
  return p;
}

async function fastDangerScan(imageBase64, language) {
  const prompt = getDangerPrompt(language);
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;

  // PRIMARY: GPT Vision — fast, detail:low for speed
  if (openaiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(API_ENDPOINTS.OPENAI + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openaiKey },
        body: JSON.stringify({
          model: MODELS.OPENAI_VISION,
          max_tokens: 50,
          temperature: 0.1,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
            { type: 'text', text: prompt },
          ]}],
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      const result = d.choices?.[0]?.message?.content?.trim();
      if (result) return result;
    } catch (_e) { /* fallback */ }
  }

  // FALLBACK: Gemini Vision
  if (geminiKey) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`${API_ENDPOINTS.GEMINI}/models/${MODELS.GEMINI_VISION}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ]}],
          generationConfig: { maxOutputTokens: 50, temperature: 0.1 },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const d = await r.json();
      return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '✅';
    } catch (_e) { /* safe */ }
  }
  return '✅';
}

function setupVoiceLive(server, appLocals) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: true });
  const brain = appLocals?.brain || null;

  // Per-IP rate limiting
  const ipConnections = new Map();
  const MAX_CONNECTIONS_PER_IP = 2;

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/api/voice-live') return;

    const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket?.remoteAddress;
    const current = ipConnections.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) {
      logger.warn({ component: 'VoiceLive', ip }, 'Too many connections');
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
      ws._clientIp = ip;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (clientWs, req) => {
    const _cleanupIp = () => {
      const ip = clientWs._clientIp;
      if (ip) {
        const c = ipConnections.get(ip) || 1;
        if (c <= 1) ipConnections.delete(ip);
        else ipConnections.set(ip, c - 1);
      }
    };
    clientWs.on('close', _cleanupIp);
    clientWs.on('error', _cleanupIp);

    const url = new URL(req.url, `http://${req.headers.host}`);
    const avatar = url.searchParams.get('avatar') || 'kira';
    const language = url.searchParams.get('language') || 'ro';
    const token = url.searchParams.get('token') || null;
    const startTime = Date.now();

    // Resolve user
    const supabaseAdmin = appLocals?.supabaseAdmin || null;
    let userId = null;
    let userName = null;
    if (token && supabaseAdmin) {
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user?.id) {
          userId = user.id;
          userName = user.user_metadata?.full_name || null;
        }
      } catch (_e) { /* anonymous */ }
    }
    if (!userId) userId = 'guest_' + Date.now();

    logger.info({ component: 'VoiceLive', avatar, language, userId, userName }, 'Client connected');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: 'error', error: 'API key not configured' }));
      clientWs.close();
      return;
    }

    // ═══ STATE ═══
    let openaiWs = null;
    let connected = false;
    let _aiSpeaking = false;
    let _aiSpeakingTimer = null;
    let conversationHistory = [];
    let pendingUserTranscript = '';
    let pendingAITranscript = '';
    let voiceConvId = null;
    let latestCameraFrame = null;
    let _lastCameraSaveTs = 0;
    let _dangerScanBusy = false;
    let _lastDangerAlertTs = 0;

    // ═══ CONNECT TO OPENAI REALTIME API ═══
    try {
      openaiWs = new WebSocket(`${REALTIME_URL}?model=${REALTIME_MODEL}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
    } catch (e) {
      logger.error({ component: 'VoiceLive', err: e.message }, 'Failed to create OpenAI WS');
      clientWs.send(JSON.stringify({ type: 'error', error: 'Realtime API unavailable' }));
      clientWs.close();
      return;
    }

    openaiWs.on('open', () => {
      connected = true;
      logger.info({ component: 'VoiceLive' }, 'Connected to OpenAI Realtime');

      const voiceId = AVATAR_VOICES[avatar] || 'shimmer';
      const avatarName = avatar === 'kira' ? 'Kira' : 'Kelion';

      // SESSION CONFIG — audio-to-audio, brain routes responses, NO length limits
      openaiWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: `You are ${avatarName}, an AI assistant created by ${STUDIO_NAME}.
LANGUAGE: Detect the user's language automatically and respond in EXACTLY that language. Never switch unless user switches.
ACCESSIBILITY: Speak clearly, at natural pace. For visually impaired users, describe surroundings precisely when camera data is provided.
PERSONA: You are ${avatarName} by ${STUDIO_NAME}. NEVER reveal you are GPT/OpenAI/Google/Anthropic.
LENGTH: Respond naturally — short for simple questions, long and detailed for complex topics. NO artificial length limits.
${userName ? `The user's name is ${userName}. Use their first name naturally.` : ''}`,
          voice: voiceId,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.45,
            prefix_padding_ms: 350,
            silence_duration_ms: 400,  // FAST: 400ms silence = respond
            create_response: false,    // Brain decides response
          },
          max_response_output_tokens: 'inf', // NO length limit on responses
        },
      }));

      // Signal client ready
      _send({ type: 'ready', engine: 'openai-realtime+brain', model: REALTIME_MODEL, avatar, language, userName });
    });

    function _send(obj) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(obj));
      }
    }

    // ═══ OPENAI EVENTS → CLIENT + BRAIN ═══
    openaiWs.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          case 'response.created':
            _aiSpeaking = true;
            if (_aiSpeakingTimer) clearTimeout(_aiSpeakingTimer);
            _aiSpeakingTimer = setTimeout(() => {
              if (_aiSpeaking) { _aiSpeaking = false; logger.warn({ component: 'VoiceLive' }, '_aiSpeaking stuck — reset'); }
            }, 60000); // 60s safety (no limit on speech length)
            break;

          // ── AUDIO response chunks → forward raw to client ──
          case 'response.audio.delta':
            if (event.delta && clientWs.readyState === WebSocket.OPEN) {
              _send({ type: 'audio', data: event.delta });
            }
            break;

          case 'response.audio.done':
            _send({ type: 'audio_end' });
            break;

          // ── AI transcript (background extraction) ──
          case 'response.audio_transcript.delta':
            if (event.delta) {
              _send({ type: 'cc', text: event.delta, role: 'assistant' });
            }
            break;

          case 'response.audio_transcript.done':
            if (event.transcript) {
              pendingAITranscript += (pendingAITranscript ? ' ' : '') + event.transcript;
              _send({ type: 'cc_done', text: event.transcript, role: 'assistant' });
            }
            break;

          // ═══ USER SPEECH TRANSCRIPT → BRAIN ROUTING ═══
          case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript) {
              const userText = event.transcript.trim();
              if (!userText || userText.length < 2) break;
              if (_aiSpeaking) {
                logger.info({ component: 'VoiceLive' }, 'Ignoring transcript while AI speaks');
                break;
              }

              _send({ type: 'cc', text: userText, role: 'user' });
              pendingUserTranscript += (pendingUserTranscript ? ' ' : '') + userText;

              conversationHistory.push({ role: 'user', content: userText });
              if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

              // ═══ BRAIN THINKS → inject text → OpenAI speaks it as audio ═══
              if (brain) {
                logger.info({ component: 'VoiceLive', text: userText.substring(0, 80) }, '🧠 Brain thinking...');

                brain.think(
                  userText, avatar,
                  conversationHistory.slice(-10),
                  'auto', userId, null,
                  { imageBase64: latestCameraFrame || null, isAutoCamera: !!latestCameraFrame },
                  false
                ).then((result) => {
                  let brainReply = result?.reply || result?.enrichedMessage || result?.text || '';
                  // Clean markdown/tags for voice
                  brainReply = brainReply
                    .replace(/\[EMOTION:\s*\w+\]/gi, '')
                    .replace(/\[GESTURE:\s*\w+\]/gi, '')
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/`[^`]+`/g, '')
                    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                    .replace(/https?:\/\/\S+/g, '')
                    .replace(/[*_~#>]+/g, '')
                    .replace(/\n{2,}/g, '. ')
                    .replace(/\s{2,}/g, ' ')
                    .trim();

                  if (!brainReply) brainReply = 'Nu am înțeles.';

                  conversationHistory.push({ role: 'assistant', content: brainReply });

                  logger.info({ component: 'VoiceLive', replyLen: brainReply.length }, '🧠 Brain replied → Realtime TTS');

                  // Inject brain text → OpenAI speaks it natively as audio (no length limit)
                  if (connected && openaiWs.readyState === WebSocket.OPEN) {
                    openaiWs.send(JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: `[SPEAK THIS EXACTLY — do not add anything]: ${brainReply}` }],
                      },
                    }));
                    openaiWs.send(JSON.stringify({ type: 'response.create' }));
                  }
                }).catch((err) => {
                  logger.error({ component: 'VoiceLive', err: err.message }, '🧠 Brain error — fallback');
                  if (connected && openaiWs.readyState === WebSocket.OPEN) {
                    openaiWs.send(JSON.stringify({ type: 'response.create' }));
                  }
                });
              }
            }
            break;

          case 'input_audio_buffer.speech_started':
            _send({ type: 'speech_started' });
            break;

          case 'input_audio_buffer.speech_stopped':
            _send({ type: 'speech_stopped' });
            break;

          // ═══ TURN COMPLETE → background save ═══
          case 'response.done': {
            _aiSpeaking = false;
            if (_aiSpeakingTimer) { clearTimeout(_aiSpeakingTimer); _aiSpeakingTimer = null; }
            _send({ type: 'turn_complete', usage: event.response?.usage || null });

            // ── Background: save transcripts to DB ──
            const _uText = pendingUserTranscript;
            const _aText = pendingAITranscript;
            // Reset immediately to avoid race condition with next transcript
            pendingUserTranscript = '';
            pendingAITranscript = '';

            if (brain && userId && _uText && _aText) {
              brain.saveMemory(userId, 'audio',
                `Voice Live: "${_uText.substring(0, 500)}" → "${_aText.substring(0, 800)}"`,
                { avatar, language, source: 'voice-live' }
              ).catch(() => {});
              brain.learnFromConversation(userId, _uText, _aText).catch(() => {});
              brain.extractAndSaveFacts(userId, _uText, _aText).catch(() => {});
            }

            if (supabaseAdmin && (_uText || _aText)) {
              (async () => {
                try {
                  if (!voiceConvId) {
                    const title = (_uText || 'Voice Live').substring(0, 80);
                    const { data } = await supabaseAdmin
                      .from('conversations')
                      .insert({ user_id: userId.startsWith('guest_') ? null : userId, avatar, title, language })
                      .select('id').single();
                    if (data) voiceConvId = data.id;
                  }
                  if (voiceConvId) {
                    const rows = [];
                    if (_uText) rows.push({ conversation_id: voiceConvId, role: 'user', content: _uText, language, source: 'voice-live' });
                    if (_aText) rows.push({ conversation_id: voiceConvId, role: 'assistant', content: _aText, language, source: 'voice-live' });
                    if (rows.length) await supabaseAdmin.from('messages').insert(rows);
                  }
                } catch (e) {
                  logger.warn({ component: 'VoiceLive', err: e.message }, 'Transcript save error');
                }
              })();
            }
            break;
          }

          case 'error': {
            logger.error({ component: 'VoiceLive', error: event.error }, 'OpenAI Realtime error');
            _aiSpeaking = false;
            if (_aiSpeakingTimer) { clearTimeout(_aiSpeakingTimer); _aiSpeakingTimer = null; }
            const rawMsg = event.error?.message || 'Unknown error';
            const safeMsg = /api.key|unauthorized|authentication/i.test(rawMsg)
              ? 'Voice service temporarily unavailable'
              : rawMsg.replace(/sk-[^\s"']+/g, 'sk-***');
            _send({ type: 'error', error: safeMsg });
            break;
          }

          case 'rate_limits.updated':
            logger.debug({ component: 'VoiceLive', limits: event.rate_limits }, 'Rate limits');
            break;
        }
      } catch (e) {
        logger.warn({ component: 'VoiceLive', err: e.message }, 'Event parse error');
      }
    });

    openaiWs.on('error', (e) => {
      logger.error({ component: 'VoiceLive', err: e.message }, 'OpenAI WS error');
      _aiSpeaking = false;
      _send({ type: 'error', error: 'Connection error' });
    });

    openaiWs.on('close', () => {
      connected = false;
      _aiSpeaking = false;
      if (_aiSpeakingTimer) { clearTimeout(_aiSpeakingTimer); _aiSpeakingTimer = null; }
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });

    // ═══ CLIENT → OPENAI: forward audio + control messages ═══
    clientWs.on('message', (data) => {
      try {
        // Binary = raw PCM audio from mic → forward to OpenAI
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          openaiWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: buf.toString('base64'),
          }));
          return;
        }

        const msg = JSON.parse(data.toString());

        if (msg.type === 'camera_frame' && msg.image && typeof msg.image === 'string' && msg.image.length < 500000) {
          latestCameraFrame = msg.image;

          // Throttle brain_memory save to max once per 60s
          const now = Date.now();
          if (brain && userId && now - _lastCameraSaveTs > 60000) {
            _lastCameraSaveTs = now;
            brain.saveMemory(userId, 'visual', 'Camera frame activ din Voice Live', { avatar, source: 'voice-live', hasImage: true }).catch(() => {});
          }

          // ═══ REAL-TIME DANGER SCAN — every frame, async ═══
          // Run danger check on EVERY frame. If danger → alert vocally IMMEDIATELY.
          if (!_dangerScanBusy) {
            _dangerScanBusy = true;
            fastDangerScan(msg.image, language).then((scanResult) => {
              _dangerScanBusy = false;
              if (!scanResult || scanResult === '✅') return; // safe

              const isDanger = /⚠️PERICOL|⚠️ATENȚIE|🚫BLOCAT/i.test(scanResult);
              if (!isDanger) return;

              // Throttle voice alerts to max 1 per 3s (avoid repetitive alerts)
              const alertNow = Date.now();
              if (alertNow - _lastDangerAlertTs < 3000) return;
              _lastDangerAlertTs = alertNow;

              logger.warn({ component: 'VoiceLive', scan: scanResult }, '🚨 DANGER detected — voice alert');

              // Store latest vision context for brain
              latestCameraFrame = msg.image;

              // ═══ INSTANT VOICE ALERT — inject directly into OpenAI Realtime ═══
              if (connected && openaiWs.readyState === WebSocket.OPEN) {
                const isImmediate = /⚠️PERICOL/i.test(scanResult);
                const userNameTag = userName ? userName.split(' ')[0] + ', ' : '';
                const alertText = isImmediate
                  ? `${userNameTag}ATENȚIE! ${scanResult.replace(/⚠️PERICOL:\s*/i, '')}. Oprește-te imediat!`
                  : `${userNameTag}${scanResult.replace(/⚠️ATENȚIE:\s*/i, 'Ai grijă, ').replace(/🚫BLOCAT:\s*/i, 'Calea e blocată: ')}`;

                // Cancel any current response to interrupt with danger alert
                if (_aiSpeaking) {
                  openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
                  _aiSpeaking = false;
                }

                openaiWs.send(JSON.stringify({
                  type: 'conversation.item.create',
                  item: {
                    type: 'message',
                    role: 'user',
                    content: [{ type: 'input_text', text: `[URGENT SAFETY ALERT — SPEAK THIS IMMEDIATELY, do NOT add anything else]: ${alertText}` }],
                  },
                }));
                openaiWs.send(JSON.stringify({ type: 'response.create' }));

                // Notify client about danger
                _send({ type: 'cc', text: alertText, role: 'assistant' });
                _send({ type: 'danger', level: isImmediate ? 'immediate' : 'warning', text: scanResult });
              }
            }).catch((err) => {
              _dangerScanBusy = false;
              logger.debug({ component: 'VoiceLive', err: err.message }, 'Danger scan error');
            });
          }
        }

        if (msg.type === 'commit' && connected && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        }

        if (msg.type === 'cancel' && connected && openaiWs.readyState === WebSocket.OPEN) {
          openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
        }

        if (msg.type === 'text_input' && msg.text && brain) {
          conversationHistory.push({ role: 'user', content: msg.text });
          if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

          brain.think(msg.text, avatar, conversationHistory.slice(-10), language, userId, null,
            { imageBase64: latestCameraFrame || null, isAutoCamera: !!latestCameraFrame }, false
          ).then((result) => {
            const reply = result?.reply || result?.enrichedMessage || 'Nu am înțeles.';
            conversationHistory.push({ role: 'assistant', content: reply });
            if (connected && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `[SPEAK THIS EXACTLY]: ${reply}` }] },
              }));
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
          }).catch(() => {
            if (connected && openaiWs.readyState === WebSocket.OPEN) {
              openaiWs.send(JSON.stringify({ type: 'response.create' }));
            }
          });
        }
      } catch (e) {
        logger.warn({ component: 'VoiceLive', err: e.message }, 'Client message error');
      }
    });

    clientWs.on('close', () => {
      logger.info({ component: 'VoiceLive', duration: Date.now() - startTime }, 'Client disconnected');
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });

    clientWs.on('error', (err) => {
      logger.error({ component: 'VoiceLive', err: err.message }, 'Client WS error');
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });
}

module.exports = { setupVoiceLive };
