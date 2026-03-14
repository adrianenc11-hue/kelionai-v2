// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice-First Mode: OpenAI Realtime API Proxy
// Single WebSocket: Audio → GPT Realtime → Audio + Transcript
// ═══════════════════════════════════════════════════════════════
"use strict";

const WebSocket = require("ws");
const logger = require("../logger");
const { MODELS, PERSONAS } = require("../config/models");

// ── OpenAI Realtime API config ──
const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const REALTIME_MODEL = MODELS.GPT_REALTIME || "gpt-4o-realtime-preview";

/**
 * Setup the Voice-First WebSocket on the HTTP server.
 * Client connects to /api/voice-realtime → proxied to OpenAI Realtime API.
 */
function setupRealtimeVoice(server, appLocals) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
  const brain = appLocals?.brain || null;

  // Handle upgrade requests for /api/voice-realtime
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/voice-realtime") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (clientWs, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const avatar = url.searchParams.get("avatar") || "kelion";
    const language = url.searchParams.get("language") || "ro";
    const startTime = Date.now();

    logger.info(
      { component: "VoiceRealtime", avatar, language },
      "Client connected to voice-realtime",
    );

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: "OPENAI_API_KEY not configured",
        }),
      );
      clientWs.close();
      return;
    }

    // ── Connect to OpenAI Realtime API ──
    let openaiWs = null;
    let connected = false;

    try {
      openaiWs = new WebSocket(`${REALTIME_URL}?model=${REALTIME_MODEL}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
    } catch (e) {
      logger.error(
        { component: "VoiceRealtime", err: e.message },
        "Failed to create OpenAI WS",
      );
      clientWs.send(
        JSON.stringify({ type: "error", error: "Realtime API unavailable" }),
      );
      clientWs.close();
      return;
    }

    openaiWs.on("open", () => {
      connected = true;
      logger.info(
        { component: "VoiceRealtime" },
        "Connected to OpenAI Realtime",
      );

      // ── Configure session ──
      const persona = PERSONAS[avatar] || PERSONAS.kelion || "";
      const langName = language === "ro" ? "Romanian" : "English";

      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: `${persona}\n\nRespond in ${langName}. Keep responses concise for voice conversation (2-3 sentences max). Be warm, natural, and conversational. Do NOT use markdown formatting — this is a spoken conversation.\n\nYou are a voice-first assistant. The user is speaking to you directly via microphone.`,
            voice: avatar === "kira" ? "shimmer" : "alloy",
            input_audio_format: "pcm16",
            output_audio_format: "pcm16",
            input_audio_transcription: {
              model: "whisper-1",
            },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
          },
        }),
      );

      // Signal client that we're ready
      clientWs.send(
        JSON.stringify({
          type: "ready",
          engine: "openai-realtime",
          model: REALTIME_MODEL,
          avatar,
          language,
        }),
      );
    });

    // ── Relay OpenAI events to client ──
    openaiWs.on("message", (raw) => {
      try {
        const event = JSON.parse(raw.toString());

        switch (event.type) {
          // ── Audio response chunks → relay to client as binary ──
          case "response.audio.delta": {
            const audioB64 = event.delta;
            if (audioB64 && clientWs.readyState === WebSocket.OPEN) {
              // Send as JSON — client decodes base64
              clientWs.send(
                JSON.stringify({
                  type: "audio_chunk",
                  audio: audioB64,
                }),
              );
            }
            break;
          }

          // ── Audio response complete ──
          case "response.audio.done": {
            clientWs.send(JSON.stringify({ type: "audio_end" }));
            break;
          }

          // ── Transcript of AI response (for CC subtitles) ──
          case "response.audio_transcript.delta": {
            if (event.delta) {
              clientWs.send(
                JSON.stringify({
                  type: "transcript",
                  text: event.delta,
                  role: "assistant",
                }),
              );
            }
            break;
          }

          case "response.audio_transcript.done": {
            if (event.transcript) {
              clientWs.send(
                JSON.stringify({
                  type: "transcript_done",
                  text: event.transcript,
                  role: "assistant",
                }),
              );

              // Save to brain memory
              if (brain) {
                brain
                  .saveMemory(
                    null,
                    "audio",
                    "VoiceFirst reply: " +
                      event.transcript.substring(0, 300),
                    { avatar, language, mode: "realtime" },
                  )
                  .catch(() => {});
              }
            }
            break;
          }

          // ── Transcript of user's speech (input transcription) ──
          case "conversation.item.input_audio_transcription.completed": {
            if (event.transcript) {
              clientWs.send(
                JSON.stringify({
                  type: "transcript",
                  text: event.transcript,
                  role: "user",
                }),
              );

              // Save user speech to brain memory
              if (brain) {
                brain
                  .saveMemory(
                    null,
                    "audio",
                    "VoiceFirst user said: " +
                      event.transcript.substring(0, 300),
                    { avatar, language, mode: "realtime" },
                  )
                  .catch(() => {});
              }
            }
            break;
          }

          // ── Speech started (user is talking) ──
          case "input_audio_buffer.speech_started": {
            clientWs.send(JSON.stringify({ type: "speech_started" }));
            break;
          }

          // ── Speech stopped (user stopped talking) ──
          case "input_audio_buffer.speech_stopped": {
            clientWs.send(JSON.stringify({ type: "speech_stopped" }));
            break;
          }

          // ── Turn complete ──
          case "response.done": {
            const usage = event.response?.usage;
            clientWs.send(
              JSON.stringify({
                type: "turn_complete",
                usage: usage || null,
              }),
            );

            if (usage) {
              logger.info(
                {
                  component: "VoiceRealtime",
                  input_tokens: usage.input_tokens,
                  output_tokens: usage.output_tokens,
                },
                `Turn done: ${usage.input_tokens}in/${usage.output_tokens}out tokens`,
              );
            }
            break;
          }

          // ── Error from OpenAI ──
          case "error": {
            logger.error(
              { component: "VoiceRealtime", error: event.error },
              "OpenAI Realtime error",
            );
            clientWs.send(
              JSON.stringify({
                type: "error",
                error: event.error?.message || "Unknown error",
              }),
            );
            break;
          }

          // ── Rate limits ──
          case "rate_limits.updated": {
            // Log but don't relay to client
            logger.debug(
              { component: "VoiceRealtime", limits: event.rate_limits },
              "Rate limits updated",
            );
            break;
          }

          default:
            // Log unknown events for debugging
            if (event.type && !event.type.startsWith("session.")) {
              logger.debug(
                { component: "VoiceRealtime", eventType: event.type },
                "Unhandled event",
              );
            }
            break;
        }
      } catch (e) {
        logger.warn(
          { component: "VoiceRealtime", err: e.message },
          "Event parse error",
        );
      }
    });

    openaiWs.on("error", (e) => {
      logger.error(
        { component: "VoiceRealtime", err: e.message },
        "OpenAI WS error",
      );
      clientWs.send(
        JSON.stringify({
          type: "error",
          error: "Realtime connection error",
        }),
      );
    });

    openaiWs.on("close", (code, reason) => {
      logger.info(
        { component: "VoiceRealtime", code, reason: reason?.toString() },
        "OpenAI WS closed",
      );
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: "disconnected" }));
        clientWs.close();
      }
    });

    // ── Handle client messages ──
    clientWs.on("message", (data) => {
      if (!connected || openaiWs.readyState !== WebSocket.OPEN) return;

      try {
        // Binary = raw audio from microphone (PCM 24kHz 16-bit mono)
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          const b64Audio = Buffer.isBuffer(data)
            ? data.toString("base64")
            : Buffer.from(data).toString("base64");

          openaiWs.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: b64Audio,
            }),
          );
          return;
        }

        // Text = control messages
        const msg = JSON.parse(data.toString());

        if (msg.type === "commit") {
          // Client signals end of speech (manual mode)
          openaiWs.send(
            JSON.stringify({ type: "input_audio_buffer.commit" }),
          );
          openaiWs.send(
            JSON.stringify({ type: "response.create" }),
          );
        }

        if (msg.type === "cancel") {
          // Cancel current response
          openaiWs.send(JSON.stringify({ type: "response.cancel" }));
        }

        if (msg.type === "text_input") {
          // Text fallback — user typed instead of spoke
          openaiWs.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: msg.text,
                  },
                ],
              },
            }),
          );
          openaiWs.send(JSON.stringify({ type: "response.create" }));
        }
      } catch (e) {
        logger.warn(
          { component: "VoiceRealtime", err: e.message },
          "Client message error",
        );
      }
    });

    // ── Client disconnected ──
    clientWs.on("close", () => {
      const duration = Date.now() - startTime;
      logger.info(
        { component: "VoiceRealtime", duration },
        `Client disconnected (${Math.round(duration / 1000)}s session)`,
      );
      if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
        openaiWs.close();
      }
    });
  });

  return wss;
}

module.exports = { setupRealtimeVoice };
