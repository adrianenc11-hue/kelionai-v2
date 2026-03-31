import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, conversations, messages } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Admin-only procedure that checks user role
 */
const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return next({ ctx });
});

export const adminRouter = router({
  /**
   * Get all users (admin only)
   */
  getAllUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    try {
      const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
      return allUsers.map((u) => ({
        ...u,
        stripeCustomerId: u.stripeCustomerId ? "***" : null,
        stripeSubscriptionId: u.stripeSubscriptionId ? "***" : null,
      }));
    } catch (error) {
      console.error("[Admin] Failed to get users:", error);
      throw error;
    }
  }),

  /**
   * Get user analytics
   */
  getUserAnalytics: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    try {
      const allUsers = await db.select().from(users);
      const allConversations = await db.select().from(conversations);
      const allMessages = await db.select().from(messages);

      const totalUsers = allUsers.length;
      const activeUsers = allUsers.filter((u) => {
        const lastSignedIn = new Date(u.lastSignedIn);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return lastSignedIn > thirtyDaysAgo;
      }).length;

      const paidUsers = allUsers.filter((u) => u.subscriptionTier !== "free").length;
      const totalConversations = allConversations.length;
      const totalMessages = allMessages.length;

      const usersByTier = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length,
      };

      return {
        totalUsers,
        activeUsers,
        paidUsers,
        totalConversations,
        totalMessages,
        usersByTier,
        averageConversationsPerUser: totalConversations / totalUsers || 0,
        averageMessagesPerConversation: totalMessages / totalConversations || 0,
      };
    } catch (error) {
      console.error("[Admin] Failed to get analytics:", error);
      throw error;
    }
  }),

  /**
   * Get system health status
   */
  getSystemHealth: adminProcedure.query(async () => {
    const db = await getDb();

    return {
      database: db ? "connected" : "disconnected",
      timestamp: new Date(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    };
  }),

  /**
   * Get revenue analytics
   */
  getRevenueAnalytics: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    try {
      const allUsers = await db.select().from(users);

      const subscriptionTiers = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length,
      };

      // Placeholder pricing - would be fetched from Stripe in production
      const estimatedMRR =
        subscriptionTiers.pro * 29 + subscriptionTiers.enterprise * 99;

      return {
        subscriptionTiers,
        estimatedMRR,
        activeSubscriptions: subscriptionTiers.pro + subscriptionTiers.enterprise,
      };
    } catch (error) {
      console.error("[Admin] Failed to get revenue analytics:", error);
      throw error;
    }
  }),

  /**
   * Update user subscription tier (admin only)
   */
  updateUserSubscription: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        tier: z.enum(["free", "pro", "enterprise"]),
        status: z.enum(["active", "cancelled", "past_due", "trialing"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        const updateData: Record<string, unknown> = { subscriptionTier: input.tier };
        if (input.status) {
          updateData.subscriptionStatus = input.status;
        }

        await db.update(users).set(updateData).where(eq(users.id, input.userId));

        return { success: true };
      } catch (error) {
        console.error("[Admin] Failed to update user subscription:", error);
        throw error;
      }
    }),

  /**
   * Delete user (admin only) - soft delete by anonymizing
   */
  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error("Database not available");
      }

      try {
        // Soft delete - anonymize user data
        await db
          .update(users)
          .set({
            name: "Deleted User",
            email: null,
            openId: `deleted_${input.userId}_${Date.now()}`,
          })
          .where(eq(users.id, input.userId));

        return { success: true };
      } catch (error) {
        console.error("[Admin] Failed to delete user:", error);
        throw error;
      }
    }),
});
