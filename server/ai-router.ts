/**
 * AI Router - Simplified to only use gpt-5.4-pro via core LLM
 */

import { invokeLLM } from "./_core/llm";

// Maintain type backwards compatibility to prevent massive TS refactoring across the codebase, 
// but force its actual value conceptually for our code logic.
export type AIProvider = "gpt-5.4-pro" | "gpt-4" | "gemini" | "groq" | "claude" | "deepseek";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

export interface AIResponse {
  provider: string;
  content: string;
  tokensUsed?: number;
  model?: string;
}

/**
 * Route a chat request simply to our sole AI provider
 */
export async function routeToAI(
  messages: ChatMessage[],
  provider?: AIProvider, // kept for backward compatibility with TS
  fallbackChain?: AIProvider[] // kept for backward compatibility with TS
): Promise<AIResponse> {
  try {
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
      provider: "gpt-5.4-pro",
      content,
      tokensUsed,
      model: "gpt-5.4-pro",
    };
  } catch (error) {
    console.error(`[AI Router] gpt-5.4-pro failed:`, error);
    throw error;
  }
}

/**
 * All use cases naturally fall back to our Pro model
 */
export function getOptimalProvider(useCase: string): AIProvider {
  return "gpt-5.4-pro";
}

/**
 * Fallback chain is explicitly empty
 */
export function getFallbackChain(provider?: string): AIProvider[] {
  return [];
}

/**
 * Stream response from AI provider
 */
export async function streamFromAI(
  messages: ChatMessage[],
  provider?: AIProvider
): Promise<AIResponse> {
  return routeToAI(messages);
}
