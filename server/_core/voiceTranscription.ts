/**
 * Voice transcription - Gemini audio input (primary) + Whisper fallback
 */
import { ENV } from "./env";

export type TranscribeOptions = {
  audioUrl: string;
  language?: string;
  prompt?: string;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: any[];
};

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

export type TranscriptionResponse = WhisperResponse;

export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Download audio
    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      const response = await fetch(options.audioUrl);
      if (!response.ok) return { error: "Failed to download audio", code: "INVALID_FORMAT", details: `HTTP ${response.status}` };
      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get("content-type") || "audio/webm";
      if (audioBuffer.length / (1024 * 1024) > 16) {
        return { error: "Audio too large", code: "FILE_TOO_LARGE", details: "Max 16MB" };
      }
    } catch (e) {
      return { error: "Failed to fetch audio", code: "SERVICE_ERROR", details: e instanceof Error ? e.message : "Unknown" };
    }

    // Primary: Gemini audio transcription
    if (ENV.geminiApiKey) {
      try {
        const model = ENV.geminiProModel || "gemini-2.5-pro";
        const payload = {
          contents: [{
            parts: [
              { text: options.prompt || "Transcribe this audio exactly. Return only the transcription text, nothing else." },
              { inlineData: { mimeType, data: audioBuffer.toString("base64") } }
            ]
          }],
          generationConfig: { maxOutputTokens: 4096 },
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ENV.geminiApiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const text = data.candidates?.[0]?.content?.parts?.filter((p: any) => p.text)?.map((p: any) => p.text)?.join("") || "";
          if (text.length > 0) {
            const estimatedDuration = Math.max(1, Math.round(audioBuffer.length / (16000 * 2)));
            return {
              task: "transcribe",
              language: options.language || "auto",
              duration: estimatedDuration,
              text: text.trim(),
              segments: [],
            };
          }
        }
        console.warn("[STT] Gemini transcription failed, trying Whisper fallback...");
      } catch (e) {
        console.warn("[STT] Gemini error:", e);
      }
    }

    // Fallback: OpenAI Whisper
    const apiKey = ENV.openaiApiKey;
    if (!apiKey) return { error: "No transcription service configured", code: "SERVICE_ERROR" };

    const formData = new FormData();
    const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp3") ? "mp3" : "webm";
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), `audio.${ext}`);
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    if (options.language) formData.append("language", options.language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      return { error: "Whisper failed", code: "TRANSCRIPTION_FAILED", details: `${res.status}: ${err}` };
    }

    return await res.json() as WhisperResponse;

  } catch (error) {
    return { error: "Transcription failed", code: "SERVICE_ERROR", details: error instanceof Error ? error.message : "Unknown" };
  }
}

/**
 * Transcribe audio directly from base64 (no upload needed) — Gemini native, ~0.3s
 */
export async function transcribeAudioBase64(
  audioBase64: string,
  mimeType: string,
  language?: string
): Promise<{ text: string; duration: number }> {
  if (!ENV.geminiApiKey) throw new Error("No GEMINI_API_KEY");

  const model = ENV.geminiFlashModel || "gemini-2.5-flash";
  const payload = {
    contents: [{
      parts: [
        { text: language ? `Transcribe this audio in ${language}. Return only the transcription text.` : "Transcribe this audio exactly. Return only the transcription text, nothing else." },
        { inlineData: { mimeType, data: audioBase64 } }
      ]
    }],
    generationConfig: { maxOutputTokens: 2048 },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${ENV.geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const e = await res.text();
    throw new Error(`Gemini STT failed: ${res.status} - ${e.substring(0, 200)}`);
  }

  const data = await res.json() as any;
  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((p: any) => p.text)
    .map((p: any) => p.text)
    .join("").trim();

  const estimatedDuration = Math.max(1, Math.round((audioBase64.length * 0.75) / (16000 * 2)));
  return { text, duration: estimatedDuration };
}
