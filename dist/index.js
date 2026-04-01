var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/const.ts
var COOKIE_NAME, ONE_YEAR_MS, AXIOS_TIMEOUT_MS, UNAUTHED_ERR_MSG, NOT_ADMIN_ERR_MSG;
var init_const = __esm({
  "shared/const.ts"() {
    "use strict";
    COOKIE_NAME = "app_session_id";
    ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
    AXIOS_TIMEOUT_MS = 3e4;
    UNAUTHED_ERR_MSG = "Please login (10001)";
    NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
  }
});

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  const secure = isSecureRequest(req);
  const isStandalone3 = true;
  return {
    httpOnly: true,
    path: "/",
    sameSite: isStandalone3 ? "lax" : "none",
    secure: isStandalone3 ? secure : true
  };
}
var init_cookies = __esm({
  "server/_core/cookies.ts"() {
    "use strict";
  }
});

// server/_core/env.ts
var ENV;
var init_env = __esm({
  "server/_core/env.ts"() {
    "use strict";
    ENV = {
      appId: process.env.VITE_APP_ID ?? "",
      cookieSecret: process.env.JWT_SECRET ?? "",
      databaseUrl: process.env.DATABASE_URL ?? "",
      supabaseUrl: process.env.SUPABASE_URL ?? "",
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
      supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
      oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
      ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
      isProduction: process.env.NODE_ENV === "production",
      forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
      forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
      // ElevenLabs TTS & Voice Cloning
      elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
      elevenLabsVoiceKelion: process.env.ELEVENLABS_VOICE_KELION ?? "VR6AewLTigWG4xSOukaG",
      elevenLabsVoiceKira: process.env.ELEVENLABS_VOICE_KIRA ?? "EXAVITQu4vr4xnSDxMaL",
      // OpenAI for GPT-5.4 vision + Whisper STT
      openaiApiKey: process.env.OPENAI_API_KEY ?? ""
    };
  }
});

// drizzle/schema.ts
import { pgTable, text, timestamp, varchar, boolean, numeric, json, serial, integer, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
var roleEnum, subscriptionTierEnum, subscriptionStatusEnum, messageRoleEnum, planTierEnum, providerEnum, users, conversations, messages, subscriptionPlans, userUsage, aiProviders, referralCodes, refundRequests, dailyUsage, userClonedVoices, payments, contactMessages, usersRelations, conversationsRelations, messagesRelations, userUsageRelations, dailyUsageRelations, chatRoomTypeEnum, userChatRooms, userChatParticipants, userChatMessages, voiceLibrary, userChatRoomsRelations, userChatParticipantsRelations, userChatMessagesRelations, voiceLibraryRelations;
var init_schema = __esm({
  "drizzle/schema.ts"() {
    "use strict";
    roleEnum = pgEnum("role", ["user", "admin"]);
    subscriptionTierEnum = pgEnum("subscription_tier", ["free", "pro", "enterprise"]);
    subscriptionStatusEnum = pgEnum("subscription_status", ["active", "cancelled", "past_due", "trialing"]);
    messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
    planTierEnum = pgEnum("plan_tier", ["free", "pro", "enterprise"]);
    providerEnum = pgEnum("provider", ["openai", "google", "groq", "anthropic", "deepseek"]);
    users = pgTable("users", {
      id: serial("id").primaryKey(),
      openId: varchar("open_id", { length: 64 }).notNull().unique(),
      name: text("name"),
      email: varchar("email", { length: 320 }),
      passwordHash: text("password_hash"),
      loginMethod: varchar("login_method", { length: 64 }),
      role: roleEnum("role").default("user").notNull(),
      avatarUrl: text("avatar_url"),
      stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
      stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
      subscriptionTier: subscriptionTierEnum("subscription_tier").default("free").notNull(),
      subscriptionStatus: subscriptionStatusEnum("subscription_status").default("active"),
      language: varchar("language", { length: 10 }).default("en"),
      trialStartDate: timestamp("trial_start_date").defaultNow(),
      trialExpired: boolean("trial_expired").default(false),
      subscriptionStartDate: timestamp("subscription_start_date"),
      billingCycle: varchar("billing_cycle", { length: 10 }).default("monthly"),
      referralBonusDays: integer("referral_bonus_days").default(0),
      accountClosed: boolean("account_closed").default(false),
      accountClosedAt: timestamp("account_closed_at"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull(),
      lastSignedIn: timestamp("last_signed_in").defaultNow().notNull()
    });
    conversations = pgTable("conversations", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      title: text("title"),
      description: text("description"),
      primaryAiModel: varchar("primary_ai_model", { length: 50 }).default("gpt-4"),
      isArchived: boolean("is_archived").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    messages = pgTable("messages", {
      id: serial("id").primaryKey(),
      conversationId: integer("conversation_id").notNull(),
      role: messageRoleEnum("role").notNull(),
      content: text("content"),
      aiModel: varchar("ai_model", { length: 50 }),
      tokens: integer("tokens"),
      metadata: json("metadata"),
      intent: varchar("intent", { length: 50 }),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    subscriptionPlans = pgTable("subscription_plans", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 100 }).notNull(),
      tier: planTierEnum("tier").notNull(),
      stripePriceId: varchar("stripe_price_id", { length: 255 }),
      monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }),
      yearlyPrice: numeric("yearly_price", { precision: 10, scale: 2 }),
      messagesPerMonth: integer("messages_per_month"),
      voiceMinutesPerMonth: integer("voice_minutes_per_month"),
      features: json("features"),
      messageLimit: integer("message_limit"),
      voiceMinutes: integer("voice_minutes"),
      isActive: boolean("is_active").default(true),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    userUsage = pgTable("user_usage", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      messagesThisMonth: integer("messages_this_month").default(0),
      voiceMinutesThisMonth: integer("voice_minutes_this_month").default(0),
      lastResetDate: timestamp("last_reset_date").defaultNow(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    aiProviders = pgTable("ai_providers", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 50 }).notNull(),
      provider: providerEnum("provider").notNull(),
      model: varchar("model", { length: 100 }).notNull(),
      isActive: boolean("is_active").default(true),
      priority: integer("priority").default(0),
      metadata: json("metadata"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    referralCodes = pgTable("referral_codes", {
      id: serial("id").primaryKey(),
      code: varchar("code", { length: 20 }).notNull().unique(),
      senderUserId: integer("sender_user_id").notNull(),
      recipientEmail: varchar("recipient_email", { length: 320 }).notNull(),
      expiresAt: timestamp("expires_at").notNull(),
      usedBy: integer("used_by"),
      usedAt: timestamp("used_at"),
      bonusApplied: boolean("bonus_applied").default(false),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    refundRequests = pgTable("refund_requests", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
      billingCycle: varchar("billing_cycle", { length: 10 }).notNull(),
      subscriptionStartDate: timestamp("subscription_start_date"),
      monthsElapsed: integer("months_elapsed").default(0),
      refundAmount: numeric("refund_amount", { precision: 10, scale: 2 }),
      status: varchar("status", { length: 20 }).default("pending").notNull(),
      reason: text("reason"),
      adminNote: text("admin_note"),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      resolvedAt: timestamp("resolved_at")
    });
    dailyUsage = pgTable("daily_usage", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      date: varchar("date", { length: 10 }).notNull(),
      minutesUsed: integer("minutes_used").default(0).notNull(),
      messagesCount: integer("messages_count").default(0).notNull(),
      lastActivityAt: timestamp("last_activity_at").defaultNow(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    userClonedVoices = pgTable("user_cloned_voices", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      voiceId: varchar("voice_id", { length: 255 }).notNull(),
      voiceName: varchar("voice_name", { length: 255 }).notNull(),
      isActive: boolean("is_active").default(true),
      createdAt: timestamp("created_at").defaultNow()
    });
    payments = pgTable("payments", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      stripePaymentId: varchar("stripe_payment_id", { length: 255 }),
      amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
      currency: varchar("currency", { length: 10 }).default("eur"),
      status: varchar("status", { length: 30 }).default("pending"),
      description: text("description"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    contactMessages = pgTable("contact_messages", {
      id: serial("id").primaryKey(),
      userId: integer("user_id"),
      name: varchar("name", { length: 255 }).notNull(),
      email: varchar("email", { length: 320 }).notNull(),
      subject: varchar("subject", { length: 500 }),
      message: text("message").notNull(),
      aiResponse: text("ai_response"),
      status: varchar("status", { length: 20 }).default("new"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    usersRelations = relations(users, ({ many }) => ({
      conversations: many(conversations),
      usage: many(userUsage)
    }));
    conversationsRelations = relations(conversations, ({ one, many }) => ({
      user: one(users, {
        fields: [conversations.userId],
        references: [users.id]
      }),
      messages: many(messages)
    }));
    messagesRelations = relations(messages, ({ one }) => ({
      conversation: one(conversations, {
        fields: [messages.conversationId],
        references: [conversations.id]
      })
    }));
    userUsageRelations = relations(userUsage, ({ one }) => ({
      user: one(users, {
        fields: [userUsage.userId],
        references: [users.id]
      })
    }));
    dailyUsageRelations = relations(dailyUsage, ({ one }) => ({
      user: one(users, {
        fields: [dailyUsage.userId],
        references: [users.id]
      })
    }));
    chatRoomTypeEnum = pgEnum("chat_room_type", ["direct", "group"]);
    userChatRooms = pgTable("user_chat_rooms", {
      id: serial("id").primaryKey(),
      name: varchar("name", { length: 100 }).notNull(),
      type: chatRoomTypeEnum("type").default("direct").notNull(),
      createdBy: integer("created_by").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull(),
      updatedAt: timestamp("updated_at").defaultNow().notNull()
    });
    userChatParticipants = pgTable("user_chat_participants", {
      id: serial("id").primaryKey(),
      roomId: integer("room_id").notNull(),
      userId: integer("user_id").notNull(),
      joinedAt: timestamp("joined_at").defaultNow().notNull()
    });
    userChatMessages = pgTable("user_chat_messages", {
      id: serial("id").primaryKey(),
      roomId: integer("room_id").notNull(),
      senderId: integer("sender_id").notNull(),
      content: text("content").notNull(),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    voiceLibrary = pgTable("voice_library", {
      id: serial("id").primaryKey(),
      userId: integer("user_id").notNull(),
      name: varchar("name", { length: 100 }).notNull(),
      voiceId: varchar("voice_id", { length: 255 }).notNull(),
      provider: varchar("provider", { length: 50 }).default("elevenlabs").notNull(),
      sampleUrl: text("sample_url"),
      isDefault: boolean("is_default").default(false),
      isPublic: boolean("is_public").default(false),
      quality: varchar("quality", { length: 20 }).default("standard"),
      createdAt: timestamp("created_at").defaultNow().notNull()
    });
    userChatRoomsRelations = relations(userChatRooms, ({ many }) => ({
      participants: many(userChatParticipants),
      messages: many(userChatMessages)
    }));
    userChatParticipantsRelations = relations(userChatParticipants, ({ one }) => ({
      room: one(userChatRooms, { fields: [userChatParticipants.roomId], references: [userChatRooms.id] }),
      user: one(users, { fields: [userChatParticipants.userId], references: [users.id] })
    }));
    userChatMessagesRelations = relations(userChatMessages, ({ one }) => ({
      room: one(userChatRooms, { fields: [userChatMessages.roomId], references: [userChatRooms.id] }),
      sender: one(users, { fields: [userChatMessages.senderId], references: [users.id] })
    }));
    voiceLibraryRelations = relations(voiceLibrary, ({ one }) => ({
      user: one(users, { fields: [voiceLibrary.userId], references: [users.id] })
    }));
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  applyReferralBonus: () => applyReferralBonus,
  closeUserAccount: () => closeUserAccount,
  createConversation: () => createConversation,
  createMessage: () => createMessage,
  createReferralCode: () => createReferralCode,
  createRefundRequest: () => createRefundRequest,
  deleteConversationMessages: () => deleteConversationMessages,
  deleteMessage: () => deleteMessage,
  getAllRefundRequests: () => getAllRefundRequests,
  getConversationById: () => getConversationById,
  getConversationsByUserId: () => getConversationsByUserId,
  getDailyUsage: () => getDailyUsage,
  getDb: () => getDb,
  getMessageById: () => getMessageById,
  getMessagesByConversationId: () => getMessagesByConversationId,
  getReferralByCode: () => getReferralByCode,
  getRefundRequests: () => getRefundRequests,
  getSubscriptionPlans: () => getSubscriptionPlans,
  getTrialStatus: () => getTrialStatus,
  getUserByOpenId: () => getUserByOpenId,
  getUserReferrals: () => getUserReferrals,
  getUserUsage: () => getUserUsage,
  incrementDailyUsage: () => incrementDailyUsage,
  markReferralUsed: () => markReferralUsed,
  updateMessage: () => updateMessage,
  updateRefundStatus: () => updateRefundStatus,
  updateUserLanguage: () => updateUserLanguage,
  updateUserProfilePicture: () => updateUserProfilePicture,
  updateUserUsage: () => updateUserUsage,
  upsertUser: () => upsertUser
});
import { eq, desc, asc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
async function getDb() {
  if (!_db) {
    const url = SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "";
    if (!url || url.startsWith("mysql://")) {
      console.warn("[Database] No PostgreSQL URL configured. Set SUPABASE_DATABASE_URL.");
      return null;
    }
    try {
      const client = postgres(url, {
        ssl: "require",
        max: 10
      });
      _db = drizzle(client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = { openId: user.openId };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId || user.openId === "email_adrianenc11@gmail.com" || user.email === "adrianenc11@gmail.com") {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) values.lastSignedIn = /* @__PURE__ */ new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function getConversationsByUserId(userId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt));
  } catch (error) {
    console.error("[Database] Failed to get conversations:", error);
    return [];
  }
}
async function getConversationById(conversationId) {
  const db = await getDb();
  if (!db) return void 0;
  try {
    const result = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    return result.length > 0 ? result[0] : void 0;
  } catch (error) {
    console.error("[Database] Failed to get conversation:", error);
    return void 0;
  }
}
async function createConversation(userId, title) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(conversations).values({ userId, title, primaryAiModel: "gpt-4" }).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to create conversation:", error);
    throw error;
  }
}
async function getMessagesByConversationId(conversationId) {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt));
  } catch (error) {
    console.error("[Database] Failed to get messages:", error);
    return [];
  }
}
async function createMessage(conversationId, role, content, aiModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const result = await db.insert(messages).values({ conversationId, role, content, aiModel }).returning();
    return result[0];
  } catch (error) {
    console.error("[Database] Failed to create message:", error);
    throw error;
  }
}
async function getSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.isActive, true));
  } catch (error) {
    console.error("[Database] Failed to get subscription plans:", error);
    return [];
  }
}
async function getUserUsage(userId) {
  const db = await getDb();
  if (!db) return void 0;
  try {
    const result = await db.select().from(userUsage).where(eq(userUsage.userId, userId)).limit(1);
    return result.length > 0 ? result[0] : void 0;
  } catch (error) {
    console.error("[Database] Failed to get user usage:", error);
    return void 0;
  }
}
async function updateMessage(messageId, content) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(messages).set({ content }).where(eq(messages.id, messageId));
  return { success: true };
}
async function deleteMessage(messageId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.id, messageId));
  return { success: true };
}
async function getMessageById(messageId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function deleteConversationMessages(conversationId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  return { success: true };
}
async function updateUserProfilePicture(userId, avatarUrl) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));
  return { success: true };
}
async function updateUserLanguage(userId, language) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ language }).where(eq(users.id, userId));
  return { success: true };
}
async function updateUserUsage(userId, messagesThisMonth, voiceMinutesThisMonth) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const usage = await getUserUsage(userId);
  if (usage) {
    await db.update(userUsage).set({ messagesThisMonth, voiceMinutesThisMonth }).where(eq(userUsage.userId, userId));
  } else {
    await db.insert(userUsage).values({ userId, messagesThisMonth, voiceMinutesThisMonth });
  }
}
function generateReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "KEL-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
async function createReferralCode(senderUserId, recipientEmail) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const code = generateReferralCode();
  const expiresAt = /* @__PURE__ */ new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  const result = await db.insert(referralCodes).values({
    code,
    senderUserId,
    recipientEmail,
    expiresAt
  }).returning();
  return result[0];
}
async function getReferralByCode(code) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(referralCodes).where(eq(referralCodes.code, code.toUpperCase())).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function markReferralUsed(codeId, usedByUserId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(referralCodes).set({ usedBy: usedByUserId, usedAt: /* @__PURE__ */ new Date() }).where(eq(referralCodes.id, codeId));
}
async function applyReferralBonus(referralId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const referral = await db.select().from(referralCodes).where(eq(referralCodes.id, referralId)).limit(1);
  if (!referral.length || referral[0].bonusApplied) return;
  const sender = await db.select().from(users).where(eq(users.id, referral[0].senderUserId)).limit(1);
  if (sender.length && sender[0].stripeSubscriptionId) {
    try {
      const Stripe4 = (await import("stripe")).default;
      const stripe4 = new Stripe4(process.env.STRIPE_SECRET_KEY || "");
      const sub = await stripe4.subscriptions.retrieve(sender[0].stripeSubscriptionId);
      if (sub && sub.current_period_end) {
        const newEnd = sub.current_period_end + 5 * 24 * 60 * 60;
        await stripe4.subscriptions.update(sender[0].stripeSubscriptionId, {
          trial_end: newEnd,
          proration_behavior: "none"
        });
        console.log(`[Referral] Extended subscription for user ${sender[0].id} by 5 days via Stripe`);
      }
    } catch (stripeErr) {
      console.error(`[Referral] Stripe extension failed, tracking locally:`, stripeErr);
    }
    await db.update(referralCodes).set({ bonusApplied: true }).where(eq(referralCodes.id, referralId));
    console.log(`[Referral] Bonus +5 days applied for user ${referral[0].senderUserId}`);
  } else if (sender.length) {
    await db.update(referralCodes).set({ bonusApplied: true }).where(eq(referralCodes.id, referralId));
    console.log(`[Referral] Bonus tracked for free user ${referral[0].senderUserId} (will apply on subscription)`);
  }
}
async function getUserReferrals(userId) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(referralCodes).where(eq(referralCodes.senderUserId, userId)).orderBy(desc(referralCodes.createdAt));
}
async function createRefundRequest(userId, stripeSubId, billingCycle, subStartDate, monthsElapsed, refundAmount, reason) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(refundRequests).values({
    userId,
    stripeSubscriptionId: stripeSubId,
    billingCycle,
    subscriptionStartDate: subStartDate,
    monthsElapsed,
    refundAmount,
    status: billingCycle === "monthly" ? "denied" : monthsElapsed >= 3 ? "denied" : "pending",
    reason,
    adminNote: billingCycle === "monthly" ? "Monthly subscriptions are non-refundable." : monthsElapsed >= 3 ? "Refund not available after 3 completed months." : null
  }).returning();
  return result[0];
}
async function getRefundRequests(userId) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(refundRequests).where(eq(refundRequests.userId, userId)).orderBy(desc(refundRequests.createdAt));
}
async function getAllRefundRequests() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(refundRequests).orderBy(desc(refundRequests.createdAt));
}
async function updateRefundStatus(refundId, status, adminNote) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(refundRequests).set({
    status,
    adminNote,
    resolvedAt: /* @__PURE__ */ new Date()
  }).where(eq(refundRequests.id, refundId));
}
function getTodayDate() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
async function getDailyUsage(userId, date) {
  const db = await getDb();
  if (!db) return void 0;
  const d = date || getTodayDate();
  const result = await db.select().from(dailyUsage).where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, d))).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function incrementDailyUsage(userId, addMinutes = 0, addMessages = 1) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const today = getTodayDate();
  const existing = await getDailyUsage(userId, today);
  if (existing) {
    await db.update(dailyUsage).set({
      minutesUsed: (existing.minutesUsed || 0) + addMinutes,
      messagesCount: (existing.messagesCount || 0) + addMessages,
      lastActivityAt: /* @__PURE__ */ new Date()
    }).where(eq(dailyUsage.id, existing.id));
  } else {
    await db.insert(dailyUsage).values({
      userId,
      date: today,
      minutesUsed: addMinutes,
      messagesCount: addMessages,
      lastActivityAt: /* @__PURE__ */ new Date()
    });
  }
}
async function getTrialStatus(userId) {
  const db = await getDb();
  if (!db) return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "Database not available" };
  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userResult.length) return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 10, dailyMessagesCount: 0, canUse: false, reason: "User not found" };
  const user = userResult[0];
  if (user.accountClosed) {
    return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 0, dailyMessagesCount: 0, canUse: false, reason: "Account closed. Contact support for assistance." };
  }
  if (user.role === "admin") {
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }
  if (user.subscriptionTier !== "free") {
    if (user.subscriptionStatus === "cancelled" || user.subscriptionStatus === "past_due") {
      return { isTrialUser: false, trialExpired: true, trialDaysLeft: 0, dailyMinutesUsed: 0, dailyMinutesLimit: 0, dailyMessagesCount: 0, canUse: false, reason: `Subscription ${user.subscriptionStatus === "past_due" ? "payment failed" : "cancelled"}. Please renew to continue.` };
    }
    return { isTrialUser: false, trialExpired: false, trialDaysLeft: 999, dailyMinutesUsed: 0, dailyMinutesLimit: 999, dailyMessagesCount: 0, canUse: true };
  }
  const trialStart = user.trialStartDate || user.createdAt;
  const now = /* @__PURE__ */ new Date();
  const diffMs = now.getTime() - trialStart.getTime();
  const diffDays = Math.floor(diffMs / (1e3 * 60 * 60 * 24));
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
async function closeUserAccount(userId) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({
    accountClosed: true,
    accountClosedAt: /* @__PURE__ */ new Date(),
    subscriptionTier: "free",
    subscriptionStatus: "cancelled",
    stripeSubscriptionId: null
  }).where(eq(users.id, userId));
  console.log(`[Account] User ${userId} account closed after refund`);
}
var _db, SUPABASE_DATABASE_URL;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    init_env();
    _db = null;
    SUPABASE_DATABASE_URL = process.env.SUPABASE_DATABASE_URL || "";
  }
});

// shared/_core/errors.ts
var HttpError, ForbiddenError;
var init_errors = __esm({
  "shared/_core/errors.ts"() {
    "use strict";
    HttpError = class extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = "HttpError";
      }
    };
    ForbiddenError = (msg) => new HttpError(403, msg);
  }
});

// server/_core/sdk.ts
var sdk_exports = {};
__export(sdk_exports, {
  sdk: () => sdk
});
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString2, EXCHANGE_TOKEN_PATH, GET_USER_INFO_PATH, GET_USER_INFO_WITH_JWT_PATH, OAuthService, createOAuthHttpClient, SDKServer, sdk;
var init_sdk = __esm({
  "server/_core/sdk.ts"() {
    "use strict";
    init_const();
    init_errors();
    init_db();
    init_env();
    isNonEmptyString2 = (value) => typeof value === "string" && value.length > 0;
    EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
    GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
    GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
    OAuthService = class {
      constructor(client) {
        this.client = client;
        console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
        if (!ENV.oAuthServerUrl) {
          console.error(
            "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
          );
        }
      }
      decodeState(state) {
        const redirectUri = atob(state);
        return redirectUri;
      }
      async getTokenByCode(code, state) {
        const payload = {
          clientId: ENV.appId,
          grantType: "authorization_code",
          code,
          redirectUri: this.decodeState(state)
        };
        const { data } = await this.client.post(
          EXCHANGE_TOKEN_PATH,
          payload
        );
        return data;
      }
      async getUserInfoByToken(token) {
        const { data } = await this.client.post(
          GET_USER_INFO_PATH,
          {
            accessToken: token.accessToken
          }
        );
        return data;
      }
    };
    createOAuthHttpClient = () => axios.create({
      baseURL: ENV.oAuthServerUrl,
      timeout: AXIOS_TIMEOUT_MS
    });
    SDKServer = class {
      client;
      oauthService;
      constructor(client = createOAuthHttpClient()) {
        this.client = client;
        this.oauthService = new OAuthService(this.client);
      }
      deriveLoginMethod(platforms, fallback) {
        if (fallback && fallback.length > 0) return fallback;
        if (!Array.isArray(platforms) || platforms.length === 0) return null;
        const set = new Set(
          platforms.filter((p) => typeof p === "string")
        );
        if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
        if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
        if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
        if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
          return "microsoft";
        if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
        const first = Array.from(set)[0];
        return first ? first.toLowerCase() : null;
      }
      /**
       * Exchange OAuth authorization code for access token
       * @example
       * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
       */
      async exchangeCodeForToken(code, state) {
        return this.oauthService.getTokenByCode(code, state);
      }
      /**
       * Get user information using access token
       * @example
       * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
       */
      async getUserInfo(accessToken) {
        const data = await this.oauthService.getUserInfoByToken({
          accessToken
        });
        const loginMethod = this.deriveLoginMethod(
          data?.platforms,
          data?.platform ?? data.platform ?? null
        );
        return {
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      parseCookies(cookieHeader) {
        if (!cookieHeader) {
          return /* @__PURE__ */ new Map();
        }
        const parsed = parseCookieHeader(cookieHeader);
        return new Map(Object.entries(parsed));
      }
      getSessionSecret() {
        const secret = ENV.cookieSecret;
        return new TextEncoder().encode(secret);
      }
      /**
       * Create a session token for a Manus user openId
       * @example
       * const sessionToken = await sdk.createSessionToken(userInfo.openId);
       */
      async createSessionToken(openId, options = {}) {
        return this.signSession(
          {
            openId,
            appId: ENV.appId,
            name: options.name || ""
          },
          options
        );
      }
      async signSession(payload, options = {}) {
        const issuedAt = Date.now();
        const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
        const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
        const secretKey = this.getSessionSecret();
        return new SignJWT({
          openId: payload.openId,
          appId: payload.appId,
          name: payload.name
        }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
      }
      async verifySession(cookieValue) {
        if (!cookieValue) {
          console.warn("[Auth] Missing session cookie");
          return null;
        }
        try {
          const secretKey = this.getSessionSecret();
          const { payload } = await jwtVerify(cookieValue, secretKey, {
            algorithms: ["HS256"]
          });
          const { openId, appId, name } = payload;
          if (!isNonEmptyString2(openId) || !isNonEmptyString2(appId) || !isNonEmptyString2(name)) {
            console.warn("[Auth] Session payload missing required fields");
            return null;
          }
          return {
            openId,
            appId,
            name
          };
        } catch (error) {
          console.warn("[Auth] Session verification failed", String(error));
          return null;
        }
      }
      async getUserInfoWithJwt(jwtToken) {
        const payload = {
          jwtToken,
          projectId: ENV.appId
        };
        const { data } = await this.client.post(
          GET_USER_INFO_WITH_JWT_PATH,
          payload
        );
        const loginMethod = this.deriveLoginMethod(
          data?.platforms,
          data?.platform ?? data.platform ?? null
        );
        return {
          ...data,
          platform: loginMethod,
          loginMethod
        };
      }
      async authenticateRequest(req) {
        const cookies = this.parseCookies(req.headers.cookie);
        const sessionCookie = cookies.get(COOKIE_NAME);
        const session = await this.verifySession(sessionCookie);
        if (!session) {
          throw ForbiddenError("Invalid session cookie");
        }
        const sessionUserId = session.openId;
        const signedInAt = /* @__PURE__ */ new Date();
        let user = await getUserByOpenId(sessionUserId);
        if (!user) {
          try {
            const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
            await upsertUser({
              openId: userInfo.openId,
              name: userInfo.name || null,
              email: userInfo.email ?? null,
              loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
              lastSignedIn: signedInAt
            });
            user = await getUserByOpenId(userInfo.openId);
          } catch (error) {
            console.error("[Auth] Failed to sync user from OAuth:", error);
            throw ForbiddenError("Failed to sync user info");
          }
        }
        if (!user) {
          throw ForbiddenError("User not found");
        }
        await upsertUser({
          openId: user.openId,
          lastSignedIn: signedInAt
        });
        return user;
      }
    };
    sdk = new SDKServer();
  }
});

// server/_core/oauth.ts
var oauth_exports = {};
__export(oauth_exports, {
  registerOAuthRoutes: () => registerOAuthRoutes
});
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
var init_oauth = __esm({
  "server/_core/oauth.ts"() {
    "use strict";
    init_const();
    init_db();
    init_cookies();
    init_sdk();
  }
});

// server/standalone-auth.ts
var standalone_auth_exports = {};
__export(standalone_auth_exports, {
  authenticateRequestStandalone: () => authenticateRequestStandalone,
  registerStandaloneAuthRoutes: () => registerStandaloneAuthRoutes,
  verifySessionStandalone: () => verifySessionStandalone
});
import bcrypt from "bcryptjs";
import { SignJWT as SignJWT2, jwtVerify as jwtVerify2 } from "jose";
import { eq as eq5 } from "drizzle-orm";
function getJwtSecret() {
  const secret = process.env.JWT_SECRET || "kelionai-default-secret-change-me";
  return new TextEncoder().encode(secret);
}
async function createSessionToken(user) {
  const secretKey = getJwtSecret();
  return new SignJWT2({
    openId: user.openId,
    appId: "kelionai",
    name: user.name || "",
    userId: user.id
  }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(Math.floor((Date.now() + ONE_YEAR_MS) / 1e3)).sign(secretKey);
}
async function verifySessionStandalone(cookieValue) {
  if (!cookieValue) return null;
  try {
    const secretKey = getJwtSecret();
    const { payload } = await jwtVerify2(cookieValue, secretKey, { algorithms: ["HS256"] });
    const { openId, appId, name } = payload;
    if (typeof openId !== "string" || !openId) return null;
    return { openId, appId: appId || "kelionai", name: name || "" };
  } catch {
    return null;
  }
}
async function authenticateRequestStandalone(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) throw new Error("No cookies");
  const cookies = /* @__PURE__ */ new Map();
  cookieHeader.split(";").forEach((c) => {
    const [key, ...rest] = c.trim().split("=");
    if (key) cookies.set(key, rest.join("="));
  });
  const sessionCookie = cookies.get(COOKIE_NAME);
  const session = await verifySessionStandalone(sessionCookie);
  if (!session) throw new Error("Invalid session");
  const user = await getUserByOpenId(session.openId);
  if (!user) throw new Error("User not found");
  return user;
}
function registerStandaloneAuthRoutes(app) {
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }
      const dbInstance = await getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const existing = await dbInstance.select().from(users).where(eq5(users.email, email)).limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const openId = `email_${email}`;
      await upsertUser({
        openId,
        name: name || email.split("@")[0],
        email,
        loginMethod: "email",
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      await dbInstance.update(users).set({ passwordHash }).where(eq5(users.openId, openId));
      const user = await getUserByOpenId(openId);
      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Register failed:", error);
      const errMsg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: "Registration failed", detail: errMsg });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }
      const dbInstance = await getDb();
      if (!dbInstance) {
        res.status(500).json({ error: "Database not available" });
        return;
      }
      const result = await dbInstance.select().from(users).where(eq5(users.email, email)).limit(1);
      if (result.length === 0) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      const user = result[0];
      if (!user.passwordHash) {
        res.status(401).json({ error: "This account uses social login. Please use the original login method." });
        return;
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      await upsertUser({ openId: user.openId, lastSignedIn: /* @__PURE__ */ new Date() });
      const sessionToken = await createSessionToken(user);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
  app.get("/api/oauth/callback", async (req, res) => {
    const oauthServerUrl = process.env.OAUTH_SERVER_URL;
    if (oauthServerUrl) {
      try {
        const { registerOAuthRoutes: registerOAuthRoutes2 } = await Promise.resolve().then(() => (init_oauth(), oauth_exports));
        res.redirect("/");
      } catch {
        res.redirect("/login");
      }
    } else {
      res.redirect("/login");
    }
  });
}
var SALT_ROUNDS;
var init_standalone_auth = __esm({
  "server/standalone-auth.ts"() {
    "use strict";
    init_const();
    init_cookies();
    init_db();
    init_schema();
    SALT_ROUNDS = 12;
  }
});

// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/routers.ts
init_const();
init_cookies();

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
init_env();
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
init_const();
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers/chat.ts
import { z as z2 } from "zod";
init_db();

// server/_core/llm.ts
init_env();
var ensureArray = (value) => Array.isArray(value) ? value : [value];
var normalizeContentPart = (part) => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") {
    return part;
  }
  if (part.type === "image_url") {
    return part;
  }
  if (part.type === "file_url") {
    return part;
  }
  throw new Error("Unsupported message content part");
};
var normalizeMessage = (message) => {
  const { role, name, tool_call_id } = message;
  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content).map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\n");
    return {
      role,
      name,
      tool_call_id,
      content
    };
  }
  const contentParts = ensureArray(message.content).map(normalizeContentPart);
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text
    };
  }
  return {
    role,
    name,
    content: contentParts
  };
};
var normalizeToolChoice = (toolChoice, tools) => {
  if (!toolChoice) return void 0;
  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }
  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }
    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }
    return {
      type: "function",
      function: { name: tools[0].function.name }
    };
  }
  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name }
    };
  }
  return toolChoice;
};
var resolveApiUrl = () => {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions";
};
var getApiKey = () => {
  if (ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0) {
    return ENV.forgeApiKey;
  }
  if (ENV.openaiApiKey && ENV.openaiApiKey.trim().length > 0) {
    return ENV.openaiApiKey;
  }
  throw new Error("No API key configured. Set OPENAI_API_KEY or BUILT_IN_FORGE_API_KEY.");
};
var getModelName = () => {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    return "gemini-2.5-flash";
  }
  return "gpt-4o";
};
var normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema
}) => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }
  const schema = outputSchema || output_schema;
  if (!schema) return void 0;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...typeof schema.strict === "boolean" ? { strict: schema.strict } : {}
    }
  };
};
async function invokeLLM(params) {
  const apiKey = getApiKey();
  const {
    messages: messages2,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format
  } = params;
  const payload = {
    model: getModelName(),
    messages: messages2.map(normalizeMessage)
  };
  if (tools && tools.length > 0) {
    payload.tools = tools;
  }
  const normalizedToolChoice = normalizeToolChoice(
    toolChoice || tool_choice,
    tools
  );
  if (normalizedToolChoice) {
    payload.tool_choice = normalizedToolChoice;
  }
  payload.max_tokens = 32768;
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    payload.thinking = {
      "budget_tokens": 128
    };
  }
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema
  });
  if (normalizedResponseFormat) {
    payload.response_format = normalizedResponseFormat;
  }
  const response = await fetch(resolveApiUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} \u2013 ${errorText}`
    );
  }
  return await response.json();
}

// server/brain-v4.ts
init_env();

// server/characters.ts
var CHARACTERS = {
  kelion: {
    name: "kelion",
    displayName: "Kelion",
    personality: "Serious, technical, analytical, friendly. A reliable expert who explains things clearly.",
    voiceStyle: "Calm, confident, measured pace",
    traits: ["analytical", "precise", "patient", "knowledgeable", "protective"],
    greeting: "Hello! I'm Kelion, your AI assistant. How can I help you today?",
    systemPrompt: `You are Kelion, a serious and analytical AI assistant. You are:
- Technical and precise in your explanations
- Patient and thorough - you take time to explain things properly
- Protective of users - you warn about dangers and risks
- Honest - you NEVER make up information. If you don't know, say "I don't know"
- Friendly but professional in tone
- You adapt your language level to match the user's level
- For visually impaired users: you describe everything in detail
- For children: you use simple, safe language
- You ALWAYS recommend specialists for medical, legal, or financial questions`
  },
  kira: {
    name: "kira",
    displayName: "Kira",
    personality: "Warm, creative, empathetic, energetic. A caring friend who makes learning fun.",
    voiceStyle: "Warm, enthusiastic, expressive",
    traits: ["empathetic", "creative", "encouraging", "playful", "supportive"],
    greeting: "Hi there! I'm Kira! I'm so happy to meet you! What would you like to explore today?",
    systemPrompt: `You are Kira, a warm and creative AI assistant. You are:
- Empathetic and caring - you understand how people feel
- Creative and fun - you make learning enjoyable
- Encouraging - you celebrate progress and effort
- Honest - you NEVER make up information. If you don't know, say "I'm not sure about that"
- Warm and friendly in tone, like a good friend
- You adapt your language level to match the user's level
- For visually impaired users: you paint vivid word pictures of everything
- For children: you're playful, use simple words, and keep things safe
- You ALWAYS recommend specialists for medical, legal, or financial questions`
  }
};
function detectUserLevel(message) {
  const words = message.split(/\s+/);
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
  const hasTechnicalTerms = /\b(algorithm|function|API|database|server|compile|runtime|async|protocol|framework|repository|deployment)\b/i.test(message);
  const hasAcademicTerms = /\b(hypothesis|methodology|empirical|theoretical|paradigm|ontology|epistemology|dissertation|synthesis)\b/i.test(message);
  const hasSimpleLanguage = /\b(hi|hello|hey|cool|nice|ok|yeah|yep|nope|lol|haha|pls|plz|thx)\b/i.test(message);
  const hasChildLanguage = /\b(mommy|daddy|please help|i don't understand|what is a|can you explain)\b/i.test(message);
  if (hasChildLanguage || avgWordLength < 4 && words.length < 10) return "child";
  if (hasAcademicTerms) return "academic";
  if (hasTechnicalTerms) return "technical";
  if (hasSimpleLanguage) return "casual";
  if (avgWordLength > 5) return "professional";
  return "casual";
}
function getLevelPrompt(level) {
  const prompts = {
    child: "\n\nIMPORTANT: The user is a child or communicates simply. Use very simple words, short sentences. Explain like talking to an 8-year-old.",
    casual: "\n\nThe user communicates casually. Be friendly and conversational. Keep explanations clear.",
    professional: "\n\nThe user communicates professionally. Be clear, structured, and efficient.",
    academic: "\n\nThe user communicates at an academic level. Use sophisticated vocabulary and provide in-depth analysis.",
    technical: "\n\nThe user is technically proficient. Use technical terminology freely. Provide code examples and precise specs."
  };
  return prompts[level];
}
var ANTI_HALLUCINATION_RULES = `

CRITICAL RULES (NEVER BREAK THESE):
1. NEVER invent facts, data, statistics, or URLs. If you don't know, say "I don't know".
2. For weather, dates, calculations - use the appropriate tool, don't guess.
3. For medical/legal/financial questions - ALWAYS say "Please consult a specialist".
4. If not confident, say so: "I think... but I'm not 100% sure".
5. NEVER pretend to have capabilities you don't have.
6. If you don't understand, ask for clarification instead of guessing.
7. For children and vulnerable users: zero speculation, extra clarity.`;
function buildSystemPrompt(character, level, language) {
  const char = CHARACTERS[character];
  let prompt = char.systemPrompt;
  prompt += getLevelPrompt(level);
  prompt += ANTI_HALLUCINATION_RULES;
  if (language && language !== "en") {
    prompt += `

Respond in the user's language: ${language}.`;
  }
  prompt += "\n\nAlways respond in the same language the user writes in.";
  return prompt;
}

// server/elevenlabs.ts
init_env();

// server/storage.ts
init_env();
import path from "path";
import fs from "fs";
function getManusStorageConfig() {
  const baseUrl = ENV.forgeApiUrl;
  const apiKey = ENV.forgeApiKey;
  if (!baseUrl || !apiKey) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function buildAuthHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}
function buildUploadUrl(baseUrl, relKey) {
  const url = new URL("v1/storage/upload", ensureTrailingSlash(baseUrl));
  url.searchParams.set("path", normalizeKey(relKey));
  return url;
}
function toFormData(data, contentType, fileName) {
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const form = new FormData();
  form.append("file", blob, fileName || "file");
  return form;
}
var LOCAL_STORAGE_DIR = path.resolve(process.cwd(), "uploads");
function ensureLocalStorageDir() {
  if (!fs.existsSync(LOCAL_STORAGE_DIR)) {
    fs.mkdirSync(LOCAL_STORAGE_DIR, { recursive: true });
  }
}
function getServerBaseUrl() {
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    return `https://${railwayDomain}`;
  }
  const customDomain = process.env.DOMAIN;
  if (customDomain) {
    return customDomain.startsWith("http") ? customDomain : `https://${customDomain}`;
  }
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const manusConfig = getManusStorageConfig();
  if (manusConfig) {
    const key2 = normalizeKey(relKey);
    const uploadUrl = buildUploadUrl(manusConfig.baseUrl, key2);
    const formData = toFormData(data, contentType, key2.split("/").pop() ?? key2);
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: buildAuthHeaders(manusConfig.apiKey),
      body: formData
    });
    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(
        `Storage upload failed (${response.status} ${response.statusText}): ${message}`
      );
    }
    const url2 = (await response.json()).url;
    return { key: key2, url: url2 };
  }
  const s3Bucket = process.env.S3_BUCKET;
  const s3Region = process.env.S3_REGION || "us-east-1";
  const awsAccessKey = process.env.AWS_ACCESS_KEY_ID;
  const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (s3Bucket && awsAccessKey && awsSecretKey) {
    const key2 = normalizeKey(relKey);
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: s3Region,
      credentials: { accessKeyId: awsAccessKey, secretAccessKey: awsSecretKey }
    });
    const buffer2 = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
    await s3.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key2,
      Body: buffer2,
      ContentType: contentType
    }));
    const url2 = `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key2}`;
    return { key: key2, url: url2 };
  }
  ensureLocalStorageDir();
  const key = normalizeKey(relKey);
  const filePath = path.join(LOCAL_STORAGE_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  const baseUrl = getServerBaseUrl();
  const url = `${baseUrl}/uploads/${key}`;
  return { key, url };
}

// server/elevenlabs.ts
var ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";
function getHeaders() {
  return {
    "xi-api-key": ENV.elevenLabsApiKey,
    "Content-Type": "application/json"
  };
}
async function generateSpeech(params) {
  const { text: text2, avatar, voiceId, quality = "high", language } = params;
  const resolvedVoiceId = voiceId || (avatar === "kelion" ? ENV.elevenLabsVoiceKelion : ENV.elevenLabsVoiceKira);
  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }
  const response = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${resolvedVoiceId}`,
    {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        text: text2.slice(0, 5e3),
        // ElevenLabs limit
        model_id: quality === "ultra" ? "eleven_multilingual_v2" : quality === "high" ? "eleven_multilingual_v2" : "eleven_turbo_v2_5",
        voice_settings: {
          stability: quality === "ultra" ? 0.7 : 0.5,
          similarity_boost: quality === "ultra" ? 0.9 : 0.75,
          style: quality === "ultra" ? 0.5 : 0.3,
          use_speaker_boost: quality !== "standard"
        },
        ...language ? { language_code: language } : {}
      })
    }
  );
  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] TTS error:", err);
    throw new Error(`ElevenLabs TTS failed: ${response.status}`);
  }
  const audioBuffer = Buffer.from(new Uint8Array(await response.arrayBuffer()));
  let url;
  try {
    const timestamp2 = Date.now();
    const randomSuffix2 = Math.random().toString(36).slice(2, 8);
    const fileKey = `tts/${avatar}-${timestamp2}-${randomSuffix2}.mp3`;
    const result = await storagePut(fileKey, audioBuffer, "audio/mpeg");
    if (result.url && !result.url.includes("localhost")) {
      url = result.url;
    } else {
      url = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
    }
  } catch (e) {
    console.warn("[ElevenLabs] Storage failed, using base64 fallback:", e);
    url = `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
  }
  const estimatedDuration = Math.ceil(text2.length / 750 * 60);
  return { audioUrl: url, duration: estimatedDuration };
}
async function cloneVoice(params) {
  const { audioBuffer, name, description } = params;
  if (!ENV.elevenLabsApiKey) {
    throw new Error("ElevenLabs API key not configured");
  }
  const formData = new FormData();
  formData.append("name", name);
  formData.append(
    "description",
    description || `Cloned voice for ${name} on KelionAI`
  );
  formData.append(
    "files",
    new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" }),
    "recording.webm"
  );
  const response = await fetch(`${ELEVENLABS_BASE}/voices/add`, {
    method: "POST",
    headers: {
      "xi-api-key": ENV.elevenLabsApiKey
    },
    body: formData
  });
  if (!response.ok) {
    const err = await response.text();
    console.error("[ElevenLabs] Voice cloning error:", err);
    throw new Error(`Voice cloning failed: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return { voiceId: data.voice_id, name };
}
async function deleteClonedVoice(voiceId) {
  if (!ENV.elevenLabsApiKey) return false;
  const response = await fetch(`${ELEVENLABS_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: getHeaders()
  });
  return response.ok;
}
async function getElevenLabsUsage() {
  if (!ENV.elevenLabsApiKey) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }
  const response = await fetch(`${ELEVENLABS_BASE}/user`, {
    headers: getHeaders()
  });
  if (!response.ok) {
    return { characterCount: 0, characterLimit: 0, canClone: false };
  }
  const data = await response.json();
  return {
    characterCount: data.subscription.character_count,
    characterLimit: data.subscription.character_limit,
    canClone: data.subscription.can_use_instant_voice_cloning
  };
}

// server/brain-v4.ts
var BRAIN_TOOLS = [
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the internet for real, current information.",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
    }
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get real weather data for a location.",
      parameters: { type: "object", properties: { location: { type: "string" } }, required: ["location"] }
    }
  },
  {
    type: "function",
    function: {
      name: "generate_code",
      description: "Generate code in any programming language.",
      parameters: { type: "object", properties: { language: { type: "string" }, task: { type: "string" } }, required: ["language", "task"] }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_image",
      description: "Analyze an image using AI vision for visually impaired users.",
      parameters: { type: "object", properties: { imageUrl: { type: "string" }, question: { type: "string" } }, required: ["imageUrl"] }
    }
  },
  {
    type: "function",
    function: {
      name: "do_math",
      description: "Perform mathematical calculations accurately.",
      parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] }
    }
  },
  {
    type: "function",
    function: {
      name: "translate_text",
      description: "Translate text between languages.",
      parameters: { type: "object", properties: { text: { type: "string" }, targetLanguage: { type: "string" } }, required: ["text", "targetLanguage"] }
    }
  }
];
async function executeSearchWeb(query) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1`);
    if (!res.ok) return `Search failed: ${res.status}`;
    const data = await res.json();
    const parts = [];
    if (data.AbstractText) parts.push(data.AbstractText);
    if (data.Answer) parts.push(data.Answer);
    if (data.RelatedTopics?.length) {
      parts.push("Related: " + data.RelatedTopics.slice(0, 3).map((t2) => t2.Text).filter(Boolean).join("; "));
    }
    if (!parts.length) {
      const wikiRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
      if (wikiRes.ok) {
        const w = await wikiRes.json();
        if (w.extract) return `[Wikipedia] ${w.extract}`;
      }
      return "No results found. I cannot verify this information.";
    }
    return parts.join("\n");
  } catch {
    return "Search temporarily unavailable.";
  }
}
async function executeGetWeather(location) {
  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`);
    if (!geoRes.ok) return "Could not find location.";
    const geo = await geoRes.json();
    if (!geo.results?.length) return `Could not find: ${location}`;
    const { latitude, longitude, name, country } = geo.results[0];
    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`);
    if (!wRes.ok) return "Weather service unavailable.";
    const w = await wRes.json();
    const codes = { 0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Foggy", 51: "Light drizzle", 61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 95: "Thunderstorm" };
    return `[VERIFIED] Weather in ${name}, ${country}: ${w.current.temperature_2m}C, ${codes[w.current.weather_code] || "Unknown"}, Humidity: ${w.current.relative_humidity_2m}%, Wind: ${w.current.wind_speed_10m} km/h`;
  } catch {
    return "Weather service unavailable.";
  }
}
async function executeGenerateCode(language, task) {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Expert ${language} programmer. Write clean code only.` }, { role: "user", content: task }] });
  return r.choices?.[0]?.message?.content || "Could not generate code.";
}
async function executeAnalyzeImage(imageUrl, question) {
  try {
    const prompt = question ? `Describe this image in detail for a visually impaired person. Also answer: ${question}` : "Describe this image in complete detail for a visually impaired person. Include objects, positions, colors, text, people, scene, mood, and any hazards.";
    if (ENV.openaiApiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${ENV.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] }], max_tokens: 1e3 })
      });
      if (res.ok) {
        const data = await res.json();
        return `[VISION] ${data.choices[0].message.content}`;
      }
    }
    const r = await invokeLLM({ messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: imageUrl } }] }] });
    return `[VISION] ${r.choices?.[0]?.message?.content || "Could not analyze image."}`;
  } catch {
    return "Image analysis unavailable.";
  }
}
async function executeDoMath(expression) {
  const r = await invokeLLM({ messages: [{ role: "system", content: "Precise mathematician. Solve step by step. Double-check." }, { role: "user", content: expression }] });
  return `[CALCULATED] ${r.choices?.[0]?.message?.content || "Could not solve."}`;
}
async function executeTranslate(text2, targetLanguage) {
  const r = await invokeLLM({ messages: [{ role: "system", content: `Translate to ${targetLanguage}. Output only the translation.` }, { role: "user", content: text2 }] });
  return r.choices?.[0]?.message?.content || "Translation failed.";
}
async function executeTool(name, args) {
  switch (name) {
    case "search_web":
      return executeSearchWeb(args.query);
    case "get_weather":
      return executeGetWeather(args.location);
    case "generate_code":
      return executeGenerateCode(args.language, args.task);
    case "analyze_image":
      return executeAnalyzeImage(args.imageUrl, args.question);
    case "do_math":
      return executeDoMath(args.expression);
    case "translate_text":
      return executeTranslate(args.text, args.targetLanguage);
    default:
      return `Unknown tool: ${name}`;
  }
}
function detectLanguage(text2) {
  if (/\b(sunt|este|vreau|cum|unde|care|pentru|foarte|bine|salut|buna|multumesc)\b/i.test(text2)) return "Romanian";
  if (/\b(hola|como|donde|quiero|para|muy|bien|gracias)\b/i.test(text2)) return "Spanish";
  if (/\b(bonjour|comment|merci|je suis|oui|non)\b/i.test(text2)) return "French";
  if (/\b(hallo|danke|bitte|ich bin|wie|wo)\b/i.test(text2)) return "German";
  return "English";
}
function isVoiceCloningRequest(message) {
  return [/clone?\s*(my|the|a)?\s*voice/i, /cloneaz[aă]\s*(vocea|voce)/i, /vreau\s*s[aă]\s*(mi|imi)\s*clonez/i, /voice\s*clon/i, /copy\s*my\s*voice/i, /record\s*my\s*voice/i].some((p) => p.test(message));
}
async function processBrainMessage(params) {
  const { message, history, character, userId, userName, imageUrl } = params;
  const userLevel = detectUserLevel(message);
  const language = detectLanguage(message);
  if (isVoiceCloningRequest(message)) {
    const isRo = language === "Romanian";
    return {
      content: isRo ? "Hai sa-ti clonam vocea! Urmeaza pasii de pe ecran." : "Let's clone your voice! Follow the steps on screen.",
      toolsUsed: ["start_voice_cloning"],
      confidence: "verified",
      userLevel,
      language,
      voiceCloningStep: {
        step: 1,
        totalSteps: 5,
        title: isRo ? "Pas 1/5: Pregatire" : "Step 1/5: Preparation",
        description: isRo ? "Pregateste-te sa citesti textul de mai jos cu voce tare. Asigura-te ca esti intr-un loc linistit." : "Get ready to read the text below out loud. Make sure you're in a quiet place.",
        action: "show_text",
        sampleText: isRo ? "Buna ziua! Ma numesc si aceasta este vocea mea. Astazi este o zi frumoasa si sunt bucuros sa pot vorbi cu tine. Inteligenta artificiala ne ajuta sa comunicam mai bine si sa invatam lucruri noi in fiecare zi. Multumesc ca esti aici!" : "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. Thank you for being here!"
      }
    };
  }
  const systemPrompt = buildSystemPrompt(character, userLevel, language);
  const llmMessages = [{ role: "system", content: systemPrompt }];
  for (const msg of history.slice(-20)) llmMessages.push({ role: msg.role, content: msg.content });
  if (imageUrl) {
    llmMessages.push({ role: "user", content: [{ type: "text", text: message || "Describe this image in detail." }, { type: "image_url", image_url: { url: imageUrl, detail: "high" } }] });
  } else {
    llmMessages.push({ role: "user", content: message });
  }
  const toolsUsed = [];
  let confidence = "high";
  let finalContent = "";
  try {
    const response = await invokeLLM({ messages: llmMessages, tools: BRAIN_TOOLS, tool_choice: "auto" });
    const choice = response.choices?.[0];
    if (!choice) return { content: "I'm sorry, I couldn't process that. Please try again.", toolsUsed: [], confidence: "low", userLevel, language };
    if (choice.message?.tool_calls?.length) {
      const toolResults = [];
      for (const tc of choice.message.tool_calls) {
        const fnName = tc.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(tc.function.arguments);
        } catch {
          fnArgs = {};
        }
        toolsUsed.push(fnName);
        toolResults.push(`[Tool: ${fnName}] ${await executeTool(fnName, fnArgs)}`);
      }
      if (toolsUsed.some((t2) => ["get_weather", "do_math"].includes(t2))) confidence = "verified";
      const followUp = [...llmMessages, { role: "assistant", content: choice.message.content || "" }, { role: "user", content: `Tool results:
${toolResults.join("\n")}

Provide a natural response based on these results. If data says [VERIFIED], present confidently.` }];
      const final = await invokeLLM({ messages: followUp });
      finalContent = final.choices?.[0]?.message?.content || toolResults.join("\n");
    } else {
      finalContent = choice.message?.content || "I couldn't generate a response.";
    }
  } catch (error) {
    console.error("[Brain v4] Error:", error?.message || error);
    finalContent = `I'm experiencing a temporary issue: ${error?.message || "Unknown error"}. Please try again.`;
    confidence = "low";
  }
  let audioUrl;
  if (ENV.elevenLabsApiKey && finalContent.length > 0 && finalContent.length < 3e3) {
    try {
      const cleanText = finalContent.replace(/\[.*?\]/g, "").replace(/```[\s\S]*?```/g, "code block").replace(/[#*_~`]/g, "");
      const tts = await generateSpeech({ text: cleanText, avatar: character });
      audioUrl = tts.audioUrl;
    } catch (e) {
      console.error("[Brain v4] TTS error:", e);
    }
  }
  return { content: finalContent, toolsUsed, confidence, userLevel, language, audioUrl };
}
async function processVoiceCloningStep(params) {
  const { step, userId, userName, audioBuffer } = params;
  switch (step) {
    case 1:
      return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Get ready to read the text below out loud in a quiet place.", action: "show_text", sampleText: "Hello! My name is and this is my voice. Today is a beautiful day and I am happy to talk to you. Artificial intelligence helps us communicate better and learn new things every day. I enjoy reading books, watching movies, and spending time with friends. Thank you for being here and listening to me!" };
    case 2:
      return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Press record and read the text above clearly. Speak naturally. 30-60 seconds.", action: "record_audio" };
    case 3:
      return { step: 3, totalSteps: 5, title: "Step 3/5: Processing", description: "Your voice is being processed by ElevenLabs AI...", action: "processing" };
    case 4:
      if (!audioBuffer) return { step: 2, totalSteps: 5, title: "Step 2/5: Recording", description: "Audio missing. Please record again.", action: "record_audio" };
      try {
        const result = await cloneVoice({ audioBuffer, name: `${userName}-kelionai-${userId}` });
        return { step: 4, totalSteps: 5, title: "Step 4/5: Voice Cloned!", description: `Your voice has been cloned successfully! Would you like to save it?`, action: "confirm", voiceId: result.voiceId };
      } catch (error) {
        console.error("[Voice Cloning] Error:", error);
        return { step: 2, totalSteps: 5, title: "Cloning Failed", description: "Please try recording again with clearer audio.", action: "record_audio" };
      }
    case 5:
      return { step: 5, totalSteps: 5, title: "Step 5/5: Complete!", description: "Your cloned voice has been saved! The AI will now respond using your voice.", action: "done" };
    default:
      return { step: 1, totalSteps: 5, title: "Step 1/5: Preparation", description: "Let's start voice cloning.", action: "show_text" };
  }
}
function getBrainDiagnostics() {
  return {
    version: "v4.0",
    features: ["Function calling", "Anti-hallucination", "User level detection", "Multi-language", "ElevenLabs TTS", "Voice cloning from chat", "GPT-4o vision", "Real weather API", "Real web search", "Code generation", "Math", "Translation"],
    tools: BRAIN_TOOLS.map((t2) => t2.function.name),
    characters: ["kelion", "kira"],
    antiHallucination: true,
    voiceCloning: true
  };
}

// server/routers/chat.ts
var chatRouter = router({
  listConversations: protectedProcedure.query(async ({ ctx }) => {
    return await getConversationsByUserId(ctx.user.id);
  }),
  getConversation: protectedProcedure.input(z2.object({ conversationId: z2.number() })).query(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    const messages2 = await getMessagesByConversationId(input.conversationId);
    return { conversation, messages: messages2 };
  }),
  createConversation: protectedProcedure.input(z2.object({ title: z2.string().optional(), avatar: z2.string().optional() })).mutation(async ({ ctx, input }) => {
    const title = input.title || `Chat - ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`;
    return await createConversation(ctx.user.id, title);
  }),
  sendMessage: protectedProcedure.input(
    z2.object({
      conversationId: z2.number().optional(),
      message: z2.string(),
      avatar: z2.enum(["kelion", "kira"]).optional(),
      imageUrl: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    let conversationId = input.conversationId;
    const avatar = input.avatar || "kelion";
    if (!conversationId) {
      const title = input.message.slice(0, 50) + (input.message.length > 50 ? "..." : "");
      const result = await createConversation(ctx.user.id, title);
      conversationId = result?.id || result[0]?.id;
      if (!conversationId) throw new Error("Failed to create conversation");
    }
    const conversation = await getConversationById(conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    const trialStatus = await getTrialStatus(ctx.user.id);
    if (!trialStatus.canUse) {
      throw new Error(trialStatus.reason || "Usage limit reached. Please upgrade.");
    }
    await createMessage(conversationId, "user", input.message);
    const dbMessages = await getMessagesByConversationId(conversationId);
    const history = dbMessages.map((m) => ({
      role: m.role,
      content: m.content || ""
    }));
    const brainResult = await processBrainMessage({
      message: input.message,
      history,
      character: avatar,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      imageUrl: input.imageUrl
    });
    await createMessage(conversationId, "assistant", brainResult.content, "brain-v4");
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
      voiceCloningStep: brainResult.voiceCloningStep
    };
  }),
  // Voice cloning step processor
  voiceCloningStep: protectedProcedure.input(
    z2.object({
      step: z2.number(),
      audioBase64: z2.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    let audioBuffer;
    if (input.audioBase64) {
      audioBuffer = Buffer.from(input.audioBase64, "base64");
    }
    const result = await processVoiceCloningStep({
      step: input.step,
      userId: ctx.user.id,
      userName: ctx.user.name || "User",
      audioBuffer
    });
    return result;
  }),
  getMessages: protectedProcedure.input(z2.object({ conversationId: z2.number() })).query(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    return await getMessagesByConversationId(input.conversationId);
  }),
  deleteConversation: protectedProcedure.input(z2.object({ conversationId: z2.number() })).mutation(async ({ ctx, input }) => {
    const conversation = await getConversationById(input.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Conversation not found or access denied");
    }
    await deleteConversationMessages(input.conversationId);
    return { success: true };
  }),
  editMessage: protectedProcedure.input(z2.object({ messageId: z2.number(), content: z2.string().min(1) })).mutation(async ({ ctx, input }) => {
    const msg = await getMessageById(input.messageId);
    if (!msg) throw new Error("Message not found");
    const conversation = await getConversationById(msg.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Access denied");
    }
    if (msg.role !== "user") throw new Error("Can only edit your own messages");
    await updateMessage(input.messageId, input.content);
    return { success: true };
  }),
  deleteMessage: protectedProcedure.input(z2.object({ messageId: z2.number() })).mutation(async ({ ctx, input }) => {
    const msg = await getMessageById(input.messageId);
    if (!msg) throw new Error("Message not found");
    const conversation = await getConversationById(msg.conversationId);
    if (!conversation || conversation.userId !== ctx.user.id) {
      throw new Error("Access denied");
    }
    if (msg.role !== "user") throw new Error("Can only delete your own messages");
    await deleteMessage(input.messageId);
    return { success: true };
  })
});

// server/routers/subscription.ts
import { z as z3 } from "zod";
init_db();
import Stripe from "stripe";
var stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
var subscriptionRouter = router({
  /**
   * Get all available subscription plans
   */
  getPlans: publicProcedure.query(async () => {
    return await getSubscriptionPlans();
  }),
  /**
   * Create a checkout session for subscription purchase
   */
  createCheckoutSession: protectedProcedure.input(
    z3.object({
      planId: z3.string(),
      billingCycle: z3.enum(["monthly", "yearly"]),
      referralCode: z3.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    try {
      let customerId = ctx.user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: ctx.user.email || void 0,
          name: ctx.user.name || void 0,
          metadata: {
            userId: ctx.user.id.toString()
          }
        });
        customerId = customer.id;
      }
      const priceMap = {
        pro: {
          monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || "price_pro_monthly",
          yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || "price_pro_yearly"
        },
        enterprise: {
          monthly: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || "price_enterprise_monthly",
          yearly: process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || "price_enterprise_yearly"
        }
      };
      const priceId = priceMap[input.planId]?.[input.billingCycle] || input.planId;
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url: `${ctx.req.headers.origin || "https://kelionai.app"}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${ctx.req.headers.origin || "https://kelionai.app"}/pricing`,
        client_reference_id: ctx.user.id.toString(),
        customer_email: !customerId ? ctx.user.email || void 0 : void 0,
        metadata: {
          userId: ctx.user.id.toString(),
          planId: input.planId,
          billingCycle: input.billingCycle,
          referralCode: input.referralCode || "",
          customerEmail: ctx.user.email || "",
          customerName: ctx.user.name || ""
        }
      });
      return {
        sessionId: session.id,
        url: session.url
      };
    } catch (error) {
      console.error("[Subscription] Checkout session creation failed:", error);
      throw new Error("Failed to create checkout session");
    }
  }),
  /**
   * Get current subscription status
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.stripeSubscriptionId) {
        return {
          status: "none",
          tier: ctx.user.subscriptionTier || "free",
          currentPeriodEnd: null
        };
      }
      const subscription = await stripe.subscriptions.retrieve(ctx.user.stripeSubscriptionId);
      return {
        status: subscription.status,
        tier: ctx.user.subscriptionTier,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1e3) : null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      };
    } catch (error) {
      console.error("[Subscription] Status retrieval failed:", error);
      return {
        status: "error",
        tier: ctx.user.subscriptionTier || "free",
        currentPeriodEnd: null
      };
    }
  }),
  /**
   * Cancel current subscription
   */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      if (!ctx.user.stripeSubscriptionId) {
        throw new Error("No active subscription");
      }
      const subscription = await stripe.subscriptions.update(ctx.user.stripeSubscriptionId, {
        cancel_at_period_end: true
      });
      return {
        success: true,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1e3) : null
      };
    } catch (error) {
      console.error("[Subscription] Cancellation failed:", error);
      throw new Error("Failed to cancel subscription");
    }
  }),
  /**
   * Get payment history
   */
  getPaymentHistory: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (!ctx.user.stripeCustomerId) {
        return [];
      }
      const invoices = await stripe.invoices.list({
        customer: ctx.user.stripeCustomerId,
        limit: 10
      });
      return invoices.data.map((invoice) => ({
        id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        date: new Date(invoice.created * 1e3),
        pdfUrl: invoice.invoice_pdf
      }));
    } catch (error) {
      console.error("[Subscription] Payment history retrieval failed:", error);
      return [];
    }
  })
});

// server/routers/admin.ts
import { z as z4 } from "zod";
init_db();
init_schema();
import { eq as eq2, desc as desc2 } from "drizzle-orm";
var adminProcedure2 = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new Error("Admin access required");
  }
  return next({ ctx });
});
var adminRouter = router({
  /**
   * Get all users (admin only)
   */
  getAllUsers: adminProcedure2.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const allUsers = await db.select().from(users).orderBy(desc2(users.createdAt));
      return allUsers.map((u) => ({
        ...u,
        stripeCustomerId: u.stripeCustomerId ? "***" : null,
        stripeSubscriptionId: u.stripeSubscriptionId ? "***" : null
      }));
    } catch (error) {
      console.error("[Admin] Failed to get users:", error);
      throw error;
    }
  }),
  /**
   * Get user analytics
   */
  getUserAnalytics: adminProcedure2.query(async () => {
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
        const thirtyDaysAgo = /* @__PURE__ */ new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return lastSignedIn > thirtyDaysAgo;
      }).length;
      const paidUsers = allUsers.filter((u) => u.subscriptionTier !== "free").length;
      const totalConversations = allConversations.length;
      const totalMessages = allMessages.length;
      const usersByTier = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length
      };
      return {
        totalUsers,
        activeUsers,
        paidUsers,
        totalConversations,
        totalMessages,
        usersByTier,
        averageConversationsPerUser: totalConversations / totalUsers || 0,
        averageMessagesPerConversation: totalMessages / totalConversations || 0
      };
    } catch (error) {
      console.error("[Admin] Failed to get analytics:", error);
      throw error;
    }
  }),
  /**
   * Get system health status
   */
  getSystemHealth: adminProcedure2.query(async () => {
    const db = await getDb();
    return {
      database: db ? "connected" : "disconnected",
      timestamp: /* @__PURE__ */ new Date(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }),
  /**
   * Get revenue analytics
   */
  getRevenueAnalytics: adminProcedure2.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const allUsers = await db.select().from(users);
      const subscriptionTiers = {
        free: allUsers.filter((u) => u.subscriptionTier === "free").length,
        pro: allUsers.filter((u) => u.subscriptionTier === "pro").length,
        enterprise: allUsers.filter((u) => u.subscriptionTier === "enterprise").length
      };
      const estimatedMRR = subscriptionTiers.pro * 29 + subscriptionTiers.enterprise * 99;
      return {
        subscriptionTiers,
        estimatedMRR,
        activeSubscriptions: subscriptionTiers.pro + subscriptionTiers.enterprise
      };
    } catch (error) {
      console.error("[Admin] Failed to get revenue analytics:", error);
      throw error;
    }
  }),
  /**
   * Update user subscription tier (admin only)
   */
  updateUserSubscription: adminProcedure2.input(
    z4.object({
      userId: z4.number(),
      tier: z4.enum(["free", "pro", "enterprise"]),
      status: z4.enum(["active", "cancelled", "past_due", "trialing"]).optional()
    })
  ).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      const updateData = { subscriptionTier: input.tier };
      if (input.status) {
        updateData.subscriptionStatus = input.status;
      }
      await db.update(users).set(updateData).where(eq2(users.id, input.userId));
      return { success: true };
    } catch (error) {
      console.error("[Admin] Failed to update user subscription:", error);
      throw error;
    }
  }),
  /**
   * Get Brain v4 diagnostics
   */
  getBrainDiagnostics: adminProcedure2.query(async () => {
    return getBrainDiagnostics();
  }),
  /**
   * Delete user (admin only) - soft delete by anonymizing
   */
  deleteUser: adminProcedure2.input(z4.object({ userId: z4.number() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }
    try {
      await db.update(users).set({
        name: "Deleted User",
        email: null,
        openId: `deleted_${input.userId}_${Date.now()}`
      }).where(eq2(users.id, input.userId));
      return { success: true };
    } catch (error) {
      console.error("[Admin] Failed to delete user:", error);
      throw error;
    }
  })
});

// server/routers/voice.ts
import { z as z5 } from "zod";

// server/_core/voiceTranscription.ts
init_env();
async function transcribeAudio(options) {
  try {
    const apiKey = ENV.forgeApiKey || ENV.openaiApiKey;
    const apiBaseUrl = ENV.forgeApiUrl || "https://api.openai.com";
    if (!apiKey) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither BUILT_IN_FORGE_API_KEY nor OPENAI_API_KEY is set"
      };
    }
    let audioBuffer;
    let mimeType;
    if (options.audioBuffer) {
      audioBuffer = options.audioBuffer;
      mimeType = options.audioMimeType || "audio/webm";
    } else {
      try {
        const response2 = await fetch(options.audioUrl);
        if (!response2.ok) {
          return {
            error: "Failed to download audio file",
            code: "INVALID_FORMAT",
            details: `HTTP ${response2.status}: ${response2.statusText}`
          };
        }
        audioBuffer = Buffer.from(await response2.arrayBuffer());
        mimeType = response2.headers.get("content-type") || "audio/mpeg";
        const sizeMB = audioBuffer.length / (1024 * 1024);
        if (sizeMB > 16) {
          return {
            error: "Audio file exceeds maximum size limit",
            code: "FILE_TOO_LARGE",
            details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
          };
        }
      } catch (error) {
        return {
          error: "Failed to fetch audio file",
          code: "SERVICE_ERROR",
          details: error instanceof Error ? error.message : "Unknown error"
        };
      }
    }
    const formData = new FormData();
    const filename = `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, filename);
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    const prompt = options.prompt || (options.language ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}` : "Transcribe the user's voice to text");
    formData.append("prompt", prompt);
    const baseUrl = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
    const fullUrl = new URL(
      "v1/audio/transcriptions",
      baseUrl
    ).toString();
    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "Accept-Encoding": "identity"
      },
      body: formData
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`
      };
    }
    const whisperResponse = await response.json();
    if (!whisperResponse.text || typeof whisperResponse.text !== "string") {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }
    return whisperResponse;
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}
function getFileExtension(mimeType) {
  const mimeToExt = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a"
  };
  return mimeToExt[mimeType] || "audio";
}
function getLanguageName(langCode) {
  const langMap = {
    "en": "English",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "ar": "Arabic",
    "hi": "Hindi",
    "nl": "Dutch",
    "pl": "Polish",
    "tr": "Turkish",
    "sv": "Swedish",
    "da": "Danish",
    "no": "Norwegian",
    "fi": "Finnish"
  };
  return langMap[langCode] || langCode;
}

// server/routers/voice.ts
init_db();
import { sql as sql2 } from "drizzle-orm";
function randomSuffix() {
  return Math.random().toString(36).substring(2, 10);
}
async function checkAccess(userId, userRole, subscriptionTier) {
  if (userRole === "admin") return;
  if (subscriptionTier && subscriptionTier !== "free") return;
  const trial = await getTrialStatus(userId);
  if (!trial.canUse) {
    throw new Error(trial.reason || "Trial expired or daily limit reached. Upgrade to continue.");
  }
}
var voiceRouter = router({
  /**
   * Upload audio blob (base64) to S3, return URL for Whisper STT
   */
  uploadAudio: protectedProcedure.input(z5.object({ audioBase64: z5.string(), mimeType: z5.string().default("audio/webm") })).mutation(async ({ ctx, input }) => {
    await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
    const buffer = Buffer.from(input.audioBase64, "base64");
    const ext = input.mimeType.includes("wav") ? "wav" : input.mimeType.includes("mp3") ? "mp3" : "webm";
    const key = `audio/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    return { audioUrl: url };
  }),
  /**
   * Upload image blob (base64) to S3, return URL for GPT vision
   */
  uploadImage: protectedProcedure.input(z5.object({ imageBase64: z5.string(), mimeType: z5.string().default("image/jpeg") })).mutation(async ({ ctx, input }) => {
    await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
    const buffer = Buffer.from(input.imageBase64, "base64");
    const ext = input.mimeType.includes("png") ? "png" : "jpg";
    const key = `images/${ctx.user.id}-${Date.now()}-${randomSuffix()}.${ext}`;
    const { url } = await storagePut(key, buffer, input.mimeType);
    return { imageUrl: url };
  }),
  /**
   * Transcribe audio file to text using Whisper API
   */
  transcribeAudio: protectedProcedure.input(
    z5.object({
      audioUrl: z5.string().optional(),
      audioBase64: z5.string().optional(),
      mimeType: z5.string().optional(),
      language: z5.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
    const transcribeOpts = {
      audioUrl: input.audioUrl || "",
      language: input.language
    };
    if (input.audioBase64) {
      transcribeOpts.audioBuffer = Buffer.from(input.audioBase64, "base64");
      transcribeOpts.audioMimeType = input.mimeType || "audio/webm";
    }
    const result = await transcribeAudio(transcribeOpts);
    if ("error" in result) {
      console.error("[Voice] Transcription error:", result);
      throw new Error(result.error + (result.details ? `: ${result.details}` : ""));
    }
    await incrementDailyUsage(ctx.user.id, 1, 0);
    const usage = await getUserUsage(ctx.user.id);
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, voiceMinutesUsed + 1);
    return {
      text: result.text || "",
      language: result.language || "en",
      duration: result.duration || 0
    };
  }),
  /**
   * Generate speech from text using ElevenLabs TTS (REAL)
   */
  generateSpeech: protectedProcedure.input(
    z5.object({
      text: z5.string().min(1).max(5e3),
      avatar: z5.enum(["kelion", "kira"]).default("kelion"),
      useClonedVoice: z5.boolean().default(false),
      quality: z5.enum(["standard", "high", "ultra"]).default("high"),
      language: z5.string().optional()
    })
  ).mutation(async ({ ctx, input }) => {
    await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
    let customVoiceId;
    if (input.useClonedVoice) {
      const db = await getDb();
      if (db) {
        const rows = await db.execute(
          sql2`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
        );
        const result = rows;
        if (result?.[0]?.voice_id) {
          customVoiceId = result[0].voice_id;
        }
      }
    }
    const { audioUrl, duration } = await generateSpeech({
      text: input.text,
      avatar: input.avatar,
      voiceId: customVoiceId,
      quality: input.quality,
      language: input.language
    });
    const estimatedMinutes = Math.max(1, Math.ceil(duration / 60));
    await incrementDailyUsage(ctx.user.id, estimatedMinutes, 0);
    const usage = await getUserUsage(ctx.user.id);
    const voiceMinutesUsed = usage?.voiceMinutesThisMonth || 0;
    await updateUserUsage(ctx.user.id, usage?.messagesThisMonth || 0, voiceMinutesUsed + estimatedMinutes);
    return { audioUrl, duration, avatar: input.avatar };
  }),
  /**
   * Clone user's voice - Step-by-step procedure from chat
   */
  cloneVoice: protectedProcedure.input(
    z5.object({
      audioBase64: z5.string().min(1),
      voiceName: z5.string().default("My Voice")
    })
  ).mutation(async ({ ctx, input }) => {
    await checkAccess(ctx.user.id, ctx.user.role, ctx.user.subscriptionTier);
    const elUsage = await getElevenLabsUsage();
    if (!elUsage.canClone) {
      throw new Error("Voice cloning is not available on the current ElevenLabs plan");
    }
    const audioBuffer = Buffer.from(input.audioBase64, "base64");
    const { voiceId, name } = await cloneVoice({
      audioBuffer,
      name: `${input.voiceName} - ${ctx.user.name || ctx.user.id}`,
      description: `Cloned voice for user ${ctx.user.name || ctx.user.id} on KelionAI`
    });
    const db = await getDb();
    if (db) {
      await db.execute(
        sql2`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
      );
      await db.execute(
        sql2`INSERT INTO user_cloned_voices (user_id, voice_id, voice_name, is_active, created_at)
              VALUES (${ctx.user.id}, ${voiceId}, ${name}, true, NOW())`
      );
    }
    return {
      success: true,
      voiceId,
      voiceName: name,
      message: "Voice cloned successfully! Your AI assistant will now use your voice."
    };
  }),
  /**
   * Get user's cloned voice info
   */
  getClonedVoice: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { hasClonedVoice: false, voiceName: null, voiceId: null };
    const rows = await db.execute(
      sql2`SELECT voice_id, voice_name, created_at FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true LIMIT 1`
    );
    const result = rows;
    if (result?.[0]) {
      return {
        hasClonedVoice: true,
        voiceName: result[0].voice_name,
        voiceId: result[0].voice_id,
        createdAt: result[0].created_at
      };
    }
    return { hasClonedVoice: false, voiceName: null, voiceId: null };
  }),
  /**
   * Delete user's cloned voice
   */
  deleteClonedVoice: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.execute(
      sql2`SELECT voice_id FROM user_cloned_voices WHERE user_id = ${ctx.user.id} AND is_active = true`
    );
    const result = rows;
    if (result?.[0]?.voice_id) {
      await deleteClonedVoice(result[0].voice_id);
      await db.execute(
        sql2`UPDATE user_cloned_voices SET is_active = false WHERE user_id = ${ctx.user.id}`
      );
    }
    return { success: true };
  }),
  /**
   * Get voice usage statistics
   */
  getVoiceUsage: protectedProcedure.query(async ({ ctx }) => {
    const trial = await getTrialStatus(ctx.user.id);
    let elevenLabsUsage = { characterCount: 0, characterLimit: 0, canClone: false };
    try {
      elevenLabsUsage = await getElevenLabsUsage();
    } catch (_) {
    }
    return {
      used: trial.dailyMinutesUsed,
      limit: trial.dailyMinutesLimit,
      remaining: Math.max(0, trial.dailyMinutesLimit - trial.dailyMinutesUsed),
      percentage: trial.dailyMinutesLimit > 0 ? trial.dailyMinutesUsed / trial.dailyMinutesLimit * 100 : 0,
      trialDaysLeft: trial.trialDaysLeft,
      canUse: trial.canUse,
      elevenLabs: elevenLabsUsage
    };
  })
});

// server/routers/contact.ts
import { z as z6 } from "zod";
init_db();
import { sql as sql3 } from "drizzle-orm";
var contactRouter = router({
  /**
   * Send a contact message with AI auto-response
   */
  sendMessage: publicProcedure.input(
    z6.object({
      name: z6.string().min(1),
      email: z6.string().email(),
      subject: z6.string().min(1),
      message: z6.string().min(1).max(5e3)
    })
  ).mutation(async ({ input }) => {
    const db = await getDb();
    if (db) {
      try {
        await db.execute(
          sql3`INSERT INTO contact_messages (name, email, subject, message, status, created_at)
                VALUES (${input.name}, ${input.email}, ${input.subject}, ${input.message}, 'new', NOW())`
        );
      } catch (err) {
        console.error("[Contact] Failed to save message:", err);
      }
    }
    try {
      await notifyOwner({
        title: `New Contact: ${input.subject}`,
        content: `From: ${input.name} (${input.email})

${input.message}`
      });
    } catch (err) {
      console.error("[Contact] Failed to notify owner:", err);
    }
    let aiResponse = "";
    try {
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are KelionAI's customer support assistant. Generate a brief, helpful auto-response to this contact form message. Be warm, professional, and acknowledge their specific concern. Keep it under 100 words. If it's a technical issue, suggest they try the chat feature. If it's billing, mention they can check their subscription page.`
          },
          {
            role: "user",
            content: `Subject: ${input.subject}
Message: ${input.message}`
          }
        ]
      });
      aiResponse = result?.choices?.[0]?.message?.content || "";
    } catch (err) {
      console.error("[Contact] AI auto-response failed:", err);
      aiResponse = "Thank you for reaching out! Our team has received your message and will get back to you within 24 hours.";
    }
    return {
      success: true,
      aiResponse
    };
  })
});

// server/routers/referral.ts
import { z as z7 } from "zod";
init_db();
var referralRouter = router({
  /**
   * Generate a referral code and send it via email to a potential client
   * Since we can't send emails directly to arbitrary addresses,
   * we notify the owner and return the code for the user to share manually
   */
  sendReferral: protectedProcedure.input(z7.object({
    recipientEmail: z7.string().email(),
    recipientName: z7.string().optional()
  })).mutation(async ({ ctx, input }) => {
    try {
      const referral = await createReferralCode(ctx.user.id, input.recipientEmail);
      await notifyOwner({
        title: `New Referral Code Generated`,
        content: `User ${ctx.user.name || ctx.user.email || ctx.user.id} generated referral code ${referral.code} for ${input.recipientEmail}. Code expires ${referral.expiresAt.toISOString().slice(0, 10)}. Please forward this code to the recipient.`
      }).catch(() => {
        console.warn("[Referral] Owner notification failed, code still created");
      });
      console.log(`[Referral] Code ${referral.code} created by user ${ctx.user.id} for ${input.recipientEmail}`);
      return {
        success: true,
        code: referral.code,
        expiresAt: referral.expiresAt,
        recipientEmail: input.recipientEmail,
        message: `Referral code ${referral.code} generated! Share this code with ${input.recipientName || input.recipientEmail}. Valid for 7 days. When they subscribe using this code, you'll receive 5 bonus days on your subscription.`
      };
    } catch (error) {
      console.error("[Referral] Failed to create referral:", error);
      throw new Error("Failed to create referral code");
    }
  }),
  /**
   * Validate a referral code (used at checkout)
   */
  validateCode: protectedProcedure.input(z7.object({
    code: z7.string().min(1)
  })).mutation(async ({ ctx, input }) => {
    const referral = await getReferralByCode(input.code);
    if (!referral) {
      return { valid: false, message: "Invalid referral code." };
    }
    if (referral.usedBy) {
      return { valid: false, message: "This referral code has already been used." };
    }
    if (/* @__PURE__ */ new Date() > referral.expiresAt) {
      return { valid: false, message: "This referral code has expired." };
    }
    if (referral.senderUserId === ctx.user.id) {
      return { valid: false, message: "You cannot use your own referral code." };
    }
    return {
      valid: true,
      referralId: referral.id,
      message: "Referral code is valid! The referrer will receive 5 bonus days on their subscription after your payment is confirmed."
    };
  }),
  /**
   * Get my sent referrals
   */
  myReferrals: protectedProcedure.query(async ({ ctx }) => {
    return await getUserReferrals(ctx.user.id);
  })
});

// server/routers/refund.ts
import { z as z8 } from "zod";
init_db();
import Stripe2 from "stripe";
import { TRPCError as TRPCError3 } from "@trpc/server";
var stripe2 = new Stripe2(process.env.STRIPE_SECRET_KEY || "");
var refundRouter = router({
  /**
   * Request a refund - enforces policy:
   * - Monthly: NO refund, immediate denial with message
   * - Annual: stop current month, refund 11 months if < 3 months elapsed
   *           if >= 3 months elapsed, denied with message
   *           Account closed automatically on approved refund
   *           Refund processed in 15 business days
   */
  requestRefund: protectedProcedure.input(z8.object({
    reason: z8.string().optional()
  })).mutation(async ({ ctx, input }) => {
    if (!ctx.user.stripeSubscriptionId) {
      throw new TRPCError3({ code: "BAD_REQUEST", message: "No active subscription to refund." });
    }
    try {
      const subscription = await stripe2.subscriptions.retrieve(ctx.user.stripeSubscriptionId);
      const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || "month";
      const billingCycle = interval === "year" ? "yearly" : "monthly";
      const startDate = new Date(subscription.start_date * 1e3);
      const now = /* @__PURE__ */ new Date();
      const monthsElapsed = Math.floor((now.getTime() - startDate.getTime()) / (1e3 * 60 * 60 * 24 * 30));
      if (billingCycle === "monthly") {
        const refund2 = await createRefundRequest(
          ctx.user.id,
          ctx.user.stripeSubscriptionId,
          billingCycle,
          startDate,
          monthsElapsed,
          null,
          input.reason
        );
        return {
          success: false,
          status: "denied",
          message: "Monthly subscriptions are non-refundable. Your subscription will remain active until the end of the current billing period. You can cancel anytime from your subscription page.",
          refundId: refund2.id
        };
      }
      if (monthsElapsed >= 3) {
        const refund2 = await createRefundRequest(
          ctx.user.id,
          ctx.user.stripeSubscriptionId,
          billingCycle,
          startDate,
          monthsElapsed,
          null,
          input.reason
        );
        return {
          success: false,
          status: "denied",
          message: `Your annual subscription has been active for ${monthsElapsed} months. Refunds are only available within the first 3 months. You can cancel your subscription to prevent future charges.`,
          refundId: refund2.id
        };
      }
      const yearlyAmountCents = subscription.items?.data?.[0]?.price?.unit_amount || 0;
      const monthlyEquivalentCents = yearlyAmountCents / 12;
      const refundAmountCents = Math.round(monthlyEquivalentCents * 11);
      const refundAmount = (refundAmountCents / 100).toFixed(2);
      const refund = await createRefundRequest(
        ctx.user.id,
        ctx.user.stripeSubscriptionId,
        billingCycle,
        startDate,
        monthsElapsed,
        refundAmount,
        input.reason
      );
      await stripe2.subscriptions.cancel(ctx.user.stripeSubscriptionId);
      await closeUserAccount(ctx.user.id);
      await notifyOwner({
        title: "Refund Request - Account Closed",
        content: `User ${ctx.user.name || ctx.user.email || ctx.user.id} requested a refund of \u20AC${refundAmount} (annual plan, ${monthsElapsed} months elapsed). Account has been closed. Please process the Stripe refund within 15 business days.`
      }).catch(() => {
      });
      return {
        success: true,
        status: "pending",
        message: `Refund request submitted. Your account has been closed and \u20AC${refundAmount} (11 months) will be refunded within 15 business days.`,
        refundAmount,
        refundId: refund.id
      };
    } catch (error) {
      console.error("[Refund] Error:", error);
      throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: "Failed to process refund request." });
    }
  }),
  /**
   * Get my refund requests
   */
  myRefunds: protectedProcedure.query(async ({ ctx }) => {
    return await getRefundRequests(ctx.user.id);
  }),
  /**
   * Admin: get all refund requests
   */
  allRefunds: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError3({ code: "FORBIDDEN" });
    }
    return await getAllRefundRequests();
  }),
  /**
   * Admin: process a refund (approve/deny)
   * When approved, executes actual Stripe refund
   */
  processRefund: protectedProcedure.input(z8.object({
    refundId: z8.number(),
    action: z8.enum(["approved", "denied"]),
    adminNote: z8.string().optional()
  })).mutation(async ({ ctx, input }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError3({ code: "FORBIDDEN" });
    }
    if (input.action === "approved") {
      try {
        const refunds = await getAllRefundRequests();
        const refundReq = refunds.find((r) => r.id === input.refundId);
        if (refundReq && refundReq.stripeSubscriptionId && refundReq.refundAmount) {
          const invoices = await stripe2.invoices.list({
            subscription: refundReq.stripeSubscriptionId,
            limit: 1
          });
          if (invoices.data.length > 0 && invoices.data[0].payment_intent) {
            const refundAmountCents = Math.round(parseFloat(refundReq.refundAmount) * 100);
            await stripe2.refunds.create({
              payment_intent: invoices.data[0].payment_intent,
              amount: refundAmountCents
            });
            console.log(`[Refund] Stripe refund of ${refundReq.refundAmount} executed for refund #${input.refundId}`);
          }
        }
      } catch (stripeErr) {
        console.error("[Refund] Stripe refund execution failed:", stripeErr);
      }
    }
    await updateRefundStatus(input.refundId, input.action, input.adminNote);
    return { success: true, message: `Refund ${input.action}.` };
  })
});

// server/routers/userChat.ts
import { z as z9 } from "zod";
init_db();
init_schema();
import { eq as eq3, and as and2, desc as desc3 } from "drizzle-orm";
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
var userChatRouter = router({
  createRoom: protectedProcedure.input(z9.object({ targetUserId: z9.number(), name: z9.string().optional() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const existingRooms = await db.select().from(userChatRooms).innerJoin(userChatParticipants, eq3(userChatRooms.id, userChatParticipants.roomId)).where(and2(eq3(userChatRooms.type, "direct"), eq3(userChatParticipants.userId, ctx.user.id)));
    for (const room of existingRooms) {
      const otherParticipant = await db.select().from(userChatParticipants).where(and2(eq3(userChatParticipants.roomId, room.user_chat_rooms.id), eq3(userChatParticipants.userId, input.targetUserId)));
      if (otherParticipant.length > 0) {
        return { roomId: room.user_chat_rooms.id, existing: true };
      }
    }
    const [newRoom] = await db.insert(userChatRooms).values({ name: input.name || "Direct Chat", type: "direct", createdBy: ctx.user.id }).returning();
    await db.insert(userChatParticipants).values([
      { roomId: newRoom.id, userId: ctx.user.id },
      { roomId: newRoom.id, userId: input.targetUserId }
    ]);
    return { roomId: newRoom.id, existing: false };
  }),
  createGroupRoom: protectedProcedure.input(z9.object({ name: z9.string().min(1).max(100), userIds: z9.array(z9.number()).min(1).max(50) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const [newRoom] = await db.insert(userChatRooms).values({ name: input.name, type: "group", createdBy: ctx.user.id }).returning();
    const allUserIds = [ctx.user.id, ...input.userIds.filter((id) => id !== ctx.user.id)];
    await db.insert(userChatParticipants).values(allUserIds.map((userId) => ({ roomId: newRoom.id, userId })));
    return { roomId: newRoom.id };
  }),
  getMyRooms: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return await db.select({ roomId: userChatRooms.id, roomName: userChatRooms.name, roomType: userChatRooms.type, createdAt: userChatRooms.createdAt }).from(userChatParticipants).innerJoin(userChatRooms, eq3(userChatParticipants.roomId, userChatRooms.id)).where(eq3(userChatParticipants.userId, ctx.user.id)).orderBy(desc3(userChatRooms.createdAt));
  }),
  sendMessage: protectedProcedure.input(z9.object({ roomId: z9.number(), content: z9.string().min(1).max(5e3) })).mutation(async ({ ctx, input }) => {
    const db = await requireDb();
    const participant = await db.select().from(userChatParticipants).where(and2(eq3(userChatParticipants.roomId, input.roomId), eq3(userChatParticipants.userId, ctx.user.id)));
    if (participant.length === 0) throw new Error("Not a participant in this room");
    const [message] = await db.insert(userChatMessages).values({ roomId: input.roomId, senderId: ctx.user.id, content: input.content }).returning();
    return message;
  }),
  getMessages: protectedProcedure.input(z9.object({ roomId: z9.number(), limit: z9.number().min(1).max(100).default(50), offset: z9.number().min(0).default(0) })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const participant = await db.select().from(userChatParticipants).where(and2(eq3(userChatParticipants.roomId, input.roomId), eq3(userChatParticipants.userId, ctx.user.id)));
    if (participant.length === 0) throw new Error("Not a participant in this room");
    const msgs = await db.select().from(userChatMessages).where(eq3(userChatMessages.roomId, input.roomId)).orderBy(desc3(userChatMessages.createdAt)).limit(input.limit).offset(input.offset);
    return msgs.reverse();
  })
});

// server/routers/voiceLibrary.ts
import { z as z10 } from "zod";
init_db();
init_schema();
import { eq as eq4, and as and3, desc as desc4 } from "drizzle-orm";
async function requireDb2() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
var voiceLibraryRouter = router({
  // Get all voices for the current user
  getMyVoices: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb2();
    return await db.select().from(voiceLibrary).where(eq4(voiceLibrary.userId, ctx.user.id)).orderBy(desc4(voiceLibrary.createdAt));
  }),
  // Add a new voice to the library
  addVoice: protectedProcedure.input(z10.object({
    name: z10.string().min(1).max(100),
    voiceId: z10.string().min(1),
    provider: z10.string().default("elevenlabs"),
    sampleUrl: z10.string().optional(),
    quality: z10.string().default("standard")
  })).mutation(async ({ ctx, input }) => {
    const db = await requireDb2();
    const [voice] = await db.insert(voiceLibrary).values({
      userId: ctx.user.id,
      name: input.name,
      voiceId: input.voiceId,
      provider: input.provider,
      sampleUrl: input.sampleUrl || null,
      quality: input.quality
    }).returning();
    return voice;
  }),
  // Set a voice as default
  setDefault: protectedProcedure.input(z10.object({ voiceId: z10.number() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb2();
    await db.update(voiceLibrary).set({ isDefault: false }).where(eq4(voiceLibrary.userId, ctx.user.id));
    await db.update(voiceLibrary).set({ isDefault: true }).where(and3(eq4(voiceLibrary.id, input.voiceId), eq4(voiceLibrary.userId, ctx.user.id)));
    return { success: true };
  }),
  // Toggle public visibility (for marketplace)
  togglePublic: protectedProcedure.input(z10.object({ voiceId: z10.number(), isPublic: z10.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb2();
    await db.update(voiceLibrary).set({ isPublic: input.isPublic }).where(and3(eq4(voiceLibrary.id, input.voiceId), eq4(voiceLibrary.userId, ctx.user.id)));
    return { success: true };
  }),
  // Delete a voice
  deleteVoice: protectedProcedure.input(z10.object({ voiceId: z10.number() })).mutation(async ({ ctx, input }) => {
    const db = await requireDb2();
    await db.delete(voiceLibrary).where(and3(eq4(voiceLibrary.id, input.voiceId), eq4(voiceLibrary.userId, ctx.user.id)));
    return { success: true };
  }),
  // Browse public voices (marketplace)
  browsePublic: protectedProcedure.input(z10.object({ limit: z10.number().min(1).max(100).default(50), offset: z10.number().min(0).default(0) })).query(async ({ input }) => {
    const db = await requireDb2();
    return await db.select().from(voiceLibrary).where(eq4(voiceLibrary.isPublic, true)).orderBy(desc4(voiceLibrary.createdAt)).limit(input.limit).offset(input.offset);
  })
});

// server/routers.ts
init_db();
import { z as z11 } from "zod";
var appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  chat: chatRouter,
  subscription: subscriptionRouter,
  admin: adminRouter,
  voice: voiceRouter,
  contact: contactRouter,
  referral: referralRouter,
  refund: refundRouter,
  userChat: userChatRouter,
  voiceLibrary: voiceLibraryRouter,
  trial: router({
    getStatus: protectedProcedure.query(async ({ ctx }) => {
      return await getTrialStatus(ctx.user.id);
    })
  }),
  profile: router({
    updateLanguage: protectedProcedure.input(z11.object({ language: z11.string().min(2).max(10) })).mutation(async ({ ctx, input }) => {
      await updateUserLanguage(ctx.user.id, input.language);
      return { success: true };
    })
  })
});

// server/_core/context.ts
var isStandalone = true;
async function createContext(opts) {
  let user = null;
  try {
    if (isStandalone) {
      const { authenticateRequestStandalone: authenticateRequestStandalone2 } = await Promise.resolve().then(() => (init_standalone_auth(), standalone_auth_exports));
      user = await authenticateRequestStandalone2(opts.req);
    } else {
      const { sdk: sdk2 } = await Promise.resolve().then(() => (init_sdk(), sdk_exports));
      user = await sdk2.authenticateRequest(opts.req);
    }
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs3 from "fs";
import { nanoid } from "nanoid";
import path3 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs2 from "node:fs";
import path2 from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path2.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs2.existsSync(LOG_DIR)) {
    fs2.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs2.existsSync(logPath) || fs2.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs2.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs2.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path2.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs2.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path2.resolve(import.meta.dirname, "client", "src"),
      "@shared": path2.resolve(import.meta.dirname, "shared"),
      "@assets": path2.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path2.resolve(import.meta.dirname),
  root: path2.resolve(import.meta.dirname, "client"),
  publicDir: path2.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path2.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs3.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path3.resolve(import.meta.dirname, "../..", "dist", "public") : path3.resolve(import.meta.dirname, "public");
  if (!fs3.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path3.resolve(distPath, "index.html"));
  });
}

// server/_core/stripe-webhook.ts
init_db();
init_schema();
import Stripe3 from "stripe";
import { eq as eq6 } from "drizzle-orm";
var stripe3 = new Stripe3(process.env.STRIPE_SECRET_KEY || "");
var webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
async function handleStripeWebhook(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe3.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.id.startsWith("evt_test_")) {
    console.log("[Stripe Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }
  const db = await getDb();
  if (!db) {
    console.error("[Stripe Webhook] Database not available");
    return res.status(500).json({ error: "Database unavailable" });
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("[Stripe Webhook] Checkout session completed:", session.id);
        if (session.client_reference_id) {
          const userId = parseInt(session.client_reference_id);
          const customerId = session.customer;
          const subscriptionId = session.subscription;
          const billingCycle = session.metadata?.billingCycle || "monthly";
          await db.update(users).set({
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            subscriptionTier: session.metadata?.planId || "pro",
            subscriptionStatus: "active",
            subscriptionStartDate: /* @__PURE__ */ new Date(),
            billingCycle,
            trialExpired: true
            // No longer on trial
          }).where(eq6(users.id, userId));
          console.log("[Stripe Webhook] User subscription updated:", userId, "billing:", billingCycle);
          const referralCode = session.metadata?.referralCode;
          if (referralCode) {
            try {
              const referral = await getReferralByCode(referralCode);
              if (referral && !referral.usedBy && referral.senderUserId !== userId) {
                await markReferralUsed(referral.id, userId);
                await applyReferralBonus(referral.id);
                console.log(`[Stripe Webhook] Referral ${referralCode} applied, bonus given to user ${referral.senderUserId}`);
              }
            } catch (refErr) {
              console.error("[Stripe Webhook] Referral processing error:", refErr);
            }
          }
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        console.log("[Stripe Webhook] Subscription updated:", subscription.id);
        const userRecord = await db.select().from(users).where(eq6(users.stripeSubscriptionId, subscription.id)).limit(1);
        if (userRecord.length > 0) {
          let status = "cancelled";
          if (subscription.status === "active") status = "active";
          else if (subscription.status === "past_due") status = "past_due";
          else if (subscription.status === "trialing") status = "trialing";
          else status = "cancelled";
          const updateData = { subscriptionStatus: status };
          if (["canceled", "unpaid", "incomplete_expired"].includes(subscription.status)) {
            updateData.subscriptionTier = "free";
            updateData.stripeSubscriptionId = null;
          }
          await db.update(users).set(updateData).where(eq6(users.id, userRecord[0].id));
          console.log(`[Stripe Webhook] User ${userRecord[0].id} subscription status: ${subscription.status} -> ${status}`);
        }
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log("[Stripe Webhook] Subscription deleted:", subscription.id);
        const userRecord = await db.select().from(users).where(eq6(users.stripeSubscriptionId, subscription.id)).limit(1);
        if (userRecord.length > 0) {
          await db.update(users).set({
            subscriptionTier: "free",
            subscriptionStatus: "cancelled",
            stripeSubscriptionId: null
          }).where(eq6(users.id, userRecord[0].id));
          console.log("[Stripe Webhook] User downgraded to free:", userRecord[0].id);
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        console.log("[Stripe Webhook] Invoice paid:", invoice.id);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.log("[Stripe Webhook] Invoice payment failed:", invoice.id);
        if (invoice.customer) {
          const userRecord = await db.select().from(users).where(eq6(users.stripeCustomerId, invoice.customer)).limit(1);
          if (userRecord.length > 0) {
            await db.update(users).set({ subscriptionStatus: "past_due" }).where(eq6(users.id, userRecord[0].id));
            console.log("[Stripe Webhook] User subscription marked as past_due:", userRecord[0].id);
          }
        }
        break;
      }
      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (error) {
    console.error("[Stripe Webhook] Error processing event:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

// server/streaming.ts
init_env();
init_db();
import { Router } from "express";
init_standalone_auth();
var router2 = Router();
function resolveApiUrl2() {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) {
    return `${ENV.forgeApiUrl.replace(/\/$/, "")}/v1/chat/completions`;
  }
  return "https://api.openai.com/v1/chat/completions";
}
function getApiKey2() {
  if (ENV.forgeApiKey && ENV.forgeApiKey.trim().length > 0) return ENV.forgeApiKey;
  if (ENV.openaiApiKey && ENV.openaiApiKey.trim().length > 0) return ENV.openaiApiKey;
  throw new Error("No API key configured");
}
function getModelName2() {
  if (ENV.forgeApiUrl && ENV.forgeApiUrl.trim().length > 0) return "gemini-2.5-flash";
  return "gpt-4o";
}
router2.post("/api/chat/stream", async (req, res) => {
  try {
    let user;
    try {
      user = await authenticateRequestStandalone(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { message, conversationId: inputConvId, avatar = "kelion", imageUrl } = req.body;
    if (!message) {
      res.status(400).json({ error: "Message required" });
      return;
    }
    const trialStatus = await getTrialStatus(user.id);
    if (!trialStatus.canUse) {
      res.status(403).json({ error: trialStatus.reason || "Usage limit reached" });
      return;
    }
    let conversationId = inputConvId;
    if (!conversationId) {
      const title = message.slice(0, 50) + (message.length > 50 ? "..." : "");
      const result = await createConversation(user.id, title);
      conversationId = result?.id || result[0]?.id;
      if (!conversationId) {
        res.status(500).json({ error: "Failed to create conversation" });
        return;
      }
    }
    const conversation = await getConversationById(conversationId);
    if (!conversation || conversation.userId !== user.id) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    await createMessage(conversationId, "user", message);
    const dbMessages = await getMessagesByConversationId(conversationId);
    const history = dbMessages.map((m) => ({
      role: m.role,
      content: m.content || ""
    }));
    const character = avatar;
    const level = detectUserLevel(message);
    const systemPrompt = buildSystemPrompt(character, level);
    const llmMessages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-20)
    ];
    if (imageUrl) {
      const lastMsg = llmMessages[llmMessages.length - 1];
      if (lastMsg.role === "user") {
        lastMsg.content = [
          { type: "text", text: lastMsg.content },
          { type: "image_url", image_url: { url: imageUrl } }
        ];
      }
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(`data: ${JSON.stringify({ type: "meta", conversationId })}

`);
    const payload = {
      model: getModelName2(),
      messages: llmMessages,
      stream: true,
      max_tokens: 4096
    };
    const response = await fetch(resolveApiUrl2(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${getApiKey2()}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok || !response.body) {
      const errText = await response.text();
      res.write(`data: ${JSON.stringify({ type: "error", error: errText })}

`);
      res.end();
      return;
    }
    let fullContent = "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            fullContent += delta.content;
            res.write(`data: ${JSON.stringify({ type: "token", content: delta.content })}

`);
          }
        } catch {
        }
      }
    }
    await createMessage(conversationId, "assistant", fullContent, "brain-v4");
    let audioUrl;
    try {
      const ttsText = fullContent.slice(0, 500);
      const ttsResult = await generateSpeech({ text: ttsText, avatar: character });
      audioUrl = ttsResult.audioUrl;
    } catch (e) {
      console.error("[Streaming] TTS failed:", e);
    }
    res.write(`data: ${JSON.stringify({ type: "done", audioUrl, conversationId })}

`);
    if (trialStatus.isTrialUser) {
      await incrementDailyUsage(user.id, 1, 2);
    }
    res.end();
  } catch (err) {
    console.error("[Streaming] Error:", err);
    try {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}

`);
      res.end();
    } catch {
    }
  }
});
var streaming_default = router2;

// server/sentry.ts
import * as Sentry from "@sentry/node";
var SENTRY_DSN = process.env.SENTRY_DSN;
function initSentry() {
  if (!SENTRY_DSN) {
    console.log("[Sentry] No SENTRY_DSN configured, error tracking disabled");
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.1
  });
  console.log("[Sentry] Server error tracking initialized");
}

// server/_core/index.ts
initSentry();
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
var isStandalone2 = true;
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(self)");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });
  app.use((req, _res, next) => {
    const start = Date.now();
    _res.on("finish", () => {
      const duration = Date.now() - start;
      if (req.path.startsWith("/api/")) {
        console.log(`[${(/* @__PURE__ */ new Date()).toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
      }
    });
    next();
  });
  app.post("/api/stripe/webhook", express2.raw({ type: "application/json" }), handleStripeWebhook);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  if (isStandalone2) {
    console.log("[Auth] Running in STANDALONE mode (email/password)");
    const { registerStandaloneAuthRoutes: registerStandaloneAuthRoutes2 } = await Promise.resolve().then(() => (init_standalone_auth(), standalone_auth_exports));
    registerStandaloneAuthRoutes2(app);
  } else {
    console.log("[Auth] Running with Manus OAuth");
    const { registerOAuthRoutes: registerOAuthRoutes2 } = await Promise.resolve().then(() => (init_oauth(), oauth_exports));
    registerOAuthRoutes2(app);
  }
  app.get("/api/migrate", async (req, res) => {
    try {
      const { getDb: getDb2 } = await Promise.resolve().then(() => (init_db(), db_exports));
      const { sql: sqlTag } = await import("drizzle-orm");
      const db = await getDb2();
      if (!db) {
        res.status(500).json({ error: "No DB" });
        return;
      }
      const results = [];
      try {
        const testResult = await db.execute(sqlTag.raw("SELECT current_database(), version()"));
        results.push(`Connected to PostgreSQL: ${JSON.stringify(testResult[0])}`);
      } catch (e) {
        results.push(`Connection test failed: ${e.message}`);
      }
      try {
        await db.execute(sqlTag.raw("UPDATE users SET role = 'admin' WHERE email = 'adrianenc11@gmail.com'"));
        results.push("OK: set admin role for adrianenc11@gmail.com");
      } catch (e) {
        results.push(`Admin role: ${e.message}`);
      }
      try {
        await db.execute(sqlTag.raw(`
          INSERT INTO subscription_plans (name, tier, monthly_price, yearly_price, features, message_limit, voice_minutes)
          SELECT 'Pro', 'pro', 9.99, 99.90, '{"features": ["All features", "500 messages/month", "60 voice minutes"]}', 500, 60
          WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE tier = 'pro')
        `));
        await db.execute(sqlTag.raw(`
          INSERT INTO subscription_plans (name, tier, monthly_price, yearly_price, features, message_limit, voice_minutes)
          SELECT 'Enterprise', 'enterprise', 29.99, 299.90, '{"features": ["Unlimited everything", "Priority support"]}', 999999, 999999
          WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE tier = 'enterprise')
        `));
        results.push("OK: subscription plans");
      } catch (e) {
        results.push(`Subscription plans: ${e.message}`);
      }
      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/profile/avatar", async (req, res) => {
    try {
      const { updateUserProfilePicture: updateUserProfilePicture2 } = await Promise.resolve().then(() => (init_db(), db_exports));
      const { jwtVerify: jwtVerify3 } = await import("jose");
      const cookieName = "app_session_id";
      const cookies = req.headers.cookie?.split(";").reduce((acc, c) => {
        const [k, v] = c.trim().split("=");
        acc[k] = v;
        return acc;
      }, {}) || {};
      const token = cookies[cookieName];
      if (!token) {
        res.status(401).json({ error: "Not authenticated" });
        return;
      }
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
      const { payload } = await jwtVerify3(token, secret);
      const userId = payload.userId || payload.id;
      if (!userId) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      const { avatarUrl } = req.body;
      if (!avatarUrl) {
        res.status(400).json({ error: "avatarUrl required" });
        return;
      }
      await updateUserProfilePicture2(userId, avatarUrl);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  app.use("/uploads", express2.static("uploads"));
  app.use(streaming_default);
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
