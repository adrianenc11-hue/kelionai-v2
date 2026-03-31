import { eq, desc, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, conversations, messages, subscriptionPlans, userUsage } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
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

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Conversation queries
export async function getConversationsByUserId(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get conversations: database not available");
    return [];
  }

  try {
    const result = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
    return result;
  } catch (error) {
    console.error("[Database] Failed to get conversations:", error);
    return [];
  }
}

export async function getConversationById(conversationId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get conversation: database not available");
    return undefined;
  }

  try {
    const result = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get conversation:", error);
    return undefined;
  }
}

export async function createConversation(userId: number, title: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: "gpt-4" });
    return result;
  } catch (error) {
    console.error("[Database] Failed to create conversation:", error);
    throw error;
  }
}

// Message queries
export async function getMessagesByConversationId(conversationId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get messages: database not available");
    return [];
  }

  try {
    const result = await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
    return result;
  } catch (error) {
    console.error("[Database] Failed to get messages:", error);
    return [];
  }
}

export async function createMessage(conversationId: number, role: "user" | "assistant" | "system", content: string, aiModel?: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const result = await db.insert(messages).values({ conversationId, role, content, aiModel });
    return result;
  } catch (error) {
    console.error("[Database] Failed to create message:", error);
    throw error;
  }
}

// Subscription queries
export async function getSubscriptionPlans() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get subscription plans: database not available");
    return [];
  }

  try {
    const result = await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
    return result;
  } catch (error) {
    console.error("[Database] Failed to get subscription plans:", error);
    return [];
  }
}

// User usage queries
export async function getUserUsage(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user usage: database not available");
    return undefined;
  }

  try {
    const result = await db.select().from(userUsage).where(eq(userUsage.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get user usage:", error);
    return undefined;
  }
}

// Message editing
export async function updateMessage(messageId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(messages).set({ content }).where(eq(messages.id, messageId));
    return { success: true };
  } catch (error) {
    console.error("[Database] Failed to update message:", error);
    throw error;
  }
}

export async function deleteMessage(messageId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.delete(messages).where(eq(messages.id, messageId));
    return { success: true };
  } catch (error) {
    console.error("[Database] Failed to delete message:", error);
    throw error;
  }
}

export async function getMessageById(messageId: number) {
  const db = await getDb();
  if (!db) return undefined;
  try {
    const result = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
    return result.length > 0 ? result[0] : undefined;
  } catch (error) {
    console.error("[Database] Failed to get message:", error);
    return undefined;
  }
}

export async function deleteConversationMessages(conversationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.delete(messages).where(eq(messages.conversationId, conversationId));
    await db.delete(conversations).where(eq(conversations.id, conversationId));
    return { success: true };
  } catch (error) {
    console.error("[Database] Failed to delete conversation:", error);
    throw error;
  }
}

// Profile picture
export async function updateUserProfilePicture(userId: number, avatarUrl: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
    return { success: true };
  } catch (error) {
    console.error("[Database] Failed to update profile picture:", error);
    throw error;
  }
}

export async function updateUserUsage(userId: number, messagesThisMonth: number, voiceMinutesThisMonth: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  try {
    const usage = await getUserUsage(userId);
    if (usage) {
      await db.update(userUsage).set({ messagesThisMonth, voiceMinutesThisMonth }).where(eq(userUsage.userId, userId));
    } else {
      await db.insert(userUsage).values({ userId, messagesThisMonth, voiceMinutesThisMonth });
    }
  } catch (error) {
    console.error("[Database] Failed to update user usage:", error);
    throw error;
  }
}
