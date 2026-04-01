import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getConversationsByUserId,
  getConversationById,
  createConversation,
  getMessagesByConversationId,
  createMessage,
  getUserUsage,
  updateUserUsage,
  getTrialStatus,
  incrementDailyUsage,
  deleteConversationMessages,
} from "../db";
import { processBrainMessage, processVoiceCloningStep, BrainMessage } from "../brain-v4";
import { CharacterName } from "../characters";

export const chatRouter = router({
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return await getConversationsByUserId(ctx.user.id);
  }),

  getConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }
      const messages = await getMessagesByConversationId(input.conversationId);
      return { conversation, messages };
    }),

  createConversation: protectedProcedure
    .input(z.object({ title: z.string().optional(), avatar: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const title = input.title || `Chat - ${new Date().toLocaleDateString()}`;
      return await createConversation(ctx.user.id, title);
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().optional(),
        message: z.string(),
        avatar: z.enum(["kelion", "kira"]).optional(),
        imageUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let conversationId = input.conversationId;
      const avatar: CharacterName = input.avatar || "kelion";

      // Auto-create conversation if none provided
      if (!conversationId) {
        const title = input.message.slice(0, 50) + (input.message.length > 50 ? "..." : "");
        const result = await createConversation(ctx.user.id, title);
        conversationId = (result as any)?.id || (result as any)[0]?.id;
        if (!conversationId) throw new Error("Failed to create conversation");
      }

      // Verify ownership
      const conversation = await getConversationById(conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }

      // Check trial/usage limits for free users
      const trialStatus = await getTrialStatus(ctx.user.id);
      if (!trialStatus.canUse) {
        throw new Error(trialStatus.reason || "Usage limit reached. Please upgrade.");
      }

      // Store user message
      await createMessage(conversationId, "user", input.message);

      // Get conversation history for Brain v4
      const dbMessages = await getMessagesByConversationId(conversationId);
      const history: BrainMessage[] = dbMessages.map((m: any) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content || "",
      }));

      // Process through Brain v4
      const brainResult = await processBrainMessage({
        message: input.message,
        history,
        character: avatar,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        imageUrl: input.imageUrl,
      });

      // Store AI response
      await createMessage(conversationId, "assistant", brainResult.content, "brain-v4");

      // Update daily usage (estimate ~1 min per message exchange for free users)
      if (trialStatus.isTrialUser) {
        await incrementDailyUsage(ctx.user.id, 1, 2);
      }

      return {
        success: true,
        conversationId,
        message: brainResult.content,
        audioUrl: brainResult.audioUrl,
        confidence: brainResult.confidence,
        toolsUsed: brainResult.toolsUsed,
        userLevel: brainResult.userLevel,
        language: brainResult.language,
        voiceCloningStep: brainResult.voiceCloningStep,
      };
    }),

  // Voice cloning step processor
  voiceCloningStep: protectedProcedure
    .input(
      z.object({
        step: z.number(),
        audioBase64: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let audioBuffer: Buffer | undefined;
      if (input.audioBase64) {
        audioBuffer = Buffer.from(input.audioBase64, "base64");
      }

      const result = await processVoiceCloningStep({
        step: input.step,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        audioBuffer,
      });

      return result;
    }),

  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }
      return await getMessagesByConversationId(input.conversationId);
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) {
        throw new Error("Conversation not found or access denied");
      }
      await deleteConversationMessages(input.conversationId);
      return { success: true };
    }),
});
