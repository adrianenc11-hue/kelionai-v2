/**
 * ElevenLabs Integration - Real TTS + Voice Cloning
 * For KelionAI v2 - Accessibility-first AI Assistant
 */
import { ENV } from "./_core/env";
import { storagePut } from "./storage";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

function getHeaders(): Record<string, string> {
  return {
    "xi-api-key": ENV.elevenLabsApiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Generate speech from text using ElevenLabs TTS
 * Returns a URL to the generated audio file stored in S3
 */
export async function generateSpeech(params: {
  text: string;
  avatar: "kelion" | "kira";
  voiceId?: string; // custom cloned voice overrides avatar default
}): Promise<{ audioUrl: string; duration: number }> {
  const { text, avatar, voiceId } = params;

  // Use custom cloned voice if provided, otherwise use avatar default
  const resolvedVoiceId =
    voiceId ||
    (avatar === "kelion" ? ENV.elevenLabsVoiceKelion : ENV.elevenLabsVoiceKira);

  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  const response = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${resolvedVoiceId}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        text: text.slice(0, 5000), // ElevenLabs limit
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] TTS error:", err);
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }

  // Get audio buffer
  const audioBuffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));

  // Upload to S3
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  const fileKey = `tts/${avatar}-${timestamp}-${randomSuffix}.mp3`;
  const { url } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

  // Estimate duration (rough: ~150 words/min, ~5 chars/word)
  const estimatedDuration = Math.ceil((text.length / 750) * 60);

  return { audioUrl: url, duration: estimatedDuration };
}

/**
 * Clone a user's voice from an audio recording
 * Returns the new voice ID from ElevenLabs
 */
export async function cloneVoice(params: {
  audioBuffer: Buffer;
  name: string;
  description?: string;
}): Promise<{ voiceId: string; name: string }> {
  const { audioBuffer, name, description } = params;

  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  // Create FormData for multipart upload
  const formData = new FormData();
  formData.append("name", name);
  formData.append(
    "description",
    description || `Cloned voice for ${name} on KelionAI`
  );
  formData.append(
    "files",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }),
    "recording.webm"
  );

  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": ENV.elevenLabsApiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] Voice cloning error:", err);
    throw new Error(`Voice cloning failed: ${response.status} - ${err}`);
  }

  const data = (await response.json()) as { voice_id: string };
  return { voiceId: data.voice_id, name };
}

/**
 * Delete a cloned voice from ElevenLabs
 */
export async function deleteClonedVoice(voiceId: string): Promise<boolean> {
  if (!ENV.elevenLabsApiKey) return false;

  const response = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });

  return response.ok;
}

/**
 * Get user's subscription info (remaining characters, etc.)
 */
export async function getElevenLabsUsage(): Promise<{
  characterCount: number;
  characterLimit: number;
  canClone: boolean;
}> {
  if (!ENV.elevenLabsApiKey) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }

  const response = await fetch(`${ELEVENLABS_BASE}/user`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }

  const data = (await response.json()) as {
    subscription: {
      character_count: number;
      character_limit: number;
      can_use_instant_voice_cloning: boolean;
    };
  };

  return {
    characterCount: data.subscription.character_count,
    characterLimit: data.subscription.character_limit,
    canClone: data.subscription.can_use_instant_voice_cloning,
  };
}
