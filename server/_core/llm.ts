import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "model" | "tool" | "function";
export type MessageContent = string | any[];
export type Message = { role: Role; content: MessageContent; name?: string; tool_call_id?: string };
export type Tool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type InvokeResult = {
  id: string; created: number; model: string;
  choices: Array<{ index: number; message: { role: Role; content: string | any[]; tool_calls?: ToolCall[] }; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

export type InvokeParams = {
  messages: Message[]; tools?: Tool[]; toolChoice?: any; tool_choice?: any;
  maxTokens?: number; max_completion_tokens?: number;
  outputSchema?: any; output_schema?: any; responseFormat?: any; response_format?: any;
};

function getGeminiKey(): string {
  if (!ENV.geminiApiKey) throw new Error("No GEMINI_API_KEY configured.");
  return ENV.geminiApiKey;
}

// ========== Gemini Flash (default brain - 0.8s) ==========
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = getGeminiKey();
  const payload: Record<string, unknown> = {
    model: ENV.geminiFlashModel || "gemini-2.5-flash",
    messages: params.messages.map(m => ({ role: m.role, content: m.content })),
    max_completion_tokens: 8192,
  };
  if (params.tools?.length) payload.tools = params.tools;
  const tc = params.toolChoice || params.tool_choice;
  if (tc) payload.tool_choice = tc;

  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Gemini Flash failed: ${r.status} - ${e.substring(0, 200)}`); }
  return (await r.json()) as InvokeResult;
}

// ========== Gemini Native generateContent ==========
export interface GeminiNativeResult {
  candidates: Array<{
    content: { parts: Array<{ text?: string; functionCall?: { name: string; args: any }; executableCode?: any; codeExecutionResult?: any }>; role: string };
    finishReason: string; groundingMetadata?: any;
  }>;
  usageMetadata?: any;
}

export async function invokeGeminiNative(params: {
  model?: string; contents: any[]; systemInstruction?: string; tools?: any[];
  generationConfig?: Record<string, unknown>;
}): Promise<GeminiNativeResult> {
  const apiKey = getGeminiKey();
  const model = params.model || ENV.geminiFlashModel || "gemini-2.5-flash";
  const payload: Record<string, unknown> = {
    contents: params.contents,
    generationConfig: params.generationConfig || { maxOutputTokens: 8192 },
  };
  if (params.systemInstruction) payload.systemInstruction = { parts: [{ text: params.systemInstruction }] };
  if (params.tools?.length) payload.tools = params.tools;

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`Gemini Native failed: ${r.status} - ${e.substring(0, 200)}`); }
  return (await r.json()) as GeminiNativeResult;
}

// ========== Gemini Flash + Google Search (real-time info - 5.5s) ==========
export async function invokeGeminiSearch(query: string, systemInstruction?: string): Promise<{ text: string }> {
  const result = await invokeGeminiNative({
    model: ENV.geminiFlashModel,
    contents: [{ role: "user", parts: [{ text: query }] }],
    systemInstruction: systemInstruction || "Provide accurate, up-to-date information.",
    tools: [{ googleSearch: {} }],
    generationConfig: { maxOutputTokens: 4096 },
  });
  return { text: extractGeminiText(result) };
}

// ========== OpenAI Vision Backup (GPT-5.4) ==========
export async function invokeOpenAIVision(params: { messages: Message[]; maxTokens?: number }): Promise<InvokeResult> {
  if (!ENV.openaiApiKey) throw new Error("No OPENAI_API_KEY for vision backup.");
  const r = await fetch(`${ENV.openaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ENV.openaiApiKey}` },
    body: JSON.stringify({ model: ENV.openaiModel || "gpt-5.4", messages: params.messages, max_completion_tokens: params.maxTokens || 4096 }),
  });
  if (!r.ok) { const e = await r.text(); throw new Error(`OpenAI Vision failed: ${r.status} - ${e.substring(0, 200)}`); }
  return (await r.json()) as InvokeResult;
}

export function extractGeminiText(result: GeminiNativeResult): string {
  return (result.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join("");
}

export function extractGeminiFunctionCalls(result: GeminiNativeResult): Array<{ name: string; args: any }> {
  return (result.candidates?.[0]?.content?.parts || []).filter(p => p.functionCall).map(p => ({ name: p.functionCall!.name, args: p.functionCall!.args }));
}
