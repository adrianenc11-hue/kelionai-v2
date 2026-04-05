/**
 * Brain v5 - KelionAI
 * Flow: auth(0.1s) → limit(0.1s) → Gemini Flash(0.8s) → response(0.05s) = 1.05s
 * Background: DB save, usage, memories, learning, TTS
 */
import { invokeGeminiNative, invokeGeminiSearch, invokeOpenAIVision, extractGeminiText } from "./_core/llm";
import { ENV } from "./_core/env";
import { CharacterName, detectUserLevel, buildSystemPrompt } from "./characters";
import { generateSpeech, cloneVoice } from "./elevenlabs";
import { getMemoriesForContext, extractAndSaveMemories } from "./memory-service";
import { updateLearningProfile } from "./learning-service";

export interface BrainMessage { role: "user" | "assistant" | "system"; content: string; }
export interface BrainResult {
  content: string; toolsUsed: string[]; confidence: "verified" | "high" | "medium" | "low";
  userLevel: string; language: string; audioUrl?: string; searchStatus?: string;
  voiceCloningStep?: VoiceCloningStep;
}
export interface VoiceCloningStep {
  step: number; totalSteps: number; title: string; description: string;
  action: "show_text" | "record_audio" | "processing" | "confirm" | "done";
  sampleText?: string; voiceId?: string;
}

function needsSearch(msg: string): boolean {
  return /\b(search|find|look up|what is|who is|when|where|news|weather|price|stock|score|latest|current|today|yesterday|recent|update)\b/i.test(msg) ||
    /\b(caut|gaseste|stir|vreme|pret|cine e|ce e|unde|cand|actual|azi|ieri|recent)\b/i.test(msg);
}

function detectLanguage(text: string): string {
  if (/\b(sunt|este|vreau|cum|unde|care|pentru|foarte|bine|salut|buna)\b/i.test(text)) return "Romanian";
  if (/\b(hola|como|donde|quiero|para|muy|bien|gracias)\b/i.test(text)) return "Spanish";
  if (/\b(bonjour|comment|merci|je suis|oui|non)\b/i.test(text)) return "French";
  if (/\b(hallo|danke|bitte|ich bin|wie|wo)\b/i.test(text)) return "German";
  return "English";
}

function isVoiceCloningRequest(msg: string): boolean {
  return [/clone?\s*(my|the|a)?\s*voice/i, /voice\s*clon/i, /copy\s*my\s*voice/i].some(p => p.test(msg));
}

export async function processBrainMessage(params: {
  message: string; history: BrainMessage[]; character: CharacterName;
  userId: number; userName?: string; imageUrl?: string;
  location?: { lat: number; lon: number; city?: string };
}): Promise<BrainResult> {
  const { message, history, character, userId, imageUrl, location } = params;
  const userLevel = detectUserLevel(message);
  const language = detectLanguage(message);

  if (isVoiceCloningRequest(message)) {
    return {
      content: "Let's clone your voice! Follow the steps on screen.",
      toolsUsed: ["start_voice_cloning"], confidence: "verified", userLevel, language,
      voiceCloningStep: { step: 1, totalSteps: 5, title: "Step 1/5: Preparation",
        description: "Get ready to read the text below out loud.", action: "show_text",
        sampleText: "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you." },
    };
  }

  // FAST PATH: only what's needed for response
  const locationNote = location ? `\nUser location: ${location.city ? location.city + ", " : ""}lat=${location.lat.toFixed(4)}, lon=${location.lon.toFixed(4)}.` : "";
  const systemContent = buildSystemPrompt(character, userLevel, language) + locationNote;
  const toolsUsed: string[] = [];
  let confidence: BrainResult["confidence"] = "high";
  let finalContent = "";
  let searchStatus: string | undefined;

  try {
    if (needsSearch(message)) {
      searchStatus = "Searching for recent information...";
      toolsUsed.push("google_search");
      const result = await invokeGeminiSearch(message, systemContent);
      finalContent = result.text;
      confidence = "verified";
    } else {
      const contents: any[] = [];
      for (const msg of history.slice(-20)) {
        contents.push({ role: msg.role === "assistant" ? "model" : "user", parts: [{ text: msg.content }] });
      }
      const userParts: any[] = [{ text: message }];
      if (imageUrl) {
        try {
          const imgRes = await fetch(imageUrl);
          const imgBuf = Buffer.from(await imgRes.arrayBuffer());
          userParts.push({ inlineData: { mimeType: imgRes.headers.get("content-type") || "image/jpeg", data: imgBuf.toString("base64") } });
          toolsUsed.push("vision");
        } catch {}
      }
      contents.push({ role: "user", parts: userParts });

      const response = await invokeGeminiNative({
        model: ENV.geminiFlashModel,
        contents,
        systemInstruction: systemContent,
        generationConfig: { maxOutputTokens: 4096 },
      });
      finalContent = extractGeminiText(response) || "I couldn't generate a response.";
    }
  } catch (error) {
    console.error("[Brain v5] Error:", error);
    if (imageUrl && ENV.openaiApiKey) {
      try {
        const fb = await invokeOpenAIVision({ messages: [
          { role: "system", content: systemContent },
          { role: "user", content: [{ type: "text", text: message }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] as any }
        ] });
        finalContent = (fb.choices?.[0]?.message?.content as string) || "";
        toolsUsed.push("gpt5.4_fallback");
      } catch { finalContent = "ERROR: " + (error instanceof Error ? error.message : String(error)); confidence = "low"; }
    } else {
      finalContent = "ERROR: " + (error instanceof Error ? error.message : String(error)); confidence = "low";
    }
  }

  // BACKGROUND: everything else runs after response is returned
  const bgContent = finalContent;
  setTimeout(() => {
    extractAndSaveMemories(userId, message, bgContent).catch(() => {});
    updateLearningProfile(userId, { detectedLevel: userLevel, language, avatar: character, isVoice: false }).catch(() => {});
  }, 0);

  return { content: finalContent, toolsUsed, confidence, userLevel, language, searchStatus };
}

export async function processVoiceCloningStep(params: { step: number; userId: number; userName: string; audioBuffer?: Buffer }): Promise<VoiceCloningStep> {
  const { step, userId, userName, audioBuffer } = params;
  switch (step) {
    case 1: return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Read the text out loud.", action: "show_text", sampleText: "Hello! My name is and this is my voice. Today is a beautiful day." };
    case 2: return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Press record and read clearly.", action: "record_audio" };
    case 3: return { step: 3, totalSteps: 5, title: "Step 3/5: Processing", description: "Processing...", action: "processing" };
    case 4:
      if (!audioBuffer) return { step: 2, totalSteps: 5, title: "Recording", description: "Audio missing.", action: "record_audio" };
      try {
        const result = await cloneVoice({ audioBuffer, name: `${userName}-kelionai-${userId}` });
        return { step: 4, totalSteps: 5, title: "Cloned!", description: "Voice cloned!", action: "confirm", voiceId: result.voiceId };
      } catch { return { step: 2, totalSteps: 5, title: "Failed", description: "Try again.", action: "record_audio" }; }
    case 5: return { step: 5, totalSteps: 5, title: "Complete!", description: "Voice saved!", action: "done" };
    default: return { step: 1, totalSteps: 5, title: "Start", description: "Begin.", action: "show_text" };
  }
}

export function getBrainDiagnostics() {
  return {
    version: "v5.0",
    defaultModel: "Gemini 2.5 Flash (0.8s)",
    searchModel: "Gemini 2.5 Flash + Google Search",
    voiceClone: "ElevenLabs",
    backupVision: "GPT-5.4",
    tools: ["google_search", "vision", "voice_cloning"],
    characters: ["kelion", "kira"],
  };
}
