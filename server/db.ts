import { eq, desc, asc, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users, conversations, messages, subscriptionPlans, userUsage, dailyUsage, referralCodes, refundRequests } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: any = null;
let _client: ReturnType<typeof postgres> | null = null;

// Supabase PostgreSQL connection - override any built-in MySQL DATABASE_URL
const SUPABASE_DATABASE_URL = process.env.SUPABASE_DATABASE_URL || "";

export async function getDb() {
  if (!_db) {
    const url = SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "";
    if (!url || url.startsWith('mysql://')) {
      console.warn('[Database] No PostgreSQL URL configured. Set SUPABASE_DATABASE_URL.');
      return null;
    }
    try {
      _client = postgres(url, {
        ssl: 'require',
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

/** Graceful shutdown — close all DB connections */
export async function closeDb() {
  if (_client) {
    try {
      await _client.end();
      console.log("[Database] Connections closed gracefully");
    } catch (e) {
      console.error("[Database] Error closing connections:", e);
    }
    _client = null;
    _db = null;
  }
}

// Register shutdown handlers
process.on("SIGTERM", async () => { await closeDb(); process.exit(0); });
process.on("SIGINT", async () => { await closeDb(); process.exit(0); });

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId || user.openId === 'email_adrianenc11@gmail.com' || user.email === 'adrianenc11@gmail.com') { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    // PostgreSQL upsert: ON CONFLICT (open_id) DO UPDATE
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot get user: database not available"); return undefined; }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getConversationsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
  } catch (error) { console.error("[Database] Failed to get conversations:", error); return []; }
}

export async function getConversationById(conversationId: number) {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const result = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) { console.error("[Database] Failed to get conversation:", error); return undefined; }
}

export async function createConversation(userId: number, title: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    // PostgreSQL: use .returning() instead of .$returningId()
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: "gpt-4.1" }).returning();
    return result[0];
  } catch (error) { console.error("[Database] Failed to create conversation:", error); throw error; }
}

export async function getMessagesByConversationId(conversationId: number) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
  } catch (error) { console.error("[Database] Failed to get messages:", error); return []; }
}

export async function createMessage(conversationId: number, role: "user" | "assistant" | "system", content: string, aiModel?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    // PostgreSQL: use .returning() instead of .$returningId()
    const result = await db.insert(messages).values({ conversationId, role, content, aiModel }).returning();
    return result[0];
  } catch (error) { console.error("[Database] Failed to create message:", error); throw error; }
}

export async function getSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
  } catch (error) { console.error("[Database] Failed to get subscription plans:", error); return []; }
}

export async function getUserUsage(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const result = await db.select().from(userUsage).where(eq(userUsage.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) { console.error("[Database] Failed to get user usage:", error); return undefined; }
}

export async function updateMessage(messageId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(messages).set({ content }).where(eq(messages.id, messageId));
  return { success: true };
}

export async function deleteMessage(messageId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.id, messageId));
  return { success: true };
}

export async function getMessageById(messageId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function deleteConversationMessages(conversationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  return { success: true };
}

export async function updateUserProfilePicture(userId: number, avatarUrl: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
  return { success: true };
}

export async function updateUserLanguage(userId: number, language: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ language }).where(eq(users.id, userId));
  return { success: true };
}

export async function updateUserUsage(userId: number, messagesThisMonth: number, voiceMinutesThisMonth: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const usage = await getUserUsage(userId);
  if (usage) {
    await db.update(userUsage).set({ messagesThisMonth, voiceMinutesThisMonth }).where(eq(userUsage.userId, userId));
  } else {
    await db.insert(userUsage).values({ userId, messagesThisMonth, voiceMinutesThisMonth });
  }
}

// ============ REFERRAL SYSTEM ============

function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'KEL-';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createReferralCode(senderUserId: number, recipientEmail: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const code = generateReferralCode();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  const result = await db.insert(referralCodes).values({
    code,
    senderUserId,
    recipientEmail,
    expiresAt,
  }).returning();
  return result[0];
}

export async function getReferralByCode(code: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(referralCodes).where(eq(referralCodes.code, code.toUpperCase())).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function markReferralUsed(codeId: number, usedByUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referralCodes).set({ usedBy: usedByUserId, usedAt: new Date() }).where(eq(referralCodes.id, codeId));
}

export async function applyReferralBonus(referralId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const referral = await db.select().from(referralCodes).where(eq(referralCodes.id, referralId)).limit(1);
  if (!referral.length || referral[0].bonusApplied) return;
  
  const sender = await db.select().from(users).where(eq(users.id, referral[0].senderUserId)).limit(1);
  if (sender.length && sender[0].stripeSubscriptionId) {
    try {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
      const sub = await stripe.subscriptions.retrieve(sender[0].stripeSubscriptionId) as any;
      if (sub && sub.current_period_end) {
        const newEnd = sub.current_period_end + (7 * 24 * 60 * 60);
        await stripe.subscriptions.update(sender[0].stripeSubscriptionId, {
          trial_end: newEnd,
          proration_behavior: 'none',
        } as any);
        console.log(`[Referral] Extended subscription for user ${sender[0].id} by 7 days via Stripe`);
      }
    } catch (stripeErr) {
      console.error(`[Referral] Stripe extension failed, tracking locally:`, stripeErr);
    }
    await db.update(referralCodes).set({ bonusApplied: true }).where(eq(referralCodes.id, referralId));
    console.log(`[Referral] Bonus +7 days applied for user ${referral[0].senderUserId}`);
  } else if (sender.length) {
    await db.update(referralCodes).set({ bonusApplied: true }).where(eq(referralCodes.id, referralId));
    console.log(`[Referral] Bonus tracked for free user ${referral[0].senderUserId} (will apply on subscription)`);
  }
}

export async function getUserReferrals(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(referralCodes).where(eq(referralCodes.senderUserId, userId)).orderBy(desc(referralCodes.createdAt));
}

// ============ REFUND SYSTEM ============

export async function createRefundRequest(userId: number, stripeSubId: string | null, billingCycle: string, subStartDate: Date | null, monthsElapsed: number, refundAmount: string | null, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(refundRequests).values({
    userId,
    stripeSubscriptionId: stripeSubId,
    billingCycle,
    subscriptionStartDate: subStartDate,
    monthsElapsed,
    refundAmount,
    status: billingCycle === 'monthly' ? 'denied' : (monthsElapsed >= 3 ? 'denied' : 'pending'),
    reason,
    adminNote: billingCycle === 'monthly' 
      ? 'Monthly subscriptions are non-refundable.' 
      : (monthsElapsed >= 3 ? 'Refund not available after 3 completed months.' : null),
  }).returning();
  return result[0];
}

export async function getRefundRequests(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(refundRequests).where(eq(refundRequests.userId, userId)).orderBy(desc(refundRequests.createdAt));
}

export async function getAllRefundRequests() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(refundRequests).orderBy(desc(refundRequests.createdAt));
}

export async function updateRefundStatus(refundId: number, status: string, adminNote?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(refundRequests).set({ 
    status: status as any, 
    adminNote,
    resolvedAt: new Date() 
  }).where(eq(refundRequests.id, refundId));
}

// ============ TRIAL & DAILY USAGE ============

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getDailyUsage(userId: number, date?: string) {
  const db = await getDb();
  if (!db) return undefined;
  const d = date || getTodayDate();
  const result = await db.select().from(dailyUsage).where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, d))).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function incrementDailyUsage(userId: number, addMinutes: number = 0, addMessages: number = 1) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const today = getTodayDate();
  const existing = await getDailyUsage(userId, today);
  if (existing) {
    await db.update(dailyUsage).set({
      minutesUsed: (existing.minutesUsed || 0) + addMinutes,
      messagesCount: (existing.messagesCount || 0) + addMessages,
      lastActivityAt: new Date(),
    }).where(eq(dailyUsage.id, existing.id));
  } else {
    await db.insert(dailyUsage).values({
      userId,
      date: today,
      minutesUsed: addMinutes,
      messagesCount: addMessages,
      lastActivityAt: new Date(),
    });
  }
}

export interface TrialStatus {
  isTrialUser: boolean;
  trialExpired: boolean;
  trialDaysLeft: number;
  dailyMinutesUsed: number;
  dailyMinutesLimit: number;
  dailyMessagesCount: number;
  canUse: boolean;
  reason?: string;
}

export async function getTrialStatus(userId: number): Promise<TrialStatus> {
  const db = await getDb();
  if (!db) return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "Database not available" };

  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userResult.length) return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "User not found" };

  const user = userResult[0];

  // Account closed - block access
  if (user.accountClosed) {
    return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 0, dailyMessagesCount: 0, canUse: false, reason: "Account closed. Contact support for assistance." };
  }

  // Admin always has access
  if (user.role === 'admin') {
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }

  // Paid subscription - check if still active
  if (user.subscriptionTier !== 'free') {
    if (user.subscriptionStatus === 'cancelled' || user.subscriptionStatus === 'past_due') {
      return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 0, dailyMessagesCount: 0, canUse: false, reason: `Subscription ${user.subscriptionStatus === 'past_due' ? 'payment failed' : 'cancelled'}. Please renew to continue.` };
    }
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }

  const trialStart = user.trialStartDate || user.createdAt;
  const now = new Date();
  const diffMs = now.getTime() - trialStart.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const trialDaysLeft = Math.max(0, 7 - diffDays);

  if (trialDaysLeft <= 0) {
    return { isTrialUser: true, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "Trial expired. Upgrade to continue." };
  }

  const todayUsage = await getDailyUsage(userId);
  const minutesUsed = todayUsage?.minutesUsed || 0;
  const messagesCount = todayUsage?.messagesCount || 0;

  if (minutesUsed >= 10) {
    return { isTrialUser: true, trialExpired: false, trialDaysLeft, dailyMinutesUsed: minutesUsed, dailyMinutesLimit: 10, dailyMessagesCount: messagesCount, canUse: false, reason: "Daily 10-minute limit reached. Come back tomorrow!" };
  }

  return { isTrialUser: true, trialExpired: false, trialDaysLeft, dailyMinutesUsed: minutesUsed, dailyMinutesLimit: 10, dailyMessagesCount: messagesCount, canUse: true };
}

// ============ ACCOUNT CLOSURE ============

export async function closeUserAccount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    accountClosed: true,
    accountClosedAt: new Date(),
    subscriptionTier: "free",
    subscriptionStatus: "cancelled",
    stripeSubscriptionId: null,
  }).where(eq(users.id, userId));
  console.log(`[Account] User ${userId} account closed after refund`);
}
