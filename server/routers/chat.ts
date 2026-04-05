import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getConversationsByUserId, getConversationById, createConversation,
  getMessagesByConversationId, createMessage, getUserUsage, updateUserUsage,
  getSubscriptionPlans, deleteConversationMessages,
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
      if (!conversation || conversation.userId !== ctx.user.id) throw new Error("Not found");
      const messages = await getMessagesByConversationId(input.conversationId);
      return { conversation, messages };
    }),

  createConversation: protectedProcedure
    .input(z.object({ title: z.string().optional(), avatar: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return await createConversation(ctx.user.id, input.title || `Chat - ${new Date().toLocaleDateString()}`);
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      conversationId: z.number().optional(),
      message: z.string(),
      avatar: z.enum(["kelion", "kira"]).optional(),
      imageUrl: z.string().optional(),
      history: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })).optional(),
      location: z.object({ lat: z.number(), lon: z.number(), city: z.string().optional() }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const avatar: CharacterName = input.avatar || "kelion";

      // FAST: auth already done by protectedProcedure
      // FAST: limit check (single DB read)
      const [usage, plans] = await Promise.all([
        getUserUsage(ctx.user.id),
        getSubscriptionPlans(),
      ]);
      const tier = ctx.user.subscriptionTier || "free";
      const messagesThisMonth = usage?.messagesThisMonth || 0;
      const userPlan = plans.find((p) => p.tier === tier);
      const messageLimit = userPlan?.messagesPerMonth ?? 20;
      if (messageLimit !== -1 && messagesThisMonth >= messageLimit) {
        throw Object.assign(new Error("LIMIT_REACHED"), { code: "LIMIT_REACHED", tier });
      }

      // FAST: use history from frontend if available, skip DB read
      const history: BrainMessage[] = input.history || [];

      // FAST: Gemini Flash (0.8s)
      const brainResult = await processBrainMessage({
        message: input.message,
        history,
        character: avatar,
        userId: ctx.user.id,
        userName: ctx.user.name || "User",
        imageUrl: input.imageUrl,
        location: input.location,
      });

      // FAST: return response immediately
      const response = {
        success: true,
        conversationId: input.conversationId || 0,
        message: brainResult.content,
        confidence: brainResult.confidence,
        toolsUsed: brainResult.toolsUsed,
        userLevel: brainResult.userLevel,
        language: brainResult.language,
        searchStatus: brainResult.searchStatus,
        voiceCloningStep: brainResult.voiceCloningStep,
        audioUrl: brainResult.audioUrl,
      };

      // BACKGROUND: DB writes after response
      const convId = input.conversationId;
      const userId = ctx.user.id;
      const msg = input.message;
      const aiContent = brainResult.content;
      const voiceMinutes = usage?.voiceMinutesThisMonth || 0;

      setTimeout(async () => {
        try {
          let cid = convId;
          if (!cid) {
            const r = await createConversation(userId, msg.slice(0, 50));
            cid = (r as any)?.id || (r as any)[0]?.id;
          }
          if (cid) {
            await createMessage(cid, "user", msg);
            await createMessage(cid, "assistant", aiContent, "brain-v5");
            response.conversationId = cid;
          }
          await updateUserUsage(userId, messagesThisMonth + 2, voiceMinutes);
        } catch (e) { console.error("[Chat] Background save error:", e); }
      }, 0);

      return response;
    }),

  voiceCloningStep: protectedProcedure
    .input(z.object({ step: z.number(), audioBase64: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const audioBuffer = input.audioBase64 ? Buffer.from(input.audioBase64, "base64") : undefined;
      return await processVoiceCloningStep({
        step: input.step, userId: ctx.user.id, userName: ctx.user.name || "User", audioBuffer,
      });
    }),

  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) throw new Error("Not found");
      return await getMessagesByConversationId(input.conversationId);
    }),

  deleteConversation: protectedProcedure
    .input(z.object({ conversationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const conversation = await getConversationById(input.conversationId);
      if (!conversation || conversation.userId !== ctx.user.id) throw new Error("Not found");
      await deleteConversationMessages(input.conversationId);
      return { success: true };
    }),
});
