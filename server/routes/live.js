// ═══════════════════════════════════════════════════════════════
// KelionAI — Live Audio Chat (OpenAI Realtime API — gpt-4o-realtime-preview)
// Socket.io namespace: /live
// Receives PCM, streams to OpenAI Realtime, returns AI Voice + Transcript
// Bypass Architecture: Direct Tool Calling, No Custom Brain Parsing
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { MODELS, PERSONAS, API_ENDPOINTS } = require('../config/models');
const { safetyClassifier } = require('../safety-classifier');

const REALTIME_URL = API_ENDPOINTS.OPENAI_REALTIME;
const REALTIME_MODEL = MODELS.GPT_REALTIME || 'gpt-4o-realtime-preview';
const VISION_MODEL = MODELS.GPT_VISION || 'gpt-4o';

async function analyzeFrameWithVision(imageBase64, language) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const langPrompt =
    language === 'ro'
      ? 'Răspunde în română. Descrie ce vezi pentru o persoană cu deficiențe vizuale: persoane, obiecte, text vizibil, pericole, distanțe. Fii concis dar complet (max 3 propoziții).'
      : 'Respond in English. Describe what you see for a visually impaired person: people, objects, visible text, hazards, distances. Be concise but thorough (max 3 sentences).';

  try {
    const r = await fetch(API_ENDPOINTS.OPENAI + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: langPrompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'low' } },
            ],
          },
        ],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    logger.warn({ component: 'VisionAnalysis', err: e.message }, 'GPT-4o Vision failed');
    return null;
  }
}

function setupLiveChat(io, _appLocals) {
  const ns = io.of('/live');

  // ── Per-IP connection rate limiting ──
  const ipConnections = new Map();
  const MAX_CONNECTIONS_PER_IP = 3;

  ns.on('connection', async (socket) => {
    // ── IP rate limiting ──
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address;
    const current = ipConnections.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) {
      logger.warn({ component: 'LiveChat', ip }, 'Too many connections from IP');
      socket.emit('error_msg', { error: 'Too many live connections' });
      socket.disconnect(true);
      return;
    }
    ipConnections.set(ip, current + 1);
    socket.on('disconnect', () => {
      const c = ipConnections.get(ip) || 1;
      if (c <= 1) ipConnections.delete(ip);
      else ipConnections.set(ip, c - 1);
    });

    // ── Mandatory auth ──
    const token = socket.handshake.query.token || null;
    const supabaseAdmin = _appLocals?.supabaseAdmin || null;
    let userId = null;
    if (token && supabaseAdmin) {
      try {
        const {
          data: { user },
        } = await supabaseAdmin.auth.getUser(token);
        if (user?.id) userId = user.id;
      } catch (_e) {
        /* invalid token */
      }
    }
    if (!userId) {
      // Allow guest users — assign a temporary session ID
      userId = 'guest_' + socket.id;
      logger.info({ component: 'LiveChat', ip }, 'Guest connection allowed: ' + userId);
    }

    const avatar = socket.handshake.query.avatar || 'kira';
    const initialLanguage = socket.handshake.query.language || 'en';
    let currentLanguage = initialLanguage;

    const voice = avatar === 'kira' ? 'shimmer' : 'alloy';
    const persona = PERSONAS[avatar] || PERSONAS.kelion || '';

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

    function detectLanguageFromText(text) {
      if (!text || text.length < 5) return null;
      const t = text.toLowerCase();
      if (
        /\b(sunt|este|pentru|despre|vreau|spune|bine|ce |cum |unde |c\u00e2nd |c\u0103 |\u0219i |sau |dar |nu |da |te |m\u0103 |\u00eemi|e\u0219ti|a\u021bi|vom|voi|avea|face|foarte|acum|aici|acolo|mergem|putem|trebuie)\b/.test(
          t
        )
      )
        return 'ro';
      if (/\b(hola|como|est\u00e1s|quiero|puedo|gracias|buenos|buenas|qu\u00e9|donde|cuando|tengo|necesito)\b/.test(t))
        return 'es';
      if (/\b(bonjour|comment|je suis|merci|s'il|qu'est|c'est|j'ai|nous|vous|o\u00f9|quand)\b/.test(t)) return 'fr';
      if (/\b(hallo|wie|ich bin|danke|bitte|warum|wo |wann|k\u00f6nnen|m\u00f6chte|haben)\b/.test(t)) return 'de';
      if (/\b(ciao|come|sono|grazie|voglio|posso|buongiorno|cosa|dove|quando)\b/.test(t)) return 'it';
      if (/\b(ol\u00e1|como|obrigado|preciso|quero|posso|bom dia|onde|quando)\b/.test(t)) return 'pt';
      if (
        /\b(the |is |are |was |what|where|when|how |can |will|would|should|have|this|that|hello|please|thank)\b/.test(t)
      )
        return 'en';
      return null;
    }

    const _langName = LANG_NAMES[currentLanguage] || currentLanguage;

    logger.info(
      { component: 'LiveChat', avatar, language: currentLanguage, id: socket.id },
      'Client connected to /live'
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      socket.emit('error_msg', { error: 'OPENAI_API_KEY not configured' });
      socket.disconnect(true);
      return;
    }

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
      logger.error({ component: 'LiveChat', err: e.message }, 'Failed to create OpenAI Realtime WS');
      socket.emit('error_msg', { error: 'Realtime API unavailable' });
      socket.disconnect(true);
      return;
    }

    openaiWs.on('open', async () => {
      connected = true;
      logger.info({ component: 'LiveChat', model: REALTIME_MODEL }, 'Connected to OpenAI Realtime');

      openaiWs.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: `${persona}\n\nIMPORTANT: You MUST respond in the SAME language the user speaks. If the user speaks Romanian, respond in Romanian. If the user speaks Spanish, respond in Spanish. Auto-detect and match their language. Keep responses concise for voice conversation (2-3 sentences max). Be warm, natural, and conversational. Do NOT use markdown formatting.\n\nCRITICAL AVATAR RULE: You MUST append avatar animation tags at the very end of your response text (e.g. "[EMOTION:happy] [GESTURE:wave]"). DO NOT speak these tags out loud, just include them in the text transcript. Valid emotions: happy, sad, angry, surprised, thinking, confused, excited, concerned, neutral. Valid gestures: nod, shake, tilt, wave, point, shrug, think, explain.\n\nYou are a voice-first assistant. The user is speaking to you directly via microphone.\n\nACCESSIBILITY: If the user has their camera active, you will receive periodic camera frames to help describe their surroundings.`,
            voice: voice,
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
            },
            tools: [
              {
                type: 'function',
                name: 'get_user_location',
                description:
                  'Fetches the user coordinates directly from their browser. Call this whenever you need to know where the user is (e.g., before checking weather).',
                parameters: { type: 'object', properties: {} },
              },
              {
                type: 'function',
                name: 'get_weather',
                description:
                  'Gets the current weather for a specific latitude and longitude. Always call get_user_location first if you do not know the coordinates.',
                parameters: {
                  type: 'object',
                  properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                    city: { type: 'string', description: 'Optional city name for display' },
                  },
                  required: ['lat', 'lng'],
                },
              },
              {
                type: 'function',
                name: 'web_search',
                description:
                  'Search the web for current information. Use when the user asks about news, facts, or anything you need to look up.',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'The search query' },
                  },
                  required: ['query'],
                },
              },
            ],
            tool_choice: 'auto',
          },
        })
      );

      socket.emit('ready', {
        engine: 'openai-realtime',
        model: REALTIME_MODEL,
        avatar,
        language: currentLanguage,
      });
    });

    openaiWs.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          case 'response.audio.delta': {
            if (event.delta && socket.connected) {
              const pcmBuf = Buffer.from(event.delta, 'base64');
              const wavBuf = encodeWAV(pcmBuf, 24000, 1);
              socket.emit('audio_chunk', { audio: wavBuf.toString('base64') });
            }
            break;
          }
          case 'response.audio.done': {
            socket.emit('audio_end');
            break;
          }
          case 'response.audio_transcript.delta': {
            if (event.delta) {
              socket.emit('transcript', { text: event.delta, role: 'assistant' });
            }
            break;
          }
          case 'response.audio_transcript.done': {
            if (event.transcript) {
              socket.emit('transcript', { text: event.transcript, role: 'assistant' });
            }
            break;
          }
          case 'conversation.item.input_audio_transcription.completed': {
            if (event.transcript) {
              const tSafety = safetyClassifier.classify(event.transcript, 'input');
              if (!tSafety.safe) {
                logger.warn({ component: 'LiveChat', category: tSafety.category }, '🛡️ Live chat transcript blocked');
                socket.emit('safety_warning', {
                  message: tSafety.message || 'Mesajul vocal a fost filtrat.',
                  category: tSafety.category,
                });
                break;
              }

              // ═══ AUTO-DETECT LANGUAGE FROM USER SPEECH ═══
              const detectedLang = detectLanguageFromText(event.transcript);
              if (detectedLang && detectedLang !== currentLanguage) {
                currentLanguage = detectedLang;
                const newLangName = LANG_NAMES[detectedLang] || detectedLang;
                logger.info(
                  { component: 'LiveChat', from: initialLanguage, to: detectedLang },
                  'Language auto-switched to ' + newLangName
                );
                // Update OpenAI Realtime session to respond in detected language
                if (connected && openaiWs.readyState === 1) {
                  openaiWs.send(
                    JSON.stringify({
                      type: 'session.update',
                      session: {
                        instructions: `${persona}\n\nIMPORTANT: You MUST respond ONLY in ${newLangName}. Every word must be in ${newLangName}. Keep responses concise for voice conversation (2-3 sentences max). Be warm, natural, and conversational. Do NOT use markdown formatting.\n\nCRITICAL AVATAR RULE: You MUST append avatar animation tags at the very end of your response text (e.g. "[EMOTION:happy] [GESTURE:wave]"). DO NOT speak these tags out loud, just include them in the text transcript. Valid emotions: happy, sad, angry, surprised, thinking, confused, excited, concerned, neutral. Valid gestures: nod, shake, tilt, wave, point, shrug, think, explain.\n\nYou are a voice-first assistant. The user is speaking to you directly via microphone.\n\nACCESSIBILITY: If the user has their camera active, you will receive periodic camera frames to help describe their surroundings.`,
                      },
                    })
                  );
                }
                socket.emit('language_changed', { language: detectedLang });
              }

              socket.emit('transcript', { text: event.transcript, role: 'user' });
            }
            break;
          }
          case 'input_audio_buffer.speech_started': {
            socket.emit('speech_started');
            break;
          }
          case 'response.done': {
            const usage = event.response?.usage;
            socket.emit('turn_complete', {
              usage: usage || null,
            });
            break;
          }
          case 'response.function_call_arguments.done': {
            const fnName = event.name;
            const callId = event.call_id;
            let args = {};
            try {
              args = JSON.parse(event.arguments);
            } catch (_e) {
              /* ignore */
            }

            if (fnName === 'get_user_location') {
              logger.info({ component: 'LiveChat' }, 'OpenAI asked for location. Requesting from client...');
              socket.emit('request_location', { callId });
            } else if (fnName === 'get_weather') {
              logger.info({ component: 'LiveChat', lat: args.lat, lng: args.lng }, 'OpenAI fetching weather...');
              fetch(
                `https://api.open-meteo.com/v1/forecast?latitude=${args.lat}&longitude=${args.lng}&current_weather=true`
              )
                .then((r) => r.json())
                .then((data) => {
                  const w = data.current_weather || data;
                  openaiWs.send(
                    JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: JSON.stringify(w),
                      },
                    })
                  );
                  openaiWs.send(JSON.stringify({ type: 'response.create' }));
                })
                .catch((_e) => {
                  openaiWs.send(
                    JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: '{"error":"weather service down"}',
                      },
                    })
                  );
                  openaiWs.send(JSON.stringify({ type: 'response.create' }));
                });
            } else if (fnName === 'web_search') {
              logger.info({ component: 'LiveChat', query: args.query }, 'OpenAI searching web...');
              // Use the existing search endpoint on the server
              const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1&skip_disambig=1`;
              fetch(searchUrl)
                .then((r) => r.json())
                .then((data) => {
                  const results = (data.RelatedTopics || []).slice(0, 5).map((t) => ({
                    title: t.Text ? t.Text.substring(0, 80) : '',
                    url: t.FirstURL || '',
                    snippet: t.Text || '',
                  }));
                  openaiWs.send(
                    JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: JSON.stringify(
                          results.length > 0 ? results : { answer: data.AbstractText || 'No results found' }
                        ),
                      },
                    })
                  );
                  openaiWs.send(JSON.stringify({ type: 'response.create' }));
                })
                .catch(() => {
                  openaiWs.send(
                    JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: '{"error":"search unavailable"}',
                      },
                    })
                  );
                  openaiWs.send(JSON.stringify({ type: 'response.create' }));
                });
            break;
          }
          case 'error': {
            logger.error({ component: 'LiveChat', error: event.error }, 'OpenAI Realtime error');
            socket.emit('error_msg', { error: event.error?.message || 'Error processing audio' });
            break;
          }
        }
      } catch (e) {
        logger.warn({ component: 'LiveChat', err: e.message }, 'Event parse error');
      }
    });

    openaiWs.on('error', (e) => {
      logger.error({ component: 'LiveChat', err: e.message }, 'OpenAI Realtime WS error');
      socket.emit('error_msg', { error: 'Realtime connection error' });
    });

    openaiWs.on('close', (code, reason) => {
      logger.info({ component: 'LiveChat', code, reason: reason?.toString() }, 'OpenAI Realtime WS closed');
      connected = false;
      if (socket.connected) {
        socket.disconnect(true);
      }
    });

    socket.on('location_result', (data) => {
      if (!connected || !openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      const outputData = data.error ? { error: data.error } : { lat: data.lat, lng: data.lng };
      openaiWs.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: data.callId,
            output: JSON.stringify(outputData),
          },
        })
      );
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    });

    socket.on('audio', (data) => {
      if (!connected || !openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: buf.toString('base64') }));
    });

    let lastFrameTime = 0;
    socket.on('vision_frame', (data) => {
      if (!connected || !openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      if (!data?.image) return;

      const now = Date.now();
      if (now - lastFrameTime < 2500) return;
      lastFrameTime = now;

      try {
        openaiWs.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_image', image: data.image },
                {
                  type: 'input_text',
                  text: '[CAMERA FRAME — Describe what you see for a visually impaired user: people, objects, hazards. Use clear spatial language (left/right/ahead).]',
                },
              ],
            },
          })
        );

        if (!socket._visionFrameCount) socket._visionFrameCount = 0;
        socket._visionFrameCount++;

        if (socket._visionFrameCount % 3 === 1) {
          analyzeFrameWithVision(data.image, language)
            .then((description) => {
              if (description && socket.connected) {
                socket.emit('vision_description', { text: description });
                if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
                  openaiWs.send(
                    JSON.stringify({
                      type: 'conversation.item.create',
                      item: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: `[VISION ANALYSIS: ${description}]` }],
                      },
                    })
                  );
                }
              }
            })
            .catch((err) => {
              logger.warn({ component: 'LiveChat', err: err.message }, 'Vision frame analysis failed');
            });
        }
      } catch (e) {
        logger.warn({ component: 'LiveChat', err: e.message }, 'Vision frame injection failed');
      }
    });

    socket.on('commit', () => {
      if (!connected || !openaiWs || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    });

    socket.on('disconnect', () => {
      logger.info({ component: 'LiveChat', id: socket.id }, 'Client disconnected from /live');
      connected = false;
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
    });
  });

  logger.info(
    { component: 'LiveChat', namespace: '/live', model: REALTIME_MODEL },
    'Socket.io live chat ready (Bypass Mode)'
  );
  return ns;
}

function encodeWAV(pcmBuffer, sampleRate, numChannels) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

module.exports = { setupLiveChat };
