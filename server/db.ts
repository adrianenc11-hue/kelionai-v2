import { eq, desc, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users, conversations, messages, subscriptionPlans, userUsage, userMemories, userLearningProfiles, userPreferences } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db) {
    const url = ENV.databaseUrl;
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
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: ENV.openaiModel }).returning();
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

// MEMORIES
export async function getUserMemories(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(userMemories).where(eq(userMemories.userId, userId)).orderBy(desc(userMemories.updatedAt));
}

export async function saveUserMemory(userId: number, key: string, value: string, importance = 1) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(userMemories).where(eq(userMemories.userId, userId)).then(rows => rows.find(r => r.key === key));
  if (existing) {
    await db.update(userMemories).set({ value, importance, updatedAt: new Date() }).where(eq(userMemories.id, existing.id));
  } else {
    await db.insert(userMemories).values({ userId, key, value, importance });
  }
}

export async function deleteUserMemory(memoryId: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userMemories).where(eq(userMemories.id, memoryId));
}

export async function clearUserMemories(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(userMemories).where(eq(userMemories.userId, userId));
}

// LEARNING PROFILES
export async function getUserLearningProfile(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userLearningProfiles).where(eq(userLearningProfiles.userId, userId)).limit(1);
  return result[0] || null;
}

export async function upsertUserLearningProfile(userId: number, data: Partial<typeof userLearningProfiles.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserLearningProfile(userId);
  if (existing) {
    await db.update(userLearningProfiles).set({ ...data, lastUpdated: new Date() }).where(eq(userLearningProfiles.userId, userId));
  } else {
    await db.insert(userLearningProfiles).values({ userId, ...data });
  }
}

// PREFERENCES
export async function getUserPreferences(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return result[0] || null;
}

export async function upsertUserPreferences(userId: number, data: Partial<typeof userPreferences.$inferInsert>) {
  const db = await getDb();
  if (!db) return;
  const existing = await getUserPreferences(userId);
  if (existing) {
    await db.update(userPreferences).set({ ...data, updatedAt: new Date() }).where(eq(userPreferences.userId, userId));
  } else {
    await db.insert(userPreferences).values({ userId, ...data });
  }
}
