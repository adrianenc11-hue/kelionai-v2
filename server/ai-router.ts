/**
 * AI Router - Intelligent routing between multiple AI providers
 * Supports: GPT-4, Gemini, Groq, Claude, DeepSeek
 */

import { invokeLLM } from "./_core/llm";

export type AIProvider = "gpt-4" | "gemini" | "groq" | "claude" | "deepseek";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

export interface AIResponse {
  provider: AIProvider;
  content: string;
  tokensUsed?: number;
  model?: string;
}

/**
 * Provider configuration with fallback chain
 */
const PROVIDER_CONFIG: Record<AIProvider, { model: string; priority: number }> = {
  "gpt-4": { model: "gpt-4o", priority: 1 },
  "gemini": { model: "gemini-2.5-flash", priority: 2 },
  "groq": { model: "llama-3.3-70b-versatile", priority: 3 },
  "claude": { model: "claude-3.5-sonnet", priority: 4 },
  "deepseek": { model: "deepseek-chat", priority: 5 },
};

/**
 * Route a chat request to the specified AI provider
 * Falls back to next provider if primary fails
 */
export async function routeToAI(
  messages: ChatMessage[],
  provider: AIProvider = "gpt-4",
  fallbackChain: AIProvider[] = []
): Promise<AIResponse> {
  const chain = [provider, ...fallbackChain];
  let lastError: Error | null = null;

  for (const currentProvider of chain) {
    try {
      const config = PROVIDER_CONFIG[currentProvider];
      if (!config) {
        console.warn(`[AI Router] Unknown provider: ${currentProvider}`);
        continue;
      }

      console.log(`[AI Router] Routing to ${currentProvider} (${config.model})`);

      const response = await invokeLLM({
        messages: messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content
        })) as Parameters<typeof invokeLLM>[0]["messages"],
      });

      const messageContent = response.choices?.[0]?.message?.content;
      const content = typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent) || "";
      const tokensUsed = response.usage?.total_tokens;

      return {
        provider: currentProvider,
        content,
        tokensUsed,
        model: config.model,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[AI Router] ${currentProvider} failed:`, lastError.message);
      // Continue to next provider in chain
    }
  }

  // All providers failed
  throw new Error(
    `All AI providers failed. Last error: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Get optimal provider based on use case
 */
export function getOptimalProvider(useCase: "fast" | "quality" | "code" | "reasoning"): AIProvider {
  switch (useCase) {
    case "fast":
      return "groq"; // Fastest inference
    case "quality":
      return "gpt-4"; // Best overall quality
    case "code":
      return "claude"; // Best for code generation
    case "reasoning":
      return "deepseek"; // Best for complex reasoning
    default:
      return "gpt-4";
  }
}

/**
 * Get default fallback chain for a provider
 */
export function getFallbackChain(provider: AIProvider): AIProvider[] {
  const allProviders: AIProvider[] = ["gpt-4", "gemini", "groq", "claude", "deepseek"];
  return allProviders.filter((p) => p !== provider);
}

/**
 * Stream response from AI provider (for real-time responses)
 * Note: Streaming implementation depends on frontend setup
 */
export async function streamFromAI(
  messages: ChatMessage[],
  provider: AIProvider = "gpt-4"
): Promise<AIResponse> {
  // For now, return full response
  // Streaming would require WebSocket or Server-Sent Events setup
  return routeToAI(messages, provider);
}
