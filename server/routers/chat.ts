import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { routeToAI, getOptimalProvider, getFallbackChain, AIProvider } from "../ai-router";
import {
  getConversationsByUserId,
  getConversationById,
  createConversation,
  getMessagesByConversationId,
  createMessage,
  getUserUsage,
  updateUserUsage,
} from "../db";

export const chatRouter = router({
  /**
   * Get all conversations for the current user
   */
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return await getConversationsByUserId(ctx.user.id);
  }),

  /**
   * Get a specific conversation with all messages
   */
  getConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);

      // Verify ownership
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }

      const messages = await getMessagesByConversationId(input.conversationId);
      return { conversation, messages };
    }),

  /**
   * Create a new conversation
   */
  createConversation: protectedProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const title = input.title || `Chat - ${new Date().toLocaleDateString()}`;
      const result = await createConversation(ctx.user.id, title);
      return result;
    }),

  /**
   * Send a message and get AI response
   */
  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number(),
        message: z.string(),
        aiProvider: z.enum(["gpt-4", "gemini", "groq", "claude", "deepseek"]).optional(),
        useCase: z.enum(["fast", "quality", "code", "reasoning"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify conversation ownership
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }

      // Check usage limits based on subscription tier
      const usage = await getUserUsage(ctx.user.id);
      const tier = ctx.user.subscriptionTier || "free";
      const limits: Record<string, number> = {
        free: 20,
        pro: 200,
        enterprise: 10000,
      };

      const messagesThisMonth = usage?.messagesThisMonth || 0;
      if (messagesThisMonth >= limits[tier]) {
        throw new Error(`Message limit reached for ${tier} tier`);
      }

      // Store user message
      await createMessage(input.conversationId, "user", input.message);

      // Determine AI provider
      let provider: AIProvider = input.aiProvider || "gpt-4";
      if (input.useCase) {
        provider = getOptimalProvider(input.useCase);
      }

      // Get conversation history for context
      const messages = await getMessagesByConversationId(input.conversationId);

      // Build message array for AI
      const aiMessages = messages.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content || "",
      }));

      // Add current message
      aiMessages.push({
        role: "user" as const,
        content: input.message,
      });

      // Get AI response with fallback chain
      const fallbackChain = getFallbackChain(provider);
      const aiResponse = await routeToAI(aiMessages, provider, fallbackChain);

      // Store AI response
      await createMessage(input.conversationId, "assistant", aiResponse.content, aiResponse.provider);

      // Update usage
      const newMessagesCount = (usage?.messagesThisMonth || 0) + 2;
      const newVoiceMinutes = usage?.voiceMinutesThisMonth || 0;

      await updateUserUsage(ctx.user.id, newMessagesCount, newVoiceMinutes);

      return {
        success: true,
        message: aiResponse.content,
        provider: aiResponse.provider,
        tokensUsed: aiResponse.tokensUsed,
      };
    }),

  /**
   * Get message history for a conversation
   */
  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);

      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }

      return await getMessagesByConversationId(input.conversationId);
    }),

  /**
   * Delete a conversation
   */
  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);

      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }

      // TODO: Implement actual deletion in database
      return { success: true };
    }),
});
