/**
 * GDPR Router - Data privacy compliance endpoints
 * Right to access (export), Right to be forgotten (delete)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getConversationsByUserId, getMessagesByConversationId, getUserReferrals, getRefundRequests, closeUserAccount } from "../db";
import { users, conversations, messages, dailyUsage, userUsage, userChatMessages, userChatParticipants, voiceLibrary, userClonedVoices, contactMessages } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { deleteClonedVoice } from "../elevenlabs";

export const gdprRouter = router({
  /**
   * Export all user data (GDPR Art. 20 - Right to data portability)
   */
  exportData: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const userId = ctx.user.id;

    // Gather all user data
    const userRecord = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const userConversations = await getConversationsByUserId(userId);

    // Get all messages from all conversations
    const allMessages: any[] = [];
    for (const conv of userConversations) {
      const msgs = await getMessagesByConversationId(conv.id);
      allMessages.push(...msgs.map((m: any) => ({
        conversationId: conv.id,
        conversationTitle: conv.title,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })));
    }

    // Get usage data
    const usage = await db.select().from(userUsage).where(eq(userUsage.userId, userId));
    const daily = await db.select().from(dailyUsage).where(eq(dailyUsage.userId, userId));

    // Get referrals
    const referrals = await getUserReferrals(userId);

    // Get refund requests
    const refunds = await getRefundRequests(userId);

    // Get voice library
    const voices = await db.select().from(voiceLibrary).where(eq(voiceLibrary.userId, userId));

    // Get contact messages
    const contacts = await db.select().from(contactMessages).where(eq(contactMessages.userId, userId));

    // Sanitize user record (remove password hash)
    const sanitizedUser = userRecord[0] ? {
      id: userRecord[0].id,
      name: userRecord[0].name,
      email: userRecord[0].email,
      role: userRecord[0].role,
      language: userRecord[0].language,
      subscriptionTier: userRecord[0].subscriptionTier,
      subscriptionStatus: userRecord[0].subscriptionStatus,
      billingCycle: userRecord[0].billingCycle,
      trialStartDate: userRecord[0].trialStartDate,
      createdAt: userRecord[0].createdAt,
      lastSignedIn: userRecord[0].lastSignedIn,
    } : null;

    return {
      exportDate: new Date().toISOString(),
      user: sanitizedUser,
      conversations: userConversations.map((c: any) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      messages: allMessages,
      usage,
      dailyUsage: daily,
      referrals,
      refundRequests: refunds,
      voiceLibrary: voices,
      contactMessages: contacts,
    };
  }),

  /**
   * Delete all user data (GDPR Art. 17 - Right to erasure / Right to be forgotten)
   * This is PERMANENT and cannot be undone.
   */
  deleteAllData: protectedProcedure
    .input(z.object({
      confirmEmail: z.string(),
      confirmPhrase: z.literal("DELETE MY DATA"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify the confirmation email matches
      if (input.confirmEmail !== ctx.user.email) {
        throw new Error("Email confirmation does not match your account email");
      }

      const userId = ctx.user.id;
      console.log(`[GDPR] Starting full data deletion for user ${userId} (${ctx.user.email})`);

      try {
        // 1. Delete cloned voices from ElevenLabs
        const clonedVoices = await db.select().from(userClonedVoices).where(eq(userClonedVoices.userId, userId));
        for (const voice of clonedVoices) {
          try {
            await deleteClonedVoice(voice.voiceId);
          } catch (e) {
            console.error(`[GDPR] Failed to delete ElevenLabs voice ${voice.voiceId}:`, e);
          }
        }
        await db.delete(userClonedVoices).where(eq(userClonedVoices.userId, userId));

        // 2. Delete voice library entries
        await db.delete(voiceLibrary).where(eq(voiceLibrary.userId, userId));

        // 3. Delete all messages from all conversations
        const userConvs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.userId, userId));
        for (const conv of userConvs) {
          await db.delete(messages).where(eq(messages.conversationId, conv.id));
        }

        // 4. Delete conversations
        await db.delete(conversations).where(eq(conversations.userId, userId));

        // 5. Delete usage data
        await db.delete(userUsage).where(eq(userUsage.userId, userId));
        await db.delete(dailyUsage).where(eq(dailyUsage.userId, userId));

        // 6. Delete chat participants & messages (user-to-user chat)
        await db.delete(userChatParticipants).where(eq(userChatParticipants.userId, userId));
        await db.delete(userChatMessages).where(eq(userChatMessages.senderId, userId));

        // 7. Delete contact messages
        await db.delete(contactMessages).where(eq(contactMessages.userId, userId));

        // 8. Cancel Stripe subscription if active
        if (ctx.user.stripeSubscriptionId) {
          try {
            const Stripe = (await import("stripe")).default;
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
            await stripe.subscriptions.cancel(ctx.user.stripeSubscriptionId);
          } catch (e) {
            console.error("[GDPR] Stripe cancellation error:", e);
          }
        }

        // 9. Anonymize user record (keep for referential integrity)
        await db.update(users).set({
          name: "Deleted User",
          email: null,
          passwordHash: null,
          avatarUrl: null,
          openId: `deleted_${userId}_${Date.now()}`,
          loginMethod: null,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          subscriptionTier: "free" as const,
          subscriptionStatus: "cancelled" as const,
          accountClosed: true,
          accountClosedAt: new Date(),
          language: null,
        }).where(eq(users.id, userId));

        console.log(`[GDPR] Full data deletion complete for user ${userId}`);

        return {
          success: true,
          message: "All your data has been permanently deleted. Your session will now end.",
          deletedItems: {
            clonedVoices: clonedVoices.length,
            conversations: userConvs.length,
          },
        };
      } catch (error) {
        console.error("[GDPR] Data deletion failed:", error);
        throw new Error("Data deletion failed. Please contact support.");
      }
    }),
});
