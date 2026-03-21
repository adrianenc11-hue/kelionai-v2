// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Stream (Sub-1s Pipeline)
// Deepgram STT → Groq LLM (streaming) → Cartesia TTS (streaming)
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { getVoiceId } = require('../config/voices');
const { MODELS, PERSONAS } = require('../config/models');

// ─── Deepgram STT (WebSocket Streaming) ───
function createDeepgramSTT(onTranscript, language = 'ro') {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return null;

  const ws = new WebSocket(
    `wss://api.deepgram.com/v1/listen?model=nova-3&language=${language}&smart_format=true&endpointing=300&utterance_end_ms=1000&interim_results=true`,
    { headers: { Authorization: `Token ${key}` } }
  );

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        if (alt?.transcript) {
          onTranscript({
            text: alt.transcript,
            isFinal: msg.is_final,
            speechFinal: msg.speech_final,
          });
        }
      }
    } catch (e) {
      logger.warn({ component: 'DeepgramSTT', err: e.message }, 'parse error');
    }
  });

  ws.on('error', (e) => logger.error({ component: 'DeepgramSTT', err: e.message }, 'WS error'));

  return {
    send: (audioChunk) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(audioChunk);
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws.close();
      }
    },
    ws,
  };
}

// ─── Groq LLM (Streaming Tokens) ───
async function* streamGroqChat(messages, avatar = 'kelion', language = 'ro', brain = null, userId = null) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const persona = PERSONAS[avatar] || PERSONAS.kelion;

  // Build memory context from brain if available
  let memoryContext = '';
  if (brain && userId) {
    try {
      const [memories, visualMem, audioMem, facts] = await Promise.all([
        brain.loadMemory(userId, 'text', 5),
        brain.loadMemory(userId, 'visual', 3),
        brain.loadMemory(userId, 'audio', 3),
        brain.loadFacts(userId, 10),
      ]);
      memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
    } catch (e) {
      logger.warn({ component: 'VoiceStream', err: e.message }, 'Memory load failed');
    }
  }

  const systemMsg = `${persona} Respond in ${language === 'ro' ? 'Romanian' : 'English'}. Keep responses concise for voice conversation (2-3 sentences max). Do NOT use markdown, bullets, or special formatting — this is spoken aloud.
At the END of your response, add [EMOTION:xxx] tag (happy/sad/thinking/curious/concerned/laughing/surprised/neutral).
${memoryContext}`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: MODELS.GROQ_PRIMARY,
      messages: [{ role: 'system', content: systemMsg }, ...messages],
      stream: true,
      temperature: 0.7,
      max_tokens: 256,
    }),
  });

  if (!r.ok) throw new Error(`Groq ${r.status}: ${await r.text()}`);

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const value of r.body) {
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch {
        /* ignored */
      }
    }
  }
}

// ─── Cartesia TTS (WebSocket Streaming) ───
function createCartesiaTTS(onAudio, voiceId, language = 'ro') {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) return null;

  const ws = new WebSocket(`wss://api.cartesia.ai/tts/websocket?api_key=${key}&cartesia_version=2025-04-16`);

  const contextId = 'ctx_' + Date.now();
  let ready = false;

  ws.on('open', () => {
    ready = true;
    logger.info({ component: 'CartesiaTTS' }, 'WebSocket connected');
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'chunk' && msg.data) {
        // msg.data is base64-encoded PCM audio
        const audioBuf = Buffer.from(msg.data, 'base64');
        onAudio(audioBuf);
      }
      if (msg.type === 'done') {
        onAudio(null); // Signal end of audio
      }
    } catch (e) {
      logger.warn({ component: 'CartesiaTTS', err: e.message }, 'parse error');
    }
  });

  ws.on('error', (e) => logger.error({ component: 'CartesiaTTS', err: e.message }, 'WS error'));

  return {
    speak: (text, isContinuation = false) => {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          model_id: 'sonic-2',
          transcript: text,
          voice: {
            mode: 'id',
            id: voiceId || 'a0e99841-438c-4a64-b679-ae501e7d6091',
          },
          language: language === 'ro' ? 'ro' : 'en',
          context_id: contextId,
          output_format: {
            container: 'raw',
            encoding: 'pcm_s16le',
            sample_rate: 24000,
          },
          continue: isContinuation,
        })
      );
    },
    flush: () => {
      if (ready && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            context_id: contextId,
            transcript: '',
            continue: false,
          })
        );
      }
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
    ws,
  };
}

// ─── ElevenLabs TTS WebSocket (Fallback — works with existing API key) ───
function createElevenLabsTTS(onAudio, voiceId) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;

  const ws = new WebSocket(
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_v3_conversational&optimize_streaming_latency=4&output_format=pcm_24000`
  );

  let ready = false;

  ws.on('open', () => {
    ready = true;
    // Initialize the stream with voice settings
    ws.send(
      JSON.stringify({
        text: ' ',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        xi_api_key: key,
      })
    );
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.audio) {
        const audioBuf = Buffer.from(msg.audio, 'base64');
        onAudio(audioBuf);
      }
      if (msg.isFinal) {
        onAudio(null);
      }
    } catch (e) {
      logger.warn({ component: 'ElevenLabsTTS', err: e.message }, 'parse');
    }
  });

  ws.on('error', (e) => logger.error({ component: 'ElevenLabsTTS', err: e.message }, 'WS error'));

  return {
    speak: (text) => {
      if (!ready || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ text, try_trigger_generation: true }));
    },
    flush: () => {
      if (ready && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ text: '' })); // Empty string signals flush
      }
    },
    close: () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    },
    ws,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Setup WebSocket voice pipeline on the HTTP server
// ═══════════════════════════════════════════════════════════════
function setupVoiceStream(server, appLocals) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: true });
  const brain = appLocals?.brain || null;

  // Handle upgrade requests for /api/voice-stream
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/api/voice-stream') {
      // Allow compression negotiation for Railway proxy compatibility
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const avatar = url.searchParams.get('avatar') || 'kelion';
    const language = url.searchParams.get('language') || 'ro';
    const voiceId = getVoiceId(avatar, language);
    const token = url.searchParams.get('token') || null;

    // Resolve userId from token (non-blocking — auth optional)
    let userId = null;
    if (token && appLocals?.supabaseAdmin) {
      try {
        const {
          data: { user },
        } = await appLocals.supabaseAdmin.auth.getUser(token);
        if (user?.id) userId = user.id;
      } catch (_e) {
        /* token invalid — continue as anonymous */
      }
    }

    logger.info(
      { component: 'VoiceStream', avatar, language, userId: userId || 'anon' },
      'Client connected to voice stream'
    );

    let sttHandler = null;
    let ttsHandler = null;
    let sentenceBuffer = '';
    const conversationHistory = [];
    const startTime = Date.now();

    // ── Step 1: Setup STT ──
    // When Deepgram is available, use it. Otherwise fallback to client-side STT.
    const onTranscript = async (result) => {
      if (!result.speechFinal) {
        // Send interim results for live feedback
        clientWs.send(
          JSON.stringify({
            type: 'transcript',
            text: result.text,
            interim: true,
          })
        );
        return;
      }

      // Final transcript → feed to LLM
      const userText = result.text.trim();
      if (!userText) return;

      clientWs.send(JSON.stringify({ type: 'transcript', text: userText, interim: false }));

      const llmStart = Date.now();
      conversationHistory.push({ role: 'user', content: userText });

      // ── Step 2: Stream LLM → TTS ──
      try {
        // Create TTS handler (Cartesia preferred, ElevenLabs fallback)
        const onAudioChunk = (chunk) => {
          if (chunk === null) {
            clientWs.send(JSON.stringify({ type: 'audio_end' }));
          } else if (clientWs.readyState === WebSocket.OPEN) {
            // Send raw PCM audio to client
            clientWs.send(chunk);
          }
        };

        ttsHandler = createCartesiaTTS(onAudioChunk, voiceId, language) || createElevenLabsTTS(onAudioChunk, voiceId);

        if (!ttsHandler) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              error: 'No TTS provider available',
            })
          );
          return;
        }

        // Wait for TTS WebSocket to be ready
        await new Promise((resolve) => {
          if (ttsHandler.ws.readyState === WebSocket.OPEN) return resolve();
          ttsHandler.ws.on('open', resolve);
          setTimeout(resolve, 3000); // timeout
        });

        clientWs.send(
          JSON.stringify({
            type: 'llm_start',
            ttft: Date.now() - llmStart,
          })
        );

        let fullReply = '';
        sentenceBuffer = '';

        // Stream LLM tokens and feed sentences to TTS
        for await (const token of streamGroqChat(
          conversationHistory,
          avatar,
          language,
          brain,
          null // userId — TODO: extract from WebSocket auth
        )) {
          fullReply += token;
          sentenceBuffer += token;

          // Send text token to client for display
          clientWs.send(JSON.stringify({ type: 'token', text: token }));

          // Feed TTS when we have a natural sentence boundary
          const sentenceEnd = sentenceBuffer.match(/[.!?;:,]\s/);
          if (sentenceEnd) {
            const idx = sentenceEnd.index + sentenceEnd[0].length;
            const sentence = sentenceBuffer.substring(0, idx);
            sentenceBuffer = sentenceBuffer.substring(idx);
            ttsHandler.speak(sentence, fullReply.length > sentence.length);
          }
        }

        // Flush remaining text to TTS
        if (sentenceBuffer.trim()) {
          ttsHandler.speak(sentenceBuffer.trim(), true);
        }
        ttsHandler.flush();

        conversationHistory.push({ role: 'assistant', content: fullReply });

        // ═══ BRAIN INTEGRATION — parse emotion/gesture + save memory ═══
        let emotion = 'neutral';
        const gestures = [];
        const emotionMatch = fullReply.match(/\[EMOTION:\s*(\w+)\]/i);
        if (emotionMatch) {
          emotion = emotionMatch[1].toLowerCase();
          fullReply = fullReply.replace(/\[EMOTION:\s*\w+\]/gi, '').trim();
        }
        const gestureMatches = fullReply.matchAll(/\[GESTURE:\s*(\w+)\]/gi);
        for (const gm of gestureMatches) gestures.push(gm[1].toLowerCase());
        fullReply = fullReply.replace(/\[GESTURE:\s*\w+\]/gi, '').trim();

        // Send emotion + gestures to client
        if (emotion !== 'neutral') {
          clientWs.send(JSON.stringify({ type: 'emotion', emotion }));
        }
        for (const g of gestures) {
          clientWs.send(JSON.stringify({ type: 'gesture', gesture: g }));
        }

        // Save conversation to brain memory
        if (brain) {
          brain
            .saveMemory(
              userId,
              'audio',
              'Voice: ' + userText.substring(0, 200) + ' | Reply: ' + fullReply.substring(0, 300),
              {
                avatar,
                language,
                emotion,
              }
            )
            .catch(() => {});
        }

        const totalTime = Date.now() - llmStart;
        clientWs.send(
          JSON.stringify({
            type: 'turn_complete',
            reply: fullReply,
            emotion,
            gestures,
            totalTime,
          })
        );

        logger.info(
          {
            component: 'VoiceStream',
            totalTime,
            replyLen: fullReply.length,
            emotion,
          },
          `Voice turn: ${totalTime}ms | ${fullReply.length}c | ${emotion}`
        );
      } catch (e) {
        logger.error({ component: 'VoiceStream', err: e.message }, 'Pipeline error');
        clientWs.send(JSON.stringify({ type: 'error', error: e.message }));
      }
    };

    // Try Deepgram streaming STT
    if (process.env.DEEPGRAM_API_KEY) {
      sttHandler = createDeepgramSTT(onTranscript, language);
    }

    // Handle incoming messages from client
    clientWs.on('message', (data) => {
      try {
        // Binary data = audio chunk from microphone
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          if (sttHandler) {
            sttHandler.send(data);
          }
          return;
        }

        // Text data = control messages
        const msg = JSON.parse(data.toString());

        if (msg.type === 'text_input') {
          // Client sends text directly (fallback when no Deepgram)
          onTranscript({
            text: msg.text,
            isFinal: true,
            speechFinal: true,
          });
        }

        if (msg.type === 'config') {
          // Runtime config updates
          logger.info({ component: 'VoiceStream', config: msg }, 'Config update');
        }
      } catch (e) {
        logger.warn({ component: 'VoiceStream', err: e.message }, 'Message parse');
      }
    });

    clientWs.on('close', () => {
      logger.info({ component: 'VoiceStream', duration: Date.now() - startTime }, 'Client disconnected');
      if (sttHandler) sttHandler.close();
      if (ttsHandler) ttsHandler.close();
    });

    // Send ready signal
    clientWs.send(
      JSON.stringify({
        type: 'ready',
        stt: !!process.env.DEEPGRAM_API_KEY ? 'deepgram' : 'browser',
        tts: process.env.CARTESIA_API_KEY ? 'cartesia' : process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'none',
        llm: 'groq',
        avatar,
        language,
      })
    );
  });

  return wss;
}

module.exports = { setupVoiceStream };
