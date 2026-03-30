// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice-First Mode: OpenAI Realtime API via Socket.io
// Socket.io namespace: /voice-realtime
// Audio pipeline: Mic → OpenAI STT (live) → Brain → OpenAI TTS (native voice) → Speaker
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { MODELS, API_ENDPOINTS } = require('../config/models');
const { incrementUsage } = require('../payments');

// ── OpenAI Realtime API config ──
const REALTIME_URL = API_ENDPOINTS.OPENAI_REALTIME;
const REALTIME_MODEL = MODELS.GPT_REALTIME || 'gpt-4o-realtime-preview-2024-12-17';

// ── Voci naturale per avatar — OpenAI Realtime voices ──
// alloy=neutru, echo=masculin, shimmer=feminin, ash=calm, ballad=cald, coral=vivace, sage=autoritar, verse=expresiv
const { OPENAI_AVATAR_VOICES: AVATAR_VOICES } = require('../config/voices');

/**
 * Attach Voice-First Socket.io namespace to the io server.
 * @param {import('socket.io').Server} io  — Socket.io server instance
 * @param {object} appLocals              — Express app.locals (contains brain)
 */
function setupRealtimeVoice(io, appLocals) {
  const brain = appLocals?.brain || null;
  const ns = io.of('/voice-realtime');

  // ── Per-IP connection rate limiting ──
  const ipConnections = new Map(); // IP → count
  const MAX_CONNECTIONS_PER_IP = 3;

  ns.on('connection', async (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
    const current = ipConnections.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) {
      logger.warn({ component: 'VoiceRealtime', ip }, 'Too many connections from IP');
      socket.emit('error_msg', { error: 'Too many voice connections' });
      socket.disconnect(true);
      return;
    }
    ipConnections.set(ip, current + 1);
    socket.on('disconnect', () => {
      const c = ipConnections.get(ip) || 1;
      if (c <= 1) ipConnections.delete(ip);
      else ipConnections.set(ip, c - 1);
    });

    const avatar = socket.handshake.query.avatar || 'kelion';
    const language = socket.handshake.query.language || 'ro';
    const token = socket.handshake.query.token || null;
    const startTime = Date.now();

    // ── Supabase for persisting transcripts ──
    const supabaseAdmin = appLocals?.supabaseAdmin || null;

    // ── Resolve userId from token (mandatory) ──
    let userId = null;
    if (token && supabaseAdmin) {
      try {
        const {
          data: { user },
        } = await supabaseAdmin.auth.getUser(token);
        if (user?.id) userId = user.id;
      } catch (e) {
        logger.debug({ component: 'VoiceRealtime', err: e.message }, 'Invalid token');
      }
    }
    if (!userId) {
      // Allow guest users — assign a temporary session ID
      userId = 'guest_' + socket.id;
      logger.info({ component: 'VoiceRealtime', ip }, 'Guest connection allowed: ' + userId);
    }

    // ── Conversation history for brain context ──
    let conversationHistory = [];
    let voiceConvId = null;
    let pendingUserTranscript = '';
    let pendingAITranscript = '';
    // language param is already available from outer scope

    // ── Camera frame (latest from client, for vision analysis) ──
    let latestCameraFrame = null; // base64 JPEG from client

    // Language detection is done by Whisper automatically (from transcription event)

    const LANG_NAMES = {
      ro: 'Romanian',
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      zh: 'Chinese',
      ja: 'Japanese',
      ko: 'Korean',
      ar: 'Arabic',
      hi: 'Hindi',
      tr: 'Turkish',
      pl: 'Polish',
      nl: 'Dutch',
      sv: 'Swedish',
      ru: 'Russian',
      cs: 'Czech',
      hu: 'Hungarian',
    };

    logger.info(
      { component: 'VoiceRealtime', avatar, language, userId: userId || 'anon', id: socket.id },
      'Client connected to voice-realtime (Socket.io)'
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      socket.emit('error_msg', { error: 'OPENAI_API_KEY not configured' });
      socket.disconnect(true);
      return;
    }

    // ── Connect to OpenAI Realtime API ──
    let openaiWs = null;
    let connected = false;

    try {
      openaiWs = new WebSocket(`${REALTIME_URL}?model=${REALTIME_MODEL}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
    } catch (e) {
      logger.error({ component: 'VoiceRealtime', err: e.message }, 'Failed to create OpenAI WS');
      socket.emit('error_msg', { error: 'Realtime API unavailable' });
      socket.disconnect(true);
      return;
    }

    openaiWs.on('open', () => {
      connected = true;
      logger.info({ component: 'VoiceRealtime' }, 'Connected to OpenAI Realtime');

      const _langName = LANG_NAMES[language] || language || 'Romanian';
      const voiceId = AVATAR_VOICES[avatar] || 'echo';

      // SESSION CONFIG: auto-language detection, natural voices, accessibility-optimized VAD
      openaiWs.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: `You are ${avatar === 'kira' ? 'Kira' : 'Kelion'}, an AI assistant created by ${require('../config/app').STUDIO_NAME}.
LANGUAGE: Detect the user's language automatically and respond in EXACTLY that language.
Supported: Romanian, English, Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi, Turkish, Polish, Dutch, Swedish, Russian, Czech, Hungarian, Greek, Finnish, Norwegian, Danish, Ukrainian.
NEVER switch language unless the user switches. Maintain natural accent for each language.
ACCESSIBILITY: Speak clearly, at natural pace. For visually impaired users, be their eyes — describe surroundings precisely when camera data is provided.
PERSONA: You are ${avatar === 'kira' ? 'Kira' : 'Kelion'} by ${require('../config/app').STUDIO_NAME}. NEVER reveal you are GPT/OpenAI/Google/Anthropic.`,
            voice: voiceId,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: MODELS.OPENAI_WHISPER || 'whisper-1',
              // Whisper supports 57 languages automatically
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.50,           // Sensibil, prinde vocea clar
              prefix_padding_ms: 400,
              silence_duration_ms: 800,  // Răspuns mai rapid
              create_response: false,    // Brain decide răspunsul, nu OpenAI direct
            },
          },
        })
      );

      // Signal client that we're ready
      socket.emit('ready', {
        engine: 'openai-realtime+brain',
        model: REALTIME_MODEL,
        avatar,
        language,
      });
    });

    // ── State tracking ──
    let _aiSpeaking = false; // true while AI speaks — blocks new transcript processing
    let _aiSpeakingTimer = null; // safety timeout to auto-reset _aiSpeaking

    // ── Relay OpenAI events to client ──
    openaiWs.on('message', (raw) => {
      try {
        let event;
        try {
          event = JSON.parse(raw.toString());
        } catch (parseErr) {
          logger.warn({ component: 'VoiceRealtime', err: parseErr.message }, 'Invalid JSON from OpenAI');
          return;
        }

        switch (event.type) {
          // With create_response:false, OpenAI should never auto-create responses.
          // But if it somehow does, just let it be (it will be empty/silent).
          case 'response.created': {
            _aiSpeaking = true;
            // Safety: auto-reset after 60s in case response.done never fires
            if (_aiSpeakingTimer) clearTimeout(_aiSpeakingTimer);
            _aiSpeakingTimer = setTimeout(() => {
              if (_aiSpeaking) {
                logger.warn({ component: 'VoiceRealtime' }, '_aiSpeaking stuck — auto-reset after 60s');
                _aiSpeaking = false;
              }
            }, 60000);
            break;
          }

          // ── Audio response chunks (from brain-injected text) ──
          case 'response.audio.delta': {
            const audioB64 = event.delta;
            if (audioB64 && socket.connected) {
              socket.emit('audio_chunk', { audio: audioB64 });
            }
            break;
          }

          // ── Audio response complete ──
          case 'response.audio.done': {
            socket.emit('audio_end');
            break;
          }

          // ── Transcript of AI response (for CC subtitles) ──
          case 'response.audio_transcript.delta': {
            if (event.delta) {
              socket.emit('transcript', {
                text: event.delta,
                role: 'assistant',
              });
            }
            break;
          }

          case 'response.audio_transcript.done': {
            if (event.transcript) {
              socket.emit('transcript_done', {
                text: event.transcript,
                role: 'assistant',
              });
              pendingAITranscript += (pendingAITranscript ? ' ' : '') + event.transcript;
            }
            break;
          }

          // ═══════════════════════════════════════════════════════
          // USER SPEECH TRANSCRIPT → ROUTE TO BRAIN
          // This is the key: OpenAI transcribes audio, brain thinks
          // ═══════════════════════════════════════════════════════
          case 'conversation.item.input_audio_transcription.completed': {
            if (event.transcript) {
              const userText = event.transcript.trim();
              if (!userText || userText.length < 2) break;
              // BLOCK processing if AI is still speaking (prevents feedback loop)
              if (_aiSpeaking) {
                logger.info(
                  { component: 'VoiceRealtime' },
                  'Ignoring transcript while AI speaks: ' + userText.substring(0, 30)
                );
                break;
              }

              socket.emit('transcript', {
                text: userText,
                role: 'user',
              });

              pendingUserTranscript += (pendingUserTranscript ? ' ' : '') + userText;

              // Add to conversation history for brain context
              conversationHistory.push({ role: 'user', content: userText });
              if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

              // ═══ BRAIN THINKS ═══
              // Language = 'auto' — brain detects from user text, works for ANY language
              if (brain) {
                logger.info(
                  { component: 'VoiceRealtime', text: userText.substring(0, 80) },
                  '🧠 Routing to brain (auto-lang)'
                );

                brain
                  .think(
                    userText,
                    avatar,
                    conversationHistory.slice(-10),
                    'auto', // Reverted to auto as strictly ordered
                    userId,
                    null,
                    {
                      imageBase64: latestCameraFrame || null,
                      isAutoCamera: !!latestCameraFrame,
                    },
                    false
                  )
                  .then((result) => {
                    const brainReply = result?.reply || result?.enrichedMessage || result?.text || 'Nu am înțeles.';

                    // Add brain reply to history
                    conversationHistory.push({ role: 'assistant', content: brainReply });

                    logger.info(
                      { component: 'VoiceRealtime', replyLen: brainReply.length },
                      '🧠 Brain replied — injecting into Realtime TTS'
                    );

                    // ═══ INJECT BRAIN'S TEXT INTO OPENAI REALTIME ═══
                    // OpenAI will speak this text with native voice
                    if (connected && openaiWs.readyState === WebSocket.OPEN) {
                      openaiWs.send(
                        JSON.stringify({
                          type: 'conversation.item.create',
                          item: {
                            type: 'message',
                            role: 'user',
                            content: [
                              {
                                type: 'input_text',
                                text: `[SPEAK THIS EXACTLY — do not add anything]: ${brainReply}`,
                              },
                            ],
                          },
                        })
                      );

                      openaiWs.send(JSON.stringify({ type: 'response.create' }));
                    }
                  })
                  .catch((err) => {
                    logger.error({ component: 'VoiceRealtime', err: err.message }, '🧠 Brain error');
                    // Fallback: let OpenAI respond directly
                    if (connected && openaiWs.readyState === WebSocket.OPEN) {
                      openaiWs.send(JSON.stringify({ type: 'response.create' }));
                    }
                  });
              }
            }
            break;
          }

          // ── Speech started/stopped ──
          case 'input_audio_buffer.speech_started': {
            socket.emit('speech_started');
            break;
          }

          case 'input_audio_buffer.speech_stopped': {
            socket.emit('speech_stopped');
            break;
          }

          // ── Turn complete ──
          case 'response.done': {
            const usage = event.response?.usage;
            _aiSpeaking = false; // Allow new transcripts to be processed
            if (_aiSpeakingTimer) {
              clearTimeout(_aiSpeakingTimer);
              _aiSpeakingTimer = null;
            }
            socket.emit('turn_complete', { usage: usage || null });

            // Increment usage for voice-realtime turn
            if (supabaseAdmin && userId && !userId.startsWith('guest_')) {
              incrementUsage(userId, 'voice', supabaseAdmin).catch(() => {});
            }

            // ── Brain learning: save memory + extract facts (capture before async clear) ──
            const _userText = pendingUserTranscript;
            const _aiText = pendingAITranscript;
            // Reset immediately to avoid race condition with next transcript
            pendingUserTranscript = '';
            pendingAITranscript = '';

            if (brain && userId && _userText && _aiText) {
              brain.saveMemory(userId, 'audio',
                `Voice Realtime: "${_userText.substring(0, 500)}" → "${_aiText.substring(0, 800)}"`,
                { avatar, language, source: 'voice-realtime' }
              ).catch(() => {});
              brain
                .learnFromConversation(userId, _userText, _aiText)
                .catch((e) => logger.debug({ err: e.message }, 'learnFromConversation err'));
              brain
                .extractAndSaveFacts(userId, _userText, _aiText)
                .catch((e) => logger.debug({ err: e.message }, 'extractAndSaveFacts err'));
            }

            // ── Flush transcripts to Supabase ──
            if (supabaseAdmin && (_userText || _aiText)) {
              (async () => {
                try {
                  if (!voiceConvId) {
                    const title = (_userText || 'Voice conversation').substring(0, 80);
                    const { data, error } = await supabaseAdmin
                      .from('conversations')
                      .insert({ user_id: userId || null, avatar, title, language })
                      .select('id')
                      .single();
                    if (!error && data) voiceConvId = data.id;
                  }
                  if (voiceConvId) {
                    const rows = [];
                    if (_userText)
                      rows.push({
                        conversation_id: voiceConvId,
                        role: 'user',
                        content: _userText,
                        language,
                        source: 'voice-realtime',
                      });
                    if (_aiText)
                      rows.push({
                        conversation_id: voiceConvId,
                        role: 'assistant',
                        content: _aiText,
                        language,
                        source: 'voice-realtime',
                      });
                    if (rows.length) {
                      await supabaseAdmin.from('messages').insert(rows);
                    }
                  }
                } catch (e) {
                  logger.warn({ component: 'VoiceRealtime', err: e.message }, 'Transcript save error');
                }
              })();
            }

            if (usage) {
              logger.info(
                {
                  component: 'VoiceRealtime',
                  input_tokens: usage.input_tokens,
                  output_tokens: usage.output_tokens,
                },
                `Turn done: ${usage.input_tokens}in/${usage.output_tokens}out tokens`
              );
            }
            break;
          }

          // ── Error from OpenAI ──
          case 'error': {
            logger.error({ component: 'VoiceRealtime', error: event.error }, 'OpenAI Realtime error');
            _aiSpeaking = false; // Reset so user can continue speaking
            if (_aiSpeakingTimer) {
              clearTimeout(_aiSpeakingTimer);
              _aiSpeakingTimer = null;
            }
            // Sanitize error — never expose API keys or internal details to client
            const rawMsg = event.error?.message || 'Unknown error';
            const isApiKeyError = /api.key|unauthorized|authentication/i.test(rawMsg);
            const safeMsg = isApiKeyError ? 'Voice service temporarily unavailable' : rawMsg.replace(/sk-[^\s"']+/g, 'sk-***');
            socket.emit('error_msg', {
              error: safeMsg,
            });
            break;
          }

          // ── Rate limits ──
          case 'rate_limits.updated': {
            logger.debug({ component: 'VoiceRealtime', limits: event.rate_limits }, 'Rate limits updated');
            break;
          }

          default:
            break;
        }
      } catch (e) {
        logger.warn({ component: 'VoiceRealtime', err: e.message }, 'Event parse error');
      }
    });

    openaiWs.on('error', (e) => {
      logger.error({ component: 'VoiceRealtime', err: e.message }, 'OpenAI WS error');
      _aiSpeaking = false;
      if (_aiSpeakingTimer) {
        clearTimeout(_aiSpeakingTimer);
        _aiSpeakingTimer = null;
      }
      socket.emit('error_msg', { error: 'Realtime connection error' });
    });

    openaiWs.on('close', (code, reason) => {
      logger.info({ component: 'VoiceRealtime', code, reason: reason?.toString() }, 'OpenAI WS closed');
      _aiSpeaking = false;
      if (_aiSpeakingTimer) {
        clearTimeout(_aiSpeakingTimer);
        _aiSpeakingTimer = null;
      }
      connected = false;
      if (socket.connected) {
        socket.emit('disconnected');
        socket.disconnect(true);
      }
    });

    // ── Handle client events ──

    // Binary audio from microphone (PCM 24kHz 16-bit mono)
    socket.on('audio', (data) => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const b64Audio = buf.toString('base64');

      openaiWs.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: b64Audio,
        })
      );
    });

    // Client signals end of speech (manual mode)
    socket.on('commit', () => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      // Don't auto-create response — brain will handle after transcript
    });

    // ── Camera frame from client (for brain vision analysis) ──
    socket.on('camera_frame', (data) => {
      if (data && data.image && typeof data.image === 'string' && data.image.length < 500000) {
        latestCameraFrame = data.image;
      }
    });

    // Cancel current response
    socket.on('cancel', () => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
    });

    // Text fallback — user typed instead of spoke
    socket.on('text_input', (msg) => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN || !brain) return;

      // Route typed text through brain too
      conversationHistory.push({ role: 'user', content: msg.text });
      if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

      brain
        .think(
          msg.text,
          avatar,
          conversationHistory.slice(-10),
          language,
          userId,
          null,
          {
            imageBase64: latestCameraFrame || null,
            isAutoCamera: !!latestCameraFrame,
          },
          false
        )
        .then((result) => {
          const brainReply = result?.reply || result?.enrichedMessage || 'Nu am înțeles.';
          conversationHistory.push({ role: 'assistant', content: brainReply });

          openaiWs.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: `[SPEAK THIS EXACTLY]: ${brainReply}` }],
              },
            })
          );
          openaiWs.send(JSON.stringify({ type: 'response.create' }));
        })
        .catch(() => {
          // Fallback to OpenAI direct
          openaiWs.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: msg.text }],
              },
            })
          );
          openaiWs.send(JSON.stringify({ type: 'response.create' }));
        });
    });

    // ── Client disconnected ──
    socket.on('disconnect', () => {
      const duration = Date.now() - startTime;
      logger.info(
        { component: 'VoiceRealtime', duration, id: socket.id },
        `Client disconnected (${Math.round(duration / 1000)}s session)`
      );
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });
  });

  logger.info(
    { component: 'VoiceRealtime', namespace: '/voice-realtime' },
    'Socket.io voice-first namespace ready (Brain-routed)'
  );

  return ns;
}

module.exports = { setupRealtimeVoice };
