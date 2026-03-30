// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Live: Brain-Powered Audio-to-Audio Chat
// Pipeline: Mic → Noise Filter → Deepgram Nova-3 STT → Brain.think()
//           (+ visual context from camera) → ElevenLabs TTS → Speaker
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { getVoiceId } = require('../config/voices');
const { MODELS, API_ENDPOINTS } = require('../config/models');
const { circuitAllow, circuitSuccess, circuitFailure } = require('../scalability');

// ─── Deepgram Nova-3 Streaming STT (best quality + language detection) ───
function createDeepgramLiveSTT(onTranscript, language = 'multi') {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;
  if (!circuitAllow('deepgram')) return null;

  // Multi-language mode for auto-detection, or specific language
  const langParam = language === 'multi' ? 'multi' : language;
  const ws = new WebSocket(
    `${API_ENDPOINTS.DEEPGRAM}/listen?model=nova-3&language=${langParam}&detect_language=true&smart_format=true&endpointing=300&utterance_end_ms=1200&interim_results=true&punctuate=true&diarize=false&filler_words=false`,
    { headers: { Authorization: `Token ${key}` } }
  );

  ws.on('open', () => {
    circuitSuccess('deepgram');
    logger.info({ component: 'VoiceLive.STT' }, 'Deepgram Nova-3 connected (lang detection ON)');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        if (alt?.transcript) {
          const detectedLang = msg.channel?.detected_language || language;
          onTranscript({
            text: alt.transcript,
            isFinal: msg.is_final,
            speechFinal: msg.speech_final,
            confidence: alt.confidence || 0,
            language: detectedLang,
          });
        }
      }
    } catch (e) {
      logger.warn({ component: 'VoiceLive.STT', err: e.message }, 'parse error');
    }
  });

  ws.on('error', (e) => {
    circuitFailure('deepgram');
    logger.error({ component: 'VoiceLive.STT', err: e.message }, 'WS error');
  });

  return {
    send: (audioChunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(audioChunk);
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) {
        circuitSuccess('deepgram');
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close();
      }
    },
    ws,
  };
}

// ─── ElevenLabs Conversational TTS (WebSocket streaming) ───
function createElevenLabsLiveTTS(onAudio, voiceId) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  if (!circuitAllow('elevenlabs')) return null;

  const ws = new WebSocket(
    `${API_ENDPOINTS.ELEVENLABS_WS}/text-to-speech/${voiceId}/stream-input?model_id=${MODELS.ELEVENLABS_FLASH}&optimize_streaming_latency=4&output_format=pcm_24000`
  );

  let ready = false;

  ws.on('open', () => {
    ready = true;
    circuitSuccess('elevenlabs');
    // Initialize stream with natural voice settings
    ws.send(JSON.stringify({
      text: ' ',
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.80,
        style: 0.15,
        use_speaker_boost: true,
      },
      xi_api_key: key,
    }));
    logger.info({ component: 'VoiceLive.TTS', voiceId }, 'ElevenLabs TTS connected');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.audio) {
        const audioBuf = Buffer.from(msg.audio, 'base64');
        onAudio(audioBuf);
      }
      if (msg.isFinal) {
        onAudio(null); // signal end
      }
      if (msg.alignment) {
        // Forward alignment data for lip sync
        onAudio({ alignment: msg.alignment });
      }
    } catch (e) {
      logger.warn({ component: 'VoiceLive.TTS', err: e.message }, 'parse error');
    }
  });

  ws.on('error', (e) => {
    circuitFailure('elevenlabs');
    logger.error({ component: 'VoiceLive.TTS', err: e.message }, 'WS error');
  });

  ws.on('close', () => {
    ready = false;
  });

  return {
    speak: (text, more = false) => {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        text: text,
        try_trigger_generation: true,
        flush: !more,
      }));
    },
    flush: () => {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ text: '' }));
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ text: '' })); } catch (_e) { /* */ }
        ws.close();
      }
    },
    ws,
    isReady: () => ready && ws.readyState === WebSocket.OPEN,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Setup WebSocket voice-live pipeline
// ═══════════════════════════════════════════════════════════════
function setupVoiceLive(server, appLocals) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: true });
  const brain = appLocals?.brain || null;

  // Per-IP rate limiting
  const ipConnections = new Map();
  const MAX_CONNECTIONS_PER_IP = 2;

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname !== '/api/voice-live') return; // let other handlers process

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
    let language = url.searchParams.get('language') || 'multi';
    const voiceId = getVoiceId(avatar, language === 'multi' ? 'ro' : language);
    const token = url.searchParams.get('token') || null;

    // Resolve user from token
    let userId = null;
    let userName = null;
    if (token && appLocals?.supabaseAdmin) {
      try {
        const { data: { user } } = await appLocals.supabaseAdmin.auth.getUser(token);
        if (user?.id) {
          userId = user.id;
          userName = user.user_metadata?.full_name || null;
        }
      } catch (_e) { /* anonymous */ }
    }

    logger.info({ component: 'VoiceLive', avatar, language, userId: userId || 'anon', userName }, 'Client connected');

    let sttHandler = null;
    let ttsHandler = null;
    let currentVisualContext = null; // latest camera frame description
    let currentVisualRaw = null;    // latest raw base64 image (for brain)
    let detectedLanguage = language === 'multi' ? 'ro' : language;
    const conversationHistory = [];
    const startTime = Date.now();
    let _processing = false;

    // ── Brain-powered response generation ──
    async function processUserMessage(userText, lang) {
      if (_processing) return;
      _processing = true;

      const turnStart = Date.now();
      detectedLanguage = lang || detectedLanguage;

      // Update voice ID if language changed
      const currentVoiceId = getVoiceId(avatar, detectedLanguage);

      try {
        // Close previous TTS to prevent leaks
        if (ttsHandler) {
          try { ttsHandler.close(); } catch (_e) { /* */ }
        }

        // Create new TTS handler with correct voice
        const onAudioChunk = (chunk) => {
          if (clientWs.readyState !== WebSocket.OPEN) return;
          if (chunk === null) {
            clientWs.send(JSON.stringify({ type: 'audio_end' }));
          } else if (chunk.alignment) {
            clientWs.send(JSON.stringify({ type: 'alignment', data: chunk.alignment }));
          } else {
            clientWs.send(chunk); // raw PCM
          }
        };

        ttsHandler = createElevenLabsLiveTTS(onAudioChunk, currentVoiceId);
        if (!ttsHandler) {
          clientWs.send(JSON.stringify({ type: 'error', error: 'TTS unavailable' }));
          _processing = false;
          return;
        }

        // Wait for TTS ready
        await new Promise((resolve) => {
          if (ttsHandler.isReady()) return resolve();
          ttsHandler.ws.on('open', () => setTimeout(resolve, 100));
          setTimeout(resolve, 4000);
        });

        // ═══ BRAIN INTEGRATION — full context thinking ═══
        conversationHistory.push({ role: 'user', content: userText });
        if (conversationHistory.length > 20) {
          conversationHistory.splice(0, conversationHistory.length - 20);
        }

        clientWs.send(JSON.stringify({ type: 'thinking', text: userText }));

        let fullReply = '';
        let emotion = 'neutral';

        if (brain) {
          // Build visual context string for brain
          let visualNote = '';
          if (currentVisualContext) {
            visualNote = `\n[VISUAL CONTEXT — what camera sees right now]: ${currentVisualContext}`;
          }

          // Use brain.think() for full reasoning + memory + tools
          const brainOptions = {
            visualContext: currentVisualContext || null,
            visualImage: currentVisualRaw || null,
            voiceMode: true,
            conversationHistory,
          };

          const result = await brain.think(
            userText + visualNote,
            avatar,
            conversationHistory.slice(-10),
            detectedLanguage,
            userId,
            null,
            brainOptions
          );

          fullReply = result?.reply || result?.text || result || '';

          // Parse emotion
          const emotionMatch = fullReply.match(/\[EMOTION:\s*(\w+)\]/i);
          if (emotionMatch) {
            emotion = emotionMatch[1].toLowerCase();
            fullReply = fullReply.replace(/\[EMOTION:\s*\w+\]/gi, '').trim();
          }
          // Remove gesture tags
          fullReply = fullReply.replace(/\[GESTURE:\s*\w+\]/gi, '').trim();
          // Remove markdown
          fullReply = fullReply
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/https?:\/\/\S+/g, '')
            .replace(/[*_~#>]+/g, '')
            .replace(/\n{2,}/g, '. ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        } else {
          fullReply = 'Brain unavailable.';
        }

        // ── Stream reply text to TTS in natural sentence chunks ──
        if (fullReply && ttsHandler.isReady()) {
          const sentences = fullReply.match(/[^.!?;]+[.!?;]?\s*/g) || [fullReply];
          for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i].trim();
            if (!sentence) continue;
            ttsHandler.speak(sentence, i < sentences.length - 1);
          }
          ttsHandler.flush();
        }

        // Send text + emotion to client
        conversationHistory.push({ role: 'assistant', content: fullReply });

        clientWs.send(JSON.stringify({
          type: 'reply',
          text: fullReply,
          emotion,
          language: detectedLanguage,
          avatar,
          duration: Date.now() - turnStart,
        }));

        // Send emotion for avatar
        if (emotion !== 'neutral') {
          clientWs.send(JSON.stringify({ type: 'emotion', emotion }));
        }

        // ── Save to brain memory ──
        if (brain && userId) {
          brain.saveMemory(userId, 'audio',
            `Voice Live: "${userText.substring(0, 200)}" → "${fullReply.substring(0, 300)}"`,
            { avatar, language: detectedLanguage, emotion, source: 'voice-live' }
          ).catch(() => {});
          brain.learnFromConversation(userId, userText, fullReply).catch(() => {});
          brain.extractAndSaveFacts(userId, userText, fullReply).catch(() => {});
        }

        logger.info({
          component: 'VoiceLive',
          duration: Date.now() - turnStart,
          replyLen: fullReply.length,
          emotion,
          lang: detectedLanguage,
        }, `Voice turn: ${Date.now() - turnStart}ms`);
      } catch (e) {
        logger.error({ component: 'VoiceLive', err: e.message }, 'Voice turn error');
        clientWs.send(JSON.stringify({ type: 'error', error: e.message }));
      } finally {
        _processing = false;
      }
    }

    // ── STT: Deepgram Nova-3 with language detection ──
    const onTranscript = (result) => {
      if (!result.speechFinal && !result.isFinal) {
        // Interim → show live subtitle
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'transcript',
            text: result.text,
            interim: true,
            confidence: result.confidence,
            language: result.language,
          }));
        }
        return;
      }

      // Final transcript → process
      const userText = result.text.trim();
      if (!userText || userText.length < 2) return;

      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'transcript',
          text: userText,
          interim: false,
          confidence: result.confidence,
          language: result.language,
        }));
      }

      processUserMessage(userText, result.language);
    };

    if (process.env.DEEPGRAM_API_KEY) {
      sttHandler = createDeepgramLiveSTT(onTranscript, language);
    }

    // ── Handle client messages ──
    clientWs.on('message', (data) => {
      try {
        // Binary = audio PCM from mic
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          if (sttHandler) sttHandler.send(data);
          return;
        }

        const msg = JSON.parse(data.toString());

        // Visual context update from camera
        if (msg.type === 'visual_context') {
          currentVisualContext = msg.description || null;
          currentVisualRaw = msg.image || null;
        }

        // Text fallback (when no Deepgram)
        if (msg.type === 'text_input') {
          onTranscript({
            text: msg.text,
            isFinal: true,
            speechFinal: true,
            confidence: 1,
            language: msg.language || detectedLanguage,
          });
        }

        // Config update
        if (msg.type === 'config') {
          if (msg.language) {
            detectedLanguage = msg.language;
            language = msg.language;
          }
          logger.info({ component: 'VoiceLive', config: msg }, 'Config update');
        }
      } catch (e) {
        logger.warn({ component: 'VoiceLive', err: e.message }, 'Message parse error');
      }
    });

    // ── Cleanup ──
    clientWs.on('close', () => {
      logger.info({ component: 'VoiceLive', duration: Date.now() - startTime }, 'Client disconnected');
      if (sttHandler) try { sttHandler.close(); } catch (_e) { /* */ }
      if (ttsHandler) try { ttsHandler.close(); } catch (_e) { /* */ }
    });

    clientWs.on('error', (err) => {
      logger.error({ component: 'VoiceLive', err: err.message }, 'Client WS error');
      if (sttHandler) try { sttHandler.close(); } catch (_e) { /* */ }
      if (ttsHandler) try { ttsHandler.close(); } catch (_e) { /* */ }
    });

    // ── Ready signal ──
    clientWs.send(JSON.stringify({
      type: 'ready',
      stt: process.env.DEEPGRAM_API_KEY ? 'deepgram-nova-3' : 'browser',
      tts: 'elevenlabs',
      llm: 'brain',
      avatar,
      language,
      voiceId,
      userName: userName || null,
    }));
  });
}

module.exports = { setupVoiceLive };
