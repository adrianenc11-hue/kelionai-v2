// ═══════════════════════════════════════════════════════════════
// KelionAI — Live Audio Chat (GPT 5.4 Native Audio)
// Socket.io namespace: /live
// Receives PCM, sends to GPT 5.4, returns AI Voice + Transcript
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('../logger');
const { MODELS, PERSONAS } = require('../config/models');
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function setupLiveChat(io, appLocals) {
  const brain = appLocals?.brain || null;
  const ns = io.of('/live');

  ns.on('connection', async (socket) => {
    const avatar = socket.handshake.query.avatar || 'kelion';
    const language = socket.handshake.query.language || 'ro';

    // Voice selection based on avatar — standard OpenAI voices available for Audio modality
    const voice = avatar === 'kira' ? 'shimmer' : 'alloy';
    const persona = PERSONAS[avatar] || PERSONAS.kelion || '';
    const langName = language === 'ro' ? 'Romanian' : 'English';

    logger.info({ component: 'LiveChat', avatar, language, id: socket.id }, 'Client connected to /live');

    let audioBuffer = [];
    let isProcessing = false;

    // Maintain brief conversation history for context
    const conversationHistory = [
      {
        role: 'system',
        content: `${persona}\n\nRespond in ${langName}. Keep responses concise for voice conversation (2-3 sentences max). Be warm, natural, and conversational. Do NOT use markdown formatting — this is a spoken conversation.\n\nYou are a voice-first assistant. The user is speaking to you directly via microphone. You understand the audio input and will output an audio response.`,
      },
    ];

    // ── Buffer incoming PCM chunks ──
    socket.on('audio', (data) => {
      // data is an ArrayBuffer (Int16 PCM)
      if (Buffer.isBuffer(data)) {
        audioBuffer.push(data);
      } else if (data instanceof ArrayBuffer) {
        audioBuffer.push(Buffer.from(data));
      }
    });

    // ── Client signals end of speech turn ──
    socket.on('commit', async () => {
      if (isProcessing || audioBuffer.length === 0) return;
      isProcessing = true;
      socket.emit('speech_started'); // Tell client AI is thinking

      try {
        // Concatenate all PCM chunks
        const fullAudioBuffer = Buffer.concat(audioBuffer);
        const base64Audio = fullAudioBuffer.toString('base64');
        audioBuffer = []; // clear buffer for next turn

        const startTime = Date.now();

        // Prepare user message with audio modality
        const userMessage = {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: base64Audio,
                format: 'wav', // OpenAI accepts 'wav' or 'mp3'. We will wrap the PCM in a pseudo-WAV or send raw if accepted. Let's send it as PCM wrapped in WAV if needed, or directly if the API is flexible. Actually, the API docs say `format: "wav"` or `mp3`.
                // We'll wrap the raw PCM16 24kHz in a WAV header to be safe.
              },
            },
          ],
        };

        // Wrap PCM in WAV format
        const wavBuffer = encodeWAV(fullAudioBuffer, 24000, 1);
        userMessage.content[0].input_audio.data = wavBuffer.toString('base64');
        userMessage.content[0].input_audio.format = 'wav';

        conversationHistory.push(userMessage);

        // Keep history size reasonable (system + 6 turns)
        if (conversationHistory.length > 13) {
          conversationHistory.splice(1, 2);
        }

        // ── Call GPT 5.4 Chat Completions with Audio Modality ──
        const response = await openai.chat.completions.create({
          model: MODELS.OPENAI_CHAT, // "gpt-5.4"
          messages: conversationHistory,
        });

        const choice = response.choices[0].message;

        // Return results to client
        if (choice.audio) {
          // Send audio chunk (Base64 WAV)
          socket.emit('audio_chunk', { audio: choice.audio.data });

          // Send transcript
          socket.emit('transcript', {
            text: choice.audio.transcript,
            role: 'assistant',
          });

          // Add assistant response to history to maintain context
          conversationHistory.push({
            role: 'assistant',
            audio: { id: choice.audio.id },
            /* The API returns an audio.id which can be used in history instead of passing the whole audio back */
          });

          if (brain) {
            brain
              .saveMemory(null, 'audio', `Voice Chat: ${choice.audio.transcript.substring(0, 200)}`, {
                mode: 'live',
                avatar,
              })
              .catch(() => {});
          }
        } else if (choice.content) {
          // Fallback if no audio was generated for some reason
          socket.emit('transcript', { text: choice.content, role: 'assistant' });
          conversationHistory.push({ role: 'assistant', content: choice.content });
        }

        socket.emit('turn_complete', {
          totalTime: Date.now() - startTime,
          usage: response.usage,
        });
      } catch (err) {
        logger.error({ component: 'LiveChat', err: err.message }, 'GPT 5.4 Audio Error');
        socket.emit('error_msg', { error: err.message || 'Error processing audio' });
      } finally {
        socket.emit('audio_end');
        isProcessing = false;
      }
    });

    socket.on('disconnect', () => {
      logger.info({ component: 'LiveChat', id: socket.id }, 'Client disconnected from /live');
      audioBuffer = [];
      conversationHistory.length = 0;
    });

    // Signal ready
    socket.emit('ready', {
      engine: 'gpt-5.4-audio',
      avatar,
      language,
    });
  });

  logger.info({ component: 'LiveChat', namespace: '/live' }, 'Socket.io live chat namespace ready');
  return ns;
}

// ── Helper: Wrap Raw PCM16 in a WAV header ──
function encodeWAV(pcmBuffer, sampleRate, numChannels) {
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

module.exports = { setupLiveChat };
