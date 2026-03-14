// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice-First Mode: OpenAI Realtime API via Socket.io
// Socket.io namespace: /voice-realtime
// Replaces raw WebSocket proxy to fix Railway proxy compression
// ═══════════════════════════════════════════════════════════════
'use strict';

const WebSocket = require('ws');
const logger = require('../logger');
const { MODELS, PERSONAS } = require('../config/models');

// ── OpenAI Realtime API config ──
const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const REALTIME_MODEL = MODELS.GPT_REALTIME || 'gpt-4o-realtime-preview';

/**
 * Attach Voice-First Socket.io namespace to the io server.
 * @param {import('socket.io').Server} io  — Socket.io server instance
 * @param {object} appLocals              — Express app.locals (contains brain)
 */
function setupRealtimeVoice(io, appLocals) {
  const brain = appLocals?.brain || null;
  const ns = io.of('/voice-realtime');

  ns.on('connection', (socket) => {
    const avatar = socket.handshake.query.avatar || 'kelion';
    const language = socket.handshake.query.language || 'ro';
    const startTime = Date.now();

    logger.info(
      { component: 'VoiceRealtime', avatar, language, id: socket.id },
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

      // ── Configure session ──
      const persona = PERSONAS[avatar] || PERSONAS.kelion || '';
      const langName = language === 'ro' ? 'Romanian' : 'English';

      openaiWs.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: `${persona}\n\nRespond in ${langName}. Keep responses concise for voice conversation (2-3 sentences max). Be warm, natural, and conversational. Do NOT use markdown formatting — this is a spoken conversation.\n\nYou are a voice-first assistant. The user is speaking to you directly via microphone.`,
            voice: avatar === 'kira' ? 'shimmer' : 'echo',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
          },
        })
      );

      // Signal client that we're ready
      socket.emit('ready', {
        engine: 'openai-realtime',
        model: REALTIME_MODEL,
        avatar,
        language,
      });
    });

    // ── Relay OpenAI events to client ──
    openaiWs.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          // ── Audio response chunks ──
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

              // Save to brain memory
              if (brain) {
                brain
                  .saveMemory(null, 'audio', 'VoiceFirst reply: ' + event.transcript.substring(0, 300), {
                    avatar,
                    language,
                    mode: 'realtime',
                  })
                  .catch((err) => {
                    console.error(err);
                  });
              }
            }
            break;
          }

          // ── Transcript of user's speech ──
          case 'conversation.item.input_audio_transcription.completed': {
            if (event.transcript) {
              socket.emit('transcript', {
                text: event.transcript,
                role: 'user',
              });

              if (brain) {
                brain
                  .saveMemory(null, 'audio', 'VoiceFirst user said: ' + event.transcript.substring(0, 300), {
                    avatar,
                    language,
                    mode: 'realtime',
                  })
                  .catch((err) => {
                    console.error(err);
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
            socket.emit('turn_complete', { usage: usage || null });

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
            socket.emit('error_msg', {
              error: event.error?.message || 'Unknown error',
            });
            break;
          }

          // ── Rate limits ──
          case 'rate_limits.updated': {
            logger.debug({ component: 'VoiceRealtime', limits: event.rate_limits }, 'Rate limits updated');
            break;
          }

          default:
            if (event.type && !event.type.startsWith('session.')) {
              logger.debug({ component: 'VoiceRealtime', eventType: event.type }, 'Unhandled event');
            }
            break;
        }
      } catch (e) {
        logger.warn({ component: 'VoiceRealtime', err: e.message }, 'Event parse error');
      }
    });

    openaiWs.on('error', (e) => {
      logger.error({ component: 'VoiceRealtime', err: e.message }, 'OpenAI WS error');
      socket.emit('error_msg', { error: 'Realtime connection error' });
    });

    openaiWs.on('close', (code, reason) => {
      logger.info({ component: 'VoiceRealtime', code, reason: reason?.toString() }, 'OpenAI WS closed');
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
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    });

    // Cancel current response
    socket.on('cancel', () => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(JSON.stringify({ type: 'response.cancel' }));
    });

    // Text fallback — user typed instead of spoke
    socket.on('text_input', (msg) => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;
      openaiWs.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: msg.text,
              },
            ],
          },
        })
      );
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
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

  logger.info({ component: 'VoiceRealtime', namespace: '/voice-realtime' }, 'Socket.io voice-first namespace ready');

  return ns;
}

/**
 * undefined
 * @returns {*}
 */
module.exports = { setupRealtimeVoice };
