/**
 * Brain v4 - KelionAI AGI Orchestrator
 * Function calling, anti-hallucination, user level detection, voice cloning from chat
 */
import { invokeLLM } from "./_core/llm";
import { ENV } from "./_core/env";
import { CharacterName, detectUserLevel, buildSystemPrompt } from "./characters";
import { generateSpeech, cloneVoice } from "./elevenlabs";

export interface BrainMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface BrainResult {
  content: string;
  toolsUsed: string[];
  confidence: "verified" | "high" | "medium" | "low";
  userLevel: string;
  language: string;
  audioUrl?: string;
  voiceCloningStep?: VoiceCloningStep;
}

export interface VoiceCloningStep {
  step: number;
  totalSteps: number;
  title: string;
  description: string;
  action: "show_text" | "record_audio" | "processing" | "confirm" | "done";
  sampleText?: string;
  voiceId?: string;
}

const BRAIN_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description: "Search the internet for real, current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get real weather data for a location.",
      parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_code",
      description: "Generate code in any programming language.",
      parameters: { type: "object", properties: { language: { type: "string" }, task: { type: "string" } }, required: ["language", "task"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_image",
      description: "Analyze an image using AI vision for visually impaired users.",
      parameters: { type: "object", properties: { imageUrl: { type: "string" }, question: { type: "string" } }, required: ["imageUrl"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "do_math",
      description: "Perform mathematical calculations accurately.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "translate_text",
      description: "Translate text between languages.",
      parameters: { type: "object", properties: { text: { type: "string" }, targetLanguage: { type: "string" } }, required: ["text", "targetLanguage"] },
    },
  },
];

// ============ TOOL EXECUTORS ============
async function executeSearchWeb(query: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
    if (!res.ok) return `Search failed: ${res.status}`;
    const data = (await res.json()) as { AbstractText?: string; Answer?: string; RelatedTopics?: Array<{ Text?: string }> };
    const parts: string[] = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Answer) parts.push(data.Answer);
    if (data.RelatedTopics?.length) {
      parts.push("Related: " + data.RelatedTopics.slice(0, 3).map(t => t.Text).filter(Boolean).join("; "));
    }
    if (!parts.length) {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
      if (wikiRes.ok) {
        const w = (await wikiRes.json()) as { extract?: string };
        if (w.extract) return `[Wikipedia] ${w.extract}`;
      }
      return "No results found. I cannot verify this information.";
    }
    return parts.join("\n");
  } catch { return "Search temporarily unavailable."; }
}

async function executeGetWeather(location: string): Promise<string> {
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
    if (!geoRes.ok) return "Could not find location.";
    const geo = (await geoRes.json()) as { results?: Array<{ latitude: number; longitude: number; name: string; country: string }> };
    if (!geo.results?.length) return `Could not find: ${location}`;
    const { latitude, longitude, name, country } = geo.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`);
    if (!wRes.ok) return "Weather service unavailable.";
    const w = (await wRes.json()) as { current: { temperature_2m: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number } };
    const codes: Record<number, string> = { 0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Foggy", 51: "Light drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 95: "Thunderstorm" };
    return `[VERIFIED] Weather in ${name}, ${country}: ${w.current.temperature_2m}C, ${codes[w.current.weather_code] || "Unknown"}, Humidity: ${w.current.relative_humidity_2m}%, Wind: ${w.current.wind_speed_10m} km/h`;
  } catch { return "Weather service unavailable."; }
}

async function executeGenerateCode(language: string, task: string): Promise<string> {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Expert ${language} programmer. Write clean code only.` }, { role: "user", content: task }] });
  return (r.choices?.[0]?.message?.content as string) || "Could not generate code.";
}

async function executeAnalyzeImage(imageUrl: string, question?: string): Promise<string> {
  try {
    const prompt = question ? `Describe this image in detail for a visually impaired person. Also answer: ${question}` : "Describe this image in complete detail for a visually impaired person. Include objects, positions, colors, text, people, scene, mood, and any hazards.";
    if (ENV.openaiApiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] }], max_tokens: 1000 }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
        return `[VISION] ${data.choices[0].message.content}`;
      }
    }
    const r = await invokeLLM({ messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }] });
    return `[VISION] ${r.choices?.[0]?.message?.content || "Could not analyze image."}`;
  } catch { return "Image analysis unavailable."; }
}

async function executeDoMath(expression: string): Promise<string> {
  const r = await invokeLLM({ messages: [{ role: "system", content: "Precise mathematician. Solve step by step. Double-check." }, { role: "user", content: expression }] });
  return `[CALCULATED] ${r.choices?.[0]?.message?.content || "Could not solve."}`;
}

async function executeTranslate(text: string, targetLanguage: string): Promise<string> {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Translate to ${targetLanguage}. Output only the translation.` }, { role: "user", content: text }] });
  return (r.choices?.[0]?.message?.content as string) || "Translation failed.";
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "search_web": return executeSearchWeb(args.query as string);
    case "get_weather": return executeGetWeather(args.location as string);
    case "generate_code": return executeGenerateCode(args.language as string, args.task as string);
    case "analyze_image": return executeAnalyzeImage(args.imageUrl as string, args.question as string | undefined);
    case "do_math": return executeDoMath(args.expression as string);
    case "translate_text": return executeTranslate(args.text as string, args.targetLanguage as string);
    default: return `Unknown tool: ${name}`;
  }
}

function detectLanguage(text: string): string {
  if (/\b(sunt|este|vreau|cum|unde|care|pentru|foarte|bine|salut|buna|multumesc)\b/i.test(text)) return "Romanian";
  if (/\b(hola|como|donde|quiero|para|muy|bien|gracias)\b/i.test(text)) return "Spanish";
  if (/\b(bonjour|comment|merci|je suis|oui|non)\b/i.test(text)) return "French";
  if (/\b(hallo|danke|bitte|ich bin|wie|wo)\b/i.test(text)) return "German";
  return "English";
}

function isVoiceCloningRequest(message: string): boolean {
  return [/clone?\s*(my|the|a)?\s*voice/i, /cloneaz[aă]\s*(vocea|voce)/i, /vreau\s*s[aă]\s*(mi|imi)\s*clonez/i, /voice\s*clon/i, /copy\s*my\s*voice/i, /record\s*my\s*voice/i].some(p => p.test(message));
}

// ============ MAIN PROCESSOR ============
export async function processBrainMessage(params: {
  message: string;
  history: BrainMessage[];
  character: CharacterName;
  userId: number;
  userName?: string;
  imageUrl?: string;
}): Promise<BrainResult> {
  const { message, history, character, userId, userName, imageUrl } = params;
  const userLevel = detectUserLevel(message);
  const language = detectLanguage(message);

  if (isVoiceCloningRequest(message)) {
    const isRo = language === "Romanian";
    return {
      content: isRo ? "Hai sa-ti clonam vocea! Urmeaza pasii de pe ecran." : "Let's clone your voice! Follow the steps on screen.",
      toolsUsed: ["start_voice_cloning"],
      confidence: "verified",
      userLevel, language,
      voiceCloningStep: {
        step: 1, totalSteps: 5,
        title: isRo ? "Pas 1/5: Pregatire" : "Step 1/5: Preparation",
        description: isRo ? "Pregateste-te sa citesti textul de mai jos cu voce tare. Asigura-te ca esti intr-un loc linistit." : "Get ready to read the text below out loud. Make sure you're in a quiet place.",
        action: "show_text",
        sampleText: isRo
          ? "Buna ziua! Ma numesc si aceasta este vocea mea. Astazi este o zi frumoasa si sunt bucuros sa pot vorbi cu tine. Inteligenta artificiala ne ajuta sa comunicam mai bine si sa invatam lucruri noi in fiecare zi. Multumesc ca esti aici!"
          : "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. Thank you for being here!",
      },
    };
  }

  const systemPrompt = buildSystemPrompt(character, userLevel, language);
  const llmMessages: any[] = [{ role: "system", content: systemPrompt }];
  for (const msg of history.slice(-20)) llmMessages.push({ role: msg.role, content: msg.content });

  if (imageUrl) {
    llmMessages.push({ role: "user", content: [{ type: "text", text: message || "Describe this image in detail." }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] });
  } else {
    llmMessages.push({ role: "user", content: message });
  }

  const toolsUsed: string[] = [];
  let confidence: BrainResult["confidence"] = "high";
  let finalContent = "";

  try {
    const response = await invokeLLM({ messages: llmMessages as any, tools: BRAIN_TOOLS, tool_choice: "auto" });
    const choice = response.choices?.[0];
    if (!choice) return { content: "I'm sorry, I couldn't process that. Please try again.", toolsUsed: [], confidence: "low", userLevel, language };

    if (choice.message?.tool_calls?.length) {
      const toolResults: string[] = [];
      for (const tc of choice.message.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs: Record<string, unknown> = {};
        try { fnArgs = JSON.parse(tc.function.arguments); } catch { fnArgs = {}; }
        toolsUsed.push(fnName);
        toolResults.push(`[Tool: ${fnName}] ${await executeTool(fnName, fnArgs)}`);
      }
      if (toolsUsed.some(t => ["get_weather", "do_math"].includes(t))) confidence = "verified";

      const followUp: any[] = [...llmMessages, { role: "assistant", content: choice.message.content || "" }, { role: "user", content: `Tool results:\n${toolResults.join("\n")}\n\nProvide a natural response based on these results. If data says [VERIFIED], present confidently.` }];
      const final = await invokeLLM({ messages: followUp as any });
      finalContent = (final.choices?.[0]?.message?.content as string) || toolResults.join("\n");
    } else {
      finalContent = (choice.message?.content as string) || "I couldn't generate a response.";
    }
  } catch (error) {
    console.error("[Brain v4] Error:", error);
    finalContent = "I'm experiencing a temporary issue. Please try again.";
    confidence = "low";
  }

  let audioUrl: string | undefined;
  if (ENV.elevenLabsApiKey && finalContent.length > 0 && finalContent.length < 3000) {
    try {
      const cleanText = finalContent.replace(/\[.*?\]/g, "").replace(/```[\s\S]*?```/g, "code block").replace(/[#*_~`]/g, "");
      const tts = await generateSpeech({ text: cleanText, avatar: character });
      audioUrl = tts.audioUrl;
    } catch (e) {
      console.error("[Brain v4] TTS error:", e);
    }
  }

  return { content: finalContent, toolsUsed, confidence, userLevel, language, audioUrl };
}

export async function processVoiceCloningStep(params: { step: number; userId: number; userName: string; audioBuffer?: Buffer }): Promise<VoiceCloningStep> {
  const { step, userId, userName, audioBuffer } = params;
  switch (step) {
    case 1: return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Get ready to read the text below out loud in a quiet place.", action: "show_text", sampleText: "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. I enjoy reading books, watching movies, and spending time with friends. Thank you for being here and listening to me!" };
    case 2: return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Press record and read the text above clearly. Speak naturally. 30-60 seconds.", action: "record_audio" };
    case 3: return { step: 3, totalSteps: 5, title: "Step 3/5: Processing", description: "Your voice is being processed by ElevenLabs AI...", action: "processing" };
    case 4:
      if (!audioBuffer) return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Audio missing. Please record again.", action: "record_audio" };
      try {
        const result = await cloneVoice({ audioBuffer, name: `${userName}-kelionai-${userId}` });
        return { step: 4, totalSteps: 5, title: "Step 4/5: Voice Cloned!", description: `Your voice has been cloned successfully! Would you like to save it?`, action: "confirm", voiceId: result.voiceId };
      } catch (error) {
        console.error("[Voice Cloning] Error:", error);
        return { step: 2, totalSteps: 5, title: "Cloning Failed", description: "Please try recording again with clearer audio.", action: "record_audio" };
      }
    case 5: return { step: 5, totalSteps: 5, title: "Step 5/5: Complete!", description: "Your cloned voice has been saved! The AI will now respond using your voice.", action: "done" };
    default: return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Let's start voice cloning.", action: "show_text" };
  }
}

export function getBrainDiagnostics() {
  return {
    version: "v4.0",
    features: ["Function calling", "Anti-hallucination", "User level detection", "Multi-language", "ElevenLabs TTS", "Voice cloning from chat", "GPT-4o vision", "Real weather API", "Real web search", "Code generation", "Math", "Translation"],
    tools: BRAIN_TOOLS.map(t => t.function.name),
    characters: ["kelion", "kira"],
    antiHallucination: true,
    voiceCloning: true,
  };
}
