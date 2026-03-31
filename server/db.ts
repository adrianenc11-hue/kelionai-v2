import { eq, desc, asc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users, conversations, messages, subscriptionPlans, userUsage, dailyUsage } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL || "";
    if (!url) return null;
    try {
      const client = postgres(url, { ssl: { rejectUnauthorized: false } });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

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
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({ target: users.openId, set: updateSet });
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
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: "gpt-4" }).returning();
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

// ============ TRIAL & DAILY USAGE ============

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
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

  // Paid users (pro/enterprise) have no limits
  if (user.subscriptionTier !== 'free') {
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }

  // Admin has no limits
  if (user.role === 'admin') {
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }

  // Free user - check trial
  const trialStart = user.trialStartDate || user.createdAt;
  const now = new Date();
  const diffMs = now.getTime() - trialStart.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const trialDaysLeft = Math.max(0, 7 - diffDays);

  // Trial expired after 7 days
  if (trialDaysLeft <= 0) {
    return { isTrialUser: true, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "Trial expired. Upgrade to continue." };
  }

  // Check daily usage
  const todayUsage = await getDailyUsage(userId);
  const minutesUsed = todayUsage?.minutesUsed || 0;
  const messagesCount = todayUsage?.messagesCount || 0;

  if (minutesUsed >= 10) {
    return { isTrialUser: true, trialExpired: false, trialDaysLeft, dailyMinutesUsed: minutesUsed, dailyMinutesLimit: 10, dailyMessagesCount: messagesCount, canUse: false, reason: "Daily 10-minute limit reached. Come back tomorrow!" };
  }

  return { isTrialUser: true, trialExpired: false, trialDaysLeft, dailyMinutesUsed: minutesUsed, dailyMinutesLimit: 10, dailyMessagesCount: messagesCount, canUse: true };
}
