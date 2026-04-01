import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { users, conversations, messages } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { getBrainDiagnostics } from "../brain-v4";

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
      return allUsers.map((u: any) => ({
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
      const { sql: sqlTag } = await import("drizzle-orm");

      const [counts] = await db.execute(sqlTag`
        SELECT
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE last_signed_in > NOW() - INTERVAL '30 days') as active_users,
          (SELECT COUNT(*) FROM users WHERE subscription_tier != 'free') as paid_users,
          (SELECT COUNT(*) FROM conversations) as total_conversations,
          (SELECT COUNT(*) FROM messages) as total_messages,
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'free') as tier_free,
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'pro') as tier_pro,
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'enterprise') as tier_enterprise
      `) as any;

      const c = counts || {};
      const totalUsers = Number(c.total_users) || 0;
      const totalConversations = Number(c.total_conversations) || 0;
      const totalMessages = Number(c.total_messages) || 0;

      return {
        totalUsers,
        activeUsers: Number(c.active_users) || 0,
        paidUsers: Number(c.paid_users) || 0,
        totalConversations,
        totalMessages,
        usersByTier: {
          free: Number(c.tier_free) || 0,
          pro: Number(c.tier_pro) || 0,
          enterprise: Number(c.tier_enterprise) || 0,
        },
        averageConversationsPerUser: totalUsers > 0 ? totalConversations / totalUsers : 0,
        averageMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
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
      const { sql: sqlTag } = await import("drizzle-orm");

      const [counts] = await db.execute(sqlTag`
        SELECT
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'free') as tier_free,
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'pro') as tier_pro,
          (SELECT COUNT(*) FROM users WHERE subscription_tier = 'enterprise') as tier_enterprise
      `) as any;

      const c = counts || {};
      const subscriptionTiers = {
        free: Number(c.tier_free) || 0,
        pro: Number(c.tier_pro) || 0,
        enterprise: Number(c.tier_enterprise) || 0,
      };

      // Actual pricing: Pro €9.99, Premium/Enterprise €19.99
      const estimatedMRR = subscriptionTiers.pro * 9.99 + subscriptionTiers.enterprise * 19.99;

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
   * Get Brain v4 diagnostics
   */
  getBrainDiagnostics: adminProcedure.query(async () => {
    return getBrainDiagnostics();
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
