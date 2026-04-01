/**
 * Voice Realtime - OpenAI Realtime API for live audio-to-audio
 * GPT-4o-realtime: direct audio input → audio output (no STT/TTS needed)
 * 
 * Architecture:
 *   Client (mic) → Socket.IO → Server → OpenAI Realtime WS → Server → Socket.IO → Client (speaker)
 */
import WebSocket from "ws";
import { ENV } from "./_core/env";
import { CharacterName } from "./characters";

const REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`;

// Voice mapping for OpenAI Realtime voices
const REALTIME_VOICES: Record<CharacterName, string> = {
  kelion: "ash",   // male, warm
  kira: "shimmer", // female, friendly
};

export interface RealtimeSession {
  ws: WebSocket;
  isConnected: boolean;
  agentName: CharacterName;
  language: string;
}

/**
 * Open a Realtime API session with OpenAI
 */
export function openRealtimeSession(params: {
  agentName: CharacterName;
  language?: string;
  onAudioDelta: (base64Audio: string) => void;
  onTranscript: (text: string, role: "user" | "assistant") => void;
  onError: (error: string) => void;
  onDone: () => void;
}): RealtimeSession | null {
  const { agentName, language, onAudioDelta, onTranscript, onError, onDone } = params;

  if (!ENV.openaiApiKey) {
    onError("OpenAI API key not configured for realtime voice");
    return null;
  }

  const ws = new WebSocket(REALTIME_URL, {
    headers: {
      "Authorization": `Bearer ${ENV.openaiApiKey}`,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  const session: RealtimeSession = {
    ws,
    isConnected: false,
    agentName,
    language: language || "en",
  };

  ws.on("open", () => {
    session.isConnected = true;
    console.log(`[Realtime] Connected to OpenAI Realtime API (${agentName})`);

    // Configure the session
    const voice = REALTIME_VOICES[agentName] || "ash";
    const lang = session.language;

    const systemInstructions = agentName === "kelion"
      ? `You are Kelion, a friendly and knowledgeable AI assistant. You speak naturally and warmly. You help users with questions, tasks, and conversation. ${lang !== "en" ? `The user's language is ${lang}. Always respond in the same language the user speaks.` : ""} Keep responses concise for voice — aim for 1-3 sentences unless the topic needs more detail.`
      : `You are Kira, a creative and empathetic AI assistant. You are warm, supportive, and encouraging. ${lang !== "en" ? `The user's language is ${lang}. Always respond in the same language the user speaks.` : ""} Keep responses concise for voice — aim for 1-3 sentences unless the topic needs more detail.`;

    ws.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: systemInstructions,
        voice,
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
    }));
  });

  ws.on("message", (data: WebSocket.Data) => {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case "session.created":
          console.log(`[Realtime] Session created: ${event.session?.id}`);
          break;

        case "session.updated":
          console.log(`[Realtime] Session configured: voice=${event.session?.voice}`);
          break;

        case "response.audio.delta":
          // Forward audio chunk to client
          if (event.delta) {
            onAudioDelta(event.delta);
          }
          break;

        case "response.audio.done":
          onDone();
          break;

        case "response.audio_transcript.delta":
          // AI response transcript (partial)
          break;

        case "response.audio_transcript.done":
          // Full AI response transcript
          if (event.transcript) {
            onTranscript(event.transcript, "assistant");
          }
          break;

        case "conversation.item.input_audio_transcription.completed":
          // User speech transcript
          if (event.transcript) {
            onTranscript(event.transcript, "user");
          }
          break;

        case "input_audio_buffer.speech_started":
          console.log("[Realtime] User started speaking");
          break;

        case "input_audio_buffer.speech_stopped":
          console.log("[Realtime] User stopped speaking");
          break;

        case "error":
          console.error("[Realtime] API error:", event.error);
          onError(event.error?.message || "Realtime API error");
          break;

        default:
          // Ignore other events (rate_limits.updated, response.created, etc.)
          break;
      }
    } catch (e) {
      console.error("[Realtime] Failed to parse message:", e);
    }
  });

  ws.on("error", (error: Error) => {
    console.error("[Realtime] WebSocket error:", error.message);
    session.isConnected = false;
    onError(`Connection error: ${error.message}`);
  });

  ws.on("close", (code: number, reason: Buffer) => {
    console.log(`[Realtime] Disconnected: ${code} ${reason.toString()}`);
    session.isConnected = false;
  });

  return session;
}

/**
 * Send audio chunk to OpenAI Realtime API
 * Audio must be base64-encoded PCM16 (16kHz, mono, little-endian)
 */
export function sendAudioChunk(session: RealtimeSession, base64Audio: string): boolean {
  if (!session.isConnected || session.ws.readyState !== WebSocket.OPEN) {
    return false;
  }

  session.ws.send(JSON.stringify({
    type: "input_audio_buffer.append",
    audio: base64Audio,
  }));

  return true;
}

/**
 * Manually commit the audio buffer (force response)
 * Usually not needed with server_vad turn detection
 */
export function commitAudioBuffer(session: RealtimeSession): void {
  if (session.isConnected && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({
      type: "input_audio_buffer.commit",
    }));
  }
}

/**
 * Cancel an in-progress response (e.g., user interrupted)
 */
export function cancelResponse(session: RealtimeSession): void {
  if (session.isConnected && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({
      type: "response.cancel",
    }));
  }
}

/**
 * Close the realtime session
 */
export function closeRealtimeSession(session: RealtimeSession): void {
  if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
    session.ws.close();
  }
  session.isConnected = false;
}
